/* ==========================================================================
   F1 2026 — main.js
   Entry point. Loaded last, after every core/data/world/ui script, so all
   globals exist. Works from file:// (no modules, no fetch).
   ========================================================================== */
(function (F1) {
  'use strict';

  function fail(msg) {
    var boot = document.getElementById('boot');
    if (boot) {
      boot.innerHTML =
        '<div style="max-width:640px;text-align:center;padding:30px;font-family:system-ui,sans-serif">' +
        '<div style="font-family:Arial Narrow,Arial;font-style:italic;font-weight:900;font-size:40px;color:#e10600">STARTUP FAILED</div>' +
        '<p style="color:#c9d3dd;line-height:1.6;margin-top:16px">' + msg + '</p>' +
        '<p style="color:#7b8794;font-size:12px;margin-top:18px">Open the browser console for details.</p>' +
        '</div>';
    }
    console.error('[main] ' + msg);
  }

  function boot() {
    if (!window.THREE) {
      fail('Three.js failed to load. Make sure the <b>lib/three.min.js</b> file exists next to index.html.');
      return;
    }
    if (!F1 || !F1.DATA || !F1.DATA.teams) {
      fail('Game data failed to load. Check that the <b>data/</b> folder is intact.');
      return;
    }
    // A WebGL context is required; touch it early for a clean error message.
    try {
      var test = document.createElement('canvas');
      var gl = test.getContext('webgl2') || test.getContext('webgl');
      if (!gl) throw new Error('WebGL unavailable');
    } catch (e) {
      fail('This browser or GPU does not expose WebGL. Enable hardware acceleration, then reload.');
      return;
    }
    try {
      F1.app.init();
    } catch (e) {
      fail('Unexpected error during startup: ' + (e && e.message ? e.message : e));
      console.error(e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* friendly FPS toggle + escape routing for menus */
  window.addEventListener('keydown', function (e) {
    /* M mutes everything, P during a menu is not a pause key any more */
    var tag = (e.target && e.target.tagName) || '';
    if (e.code === 'KeyM' && F1.audio && tag !== 'INPUT' && tag !== 'TEXTAREA') {
      var muted = F1.audio.toggleMute();
      F1.settings.audio.muted = muted;
      F1.app.setAudioMutedClass(muted);
      F1.app.toast('Sound ' + (muted ? 'muted' : 'on'), 1200);
      F1.settings.save();
      e.preventDefault();
    }
    if (e.code === 'F3') {
      F1.settings.display.showPerformance = !F1.settings.display.showPerformance;
      F1.settings.save();
      F1.app.toast('Performance overlay ' + (F1.settings.display.showPerformance ? 'on' : 'off'));
      e.preventDefault();
    }
    if (e.code === 'Escape' && (document.body.dataset.screen || '').match(/garage|grid|quick-race|settings/)) {
      F1.app.show('main-menu');
    }
  });
})(window.F1 = window.F1 || {});
