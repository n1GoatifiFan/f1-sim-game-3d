/* ==========================================================================
   F1 2026 — game/session.js
   A driveable session. Owns the fixed-step clock (120 Hz), the player car,
   the camera rig, lap/sector timing, fuel and ERS strategy, the HUD feed
   and — from Section 4 — the 21 AI cars and race control.

     var session = F1.session.create(sceneApi, {
       teamId, driverId, laps, compound, camera, startS, fuel,
       assists: {...}, countdown: 3.2, sessionType: 'race'|'practice'
     });
     sceneApi.onFrame = session.update;     // driven by world/track_scene.js
     session.onKey(e) / setPaused(bool) / resetCar() / cycleERS()
     session.cycleCamera() / toggleDRS()
     session.dispose()

   Update loop: accumulate real time, run whole 1/120 s physics steps, then
   interpolate the body transform by the leftover fraction so the car stays
   smooth on 60 Hz and 144 Hz displays alike.
   ========================================================================== */
(function (F1) {
  'use strict';

  var STEP = 1 / 120;
  var MAX_STEPS = 12;             // never simulate more than 100 ms in one frame

  var ERS_MODES = ['harvest', 'balanced', 'deploy', 'overtake'];

  function lerp(a, b, t) { return a + (b - a) * t; }
  function angLerp(a, b, t) {
    var d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  F1.session = {
    STEP: STEP,

    create: function (sceneApi, params) {
      params = params || {};
      var track = sceneApi.track;
      var meta = sceneApi.meta;
      var world = sceneApi.world;
      var S = F1.settings;

      var teamId = params.teamId || 'mclaren';
      var team = F1.DATA.getTeam(teamId);
      var driverId = params.driverId || (team.drivers && team.drivers[0]) || F1.DATA.drivers[0].id;
      var driver = F1.DATA.getDriver(driverId);
      var spec = F1.vehicle.specFor(teamId, driverId);

      var lapsTotal = Math.max(1, params.laps || 3);
      var countdownStart = params.countdown === undefined ? 3.2 : params.countdown;
      var A = S.assists || {};
      var assists = params.assists || {
        abs: A.abs === undefined ? 2 : A.abs,                    // 0..3
        tractionControl: A.tractionControl === undefined ? 2 : A.tractionControl,
        steerAssist: A.steeringAssist === undefined ? 1 : A.steeringAssist,
        brakeAssist: A.brakeAssist || 0,
        autoGears: A.autoGears !== false,
        brakingLine: (A.racingLine || 0) > 0
      };

      var startS = params.startS === undefined ? track.length - 12 : params.startS;

      /* difficulty scales the whole AI field; 'custom' reads the sliders */
      var DIFF = (F1.field && F1.field.DIFFICULTY) || {};
      var diffName = params.difficulty || S.gameplay.difficulty || 'balanced';
      var diffPace = DIFF[diffName] === undefined ? 0.85 : DIFF[diffName];
      if (diffName === 'custom' && S.gameplay.aiSkill !== undefined) {
        diffPace = 0.6 + S.gameplay.aiSkill / 100 * 0.6;
      }

      /* line up in a real grid slot unless this is a solo session */
      var solo = params.field === false;
      var gridSlot = params.gridSlot === undefined ? (solo ? 0 : 5) : params.gridSlot;
      var gridPos = (!solo && F1.field) ? F1.field.slotPos(track, startS, gridSlot)
        : { s: startS, lateral: 0 };

      /* ---------------- the player car ---------------- */
      var car = F1.vehicle.create(track, spec, {
        startS: gridPos.s,
        lateral: gridPos.lateral,
        compound: params.compound || 'medium',
        fuel: params.fuel === undefined ? spec.fuelDefault : params.fuel,
        assists: assists,
        autoGears: assists.autoGears !== false,
        tyreTempC: 82
      });

      var mesh = F1.buildCar({ teamId: teamId, driverId: driverId, lod: 2 });
      mesh.position.set(car.x - track.origin.x, car.y, car.z - track.origin.z);
      mesh.rotation.y = car.heading + Math.PI;
      world.group.add(mesh);
      var wheels = mesh.userData.wheels || [];

      /* ---------------- the rest of the field ---------------- */
      var field = (!solo && F1.field) ? F1.field.create(track, world, {
        playerId: driverId,
        startS: startS,
        playerSlot: gridSlot,
        difficulty: diffPace,
        pace: params.pace === undefined ? 1 : params.pace,
        compound: params.compound || 'medium',
        raceLaps: lapsTotal,
        ambientC: params.ambientC,
        wetness: params.wetness || 0,
        seed: params.seed || (meta.id + '|' + (params.round || 1))
      }) : null;

      /* ---------------- race control ---------------- */
      var rc = F1.racecontrol ? F1.racecontrol.create(track, {
        circuitWeather: meta.weather,
        seed: meta.id,
        weather: params.weather || 'auto'
      }) : null;

      /* ---------------- pit lane ---------------- */
      var pitLane = F1.pitlane ? F1.pitlane.build(track) : null;

      /* ---------------- rain ---------------- */
      var rainFx = F1.weatherfx ? F1.weatherfx.create(sceneApi.scene) : null;

      /* ---------------- cameras ---------------- */
      var cams = F1.cameras.create(track);
      if (params.camera) cams.set(params.camera);
      document.body.dataset.camera = cams.mode;
      cams.update(sceneApi.camera, 0.016, {
        x: car.x - track.origin.x, y: car.y, z: car.z - track.origin.z,
        heading: car.heading, vx: car.vx, steer: car.steer, latG: 0,
        surface: 'asphalt', s: car.s
      });

      /* ---------------- timing state ---------------- */
      var St = {
        time: 0,                 // session clock (pauses with the game)
        state: 'countdown',      // countdown | racing | finished
        countdown: countdownStart,
        paused: false,
        started: false,          // crossed the line for the first time
        lap: 1,
        lapTime: 0,
        lastLap: 0,
        bestLap: 0,
        bestLapTrace: null,      // [{s,t}] of the best lap, for the delta
        trace: [],
        sector: 0,
        sectorStart: 0,
        sectorTimes: [0, 0, 0],
        lastSectors: [0, 0, 0],
        bestSectors: [0, 0, 0],
        delta: 0,
        lastCrossS: startS,
        crossings: 0,
        message: '',
        messageTimer: 0,
        drs: false,
        drsZone: -1,
        ersMode: 'balanced',
        position: 1,
        finishTime: 0,
        flag: 'green',
        pitRequested: false,
        pitRun: null,
        pitting: false,
        stops: 0,
        pitServed: false,
        pitCompound: null,
        offTime: 0,
        results: null,
        warnings: 0,
        blueFlag: false,
        ambientC: params.ambientC === undefined ? 22 : params.ambientC
      };

      var sectorFracs = [
        0,
        (track.sectors && track.sectors[0]) || 0.33,
        (track.sectors && track.sectors[1]) || 0.66,
        1
      ];
      var drsZones = (track.drs || []).map(function (z) {
        return { s0: z[0] * track.length, s1: z[1] * track.length };
      });

      /* ---------------- previous pose (for interpolation) -------------- */
      var prev = { x: car.x, y: car.y, z: car.z, h: car.heading };
      var acc = 0;
      var wheelSpinV = 0;

      /* ---------------- race control inputs ---------------- */
      var rcCars = [{ id: driverId, car: car, isPlayer: true }];
      if (field) {
        field.cars.forEach(function (e) { rcCars.push({ id: e.id, car: e.car, isPlayer: false }); });
      }
      var rcCtx = { cars: rcCars, state: 'countdown' };
      var lastSky = '';

      /* ---------------- input ---------------- */
      var held = { boost: false, lookBack: false, shiftUp: false, shiftDown: false };

      function readInput(dt) {
        var inp = {
          steer: 0, throttle: 0, brake: 0, boost: false,
          shiftUp: false, shiftDown: false
        };
        if (St.state === 'countdown') {
          // the throttle is live on the grid but the car is held: give the
          // player the "revs" feedback of a real start
          inp.throttle = F1.input.getThrottle() * 0.4;
          car.ersMode = St.ersMode;
          return inp;
        }
        if (rc && rc.flag === 'red' && St.state === 'racing') {
          inp.brake = 1;
          car.ersMode = St.ersMode;
          return inp;
        }
        if (St.paused || St.state === 'finished') {
          // coast to a stop after the flag
          inp.brake = St.state === 'finished' ? 0.35 : 1;
          car.ersMode = St.ersMode;
          return inp;
        }
        inp.steer = F1.util.clamp(F1.input.getSteer() * (S.controls.steerSensitivity || 1), -1, 1);
        inp.throttle = F1.input.getThrottle();
        inp.brake = F1.input.getBrake();
        inp.boost = F1.input.action('boost') || held.boost;
        inp.shiftUp = F1.input.pressed('gearUp') || held.shiftUp;
        inp.shiftDown = F1.input.pressed('gearDown') || held.shiftDown;
        car.ersMode = St.ersMode;
        return inp;
      }

      /* ---------------- lap timing ---------------- */
      function resetLapTrace() {
        St.trace.length = 0;
        St.trace.push({ s: 0, t: 0 });
      }

      function onCrossLine() {
        if (!St.started) {
          St.started = true;
          St.lapTime = 0;
          St.sectorStart = 0;
          St.sectorTimes = [0, 0, 0];
          resetLapTrace();
          return;
        }
        var lap = St.lapTime;
        // the run to the line completes sector 3
        St.sectorTimes[2] = Math.max(0, lap - St.sectorStart);
        St.lastLap = lap;
        St.lastSectors = St.sectorTimes.slice();
        if (!St.bestLap || lap < St.bestLap) {
          St.bestLap = lap;
          St.bestLapTrace = St.trace.slice();
          for (var i = 0; i < 3; i++) {
            if (!St.bestSectors[i] || St.lastSectors[i] < St.bestSectors[i]) St.bestSectors[i] = St.lastSectors[i];
          }
          say('Purple lap \u00b7 ' + F1.util.fmtTime(lap));
        } else {
          say('Lap ' + F1.util.fmtTime(lap));
        }
        St.lap++;
        St.lapTime = 0;
        St.sector = 0;
        St.sectorStart = 0;
        St.sectorTimes = [0, 0, 0];
        resetLapTrace();
        if (St.lap > lapsTotal) finish();
      }

      function onSector(idx) {
        var t = St.lapTime - St.sectorStart;
        St.sectorTimes[idx] = t;
        St.sectorStart = St.lapTime;
        if (!St.bestSectors[idx] || t < St.bestSectors[idx]) {
          // best sector only counts once the lap is complete, otherwise the
          // HUD would celebrate a sector from an out-lap
        }
      }

      function deltaToBest() {
        if (!St.bestLapTrace || St.bestLapTrace.length < 2) return 0;
        var s = track.wrapS(car.s);
        var tr = St.bestLapTrace;
        var lo = 0, hi = tr.length - 1;
        for (var i = 0; i < tr.length - 1; i++) {
          if (s >= tr[i].s && s <= tr[i + 1].s) { lo = i; hi = i + 1; break; }
          if (i === tr.length - 2) { return 0; }
        }
        var span = tr[hi].s - tr[lo].s || 1;
        var ref = lerp(tr[lo].t, tr[hi].t, (s - tr[lo].s) / span);
        return St.lapTime - ref;
      }

      /* the player's car as a classification row, in the field's own shape */
      var playerRow = {
        id: driverId, teamId: teamId, car: car, isPlayer: true,
        lapStart: 0, lastLap: 0, bestLap: 0, penalty: 0, position: 1,
        seat: { driver: driver, code: driver.code },
        get laps() { return Math.max(0, St.lap - 1); },
        get started() { return !!St.started; }
      };

      /* final classification: cars still running are ordered by distance
         covered, which is what a chequered flag looks like in the data */
      function classify() {
        if (!field) {
          return [{ pos: 1, code: driver.code, name: driver.name, laps: playerRow.laps, gap: 0, me: true, teamId: teamId }];
        }
        var rows = field.standings(playerRow);
        return rows.map(function (r, i) {
          return {
            pos: i + 1, code: r.code, name: r.name, laps: r.laps,
            gap: r.gap, me: r.me, teamId: r.teamId,
            penalty: (rc && rc.penaltyFor(r.id)) || 0
          };
        });
      }

      function finish() {
        St.state = 'finished';
        St.finishTime = St.time;
        St.results = classify();
        St.position = playerRow.position || St.position;
        say('Chequered flag \u00b7 P' + St.position);
        F1.input.rumble && F1.input.rumble(0.8, 0.5, 400);
        F1.bus.emit('session-finish', {
          position: St.position, best: St.bestLap, laps: lapsTotal,
          time: St.time, teamId: teamId, driverId: driverId
        });
      }

      function say(msg) {
        St.message = msg;
        St.messageTimer = 3.0;
      }

      /* ---------------- a step of the world ---------------- */
      function physicsStep(inp) {
        /* in the pit lane the car follows the lane rather than the tyre model:
           the corridor is narrow, the limit is 80 km/h and the wall is not
           modelled separately */
        if (St.pitRun) {
          St.pitRun.update(STEP);
          if (St.pitRun.atBox && !St.pitServed) {
            St.pitServed = true;
            St.pitRun.serve(St.pitCompound || car.compound, 20);
            St.stops++;
            say('Box complete \u2014 ' + (St.pitCompound || car.compound) + ' fitted');
          }
          if (St.pitRun.done) {
            St.pitRun = null;
            St.pitting = false;
            F1.input.rumble && F1.input.rumble(0.2, 0.2, 120);
          }
          /* the pit lane crosses the start line: the lap still counts */
          if (St.state === 'racing' && car.s < St.lastCrossS - track.length * 0.5) {
            onCrossLine();
          }
          St.lastCrossS = car.s;
          return;
        }
        var env = {
          assists: assists,
          wetness: Math.max(params.wetness || 0, rc ? rc.wetness : 0),
          ambientC: St.ambientC,
          debug: false
        };
        F1.vehicle.step(car, inp, STEP, track, env);
        car.throttle = inp.throttle;
        car.brake = inp.brake;
        wheelSpinV -= (car.vx / 0.36) * STEP;

        /* pit entry: the request is armed with the pit button, the dive
           happens when the car reaches the entry window */
        if (St.pitRequested && pitLane && !St.pitRun && St.state === 'racing' &&
            pitLane.inWindow(car.s) && Math.abs(car.vx) < 34) {
          St.pitRequested = false;
          St.pitRun = F1.pitlane.runner(track, pitLane, car, { stopTime: 2.5 });
          St.pitServed = false;
          St.pitting = true;
          St.pitCompound = St.pitCompound || 'hard';
          say('Pit lane \u2014 80 km/h');
        }

        if (St.state === 'racing') {
          var lapLen = track.length;
          var prevS = St.lastCrossS;
          var nowS = car.s;

          // the lap wraps from the end back to zero: that is the line
          if (nowS < prevS - lapLen * 0.5) {
            onCrossLine();
          } else if (nowS > prevS + lapLen * 0.5) {
            // the car was reset backwards over the line — ignore
          }

          // sector boundaries
          if (St.sector < 2) {
            var b = sectorFracs[St.sector + 1] * lapLen;
            var pf = prevS / lapLen, cf = nowS / lapLen;
            if (pf < sectorFracs[St.sector + 1] && cf >= sectorFracs[St.sector + 1]) {
              St.sector++;
              onSector(St.sector - 1);
            }
          }
          St.lastCrossS = nowS;

          /* track limits: a warning after 1.5 s off the road in one go, and
             a five second penalty every fourth warning */
          if (car.edge > 1.6) St.offTime += STEP;
          else St.offTime = Math.max(0, St.offTime - STEP * 2);
          if (St.offTime > 1.5) {
            St.offTime = 0;
            St.warnings++;
            if (rc && St.warnings % 4 === 0) {
              rc.addPenalty(driverId, 5, 'Track limits');
              say('Track limits \u2014 5 second penalty');
            } else {
              say('Track limits \u2014 ' + St.warnings + '/4');
            }
          }
        } else {
          St.lastCrossS = car.s;
        }
      }

      function tickTiming(dt) {
        if (St.state === 'countdown') {
          St.countdown -= dt;
          if (St.countdown <= 0) {
            St.state = 'racing';
            St.started = false;
            St.lap = 1;
            St.lapTime = 0;
            St.sectorStart = 0;
            St.sectorTimes = [0, 0, 0];
            initTraceAtCar();
            say('Lights out and away we go');
            F1.bus.emit('lights-out');
          }
          return;
        }
        if (St.state !== 'racing') return;
        St.lapTime += dt;
        var s = track.wrapS(car.s);
        if (!St.started) {
          // first flying lap starts when the car first crosses the line
          if (St.lastCrossS > s && St.time > 0.5) { /* handled by onCrossLine */ }
        }
        var tr = St.trace;
        if (!tr.length || s - tr[tr.length - 1].s > 25 || s < tr[tr.length - 1].s) {
          if (s >= (tr.length ? tr[tr.length - 1].s : -1)) tr.push({ s: s, t: St.lapTime });
        }

        // DRS / overtake zones
        var zone = -1;
        for (var i = 0; i < drsZones.length; i++) {
          if (s >= drsZones[i].s0 && s <= drsZones[i].s1) { zone = i; break; }
        }
        St.drsZone = zone;
        St.drs = zone >= 0 && St.lap > 1 && car.vx > 40 && St.state === 'racing';
        car.drs = St.drs;

        St.delta = deltaToBest();
        if (St.messageTimer > 0) {
          St.messageTimer -= dt;
          if (St.messageTimer <= 0) St.message = '';
        }
      }

      function initTraceAtCar() {
        St.trace.length = 0;
        St.trace.push({ s: track.wrapS(car.s), t: 0 });
      }

      /* ---------------- the frame ---------------- */
      function update(dt) {
        if (!(dt > 0)) return;
        dt = Math.min(dt, 0.1);

        /* menu / pause: keep rendering, freeze the clock */
        if (St.paused) {
          render(0);
          world.setShadowFocus && world.setShadowFocus(cams.focus.x, cams.focus.z);
          return;
        }

        acc += dt;
        var steps = 0;
        var inp = readInput(dt);
        while (acc >= STEP && steps < MAX_STEPS) {
          prev.x = car.x; prev.y = car.y; prev.z = car.z; prev.h = car.heading;
          if (St.state === 'countdown') {
            // held on the grid: revs only, no movement
            car.throttle = inp.throttle;
            car.brake = 1;
            car.rpm = spec.idleRpm + (spec.shiftRpm - spec.idleRpm) * inp.throttle * 0.7;
          } else {
            physicsStep(inp);
          }
          acc -= STEP;
          steps++;
          tickTiming(STEP);
          St.time += STEP;
          if (St.state === 'racing' && !St.started) St.lapTime = 0;

          /* the world keeps turning at the same rate as the player's car */
          if (St.state === 'racing') {
            if (rc) {
              rcCtx.state = 'racing';
              rc.update(STEP, rcCtx);
              St.flag = rc.flag;
            }
            if (field) {
              if (rc) field.setConditions({ wetness: rc.wetness, ambientC: St.ambientC });
              field.update(STEP);
              field.setLimit(rc ? rc.limit : 0);
              field.setFrozen(rc ? rc.flag === 'red' : false);
            }
          }
        }
        if (steps === MAX_STEPS) acc = 0;   // drop the backlog after a stall

        var alpha = acc / STEP;
        render(alpha);
        world.setShadowFocus && world.setShadowFocus(cams.focus.x, cams.focus.z);
        pushHud();
      }

      /* place the mesh, spin the wheels, drive the camera */
      function render(alpha) {
        var x = lerp(prev.x, car.x, alpha);
        var y = lerp(prev.y, car.y, alpha);
        var z = lerp(prev.z, car.z, alpha);
        var h = angLerp(prev.h, car.heading, alpha);

        mesh.position.set(x - track.origin.x, y, z - track.origin.z);
        // visual body attitude: roll into the corner, pitch under braking
        var roll = F1.util.clamp((car.latG || 0) * 0.035, -0.06, 0.06);
        var pitch = F1.util.clamp((car.longG || 0) * 0.02, -0.05, 0.05);
        mesh.rotation.set(pitch, h + Math.PI, roll, 'YXZ');

        // wheels
        mesh.userData.setBrakeGlow && mesh.userData.setBrakeGlow(F1.util.clamp(car.brake * 1.1 + car.brakeGlow, 0, 1));
        mesh.userData.setAeroMode && mesh.userData.setAeroMode(car.aeroMode);
        for (var i = 0; i < wheels.length; i++) {
          var w = wheels[i];
          if (w.front) w.node.rotation.y = car.steer;
          w.spin.rotation.x = wheelSpinV;
        }

        if (field) field.render(alpha);
        if (rainFx) {
          rainFx.setIntensity(rc ? rc.weather.rainIntensity : 0);
          rainFx.update(1 / 60, sceneApi.camera);
        }
        if (rc && world.setWeather && rc.skyState() !== lastSky) {
          lastSky = rc.skyState();
          world.setWeather(lastSky);
        }

        var camCar = {
          x: x - track.origin.x, y: y, z: z - track.origin.z,
          heading: h, vx: car.vx, steer: car.steer,
          latG: car.latG, surface: car.surface, s: car.s
        };
        cams.update(sceneApi.camera, 1 / 60, camCar, {
          lookBack: held.lookBack,
          shake: car.surface === 'grass' || car.surface === 'gravel' ? 0.5 : 0
        });
      }

      /* ---------------- HUD feed ---------------- */
      var hudRows = [];
      function updateStandings() {
        if (!field) return;
        var rows = field.standings(playerRow);
        hudRows.length = 0;
        var leaderGap = 0, leaderTime = 0;
        for (var i = 0; i < rows.length; i++) {
          var r = rows[i];
          if (r.me) {
            St.position = r.pos;
            St.gapToLeader = r.gap;
          }
          // seconds behind: use the leader's own lap time as the divisor so
          // the tower reads like a timing screen
          if (i === 0) leaderTime = r.bestLap || r.lastLap || 0;
        }
        var me = null;
        for (i = 0; i < rows.length; i++) if (rows[i].me) me = rows[i];
        if (me && me.bestLap) leaderTime = leaderTime || me.bestLap;
        // before anyone has set a lap time the tower shows metres; after that
        // it switches to seconds behind the leader, like a timing screen
        var scale = leaderTime > 0 ? leaderTime / track.length : 0;
        var unit = scale > 0 ? 's' : 'm';
        var leaderLaps = rows.length ? rows[0].laps : 0;
        function gapRow(row, i) {
          var lapsDown = leaderLaps - row.laps;
          if (i === 0) return { pos: row.pos, code: row.code, name: row.name, me: row.me, gap: 0, unit: unit };
          if (lapsDown > 0) {
            return { pos: row.pos, code: row.code, name: row.name, me: row.me, gap: lapsDown, unit: 'L' };
          }
          return {
            pos: row.pos, code: row.code, name: row.name, me: row.me,
            gap: scale ? row.gap * scale : row.gap, unit: unit
          };
        }
        for (i = 0; i < rows.length; i++) {
          if (i < 3 || (me && Math.abs(i - (me.pos - 1)) <= 3)) hudRows.push(gapRow(rows[i], i));
        }
        if (me && !hudRows.some(function (r) { return r.me; })) hudRows.push(gapRow(me, me.pos - 1));

        /* blue flags: a car a lap ahead closing on the player has to be let
           through, and the HUD says so */
        St.blueFlag = false;
        if (me) {
          for (i = 0; i < rows.length; i++) {
            var other = field.byDriver[rows[i].id];
            if (!other || other.laps <= playerRow.laps) continue;
            var ds = other.car.s - car.s;
            if (ds > track.length * 0.5) ds -= track.length;
            if (ds < -track.length * 0.5) ds += track.length;
            if (ds < 0 && ds > -70 && other.car.vx > car.vx) St.blueFlag = true;
          }
        }
      }

      function pushHud() {
        updateStandings();
        var d = {
          trackId: meta.id, trackName: meta.name,
          state: St.state, countdown: St.countdown, paused: St.paused,
          lap: Math.min(St.lap, lapsTotal), lapsTotal: lapsTotal,
          lapTime: St.lapTime, lastLap: St.lastLap, bestLap: St.bestLap,
          delta: St.delta, flying: St.started,
          position: St.position,
          gear: car.gear, speed: Math.abs(car.vx) * 3.6, rpm: car.rpm,
          throttle: car.throttle, brake: car.brake,
          ers: car.ers, ersMode: St.ersMode,
          aeroMode: car.aeroMode, drs: St.drs,
          compound: car.compound, fuel: car.fuel, fuelStart: spec.fuelDefault,
          tyre: {
            fl: car.tyres.fl, fr: car.tyres.fr, rl: car.tyres.rl, rr: car.tyres.rr
          },
          surface: car.surface,
          sectorTimes: St.sectorTimes,
          lastSectors: St.lastSectors,
          bestSectors: St.bestSectors,
          s: track.wrapS(car.s), trackLength: track.length,
          message: St.message,
          flag: St.flag,
          blueFlag: St.blueFlag,
          sectorFlags: rc ? rc.sectorFlags : null,
          scPhase: rc ? rc.scPhase : '',
          weather: rc ? {
            label: rc.weatherLabel(), icon: rc.weatherIcon(), wetness: rc.wetness,
            sky: rc.skyState()
          } : null,
          trackWet: rc ? rc.wetness : 0,
          pitting: St.pitting,
          pitPhase: St.pitRun ? St.pitRun.phase : '',
          pitRequested: St.pitRequested,
          stops: St.stops,
          penalty: rc ? rc.penaltyFor(driverId) : 0,
          standings: hudRows.length ? hudRows : [{
            pos: 1, code: driver.code || driver.lastName.slice(0, 3).toUpperCase(),
            name: driver.name, gap: 0, me: true
          }]
        };
        if (field) {
          var last = hudRows[hudRows.length - 1];
          d.totalCars = field.cars.length + 1;
        }
        F1.bus.emit('hud', d);
      }

      /* ---------------- camera controls ---------------- */
      function cycleCamera(dir) {
        var m = dir > 0 ? cams.next() : cams.prev();
        document.body.dataset.camera = m;
        F1.bus.emit('camera-mode', m);
        return m;
      }

      /* ---------------- pause / reset ---------------- */
      function setPaused(p) {
        if (St.state === 'finished') p = false;
        St.paused = !!p;
        F1.input.enabled = !St.paused;
      }

      function resetCar() {
        var s = track.wrapS(car.s);
        var at = track.at(s, {});
        car.x = at.x; car.z = at.z; car.y = at.y;
        car.heading = at.heading;
        car.vx = 0; car.vl = 0; car.r = 0; car.steer = 0;
        car.gear = 1; car.rpm = spec.idleRpm;
        car.lastIdx = track.indexAt(s);
        car.damage.frontWing = Math.min(car.damage.frontWing, 0.4);
        St.lastCrossS = s;
        St.pitRequested = false;
        St.pitRun = null;
        St.pitting = false;
        say('Car reset \u00b7 keep it on the road');
        F1.input.rumble && F1.input.rumble(0.6, 0.3, 200);
      }

      function cycleERS() {
        var i = ERS_MODES.indexOf(St.ersMode);
        St.ersMode = ERS_MODES[(i + 1) % ERS_MODES.length];
        say('ERS ' + St.ersMode.toUpperCase());
        return St.ersMode;
      }

      function toggleDRS() {
        // 2026: the "DRS" button is the overtake override. It only arms in a
        // zone; outside one it is a no-op, exactly like the real thing.
        if (St.drsZone < 0) { say('Override unavailable \u2014 not in a zone'); return false; }
        held.boost = !held.boost;
        say(held.boost ? 'Override armed' : 'Override off');
        return held.boost;
      }

      /* ---------------- pit controls ---------------- */
      function requestPit() {
        if (St.state !== 'racing') return false;
        if (St.pitRun) { say('Already in the pit lane'); return false; }
        St.pitRequested = !St.pitRequested;
        if (St.pitRequested) {
          St.pitCompound = St.pitCompound || (car.compound === 'soft' ? 'hard' : 'soft');
          say('Pit stop requested \u2014 ' + String(St.pitCompound).toUpperCase() + ' ready');
        } else {
          say('Pit request cancelled');
        }
        return St.pitRequested;
      }

      function cyclePitCompound() {
        var order = ['soft', 'medium', 'hard'];
        var i = order.indexOf(St.pitCompound || car.compound);
        St.pitCompound = order[(i + 1) % order.length];
        say('Pit tyres \u2014 ' + St.pitCompound.toUpperCase());
        return St.pitCompound;
      }

      /* ---------------- keyboard ---------------- */
      function onKey(e) {
        var code = e.code;
        if (e.type === 'keyup') {
          if (code === 'Space') held.boost = false;
          if (code === 'KeyX' || code === 'ArrowDown') held.lookBack = false;
          return;
        }
        if (e.repeat) return;
        if (code === 'KeyX') held.lookBack = true;
        if (code === 'Space') held.boost = true;
        if (code === 'KeyC') cycleCamera(1);
        if (code === 'KeyR') resetCar();
        if (code === 'KeyF') cycleERS();
        if (code === 'KeyP') requestPit();
        if (code === 'BracketLeft' || code === 'BracketRight') cyclePitCompound();
      }

      /* ---------------- cleanup ---------------- */
      function dispose() {
        if (field) { try { field.dispose(); } catch (e) { console.error(e); } field = null; }
        if (rainFx) { try { rainFx.dispose(); } catch (e) {} rainFx = null; }
        if (mesh.parent) mesh.parent.remove(mesh);
        F1.input.enabled = true;
      }

      /* the gearbox needs to know whether the player shifts manually */
      if (assists.autoGears === false) car.autoShift = false;

      return {
        car: car, track: track, meta: meta, cams: cams, state: St,
        update: update, tick: update,
        setPaused: setPaused, resetCar: resetCar, cycleERS: cycleERS,
        cycleCamera: cycleCamera, toggleDRS: toggleDRS,
        requestPit: requestPit, cyclePitCompound: cyclePitCompound,
        onKey: onKey, dispose: dispose,
        field: field, raceControl: rc, pitLane: pitLane,
        get results() { return St.results; },
        get flag() { return rc ? rc.flag : 'green'; },
        get weather() { return rc ? rc.weather : null; },
        get pitting() { return St.pitting; },
        get stops() { return St.stops; },
        classify: classify,
        get paused() { return St.paused; },
        get position() { return St.position; },
        get bestLap() { return St.bestLap; },
        get lastLap() { return St.lastLap; },
        get lapsTotal() { return lapsTotal; },
        get lap() { return St.lap; },
        get drsZone() { return St.drsZone; },
        /** used by the AI / replay code in Section 4 */
        setHighlightCar: function () {}
      };
    }
  };
})(window.F1 = window.F1 || {});
