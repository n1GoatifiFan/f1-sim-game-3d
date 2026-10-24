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
      // fog only needs to soften the far distance: keep it well beyond the
      // circuit so wide shots (orbit / flyover) stay readable
      var fogCol = new THREE.Color(world.sky.material.uniforms.bottom.value).lerp(new THREE.Color(0xffffff), 0.15);
      var drawDist = F1.renderer.camera.far || 2600;
      var fogDefault = null;   // keeps the day fog so camera modes can restore it
      scene.fog = new THREE.Fog(fogCol, drawDist * 0.45, drawDist * 0.97);
      fogDefault = scene.fog;
      // let world.setWeather('wet'|'overcast') recolour the scene fog
      if (world.setFogHook) {
        world.setFogHook(function (col) { scene.fog.color.copy(col); });
      }
      function applyFog() {
        if (!scene.fog) return;
        if (mode === 'orbit') {
          // keep the whole circuit crisp, only fade the far terrain
          scene.fog.near = orbit.dist * 1.25;
          scene.fog.far = orbit.dist * 3.2;
        } else {
          scene.fog.near = drawDist * 0.45;
          scene.fog.far = drawDist * 0.97;
        }
      }

      var camera = new THREE.PerspectiveCamera(F1.settings.graphics.fov, 1, 0.3, 6000);

      /* sky-coloured environment map: gives PBR materials ambient light */
      scene.environment = world.envMap;
      scene.environmentIntensity = 0.85;
      scene.background = null;

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
          if (api && api.onFrame) api.onFrame(dt);
          return;
        }
        world.update(dt);
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
