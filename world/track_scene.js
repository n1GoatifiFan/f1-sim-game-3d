/* ==========================================================================
   F1 2026 — world/track_scene.js
   Circuit scene: builds a track model + procedural environment and provides
   camera modes for inspection (flyover, orbit, trackside). This is what the
   driveable session (Section 3) mounts its car into.

   F1.trackScene.create(circuitId, opts) -> {
     scene, camera, api, world, track,
     setCameraMode(mode), destroy()
   }
   ========================================================================== */
(function (F1) {
  'use strict';

  F1.trackScene = {
    create: function (circuitId, opts) {
      opts = opts || {};
      var meta = F1.DATA.getCircuitMeta(circuitId);
      var track = F1.getTrack(circuitId);
      if (!track) throw new Error('no geometry for circuit ' + circuitId);

      var scene = new THREE.Scene();
      var world = F1.world.build(track, meta, opts);
      scene.add(world.group);
      // exp2 fog matched to the atmosphere so the far terrain dissolves into
      // the sky colour instead of a grey band
      var fogCol = world.fogColor ? world.fogColor.clone() : new THREE.Color(0xc8d8e6);
      var drawDist = F1.renderer.camera.far || 2600;
      var fogDefault = null;   // keeps the base fog so camera modes can restore it
      scene.fog = new THREE.FogExp2(fogCol.getHex(), 1 / (drawDist * 0.42));
      fogDefault = scene.fog;
      // let world.setWeather('wet'|'overcast') recolour the scene fog
      if (world.setFogHook) {
        world.setFogHook(function (col) { scene.fog.color.copy(col); });
      }
      function applyFog() {
        if (!scene.fog) return;
        if (mode === 'orbit' || mode === 'shots') {
          // aerial/cinematic views: the whole circuit must read, only the far
          // terrain fades. A fixed density would fog out the entire lap.
          var span = Math.max(track.bounds.maxX - track.bounds.minX,
                              track.bounds.maxZ - track.bounds.minZ);
          scene.fog.density = 1 / (Math.max(1600, span * 9));
        } else {
          scene.fog.density = 1 / (drawDist * 0.42);
        }
      }

      var camera = new THREE.PerspectiveCamera(F1.settings.graphics.fov, 1, 0.3, 6000);

      /* PMREM environment generated from the sky dome: ambient + reflections */
      scene.environment = world.envMap;
      scene.environmentIntensity = 0.62;
      scene.background = null;

      /* the per-circuit filmic grade + exposure, applied by the post chain */
      if (F1.post && F1.post.setGrade) {
        var g = world.grade || {};
        /* a circuit can push the time-of-day look around without touching the
           global pipeline: data/environments/<id>.js -> look{...} */
        var look = (world.art && world.art.look) || {};
        /* exposure is a camera property: it has to happen before the tone
           curve, so it goes on the renderer, not in the display-referred grade */
        if (F1.renderer && F1.renderer.renderer) {
          F1.renderer.renderer.toneMappingExposure =
            (world.exposure || 1) * (look.exposure || 1);
        }
        F1.post.setGrade({
          exposure: 1,
          contrast: (g.contrast || 1) * (look.contrast || 1),
          saturation: (g.saturation || 1) * (look.saturation || 1),
          lift: g.lift, gain: g.gain,
          tintU: (g.tintU || 0) + (look.warm || 0),
          vignette: look.vignette !== undefined ? look.vignette
            : (mode === 'race' ? 0.34 : 0.24),
          grain: 0.014
        });
        F1.post.setBloom(0.3, 0.55, 0.92);
      }

      /* ---------------- cameras ---------------- */
      var span = Math.max(track.bounds.maxX - track.bounds.minX, track.bounds.maxZ - track.bounds.minZ);
      var orbit = {
        target: new THREE.Vector3(0, 0, 0),
        yaw: 0.6, pitch: 0.95, dist: Math.max(300, span * 1.15)
      };
      var fly = { s: 0, speed: 55, height: 14, look: 55 };
      // stand the trackside camera on the pit side, looking across at the
      // main grandstand (side +1), which is the shot people recognise
      var trackside = { s: track.length * 0.94, side: -1 };
      var mode = opts.mode || 'flyover';
      applyFog();   /* the initial mode needs its fog too, not just camera changes */

      function setCameraMode(m) {
        mode = m;
        scene.fog = fogDefault;
        if (m === 'orbit') {
          orbit.pitch = 0.98;
          orbit.dist = Math.max(260, span * 0.66);
          applyFog();
        }
        if (m === 'orbit') {
          orbit.target.set(0, 0, 0);
        }
        F1.bus.emit('camera-mode', m);
      }

      /* mouse orbit controls (only active in orbit mode) */
      var dragging = false, lastX = 0, lastY = 0;
      var canvas = document.getElementById('gl');
      function onDown(e) {
        if (mode !== 'orbit') return;
        dragging = true;
        lastX = e.clientX; lastY = e.clientY;
      }
      function onMove(e) {
        if (!dragging) return;
        orbit.yaw -= (e.clientX - lastX) * 0.005;
        orbit.pitch = F1.util.clamp(orbit.pitch + (e.clientY - lastY) * 0.004, 0.08, 1.5);
        lastX = e.clientX; lastY = e.clientY;
      }
      function onUp() { dragging = false; }
      function onWheel(e) {
        if (mode !== 'orbit') return;
        e.preventDefault();
        orbit.dist = F1.util.clamp(orbit.dist * (1 + e.deltaY * 0.0012), 40, 3000);
      }
      if (canvas) {
        canvas.addEventListener('mousedown', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        canvas.addEventListener('wheel', onWheel, { passive: false });
      }

      var p = {};
      var api = null;
      function update(dt) {
        if (mode === 'race') {
          // a race session drives the camera and the world clock itself
          world.update(dt);
          if (world.atmo && world.atmo.follow) world.atmo.follow(camera.position);
          if (api && api.onFrame) api.onFrame(dt);
          return;
        }
        world.update(dt);
        if (world.atmo && world.atmo.follow) world.atmo.follow(camera.position);
        world.setShadowFocus && world.setShadowFocus(camera.position.x, camera.position.z);
        if (mode === 'flyover') {
          fly.s = (fly.s + fly.speed * dt) % track.length;
          track.at(fly.s, p);
          p.x -= track.origin.x; p.z -= track.origin.z;
          var lookAt = track.at((fly.s + fly.look) % track.length, {});
          lookAt.x -= track.origin.x; lookAt.z -= track.origin.z;
          var h = p.heading;
          // chase-style flyover: behind and above the racing line
          camera.position.set(
            p.x - Math.sin(h) * 26 + Math.cos(h) * 9,
            p.y + fly.height,
            p.z - Math.cos(h) * 26 - Math.sin(h) * 9);
          camera.lookAt(lookAt.x, lookAt.y + 1.5, lookAt.z);
        } else if (mode === 'trackside') {
          // fixed camera rig: stands back from the barrier, above the
          // catch-fencing line, framed down the track like a TV camera
          trackside.s = (trackside.s + dt * 2.2) % track.length;
          var pt = track.at(trackside.s, {});
          pt.x -= track.origin.x; pt.z -= track.origin.z;
          var lat = trackside.side * (pt.width * 0.5 + 22);
          camera.position.set(
            pt.x + Math.cos(pt.heading) * lat,
            pt.y + 13.5,
            pt.z - Math.sin(pt.heading) * lat);
          var nxt = track.at((trackside.s + 55) % track.length, {});
          nxt.x -= track.origin.x; nxt.z -= track.origin.z;
          camera.lookAt(nxt.x, nxt.y + 1.0, nxt.z);
        } else {
          var cx = Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * orbit.dist;
          var cz = Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * orbit.dist;
          var cy = Math.sin(orbit.pitch) * orbit.dist;
          // never dive below the terrain at this point of the map
          var minY = (track.maxY || 12) + 70;
          camera.position.set(orbit.target.x + cx, Math.max(minY, cy), orbit.target.z + cz);
          camera.lookAt(orbit.target.x, orbit.target.y, orbit.target.z);
        }
      }

      function onResize(w, h2) {
        camera.aspect = w / h2;
        camera.updateProjectionMatrix();
      }
      F1.renderer.onResize(onResize);
      onResize(window.innerWidth, window.innerHeight);

      function destroy() {
        scene.remove(world.group);
        world.dispose();
        if (canvas) {
          canvas.removeEventListener('mousedown', onDown);
          canvas.removeEventListener('wheel', onWheel);
        }
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }

      api = {
        scene: scene, camera: camera, update: update, mode: 'track',
        onFrame: null,
        world: world, track: track, meta: meta,
        setCameraMode: setCameraMode,
        destroy: destroy
      };

      return api;
    }
  };
})(window.F1 = window.F1 || {});
