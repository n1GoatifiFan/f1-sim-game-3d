/* ==========================================================================
   F1 2026 — world/car_model.js
   Procedural 2026 Formula 1 car, second generation.

   The first version was a handful of fat lofts and boxes; this one is built the
   way a real car reads: a continuous lofted monocoque from nose to engine
   cover, undercut sidepods, a floor with fences and a diffuser, multi-element
   front and rear wings with swept endplates, pushrod suspension, and lathe-
   turned tyres with a rounded sidewall, a polar-mapped PIRELLI sidewall band
   and wheel covers.

   F1.buildCar({ teamId, driverId, lod }) -> THREE.Group
     lod 2 -> showroom / player car (full detail)
     lod 1 -> AI cars (same silhouette, no small fittings)
     lod 0 -> distant cars (10 meshes)
   group.userData.wheels = [{ node, spin, axle:'front'|'rear', side:'L'|'R' }]
   group.userData.setBrakeGlow(v)      // 0..1 emissive brake discs
   group.userData.setAeroMode('X'|'Z') // active aero flap animation

   Axis convention: forward is -Z, up +Y, right +X, metres.
   Static body panels are merged per material at build time, so ~90 parts cost
   about 8 draw calls instead of 90.
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
    t.anisotropy = 8;
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

  /* A livery panel: team colours + sponsor wordmarks. */
  function panel(team, o) {
    var key = team.id + '|' + o.key;
    if (TEX[key]) return TEX[key];
    var W = o.w || 1024, H = o.h || 256;
    var c = canvas(W, H), ctx = c.getContext('2d');
    var col = team.colors;
    ctx.clearRect(0, 0, W, H);

    if (o.bg) { ctx.fillStyle = o.bg; ctx.fillRect(0, 0, W, H); }

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

  /* polar-mapped tyre sidewall: compound band + PIRELLI P ZERO lettering */
  function sidewallTexture(compound) {
    var key = 'sidewall|' + compound;
    if (TEX[key]) return TEX[key];
    var W = 1024, H = 128, c = canvas(W, H), ctx = c.getContext('2d');
    var band = { soft: '#e10600', medium: '#ffd400', hard: '#f2f2f2', inter: '#19c37d', wet: '#2d6fe0' }[compound] || '#e10600';
    ctx.fillStyle = '#1a1a1d'; ctx.fillRect(0, 0, W, H);
    // outer edge of the sidewall has a subtle sheen
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(255,255,255,0.10)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.02)');
    g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // compound band, repeated 6 times around the tyre
    ctx.fillStyle = band;
    for (var i = 0; i < 6; i++) ctx.fillRect(i * (W / 6) + 12, 4, W / 6 - 24, 7);
    ctx.fillStyle = '#d8d8d8';
    ctx.font = 'bold 26px "Arial Narrow", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (var k = 0; k < 6; k++) {
      ctx.save();
      ctx.translate(k * (W / 6) + W / 12, H * 0.46);
      ctx.fillText('PIRELLI', 0, 0);
      ctx.restore();
    }
    ctx.font = 'bold 17px "Arial Narrow", Arial, sans-serif';
    ctx.fillStyle = '#9a9a9a';
    for (var m = 0; m < 6; m++) {
      ctx.save();
      ctx.translate(m * (W / 6) + W / 12, H * 0.70);
      ctx.fillText('P ZERO', 0, 0);
      ctx.restore();
    }
    TEX[key] = toTexture(c, [1, 1]);
    TEX[key].wrapS = THREE.RepeatWrapping;
    TEX[key].wrapT = THREE.ClampToEdgeWrapping;
    return TEX[key];
  }

  /* carbon fibre: a faint twill weave so black parts are not flat */
  function carbonTexture() {
    if (TEX.__carbon) return TEX.__carbon;
    var N = 128, c = canvas(N, N), ctx = c.getContext('2d');
    ctx.fillStyle = '#15181c'; ctx.fillRect(0, 0, N, N);
    for (var y = 0; y < N; y += 8) {
      for (var x = 0; x < N; x += 8) {
        var on = ((x / 8) + (y / 8)) % 2 === 0;
        ctx.fillStyle = on ? 'rgba(58,64,72,0.55)' : 'rgba(22,25,29,0.6)';
        ctx.fillRect(x, y, 8, 8);
        ctx.fillStyle = on ? 'rgba(120,128,138,0.10)' : 'rgba(0,0,0,0.15)';
        ctx.fillRect(x, y, 8, 4);
      }
    }
    TEX.__carbon = toTexture(c, [7, 7]);
    return TEX.__carbon;
  }

  /* ================================================================== */
  /* 2. materials                                                       */
  /* ================================================================== */
  var MAT = {};
  function teamMat(team) {
    if (MAT[team.id]) return MAT[team.id];
    var c = team.colors;
    MAT[team.id] = {
      paint: new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(c.primary), metalness: 0.08, roughness: 0.30,
        clearcoat: 1.0, clearcoatRoughness: 0.14, envMapIntensity: 1.05
      }),
      dark: new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(c.secondary), metalness: 0.30, roughness: 0.34,
        clearcoat: 0.85, clearcoatRoughness: 0.16, envMapIntensity: 0.95
      }),
      accent: new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(c.accent), metalness: 0.25, roughness: 0.28,
        clearcoat: 0.9, clearcoatRoughness: 0.14, envMapIntensity: 1.0
      }),
      accentHex: '#' + new THREE.Color(c.accent).getHexString()
    };
    return MAT[team.id];
  }
  function common() {
    if (MAT.__c) return MAT.__c;
    var carbonMap = carbonTexture();
    MAT.__c = {
      carbon: new THREE.MeshStandardMaterial({ color: 0x1a1e23, metalness: 0.35, roughness: 0.34, map: carbonMap, envMapIntensity: 1.15 }),
      carbonLight: new THREE.MeshStandardMaterial({ color: 0x252b32, metalness: 0.4, roughness: 0.32, map: carbonMap, envMapIntensity: 1.2 }),
      metal: new THREE.MeshStandardMaterial({ color: 0xa9b0b8, metalness: 1, roughness: 0.28 }),
      darkMetal: new THREE.MeshStandardMaterial({ color: 0x44484f, metalness: 0.95, roughness: 0.3 }),
      gold: new THREE.MeshStandardMaterial({ color: 0xb08d3f, metalness: 1, roughness: 0.34 }),
      tyre: new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.82, metalness: 0.02, envMapIntensity: 0.5 }),
      rim: new THREE.MeshStandardMaterial({ color: 0x2b2e33, metalness: 0.9, roughness: 0.34 }),
      rimFace: new THREE.MeshStandardMaterial({ color: 0x24272c, metalness: 0.9, roughness: 0.26 }),
      intake: new THREE.MeshStandardMaterial({ color: 0x030304, roughness: 0.98, metalness: 0.05 }),
      visor: new THREE.MeshPhysicalMaterial({
        color: 0x0b0d12, metalness: 0.95, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02,
        iridescence: 0.7, iridescenceIOR: 1.6, iridescenceThicknessRange: [120, 420]
      }),
      brake: new THREE.MeshStandardMaterial({ color: 0x2a0d0a, emissive: 0xff2a00, emissiveIntensity: 0.0, roughness: 0.7 }),
      caliper: new THREE.MeshStandardMaterial({ color: 0x5a1414, metalness: 0.5, roughness: 0.45 }),
      rainLight: new THREE.MeshStandardMaterial({ color: 0x300003, emissive: 0xff0018, emissiveIntensity: 1.8, roughness: 0.5 }),
      headlight: new THREE.MeshBasicMaterial({ color: 0xdff0ff }),
      white: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 })
    };
    return MAT.__c;
  }

  /* ================================================================== */
  /* 3. geometry primitives                                             */
  /* ================================================================== */
  /* ---------------- the hull ----------------
     A car cross-section is described by explicit points rather than an ellipse,
     because the silhouette is the whole game: a flat floor edge, an undercut
     that tucks back in, the sidepod shoulder, the deck, then the engine cover
     crown. One parameter set per station along the car. */
  function hullRing(s) {
    var f = s.floor, po = s.podOut === undefined ? f * 0.92 : s.podOut;
    var pl = s.podLow === undefined ? s.yb + 0.10 : s.podLow;
    var pm = s.podMid === undefined ? (pl + s.podTop) * 0.5 : s.podMid;
    var pt = s.podTop === undefined ? s.ym : s.podTop;
    var pi = s.podIn === undefined ? po * 0.66 : s.podIn;
    var bh = s.bodyHalf === undefined ? Math.min(f * 0.42, 0.24) : s.bodyHalf;
    var by = s.bodyTop === undefined ? s.yt : s.bodyTop;
    var cy = s.crown === undefined ? by : s.crown;

    // right half, bottom centre -> over the top -> centre
    var right = [
      [0, s.yb],
      [f * 0.86, s.yb],
      [f, s.yb + 0.012],
      [po * 0.985, pl],
      [po, pl + (pm - pl) * 0.45],
      [po, pm],
      [po * 0.965, pt - (pt - pm) * 0.18],
      [pi, pt],
      [bh, by - (by - pt) * 0.22],
      [Math.min(bh * 0.55, 0.11), cy]
    ];
    var pts = right.slice();
    for (var i = right.length - 1; i >= 1; i--) pts.push([-right[i][0], right[i][1]]);
    pts.push([0, s.yb]);
    var ox = s.x || 0;                       // lateral offset (sidepods)
    return pts.map(function (p, idx) {
      return new THREE.Vector3(p[0] + ox, p[1], idx === pts.length - 1 ? s.z - 0.001 : s.z);
    });
  }

  /* loft hull stations into a closed shell, split into carbon (below splitY)
     and paint (above) via two material groups */
  function loftHull(stations, splitY) {
    var rings = stations.map(hullRing);
    var N = rings[0].length;
    var pos = [], uvs = [], low = [], high = [];
    var z0 = rings[0][0].z, z1 = rings[rings.length - 1][0].z;
    rings.forEach(function (r) {
      r.forEach(function (v, vi) {
        pos.push(v.x, v.y, v.z);
        uvs.push(vi / N, (v.z - z0) / (z1 - z0 || 1));
      });
    });
    for (var i = 0; i < rings.length - 1; i++) {
      for (var j = 0; j < N - 1; j++) {
        var a = i * N + j, b = a + 1, c2 = (i + 1) * N + j + 1, d = (i + 1) * N + j;
        var my = (rings[i][j].y + rings[i + 1][j].y) * 0.5;
        var tgt = splitY !== undefined && my < splitY ? low : high;
        tgt.push(a, d, c2, a, c2, b);
      }
    }
    // nose + tail caps
    function cap(ri, flip) {
      var r = rings[ri], ci = pos.length / 3, cx = 0, cy = 0, cz = 0;
      r.forEach(function (v) { cx += v.x; cy += v.y; cz += v.z; });
      pos.push(cx / r.length, cy / r.length, cz / r.length);
      uvs.push(0.5, 0.5);
      for (var m = 0; m < r.length; m++) { pos.push(r[m].x, r[m].y, r[m].z); uvs.push(0.5, 0.5); }
      var base = ci + 1;
      for (var k = 0; k < r.length - 1; k++) {
        var ia = base + k, ib = base + k + 1;
        if (flip) high.push(ci, ib, ia); else high.push(ci, ia, ib);
      }
    }
    cap(0, true);
    cap(rings.length - 1, false);
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    if (splitY !== undefined) {
      g.setIndex(low.concat(high));
      g.addGroup(0, low.length, 0);
      g.addGroup(low.length, high.length, 1);
    } else {
      g.setIndex(high);
    }
    g.computeVertexNormals();
    return g;
  }

  /* swept wing element, built as a closed solid: span along X, chord along Z,
     a real cambered profile, optional taper and tip sweep. Closed at leading
     and trailing edges so the normals stay consistent from every angle. */
  function wingElement(o) {
    var span = o.span, chord = o.chord, thick = o.thick || 0.016;
    var camber = o.camber === undefined ? 0.12 : o.camber;
    var sweep = o.sweep || 0;
    var taper = o.taper === undefined ? 1 : o.taper;
    var STA = 10, X = 12;

    function chordAt(t) { return chord * (1 - (1 - taper) * Math.pow(t, 1.7)); }
    function camberAt(t) { return camber * (1 - 0.25 * t); }

    /* one closed airfoil ring at span station x */
    function ring(x, t) {
      var c = chordAt(t), cm = camberAt(t), dz = -sweep * Math.pow(t, 1.8);
      var out = [];
      for (var j = 0; j <= X; j++) {
        var u = j / X;
        var yu = Math.sin(Math.pow(u, 0.75) * Math.PI) * thick * 0.65 + cm * Math.pow(u, 1.6) * c * 0.6;
        out.push([x, yu, -c * 0.5 + c * u + dz]);
      }
      for (var k = X; k >= 0; k--) {
        var u2 = k / X;
        var yl = -Math.sin(Math.pow(u2, 0.75) * Math.PI) * thick * 0.30 - cm * Math.pow(u2, 1.6) * c * 0.18;
        out.push([x, yl, -c * 0.5 + c * u2 + dz]);
      }
      return out;
    }

    var pos = [], idx = [];
    var stations = [];
    for (var i = 0; i <= STA; i++) stations.push(-0.5 + (i / STA) * 0.5);        // left half
    for (var i2 = STA; i2 >= 0; i2--) stations.push(0.5 - (i2 / STA) * 0.5);      // right half
    stations = stations.slice(0, stations.length - 1);                             // last == first
    var rings = stations.map(function (tx) { return ring(tx * span, Math.abs(tx) * 2); });
    // the station list runs left->centre->left, so rebuild as a proper loop
    rings = [];
    var order = [];
    for (var a = 0; a <= STA; a++) order.push(-1 + a / STA);          // -1 .. 0 (left)
    for (var b = 1; b <= STA; b++) order.push(b / STA);               // 0 .. 1 (right)
    order.forEach(function (f) { rings.push(ring(f * span * 0.5, Math.abs(f))); });

    var N = rings[0].length;
    rings.forEach(function (r) { r.forEach(function (v) { pos.push(v[0], v[1], v[2]); }); });
    for (var q = 0; q < rings.length - 1; q++) {
      for (var j2 = 0; j2 < N; j2++) {
        var p0 = q * N + j2, p1 = q * N + (j2 + 1) % N;
        var p2 = (q + 1) * N + (j2 + 1) % N, p3 = (q + 1) * N + j2;
        idx.push(p0, p3, p2, p0, p2, p1);
      }
    }
    // end caps
    [0, rings.length - 1].forEach(function (ri, which) {
      var r = rings[ri], ci = pos.length / 3, cx = 0, cy = 0, cz = 0;
      r.forEach(function (v) { cx += v[0]; cy += v[1]; cz += v[2]; });
      pos.push(cx / r.length, cy / r.length, cz / r.length);
      for (var m = 0; m < r.length; m++) pos.push(r[m][0], r[m][1], r[m][2]);
      var base = ci + 1;
      for (var m2 = 0; m2 < r.length; m2++) {
        var ia = base + m2, ib = base + (m2 + 1) % r.length;
        if (which === 0) idx.push(ci, ib, ia); else idx.push(ci, ia, ib);
      }
    });
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /* flat slab from a centreline strip [{z, halfW, y}] */
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
      idx.push(a, c, d, a, d, b);
      idx.push(B + a, B + d, B + c, B + a, B + b, B + d);
      idx.push(a, B + a, B + d, a, B + d, c);
      idx.push(b, d, B + d, b, B + d, B + b);
    }
    idx.push(0, 1, B + 1, 0, B + 1, B);
    var e = (n - 1) * 2;
    idx.push(e, B + e, B + e + 1, e, B + e + 1, e + 1);
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /* an extruded flat plate: `pts` is a closed convex polygon in the (z, y)
     plane, extruded along X by `thickness` (centred on x = 0). Explicit
     vertices, no rotation guesses. */
  function plate(pts, thickness) {
    var pos = [], idx = [];
    var n = pts.length, h = (thickness || 0.012) / 2;
    // two faces
    [h, -h].forEach(function (x) {
      for (var i = 0; i < n; i++) pos.push(x, pts[i][1], pts[i][0]);
    });
    for (var k = 1; k < n - 1; k++) {
      idx.push(0, k + 1, k);                       // +X face
      idx.push(n, n + k, n + k + 1);               // -X face
    }
    for (var e = 0; e < n; e++) {
      var e2 = (e + 1) % n;
      var a = e, b = e2, c = n + e2, d = n + e;
      idx.push(a, b, c, a, c, d);                  // rim
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function rodMesh(a, b, r, mat, seg) {
    var dir = new THREE.Vector3().subVectors(b, a);
    var len = dir.length();
    var m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg || 6, 1), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return m;
  }

  /* merge every static mesh in a group by material: ~90 parts -> a handful of
     draw calls. Meshes flagged userData.keep are left alone (wheels, decals). */
  function mergeStatic(group) {
    var buckets = new Map();
    var keep = [];
    group.updateMatrixWorld(true);
    var toRemove = [];
    group.traverse(function (o) {
      if (!o.isMesh) return;
      if (o.userData.keep || Array.isArray(o.material) ||
          (o.material && o.material.transparent)) { keep.push(o); return; }
      if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) { keep.push(o); return; }
      var key = o.material;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(o);
      toRemove.push(o);
    });
    toRemove.forEach(function (o) { if (o.parent) o.parent.remove(o); });

    var made = [];
    buckets.forEach(function (list, mat) {
      var pos = [], nor = [], uv = [];
      list.forEach(function (o) {
        var g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
        var p = g.attributes.position, nrm = g.attributes.normal, uvs = g.attributes.uv;
        var m = o.matrixWorld.clone();
        // the merge target lives in the group's own space
        var parentM = new THREE.Matrix4();
        if (o.parent && o.parent !== group) {
          o.parent.updateMatrixWorld(true);
          parentM.copy(group.matrixWorld).invert().multiply(o.parent.matrixWorld);
        } else {
          parentM.identity();
        }
        m.premultiply(parentM);
        var v = new THREE.Vector3(), nv = new THREE.Vector3();
        var nm = new THREE.Matrix3().getNormalMatrix(m);
        for (var i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p, i).applyMatrix4(m);
          pos.push(v.x, v.y, v.z);
          if (nrm) {
            nv.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
            nor.push(nv.x, nv.y, nv.z);
          }
          if (uvs) uv.push(uvs.getX(i), uvs.getY(i));
        }
      });
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      if (nor.length) geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      else geo.computeVertexNormals();
      if (uv.length) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      var mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      group.add(mesh);
      made.push(mesh);
    });
    return made;
  }

  /* ================================================================== */
  /* 4. the tyre + wheel                                                */
  /* ================================================================== */
  var WHEEL_GEO = {};

  function tyreGeometry(radius, halfWidth) {
    var key = 't' + radius + '|' + halfWidth;
    if (WHEEL_GEO[key]) return WHEEL_GEO[key];
    var R = radius, hw = halfWidth, bead = radius * 0.70;
    var pts = [
      new THREE.Vector2(bead, -hw * 0.99),
      new THREE.Vector2(R * 0.93, -hw * 0.98),
      new THREE.Vector2(R * 0.985, -hw * 0.88),
      new THREE.Vector2(R * 0.998, -hw * 0.62),
      new THREE.Vector2(R, -hw * 0.22),
      new THREE.Vector2(R, hw * 0.22),
      new THREE.Vector2(R * 0.998, hw * 0.62),
      new THREE.Vector2(R * 0.985, hw * 0.88),
      new THREE.Vector2(R * 0.93, hw * 0.98),
      new THREE.Vector2(bead, hw * 0.99)
    ];
    var g = new THREE.LatheGeometry(pts, 44);
    g.rotateZ(Math.PI / 2);          // axis along X
    g.computeVertexNormals();
    WHEEL_GEO[key] = g;
    return g;
  }

  /* the wheel face: five forged spokes, a centre nut and a coloured lip,
     painted once into a texture and wrapped on the rim face. Far cheaper and
     crisper than modelled spokes at race distance. */
  var FACE_TEX = {};
  function wheelFaceTexture(accent) {
    var key = 'f' + accent;
    if (FACE_TEX[key]) return FACE_TEX[key];
    var S = 256, c = document.createElement('canvas');
    c.width = c.height = S;
    var ctx = c.getContext('2d');
    var cx = S / 2, cy = S / 2, R = S / 2;

    // tyre-side vignette behind the rim
    ctx.fillStyle = '#0a0b0d';
    ctx.fillRect(0, 0, S, S);

    // barrel / dish
    var dish = ctx.createRadialGradient(cx, cy * 0.82, R * 0.12, cx, cy, R);
    dish.addColorStop(0, '#3c4149');
    dish.addColorStop(0.55, '#23272d');
    dish.addColorStop(1, '#14161a');
    ctx.fillStyle = dish;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.985, 0, TAU); ctx.fill();

    // machined rim lip with a thin team-colour pinline
    ctx.strokeStyle = '#8a9099';
    ctx.lineWidth = R * 0.085;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.905, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(20,22,26,0.55)';
    ctx.lineWidth = R * 0.02;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.865, 0, TAU); ctx.stroke();
    ctx.strokeStyle = accent;
    ctx.lineWidth = R * 0.026;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.955, 0, TAU); ctx.stroke();

    // five spokes
    for (var i = 0; i < 5; i++) {
      var a = (i / 5) * TAU - Math.PI / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      var g = ctx.createLinearGradient(0, -R * 0.2, 0, -R * 0.86);
      g.addColorStop(0, '#5a6068');
      g.addColorStop(0.5, '#40454d');
      g.addColorStop(1, '#2c3036');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-R * 0.115, -R * 0.20);
      ctx.lineTo(-R * 0.075, -R * 0.80);
      ctx.lineTo(R * 0.075, -R * 0.80);
      ctx.lineTo(R * 0.115, -R * 0.20);
      ctx.closePath();
      ctx.fill();
      // machined highlight
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(-R * 0.115, -R * 0.80, R * 0.045, R * 0.60);
      ctx.restore();
    }

    // centre nut + hub
    ctx.fillStyle = '#0e1013';
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.22, 0, TAU); ctx.fill();
    ctx.fillStyle = '#787f88';
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.155, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1b1e22';
    for (var k = 0; k < 6; k++) {
      var ang = (k / 6) * TAU;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * R * 0.10, cy + Math.sin(ang) * R * 0.10, R * 0.028, 0, TAU);
      ctx.fill();
    }
    var t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    FACE_TEX[key] = t;
    return t;
  }

  /* a ring with polar UVs so a repeated sidewall texture wraps correctly */
  function polarRing(r0, r1, seg) {
    var pos = [], uv = [], idx = [];
    for (var i = 0; i <= seg; i++) {
      var a = (i / seg) * TAU;
      var cs = Math.cos(a), sn = Math.sin(a);
      pos.push(cs * r0, sn * r0, 0); uv.push(i / seg, 0);
      pos.push(cs * r1, sn * r1, 0); uv.push(i / seg, 1);
    }
    for (var j = 0; j < seg; j++) {
      var a0 = j * 2, b0 = a0 + 1, a1 = a0 + 2, b1 = a0 + 3;
      idx.push(a0, a1, b1, a0, b1, b0);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function discGeometry(r, seg) {
    if (WHEEL_GEO['d' + r]) return WHEEL_GEO['d' + r];
    var g = new THREE.CircleGeometry(r, seg || 32);
    WHEEL_GEO['d' + r] = g;
    return g;
  }

  function buildWheel(C, mat, front, side, lod) {
    var node = new THREE.Group();
    var isRight = side > 0;
    var halfTrack = front ? 0.795 : 0.745;
    node.position.set(halfTrack * side, 0.36, front ? -1.70 : 1.70);

    var spin = new THREE.Group();
    node.add(spin);

    var width = front ? 0.305 : 0.405;
    var outX = isRight ? 1 : -1;
    var R = 0.36;

    var tyre = new THREE.Mesh(tyreGeometry(R, width / 2), C.tyre);
    spin.add(tyre);

    if (lod > 0) {
      // sidewall lettering + compound band, both faces
      [1, -1].forEach(function (d) {
        var ring = new THREE.Mesh(polarRing(R * 0.74, R * 0.985, 44),
          new THREE.MeshStandardMaterial({
            map: sidewallTexture(mat.__compound || 'soft'), roughness: 0.9, metalness: 0.0,
            transparent: false
          }));
        ring.position.x = d * (width / 2 - 0.004);
        ring.rotation.y = d > 0 ? Math.PI / 2 : -Math.PI / 2;
        ring.userData.keep = true;
        if (lod > 1) spin.add(ring);
      });

      // rim barrel + wheel cover face (2026 cars run covers)
      var barrel = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.70, R * 0.70, width * 0.94, 28, 1, true), C.rim);
      barrel.rotation.z = Math.PI / 2;
      spin.add(barrel);

      /* the forged wheel face: one textured disc, mirrored onto both sides */
      var faceMat = new THREE.MeshStandardMaterial({
        map: wheelFaceTexture(mat.accentHex || '#c8cdd4'),
        roughness: 0.42, metalness: 0.62, envMapIntensity: 1.1
      });
      var cover = new THREE.Mesh(discGeometry(R * 0.735, 40), faceMat);
      cover.rotation.y = outX > 0 ? Math.PI / 2 : -Math.PI / 2;
      cover.position.x = outX * (width / 2 - 0.010);
      cover.userData.keep = true;
      spin.add(cover);

      /* the inner face stays dark so you never see through the wheel */
      var inner = new THREE.Mesh(discGeometry(R * 0.70, 24), C.darkMetal);
      inner.rotation.y = outX > 0 ? -Math.PI / 2 : Math.PI / 2;
      inner.position.x = -outX * (width / 2 - 0.02);
      spin.add(inner);

      // brake disc + caliper, inboard
      var disc = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.026, 26), C.brake);
      disc.rotation.z = Math.PI / 2;
      disc.position.x = -outX * width * 0.10;
      disc.userData.brakeDisc = true;
      spin.add(disc);
      node.userData.brakeDisc = disc;

      if (lod > 1) {
        var caliper = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.13, 0.10), C.caliper);
        caliper.position.set(-outX * width * 0.10, 0.06, -0.12);
        spin.add(caliper);
      }
    }

    return { node: node, spin: spin, axle: front ? 'front' : 'rear', side: isRight ? 'R' : 'L', front: front };
  }

  /* ================================================================== */
  /* 5. the body: one continuous loft, nose to engine cover             */
  /* ================================================================== */
  function hullStations() {
    /* The central body only: nose, cockpit tub, engine cover. It is narrow, so
       the sidepods read as separate volumes with a real shoulder step between
       them and the cover. */
    var raw = [
      [-2.62, 0.135, 0.142, 0.25, 0.272, 0.29, 0.07, 0.06, 0.298, 0.306, 0.230],
      [-2.45, 0.144, 0.152, 0.248, 0.272, 0.294, 0.078, 0.066, 0.308, 0.318, 0.222],
      [-2.22, 0.156, 0.164, 0.246, 0.272, 0.3, 0.088, 0.074, 0.322, 0.334, 0.208],
      [-1.98, 0.168, 0.178, 0.246, 0.276, 0.312, 0.098, 0.082, 0.344, 0.356, 0.192],
      [-1.75, 0.184, 0.196, 0.248, 0.282, 0.33, 0.11, 0.092, 0.372, 0.386, 0.176],
      [-1.52, 0.202, 0.214, 0.252, 0.29, 0.354, 0.124, 0.104, 0.41, 0.424, 0.160],
      [-1.28, 0.22, 0.232, 0.256, 0.3, 0.384, 0.14, 0.118, 0.452, 0.466, 0.144],
      [-1.05, 0.238, 0.25, 0.262, 0.316, 0.42, 0.156, 0.132, 0.5, 0.514, 0.128],
      [-0.82, 0.252, 0.264, 0.268, 0.336, 0.462, 0.172, 0.146, 0.548, 0.562, 0.112],
      [-0.6, 0.264, 0.274, 0.274, 0.358, 0.5, 0.184, 0.158, 0.586, 0.6, 0.100],
      [-0.38, 0.272, 0.282, 0.28, 0.374, 0.526, 0.192, 0.166, 0.612, 0.626, 0.094],
      [-0.15, 0.276, 0.284, 0.284, 0.384, 0.542, 0.196, 0.17, 0.626, 0.64, 0.092],
      [0.08, 0.276, 0.284, 0.286, 0.39, 0.552, 0.194, 0.17, 0.634, 0.648, 0.092],
      [0.32, 0.272, 0.28, 0.29, 0.398, 0.562, 0.19, 0.166, 0.648, 0.662, 0.096],
      [0.55, 0.264, 0.27, 0.296, 0.41, 0.58, 0.182, 0.158, 0.678, 0.692, 0.104],
      [0.78, 0.256, 0.262, 0.302, 0.426, 0.604, 0.172, 0.15, 0.714, 0.728, 0.116],
      [1, 0.244, 0.25, 0.31, 0.438, 0.622, 0.162, 0.142, 0.742, 0.756, 0.132],
      [1.22, 0.23, 0.236, 0.318, 0.436, 0.618, 0.152, 0.134, 0.744, 0.758, 0.150],
      [1.44, 0.214, 0.22, 0.326, 0.418, 0.586, 0.142, 0.124, 0.716, 0.73, 0.172],
      [1.66, 0.196, 0.202, 0.334, 0.398, 0.542, 0.13, 0.112, 0.662, 0.676, 0.196],
      [1.88, 0.176, 0.182, 0.342, 0.376, 0.486, 0.116, 0.098, 0.594, 0.608, 0.224],
      [2.06, 0.15, 0.156, 0.35, 0.36, 0.412, 0.1, 0.084, 0.508, 0.52, 0.256],
      [2.18, 0.135, 0.14, 0.356, 0.36, 0.38, 0.086, 0.072, 0.452, 0.462, 0.290]
    ];
    return raw.map(function (r) {
      return {
        z: r[0], floor: r[1], podOut: r[2], podLow: r[3], podMid: r[4], podTop: r[5],
        podIn: r[6], bodyHalf: r[7], bodyTop: r[8], crown: r[9], yb: r[10]
      };
    });
  }

  /* the sidepods: flat-topped boxes with a ramped upper surface, built as
     their own lofts and pushed out to the flanks. This is what gives the car
     its shoulder line, and the dark inlet mouth at the front of each one. */
  function podStations(side) {
    /* z, halfW, bottomY, topY, topHalf, xCentre
       The pods' outer skin is flush with the floor edge (0.72 m) — that is the
       shoulder you see in a plan view — and the undercut tucks back in below. */
    var raw = [
      [-0.94, 0.105, 0.210, 0.300, 0.074, 0.380],
      [-0.80, 0.205, 0.160, 0.372, 0.145, 0.455],
      [-0.60, 0.250, 0.130, 0.428, 0.180, 0.470],
      [-0.34, 0.268, 0.116, 0.462, 0.196, 0.474],
      [-0.02, 0.270, 0.110, 0.474, 0.198, 0.474],
      [0.30, 0.262, 0.114, 0.462, 0.190, 0.468],
      [0.62, 0.244, 0.124, 0.428, 0.174, 0.452],
      [0.90, 0.216, 0.138, 0.386, 0.150, 0.428],
      [1.14, 0.174, 0.154, 0.338, 0.116, 0.394],
      [1.34, 0.108, 0.176, 0.292, 0.070, 0.352]
    ];
    return raw.map(function (r) {
      return {
        z: r[0], x: r[5] * side, yb: 0.050,
        floor: r[1] * 1.03, podOut: r[1], podLow: r[2] + 0.13,
        podMid: (r[2] + r[3]) * 0.5, podTop: r[3],
        podIn: r[4] * 1.06, bodyHalf: r[4] * 0.86,
        bodyTop: r[3], crown: r[3] + 0.005
      };
    });
  }

  /* only the front half needs a finer split: the cockpit/deck is a separate
     loft so the sides stay hollow where the driver sits */
  function cockpitStations() { return []; }

  /* ================================================================== */
  /* 6. build the car                                                   */
  /* ================================================================== */
  function decal(tex, w, h, opts) {
    var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial(Object.assign({
        map: tex, transparent: true, alphaTest: 0.06, roughness: 0.4, metalness: 0.02,
        polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false, side: THREE.DoubleSide
      }, opts || {})));
    m.renderOrder = 3;
    m.userData.keep = true;           // decals are not merged (unique material)
    return m;
  }

  function buildDetailCar(team, driver, C, mat, lod) {
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

    /* ---------------- monocoque, sidepods and engine cover ----------------
       one continuous hull: the sidepod shoulder and the undercut come from the
       station table, and the split at 0.185 m makes the lower half carbon. */
    add(loftHull(hullStations(), 0.085), [C.carbon, mat.paint]);

    /* sidepods, one loft each, with the inlet mouth on the front face */
    [1, -1].forEach(function (sd) {
      /* carbon below the shoulder line, paint above it: the two-tone break is
         the fastest way for the eye to read the undercut */
      var podGeo = loftHull(podStations(sd), 0.205);
      var pod = new THREE.Mesh(podGeo, [C.carbon, mat.paint]);
      pod.castShadow = true;
      body.add(pod);

      // inlet: a dark rounded mouth set into the pod's leading edge
      var inlet = add(new THREE.CircleGeometry(0.105, 20), C.intake, 0.405 * sd, 0.258, -0.860, 0, sd * 0.30, 0);
      inlet.scale.set(1.12, 1.45, 1);
      inlet.userData.keep = true;
      // the pod's leading-edge lip
      add(new THREE.BoxGeometry(0.042, 0.036, 0.12), mat.dark, 0.405 * sd, 0.352, -0.885);

      /* sponsor strip painted on the pod's top shoulder */
      var podTex = panel(team, {
        key: 'pod', w: 1024, h: 192, pattern: 'edge',
        words: [{ text: team.short, weight: 900 }]
      });
      var podDecal = decal(podTex, 0.62, 0.155, { opacity: 1 });
      podDecal.position.set((0.474 + 0.02) * sd, 0.478, 0.06);
      podDecal.rotation.x = -Math.PI / 2;
      podDecal.rotation.z = sd > 0 ? Math.PI / 2 : -Math.PI / 2;
      body.add(podDecal);

      // turning vanes under the pod
      for (var v = 0; v < 2; v++) {
        add(plate([[-0.60, 0.065 + v * 0.05], [-0.34, 0.085 + v * 0.05],
          [-0.34, 0.105 + v * 0.05], [-0.60, 0.085 + v * 0.05]], 0.012),
          C.carbonLight, (0.20 + v * 0.07) * sd, 0, 0);
      }
    });

    /* shark fin along the engine cover spine */
    add(plate([[0.55, 0.760], [1.35, 0.700], [1.35, 0.672], [0.55, 0.726]], 0.014), mat.accent, 0, 0, 0);

    /* ---------------- floor, fences, diffuser ---------------- */
    add(slab([
      { z: -1.60, halfW: 0.26, y: 0.104 },
      { z: -1.34, halfW: 0.40, y: 0.088 },
      { z: -1.06, halfW: 0.52, y: 0.072 },
      { z: -0.72, halfW: 0.60, y: 0.058 },
      { z: -0.30, halfW: 0.66, y: 0.050 },
      { z: 0.20, halfW: 0.695, y: 0.048 },
      { z: 0.70, halfW: 0.690, y: 0.050 },
      { z: 1.12, halfW: 0.640, y: 0.056 },
      { z: 1.46, halfW: 0.545, y: 0.070 }
    ], 0.018), C.carbon);

    // floor edge fences
    [1, -1].forEach(function (s) {
      for (var i = 0; i < 3; i++) {
        var f = add(new THREE.BoxGeometry(0.010, 0.075, 0.30), C.carbonLight,
          (0.38 + i * 0.09) * s, 0.070, -0.90 + i * 0.06);
        f.rotation.y = s * 0.10;
      }
      // floor edge wing
      add(plate([[-0.95, 0.048], [1.00, 0.054], [1.00, 0.092], [-0.95, 0.084]], 0.012), C.carbonLight, 0.700 * s, 0, 0);
    });

    // diffuser ramp + strakes
    add(slab([
      { z: 1.58, halfW: 0.66, y: 0.066 },
      { z: 1.76, halfW: 0.62, y: 0.100 },
      { z: 1.92, halfW: 0.56, y: 0.148 },
      { z: 2.02, halfW: 0.50, y: 0.196 }
    ], 0.016), C.carbon);
    [-0.45, -0.15, 0.15, 0.45].forEach(function (x) {
      var st = add(new THREE.BoxGeometry(0.010, 0.10, 0.42), C.carbonLight, x, 0.11, 1.82);
      st.rotation.x = 0.30;
    });

    /* ---------------- front wing ---------------- */
    var fwZ = -2.50;
    add(wingElement({ span: 1.96, chord: 0.32, thick: 0.020, camber: 0.09, taper: 0.90 }), C.carbon, 0, 0.060, fwZ + 0.10);
    add(wingElement({ span: 1.94, chord: 0.24, thick: 0.017, camber: 0.13, taper: 0.88, sweep: 0.02 }), mat.paint, 0, 0.098, fwZ + 0.11);
    add(wingElement({ span: 1.90, chord: 0.20, thick: 0.015, camber: 0.16, taper: 0.86, sweep: 0.03 }), mat.accent, 0, 0.136, fwZ + 0.12);
    add(wingElement({ span: 1.84, chord: 0.16, thick: 0.013, camber: 0.18, taper: 0.84, sweep: 0.04 }), C.carbonLight, 0, 0.170, fwZ + 0.13);
    /* the neutral centre section under the nose, mandated by the regs */
    add(wingElement({ span: 0.50, chord: 0.40, thick: 0.022, camber: 0.02 }), C.carbon, 0, 0.056, fwZ + 0.10);

    [1, -1].forEach(function (s) {
      // endplate: tall blade along the wing's outer edge
      add(plate([[-0.18, 0.018], [0.22, 0.042], [0.22, 0.215], [0.06, 0.238], [-0.18, 0.142]], 0.014),
        mat.paint, 0.960 * s, 0, fwZ + 0.10);
      // footplate flare, just above the track
      add(plate([[-0.18, 0.008], [0.26, 0.010], [0.26, 0.026], [-0.18, 0.024]], 0.075), C.carbon, 0.984 * s, 0, fwZ + 0.10);
      // dive plane above the wing
      add(plate([[-0.10, 0.170], [0.15, 0.200], [0.15, 0.228], [-0.10, 0.200]], 0.010), C.carbonLight, 0.912 * s, 0, fwZ + 0.10);
      // nose pillars down to the mainplane
      add(new THREE.BoxGeometry(0.018, 0.090, 0.26), C.carbon, 0.082 * s, 0.135, fwZ + 0.12);
    });

    /* ---------------- diffuser + rear crash structure ---------------- */
    add(slab([
      { z: 1.52, halfW: 0.42, y: 0.088 },
      { z: 1.76, halfW: 0.40, y: 0.115 },
      { z: 1.96, halfW: 0.36, y: 0.165 },
      { z: 2.10, halfW: 0.30, y: 0.225 }
    ], 0.012), C.carbon);
    [-1, 1].forEach(function (sd) {
      for (var i = 0; i < 3; i++) {
        add(plate([[1.55, 0.070 + i * 0.012], [2.08, 0.150 + i * 0.024],
          [2.08, 0.168 + i * 0.024], [1.55, 0.090 + i * 0.012]], 0.010),
          C.carbonLight, (0.10 + i * 0.13) * sd, 0, 0);
      }
    });
    /* the rear crash structure the wing is bolted to */
    add(new THREE.BoxGeometry(0.30, 0.18, 0.36), C.carbon, 0, 0.330, 2.06);
    add(new THREE.BoxGeometry(0.20, 0.12, 0.10), C.darkMetal, 0, 0.380, 2.20);

    /* ---------------- rear wing ---------------- */
    add(wingElement({ span: 1.05, chord: 0.38, thick: 0.021, camber: 0.10, taper: 0.97 }), mat.paint, 0, 0.868, 2.34);
    var flap = add(wingElement({ span: 1.02, chord: 0.25, thick: 0.017, camber: 0.20, taper: 0.96 }), mat.accent, 0, 0.972, 2.42);
    flap.userData.keep = true;
    add(wingElement({ span: 0.88, chord: 0.19, thick: 0.014, camber: 0.16 }), C.carbonLight, 0, 0.566, 2.30);
    [-1, 1].forEach(function (s) {
      add(plate([[2.14, 0.540], [2.22, 0.510], [2.34, 0.510], [2.42, 0.565],
        [2.46, 0.875], [2.56, 0.982], [2.58, 1.018], [2.45, 1.010], [2.32, 0.930], [2.14, 0.720]], 0.014),
        mat.dark, 0.532 * s, 0, 0);
      // endplate top strake + gurney flap
      add(new THREE.BoxGeometry(0.010, 0.030, 0.36), mat.accent, 0.538 * s, 1.008, 2.44);
      add(new THREE.BoxGeometry(0.008, 0.014, 0.32), C.carbonLight, 0.538 * s, 0.982, 2.46);
    });
    // DRS actuator pod + pylon
    add(new THREE.BoxGeometry(0.075, 0.060, 0.10), C.carbon, 0, 0.958, 2.36);
    add(new THREE.BoxGeometry(0.030, 0.340, 0.10), C.carbon, 0, 0.730, 2.330);
    [-1, 1].forEach(function (s) {
      add(new THREE.BoxGeometry(0.016, 0.350, 0.055), C.carbon, 0.135 * s, 0.730, 2.320);
    });

    /* ---------------- halo ---------------- */
    (function halo() {
      var R = 0.300, tube = 0.022;
      var geo = new THREE.TorusGeometry(R, tube, 10, 48, Math.PI * 1.18);
      geo.rotateZ(-Math.PI * 0.59);
      geo.rotateX(-Math.PI / 2);
      geo.scale(1.0, 1.0, 1.28);
      var haloMesh = add(geo, mat.dark, 0, 0.832, 0.10);
      haloMesh.rotation.y = 0;
      // front pillar
      add(new THREE.CylinderGeometry(0.020, 0.030, 0.245, 8), mat.dark, 0, 0.740, -0.285, 0.24);
      // rear mounts
      [-1, 1].forEach(function (s) {
        add(new THREE.CylinderGeometry(0.018, 0.018, 0.10, 6), mat.dark, 0.215 * s, 0.760, 0.44, 0, 0, s * 0.5);
      });
    })();

    /* ---------------- cockpit: opening, padding, wheel, driver ---------------- */
    /* cockpit tray: a dark recess sitting in the hull */
    add(loftHull([
      { z: -0.56, yb: 0.400, floor: 0.120, podOut: 0.120, podLow: 0.560, podMid: 0.596, podTop: 0.618,
        podIn: 0.072, bodyHalf: 0.086, bodyTop: 0.630, crown: 0.636 },
      { z: -0.20, yb: 0.400, floor: 0.140, podOut: 0.140, podLow: 0.560, podMid: 0.598, podTop: 0.624,
        podIn: 0.084, bodyHalf: 0.100, bodyTop: 0.638, crown: 0.644 },
      { z: 0.16, yb: 0.400, floor: 0.142, podOut: 0.142, podLow: 0.560, podMid: 0.598, podTop: 0.626,
        podIn: 0.086, bodyHalf: 0.102, bodyTop: 0.640, crown: 0.646 },
      { z: 0.46, yb: 0.400, floor: 0.120, podOut: 0.120, podLow: 0.560, podMid: 0.594, podTop: 0.620,
        podIn: 0.074, bodyHalf: 0.088, bodyTop: 0.634, crown: 0.640 }
    ]), C.intake);

    /* headrest padding behind and beside the helmet */
    add(loftHull([
      { z: 0.02, yb: 0.440, floor: 0.150, podOut: 0.150, podLow: 0.620, podMid: 0.700, podTop: 0.762,
        podIn: 0.100, bodyHalf: 0.120, bodyTop: 0.776, crown: 0.784 },
      { z: 0.32, yb: 0.440, floor: 0.152, podOut: 0.152, podLow: 0.630, podMid: 0.716, podTop: 0.800,
        podIn: 0.102, bodyHalf: 0.124, bodyTop: 0.816, crown: 0.824 },
      { z: 0.56, yb: 0.440, floor: 0.134, podOut: 0.134, podLow: 0.630, podMid: 0.712, podTop: 0.792,
        podIn: 0.090, bodyHalf: 0.110, bodyTop: 0.808, crown: 0.816 }
    ]), mat.dark);

    // steering wheel
    add(new THREE.TorusGeometry(0.085, 0.020, 6, 16), C.carbon, 0, 0.672, -0.315, -1.28);
    add(new THREE.BoxGeometry(0.140, 0.055, 0.035), C.carbonLight, 0, 0.660, -0.330, -1.28);

    if (driver && lod > 1) {
      add(new THREE.SphereGeometry(0.105, 20, 14), mat.dark, 0, 0.700, 0.175);   // shoulders
      var helmetMesh = add(new THREE.SphereGeometry(0.132, 28, 20), new THREE.MeshPhysicalMaterial({
        map: helmetTexture(driver.helmet, driver.number), roughness: 0.16, metalness: 0.25,
        clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.2
      }), 0, 0.812, 0.02);
      helmetMesh.rotation.y = Math.PI;
      helmetMesh.scale.set(0.97, 1.03, 1.06);
      helmetMesh.userData.keep = true;
      var visor = add(new THREE.SphereGeometry(0.134, 22, 12,
        Math.PI * 0.54, Math.PI * 0.44, Math.PI * 0.35, Math.PI * 0.26), C.visor, 0, 0.812, 0.02);
      visor.rotation.y = Math.PI;
      visor.scale.set(0.975, 1.04, 1.07);
      visor.userData.keep = true;
    } else if (lod > 1) {
      add(new THREE.SphereGeometry(0.130, 16, 12), mat.dark, 0, 0.812, 0.02);
    }

    /* ---------------- airbox / roll hoop ---------------- */
    add(loftHull([
      { z: 0.10, yb: 0.760, floor: 0.052, podOut: 0.052, podLow: 0.850, podMid: 0.906, podTop: 0.938,
        podIn: 0.038, bodyHalf: 0.046, bodyTop: 0.954, crown: 0.960 },
      { z: 0.36, yb: 0.760, floor: 0.066, podOut: 0.066, podLow: 0.866, podMid: 0.930, podTop: 0.964,
        podIn: 0.048, bodyHalf: 0.060, bodyTop: 0.982, crown: 0.988 },
      { z: 0.62, yb: 0.760, floor: 0.058, podOut: 0.058, podLow: 0.846, podMid: 0.902, podTop: 0.936,
        podIn: 0.042, bodyHalf: 0.052, bodyTop: 0.954, crown: 0.960 },
      { z: 0.86, yb: 0.760, floor: 0.036, podOut: 0.036, podLow: 0.806, podMid: 0.852, podTop: 0.880,
        podIn: 0.026, bodyHalf: 0.034, bodyTop: 0.896, crown: 0.900 }
    ]), mat.dark);
    add(new THREE.CircleGeometry(0.048, 16), C.intake, 0, 0.900, 0.095, -1.28);

    if (lod > 1) {
      /* ---------------- suspension ---------------- */
      [1, -1].forEach(function (s) {
        [[-1.70, true], [1.70, false]].forEach(function (ax) {
          var zA = ax[0], front = ax[1];
          var innerX = 0.13 * s, outerX = 0.70 * s;
          var yTop = front ? 0.50 : 0.52, yBot = front ? 0.20 : 0.22;
          var p = function (x, y, z) { return new THREE.Vector3(x, y, z); };
          // upper + lower wishbones (flat aero fairings)
          body.add(rodMesh(p(innerX, yTop, zA - 0.21), p(outerX, yTop - 0.06, zA), 0.014, C.carbon, 5));
          body.add(rodMesh(p(innerX, yTop, zA + 0.19), p(outerX, yTop - 0.06, zA), 0.014, C.carbon, 5));
          body.add(rodMesh(p(innerX, yBot, zA - 0.19), p(outerX, yBot + 0.05, zA), 0.017, C.carbon, 5));
          body.add(rodMesh(p(innerX, yBot, zA + 0.17), p(outerX, yBot + 0.05, zA), 0.017, C.carbon, 5));
          // pushrod + track rod
          body.add(rodMesh(p(outerX * 0.96, yBot + 0.05, zA), p(0.16 * s, yTop + 0.10, zA + 0.26), 0.012, C.metal, 5));
          body.add(rodMesh(p(outerX * 0.96, yTop - 0.10, zA), p(0.15 * s, yTop - 0.02, zA + 0.30), 0.012, C.carbonLight, 5));
        });
      });

      /* ---------------- mirrors, t-cam, rain light, exhaust ---------------- */
      [-1, 1].forEach(function (s) {
        add(new THREE.BoxGeometry(0.115, 0.042, 0.030), mat.dark, 0.560 * s, 0.680, -0.560, 0, s * -0.12, 0);
        add(new THREE.BoxGeometry(0.014, 0.014, 0.10), C.carbon, 0.500 * s, 0.655, -0.545, 0, 0, s * 0.55);
        add(new THREE.BoxGeometry(0.008, 0.055, 0.075), C.carbonLight, 0.540 * s, 0.700, -0.520);
      });
      add(new THREE.BoxGeometry(0.052, 0.030, 0.080), C.carbon, 0, 0.972, 0.150);
      add(new THREE.CylinderGeometry(0.005, 0.005, 0.15, 5), C.darkMetal, 0, 1.010, 0.30);
      add(new THREE.CylinderGeometry(0.042, 0.048, 0.08, 12), C.metal, 0, 0.400, 2.130, Math.PI / 2);
      add(new THREE.BoxGeometry(0.050, 0.040, 0.016), C.rainLight, 0, 0.365, 2.170);

      /* ---------------- brake ducts ---------------- */
      [-1, 1].forEach(function (s) {
        add(new THREE.BoxGeometry(0.050, 0.19, 0.28), C.carbon, 0.640 * s, 0.300, -1.70);
        add(new THREE.BoxGeometry(0.050, 0.19, 0.30), C.carbon, 0.630 * s, 0.300, 1.70);
        // duct mouth facing the wheel
        add(new THREE.CircleGeometry(0.075, 12), C.intake, 0.600 * s, 0.320, -1.70, 0, s * Math.PI / 2, 0);
      });
    }

    /* ---------------- livery decals ---------------- */
    var title = F1.DATA.titleSponsor(team.id);
    var num = driver ? String(driver.number) : '';
    var surname = driver ? driver.lastName.toUpperCase() : team.short.toUpperCase();

    var sideTex = panel(team, {
      key: 'side', w: 1024, h: 256, pattern: team.id === 'mclaren' ? 'slash' : 'swoosh',
      words: [title].concat(F1.DATA.sponsorsOf(team.id)
        .filter(function (s) { return s.tier !== 'partner'; })
        .map(function (s) { return s.name; }).slice(0, 2))
    });
    [-1, 1].forEach(function (s) {
      var d = decal(sideTex, 0.62, 0.15);
      d.position.set(0.545 * s, 0.335, 0.30);
      d.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
      body.add(d);
    });

    var coverTex = panel(team, {
      key: 'cover', w: 512, h: 512, pattern: 'edge',
      words: [{ text: num, weight: 900 }, { text: title, weight: 800 }]
    });
    var cover = decal(coverTex, 0.20, 0.46);
    cover.position.set(0, 0.800, 1.06);
    cover.rotation.x = -Math.PI / 2 + 0.235;
    cover.rotation.z = Math.PI;
    body.add(cover);

    var cpTex = panel(team, {
      key: 'cockpit', w: 512, h: 128, pattern: null,
      words: [{ text: surname, weight: 800 }]
    });
    [-1, 1].forEach(function (s) {
      var d = decal(cpTex, 0.26, 0.058);
      d.position.set(0.212 * s, 0.520, -0.12);
      d.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
      body.add(d);
    });

    var noseTex = panel(team, {
      key: 'nose', w: 256, h: 512, pattern: null,
      words: [{ text: num || team.code, weight: 900 }]
    });
    /* the nose cone carries the biggest wordmark on the car, as it does on a
       real one, laid along the upward slope of the nose */
    var nose = decal(noseTex, 0.150, 0.34);
    nose.position.set(0, 0.300, -1.60);
    nose.rotation.x = -Math.PI / 2 + 0.28;
    nose.rotation.z = 0;
    body.add(nose);

    var wingTex = panel(team, {
      key: 'wing', w: 1024, h: 256, pattern: 'edge',
      words: [{ text: title.toUpperCase(), weight: 900 }, { text: surname + '  ' + num, weight: 700 }]
    });
    [-1, 1].forEach(function (s) {
      var d = decal(wingTex, 0.92, 0.170);
      d.position.set(0, 0.898, 2.38 + 0.172 * s);
      d.rotation.y = s > 0 ? 0 : Math.PI;
      body.add(d);
    });

    var epTex = panel(team, {
      key: 'rwep', w: 256, h: 256, pattern: null,
      words: [{ text: num || team.code, weight: 900 }]
    });
    [-1, 1].forEach(function (s) {
      var d = decal(epTex, 0.20, 0.20);
      d.position.set(0.524 * s, 0.895, 2.41);
      d.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
      body.add(d);
    });

    var fwTex = panel(team, {
      key: 'fwep', w: 512, h: 128, pattern: null,
      words: [{ text: team.code, weight: 900 }]
    });
    [-1, 1].forEach(function (s) {
      var d = decal(fwTex, 0.24, 0.055);
      d.position.set(0.968 * s, 0.132, fwZ + 0.16);
      d.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
      body.add(d);
    });

    var haloTex = panel(team, { key: 'halo', w: 512, h: 128, pattern: null, words: [{ text: title, weight: 700 }] });
    var haloDecal = decal(haloTex, 0.22, 0.056);
    haloDecal.position.set(0, 0.862, -0.05);
    haloDecal.rotation.x = -Math.PI / 2 + 0.16;
    body.add(haloDecal);

    /* ---------------- wheels ---------------- */
    var wheels = [];
    [1, -1].forEach(function (s) { wheels.push(buildWheel(C, mat, true, s, lod)); });
    [1, -1].forEach(function (s) { wheels.push(buildWheel(C, mat, false, s, lod)); });
    wheels.forEach(function (w) { root.add(w.node); });

    /* ---------------- merge static bodywork ---------------- */
    mergeStatic(body);

    body.traverse(function (o) {
      if (!o.isMesh) return;
      var isDecal = o.material && o.material.transparent;
      o.castShadow = !isDecal;
      o.receiveShadow = false;
    });

    var baseFlapRot = flap.rotation.x;
    root.userData = {
      team: team, driver: driver, lod: lod,
      wheels: wheels,
      body: body,
      flap: flap,
      setBrakeGlow: function (v) { C.brake.emissiveIntensity = v; },
      setAeroMode: function (mode) {
        flap.rotation.x = baseFlapRot + (mode === 'X' ? -0.52 : 0);
      }
    };
    return root;
  }

  /* ================================================================== */
  /* 7. low-detail car (LOD 0)                                          */
  /* ================================================================== */
  function buildLowCar(team, C, mat) {
    var grp = new THREE.Group();
    function add(geo, m, x, y, z) {
      var mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x || 0, y || 0, z || 0);
      grp.add(mesh);
      return mesh;
    }
    add(loftHull(hullStations().filter(function (s2, i) { return i % 2 === 0; })), mat.paint);
    add(new THREE.BoxGeometry(0.34, 0.30, 1.3), mat.dark, 0.42, 0.33, 0.35);
    add(new THREE.BoxGeometry(0.34, 0.30, 1.3), mat.dark, -0.42, 0.33, 0.35);
    add(new THREE.BoxGeometry(1.9, 0.05, 0.36), C.carbon, 0, 0.13, -2.40);
    add(new THREE.BoxGeometry(1.02, 0.05, 0.36), mat.dark, 0, 0.90, 2.28);
    add(new THREE.BoxGeometry(0.02, 0.32, 0.44), mat.dark, 0.51, 0.90, 2.29);
    add(new THREE.BoxGeometry(0.02, 0.32, 0.44), mat.dark, -0.51, 0.90, 2.29);
    add(new THREE.BoxGeometry(1.5, 0.03, 1.1), C.carbon, 0, 0.06, 0.4);
    add(new THREE.SphereGeometry(0.13, 8, 6), mat.dark, 0, 0.84, 0.05);

    var wheels = [];
    [[1, true], [-1, true], [1, false], [-1, false]].forEach(function (w) {
      var node = new THREE.Group();
      node.position.set((w[1] ? 0.72 : 0.70) * w[0], 0.36, w[1] ? -1.70 : 1.70);
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
  /* 8. public builder                                                  */
  /* ================================================================== */
  F1.buildCar = function (opts) {
    opts = opts || {};
    var team = F1.DATA.getTeam(opts.teamId);
    var driver = opts.driverId ? F1.DATA.getDriver(opts.driverId) : null;
    var lod = opts.lod === undefined ? 2 : opts.lod;
    var C = common();
    var mat = teamMat(team);
    // the sidewall band follows the tyre the car is actually on when known
    mat.__compound = opts.compound || mat.__compound || 'soft';

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
    return buildDetailCar(team, driver, C, mat, lod);
  };

  F1.carModel = {
    helmetTexture: helmetTexture,
    panelTexture: panel,
    sidewallTexture: sidewallTexture,
    disposeTextureCache: function () {
      Object.keys(TEX).forEach(function (k) {
        try { TEX[k].dispose(); } catch (e) {}
        delete TEX[k];
      });
    }
  };
  void TAU;
})(window.F1 = window.F1 || {});
