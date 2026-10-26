/* ==========================================================================
   F1 2026 — core/app.js
   Application shell: boot sequence, screen manager, scene switching, main
   loop, toasts, error overlay and the loading screen.
   ========================================================================== */
(function (F1) {
  'use strict';

  var App = {
    current: null,
    currentName: null,
    sceneApi: null,
    booted: false,
    running: false,
    bootEls: null,
    history: []
  };

  /* ------------------------------------------------------------------ */
  /* boot / loading UI                                                   */
  /* ------------------------------------------------------------------ */
  App.boot = function () {
    App.bootEls = {
      root: document.getElementById('boot'),
      bar: document.getElementById('boot-bar'),
      step: document.getElementById('boot-step'),
      trivia: document.getElementById('boot-trivia')
    };
    var trivia = [
      'The 2026 cars are shorter, narrower and 768\u2009kg: active aero replaces DRS.',
      'The 2026 power units split combustion and electric power roughly 50/50.',
      'Suzuka is the only figure-of-eight layout on the calendar.',
      'Monza\u2019s Parabolica is taken at over 250 km/h and never quite flat.',
      'Spa\u2019s Eau Rouge rises 40 metres in under a kilometre.',
      'Monaco\u2019s tunnel is one of only two on the calendar \u2014 Las Vegas has the other.',
      'A 100% sustainable fuel produces the same power as the 2025 engines.',
      'Overtake mode gives a chasing car extra electrical deployment, not DRS.'
    ];
    if (App.bootEls.trivia) App.bootEls.trivia.textContent = trivia[Math.floor(Math.random() * trivia.length)];
  };

  App.progress = function (frac, label) {
    if (!App.bootEls) return;
    var pct = Math.round(F1.util.clamp(frac, 0, 1) * 100);
    if (App.bootEls.bar) App.bootEls.bar.style.width = pct + '%';
    if (App.bootEls.step && label) App.bootEls.step.textContent = label;
    var pctEl = document.getElementById('boot-pct');
    if (pctEl) pctEl.textContent = pct + '%';
  };

  App.hideBoot = function () {
    if (!App.bootEls || !App.bootEls.root) return;
    App.bootEls.root.classList.add('done');
    setTimeout(function () { if (App.bootEls.root) App.bootEls.root.style.display = 'none'; }, 650);
  };

  /* ------------------------------------------------------------------ */
  /* screens                                                             */
  /* ------------------------------------------------------------------ */
  App.register = function (name, screen) {
    F1.screens[name] = screen;
  };

  App.show = function (name, params) {
    var screen = F1.screens[name];
    if (!screen) {
      console.warn('[app] unknown screen', name);
      return;
    }
    if (App.current && App.current.unmount) {
      try { App.current.unmount(); } catch (e) { console.error(e); }
    }
    if (App.currentName && App.currentName !== name) App.history.push(App.currentName);
    var root = document.getElementById('screen-root');
    root.innerHTML = '';
    App.current = screen;
    App.currentName = name;
    root.className = 'screen screen-' + name + (screen.noScrim ? ' no-scrim' : '');
    var node = screen.mount(root, params || {});
    if (node && node.parentNode !== root) root.appendChild(node);
    root.classList.add('visible');
    document.body.dataset.screen = name;
    F1.bus.emit('screen', name, params);
    return node;
  };

  App.back = function () {
    var prev = App.history.pop();
    App.show(prev || 'main-menu');
  };

  App.setScene = function (api) {
    App.sceneApi = api;
  };

  /* ------------------------------------------------------------------ */
  /* track preview (Section 2) / race session (Section 3+)              */
  /* ------------------------------------------------------------------ */
  App.currentSession = null;

  App.startQuickRace = function (params) {
    params = params || {};
    var id = params.circuit || F1.settings.gameplay.lastCircuit || 'italy';
    var meta = F1.DATA.getCircuitMeta(id);
    var frac = params.raceLength || F1.settings.gameplay.raceLength || 0.25;
    params.circuit = id;
    params.laps = params.laps || Math.max(3, Math.round((meta.laps || 50) * frac));
    params.teamId = params.teamId || F1.settings.career.teamId || 'mclaren';
    params.driverId = params.driverId || F1.DATA.teamOf(params.teamId).drivers[0];
    F1.settings.gameplay.lastCircuit = id;
    F1.settings.save();
    App.show('race', params);
  };

  /* ------------------------------------------------------------------ */
  /* toast                                                               */
  /* ------------------------------------------------------------------ */
  App.toast = function (msg, ms) {
    var root = document.getElementById('toast-root');
    if (!root) return;
    var el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = msg;
    root.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('in'); });
    setTimeout(function () {
      el.classList.remove('in');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 350);
    }, ms || 2600);
  };
  F1.bus.on('toast', function (m) { App.toast(m); });

  /* a small "sound off" chip lives on <body> so it survives every screen */
  App.setAudioMutedClass = function (on) {
    document.body.classList.toggle('audio-muted', !!on);
  };

  /* ------------------------------------------------------------------ */
  /* error overlay — makes file:// debugging possible                    */
  /* ------------------------------------------------------------------ */
  App.installErrorOverlay = function () {
    var shown = 0;
    function show(kind, msg, detail) {
      if (shown++ > 6) return;
      var box = document.getElementById('error-overlay');
      if (!box) return;
      box.classList.add('visible');
      var item = document.createElement('div');
      item.className = 'err-item';
      item.innerHTML = '<b>' + kind + '</b> ' + String(msg).replace(/</g, '&lt;') +
        (detail ? '<pre>' + String(detail).split('\n').slice(0, 4).join('\n').replace(/</g, '&lt;') + '</pre>' : '');
      box.appendChild(item);
    }
    window.addEventListener('error', function (e) {
      show('ERROR', e.message || 'Unknown error', e.filename + ':' + e.lineno + '\n' + (e.error && e.error.stack || ''));
    });
    window.addEventListener('unhandledrejection', function (e) {
      show('PROMISE', (e.reason && e.reason.message) || e.reason || 'Unhandled rejection');
    });
    var oldError = console.error;
    console.error = function () {
      var args = Array.prototype.slice.call(arguments);
      oldError.apply(console, args);
      show('CONSOLE', args.map(function (a) { return a && a.message ? a.message : String(a); }).join(' '));
    };
  };

  /* ------------------------------------------------------------------ */
  /* performance overlay                                                 */
  /* ------------------------------------------------------------------ */
  App.installPerfOverlay = function () {
    var el = document.createElement('div');
    el.id = 'perf-overlay';
    document.getElementById('ui').appendChild(el);
    App._perfEl = el;
    setInterval(function () {
      var show = F1.settings.display.showPerformance;
      el.style.display = show ? 'block' : 'none';
      if (!show) return;
      var i = F1.renderer.info();
      el.innerHTML = '<b>' + i.fps + ' FPS</b><br>' +
        i.calls + ' draw calls<br>' + i.triangles.toLocaleString() + ' tris<br>' +
        i.geometries + ' geo / ' + i.textures + ' tex<br>' +
        'quality: ' + F1.settings.graphics.quality;
    }, 500);
  };

  /* ------------------------------------------------------------------ */
  /* main loop                                                           */
  /* ------------------------------------------------------------------ */
  App.start = function () {
    if (App.running) return;
    App.running = true;
    var last = performance.now();
    var acc = 0;
    function frame(now) {
      requestAnimationFrame(frame);
      var dt = (now - last) / 1000;
      last = now;
      if (dt > 0.25) dt = 0.25;   // tab switch guard
      acc += dt;
      F1.input.update(dt);
      if (App.sceneApi && App.sceneApi.update) {
        try { App.sceneApi.update(dt); } catch (e) { console.error('[scene]', e); }
      }
      F1.renderer.tick(dt);
      if (App.sceneApi && App.sceneApi.scene) {
        F1.renderer.render(App.sceneApi.scene, App.sceneApi.camera);
      }
      F1.bus.emit('frame', dt);
    }
    requestAnimationFrame(frame);
  };

  /* ------------------------------------------------------------------ */
  /* startup                                                             */
  /* ------------------------------------------------------------------ */
  /* audio cannot start before a user gesture: arm it on the first one */
  function armAudio() {
    if (!F1.audio) return;
    var on = function () {
      F1.audio.init();
      F1.audio.beep('click');
      window.removeEventListener('pointerdown', on);
      window.removeEventListener('keydown', on);
      window.removeEventListener('touchstart', on);
    };
    window.addEventListener('pointerdown', on);
    window.addEventListener('keydown', on);
    window.addEventListener('touchstart', on);
  }

  App.init = function () {
    App.installErrorOverlay();
    F1.input.init();
    armAudio();
    if (F1.settings.audio.muted) App.setAudioMutedClass(true);

    F1.renderer.init(document.getElementById('gl'));
    App.installPerfOverlay();

    App.boot();

    // Run the boot sequence across a few animation frames so the progress
    // bar actually paints. Steps are real (data validation, geometry build,
    // shader compile) but fast on a modern machine.
    var steps = [
      { p: 0.12, label: 'Loading 2026 regulations\u2026', fn: function () { validateData(); } },
      { p: 0.34, label: 'Building procedural car geometry\u2026', fn: function () {} },
      { p: 0.58, label: 'Painting liveries\u2026', fn: function () { buildFirstCar(); } },
      { p: 0.80, label: 'Compiling shaders\u2026', fn: function () { compileShaders(); } },
      { p: 0.95, label: 'Warming up the pit lane\u2026', fn: function () {} }
    ];

    var i = 0;
    function next() {
      if (i >= steps.length) {
        App.progress(1, 'Ready');
        setTimeout(function () {
          App.hideBoot();
          App.show(App.savedScreen() || 'main-menu');
          App.start();
          F1.bus.emit('app-ready');
        }, 260);
        return;
      }
      var s = steps[i++];
      App.progress(s.p, s.label);
      try { s.fn(); } catch (e) { console.error('[boot]', e); }
      setTimeout(next, 140);
    }
    setTimeout(next, 260);
  };

  App.savedScreen = function () {
    // Always start on the menu; career "continue" lives in the menu.
    return null;
  };

  var showroom = null;
  App.getShowroom = function () {
    if (!showroom) {
      showroom = F1.showroom.create();
      App.setScene(showroom.api);
    }
    return showroom;
  };

  function validateData() {
    var d = F1.DATA;
    if (!d || !d.teams || d.teams.length !== 11) throw new Error('team data missing');
    if (!d.drivers || d.drivers.length !== 22) throw new Error('driver data missing');
    if (!d.circuits || d.circuits.length !== 24) throw new Error('circuit data missing');
    if (d.activeCalendar(false).length !== 22) throw new Error('calendar filtering broken');
    console.log('[boot] data OK: ' + d.teams.length + ' teams, ' + d.drivers.length +
      ' drivers, ' + d.circuits.length + ' rounds (' + d.sprintCount(false) + ' sprints)');
  }

  function buildFirstCar() {
    var show = App.getShowroom();
    show.setTeam('mclaren', 'norris');
    show.setMode('menu');
    App.setScene(show.api);
  }

  function compileShaders() {
    try { F1.renderer.renderer.compile(App.sceneApi.scene, App.sceneApi.camera); }
    catch (e) { console.warn('[boot] shader precompile skipped', e); }
  }

  F1.app = App;
})(window.F1 = window.F1 || {});
