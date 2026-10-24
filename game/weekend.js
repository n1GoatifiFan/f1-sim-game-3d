/* ==========================================================================
   F1 2026 — game/weekend.js
   A race weekend as data: practice, qualifying (Q1–Q3), the sprint, the
   grand prix, and the championship points.

   Everything here is deterministic given a seed, so a weekend can be saved
   and reloaded without re-running the sessions: the AI reference laps come
   from the same speed profile the field uses on track.

     var wkd = F1.weekend.create({ circuitId: 'italy', type: 'standard', seed: 'r1' });
     wkd.sessions               // [{ id, label, kind, state, results, ... }]
     wkd.simulate('fp1')        // fill in the AI times
     wkd.setPlayerTime('q1', 81.4)
     wkd.grid()                 // ordered driver ids for the race
     wkd.points(1)              // 25
   ========================================================================== */
(function (F1) {
  'use strict';

  var POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
  var SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1];

  var PLANS = {
    standard: [
      { id: 'fp1', label: 'Free Practice 1', kind: 'practice', minutes: 60 },
      { id: 'fp2', label: 'Free Practice 2', kind: 'practice', minutes: 60 },
      { id: 'fp3', label: 'Free Practice 3', kind: 'practice', minutes: 60 },
      { id: 'q1', label: 'Qualifying Q1', kind: 'quali', minutes: 18, knockouts: 5 },
      { id: 'q2', label: 'Qualifying Q2', kind: 'quali', minutes: 15, knockouts: 5 },
      { id: 'q3', label: 'Qualifying Q3', kind: 'quali', minutes: 12, knockouts: 0 },
      { id: 'race', label: 'Grand Prix', kind: 'race', laps: 'full' }
    ],
    sprint: [
      { id: 'fp1', label: 'Free Practice 1', kind: 'practice', minutes: 60 },
      { id: 'sq', label: 'Sprint Qualifying', kind: 'quali', minutes: 12, knockouts: 0 },
      { id: 'sprint', label: 'Sprint', kind: 'sprint', laps: 'sprint' },
      { id: 'q1', label: 'Qualifying Q1', kind: 'quali', minutes: 18, knockouts: 5 },
      { id: 'q2', label: 'Qualifying Q2', kind: 'quali', minutes: 15, knockouts: 5 },
      { id: 'q3', label: 'Qualifying Q3', kind: 'quali', minutes: 12, knockouts: 0 },
      { id: 'race', label: 'Grand Prix', kind: 'race', laps: 'full' }
    ]
  };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ------------------------------------------------------------------ */
  /* reference pace                                                     */
  /* ------------------------------------------------------------------ */
  /* One speed profile per car, on the weekend's circuit. Cached per circuit
     because 22 profiles is about a third of a second of work. */
  var PACE_CACHE = {};

  function referenceLaps(track, opts) {
    opts = opts || {};
    if (PACE_CACHE[track.id] && !opts.force) return PACE_CACHE[track.id];
    var out = {};
    var cars = [];
    F1.DATA.drivers.forEach(function (d) {
      var spec = F1.vehicle.specFor(d.team, d.id);
      var car = F1.vehicle.create(track, spec, { compound: 'soft', fuel: 40 });
      var prof = F1.ai.profile(track, car, { grip: 1.75 });
      var skill = clamp(0.945 + (F1.DATA.driverOverall(d) - 82) * 0.0032, 0.90, 0.999);
      // qualifying pace: softs, low fuel, everything on the limit
      out[d.id] = prof.lapTime * (1.013 - skill * 0.02);
      cars.push({ id: d.id, lap: out[d.id] });
    });
    var fastest = Math.min.apply(null, cars.map(function (c) { return c.lap; }));
    cars.forEach(function (c) { c.gap = c.lap - fastest; });
    PACE_CACHE[track.id] = { laps: out, fastest: fastest, class: cars };
    return PACE_CACHE[track.id];
  }

  function clearCache() { PACE_CACHE = {}; }

  /* ------------------------------------------------------------------ */
  /* one session                                                        */
  /* ------------------------------------------------------------------ */
  function baseSession(def, state) {
    return {
      id: def.id,
      label: def.label,
      kind: def.kind,
      minutes: def.minutes || 0,
      knockouts: def.knockouts || 0,
      laps: def.laps || 0,
      state: state || 'pending',      // pending | running | done
      results: null,                  // [{ pos, id, teamId, time, gap, laps }]
      playerId: null
    };
  }

  /* A simulated lap for an AI driver: reference pace, plus a session-to-session
     wobble, plus a small chance of a mistake (a dirty lap). */
  function simulatedLap(ref, driverId, sessionKind, rnd, track) {
    var base = ref.laps[driverId] || ref.fastest;
    var wobble = (rnd() - 0.5) * 0.9;
    var mistake = rnd() < 0.14 ? 0.35 + rnd() * 1.4 : 0;
    var kindMul = sessionKind === 'practice' ? 1.012
      : sessionKind === 'race' ? 1.006
        : 1.0;
    return (base + wobble + mistake) * kindMul;
  }

  /* ------------------------------------------------------------------ */
  /* the weekend                                                        */
  /* ------------------------------------------------------------------ */
  function create(opts) {
    opts = opts || {};
    var circuitId = opts.circuitId || 'italy';
    var meta = F1.DATA.getCircuitMeta(circuitId);
    var track = F1.getTrack(circuitId);
    var type = opts.type || (meta.sprint ? 'sprint' : 'standard');
    var plan = PLANS[type] || PLANS.standard;
    var rnd = F1.rng(F1.rng.string(opts.seed || (circuitId + '|wkd')));
    var playerId = opts.playerId || F1.DATA.drivers[0].id;
    var playerTeamId = opts.teamId || F1.DATA.getDriver(playerId).team;

    var ref = referenceLaps(track);

    var sessions = plan.map(function (def) { return baseSession(def); });
    var byId = {};
    sessions.forEach(function (s) { byId[s.id] = s; });

    /* the full race distance, scaled by the race-length setting */
    var raceLaps = Math.max(3, Math.round(meta.laps * (opts.raceLength === undefined ? 1 : opts.raceLength)));
    var sprintLaps = Math.max(3, Math.round(meta.laps * 0.34));

    /* ---------------- knock-out eligibility ---------------- */
    /* Q1 runs the whole field, Q2 the fastest 15, Q3 the fastest 10. A driver
       knocked out in Q1 never appears in Q2 — including the player. */
    function inSession(id, driverId) {
      if (id === 'q3') {
        var q2 = byId.q2;
        return !!(q2 && q2.results && q2.results.slice(0, 10).some(function (r) { return r.id === driverId; }));
      }
      if (id === 'q2') {
        var q1 = byId.q1;
        return !!(q1 && q1.results && q1.results.slice(0, 15).some(function (r) { return r.id === driverId; }));
      }
      return true;
    }

    /* ---------------- simulation ---------------- */
    function simulate(id, playerTime, playerNote) {
      var ses = byId[id];
      if (!ses) return null;
      var rows = [];
      F1.DATA.drivers.forEach(function (d) {
        if (ses.kind === 'quali' && !inSession(id, d.id)) return;
        var isPlayer = d.id === playerId;
        var t;
        if (isPlayer) {
          // the player's own lap if they set one, otherwise their car's pace
          t = playerTime && playerTime > 0 ? playerTime
            : (ref.laps[d.id] || ref.fastest) + 0.9 + rnd() * 0.8;
        } else {
          t = simulatedLap(ref, d.id, ses.kind, rnd, track);
        }
        rows.push({ id: d.id, teamId: d.team, time: +t.toFixed(3), isPlayer: !!isPlayer, note: isPlayer ? playerNote : '' });
      });
      rows.sort(function (a, b) { return a.time - b.time; });
      var lead = rows[0].time;
      rows.forEach(function (r, i) {
        r.pos = i + 1;
        r.gap = +(r.time - lead).toFixed(3);
        if (r.isPlayer) ses.playerPos = r.pos;
      });
      ses.results = rows;
      ses.state = 'done';
      var mine = rows.filter(function (r) { return r.isPlayer; })[0];
      ses.playerTime = mine ? (playerTime || mine.time) : 0;
      ses.playerPos = mine ? mine.pos : 0;
      return rows;
    }

    /* qualifying is a knock-out: only the cars that survived the last phase
       take part in the next one, the rest are already classified */
    function qualiGrid() {
      var last = byId.q3 && byId.q3.results ? byId.q3
        : byId.q2 && byId.q2.results ? byId.q2
          : byId.q1 && byId.q1.results ? byId.q1 : (byId.sq && byId.sq.results ? byId.sq : null);
      if (!last) return null;
      var order = [];
      var seen = {};
      ['q3', 'q2', 'q1', 'sq'].forEach(function (qid) {
        var s = byId[qid];
        if (!s || !s.results) return;
        s.results.forEach(function (r) {
          if (!seen[r.id]) { seen[r.id] = true; order.push(r); }
        });
      });
      return order;
    }

    function grid() {
      var q = qualiGrid();
      if (!q) {
        // no qualifying yet: championship-style order
        return F1.field.buildGrid(circuitId + '|grid').map(function (s) { return s.driverId; });
      }
      return q.map(function (r) { return r.id; });
    }

    /* ---------------- championship points ---------------- */
    function points(pos, sprint) {
      var table = sprint ? SPRINT_POINTS : POINTS;
      return pos >= 1 && pos <= table.length ? table[pos - 1] : 0;
    }

    /* ---------------- session result → race classification ---------------- */
    function classifyRace(raceResults) {
      return raceResults.map(function (r, i) {
        return {
          pos: i + 1,
          id: r.id,
          teamId: r.teamId,
          laps: r.laps,
          time: r.time,
          gap: r.gap,
          points: points(i + 1, false),
          isPlayer: r.id === playerId,
          retired: !!r.retired
        };
      });
    }

    function nextPending() {
      for (var i = 0; i < sessions.length; i++) {
        if (sessions[i].state !== 'done') return sessions[i];
      }
      return null;
    }

    function progress() {
      var done = 0;
      sessions.forEach(function (s) { if (s.state === 'done') done++; });
      return done / sessions.length;
    }

    /* the session lap count for the two race sessions */
    function lapsFor(sesId) {
      if (sesId === 'sprint') return sprintLaps;
      return raceLaps;
    }

    return {
      circuitId: circuitId,
      meta: meta,
      type: type,
      track: track,
      sessions: sessions,
      session: function (id) { return byId[id]; },
      byId: byId,
      playerId: playerId,
      teamId: playerTeamId,
      reference: ref,
      raceLaps: raceLaps,
      sprintLaps: sprintLaps,
      simulate: simulate,
      grid: grid,
      qualiGrid: qualiGrid,
      points: points,
      classifyRace: classifyRace,
      lapsFor: lapsFor,
      nextPending: nextPending,
      progress: progress,
      update: function (id, patch) {
        var s = byId[id];
        if (!s) return null;
        for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) s[k] = patch[k];
        return s;
      }
    };
  }

  F1.weekend = {
    create: create,
    PLANS: PLANS,
    POINTS: POINTS,
    SPRINT_POINTS: SPRINT_POINTS,
    referenceLaps: referenceLaps,
    clearCache: clearCache
  };
})(window.F1 = window.F1 || {});
