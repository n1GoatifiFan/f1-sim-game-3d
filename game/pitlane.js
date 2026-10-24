/* ==========================================================================
   F1 2026 — game/pitlane.js
   The pit lane: geometry, the 80 km/h limiter, the stop itself, and a runner
   that moves a car along the lane while the normal physics is bypassed.

   The car is driven kinematically along a path offset from the centreline.
   That sounds like cheating, but the alternative (a second collision world
   for the pit wall) buys nothing: the pit lane is a corridor, and a corridor
   is exactly what a path is.

     var pit = F1.pitlane.build(track);
     var run = F1.pitlane.runner(track, pit, car, {stopTime: 2.6});
     run.update(dt);            // 'entry' | 'box' | 'exit' | 'done'
     run.atBox                  // true while the crew is working
     F1.pitlane.fit(run, car)   // true when the stop is ready to apply
   ========================================================================== */
(function (F1) {
  'use strict';

  var PIT_LIMIT = 80 / 3.6;     // m/s (80 km/h)
  var PATH_LEN_FRAC = 0.068;    // fraction of the lap spent in the pit lane

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ================================================================== */
  /* geometry                                                           */
  /* ================================================================== */
  function build(track) {
    var entryFrac = (track.pit && track.pit.entry) || 0.955;
    var span = PATH_LEN_FRAC * track.length;
    var samples = Math.max(24, Math.round(span / 9));
    var pts = [];
    var at = {};

    for (var i = 0; i <= samples; i++) {
      var t = i / samples;
      var s = entryFrac * track.length + t * span;
      track.at(track.wrapS(s), at);
      var idx = track.indexAt(track.wrapS(s));
      var halfW = track.width[idx] * 0.5;
      // swing out of the racing line into the lane, sit in it, then blend back
      var ramp = Math.min(1, Math.min(t * 5.5, (1 - t) * 5.5));
      var lateral = -(halfW + 3.0 + ramp * 7.0);
      pts.push({
        s: track.wrapS(s),
        rawS: s,
        lateral: lateral,
        x: at.x + Math.cos(at.heading) * lateral,
        z: at.z - Math.sin(at.heading) * lateral,
        y: at.y,
        heading: at.heading,
        t: t
      });
    }

    // cumulative distance along the lane, for a constant-speed run
    var dist = [0];
    for (i = 1; i < pts.length; i++) {
      var dx = pts[i].x - pts[i - 1].x, dz = pts[i].z - pts[i - 1].z;
      dist.push(dist[i - 1] + Math.sqrt(dx * dx + dz * dz));
    }

    var boxAt = 0.42;           // fraction along the lane where the box sits
    return {
      points: pts,
      dist: dist,
      length: dist[dist.length - 1],
      entryFrac: entryFrac,
      exitFrac: track.wrapS(entryFrac * track.length + span) / track.length,
      boxDist: dist[dist.length - 1] * boxAt,
      boxT: boxAt,
      /** is this track position close enough to the lane to dive in? */
      inWindow: function (s) {
        var d = s - entryFrac * track.length;
        if (d < -track.length * 0.5) d += track.length;
        return d > -35 && d < 45;
      },
      /** world position at a distance along the lane */
      at: function (d, out) {
        d = clamp(d, 0, dist[dist.length - 1]);
        var lo = 0, hi = dist.length - 1;
        while (hi - lo > 1) {
          var mid = (lo + hi) >> 1;
          if (dist[mid] <= d) lo = mid; else hi = mid;
        }
        var span2 = Math.max(1e-4, dist[hi] - dist[lo]);
        var f = (d - dist[lo]) / span2;
        var a = pts[lo], b = pts[hi];
        out = out || {};
        out.x = a.x + (b.x - a.x) * f;
        out.y = a.y + (b.y - a.y) * f;
        out.z = a.z + (b.z - a.z) * f;
        var dh = b.heading - a.heading;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        out.heading = a.heading + dh * f;
        out.s = a.s + ((b.s - a.s + track.length) % track.length) * f;
        out.lateral = a.lateral + (b.lateral - a.lateral) * f;
        return out;
      }
    };
  }

  /* ================================================================== */
  /* runner                                                             */
  /* ================================================================== */
  function runner(track, lane, car, opts) {
    opts = opts || {};
    var stopTime = opts.stopTime === undefined ? 2.4 : opts.stopTime;
    var phase = 'entry';
    var d = 0;
    var speed = Math.min(Math.abs(car.vx), PIT_LIMIT);
    var stoppedFor = 0;
    var out = {};
    var boxHold = 0;

    // start from wherever the car crossed the line into the lane
    lane.at(0, out);
    var dx = car.x - out.x, dz = car.z - out.z;
    var blend = Math.sqrt(dx * dx + dz * dz);

    var api = {
      phase: phase,
      atBox: false,
      done: false,
      stopLeft: 0,
      get speed() { return speed; },
      get progress() { return d / lane.length; },

      /* the stop is complete: fit fresh tyres + fuel */
      serve: function (compound, fuelLitres) {
        var c = compound || car.compound;
        car.compound = c;
        ['fl', 'fr', 'rl', 'rr'].forEach(function (k) {
          car.tyres[k] = F1.tyres.create(c, { tempC: 68, wear: 0 });
        });
        if (fuelLitres) car.fuel = Math.min(car.spec.fuelDefault, car.fuel + fuelLitres);
        car.damage.frontWing = Math.max(0, car.damage.frontWing - 0.6);
        car.damage.rearWing = Math.max(0, car.damage.rearWing - 0.5);
        car.damage.floor = Math.max(0, car.damage.floor - 0.4);
        car.wallContact = 0;
      },

      /* push the car along the lane; returns the phase after this frame */
      update: function (dt) {
        if (api.done) return 'done';
        // accelerate up to the limiter and slow for the box
        var target = PIT_LIMIT;
        if (phase === 'entry' && d > lane.boxDist - 55) target = 16;      // brake for the box
        if (phase === 'box') target = 0;
        if (phase === 'exit' && d > lane.length - 40) target = PIT_LIMIT;
        speed += clamp(target - speed, -9 * dt * 2.2, 6.5 * dt * 2.2);
        speed = clamp(speed, 0, PIT_LIMIT);

        if (phase === 'entry' && d >= lane.boxDist) {
          phase = 'box';
          d = lane.boxDist;
          speed = 0;
          api.atBox = true;
          api.stopLeft = stopTime;
        }

        if (phase === 'box') {
          api.stopLeft -= dt;
          if (api.stopLeft <= 0) {
            phase = 'exit';
            api.atBox = false;
            speed = 4;
          }
        } else {
          d += speed * dt;
          if (phase === 'entry') boxHold += dt;
        }

        if (d >= lane.length) {
          d = lane.length;
          phase = 'done';
          api.done = true;
        }

        lane.at(d, out);
        // ease the car onto the lane over the first 12 m of the entry
        var k = 1;
        if (phase === 'entry' && d < 14 && blend > 0.2) {
          k = clamp(d / 14, 0, 1);
          car.x = car.x + (out.x - car.x) * k;
          car.z = car.z + (out.z - car.z) * k;
          car.y = out.y;
        } else {
          car.x = out.x; car.z = out.z; car.y = out.y;
        }
        car.heading = out.heading;
        car.vx = speed;
        car.vl = 0; car.r = 0; car.steer = 0;
        car.s = out.s;
        car.lateral = out.lateral;
        car.lastIdx = track.indexAt(out.s);
        car.surface = 'asphalt';
        car.edge = 0;
        car.throttle = phase === 'box' ? 0 : 0.35;
        car.brake = 0;
        car.gear = speed < 12 ? 1 : 2;
        car.rpm = car.spec.idleRpm + speed * 320;
        car.wallContact = 0;
        car.inPit = phase !== 'done';
        api.phase = phase;
        return phase;
      }
    };
    return api;
  }

  F1.pitlane = {
    build: build,
    runner: runner,
    LIMIT: PIT_LIMIT,
    PATH_LEN_FRAC: PATH_LEN_FRAC
  };
})(window.F1 = window.F1 || {});
