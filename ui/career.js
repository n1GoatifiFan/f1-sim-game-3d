/* ==========================================================================
   F1 2026 — ui/career.js
   Career setup and the career hub.

   Two screens:
     career-setup  create a driver or take a real seat, then sign the first deal
     career        contract, next race, championship, R&D, market, saves
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

  function bar(v, max, cls) {
    var pct = Math.round(T.clamp(v / max, 0, 1) * 100);
    return '<span class="bar ' + (cls || '') + '"><b style="width:' + pct + '%"></b></span>';
  }

  function money(n) {
    return '\u00a0' + Number(n || 0).toLocaleString('en-US');
  }

  /* ================================================================== */
  /* setup                                                              */
  /* ================================================================== */
  F1.screens['career-setup'] = {
    mount: function (root) {
      var wrap = U.node('div', 'screen-inner cs');
      wrap.appendChild(U.header({ title: 'Career', sub: 'Create a driver or take over a real seat' }));

      var state = {
        mode: 'create',
        name: '',
        code: '',
        country: 'FR',
        number: 12,
        teamId: 'cadillac',
        driverId: D.drivers[0].id,
        rating: 76
      };

      var body = U.node('div', 'cs-body');
      wrap.appendChild(body);

      var left = U.node('div', 'panel pad cs-left');
      var right = U.node('div', 'panel pad cs-right');
      body.appendChild(left);
      body.appendChild(right);

      var countries = ['FR', 'GB', 'IT', 'DE', 'ES', 'NL', 'BR', 'JP', 'AU', 'US', 'CA', 'MX', 'FI', 'DK', 'SE', 'AR'];

      function renderLeft() {
        var html = '<h3 class="panel-title">Your driver</h3>' +
          '<div class="cs-tabs">' +
          '<button data-mode="create" class="' + (state.mode === 'create' ? 'on' : '') + '">Create a driver</button>' +
          '<button data-mode="real" class="' + (state.mode === 'real' ? 'on' : '') + '">Real driver</button>' +
          '</div>';

        if (state.mode === 'create') {
          html +=
            '<label class="cs-field"><span>Name</span><input id="cs-name" maxlength="28" placeholder="A. Driver" value="' + esc(state.name) + '"></label>' +
            '<div class="cs-row">' +
            '<label class="cs-field small"><span>Code</span><input id="cs-code" maxlength="3" placeholder="DRV" value="' + esc(state.code) + '"></label>' +
            '<label class="cs-field small"><span>Number</span><input id="cs-number" type="number" min="2" max="99" value="' + state.number + '"></label>' +
            '<label class="cs-field small"><span>Country</span><select id="cs-country">' +
            countries.map(function (c) { return '<option value="' + c + '"' + (c === state.country ? ' selected' : '') + '>' + c + '</option>'; }).join('') +
            '</select></label>' +
            '</div>' +
            '<p class="muted cs-note">A rookie starts at 76 and a backmarker contract. Perform and the top teams call.</p>';
        } else {
          html += '<label class="cs-field"><span>Driver</span><select id="cs-driver">' +
            D.drivers.map(function (d) {
              var team = D.getTeam(d.team);
              return '<option value="' + d.id + '"' + (d.id === state.driverId ? ' selected' : '') + '>' +
                esc(d.name) + ' \u2014 ' + esc(team.short) + ' (' + D.driverOverall(d) + ')</option>';
            }).join('') + '</select></label>' +
            '<p class="muted cs-note">You take over the seat, the team and the contract of a real driver \u2014 no rating or team choice.</p>';
        }
        left.innerHTML = html;

        left.querySelectorAll('[data-mode]').forEach(function (b) {
          b.addEventListener('click', function () {
            state.mode = b.getAttribute('data-mode');
            renderLeft(); renderRight();
          });
        });
        var nameEl = left.querySelector('#cs-name');
        if (nameEl) {
          nameEl.addEventListener('input', function () {
            state.name = nameEl.value;
            var codeEl = left.querySelector('#cs-code');
            var parts = state.name.trim().split(/\s+/);
            var last = parts.length > 1 ? parts[parts.length - 1] : (parts[0] || '');
            if (codeEl && (!state.code || state.code === state._autoCode)) {
              state._autoCode = last.slice(0, 3).toUpperCase();
              state.code = state._autoCode;
              codeEl.value = state.code;
            }
          });
        }
        var codeEl2 = left.querySelector('#cs-code');
        if (codeEl2) codeEl2.addEventListener('input', function () { state.code = codeEl2.value.toUpperCase(); });
        var numEl = left.querySelector('#cs-number');
        if (numEl) numEl.addEventListener('input', function () { state.number = +numEl.value || 2; });
        var ctyEl = left.querySelector('#cs-country');
        if (ctyEl) ctyEl.addEventListener('change', function () { state.country = ctyEl.value; });
        var drvEl = left.querySelector('#cs-driver');
        if (drvEl) drvEl.addEventListener('change', function () {
          state.driverId = drvEl.value;
          state.teamId = D.getDriver(drvEl.value).team;
          renderRight();
        });
      }

      function renderRight() {
        var rating = state.mode === 'real' ? D.driverOverall(D.getDriver(state.driverId)) : 76;
        var list = F1.career.offers(rating);
        var html = '<h3 class="panel-title">' + (state.mode === 'real' ? 'Your seat' : 'Choose a team') + '</h3>' +
          '<div class="cs-teams">';
        list.forEach(function (o) {
          var t = D.getTeam(o.teamId);
          var locked = state.mode === 'real' ? o.teamId !== D.getDriver(state.driverId).team : !o.interested;
          html += '<button class="cs-team' + (locked ? ' locked' : '') + (state.teamId === o.teamId ? ' on' : '') + '" data-team="' + o.teamId + '"' + (locked ? ' disabled' : '') + '>' +
            '<i class="sw" style="background:' + t.colors.primary + '"></i>' +
            '<span class="n">' + esc(t.short) + '</span>' +
            '<span class="st mono">' + o.strength.toFixed(0) + '</span>' +
            '<span class="sal mono">' + money(o.salary) + '</span>' +
            (locked ? '<span class="lock">\u2715</span>' : '') +
            '</button>';
        });
        html += '</div>' +
          '<div class="cs-summary">' +
          '<div><span>Rating</span><b>' + rating + '</b></div>' +
          '<div><span>Salary</span><b class="mono">' + money((list.filter(function (o) { return o.teamId === state.teamId; })[0] || {}).salary || 0) + '</b></div>' +
          '<div><span>Season</span><b>' + D.activeCalendar(false).length + ' rounds</b></div>' +
          '</div>' +
          '<div class="cs-actions"><button class="btn primary" id="cs-start">Sign and start the season \u203a</button></div>';
        right.innerHTML = html;

        right.querySelectorAll('[data-team]').forEach(function (b) {
          b.addEventListener('click', function () {
            state.teamId = b.getAttribute('data-team');
            renderRight();
          });
        });
        var start = right.querySelector('#cs-start');
        if (start) start.addEventListener('click', function () {
          var opts = state.mode === 'real'
            ? { mode: 'real', driverId: state.driverId }
            : {
              mode: 'create', name: state.name || 'A. Driver', code: state.code || 'DRV',
              country: state.country, number: state.number, teamId: state.teamId, rating: 76
            };
          var career = F1.career.create(opts);
          F1.career.save(career, F1.storage.get('career_active', 1) || 1);
          F1.career.applyRnd(career);
          F1.app.career = career;
          F1.settings.career.teamId = career.teamId;
          F1.settings.career.driverId = F1.career.driverIdOf(career);
          F1.settings.save();
          F1.app.show('career');
        });
      }

      renderLeft();
      renderRight();
      return wrap;
    }
  };

  /* ================================================================== */
  /* hub                                                                */
  /* ================================================================== */
  F1.screens.career = {
    mount: function (root, params) {
      params = params || {};
      /* no career yet: offer the slot list first */
      var career = params.career || F1.app.career;
      var list = F1.career.list();
      var hasSaves = list.some(function (s) { return !s.empty; });

      if (!career && !hasSaves) {
        /* nothing to continue: show the setup form on this screen instead of
           redirecting (a redirect inside mount would unmount the screen that
           is still being built) */
        var el = F1.screens['career-setup'].mount(root);
        if (el) root.appendChild(el);
        return U.node('div');
      }

      var wrap = U.node('div', 'screen-inner career');
      wrap.appendChild(U.header({ title: 'Career', sub: '2026 season', right: U.node('div', 'career-right', '') }));

      var body = U.node('div', 'career-body');
      wrap.appendChild(body);

      var main = U.node('div', 'career-main');
      var side = U.node('div', 'career-side');
      body.appendChild(main);
      body.appendChild(side);

      var view = 'hub';       // hub | table | rnd | market | saves
      var selectedSlot = F1.storage.get('career_active', 1) || 1;

      function header(c) {
        var team = D.getTeam(c.teamId);
        return '<div class="career-hero">' +
          '<div class="ch-team"><i class="sw" style="background:' + team.colors.primary + '"></i>' +
          '<div><b>' + esc(c.identity.name) + '</b>' +
          '<span>' + esc(team.short) + ' \u00b7 season ' + c.season + ' \u00b7 round ' + Math.min(c.round + 1, c.calendar.length) + '/' + c.calendar.length + '</span></div></div>' +
          '<div class="ch-stats">' +
          '<div><span>Credits</span><b class="mono">' + money(c.credits) + '</b></div>' +
          '<div><span>Contract</span><b>' + c.contract.seasonsLeft + ' yr</b></div>' +
          '<div><span>Objective</span><b>' + (F1.career.OBJECTIVES[c.contract.objective] || {}).label + '</b></div>' +
          '</div></div>';
      }

      function nextEvent(c) {
        var meta = F1.career.nextCircuit(c);
        if (!meta) return '<div class="career-card"><h3>Season complete</h3><p>Pick up a new deal in the market.</p></div>';
        var t = D.getTeam(c.teamId);
        return '<div class="career-card next-race">' +
          '<span class="cc">R' + meta.round + '</span>' +
          '<div class="nr-main"><b>' + esc(meta.name) + '</b>' +
          '<span>' + esc(meta.city) + ', ' + esc(meta.country) + ' \u00b7 ' + (meta.length / 1000).toFixed(3) + ' km \u00b7 ' +
          meta.laps + ' laps' + (meta.sprint ? ' \u00b7 sprint' : '') + '</span></div>' +
          '<div class="nr-actions">' +
          '<button class="btn" data-act="practice">Practice</button>' +
          '<button class="btn primary" data-act="weekend">Race weekend \u203a</button>' +
          '</div></div>';
      }

      function miniTable(c) {
        var rows = F1.career.driverTable(c).slice(0, 10);
        return '<div class="career-card"><h3>Drivers\u2019 championship</h3><div class="ctable">' +
          rows.map(function (r) {
            var team = D.getTeam(r.team || c.teamId);
            return '<div class="ct-row' + (r.me ? ' me' : '') + '"><span class="p">' + r.pos + '</span>' +
              '<i class="sw" style="background:' + team.colors.primary + '"></i>' +
              '<span class="n">' + esc(r.code) + '</span>' +
              '<span class="pts mono">' + r.points + '</span></div>';
          }).join('') + '</div>' +
          '<button class="btn ghost small" data-act="table">Full standings</button></div>';
      }

      function rndCard(c) {
        var keys = Object.keys(F1.career.RD);
        return '<div class="career-card"><h3>R&amp;D programme</h3><div class="rnd-list">' +
          keys.map(function (k) {
            var def = F1.career.RD[k];
            var lvl = c.rnd[k] || 0;
            var cost = F1.career.rdCost(c, k);
            var maxed = lvl >= 8;
            return '<div class="rnd-row">' +
              '<div class="rnd-name"><b>' + def.label + '</b><span>' + lvl + '/8</span></div>' +
              bar(lvl, 8, 'rnd') +
              '<button class="btn small' + (maxed || c.credits < cost ? '' : ' primary') + '" data-rnd="' + k + '"' + (maxed ? ' disabled' : '') + '>' +
              (maxed ? 'Max' : money(cost)) + '</button>' +
              '</div>';
          }).join('') + '</div></div>';
      }

      function marketCard(c) {
        if (!c.market || !c.market.length) {
          return '<div class="career-card"><h3>Driver market</h3><p class="muted">Offers arrive at the end of the season. Your agent is watching.</p></div>';
        }
        return '<div class="career-card"><h3>Contract offers</h3><div class="market">' +
          c.market.map(function (o) {
            var t = D.getTeam(o.teamId);
            return '<div class="mk-row"><i class="sw" style="background:' + t.colors.primary + '"></i>' +
              '<span class="n">' + esc(t.short) + '</span>' +
              '<span class="muted">' + o.seasons + ' yr \u00b7 ' + (F1.career.OBJECTIVES[o.objective] || {}).label + '</span>' +
              '<span class="mono">' + money(o.salary) + '</span>' +
              '<button class="btn small primary" data-sign="' + o.teamId + '">Sign</button></div>';
          }).join('') + '</div></div>';
      }

      function renderMain(c) {
        if (!c) { main.innerHTML = '<div class="career-card"><h3>No career loaded</h3></div>'; return; }
        if (view === 'table') {
          var drv = F1.career.driverTable(c);
          var tms = F1.career.teamTable(c);
          main.innerHTML = '<div class="career-card"><h3>Drivers\u2019 championship</h3><div class="fulltable">' +
            drv.map(function (r) {
              var team = D.getTeam(r.team || c.teamId);
              return '<div class="ft-row' + (r.me ? ' me' : '') + '"><span class="p">' + r.pos + '</span>' +
                '<i class="sw" style="background:' + team.colors.primary + '"></i>' +
                '<span class="n">' + esc(r.name) + '</span><span class="t">' + esc(team.short) + '</span>' +
                '<span class="pts mono">' + r.points + '</span></div>';
            }).join('') + '</div></div>' +
            '<div class="career-card"><h3>Constructors</h3><div class="fulltable">' +
            tms.map(function (r) {
              return '<div class="ft-row"><span class="p">' + r.pos + '</span>' +
                '<i class="sw" style="background:' + r.team.colors.primary + '"></i>' +
                '<span class="n">' + esc(r.team.short) + '</span><span class="t"></span>' +
                '<span class="pts mono">' + r.points + '</span></div>';
            }).join('') + '</div></div>';
          return;
        }
        if (view === 'saves') {
          main.innerHTML = savesMarkup();
          wireSaves();
          return;
        }
        main.innerHTML = nextEvent(c) + miniTable(c) + (view === 'rnd' ? rndCard(c) : '') +
          (view === 'market' ? marketCard(c) : '');
        wireMain(c);
      }

      function savesMarkup() {
        var rows = F1.career.list();
        return '<div class="career-card"><h3>Save slots</h3><div class="slots">' +
          rows.map(function (s) {
            return '<div class="slot' + (s.empty ? ' empty' : '') + (s.slot === selectedSlot ? ' on' : '') + '">' +
              '<div class="slot-head"><b>Slot ' + s.slot + '</b>' +
              (s.empty ? '<span class="muted">empty</span>' : '<span class="muted">' + new Date(s.savedAt).toLocaleDateString() + '</span>') +
              '</div>' +
              (s.empty
                ? '<div class="slot-body muted">No career</div>'
                : '<div class="slot-body"><b>' + esc(s.name) + '</b><span>' + esc(s.team) + ' \u00b7 S' + s.season +
                ' \u00b7 R' + Math.min(s.round + 1, s.races) + '/' + s.races + '</span>' +
                '<span class="mono">P' + (s.pos || '-') + ' \u00b7 ' + s.points + ' pts \u00b7 ' + money(s.credits) + '</span></div>') +
              '<div class="slot-actions">' +
              (s.empty ? '' : '<button class="btn small" data-load="' + s.slot + '">Load</button>') +
              '<button class="btn small" data-save="' + s.slot + '">Save here</button>' +
              (s.empty ? '' : '<button class="btn small ghost danger" data-clear="' + s.slot + '">Delete</button>') +
              '</div></div>';
          }).join('') + '</div>' +
          '<div class="slot-io">' +
          '<button class="btn" data-act="export">Export JSON</button>' +
          '<label class="btn" for="career-import">Import JSON</label>' +
          '<input id="career-import" type="file" accept="application/json,.json" hidden>' +
          '</div>' +
          '<p class="muted cs-note">Saves live in this browser\u2019s localStorage. Export writes a .json file you can keep or move to another machine.</p></div>';
      }

      function wireSaves() {
        var c = F1.app.career;
        main.querySelectorAll('[data-save]').forEach(function (b) {
          b.addEventListener('click', function () {
            if (!c) { F1.app.toast('No career loaded'); return; }
            var slot = +b.getAttribute('data-save');
            F1.career.save(c, slot);
            selectedSlot = slot;
            renderMain(c);
            F1.app.toast('Saved to slot ' + slot);
          });
        });
        main.querySelectorAll('[data-load]').forEach(function (b) {
          b.addEventListener('click', function () {
            var slot = +b.getAttribute('data-load');
            var loaded = F1.career.load(slot);
            if (!loaded) { F1.app.toast('Slot is empty'); return; }
            F1.app.career = loaded;
            F1.storage.set('career_active', slot);
            selectedSlot = slot;
            F1.career.applyRnd(loaded);
            view = 'hub';
            renderMain(loaded);
            renderSide(loaded);
            F1.app.toast('Loaded ' + loaded.identity.name);
          });
        });
        main.querySelectorAll('[data-clear]').forEach(function (b) {
          b.addEventListener('click', function () {
            F1.career.clear(+b.getAttribute('data-clear'));
            renderMain(F1.app.career);
          });
        });
        var ex = main.querySelector('[data-act="export"]');
        if (ex) ex.addEventListener('click', function () {
          if (!c) { F1.app.toast('No career loaded'); return; }
          var text = F1.career.exportText(c);
          var blob = new Blob([text], { type: 'application/json' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'f1-2026-career-' + c.identity.code + '-S' + c.season + '.json';
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
          F1.app.toast('Career exported');
        });
        var imp = main.querySelector('#career-import');
        if (imp) imp.addEventListener('change', function () {
          var f = imp.files && imp.files[0];
          if (!f) return;
          var fr = new FileReader();
          fr.onload = function () {
            var res = F1.career.importText(String(fr.result || ''));
            if (!res.ok) { F1.app.toast('Import failed: ' + res.reason); return; }
            F1.app.career = res.career;
            F1.career.applyRnd(res.career);
            F1.career.save(res.career, selectedSlot);
            view = 'hub';
            renderMain(res.career);
            renderSide(res.career);
            F1.app.toast('Career imported into slot ' + selectedSlot);
          };
          fr.readAsText(f);
        });
      }

      function wireMain(c) {
        main.querySelectorAll('[data-act]').forEach(function (b) {
          b.addEventListener('click', function () {
            var act = b.getAttribute('data-act');
            if (act === 'table') { view = 'table'; renderMain(c); return; }
            if (act === 'weekend') { startWeekend(c); return; }
            if (act === 'practice') { startWeekend(c, true); return; }
          });
        });
        main.querySelectorAll('[data-rnd]').forEach(function (b) {
          b.addEventListener('click', function () {
            var res = F1.career.invest(c, b.getAttribute('data-rnd'));
            if (!res.ok) { F1.app.toast('R&D: ' + res.reason); return; }
            F1.career.save(c, selectedSlot);
            renderMain(c);
            renderSide(c);
            F1.app.toast('Upgrade fitted \u00b7 level ' + res.level);
          });
        });
        main.querySelectorAll('[data-sign]').forEach(function (b) {
          b.addEventListener('click', function () {
            var teamId = b.getAttribute('data-sign');
            if (!F1.career.sign(c, teamId)) return;
            F1.career.applyRnd(c);
            F1.career.save(c, selectedSlot);
            view = 'hub';
            renderMain(c);
            renderSide(c);
            F1.app.toast('Signed with ' + D.getTeam(teamId).short);
          });
        });
      }

      function startWeekend(c, practiceOnly) {
        var meta = F1.career.nextCircuit(c);
        if (!meta) { F1.app.toast('The season is over'); return; }
        var teamId = c.teamId;
        var driverId = F1.career.driverIdOf(c);
        var wkd = F1.weekend.create({
          circuitId: meta.id,
          type: meta.sprint ? 'sprint' : 'standard',
          seed: c.seed + '|S' + c.season + '|' + meta.id,
          playerId: driverId,
          teamId: teamId,
          raceLength: F1.settings.gameplay.raceLength
        });
        F1.app.weekend = wkd;
        F1.app.careerRace = { career: c, circuit: meta.id, slot: selectedSlot, practiceOnly: !!practiceOnly };
        if (practiceOnly) {
          F1.careerScreen.startFreePractice(c, meta);
          return;
        }
        F1.app.show('weekend', { weekend: wkd, circuitId: meta.id, type: wkd.type });
      }

      function renderSide(c) {
        if (!c) { side.innerHTML = ''; return; }
        var hist = (c.history || []).slice(-4).reverse();
        var contractTeam = D.getTeam(c.teamId);
        side.innerHTML =
          '<div class="career-card"><h3>Grid</h3>' +
          '<div class="career-grid">' +
          D.activeCalendar(F1.settings.gameplay.includeCancelled).map(function (m) {
            var done = c.results.some(function (r) { return r.season === c.season && r.circuit === m.id; });
            var next = F1.career.nextCircuit(c);
            var isNext = next && next.id === m.id;
            return '<div class="cg-row' + (done ? ' done' : '') + (isNext ? ' next' : '') + '">' +
              '<span class="r">' + m.round + '</span><span class="n">' + esc(m.name) + '</span>' +
              (done ? '<span class="tick">\u2713</span>' : isNext ? '<span class="now">NEXT</span>' : '') +
              '</div>';
          }).join('') + '</div></div>' +
          '<div class="career-card"><h3>Contract</h3>' +
          '<div class="contract"><div class="co-team"><i class="sw" style="background:' + contractTeam.colors.primary + '"></i>' +
          '<b>' + esc(contractTeam.short) + '</b></div>' +
          '<div class="co-row"><span>Salary</span><span class="mono">' + money(c.contract.salary) + '</span></div>' +
          '<div class="co-row"><span>Years left</span><span>' + c.contract.seasonsLeft + '</span></div>' +
          '<div class="co-row"><span>Objective</span><span>' + (F1.career.OBJECTIVES[c.contract.objective] || {}).label + '</span></div>' +
          '</div></div>' +
          (hist.length ? '<div class="career-card"><h3>History</h3>' + hist.map(function (h) {
            return '<div class="co-row"><span>S' + h.season + '</span><span>P' + h.pos + ' \u00b7 ' + h.points + ' pts' +
              (h.champion ? ' \u00b7 champion' : '') + '</span></div>';
          }).join('') + '</div>' : '');
        wireSide(c);
      }

      function wireSide(c) {
        side.querySelectorAll('[data-view]').forEach(function (b) {
          b.addEventListener('click', function () {
            view = b.getAttribute('data-view');
            renderMain(c);
            side.querySelectorAll('[data-view]').forEach(function (x) { x.classList.toggle('on', x === b); });
          });
        });
      }

      /* ---------------- toolbar ---------------- */
      var rightSlot = wrap.querySelector('.career-right');
      if (rightSlot) {
        var nav = U.node('div', 'career-nav');
        nav.innerHTML =
          '<button class="btn small on" data-view="hub">Hub</button>' +
          '<button class="btn small" data-view="rnd">R&amp;D</button>' +
          '<button class="btn small" data-view="market">Market</button>' +
          '<button class="btn small" data-view="saves">Saves</button>';
        rightSlot.appendChild(nav);
        rightSlot.appendChild(U.node('span', 'chip', 'S' + (career ? career.season : 1)));
        nav.querySelectorAll('[data-view]').forEach(function (b) {
          b.addEventListener('click', function () {
            view = b.getAttribute('data-view');
            renderMain(F1.app.career);
            nav.querySelectorAll('[data-view]').forEach(function (x) { x.classList.toggle('on', x === b); });
          });
        });
      }

      if (!career) {
        // a save exists but nothing is loaded: load the active slot
        career = F1.career.load(selectedSlot) || F1.career.load(1) || F1.career.load(2) || F1.career.load(3);
        if (career) {
          F1.app.career = career;
          F1.career.applyRnd(career);
        }
      }

      if (career) {
        F1.settings.career.teamId = career.teamId;
        F1.settings.career.driverId = F1.career.driverIdOf(career);
      }

      var hero = U.node('div', 'career-hero-wrap');
      if (career) hero.innerHTML = header(career);
      wrap.insertBefore(hero, body);

      renderMain(career);
      renderSide(career);
      return wrap;
    }
  };

  /* a free-practice-only career session: three laps, no field, no timing.
     Deferred so this file does not depend on ui/race.js having loaded. */
  F1.careerScreen = {
    startFreePractice: function (career, meta) {
      F1.app.show('race', {
        circuit: meta.id, laps: 3, field: false, gridSlot: 0,
        teamId: career.teamId, driverId: F1.career.driverIdOf(career),
        compound: 'soft', career: career, careerRound: meta.id, practiceOnly: true
      });
    }
  };
})(window.F1 = window.F1 || {});
