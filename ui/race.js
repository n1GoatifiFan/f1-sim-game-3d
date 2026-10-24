/* ==========================================================================
   F1 2026 — ui/race.js
   The driveable session screen: builds the circuit scene, mounts the session
   and the HUD, and owns the pause menu and the finish card.
   ========================================================================== */
(function (F1) {
  'use strict';

  var U = F1.util;
  var D = F1.DATA;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function hit(action, code) {
    var binds = F1.settings.controls.binds[action] || [];
    return binds.indexOf(code) >= 0;
  }

  F1.screens = F1.screens || {};

  F1.screens.race = {
    noScrim: true,
    mount: function (root, params) {
      var circuitId = params.circuit || F1.settings.gameplay.lastCircuit || 'italy';
      var meta = D.getCircuitMeta(circuitId);
      var wrap = document.createElement('div');
      wrap.className = 'race-layer';
      wrap.style.pointerEvents = 'none';
      root.appendChild(wrap);
      root.classList.add('race-active');

      var loading = document.createElement('div');
      loading.className = 'race-loading';
      loading.innerHTML = '<span class="build-chip">Building circuit</span><h2>' + esc(meta.name) + '</h2>' +
        '<p>' + esc(meta.blurb || '') + '</p>';
      wrap.appendChild(loading);

      var sceneApi = null, session = null, hud = null, pausePanel = null;
      var keyHandler = null;
      var disposed = false;

      /* ---------------- pause menu ---------------- */
      function buildPausePanel() {
        var panel = document.createElement('div');
        panel.className = 'race-pause';
        panel.innerHTML =
          '<div class="pause-card">' +
          '<div class="pause-chip">Paused</div>' +
          '<h2>' + esc(meta.name) + '</h2>' +
          '<div class="pause-actions">' +
          '<button class="btn primary" data-act="resume">Resume</button>' +
          '<button class="btn" data-act="restart">Restart session</button>' +
          '<button class="btn" data-act="camera">Change camera</button>' +
          (params.career ? '<button class="btn" data-act="career">Back to career</button>' : '') +
          (params.championship ? '<button class="btn" data-act="champ">Back to championship</button>' : '') +
          (params.timeTrial ? '<button class="btn" data-act="tt">Back to time trial</button>' : '') +
          (params.weekend ? '<button class="btn" data-act="paddock">Return to paddock</button>' : '') +
          '<button class="btn ghost" data-act="quit">Quit to menu</button>' +
          '</div>' +
          '<div class="pause-keys muted">' +
          '<span><b>W / S</b> throttle &amp; brake</span><span><b>A / D</b> steer</span>' +
          '<span><b>Space</b> ERS deploy</span><span><b>F</b> ERS mode</span>' +
          '<span><b>C</b> camera</span><span><b>X</b> look back</span>' +
          '<span><b>R</b> reset car</span><span><b>H</b> HUD</span>' +
          '<span><b>P</b> pit request</span><span><b>[ / ]</b> pit tyres</span>' +
          '<span><b>T</b> replay</span><span><b>V</b> photo mode</span>' +
          '<span><b>Esc</b> pause</span>' +
          '</div>' +
          '<div class="pause-note muted">Esc resumes \u00b7 M mutes the audio \u00b7 F3 shows the frame timing</div>' +
          '</div>';
        panel.addEventListener('click', function (e) {
          var b = e.target.closest('[data-act]');
          if (!b) return;
          var act = b.getAttribute('data-act');
          if (act === 'paddock') { recordWeekend(); quit(true); }
          else if (act === 'career') { recordCareer(); quit('career'); }
          else if (act === 'champ') { recordChampionship(); quit('champ'); }
          else if (act === 'tt') { recordTimeTrial(); quit('tt'); }
          else if (act === 'resume') setPaused(false);
          else if (act === 'restart') restart();
          else if (act === 'camera') { if (session) session.cycleCamera(); }
          else if (act === 'quit') quit();
        });
        return panel;
      }

      function setPaused(p) {
        if (!session) return;
        session.setPaused(p);
        if (pausePanel) pausePanel.classList.toggle('show', p && session.state.state !== 'finished');
        var hr = document.getElementById('hud-root');
        if (hr) hr.classList.toggle('dimmed', !!p);
      }

      function restart() {
        var hr = document.getElementById('hud-root');
        if (hr) hr.classList.remove('summary');
        quit(true);
        F1.app.show('race', params);
      }

      function quit(toPaddock) {
        if (toPaddock === 'career' && params.career) {
          F1.app.show('career', { career: params.career });
        } else if (toPaddock === 'champ' && params.championship) {
          F1.app.show('championship');
        } else if (toPaddock === 'tt' && params.timeTrial) {
          F1.app.show('time-trial');
        } else if (toPaddock && params.weekend) {
          F1.app.show('weekend', {
            weekend: params.weekend,
            circuitId: params.weekend.circuitId,
            type: params.weekend.type
          });
        } else {
          F1.app.show('main-menu');
        }
      }

      function cleanup() {
        if (disposed) return;
        disposed = true;
        var hr = document.getElementById('hud-root');
        if (hr) hr.classList.remove('summary');
        // leaving a weekend session still counts if the player set a time
        if (params.weekend && session && !params._recorded) {
          try {
            F1.screens.weekend.record(params.weekend, params.weekendSession, {
              results: session.results || [],
              position: session.position,
              bestLap: session.bestLap,
              laps: session.lapsTotal,
              finished: session.state.state === 'finished'
            });
            params._recorded = true;
          } catch (e) { /* the paddock is optional */ }
        }
        F1.bus.off('lap-complete', onLapComplete);
        if (keyHandler) {
          window.removeEventListener('keydown', keyHandler);
          window.removeEventListener('keyup', keyHandler);
        }
        F1.bus.off('hud', onHud);
        F1.bus.off('session-finish', onFinish);
        F1.bus.off('camera-mode', onCameraMode);
        if (hud) { try { hud.destroy(); } catch (e) {} hud = null; }
        if (session) { try { session.dispose(); } catch (e) {} session = null; }
        F1.app.raceSession = null;
        if (sceneApi) { try { sceneApi.destroy(); } catch (e) {} sceneApi = null; }
        F1.app.setScene(null);
      }

      /* ---------------- build the world ---------------- */
      setTimeout(function () {
        if (disposed) return;
        try {
          sceneApi = F1.trackScene.create(circuitId, { mode: 'race' });
        } catch (e) {
          loading.innerHTML = '<h2>Could not build circuit</h2><p>' + esc(e.message) + '</p>';
          console.error(e);
          return;
        }
        F1.app.currentSession = sceneApi;
        F1.app.setScene(sceneApi);
        wrap.removeChild(loading);

        session = F1.session.create(sceneApi, {
          teamId: params.teamId || F1.settings.career.teamId || 'mclaren',
          driverId: params.driverId,
          laps: params.laps,
          compound: params.compound || 'medium',
          camera: params.camera || 'tcam',
          startS: params.startS,
          countdown: params.countdown === undefined ? 3.6 : params.countdown,
          gridSlot: params.gridSlot,
          difficulty: params.difficulty,
          weather: params.weather,
          wetness: params.wetness,
          ambientC: params.ambientC,
          field: params.field,
          seed: params.seed,
          round: params.round,
          order: params.order,
          formationLap: params.formationLap,
          field: params.field,
          ghost: params.ghost
        });
        F1.app.raceSession = session;

        // the track scene calls this every frame
        sceneApi.onFrame = session.update;

        hud = F1.hud.create(document.getElementById('hud-root'));
        F1.bus.on('hud', onHud);
        F1.bus.on('session-finish', onFinish);
        F1.bus.on('camera-mode', onCameraMode);

        pausePanel = buildPausePanel();
        wrap.appendChild(pausePanel);

        F1.screens.race._cleanup = cleanup;
        keyHandler = function (e) {
          if (e.type === 'keyup') { session.onKey(e); return; }
          if (e.repeat) return;
          var code = e.code;
          /* pit controls stay live even when the pause key is bound nearby */
          if (code === 'KeyP' || code === 'BracketLeft' || code === 'BracketRight') {
            if (!session.paused && session.state.state === 'racing') { session.onKey(e); e.preventDefault(); return; }
          }
          if (hit('pause', code) || code === 'Backspace') {
            if (session.state.state === 'finished') return;
            setPaused(!session.paused);
            e.preventDefault();
            return;
          }
          if (session.paused) return;
          if (code === 'Enter' && session.state.state === 'finished') { showSummary(); return; }
          if (hit('cycleHud', code)) { F1.bus.emit('hud-cycle'); return; }
          session.onKey(e);          // camera / reset / ERS / look-back
        };
        window.addEventListener('keydown', keyHandler);
        window.addEventListener('keyup', keyHandler);
      }, 60);

      function onHud(data) {
        if (hud) hud.update(data);
      }
      /* a career round writes its result into the career's season */
      function recordCareer() {
        if (!params.career || !params.careerRound || params._careerDone) return;
        if (!session || session.state.state !== 'finished') return;
        params._careerDone = true;
        try {
          F1.career.advance(params.career, params.careerRound, {
            pos: session.position,
            retired: !!(session.state && session.state.retired),
            pole: false
          });
          var slot = F1.storage.get('career_active', 1) || 1;
          F1.career.save(params.career, slot);
          F1.app.career = params.career;
        } catch (e) { console.error('[career] advance failed', e); }
      }

      /* a custom championship round goes into its own points table */
      function recordChampionship() {
        if (!params.championship || !params.champRound || params._champDone) return;
        if (!session || session.state.state !== 'finished') return;
        params._champDone = true;
        try {
          var r = F1.championshipScreen.record(params, {
            pos: session.position,
            retired: !!(session.state && session.state.retired)
          });
          if (r) F1.app.toast('Championship \u00b7 P' + (r.pos || 22) + ' \u00b7 ' + r.points + ' pts', 2600);
        } catch (e) { console.error('[championship] record failed', e); }
      }

      /* a weekend session writes itself back into the paddock */
      function recordWeekend() {
        if (!params.weekend || !params.weekendSession || !session) return;
        if (params._recorded) return;
        params._recorded = true;
        try {
          F1.screens.weekend.record(params.weekend, params.weekendSession, {
            results: session.results || [],
            position: session.position,
            bestLap: session.bestLap,
            laps: session.lapsTotal,
            finished: session.state.state === 'finished'
          });
        } catch (e) { console.error('[weekend] record failed', e); }
      }

      /* a time trial keeps its best lap as a ghost for next time, saved the
         moment the lap is banked so quitting early cannot lose it */
      function recordTimeTrial() {
        if (!params.timeTrial || !session || !session.ghost) return;
        var g = session.ghost;
        if (F1.timetrial && F1.timetrial.store(params.circuit, g)) {
          F1.app.toast('New personal best \u00b7 ghost saved');
        }
      }
      function onLapComplete() {
        if (!params.timeTrial) return;
        recordTimeTrial();
      }
      F1.bus.on('lap-complete', onLapComplete);

      function onFinish(info) {
        recordWeekend();
        recordCareer();
        recordChampionship();
        recordTimeTrial();
        F1.app.toast('Chequered flag \u00b7 best ' + (info.best ? U.fmtTime(info.best) : '\u2014'));
        setTimeout(function () {
          if (!disposed && session && session.state.state === 'finished') showSummary();
        }, 4200);
      }
      function onCameraMode(m) {
        F1.app.toast('Camera: ' + (F1.cameras.LABELS[m] || m), 1200);
      }

      /* classification: eight rows plus the player, the way a results sheet
         is printed in the paddock */
      function resultTable(sess) {
        var rows = sess.results;
        if (!rows || !rows.length) return '';
        var me = null;
        rows.forEach(function (r) { if (r.me) me = r; });
        var show = rows.slice(0, 8);
        if (me && show.indexOf(me) < 0) show.push(me);
        var scale = sess.bestLap > 0 ? sess.bestLap / sess.track.length : 0;
        var leadLaps = rows[0].laps;
        var html = '<div class="result-table"><div class="rt-head"><span>POS</span><span>DRIVER</span>' +
          '<span>LAPS</span><span>GAP</span></div>';
        show.forEach(function (r) {
          var down = leadLaps - r.laps;
          var gap = r.pos === 1 ? 'LEADER'
            : down > 0 ? '+' + down + ' LAP' + (down > 1 ? 'S' : '')
            : '+' + (r.gap * scale).toFixed(1) + 's';
          html += '<div class="rt-row' + (r.me ? ' me' : '') + '"><span class="p">' + r.pos + '</span>' +
            '<span class="n">' + esc(r.code || '') + '</span>' +
            '<span class="l">' + r.laps + '</span>' +
            '<span class="g mono">' + gap + '</span></div>';
        });
        return html + '</div>';
      }

      function showSummary() {
        if (!session || session.state.state !== 'finished') return;
        var panel = document.createElement('div');
        panel.className = 'race-pause show';
        recordTimeTrial();
        var best = session.bestLap, last = session.lastLap;
        panel.innerHTML =
          '<div class="pause-card">' +
          '<div class="pause-chip">Result</div>' +
          '<h2>' + esc(meta.name) + '</h2>' +
          '<div class="summary-grid">' +
          '<div><span>Position</span><b>P' + session.position + '</b></div>' +
          '<div><span>Laps</span><b>' + session.lapsTotal + '</b></div>' +
          '<div><span>Best lap</span><b class="mono">' + (best ? U.fmtTime(best) : '\u2014') + '</b></div>' +
          '<div><span>Last lap</span><b class="mono">' + (last ? U.fmtTime(last) : '\u2014') + '</b></div>' +
          '</div>' +
          resultTable(session) +
          '<div class="pause-actions">' +
          (params.career
            ? '<button class="btn primary" data-act="career">Back to career</button>'
            : params.championship
              ? '<button class="btn primary" data-act="champ">Back to championship</button>'
              : params.timeTrial
                ? '<button class="btn primary" data-act="tt">Back to time trial</button>'
                : params.weekend
              ? '<button class="btn primary" data-act="paddock">Return to paddock</button>'
              : '<button class="btn primary" data-act="again">Race again</button>') +
          '<button class="btn" data-act="quit">Back to menu</button>' +
          '</div></div>';
        var hudRoot = document.getElementById('hud-root');
        if (hudRoot) hudRoot.classList.add('summary');
        panel.addEventListener('click', function (e) {
          var b = e.target.closest('[data-act]');
          if (!b) return;
          var act = b.getAttribute('data-act');
          if (act === 'again') restart();
          else if (act === 'career') { recordCareer(); quit('career'); }
          else if (act === 'champ') { recordChampionship(); quit('champ'); }
          else if (act === 'tt') { recordTimeTrial(); quit('tt'); }
          else if (act === 'paddock') {
            recordWeekend();
            quit(true);
          } else quit();
        });
        wrap.appendChild(panel);
      }

      return wrap;
    },

    unmount: function () {
      var root = document.getElementById('screen-root');
      if (root) root.classList.remove('race-active');
      var hudRoot = document.getElementById('hud-root');
      if (hudRoot) hudRoot.innerHTML = '';
      if (F1.screens.race._cleanup) {
        try { F1.screens.race._cleanup(); } catch (e) { console.error(e); }
        F1.screens.race._cleanup = null;
      }
      F1.app.raceSession = null;
      F1.app.currentSession = null;
      F1.app.setScene(null);
    }
  };
})(window.F1 = window.F1 || {});
