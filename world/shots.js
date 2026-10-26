/* ==========================================================================
   F1 2026 — world/shots.js
   Standardised screenshot rig. Used to capture the same four camera angles for
   every circuit so the art direction can be reviewed (and regressions caught)
   without hand-flying a camera.

     F1.shots.VIEWS                 // ['chase','tv','trackside','aerial']
     F1.shots.circuits()            // 24 ids in calendar order
     F1.shots.open(circuitId)       // build a scene for that circuit
     F1.shots.setView(name)         // frame the standard camera for that view
     F1.shots.grab()                // PNG data URL of the current frame
     F1.shots.run(ids, cb)          // capture every circuit; cb(id, view, url)

   In the browser, ?shots=1&circuit=italy (or ?shots=1&all=1) downloads the
   PNGs directly. The headless capture used during development drives the same
   API, so the before/after images are guaranteed to be the same four shots.
   ========================================================================== */
(function (F1) {
  'use strict';

  var VIEWS = ['chase', 'tv', 'trackside', 'aerial'];

  var state = {
    id: null,
    api: null,
    view: 'chase',
    scene: null
  };

  function trackOf(api) { return api.track; }

  /* the camera work for each standard view. `s` is the distance along the lap
     (a fraction of it for the aerial, metres for the rest). */
  function viewCamera(api, name, camera) {
    var track = trackOf(api);
    var o = track.origin;
    var p = track.at(track.length * 0.02, {});
    var x = p.x - o.x, z = p.z - o.z, h = p.heading;

    if (name === 'chase') {
      /* chase camera on the start line: 7 m back, 2.1 m up, looking down the
         straight — the shot a player actually sees */
      camera.fov = 58;
      camera.position.set(x - Math.sin(h) * 8.5, p.y + 2.1, z - Math.cos(h) * 8.5);
      var ahead = track.at(track.length * 0.02 + 60, {});
      camera.lookAt(ahead.x - o.x, ahead.y + 1.1, ahead.z - o.z);
    } else if (name === 'tv') {
      /* high broadcast camera: on the outside of the first corner, 45 m up,
         with a long lens so the track fills the frame */
      var tvS = track.length * 0.06;
      var pt = track.at(tvS, {});
      var side = 1;
      var lat = pt.width * 0.5 + 95;
      camera.fov = 34;
      camera.position.set(
        pt.x - o.x + Math.cos(pt.heading) * lat * side,
        pt.y + 46,
        pt.z - o.z - Math.sin(pt.heading) * lat * side);
      var tvLook = track.at(tvS - 40, {});
      camera.lookAt(tvLook.x - o.x, tvLook.y + 2, tvLook.z - o.z);
    } else if (name === 'trackside') {
      /* low trackside: 1.55 m off the deck, 14 m from the white line, panning
         back up the road — the classic low-angle speed shot */
      var tsS = track.length * 0.10;
      var ps = track.at(tsS, {});
      var lat2 = ps.width * 0.5 + 13;
      camera.fov = 40;
      camera.position.set(
        ps.x - o.x + Math.cos(ps.heading) * lat2,
        ps.y + 1.55,
        ps.z - o.z - Math.sin(ps.heading) * lat2);
      var back = track.at(tsS - 70, {});
      camera.lookAt(back.x - o.x, back.y + 1.4, back.z - o.z);
    } else {
      /* aerial: 420 m up over the middle of the lap at a 55 degree tilt */
      var span = Math.max(
        track.bounds.maxX - track.bounds.minX,
        track.bounds.maxZ - track.bounds.minZ);
      var dist = Math.max(260, span * 0.95);
      camera.fov = 45;
      camera.position.set(dist * 0.52, dist * 0.95, dist * 0.72);
      camera.lookAt(0, 0, 0);
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }

  F1.shots = {
    VIEWS: VIEWS,
    state: state,

    circuits: function () {
      return F1.DATA.circuits.map(function (c) { return c.id; });
    },

    open: function (id) {
      F1.shots.close();
      var api = F1.trackScene.create(id, { mode: 'shots' });
      state.api = api;
      state.id = id;
      state.scene = api.scene;
      F1.app.currentSession = api;
      F1.app.setScene(api);
      return api;
    },

    close: function () {
      if (state.api) {
        try { state.api.destroy(); } catch (e) {}
        state.api = null;
      }
      state.id = null;
      state.scene = null;
    },

    setView: function (name) {
      if (!state.api) return false;
      state.view = name;
      /* one update tick so the world can settle its LOD / shadow focus at the
         new camera position before the frame is grabbed */
      viewCameraFor(state.api, name);
      state.api.update(0.016);
      viewCameraFor(state.api, name);
      return true;
    },

    /* re-render, then read the canvas back. The drawing buffer is not
       preserved (that is a real per-frame cost), so the render has to happen
       immediately before toDataURL. */
    grab: function () {
      if (!state.api) return null;
      var r = F1.renderer;
      viewCameraFor(state.api, state.view);
      if (r.render) r.render(state.scene || state.api.scene, state.api.camera);
      return r.renderer.domElement.toDataURL('image/png');
    },

    download: function (name, url) {
      var a = document.createElement('a');
      a.download = name;
      a.href = url;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 0);
    }
  };

  function viewCameraFor(api, name) {
    viewCamera(api, name, api.camera);
  }

  /* ---------------- ?shots=1 in-browser capture ---------------- */
  F1.bus.on('app-ready', function () {
    var q = new URLSearchParams(location.search);
    if (q.get('shots') !== '1') return;
    var all = q.get('all') === '1';
    var ids = all ? F1.shots.circuits() : [q.get('circuit') || 'italy'];
    var i = 0, v = 0;
    function next() {
      if (i >= ids.length) { document.title = 'shots done'; return; }
      if (v === 0) F1.shots.open(ids[i]);
      var view = F1.shots.VIEWS[v];
      F1.shots.setView(view);
      var url = F1.shots.grab();
      F1.shots.download(ids[i] + '_' + view + '.png', url);
      v++;
      if (v >= F1.shots.VIEWS.length) { v = 0; i++; }
      setTimeout(next, 550);
    }
    setTimeout(next, 1200);
  });
})(window.F1 = window.F1 || {});
