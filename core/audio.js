/* ==========================================================================
   F1 2026 — core/audio.js
   Every sound in the game is synthesised: there is not a single audio file in
   the repository. That keeps the download small and means the engine note
   follows the revs exactly instead of being a loop pitched up and down.

   Graph
     engine  2 saw oscillators (slightly detuned) + sub square -> lowpass ->
             waveshaper -> engineGain ----------------------------+
     turbo   band-passed noise, gain follows boost ---------------+
     tyres   noise -> bandpass, gain follows slip and lateral g ---+-> mix
     wind    noise -> lowpass, gain follows speed ----------------+
     crowd   noise -> bandpass, slow swell ------------------------+
     radio   short filtered noise bursts, for the engineer --------+

   The context is created lazily on the first key press or click: a browser
   will not let a page start audio before a user gesture, and file:// changes
   nothing about that.

     F1.audio.init();
     F1.audio.update({ rpm, throttle, speed, slip, latG, surface, gear });
     F1.audio.beep('radio');
     F1.audio.applyVolumes();
     F1.audio.suspend();
   ========================================================================== */
(function (F1) {
  'use strict';

  var A = {
    ctx: null,
    ready: false,
    muted: false,
    master: null,
    bus: {},
    nodes: {},
    _lastRpm: 11000,
    _targets: {},
    _voices: {}
  };

  var NOISE_SECONDS = 2;

  /* ------------------------------------------------------------------ */
  /* helpers                                                            */
  /* ------------------------------------------------------------------ */
  function noiseBuffer(ctx) {
    var len = Math.floor(ctx.sampleRate * NOISE_SECONDS);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    // pink-ish noise: a cheap one-pole filter over white noise
    var last = 0;
    for (var i = 0; i < len; i++) {
      var white = Math.random() * 2 - 1;
      last = 0.97 * last + 0.03 * white;
      d[i] = (white * 0.35 + last * 3.2) * 0.5;
    }
    return buf;
  }

  function softClip(ctx) {
    var n = 1024;
    var curve = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.8);
    }
    return curve;
  }

  function makeNoise(ctx, buffer) {
    var src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    return src;
  }

  /* ------------------------------------------------------------------ */
  /* build the graph                                                    */
  /* ------------------------------------------------------------------ */
  function build() {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { A.ready = false; return false; }
    var ctx = new Ctx();
    A.ctx = ctx;

    A.master = ctx.createGain();
    A.master.gain.value = 0.0;               // faded in by applyVolumes
    A.master.connect(ctx.destination);

    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    comp.attack.value = 0.006;
    comp.release.value = 0.22;
    comp.connect(A.master);

    var bus = A.bus;
    ['engine', 'tyres', 'crowd', 'ui', 'engineer'].forEach(function (k) {
      bus[k] = ctx.createGain();
      bus[k].gain.value = 0.5;
      bus[k].connect(comp);
    });

    var noise = noiseBuffer(ctx);

    /* ---------------- engine ---------------- */
    var oscA = ctx.createOscillator();
    var oscB = ctx.createOscillator();
    var sub = ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscB.type = 'sawtooth';
    sub.type = 'square';
    oscA.frequency.value = 70;
    oscB.frequency.value = 71.5;             // detune gives the beat
    sub.frequency.value = 35;

    var subGain = ctx.createGain();
    subGain.gain.value = 0.35;
    var oscMix = ctx.createGain();
    oscMix.gain.value = 0.55;

    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.Q.value = 1.4;

    var shaper = ctx.createWaveShaper();
    shaper.curve = softClip(ctx);
    shaper.oversample = '2x';

    var engGain = ctx.createGain();
    engGain.gain.value = 0.0;

    oscA.connect(oscMix);
    oscB.connect(oscMix);
    sub.connect(subGain);
    subGain.connect(oscMix);
    oscMix.connect(lp);
    lp.connect(shaper);
    shaper.connect(engGain);
    engGain.connect(bus.engine);

    var engPan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (engPan) {
      engGain.disconnect();
      engGain.connect(engPan);
      engPan.connect(bus.engine);
      engPan.pan.value = 0;
    }

    oscA.start(); oscB.start(); sub.start();

    /* ---------------- turbo whistle ---------------- */
    var turbo = makeNoise(ctx, noise);
    var turboBP = ctx.createBiquadFilter();
    turboBP.type = 'bandpass';
    turboBP.frequency.value = 2600;
    turboBP.Q.value = 6;
    var turboGain = ctx.createGain();
    turboGain.gain.value = 0;
    turbo.connect(turboBP);
    turboBP.connect(turboGain);
    turboGain.connect(bus.engine);
    turbo.start();

    /* ---------------- tyres ---------------- */
    var tyre = makeNoise(ctx, noise);
    var tyreBP = ctx.createBiquadFilter();
    tyreBP.type = 'bandpass';
    tyreBP.frequency.value = 1500;
    tyreBP.Q.value = 0.9;
    var tyreGain = ctx.createGain();
    tyreGain.gain.value = 0;
    tyre.connect(tyreBP);
    tyreBP.connect(tyreGain);
    tyreGain.connect(bus.tyres);
    tyre.start();

    /* ---------------- wind ---------------- */
    var wind = makeNoise(ctx, noise);
    var windLP = ctx.createBiquadFilter();
    windLP.type = 'lowpass';
    windLP.frequency.value = 620;
    var windGain = ctx.createGain();
    windGain.gain.value = 0;
    wind.connect(windLP);
    windLP.connect(windGain);
    windGain.connect(bus.tyres);
    wind.start();

    /* ---------------- crowd ---------------- */
    var crowd = makeNoise(ctx, noise);
    var crowdBP = ctx.createBiquadFilter();
    crowdBP.type = 'bandpass';
    crowdBP.frequency.value = 780;
    crowdBP.Q.value = 0.7;
    var crowdGain = ctx.createGain();
    crowdGain.gain.value = 0.0;
    crowd.connect(crowdBP);
    crowdBP.connect(crowdGain);
    crowdGain.connect(bus.crowd);
    crowd.start();

    A.nodes = {
      oscA: oscA, oscB: oscB, sub: sub, lp: lp, engGain: engGain, pan: engPan,
      turboBP: turboBP, turboGain: turboGain,
      tyreBP: tyreBP, tyreGain: tyreGain,
      windLP: windLP, windGain: windGain,
      crowdBP: crowdBP, crowdGain: crowdGain,
      noise: noise
    };

    A.ready = true;
    A.muted = !!(F1.settings.audio && F1.settings.audio.muted);
    applyVolumes();
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* volumes                                                            */
  /* ------------------------------------------------------------------ */
  function vol(x, fallback) {
    return typeof x === 'number' && isFinite(x) ? Math.max(0, Math.min(1, x)) : fallback;
  }

  function applyVolumes() {
    if (!A.ready) return;
    var s = F1.settings.audio;
    var now = A.ctx.currentTime;
    var m = A.muted ? 0 : vol(s.master, 0.8);
    A.master.gain.cancelScheduledValues(now);
    A.master.gain.setTargetAtTime(Math.max(0, Math.min(1, m)) * 0.9, now, 0.08);
    A.master.gain.value = Math.max(0, Math.min(1, m)) * 0.9;   // immediate read-back for tests
    A.bus.engine.gain.setTargetAtTime(vol(s.engine, 0.9) * 0.55, now, 0.05);
    A.bus.tyres.gain.setTargetAtTime(vol(s.tyres, 0.7) * 0.5, now, 0.05);
    A.bus.crowd.gain.setTargetAtTime(vol(s.crowd, 0.5) * 0.42, now, 0.05);
    A.bus.ui.gain.setTargetAtTime(vol(s.ui, 0.7) * 0.5, now, 0.02);
    A.bus.engineer.gain.setTargetAtTime(vol(s.engineer, 0.9) * 0.6, now, 0.02);
  }

  /* ------------------------------------------------------------------ */
  /* one frame of engine state                                          */
  /* ------------------------------------------------------------------ */
  function update(st) {
    if (!A.ready || !st) return;
    var now = A.ctx.currentTime;
    var n = A.nodes;
    var rpm = Math.max(900, st.rpm || 1000);
    var thr = st.throttle === undefined ? 0 : st.throttle;
    var speed = Math.abs(st.speed || 0);

    // firing frequency: a V6 at 15 000 rpm is 750 Hz of exhaust pulses; halve
    // it so the note sits where a real car sits rather than in the whistle band
    var f = rpm / 60 * 3;
    var detune = 1 + 0.004 * Math.sin(now * 1.7);
    n.oscA.frequency.setTargetAtTime(f, now, 0.02);
    n.oscB.frequency.setTargetAtTime(f * 1.006 * detune, now, 0.02);
    n.sub.frequency.setTargetAtTime(f * 0.5, now, 0.03);

    var open = 0.28 + thr * 0.55 + Math.min(1, speed / 90) * 0.2;
    n.lp.frequency.setTargetAtTime(420 + rpm * 0.16 + thr * 900, now, 0.03);
    n.lp.Q.setTargetAtTime(1.2 + thr * 1.6, now, 0.05);
    n.engGain.gain.setTargetAtTime(open * 0.42, now, 0.04);

    // turbo: spool depends on throttle and revs
    var spool = Math.max(0, thr) * Math.min(1, rpm / 11000);
    n.turboBP.frequency.setTargetAtTime(1800 + rpm * 0.13, now, 0.05);
    n.turboGain.gain.setTargetAtTime(spool * 0.045, now, 0.08);

    // tyres: slip and lateral load, plus a gravel/kerb rumble from the surface
    var slip = Math.abs(st.slip || 0);
    var lat = Math.min(1, Math.abs(st.latG || 0) / 2.6);
    var surf = st.surface || 'asphalt';
    var surfMul = surf === 'gravel' ? 3.2 : surf === 'grass' ? 2.1 :
      surf === 'kerb' ? 1.7 : surf === 'paint' ? 0.9 : 1;
    var tyre = (slip * 0.30 + lat * 0.10) * surfMul;
    n.tyreGain.gain.setTargetAtTime(Math.min(0.5, tyre), now, 0.05);
    n.tyreBP.frequency.setTargetAtTime(
      surf === 'gravel' ? 700 : surf === 'kerb' ? 2200 : 1500, now, 0.06);

    // wind and road noise
    n.windGain.gain.setTargetAtTime(Math.min(0.22, speed * 0.0022), now, 0.08);
    n.windLP.frequency.setTargetAtTime(350 + speed * 6, now, 0.1);

    // crowd swells with what is happening (a pass, a spin) — supplied by the
    // session as `excitement` 0..1
    n.crowdGain.gain.setTargetAtTime(0.02 + (st.excitement || 0) * 0.20, now, 0.35);

    A._lastRpm = rpm;
  }

  /* ------------------------------------------------------------------ */
  /* one-shots                                                          */
  /* ------------------------------------------------------------------ */
  function blip(freq, dur, type, vol, dest) {
    if (!A.ready) return;
    var ctx = A.ctx, now = ctx.currentTime;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol || 0.12, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    o.connect(g);
    g.connect(dest || A.bus.ui);
    o.start(now);
    o.stop(now + dur + 0.02);
  }

  function radioBurst(dur) {
    if (!A.ready) return;
    var ctx = A.ctx, now = ctx.currentTime;
    var src = makeNoise(ctx, A.nodes.noise);
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1600;
    bp.Q.value = 3.5;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.10, now + 0.01);
    g.gain.setValueAtTime(0.10, now + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    src.connect(bp); bp.connect(g); g.connect(A.bus.engineer);
    src.start(now);
    src.stop(now + dur + 0.05);
  }

  A.update = update;        // the per-frame engine / tyre / wind feed

  A.beep = function (kind) {
    if (!A.ready) return;
    switch (kind) {
      case 'radio': radioBurst(0.16); setTimeout(function () { blip(880, 0.09, 'square', 0.05, A.bus.engineer); }, 170); break;
      case 'click': blip(520, 0.05, 'triangle', 0.07); break;
      case 'select': blip(760, 0.07, 'triangle', 0.08); break;
      case 'back': blip(340, 0.07, 'triangle', 0.07); break;
      case 'lights': blip(600, 0.12, 'square', 0.1); break;
      case 'go': blip(1200, 0.28, 'square', 0.12); break;
      case 'penalty': blip(220, 0.22, 'sawtooth', 0.09); break;
      case 'lap': blip(980, 0.1, 'sine', 0.08); setTimeout(function () { blip(1320, 0.14, 'sine', 0.07); }, 110); break;
      case 'chequered': blip(880, 0.16, 'square', 0.1); setTimeout(function () { blip(1180, 0.3, 'square', 0.1); }, 180); break;
      default: blip(600, 0.06, 'sine', 0.06);
    }
  };

  /* an "engineer" line: two radio clicks and a typed message */
  A.radio = function (text) {
    if (A.ready) radioBurst(0.12);       // the squelch, even if the graph is cold
    F1.bus.emit('radio-message', text);
  };

  /* ------------------------------------------------------------------ */
  /* lifecycle                                                          */
  /* ------------------------------------------------------------------ */
  A.init = function () {
    if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return A.ready; }
    try { build(); } catch (e) {
      console.warn('[audio] could not start', e);
      A.ready = false;
    }
    return A.ready;
  };

  A.suspend = function () {
    if (A.ctx && A.ctx.state === 'running') A.ctx.suspend();
  };
  A.resume = function () {
    if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume();
  };
  A.applyVolumes = applyVolumes;
  A.setMuted = function (m) {
    A.muted = !!m;
    applyVolumes();
  };
  A.toggleMute = function () {
    A.setMuted(!A.muted);
    return A.muted;
  };

  /* the graph needs a real quiet engine at idle, otherwise the first corner
     arrives with a bang */
  A.updateIdle = function () {
    if (!A.ready) return;
    var now = A.ctx.currentTime;
    A.nodes.engGain.gain.setTargetAtTime(0.06, now, 0.2);
    A.nodes.tyreGain.gain.setTargetAtTime(0, now, 0.2);
    A.nodes.windGain.gain.setTargetAtTime(0, now, 0.2);
    A.nodes.turboGain.gain.setTargetAtTime(0, now, 0.2);
    A.nodes.oscA.frequency.setTargetAtTime(60, now, 0.3);
    A.nodes.oscB.frequency.setTargetAtTime(61, now, 0.3);
    A.nodes.sub.frequency.setTargetAtTime(30, now, 0.3);
    A.nodes.lp.frequency.setTargetAtTime(500, now, 0.3);
  };

  F1.audio = A;
})(window.F1 = window.F1 || {});
