/* ==========================================================================
   F1 2026 — game/career.js
   Career mode: a driver, a contract, a season, an R&D programme and a market.

   A career is a plain JSON object so it can be written to localStorage, copied
   to a slot or exported to a file without any conversion. Everything here is
   deterministic from the career's seed, so a reloaded save continues exactly
   where it stopped.

     var c = F1.career.create({
       name: 'A. Driver', code: 'DRV', country: 'FR', teamId: 'mclaren',
       mode: 'create'          // 'create' | 'real'
     });
     F1.career.save(c, 1);                  // slot 1..3
     F1.career.list();                      // [{ slot, ...summary }]
     F1.career.load(1);
     F1.career.exportText(c);               // JSON string
     F1.career.importText(text);

     F1.career.advance(c, 'italy', result);  // after a round
     F1.career.invest(c, 'aero');
     F1.career.sign(c, 'leclerc', 'mercedes');
   ========================================================================== */
(function (F1) {
  'use strict';

  var SLOTS = 3;
  var KEY = 'career_slot_';
  var MAX_SEASONS = 10;

  /* R&D departments. Each level costs credits and buys a small, permanent
     performance bump for the player's team — the same numbers the physics
     reads from team.performance. */
  var RD = {
    aero: { label: 'Aerodynamics', cost: 340, step: 1.1, unit: 'aero', desc: 'Floor, wings and diffuser. Downforce and balance.' },
    power: { label: 'Power unit', cost: 320, step: 1.1, unit: 'power', desc: 'Combustion and the electric side of the 2026 unit.' },
    chassis: { label: 'Chassis', cost: 300, step: 1.0, unit: 'chassis', desc: 'Weight, stiffness and the mechanical platform.' },
    reliability: { label: 'Reliability', cost: 220, step: 1.2, unit: 'reliability', desc: 'Fewer retirements, fewer grid penalties.' },
    pitcrew: { label: 'Pit crew', cost: 180, step: 0.02, unit: 'pitStop', desc: 'Faster stops: 0.02 s per level.' }
  };

  var OBJECTIVES = {
    rookie: { label: 'Rookie', points: 6, desc: 'Score points and keep the car on the road.', bonus: 400 },
    midfield: { label: 'Midfield', points: 40, desc: 'Be a regular in the top ten.', bonus: 700 },
    podium: { label: 'Podium', points: 120, desc: 'Fight for podiums.', bonus: 1200 },
    title: { label: 'Title', points: 220, desc: 'Win the championship.', bonus: 2500 }
  };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ------------------------------------------------------------------ */
  /* creation                                                           */
  /* ------------------------------------------------------------------ */
  function teamStrength(teamId) {
    var p = F1.DATA.getTeam(teamId).performance;
    return (p.aero + p.power + p.chassis) / 3;
  }

  /* the deal a rookie can get: better teams want better drivers */
  function offers(rating) {
    var list = F1.DATA.teams.map(function (t) {
      var strength = teamStrength(t.id);
      // a team of strength S will talk to a driver of rating >= S - 8
      var reach = strength - 8;
      return {
        teamId: t.id,
        strength: +strength.toFixed(1),
        interested: rating >= reach,
        salary: Math.round((strength - 55) * 26 + rating * 9),
        seat: (t.drivers && t.drivers.length < 2) ? 2 : 1
      };
    });
    list.sort(function (a, b) { return b.strength - a.strength; });
    return list;
  }

  function makeDriverIdentity(opts) {
    var countries = ['FR', 'GB', 'IT', 'DE', 'ES', 'NL', 'BR', 'JP', 'AU', 'US', 'CA', 'MX', 'FI', 'DK', 'SE', 'AR', 'NZ', 'ZA'];
    var name = (opts.name || 'New Driver').trim().slice(0, 28);
    var parts = name.split(/\s+/);
    var last = parts.length > 1 ? parts[parts.length - 1] : name;
    var code = (opts.code || last.slice(0, 3)).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    if (code.length < 3) code = (code + 'XYZ').slice(0, 3);
    return {
      name: name,
      code: code,
      country: opts.country || countries[Math.floor(name.length % countries.length)],
      number: opts.number || (2 + (name.length * 7) % 97),
      age: opts.age || 19
    };
  }

  function create(opts) {
    opts = opts || {};
    var mode = opts.mode || 'create';
    var teamId = opts.teamId || 'cadillac';
    var rating = opts.rating === undefined ? 76 : opts.rating;
    var id = opts.id || ('player_' + Date.now().toString(36));
    var realId = null;
    var identity;

    if (mode === 'real') {
      var d = F1.DATA.getDriver(opts.driverId || F1.DATA.drivers[0].id);
      realId = d.id;
      teamId = d.team;
      rating = F1.DATA.driverOverall(d);
      identity = { name: d.name, code: d.code, country: d.countryCode, number: d.number || 1, age: d.age || 26 };
    } else {
      identity = makeDriverIdentity(opts);
    }

    var seed = opts.seed || (id + '|' + Date.now());
    var rnd = F1.rng(F1.rng.string(seed));
    var calendar = F1.DATA.activeCalendar(!!opts.includeCancelled).map(function (m) { return m.id; });

    /* a season of results, filled in round by round */
    var standingsInit = function () {
      var out = {};
      F1.DATA.drivers.forEach(function (dr) { out[dr.id] = 0; });
      out[id] = 0;
      if (realId) delete out[realId];
      return out;
    };

    var career = {
      version: 1,
      id: id,
      mode: mode,
      seed: seed,
      created: Date.now(),
      identity: identity,
      realDriverId: realId,
      rating: rating,
      teamId: teamId,
      contract: {
        teamId: teamId,
        seasons: opts.contractSeasons || 1 + Math.floor(rnd() * 2),
        seasonsLeft: opts.contractSeasons || 1 + Math.floor(rnd() * 2),
        salary: Math.round((teamStrength(teamId) - 55) * 26 + rating * 9),
        objective: rating > 88 ? 'title' : rating > 82 ? 'podium' : rating > 76 ? 'midfield' : 'rookie',
        bonus: 0
      },
      season: 1,
      round: 0,
      credits: opts.credits === undefined ? 900 : opts.credits,
      reputation: rating,
      calendar: calendar,
      results: [],                     // [{ round, circuit, pos, points, sprintPos }]
      points: standingsInit(),
      teamPoints: {},
      rnd: { aero: 0, power: 0, chassis: 0, reliability: 0, pitcrew: 0 },
      history: [],                     // one entry per finished season
      market: [],                      // pending offers at season end
      flags: { retired: false, champion: false }
    };
    F1.DATA.teams.forEach(function (t) { career.teamPoints[t.id] = 0; });
    return career;
  }

  /* ------------------------------------------------------------------ */
  /* points and standings                                               */
  /* ------------------------------------------------------------------ */
  function pointsFor(pos, sprint) {
    var table = sprint ? F1.weekend.SPRINT_POINTS : F1.weekend.POINTS;
    return pos >= 1 && pos <= table.length ? table[pos - 1] : 0;
  }

  function driverIdOf(career) { return career.realDriverId || career.id; }

  /* ------------------------------------------------------------------ */
  /* a round                                                            */
  /* ------------------------------------------------------------------ */
  /* result: { pos, sprintPos, retired, fastestLap } from a race session */
  function advance(career, circuitId, result) {
    result = result || {};
    var meta = F1.DATA.getCircuitMeta(circuitId);
    var me = driverIdOf(career);
    var sprint = !!meta.sprint;
    var pos = result.pos || 18;
    var sprintPos = result.sprintPos || 0;

    var gpPoints = pointsFor(pos, false);
    var sprintPoints = sprint && sprintPos ? pointsFor(sprintPos, true) : 0;
    var bonus = 0;
    // fastest lap is deliberately NOT a point (2026 regulations)
    if (result.pole) bonus += 0;

    career.points[me] = (career.points[me] || 0) + gpPoints + sprintPoints;
    career.teamPoints[career.teamId] = (career.teamPoints[career.teamId] || 0) + gpPoints + sprintPoints;

    career.results.push({
      round: meta.round,
      circuit: circuitId,
      pos: pos,
      sprintPos: sprintPos || 0,
      points: gpPoints + sprintPoints,
      retired: !!result.retired,
      season: career.season
    });
    career.round++;

    /* credits: a race fee scaled by the finish, sponsorship and a bonus for
       beating the objective */
    var fee = 120 + Math.max(0, 20 - pos) * 22;
    if (pos <= 3) fee += 180;
    if (pos === 1) fee += 220;
    career.credits += fee;
    career.reputation = clamp(career.reputation + (pos <= 3 ? 0.6 : pos <= 10 ? 0.2 : -0.15), 40, 99);
    career.contract.seasonsLeft = Math.max(0, career.contract.seasonsLeft);

    /* simulate the rest of the field so the standings are real */
    simulateOthers(career, circuitId, me, pos);

    var finished = career.results.filter(function (r) { return r.season === career.season && r.circuit === circuitId; }).length > 0;
    if (career.round >= career.calendar.length && finished) endSeason(career);
    return career.results[career.results.length - 1];
  }

  /* every other driver gets a result from the same reference pace the weekend
     uses, so the championship table is consistent with qualifying */
  function simulateOthers(career, circuitId, me, myPos) {
    var ref = F1.weekend.referenceLaps(F1.getTrack(circuitId));
    var rnd = F1.rng(F1.rng.string(career.seed + '|' + circuitId + '|' + career.season));
    var rows = [];
    F1.DATA.drivers.forEach(function (d) {
      if (d.id === me) return;
      var t = (ref.laps[d.id] || ref.fastest) + (rnd() - 0.5) * 0.8;
      rows.push({ id: d.id, team: d.team, t: t });
    });
    rows.sort(function (a, b) { return a.t - b.t; });
    // insert the player at their finishing position, pushing the rest down
    var insertAt = clamp(myPos - 1, 0, rows.length);
    rows.splice(insertAt, 0, { id: me, team: career.teamId, t: ref.fastest + (myPos - 1) * 0.4 });

    for (var i = 0; i < rows.length; i++) {
      // the player's points (and any sprint points) were already banked
      if (rows[i].id === me) continue;
      var p = pointsFor(i + 1, false);
      career.points[rows[i].id] = (career.points[rows[i].id] || 0) + p;
      career.teamPoints[rows[i].team] = (career.teamPoints[rows[i].team] || 0) + p;
    }
    career._lastField = rows.map(function (r, i) { return { pos: i + 1, id: r.id, teamId: r.team }; });
  }

  /* ------------------------------------------------------------------ */
  /* season end: objectives, R&D carry-over, market                     */
  /* ------------------------------------------------------------------ */
  function driverTable(career) {
    var list = Object.keys(career.points).map(function (id) {
      var d = F1.DATA.driverById[id];
      return {
        id: id, points: career.points[id],
        team: d ? d.team : (id === driverIdOf(career) ? career.teamId : ''),
        code: d ? d.code : career.identity.code,
        name: d ? d.name : career.identity.name,
        me: id === driverIdOf(career)
      };
    });
    list.sort(function (a, b) { return b.points - a.points || (a.code < b.code ? -1 : 1); });
    list.forEach(function (r, i) { r.pos = i + 1; });
    return list;
  }

  function teamTable(career) {
    var list = Object.keys(career.teamPoints).map(function (id) {
      return { id: id, team: F1.DATA.getTeam(id), points: career.teamPoints[id] };
    });
    list.sort(function (a, b) { return b.points - a.points; });
    list.forEach(function (r, i) { r.pos = i + 1; });
    return list;
  }

  function endSeason(career) {
    var table = driverTable(career);
    var mine = table.filter(function (r) { return r.me; })[0];
    var obj = OBJECTIVES[career.contract.objective] || OBJECTIVES.midfield;
    var achieved = mine && mine.points >= obj.points;
    var champion = mine && mine.pos === 1;
    var bonus = achieved ? obj.bonus : 0;
    var prize = Math.round(600 + (mine ? (23 - mine.pos) * 40 : 0) + (champion ? 1200 : 0));

    career.credits += bonus + prize;
    career.contract.bonus += bonus;
    career.flags.champion = career.flags.champion || champion;
    career.history.push({
      season: career.season,
      pos: mine ? mine.pos : 22,
      points: mine ? mine.points : 0,
      teamId: career.teamId,
      champion: champion,
      objectiveMet: achieved,
      prize: prize + bonus,
      teamPos: (teamTable(career).filter(function (t) { return t.id === career.teamId; })[0] || {}).pos || 0
    });

    /* the team's development level carries into the next car */
    var devSeed = F1.DATA.getTeam(career.teamId).performance.development || 80;
    career.contract.seasonsLeft--;
    career.market = makeMarket(career, mine ? mine.pos : 20);
    career.season++;
    career.round = 0;
    career.results = [];
    career.points = {};
    F1.DATA.drivers.forEach(function (dr) { career.points[dr.id] = 0; });
    career.points[driverIdOf(career)] = 0;
    if (career.realDriverId) delete career.points[career.realDriverId];
    F1.DATA.teams.forEach(function (t) { career.teamPoints[t.id] = 0; });
    career._devSeed = devSeed;
    return career.history[career.history.length - 1];
  }

  /* contract offers at the end of a season: the better you finished, the
     better the seat somebody will offer */
  function makeMarket(career, seasonPos) {
    var rnd = F1.rng(F1.rng.string(career.seed + '|market|' + career.season));
    var strength = 74 + (22 - clamp(seasonPos, 1, 22)) * 0.9 + career.reputation * 0.12;
    var out = [];
    F1.DATA.teams.forEach(function (t) {
      var s = teamStrength(t.id);
      if (s > strength + 6) return;
      out.push({
        teamId: t.id,
        strength: +s.toFixed(1),
        salary: Math.round((s - 55) * 26 + career.reputation * 9),
        seasons: (rnd() < 0.5 ? 1 : 2) + (rnd() < 0.25 ? 1 : 0),
        objective: s > 88 ? 'title' : s > 82 ? 'podium' : s > 76 ? 'midfield' : 'rookie'
      });
    });
    // always keep the current team in the list, even after a bad year
    if (!out.some(function (o) { return o.teamId === career.teamId; })) {
      var cur = F1.DATA.getTeam(career.teamId);
      out.push({
        teamId: cur.id, strength: +teamStrength(cur.id).toFixed(1),
        salary: career.contract.salary, seasons: 1,
        objective: career.contract.objective, current: true
      });
    }
    out.sort(function (a, b) { return b.strength - a.strength; });
    return out.slice(0, 6);
  }

  function sign(career, teamId, offer) {
    var o = offer || (career.market || []).filter(function (x) { return x.teamId === teamId; })[0];
    if (!o) return false;
    career.teamId = teamId;
    career.contract = {
      teamId: teamId,
      seasons: o.seasons || 1,
      seasonsLeft: o.seasons || 1,
      salary: o.salary,
      objective: o.objective || 'midfield',
      bonus: 0
    };
    career.market = [];
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* R&D                                                                */
  /* ------------------------------------------------------------------ */
  function rdCost(career, key) {
    var def = RD[key];
    if (!def) return Infinity;
    var level = career.rnd[key] || 0;
    return Math.round(def.cost * (1 + level * 0.55));
  }

  function invest(career, key) {
    var def = RD[key];
    if (!def) return { ok: false, reason: 'unknown department' };
    var level = career.rnd[key] || 0;
    if (level >= 8) return { ok: false, reason: 'maxed out' };
    var cost = rdCost(career, key);
    if (career.credits < cost) return { ok: false, reason: 'not enough credits' };
    career.credits -= cost;
    career.rnd[key] = level + 1;
    F1.career.applyRnd(career);
    return { ok: true, level: level + 1, cost: cost };
  }

  /* the R&D levels are the single source of the team's ratings while a career
     is active: base rating + level, so the physics really does get faster */
  function applyRnd(career) {
    var team = F1.DATA.getTeam(career.teamId);
    if (!team._basePerf) team._basePerf = F1.util.clone(team.performance);
    var base = team._basePerf;
    team.performance.aero = Math.round(clamp(base.aero + career.rnd.aero * RD.aero.step, 0, 110));
    team.performance.power = Math.round(clamp(base.power + career.rnd.power * RD.power.step, 0, 110));
    team.performance.chassis = Math.round(clamp(base.chassis + career.rnd.chassis * RD.chassis.step, 0, 110));
    team.performance.reliability = Math.round(clamp(base.reliability + career.rnd.reliability * RD.reliability.step, 0, 110));
    team.perfModified = true;
    return team.performance;
  }

  function resetRnd() {
    F1.DATA.teams.forEach(function (t) {
      if (t._basePerf) {
        t.performance = F1.util.clone(t._basePerf);
        t._basePerf = null;
        t.perfModified = false;
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* saves                                                              */
  /* ------------------------------------------------------------------ */
  function slotKey(slot) { return KEY + slot; }

  function save(career, slot) {
    slot = clamp(slot || 1, 1, SLOTS);
    var payload = { savedAt: Date.now(), career: career };
    F1.storage.set(slotKey(slot), payload);
    F1.storage.set('career_active', slot);
    return payload;
  }

  function load(slot) {
    var payload = F1.storage.get(slotKey(slot), null);
    if (!payload || !payload.career) return null;
    var c = payload.career;
    // forward-compatible defaults for saves written by an older build
    c.rnd = c.rnd || { aero: 0, power: 0, chassis: 0, reliability: 0, pitcrew: 0 };
    c.market = c.market || [];
    c.history = c.history || [];
    c.results = c.results || [];
    if (!c.calendar || !c.calendar.length) {
      c.calendar = F1.DATA.activeCalendar(false).map(function (m) { return m.id; });
    }
    if (c.rnd && (c.rnd.aero || c.rnd.power || c.rnd.chassis)) applyRnd(c);
    return c;
  }

  function clear(slot) {
    F1.storage.remove(slotKey(slot));
  }

  function list() {
    var out = [];
    for (var i = 1; i <= SLOTS; i++) {
      var payload = F1.storage.get(slotKey(i), null);
      if (!payload || !payload.career) { out.push({ slot: i, empty: true }); continue; }
      var c = payload.career;
      var table = driverTable(c);
      var mine = table.filter(function (r) { return r.me; })[0];
      out.push({
        slot: i,
        empty: false,
        savedAt: payload.savedAt,
        name: c.identity.name,
        code: c.identity.code,
        teamId: c.teamId,
        team: F1.DATA.getTeam(c.teamId).short,
        season: c.season,
        round: c.round,
        races: c.calendar.length,
        pos: mine ? mine.pos : null,
        points: mine ? mine.points : 0,
        credits: c.credits
      });
    }
    return out;
  }

  function exportText(career) {
    return JSON.stringify({ format: 'f1-2026-career', version: 1, career: career }, null, 2);
  }

  function importText(text) {
    var obj = null;
    try { obj = JSON.parse(text); } catch (e) { return { ok: false, reason: 'not valid JSON' }; }
    var c = obj && obj.career ? obj.career : obj;
    if (!c || !c.identity || !c.calendar) return { ok: false, reason: 'not a career file' };
    c.rnd = c.rnd || { aero: 0, power: 0, chassis: 0, reliability: 0, pitcrew: 0 };
    c.market = c.market || [];
    c.history = c.history || [];
    c.results = c.results || [];
    return { ok: true, career: c };
  }

  /* ------------------------------------------------------------------ */
  /* next event                                                         */
  /* ------------------------------------------------------------------ */
  function nextCircuit(career) {
    if (career.round >= career.calendar.length) return null;
    return F1.DATA.getCircuitMeta(career.calendar[career.round]);
  }

  function progress(career) {
    return career.calendar.length ? career.round / career.calendar.length : 0;
  }

  F1.career = {
    create: create,
    advance: advance,
    save: save,
    load: load,
    clear: clear,
    list: list,
    exportText: exportText,
    importText: importText,
    invest: invest,
    rdCost: rdCost,
    applyRnd: applyRnd,
    resetRnd: resetRnd,
    sign: sign,
    offers: offers,
    driverTable: driverTable,
    teamTable: teamTable,
    nextCircuit: nextCircuit,
    progress: progress,
    driverIdOf: driverIdOf,
    pointsFor: pointsFor,
    RD: RD,
    OBJECTIVES: OBJECTIVES,
    SLOTS: SLOTS,
    MAX_SEASONS: MAX_SEASONS
  };
})(window.F1 = window.F1 || {});
