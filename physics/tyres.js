/* ==========================================================================
   F1 2026 — physics/tyres.js
   Tyre compounds, the normalised force curve used by physics/vehicle.js, and
   the temperature / wear model that feeds the HUD.

   The model is deliberately simple but not fake: every force the car makes
   goes through one curve, and grip is a function of that curve, the vertical
   load, the compound, the surface and the tyre's current temperature and wear.
   Nothing here adds grip for the AI or for the player.

   F1.tyres.create('soft') -> tyre state
   F1.tyres.step(tyre, work, dt, ambientC) -> grip multiplier (updates temp/wear)
   F1.tyres.curve(slipNorm) -> 0..1 normalised force
   ========================================================================== */
(function (F1) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* compounds                                                          */
  /* ------------------------------------------------------------------ */
  var COMPOUNDS = {
    soft: {
      id: 'soft', code: 'S', name: 'Soft', color: '#e10600',
      grip: 2.52, wearRate: 1.55, peakTemp: 92, heatGain: 1.18,
      wetGrip: 0.30, dryOnly: true
    },
    medium: {
      id: 'medium', code: 'M', name: 'Medium', color: '#ffd400',
      grip: 2.38, wearRate: 1.0, peakTemp: 98, heatGain: 1.0,
      wetGrip: 0.36, dryOnly: true
    },
    hard: {
      id: 'hard', code: 'H', name: 'Hard', color: '#f2f2f2',
      grip: 2.20, wearRate: 0.70, peakTemp: 104, heatGain: 0.86,
      wetGrip: 0.40, dryOnly: true
    },
    inter: {
      id: 'inter', code: 'I', name: 'Intermediate', color: '#19c37d',
      grip: 2.05, wearRate: 0.95, peakTemp: 80, heatGain: 0.95,
      wetGrip: 0.74, dryOnly: false
    },
    wet: {
      id: 'wet', code: 'W', name: 'Wet', color: '#2d6fe0',
      grip: 1.62, wearRate: 0.82, peakTemp: 70, heatGain: 0.9,
      wetGrip: 0.96, dryOnly: false
    }
  };

  function compound(id) {
    return COMPOUNDS[id] || COMPOUNDS.medium;
  }

  /* ------------------------------------------------------------------ */
  /* force curve                                                        */
  /* ------------------------------------------------------------------ */
  /* Normalised slip -> normalised force.
       sn = 0    -> 0
       sn = 1    -> 1     (peak grip)
       sn -> inf -> 0.84  (sliding friction, still useful)
     Sneaking the peak exactly to sn = 1 keeps the vehicle code readable:
     "normalise the slip by the peak slip and read the curve". */
  function curve(sn) {
    if (sn <= 0) return 0;
    if (sn < 1) {
      // sin ramp: 0 at 0, 1 at the peak
      return Math.sin(sn * Math.PI * 0.5);
    }
    var t = 1 - Math.exp(-(sn - 1) * 1.55);
    return 1 - 0.215 * t;
  }

  /* ------------------------------------------------------------------ */
  /* tyre state                                                         */
  /* ------------------------------------------------------------------ */
  function create(compoundId, opts) {
    opts = opts || {};
    var c = compound(compoundId);
    return {
      compound: c.id,
      code: c.code,
      color: c.color,
      tempC: opts.tempC !== undefined ? opts.tempC : 78,
      wear: opts.wear || 0,            // 0 new .. 1 destroyed
      pressure: opts.pressure || 1.0,
      surfaceTempC: 60,
      graining: 0,
      flatSpot: 0,
      grip: c.grip,
      _work: 0
    };
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* Grip multiplier from thermal state: 1 at the compound's peak temperature,
     falling off either side. Cold tyres are genuinely slippery. */
  function tempFactor(tyre, c) {
    // asymmetric: overheating costs less than the cold cliff below
    var over = tyre.tempC - c.peakTemp;
    var f;
    if (over >= 0) {
      f = 1 - 0.34 * Math.min(1, over / (c.peakTemp * 0.85)) - 0.16 * Math.min(1, over / (c.peakTemp * 1.8));
    } else {
      f = 1 - 0.40 * Math.pow(Math.min(1, -over / (c.peakTemp * 0.75)), 2);
    }
    if (f < 0.34) f = 0.34;
    // below ~45 C the tyre is a brick; blend in a cold-cliff
    if (tyre.tempC < 45) f *= clamp((tyre.tempC - 5) / 40, 0.15, 1);
    return f;
  }

  /* Grip multiplier from wear: gentle until the tyre is 80 % gone, then a
     cliff (this is what makes the strategy calls in later sections matter). */
  function wearFactor(tyre) {
    var w = tyre.wear;
    if (w <= 0.8) return 1 - 0.16 * w;
    var over = (w - 0.8) / 0.2;
    return (1 - 0.128) - 0.42 * over * over;
  }

  /* Current grip multiplier, 0.25 .. 1.06 */
  function gripFactor(tyre) {
    var c = compound(tyre.compound);
    var g = tempFactor(tyre, c) * wearFactor(tyre);
    return clamp(g, 0.22, 1.08);
  }

  /* Surface grip. 'wet' surfaces scale by the compound's wet ability. */
  var SURFACES = {
    asphalt: { grip: 1.0, rough: 0.0, drag: 1.0, sound: 'tarmac' },
    kerb:    { grip: 0.80, rough: 1.0, drag: 1.0, sound: 'kerb' },
    paint:   { grip: 0.92, rough: 0.35, drag: 1.0, sound: 'tarmac' },
    astro:   { grip: 0.62, rough: 1.3, drag: 1.05, sound: 'grass' },
    grass:   { grip: 0.52, rough: 1.7, drag: 1.15, sound: 'grass' },
    gravel:  { grip: 0.44, rough: 2.0, drag: 2.1, sound: 'gravel' },
    sand:    { grip: 0.40, rough: 1.8, drag: 2.2, sound: 'gravel' }
  };

  function surface(name) { return SURFACES[name] || SURFACES.asphalt; }

  /* Effective mu for one axle: compound grip * thermal/wear * surface.
     wetness 0..1 blends from dry grip to the compound's wet grip. */
  function mu(tyre, surfaceName, wetness) {
    var c = compound(tyre.compound);
    var s = surface(surfaceName);
    wetness = wetness || 0;
    // dry compounds lose most of their grip in the wet; wets keep theirs
    var base = c.grip * (1 - wetness) + c.wetGrip * wetness;
    return base * gripFactor(tyre) * s.grip;
  }

  /* ------------------------------------------------------------------ */
  /* thermal + wear update                                              */
  /* ------------------------------------------------------------------ */
  /* effort = {
       slipPower : joules per second being rubbed off in the contact patch
       brake     : 0..1 pedal, adds disc heat through the rim
       speed     : m/s, drives airflow cooling
       load      : N on this corner, scales the wear
     }
     Thermal mass is lumped: dT/dt = (heat in - heat out) / C with C chosen so
     a hard cornering tyre climbs ~3-5 K/s and a straight settles near 90 C. */
  function step(tyre, effort, dt, ambientC) {
    var c = compound(tyre.compound);
    ambientC = ambientC === undefined ? 24 : ambientC;
    var speed = effort.speed || 0;
    var power = effort.slipPower || 0;

    // heat in: slip power in the contact patch + a little from the brakes +
    // the constant flexing of a tyre that is simply rolling fast
    var heatIn = power * 0.00011 * c.heatGain
      + (effort.brake || 0) * speed * 0.016 * c.heatGain
      + speed * 0.008;

    // heat out: convection, better with airflow
    var cool = (tyre.tempC - ambientC) * (0.014 + 0.00018 * speed);

    tyre.tempC += (heatIn - cool) * dt;
    if (tyre.tempC < ambientC) tyre.tempC = ambientC;
    if (tyre.tempC > 150) tyre.tempC = 150;

    // wear: energy in the slip zone, punished by overheating and by itself
    var load = effort.load || 4000;
    var wearPower = effort.wearPower === undefined ? power * 0.5 : effort.wearPower;
    var tempStress = 1 + Math.max(0, (tyre.tempC - c.peakTemp) / 32);
    var loadStress = 0.75 + load / 16000;
    tyre.wear += wearPower * 1.5e-8 * c.wearRate * tempStress * loadStress * dt;
    if (tyre.graining !== undefined && tyre.tempC < c.peakTemp - 30 && power > 4000) {
      tyre.graining = Math.min(1, tyre.graining + dt * 0.02);
    }
    if (tyre.wear > 1) tyre.wear = 1;

    tyre.surfaceTempC += (tyre.tempC - tyre.surfaceTempC) * Math.min(1, dt * 1.8);
    tyre.grip = c.grip * gripFactor(tyre);
    return tyre.grip;
  }

  /* ------------------------------------------------------------------ */
  /* exports                                                            */
  /* ------------------------------------------------------------------ */
  F1.tyres = {
    COMPOUNDS: COMPOUNDS,
    SURFACES: SURFACES,
    compound: compound,
    create: create,
    curve: curve,
    gripFactor: gripFactor,
    tempFactor: tempFactor,
    wearFactor: wearFactor,
    surface: surface,
    mu: mu,
    step: step,
    peakSlipAngle: 0.122,      // rad, dry
    peakSlipRatio: 0.09,
    thermal: function (tyre) {
      // 0..1 "how ready is this tyre", used by the HUD colour coding
      var c = compound(tyre.compound);
      return clamp(1 - Math.abs(tyre.tempC - c.peakTemp) / 55, 0, 1);
    }
  };
})(window.F1 = window.F1 || {});
