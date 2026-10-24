/* ==========================================================================
   F1 2026 — physics/vehicle.js
   Vehicle dynamics for a 2026 car: 400 kW ICE + 350 kW ERS, active aero
   (X = low drag, Z = high downforce), 8-speed gearbox, friction-limited
   tyres, weight transfer, damage and driver aids.

   Model: two-axle ("bicycle") body with combined-slip tyre forces, integrated
   at a fixed 120 Hz by game/session.js. Nothing here cheats: every force the
   car generates passes through F1.tyres.curve() and the friction circle, so
   the AI in Section 4 can use exactly the same code.

   Body frame: +vx forward, +vl lateral (toward the track's right normal),
   +r yaw rate (heading increasing = turning toward +vl).

   F1.vehicle.specFor(teamId, driverId) -> car spec
   F1.vehicle.create(track, spec, opts) -> car state
   F1.vehicle.step(car, input, dt, track, env)
   ========================================================================== */
(function (F1) {
  'use strict';

  var G = 9.81;
  var RHO = 1.225;

  /* ------------------------------------------------------------------ */
  /* baseline car                                                       */
  /* ------------------------------------------------------------------ */
  var DEFAULTS = {
    mass: 768,              // 2026 minimum, before fuel
    inertia: 1420,          // kg m^2 yaw
    a: 1.62,                // CG -> front axle
    b: 1.78,                // CG -> rear axle
    trackWidth: 1.66,
    cgHeight: 0.31,
    wheelRadius: 0.36,
    gears: [2.95, 2.32, 1.92, 1.63, 1.40, 1.22, 1.07, 0.94],
    finalDrive: 4.95,
    drivetrain: 0.92,
    maxRpm: 15000,
    idleRpm: 4000,
    shiftRpm: 14400,
    shiftTime: 0.045,
    peakTorque: 350,        // Nm (about 405 kW at 11 000 rpm)
    icePower: 405000,       // W
    ersPower: 300000,       // W continuous deploy
    ersOvertake: 350000,    // W in overtake mode
    ersCapacity: 8000000,   // J usable per lap
    regenPower: 250000,     // W under braking
    dragX: 0.86,
    dragZ: 1.24,
    downX: 2.30,
    downZ: 5.50,
    aeroFront: 0.40,
    brakeMax: 34000,        // N with both feet on the pedal (clipped by grip)
    brakeBias: 0.57,
    steerLock: 0.40,        // rad at standstill
    peakAngle: 0.165,       // rad
    peakRatio: 0.085,
    fuelDefault: 28,        // kg
    fuelBurn: 0.0275,       // kg/s at full throttle
    limiter: 0              // m/s, 0 = off
  };

  var AERO_SWITCH_TIME = 0.35;

  /* ------------------------------------------------------------------ */
  /* spec from team performance                                         */
  /* ------------------------------------------------------------------ */
  function specFor(teamId, driverId) {
    var team = F1.DATA.getTeam(teamId) || F1.DATA.teams[0];
    var p = team.performance || { aero: 90, power: 90, chassis: 90 };
    var s = F1.util.clone(DEFAULTS);
    // ratings span roughly 76..96; map to a +/- 4 % performance window so the
    // field is close but the best car is measurably quicker
    var powerMul = 0.965 + (p.power - 86) * 0.0028;
    var aeroMul = 0.968 + (p.aero - 86) * 0.0032;
    var chassisMul = 0.974 + (p.chassis - 86) * 0.0026;

    s.icePower = DEFAULTS.icePower * powerMul;
    s.ersPower = DEFAULTS.ersPower * powerMul;
    s.ersOvertake = DEFAULTS.ersOvertake * powerMul;
    s.peakTorque = DEFAULTS.peakTorque * powerMul;

    s.downZ = DEFAULTS.downZ * aeroMul;
    s.downX = DEFAULTS.downX * aeroMul;
    s.dragZ = DEFAULTS.dragZ * (2 - aeroMul);      // more aero = slightly more drag
    s.dragX = DEFAULTS.dragX * (2 - aeroMul);

    s.mass = DEFAULTS.mass + (90 - p.chassis) * 1.6;
    s.inertia = DEFAULTS.inertia * (1 + (90 - p.chassis) * 0.004);
    s.brakeMax = DEFAULTS.brakeMax * chassisMul;
    s.team = team.id;
    s.driverId = driverId || (team.drivers && team.drivers[0]);
    return s;
  }

  /* ------------------------------------------------------------------ */
  /* state                                                              */
  /* ------------------------------------------------------------------ */
  function create(track, spec, opts) {
    opts = opts || {};
    var startS = opts.startS === undefined ? 0 : opts.startS;
    var lateral = opts.lateral || 0;
    var p = track.offsetPoint(startS, lateral, {});
    var compound = opts.compound || 'medium';
    var car = {
      spec: spec,
      x: p.x, y: p.y, z: p.z,
      heading: p.heading,
      vx: 0, vl: 0, r: 0,            // forward, lateral, yaw rate
      steer: 0,
      throttle: 0, brake: 0,
      gear: opts.gear || 2,
      rpm: spec.idleRpm,
      shiftTimer: 0,
      autoShift: opts.autoGears === undefined ? true : !!opts.autoGears,

      ers: 0.55,                     // 0..1 of the deployable store
      ersMode: 'balanced',           // harvest | balanced | deploy | overtake
      ersDeploy: 0,                  // W actually deployed last step
      aeroMode: 'Z',
      aeroTimer: 0,
      aeroAuto: true,
      drs: false,                    // set by race control in Section 4

      fuel: opts.fuel === undefined ? spec.fuelDefault : opts.fuel,
      tyreWetness: opts.wetness || 0,
      compound: compound,
      tyres: {
        fl: F1.tyres.create(compound, { tempC: opts.tyreTempC || 78 }),
        fr: F1.tyres.create(compound, { tempC: opts.tyreTempC || 78 }),
        rl: F1.tyres.create(compound, { tempC: opts.tyreTempC || 80 }),
        rr: F1.tyres.create(compound, { tempC: opts.tyreTempC || 80 })
      },
      damage: { frontWing: 0, rearWing: 0, floor: 0, engine: 0, gearbox: 0, suspension: 0 },
      brakeGlow: 0,

      s: startS,
      lateral: lateral,
      lastIdx: track.indexAt(startS),
      surface: 'asphalt',
      edge: 0,
      speed: 0,
      slipF: 0, slipR: 0, slipRatio: 0,
      latG: 0, longG: 0,
      wheelSpin: 0,
      reversing: false,
      reverseHold: 0,
      wallContact: 0,
      offTrackTime: 0,
      airTime: 0,
      assists: opts.assists || {}
    };
    car._at = {};
    return car;
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* engine torque at a given rpm, capped so power stays flat up top */
  function torqueAt(spec, rpm, gear, throttle) {
    var omega = Math.max(1, rpm * Math.PI / 30);          // rad/s
    var x = clamp(rpm / spec.maxRpm, 0, 1.05);
    var shape;
    if (x < 0.72) shape = 1 - 0.55 * Math.pow((0.72 - x) / 0.72, 2);
    else shape = 1 - 0.72 * Math.pow((x - 0.72) / 0.30, 2);
    var byCurve = Math.max(0.12, shape) * spec.peakTorque;
    var byPower = spec.icePower / omega;
    var tq = Math.min(byCurve, byPower);
    // part throttle + engine braking
    if (throttle > 0) return tq * throttle;
    return -tq * 0.14;                                     // engine braking
  }

  /* ------------------------------------------------------------------ */
  /* the step                                                           */
  /* ------------------------------------------------------------------ */
  function step(car, input, dt, track, env) {
    env = env || {};
    input = input || {};
    var spec = car.spec;
    var assists = env.assists || car.assists || {};
    var wetness = env.wetness || car.tyreWetness || 0;

    /* ---------------- 1. where are we? ---------------- */
    var pr = track.project(car.x, car.z, car.lastIdx);
    car.lastIdx = pr.idx;
    car.s = track.wrapS(pr.s);
    car.lateral = pr.lateral;
    var at = track.at(car.s, car._at);
    car.trackWidth = at.width;
    var halfW = at.width * 0.5;
    var edge = Math.abs(pr.lateral) - halfW;
    car.edge = edge;

    var surface = 'asphalt';
    if (edge > 1.35) surface = env.offTrack || 'grass';
    else if (edge > 0.90) surface = 'kerb';
    car.surface = surface;
    var surfDef = F1.tyres.surface(surface);

    // ride height follows the road, banking included
    var groundY = at.y + Math.abs(pr.lateral) * Math.tan(at.banking || 0);
    if (car.y === undefined) car.y = groundY;
    // a little suspension compliance so kerbs and crests are felt
    car.y = F1.util.damp(car.y, groundY, 14, dt);
    car.bankAngle = at.banking || 0;

    /* ---------------- 2. controls ---------------- */
    var speed = Math.hypot(car.vx, car.vl);
    car.speed = speed;
    var speedAbs = Math.abs(car.vx);

    var throttleIn = clamp(input.throttle || 0, 0, 1);
    var brakeIn = clamp(input.brake || 0, 0, 1);

    // reverse: holding the brake at a standstill reverses slowly
    if (car.vx < 1.5 && brakeIn > 0.15 && throttleIn < 0.1) {
      car.reverseHold += dt;
      if (car.reverseHold > 0.35) car.reversing = true;
    } else {
      car.reverseHold = 0;
      if (car.vx > -0.5) car.reversing = false;
    }
    if (car.reversing && car.vx > 0.5) car.reversing = false;

    var steerIn = clamp(input.steer || 0, -1, 1);
    var lock = spec.steerLock * (1 - 0.62 * clamp(speedAbs / 88, 0, 1));
    if (assists.steerAssist > 0) lock *= 1 - 0.10 * (assists.steerAssist / 3) * clamp(speedAbs / 70, 0, 1);
    var targetSteer = steerIn * lock;
    // countersteer help when the rear steps out
    if ((assists.steerAssist || 0) >= 1 && Math.abs(car.slipR) > 0.09 && speedAbs > 7) {
      var corr = -car.slipR * (0.22 + 0.20 * assists.steerAssist);
      targetSteer += clamp(corr, -0.55 * lock, 0.55 * lock);
    }
    var steerRate = 7.0;
    car.steer += clamp(targetSteer - car.steer, -steerRate * dt, steerRate * dt);

    /* ---------------- 3. gearbox ---------------- */
    var wheelRpm = speedAbs / (Math.PI * 2 * spec.wheelRadius) * 60;
    var ratio = spec.gears[car.gear - 1] * spec.finalDrive;
    var rpmFromWheels = wheelRpm * ratio;
    var rpm = Math.max(spec.idleRpm, rpmFromWheels);

    if (car.shiftTimer > 0) {
      car.shiftTimer -= dt;
      car.rpm = F1.util.damp(car.rpm, spec.shiftRpm * 0.96, 30, dt);
    } else {
      if (car.autoShift) {
        var upAt = spec.shiftRpm;
        var downAt = spec.shiftRpm * (circuitIsSlow(car) ? 0.60 : 0.55);
        if (rpm > upAt && car.gear < 8 && throttleIn > 0.05) {
          car.gear++; car.shiftTimer = spec.shiftTime;
          rpm = rpm * 0.76;
        } else if (rpm < downAt && car.gear > 1) {
          car.gear--; car.shiftTimer = spec.shiftTime * 0.7;
          rpm = rpm * 1.28;
        }
      } else {
        if (input.shiftUp && car.gear < 8) { car.gear++; car.shiftTimer = spec.shiftTime; }
        if (input.shiftDown && car.gear > 1) { car.gear--; car.shiftTimer = spec.shiftTime * 0.8; }
      }
    }
    car.rpm = F1.util.damp(car.rpm, rpm, 18, dt);

    /* ---------------- 4. engine + ERS ---------------- */
    var shifting = car.shiftTimer > 0;
    var gearRatio = spec.gears[car.gear - 1] * spec.finalDrive;
    var torque = shifting ? 0 : torqueAt(spec, car.rpm, car.gear, throttleIn);
    var driveForce = torque * gearRatio / spec.wheelRadius * spec.drivetrain;
    if (car.reversing) driveForce = -clamp(brakeIn, 0, 1) * 2600;

    // ERS: mode decides when it deploys
    var mode = car.ersMode;
    var deployW = 0;
    var wantDeploy = false;
    if (input.boost || mode === 'overtake') wantDeploy = car.ers > 0.02 && throttleIn > 0.35;
    else if (mode === 'deploy') wantDeploy = car.ers > 0.02 && throttleIn > 0.5 && speedAbs > 40;
    else if (mode === 'balanced') wantDeploy = car.ers > 0.25 && throttleIn > 0.9 && speedAbs > 60;
    var ersMax = (input.boost || mode === 'overtake') ? spec.ersOvertake : spec.ersPower;
    if (wantDeploy) {
      var allowed = car.ers * spec.ersCapacity / dt;      // cannot exceed the store
      deployW = Math.min(ersMax, allowed);
      car.ers = Math.max(0, car.ers - deployW * dt / spec.ersCapacity);
    } else if (brakeIn > 0.1 && car.vx > 6) {
      // MGU-K harvest under braking
      var regen = Math.min(spec.regenPower, brakeIn * spec.regenPower);
      car.ers = Math.min(1, car.ers + regen * dt / spec.ersCapacity);
    } else if (throttleIn < 0.05 && car.vx > 8) {
      car.ers = Math.min(1, car.ers + spec.regenPower * 0.35 * dt / spec.ersCapacity);
    }
    car.ersDeploy = deployW;
    driveForce += Math.min(deployW / Math.max(speedAbs, 14), 9000) * spec.drivetrain;

    /* ---------------- 5. aero ---------------- */
    car.aeroTimer += dt;
    if (env.forceAero) {
      car.aeroMode = env.forceAero;
    } else if (car.aeroAuto && car.aeroTimer > AERO_SWITCH_TIME) {
      // Open X only when there is genuinely no corner ahead: look a long way
      // down the road and require the car to be straight and unloaded. A
      // driver who opens the wing mid-corner loses the rear instantly.
      var aheadCurv = 0;
      for (var ad = 40; ad <= 220; ad += 45) {
        var probe = track.at(car.s + ad, car._probe || (car._probe = {}));
        aheadCurv = Math.max(aheadCurv, Math.abs(probe.curvature || 0));
      }
      var straight = aheadCurv < (1 / 380)
        && Math.abs(car.steer) < 0.022
        && Math.abs(car.latG) < 0.30
        && brakeIn < 0.05
        && speedAbs > 55;
      var next = straight ? 'X' : 'Z';
      if (next !== car.aeroMode) { car.aeroMode = next; car.aeroTimer = 0; }
    }

    var q = 0.5 * RHO * speedAbs * speedAbs;
    var cdA = car.aeroMode === 'X' ? spec.dragX : spec.dragZ;
    var clA = car.aeroMode === 'X' ? spec.downX : spec.downZ;
    if (car.drs) clA *= 0.72;                              // DRS: less downforce
    var dfHealth = clamp(1 - 0.55 * car.damage.frontWing - 0.35 * car.damage.rearWing
      - 0.20 * car.damage.floor, 0.25, 1);
    var downforce = q * clA * dfHealth;
    var drag = q * cdA * surfDef.drag;

    /* ---------------- 6. loads ---------------- */
    var mass = spec.mass + Math.max(0, car.fuel);
    var weight = mass * G;
    var wheelbase = spec.a + spec.b;
    var FzF = weight * spec.b / wheelbase + downforce * spec.aeroFront;
    var FzR = weight * spec.a / wheelbase + downforce * (1 - spec.aeroFront);
    // longitudinal transfer from the previous step's acceleration
    var transfer = mass * (car.longG * G) * spec.cgHeight / wheelbase;
    FzF = Math.max(200, FzF - transfer);
    FzR = Math.max(200, FzR + transfer);

    /* ---------------- 7. grip ---------------- */
    var muFL = F1.tyres.mu(car.tyres.fl, surface, wetness);
    var muR = F1.tyres.mu(car.tyres.rl, surface, wetness);
    // load sensitivity: mu falls as the tyre is pressed harder
    var muf = muFL * (1 - 0.085 * ((FzF / 2) / 3200 - 1));
    var mur = muR * (1 - 0.085 * ((FzR / 2) / 3200 - 1));
    muf = Math.max(0.15, muf);
    mur = Math.max(0.15, mur);

    var capF = muf * FzF;
    var capR = mur * FzR;

    /* ---------------- 8. slip angles -> lateral force ---------------- */
    var vxs = Math.max(Math.abs(car.vx), 1.0);
    var alphaF = Math.atan2(car.vl + spec.a * car.r, vxs) - car.steer;
    var alphaR = Math.atan2(car.vl - spec.b * car.r, vxs);
    car.slipF = alphaF;
    car.slipR = alphaR;

    var nF = F1.tyres.curve(Math.abs(alphaF) / spec.peakAngle);
    var nR = F1.tyres.curve(Math.abs(alphaR) / spec.peakAngle);
    var fyF = -capF * nF * F1.util.sign(alphaF);
    var fyR = -capR * nR * F1.util.sign(alphaR);

    /* ---------------- 9. longitudinal ---------------- */
    var brakeTotal = brakeIn * spec.brakeMax * (1 - 0.35 * car.damage.suspension);
    var fxDemandF = -brakeTotal * spec.brakeBias * F1.util.sign(car.vx);
    var fxDemandR = -brakeTotal * (1 - spec.brakeBias) * F1.util.sign(car.vx) + driveForce;

    // ABS: never ask for more than the tyre can give longitudinally. Higher
    // assist levels leave a bigger reserve for steering, which is why a high
    // ABS setting costs a little braking distance and gains a lot of stability.
    var absLevel = assists.abs || 0;
    if (absLevel > 0) {
      var absHead = 0.98 - 0.075 * absLevel;         // 0.905 .. 0.755
      fxDemandF = clamp(fxDemandF, -capF * absHead, capF * absHead);
      fxDemandR = clamp(fxDemandR, -capR * absHead, capR * absHead);
    }

    // Traction control: the drive force is trimmed so the rear keeps enough of
    // its friction circle to resist the corner. Level 3 is safe but slow; 0 is
    // the raw car and will spin on a damp kerb.
    var tc = assists.tractionControl || 0;
    var spin = 0;
    if (driveForce > 0) {
      var tcFrac = tc <= 0 ? 1.0 : (1.0 - 0.135 * tc);      // 0.87 / 0.73 / 0.60
      var steerLoad = Math.abs(car.steer) / Math.max(0.02, lock);
      tcFrac *= 1 - 0.22 * clamp(steerLoad, 0, 1);
      var allow = capR * tcFrac;
      if (driveForce > allow) {
        spin = clamp((driveForce - allow) / Math.max(allow, 1), 0, 3);
        driveForce = tc > 0 ? allow : allow * 1.15;         // still lets it spin a little
        fxDemandR = -brakeTotal * (1 - spec.brakeBias) * F1.util.sign(car.vx) + driveForce;
      }
    }
    car.wheelSpin = F1.util.damp(car.wheelSpin, spin, 12, dt);

    // friction circle per axle
    function ellipse(fx, fy, cap) {
      var mag = Math.hypot(fx, fy);
      if (mag > cap && mag > 1e-4) {
        var k = cap / mag;
        return { fx: fx * k, fy: fy * k, clipped: true };
      }
      return { fx: fx, fy: fy, clipped: false };
    }
    var ef = ellipse(fxDemandF, fyF, capF);
    var er = ellipse(fxDemandR, fyR, capR);
    if (er.clipped || car.wheelSpin > 0.05) {
      // spinning wheels give up lateral grip: it feels like oversteer
      var spinLoss = clamp(car.wheelSpin * 0.35, 0, 0.28);
      er.fy *= 1 - spinLoss;
      ef.fy *= 1 - spinLoss * 0.35;
    }

    /* ---------------- 10. integrate ---------------- */
    var rolling = 0.014 * weight * F1.util.sign(car.vx);
    var totalFx = ef.fx + er.fx - drag * F1.util.sign(car.vx) - rolling;
    var totalFy = ef.fy + er.fy;

    var aLong = totalFx / mass;
    var aLat = totalFy / mass;
    car.longG = F1.util.damp(car.longG, aLong / G, 10, dt);
    car.latG = F1.util.damp(car.latG, aLat / G, 10, dt);

    car.vx += (aLong + car.r * car.vl) * dt;
    car.vl += (aLat - car.r * car.vx) * dt;

    var yawMoment = spec.a * ef.fy * Math.cos(car.steer) - spec.b * er.fy;
    // aero yaw damping keeps the car stable in a straight line at speed
    yawMoment -= car.r * (q * 0.9 + 2400);
    var rDot = yawMoment / spec.inertia;
    car.r += rDot * dt;

    // low-speed cleanup: stop creeping forever
    if (Math.abs(car.vx) < 0.35 && throttleIn < 0.05 && brakeIn < 0.05) {
      car.vx = 0; car.vl = 0; car.r *= 0.85;
    }
    if (Math.abs(car.vx) < 1.2) {
      car.vl *= 0.92;
      car.r *= 0.90;
    }

    /* ---------------- 11. move ---------------- */
    car.heading = F1.util.wrapAngle(car.heading + car.r * dt);
    var fwdX = Math.sin(car.heading), fwdZ = Math.cos(car.heading);
    var latX = Math.cos(car.heading), latZ = -Math.sin(car.heading);
    car.x += (car.vx * fwdX + car.vl * latX) * dt;
    car.z += (car.vx * fwdZ + car.vl * latZ) * dt;

    /* ---------------- 12. walls ---------------- */
    // barriers sit 2.2 m beyond the white line (world/environment.js), so the
    // engine has to use the same distance or the car would drive through them
    var wallOff = env.wallOffset === undefined
      ? (at.width ? at.width * 0.5 + 2.2 : 11)
      : env.wallOffset;
    car.wallContact = Math.max(0, car.wallContact - dt * 2);
    var limit = wallOff - 0.85;
    if (Math.abs(pr.lateral) > limit) {
      var sgn = F1.util.sign(pr.lateral);
      var nwx = track.nx[pr.idx] * sgn, nwz = track.nz[pr.idx] * sgn;   // outward
      var push = Math.abs(pr.lateral) - limit;
      car.x -= nwx * push;
      car.z -= nwz * push;
      // world velocity, reflect the outward component, convert back
      var wvx = car.vx * fwdX + car.vl * latX;
      var wvz = car.vx * fwdZ + car.vl * latZ;
      var vOut = wvx * nwx + wvz * nwz;
      var impactSpeed = Math.abs(vOut);
      car.vx *= 0.995;                     // scraping the barrier costs speed
      car.vl *= 0.97;
      if (vOut > 0) {
        var impact = impactSpeed;
        wvx -= nwx * vOut * 1.35;          // 0.35 restitution
        wvz -= nwz * vOut * 1.35;
        car.vx = wvx * fwdX + wvz * fwdZ;
        car.vl = wvx * latX + wvz * latZ;
        car.r *= 0.5;
        car.wallContact = Math.min(1, impact / 14);
        if (impact > 3.0) {
          var dmg = clamp((impact - 3.0) / 26, 0, 0.8);
          // the leading end of the car takes the hit
          if (car.vx >= 0) car.damage.frontWing = clamp(car.damage.frontWing + dmg * 0.75, 0, 1);
          else car.damage.rearWing = clamp(car.damage.rearWing + dmg * 0.75, 0, 1);
          car.damage.suspension = clamp(car.damage.suspension + dmg * 0.35, 0, 1);
          if (impact > 16) car.damage.engine = clamp(car.damage.engine + dmg * 0.2, 0, 1);
          car.lastImpact = impact;
        }
      }
    }

    /* ---------------- 13. tyres, fuel, damage ---------------- */
    // velocity across the contact patch: lateral slide + wheelspin/traction slip
    var slipVelF = Math.abs(car.vl + spec.a * car.r) + Math.abs(car.vx * car.wheelSpin * 0.4);
    var slipVelR = Math.abs(car.vl - spec.b * car.r) + Math.abs(car.vx * car.wheelSpin);
    // slip power in the contact patch is what heats and wears a tyre
    var powerF = Math.abs(ef.fy) * slipVelF + Math.abs(ef.fx) * Math.abs(car.vx) * 0.006;
    var powerR = Math.abs(er.fy) * slipVelR + Math.abs(er.fx) * Math.abs(car.vx) * 0.006;
    // only sliding rubber wears the tyre; straight-line rolling barely does
    var wearF = Math.abs(ef.fy) * slipVelF;
    var wearR = Math.abs(er.fy) * slipVelR + Math.abs(er.fx) * Math.abs(car.vx * car.wheelSpin);
    var scrubPower = surfDef.rough * speedAbs * 700;      // W sliding on grass/gravel
    var ambient = env.ambientC === undefined ? 24 : env.ambientC;
    var effF = { slipPower: powerF, wearPower: wearF, brake: brakeIn, speed: speedAbs, load: FzF * 0.5 };
    var effR = { slipPower: powerR, wearPower: wearR, brake: brakeIn * 0.6, speed: speedAbs, load: FzR * 0.5 };
    if (scrubPower > 1) {
      effF.slipPower += scrubPower; effF.wearPower += scrubPower * 1.4;
      effR.slipPower += scrubPower; effR.wearPower += scrubPower * 1.4;
    }
    F1.tyres.step(car.tyres.fl, effF, dt, ambient);
    F1.tyres.step(car.tyres.fr, effF, dt, ambient);
    F1.tyres.step(car.tyres.rl, effR, dt, ambient);
    F1.tyres.step(car.tyres.rr, effR, dt, ambient);

    car.fuel = Math.max(0, car.fuel - throttleIn * spec.fuelBurn * dt);
    car.brakeGlow = F1.util.damp(car.brakeGlow, brakeIn * 0.85 + (assists.abs ? 0 : 0), 6, dt);

    // brake temperatures for the HUD (fronts run hotter)
    car.brakeTempF = F1.util.damp(car.brakeTempF || 320, 320 + brakeIn * 680 + speedAbs * 1.4, 1.6, dt);
    car.brakeTempR = F1.util.damp(car.brakeTempR || 300, 300 + brakeIn * 480 + speedAbs * 1.0, 1.3, dt);

    // off-track time (used for track limits in Section 4)
    if (edge > 0.6 && speedAbs > 5) car.offTrackTime += dt;
    else car.offTrackTime = Math.max(0, car.offTrackTime - dt * 2);

    car.slipRatio = clamp(Math.hypot(car.vl, car.vx * car.wheelSpin) / Math.max(speedAbs, 2), 0, 1);

    if (env.debug) {
      car._dbg = {
        FzF: FzF, FzR: FzR, muf: muf, mur: mur, capF: capF, capR: capR,
        fyF: ef.fy, fyR: er.fy, fxF: ef.fx, fxR: er.fx,
        alphaF: alphaF, alphaR: alphaR, downforce: downforce, drag: drag,
        cdf: cdA, clA: clA, aLong: aLong, aLat: aLat
      };
    }
  }

  /* Slow circuits need shorter gearing feel: auto shift points drop a little. */
  function circuitIsSlow(car) { return (car.trackWidth || 12) < 12.5; }

  /* ------------------------------------------------------------------ */
  /* helpers                                                            */
  /* ------------------------------------------------------------------ */
  function resetToTrack(car, track, s, lateral) {
    lateral = lateral || 0;
    var p = track.offsetPoint(s === undefined ? car.s : s, lateral, {});
    car.x = p.x; car.z = p.z; car.y = p.y;
    car.heading = p.heading;
    car.vx = 0; car.vl = 0; car.r = 0;
    car.steer = 0; car.gear = 1; car.rpm = car.spec.idleRpm;
    car.lastIdx = track.indexAt(s === undefined ? car.s : s);
    car.wheelSpin = 0;
  }

  function speedKmh(car) { return Math.abs(car.vx) * 3.6; }

  F1.vehicle = {
    DEFAULTS: DEFAULTS,
    specFor: specFor,
    create: create,
    step: step,
    resetToTrack: resetToTrack,
    speedKmh: speedKmh,
    torqueAt: torqueAt
  };
})(window.F1 = window.F1 || {});
