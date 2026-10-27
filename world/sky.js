/* ==========================================================================
   F1 2026 — world/sky.js
   Procedural atmosphere: Preetham sky (three/addons Sky, bundled locally),
   a two-layer cloud dome driven by value noise, a star field and moon for
   night rounds, and a PMREM environment map generated from the sky itself so
   every PBR material is lit by the real sky rather than a flat canvas.

     var atmo = F1.sky.create(meta, { quality: q });
     atmo.sky        // THREE.Mesh added to the world group
     atmo.envMap     // PMREM texture (scene.environment)
     atmo.sunDir     // THREE.Vector3, normalised
     atmo.update(dt) // wind on the clouds
     atmo.setWeather('overcast'|'rain'|'dry')
     atmo.dispose()
   ========================================================================== */
(function (F1) {
  'use strict';

  var ADD = window.THREE_ADDONS || {};

  /* ---------------------------------------------------------------- */
  /* presets — per time of day. Values feed both the sky and the sun.   */
  /* ---------------------------------------------------------------- */
  var ATMOS = {
    day: {
      zenith: 0x1c4fa8, horizon: 0xbcd6ef, ground: 0x9aa79a,
      sunColor: 0xfff6e6, sunPower: 26, sunGlow: 0.55, sunIntensity: 3.5,
      haze: 0.55, cloudCover: 0.34, cloudTint: 0xfbfcff, cloudBright: 1.0,
      hemiSky: 0xb9cfe4, hemiGround: 0x4d5338, hemiIntensity: 0.42,
      fogTint: 0xc9d9ea, fogNearK: 0.30, fogFarK: 1.3, exposure: 2.0,
      starAlpha: 0, sunElev: 54, sunAzim: 148, turbidity: 3.0, rayleigh: 2.35,
      grade: { contrast: 1.075, saturation: 1.06, lift: 0.008, gain: 1.0, tintU: 0.006 }
    },
    golden: {
      zenith: 0x2b5aa8, horizon: 0xffc98a, ground: 0x8a7a63,
      sunColor: 0xffcf9a, sunPower: 34, sunGlow: 1.5, sunIntensity: 3.1,
      haze: 0.72, cloudCover: 0.4, cloudTint: 0xffd3ae, cloudBright: 0.92,
      hemiSky: 0xd0b295, hemiGround: 0x463d2e, hemiIntensity: 0.4,
      fogTint: 0xe6c9a6, fogNearK: 0.26, fogFarK: 1.15, exposure: 2.2,
      starAlpha: 0.06, sunElev: 8.5, sunAzim: 258, turbidity: 6.2, rayleigh: 2.9,
      grade: { contrast: 1.09, saturation: 1.12, lift: 0.016, gain: 1.01, tintU: 0.02 }
    },
    twilight: {
      zenith: 0x172b55, horizon: 0xe08a5e, ground: 0x4a4038,
      sunColor: 0xff9a6a, sunPower: 6, sunGlow: 2.2, sunIntensity: 0.55,
      haze: 0.85, cloudCover: 0.44, cloudTint: 0xff9e86, cloudBright: 0.6,
      hemiSky: 0x5f6f9c, hemiGround: 0x2a2b26, hemiIntensity: 0.55,
      fogTint: 0x6a6f8c, fogNearK: 0.22, fogFarK: 1.0, exposure: 2.8,
      starAlpha: 0.4, sunElev: -2.5, sunAzim: 292, turbidity: 9, rayleigh: 3.6,
      grade: { contrast: 1.1, saturation: 1.08, lift: 0.024, gain: 0.98, tintU: 0.03 }
    },
    night: {
      zenith: 0x050912, horizon: 0x121d33, ground: 0x0a0d12,
      sunColor: 0x9fb6e0, sunPower: 0, sunGlow: 0.12, sunIntensity: 0.3,
      haze: 0.5, cloudCover: 0.3, cloudTint: 0x6b7ba0, cloudBright: 0.35,
      hemiSky: 0x25324e, hemiGround: 0x16171a, hemiIntensity: 0.5,
      fogTint: 0x121a28, fogNearK: 0.18, fogFarK: 0.95, exposure: 3.4,
      starAlpha: 1, sunElev: -14, sunAzim: 30, turbidity: 4, rayleigh: 0.35,
      grade: { contrast: 1.12, saturation: 1.04, lift: 0.03, gain: 1.03, tintU: 0.028 }
    }
  };

  /* the time-of-day a circuit declares, plus small per-circuit variation so
     two "day" rounds do not share an identical sky */
  function presetFor(meta, rnd) {
    var base = ATMOS[meta.timeOfDay] || ATMOS.day;
    var p = {};
    for (var k in base) p[k] = base[k];
    p.grade = {};
    for (var g in base.grade) p.grade[g] = base.grade[g];
    /* small, seeded variation only: a circuit's sky has to look the same every
       time it is loaded (and in every before/after screenshot) */
    p.sunElev = base.sunElev + (rnd() - 0.5) * 3;
    p.sunAzim = base.sunAzim + (rnd() - 0.5) * 18;
    p.cloudCover = Math.min(0.7, Math.max(0.12, base.cloudCover + (rnd() - 0.5) * 0.06));
    p.haze = Math.min(0.9, Math.max(0.25, base.haze + (rnd() - 0.5) * 0.05));
    p.zenith = new THREE.Color(base.zenith).offsetHSL(0, 0, (rnd() - 0.5) * 0.03);
    p.horizon = new THREE.Color(base.horizon).offsetHSL(0, 0, (rnd() - 0.5) * 0.02);
    p.fogTint = new THREE.Color(base.fogTint);
    p.sunColorC = new THREE.Color(base.sunColor);
    p.hemiSkyC = new THREE.Color(base.hemiSky);
    p.hemiGroundC = new THREE.Color(base.hemiGround);
    return p;
    return p;
  }

  /* ---------------------------------------------------------------- */
  /* sky dome shader                                                    */
  /* ---------------------------------------------------------------- */
  /* Authored in linear HDR and tone-mapped exactly once, by OutputPass.
     The addon Sky (Preetham) is kept in the bundle for reference but the
     look is driven from here: a real Rayleigh-ish gradient controlled per
     circuit, a HDR sun disc with limb darkening + forward-scatter glow, and
     horizon haze that matches the fog so the ground melts into the sky. */
  var SKY_VS = [
    'varying vec3 vDir;',
    'void main() {',
    '  vDir = normalize(position);',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  var SKY_FS = [
    'varying vec3 vDir;',
    'uniform vec3 uZenith;',
    'uniform vec3 uHorizon;',
    'uniform vec3 uGround;',
    'uniform vec3 uSunDir;',
    'uniform vec3 uSunColor;',
    'uniform float uSunPower;',
    'uniform float uSunGlow;',
    'uniform float uHaze;',
    'uniform float uNight;',
    'uniform float uTime;',
    'uniform vec3 uFog;',

    'void main() {',
    '  vec3 d = normalize(vDir);',
    '  float h = d.y;',

    /* base gradient: exponent controls how quickly the horizon whitens */
    '  float t = pow(clamp(1.0 - max(h, 0.0), 0.0, 1.0), 2.4 - uHaze * 1.1);',
    '  vec3 col = mix(uZenith, uHorizon, t);',

    /* below the horizon fade into the ground haze */
    '  float below = smoothstep(0.0, -0.18, h);',
    '  col = mix(col, uGround, below * 0.85);',

    /* horizon haze band — matches the fog colour so the terrain dissolves */
    '  float band = exp(-abs(h) * (11.0 - uHaze * 5.0));',
    '  col = mix(col, uFog, band * uHaze * 0.85);',

    /* sun: angular disc + limb darkening */
    '  float mu = max(dot(d, uSunDir), 0.0);',
    '  float disc = smoothstep(0.99965, 0.99992, mu);',
    '  float limb = 1.0 - pow(1.0 - disc, 3.0) * 0.25;',
    '  vec3 sun = uSunColor * uSunPower * disc * limb;',

    /* forward scatter halo (Mie) + a wider atmospheric glow */
    '  float halo = pow(mu, 900.0) * 0.55 + pow(mu, 40.0) * 0.16 + pow(mu, 6.0) * 0.06;',
    '  col += uSunColor * halo * uSunGlow * (1.0 - uNight * 0.7);',
    '  col += sun;',

    /* night lift so the dome is never pure black, and a faint airglow */
    '  col += vec3(0.02, 0.028, 0.055) * uNight;',

    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  /* ---------------------------------------------------------------- */
  /* cloud dome shader                                                  */
  /* ---------------------------------------------------------------- */
  var CLOUD_VS = [
    'varying vec3 vDir;',
    'void main() {',
    '  vDir = normalize(position);',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  var CLOUD_FS = [
    'varying vec3 vDir;',
    'uniform vec3 uSunDir;',
    'uniform vec3 uSunColor;',
    'uniform vec3 uSkyTop;',
    'uniform vec3 uSkyBottom;',
    'uniform vec3 uTint;',
    'uniform float uCover;',
    'uniform float uTime;',
    'uniform float uNight;',
    'uniform float uStorm;',

    'float hash21(vec2 p) {',
    '  p = fract(p * vec2(123.34, 456.21));',
    '  p += dot(p, p + 45.32);',
    '  return fract(p.x * p.y);',
    '}',
    'float vnoise(vec2 p) {',
    '  vec2 i = floor(p), f = fract(p);',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));',
    '  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));',
    '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
    '}',
    'float fbm(vec2 p) {',
    '  float v = 0.0, amp = 0.5;',
    '  for (int i = 0; i < 5; i++) { v += amp * vnoise(p); p *= 2.03; amp *= 0.5; }',
    '  return v;',
    '}',

    'void main() {',
    '  vec3 d = normalize(vDir);',
    '  float h = d.y;',
    /* project the dome onto a plane: clouds converge at the horizon */
    '  float horizon = clamp(h, 0.0, 1.0);',
    '  vec2 uv = d.xz / max(0.075, h + 0.10);',
    '  uv *= 0.55;',

    /* two layers: high cirrus streaks, low cumulus puffs */
    '  vec2 windA = vec2(uTime * 0.0035, uTime * 0.0012);',
    '  vec2 windB = vec2(uTime * 0.0075, uTime * 0.0026);',
    '  float cirrus = fbm(uv * 1.9 + windA + 13.0);',
    '  float cumulus = fbm(uv * 0.85 + windB);',
    '  float cover = uCover;',
    '  float c1 = smoothstep(0.70 - cover * 0.34, 1.04 - cover * 0.22, cumulus);',
    '  float c2 = smoothstep(0.55, 0.92, cirrus) * 0.55;',
    '  float density = clamp(c1 * (1.0 - c2 * 0.45) + c2 * 0.6, 0.0, 1.0);',
    '  density *= smoothstep(0.0, 0.16, h);',        /* no clouds below the horizon */
    '  density *= 1.0 - smoothstep(0.72, 1.0, h) * 0.35;',

    /* lighting: silver lining towards the sun, grey undersides away from it */
    '  float sunAmt = pow(max(dot(d, uSunDir), 0.0), 6.0);',
    '  float sunEdge = pow(max(dot(d, uSunDir), 0.0), 2.0);',
    '  vec3 lit = uTint * (1.05 + 0.55 * sunEdge);',
    '  vec3 shade = mix(uSkyBottom * 0.55, uTint * vec3(0.62, 0.66, 0.74), 0.5) * (1.0 - uStorm * 0.35);',
    '  vec3 cloudCol = mix(shade, lit, smoothstep(0.15, 0.85, density)) * 0.94;',
    '  cloudCol += uSunColor * sunAmt * (0.55 - density * 0.25) * (1.0 - uNight * 0.8);',

    '  float alpha = density * 0.62;',
    '  alpha *= mix(1.0, 1.25, uStorm);',
    '  alpha *= smoothstep(0.02, 0.3, h);',
    '  alpha = clamp(alpha, 0.0, 0.94);',
    '  gl_FragColor = vec4(cloudCol, alpha);',
    '#ifndef RAW_HDR',
    '  #include <tonemapping_fragment>',
    '  #include <colorspace_fragment>',
    '#endif',
    '}'
  ].join('\n');

  var STAR_VS = [
    'varying vec3 vDir;',
    'void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
  ].join('\n');

  var STAR_FS = [
    'varying vec3 vDir;',
    'uniform float uAlpha;',
    'uniform float uTime;',
    'float hash31(vec3 p) {',
    '  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));',
    '  p *= 17.0;',
    '  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));',
    '}',
    'void main() {',
    '  vec3 d = normalize(vDir);',
    '  if (d.y < -0.02) { gl_FragColor = vec4(0.0); return; }',
    /* cells on the sphere; one star per cell kept if it wins a random test */
    '  vec3 cell = floor(d * 260.0);',
    '  float r = hash31(cell);',
    '  float star = smoothstep(0.9965, 1.0, r);',
    '  float twinkle = 0.72 + 0.28 * sin(uTime * 2.2 + r * 63.0);',
    '  float fade = smoothstep(-0.02, 0.22, d.y);',
    '  vec3 c = mix(vec3(0.78, 0.85, 1.0), vec3(1.0, 0.94, 0.82), hash31(cell + 7.0));',
    '  gl_FragColor = vec4(c * star * twinkle * uAlpha * fade * 1.6, 1.0);',
    '#ifndef RAW_HDR',
    '  #include <tonemapping_fragment>',
    '  #include <colorspace_fragment>',
    '#endif',
    '}'
  ].join('\n');

  /* ---------------------------------------------------------------- */
  F1.sky = { presets: ATMOS, presetFor: presetFor };

  /* Turn the dome's built-in tone mapping off (composer present) or back on
     (plain render to the canvas). Changing a define needs a recompile, but
     this only happens when the post chain is created or dropped. */
  F1.sky.setHDRMode = function (raw) {
    var mats = F1.sky._hdrMats || [];
    for (var i = 0; i < mats.length; i++) {
      var m = mats[i];
      var want = raw ? 1 : 0;
      var has = m.defines && m.defines.RAW_HDR ? 1 : 0;
      if (want === has) continue;
      m.defines = m.defines || {};
      if (want) m.defines.RAW_HDR = 1; else delete m.defines.RAW_HDR;
      m.needsUpdate = true;
    }
    F1.sky._rawHDR = !!raw;
  };


  F1.sky.create = function (meta, opts) {
    opts = opts || {};
    var rnd = F1.rng(F1.rng.string(meta.id + '|sky'));
    var p = presetFor(meta, rnd);
    var group = new THREE.Group();
    group.name = 'atmosphere';

    var sunDir = new THREE.Vector3().setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(90 - p.sunElev),
      THREE.MathUtils.degToRad(p.sunAzim));

    /* ---- analytical sky dome ------------------------------------------- */
    var skyUniforms = {
      uZenith: { value: p.zenith.clone().convertSRGBToLinear() },
      uHorizon: { value: p.horizon.clone().convertSRGBToLinear() },
      uGround: { value: new THREE.Color(p.ground).convertSRGBToLinear() },
      uSunDir: { value: sunDir.clone() },
      uSunColor: { value: (p.sunColorC || new THREE.Color(p.sunColor)).clone().convertSRGBToLinear() },
      uSunPower: { value: p.sunPower },
      uSunGlow: { value: p.sunGlow },
      uHaze: { value: p.haze },
      uNight: { value: meta.timeOfDay === 'night' ? 1 : meta.timeOfDay === 'twilight' ? 0.5 : 0 },
      uTime: { value: 0 },
      uFog: { value: (p.fogTint || new THREE.Color(p.fogTint)).clone().convertSRGBToLinear() }
    };
    var sky = new THREE.Mesh(
      new THREE.SphereGeometry(3000, 40, 24),
      new THREE.ShaderMaterial({
        uniforms: skyUniforms,
        vertexShader: SKY_VS,
        fragmentShader: SKY_FS,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false
      }));
    sky.frustumCulled = false;
    sky.renderOrder = -1000;
    sky.name = 'sky';
    var domeGroup = new THREE.Group();
    domeGroup.name = 'dome';
    domeGroup.frustumCulled = false;
    domeGroup.add(sky);

    /* ---- cloud dome ---------------------------------------------------- */
    var cloudUniforms = {
      uSunDir: { value: sunDir.clone() },
      uSunColor: { value: (p.sunColorC || new THREE.Color(0xfff6e6)).clone().convertSRGBToLinear() },
      uSkyTop: { value: new THREE.Color(0x3f6ea8) },
      uSkyBottom: { value: (p.fogTint || new THREE.Color(0xc3d3e0)).clone() },
      uTint: { value: new THREE.Color(p.cloudTint).convertSRGBToLinear() },
      uCover: { value: p.cloudCover },
      uTime: { value: 0 },
      uNight: { value: meta.timeOfDay === 'night' ? 1 : meta.timeOfDay === 'twilight' ? 0.55 : 0 },
      uStorm: { value: 0 },
      uBright: { value: p.cloudBright }
    };
    F1.sky._rawHDR = !!(F1.settings && F1.settings.preset && F1.settings.preset().postFX);
    /* every dome material that skips its own tone mapping while the composer
       is in charge; renderer sets this again whenever the chain changes */
    F1.sky._hdrMats = [];
    var cloudMat = new THREE.ShaderMaterial({
        defines: F1.sky._rawHDR ? { RAW_HDR: 1 } : {},
        uniforms: cloudUniforms,
        vertexShader: CLOUD_VS,
        fragmentShader: CLOUD_FS,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.NormalBlending,
        fog: false
      });
    F1.sky._hdrMats.push(cloudMat);
    var clouds = new THREE.Mesh(
      new THREE.SphereGeometry(2400, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.55), cloudMat);
    clouds.frustumCulled = false;
    clouds.renderOrder = -999;
    clouds.name = 'clouds';
    domeGroup.add(clouds);

    /* ---- stars (only meaningful at night) ------------------------------ */
    var starUniforms = { uAlpha: { value: p.starAlpha }, uTime: { value: 0 } };
    var starMat = new THREE.ShaderMaterial({
        defines: F1.sky._rawHDR ? { RAW_HDR: 1 } : {},
        uniforms: starUniforms, vertexShader: STAR_VS, fragmentShader: STAR_FS,
        side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: true,
        blending: THREE.AdditiveBlending, fog: false
      });
    F1.sky._hdrMats.push(starMat);
    var stars = new THREE.Mesh(new THREE.SphereGeometry(2300, 32, 20), starMat);
    stars.frustumCulled = false;
    stars.renderOrder = -998;
    stars.visible = p.starAlpha > 0.02;
    domeGroup.add(stars);
    group.add(domeGroup);

    /* ---- lights -------------------------------------------------------- */
    var hemi = new THREE.HemisphereLight(p.hemiSkyC || p.hemiSky, p.hemiGroundC || p.hemiGround, p.hemiIntensity);
    hemi.position.set(0, 300, 0);
    group.add(hemi);

    var sun = new THREE.DirectionalLight(p.sunColorC || p.sunColor, p.sunIntensity);
    sun.castShadow = true;
    group.add(sun, sun.target);

    /* ---- PMREM environment from the sky itself ------------------------- */
    var envMap = null, pmrem = null;
    function buildEnv() {
      if (opts.noEnv || !THREE.PMREMGenerator) return;
      try {
        pmrem = pmrem || new THREE.PMREMGenerator(F1.renderer && F1.renderer.renderer
          ? F1.renderer.renderer : new THREE.WebGLRenderer());
        pmrem.compileEquirectangularShader();
        /* a private scene with only the dome: cheap and exactly the sky */
        var tmp = new THREE.Scene();
        var dome = sky.clone();
        dome.material = sky.material.clone();
        /* the dome is authored at 3000 m radius; scale it inside the cube
           camera's far plane or it is clipped and the env map comes out black */
        dome.scale.setScalar(500 / 3000);
        tmp.add(dome);
        var cloudCopy = clouds.clone();
        cloudCopy.material = clouds.material.clone();
        cloudCopy.material.uniforms = THREE.UniformsUtils.clone(cloudUniforms);
        cloudCopy.scale.setScalar(470 / 2400);
        tmp.add(cloudCopy);
        if (envMap) envMap.dispose();
        envMap = pmrem.fromScene(tmp, 0, 1, 2000).texture;
        dome.material.dispose();
        cloudCopy.material.dispose();
      } catch (e) {
        console.warn('[sky] PMREM failed, falling back to no env map', e);
        envMap = null;
      }
    }
    buildEnv();

    /* ---- weather ------------------------------------------------------- */
    var weather = 'dry';
    function setWeather(w) {
      weather = w || 'dry';
      var storm = weather === 'overcast' || weather === 'rain' ? 1 : 0;
      cloudUniforms.uStorm.value = storm;
      cloudUniforms.uCover.value = Math.min(0.92, p.cloudCover + storm * 0.4);
      hemi.intensity = p.hemiIntensity * (storm ? 0.72 : 1);
      sun.intensity = p.sunIntensity * (storm ? 0.28 : 1);
      stars.material.uniforms.uAlpha.value = p.starAlpha * (storm ? 0.15 : 1);
    }

    var t = 0;
    return {
      domeGroup: domeGroup,
      follow: function (p) { if (p) domeGroup.position.copy(p); },
      group: group,
      sky: sky,
      clouds: clouds,
      stars: stars,
      sun: sun,
      hemi: hemi,
      sunDir: sunDir,
      envMap: envMap,
      preset: p,
      exposure: p.exposure,
      fogColor: (p.fogTint || new THREE.Color(p.fogTint)).clone(),
      fogNearK: p.fogNear,
      fogFarK: p.fogFar,
      grade: p.grade,
      update: function (dt) {
        t += dt;
        cloudUniforms.uTime.value = t;
        starUniforms.uTime.value = t;
      },
      setWeather: setWeather,
      get weather() { return weather; },
      rebuildEnv: buildEnv,
      dispose: function () {
        if (envMap) envMap.dispose();
        if (pmrem) pmrem.dispose();
        group.remove(sky); group.remove(clouds); group.remove(stars);
        if (sky.geometry) sky.geometry.dispose();
        if (sky.material) sky.material.dispose();
        clouds.geometry.dispose(); clouds.material.dispose();
        stars.geometry.dispose(); stars.material.dispose();
      }
    };
  };
})(window.F1 = window.F1 || {});
