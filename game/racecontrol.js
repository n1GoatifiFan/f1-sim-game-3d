/* ==========================================================================
   F1 2026 — game/racecontrol.js
   Flags, the safety car, penalties and the weather.

   Race control is a pure state machine: it watches the cars it is given and
   publishes a flag state, a speed limit and a list of penalties. It never
   touches a car's physics — the session and the field read from it.

     var rc = F1.racecontrol.create(track, {weather: 'auto', seed: 'italy'});
     rc.update(dt, {cars: [{id, car, isPlayer}], state: 'racing'});
     rc.flag            // 'green' | 'yellow' | 'vsc' | 'sc' | 'red'
     rc.sectorFlags     // ['green','yellow','green']
     rc.limit           // m/s cap while the SC is out, 0 when green
     rc.weather.wetness // 0..1, feeds vehicle.step
     rc.penaltyFor(id)  // seconds owed
   ========================================================================== */
(function (F1) {
  'use strict';

  var SECTORS = 3;

  var WX = {
    dry: { label: 'Dry', wetness: 0.0, sky: 'dry', icon: '\u2600', chance: 0.22 },
    cloudy: { label: 'Cloudy', wetness: 0.04, sky: 'overcast', icon: '\u2601', chance: 0.34 },
    shower: { label: 'Showers', wetness: 0.38, sky: 'wet', icon: '\u2614', chance: 0.28 },
    rain: { label: 'Heavy rain', wetness: 0.85, sky: 'wet', icon: '\u26C8', chance: 0.16 }
  };
  var WX_ORDER = ['dry', 'cloudy', 'shower', 'rain'];

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ================================================================== */
  /* weather                                                            */
  /* ================================================================== */
  function makeWeather(trackMeta, seed, mode) {
    var rnd = F1.rng(F1.rng.string(seed));
    var start = 'dry';
    var forced = mode && mode !== 'auto' ? mode : null;
    if (forced) {
      start = forced === 'wet' ? 'rain' : (forced === 'mixed' ? 'cloudy' : 'dry');
    } else {
      // circuit metadata: { base: 'dry'|'overcast'|'mixed', rainChance: 0..1 }
      var wx = trackMeta.weather || {};
      var base = (wx.base || 'dry').toLowerCase();
      var chance = wx.rainChance === undefined ? 0.2 : wx.rainChance;
      if (base === 'mixed' || base === 'wet') start = rnd() < 0.6 ? 'shower' : 'cloudy';
      else if (base === 'overcast') start = rnd() < chance ? 'shower' : 'cloudy';
      else start = rnd() < chance * 0.35 ? 'cloudy' : 'dry';
    }
    var state = {
      mode: forced || 'auto',
      sky: start,
      wetness: 0,
      target: start,
      nextChange: 150 + rnd() * 260,     // seconds until the next forecast change
      changedAt: 0,
      rainIntensity: 0,
      history: [start]
    };
    state.wetness = WX[start].wetness * 0.6;
    return state;
  }

  function stepWeather(w, dt, time) {
    if (w.mode !== 'auto') {
      // fixed conditions: still ramp the track towards the target wetness
      w.wetness += clamp((WX[w.sky].wetness - w.wetness), -0.02 * dt, 0.03 * dt);
      w.rainIntensity += clamp((WX[w.sky].wetness - w.rainIntensity), -2 * dt, 2 * dt);
      return;
    }
    w.nextChange -= dt;
    if (w.nextChange <= 0) {
      // seeded walk: dry stays dry most of the time, rain tends to clear
      var i = WX_ORDER.indexOf(w.sky);
      var roll = Math.random();
      var next = i;
      if (roll < 0.34) next = Math.max(0, i - 1);          // clearing
      else if (roll < 0.62) next = Math.min(3, i + 1);     // worsening
      w.sky = WX_ORDER[next];
      w.nextChange = 170 + Math.random() * 320;
      w.changedAt = time;
      w.history.push(w.sky);
      if (w.history.length > 6) w.history.shift();
    }
    // the track takes time to wet up and longer to dry
    var targetWet = WX[w.sky].wetness;
    var rate = targetWet > w.wetness ? 0.012 : 0.005;
    w.wetness += clamp(targetWet - w.wetness, -rate * dt * 3, rate * dt);
    w.rainIntensity = clamp(w.rainIntensity + (WX[w.sky].wetness - w.rainIntensity) * dt * 0.4, 0, 1);
  }

  /* ================================================================== */
  /* race control                                                       */
  /* ================================================================== */
  function create(track, opts) {
    opts = opts || {};
    var weather = makeWeather({ weather: opts.circuitWeather }, opts.seed || track.id || 'wx', opts.weather);
    var rnd = F1.rng(F1.rng.string((opts.seed || 'rc') + '|flags'));
    var sectorFracs = [0,
      (track.sectors && track.sectors[0]) || 0.33,
      (track.sectors && track.sectors[1]) || 0.66, 1];

    var flag = 'green';
    var sectorFlags = ['green', 'green', 'green'];
    var sectorTimer = [0, 0, 0];
    var flagTimer = 0;
    var scPhase = '';            // 'deploy' | 'neutral' | 'in' | ''
    var scTimer = 0;
    var redTimer = 0;
    var incidents = 0;
    var incidentClock = 0;       // seconds since the last incident
    var sinceYellow = 0;
    var time = 0;
    var limit = 0;
    var penalties = {};          // id -> { time, reasons: [], warnings }
    var watch = {};              // id -> { stopped, stoppedT, speedOver }
    var messages = [];
    var history = [];
    var lastSector = -1;
    var scUses = 0;
    var vscTimer = 0;
    var yellowT = 0;

    function say(text, kind) {
      messages.push({ t: time, text: text, kind: kind || 'info' });
      if (messages.length > 80) messages.shift();
      F1.bus.emit('race-message', text);
    }

    function sectorAt(s) {
      var f = s / track.length;
      for (var i = SECTORS - 1; i >= 0; i--) if (f >= sectorFracs[i]) return i;
      return 0;
    }

    function pen(id) {
      if (!penalties[id]) penalties[id] = { time: 0, reasons: [], warnings: 0 };
      return penalties[id];
    }

    function addPenalty(id, seconds, reason) {
      var p = pen(id);
      p.time += seconds;
      p.reasons.push(reason);
      say(reason + ' \u2014 ' + seconds + 's penalty', 'penalty');
      return p.time;
    }

    /* ---------------- per-car incident watch ---------------- */
    function trackCar(c, dt) {
      var w = watch[c.id] || (watch[c.id] = {
        stopped: 0, slow: 0, over: 0, off: 0, lastIncident: -99, moved: false
      });
      var car = c.car;
      if (car.inPit) {
        // a car stationary in its box is not an incident
        w.stopped = 0; w.moved = true;
        return;
      }
      var speed = Math.abs(car.vx);
      var spun = speed < 4.5 && car.surface === 'asphalt';
      var beached = speed < 2.5 && (car.surface === 'gravel' || car.surface === 'grass');
      var crashed = canCrash(car) && car.wallContact > 0.75;
      if (speed > 9) w.moved = true;
      if (spun || beached || crashed) w.stopped += dt;
      else w.stopped = Math.max(0, w.stopped - dt * 2);

      // a car stopped on the road for 1.4 s is an incident; the flags are out
      // while it recovers and for a few seconds afterwards
      if (w.stopped > 1.4 && w.moved && time - w.lastIncident > 8) {
        w.lastIncident = time;
        w.moved = false;
        incidents++;
        incidentClock = 0;
        var sec = sectorAt(car.s);
        sectorFlags[sec] = 'yellow';
        sectorTimer[sec] = 9;
        if (flag === 'green') {
          flag = 'yellow';
          say('Yellow flag \u2014 sector ' + (sec + 1), 'flag');
        }
        history.push({ t: time, kind: 'incident', sector: sec, id: c.id });
      }

      /* track limits for the player are policed by the session (it owns the
         warning UI); here we only accumulate the 4-warning penalty */
      if (car.edge > 1.6) w.off += dt; else w.off = Math.max(0, w.off - dt * 3);
      if (w.off > 3.0) {
        w.off = 0;
        var p = pen(c.id);
        p.warnings++;
        if (p.warnings % 4 === 0 && c.isPlayer) addPenalty(c.id, 5, 'Track limits');
      }

      /* SC delta breach: only the player is policed, the AI obeys the cap */
      if (limit > 0 && c.isPlayer && time > 5) {
        if (speed > limit * 1.35) w.over += dt; else w.over = Math.max(0, w.over - dt);
        if (w.over > 2.5) {
          w.over = 0;
          addPenalty(c.id, 5, 'Safety car delta');
        }
      }
    }

    function canCrash(car) {
      return car.wallContact > 0;
    }

    /* ---------------- deploy / clear ---------------- */
    function deploySC(kind, reason) {
      if (flag === 'sc' || flag === 'red') return;
      flag = 'sc';
      scPhase = 'deploy';
      scTimer = 3.5;
      limit = 40;
      scUses++;
      say(reason, 'flag');
      history.push({ t: time, kind: 'sc', reason: reason });
      // any yellow sectors are cleared once the SC is out
      for (var i = 0; i < SECTORS; i++) { sectorFlags[i] = 'yellow'; sectorTimer[i] = 6; }
    }

    function deployVSC(reason) {
      if (flag === 'red' || flag === 'sc') return;
      flag = 'vsc';
      limit = 45;
      vscTimer = 16;
      sectorFlags[0] = sectorFlags[1] = sectorFlags[2] = 'yellow';
      sectorTimer[0] = sectorTimer[1] = sectorTimer[2] = 4;
      say(reason, 'flag');
      history.push({ t: time, kind: 'vsc', reason: reason });
    }

    function deployRed(reason) {
      flag = 'red';
      redTimer = 8;
      limit = 0;
      say(reason, 'flag');
      history.push({ t: time, kind: 'red', reason: reason });
    }

    /* ---------------- the tick ---------------- */
    function update(dt, ctx) {
      if (!(dt > 0)) return;
      ctx = ctx || {};
      time += dt;
      incidentClock += dt;
      sinceYellow += dt;
      var cars = ctx.cars || [];
      var racing = ctx.state === 'racing' || ctx.state === undefined;

      stepWeather(weather, dt, time);

      /* red flag: everything is frozen, then a rolling restart */
      if (flag === 'red') {
        redTimer -= dt;
        if (redTimer <= 0) {
          flag = 'sc';
          scPhase = 'neutral';
          scTimer = 10;
          limit = 40;
          say('Rolling restart behind the safety car', 'flag');
        }
        return;
      }

      if (racing) {
        for (var i = 0; i < cars.length; i++) trackCar(cars[i], dt);
      }

      /* sector yellows time out */
      for (i = 0; i < SECTORS; i++) {
        if (sectorTimer[i] > 0) {
          sectorTimer[i] -= dt;
          if (sectorTimer[i] <= 0) sectorFlags[i] = 'green';
        }
      }

      /* weather escalations */
      if (weather.wetness > 0.72 && flag === 'green' && scUses < 3 && ctx.state === 'racing') {
        deploySC('sc', 'Safety car \u2014 standing water');
        scUses++;
      }

      var yellowOut = sectorFlags.indexOf('yellow') >= 0;
      yellowT = yellowOut ? yellowT + dt : 0;

      if (flag === 'green' || flag === 'yellow') {
        // a big incident (or several in quick succession) brings out the SC
        if (incidents >= 3 && incidentClock < 20) {
          incidents = 0;
          deploySC('sc', 'Safety car \u2014 incident');
        } else if (flag === 'green' && incidents >= 1 && incidentClock < 18 && rnd() < 0.06) {
          incidents = 0;
          deployVSC('Virtual safety car \u2014 incident');
        } else if (yellowT > 9 && scUses < 3 && time > 30) {
          // a sector that will not clear is a recovery, and that needs the SC
          deploySC('sc', 'Safety car \u2014 recovery');
        } else if (incidentClock > 40) {
          incidents = Math.max(0, incidents - 1);
        }
        if (flag === 'green' || flag === 'yellow') limit = 0;
      }
      if (flag === 'yellow' && !yellowOut) {
        flag = 'green';
        sinceYellow = 0;
        say('Track clear \u2014 green flag', 'flag');
      } else if (flag === 'vsc') {
        limit = 45;
        vscTimer -= dt;
        if (vscTimer <= 0) {
          flag = 'green';
          limit = 0;
          sectorFlags[0] = sectorFlags[1] = sectorFlags[2] = 'green';
          sectorTimer[0] = sectorTimer[1] = sectorTimer[2] = 0;
          say('Virtual safety car in \u2014 green flag', 'flag');
        }
      } else if (flag === 'sc') {
        limit = 40;
        scTimer -= dt;
        if (scPhase === 'deploy' && scTimer <= 0) {
          scPhase = 'neutral';
          scTimer = 12 + Math.random() * 8;
          say('Safety car \u2014 field neutralised', 'flag');
        } else if (scPhase === 'neutral' && scTimer <= 0) {
          scPhase = 'in';
          scTimer = 6;
          say('Safety car in this lap', 'flag');
        } else if (scPhase === 'in' && scTimer <= 0) {
          flag = 'green';
          scPhase = '';
          limit = 0;
          sectorFlags[0] = sectorFlags[1] = sectorFlags[2] = 'green';
          sectorTimer[0] = sectorTimer[1] = sectorTimer[2] = 0;
          say('Green flag \u2014 racing resumes', 'flag');
        }
      }

      // hard stop: the player exceeded the delta too many times under a red
      if (flag === 'green' && scPhase === '') limit = 0;
    }

    function setFlag(f, reason) {
      if (f === 'red') return deployRed(reason || 'Red flag');
      if (f === 'sc') return deploySC('sc', reason || 'Safety car');
      if (f === 'vsc') return deployVSC(reason || 'Virtual safety car');
      if (f === 'yellow') {
        sectorFlags[sectorAt(0)] = 'yellow';
        sectorTimer[0] = 8;
        flag = 'yellow';
        say(reason || 'Yellow flag', 'flag');
        return;
      }
      flag = 'green';
      limit = 0;
      sectorFlags = ['green', 'green', 'green'];
      say(reason || 'Green flag', 'flag');
    }

    return {
      update: update,
      say: say,
      setFlag: setFlag,
      addPenalty: addPenalty,
      penaltyFor: function (id) { return penalties[id] ? penalties[id].time : 0; },
      penaltyInfo: function (id) { return penalties[id] || null; },
      sectorAt: sectorAt,
      get flag() { return flag; },
      get wetness() { return weather.wetness; },
      get limit() { return limit; },
      get sectorFlags() { return sectorFlags; },
      get weather() { return weather; },
      get time() { return time; },
      get scPhase() { return scPhase; },
      get penalties() { return penalties; },
      messages: messages,
      history: history,
      /** the sky state the world should render: dry | overcast | wet */
      skyState: function () { return WX[weather.sky].sky; },
      weatherLabel: function () { return WX[weather.sky].label; },
      weatherIcon: function () { return WX[weather.sky].icon; },
      /** a two-entry forecast for the HUD: [now, later] */
      forecast: function () {
        var i = WX_ORDER.indexOf(weather.sky);
        var later = WX_ORDER[Math.min(3, Math.max(0, i + (Math.random() < 0.5 ? -1 : 1)))];
        return { now: WX[weather.sky], later: WX[later], inMin: Math.max(1, Math.round(weather.nextChange / 60)) };
      }
    };
  }

  F1.racecontrol = { create: create, WX: WX };
})(window.F1 = window.F1 || {});
