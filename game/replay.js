/* ==========================================================================
   F1 2026 — game/replay.js
   Instant replay and photo mode.

   The replay is a ring buffer of poses, not a recording of physics: every
   car's position, heading, steering and wheel spin at 12 Hz is enough to
   reproduce a lap exactly as it looked. Photo mode freezes the world and
   hands the camera to the player.

     var rp = F1.replay.create({ session, sceneApi, cars: [...] });
     rp.record(dt);          // every frame while racing
     rp.start();             // rewind 12 s and play it back
     rp.update(dt);          // during playback, drives the meshes + camera
     rp.stop();
     rp.photo.toggle();
   ========================================================================== */
(function (F1) {
  'use strict';

  var RATE = 12;              // samples per second
  var SECONDS = 95;           // ring length
  var MAX_ACTORS = 24;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function create(opts) {
    opts = opts || {};
    var session = opts.session;
    var sceneApi = opts.sceneApi;
    var actors = opts.actors || [];       // [{ car, mesh, wheels }]
    var capacity = RATE * SECONDS;
    var frames = [];                      // [{ t, poses: Float32Array }]
    var clock = 0;
    var acc = 0;
    var playing = false;
    var playT = 0;
    var speed = 1;
    var camMode = 'tv';

    /* ---------------- recording ---------------- */
    function record(dt) {
      if (playing || !(dt > 0)) return;
      clock += dt;
      acc += dt;
      if (acc < 1 / RATE) return;
      acc = 0;
      var poses = new Float32Array(actors.length * 7);
      for (var i = 0; i < actors.length; i++) {
        var c = actors[i].car;
        var o = i * 7;
        poses[o] = c.x; poses[o + 1] = c.y; poses[o + 2] = c.z;
        poses[o + 3] = c.heading; poses[o + 4] = c.steer;
        poses[o + 5] = actors[i].spin || 0; poses[o + 6] = c.latG || 0;
      }
      frames.push({ t: clock, poses: poses });
      if (frames.length > capacity) frames.shift();
      if (actors[0]) actors[0].spin = actors[0].spin;
    }

    function sampleSpin(i) {
      var w = actors[i].wheels;
      return w && w.length ? w[0].spin.rotation.x : 0;
    }

    /* ---------------- playback ---------------- */
    function start(secondsBack) {
      if (frames.length < RATE * 2) return false;
      playing = true;
      speed = 1;
      var back = secondsBack || 12;
      playT = Math.max(0, frames[frames.length - 1].t - back);
      return true;
    }

    function stop() {
      playing = false;
    }

    function poseAt(t) {
      // binary search for the frame before t
      var lo = 0, hi = frames.length - 1;
      if (t <= frames[0].t) return frames[0];
      if (t >= frames[hi].t) return frames[hi];
      while (hi - lo > 1) {
        var mid = (lo + hi) >> 1;
        if (frames[mid].t <= t) lo = mid; else hi = mid;
      }
      return frames[lo];
    }

    function apply(t) {
      var a = poseAt(t);
      var b = poseAt(t + 1 / RATE);
      var span = Math.max(1e-4, b.t - a.t);
      var f = clamp((t - a.t) / span, 0, 1);
      for (var i = 0; i < actors.length; i++) {
        var act = actors[i];
        if (!act.mesh) continue;
        var o = i * 7;
        var x = a.poses[o] + (b.poses[o] - a.poses[o]) * f;
        var y = a.poses[o + 1] + (b.poses[o + 1] - a.poses[o + 1]) * f;
        var z = a.poses[o + 2] + (b.poses[o + 2] - a.poses[o + 2]) * f;
        var h = a.poses[o + 3];
        var dh = b.poses[o + 3] - h;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        var steer = a.poses[o + 4];
        var spin = a.poses[o + 5] + (b.poses[o + 5] - a.poses[o + 5]) * f;
        var latG = a.poses[o + 6];
        var track = session && session.track;
        var ox = track ? track.origin.x : 0, oz = track ? track.origin.z : 0;
        act.mesh.position.set(x - ox, y, z - oz);
        act.mesh.rotation.set(0, h + dh * f + Math.PI, clamp(latG * 0.035, -0.06, 0.06), 'YXZ');
        for (var w = 0; w < (act.wheels || []).length; w++) {
          var wh = act.wheels[w];
          if (wh.front) wh.node.rotation.y = steer;
          wh.spin.rotation.x = spin;
        }
      }
      return { x: a.poses[0], y: a.poses[1], z: a.poses[2], heading: a.poses[3] };
    }

    function update(dt) {
      if (!playing) return false;
      if (dt > 0) playT += dt * speed;
      var last = frames[frames.length - 1].t;
      if (playT >= last) { playing = false; return false; }
      var p = apply(playT);
      if (session && session.cams && sceneApi) {
        var track = session.track;
        session.cams.update(sceneApi.camera, dt, {
          x: p.x - track.origin.x, y: p.y, z: p.z - track.origin.z,
          heading: p.heading, vx: 40, steer: 0, latG: 0, surface: 'asphalt', s: 0
        }, { replay: true });
      }
      return true;
    }

    function seek(frac) {
      if (!frames.length) return 0;
      var t0 = frames[0].t, t1 = frames[frames.length - 1].t;
      playT = t0 + (t1 - t0) * clamp(frac, 0, 1);
      apply(playT);
      return playT;
    }

    /* ---------------- photo mode ---------------- */
    var photo = {
      active: false,
      yaw: 0.6,
      pitch: 0.32,
      dist: 7.5,
      target: new THREE.Vector3(),
      wasPaused: false,
      toggle: function (on) {
        photo.active = on === undefined ? !photo.active : !!on;
        if (photo.active) {
          // the frame guard in session.update freezes the sim; the pause
          // overlay would be the wrong message so it is deliberately not used
          var car = opts.actors && opts.actors[0] ? opts.actors[0].car : null;
          if (car) {
            var track = session.track;
            photo.target.set(car.x - track.origin.x, car.y + 0.6, car.z - track.origin.z);
          }
          F1.bus.emit('photo-mode', true);
        } else {
          photo.wasPaused = false;
          F1.bus.emit('photo-mode', false);
        }
      },
      orbit: function (dx, dy, wheel) {
        photo.yaw += dx * 0.005;
        photo.pitch = clamp(photo.pitch + dy * 0.004, -0.15, 1.35);
        if (wheel) photo.dist = clamp(photo.dist + wheel * 0.004, 2.2, 40);
      },
      update: function (camera) {
        if (!photo.active || !camera) return;
        var d = photo.dist;
        var cx = Math.sin(photo.yaw) * Math.cos(photo.pitch) * d;
        var cy = Math.sin(photo.pitch) * d + 0.9;
        var cz = Math.cos(photo.yaw) * Math.cos(photo.pitch) * d;
        camera.position.set(photo.target.x + cx, photo.target.y + cy, photo.target.z + cz);
        camera.lookAt(photo.target);
      },
      /* a PNG straight out of the canvas, offered as a download */
      capture: function (name) {
        try {
          /* the drawing buffer is not preserved (that is a real frame-rate
             cost), so re-render immediately before reading the pixels */
          if (opts.sceneApi && F1.renderer.render) {
            F1.renderer.render(opts.sceneApi.scene, opts.sceneApi.camera);
          }
          var canvas = (F1.renderer.renderer && F1.renderer.renderer.domElement) || F1.renderer.canvas;
          if (!canvas) return false;
          var url = canvas.toDataURL('image/png');
          var a = document.createElement('a');
          a.href = url;
          a.download = (name || 'f1-2026-photo') + '.png';
          document.body.appendChild(a);
          a.click();
          a.remove();
          return true;
        } catch (e) {
          console.warn('[photo] capture failed', e);
          return false;
        }
      }
    };

    return {
      record: record,
      start: start,
      stop: stop,
      update: update,
      seek: seek,
      apply: apply,
      photo: photo,
      get playing() { return playing; },
      get progress() {
        if (!frames.length) return 0;
        var t0 = frames[0].t, t1 = frames[frames.length - 1].t;
        return t1 > t0 ? (playT - t0) / (t1 - t0) : 0;
      },
      get length() { return frames.length ? frames[frames.length - 1].t - frames[0].t : 0; },
      setSpeed: function (v) { speed = v; },
      sampleSpin: sampleSpin
    };
  }

  F1.replay = { create: create, RATE: RATE, SECONDS: SECONDS };
})(window.F1 = window.F1 || {});
