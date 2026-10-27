/* ==========================================================================
   F1 2026 — world/vegetation.js
   Trees, hedges, grass and the far treeline. One instanced mesh per species,
   so a 2400-tree avenue costs a handful of draw calls instead of 2400.

     F1.vegetation.build(model, meta, opts) -> { group, update(dt), stats }

   Species are chosen by the circuit's `theme.trees` and by an optional
   `meta.flora` list (Monza: plane trees + poplars). Each species is a
   different silhouette, not a recoloured cone:
      poplar  — tall narrow ellipsoid, the Monza/Parc avenue tree
      plane   — broad multi-lobed crown on a pale trunk
      pine    — umbrella pine (Italian stone pine)
      cypress — dark narrow column (Tuscany/Monza park edges)
      palm    — for the desert/harbour rounds
      oak     — heavy round crown for northern forests
   ========================================================================== */
(function (F1) {
  'use strict';

  var TAU = Math.PI * 2;

  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function cv(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function tex(canvas, opts) {
    opts = opts || {};
    var t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = opts.aniso || 8;
    t.needsUpdate = true;
    return t;
  }

  /* ---------------- foliage canopy texture (alpha cut-out) ------------- */
  /* A single leaf cluster drawn as a noisy blob; used as a billboard shell
     around the trunk so the crown has ragged edges instead of a smooth ball. */
  function canopyTexture(seed, tint) {
    var S = 256;
    var c = cv(S, S), x = c.getContext('2d');
    var rnd = F1.rng(seed);
    x.clearRect(0, 0, S, S);
    for (var i = 0; i < 700; i++) {
      var a = rnd() * TAU;
      var r = Math.pow(rnd(), 0.55) * S * 0.46;
      var px = S / 2 + Math.cos(a) * r;
      var py = S / 2 + Math.sin(a) * r;
      var rad = 3 + rnd() * 11;
      var g = 40 + rnd() * 70;
      x.fillStyle = 'rgba(' + Math.round(tint[0] * g / 110) + ',' + Math.round(tint[1] * g / 110) + ',' + Math.round(tint[2] * g / 110) + ',' + (0.35 + rnd() * 0.5) + ')';
      x.beginPath(); x.arc(px, py, rad, 0, TAU); x.fill();
    }
    return tex(c, {});
  }

  /* ---------------- grass tuft texture --------------------------------- */
  function tuftTexture() {
    var S = 128;
    var c = cv(S, S), x = c.getContext('2d');
    var rnd = F1.rng(91);
    x.clearRect(0, 0, S, S);
    for (var i = 0; i < 90; i++) {
      var bx = S * 0.5 + (rnd() - 0.5) * 30;
      var tipX = bx + (rnd() - 0.5) * 90;
      var g = 90 + rnd() * 90;
      x.strokeStyle = 'rgba(' + Math.round(g * 0.55) + ',' + Math.round(g) + ',' + Math.round(g * 0.42) + ',' + (0.5 + rnd() * 0.5) + ')';
      x.lineWidth = 1 + rnd() * 1.6;
      x.beginPath();
      x.moveTo(bx, S);
      x.quadraticCurveTo(bx + (tipX - bx) * 0.3, S * 0.5, tipX, S * (0.1 + rnd() * 0.5));
      x.stroke();
    }
    return tex(c, {});
  }

  /* ---------------- species geometry ---------------------------------- */
  function speciesGeo(kind) {
    var parts = [];   /* {geo, x, y, z, ry, scale} */
    function push(geo, x, y, z, sx, sy, sz) {
      parts.push({ geo: geo, x: x, y: y, z: z, sx: sx || 1, sy: sy || 1, sz: sz || 1 });
    }
    if (kind === 'poplar') {
      /* column crown: three stacked ellipsoids */
      push(new THREE.CylinderGeometry(0.20, 0.40, 5.4, 6), 0, 2.7, 0, 1, 1, 1);
      push(new THREE.SphereGeometry(1.85, 9, 8), 0, 6.6, 0, 1.0, 2.2, 1.0);
      push(new THREE.SphereGeometry(1.45, 9, 8), 0, 10.4, 0, 0.95, 2.1, 0.95);
      push(new THREE.SphereGeometry(1.05, 8, 7), 0, 13.6, 0, 0.85, 1.7, 0.85);
      push(new THREE.SphereGeometry(0.66, 7, 6), 0, 15.6, 0, 0.9, 1.1, 0.9);
    } else if (kind === 'plane') {
      push(new THREE.CylinderGeometry(0.30, 0.52, 4.2, 7), 0, 2.1, 0, 1, 1, 1);
      push(new THREE.SphereGeometry(3.0, 10, 9), 0, 6.0, 0, 1.25, 0.85, 1.25);
      push(new THREE.SphereGeometry(2.1, 8, 7), 1.9, 5.0, 0.6, 1, 0.95, 1);
      push(new THREE.SphereGeometry(2.0, 8, 7), -1.7, 5.2, -0.8, 1, 0.95, 1);
      push(new THREE.SphereGeometry(1.7, 8, 7), 0.2, 7.4, 1.5, 1, 0.9, 1);
    } else if (kind === 'pine') {
      push(new THREE.CylinderGeometry(0.26, 0.46, 8.2, 7), 0, 4.1, 0, 1, 1, 1);
      push(new THREE.SphereGeometry(3.6, 10, 7), 0, 9.0, 0, 1.3, 0.52, 1.3);
      push(new THREE.SphereGeometry(2.4, 9, 6), 1.7, 8.5, -0.6, 1, 0.55, 1);
    } else if (kind === 'cypress') {
      push(new THREE.CylinderGeometry(0.14, 0.22, 3.0, 6), 0, 1.5, 0, 1, 1, 1);
      push(new THREE.SphereGeometry(1.0, 8, 8), 0, 6.4, 0, 0.7, 4.2, 0.7);
    } else if (kind === 'palm') {
      push(new THREE.CylinderGeometry(0.18, 0.34, 8.4, 6), 0, 4.2, 0, 1, 1, 1);
      for (var p = 0; p < 6; p++) {
        var a = (p / 6) * TAU;
        parts.push({
          geo: new THREE.ConeGeometry(0.9, 3.4, 4),
          x: Math.cos(a) * 1.3, y: 9.1, z: Math.sin(a) * 1.3,
          rx: 0.9, ry: -a, sx: 1, sy: 1, sz: 1
        });
      }
    } else {
      /* oak */
      push(new THREE.CylinderGeometry(0.32, 0.54, 3.0, 7), 0, 1.5, 0, 1, 1, 1);
      push(new THREE.SphereGeometry(3.1, 9, 8), 0, 5.6, 0, 1.15, 1.05, 1.15);
      push(new THREE.SphereGeometry(2.2, 8, 7), 1.8, 5.2, 1.1, 1, 0.9, 1);
      push(new THREE.SphereGeometry(2.0, 8, 7), -1.9, 5.4, -0.9, 1, 0.9, 1);
    }
    return parts;
  }

  function mergeParts(parts) {
    var pos = [], nor = [], uv = [];
    var m4 = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3();
    var e = new THREE.Euler();
    var q = new THREE.Quaternion();
    parts.forEach(function (p) {
      var g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
      e.set(p.rx || 0, p.ry || 0, 0);
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.sx, p.sy, p.sz));
      nm.getNormalMatrix(m4);
      var pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv;
      for (var i = 0; i < pa.count; i++) {
        v.set(pa.getX(i), pa.getY(i), pa.getZ(i)).applyMatrix4(m4);
        pos.push(v.x, v.y, v.z);
        if (na) { v.set(na.getX(i), na.getY(i), na.getZ(i)).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z); }
        else nor.push(0, 1, 0);
        uv.push(ua ? ua.getX(i) : 0, ua ? ua.getY(i) : 0);
      }
    });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeBoundingSphere();
    return geo;
  }

  var SPECIES = {
    poplar: { trunk: 0x6d6558, leaf: 0x33602b, height: 16 },
    plane: { trunk: 0x817a6c, leaf: 0x437038, height: 9 },
    pine: { trunk: 0x6d5a44, leaf: 0x2f5533, height: 12 },
    cypress: { trunk: 0x5a4c3c, leaf: 0x2a4a2c, height: 11 },
    palm: { trunk: 0x9a8663, leaf: 0x3f7a35, height: 11 },
    oak: { trunk: 0x5b4a36, leaf: 0x375f2c, height: 9 }
  };

  function speciesFor(meta, rnd) {
    var flora = meta.flora;
    if (flora && flora.length) return flora[Math.floor(rnd() * flora.length)];
    var t = (meta.theme && meta.theme.trees) || 'mixed';
    if (t === 'palm') return 'palm';
    if (t === 'pine') return rnd() < 0.7 ? 'pine' : 'cypress';
    if (t === 'mixed') {
      var r = rnd();
      return r < 0.5 ? 'plane' : r < 0.8 ? 'poplar' : 'oak';
    }
    if (t === 'sparse') return rnd() < 0.5 ? 'oak' : 'pine';
    return 'oak';
  }

  F1.vegetation = {};

  F1.vegetation.build = function (model, meta, opts) {
    opts = opts || {};
    var q = opts.quality || (F1.settings ? F1.settings.preset() : {});
    var aniso = q.anisotropy || 8;
    var grassDensity = q.grassDensity !== undefined ? q.grassDensity : 0.65;
    var rnd = F1.rng(hashStr(meta.id + '|flora'));
    var group = new THREE.Group();
    group.name = 'vegetation';
    /* one circuit is loaded at a time: drop the previous circuit's leaf
       materials so update() never drives shaders that are out of the scene */
    F1.vegetation._leafMats = [];
    var stats = { trees: 0, tufts: 0, meshes: 0 };
    var O = model.origin;
    var theme = meta.theme || {};

    function at(s) {
      var p = model.at(s, {});
      p.x -= O.x; p.z -= O.z;
      return p;
    }

    /* ---------------- where trees may stand ----------------------------- */
    /* distance from the centreline: walk every sample once and keep a coarse
       occupancy grid so trees never sit on the track, the pit lane or a
       grandstand. 8 m cells are plenty at these distances. */
    var CELL = 8;
    var span = Math.max(model.bounds.maxX - model.bounds.minX,
                        model.bounds.maxZ - model.bounds.minZ) * 0.5 + 320;
    var half = Math.ceil(span / CELL);
    var W = half * 2;
    var blocked = new Uint8Array(W * W);
    function cellOf(x, z) {
      var cx = Math.floor((x + half * CELL) / CELL);
      var cz = Math.floor((z + half * CELL) / CELL);
      if (cx < 0 || cz < 0 || cx >= W || cz >= W) return -1;
      return cz * W + cx;
    }
    for (var i = 0; i < model.count; i += 2) {
      var x = model.x[i] - O.x, z = model.z[i] - O.z;
      /* block the track + run-off + the pit lane side */
      for (var dx = -12; dx <= 12; dx += CELL) {
        for (var dz = -12; dz <= 12; dz += CELL) {
          var c = cellOf(x + dx, z + dz);
          if (c >= 0) blocked[c] = 1;
        }
      }
    }

    function freeAt(x, z) {
      var c = cellOf(x, z);
      return c >= 0 && !blocked[c];
    }

    /* ---------------- species batches ---------------------------------- */
    var batches = {};
    function batchFor(kind) {
      if (!batches[kind]) {
        batches[kind] = { trunk: [], leaf: [], canopy: [] };
      }
      return batches[kind];
    }

    var treeTarget = meta.id === 'italy' ? 1900 : (theme.style === 'street' ? 320 : 1500);
    treeTarget = Math.round(treeTarget * (q.qualityRank >= 2 ? 1 : q.qualityRank === 1 ? 0.7 : 0.45));

    var placed = 0;
    var tries = 0;
    var m4 = new THREE.Matrix4();
    var q4 = new THREE.Quaternion();
    var e3 = new THREE.Euler();

    while (placed < treeTarget && tries < treeTarget * 6) {
      tries++;
      var p = at(rnd() * model.length);
      var side = rnd() < 0.5 ? -1 : 1;
      var off = model.width[0] * 0.5 + 26 + Math.pow(rnd(), 1.5) * 320;
      var tx = p.x + Math.cos(p.heading) * side * off + (rnd() - 0.5) * 6;
      var tz = p.z - Math.sin(p.heading) * side * off + (rnd() - 0.5) * 6;
      if (!freeAt(tx, tz)) continue;
      var kind = speciesFor(meta, rnd);
      var sc = 0.75 + rnd() * 0.6;
      var b = batchFor(kind);
      var rot = rnd() * TAU;
      q4.setFromEuler(e3.set(0, rot, 0));
      m4.compose(new THREE.Vector3(tx, model.y[Math.round(rnd() * (model.count - 1))] || 0, tz), q4,
        new THREE.Vector3(sc, sc * (0.9 + rnd() * 0.3), sc));
      b.trunk.push(m4.clone());
      placed++;
      stats.trees++;
    }

    /* ---------------- Monza: the avenue ------------------------------- */
    /* Straight double rows of planes along the main straight and poplars on
       the run to the Lesmos — the thing that makes the park read as a park. */
    if (meta.id === 'italy') {
      [0.02, 0.06, 0.14, 0.52, 0.86].forEach(function (f) {
        for (var s = 0; s < 700; s += 16) {
          var p = at(model.length * f + s);
          if (!p) continue;
          [-1, 1].forEach(function (side) {
            var off = p.width * 0.5 + 17 + (rnd() < 0.2 ? 6 : 0);
            var tx = p.x + Math.cos(p.heading) * side * off;
            var tz = p.z - Math.sin(p.heading) * side * off;
            if (!freeAt(tx, tz)) return;
            q4.setFromEuler(e3.set(0, rnd() * TAU, 0));
            var sc2 = 0.95 + rnd() * 0.35;
            m4.compose(new THREE.Vector3(tx, p.y, tz), q4, new THREE.Vector3(sc2, sc2, sc2));
            batchFor(rnd() < 0.55 ? 'plane' : 'poplar').trunk.push(m4.clone());
            stats.trees++;
          });
        }
      });
    }

    /* ---------------- build one instanced mesh per species ------------- */
    Object.keys(batches).forEach(function (kind) {
      var b = batches[kind];
      if (!b.trunk.length) return;
      var spec = SPECIES[kind] || SPECIES.plane;
      var parts = speciesGeo(kind);

      /* split the species into trunk and leaf geometry so the leaves can be
         double sided and wind-animated without lighting the trunk twice */
      var leafGeo = mergeParts(parts.filter(function (_, i) { return i > 0; }));
      var trunkGeo = mergeParts(parts.slice(0, 1));

      var trunkMat = new THREE.MeshStandardMaterial({ color: spec.trunk, roughness: 0.95 });
      var leafMat = new THREE.MeshStandardMaterial({
        color: spec.leaf, roughness: 0.92, side: THREE.DoubleSide
      });
      /* gentle wind: displace leaf vertices by height so the crown sways and
         the trunk does not */
      leafMat.onBeforeCompile = function (shader) {
        shader.uniforms.uTime = { value: 0 };
        shader.uniforms.uWind = { value: 0.16 };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>',
            '#include <common>\nuniform float uTime;\nuniform float uWind;')
          .replace('#include <begin_vertex>',
            '#include <begin_vertex>\n' +
            'float sway = sin(uTime * 0.9 + (position.x + position.z) * 0.06 + instanceMatrix[3][0] * 0.02);\n' +
            'transformed.x += sway * uWind * max(0.0, position.y - 3.0) * 0.12;\n' +
            'transformed.z += sway * uWind * max(0.0, position.y - 3.0) * 0.09;');
        leafMat.userData.shader = shader;
      };
      leafMat.customProgramCacheKey = function () { return 'f1-leaf'; };

      var trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, b.trunk.length);
      var leaves = new THREE.InstancedMesh(leafGeo, leafMat, b.trunk.length);
      for (var i2 = 0; i2 < b.trunk.length; i2++) {
        trunks.setMatrixAt(i2, b.trunk[i2]);
        leaves.setMatrixAt(i2, b.trunk[i2]);
      }
      trunks.instanceMatrix.needsUpdate = true;
      leaves.instanceMatrix.needsUpdate = true;
      trunks.castShadow = true; leaves.castShadow = true;
      leaves.receiveShadow = false;
      trunks.frustumCulled = false; leaves.frustumCulled = false;
      group.add(trunks, leaves);
      stats.meshes += 2;
      F1.vegetation._leafMats.push(leafMat);
    });

    /* ---------------- grass tufts near the track ---------------------- */
    if (grassDensity > 0.01) {
      var tuftTex = tuftTexture();
      var tuftMat = new THREE.MeshStandardMaterial({
        map: tuftTex, transparent: true, alphaTest: 0.32, side: THREE.DoubleSide,
        roughness: 1, depthWrite: true
      });
      var tuftGeo = new THREE.PlaneGeometry(1.1, 0.75);
      tuftGeo.translate(0, 0.36, 0);
      var nTufts = Math.round(5200 * grassDensity);
      var tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, nTufts);
      var placedT = 0, guard = 0;
      while (placedT < nTufts && guard < nTufts * 4) {
        guard++;
        var s = rnd() * model.length;
        var p2 = at(s);
        var side2 = rnd() < 0.5 ? -1 : 1;
        var off2 = model.width[0] * 0.5 + 1.6 + Math.pow(rnd(), 0.7) * 26;
        var tx2 = p2.x + Math.cos(p2.heading) * side2 * off2;
        var tz2 = p2.z - Math.sin(p2.heading) * side2 * off2;
        if (!freeAt(tx2, tz2)) continue;
        q4.setFromEuler(e3.set(0, rnd() * TAU, 0));
        var sc3 = 0.7 + rnd() * 0.8;
        m4.compose(new THREE.Vector3(tx2, p2.y - 0.05, tz2), q4, new THREE.Vector3(sc3, sc3, sc3));
        tufts.setMatrixAt(placedT++, m4);
      }
      tufts.count = placedT;
      tufts.instanceMatrix.needsUpdate = true;
      tufts.frustumCulled = false;
      group.add(tufts);
      stats.tufts = placedT;
      stats.meshes++;
    }

    /* ---------------- distant treeline -------------------------------- */
    /* A ring of billboard trees beyond the detail radius so the horizon is a
       forest margin, not a straight line where the trees stop. */
    (function treeline() {
      var S = 256;
      var c = cv(S, S), x = c.getContext('2d');
      var r2 = F1.rng(451);
      x.clearRect(0, 0, S, S);
      for (var i = 0; i < 420; i++) {
        var bx = r2() * S;
        var hgt = 40 + r2() * 90;
        var g = 30 + r2() * 45;
        x.fillStyle = 'rgba(' + Math.round(g * 0.7) + ',' + Math.round(g + 18) + ',' + Math.round(g * 0.6) + ',0.95)';
        x.beginPath();
        x.moveTo(bx - 9, S);
        x.quadraticCurveTo(bx - 4, S - hgt * 0.7, bx, S - hgt);
        x.quadraticCurveTo(bx + 5, S - hgt * 0.6, bx + 9, S);
        x.fill();
      }
      var lineTex = tex(c, { aniso: aniso });
      lineTex.wrapS = THREE.RepeatWrapping;
      var ringR = Math.max(900, span * 0.9);
      var segs = 48;
      var geo = new THREE.CylinderGeometry(ringR, ringR, 90, segs, 1, true);
      var mat = new THREE.MeshStandardMaterial({
        map: lineTex, transparent: true, alphaTest: 0.25,
        side: THREE.BackSide, roughness: 1, depthWrite: false
      });
      mat.map.repeat.set(26, 1);
      var ring = new THREE.Mesh(geo, mat);
      ring.position.y = 30;
      ring.frustumCulled = false;
      group.add(ring);
      stats.meshes++;
    })();

    var clock = 0;
    return {
      group: group,
      stats: stats,
      update: function (dt) {
        clock += dt;
        var mats = F1.vegetation._leafMats;
        if (mats) {
          for (var i = 0; i < mats.length; i++) {
            if (mats[i].userData.shader) mats[i].userData.shader.uniforms.uTime.value = clock;
          }
        }
      }
    };
  };
})(window.F1 = window.F1 || {});
