/* ==========================================================================
   F1 2026 — ui/weekend.js
   The paddock: the weekend's session list, the timing screens and the grid.

   A weekend is a sequence of sessions. Practice and qualifying are short
   lap-limited runs (three laps) so a full weekend fits in a sitting; the
   sprint and the grand prix use the real distances scaled by the race-length
   setting. Every session writes its result into F1.weekend, so the grid for
   the race comes from what actually happened on track.
   ========================================================================== */
(function (F1) {
  'use strict';

  var U = F1.ui;
  var T = F1.util;
  var D = F1.DATA;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  var PRACTICE_LAPS = 3;
  var QUALI_LAPS = 3;

  function sessionInfo(ses, teamOf) {
    if (ses.kind === 'practice' || ses.kind === 'quali') return PRACTICE_LAPS + ' laps';
    return ses.laps + ' laps';
  }

  F1.screens = F1.screens || {};

  F1.screens.weekend = {
    mount: function (root, params) {
      params = params || {};
      var wkd = params.weekend;
      if (!wkd) {
        wkd = F1.weekend.create({
          circuitId: params.circuitId || F1.settings.gameplay.lastCircuit || 'italy',
          type: params.type,
          seed: params.seed || ('wkd|' + (params.circuitId || 'italy')),
          playerId: params.driverId || F1.DATA.teamOf(F1.settings.career.teamId || 'mclaren').drivers[0],
          teamId: params.teamId || F1.settings.career.teamId || 'mclaren',
          raceLength: params.raceLength
        });
      }
      F1.app.weekend = wkd;
      var meta = wkd.meta;

      var wrap = U.node('div', 'screen-inner wkd');
      wrap.appendChild(U.header({
        title: meta.name,
        sub: 'Round ' + (meta.round || '') + ' \u00b7 ' + (wkd.type === 'sprint' ? 'Sprint weekend' : 'Standard weekend') +
          ' \u00b7 ' + wkd.raceLaps + ' lap race',
        right: U.node('div', 'wkd-right', '')
      }));

      var body = U.node('div', 'wkd-body');
      wrap.appendChild(body);

      /* ---------------- left: sessions ---------------- */
      var left = U.node('div', 'panel pad wkd-sessions');
      left.innerHTML = '<h3 class="panel-title">Sessions</h3>';
      var list = U.node('div', 'wkd-list');
      left.appendChild(list);
      body.appendChild(left);

      /* ---------------- right: timing ---------------- */
      var right = U.node('div', 'panel pad wkd-timing');
      body.appendChild(right);

      var selected = (wkd.nextPending() || wkd.sessions[0]).id;

      function playerPosText(ses) {
        if (ses.state !== 'done' || !ses.playerPos) return '';
        if (ses.kind === 'race' || ses.kind === 'sprint') return 'P' + ses.playerPos;
        return 'P' + ses.playerPos;
      }

      function renderList() {
        list.innerHTML = '';
        var next = wkd.nextPending();
        wkd.sessions.forEach(function (ses) {
          var row = U.node('button', 'wkd-row' + (ses.id === selected ? ' sel' : '') +
            (ses.state === 'done' ? ' done' : '') + (next && next.id === ses.id ? ' next' : ''));
          var posTxt = ses.state === 'done' ? playerPosText(ses) : (next && next.id === ses.id ? 'NEXT' : '');
          var timeTxt = '';
          if (ses.state === 'done' && ses.results) {
            var mine = ses.results.filter(function (r) { return r.isPlayer; })[0];
            if (mine) timeTxt = T.fmtTime(mine.time);
          }
          row.innerHTML =
            '<span class="k">' + (ses.kind === 'race' ? '\u2691' : ses.kind === 'sprint' ? '\u26A1' : '') + '</span>' +
            '<span class="lbl">' + esc(ses.label) + '</span>' +
            '<span class="meta mono">' + (timeTxt || (ses.kind === 'practice' ? '' : '')) + '</span>' +
            '<span class="st">' + (posTxt || (ses.state === 'done' ? '\u2713' : '')) + '</span>';
          row.addEventListener('click', function () {
            selected = ses.id;
            renderList();
            renderTiming();
          });
          list.appendChild(row);
        });
      }

      function renderTiming() {
        var ses = wkd.session(selected);
        if (!ses) return;
        var next = wkd.nextPending();
        var canStart = next && next.id === ses.id;
        var html = '<div class="wkd-timing-head"><h3 class="panel-title">' + esc(ses.label) + '</h3>' +
          '<span class="muted">' + esc(sessionInfo(ses)) + '</span></div>';

        if (ses.state === 'done' && ses.results) {
          html += '<div class="wkd-table">' +
            '<div class="wt-head"><span>POS</span><span>DRIVER</span><span>TEAM</span><span>TIME</span><span>GAP</span></div>';
          ses.results.slice(0, 12).forEach(function (r) {
            var d = D.getDriver(r.id);
            var team = D.getTeam(r.teamId || d.team);
            html += '<div class="wt-row' + (r.isPlayer ? ' me' : '') + '">' +
              '<span class="p">' + r.pos + '</span>' +
              '<span class="n"><i class="sw" style="background:' + team.colors.primary + '"></i>' +
              esc(d.code || d.lastName.slice(0, 3)) + '</span>' +
              '<span class="t">' + esc(team.short) + '</span>' +
              '<span class="tt mono">' + (r.time ? T.fmtTime(r.time) : '\u2014') + '</span>' +
              '<span class="g mono">' + (r.pos === 1 ? '' : '+' + (r.gap || 0).toFixed(3)) + '</span></div>';
          });
          if (ses.results.length > 12) html += '<div class="wt-more muted">+' + (ses.results.length - 12) + ' more</div>';
          html += '</div>';
        } else {
          var blocked = !canStart;
          html += '<div class="wkd-brief">' +
            '<p>' + esc(briefing(ses, wkd)) + '</p>' +
            (blocked ? '<p class="muted">Finish the sessions before this one first.</p>' : '') +
            '</div>';
        }

        /* the grid so far */
        var grid = wkd.grid();
        html += '<div class="wkd-grid"><h4>Provisional grid</h4><div class="wg-grid">';
        grid.slice(0, 10).forEach(function (id, i) {
          var d = D.getDriver(id);
          var team = D.getTeam(d.team);
          html += '<div class="wg-row' + (id === wkd.playerId ? ' me' : '') + '">' +
            '<span class="p mono">' + (i + 1) + '</span>' +
            '<i class="sw" style="background:' + team.colors.primary + '"></i>' +
            '<span class="n">' + esc(d.code || '') + '</span></div>';
        });
        html += '</div></div>';

        var actions = U.node('div', 'wkd-actions');
        actions.innerHTML = '<div class="spacer"></div>';
        if (canStart) {
          var go = U.node('button', 'btn primary', ses.kind === 'race' ? 'Start Grand Prix' :
            ses.kind === 'sprint' ? 'Start Sprint' : 'Drive ' + ses.label);
          go.addEventListener('click', function () { startSession(ses); });
          actions.appendChild(go);
        }
        if (ses.state !== 'done' && canStart) {
          var sim = U.node('button', 'btn ghost', 'Simulate');
          sim.addEventListener('click', function () {
            if (ses.kind === 'race' || ses.kind === 'sprint') {
              wkd.simulate(ses.id, 0);
            } else {
              wkd.simulate(ses.id, 0);
            }
            selected = nextSessionIdAfter(ses.id) || ses.id;
            renderList(); renderTiming();
          });
          actions.appendChild(sim);
        }
        right.innerHTML = '';
        right.appendChild(actions);
        var inner = U.node('div', 'wkd-timing-inner');
        inner.innerHTML = html;
        right.insertBefore(inner, actions);

        if (!wkd.nextPending()) {
          var done = U.node('div', 'wkd-complete');
          done.innerHTML = '<b>Weekend complete</b><span class="muted">Use the paddock button to go back to the menu.</span>';
          right.appendChild(done);
        }
      }

      function nextSessionIdAfter(id) {
        var i = -1;
        wkd.sessions.forEach(function (s, k) { if (s.id === id) i = k; });
        for (var k = i + 1; k < wkd.sessions.length; k++) if (wkd.sessions[k].state !== 'done') return wkd.sessions[k].id;
        return null;
      }

      function briefing(ses, w) {
        if (ses.kind === 'practice') return 'Free practice. Three laps to learn the circuit and the tyre behaviour. Your best lap decides nothing but your own reference.';
        if (ses.kind === 'quali') return 'Qualifying ' + ses.id.toUpperCase() + '. Three laps. Only the fastest drivers survive into the next phase.';
        if (ses.kind === 'sprint') return 'Sprint: ' + w.sprintLaps + ' laps, points down to eighth, no pit stops required.';
        return 'Grand Prix: ' + w.raceLaps + ' laps with a formation lap, a full field and points down to tenth.';
      }

      /* ---------------- start a session ---------------- */
      function startSession(ses) {
        var grid = wkd.grid();
        var slot = Math.max(0, grid.indexOf(wkd.playerId));
        var laps = ses.kind === 'practice' || ses.kind === 'quali' ? QUALI_LAPS : wkd.lapsFor(ses.id);
        F1.app.show('race', {
          circuit: wkd.circuitId,
          laps: laps,
          gridSlot: slot,
          order: grid,
          seed: wkd.circuitId + '|' + ses.id,
          weekend: wkd,
          weekendSession: ses.id,
          formationLap: ses.kind === 'race',
          teamId: wkd.teamId,
          driverId: wkd.playerId,
          compound: ses.kind === 'quali' ? 'soft' : 'medium'
        });
      }

      renderList();
      renderTiming();

      /* the header's right-hand slot: progress + back to the menu */
      var rightSlot = wrap.querySelector('.wkd-right');
      if (rightSlot) {
        var back = U.node('button', 'btn ghost small', 'Paddock \u2192 Menu');
        back.addEventListener('click', function () { F1.app.show('main-menu'); });
        rightSlot.appendChild(U.node('span', 'chip', Math.round(wkd.progress() * 100) + '% complete'));
        rightSlot.appendChild(back);
      }

      F1.screens.weekend._last = { weekend: wkd };
      return wrap;
    },

    /* called by the race screen when a weekend session ends */
    record: function (wkd, sessionId, info) {
      if (!wkd || !sessionId) return;
      var ses = wkd.session(sessionId);
      if (!ses) return;
      if (ses.kind === 'race' || ses.kind === 'sprint') {
        var results = (info.results || []).map(function (r) {
          return {
            pos: r.pos, id: r.id, teamId: r.teamId, laps: r.laps,
            gap: r.gap, time: 0, isPlayer: !!r.me
          };
        });
        if (results.length) {
          // convert the gap in metres to a time with the winner's average lap
          var scale = info.bestLap && info.laps ? info.bestLap / (wkd.track.length) : 0.012;
          results.forEach(function (r, i) {
            r.time = i === 0 ? info.bestLap * info.laps : 0;
            r.gap = r.gap * scale;
          });
          wkd.update(sessionId, { state: 'done', results: results, playerPos: info.position });
        } else {
          wkd.simulate(sessionId, 0);
        }
      } else {
        wkd.simulate(sessionId, info.bestLap || 0);
      }
      return wkd;
    }
  };
})(window.F1 = window.F1 || {});
