/* ==========================================================================
   F1 2026 — world/props.js
   Trackside furniture: the things that make a circuit look like a circuit.

     F1.props.build(model, meta, opts) -> { group, update(dt), stats }

   Everything is built from the centreline model, merged by material and
   instanced where repeated, because the target is 60 fps with all of it on.

   Systems
   -------
   * Armco barrier: corrugated beam swept along the lap, posts every 4 m,
     bolt rows, and the concrete plinth it is bolted to.
   * Catch fencing: alpha-mapped mesh panels on angled posts above the barrier.
   * TecPro: the yellow/black plastic blocks used at high-speed corners.
   * Tyre walls: stacked tyres at the corners that need them, with the
     traditional sponsor band across the top.
   * Grandstands: tiered decks, roof, rear wall, and an instanced crowd with a
     per-seat phase so it moves.
   * Pit complex: 11 garages in the real 2026 team colours, glass band, roof,
     team banners, pit wall with monitors, gantry with the five start lights.
   * Marshal posts, camera pods, timing screens, braking boards, DRS boards,
     sponsor billboards, service roads, bridges, cranes.
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
    t.colorSpace = opts.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.anisotropy = opts.aniso || 8;
    if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
    t.needsUpdate = true;
    return t;
  }

  /* ---------------- merged-geometry helpers ---------------- */
  function merge(items) {
    var pos = [], nor = [], uv = [];
    var nm = new THREE.Matrix3();
    var v = new THREE.Vector3();
    items.forEach(function (it) {
      var g = it.geo.index ? it.geo.toNonIndexed() : it.geo;
      var p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
      nm.getNormalMatrix(it.matrix);
      for (var i = 0; i < p.count; i++) {
        v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(it.matrix);
        pos.push(v.x, v.y, v.z);
        if (n) { v.set(n.getX(i), n.getY(i), n.getZ(i)).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z); }
        else nor.push(0, 1, 0);
        if (u) uv.push(u.getX(i), u.getY(i)); else uv.push(0, 0);
      }
    });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeBoundingSphere();
    return geo;
  }

  function M(x, y, z, ry, sx, sy, sz) {
    return new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry || 0, 0)),
      new THREE.Vector3(sx || 1, sy || 1, sz || 1));
  }

  /* ---------------- procedural maps ---------------- */
  function armcoTexture(aniso) {
    var c = cv(128, 32), x = c.getContext('2d');
    x.fillStyle = '#c8ced3'; x.fillRect(0, 0, 128, 32);
    /* two corrugation waves */
    for (var i = 0; i < 128; i++) {
      var w = Math.sin(i / 128 * TAU * 2) * 24 + 172;
      x.fillStyle = 'rgb(' + Math.round(w) + ',' + Math.round(w + 4) + ',' + Math.round(w + 8) + ')';
      x.fillRect(i, 0, 1, 32);
    }
    /* rust speckle + scratches */
    var rnd = F1.rng(7);
    for (var s = 0; s < 260; s++) {
      x.fillStyle = 'rgba(' + (90 + rnd() * 60) + ',' + (70 + rnd() * 40) + ',' + (50 + rnd() * 30) + ',' + (rnd() * 0.25) + ')';
      x.fillRect(rnd() * 128, rnd() * 32, 1 + rnd() * 3, 1 + rnd() * 2);
    }
    return tex(c, { aniso: aniso });
  }

  function fenceTexture(aniso) {
    /* catch fencing: diagonal chain-link over a transparent background */
    var S = 256;
    var c = cv(S, S), x = c.getContext('2d');
    x.clearRect(0, 0, S, S);
    x.strokeStyle = 'rgba(150,160,170,0.9)';
    x.lineWidth = 1.4;
    for (var i = -S; i < S * 2; i += 11) {
      x.beginPath(); x.moveTo(i, 0); x.lineTo(i + S, S); x.stroke();
      x.beginPath(); x.moveTo(i + S, 0); x.lineTo(i, S); x.stroke();
    }
    return tex(c, { aniso: aniso });
  }

  function sponsorTexture(text, bg, fg, aniso) {
    var c = cv(512, 128), x = c.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, 512, 128);
    x.fillStyle = fg;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    var size = 86;
    x.font = '900 ' + size + 'px "Arial Narrow", Arial, sans-serif';
    while (x.measureText(text).width > 470 && size > 18) {
      size -= 4;
      x.font = '900 ' + size + 'px "Arial Narrow", Arial, sans-serif';
    }
    x.fillText(text, 256, 68);
    return tex(c, { aniso: aniso });
  }

  /* 8x8 atlas of single spectators. Each cell is drawn as head + shoulders +
     torso so a quad still reads as a person from the TV camera; the instance
     shader picks a cell per spectator, which is what stops the block from
     averaging out into grey mush. */
  var CROWD_ATLAS = 8;
  function crowdTexture(aniso) {
    var N = CROWD_ATLAS, C = 32, S = N * C;
    var c = cv(S, S), x = c.getContext('2d');
    x.fillStyle = '#33373d'; x.fillRect(0, 0, S, S);
    var shirts = ['#d9d7d2', '#c0453f', '#d98a45', '#cbb257', '#4a8f8a', '#4a6f9e',
                  '#8a6a9e', '#4a6a52', '#3a3a3c', '#bfbcb4', '#a63a44', '#c99a52',
                  '#6a5a8a', '#4a6f8f', '#a8a49c', '#8a5a52'];
    var skin = ['#e8b48c', '#c98b5e', '#8d5a36', '#f0c9a4', '#6b4326'];
    var rnd = F1.rng(31);
    for (var gy = 0; gy < N; gy++) {
      for (var gx = 0; gx < N; gx++) {
        var ox = gx * C, oy = gy * C;
        var sx = ox + C * 0.5 + (rnd() - 0.5) * 3;
        var sy = oy + C * 0.5 + (rnd() - 0.5) * 2;
        /* torso */
        x.fillStyle = shirts[Math.floor(rnd() * shirts.length)];
        x.beginPath();
        x.moveTo(sx - 7, sy + 13);
        x.lineTo(sx - 6.5, sy + 2);
        x.lineTo(sx + 6.5, sy + 2);
        x.lineTo(sx + 7, sy + 13);
        x.closePath(); x.fill();
        /* shoulders */
        x.beginPath();
        x.moveTo(sx - 6.5, sy + 2);
        x.quadraticCurveTo(sx, sy - 3.5, sx + 6.5, sy + 2);
        x.closePath(); x.fill();
        /* head */
        x.fillStyle = skin[Math.floor(rnd() * skin.length)];
        x.beginPath(); x.arc(sx, sy - 5.5, 3.4, 0, TAU); x.fill();
        /* hair / cap */
        x.fillStyle = rnd() < 0.35 ? shirts[Math.floor(rnd() * shirts.length)] : '#2a2320';
        x.beginPath(); x.arc(sx, sy - 6.4, 3.4, Math.PI * 1.05, Math.PI * 1.95); x.fill();
        /* a couple of raised arms on some of them */
        if (rnd() < 0.18) {
          x.fillStyle = skin[Math.floor(rnd() * skin.length)];
          x.fillRect(sx - 8.5, sy - 6, 2, 9);
        }
      }
    }
    var t = tex(c, { aniso: aniso });
    t.repeat.set(1, 1);
    t.offset.set(0, 0);
    return t;
  }

  function italianFlagTexture(aniso) {
    var c = cv(96, 64), x = c.getContext('2d');
    x.fillStyle = '#008C45'; x.fillRect(0, 0, 32, 64);
    x.fillStyle = '#F4F5F0'; x.fillRect(32, 0, 32, 64);
    x.fillStyle = '#CD212A'; x.fillRect(64, 0, 32, 64);
    return tex(c, { aniso: aniso });
  }

  /* ================================================================== */
  F1.props = {};

  F1.props.build = function (model, meta, opts) {
    opts = opts || {};
    var q = opts.quality || (F1.settings ? F1.settings.preset() : {});
    var aniso = q.anisotropy || 8;
    var crowdDensity = q.crowdDensity !== undefined ? q.crowdDensity : 0.8;
    var theme = meta.theme || {};
    var features = meta.features || [];
    var rnd = F1.rng(hashStr(meta.id + '|props'));
    var group = new THREE.Group();
    group.name = 'props';
    var animated = [];
    var stats = { meshes: 0, tris: 0, crowd: 0 };

    var O = model.origin;
    var n = model.count;
    function at(s, out) {
      var p = model.at(s, out || {});
      p.x -= O.x; p.z -= O.z;
      return p;
    }
    function idxOf(s) { return Math.round(s / model.step) % n; }
    function halfW(k) { return model.width[k] * 0.5; }

    function register(mesh, name) {
      if (name) mesh.name = name;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      if (mesh.geometry && mesh.geometry.index) stats.tris += mesh.geometry.index.count / 3;
      else if (mesh.geometry && mesh.geometry.attributes.position) stats.tris += mesh.geometry.attributes.position.count / 3;
      stats.meshes++;
      group.add(mesh);
      return mesh;
    }

    /* ------------------------------------------------------------------ */
    /* 1. barriers                                                        */
    /* ------------------------------------------------------------------ */
    var street = theme.style === 'street' || theme.style === 'harbour' || theme.walls;
    var wallLat = 1.55;                  /* metres outside the white line */

    var armcoTex = armcoTexture(aniso);
    armcoTex.repeat.set(1, 1);
    var armcoMat = new THREE.MeshStandardMaterial({
      map: armcoTex, color: 0xffffff, metalness: 0.12, roughness: 0.58
    });

    var postMat = new THREE.MeshStandardMaterial({ color: 0x8f969c, metalness: 0.6, roughness: 0.42 });
    var boltMat = new THREE.MeshStandardMaterial({ color: 0x6d747a, metalness: 0.8, roughness: 0.35 });

    /* the concrete plinth every barrier sits on (Jersey profile in section) */
    (function plinth() {
      var geos = [];
      var step = 4;
      for (var s = 0; s < model.length; s += step) {
        var p = at(s, {});
        var w = p.width * 0.5 + wallLat;
        [-1, 1].forEach(function (side) {
          var x = p.x + Math.cos(p.heading) * side * w;
          var z = p.z - Math.sin(p.heading) * side * w;
          geos.push({
            geo: new THREE.BoxGeometry(0.62, street ? 1.05 : 0.62, step * 1.02),
            matrix: M(x, p.y + (street ? 0.5 : 0.3), z, p.heading)
          });
        });
      }
      var m = new THREE.Mesh(merge(geos), new THREE.MeshStandardMaterial({
        color: 0xc3bdb0, roughness: 0.94, metalness: 0.02
      }));
      m.castShadow = true; m.receiveShadow = true;
      register(m, 'barrierPlinth');
    })();

    if (!street) {
      /* two-wave Armco beam + posts + bolts, all merged */
      var beams = [], posts = [], bolts = [];
      for (var s2 = 0; s2 < model.length; s2 += 3) {
        var p2 = at(s2, {});
        var w2 = p2.width * 0.5 + wallLat;
        [-1, 1].forEach(function (side) {
          var nx = Math.cos(p2.heading) * side, nz = -Math.sin(p2.heading) * side;
          var x2 = p2.x + nx * w2, z2 = p2.z + nz * w2;
          beams.push({
            geo: new THREE.BoxGeometry(0.10, 0.34, 3.06),
            matrix: M(x2, p2.y + 0.78, z2, p2.heading)
          });
          if (s2 % 4 < 3) {
            posts.push({
              geo: new THREE.BoxGeometry(0.12, 0.95, 0.14),
              matrix: M(x2 + nx * 0.09, p2.y + 0.5, z2 + nz * 0.09, p2.heading)
            });
            bolts.push({
              geo: new THREE.CylinderGeometry(0.035, 0.035, 0.03, 6),
              matrix: M(x2 + nx * 0.14, p2.y + 0.78, z2 + nz * 0.14, p2.heading)
            });
          }
        });
      }
      var beamMesh = new THREE.Mesh(merge(beams), armcoMat);
      beamMesh.castShadow = true;
      register(beamMesh, 'armco');
      register(new THREE.Mesh(merge(posts), postMat), 'armcoPosts');
      register(new THREE.Mesh(merge(bolts), boltMat), 'armcoBolts');
    } else {
      /* street circuit: solid painted wall with a sponsor band on top */
      var walls = [];
      for (var s3 = 0; s3 < model.length; s3 += 3) {
        var p3 = at(s3, {});
        var w3 = p3.width * 0.5 + wallLat;
        [-1, 1].forEach(function (side) {
          var nx = Math.cos(p3.heading) * side, nz = -Math.sin(p3.heading) * side;
          walls.push({
            geo: new THREE.BoxGeometry(0.36, 1.05, 3.06),
            matrix: M(p3.x + nx * w3, p3.y + 0.52, p3.z + nz * w3, p3.heading)
          });
        });
      }
      register(new THREE.Mesh(merge(walls), new THREE.MeshStandardMaterial({
        color: new THREE.Color(theme.accent || '#dddddd'), roughness: 0.72
      })), 'streetWall');
    }

    /* catch fencing above the barrier on the outside of fast corners */
    var fenceTex = fenceTexture(aniso);
    fenceTex.repeat.set(1.6, 1.6);
    var fenceMat = new THREE.MeshStandardMaterial({
      map: fenceTex, transparent: true, alphaTest: 0.55, depthWrite: false,
      side: THREE.DoubleSide, roughness: 0.85, metalness: 0.15, color: 0x9aa4ad
    });
    (function fencing() {
      var panels = [];
      var s = 0;
      while (s < model.length) {
        var k = idxOf(s);
        var cur = Math.abs(model.curvature ? model.curvature[k] : 0);
        var runLen = 40;
        if (cur > 1 / 200) {
          var side = (model.curvature && model.curvature[k] > 0) ? -1 : 1;
          for (var t = 0; t < runLen; t += 4) {
            var p = at(s + t, {});
            var w = p.width * 0.5 + wallLat;
            var nx = Math.cos(p.heading) * side, nz = -Math.sin(p.heading) * side;
            panels.push({
              geo: new THREE.PlaneGeometry(4.05, 3.1),
              matrix: M(p.x + nx * (w + 0.35), p.y + 2.45, p.z + nz * (w + 0.35), p.heading + Math.PI / 2)
            });
          }
        }
        s += runLen;
      }
      var fence = new THREE.Mesh(merge(panels), fenceMat);
      fence.receiveShadow = false;
      register(fence, 'catchFence');
    })();

    /* TecPro blocks + tyre stacks at the fastest corners */
    (function safety() {
      var tecGeo = [], tyreGeo = [], bandGeo = [];
      var tyreMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95 });
      var tecMat = new THREE.MeshStandardMaterial({ color: 0xd9c33a, roughness: 0.62 });
      var bandMat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.8 });
      for (var s = 120; s < model.length - 120; s += 26) {
        var k = idxOf(s);
        var cur = Math.abs(model.curvature ? model.curvature[k] : 0);
        if (cur < 1 / 70) continue;
        var p = at(s, {});
        var side = (model.curvature && model.curvature[k] > 0) ? -1 : 1;
        var nx = Math.cos(p.heading) * side, nz = -Math.sin(p.heading) * side;
        var lat = p.width * 0.5 + wallLat + 1.0;
        var bx = p.x + nx * lat, bz = p.z + nz * lat;
        if (rnd() < 0.55) {
          for (var b = 0; b < 3; b++) {
            tecGeo.push({
              geo: new THREE.BoxGeometry(1.05, 0.85, 2.0),
              matrix: M(bx + Math.cos(p.heading) * b * 2.1, p.y + 0.44, bz - Math.sin(p.heading) * b * 2.1, p.heading)
            });
          }
        } else {
          for (var t2 = 0; t2 < 4; t2++) {
            tyreGeo.push({
              geo: new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10),
              matrix: M(bx, p.y + 0.13 + t2 * 0.25, bz, p.heading)
            });
          }
          bandGeo.push({
            geo: new THREE.BoxGeometry(0.2, 0.26, 1.0),
            matrix: M(bx, p.y + 1.06, bz, p.heading)
          });
        }
      }
      if (tecGeo.length) { var tm = new THREE.Mesh(merge(tecGeo), tecMat); tm.castShadow = true; register(tm, 'tecpro'); }
      if (tyreGeo.length) { var ym = new THREE.Mesh(merge(tyreGeo), tyreMat); register(ym, 'tyres'); }
      if (bandGeo.length) register(new THREE.Mesh(merge(bandGeo), bandMat), 'tyreBand');
    })();

    /* ------------------------------------------------------------------ */
    /* 2. grandstands + animated crowd                                    */
    /* ------------------------------------------------------------------ */
    var crowdTex = crowdTexture(aniso);
    var standMat = new THREE.MeshStandardMaterial({ color: 0xc6c0b2, roughness: 0.92 });
    var roofMat = new THREE.MeshStandardMaterial({ color: 0x8d939a, roughness: 0.45, metalness: 0.5 });
    var seatMat = new THREE.MeshStandardMaterial({ color: 0x8b8880, roughness: 0.88 });
    var standDeck = [], standRoof = [], standSeat = [];

    /* crowd: one instanced quad per seat, with a per-instance phase so the
       block shimmers like a real crowd instead of reading as a texture */
    var crowdGeo = new THREE.PlaneGeometry(0.78, 0.95);
    var crowdMat = new THREE.MeshStandardMaterial({
      map: crowdTex, roughness: 0.92, side: THREE.DoubleSide,
      emissive: 0xffffff, emissiveIntensity: 0.09
    });
    var crowdCount = 0;
    var crowdPositions = [];

    function addStand(s, side, mul) {
      var k = idxOf(s);
      var p = at(s, {});
      var len = 54 * (mul || 1);
      var depth = 17;
      var tiers = 9;
      var rise = 0.92;
      var tierDepth = depth / tiers;
      var lat = p.width * 0.5 + (street ? 6.5 : 17);
      var nx = Math.cos(p.heading) * side, nz = -Math.sin(p.heading) * side;
      var cx = p.x + nx * (lat + depth * 0.5);
      var cz = p.z + nz * (lat + depth * 0.5);
      var ry = p.heading;

      standDeck.push({ geo: new THREE.BoxGeometry(depth, 1.2, len), matrix: M(cx, p.y + 0.5, cz, ry) });
      for (var t = 0; t < tiers; t++) {
        var out = lat + (t + 0.5) * tierDepth;
        var dx = p.x + nx * out, dz = p.z + nz * out;
        var y = p.y + 1.1 + t * rise;
        standSeat.push({ geo: new THREE.BoxGeometry(tierDepth * 1.02, rise, len), matrix: M(dx, y + rise * 0.5, dz, ry) });
        /* crowd on every tier, standing on the front lip of the tread so the
           whole block reads as a wall of people from the track */
        var seats = Math.round(len / 0.62);
        var keep = Math.round(seats * crowdDensity);
        var outC = out - tierDepth * 0.5 + 0.62;
        var cxx = p.x + nx * outC, czz = p.z + nz * outC;
        for (var c = 0; c < keep; c++) {
          var along = (c / Math.max(1, keep)) * len - len * 0.5 + (rnd() - 0.5) * 0.3;
          if (rnd() > 0.9) continue;                     /* gaps in the block */
          crowdPositions.push([
            cxx + Math.cos(ry + Math.PI / 2) * along,
            y + rise + 0.47,
            czz - Math.sin(ry + Math.PI / 2) * along,
            ry + Math.PI / 2
          ]);
        }
      }
      /* back wall + roof */
      var backOut = lat + depth;
      var bx = p.x + nx * backOut, bz = p.z + nz * backOut;
      standDeck.push({ geo: new THREE.BoxGeometry(0.6, 1.1 + tiers * rise, len), matrix: M(bx, p.y + (tiers * rise) * 0.5, bz, ry) });
      var roofY = p.y + 1.1 + tiers * rise + 2.1;
      standRoof.push({ geo: new THREE.BoxGeometry(depth + 2.0, 0.22, len + 1.2), matrix: M(cx + nx * 0.6, roofY, cz + nz * 0.6, ry) });
      /* deep fascia across the front edge so the roof reads as a structure */
      standRoof.push({
        geo: new THREE.BoxGeometry(0.28, 1.15, len + 1.2),
        matrix: M(p.x + nx * (lat - 0.4), roofY - 0.5, p.z + nz * (lat - 0.4), ry)
      });
      for (var r = -1; r <= 1; r += 2) {
        standRoof.push({
          geo: new THREE.BoxGeometry(0.3, 2.9, 0.3),
          matrix: M(p.x + nx * (lat + 0.6) - Math.cos(ry + Math.PI / 2) * len * 0.44 * r,
                   roofY - 1.45,
                   p.z + nz * (lat + 0.6) + Math.sin(ry + Math.PI / 2) * len * 0.44 * r, ry)
        });
      }
    }

    /* where the stands go: a heuristic by lap fraction, boosted for park
       circuits and for the circuits the brief calls out as full houses */
    var fullHouse = { italy: 0.95, britain: 0.9, japan: 0.92, brazil: 0.9, netherlands: 0.88, austria: 0.8 };
    var standMul = fullHouse[meta.id] || (theme.style === 'park' ? 0.7 : 0.5);
    var standAt = [
      [0.02, 1, 1.5], [0.06, -1, 1.4], [0.10, 1, 1.2],
      [0.17, -1, 1.0], [0.30, 1, 0.95], [0.42, -1, 1.0],
      [0.55, 1, 1.05], [0.66, -1, 0.95], [0.78, 1, 1.0],
      [0.90, -1, 1.1], [0.945, 1, 1.3], [0.975, -1, 1.3]
    ];
    standAt.forEach(function (sp) {
      /* skip the tight street circuits' frontage: no room */
      addStand(model.length * sp[0], sp[1], sp[2] * standMul);
    });

    register(new THREE.Mesh(merge(standDeck), standMat), 'stands');
    register(new THREE.Mesh(merge(standSeat), seatMat), 'standSeats');
    register(new THREE.Mesh(merge(standRoof), roofMat), 'standRoofs');

    if (crowdPositions.length) {
      var inst = new THREE.InstancedMesh(crowdGeo, crowdMat, crowdPositions.length);
      var m4 = new THREE.Matrix4();
      var phases = new Float32Array(crowdPositions.length);
      for (var ci = 0; ci < crowdPositions.length; ci++) {
        var cp = crowdPositions[ci];
        m4.compose(new THREE.Vector3(cp[0], cp[1], cp[2]),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, cp[3], 0)),
          new THREE.Vector3(1, 1, 1));
        inst.setMatrixAt(ci, m4);
        phases[ci] = rnd() * TAU;
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.frustumCulled = false;
      /* per-instance bob: crowd shader, injected once */
      crowdMat.onBeforeCompile = function (shader) {
        shader.uniforms.uTime = { value: 0 };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>',
            '#include <common>\nuniform float uTime;\nattribute float aPhase;\n' +
            'attribute vec2 aCell;\nconst float ATLAS = ' + CROWD_ATLAS.toFixed(1) + ';')
          .replace('#include <uv_vertex>',
            '#include <uv_vertex>\n' +
            '#ifdef USE_MAP\n' +
            '  vMapUv = (vMapUv * (1.0 / ATLAS)) + (aCell * (1.0 / ATLAS));\n' +
            '#endif')
          .replace('#include <begin_vertex>',
            '#include <begin_vertex>\n' +
            'transformed.y += sin(uTime * 3.1 + aPhase) * 0.055;\n' +
            'transformed.x += cos(uTime * 2.3 + aPhase * 1.7) * 0.022;');
        crowdMat.userData.shader = shader;
      };
      crowdMat.customProgramCacheKey = function () { return 'f1-crowd'; };
      var phaseAttr = new THREE.InstancedBufferAttribute(phases, 1);
      var cells = new Float32Array(crowdPositions.length * 2);
      for (var cj = 0; cj < crowdPositions.length; cj++) {
        cells[cj * 2] = Math.floor(rnd() * CROWD_ATLAS) / 1;
        cells[cj * 2 + 1] = Math.floor(rnd() * CROWD_ATLAS) / 1;
      }
      inst.geometry = crowdGeo.clone();
      inst.geometry.setAttribute('aPhase', phaseAttr);
      inst.geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
      register(inst, 'crowd');
      stats.crowd = crowdPositions.length;
      animated.push({
        update: function (dt, t) {
          if (crowdMat.userData.shader) crowdMat.userData.shader.uniforms.uTime.value = t;
        }
      });
    }

    /* ------------------------------------------------------------------ */
    /* 3. pit complex                                                     */
    /* ------------------------------------------------------------------ */
    var teams = F1.DATA.teams;
    var garageW = 8.4;
    var garageN = teams.length;
    var pitLen = garageN * garageW;
    var pitS0 = model.length * (((model.pit && model.pit.entry) || 0.955) - 0.055 + 1) % model.length;
    var pitSide = -1;
    var pitLat = (model.width[0] * 0.5 + 9.5);

    var garageFront = [];
    var garageSide = [];
    var garageRoof = [];
    var bannerGeos = [];
    var glassGeos = [];

    (function pitBuilding() {
      var nGar = garageN;
      for (var g = 0; g < nGar; g++) {
        var s = pitS0 + g * garageW + garageW * 0.5;
        var p = at(s, {});
        var nx = Math.cos(p.heading) * pitSide, nz = -Math.sin(p.heading) * pitSide;
        var cx = p.x + nx * (pitLat + 5), cz = p.z + nz * (pitLat + 5);
        var ry = p.heading;
        /* shell */
        garageFront.push({ geo: new THREE.BoxGeometry(10.2, 6.6, garageW * 0.99), matrix: M(cx, p.y + 3.3, cz, ry) });
        /* glass band facing the pit lane */
        glassGeos.push({
          geo: new THREE.BoxGeometry(0.18, 2.5, garageW * 0.82),
          matrix: M(cx + nx * 5.15, p.y + 4.4, cz + nz * 5.15, ry)
        });
        /* garage opening: dark recess with the team colour band above */
        garageFront.push({
          geo: new THREE.BoxGeometry(0.3, 2.8, garageW * 0.7),
          matrix: M(cx + nx * 5.12, p.y + 1.5, cz + nz * 5.12, ry)
        });
        var colour = teams[g % teams.length].colors.primary;
        bannerGeos.push({
          geo: new THREE.BoxGeometry(0.16, 0.72, garageW * 0.94),
          matrix: M(cx + nx * 5.22, p.y + 3.35, cz + nz * 5.22, ry),
          colour: colour
        });
        /* rear block + roof plant */
        garageSide.push({ geo: new THREE.BoxGeometry(9.5, 2.2, garageW * 0.99), matrix: M(cx - nx * 4.2, p.y + 7.7, cz - nz * 4.2, ry) });
        garageRoof.push({ geo: new THREE.BoxGeometry(11.5, 0.4, garageW * 1.02), matrix: M(cx, p.y + 6.7, cz, ry) });
      }
      var shellMat = new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.52, metalness: 0.14 });
      var front = new THREE.Mesh(merge(garageFront), shellMat);
      front.castShadow = true; front.receiveShadow = true;
      register(front, 'pitBuilding');
      register(new THREE.Mesh(merge(glassGeos), new THREE.MeshStandardMaterial({
        color: 0x1b2836, roughness: 0.1, metalness: 0.86, envMapIntensity: 1.4
      })), 'pitGlass');
      register(new THREE.Mesh(merge(garageSide), new THREE.MeshStandardMaterial({
        color: 0xd2d6da, roughness: 0.7, metalness: 0.2
      })), 'pitRear');
      register(new THREE.Mesh(merge(garageRoof), roofMat), 'pitRoof');

      /* team colour bands, one material per colour so they stay crisp */
      var byColour = {};
      bannerGeos.forEach(function (b) {
        (byColour[b.colour] = byColour[b.colour] || []).push(b);
      });
      Object.keys(byColour).forEach(function (c) {
        register(new THREE.Mesh(merge(byColour[c]), new THREE.MeshStandardMaterial({
          color: new THREE.Color(c), roughness: 0.45, metalness: 0.1
        })), 'teamBand');
      });

      /* big circuit name board on the roof */
      var mid = at(pitS0 + pitLen * 0.5, {});
      var nxm = Math.cos(mid.heading) * pitSide, nzm = -Math.sin(mid.heading) * pitSide;
      var signTex = sponsorTexture(meta.name.toUpperCase(), '#080b10', '#ffffff', aniso);
      var sign = new THREE.Mesh(new THREE.PlaneGeometry(34, 5.2),
        new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide }));
      sign.position.set(mid.x + nxm * 5.4, mid.y + 9.6, mid.z + nzm * 5.4);
      sign.rotation.y = mid.heading + Math.PI / 2;
      register(sign, 'pitSign');
    })();

    /* pit wall with monitors, umbrellas and the timing tower */
    (function pitWall() {
      var wallBits = [];
      var monBits = [];
      var px = [], pz = [];
      for (var g = 0; g <= garageN; g++) {
        var s = pitS0 + g * garageW;
        var p = at(s, {});
        var nx = Math.cos(p.heading) * pitSide, nz = -Math.sin(p.heading) * pitSide;
        var x = p.x + nx * (pitLat - 1.2), z = p.z + nz * (pitLat - 1.2);
        px.push({ x: x, y: p.y, z: z, h: p.heading });
      }
      for (var i = 0; i < px.length - 1; i++) {
        var a = px[i], b = px[i + 1];
        var mx = (a.x + b.x) * 0.5, mz = (a.z + b.z) * 0.5;
        var len = Math.hypot(b.x - a.x, b.z - a.z) * 1.02;
        wallBits.push({ geo: new THREE.BoxGeometry(0.5, 1.05, len), matrix: M(mx, a.y + 0.52, mz, a.h) });
        if (i % 2 === 0) {
          monBits.push({ geo: new THREE.BoxGeometry(0.12, 0.55, 1.2), matrix: M(mx, a.y + 1.5, mz, a.h) });
          monBits.push({ geo: new THREE.BoxGeometry(0.9, 0.08, 1.4), matrix: M(mx + Math.cos(a.h) * 0.4, a.y + 1.28, mz - Math.sin(a.h) * 0.4, a.h) });
        }
      }
      register(new THREE.Mesh(merge(wallBits), new THREE.MeshStandardMaterial({
        color: 0xdfe3e7, roughness: 0.6, metalness: 0.2
      })), 'pitWall');
      register(new THREE.Mesh(merge(monBits), new THREE.MeshStandardMaterial({
        color: 0x14181e, roughness: 0.35, metalness: 0.5, emissive: 0x0a1a2a, emissiveIntensity: 0.6
      })), 'pitMonitors');
    })();

    /* ------------------------------------------------------------------ */
    /* 4. start gantry with the five lights                               */
    /* ------------------------------------------------------------------ */
    var startLights = [];
    (function gantry() {
      var p = at(0, {});
      var steel = new THREE.MeshStandardMaterial({ color: 0x23272d, metalness: 0.7, roughness: 0.38 });
      var frame = [];
      var halfSpan = p.width * 0.5 + 2.4;
      [-1, 1].forEach(function (side) {
        var nx = Math.cos(p.heading) * side, nz = -Math.sin(p.heading) * side;
        frame.push({ geo: new THREE.BoxGeometry(0.55, 7.4, 0.55), matrix: M(p.x + nx * halfSpan, p.y + 3.7, p.z + nz * halfSpan, p.heading) });
      });
      frame.push({ geo: new THREE.BoxGeometry(halfSpan * 2, 0.85, 0.7), matrix: M(p.x, p.y + 7.1, p.z, p.heading) });
      frame.push({ geo: new THREE.BoxGeometry(halfSpan * 2, 0.28, 0.5), matrix: M(p.x, p.y + 5.8, p.z, p.heading) });
      register(new THREE.Mesh(merge(frame), steel), 'gantry');

      var lightGeo = new THREE.SphereGeometry(0.22, 12, 10);
      for (var i = 0; i < 5; i++) {
        var off = (i - 2) * 0.95;
        var mat = new THREE.MeshStandardMaterial({
          color: 0x2a0d0d, emissive: 0xff1010, emissiveIntensity: 0,
          roughness: 0.4, metalness: 0.1
        });
        var bulb = new THREE.Mesh(lightGeo, mat);
        bulb.position.set(
          p.x + Math.cos(p.heading + Math.PI / 2) * off,
          p.y + 6.5,
          p.z - Math.sin(p.heading + Math.PI / 2) * off);
        group.add(bulb);
        startLights.push(mat);
      }
      var boxMat = new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.5 });
      var box = new THREE.Mesh(new THREE.BoxGeometry(6.2, 1.1, 0.5), boxMat);
      box.position.set(p.x, p.y + 6.5, p.z);
      box.rotation.y = p.heading;
      register(box, 'gantryLightBox');
    })();

    /* ------------------------------------------------------------------ */
    /* 5. marshal posts, cameras, boards, flags                           */
    /* ------------------------------------------------------------------ */
    (function marshals() {
      var hutBits = [], personBits = [], flagPoles = [];
      var orange = new THREE.MeshStandardMaterial({ color: 0xf26f00, roughness: 0.85 });
      var hutMat = new THREE.MeshStandardMaterial({ color: 0xe6e8ea, roughness: 0.8 });
      var poleMat = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.7, roughness: 0.4 });
      var flagTex = italianFlagTexture(aniso);
      var flagMat = new THREE.MeshStandardMaterial({
        map: flagTex, side: THREE.DoubleSide, roughness: 0.9
      });
      var flagGeo = new THREE.PlaneGeometry(1.5, 1.0);

      for (var s = 60; s < model.length; s += 190) {
        var p = at(s, {});
        var side = ((s / 190) | 0) % 2 ? 1 : -1;
        var nx = Math.cos(p.heading) * side, nz = -Math.sin(p.heading) * side;
        var lat = p.width * 0.5 + 4.2;
        var x = p.x + nx * lat, z = p.z + nz * lat;
        hutBits.push({ geo: new THREE.BoxGeometry(1.5, 2.1, 1.5), matrix: M(x, p.y + 1.05, z, p.heading) });
        personBits.push({ geo: new THREE.BoxGeometry(0.34, 1.05, 0.24), matrix: M(x + nx * 1.0, p.y + 0.55, z + nz * 1.0, p.heading) });
        personBits.push({ geo: new THREE.BoxGeometry(0.24, 0.26, 0.22), matrix: M(x + nx * 1.0, p.y + 1.22, z + nz * 1.0, p.heading) });
        if (s % 380 < 190) {
          flagPoles.push({ geo: new THREE.CylinderGeometry(0.045, 0.045, 4.4, 6), matrix: M(x - nx * 1.6, p.y + 2.2, z - nz * 1.6, p.heading) });
          var flag = new THREE.Mesh(flagGeo, flagMat);
          flag.position.set(x - nx * 1.6 + Math.cos(p.heading) * 0.8, p.y + 3.9, z - nz * 1.6 - Math.sin(p.heading) * 0.8);
          flag.rotation.y = p.heading + Math.PI / 2;
          register(flag, 'italianFlag');
          animated.push({ flag: flag, base: p.heading + Math.PI / 2 });
        }
      }
      register(new THREE.Mesh(merge(hutBits), hutMat), 'marshalHuts');
      register(new THREE.Mesh(merge(personBits), orange), 'marshals');
      register(new THREE.Mesh(merge(flagPoles), poleMat), 'flagPoles');
    })();

    /* braking boards and DRS boards on the approaches to the big stops */
    (function boards() {
      var boardGeo = [], postGeo = [], faceMats = [];
      var boardMats = {};
      function boardMat(text, bg, fg) {
        var key = text + bg;
        if (!boardMats[key]) {
          boardMats[key] = new THREE.MeshStandardMaterial({
            map: sponsorTexture(text, bg, fg, aniso), roughness: 0.7, side: THREE.DoubleSide
          });
        }
        return boardMats[key];
      }
      /* find the four slowest points of the lap and put 100/50 boards before them */
      var slow = [];
      for (var k = 8; k < model.count - 8; k += 4) {
        var curv = Math.abs(model.curvature ? model.curvature[k] : 0);
        if (curv > 1 / 60) slow.push(k);
      }
      var used = [];
      slow.forEach(function (k) {
        for (var u = 0; u < used.length; u++) if (Math.abs(used[u] - k) < 30) return;
        used.push(k);
        var sBrake = k * model.step;
        [[100, 70], [50, 34]].forEach(function (bb) {
          var s = sBrake - bb[1];
          if (s < 0) return;
          var p = at(s, {});
          var side = 1;
          var nx = Math.cos(p.heading) * side, nz = -Math.sin(p.heading) * side;
          var lat = p.width * 0.5 + 3.4;
          var x = p.x + nx * lat, z = p.z + nz * lat;
          postGeo.push({ geo: new THREE.BoxGeometry(0.12, 1.5, 0.12), matrix: M(x, p.y + 0.75, z, p.heading) });
          var face = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 1.35), boardMat(String(bb[0]), '#141619', '#f5f5f5'));
          face.position.set(x, p.y + 2.0, z);
          face.rotation.y = p.heading + Math.PI / 2;
          register(face, 'brakeBoard');
          var panel = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 1.35), new THREE.MeshStandardMaterial({
            color: 0x17191d, roughness: 0.8, side: THREE.DoubleSide
          }));
          panel.position.set(x, p.y + 2.0, z);
          panel.rotation.y = p.heading - Math.PI / 2;
          register(panel, 'boardBack');
        });
        if (used.length >= 6) return;
      });
      if (postGeo.length) register(new THREE.Mesh(merge(postGeo), new THREE.MeshStandardMaterial({
        color: 0x8b9298, metalness: 0.6, roughness: 0.4
      })), 'boardPosts');

      /* trackside sponsor hoardings along the straights */
      var hoard = [];
      for (var s = 40; s < model.length; s += 26) {
        var p = at(s, {});
        var kk = Math.round(s / model.step) % model.count;
        if (Math.abs(model.curvature ? model.curvature[kk] : 0) > 1 / 200) continue;
        if (rnd() < 0.45) continue;
        var side = rnd() < 0.5 ? -1 : 1;
        var nx = Math.cos(p.heading) * side, nz = -Math.sin(p.heading) * side;
        var lat = p.width * 0.5 + 3.6;
        hoard.push({
          x: p.x + nx * lat, y: p.y + 0.55, z: p.z + nz * lat, h: p.heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2)
        });
      }
      var sponsors = [['PIRELLI', '#f5f5f5', '#111111'], ['ARAMCO', '#0b6b3a', '#ffffff'],
                      ['ROLEX', '#0a4d2c', '#d8c37a'], ['DHL', '#ffcc00', '#c8102e'],
                      ['AWS', '#0f1a2b', '#ff9900'], ['Lenovo', '#c8102e', '#ffffff']];
      sponsors.forEach(function (sp, spi) {
        var list = hoard.filter(function (_, i) { return i % sponsors.length === spi; });
        if (!list.length) return;
        var geos = list.map(function (h) {
          return { geo: new THREE.PlaneGeometry(4.6, 0.92), matrix: M(h.x, h.y + 0.46, h.z, h.h) };
        });
        register(new THREE.Mesh(merge(geos), new THREE.MeshStandardMaterial({
          map: sponsorTexture(sp[0], sp[1], sp[2], aniso), roughness: 0.66, side: THREE.DoubleSide
        })), 'hoarding' + spi);
      });
    })();

    /* ------------------------------------------------------------------ */
    /* 6. bridges over the track + timing screens                         */
    /* ------------------------------------------------------------------ */
    (function bridges() {
      var stone = new THREE.MeshStandardMaterial({ color: 0xb6b2a8, roughness: 0.92 });
      var dark = new THREE.MeshStandardMaterial({ color: 0x1b1e23, metalness: 0.5, roughness: 0.4 });
      [0.30, 0.62].forEach(function (f) {
        var s = model.length * f;
        var p = at(s, {});
        var halfSpan = p.width * 0.5 + 4.5;
        var bits = [];
        [-1, 1].forEach(function (side) {
          var nx = Math.cos(p.heading) * side, nz = -Math.sin(p.heading) * side;
          bits.push({ geo: new THREE.BoxGeometry(1.6, 5.2, 1.6), matrix: M(p.x + nx * halfSpan, p.y + 2.6, p.z + nz * halfSpan, p.heading) });
        });
        bits.push({ geo: new THREE.BoxGeometry(halfSpan * 2, 1.1, 2.6), matrix: M(p.x, p.y + 5.4, p.z, p.heading) });
        bits.push({ geo: new THREE.BoxGeometry(halfSpan * 2, 0.7, 0.3), matrix: M(p.x, p.y + 6.1, p.z, p.heading) });
        var m = new THREE.Mesh(merge(bits), stone);
        m.castShadow = true; m.receiveShadow = true;
        register(m, 'bridge');
        /* a banner across the bridge face */
        var ban = new THREE.Mesh(new THREE.PlaneGeometry(halfSpan * 1.6, 1.0),
          new THREE.MeshStandardMaterial({
            map: sponsorTexture('FORMULA 1', '#0b0d12', '#ffffff', aniso), roughness: 0.7, side: THREE.DoubleSide
          }));
        ban.position.set(p.x, p.y + 4.6, p.z);
        ban.rotation.y = p.heading + Math.PI / 2;
        register(ban, 'bridgeBanner');
      });
    })();

    /* ------------------------------------------------------------------ */
    /* 7. lighting towers (night rounds)                                  */
    /* ------------------------------------------------------------------ */
    if (meta.timeOfDay === 'night' || meta.timeOfDay === 'twilight') {
      var mastMat = new THREE.MeshStandardMaterial({ color: 0x4b5158, metalness: 0.7, roughness: 0.4 });
      var lampMat = new THREE.MeshStandardMaterial({
        color: 0xfff5dd, emissive: 0xfff0cc, emissiveIntensity: 2.4, roughness: 0.3
      });
      var masts = [], lamps = [];
      var nMast = Math.min(18, Math.max(8, Math.round(model.length / 300)));
      for (var i = 0; i < nMast; i++) {
        var s = (i / nMast) * model.length;
        var p = at(s, {});
        var side = i % 2 ? 1 : -1;
        var nx = Math.cos(p.heading) * side, nz = -Math.sin(p.heading) * side;
        var lat = p.width * 0.5 + 13;
        var x = p.x + nx * lat, z = p.z + nz * lat;
        masts.push({ geo: new THREE.CylinderGeometry(0.3, 0.45, 26, 8), matrix: M(x, p.y + 13, z, p.heading) });
        lamps.push({ geo: new THREE.BoxGeometry(4.2, 0.5, 1.6), matrix: M(x - nx * 1.2, p.y + 26, z - nz * 1.2, p.heading) });
      }
      register(new THREE.Mesh(merge(masts), mastMat), 'lightMasts');
      register(new THREE.Mesh(merge(lamps), lampMat), 'lightHeads');
    }

    /* ------------------------------------------------------------------ */
    /* 8. start lights controller (hooked by the race start sequence)      */
    /* ------------------------------------------------------------------ */
    var lit = 0;
    function setStartLights(n) {
      lit = Math.max(0, Math.min(5, n));
      for (var i = 0; i < startLights.length; i++) {
        startLights[i].emissiveIntensity = i < lit ? 4.5 : 0;
        startLights[i].color.setHex(i < lit ? 0xff2a1a : 0x2a0d0d);
      }
    }

    var clock = 0;
    return {
      group: group,
      stats: stats,
      startLights: setStartLights,
      update: function (dt) {
        clock += dt;
        for (var i = 0; i < animated.length; i++) {
          var a = animated[i];
          if (a.update) a.update(dt, clock);
          else if (a.flag) a.flag.rotation.z = Math.sin(clock * 2.6 + a.flag.position.x * 0.1) * 0.16;
        }
      }
    };
  };
})(window.F1 = window.F1 || {});
