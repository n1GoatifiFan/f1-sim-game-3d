/* ==========================================================================
   F1 2026 — core/input.js
   Keyboard + Gamepad input. Analogue axes with keyboard smoothing, so the
   same vehicle code works for both devices.
   ========================================================================== */
(function (F1) {
  'use strict';

  var Input = {
    keys: Object.create(null),
    down: Object.create(null),      // edge: pressed this frame
    up: Object.create(null),
    gamepadConnected: false,
    gamepadName: '',
    usingGamepad: false,
    enabled: true,
    _prevDown: Object.create(null),
    _steer: 0, _throttle: 0, _brake: 0,
    _gp: { steer: 0, throttle: 0, brake: 0, boost: false, overtake: false, gearUp: false, gearDown: false, camera: false, pause: false, radio: false },
    _gpPressed: Object.create(null),
    _listeners: [],
    _hasFocus: true
  };

  Input.init = function () {
    if (Input._inited) return;
    Input._inited = true;

    window.addEventListener('keydown', function (e) {
      if (isTextTarget(e.target)) return;
      if (e.code === 'Space' || e.code.indexOf('Arrow') === 0) e.preventDefault();
      if (!Input.keys[e.code]) { Input.down[e.code] = true; }
      Input.keys[e.code] = true;
      Input.usingGamepad = false;
    });
    window.addEventListener('keyup', function (e) {
      if (isTextTarget(e.target)) return;
      Input.keys[e.code] = false;
      Input.up[e.code] = true;
    });
    window.addEventListener('blur', function () {
      for (var k in Input.keys) Input.keys[k] = false;
      Input._hasFocus = false;
    });
    window.addEventListener('focus', function () { Input._hasFocus = true; });
    window.addEventListener('gamepadconnected', function (e) {
      Input.gamepadConnected = true;
      Input.gamepadName = e.gamepad.id || 'Gamepad';
      F1.bus.emit('gamepad', e.gamepad);
      console.log('[input] gamepad connected:', e.gamepad.id);
    });
    window.addEventListener('gamepaddisconnected', function () {
      Input.gamepadConnected = false;
      F1.bus.emit('gamepad', null);
    });
  };

  function isTextTarget(t) {
    if (!t) return false;
    var tag = (t.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
  }

  /* first connected gamepad (standard mapping) */
  function pad() {
    if (!navigator.getGamepads) return null;
    var pads = navigator.getGamepads();
    for (var i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) return pads[i];
    return null;
  }

  function dz(v, dead) {
    if (Math.abs(v) < dead) return 0;
    return Math.sign(v) * (Math.abs(v) - dead) / (1 - dead);
  }

  Input.update = function (dt) {
    // ---- edge bookkeeping (down/up only valid for one frame) ----
    Input._prevDown = Input.down;
    Input.down = Object.create(null);
    Input.up = Object.create(null);
    Input._gpPressed = Object.create(null);

    var g = pad();
    if (g) {
      if (!Input.gamepadConnected) {
        Input.gamepadConnected = true; Input.gamepadName = g.id;
        F1.bus.emit('gamepad', g);
      }
      var dead = F1.settings.controls.gamepadDeadzone;
      var ax = dz(g.axes[0] || 0, dead);
      var t = g.buttons[7] ? g.buttons[7].value : 0;
      var b = g.buttons[6] ? g.buttons[6].value : 0;
      if (g.buttons[5] && g.buttons[5].pressed) t = Math.max(t, 1);   // RB as throttle helper
      if (g.buttons[4] && g.buttons[4].pressed) b = Math.max(b, 1);   // LB as brake helper

      var anyActivity = Math.abs(ax) > 0.08 || t > 0.05 || b > 0.05;
      if (anyActivity) Input.usingGamepad = true;
      Input._gp.steer = ax;
      Input._gp.throttle = t;
      Input._gp.brake = b;
      Input._gp.boost = !!(g.buttons[0] && g.buttons[0].pressed);
      Input._gp.overtake = !!(g.buttons[2] && g.buttons[2].pressed);
      Input._gp.gearUp = !!(g.buttons[5] && g.buttons[5].pressed) && !t; // fallback only
      Input._gp.gearDown = !!(g.buttons[4] && g.buttons[4].pressed) && !b;
      Input._gp.camera = !!(g.buttons[3] && g.buttons[3].pressed);
      Input._gp.pause = !!(g.buttons[9] && g.buttons[9].pressed);
      Input._gp.radio = !!(g.buttons[1] && g.buttons[1].pressed);
      Input._gp.gearUp = Input._gp.gearUp || !!(g.buttons[12] && g.buttons[12].pressed);
      Input._gp.gearDown = Input._gp.gearDown || !!(g.buttons[13] && g.buttons[13].pressed);
    } else {
      if (Input.gamepadConnected) { Input.gamepadConnected = false; F1.bus.emit('gamepad', null); }
      Input._gp.steer = Input._gp.throttle = Input._gp.brake = 0;
      Input._gp.boost = Input._gp.overtake = Input._gp.gearUp = Input._gp.gearDown = false;
    }

    // ---- keyboard analogue ramps ----
    if (!Input.enabled) {
      Input._steer = Input._throttle = Input._brake = 0;
      return;
    }
    var sens = F1.settings.controls.steerSensitivity || 1;
    var kLeft = Input.action('steerLeft') ? 1 : 0;
    var kRight = Input.action('steerRight') ? 1 : 0;
    var target = (kRight - kLeft) * sens;
    if (Input.usingGamepad && pad()) target = Input._gp.steer;
    // steer rate depends on speed later; here just a pleasant ramp
    var rate = Math.abs(target) > Math.abs(Input._steer) ? 7.5 : 11;
    Input._steer = F1.util.damp(Input._steer, F1.util.clamp(target, -1, 1), rate, dt);

    var kThrottle = Input.action('throttle') ? 1 : 0;
    var kBrake = Input.action('brake') ? 1 : 0;
    var tgtT = Math.max(kThrottle, Input.usingGamepad ? Input._gp.throttle : 0);
    var tgtB = Math.max(kBrake, Input.usingGamepad ? Input._gp.brake : 0);
    Input._throttle = F1.util.damp(Input._throttle, tgtT, tgtT > Input._throttle ? 14 : 22, dt);
    Input._brake = F1.util.damp(Input._brake, tgtB, tgtB > Input._brake ? 20 : 25, dt);
  };

  /* true while any key bound to action is held (or gamepad equivalent) */
  Input.action = function (name) {
    var binds = F1.settings.controls.binds[name] || [];
    for (var i = 0; i < binds.length; i++) if (Input.keys[binds[i]]) return true;
    var g = Input._gp;
    switch (name) {
      case 'boost': return g.boost;
      case 'overtake': return g.overtake;
      case 'camera': return g.camera;
      case 'pause': return g.pause;
      case 'radio': return g.radio;
      case 'gearUp': return g.gearUp;
      case 'gearDown': return g.gearDown;
    }
    return false;
  };

  /* edge-triggered press for menus / discrete actions */
  Input.pressed = function (name) {
    var binds = F1.settings.controls.binds[name] || [];
    for (var i = 0; i < binds.length; i++) if (Input.down[binds[i]]) return true;
    return false;
  };

  Input.getSteer = function () { return Input.enabled ? Input._steer : 0; };
  Input.getThrottle = function () { return Input.enabled ? Input._throttle : 0; };
  Input.getBrake = function () { return Input.enabled ? Input._brake : 0; };
  Input.isUsingGamepad = function () { return !!pad() && Input.usingGamepad; };

  Input.rumble = function (strong, weak, ms) {
    if (!F1.settings.controls.rumble) return;
    var g = pad();
    if (!g) return;
    try {
      var act = g.vibrationActuator;
      if (act && act.playEffect) {
        act.playEffect('dual-rumble', {
          duration: ms || 120,
          strongMagnitude: F1.util.clamp(strong, 0, 1),
          weakMagnitude: F1.util.clamp(weak, 0, 1)
        });
      }
    } catch (e) { /* not supported */ }
  };

  /* ---------- binding editor support ---------- */
  Input.rebind = function (action, codes) {
    F1.settings.controls.binds[action] = codes;
    F1.settings.save();
  };

  Input.startCapture = function (action, onDone) {
    var handler = function (e) {
      e.preventDefault();
      e.stopPropagation();
      var code = e.code;
      if (code === 'Escape') { window.removeEventListener('keydown', handler, true); onDone(null); return; }
      // remove from other actions to avoid duplicates for driving inputs
      Object.keys(F1.settings.controls.binds).forEach(function (a) {
        if (a === action) return;
        var list = F1.settings.controls.binds[a];
        var i = list.indexOf(code);
        if (i >= 0) list.splice(i, 1);
      });
      F1.settings.controls.binds[action] = [code];
      F1.settings.save();
      window.removeEventListener('keydown', handler, true);
      onDone(code);
    };
    window.addEventListener('keydown', handler, true);
    return function cancel() { window.removeEventListener('keydown', handler, true); };
  };

  Input.keyLabel = function (code) {
    if (!code) return '—';
    return code
      .replace('Key', '')
      .replace('Digit', '')
      .replace('Arrow', '\u2191')
      .replace('Left', '')
      .replace('Right', '')
      .replace('Up', '')
      .replace('Down', '')
      .replace('Shift', 'Shift')
      .replace('Control', 'Ctrl')
      .replace('Space', 'Space');
  };

  F1.input = Input;
})(window.F1 = window.F1 || {});
