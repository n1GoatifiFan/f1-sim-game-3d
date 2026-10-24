/* ==========================================================================
   F1 2026 — game/field.js
   The other cars on the grid.

   Every opponent is a real F1.vehicle with the player's tyre model, power
   unit and barrier contact. The AI (ai/driver.js) only decides pedals and
   steering, so there is no grip cheating anywhere in the field.

     var field = F1.field.create(track, world, {
       playerId: 'norris',        // that seat is left empty for the player
       startS: track.length - 14, // pole position for the player
       pace: 1.0,                 // global difficulty multiplier
       compound: 'medium'
     });
     field.update(dt);           // steps 1/120 s, same clock as the session
     field.render(alpha);        // interpolated mesh positions
     field.standings(playerRow); // classification incl. the player
     field.dispose();

   Classification: laps first, then distance travelled since the line. Gaps
   are metres behind the leader (the HUD converts to time).
   ========================================================================== */
(function (F1) {
  'use strict';

  var STEP = (F1.session && F1.session.STEP) || 1 / 120;
  var GRID = 14;                // metres from the line to pole
  var MAX_RECOVERIES = 3;       // failed attempts before a marshal reset

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function sign(v) { return v < 0 ? -1 : 1; }

  /* championship-style grid order: team performance first, then the driver's
     own rating, then a stable per-weekend shuffle for the midfield */
  function buildGrid(seed) {
    var rnd = F1.rng(F1.rng.string(seed || 'grid'));
    var seats = [];
    F1.DATA.teams.forEach(function (team) {
      (team.drivers || []).forEach(function (id) {
        var d = F1.DATA.getDriver(id);
        var perf = (team.performance.power + team.performance.aero + team.performance.chassis) / 3;
        seats.push({
          teamId: team.id,
          driverId: id,
          team: team,
          driver: d,
          overall: F1.DATA.driverOverall(d),
          score: perf * 0.74 + F1.DATA.driverOverall(d) * 0.26 + (rnd() - 0.5) * 2.2
        });
      });
    });
    seats.sort(function (a, b) { return b.score - a.score; });
    return seats;
  }

  /* ------------------------------------------------------------------ */
  /* the field                                                          */
  /* ------------------------------------------------------------------ */
  /* grid slot geometry, shared with the session so the player lines up in a
     real slot rather than floating beside the field */
  function slotPos(track, startS, slot) {
    var row = Math.floor(slot / 2), col = slot % 2;
    return {
      s: track.wrapS(startS - 9 - row * 8.5),
      lateral: (col === 0 ? -2.3 : 2.3) * (row % 2 ? -1 : 1)
    };
  }

  F1.field = {
    STEP: STEP,
    buildGrid: buildGrid,
    slotPos: slotPos,
    DIFFICULTY: { rookie: 0.55, balanced: 0.8, pro: 1.0, legend: 1.16, custom: 0.9 },

    create: function (track, world, opts) {
      opts = opts || {};
      var playerId = opts.playerId || null;
      var pace = opts.pace === undefined ? 1.0 : opts.pace;
      var seats;
      if (opts.order && opts.order.length) {
        // an explicit grid (qualifying result) wins over the rating order
        seats = opts.order.map(function (id) {
          var d = F1.DATA.getDriver(id);
          var team = F1.DATA.getTeam(d.team);
          var perf = (team.performance.power + team.performance.aero + team.performance.chassis) / 3;
          return {
            teamId: team.id, driverId: id, team: team, driver: d,
            overall: F1.DATA.driverOverall(d), score: perf
          };
        });
      } else {
        seats = (opts.seats || buildGrid(track.id + '|' + (opts.seed || 'r1')));
      }
      var aiSeats = seats.filter(function (s) { return s.driverId !== playerId; });
      var startS = opts.startS === undefined ? track.length - GRID : opts.startS;
      var cars = [];
      var byDriver = {};
      var pit = F1.pitlane ? F1.pitlane.build(track) : null;
      var cond = {
        wetness: opts.wetness || 0,
        ambientC: opts.ambientC === undefined ? 22 : opts.ambientC
      };
      var rnd = F1.rng(F1.rng.string((track.id || 'track') + '|field'));

      /* difficulty: pace scales the target speed of every AI driver, and the
         spread keeps a 0.4 s/lap gap between neighbours in the same car */
      var diff = opts.difficulty === undefined ? 1 : opts.difficulty;
      var paceMul = pace * (0.982 + 0.018 * clamp(diff, 0, 1.2));

      var playerSlot = opts.playerSlot === undefined ? 0 : opts.playerSlot;
      var nextSlot = 0;
      aiSeats.forEach(function (seat, i) {
        if (nextSlot === playerSlot) nextSlot++;
        var mySlot = nextSlot++;
        var slot = slotPos(track, startS, mySlot);
        var s = slot.s, lateral = slot.lateral;
        var spec = F1.vehicle.specFor(seat.teamId, seat.driverId);
        var car = F1.vehicle.create(track, spec, {
          startS: s, lateral: lateral,
          compound: opts.compound || 'medium',
          fuel: opts.fuel === undefined ? spec.fuelDefault : opts.fuel,
          assists: { abs: 1, tractionControl: 1 },
          tyreTempC: 62
        });

        var prof = F1.ai.profile(track, car, {});
        var skill = 0.945 + (seat.overall - 82) * 0.0032 + (rnd() - 0.5) * 0.014;
        var driver = F1.ai.createDriver(car, track, prof, {
          skill: clamp(skill, 0.905, 0.995),
          pace: paceMul,
          aggression: 0.3 + rnd() * 0.5,
          laneBias: (rnd() - 0.5) * 0.5,
          maxLane: 2.2,
          onRecover: function () { recovered++; }
        });

        var mesh = F1.buildCar({ teamId: seat.teamId, driverId: seat.driverId, lod: 1 });
        mesh.traverse(function (o) {
          if (o.isMesh && o.material) {
            o.castShadow = false;
            o.receiveShadow = false;
          }
        });
        mesh.position.set(car.x - track.origin.x, car.y, car.z - track.origin.z);
        mesh.rotation.y = car.heading + Math.PI;
        world.group.add(mesh);

        var entry = {
          id: seat.driverId,
          teamId: seat.teamId,
          seat: seat,
          car: car,
          driver: driver,
          profile: prof,
          mesh: mesh,
          wheels: (mesh.userData.wheels || []),
          prev: { x: car.x, y: car.y, z: car.z, h: car.heading },
          spin: 0,
          laps: 0,
          lapStart: 0,
          lastLap: 0,
          bestLap: 0,
          lastCrossS: s,
          started: false,
          offTrack: 0,
          warnings: 0,
          penalties: 0,
          position: i + 1,
          retired: false,
          crashes: 0,
          isPlayer: false,
          slot: mySlot,
          pitRun: null,
          served: false,
          stops: 0,
          planStopLap: 0,
          raceLaps: opts.raceLaps || 0
        };
        cars.push(entry);
        byDriver[seat.driverId] = entry;
      });

      var recovered = 0;
      var time = 0;
      var messages = [];
      var lapsSinceStart = 0;

      function say(text) {
        messages.push({ t: time, text: text });
        if (messages.length > 60) messages.shift();
        F1.bus.emit('race-message', text);
      }

      /* ---------------- lap timing ---------------- */
      function crossLine(e) {
        var lap = time - e.lapStart;
        if (!e.started) {
          // the first crossing is the start of lap 1, not the end of one
          e.started = true;
          e.lapStart = time;
          return;
        }
        if (lap > 8 && lap < 900) {
          e.lastLap = lap;
          if (!e.bestLap || lap < e.bestLap) e.bestLap = lap;
        }
        e.lapStart = time;
        e.laps++;
        chooseStop(e);
      }

      /* ---------------- progress ---------------- */
      /* distance around the lap measured from the start line, so that cars
         on the grid (behind the line) have a small positive progress value */
      /* Distance from the start line, in metres. A car that has not yet
         crossed the line sits *behind* it, so its progress is negative:
         without that, a full grid behind the line would look a lap ahead of
         the leader for the first few seconds of the race. */
      function progressOf(car, laps, started) {
        if (started === false) return car.s - track.length;
        return laps * track.length + car.s;
      }

      function rowOf(e) {
        return {
          pos: e.position,
          id: e.id,
          teamId: e.teamId,
          code: (e.seat.driver.code || '').slice(0, 3),
          name: e.seat.driver.name,
          laps: e.laps,
          gap: 0,
          lastLap: e.lastLap,
          bestLap: e.bestLap,
          penalty: e.penalties,
          retired: !!e.retired,
          me: !!e.isPlayer
        };
      }

      function standings(playerRow) {
        var rows = cars.map(function (e) {
          // a retired car is classified behind every car still running
          var p = progressOf(e.car, e.laps, e.started);
          return { e: e, p: e.retired ? p - track.length * 100 : p };
        });
        if (playerRow) {
          rows.push({
            e: playerRow,
            p: progressOf(playerRow.car, playerRow.laps, playerRow.started)
          });
        }
        rows.sort(function (a, b) { return b.p - a.p; });
        var leadP = rows.length ? rows[0].p : 0;
        rows.forEach(function (r, i) {
          r.e.position = i + 1;
          r.e._gap = leadP - r.p;
        });
        return rows.map(function (r) {
          var row = rowOf(r.e);
          row.gap = r.e._gap;
          row.pos = r.e.position;
          return row;
        });
      }

      /* ---------------- traffic ---------------- */
      /* For every car find the nearest opponent ahead within 60 m and tell
         the driver about it. Cars in a different lane are only a problem
         once they are close, so the gap is weighted by lateral separation. */
      var order = [];
      function traffic() {
        order.length = 0;
        for (var i = 0; i < cars.length; i++) order.push(cars[i]);
        order.sort(function (a, b) { return a.car.s - b.car.s; });
        for (i = 0; i < cars.length; i++) {
          var a = cars[i].car;
          var best = Infinity, side = 0, leadV = 0;
          for (var j = 0; j < cars.length; j++) {
            if (i === j) continue;
            var b = cars[j].car;
            var ds = b.s - a.s;
            if (ds <= 0) ds += track.length;
            if (ds > 55) continue;
            var dl = b.lateral - a.lateral;
            if (Math.abs(dl) > 2.1) continue;      // clearly side by side
            if (ds < best) {
              best = ds;
              // aim for the half of the road the other car is not using
              side = a.lateral > b.lateral ? 1.5 : -1.5;
              leadV = b.vx;
            }
          }
          cars[i].driver.setTraffic(best, best < 45 ? side : 0, leadV);
        }
      }

      /* ---------------- pit strategy ---------------- */
      /* The default race is a handful of laps, so a scheduled stop only makes
         sense over a longer run. Tyre wear can still force one at any time:
         a soft that is cooked is slower than a hard that is not. */
      function chooseStop(e) {
        if (!(e.raceLaps >= 8) || e.planStopLap) return;
        var window0 = Math.max(2, Math.round(e.raceLaps * 0.28));
        var window1 = Math.max(window0 + 1, Math.round(e.raceLaps * 0.72));
        e.planStopLap = window0 + Math.floor(rnd() * (window1 - window0));
      }

      function wantToStop(e) {
        if (e.pitRun || !pit) return false;
        if (e.planStopLap && e.laps >= e.planStopLap && e.stops < 1) return true;
        var wear = 0, n = 0;
        ['fl', 'fr', 'rl', 'rr'].forEach(function (k) { wear += e.car.tyres[k].wear; n++; });
        wear /= n;
        return wear > 0.72 && e.laps > 1 && e.raceLaps > e.laps + 1;
      }

      function startPit(e) {
        if (!pit || e.pitRun) return false;
        // a car that is not near the pit entry has to wait for the next lap
        if (!pit.inWindow(e.car.s)) return false;
        e.served = false;
        e.pitRun = F1.pitlane.runner(track, pit, e.car, { stopTime: 2.2 + rnd() * 0.8 });
        e.driver.debug.state = 'pit';
        return true;
      }

      /* ---------------- contact ---------------- */
      /* Two cars occupying the same piece of road: the one behind lifts and
         both get a small lateral shove. Positional, not momentum-based — at
         this scale it keeps the field tidy without a full 2D solver. */
      function separate() {
        var n = cars.length;
        for (var i = 0; i < n; i++) {
          for (var j = i + 1; j < n; j++) {
            var a = cars[i].car, b = cars[j].car;
            var ds = b.s - a.s;
            var len = track.length;
            if (ds > len * 0.5) ds -= len;
            if (ds < -len * 0.5) ds += len;
            if (Math.abs(ds) > 5.6) continue;
            var dl = b.lateral - a.lateral;
            if (Math.abs(dl) > 2.05) continue;
            var push = (2.05 - Math.abs(dl)) * 0.22;
            b.lateral += push * sign(dl || 1);
            a.lateral -= push * sign(dl || 1);
            if (Math.abs(ds) < 4.4) {
              var behind = ds > 0 ? cars[i] : cars[j];
              behind.car.vx *= 0.978;
            }
          }
        }
      }

      /* ---------------- the step ---------------- */
      var sub = 0;
      var frozen = false;
      function step(h) {
        if (frozen) return;
        time += h;
        for (var i = 0; i < cars.length; i++) {
          var e = cars[i];
          var p = e.prev, c = e.car;
          p.x = c.x; p.y = c.y; p.z = c.z; p.h = c.heading;

          if (e.retired) continue;
          if (e.car.wallContact > 0.9) e.crashes = (e.crashes || 0) + 1;
          if (e.crashes >= 3 || e.car.damage.suspension > 0.95 || e.car.damage.engine > 0.95) {
            /* out of the race: park it off the road and stop simulating it */
            e.retired = true;
            e.car.vx = 0; e.car.throttle = 0; e.car.brake = 1;
            e.mesh.visible = true;
            say((e.seat.driver.code || '') + ' — out of the race');
            continue;
          }
          if (e.pitRun) {
            e.pitRun.update(h);
            if (e.pitRun.atBox && !e.served) {
              e.served = true;
              e.pitRun.serve(e.stops === 0 ? pickCompound(e) : 'soft', 18);
              e.stops++;
            }
            if (e.pitRun.done) {
              e.pitRun = null;
              e.driver.debug.state = 'run';
            }
            e.spin -= (c.vx / 0.36) * h;
          } else {
            if (wantToStop(e)) startPit(e);
            var inp = e.driver.update(h);
            if (!e.pitRun) {
              F1.vehicle.step(c, inp, h, track, {
                assists: { abs: 1, tractionControl: 1 },
                ambientC: cond.ambientC,
                wetness: cond.wetness
              });
            } else {
              e.pitRun.update(h);
            }
            e.spin -= (c.vx / 0.36) * h;
          }

          if (c.s < e.lastCrossS - track.length * 0.5) crossLine(e);
          e.lastCrossS = c.s;

          // track limits: 2 s off the road in one go is a warning
          if (c.edge > 1.5) e.offTrack += h; else e.offTrack = Math.max(0, e.offTrack - h * 2);
          if (e.offTrack > 2.0) {
            e.offTrack = 0;
            e.warnings++;
            if (e.warnings % 3 === 0) e.penalties++;
            say((e.seat.driver.code || '??') + ' \u2014 track limits');
          }
        }
        // traffic every other physics substep is plenty (60 Hz of decisions)
        if ((sub++ & 1) === 0) { traffic(); separate(); }
      }

      function update(dt) {
        if (!(dt > 0)) return;
        var maxSteps = 8;
        var acc = dt;
        var n = 0;
        while (acc >= STEP && n < maxSteps) { step(STEP); acc -= STEP; n++; }
        if (n === maxSteps) {
          // drop the backlog rather than spiral; the field is decorative
          // compared with the player's own lap
        }
      }

      /* ---------------- render ---------------- */
      function render(alpha) {
        for (var i = 0; i < cars.length; i++) {
          var e = cars[i], c = e.car, p = e.prev;
          var x = p.x + (c.x - p.x) * alpha;
          var y = p.y + (c.y - p.y) * alpha;
          var z = p.z + (c.z - p.z) * alpha;
          var h = p.h + angDelta(p.h, c.heading) * alpha;
          e.mesh.position.set(x - track.origin.x, y, z - track.origin.z);
          var roll = clamp((c.latG || 0) * 0.035, -0.06, 0.06);
          e.mesh.rotation.set(0, h + Math.PI, roll, 'YXZ');
          for (var w = 0; w < e.wheels.length; w++) {
            var wh = e.wheels[w];
            if (wh.front) wh.node.rotation.y = c.steer;
            wh.spin.rotation.x = e.spin;
          }
        }
      }

      function angDelta(a, b) {
        var d = b - a;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return d;
      }

      /* ---------------- housekeeping ---------------- */
      function applyBurst(n) {
        // the whole field takes a fresh set of tyres in a safety-car window
        cars.forEach(function (e) {
          var k = e.car.compound;
          ['fl', 'fr', 'rl', 'rr'].forEach(function (id) {
            e.car.tyres[id] = F1.tyres.create(k, { tempC: 78 });
          });
        });
      }

      function dispose() {
        cars.forEach(function (e) {
          if (e.mesh.parent) e.mesh.parent.remove(e.mesh);
          if (e.mesh.userData.dispose) e.mesh.userData.dispose();
        });
        cars.length = 0;
      }

      function pickCompound(e) {
        var lapsLeft = Math.max(0, (e.raceLaps || 0) - e.laps);
        if (lapsLeft && lapsLeft < 8) return 'soft';
        return 'hard';
      }

      return {
        cars: cars,
        byDriver: byDriver,
        setLimit: function (mps) {
          var lim = mps > 0 ? mps : 0;
          for (var i = 0; i < cars.length; i++) cars[i].driver.setLimit(lim);
        },
        setFrozen: function (v) { frozen = !!v; },
        /* weather changes under the field as the race goes on */
        setConditions: function (c) {
          if (!c) return;
          if (c.wetness !== undefined) cond.wetness = c.wetness;
          if (c.ambientC !== undefined) cond.ambientC = c.ambientC;
          for (var i = 0; i < cars.length; i++) cars[i].driver.setWetness(cond.wetness);
        },
        startPit: startPit,
        /* after a formation lap the whole field lines up again in grid order */
        regrid: function () {
          for (var i = 0; i < cars.length; i++) {
            var e = cars[i];
            var gp = slotPos(track, startS, e.slot);
            var p = track.offsetPoint(gp.s, gp.lateral, {});
            e.car.x = p.x; e.car.z = p.z; e.car.y = p.y;
            e.car.heading = p.heading;
            e.car.vx = 0; e.car.vl = 0; e.car.r = 0; e.car.steer = 0;
            e.car.gear = 1; e.car.lastIdx = track.indexAt(gp.s);
            e.car.wallContact = 0; e.car.inPit = false;
            e.car.s = gp.s; e.car.lateral = gp.lateral;
            e.prev.x = p.x; e.prev.z = p.z; e.prev.h = p.heading;
            e.laps = 0; e.started = false; e.lastCrossS = gp.s; e.pitRun = null;
            e.mesh.position.set(p.x - track.origin.x, p.y, p.z - track.origin.z);
            e.mesh.rotation.y = p.heading + Math.PI;
          }
          time = 0;
        },
        carAt: function (id) { return byDriver[id]; },
        update: update,
        render: render,
        standings: standings,
        progressOf: progressOf,
        rowOf: rowOf,
        applyBurst: applyBurst,
        dispose: dispose,
        messages: messages,
        say: say,
        get time() { return time; },
        get recoveries() { return recovered; }
      };
    }
  };
})(window.F1 = window.F1 || {});
