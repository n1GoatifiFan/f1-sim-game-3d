/* ==========================================================================
   F1 2026 — core/settings.js
   Persistent user settings + graphics quality presets.
   ========================================================================== */
(function (F1) {
  'use strict';
  var STORE_KEY = 'settings_v1';

  var QUALITY = {
    low: {
      label: 'Low', qualityRank: 0, pixelRatio: 1.0, shadows: false, shadowSize: 1024,
      shadowHalf: 90, drawDistance: 900, crowdDensity: 0.25, particleMul: 0.4, anisotropy: 4,
      msaa: 0, asphaltDetail: 0, carDetail: 0, postFX: false, skidMarks: 220, maxLights: 2,
      bloomStrength: 0.22, bloomRadius: 0.4, bloomThreshold: 1.0, ssao: false,
      grassDensity: 0.0, cloudDetail: 0, wetReflections: false
    },
    medium: {
      label: 'Medium', qualityRank: 1, pixelRatio: 1.25, shadows: true, shadowSize: 2048,
      shadowHalf: 110, drawDistance: 1200, crowdDensity: 0.5, particleMul: 0.7, anisotropy: 8,
      msaa: 0, asphaltDetail: 1, carDetail: 1, postFX: true, skidMarks: 450, maxLights: 4,
      bloomStrength: 0.26, bloomRadius: 0.48, bloomThreshold: 0.96, ssao: false,
      grassDensity: 0.35, cloudDetail: 1, wetReflections: false
    },
    high: {
      label: 'High', qualityRank: 2, pixelRatio: 1.5, shadows: true, shadowSize: 2048,
      shadowHalf: 130, drawDistance: 1600, crowdDensity: 0.8, particleMul: 1, anisotropy: 16,
      msaa: 0, asphaltDetail: 2, carDetail: 2, postFX: true, skidMarks: 800, maxLights: 6,
      bloomStrength: 0.32, bloomRadius: 0.55, bloomThreshold: 0.92, ssao: true,
      grassDensity: 0.65, cloudDetail: 2, wetReflections: true
    },
    ultra: {
      label: 'Ultra', qualityRank: 3, pixelRatio: 2.0, shadows: true, shadowSize: 4096,
      shadowHalf: 170, drawDistance: 2200, crowdDensity: 1, particleMul: 1.3, anisotropy: 16,
      msaa: 0, asphaltDetail: 2, carDetail: 2, postFX: true, skidMarks: 1200, maxLights: 8,
      bloomStrength: 0.38, bloomRadius: 0.62, bloomThreshold: 0.88, ssao: true,
      grassDensity: 1.0, cloudDetail: 2, wetReflections: true
    }
  };

  var DEFAULT_BINDS = {
    throttle: ['KeyW', 'ArrowUp'],
    brake: ['KeyS', 'ArrowDown'],
    steerLeft: ['KeyA', 'ArrowLeft'],
    steerRight: ['KeyD', 'ArrowRight'],
    gearUp: ['KeyE', 'ShiftLeft'],
    gearDown: ['KeyQ', 'ControlLeft'],
    boost: ['Space'],
    ersMode: ['KeyF'],
    brakeBalance: ['KeyB'],
    cycleHud: ['KeyH'],
    camera: ['KeyC'],
    lookBack: ['KeyX'],
    pause: ['Escape'],          // KeyP is the pit request; do not bind it here
    resetCar: ['KeyR'],
    overtake: ['KeyO'],
    radio: ['KeyT']
  };

  var defaults = {
    version: 1,
    graphics: {
      quality: 'high',
      autoQuality: true,
      resolutionScale: 100,          // % of preset pixel ratio
      drawDistance: 100,             // % of preset
      shadowsQuality: 2,             // 0 off, 1 low, 2 high
      motionBlur: false,
      fov: 62
    },
    audio: { master: 0.8, engine: 0.9, tyres: 0.7, crowd: 0.5, ui: 0.7, engineer: 0.9, music: 0.4, muted: false },
    gameplay: {
      units: 'kmh',                  // 'kmh' | 'mph'
      difficulty: 'balanced',        // 'rookie' | 'balanced' | 'pro' | 'legend' | 'custom'
      raceLength: 0.25,              // 0.25 | 0.5 | 1
      damage: 'realistic',           // 'off' | 'visual' | 'realistic'
      fuelSim: true,
      aiAggression: 1.0,
      penalties: true,
      flashbacks: 0,                 // number of rewinds allowed
      includeCancelled: false,       // include Bahrain + Jeddah in the calendar
      ghost: true,
      seatTeam: 'mclaren',           // quick-race seat, independent of career
      seatDriver: 'norris'
    },
    assists: {
      tractionControl: 2,            // 0 off .. 3 full
      abs: 2,
      steeringAssist: 1,
      autoGears: true,
      racingLine: 1,                 // 0 off, 1 braking + line, 2 full line
      brakeAssist: 0,
      pitAssist: true,
      autoErs: true
    },
    controls: { binds: F1.util.clone(DEFAULT_BINDS), steerSensitivity: 1.0, gamepadDeadzone: 0.12, rumble: true, invertLookY: false },
    display: {
      hudScale: 1.0, colorblind: false, showPerformance: false, showMinimap: true,
      broadcastStyle: 'modern', language: 'en', reduceMotion: false, tyreTempC: true
    },
    career: { myTeam: false, seed: '', teamId: 'mclaren', driverId: '' }
  };

  function merge(base, over) {
    var out = {};
    Object.keys(base).forEach(function (k) {
      var b = base[k], o = over ? over[k] : undefined;
      if (o === undefined) out[k] = F1.util.clone(b);
      else if (b && typeof b === 'object' && !Array.isArray(b)) out[k] = merge(b, o);
      else out[k] = o;
    });
    return out;
  }

  var settings = merge(defaults, F1.storage.get(STORE_KEY, null) || {});

  settings.presets = QUALITY;
  settings.defaultBinds = DEFAULT_BINDS;

  settings.preset = function () {
    var q = settings.graphics.quality;
    var p = F1.util.clone(QUALITY[q] || QUALITY.high);
    p.label = (QUALITY[q] || QUALITY.high).label;
    p.pixelRatio = p.pixelRatio * (settings.graphics.resolutionScale / 100);
    p.drawDistance = p.drawDistance * (settings.graphics.drawDistance / 100);
    if (!settings.graphics.shadowsQuality) p.shadows = false;
    else if (settings.graphics.shadowsQuality === 1) p.shadowSize = Math.min(p.shadowSize, 1024);
    return p;
  };

  settings.save = function () {
    F1.storage.set(STORE_KEY, settings);
  };

  settings.reset = function (section) {
    if (section && defaults[section]) settings[section] = F1.util.clone(defaults[section]);
    else {
      var keep = settings;
      Object.keys(defaults).forEach(function (k) { keep[k] = F1.util.clone(defaults[k]); });
      keep.presets = QUALITY; keep.defaultBinds = DEFAULT_BINDS;
      keep.preset = settings.preset; keep.save = settings.save; keep.reset = settings.reset;
      F1.settings = keep;
    }
    settings.save();
  };

  /* units helpers used by HUD / menus */
  settings.speedFromMs = function (ms) {
    return settings.gameplay.units === 'mph' ? ms * 2.2369362920544 : ms * 3.6;
  };
  settings.speedUnit = function () { return settings.gameplay.units === 'mph' ? 'mph' : 'km/h'; };
  settings.distanceFromM = function (m) {
    return settings.gameplay.units === 'mph' ? m * 3.280839895 : m;
  };
  settings.distanceUnit = function () { return settings.gameplay.units === 'mph' ? 'ft' : 'm'; };

  /* Ctrl/Cmd detection for platform-specific hints */
  settings.isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  F1.settings = settings;
  F1.settings.defaults = defaults;
})(window.F1 = window.F1 || {});
