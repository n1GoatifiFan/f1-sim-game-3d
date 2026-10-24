/* ==========================================================================
   F1 2026 — physics/cameras.js
   Onboard and broadcast camera rigs. Everything works in the world group's
   local space, i.e. track coordinates minus track.origin.

     var cams = F1.cameras.create(track);
     cams.mode; cams.set('tcam'); cams.next(); cams.prev();
     cams.update(camera, dt, car, { lookBack:false, shake:0 });
     cams.label(); cams.focus;      // {x,y,z} — for setShadowFocus()

   car must expose { x, y, z, heading, vx, steer, latG, surface, airborne }
   in world-local metres.
   ========================================================================== */
(function (F1) {
  'use strict';

  var MODES = ['tcam', 'cockpit', 'chase', 'tv', 'cinematic'];

  var LABELS = {
    tcam: 'T-Cam',
    cockpit: 'Cockpit',
    chase: 'Chase',
    tv: 'Broadcast',
    cinematic: 'Cinematic'
  };

  function damp(cur, target, lambda, dt) {
    return cur + (target - cur) * (1 - Math.exp(-lambda * dt));
  }

  F1.cameras = {
    MODES: MODES,
    LABELS: LABELS,

    create: function (track) {
      var mode = 'tcam';
      var blend = 1;                    // 0..1 fade after a mode switch
      var prevMode = null;
      var shakeAmt = 0;

      /* broadcast posts: fixed rigs around the lap, cut between them the way
         a TV director does — the shot follows the car for ~6 s, then cuts */
      var posts = [];
      var NP = 14;
      for (var i = 0; i < NP; i++) {
        var s = track.length * (i / NP) + (i % 3) * 26;
        s = track.wrapS(s);
        var p = track.at(s, {});
        var side = (i % 2 === 0) ? 1 : -1;
        var off = p.width * 0.5 + 20 + (i % 4) * 6;
        posts.push({
          s: s,
          x: p.x - track.origin.x + Math.cos(p.heading) * off * side,
          y: p.y + 11 + (i % 3) * 3.5,
          z: p.z - track.origin.z - Math.sin(p.heading) * off * side,
          side: side
        });
      }
      // ordering by s makes the "next post" scan trivial
      posts.sort(function (a, b) { return a.s - b.s; });

      var target = new THREE.Vector3();
      var pos = new THREE.Vector3();
      var look = new THREE.Vector3();
      var postIdx = 0;
      var shotT = 0;
      var lastCar = null;
      var lastS = 0;

      var api = {
        mode: mode,
        posts: posts,
        focus: { x: 0, y: 0, z: 0 },

        set: function (m) {
          if (MODES.indexOf(m) < 0 || m === mode) return mode;
          prevMode = mode;
          mode = m;
          api.mode = m;
          blend = 0;
          shotT = 0;
          // a new rig starts from where the old one was, so the cut reads as a
          // camera change rather than a teleport across the circuit
          if (cam) { pos.copy(cam.position); lastCar = null; }
          if (m === 'tv') { updatePost({ s: lastS || 0 }); snapPost(cam); }
          return mode;
        },
        next: function () {
          return api.set(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
        },
        prev: function () {
          return api.set(MODES[(MODES.indexOf(mode) + MODES.length - 1) % MODES.length]);
        },
        label: function () { return LABELS[mode]; },

        /* the camera's actual position, for shadow focus + audio  */
        position: function (out) {
          out = out || {};
          out.x = cam.x; out.y = cam.y; out.z = cam.z;
          return out;
        },

        update: function (camera, dt, car, opts) {
          if (!camera || !car) return camera;
          opts = opts || {};
          cam = camera;
          lastCar = car;
          lastS = car.s || 0;
          if (!isFinite(pos.x) || !isFinite(pos.y) || !isFinite(pos.z)) {
            pos.set(car.x - Math.sin(car.heading) * 6, car.y + 2.4, car.z - Math.cos(car.heading) * 6);
          }
          dt = Math.min(dt || 0.016, 0.1);
          blend = Math.min(1, blend + dt * 3.2);

          // speed-driven shake: kerbs + 300 km/h wind buffeting
          var kerb = car.surface === 'kerb' || car.surface === 'astro' ? 1 : 0;
          var spd = Math.abs(car.vx || 0) / 100;
          var want = kerb * 0.55 + Math.max(0, spd - 0.62) * 0.5 + (opts.shake || 0);
          shakeAmt = damp(shakeAmt, want, 9, dt);
          var t = performance.now() * 0.001;
          var sh = shakeAmt * 0.012;

          var h = car.heading || 0;
          var fx = Math.sin(h), fz = Math.cos(h);
          var rx = Math.cos(h), rz = -Math.sin(h);
          var cx = car.x, cy = (car.y || 0), cz = car.z;

          if (mode === 'tcam') {
            var dir = opts.lookBack ? -1 : 1;
            pos.set(cx + fx * 0.02 * dir,
              cy + 1.62 + Math.sin(t * 7) * sh,
              cz + fz * 0.02 * dir);
            look.set(cx + fx * 24 * dir + rx * (car.steer || 0) * 3,
              cy + 0.95 + Math.sin(t * 5.1) * sh,
              cz + fz * 24 * dir);
            look.x += Math.sin(t * 11) * sh * 6;
            look.z += Math.cos(t * 9) * sh * 6;
            apply(camera, pos, look, 0);
          } else if (mode === 'cockpit') {
            // nose cam: 1.9 m ahead of the CG, just above the front wing
            pos.set(cx + fx * 1.9, cy + 0.72 + Math.sin(t * 9) * sh * 0.6, cz + fz * 1.9);
            look.set(cx + fx * 32 + rx * (car.steer || 0) * 7,
              cy + 0.62 - (car.latG || 0) * 0.06 + Math.sin(t * 6) * sh * 0.5,
              cz + fz * 32);
            apply(camera, pos, look, (car.latG || 0) * 0.012);
          } else if (mode === 'chase') {
            var dist = 5.8 + spd * 0.55;
            var ht = 1.95 + spd * 0.16;
            target.set(cx - fx * dist, cy + ht, cz - fz * dist);
            // lazy spring: the camera trails the car and swings on corner exit
            pos.x = damp(pos.x, target.x, 4.6, dt);
            pos.y = damp(pos.y, target.y, 4.0, dt);
            pos.z = damp(pos.z, target.z, 4.6, dt);
            var ahead = 9 + spd * 4;
            look.set(cx + fx * ahead, cy + 0.85, cz + fz * ahead);
            apply(camera, pos, look, 0);
          } else if (mode === 'tv') {
            shotT += dt;
            updatePost(car);
            var post = posts[postIdx];
            pos.set(post.x, post.y, post.z);
            look.set(cx + fx * 6 + rx * 1.5, cy + 0.55, cz + fz * 6);
            apply(camera, pos, look, 0);
            // a director's cut is stable; only nudge when the car is far away
            if (pos.distanceTo(look) > 520) snapPost(camera);
          } else {
            /* cinematic: wide, low, slowly drifting to the outside of the
               corner — used for replays and photo mode */
            var wide = 16 + spd * 3;
            target.set(cx - fx * wide + rx * (car.latG > 0 ? -4 : 4),
              cy + 3.6, cz - fz * wide - rz * (car.latG > 0 ? -4 : 4));
            pos.x = damp(pos.x, target.x, 1.9, dt);
            pos.y = damp(pos.y, target.y + 1.4, 1.5, dt);
            pos.z = damp(pos.z, target.z, 1.9, dt);
            look.set(cx + fx * 5, cy + 0.95, cz + fz * 5);
            apply(camera, pos, look, (car.latG || 0) * 0.006);
          }

          api.focus.x = camera.position.x;
          api.focus.y = camera.position.y;
          api.focus.z = camera.position.z;
          return camera;
        }
      };

      var cam = null;

      /* helpers -------------------------------------------------------- */
      function apply(camera, p, l, roll) {
        camera.position.lerp(p, blend < 1 ? 0.35 : 1);
        if (blend < 1) {
          camera.position.copy(p);
        } else {
          camera.position.copy(p);
        }
        var up = camera.up;
        up.set(Math.sin(roll || 0), Math.cos(roll || 0), 0);
        camera.lookAt(l);
        camera.up.set(0, 1, 0);
      }

      function camDistanceToCar(car) {
        var p = posts[postIdx];
        var dx = p.x - car.x, dz = p.z - car.z;
        return Math.sqrt(dx * dx + dz * dz);
      }

      /* pick the post that is currently "on air": the closest one the car has
         already passed, or the next one up the road when the car is early */
      function updatePost(car) {
        var s = track.wrapS(car.s || 0);
        var best = -1, bestD = 1e9;
        for (var i = 0; i < posts.length; i++) {
          var d = track.wrapS(s - posts[i].s);         // metres travelled since the post
          // prefer posts 0..170 m behind the car: that is the classic
          // "camera ahead of the corner, car approaching" shot
          var score = Math.abs(d - 55);
          if (d > 300) score += 400;
          if (score < bestD) { bestD = score; best = i; }
        }
        if (best >= 0 && best !== postIdx) {
          // hold a shot for at least a second so cuts don't strobe
          if (shotT > 1.0 || bestD < 40) postIdx = best;
        }
      }

      function snapPost(camera) {
        var c = camera || cam;
        if (!c) return;
        var p = posts[postIdx];
        c.position.set(p.x, p.y, p.z);
        pos.set(p.x, p.y, p.z);
      }

      return api;
    }
  };
})(window.F1 = window.F1 || {});
