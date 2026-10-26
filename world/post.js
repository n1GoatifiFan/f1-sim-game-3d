/* ==========================================================================
   F1 2026 — world/post.js
   Screen-space chain. Built on the official three.js addons, bundled offline
   into lib/three-post.js (EffectComposer, RenderPass, UnrealBloomPass,
   SSAOPass, SMAAPass, OutputPass, ShaderPass).

   Order (each stage quality-gated):
     render → SSAO → bloom → output (ACES + sRGB) → grade → SMAA

   The grade pass is custom: exposure, filmic contrast, saturation, split
   tone, vignette, chromatic aberration, grain, and a subtle "broadcast"
   sharpen. It runs after OutputPass, i.e. in display-referred sRGB, which is
   where vignette/grain belong.
   ========================================================================== */
(function (F1) {
  'use strict';

  var ADD = window.THREE_ADDONS || {};

  var GRADE_FS = [
    'uniform sampler2D tDiffuse;',
    'uniform float uExposure;',
    'uniform float uContrast;',
    'uniform float uSaturation;',
    'uniform float uLift;',
    'uniform float uGain;',
    'uniform float uVignette;',
    'uniform float uGrain;',
    'uniform float uCA;',
    'uniform float uTintU;',
    'uniform float uWarm;',
    'uniform float uTime;',
    'uniform vec2 uRes;',
    'uniform float uFlash;',
    'varying vec2 vUv;',

    'float rand(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }',

    'void main() {',
    '  vec2 uv = vUv;',
    '  vec2 c = uv - 0.5;',
    '  float r2 = dot(c, c);',
    /* chromatic aberration scales with distance from centre */
    '  vec2 off = c * (uCA * r2);',
    '  vec3 col;',
    '  col.r = texture2D(tDiffuse, uv + off).r;',
    '  col.g = texture2D(tDiffuse, uv).g;',
    '  col.b = texture2D(tDiffuse, uv - off).b;',

    '  col *= uExposure;',

    /* split tone: cool the shadows, warm the highlights */
    '  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));',
    '  col += vec3(-uTintU, 0.0, uTintU) * (1.0 - smoothstep(0.0, 0.45, lum));',
    '  col += vec3(uWarm, uWarm * 0.35, -uWarm * 0.6) * smoothstep(0.45, 1.0, lum);',

    /* filmic S-curve around mid grey, then lift/gain */
    '  col = (col - 0.5) * uContrast + 0.5;',
    '  col = col * uGain + uLift * (1.0 - col);',

    /* saturation */
    '  float l2 = dot(col, vec3(0.2126, 0.7152, 0.0722));',
    '  col = mix(vec3(l2), col, uSaturation);',

    /* vignette (natural, squared falloff) */
    '  float vig = 1.0 - uVignette * smoothstep(0.16, 0.95, r2 * 2.1);',
    '  col *= vig;',

    /* fine grain, slightly stronger in the shadows */
    '  float g = rand(uv * uRes + fract(uTime) * 137.0) - 0.5;',
    '  col += g * uGrain * (1.25 - l2 * 0.85);',

    /* camera flash / race-start whiteout hook */
    '  col = mix(col, vec3(1.0), uFlash);',

    '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);',
    '}'
  ].join('\n');

  var GradeShader = {
    uniforms: {
      tDiffuse: { value: null },
      uExposure: { value: 1.0 }, uContrast: { value: 1.04 },
      uSaturation: { value: 1.05 }, uLift: { value: 0.01 }, uGain: { value: 1.0 },
      uVignette: { value: 0.32 }, uGrain: { value: 0.016 }, uCA: { value: 0.0035 },
      uTintU: { value: 0.008 }, uWarm: { value: 0.012 }, uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) }, uFlash: { value: 0 }
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: GRADE_FS
  };

  var P = {
    composer: null,
    grade: null,
    bloom: null,
    ssao: null,
    smaa: null,
    renderPass: null,
    ready: false,
    enabled: false,
    quality: null,
    scene: null,
    camera: null,
    _w: 0, _h: 0, _t: 0
  };

  P.available = function () {
    return !!(ADD.EffectComposer && ADD.RenderPass && ADD.OutputPass && ADD.ShaderPass);
  };

  /* q = settings preset object */
  P.create = function (renderer, scene, camera, q) {
    if (!P.available()) { console.warn('[post] addon bundle missing, direct render'); return false; }
    P.dispose();
    P.quality = q;
    P.scene = scene;
    P.camera = camera;

    var size = renderer.getDrawingBufferSize(new THREE.Vector2());
    P._w = size.x; P._h = size.y;

    /* HDR intermediate: bloom needs values above 1 to do anything */
    var rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace,
      samples: q.msaa > 0 ? Math.min(4, q.msaa) : 0,
      depthBuffer: true,
      stencilBuffer: false
    });

    var composer = new ADD.EffectComposer(renderer, rt);
    composer.setSize(size.x, size.y);
    composer.setPixelRatio(1);

    P.renderPass = new ADD.RenderPass(scene, camera);
    composer.addPass(P.renderPass);

    /* SSAO: half-res, blended at 0.55. It is the most expensive stage, so it
       only exists on high/ultra. */
    if (ADD.SSAOPass && q.qualityRank >= 2) {
      var ssao = new ADD.SSAOPass(scene, camera, size.x * 0.5, size.y * 0.5);
      ssao.kernelRadius = 2.6;
      ssao.minDistance = 0.0015;
      ssao.maxDistance = 0.11;
      ssao.output = ADD.SSAOPass.OUTPUT.Default;
      composer.addPass(ssao);
      P.ssao = ssao;
    }

    if (ADD.UnrealBloomPass && q.postFX) {
      var bloom = new ADD.UnrealBloomPass(
        new THREE.Vector2(size.x, size.y),
        q.bloomStrength !== undefined ? q.bloomStrength : 0.32,
        q.bloomRadius || 0.55,
        q.bloomThreshold !== undefined ? q.bloomThreshold : 0.92);
      composer.addPass(bloom);
      P.bloom = bloom;
    }

    if (ADD.OutputPass) {
      composer.addPass(new ADD.OutputPass());
    }

    P.grade = new ADD.ShaderPass(GradeShader);
    composer.addPass(P.grade);

    if (ADD.SMAAPass && q.msaa === 0) {
      var smaa = new ADD.SMAAPass(size.x, size.y);
      if (smaa.setSize) smaa.setSize(size.x, size.y);
      composer.addPass(smaa);
      P.smaa = smaa;
    }

    P.composer = composer;
    P.enabled = true;
    P.ready = true;
    return true;
  };

  /* filmic look, applied per circuit/time of day */
  P.setGrade = function (o) {
    if (!P.grade) return;
    var u = P.grade.uniforms;
    o = o || {};
    if (o.exposure !== undefined) u.uExposure.value = o.exposure;
    if (o.contrast !== undefined) u.uContrast.value = o.contrast;
    if (o.saturation !== undefined) u.uSaturation.value = o.saturation;
    if (o.lift !== undefined) u.uLift.value = o.lift;
    if (o.gain !== undefined) u.uGain.value = o.gain;
    if (o.vignette !== undefined) u.uVignette.value = o.vignette;
    if (o.grain !== undefined) u.uGrain.value = o.grain;
    if (o.ca !== undefined) u.uCA.value = o.ca;
    if (o.tintU !== undefined) u.uTintU.value = o.tintU;
    if (o.warm !== undefined) u.uWarm.value = o.warm;
  };

  P.setBloom = function (strength, radius, threshold) {
    if (!P.bloom) return;
    if (strength !== undefined) P.bloom.strength = strength;
    if (radius !== undefined) P.bloom.radius = radius;
    if (threshold !== undefined) P.bloom.threshold = threshold;
  };

  /* motion blur / radial speed streak strength, driven by the camera FOV
     stretch while the player is at speed */
  P.setSpeedBlur = function (amount) {
    if (!P.grade) return;
    /* reuse the CA channel: it reads as radial streak at high speed */
    P.grade.uniforms.uCA.value = 0.0035 + amount * 0.012;
  };

  P.setFlash = function (v) {
    if (P.grade) P.grade.uniforms.uFlash.value = Math.max(0, Math.min(1, v));
  };

  P.resize = function (w, h, pixelRatio) {
    if (!P.composer) return;
    var rw = Math.max(2, Math.floor(w * pixelRatio));
    var rh = Math.max(2, Math.floor(h * pixelRatio));
    if (rw === P._w && rh === P._h) return;
    P._w = rw; P._h = rh;
    P.composer.setSize(rw, rh);
    if (P.ssao) P.ssao.setSize(rw * 0.5, rh * 0.5);
    if (P.smaa && P.smaa.setSize) P.smaa.setSize(rw, rh);
    if (P.grade) P.grade.uniforms.uRes.value.set(rw, rh);
  };

  P.render = function (dt) {
    if (!P.enabled || !P.composer) return false;
    P._t += dt || 0.016;
    if (P.grade) P.grade.uniforms.uTime.value = P._t;
    P.composer.render(dt || 0.016);
    return true;
  };

  P.dispose = function () {
    if (P.composer) {
      P.composer.passes.forEach(function (p) {
        if (p.dispose) { try { p.dispose(); } catch (e) {} }
      });
      if (P.composer.renderTarget1) P.composer.renderTarget1.dispose();
      if (P.composer.renderTarget2) P.composer.renderTarget2.dispose();
    }
    P.composer = null; P.grade = null; P.bloom = null; P.ssao = null;
    P.smaa = null; P.renderPass = null; P.ready = false; P.enabled = false;
  };

  F1.post = P;
})(window.F1 = window.F1 || {});
