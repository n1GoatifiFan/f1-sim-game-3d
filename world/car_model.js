/* ==========================================================================
   F1 2026 — world/car_model.js
   Procedural 2026 Formula 1 car.

   Dimensions follow the 2026 technical regulations closely enough to read
   correctly on screen (mass 768 kg, 3.4 m wheelbase, ~1.9 m width, 18" wheels
   with 0.36 m radius): nose low and slim, cockpit headrest ~0.95 m, sidepods
   undercut, active-aero front/rear wings, halo, floor + diffuser.

   F1.buildCar({ teamId, driverId, lod }) -> THREE.Group
     group.userData.wheels = [{ node, spin, axle:'front'|'rear', side:'L'|'R' }]
     group.userData.setBrakeGlow(v)          // 0..1 emissive brake discs
     group.userData.setAeroMode('X'|'Z')     // active aero flap animation
   Axis convention: forward is -Z, up +Y, right +X, metres.

   Geometry is built ONCE and cached (shared by all 22 cars); only textures,
   decal planes and a few materials are per team. `lod: 0` returns a cheap
   ~10-mesh approximation for distant AI cars.
   ========================================================================== */
(function (F1) {
  'use strict';

  var TAU = Math.PI * 2;

  /* ================================================================== */
  /* 1. canvas texture helpers                                          */
  /* ================================================================== */
  var TEX = {};

  function canvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function toTexture(c, rep) {
    var t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); }
    return t;
  }
  function fnt(size, weight, italic) {
    return (italic === false ? '' : 'italic ') + (weight || 800) + ' ' + size +
      'px "Arial Narrow", "Liberation Sans Narrow", "Helvetica Neue", Arial, sans-serif';
  }
  function fitFont(ctx, text, maxW, size, weight) {
    var s = size;
    while (s > 6) {
      ctx.font = fnt(s, weight);
      if (ctx.measureText(text).width <= maxW) return s;
      s -= 1;
    }
    return s;
  }
  /* skewed uppercase wordmark — the "stylised sponsor text" of the livery */
  function mark(ctx, text, x, y, size, color, opts) {
    opts = opts || {};
    ctx.save();
    ctx.translate(x, y);
    if (opts.skew !== 0) ctx.transform(1, 0, opts.skew === undefined ? -0.14 : opts.skew, 1, 0, 0);
    ctx.font = fnt(size, opts.weight || 800, opts.italic);
    ctx.textAlign = opts.align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    if (opts.glow) { ctx.shadowColor = opts.glow; ctx.shadowBlur = size * 0.3; }
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  /* A livery panel: team colours + sponsor wordmarks. Returns a texture. */
  function panel(team, o) {
    var key = team.id + '|' + o.key;
    if (TEX[key]) return TEX[key];
    var W = o.w || 1024, H = o.h || 256;
    var c = canvas(W, H), ctx = c.getContext('2d');
    var col = team.colors;
    ctx.clearRect(0, 0, W, H);

    if (o.bg) { ctx.fillStyle = o.bg; ctx.fillRect(0, 0, W, H); }

    /* team stripe patterns behind the words */
    if (o.pattern === 'slash') {
      ctx.fillStyle = col.accent;
      ctx.beginPath();
      ctx.moveTo(W * 0.02, H); ctx.lineTo(W * 0.30, 0);
      ctx.lineTo(W * 0.40, 0); ctx.lineTo(W * 0.12, H);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = col.secondary;
      ctx.beginPath();
      ctx.moveTo(W * 0.36, H); ctx.lineTo(W * 0.64, 0);
      ctx.lineTo(W * 0.69, 0); ctx.lineTo(W * 0.41, H);
      ctx.closePath(); ctx.fill();
    } else if (o.pattern === 'swoosh') {
      ctx.fillStyle = col.accent;
      ctx.beginPath();
      ctx.moveTo(0, H);
      ctx.bezierCurveTo(W * 0.28, H * 0.62, W * 0.62, H * 1.05, W, H * 0.66);
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    } else if (o.pattern === 'edge') {
      ctx.fillStyle = col.accent;
      ctx.fillRect(0, 0, W, H * 0.055);
      ctx.fillStyle = col.secondary;
      ctx.fillRect(0, H - H * 0.075, W, H * 0.075);
    }

    var words = o.words || [];
    var n = words.length;
    var onDark = F1.util.luminance(col.primary) < 0.62;
    for (var i = 0; i < n; i++) {
      var w = words[i];
      var text = typeof w === 'string' ? w : w.text;
      var color = (typeof w === 'object' && w.color) || (onDark ? '#ffffff' : col.secondary);
      var weight = (typeof w === 'object' && w.weight) || 800;
      var y = H * (n === 1 ? 0.5 : 0.16 + 0.68 * i / (n - 1));
      var size = fitFont(ctx, text, W * 0.78, H * (n === 1 ? 0.42 : 0.30), weight);
      mark(ctx, text, W * 0.5, y, size, color, { weight: weight, glow: o.glow });
    }
    TEX[key] = toTexture(c);
    return TEX[key];
  }

  function helmetTexture(h, number) {
    var key = 'helmet|' + h.base + h.accent + h.design + h.visor + number;
    if (TEX[key]) return TEX[key];
    var W = 512, H = 256, c = canvas(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = h.base; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = h.accent;
    switch (h.design) {
      case 'split':
        ctx.fillRect(0, 0, W, H * 0.48); break;
      case 'stripes':
        for (var i = 0; i < 5; i++) ctx.fillRect(0, H * (0.14 + i * 0.15), W, H * 0.045);
        break;
      case 'flash':
        ctx.beginPath();
        ctx.moveTo(0, H * 0.18); ctx.bezierCurveTo(W * 0.42, H * 0.34, W * 0.6, H * 0.04, W, H * 0.26);
        ctx.lineTo(W, H * 0.42); ctx.bezierCurveTo(W * 0.6, H * 0.2, W * 0.42, H * 0.52, 0, H * 0.36);
        ctx.closePath(); ctx.fill(); break;
      case 'chevron':
        ctx.beginPath();
        ctx.moveTo(W * 0.5, H * 0.14); ctx.lineTo(W * 0.74, H * 0.5);
        ctx.lineTo(W * 0.5, H * 0.86); ctx.lineTo(W * 0.26, H * 0.5);
        ctx.closePath(); ctx.fill(); break;
      case 'blocks':
        for (var b = 0; b < 4; b++) ctx.fillRect(W * (0.08 + b * 0.23), H * 0.12, W * 0.11, H * 0.52);
        break;
      case 'streak':
        ctx.fillRect(0, H * 0.30, W, H * 0.05);
        ctx.fillRect(0, H * 0.42, W, H * 0.025);
        break;
    }
    // visor sits at u≈0.75 for a sphere rotated to face -Z
    ctx.fillStyle = h.visor || '#0d0d0f';
    ctx.beginPath(); ctx.ellipse(W * 0.75, H * 0.50, W * 0.155, H * 0.135, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = F1.util.textOn(h.base);
    ctx.font = fnt(58, 900); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (number != null) { ctx.fillText(String(number), W * 0.26, H * 0.62); ctx.fillText(String(number), W * 0.02, H * 0.62); }
    TEX[key] = toTexture(c);
    return TEX[key];
  }

  /* ================================================================== */
  /* 2. materials                                                       */
  /* ================================================================== */
  var MAT = {};
  function teamMat(team) {
    if (MAT[team.id]) return MAT[team.id];
    var c = team.colors;
    MAT[team.id] = {
      paint: new THREE.MeshPhysicalMaterial({ color: c.primary, metalness: 0.15, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.1 }),
      dark: new THREE.MeshPhysicalMaterial({ color: c.secondary, metalness: 0.25, roughness: 0.4, clearcoat: 0.65, clearcoatRoughness: 0.22 }),
      accent: new THREE.MeshPhysicalMaterial({ color: c.accent, metalness: 0.3, roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.15 })
    };
    return MAT[team.id];
  }
  function common() {
    if (!MAT.__c) {
      MAT.__c = {
        carbon: new THREE.MeshStandardMaterial({ color: 0x111316, metalness: 0.6, roughness: 0.55 }),
        carbonLight: new THREE.MeshStandardMaterial({ color: 0x1b1f24, metalness: 0.55, roughness: 0.5 }),
        metal: new THREE.MeshStandardMaterial({ color: 0xa9b0b8, metalness: 1, roughness: 0.3 }),
        darkMetal: new THREE.MeshStandardMaterial({ color: 0x3c4046, metalness: 0.9, roughness: 0.35 }),
        tyre: new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.96, metalness: 0.0 }),
        tyreWall: new THREE.MeshStandardMaterial({ color: 0x1c1c1f, roughness: 0.95, metalness: 0.0 }),
        rim: new THREE.MeshStandardMaterial({ color: 0x7f858e, metalness: 1, roughness: 0.25 }),
        intake: new THREE.MeshStandardMaterial({ color: 0x040405, roughness: 0.95, metalness: 0.1 }),
        visor: new THREE.MeshPhysicalMaterial({ color: 0x08090b, metalness: 0.9, roughness: 0.06, clearcoat: 1 }),
        brake: new THREE.MeshStandardMaterial({ color: 0x2a0d0a, emissive: 0xff2a00, emissiveIntensity: 0.0, roughness: 0.7 }),
        rainLight: new THREE.MeshStandardMaterial({ color: 0x300003, emissive: 0xff0018, emissiveIntensity: 1.6, roughness: 0.5 }),
        headlight: new THREE.MeshBasicMaterial({ color: 0xdff0ff })
      };
    }
    return MAT.__c;
  }

  /* ================================================================== */
  /* 3. geometry primitives                                             */
  /* ================================================================== */
  /* superellipse ring: n=2 -> ellipse, n<2 -> diamond-ish, n>2 -> boxy */
  function ring(w, h, n, segs, x, y, z) {
    var out = [];
    for (var i = 0; i < segs; i++) {
      var a = (i / segs) * TAU;
      var cs = Math.cos(a), sn = Math.sin(a);
      var px = w * (cs < 0 ? -1 : 1) * Math.pow(Math.abs(cs), 2 / n);
      var py = h * (sn < 0 ? -1 : 1) * Math.pow(Math.abs(sn), 2 / n);
      out.push(new THREE.Vector3(px + (x || 0), py + (y || 0), z));
    }
    return out;
  }

  /* loft a set of sections [{z,y,w,h,n,x}] into a closed shell */
  function loftSections(sections, segs, capA, capB) {
    var rings = sections.map(function (s) {
      return ring(s.w, s.h, s.n || 2.4, segs, s.x || 0, s.y || 0, s.z);
    });
    var pos = [], idx = [];
    var N = rings[0].length;
    rings.forEach(function (r) { r.forEach(function (v) { pos.push(v.x, v.y, v.z); }); });
    for (var i = 0; i < rings.length - 1; i++) {
      for (var j = 0; j < N; j++) {
        var a = i * N + j, b = i * N + (j + 1) % N;
        var c2 = (i + 1) * N + (j + 1) % N, d = (i + 1) * N + j;
        idx.push(a, b, c2, a, c2, d);
      }
    }
    function cap(r, rev) {
      var ci = pos.length / 3, cx = 0, cy = 0;
      r.forEach(function (v) { cx += v.x; cy += v.y; });
      cx /= r.length; cy /= r.length;
      pos.push(cx, cy, r[0].z);
      for (var q = 0; q < r.length; q++) {
        pos.push(r[q].x, r[q].y, r[q].z);
        pos.push(r[(q + 1) % r.length].x, r[(q + 1) % r.length].y, r[(q + 1) % r.length].z);
      }
      var base = ci + 1;
      for (var k = 0; k < r.length; k++) {
        var ia = base + k * 2, ib = base + k * 2 + 1;
        if (rev) idx.push(ci, ib, ia); else idx.push(ci, ia, ib);
      }
    }
    if (capA) cap(rings[0], true);
    if (capB) cap(rings[rings.length - 1], false);
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /* sweep a flat "airfoil" profile along X: used for wing elements */
  function wingElement(span, chord, thick, camber, taper) {
    var seg = 10, pos = [], idx = [];
    var x0 = -span / 2, x1 = span / 2;
    var zAt = function (t) { return -chord / 2 + chord * t; };
    // profile: NACA-ish inverted, camber pushes the trailing edge up
    var ys = [];
    for (var i = 0; i <= seg; i++) {
      var t = i / seg;
      var y = Math.sin(t * Math.PI) * thick * 0.5 + camber * t * t * chord;
      ys.push([zAt(t), y]);
    }
    for (var side = 0; side < 2; side++) {
      var x = side ? x1 : x0;
      var scale = 1;
      for (var k = 0; k < ys.length; k++) {
        pos.push(x, ys[k][1] * (side ? scale : scale), ys[k][0]);
      }
    }
    var n = ys.length;
    for (var j = 0; j < n - 1; j++) idx.push(j, n + j, n + j + 1, j, n + j + 1, j + 1);
    // bottom face (mirror, slightly thinner)
    var off = pos.length / 3;
    for (var s2 = 0; s2 < 2; s2++) {
      var x2 = s2 ? x1 : x0;
      for (var k2 = 0; k2 < n; k2++) pos.push(x2, ys[k2][1] * 0.35 - thick * 0.45, ys[k2][0]);
    }
    for (var j2 = 0; j2 < n - 1; j2++) idx.push(off + j2, off + n + j2 + 1, off + n + j2, off + j2, off + j2 + 1, off + n + j2 + 1);
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /* flat slab from a centreline strip [{z, halfW, y}] — floor, diffuser, plates */
  function slab(strip, thickness) {
    var pos = [], idx = [];
    var n = strip.length;
    var top = [], bot = [];
    strip.forEach(function (p) {
      top.push([-p.halfW, p.y + thickness / 2, p.z], [p.halfW, p.y + thickness / 2, p.z]);
      bot.push([-p.halfW, p.y - thickness / 2, p.z], [p.halfW, p.y - thickness / 2, p.z]);
    });
    top.concat(bot).forEach(function (v) { pos.push(v[0], v[1], v[2]); });
    var B = n * 2;
    for (var i = 0; i < n - 1; i++) {
      var a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      idx.push(a, c, d, a, d, b);                        // top
      idx.push(B + a, B + d, B + c, B + a, B + b, B + d); // bottom
      idx.push(a, B + a, B + d, a, B + d, c);            // right side
      idx.push(b, d, B + d, b, B + d, B + b);            // left side
    }
    idx.push(0, 1, B + 1, 0, B + 1, B);                   // front cap
    var e = (n - 1) * 2;
    idx.push(e, B + e, B + e + 1, e, B + e + 1, e + 1);   // back cap
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function rodMesh(a, b, r, mat) {
    var dir = new THREE.Vector3().subVectors(b, a);
    var len = dir.length();
    var m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6, 1), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return m;
  }

  /* ================================================================== */
  /* 4. base geometry (cached)                                          */
  /* ================================================================== */
  var G = null;

  function geometry() {
    if (G) return G;
    var g = {};

    /* ---- monocoque + nose (single loft, slim pointed nose) ---- */
    g.body = loftSections([
      { z: -2.36, y: 0.168, w: 0.030, h: 0.020, n: 1.6 },
      { z: -2.16, y: 0.176, w: 0.052, h: 0.030, n: 1.7 },
      { z: -1.94, y: 0.192, w: 0.078, h: 0.042, n: 1.8 },
      { z: -1.70, y: 0.208, w: 0.104, h: 0.054, n: 1.9 },
      { z: -1.44, y: 0.228, w: 0.132, h: 0.072, n: 2.0 },
      { z: -1.16, y: 0.252, w: 0.164, h: 0.096, n: 2.1 },
      { z: -0.88, y: 0.292, w: 0.206, h: 0.126, n: 2.3 },
      { z: -0.62, y: 0.322, w: 0.238, h: 0.152, n: 2.4 },
      { z: -0.36, y: 0.352, w: 0.268, h: 0.176, n: 2.5 },
      { z: -0.10, y: 0.378, w: 0.292, h: 0.196, n: 2.6 },
      { z: 0.16, y: 0.398, w: 0.305, h: 0.208, n: 2.6 },
      { z: 0.44, y: 0.412, w: 0.300, h: 0.212, n: 2.5 },
      { z: 0.74, y: 0.418, w: 0.272, h: 0.204, n: 2.4 },
      { z: 1.04, y: 0.412, w: 0.232, h: 0.184, n: 2.4 },
      { z: 1.34, y: 0.398, w: 0.180, h: 0.152, n: 2.3 },
      { z: 1.60, y: 0.378, w: 0.120, h: 0.112, n: 2.2 },
      { z: 1.80, y: 0.360, w: 0.062, h: 0.068, n: 2.1 }
    ], 20, true, true);

    /* ---- cockpit surround: raised rim around the driver ---- */
    g.cockpit = loftSections([
      { z: -0.42, y: 0.470, w: 0.245, h: 0.070, n: 2.8 },
      { z: -0.16, y: 0.500, w: 0.252, h: 0.086, n: 3.0 },
      { z: 0.14, y: 0.512, w: 0.250, h: 0.094, n: 3.0 },
      { z: 0.42, y: 0.505, w: 0.232, h: 0.090, n: 3.0 },
      { z: 0.62, y: 0.492, w: 0.198, h: 0.078, n: 2.8 },
      { z: 0.78, y: 0.472, w: 0.150, h: 0.062, n: 2.6 }
    ], 16, false, false);

    /* ---- headrest / engine cover with airbox ---- */
    g.cover = loftSections([
      { z: 0.30, y: 0.520, w: 0.150, h: 0.105, n: 2.4 },
      { z: 0.46, y: 0.610, w: 0.160, h: 0.175, n: 2.6 },
      { z: 0.60, y: 0.645, w: 0.152, h: 0.200, n: 2.7 },
      { z: 0.78, y: 0.628, w: 0.138, h: 0.190, n: 2.6 },
      { z: 1.02, y: 0.590, w: 0.118, h: 0.160, n: 2.5 },
      { z: 1.30, y: 0.545, w: 0.092, h: 0.120, n: 2.4 },
      { z: 1.56, y: 0.505, w: 0.060, h: 0.080, n: 2.3 },
      { z: 1.76, y: 0.475, w: 0.032, h: 0.050, n: 2.2 }
    ], 16, true, true);

    // airbox intake duct above the driver's head
    g.airbox = loftSections([
      { z: 0.12, y: 0.735, w: 0.086, h: 0.052, n: 2.6 },
      { z: 0.26, y: 0.752, w: 0.104, h: 0.064, n: 2.8 },
      { z: 0.42, y: 0.742, w: 0.098, h: 0.058, n: 2.8 },
      { z: 0.56, y: 0.706, w: 0.074, h: 0.044, n: 2.6 }
    ], 12, true, true);

    /* ---- sidepods (right reused mirrored for left) ---- */
    var podSections = [
      { z: -0.30, y: 0.330, w: 0.075, h: 0.120, n: 2.6 },
      { z: -0.06, y: 0.345, w: 0.135, h: 0.170, n: 2.9 },
      { z: 0.22, y: 0.350, w: 0.168, h: 0.205, n: 3.1 },
      { z: 0.52, y: 0.348, w: 0.170, h: 0.200, n: 3.1 },
      { z: 0.82, y: 0.340, w: 0.152, h: 0.170, n: 3.0 },
      { z: 1.08, y: 0.330, w: 0.112, h: 0.120, n: 2.8 },
      { z: 1.26, y: 0.325, w: 0.062, h: 0.070, n: 2.6 }
    ];
    g.podR = loftSections(podSections.map(function (s) {
      return { z: s.z, y: s.y, w: s.w, h: s.h, n: s.n, x: 0.505 };
    }), 14, true, true);
    g.podL = loftSections(podSections.map(function (s) {
      return { z: s.z, y: s.y, w: s.w, h: s.h, n: s.n, x: -0.505 };
    }), 14, true, true);

    /* ---- floor with undercut + diffuser ---- */
    g.floor = slab([
      { z: -1.06, halfW: 0.42, y: 0.055 },
      { z: -0.70, halfW: 0.55, y: 0.052 },
      { z: -0.30, halfW: 0.70, y: 0.050 },
      { z: 0.20, halfW: 0.84, y: 0.050 },
      { z: 0.80, halfW: 0.88, y: 0.052 },
      { z: 1.30, halfW: 0.80, y: 0.058 },
      { z: 1.62, halfW: 0.66, y: 0.070 }
    ], 0.036);
    g.diffuser = slab([
      { z: 1.58, halfW: 0.62, y: 0.078 },
      { z: 1.78, halfW: 0.58, y: 0.110 },
      { z: 1.94, halfW: 0.52, y: 0.160 }
    ], 0.02);

    /* ---- front wing ---- */
    g.fwMain = wingElement(1.88, 0.26, 0.022, 0.06);
    g.fwFlap1 = wingElement(1.84, 0.17, 0.016, 0.10);
    g.fwFlap2 = wingElement(1.80, 0.13, 0.014, 0.12);
    g.fwFlap3 = wingElement(1.74, 0.10, 0.012, 0.14);
    g.fwEndplate = new THREE.BoxGeometry(0.014, 0.20, 0.38);
    g.fwFootplate = new THREE.BoxGeometry(0.12, 0.013, 0.36);
    g.fwVane = new THREE.BoxGeometry(0.012, 0.12, 0.26);

    /* ---- rear wing ---- */
    g.rwMain = wingElement(1.02, 0.34, 0.030, 0.06);
    g.rwFlap = wingElement(1.00, 0.22, 0.022, 0.16);
    g.rwBeam = wingElement(0.92, 0.16, 0.018, 0.12);
    g.rwEndplate = new THREE.BoxGeometry(0.014, 0.32, 0.42);
    g.rwPylon = new THREE.BoxGeometry(0.026, 0.30, 0.12);
    g.sharkFin = new THREE.BoxGeometry(0.012, 0.22, 0.72);

    /* ---- halo: 300-degree ring with the gap at the front for the pillar ---- */
    g.halo = new THREE.TorusGeometry(0.285, 0.023, 8, 44, Math.PI * 300 / 180);
    g.halo.rotateZ(Math.PI * 120 / 180);       // move the gap to the front
    g.halo.rotateX(-Math.PI / 2);              // lay it flat (XZ plane)
    g.halo.scale(1, 1, 1.28);                  // elliptical: longer front-to-back
    (function archHalo(geo) {
      // give the hoop its characteristic rise towards the rear of the cockpit
      var pos = geo.attributes.position;
      for (var i = 0; i < pos.count; i++) {
        var z = pos.getZ(i);
        var y = pos.getY(i);
        pos.setY(i, y + 0.085 * (z + 0.20) / 0.56);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
    })(g.halo);
    g.haloPillar = new THREE.CylinderGeometry(0.024, 0.032, 0.26, 8);
    g.haloMount = new THREE.BoxGeometry(0.34, 0.028, 0.08);

    /* ---- wheels ---- */
    g.tyreFront = new THREE.CylinderGeometry(0.36, 0.36, 0.305, 36, 1, true);
    g.tyreRear = new THREE.CylinderGeometry(0.36, 0.36, 0.405, 36, 1, true);
    g.tyreWall = new THREE.RingGeometry(0.245, 0.359, 36);
    g.rimBarrel = new THREE.CylinderGeometry(0.249, 0.249, 1, 24, 1, true);
    g.rimFace = new THREE.CircleGeometry(0.247, 24);
    g.spoke = new THREE.BoxGeometry(0.022, 0.19, 0.026);
    g.hubCap = new THREE.CylinderGeometry(0.055, 0.055, 0.03, 12);
    g.compoundRing = new THREE.RingGeometry(0.305, 0.334, 32);
    g.brakeDisc = new THREE.CylinderGeometry(0.155, 0.155, 0.028, 18);
    g.brakeDuct = new THREE.BoxGeometry(0.10, 0.24, 0.38);
    g.axleNut = new THREE.CylinderGeometry(0.038, 0.038, 0.03, 6);

    /* ---- driver + details ---- */
    g.helmet = new THREE.SphereGeometry(0.135, 24, 18);
    g.helmetVisor = new THREE.SphereGeometry(0.137, 20, 12,
      Math.PI * 0.56, Math.PI * 0.42, Math.PI * 0.36, Math.PI * 0.24);
    g.mirror = new THREE.BoxGeometry(0.115, 0.040, 0.028);
    g.mirrorStalk = new THREE.BoxGeometry(0.016, 0.016, 0.09);
    g.exhaust = new THREE.CylinderGeometry(0.042, 0.048, 0.09, 10);
    g.rainLight = new THREE.BoxGeometry(0.055, 0.045, 0.02);
    g.tcam = new THREE.BoxGeometry(0.05, 0.03, 0.075);
    g.antenna = new THREE.CylinderGeometry(0.006, 0.006, 0.16, 6);
    g.sidepodInlet = new THREE.CircleGeometry(0.085, 14);
    g.bargeboard = new THREE.BoxGeometry(0.012, 0.14, 0.30);

    G = g;
    return g;
  }

  /* ================================================================== */
  /* 5. decal helper                                                    */
  /* ================================================================== */
  function decal(tex, w, h, opts) {
    var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial(Object.assign({
        map: tex, transparent: true, alphaTest: 0.06, roughness: 0.42, metalness: 0.02,
        polygonOffset: true, polygonOffsetFactor: -3, depthWrite: false, side: THREE.DoubleSide
      }, opts || {})));
    m.renderOrder = 3;
    return m;
  }

  /* ================================================================== */
  /* 6. wheels                                                          */
  /* ================================================================== */
  function buildWheel(g, C, mat, front, side, lod) {
    var node = new THREE.Group();
    var isRight = side > 0;
    var halfTrack = front ? 0.845 : 0.835;
    node.position.set(halfTrack * side, 0.36, front ? -1.70 : 1.70);

    var spin = new THREE.Group();
    node.add(spin);

    var width = front ? 0.305 : 0.405;
    var outX = isRight ? 1 : -1;             // outward direction
    var tyreGeo = front ? g.tyreFront : g.tyreRear;
    var tyre = new THREE.Mesh(tyreGeo, C.tyre);
    tyre.rotation.z = Math.PI / 2;
    spin.add(tyre);

    // close both sides of the tyre with sidewall rings facing outwards
    [1, -1].forEach(function (d) {
      var wall = new THREE.Mesh(g.tyreWall, C.tyreWall);
      wall.rotation.y = d > 0 ? Math.PI / 2 : -Math.PI / 2;
      wall.position.x = d * width / 2;
      spin.add(wall);
    });

    if (lod > 0) {
      // 2026 cars run wheel covers: a dark face disc with a coloured rim ring
      var coverFace = new THREE.Mesh(g.rimFace, C.darkMetal);
      coverFace.rotation.y = outX > 0 ? Math.PI / 2 : -Math.PI / 2;
      coverFace.position.x = outX * (width / 2 + 0.0015);
      coverFace.scale.setScalar(0.995);
      spin.add(coverFace);

      var ringMesh = new THREE.Mesh(g.compoundRing, mat.compound);
      ringMesh.rotation.y = outX > 0 ? Math.PI / 2 : -Math.PI / 2;
      ringMesh.position.x = outX * (width / 2 + 0.003);
      spin.add(ringMesh);

      // inner-side brake disc (glows with temperature in later builds)
      var disc = new THREE.Mesh(g.brakeDisc, C.brake);
      disc.rotation.z = Math.PI / 2;
      disc.position.x = -outX * (width * 0.12);
      spin.add(disc);
      node.userData.brakeDisc = disc;

      var nut = new THREE.Mesh(g.axleNut, C.metal);
      nut.rotation.z = Math.PI / 2;
      nut.position.x = outX * (width / 2 + 0.02);
      spin.add(nut);
    }

    // brake duct shroud sits inboard of the wheel
    if (lod > 1) {
      var duct = new THREE.Mesh(g.brakeDuct, C.carbon);
      duct.position.set(-outX * (width / 2 + 0.06), 0.0, 0);
      spin.add(duct);
    }

    return { node: node, spin: spin, axle: front ? 'front' : 'rear', side: isRight ? 'R' : 'L', front: front };
  }

  /* ================================================================== */
  /* 7. low-detail car (LOD 0) — ~10 meshes for distant AI cars         */
  /* ================================================================== */
  function buildLowCar(team, C, mat) {
    var grp = new THREE.Group();
    function add(geo, m, x, y, z) {
      var mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x || 0, y || 0, z || 0);
      grp.add(mesh);
      return mesh;
    }
    // body block
    var bodyGeo = loftSections([
      { z: -2.34, y: 0.19, w: 0.06, h: 0.04, n: 1.8 },
      { z: -1.70, y: 0.22, w: 0.13, h: 0.07, n: 2.0 },
      { z: -0.80, y: 0.29, w: 0.24, h: 0.14, n: 2.4 },
      { z: 0.10, y: 0.40, w: 0.31, h: 0.21, n: 2.6 },
      { z: 0.90, y: 0.42, w: 0.26, h: 0.19, n: 2.4 },
      { z: 1.70, y: 0.38, w: 0.10, h: 0.09, n: 2.2 }
    ], 10, true, true);
    add(bodyGeo, mat.paint);
    add(new THREE.BoxGeometry(0.36, 0.34, 1.5), mat.dark, 0.52, 0.34, 0.45);
    add(new THREE.BoxGeometry(0.36, 0.34, 1.5), mat.dark, -0.52, 0.34, 0.45);
    add(new THREE.BoxGeometry(1.9, 0.06, 0.42), C.carbon, 0, 0.16, -2.34);
    add(new THREE.BoxGeometry(1.02, 0.05, 0.4), mat.paint, 0, 0.98, 2.16);
    add(new THREE.BoxGeometry(0.02, 0.34, 0.5), mat.accent, 0.50, 0.95, 2.16);
    add(new THREE.BoxGeometry(0.02, 0.34, 0.5), mat.accent, -0.50, 0.95, 2.16);
    add(new THREE.BoxGeometry(1.7, 0.04, 1.2), C.carbon, 0, 0.07, 0.5);
    add(new THREE.SphereGeometry(0.15, 10, 8), mat.helmet, 0, 0.80, 0.05);

    var wheels = [];
    [[1, true], [-1, true], [1, false], [-1, false]].forEach(function (w) {
      var node = new THREE.Group();
      node.position.set(0.84 * w[0], 0.36, w[1] ? -1.70 : 1.70);
      var spin = new THREE.Group();
      node.add(spin);
      var t = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, w[1] ? 0.30 : 0.40, 10, 1), C.tyre);
      t.rotation.z = Math.PI / 2;
      spin.add(t);
      grp.add(node);
      wheels.push({ node: node, spin: spin, axle: w[1] ? 'front' : 'rear', side: w[0] > 0 ? 'R' : 'L', front: w[1] });
    });
    grp.userData.wheels = wheels;
    grp.userData.low = true;
    return grp;
  }

  /* ================================================================== */
  /* 8. main builder                                                    */
  /* ================================================================== */
  F1.buildCar = function (opts) {
    opts = opts || {};
    var team = F1.DATA.getTeam(opts.teamId);
    var driver = opts.driverId ? F1.DATA.getDriver(opts.driverId) : null;
    var lod = opts.lod === undefined ? 2 : opts.lod;
    var g = geometry();
    var C = common();
    var mat = teamMat(team);

    // per-team compound colour material (soft=red bands in showroom)
    if (!mat.compound) {
      mat.compound = new THREE.MeshStandardMaterial({
        color: 0xe10600, roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide
      });
      mat.helmet = new THREE.MeshStandardMaterial({ color: driver ? driver.helmet.base : '#dddddd', roughness: 0.3 });
    }

    if (lod === 0) {
      var low = buildLowCar(team, C, mat);
      low.userData.team = team;
      low.userData.driver = driver;
      return low;
    }

    var root = new THREE.Group();
    root.name = 'car_' + team.id;
    var body = new THREE.Group();
    root.add(body);

    function add(geo, m, x, y, z, rx, ry, rz, parent) {
      var mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x || 0, y || 0, z || 0);
      if (rx) mesh.rotation.x = rx;
      if (ry) mesh.rotation.y = ry;
      if (rz) mesh.rotation.z = rz;
      (parent || body).add(mesh);
      return mesh;
    }

    /* ---------- bodywork ---------- */
    add(g.body, mat.paint);
    add(g.cockpit, mat.dark);
    add(g.cover, mat.paint);
    add(g.airbox, mat.dark);
    add(g.podR, mat.dark);
    add(g.podL, mat.dark);
    add(g.floor, C.carbon);
    add(g.diffuser, C.carbon);

    // sidepod inlets
    [-1, 1].forEach(function (s) {
      var inlet = add(g.sidepodInlet, C.intake, 0.505 * s, 0.348, -0.312, 0, Math.PI, 0);
      inlet.scale.set(0.9, 1.55, 1);
    });

    // bargeboards / turning vanes
    [-1, 1].forEach(function (s) {
      add(g.bargeboard, C.carbon, 0.40 * s, 0.17, -0.62, 0, s * 0.18, s * 0.10);
    });

    /* ---------- front wing ---------- */
    add(g.fwMain, mat.paint, 0, 0.080, -2.44, -0.04);
    add(g.fwFlap1, C.carbon, 0, 0.120, -2.30, -0.16);
    add(g.fwFlap2, C.carbon, 0, 0.155, -2.205, -0.26);
    add(g.fwFlap3, mat.dark, 0, 0.183, -2.135, -0.34);
    [-1, 1].forEach(function (s) {
      add(g.fwEndplate, mat.dark, 0.945 * s, 0.128, -2.24);
      add(g.fwFootplate, C.carbon, 0.905 * s, 0.028, -2.24);
      add(g.fwVane, C.carbon, 0.80 * s, 0.105, -2.18, 0, s * 0.22, 0);
    });
    // nose-wing pillars
    [-0.12, 0.12].forEach(function (x) { add(new THREE.BoxGeometry(0.02, 0.11, 0.30), C.carbon, x, 0.15, -2.20); });

    /* ---------- rear wing ---------- */
    add(g.rwMain, mat.dark, 0, 1.005, 2.23, 0.02);
    var flap = add(g.rwFlap, mat.accent, 0, 1.075, 2.35, -0.16);
    add(g.rwBeam, C.carbon, 0, 0.60, 2.22, 0.18);
    [-1, 1].forEach(function (s) {
      add(g.rwEndplate, mat.dark, 0.515 * s, 1.02, 2.24);
      add(new THREE.BoxGeometry(0.006, 0.03, 0.42), mat.accent, 0.523 * s, 1.14, 2.24);
    });
    [-1, 1].forEach(function (s) {
      add(g.rwPylon, C.carbon, 0.13 * s, 0.80, 2.20, 0.1);
    });
    // shark fin
    add(g.sharkFin, mat.dark, 0, 0.66, 1.42, 0.0);
    // crash structure
    add(new THREE.BoxGeometry(0.16, 0.13, 0.42), C.carbon, 0, 0.40, 1.92);

    /* ---------- halo ---------- */
    add(g.halo, mat.accent, 0, 0.80, 0.02);
    add(g.haloPillar, mat.accent, 0, 0.70, -0.30, 0.20);
    add(g.haloMount, C.carbon, 0, 0.64, 0.30);

    /* ---------- driver ---------- */
    if (driver) {
      var helmetMesh = add(g.helmet, new THREE.MeshPhysicalMaterial({
        map: helmetTexture(driver.helmet, driver.number), roughness: 0.18, metalness: 0.2,
        clearcoat: 1, clearcoatRoughness: 0.1
      }), 0, 0.905, 0.02);
      helmetMesh.rotation.y = Math.PI;
      helmetMesh.scale.set(0.94, 1.0, 1.02);
      var visor = add(g.helmetVisor, C.visor, 0, 0.905, 0.02);
      visor.rotation.y = Math.PI;
      visor.scale.set(0.95, 1.01, 1.03);
      // headrest padding around the helmet
      add(new THREE.TorusGeometry(0.20, 0.045, 6, 18, Math.PI * 1.1), mat.dark, 0, 0.80, 0.14, Math.PI / 2, 0, -Math.PI * 0.05);
    } else {
      add(g.helmet, mat.helmet, 0, 0.905, 0.02);
    }

    /* ---------- mirrors, T-cam, antennas, exhaust, rain light ---------- */
    [-1, 1].forEach(function (s) {
      add(g.mirror, mat.dark, 0.575 * s, 0.655, -0.62, 0, s * -0.1, s * 0.1);
      add(g.mirrorStalk, C.carbon, 0.50 * s, 0.625, -0.62, 0, 0, s * 0.6);
    });
    add(g.tcam, C.carbon, 0, 0.79, 0.12);
    add(g.antenna, C.darkMetal, 0, 0.90, 0.30);
    add(g.exhaust, C.metal, 0, 0.455, 1.90, Math.PI / 2);
    add(g.rainLight, C.rainLight, 0, 0.40, 1.945);

    /* ---------- suspension ---------- */
    [-1, 1].forEach(function (s) {
      [[-1.70, true], [1.70, false]].forEach(function (ax) {
        var zA = ax[0], front = ax[1];
        var innerX = 0.22 * s, outerX = 0.80 * s;
        var yTop = front ? 0.50 : 0.52, yBot = front ? 0.22 : 0.24;
        var p = function (x, y, z) { return new THREE.Vector3(x, y, z); };
        body.add(rodMesh(p(innerX, yTop, zA - 0.19), p(outerX, yTop - 0.05, zA), 0.013, C.carbon));
        body.add(rodMesh(p(innerX, yTop, zA + 0.17), p(outerX, yTop - 0.05, zA), 0.013, C.carbon));
        body.add(rodMesh(p(innerX, yBot, zA - 0.17), p(outerX, yBot + 0.04, zA), 0.015, C.carbon));
        body.add(rodMesh(p(innerX, yBot, zA + 0.15), p(outerX, yBot + 0.04, zA), 0.015, C.carbon));
        body.add(rodMesh(p(outerX, yBot + 0.04, zA), p(0.24 * s, 0.42, zA + 0.34), 0.011, C.darkMetal));
      });
    });

    /* ---------- wheels ---------- */
    var wheels = [];
    [1, -1].forEach(function (s) { wheels.push(buildWheel(g, C, mat, true, s, lod)); });
    [1, -1].forEach(function (s) { wheels.push(buildWheel(g, C, mat, false, s, lod)); });
    wheels.forEach(function (w) { root.add(w.node); });

    /* ---------- livery decals ---------- */
    var team2 = team;
    var title = F1.DATA.titleSponsor(team2.id);
    var num = driver ? String(driver.number) : '';
    var surname = driver ? driver.lastName.toUpperCase() : team2.short.toUpperCase();
    var onLight = F1.util.luminance(team2.colors.primary) > 0.6;

    // sidepod flank panels (biggest sponsor real estate)
    var sideTex = panel(team2, {
      key: 'side', w: 1024, h: 256, pattern: team2.id === 'mclaren' ? 'slash' : 'swoosh',
      words: [title].concat(F1.DATA.sponsorsOf(team2.id)
        .filter(function (s) { return s.tier !== 'partner'; })
        .map(function (s) { return s.name; }).slice(0, 2))
    });
    [-1, 1].forEach(function (s) {
      var d = decal(sideTex, 0.72, 0.19);
      d.position.set(0.683 * s, 0.365, 0.44);
      d.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
      d.rotation.z = s > 0 ? 0 : 0;
      body.add(d);
      // secondary partner strip along the floor edge
      var strip = decal(panel(team2, {
        key: 'floor' + s, w: 1024, h: 128, pattern: 'edge',
        words: [F1.DATA.sponsorsOf(team2.id).slice(-2).map(function (x) { return x.name; }).join('   ')]
      }), 0.86, 0.10);
      strip.position.set(0.60 * s, 0.19, 0.62);
      strip.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
      strip.rotation.x = -0.25;
      body.add(strip);
    });

    // engine cover (name + number + title sponsor)
    var coverTex = panel(team2, {
      key: 'cover', w: 512, h: 512, pattern: 'edge',
      words: [{ text: num, weight: 900 }, { text: title, weight: 800 }]
    });
    var cover = decal(coverTex, 0.26, 0.62);
    cover.position.set(0, 0.735, 1.10);
    cover.rotation.x = -Math.PI / 2 + 0.14;
    cover.rotation.z = Math.PI;
    body.add(cover);

    // cockpit side: driver surname
    var cpTex = panel(team2, {
      key: 'cockpit', w: 512, h: 128, pattern: null,
      words: [{ text: surname, weight: 800 }]
    });
    [-1, 1].forEach(function (s) {
      var d = decal(cpTex, 0.34, 0.075);
      d.position.set(0.292 * s, 0.47, 0.06);
      d.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
      body.add(d);
    });

    // nose: team code + number
    var noseTex = panel(team2, {
      key: 'nose', w: 256, h: 512, pattern: null,
      words: [{ text: num || team2.code, weight: 900 }]
    });
    var nose = decal(noseTex, 0.13, 0.26);
    nose.position.set(0, 0.245, -1.62);
    nose.rotation.x = -Math.PI / 2 + 0.24;
    body.add(nose);

    // rear wing faces
    var wingTex = panel(team2, {
      key: 'wing', w: 1024, h: 256, pattern: 'edge',
      words: [{ text: title.toUpperCase(), weight: 900 }, { text: surname + '  ' + num, weight: 700 }]
    });
    [-1, 1].forEach(function (s) {
      var d = decal(wingTex, 0.90, 0.19);
      d.position.set(0, 1.040, 2.235 + 0.185 * s);
      d.rotation.y = s > 0 ? 0 : Math.PI;
      body.add(d);
    });

    // rear wing endplate numbers
    var epTex = panel(team2, {
      key: 'rwep', w: 256, h: 256, pattern: null,
      words: [{ text: num || team2.code, weight: 900 }]
    });
    [-1, 1].forEach(function (s) {
      var d = decal(epTex, 0.24, 0.24);
      d.position.set(0.523 * s, 1.02, 2.25);
      d.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
      body.add(d);
    });

    // front wing endplate code
    var fwTex = panel(team2, {
      key: 'fwep', w: 512, h: 128, pattern: null,
      words: [{ text: team2.code, weight: 900 }]
    });
    [-1, 1].forEach(function (s) {
      var d = decal(fwTex, 0.30, 0.072);
      d.position.set(0.953 * s, 0.128, -2.24);
      d.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
      body.add(d);
    });

    // halo wordmark
    var haloTex = panel(team2, { key: 'halo', w: 512, h: 128, pattern: null, words: [{ text: title, weight: 700 }] });
    var haloDecal = decal(haloTex, 0.28, 0.07);
    haloDecal.position.set(0, 0.905, -0.17);
    haloDecal.rotation.x = -Math.PI / 2 + 0.55;
    body.add(haloDecal);

    /* ---------- animate helpers ---------- */
    var baseFlapRot = flap.rotation.x;
    var brakeMats = [];
    root.traverse(function (o) { if (o.userData && o.userData.brakeDisc) brakeMats.push(o.userData.brakeDisc); });

    root.userData = {
      team: team, driver: driver, lod: lod,
      wheels: wheels,
      body: body,
      flap: flap,
      setBrakeGlow: function (v) {
        C.brake.emissiveIntensity = v;
      },
      setAeroMode: function (mode) {
        // X-mode opens the rear flap, Z-mode closes it
        flap.rotation.x = baseFlapRot + (mode === 'X' ? -0.55 : 0);
      }
    };

    // shadows: body casts, wheels cast
    root.traverse(function (o) {
      if (!o.isMesh) return;
      var isDecal = o.material && o.material.map && o.material.transparent;
      o.castShadow = !isDecal;
      o.receiveShadow = false;
    });

    return root;
  };

  /* ------------------------------------------------------------------ */
  /* exports                                                            */
  /* ------------------------------------------------------------------ */
  F1.carModel = {
    helmetTexture: helmetTexture,
    panelTexture: panel,
    disposeTextureCache: function () {
      Object.keys(TEX).forEach(function (k) {
        try { TEX[k].dispose(); } catch (e) {}
        delete TEX[k];
      });
    }
  };
})(window.F1 = window.F1 || {});
