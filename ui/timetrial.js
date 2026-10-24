/* ==========================================================================
   F1 2026 — ui/timetrial.js
   Time trial: one car, one circuit, and the best lap you have ever done there
   chasing you round as a translucent ghost.

   The ghost is the pose trace the race session records for every lap (10 Hz of
   position and heading). It is stored per circuit in localStorage, so it
   survives a reload and does not need a video or a second car.
   ========================================================================== */
(function (F1) {
  'use strict';

  var U = F1.ui;
  var T = F1.util;
  var D = F1.DATA;
  var KEY = 'tt_';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function best(circuit) {
    return F1.storage.get(KEY + circuit, null);
  }

  function store(circuit, ghost) {
    if (!ghost || !ghost.pts || ghost.pts.length < 5) return false;
    var prev = best(circuit);
    if (prev && prev.time && prev.time <= ghost.time) return false;
    F1.storage.set(KEY + circuit, { time: ghost.time, pts: ghost.pts, at: Date.now() });
    return true;
  }

  function leaderboardModel() {
    var out = [];
    D.activeCalendar(!!F1.settings.gameplay.includeCancelled).forEach(function (m) {
      var b = best(m.id);
      if (b) out.push({ circuit: m.id, name: m.name, time: b.time, at: b.at });
    });
    out.sort(function (a, b) { return a.time - b.time; });
    return out;
  }

  F1.timetrial = { best: best, store: store, leaderboard: leaderboardModel, KEY: KEY };

  F1.screens['time-trial'] = {
    mount: function (root, params) {
      params = params || {};
      var wrap = U.node('div', 'screen-inner tt');
      wrap.appendChild(U.header({ title: 'Time Trial', sub: 'One lap \u00b7 your ghost \u00b7 personal bests' }));

      var circuitId = params.circuit || F1.settings.gameplay.lastCircuit || 'italy';
      var meta = D.getCircuitMeta(circuitId);

      var body = U.node('div', 'tt-body');
      var left = U.node('div', 'panel pad tt-list');
      var right = U.node('div', 'panel pad tt-detail');
      body.appendChild(left);
      body.appendChild(right);
      wrap.appendChild(body);

      function driverShort() {
        var teamId = F1.settings.career.teamId || 'mclaren';
        var team = D.getTeam(teamId);
        var did = F1.settings.career.driverId || (team.drivers && team.drivers[0]);
        return { teamId: teamId, team: team, driverId: did, driver: D.getDriver(did) };
      }

      function renderList() {
        var rows = D.activeCalendar(!!F1.settings.gameplay.includeCancelled);
        left.innerHTML = '<h3 class="panel-title">Circuits</h3><div class="tt-rows">' +
          rows.map(function (m) {
            var b = best(m.id);
            return '<button class="tt-row' + (m.id === circuitId ? ' on' : '') + '" data-c="' + m.id + '">' +
              '<span class="r">' + m.round + '</span>' +
              '<span class="n">' + esc(m.name) + '</span>' +
              '<span class="pb mono">' + (b ? T.fmtTime(b.time) : '\u2014') + '</span></button>';
          }).join('') + '</div>';
        left.querySelectorAll('[data-c]').forEach(function (b) {
          b.addEventListener('click', function () {
            circuitId = b.getAttribute('data-c');
            meta = D.getCircuitMeta(circuitId);
            renderList(); renderDetail();
          });
        });
      }

      function renderDetail() {
        var pb = best(circuitId);
        var who = driverShort();
        right.innerHTML =
          '<div class="tt-head"><h3 class="panel-title">' + esc(meta.name) + '</h3>' +
          '<span class="muted">' + esc(meta.city) + ' \u00b7 ' + (meta.length / 1000).toFixed(3) + ' km \u00b7 ' +
          esc(meta.approximate ? 'approximate layout' : 'accurate layout') + '</span></div>' +
          '<div class="tt-pb">' +
          '<div><span>Personal best</span><b class="mono">' + (pb ? T.fmtTime(pb.time) : '\u2014') + '</b></div>' +
          '<div><span>Set</span><b>' + (pb ? new Date(pb.at).toLocaleDateString() : '\u2014') + '</b></div>' +
          '<div><span>Ghost</span><b>' + (pb ? 'saved' : 'none yet') + '</b></div>' +
          '</div>' +
          '<div class="tt-stats">' +
          '<div><span>Corners</span><b>' + (meta.corners || '\u2014') + '</b></div>' +
          '<div><span>DRS zones</span><b>' + (meta.drs || '\u2014') + '</b></div>' +
          '<div><span>Race laps</span><b>' + (meta.laps || '\u2014') + '</b></div>' +
          '<div><span>Lap record</span><b class="mono">' + (meta.lapRecord ? T.fmtTime(meta.lapRecord) : '\u2014') + '</b></div>' +
          '</div>' +
          '<p class="muted tt-note">Three laps, no opponents, no flags. Your quickest lap is stored here and its ' +
          'ghost lines up beside you next time.</p>' +
          '<div class="tt-car"><i class="sw" style="background:' + who.team.colors.primary + '"></i>' +
          '<span>' + esc(who.driver.name) + '</span><span class="muted">' + esc(who.team.short) + '</span></div>' +
          '<div class="tt-actions">' +
          (pb ? '<button class="btn ghost" data-act="clearg">Clear ghost</button>' : '') +
          '<button class="btn primary" data-act="go">Drive \u203a</button></div>' +
          '<div class="tt-board"><h4>Personal bests</h4>' +
          leaderboardModel().map(function (r) {
            return '<div class="tt-b-row"><span class="n">' + esc(r.name) + '</span>' +
              '<span class="mono">' + T.fmtTime(r.time) + '</span></div>';
          }).join('') + '</div>';

        right.querySelectorAll('[data-act]').forEach(function (b) {
          b.addEventListener('click', function () {
            if (b.getAttribute('data-act') === 'clearg') {
              F1.storage.remove(KEY + circuitId);
              renderList(); renderDetail();
              return;
            }
            startTrial();
          });
        });
      }

      function startTrial() {
        var who = driverShort();
        F1.app.show('race', {
          circuit: circuitId,
          laps: 3,
          field: false,
          gridSlot: 0,
          teamId: who.teamId,
          driverId: who.driverId,
          compound: 'soft',
          ghost: best(circuitId),
          timeTrial: true,
          countdown: 2.4
        });
      }

      renderList();
      renderDetail();
      return wrap;
    }
  };
})(window.F1 = window.F1 || {});
