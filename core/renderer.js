/* ==========================================================================
   F1 2026 — core/renderer.js
   WebGL renderer, camera, resize handling, FPS meter, auto-quality.
   ========================================================================== */
(function (F1) {
  'use strict';

  var R = {
    renderer: null,
    camera: null,
    canvas: null,
    width: 1,
    height: 1,
    fps: 0,
    frame: 0,
    quality: null,
    autoQualityLevel: 0,     // how many times auto-quality stepped down
    _fpsAcc: 0, _fpsFrames: 0, _lowTime: 0,
    listeners: []
  };

  R.init = function (canvas) {
    R.canvas = canvas;
    R.quality = F1.settings.preset();

    var attrs = {
      canvas: canvas,
      antialias: R.quality.msaa > 0,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
      failIfMajorPerformanceCaveat: false
    };
    try {
      R.renderer = new THREE.WebGLRenderer(attrs);
    } catch (e) {
      // retry without antialias on very weak GPUs
      attrs.antialias = false;
      R.renderer = new THREE.WebGLRenderer(attrs);
    }
    var gl = R.renderer.getContext();
    R.renderer.setClearColor(0x05070b, 1);
    if (THREE.SRGBColorSpace !== undefined) R.renderer.outputColorSpace = THREE.SRGBColorSpace;
    R.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    R.renderer.toneMappingExposure = 1.0;
    R.renderer.shadowMap.enabled = !!R.quality.shadows;
    R.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    R.renderer.shadowMap.autoUpdate = true;
    R.renderer.info.autoReset = false;

    R.camera = new THREE.PerspectiveCamera(F1.settings.graphics.fov, 1, 0.08, Math.max(2600, R.quality.drawDistance * 2));
    R.camera.position.set(0, 2, 6);

    R.applySizing();
    window.addEventListener('resize', R.applySizing);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) R._lowTime = 0;
    });

    /* screen-space chain: needs the addon bundle, and postFX in the preset */
    R.buildPost();
    console.log('[renderer] WebGL2=' + R.renderer.capabilities.isWebGL2 +
      ' maxTex=' + R.renderer.capabilities.maxTextureSize +
      ' preset=' + (R.quality.label || 'custom') +
      ' dpr=' + R.pixelRatio.toFixed(2));
    return R.renderer;
  };

  /* ------------------------------------------------------------------ */
  /* post chain                                                          */
  /* ------------------------------------------------------------------ */
  R.buildPost = function () {
    if (!F1.post || !F1.post.available()) { R.post = null; return null; }
    if (!R.quality.postFX) {
      if (F1.post.composer) F1.post.dispose();
      R.post = null;
      return null;
    }
    var scene = R._lastScene || (F1.app && F1.app.sceneApi && F1.app.sceneApi.scene);
    var cam = R._postCam || (F1.app && F1.app.sceneApi && F1.app.sceneApi.camera) || R.camera;
    if (!scene) return null;
    var ok = F1.post.create(R.renderer, scene, cam, R.quality);
    R.post = ok ? F1.post : null;
    if (ok) {
      var dpr = R.pixelRatio || 1;
      F1.post.resize(R.width, R.height, dpr);
    }
    return R.post;
  };

  /* the composer holds a scene reference from build time; every scene swap
     (menu -> race -> menu) has to repoint it or the last frame is replayed */
  R.syncPost = function (scene, camera) {
    var P = F1.post;
    if (!P || !P.enabled) return;
    if (P.renderPass && P.renderPass.scene !== scene) {
      P.renderPass.scene = scene;
      P.renderPass.camera = camera;
      if (P.ssao) { P.ssao.scene = scene; P.ssao.camera = camera; }
      if (P.renderPass.clear) P.renderPass.clear = true;
    }
  };

  R.applySizing = function () {
    if (!R.renderer) return;
    var w = Math.max(320, window.innerWidth), h = Math.max(240, window.innerHeight);
    var dpr = Math.min(window.devicePixelRatio || 1, R.quality.pixelRatio || 1.5);
    R.pixelRatio = dpr;
    R.width = w; R.height = h;
    R.renderer.setPixelRatio(dpr);
    R.renderer.setSize(w, h, false);
    R.camera.aspect = w / h;
    R.camera.updateProjectionMatrix();
    if (F1.post && F1.post.composer) F1.post.resize(w, h, dpr);
    R.listeners.forEach(function (fn) { try { fn(w, h); } catch (e) { console.error(e); } });
  };

  R.onResize = function (fn) { R.listeners.push(fn); };

  R.setQuality = function (name) {
    F1.settings.graphics.quality = name;
    F1.settings.save();
    R.quality = F1.settings.preset();
    R.autoQualityLevel = 0;
    if (R.renderer) {
      R.renderer.shadowMap.enabled = !!R.quality.shadows;
      R.camera.far = Math.max(2600, R.quality.drawDistance * 2);
      R.camera.updateProjectionMatrix();
    }
    R.applySizing();
    R.buildPost();
    F1.bus.emit('quality', name);
  };

  /* Called once per rendered frame; cheap rolling average + auto fallback */
  R.tick = function (dt) {
    R.frame++;
    R.lastDt = dt;
    R._fpsAcc += dt; R._fpsFrames++;
    if (R._fpsAcc >= 0.5) {
      R.fps = R._fpsFrames / R._fpsAcc;
      R._fpsAcc = 0; R._fpsFrames = 0;
      if (F1.settings.graphics.autoQuality) {
        if (R.fps < 40) R._lowTime += 0.5; else R._lowTime = Math.max(0, R._lowTime - 0.25);
        if (R._lowTime >= 5) {
          R._lowTime = 0;
          var order = ['low', 'medium', 'high', 'ultra'];
          var i = order.indexOf(F1.settings.graphics.quality);
          if (i > 0) {
            var next = order[i - 1];
            console.warn('[auto-quality] fps below 40 for 5s, dropping to', next);
            R.setQuality(next);
            F1.bus.emit('toast', 'Auto quality: ' + next.toUpperCase() + ' (performance)');
          }
        }
      }
    }
  };

  R.render = function (scene, camera) {
    if (!R.renderer) return;
    camera = camera || R.camera;
    R._lastScene = scene;
    /* a scene/camera swap invalidates the composer's cached references */
    if (R._postScene !== scene || R._postCam !== camera) {
      R._postScene = scene; R._postCam = camera;
      R.syncPost(scene, camera);
    }
    /* the composer can only be built once a scene exists — the first frames
       after boot render the menu showroom, long before the first circuit */
    if (!R.post && R.quality.postFX && F1.post && F1.post.available()) {
      R.buildPost();
      R.syncPost(scene, camera);
    }
    R.renderer.info.reset();
    if (R.post && F1.post.enabled) {
      if (F1.post.render(R.lastDt || 0.016)) return;
    }
    R.renderer.render(scene, camera);
  };

  R.info = function () {
    var i = R.renderer ? R.renderer.info : null;
    return {
      fps: Math.round(R.fps),
      calls: i ? i.render.calls : 0,
      triangles: i ? i.render.triangles : 0,
      geometries: i ? i.memory.geometries : 0,
      textures: i ? i.memory.textures : 0,
      programs: i ? i.programs ? i.programs.length : 0 : 0
    };
  };

  F1.renderer = R;
})(window.F1 = window.F1 || {});
