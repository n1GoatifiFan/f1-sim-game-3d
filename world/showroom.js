/* ==========================================================================
   F1 2026 — world/showroom.js
   The garage / main-menu 3D stage: studio floor, lighting, turntable and the
   procedural car. Used as the menu backdrop as well as the Garage screen.
   ========================================================================== */
(function (F1) {
  'use strict';

  var ENV_TEX = null;

  /* procedural studio environment (equirect) for believable car paint */
  function studioEnv() {
    if (ENV_TEX) return ENV_TEX;
    var c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    var ctx = c.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#0a0d13');
    g.addColorStop(0.45, '#1a1f27');
    g.addColorStop(0.55, '#2a3038');
    g.addColorStop(1, '#07090c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 256);

    // soft studio strip lights
    function strip(x, y, w, h, col, blur) {
      var lg = ctx.createLinearGradient(0, y, 0, y + h);
      lg.addColorStop(0, 'rgba(255,255,255,0)');
      lg.addColorStop(0.5, col);
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(x, y, w, h);
    }
    strip(20, 40, 150, 22, 'rgba(255,255,255,0.95)');
    strip(330, 30, 130, 18, 'rgba(210,230,255,0.8)');
    strip(90, 70, 60, 60, 'rgba(255,255,255,0.25)');
    strip(390, 150, 90, 90, 'rgba(255,190,120,0.18)');

    ENV_TEX = new THREE.CanvasTexture(c);
    ENV_TEX.mapping = THREE.EquirectangularReflectionMapping;
    ENV_TEX.colorSpace = THREE.SRGBColorSpace;
    return ENV_TEX;
  }
  F1.studioEnvMap = studioEnv;

  function floorTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 512;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#0b0e12';
    ctx.fillRect(0, 0, 512, 512);
    var g = ctx.createRadialGradient(256, 256, 30, 256, 256, 256);
    g.addColorStop(0, 'rgba(34,42,54,0.55)');
    g.addColorStop(0.55, 'rgba(16,20,26,0.35)');
    g.addColorStop(1, 'rgba(4,6,8,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    // fine concentric rings
    ctx.strokeStyle = 'rgba(150,170,190,0.05)';
    for (var r = 40; r < 260; r += 24) {
      ctx.beginPath(); ctx.arc(256, 256, r, 0, Math.PI * 2); ctx.stroke();
    }
    var t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function makeTextPlane(text, sub, color) {
    var c = document.createElement('canvas');
    c.width = 1024; c.height = 256;
    var ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 1024, 256);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.font = 'italic 900 96px "Arial Narrow", Arial, sans-serif';
    ctx.fillText(text.toUpperCase(), 30, 100);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = 'italic 600 40px "Arial Narrow", Arial, sans-serif';
    ctx.fillText(sub, 32, 180);
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  F1.showroom = {
    create: function () {
      var scene = new THREE.Scene();
      scene.background = new THREE.Color(0x05070a);
      scene.fog = new THREE.FogExp2(0x05070a, 0.028);
      scene.environment = studioEnv();
      scene.environmentIntensity = 0.9;

      var camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
      function fitAspect(w, h) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      F1.renderer.onResize(fitAspect);
      fitAspect(window.innerWidth, window.innerHeight);

      /* ---------------- floor + turntable ---------------- */
      var floorMat = new THREE.MeshStandardMaterial({
        color: 0x151a21, roughness: 0.42, metalness: 0.55,
        map: floorTexture()
      });
      var floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.02;
      floor.receiveShadow = true;
      scene.add(floor);

      var platform = new THREE.Group();
      var disc = new THREE.Mesh(new THREE.CylinderGeometry(3.35, 3.45, 0.12, 64),
        new THREE.MeshStandardMaterial({ color: 0x1b2029, roughness: 0.35, metalness: 0.65 }));
      disc.position.y = 0.06;
      disc.receiveShadow = true;
      platform.add(disc);

      var ringMat = new THREE.MeshStandardMaterial({
        color: 0xff8000, emissive: 0xff8000, emissiveIntensity: 0.6, roughness: 0.4
      });
      var ring = new THREE.Mesh(new THREE.TorusGeometry(3.38, 0.022, 8, 96), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.13;
      platform.add(ring);
      scene.add(platform);

      var glowRing = new THREE.Mesh(new THREE.RingGeometry(3.5, 14.0, 96),
        new THREE.MeshBasicMaterial({ color: 0x0a1620, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
      glowRing.rotation.x = -Math.PI / 2;
      glowRing.position.y = 0.005;
      scene.add(glowRing);

      /* floor text (team + driver) */
      var label = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.15),
        new THREE.MeshBasicMaterial({ map: makeTextPlane('McLaren', 'Lando Norris \u00b7 1', '#ffffff'), transparent: true, opacity: 0.5, depthWrite: false }));
      label.rotation.x = -Math.PI / 2;
      label.position.set(-0.2, 0.02, -4.4);
      label.rotation.z = Math.PI;
      scene.add(label);

      /* ---------------- lights ---------------- */
      scene.add(new THREE.HemisphereLight(0xb4c8de, 0x0c0f13, 0.55));

      // key light sits on the camera side of the car (viewer sees lit bodywork)
      var key = new THREE.SpotLight(0xffffff, 620, 45, 0.72, 0.65, 1.4);
      key.position.set(-4.2, 7.5, 7.2);
      key.target.position.set(0, 0.4, 0);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.bias = -0.0004;
      key.shadow.camera.near = 1;
      key.shadow.camera.far = 34;
      scene.add(key, key.target);

      var fill = new THREE.DirectionalLight(0xc8d8ec, 0.55);
      fill.position.set(5, 4.5, 4);
      scene.add(fill);
      var frontFill = new THREE.DirectionalLight(0xfff6ea, 0.3);
      frontFill.position.set(-2, 2.2, 9);
      scene.add(frontFill);

      var rim = new THREE.SpotLight(0x66ddff, 260, 34, 0.7, 0.8, 1.8);
      rim.position.set(5.5, 3.2, -6.0);
      rim.target.position.set(0, 0.6, 0);
      scene.add(rim, rim.target);

      var warm = new THREE.PointLight(0xff8844, 12, 18, 2);
      warm.position.set(4.5, 1.2, 5.5);
      scene.add(warm);

      var back = new THREE.DirectionalLight(0xfff2e0, 0.25);
      back.position.set(-2, 3, -8);
      scene.add(back);

      /* ---------------- car ---------------- */
      var carHolder = new THREE.Group();
      carHolder.position.y = 0.13;   // platform top
      scene.add(carHolder);
      var car = null;
      var current = { teamId: 'mclaren', driverId: 'norris' };

      function setTeam(teamId, driverId) {
        current.teamId = teamId || current.teamId;
        current.driverId = driverId || current.driverId;
        if (car) {
          carHolder.remove(car);
          car.traverse(function (o) { if (o.isMesh && o.material && o.material.map && o.material.map.__own) o.material.map.dispose(); });
          car = null;
        }
        car = F1.buildCar({ teamId: current.teamId, driverId: current.driverId, detail: 2 });
        car.rotation.y = 0;
        car.traverse(function (o) { if (o.isMesh) { o.castShadow = true; } });
        carHolder.add(car);

        var team = F1.DATA.getTeam(current.teamId);
        ringMat.color.set(team.colors.primary);
        ringMat.emissive.set(team.colors.primary);
        var driver = F1.DATA.getDriver(current.driverId);
        label.material.map.dispose();
        label.material.map = makeTextPlane(team.short, driver.name + ' \u00b7 ' + driver.number, team.colors.primary);
        label.material.needsUpdate = true;
        F1.bus.emit('showroom-team', current.teamId, current.driverId);
      }

      /* ---------------- framing + interaction ---------------- */
      var view = {
        yaw: -0.72, pitch: 0.24, dist: 8.6,
        targetYaw: -0.72, targetPitch: 0.24, targetDist: 8.6,
        target: new THREE.Vector3(0, 0.55, 0),
        menuOffset: new THREE.Vector3(-1.55, 0.15, 0),
        mode: 'menu'
      };
      var spin = 0, idle = 0, dragging = false, lastX = 0, lastY = 0, autoSpin = true;

      function setMode(mode) {
        view.mode = mode;
        if (mode === 'menu') {
          view.targetYaw = -0.72; view.targetPitch = 0.22; view.targetDist = 9.2;
          view.target.set(-1.35, 0.5, 0);
          autoSpin = true;
        } else {
          view.targetYaw = -0.85; view.targetPitch = 0.26; view.targetDist = 8.4;
          view.target.set(0, 0.5, 0);
          autoSpin = false;
          idle = 4;
        }
      }

      function setOrbit(yaw, pitch, dist) {
        view.targetYaw = yaw; view.targetPitch = pitch;
        if (dist) view.targetDist = dist;
      }

      var canvas = document.getElementById('gl');
      function onDown(e) {
        if (view.mode !== 'garage') return;
        dragging = true; idle = 0;
        lastX = (e.touches ? e.touches[0].clientX : e.clientX);
        lastY = (e.touches ? e.touches[0].clientY : e.clientY);
      }
      function onMove(e) {
        if (!dragging) return;
        var x = (e.touches ? e.touches[0].clientX : e.clientX);
        var y = (e.touches ? e.touches[0].clientY : e.clientY);
        view.targetYaw -= (x - lastX) * 0.006;
        view.targetPitch = F1.util.clamp(view.targetPitch + (y - lastY) * 0.004, 0.02, 0.9);
        lastX = x; lastY = y;
        idle = 0;
      }
      function onUp() { dragging = false; idle = 0; }
      function onWheel(e) {
        if (view.mode !== 'garage') return;
        e.preventDefault();
        view.targetDist = F1.util.clamp(view.targetDist + e.deltaY * 0.006, 4.5, 16);
      }
      if (canvas) {
        canvas.addEventListener('mousedown', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        canvas.addEventListener('touchstart', onDown, { passive: true });
        window.addEventListener('touchmove', onMove, { passive: true });
        window.addEventListener('touchend', onUp);
        canvas.addEventListener('wheel', onWheel, { passive: false });
      }

      /* ---------------- frame update ---------------- */
      function update(dt) {
        view.yaw = F1.util.damp(view.yaw, view.targetYaw, 9, dt);
        view.pitch = F1.util.damp(view.pitch, view.targetPitch, 9, dt);
        view.dist = F1.util.damp(view.dist, view.targetDist, 7, dt);

        if (view.mode === 'menu' && autoSpin) spin += dt * 0.16;
        else if (!dragging) {
          idle += dt;
          if (idle > 3.5) spin += dt * 0.12;   // gentle turntable idle in garage
        }
        carHolder.rotation.y = spin;
        carHolder.position.y = 0.13 + Math.sin(performance.now() * 0.0005) * 0.004;

        // keep the car framed on narrow/wide windows as well as 16:9
        var aspect = camera.aspect || 1.78;
        var frame = F1.util.clamp(1.82 / aspect, 1, 1.7);
        var dist = view.dist * frame;
        var cx = Math.sin(view.yaw) * Math.cos(view.pitch) * dist;
        var cz = Math.cos(view.yaw) * Math.cos(view.pitch) * dist;
        var cy = Math.sin(view.pitch) * dist + 0.5;
        camera.position.set(view.target.x + cx, cy, view.target.z + cz);
        camera.lookAt(view.target.x, view.target.y, view.target.z);
      }

      var api = {
        scene: scene,
        camera: camera,
        update: update,
        mode: 'showroom'
      };

      setTeam('mclaren', 'norris');
      setMode('menu');

      return {
        scene: scene,
        camera: camera,
        api: api,
        setTeam: setTeam,
        setMode: setMode,
        setOrbit: setOrbit,
        getTeam: function () { return current.teamId; },
        getDriver: function () { return current.driverId; },
        update: update,
        car: function () { return car; }
      };
    }
  };
})(window.F1 = window.F1 || {});
