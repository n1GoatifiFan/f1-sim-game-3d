/* ==========================================================================
   F1 2026 — data/environments/italy.js
   Monza art direction. The circuit is defined by four things and none of them
   survived the old generic scatter: the tree-lined park, the oval's concrete
   banking, the Parabolica gravel, and a crowd that fills every stand.

     F1.ENVIRONMENTS.italy = {
       palette, mood, exposure, grade,      // look
       landmarks(model, api) -> group,      // hero geometry
       update(dt, t)                        // animation
     }
   ========================================================================== */
(function (F1) {
  'use strict';

  var TAU = Math.PI * 2;

  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function cv(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function tex(canvas, aniso) {
    var t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso || 8;
    t.needsUpdate = true;
    return t;
  }
  function merge(items) {
    var pos = [], nor = [], uv = [];
    var nm = new THREE.Matrix3(), v = new THREE.Vector3();
    items.forEach(function (it) {
      var g = it.geo.index ? it.geo.toNonIndexed() : it.geo;
      var p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
      nm.getNormalMatrix(it.matrix);
      for (var i = 0; i < p.count; i++) {
        v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(it.matrix);
        pos.push(v.x, v.y, v.z);
        if (n) { v.set(n.getX(i), n.getY(i), n.getZ(i)).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z); }
        else nor.push(0, 1, 0);
        uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
      }
    });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeBoundingSphere();
    return geo;
  }
  function M(x, y, z, ry) {
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry || 0, 0)), new THREE.Vector3(1, 1, 1));
  }

  F1.ENVIRONMENTS = F1.ENVIRONMENTS || {};

  F1.ENVIRONMENTS.italy = {
    /* the park in late summer: deep green, warm concrete, red accents */
    palette: {
      ground: '#3d6a33',
      grass: '#4f7d3a',
      tree: '#3f6b33',
      concrete: '#b9b6ab',
      accent: '#E10600',
      sky: '#9dc0e8'
    },
    mood: 'A royal park at 3 pm in September: hard sun, deep shade under the plane trees, ' +
          'dust in the air over the gravel, and 100 000 people in the grandstands.',
    /* the look is applied by world.setLook(); these are the deltas from the
       time-of-day preset */
    look: { exposure: 1.06, saturation: 1.1, contrast: 1.06, vignette: 0.26, warm: 0.016 },
    crowdDensity: 1.0,

    /* ------------------------------------------------------------------ */
    landmarks: function (model, opts) {
      opts = opts || {};
      var aniso = (opts.quality && opts.quality.anisotropy) || 8;
      var O = model.origin;
      var group = new THREE.Group();
      group.name = 'landmarks_italy';
      var anim = [];
      function at(s) {
        var p = model.at(s, {});
        p.x -= O.x; p.z -= O.z;
        return p;
      }

      /* ---------------- 1. the oval: banking silhouette ---------------- */
      /* Monza's 1955 banking is the one shape that makes a Monza screenshot
         unmistakable, so it gets a real banked surface: two straights, two
         180-degree banked turns, an earth bank under the deck and the
         parapet wall on top. Built as a swept ribbon along an oval path. */
      (function oval() {
        var deckMat = new THREE.MeshStandardMaterial({
          color: 0xa39f95, roughness: 0.97, side: THREE.DoubleSide
        });
        var bankMat = new THREE.MeshStandardMaterial({
          color: 0x5e6a46, roughness: 1, side: THREE.DoubleSide
        });
        var parapetMat = new THREE.MeshStandardMaterial({
          color: 0xb5b1a6, roughness: 0.95
        });

        var start = at(0);
        var h0 = start.heading;
        var R = 108;            /* turn radius at the centreline */
        var L = 300;            /* straight length */
        var W = 10.5;           /* deck width */
        var bankMax = 0.42;     /* radians of banking in the turns */

        /* The oval must never cross the modern track. Walk outward along the
           normal to the start straight (in both directions) until the whole
           oval footprint clears every sampled centreline point. */
        var place = (function () {
          var pts = [], i, n = 220;
          for (i = 0; i < n; i++) pts.push(at(model.length * i / n));
          var octx = Math.cos(h0), octz = -Math.sin(h0);   /* forward */
          var sideX = -Math.sin(h0), sideZ = -Math.cos(h0); /* normal */
          var best = null;
          [-1, 1].forEach(function (sign) {
            for (var d = 250; d <= 470; d += 20) {
              var cx = start.x + sideX * sign * d;
              var cz = start.z + sideZ * sign * d;
              var rot = h0 + Math.PI * 0.5;   /* straights parallel to ours */
              var cs = Math.cos(rot), sn = Math.sin(rot);
              var clear = true;
              for (i = 0; i < pts.length && clear; i++) {
                var dx = pts[i].x - cx, dz = pts[i].z - cz;
                /* into oval-local frame */
                var lx = dx * cs + dz * sn;
                var lz = -dx * sn + dz * cs;
                if (Math.abs(lx) < L * 0.5 + R + 26 &&
                    Math.abs(lz) < R + 26) clear = false;
              }
              if (clear && !best) best = { cx: cx, cz: cz, rot: rot };
              if (clear) break;
            }
          });
          return best || { cx: start.x + sideX * 380, cz: start.z + sideZ * 380,
                           rot: h0 + Math.PI * 0.5 };
        })();
        var cx = place.cx, cz = place.cz, rot = place.rot;

        function ovalPoint(t, ud) {
          /* t = 0..1 around the oval, ud = -1..1 across the deck */
          var per = 2 * L + 2 * Math.PI * R;
          var d = t * per;
          var x, z, hx, hz, bank, y;
          if (d < L) {                                  /* bottom straight */
            x = d; z = -R; hx = 1; hz = 0; bank = 0; y = 2.4;
          } else if (d < L + Math.PI * R) {             /* right turn */
            var a = (d - L) / R;
            x = L + Math.sin(a) * R; z = -Math.cos(a) * R;
            hx = Math.cos(a); hz = Math.sin(a); y = 2.4 + Math.sin(a) * 1.4;
            bank = Math.sin(a) * bankMax;
          } else if (d < 2 * L + Math.PI * R) {         /* top straight */
            var e = d - L - Math.PI * R;
            x = L - e; z = R; hx = -1; hz = 0; y = 2.4; bank = 0;
          } else {                                       /* left turn */
            var a2 = (d - 2 * L - Math.PI * R) / R;
            x = -Math.sin(a2) * R; z = Math.cos(a2) * R;
            hx = -Math.cos(a2); hz = -Math.sin(a2); y = 2.4 + Math.sin(a2) * 1.4;
            bank = Math.sin(a2) * bankMax;
          }
          /* across the deck: +ud leans away from the turn centre */
          var nx = -hz, nz = hx;
          var lift = Math.sin(bank) * ud * W * 0.5;
          var lx = x + nx * ud * W * 0.5;
          var lz = z + nz * ud * W * 0.5;
          var cs = Math.cos(rot), sn = Math.sin(rot);
          return {
            x: cx + lx * cs - lz * sn,
            z: cz + lx * sn + lz * cs,
            y: y + lift * 1.0 + 0.9,
            bank: bank
          };
        }

        var steps = 260;
        var deckPos = [], deckIdx = [], deckUv = [];
        var skirtPos = [], skirtIdx = [];
        for (var i = 0; i <= steps; i++) {
          var t = i / steps;
          var l = ovalPoint(t, -1), r = ovalPoint(t, 1);
          deckPos.push(l.x, l.y, l.z, r.x, r.y, r.z);
          deckUv.push(0, t * 60, 1, t * 60);
          /* skirt down to the ground on both sides */
          skirtPos.push(l.x, l.y, l.z, l.x, -0.2, l.z);
          skirtPos.push(r.x, r.y, r.z, r.x, -0.2, r.z);
        }
        for (var q = 0; q < steps; q++) {
          var a0 = q * 2, b0 = q * 2 + 1, a1 = q * 2 + 2, b1 = q * 2 + 3;
          deckIdx.push(a0, b0, b1, a0, b1, a1);
          var s0 = q * 4, s1 = q * 4 + 2, s2 = q * 4 + 4, s3 = q * 4 + 6;
          skirtIdx.push(s0, s0 + 1, s2 + 1, s0, s2 + 1, s2);
          skirtIdx.push(s1, s1 + 1, s3 + 1, s1, s3 + 1, s3);
        }
        var deckGeo = new THREE.BufferGeometry();
        deckGeo.setAttribute('position', new THREE.Float32BufferAttribute(deckPos, 3));
        deckGeo.setAttribute('uv', new THREE.Float32BufferAttribute(deckUv, 2));
        deckGeo.setIndex(deckIdx);
        deckGeo.computeVertexNormals();
        var deckMesh = new THREE.Mesh(deckGeo, deckMat);
        deckMesh.receiveShadow = true;
        group.add(deckMesh);

        var skirtGeo = new THREE.BufferGeometry();
        skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(skirtPos, 3));
        skirtGeo.setIndex(skirtIdx);
        skirtGeo.computeVertexNormals();
        group.add(new THREE.Mesh(skirtGeo, bankMat));

        /* parapet: a 1.1 m wall standing on the outer edge of the deck */
        var para = [];
        for (var i2 = 0; i2 <= steps; i2 += 2) {
          var t2 = i2 / steps;
          var o = ovalPoint(t2, 1.06);
          var o2 = ovalPoint((i2 + 2) / steps, 1.06);
          var mx = (o.x + o2.x) * 0.5, mz = (o.z + o2.z) * 0.5;
          var len = Math.hypot(o2.x - o.x, o2.z - o.z) * 1.1;
          var ang = Math.atan2(o2.x - o.x, o2.z - o.z);
          para.push({
            geo: new THREE.BoxGeometry(0.45, 1.1, len),
            matrix: M(mx, o.y + 0.55, mz, ang)
          });
        }
        group.add(new THREE.Mesh(merge(para), parapetMat));

        /* the two link roads that join the oval to the modern track */
        var link = [];
        [0.02, 0.965].forEach(function (f) {
          var p = at(model.length * f);
          var side = 1;
          var off = p.width * 0.5 + 9;
          link.push({
            geo: new THREE.BoxGeometry(7.5, 0.22, 120),
            matrix: M(p.x + Math.cos(p.heading) * side * off, p.y + 0.1,
                      p.z - Math.sin(p.heading) * side * off, p.heading + 0.16)
          });
        });
        group.add(new THREE.Mesh(merge(link), deckMat));
      })();

      /* ---------------- 2. pit straight colonnade ---------------------- */
      /* A row of plane trees in stone planters along the outside of the main
         straight, plus the flags that hang between them on race day. */
      (function colonnade() {
        var stoneMat = new THREE.MeshStandardMaterial({ color: 0x8e8677, roughness: 0.98 });
        var flagTex = (function () {
          var c = cv(96, 64), x = c.getContext('2d');
          x.fillStyle = '#008C45'; x.fillRect(0, 0, 32, 64);
          x.fillStyle = '#F4F5F0'; x.fillRect(32, 0, 32, 64);
          x.fillStyle = '#CD212A'; x.fillRect(64, 0, 32, 64);
          return tex(c, aniso);
        })();
        var flagMat = new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.92 });
        var planters = [];
        var poles = [];
        for (var s = 22; s < 620; s += 26) {
          var p = at(s);
          var side = 1;
          var off = p.width * 0.5 + 13;
          var x = p.x + Math.cos(p.heading) * side * off;
          var z = p.z - Math.sin(p.heading) * side * off;
          planters.push({ geo: new THREE.CylinderGeometry(0.62, 0.7, 0.42, 8), matrix: M(x, p.y + 0.21, z, p.heading) });
          poles.push({ geo: new THREE.CylinderGeometry(0.055, 0.075, 6.6, 6), matrix: M(x, p.y + 3.6, z, p.heading) });
          var flag = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), flagMat);
          flag.position.set(x + Math.cos(p.heading) * 0.62, p.y + 6.2, z - Math.sin(p.heading) * 0.62);
          flag.rotation.y = p.heading + Math.PI / 2;
          group.add(flag);
          anim.push({ mesh: flag, phase: s * 0.03 });
        }
        group.add(new THREE.Mesh(merge(planters), stoneMat));
        group.add(new THREE.Mesh(merge(poles), new THREE.MeshStandardMaterial({
          color: 0x9aa1a8, metalness: 0.7, roughness: 0.4
        })));
      })();

      /* ---------------- 3. Parabolica: gravel bank + escape road ------- */
      (function parabolica() {
        var gravel = new THREE.MeshStandardMaterial({
          color: 0xc2b49a, roughness: 1,
          map: F1.world && F1.world.textures ? F1.world.textures.gravel() : null
        });
        if (gravel.map) { gravel.map = gravel.map.clone(); gravel.map.repeat.set(4, 4); gravel.map.needsUpdate = true; }
        /* find the Parabolica: the long right-hander in the last quarter */
        var best = 0, bestK = 0;
        for (var k = Math.round(model.count * 0.72); k < model.count; k++) {
          var cu = Math.abs(model.curvature ? model.curvature[k] : 0);
          if (cu > best) { best = cu; bestK = k; }
        }
        var s = bestK * model.step;
        var p = at(s);
        var side = (model.curvature && model.curvature[bestK] > 0) ? -1 : 1;
        var nx = Math.cos(p.heading) * side, nz = -Math.sin(p.heading) * side;
        var traps = [];
        for (var i = -10; i <= 10; i++) {
          var pp = at(s + i * 7);
          var nxx = Math.cos(pp.heading) * side, nzz = -Math.sin(pp.heading) * side;
          traps.push({
            geo: new THREE.BoxGeometry(16, 0.25, 8.4),
            matrix: M(pp.x + nxx * (pp.width * 0.5 + 12), pp.y - 0.08, pp.z + nzz * (pp.width * 0.5 + 12), pp.heading)
          });
        }
        group.add(new THREE.Mesh(merge(traps), gravel));

        /* the old escape road and its barriers */
        var barrier = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.9 });
        var bits = [];
        for (var b = -6; b <= 6; b++) {
          var pb = at(s + b * 9);
          var nx2 = Math.cos(pb.heading) * side, nz2 = -Math.sin(pb.heading) * side;
          bits.push({
            geo: new THREE.BoxGeometry(0.4, 0.9, 9.2),
            matrix: M(pb.x + nx2 * (pb.width * 0.5 + 21), pb.y + 0.45, pb.z + nz2 * (pb.width * 0.5 + 21), pb.heading)
          });
        }
        group.add(new THREE.Mesh(merge(bits), barrier));
      })();

      /* ---------------- 4. grandstand banners -------------------------- */
      (function banners() {
        var c = cv(512, 128), x = c.getContext('2d');
        x.fillStyle = '#b3140f'; x.fillRect(0, 0, 512, 128);
        x.fillStyle = '#f4f1e8';
        x.font = '900 74px "Arial Narrow", Arial, sans-serif';
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText('FORZA FERRARI', 256, 68);
        var bannerTex = tex(c, aniso);
        var mat = new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.85, side: THREE.DoubleSide });
        /* hang one on the start straight main stand */
        for (var i = 0; i < 4; i++) {
          var p = at(40 + i * 300);
          var side = i % 2 ? -1 : 1;
          var off = p.width * 0.5 + 19;
          var m = new THREE.Mesh(new THREE.PlaneGeometry(26, 3.2), mat);
          m.position.set(p.x + Math.cos(p.heading) * side * off, p.y + 6.2, p.z - Math.sin(p.heading) * side * off);
          m.rotation.y = p.heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
          group.add(m);
        }
      })();

      return {
        group: group,
        update: function (dt, t) {
          for (var i = 0; i < anim.length; i++) {
            var a = anim[i];
            a.mesh.rotation.z = Math.sin(t * 1.8 + a.phase) * 0.12;
          }
        }
      };
    }
  };
})(window.F1 = window.F1 || {});
