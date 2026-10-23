/* ==========================================================================
   F1 2026 — core/utils.js
   Small shared helpers: math, RNG, events, storage, formatting.
   Classic script (no modules). Everything hangs off window.F1.
   ========================================================================== */
(function (F1) {
  'use strict';

  var util = {
    TAU: Math.PI * 2,

    clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); },
    sign: function (v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    inverseLerp: function (a, b, v) { return a === b ? 0 : (v - a) / (b - a); },
    smoothstep: function (a, b, v) {
      var t = util.clamp((v - a) / (b - a), 0, 1);
      return t * t * (3 - 2 * t);
    },
    /* frame-rate independent exponential smoothing */
    damp: function (a, b, lambda, dt) { return util.lerp(a, b, 1 - Math.exp(-lambda * dt)); },
    dampAngle: function (a, b, lambda, dt) {
      var d = util.wrapAngle(b - a);
      return a + d * (1 - Math.exp(-lambda * dt));
    },
    wrapAngle: function (a) {
      while (a > Math.PI) a -= util.TAU;
      while (a < -Math.PI) a += util.TAU;
      return a;
    },
    mapRange: function (v, a1, a2, b1, b2) {
      return b1 + (util.clamp(v, Math.min(a1, a2), Math.max(a1, a2)) - a1) * (b2 - b1) / (a2 - a1);
    },
    /* shortest distance between two points on a circle-ish track length */
    wrapDist: function (a, b, len) {
      var d = Math.abs(a - b) % len;
      return d > len / 2 ? len - d : d;
    },
    pad: function (n, w) {
      var s = String(Math.floor(Math.abs(n)));
      while (s.length < (w || 2)) s = '0' + s;
      return (n < 0 ? '-' : '') + s;
    },
    /* 83.421 -> "1:23.421"; 3600+ -> "1:01:23.421" */
    fmtTime: function (s, opts) {
      opts = opts || {};
      if (!isFinite(s) || s <= 0) return opts.blank || '--:--.---';
      var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s - h * 3600 - m * 60;
      var str = (h > 0 ? h + ':' + util.pad(m) : String(m)) + ':' +
                (h > 0 || m > 0 ? util.pad(sec, 2) : String(Math.floor(sec))) + '.' +
                util.pad(Math.floor((sec % 1) * 1000), 3);
      return str;
    },
    /* 83.421 -> "1:23.4" (TV style sector/gap) */
    fmtTimeShort: function (s) {
      if (!isFinite(s) || s <= 0) return '--.---';
      var m = Math.floor(s / 60), sec = s - m * 60;
      return m > 0 ? m + ':' + (sec < 10 ? '0' : '') + sec.toFixed(3)
                   : s.toFixed(3);
    },
    fmtGap: function (s) { return s === null || !isFinite(s) ? '--' : '+' + s.toFixed(3); },
    fmtDelta: function (s) { return (s >= 0 ? '+' : '') + s.toFixed(3); },
    fmtInt: function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009'); },
    plural: function (n, one, many) { return n === 1 ? one : (many || one + 's'); },
    titleCase: function (s) { return s.replace(/\w\S*/g, function (t) { return t.charAt(0).toUpperCase() + t.substr(1).toLowerCase(); }); },
    slug: function (s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); },
    deepClone: function (o) { return o === undefined ? o : JSON.parse(JSON.stringify(o)); },
    /* uniform random in range; when rng supplied stays deterministic */
    rand: function (rng, a, b) { return a + (b - a) * (rng ? rng() : Math.random()); },
    shuffle: function (arr, rng) {
      var r = rng || Math.random, a = arr.slice();
      for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(r() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    },
    pick: function (arr, rng) { return arr[Math.floor((rng ? rng() : Math.random()) * arr.length) % arr.length]; },
    sum: function (arr, f) { var s = 0; for (var i = 0; i < arr.length; i++) s += f ? f(arr[i], i) : arr[i]; return s; },
    avg: function (arr, f) { return arr.length ? util.sum(arr, f) / arr.length : 0; },
    /* JSON-safe structured clone fallback for older engines */
    clone: function (o) { return JSON.parse(JSON.stringify(o)); },
    /* safe DOM helpers */
    el: function (tag, cls, html) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (html !== undefined && html !== null) n.innerHTML = html;
      return n;
    },
    icon: function (name) { return '<span class="ico ico-' + name + '"></span>'; }
  };

  /* ---------------- seeded RNG (mulberry32) ---------------- */
  F1.rng = function (seed) {
    var a = (seed >>> 0) || 0x9e3779b9;
    function next() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    next.range = function (lo, hi) { return lo + (hi - lo) * next(); };
    next.int = function (lo, hi) { return Math.floor(lo + (hi - lo + 1) * next()); };
    next.pick = function (arr) { return arr[Math.floor(next() * arr.length) % arr.length]; };
    next.chance = function (p) { return next() < p; };
    next.normal = function (mean, sd) {
      var u = 1 - next(), v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    next.shuffle = function (arr) { return util.shuffle(arr, next); };
    F1.rng.hashString = function (str) {
      var h = 2166136261;
      for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
      return h >>> 0;
    };
    return next;
  };
  F1.rng.string = function (str) {        // deterministic seed from an event id
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };

  /* ---------------- tiny event emitter ---------------- */
  F1.events = function () {
    var map = {};
    return {
      on: function (name, fn) { (map[name] = map[name] || []).push(fn); return fn; },
      off: function (name, fn) {
        if (!map[name]) return;
        var i = map[name].indexOf(fn); if (i >= 0) map[name].splice(i, 1);
      },
      emit: function (name) {
        var args = Array.prototype.slice.call(arguments, 1);
        (map[name] || []).slice().forEach(function (fn) {
          try { fn.apply(null, args); } catch (e) { console.error('[event ' + name + ']', e); }
        });
      }
    };
  };
  F1.bus = F1.events();

  /* ---------------- storage: localStorage with graceful degradation ----------------
     file:// localStorage can throw (Safari) or be shared oddly; every call is
     wrapped and a memory fallback keeps the session playable. */
  F1.storage = (function () {
    var mem = {}, available = null;
    var PREFIX = 'f1_2026_';
    function probe() {
      if (available !== null) return available;
      try {
        var k = PREFIX + '__t';
        window.localStorage.setItem(k, '1');
        window.localStorage.removeItem(k);
        available = true;
      } catch (e) {
        available = false;
        console.warn('[storage] localStorage unavailable, using memory fallback');
      }
      return available;
    }
    return {
      available: function () { return probe(); },
      get: function (key, dflt) {
        try {
          var raw = probe() ? window.localStorage.getItem(PREFIX + key) : mem[key];
          if (raw === null || raw === undefined) return dflt;
          return JSON.parse(raw);
        } catch (e) { return dflt; }
      },
      set: function (key, val) {
        var raw = JSON.stringify(val);
        try {
          if (probe()) window.localStorage.setItem(PREFIX + key, raw);
          else mem[key] = raw;
        } catch (e) { mem[key] = raw; }
        return true;
      },
      remove: function (key) {
        try { if (probe()) window.localStorage.removeItem(PREFIX + key); } catch (e) {}
        delete mem[key];
      },
      /* dump every save key — used by export/import */
      exportAll: function () {
        var out = {};
        try {
          if (probe()) {
            for (var i = 0; i < window.localStorage.length; i++) {
              var k = window.localStorage.key(i);
              if (k && k.indexOf(PREFIX) === 0) out[k.slice(PREFIX.length)] = JSON.parse(window.localStorage.getItem(k));
            }
          } else {
            Object.keys(mem).forEach(function (k) { out[k] = JSON.parse(mem[k]); });
          }
        } catch (e) { console.warn('[storage] export failed', e); }
        return out;
      },
      importAll: function (obj) {
        Object.keys(obj || {}).forEach(function (k) { F1.storage.set(k, obj[k]); });
      }
    };
  })();

  /* ---------------- misc ----------------- */
  F1.util = util;

  /* CSS colour helper for three.js from team hex strings */
  F1.util.colorToHex = function (hex) { return parseInt(String(hex).replace('#', ''), 16); };

  F1.util.hexToRgb = function (hex) {
    var h = parseInt(String(hex).replace('#', ''), 16);
    return { r: (h >> 16) & 255, g: (h >> 8) & 255, b: h & 255 };
  };
  F1.util.rgba = function (hex, a) {
    var c = F1.util.hexToRgb(hex);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
  };
  F1.util.mixHex = function (h1, h2, t) {
    var a = F1.util.hexToRgb(h1), b = F1.util.hexToRgb(h2);
    function m(x, y) { return Math.round(x + (y - x) * t); }
    return '#' + ((1 << 24) + (m(a.r, b.r) << 16) + (m(a.g, b.g) << 8) + m(a.b, b.b)).toString(16).slice(1);
  };
  /* perceived luminance — used to pick readable text on team colours */
  F1.util.luminance = function (hex) {
    var c = F1.util.hexToRgb(hex);
    return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
  };
  F1.util.textOn = function (hex) { return F1.util.luminance(hex) > 0.55 ? '#111' : '#fff'; };

})(window.F1 = window.F1 || {});
