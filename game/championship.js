/* ==========================================================================
   F1 2026 — game/championship.js
   A custom championship: pick any driver, pick the rounds you want, and every
   other car is simulated from the same reference pace the weekend uses, so the
   standings stay consistent with qualifying order.

   Career mode is the story version of this (contracts, credits, R&D). This one
   is deliberately thin: a calendar, points, and three tables.
   ========================================================================== */
(function (F1) {
  'use strict';

  var D = F1.DATA;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function pointsFor(pos, sprint) {
    var table = sprint ? F1.weekend.SPRINT_POINTS : F1.weekend.POINTS;
    return pos >= 1 && pos <= table.length ? table[pos - 1] : 0;
  }

  function create(opts) {
    opts = opts || {};
    var driverId = opts.driverId || 'norris';
    var driver = D.getDriver(driverId) || D.drivers[0];
    var teamId = opts.teamId || driver.team;
    var circuits = (opts.circuits && opts.circuits.length ? opts.circuits : D.activeCalendar(!!opts.includeCancelled).map(function (m) { return m.id; })).slice();

    var points = {}, teamPoints = {};
    D.drivers.forEach(function (dr) { points[dr.id] = 0; });
    D.teams.forEach(function (t) { teamPoints[t.id] = 0; });
    points[driverId] = points[driverId] || 0;
    void teamId;

    return {
      seed: opts.seed || (Math.random() * 1e9) | 0,
      driverId: driverId,
      teamId: teamId,
      circuits: circuits,
      round: 0,
      sprints: opts.sprints !== false,
      lapsScale: opts.lapsScale || 0.25,
      points: points,
      teamPoints: teamPoints,
      results: [],
      created: Date.now()
    };
  }

  function isSprint(champ, circuitId) {
    if (!champ.sprints) return false;
    var meta = D.getCircuitMeta(circuitId);
    return !!(meta && meta.sprint);
  }

  /* every other car gets a lap from the reference pace plus form noise */
  function simulateField(champ, circuitId, me, myPos) {
    var ref = F1.weekend.referenceLaps(F1.getTrack(circuitId));
    var rnd = F1.rng(F1.rng.string(champ.seed + '|' + circuitId + '|' + champ.results.length));
    var rows = [];
    D.drivers.forEach(function (d) {
      // the championship standings nudge the simulation a little each round
      var standing = (champ.points[d.id] || 0) * 0.0004;
      var t = (ref.laps[d.id] || ref.fastest) + (rnd() - 0.5) * 0.9 - standing;
      rows.push({ id: d.id, team: d.team, t: t });
    });
    rows.sort(function (a, b) { return a.t - b.t; });
    rows.splice(clamp(myPos - 1, 0, rows.length), 0,
      { id: me, team: champ.teamId, t: ref.fastest + (myPos - 1) * 0.4 });

    var field = [];
    for (var i = 0; i < rows.length; i++) {
      var pos = i + 1;
      var p = pointsFor(pos, false);
      if (rows[i].id !== me) {
        champ.points[rows[i].id] = (champ.points[rows[i].id] || 0) + p;
        champ.teamPoints[rows[i].team] = (champ.teamPoints[rows[i].team] || 0) + p;
      }
      field.push({ pos: pos, id: rows[i].id, teamId: rows[i].team });
    }
    return field;
  }

  /* result: { pos, retired } — sprint points are simulated from race pace */
  function advance(champ, circuitId, result) {
    result = result || {};
    var meta = D.getCircuitMeta(circuitId);
    var pos = result.pos || 18;
    var sprint = isSprint(champ, circuitId);
    var rnd = F1.rng(F1.rng.string(champ.seed + '|s|' + circuitId));
    var sprintPos = sprint ? clamp(pos + Math.round((rnd() - 0.5) * 6), 1, 22) : 0;

    var gpPoints = result.retired ? 0 : pointsFor(pos, false);
    var sprintPoints = sprintPos ? pointsFor(sprintPos, true) : 0;
    var total = gpPoints + sprintPoints;

    champ.points[champ.driverId] = (champ.points[champ.driverId] || 0) + total;
    champ.teamPoints[champ.teamId] = (champ.teamPoints[champ.teamId] || 0) + total;

    var field = simulateField(champ, circuitId, champ.driverId, result.retired ? 22 : pos);
    champ.results.push({
      round: meta ? meta.round : champ.results.length + 1,
      circuit: circuitId,
      pos: result.retired ? 0 : pos,
      sprintPos: sprintPos,
      points: total,
      retired: !!result.retired,
      field: field
    });
    champ.round = champ.results.length;
    return champ.results[champ.results.length - 1];
  }

  function driverTable(champ) {
    var list = Object.keys(champ.points).map(function (id) {
      var d = D.driverById[id];
      return {
        id: id,
        code: d ? d.code : id.slice(0, 3).toUpperCase(),
        name: d ? d.name : id,
        team: d ? d.team : null,
        teamObj: d ? D.getTeam(d.team) : null,
        points: champ.points[id] || 0,
        me: id === champ.driverId
      };
    });
    list.sort(function (a, b) { return b.points - a.points || (a.code < b.code ? -1 : 1); });
    list.forEach(function (r, i) { r.pos = i + 1; });
    return list;
  }

  function teamTable(champ) {
    var list = Object.keys(champ.teamPoints).map(function (id) {
      return { id: id, team: D.getTeam(id), points: champ.teamPoints[id] || 0, me: id === champ.teamId };
    });
    list.sort(function (a, b) { return b.points - a.points; });
    list.forEach(function (r, i) { r.pos = i + 1; });
    return list;
  }

  function nextCircuit(champ) {
    return champ.round >= champ.circuits.length ? null : champ.circuits[champ.round];
  }

  function winner(champ, table) {
    return table[0] || null;
  }

  function progress(champ) {
    return {
      round: champ.round,
      total: champ.circuits.length,
      complete: champ.round >= champ.circuits.length,
      leader: driverTable(champ)[0]
    };
  }

  function save(champ) { F1.storage.set('champ_active', champ); return true; }
  function load() { return F1.storage.get('champ_active', null); }
  function clear() { F1.storage.remove('champ_active'); }

  F1.championship = {
    create: create,
    advance: advance,
    driverTable: driverTable,
    teamTable: teamTable,
    nextCircuit: nextCircuit,
    isSprint: isSprint,
    winner: winner,
    progress: progress,
    pointsFor: pointsFor,
    save: save,
    load: load,
    clear: clear
  };
})(window.F1 = window.F1 || {});
