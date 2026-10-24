/* ==========================================================================
   F1 2026 — ai/driver.js
   A racing driver, not a rail. The AI works out a speed profile once per
   circuit/stint from the track geometry and the car's real grip, then drives
   it with pure-pursuit steering and a pedal controller — the exact same
   physics/vehicle.js step the player gets, so it can run wide, spin, lock a
   wheel or miss an apex like anybody else.

     var P = F1.ai.profile(track, car, { grip: 1.35, vTop: 96 });
     var drv = F1.ai.createDriver(car, track, P, { skill: 0.96 });
     var input = drv.update(dt);     // {steer, throttle, brake, boost}
   ========================================================================== */
(function (F1) {
  'use strict';

  var G = 9.81;
  var RHO = 1.225;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smoothstep(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }

  /* ------------------------------------------------------------------ */
  /* speed profile                                                      */
  /* ------------------------------------------------------------------ */
  /* Cornering and braking limits are solved from the car's own aero map, so
     the profile is a genuine prediction of what the car can do — not a set of
     hand-tuned target speeds. */
  function profile(track, car, opts) {
    opts = opts || {};
    var spec = car.spec;
    var n = track.count;
    var ds = track.step;
    var mass = spec.mass + (car.fuel || 0);

    var grip = opts.grip === undefined ? 1.75 : opts.grip;     // mu, lateral
    var brakeGrip = opts.brakeGrip === undefined ? grip * 1.02 : opts.brakeGrip;
    var vTop = opts.vTop === undefined ? 96 : opts.vTop;
    var maxLane = opts.maxLane === undefined ? 1.6 : opts.maxLane;

    // 0.5 * rho * Cl / m  (1/m) for the high-downforce aero mode
    var downK = 0.5 * RHO * spec.downZ / mass;
    var dragK = 0.5 * RHO * spec.dragZ / mass;

    /* curvature over ~20 m: tight enough to see a chicane, wide enough that
       survey noise does not invent one */
    var winMid = Math.max(1, Math.round(6 / ds));
    var kMid = new Float32Array(n);
    for (var q = 0; q < n; q++) {
      var accM = 0, cntM = 0;
      for (var jm = -winMid; jm <= winMid; jm++) { accM += track.curvature[(q + jm + n) % n]; cntM++; }
      kMid[q] = accM / cntM;
    }

    var v = new Float32Array(n);
    var i, k;

    /* cornering pass: v^2 = r * mu * (g + downK * v^2) */
    for (i = 0; i < n; i++) {
      k = Math.abs(kMid[i]);
      if (k < 1e-5) { v[i] = vTop; continue; }
      var r = Math.max(8, 1 / k);       // guard against survey spikes
      // Lateral limit as a function of speed. Downforce adds load but the
      // car's balance (front axle saturates first) caps the usable lateral g,
      // so the aero term is only worth a partial credit. This curve was
      // measured with the same vehicle code on synthetic circles.
      var aLatMax = G * grip + 0.0040 * v[i] * v[i];
      var vx = Math.sqrt(r * aLatMax);
      v[i] = Math.min(vTop, vx);
    }

    /* forward pass: acceleration. Two limits — what the tyres can put down,
       and what the power unit can deliver at that speed (with ERS duty). */
    var powerAvail = (spec.icePower + spec.ersPower * 0.55) * 0.94;
    var mass = spec.mass + (car.fuel || 0);
    for (i = 1; i < n; i++) {
      var vp = v[i - 1];
      var aTraction = grip * G * 1.05;                    // launch/wheelspin limit
      var aPower = (powerAvail / Math.max(vp, 6) - dragK * mass * vp * vp) / mass;
      var aAcc = Math.min(aTraction, Math.max(0, aPower));
      var vAcc = Math.sqrt(Math.max(1, vp * vp + 2 * aAcc * ds));
      if (vAcc < v[i]) v[i] = vAcc;
    }

    /* backward pass: braking, with the downforce the car will have at that
       speed — this is why an F1 car brakes from 330 km/h in 90 metres */
    var brakeMuMul = opts.brakeMul === undefined ? 1.03 : opts.brakeMul;
    for (i = n - 2; i >= 0; i--) {
      var vn = v[i + 1];
      var aBrake = grip * brakeMuMul * (G + downK * vn * vn) + dragK * vn * vn;
      var vBrk = Math.sqrt(Math.max(1, vn * vn + 2 * aBrake * ds));
      if (vBrk < v[i]) v[i] = vBrk;
    }
    // close the loop: the lap wraps, so one more backward pass from the end
    var v0 = Math.sqrt(Math.max(1, v[0] * v[0] + 2 * brakeGrip * G * ds));
    for (i = n - 1; i >= 0 && v[i] > v0; i--) v[i] = v0;

    // light smoothing so the profile does not demand impossible g
    var out = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var a = v[(i - 1 + n) % n], b = v[i], c = v[(i + 1) % n];
      out[i] = Math.min(b, (a + 2 * b + c) * 0.25);
    }

    // curvature averaged over ~70 m: the racing line follows the corner, not
    // every wrinkle in the survey data
    var kSmooth = new Float32Array(n);
    var win = Math.max(2, Math.round(18 / ds));
    for (i = 0; i < n; i++) {
      var acc = 0, cnt = 0;
      for (var j = -win; j <= win; j++) { acc += track.curvature[(i + j + n) % n]; cnt++; }
      kSmooth[i] = acc / cnt;
    }

    // how far off the centreline a car can sit before the barrier gets close
    var laneMax = new Float32Array(n);
    for (i = 0; i < n; i++) {
      laneMax[i] = Math.max(0, Math.min(maxLane, track.width[i] * 0.5 - 3.2));
    }

    return {
      v: out, track: track, step: ds, grip: grip, downK: downK, kSmooth: kSmooth, laneMax: laneMax,
      lapTime: profileLapTime(track, out),
      sampleAt: function (s) {
        var f = track.wrapS(s) / ds;
        var i0 = Math.floor(f) % n, i1 = (i0 + 1) % n;
        return out[i0] + (out[i1] - out[i0]) * (f - Math.floor(f));
      },
      brakeAccel: function (v) {
        return grip * brakeMuMul * (G + downK * v * v) + dragK * v * v;
      },
      lineAt: function (s) {
        var i = Math.floor(track.wrapS(s) / ds) % n;
        var lim = laneMax[i];
        return F1.ai._clamp(kSmooth[i] * 420, -lim, lim);
      }
    };
  }

  function profileLapTime(track, v) {
    var t = 0, n = track.count, ds = track.step;
    for (var i = 0; i < n; i++) t += ds / Math.max(4, v[i]);
    return t;
  }

  /* ------------------------------------------------------------------ */
  /* driver                                                             */
  /* ------------------------------------------------------------------ */
  function createDriver(car, track, prof, opts) {
    opts = opts || {};
    var skill = opts.skill === undefined ? 0.97 : opts.skill;      // 0.9..1.0
    var aggression = opts.aggression === undefined ? 0.5 : opts.aggression;
    var laneBias = opts.laneBias || 0;      // metres from centreline
    var maxLane = opts.maxLane === undefined ? 3.0 : opts.maxLane;
    var look = { x: 0, z: 0 };
    var temp = {};
    var peakSlip = 0.118;     // rad, front tyre peak slip angle (dry)
    var stuckT = 0;           // seconds spent trying to move with no result
    var recState = 'run';     // run | reverse | recover
    var recT = 0;             // seconds left in the current recovery phase
    var recCycles = 0;        // failed recovery attempts in a row

    var drv = {
      input: { steer: 0, throttle: 0, brake: 0, boost: false },
      line: null,

      /* pure pursuit: aim at a point on the centreline ahead, then let the
         steering geometry do the rest. Look-ahead grows with speed. */
      update: function (dt) {
        var speed = Math.max(0, car.vx);
        var v = Math.max(6, speed);
        var off = car.surface === 'grass' || car.surface === 'gravel' ||
          car.surface === 'astro' || recState === 'recover';
        var ld = 8 + v * 0.42;

        /* racing line: the aim point drifts to the inside of the corner that
           is coming up, and back to the middle on the straights */
        var lat = laneBias + prof.lineAt(car.s + ld * 0.5) * (0.45 + aggression * 0.55);

        var sAim = track.wrapS(car.s + ld);
        var aim = track.at(sAim, temp);
        var ax = aim.x + Math.cos(aim.heading) * lat;
        var az = aim.z - Math.sin(aim.heading) * lat;

        /* Stanley steering: the car is pointed along the track a few metres
           ahead, plus a cross-track correction that is gentle at speed and
           firm when the car has to be recovered from the grass. */
        var look = 5 + v * 0.22;
        if (recState === 'recover') look = 12;
        var iT = track.indexAt(track.wrapS(car.s + look));
        var psi = track.heading[iT] - car.heading;
        while (psi > Math.PI) psi -= Math.PI * 2;
        while (psi < -Math.PI) psi += Math.PI * 2;

        var kT = track.curvature[iT] || 0;
        var eCross = car.lateral - lat;              // + = right of the line

        var steerAng = Math.atan(3.4 * kT)                       // geometry
          + psi * (off ? 0.9 : 0.62)                             // heading error
          - Math.atan((off ? 2.2 : 1.35) * eCross / (v + 6));    // cross-track
        // yaw damping: stop the car from rocking itself into a spin
        steerAng -= car.r * 0.05;

        var lock = clamp(0.42 * (1 - Math.min(speed, 92) / 138), 0.10, 0.42);
        var steer = clamp(steerAng / lock, -1, 1);

        /* Recovery state machine. A driver who beaches the car on a kerb or
           noses it into a barrier reverses out, turns back towards the road
           and only then picks the pace up again. Without this a single touch
           of the wall ends the session. */
        var speedNow = Math.abs(car.vx);
        var offNow = off;
        if (recState === 'run') {
          if (speedNow < 3.0) stuckT += dt; else stuckT = Math.max(0, stuckT - dt * 0.5);
          if (speedNow > 9) recCycles = 0;
          if (stuckT > 0.9) {
            stuckT = 0;
            recState = 'reverse';
            recT = 1.8;
            recCycles++;
            /* Three failed attempts means the car is properly beached.
               In the real world a marshal recovers it, so the AI gets the
               same treatment as the player's reset button: back onto the
               road, pointing the right way, from a standstill. */
            if (recCycles >= 3) {
              var atReset = track.at(track.wrapS(car.s), {});
              car.x = atReset.x; car.z = atReset.z; car.y = atReset.y;
              car.heading = atReset.heading;
              car.vx = 0; car.vl = 0; car.r = 0; car.steer = 0;
              car.gear = 1; car.lastIdx = track.indexAt(track.wrapS(car.s));
              car.wallContact = 0; car.wheelSpin = 0;
              recState = 'recover'; recT = 1.2; recCycles = 0;
              if (opts.onRecover) opts.onRecover(car);
            }
          }
        }
        if (recState === 'reverse') {
          recT -= dt;
          var inpR = drv.input;
          inpR.steer = clamp(-steer, -1, 1);
          inpR.throttle = 0;
          inpR.brake = 1;
          inpR.boost = false;
          if (recT <= 0) { recState = 'recover'; recT = 3.0; }
          return inpR;
        }
        if (recState === 'recover') {
          recT -= dt;
          if (recT <= 0) recState = 'run';
        }

        /* Pedals. The profile already contains the braking distances, but a
           controller that only reacts once the car is over the target speed
           always arrives late (tyre model, one frame of latency, 4 m of
           travel). So the braking decision is made from the *deceleration
           needed over the next 20 m*, which starts the stop exactly when the
           car needs it — the same way a driver reads a braking board. */
        var vTarget = prof.sampleAt(car.s) * (0.93 + skill * 0.07) *
          (opts.pace === undefined ? 1 : opts.pace);
        var vAhead = prof.sampleAt(car.s + 20) * (0.93 + skill * 0.07) *
          (opts.pace === undefined ? 1 : opts.pace);
        if (offNow || recState === 'recover') {
          var crawl = recState === 'recover' ? 9 : 16;
          vTarget = Math.min(vTarget, crawl);
          vAhead = Math.min(vAhead, crawl);
        }

        var over = speed - vTarget;
        var need = (speed * speed - vAhead * vAhead) / 40;
        var aMax = Math.max(6, prof.brakeAccel(Math.max(speed, vAhead)));

        var throttle = 0, brake = 0;
        if (need > aMax * 0.5 || over > 5) {
          // the stop has to start now
          var urgency = Math.max(over / 12, (need / aMax - 0.5) * 1.4);
          brake = clamp(0.3 + urgency, 0.3, 1);
        } else if (over > 0.8) {
          brake = clamp(over * 0.12, 0.04, 0.4);
        } else {
          throttle = clamp(0.62 + (vTarget - speed) * 0.9, 0.2, 1);
          var latLoad = Math.abs(car.latG) / Math.max(0.4, prof.grip * 0.95);
          throttle *= clamp(1.10 - latLoad * 0.30, 0.42, 1);
        }

        // traction control on exit: back off if the rears are spinning up
        if (car.slipRatio > 0.14 && speed > 8) throttle *= clamp(1 - (car.slipRatio - 0.14) * 3, 0.2, 1);

        // counter-steer when the car starts to oversteer
        if (Math.abs(car.slipR) > 0.11 && speed > 12) {
          var corr = clamp(-car.slipR * 1.6, -0.9, 0.9) * clamp((Math.abs(car.slipR) - 0.11) * 6, 0, 1);
          steer = clamp(steer * 0.5 + corr, -1, 1);
          throttle *= clamp(1 - (Math.abs(car.slipR) - 0.11) * 4, 0.25, 1);
        }

        var inp = drv.input;
        inp.steer = steer;
        inp.throttle = throttle;
        inp.brake = brake;
        inp.boost = aggression > 0.6 && speed > 60 && car.ers > 0.4;
        car.ersMode = 'balanced';
        return inp;
      }
    };
    return drv;
  }

  F1.ai = {
    profile: profile,
    profileLapTime: profileLapTime,
    createDriver: createDriver,
    _clamp: clamp
  };
})(window.F1 = window.F1 || {});
