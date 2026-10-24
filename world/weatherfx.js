/* ==========================================================================
   F1 2026 — world/weatherfx.js
   Rain. A few thousand instanced streaks that follow the camera, plus a
   screen-space wet sheen that the HUD can dim with.

   The particles are one THREE.Points cloud in world space: cheaper than a
   shader, and at 60 km/h nobody counts them. Intensity is driven by race
   control's rain value, so the rain starts and stops with the forecast.

     var fx = F1.weatherfx.create(scene);
     fx.setIntensity(0.7);
     fx.update(dt, camera);
     fx.dispose();
   ========================================================================== */
(function (F1) {
  'use strict';

  function makeStreakTexture() {
    var c = document.createElement('canvas');
    c.width = 8; c.height = 64;
    var g = c.getContext('2d');
    var grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.35, 'rgba(214,232,246,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(2, 0, 4, 64);
    var tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  F1.weatherfx = {
    create: function (scene, opts) {
      opts = opts || {};
      var COUNT = opts.count || 2600;
      var SPREAD = opts.spread || 46;     // metres around the camera
      var HEIGHT = opts.height || 26;

      var geo = new THREE.BufferGeometry();
      var pos = new Float32Array(COUNT * 3);
      var vel = new Float32Array(COUNT);
      for (var i = 0; i < COUNT; i++) {
        pos[i * 3] = (Math.random() - 0.5) * SPREAD * 2;
        pos[i * 3 + 1] = Math.random() * HEIGHT;
        pos[i * 3 + 2] = (Math.random() - 0.5) * SPREAD * 2;
        vel[i] = 26 + Math.random() * 14;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

      var mat = new THREE.PointsMaterial({
        map: makeStreakTexture(),
        color: 0xbcd6ea,
        size: 0.55,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });

      var points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      points.visible = false;
      scene.add(points);

      var intensity = 0;
      var target = 0;
      var wind = { x: 2.2, z: -1.1 };

      var api = {
        points: points,

        setIntensity: function (v) {
          target = Math.max(0, Math.min(1, v || 0));
        },

        update: function (dt, camera) {
          // ease so rain does not pop on and off with a forecast change
          intensity += (target - intensity) * Math.min(1, dt * 0.6);
          var visible = intensity > 0.02;
          points.visible = visible;
          if (!visible) return;
          mat.opacity = 0.34 * intensity;

          var cam = camera && camera.position ? camera.position : { x: 0, y: 0, z: 0 };
          var arr = geo.attributes.position.array;
          var fall = 1 + intensity * 0.5;
          for (var i = 0; i < COUNT; i++) {
            var j = i * 3;
            arr[j + 1] -= vel[i] * dt * fall;
            arr[j] += wind.x * dt;
            arr[j + 2] += wind.z * dt;
            // wrap around the camera so the cloud always surrounds the view
            if (arr[j + 1] < cam.y - 8) {
              arr[j + 1] = cam.y + HEIGHT * (0.55 + Math.random() * 0.45);
              arr[j] = cam.x + (Math.random() - 0.5) * SPREAD * 2;
              arr[j + 2] = cam.z + (Math.random() - 0.5) * SPREAD * 2;
            }
            if (arr[j] - cam.x > SPREAD) arr[j] -= SPREAD * 2;
            else if (arr[j] - cam.x < -SPREAD) arr[j] += SPREAD * 2;
            if (arr[j + 2] - cam.z > SPREAD) arr[j + 2] -= SPREAD * 2;
            else if (arr[j + 2] - cam.z < -SPREAD) arr[j + 2] += SPREAD * 2;
          }
          geo.attributes.position.needsUpdate = true;
        },

        dispose: function () {
          if (points.parent) points.parent.remove(points);
          geo.dispose();
          mat.map && mat.map.dispose();
          mat.dispose();
        }
      };
      return api;
    }
  };
})(window.F1 = window.F1 || {});
