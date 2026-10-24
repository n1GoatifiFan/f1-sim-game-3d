/* ==========================================================================
   F1 2026 — ui/championship.js
   Custom championship: driver pick, calendar pick, then a hub with the
   standings and the next round.
   ========================================================================== */
(function (F1) {
  'use strict';

  var U = F1.ui;
  var T = F1.util;
  var D = F1.DATA;
  var C = F1.championship;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function teamColor(teamId) {
    var t = D.getTeam(teamId);
    return t ? t.colors.primary : '#888';
  }

  F1.screens.championship = {
    mount: function (root) {
      var wrap = U.node('div', 'screen-inner champ');
      wrap.appendChild(U.header({ title: 'Championship', sub: 'Any driver \u00b7 any rounds \u00b7 full points' }));
      var body = U.node('div', 'champ-body');
      wrap.appendChild(body);
      var champ = C.load();
      if (champ) hub(champ); else setup();
      return wrap;

      /* ---------------- setup ---------------- */
      function setup() {
        var driverId = F1.settings.career.driverId || D.drivers[0].id;
        var rounds = D.activeCalendar(false).map(function (m) { return m.id; });

        body.innerHTML =
          '<div class="panel pad champ-setup">' +
          '<div class="cs-col"><h3 class="panel-title">Your driver</h3>' +
          '<div class="champ-drivers">' +
          D.teams.map(function (t) {
            return '<div class="cd-team"><span class="cd-bar" style="background:' + t.colors.primary + '"></span>' +
              t.drivers.map(function (id) {
                var d = D.getDriver(id);
                return '<button class="cd-row" data-d="' + d.id + '">' + esc(d.name) + '</button>';
              }).join('') + '</div>';
          }).join('') + '</div></div>' +
          '<div class="cs-col"><h3 class="panel-title">Rounds <span class="muted" id="ch-rounds"></span></h3>' +
          '<div class="champ-rounds">' +
          D.activeCalendar(false).map(function (m) {
            return '<label class="cr-row"><input type="checkbox" data-c="' + m.id + '" checked>' +
              '<span class="r">' + m.round + '</span><span class="n">' + esc(m.name) + '</span>' +
              (m.sprint ? '<span class="tag">SPR</span>' : '') + '</label>';
          }).join('') + '</div>' +
          '<div class="cs-actions">' +
          '<label class="cr-row"><input type="checkbox" id="ch-sprints" checked><span class="n">Sprint points</span></label>' +
          '<button class="btn primary" id="ch-start">Start championship \u203a</button></div>' +
          '</div></div>';

        var rows = body.querySelectorAll('[data-d]');
        function paint() {
          rows.forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-d') === driverId); });
        }
        rows.forEach(function (b) {
          b.addEventListener('click', function () { driverId = b.getAttribute('data-d'); paint(); });
        });
        paint();

        var boxes = body.querySelectorAll('[data-c]');
        function count() {
          body.querySelector('#ch-rounds').textContent = '(' + body.querySelectorAll('[data-c]:checked').length + ' rounds)';
        }
        boxes.forEach(function (b) { b.addEventListener('change', count); });
        count();

        body.querySelector('#ch-start').addEventListener('click', function () {
          var picked = [].map.call(body.querySelectorAll('[data-c]:checked'), function (b) { return b.getAttribute('data-c'); });
          if (picked.length < 1) { F1.app.toast('Pick at least one round'); return; }
          var drv = D.getDriver(driverId);
          F1.settings.career.driverId = driverId;
          F1.settings.career.teamId = drv.team;
          F1.settings.save();
          var c = C.create({ driverId: driverId, teamId: drv.team, circuits: picked,
            sprints: body.querySelector('#ch-sprints').checked });
          C.save(c);
          champ = c;
          F1.audio.beep('select');
          hub(c);
        });
      }

      /* ---------------- hub ---------------- */
      function hub(c) {
        var prog = C.progress(c);
        var drivers = C.driverTable(c);
        var teams = C.teamTable(c);
        var next = C.nextCircuit(c);
        var me = drivers.filter(function (r) { return r.me; })[0];
        var nextMeta = next ? D.getCircuitMeta(next) : null;

        body.innerHTML =
          '<div class="champ-grid">' +
          '<div class="panel pad champ-main">' +
          '<div class="champ-top">' +
          '<div><span class="k">Round</span><b>' + Math.min(prog.round + 1, prog.total) + ' / ' + prog.total + '</b></div>' +
          '<div><span class="k">Your position</span><b>P' + (me ? me.pos : '\u2014') + '</b></div>' +
          '<div><span class="k">Your points</span><b class="teal">' + (me ? me.points : 0) + '</b></div>' +
          '<div><span class="k">Championship leader</span><b>' + (prog.leader ? esc(prog.leader.code) + ' \u00b7 ' + prog.leader.points : '\u2014') + '</b></div>' +
          '</div>' +
          (next ?
            '<div class="champ-next" style="border-left-color:' + teamColor(D.getDriver(c.driverId).team) + '">' +
            '<div class="cn-r">Round ' + nextMeta.round + (C.isSprint(c, next) ? ' \u00b7 Sprint weekend' : '') + '</div>' +
            '<div class="cn-n">' + esc(nextMeta.name) + '</div>' +
            '<div class="cn-c muted">' + esc(nextMeta.city) + ' \u00b7 ' + (nextMeta.length / 1000).toFixed(3) + ' km</div>' +
            '<div class="cn-a"><button class="btn primary" id="ch-race">Race this round \u203a</button>' +
            '<button class="btn" id="ch-sim">Simulate</button></div></div>'
            :
            '<div class="champ-next done"><div class="cn-n">Season complete</div>' +
            '<div class="cn-c muted">' + (drivers[0] ? esc(drivers[0].name) + ' is champion with ' + drivers[0].points + ' points.' : '') + '</div>' +
            '<div class="cn-a"><button class="btn" id="ch-new">New championship</button></div></div>') +
          '<div class="champ-tables">' +
          '<div class="ct-box drivers"><h4>Drivers</h4><div class="ct-list">' +
          drivers.slice(0, 22).map(function (r) {
            return '<div class="ct-row' + (r.me ? ' me' : '') + '"><span class="p">' + r.pos + '</span>' +
              '<span class="bar" style="background:' + teamColor(r.team) + '"></span>' +
              '<span class="n">' + esc(r.name) + '</span><b class="mono">' + r.points + '</b></div>';
          }).join('') + '</div></div>' +
          '<div class="ct-box"><h4>Constructors</h4><div class="ct-list">' +
          teams.map(function (r) {
            return '<div class="ct-row' + (r.me ? ' me' : '') + '"><span class="p">' + r.pos + '</span>' +
              '<span class="bar" style="background:' + teamColor(r.id) + '"></span>' +
              '<span class="n">' + esc(r.team.name) + '</span><b class="mono">' + r.points + '</b></div>';
          }).join('') + '</div></div></div>' +
          '<div class="champ-actions"><button class="btn ghost" id="ch-reset">Abandon</button>' +
          '<span class="muted">Races are the real thing: pick a lap count on the next screen. Simulated rounds use the same pace model.</span></div>' +
          '</div></div>';

        if (next) {
          body.querySelector('#ch-race').addEventListener('click', function () {
            var drv = D.getDriver(c.driverId);
            var meta = D.getCircuitMeta(next);
            var laps = Math.max(2, Math.round(meta.laps * c.lapsScale));
            F1.app.show('race', {
              circuit: next,
              laps: laps,
              field: true,
              gridSlot: 3,
              teamId: drv.team,
              driverId: c.driverId,
              compound: 'medium',
              championship: true,
              champRound: next,
              countdown: 3
            });
          });
          body.querySelector('#ch-sim').addEventListener('click', function () {
            var rnd = F1.rng(F1.rng.string(c.seed + '|r|' + next));
            var r = C.advance(c, next, { pos: 1 + Math.floor(rnd() * 20) });
            C.save(c);
            F1.audio.beep('select');
            F1.app.toast('Round simulated \u00b7 P' + r.pos + (r.sprintPos ? ' (sprint P' + r.sprintPos + ')' : ''));
            hub(c);
          });
        }
        var nb = body.querySelector('#ch-new');
        if (nb) nb.addEventListener('click', function () { C.clear(); champ = null; setup(); });
        body.querySelector('#ch-reset').addEventListener('click', function () {
          C.clear(); champ = null; setup();
        });
      }
    }
  };

  /* called by ui/race.js when a championship round finishes */
  F1.championshipScreen = {
    record: function (params, info) {
      var c = C.load();
      if (!c || !params.champRound) return null;
      if (!c.results.some(function (r) { return r.circuit === params.champRound; })) {
        var r = C.advance(c, params.champRound, { pos: info.pos || 18, retired: !!info.retired });
        C.save(c);
        return r;
      }
      return null;
    }
  };
})(window.F1 = window.F1 || {});
