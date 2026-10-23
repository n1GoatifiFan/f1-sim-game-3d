/* ==========================================================================
   F1 2026 — ui/ui.js
   Screens for build 1: main menu, garage (3D showroom), 2026 grid, quick-race
   circuit browser and settings. Later builds plug race/career screens into
   the same F1.screens registry.
   ========================================================================== */
(function (F1) {
  'use strict';

  var U = {};
  var T = F1.util;
  var D = F1.DATA;
  F1.screens = F1.screens || {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  U.esc = esc;

  U.node = function (tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };

  /* ------------------------------------------------------------------ */
  /* shared chrome                                                       */
  /* ------------------------------------------------------------------ */
  U.header = function (opts) {
    var head = U.node('div', 'screen-head');
    if (opts.back !== false) {
      var b = U.node('button', 'back-btn', '\u2039&nbsp;' + esc(opts.backLabel || 'Menu'));
      b.addEventListener('click', function () {
        if (opts.onBack) opts.onBack(); else F1.app.back();
      });
      head.appendChild(b);
    }
    var title = U.node('h1', 'title screen-title', esc(opts.title));
    if (opts.sub) title.appendChild(U.node('small', '', esc(opts.sub)));
    head.appendChild(title);
    head.appendChild(U.node('div', 'spacer'));
    if (opts.right) head.appendChild(opts.right);
    return head;
  };

  U.chip = function (text, cls) {
    return '<span class="chip ' + (cls || '') + '">' + esc(text) + '</span>';
  };

  /* Windows Chrome has no flag emoji font, so use a clean country-code chip */
  U.driverFlag = function (d) { return '<span class="cc">' + esc(d.countryCode || '') + '</span>'; };

  /* ------------------------------------------------------------------ */
  /* main menu                                                           */
  /* ------------------------------------------------------------------ */
  var MENU_ITEMS = [
    { id: 'career', label: 'Career', sub: 'Create a driver or take over a seat', primary: true, num: '01' },
    { id: 'quick-race', label: 'Quick Race', sub: '24 circuits \u00b7 sprint weekends', num: '02' },
    { id: 'time-trial', label: 'Time Trial', sub: 'Ghost car \u00b7 leaderboards', num: '03' },
    { id: 'championship', label: 'Championship', sub: 'Custom season \u00b7 points', num: '04' },
    { id: 'garage', label: 'Garage', sub: 'All 11 cars \u00b7 liveries', num: '05' },
    { id: 'settings', label: 'Settings', sub: 'Graphics \u00b7 controls \u00b7 audio', num: '06' }
  ];

  F1.screens['main-menu'] = {
    mount: function (root) {
      var wrap = U.node('div', 'screen-inner');

      var top = U.node('div', 'menu-top');
      top.appendChild(U.node('div', 'brand',
        '<span class="f1">F1</span><span class="yr">2026</span><span class="tag">Career Racing</span>'));

      var chip = U.node('button', 'top-chip', '<span class="dot"></span><b>2026 Grid</b><span class="muted">11 teams \u00b7 22 drivers \u00b7 24 rounds</span>');
      chip.style.cursor = 'pointer';
      chip.style.pointerEvents = 'auto';
      chip.addEventListener('click', function () { F1.app.show('grid'); });
      // keep the chip on the right
      top.appendChild(U.node('div', 'spacer'));
      top.appendChild(chip);
      wrap.appendChild(top);

      var body = U.node('div', 'menu-body');
      var left = U.node('div', 'menu-left');
      left.appendChild(U.node('div', 'menu-eyebrow', 'Formula 1 \u00b7 2026 season'));
      left.appendChild(U.node('h1', 'title menu-title', 'RACE <em>2026</em>'));
      left.appendChild(U.node('div', 'menu-subtitle', 'New era \u00b7 active aero \u00b7 50/50 power'));

      var list = U.node('nav', 'menu-list');
      MENU_ITEMS.forEach(function (item) {
        var btn = U.node('button', 'btn-menu' + (item.primary ? ' primary' : ''),
          '<span class="num">' + item.num + '</span>' +
          '<span class="lbl">' + item.label + '</span>' +
          '<span class="sub">' + item.sub + '</span>');
        btn.style.pointerEvents = 'auto';
        btn.addEventListener('click', function () {
          if (item.id === 'garage') {
            F1.app.getShowroom().setMode('garage');
          }
          F1.app.show(item.id);
        });
        btn.addEventListener('mouseenter', function () {
          // nudge the showroom camera per menu item for a bit of life
          var show = F1.app.getShowroom();
          if (show && show.setOrbit) show.setOrbit(-0.72 + Math.random() * 0.02, 0.22, 9.2);
        });
        list.appendChild(btn);
      });
      left.appendChild(list);
      body.appendChild(left);
      wrap.appendChild(body);

      var foot = U.node('div', 'menu-footer');
      foot.innerHTML =
        '<span><b>Enter</b> select</span><span class="sep"></span>' +
        '<span><b>Drag</b> orbit car</span><span class="sep"></span>' +
        '<span>v0.1 \u00b7 Section 1 build</span><span class="sep"></span>' +
        '<span>' + (F1.storage.available() ? 'Saves: local storage' : 'Saves: session only') + '</span>';
      wrap.appendChild(foot);

      return wrap;
    },
    unmount: function () {
      var show = F1.app.getShowroom();
      if (show) show.setMode('menu');
    }
  };

  /* ------------------------------------------------------------------ */
  /* garage                                                              */
  /* ------------------------------------------------------------------ */
  F1.screens.garage = {
    mount: function (root) {
      var show = F1.app.getShowroom();
      show.setMode('garage');
      var wrap = U.node('div', 'screen-inner');

      wrap.appendChild(U.header({ title: 'Garage', sub: '2026 grid \u00b7 procedural liveries' }));

      var layout = U.node('div', 'garage-layout');

      /* team list */
      var listPanel = U.node('div', 'team-list scroll');
      D.teams.forEach(function (team) {
        var item = U.node('button', 'team-item',
          '<span class="sw" style="background:' + team.colors.primary + '"></span>' +
          '<span class="tm"><b>' + esc(team.short) + '</b><span>' + esc(team.powerUnit) + '</span></span>' +
          '<span class="drivers">' + D.driversOf(team.id).map(function (d) { return esc(d.lastName); }).join('<br>') + '</span>');
        item.dataset.team = team.id;
        item.style.pointerEvents = 'auto';
        item.addEventListener('click', function () {
          var first = D.driversOf(team.id)[0];
          show.setTeam(team.id, first.id);
          refresh();
        });
        listPanel.appendChild(item);
      });
      layout.appendChild(listPanel);

      /* center: current car identity + driver switch */
      var center = U.node('div', 'garage-center');
      var idBox = U.node('div', 'panel pad', '');
      idBox.style.pointerEvents = 'auto';
      idBox.style.minWidth = '280px';
      center.appendChild(idBox);
      layout.appendChild(center);

      /* spec panel */
      var specPanel = U.node('div', 'spec-panel');
      layout.appendChild(specPanel);
      wrap.appendChild(layout);

      wrap.appendChild(U.node('div', 'garage-hint', 'Drag to orbit \u00b7 scroll to zoom \u00b7 select a team'));

      function refresh() {
        var teamId = show.getTeam();
        var driverId = show.getDriver();
        var team = D.getTeam(teamId);
        var driver = D.getDriver(driverId);
        var teamDrivers = D.driversOf(teamId);

        Array.prototype.forEach.call(listPanel.children, function (el) {
          el.classList.toggle('on', el.dataset.team === teamId);
          el.style.borderLeftColor = el.dataset.team === teamId ? D.getTeam(el.dataset.team).colors.primary : 'transparent';
        });

        idBox.innerHTML =
          '<div style="font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:' + team.colors.primary + '">' +
            esc(team.name) + '</div>' +
          '<div class="title" style="font-size:30px;margin:6px 0 2px">' + esc(driver.name) + '</div>' +
          '<div class="muted" style="font-size:11px;letter-spacing:.1em">#' + driver.number + ' \u00b7 ' +
            esc(driver.country) + ' ' + U.driverFlag(driver) + '</div>';

        var drvRow = U.node('div', '', '');
        drvRow.style.display = 'flex';
        drvRow.style.gap = '6px';
        drvRow.style.marginTop = '12px';
        teamDrivers.forEach(function (d) {
          var b = U.node('button', 'btn small' + (d.id === driverId ? ' primary' : ' ghost'), esc(d.lastName));
          b.addEventListener('click', function () { show.setTeam(teamId, d.id); refresh(); });
          drvRow.appendChild(b);
        });
        idBox.appendChild(drvRow);

        var perf = team.performance;
        specPanel.innerHTML =
          '<div class="panel pad">' +
            '<h3 class="panel-title">Car performance</h3>' +
            ['aero', 'power', 'chassis', 'reliability', 'development'].map(function (k) {
              return '<div class="spec-bar"><div class="lab"><span>' + k + '</span><b>' + perf[k] + '</b></div>' +
                '<div class="track"><div class="fill" style="width:' + perf[k] + '%;background:' + team.colors.primary + '"></div></div></div>';
            }).join('') +
          '</div>' +
          '<div class="panel pad" style="margin-top:10px">' +
            '<h3 class="panel-title">Team</h3>' +
            '<div class="setting-row" style="padding:6px 0"><span class="muted" style="flex:1">Power unit</span><b>' + esc(team.powerUnit) + '</b></div>' +
            '<div class="setting-row" style="padding:6px 0"><span class="muted" style="flex:1">Team principal</span><b style="text-align:right">' + esc(team.principal) + '</b></div>' +
            '<div class="setting-row" style="padding:6px 0"><span class="muted" style="flex:1">Factory</span><b>' + esc(team.hq) + '</b></div>' +
            '<div class="setting-row" style="padding:6px 0"><span class="muted" style="flex:1">Drivers\u2019 title odds</span><b>' + Math.round(driver.reputation) + '</b></div>' +
          '</div>' +
          '<div class="panel pad" style="margin-top:10px">' +
            '<h3 class="panel-title">Partners</h3>' +
            '<div style="display:flex;flex-wrap:wrap;gap:5px">' +
              (D.titleSponsor(teamId) ? '<span class="chip" style="border-color:' + team.colors.primary + ';color:' + team.colors.primary + '">' + esc(D.titleSponsor(teamId)) + '</span>' : '') +
              D.sponsorsOf(teamId).map(function (s) { return '<span class="chip">' + esc(s.name) + '</span>'; }).join('') +
            '</div>' +
          '</div>';
      }

      refresh();
      return wrap;
    },
    unmount: function () {
      var show = F1.app.getShowroom();
      if (show) show.setMode('menu');
    }
  };

  /* ------------------------------------------------------------------ */
  /* 2026 grid                                                           */
  /* ------------------------------------------------------------------ */
  F1.screens.grid = {
    mount: function (root) {
      var wrap = U.node('div', 'screen-inner');
      wrap.appendChild(U.header({
        title: '2026 Grid', sub: '11 teams \u00b7 22 drivers',
        right: U.node('div', 'top-chip', '<span class="dot"></span><b>' + D.drivers.length + '</b> drivers')
      }));
      var grid = U.node('div', 'grid-teams');
      D.teams.forEach(function (team) {
        var card = U.node('div', 'team-card');
        card.innerHTML =
          '<div class="bar" style="background:' + team.colors.primary + '"></div>' +
          '<h3>' + esc(team.short) + '</h3>' +
          '<div class="pu">' + esc(team.powerUnit) + ' \u00b7 ' + esc(team.principal) + ' \u00b7 ' + esc(team.hq) + '</div>' +
          D.driversOf(team.id).map(function (d) {
            return '<div class="drv">' +
              '<span class="n" style="color:' + team.colors.primary + '">' + d.number + '</span>' +
              '<span class="nm">' + esc(d.name) + '</span>' +
              '<span class="flag">' + D.flag(d.countryCode) + '</span>' +
              '<span class="rat">' + D.driverOverall(d) + '</span>' +
            '</div>';
          }).join('') +
          '<div class="info"><span>PU ' + esc(team.puShort) + '</span>' +
            '<span>' + esc(team.country) + '</span>' +
            '<span>' + (D.titleSponsor(team.id) || team.short) + '</span></div>';
        grid.appendChild(card);
      });
      wrap.appendChild(grid);
      return wrap;
    }
  };

  /* ------------------------------------------------------------------ */
  /* quick race — circuit browser                                        */
  /* ------------------------------------------------------------------ */
  F1.screens['quick-race'] = {
    mount: function (root) {
      var wrap = U.node('div', 'screen-inner');
      var selection = { circuit: 'monza' };
      var cancelled = F1.settings.gameplay.includeCancelled;

      wrap.appendChild(U.header({
        title: 'Quick Race', sub: 'Choose a circuit \u00b7 2026 calendar'
      }));

      var toolbar = U.node('div', 'toolbar');
      toolbar.innerHTML =
        '<label>Race length' +
          '<span class="seg" id="len-seg">' +
            '<button data-len="0.25" class="' + (F1.settings.gameplay.raceLength === 0.25 ? 'on' : '') + '">25%</button>' +
            '<button data-len="0.5" class="' + (F1.settings.gameplay.raceLength === 0.5 ? 'on' : '') + '">50%</button>' +
            '<button data-len="1" class="' + (F1.settings.gameplay.raceLength === 1 ? 'on' : '') + '">100%</button>' +
          '</span>' +
        '</label>' +
        '<label><span class="toggle ' + (cancelled ? 'on' : '') + '" id="cancelled-toggle"></span> Include Middle East rounds</label>' +
        '<span class="spacer"></span>' +
        '<span class="muted" style="font-size:11px">' + (cancelled ? 24 : 22) + ' races \u00b7 6 sprints</span>';
      wrap.appendChild(toolbar);

      toolbar.querySelectorAll('#len-seg button').forEach(function (b) {
        b.addEventListener('click', function () {
          F1.settings.gameplay.raceLength = parseFloat(b.dataset.len);
          F1.settings.save();
          toolbar.querySelectorAll('#len-seg button').forEach(function (x) { x.classList.toggle('on', x === b); });
        });
      });
      var ct = toolbar.querySelector('#cancelled-toggle');
      ct.addEventListener('click', function () {
        cancelled = !cancelled;
        F1.settings.gameplay.includeCancelled = cancelled;
        F1.settings.save();
        ct.classList.toggle('on', cancelled);
        renderGrid();
      });

      var grid = U.node('div', 'circuit-grid scroll');
      wrap.appendChild(grid);

      var footer = U.node('div', 'panel pad');
      footer.style.display = 'flex';
      footer.style.alignItems = 'center';
      footer.style.gap = '18px';
      footer.style.marginTop = '14px';
      footer.style.pointerEvents = 'auto';
      wrap.appendChild(footer);

      function renderGrid() {
        grid.innerHTML = '';
        D.activeCalendar(cancelled).forEach(function (ct2) {
          var team = D.getTeam('ferrari');
          var card = U.node('button', 'circuit-card' + (ct2.id === selection.circuit ? ' on' : ''));
          card.style.pointerEvents = 'auto';
          card.innerHTML =
            '<div class="flagline" style="background:' + ct2.theme.accent + '"></div>' +
            '<div class="rd">ROUND ' + ct2.round + '</div>' +
            '<div class="nm">' + esc(ct2.name) + '</div>' +
            '<div class="loc">' + esc(ct2.official) + '</div>' +
            '<div class="meta"><span><b>' + (ct2.length / 1000).toFixed(3) + '</b> km</span>' +
              '<span><b>' + ct2.laps + '</b> laps</span>' +
              '<span><b>' + ct2.corners + '</b> corners</span></div>' +
            '<div style="margin-top:8px">' +
              (ct2.sprint ? U.chip('Sprint', 'sprint') : '') +
              (ct2.cancelledIRL ? U.chip('Cancelled IRL', 'cancelled') : '') +
              (ct2.approximate ? U.chip('Approx', 'approx') : '') +
            '</div>';
          card.addEventListener('click', function () {
            selection.circuit = ct2.id;
            grid.querySelectorAll('.circuit-card').forEach(function (x) { x.classList.remove('on'); });
            card.classList.add('on');
            updateFooter(ct2);
          });
          grid.appendChild(card);
        });
        updateFooter(D.getCircuitMeta(selection.circuit));
      }

      function updateFooter(meta) {
        footer.innerHTML =
          '<div style="min-width:0">' +
            '<div style="font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:' + meta.theme.accent + '">Round ' + meta.round + ' \u00b7 ' + esc(meta.country) + '</div>' +
            '<div class="title" style="font-size:24px">' + esc(meta.official) + '</div>' +
            '<div class="muted" style="font-size:11.5px;margin-top:2px">' +
              (meta.length / 1000).toFixed(3) + ' km \u00b7 ' + meta.laps + ' laps \u00b7 ' + meta.corners + ' corners \u00b7 ' +
              esc(meta.timeOfDay) + (meta.sprint ? ' \u00b7 sprint weekend' : '') +
            '</div>' +
          '</div>' +
          '<div style="flex:1"></div>' +
          '<button class="btn primary" id="start-race">Start Session \u203a</button>';
        footer.querySelector('#start-race').addEventListener('click', function () {
          if (F1.app.startQuickRace) F1.app.startQuickRace({ circuit: meta.id, raceLength: F1.settings.gameplay.raceLength });
          else F1.app.toast('Race sessions arrive in the next build (Section 3). Track environments are Section 2.');
        });
      }

      renderGrid();
      return wrap;
    }
  };

  /* ------------------------------------------------------------------ */
  /* settings                                                            */
  /* ------------------------------------------------------------------ */
  F1.screens.settings = {
    mount: function (root) {
      var wrap = U.node('div', 'screen-inner');
      var body = U.node('div', 'scroll');
      body.style.flex = '1';
      body.style.paddingRight = '6px';

      wrap.appendChild(U.header({ title: 'Settings', sub: 'Stored locally \u00b7 exported as JSON' }));

      function section(title, rows) {
        var panel = U.node('div', 'panel pad');
        panel.style.marginBottom = '10px';
        panel.innerHTML = '<h3 class="panel-title">' + title + '</h3>';
        var list = U.node('div', '');
        rows.forEach(function (r) { list.appendChild(r); });
        panel.appendChild(list);
        return panel;
      }

      function row(label, hint, control) {
        var el = U.node('div', 'setting-row');
        el.innerHTML = '<div class="setting-label"><b>' + label + '</b>' + (hint ? '<span>' + hint + '</span>' : '') + '</div>';
        el.appendChild(control);
        return el;
      }

      function seg(options, current, onChange) {
        var wrapEl = U.node('span', 'seg');
        options.forEach(function (o) {
          var b = U.node('button', String(o.label), '');
          b.className = String(o.value) === String(current) ? 'on' : '';
          b.addEventListener('click', function () {
            wrapEl.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
            b.classList.add('on');
            onChange(o.value);
          });
          wrapEl.appendChild(b);
        });
        return wrapEl;
      }

      function toggle(value, onChange) {
        var t = U.node('span', 'toggle' + (value ? ' on' : ''));
        t.style.pointerEvents = 'auto';
        t.addEventListener('click', function () {
          value = !value;
          t.classList.toggle('on', value);
          onChange(value);
        });
        return t;
      }

      function slider(value, min, max, step, onChange, fmt) {
        var holder = U.node('span', '', '');
        holder.style.display = 'flex'; holder.style.alignItems = 'center'; holder.style.gap = '10px';
        var out = U.node('b', 'nowrap', fmt ? fmt(value) : String(value));
        out.style.textAlign = 'right'; out.style.minWidth = '44px';
        var inp = U.node('input', '');
        inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = value;
        inp.addEventListener('input', function () {
          var v = parseFloat(inp.value);
          out.textContent = fmt ? fmt(v) : String(v);
          onChange(v);
        });
        holder.appendChild(inp); holder.appendChild(out);
        return holder;
      }

      /* ---- graphics ---- */
      var g = F1.settings.graphics;
      body.appendChild(section('Graphics', [
        row('Quality preset', 'Low to Ultra \u2014 affects shadows, draw distance and crowds',
          seg([{ label: 'Low', value: 'low' }, { label: 'Med', value: 'medium' }, { label: 'High', value: 'high' }, { label: 'Ultra', value: 'ultra' }],
            g.quality, function (v) { F1.renderer.setQuality(v); F1.app.toast('Graphics: ' + v.toUpperCase()); })),
        row('Auto quality', 'Drop a preset if FPS stays below 40 for 5 seconds',
          toggle(g.autoQuality, function (v) { g.autoQuality = v; F1.settings.save(); })),
        row('Resolution scale', 'Render resolution relative to the preset',
          slider(g.resolutionScale, 60, 100, 5, function (v) {
            g.resolutionScale = v; F1.settings.save();
            var preset = F1.settings.preset(); F1.renderer.quality = preset; F1.renderer.applySizing();
          }, function (v) { return v + '%'; })),
        row('Field of view', 'Default camera FOV',
          slider(g.fov, 45, 80, 1, function (v) {
            g.fov = v; F1.settings.save();
            if (F1.renderer.camera) { F1.renderer.camera.fov = v; F1.renderer.camera.updateProjectionMatrix(); }
          }, function (v) { return v + '\u00b0'; })),
        row('Performance overlay', 'FPS, draw calls and memory',
          toggle(F1.settings.display.showPerformance, function (v) { F1.settings.display.showPerformance = v; F1.settings.save(); }))
      ]));

      /* ---- audio ---- */
      var a = F1.settings.audio;
      body.appendChild(section('Audio', [
        row('Master volume', '', slider(Math.round(a.master * 100), 0, 100, 5, function (v) { a.master = v / 100; F1.settings.save(); }, function (v) { return v + '%'; })),
        row('Engine', '', slider(Math.round(a.engine * 100), 0, 100, 5, function (v) { a.engine = v / 100; F1.settings.save(); }, function (v) { return v + '%'; })),
        row('Tyres & surface', '', slider(Math.round(a.tyres * 100), 0, 100, 5, function (v) { a.tyres = v / 100; F1.settings.save(); }, function (v) { return v + '%'; })),
        row('Crowd', '', slider(Math.round(a.crowd * 100), 0, 100, 5, function (v) { a.crowd = v / 100; F1.settings.save(); }, function (v) { return v + '%'; }))
      ]));

      /* ---- gameplay ---- */
      var gp = F1.settings.gameplay;
      body.appendChild(section('Gameplay', [
        row('Units', '', seg([{ label: 'km/h', value: 'kmh' }, { label: 'mph', value: 'mph' }], gp.units,
          function (v) { gp.units = v; F1.settings.save(); })),
        row('Race length', 'Minimum 3 laps',
          seg([{ label: '25%', value: 0.25 }, { label: '50%', value: 0.5 }, { label: '100%', value: 1 }], gp.raceLength,
            function (v) { gp.raceLength = parseFloat(v); F1.settings.save(); })),
        row('Include Middle East rounds', 'Bahrain and Saudi Arabia were removed from the 2026 calendar',
          toggle(gp.includeCancelled, function (v) { gp.includeCancelled = v; F1.settings.save(); })),
        row('Difficulty', '', seg([{ label: 'Rookie', value: 'rookie' }, { label: 'Balanced', value: 'balanced' }, { label: 'Pro', value: 'pro' }, { label: 'Legend', value: 'legend' }],
          gp.difficulty, function (v) { gp.difficulty = v; F1.settings.save(); }))
      ]));

      /* ---- assists ---- */
      var as = F1.settings.assists;
      body.appendChild(section('Assists', [
        row('Traction control', '', slider(as.tractionControl, 0, 3, 1, function (v) { as.tractionControl = v; F1.settings.save(); }, function (v) { return ['Off', 'Low', 'Med', 'Full'][v]; })),
        row('ABS', '', slider(as.abs, 0, 2, 1, function (v) { as.abs = v; F1.settings.save(); }, function (v) { return ['Off', 'Low', 'On'][v]; })),
        row('Steering assist', '', slider(as.steeringAssist, 0, 2, 1, function (v) { as.steeringAssist = v; F1.settings.save(); }, function (v) { return ['Off', 'Low', 'On'][v]; })),
        row('Racing line', '', seg([{ label: 'Off', value: 0 }, { label: 'Braking', value: 1 }, { label: 'Full', value: 2 }], as.racingLine,
          function (v) { as.racingLine = parseInt(v, 10); F1.settings.save(); })),
        row('Auto gearbox', '', toggle(as.autoGears, function (v) { as.autoGears = v; F1.settings.save(); }))
      ]));

      /* ---- controls ---- */
      var bindRows = [
        ['throttle', 'Throttle'], ['brake', 'Brake'], ['steerLeft', 'Steer left'], ['steerRight', 'Steer right'],
        ['gearUp', 'Shift up'], ['gearDown', 'Shift down'], ['boost', 'Boost / Overtake'],
        ['camera', 'Camera'], ['pause', 'Pause'], ['resetCar', 'Reset to track']
      ].map(function (pair) {
        var action = pair[0];
        var b = U.node('button', 'btn small ghost', '');
        function setLabel() {
          b.textContent = (F1.settings.controls.binds[action] || []).map(F1.input.keyLabel).join(' / ') || 'Unbound';
        }
        b.addEventListener('click', function () {
          b.textContent = 'Press a key\u2026';
          F1.input.startCapture(action, function (code) {
            setLabel();
            if (code) F1.app.toast(F1.input.keyLabel(code) + ' bound to ' + pair[1]);
          });
        });
        setLabel();
        return row(pair[1], '', b);
      });
      body.appendChild(section('Controls \u00b7 keyboard', bindRows.concat([
        row('Gamepad', 'Standard mapping: RT/LT, left stick, A boost, X overtake',
          U.node('span', 'muted', F1.input.gamepadConnected ? 'Connected: ' + esc(F1.input.gamepadName) : 'Not detected'))
      ])));

      /* ---- data ---- */
      var dataRow = U.node('div', '');
      dataRow.style.display = 'flex';
      dataRow.style.gap = '8px';
      dataRow.style.marginTop = '8px';
      var exportBtn = U.node('button', 'btn small', 'Export saves (JSON)');
      exportBtn.addEventListener('click', function () {
        var blob = new Blob([JSON.stringify(F1.storage.exportAll(), null, 2)], { type: 'application/json' });
        var a2 = document.createElement('a');
        a2.href = URL.createObjectURL(blob);
        a2.download = 'f1-2026-saves.json';
        a2.click();
        setTimeout(function () { URL.revokeObjectURL(a2.href); }, 1500);
        F1.app.toast('Save file exported');
      });
      var importInput = U.node('input', '');
      importInput.type = 'file'; importInput.accept = '.json,application/json';
      importInput.style.display = 'none';
      importInput.addEventListener('change', function () {
        var f = importInput.files && importInput.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            F1.storage.importAll(JSON.parse(reader.result));
            F1.app.toast('Saves imported \u00b7 reload recommended');
          } catch (e) { F1.app.toast('Import failed: ' + e.message); }
        };
        reader.readAsText(f);
      });
      var importBtn = U.node('button', 'btn small', 'Import saves');
      importBtn.addEventListener('click', function () { importInput.click(); });
      var resetBtn = U.node('button', 'btn small ghost danger', 'Reset settings');
      resetBtn.addEventListener('click', function () {
        F1.settings.reset();
        F1.app.toast('Settings reset');
        F1.app.show('settings');
      });
      dataRow.appendChild(exportBtn);
      dataRow.appendChild(importBtn);
      dataRow.appendChild(resetBtn);
      dataRow.appendChild(importInput);

      body.appendChild(section('Saves & data', [row('Backup', 'localStorage can be flaky on file:// URLs', dataRow)]));

      wrap.appendChild(body);
      return wrap;
    }
  };

  /* ------------------------------------------------------------------ */
  /* track preview — proves the circuit + environment pipeline           */
  /* ------------------------------------------------------------------ */
  F1.screens['track-preview'] = {
    noScrim: true,          // full-screen 3D: only the info panel darkens anything
    mount: function (root, params) {
      var circuitId = params.circuit || 'monza';
      var meta = D.getCircuitMeta(circuitId);
      var wrap = U.node('div', 'screen-inner no-scrim');

      var api = null;
      var loading = U.node('div', 'stub');
      loading.innerHTML = '<span class="build-chip">Loading circuit</span><h2>' + esc(meta.official) + '</h2>' +
        '<p>' + esc(meta.blurb) + '</p>';
      wrap.appendChild(loading);
      root.appendChild(wrap);

      setTimeout(function () {
        try {
          api = F1.trackScene.create(circuitId, {});
        } catch (e) {
          loading.innerHTML = '<h2>Could not build circuit</h2><p>' + esc(e.message) + '</p>';
          console.error(e);
          return;
        }
        F1.app.currentSession = api;
        F1.app.setScene(api);
        wrap.innerHTML = '';

        var head = U.header({
          title: meta.name, sub: meta.official + ' \u00b7 ' + (meta.length / 1000).toFixed(3) + ' km',
          backLabel: 'Circuits',
          onBack: function () {
            F1.app.currentSession = null;
            F1.app.show('quick-race');
          }
        });
        head.style.pointerEvents = 'auto';
        wrap.appendChild(head);

        var info = U.node('div', 'panel pad');
        info.style.position = 'absolute';
        info.style.left = '38px';
        info.style.bottom = '26px';
        info.style.width = '330px';
        info.style.pointerEvents = 'auto';
        info.innerHTML =
          '<h3 class="panel-title">Session preview</h3>' +
          '<div class="setting-row" style="padding:6px 0"><span class="muted" style="flex:1">Lap length</span><b>' + (api.track.length / 1000).toFixed(3) + ' km</b></div>' +
          '<div class="setting-row" style="padding:6px 0"><span class="muted" style="flex:1">Samples</span><b>' + api.track.count + '</b></div>' +
          '<div class="setting-row" style="padding:6px 0"><span class="muted" style="flex:1">Sectors</span><b>' + api.track.sectors.map(function (x) { return Math.round(x * 100) + '%'; }).join(' / ') + '</b></div>' +
          '<div class="setting-row" style="padding:6px 0"><span class="muted" style="flex:1">Boost zones</span><b>' + api.track.drs.length + '</b></div>' +
          '<div class="setting-row" style="padding:6px 0"><span class="muted" style="flex:1">Time of day</span><b>' + esc(meta.timeOfDay) + '</b></div>' +
          '<div class="setting-row" style="padding:6px 0"><span class="muted" style="flex:1">Data</span><b>' + (api.track.source === 'tum' ? 'surveyed' : 'traced') + '</b></div>' +
          '<div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap">' +
            '<button class="btn small" id="cam-fly">Flyover</button>' +
            '<button class="btn small" id="cam-orbit">Orbit</button>' +
            '<button class="btn small" id="cam-side">Trackside</button>' +
          '</div>' +
          '<p class="muted" style="font-size:10.5px;line-height:1.5;margin:12px 0 0">' +
            'Driving arrives in Section 3. Use the buttons or drag / scroll in orbit mode.' +
          '</p>';
        wrap.appendChild(info);
        var camBtns = info.querySelectorAll('button');
        function mark(active) {
          camBtns.forEach(function (b) { b.classList.toggle('primary', b === active); });
        }
        info.querySelector('#cam-fly').addEventListener('click', function (e) { api.setCameraMode('flyover'); mark(e.target); });
        info.querySelector('#cam-orbit').addEventListener('click', function (e) { api.setCameraMode('orbit'); mark(e.target); });
        info.querySelector('#cam-side').addEventListener('click', function (e) { api.setCameraMode('trackside'); mark(e.target); });
        mark(info.querySelector('#cam-fly'));
      }, 60);

      return wrap;
    },
    unmount: function () {
      var api = F1.app.currentSession;
      if (api && api.destroy) {
        try { api.destroy(); } catch (e) { console.error(e); }
      }
      F1.app.currentSession = null;
      F1.app.setScene(null);
    }
  };

  /* ------------------------------------------------------------------ */
  /* placeholder screens for later sections                              */
  /* ------------------------------------------------------------------ */
  function stubScreen(name, title, text, features, build) {
    F1.screens[name] = {
      mount: function () {
        var wrap = U.node('div', 'screen-inner');
        wrap.appendChild(U.header({ title: title, sub: 'Coming in ' + build }));
        var stub = U.node('div', 'stub');
        stub.innerHTML =
          '<span class="build-chip">Planned \u00b7 ' + build + '</span>' +
          '<h2>' + title + '</h2>' +
          '<p>' + text + '</p>' +
          '<div class="features">' + features.map(function (f) { return '<span>' + f + '</span>'; }).join('') + '</div>' +
          '<button class="btn" id="stub-back">Back to menu</button>';
        stub.querySelector('#stub-back').addEventListener('click', function () { F1.app.show('main-menu'); });
        wrap.appendChild(stub);
        return wrap;
      }
    };
  }

  stubScreen('career', 'Career',
    'Create a driver or take over one of the 22 seats, then run the 2026 season with contracts, objectives, an R&amp;D tree, a driver market and up to ten seasons of saves.',
    ['Create-a-driver', 'Real driver', 'Contracts', 'R&amp;D', 'Driver market', '3 save slots'], 'Section 6');

  stubScreen('time-trial', 'Time Trial',
    'A solo qualifying-style session with a ghost car of your best lap, sector analysis and personal bests stored per circuit.',
    ['Ghost car', 'Sector deltas', 'PBs per circuit'], 'Section 5');

  stubScreen('championship', 'Championship',
    'Build a custom season from any of the 24 rounds, pick any real driver and fight for a drivers\u2019 and constructors\u2019 title with full F1 points.',
    ['Custom calendar', 'Sprint points', 'Standings'], 'Section 5');

  F1.ui = U;
})(window.F1 = window.F1 || {});
