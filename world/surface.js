/* ==========================================================================
   F1 2026 — world/surface.js
   The track surface itself: asphalt, rubber line, marbles, paint, kerbs,
   run-off, gravel. Built from the same centreline model the physics uses, so
   the visuals can never drift away from the collision surface.

     F1.surface.build(model, meta, opts) -> {
       group, setWetness(v), update(dt), materials, stats
     }

   Design notes
   ------------
   * Everything is a swept ribbon at true scale. Widths come from
     model.width[k], so a 12 m street and a 16 m park track both get 0.25 m
     lines and 1.2 m kerbs, not stretched textures.
   * Micro detail (aggregate, stone chips) tiles in metres. Macro detail
     (patches, repairs, rubber, marbles) comes from a per-lap "lap map" laid
     out across the *lap*, not across world space, so it can follow the
     racing line and never repeats.
   * Every map is sampled with anisotropy = preset anisotropy (16 on high).
   * Nothing is coplanar: paint sits on its own lifted geometry, kerbs are
     real extruded profiles with vertical sides, and no two surfaces share a
     depth value.
   ========================================================================== */
(function (F1) {
  'use strict';

  var TAU = Math.PI * 2;

  /* ------------------------------------------------------------------ */
  /* small helpers                                                       */
  /* ------------------------------------------------------------------ */
  function cv(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* cheap deterministic value noise (2D), 3 octaves */
  function makeNoise(seed) {
    var rnd = F1.rng(seed);
    var perm = new Uint8Array(512);
    for (var i = 0; i < 256; i++) perm[i] = i;
    for (var j = 255; j > 0; j--) {
      var k = Math.floor(rnd() * (j + 1));
      var t = perm[j]; perm[j] = perm[k]; perm[k] = t;
    }
    for (var m = 0; m < 256; m++) perm[m + 256] = perm[m];
    var grad = new Float32Array(256);
    for (var g = 0; g < 256; g++) grad[g] = rnd() * 2 - 1;
    function vn(x, y) {
      var xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
      var xf = x - Math.floor(x), yf = y - Math.floor(y);
      var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      var a = grad[perm[xi] + perm[yi] & 255];
      var b = grad[perm[xi + 1] + perm[yi] & 255];
      var c = grad[perm[xi] + perm[yi + 1] & 255];
      var d = grad[perm[xi + 1] + perm[yi + 1] & 255];
      return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
    }
    return function (x, y) {
      return vn(x, y) * 0.6 + vn(x * 2.13, y * 2.13) * 0.28 + vn(x * 4.37, y * 4.37) * 0.12;
    };
  }

  /* Sobel a greyscale canvas into a tangent-space normal map */
  function heightToNormal(heightCanvas, strength) {
    var w = heightCanvas.width, h = heightCanvas.height;
    var sctx = heightCanvas.getContext('2d');
    var src = sctx.getImageData(0, 0, w, h).data;
    var out = cv(w, h);
    var octx = out.getContext('2d');
    var img = octx.createImageData(w, h);
    var d = img.data;
    function hgt(x, y) {
      x = (x + w) % w; y = (y + h) % h;
      return src[(y * w + x) * 4] / 255;
    }
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var dx = (hgt(x + 1, y) - hgt(x - 1, y)) * strength;
        var dy = (hgt(x, y + 1) - hgt(x, y - 1)) * strength;
        var nx = -dx, ny = -dy, nz = 1;
        var len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        var i = (y * w + x) * 4;
        d[i] = Math.round((nx / len * 0.5 + 0.5) * 255);
        d[i + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
        d[i + 2] = Math.round((nz / len * 0.5 + 0.5) * 255);
        d[i + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  function texFrom(canvas, opts) {
    opts = opts || {};
    var t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = opts.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.anisotropy = opts.aniso || 8;
    if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
    t.needsUpdate = true;
    return t;
  }

  /* ------------------------------------------------------------------ */
  /* swept ribbon with lap coordinates                                   */
  /* ------------------------------------------------------------------ */
  /* Builds a strip that follows the centreline. `profileFn(k, wHalf)`
     returns an array of {off, y} in track space (off = lateral metres from
     the centreline, y = height above the centreline). Adjacent profile
     points form quads, so a 6-point profile gives a real 3D kerb. */
  function swept(model, profileFn, opts) {
    opts = opts || {};
    var step = opts.step || 2;
    var n = model.count;
    var origin = model.origin;
    var rows = [];
    var sAt = [];
    var sLen = 0;
    var prev = null;

    for (var i = 0; i <= n; i += step) {
      var k = i % n;
      var h = model.heading[k];
      var cos = Math.cos(h), sin = Math.sin(h);
      var cx = model.x[k] - origin.x, cz = model.z[k] - origin.z, cy = model.y[k];
      if (prev) sLen += Math.hypot(cx - prev.x, cz - prev.z);
      prev = { x: cx, z: cz };
      var prof = profileFn(k, model.width[k] * 0.5, sLen);
      var pts = [];
      for (var p = 0; p < prof.length; p++) {
        var q = prof[p];
        pts.push(cx + cos * q.off, cy + q.y, cz - sin * q.off);
      }
      rows.push(pts);
      sAt.push(sLen);
    }

    var cols = rows[0].length / 3;
    var pos = [], uv = [], idx = [], aLap = [], aAcross = [];
    var totalLen = sAt[sAt.length - 1] || 1;
    var vScale = opts.vScale || 1;         // metres per texture repeat along
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      for (var c = 0; c < cols; c++) {
        pos.push(row[c * 3], row[c * 3 + 1], row[c * 3 + 2]);
        uv.push(opts.uAcross ? (c / (cols - 1)) : (c / (cols - 1)), sAt[r] / vScale);
        aLap.push(sAt[r] / totalLen);
        aAcross.push(c / (cols - 1));
      }
    }
    for (var ri = 0; ri < rows.length - 1; ri++) {
      for (var ci = 0; ci < cols - 1; ci++) {
        var a = ri * cols + ci, b = a + 1, d2 = a + cols, e = d2 + 1;
        /* keep the winding consistent: normal must point up/out */
        idx.push(a, b, e, a, e, d2);
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('aLap', new THREE.Float32BufferAttribute(aLap, 1));
    geo.setAttribute('aAcross', new THREE.Float32BufferAttribute(aAcross, 1));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    /* if the normals came out pointing down, flip the index order */
    var nr = geo.attributes.normal;
    var sum = 0;
    for (var vv = 0; vv < nr.count; vv++) sum += nr.getY(vv);
    if (sum < 0) {
      var ia = geo.getIndex().array;
      for (var t2 = 0; t2 < ia.length; t2 += 3) {
        var tmp = ia[t2 + 1]; ia[t2 + 1] = ia[t2 + 2]; ia[t2 + 2] = tmp;
      }
      geo.getIndex().needsUpdate = true;
      geo.computeVertexNormals();
    }
    geo.computeBoundingSphere();
    return geo;
  }

  /* ------------------------------------------------------------------ */
  /* asphalt micro texture: albedo + height->normal + roughness          */
  /* ------------------------------------------------------------------ */
  function aggregateMaps(size) {
    size = size || 512;
    var c = cv(size, size), ctx = c.getContext('2d');
    var hc = cv(size, size), hctx = hc.getContext('2d');
    var rc = cv(size, size), rctx = rc.getContext('2d');
    var rnd = F1.rng(0x5eed11);

    ctx.fillStyle = '#41464d';
    ctx.fillRect(0, 0, size, size);
    hctx.fillStyle = '#6a6a6a';
    hctx.fillRect(0, 0, size, size);
    rctx.fillStyle = '#c8c8c8';
    rctx.fillRect(0, 0, size, size);

    /* coarse chippings */
    for (var i = 0; i < size * 14; i++) {
      var x = rnd() * size, y = rnd() * size;
      var rad = 0.45 + rnd() * 1.5;
      var g = 92 + rnd() * 44;
      ctx.fillStyle = 'rgba(' + Math.round(g) + ',' + Math.round(g + 1) + ',' + Math.round(g + 4) + ',' + (0.14 + rnd() * 0.26) + ')';
      ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill();
      var hg = 105 + rnd() * 110;
      hctx.fillStyle = 'rgb(' + Math.round(hg) + ',' + Math.round(hg) + ',' + Math.round(hg) + ')';
      hctx.beginPath(); hctx.arc(x, y, rad, 0, TAU); hctx.fill();
      var rgh = 150 + rnd() * 95;
      rctx.fillStyle = 'rgba(' + Math.round(rgh) + ',' + Math.round(rgh) + ',' + Math.round(rgh) + ',0.6)';
      rctx.beginPath(); rctx.arc(x, y, rad, 0, TAU); rctx.fill();
    }
    /* bitumen sheen blobs + fine sand */
    for (var s = 0; s < size * 1.6; s++) {
      var gg = 78 + rnd() * 22;
      ctx.fillStyle = 'rgba(' + Math.round(gg) + ',' + Math.round(gg) + ',' + Math.round(gg + 2) + ',0.35)';
      var r2 = 2 + rnd() * 7;
      ctx.beginPath(); ctx.arc(rnd() * size, rnd() * size, r2, 0, TAU); ctx.fill();
    }
    for (var f = 0; f < size * 26; f++) {
      var fg = 120 + rnd() * 55;
      ctx.fillStyle = 'rgba(' + Math.round(fg) + ',' + Math.round(fg) + ',' + Math.round(fg) + ',' + (0.12 + rnd() * 0.2) + ')';
      ctx.fillRect(rnd() * size, rnd() * size, 1, 1);
    }
    return {
      albedo: texFrom(c, { repeat: [1, 1], aniso: 16 }),
      normal: texFrom(heightToNormal(hc, 1.15), { data: true, repeat: [1, 1], aniso: 16 }),
      rough: texFrom(rc, { data: true, repeat: [1, 1], aniso: 16 })
    };
  }

  /* ------------------------------------------------------------------ */
  /* lap map: rubber line, marbles, patches, repairs                     */
  /* ------------------------------------------------------------------ */
  /* One texel column spans the full track width; rows run around the lap.
     The racing line is approximated from curvature and then smoothed, which
     is enough to put the rubber where the eye expects it. */
  function lapMap(model, meta, opts) {
    var W = 512, H = 2048;
    var c = cv(W, H), ctx = c.getContext('2d');
    var n = model.count;
    var rnd = F1.rng(hashStr(meta.id + '|laps'));
    var noise = makeNoise(hashStr(meta.id + '|lapn'));

    /* ---- 1. base macro variation: broad patches of newer/older asphalt */
    var img = ctx.createImageData(W, H);
    var d = img.data;
    for (var y = 0; y < H; y++) {
      var fy = y / H;
      for (var x = 0; x < W; x++) {
        var fx = x / W;
        var v = 0.5 + noise(fx * 3.1, fy * 26) * 0.5;
        var v2 = 0.5 + noise(fx * 9.3 + 11, fy * 90 + 7) * 0.5;
        var lum = 0.90 + v * 0.12 + (v2 - 0.5) * 0.07;
        var i = (y * W + x) * 4;
        d[i] = Math.min(255, Math.round(lum * 255));
        d[i + 1] = Math.min(255, Math.round(lum * 255));
        d[i + 2] = Math.min(255, Math.round(lum * 254));
        /* canvas2D stores premultiplied: alpha 0 would erase the RGB */
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    /* sample helpers along the lap */
    function sampleAt(f) {
      var k = Math.round(((f % 1) + 1) % 1 * (n - 1));
      return k;
    }
    function halfWidth(k) { return model.width[k] * 0.5; }
    function curv(k) { return model.curvature ? model.curvature[k] : 0; }

    /* ---- 2. racing line: inside of the corner, blended by curvature ---- */
    var line = new Float32Array(H);
    var raw = new Float32Array(H);
    for (var r = 0; r < H; r++) {
      var k = sampleAt(r / H);
      var w = halfWidth(k);
      var cu = curv(k);
      var amt = Math.min(1, Math.abs(cu) * 120);
      raw[r] = -Math.sign(cu) * w * 0.62 * amt;
    }
    /* heavy box blur along the lap → a smooth, drivable line */
    var blur = 42;
    for (var r2 = 0; r2 < H; r2++) {
      var acc = 0, cnt = 0;
      for (var o = -blur; o <= blur; o += 3) {
        acc += raw[((r2 + o) % H + H) % H]; cnt++;
      }
      line[r2] = acc / cnt;
    }

    /* ---- 3. rubber + marbles, painted row by row ---------------------- */
    var ink = ctx.getImageData(0, 0, W, H);
    var dd = ink.data;
    for (var row = 0; row < H; row++) {
      var f2 = row / H;
      var kk = sampleAt(f2);
      var half = halfWidth(kk);
      var cu2 = Math.abs(curv(kk));
      var lineM = line[row];
      /* rubber is darkest where the tyre actually loads the surface */
      var brake = 0.55 + Math.min(1, cu2 * 150) * 0.45;
      for (var col = 0; col < W; col++) {
        var across = (col / (W - 1)) * 2 - 1;      // -1..1
        var m = across * half;
        var dist = Math.abs(m - lineM);
        var rubber = Math.exp(-(dist * dist) / 0.85) * 0.72 * brake;
        /* marbles: gritty light band outside the racing line on corner exit */
        var marbleBand = Math.max(0, (Math.abs(m) - half * 0.66) / (half * 0.34));
        var marble = marbleBand * marbleBand * (0.06 + 0.16 * Math.max(0, noise(across * 30, f2 * 260) + 0.4));
        var i2 = (row * W + col) * 4;
        /* rubber also darkens the albedo; store that in RGB */
        var dark = 1 - rubber * 0.26 - marble * 0.10;
        dd[i2] = Math.round(dd[i2] * dark);
        dd[i2 + 1] = Math.round(dd[i2 + 1] * dark);
        dd[i2 + 2] = Math.round(dd[i2 + 2] * (dark - 0.006));
        dd[i2 + 3] = 255;
      }
    }
    ctx.putImageData(ink, 0, 0);

    /* ---- 4. repair patches and tar seams ------------------------------ */
    var patches = 9 + Math.floor(rnd() * 6);
    for (var p = 0; p < patches; p++) {
      var py = rnd() * H;
      var ph = 12 + rnd() * 90;
      var px = rnd() * W * 0.7;
      var pw = W * (0.15 + rnd() * 0.35);
      ctx.fillStyle = 'rgba(' + (18 + rnd() * 22) + ',' + (18 + rnd() * 22) + ',' + (20 + rnd() * 22) + ',0.20)';
      ctx.fillRect(px, py, pw, ph);
    }
    /* longitudinal construction joints */
    ctx.strokeStyle = 'rgba(20,20,22,0.28)';
    for (var j = 0; j < 3; j++) {
      ctx.lineWidth = 1 + rnd() * 2;
      ctx.beginPath();
      var jx = W * (0.25 + rnd() * 0.5);
      ctx.moveTo(jx, 0);
      for (var yy = 0; yy <= H; yy += 32) {
        ctx.lineTo(jx + Math.sin(yy * 0.01 + j) * 6 + (rnd() - 0.5) * 3, yy);
      }
      ctx.stroke();
    }

    var t = texFrom(c, { aniso: opts.aniso || 16 });
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  /* ------------------------------------------------------------------ */
  /* asphalt material                                                    */
  /* ------------------------------------------------------------------ */
  function asphaltMaterial(maps, lapTex, wet) {
    var mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: maps.albedo,
      normalMap: maps.normal,
      roughnessMap: maps.rough,
      roughness: 0.94,
      metalness: 0.02,
      normalScale: new THREE.Vector2(0.58, 0.58),
      envMapIntensity: 1.05,
      dithering: true
    });
    maps.albedo.repeat.set(3, 1);
    maps.normal.repeat.set(3, 1);
    maps.rough.repeat.set(3, 1);

    mat.userData.wet = wet;
    mat.onBeforeCompile = function (shader) {
      shader.uniforms.uLap = { value: lapTex };
      shader.uniforms.uWet = wet;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>',
          '#include <common>\nattribute float aLap;\nattribute float aAcross;\nvarying vec2 vLapUv;')
        .replace('#include <begin_vertex>',
          '#include <begin_vertex>\nvLapUv = vec2(aAcross, aLap);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>',
          '#include <common>\nuniform sampler2D uLap;\nuniform float uWet;\nvarying vec2 vLapUv;')
        .replace('#include <map_fragment>',
          '#include <map_fragment>\n' +
          'vec4 lapS = texture2D(uLap, vLapUv);\n' +
          'float lapLum = dot(lapS.rgb, vec3(0.2126, 0.7152, 0.0722));\n' +
          'float rubberM = smoothstep(0.62, 0.34, lapLum);\n' +
          'diffuseColor.rgb *= lapS.rgb;\n' +
          'diffuseColor.rgb *= mix(1.0, 0.60, uWet);')
        .replace('#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\n' +
          'roughnessFactor = mix(roughnessFactor, 0.26, rubberM * 0.85);\n' +
          'roughnessFactor = mix(roughnessFactor, 0.08, uWet);');
      mat.userData.shader = shader;
    };
    mat.customProgramCacheKey = function () { return 'f1-asphalt'; };
    return mat;
  }

  /* ------------------------------------------------------------------ */
  /* paint decals                                                        */
  /* ------------------------------------------------------------------ */
  function paintMaterial(color, opts) {
    opts = opts || {};
    return new THREE.MeshStandardMaterial({
      color: color,
      roughness: opts.roughness !== undefined ? opts.roughness : 0.62,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      side: THREE.DoubleSide
    });
  }

  /* ------------------------------------------------------------------ */
  /* main                                                                */
  /* ------------------------------------------------------------------ */
  F1.surface = {};

  F1.surface.build = function (model, meta, opts) {
    opts = opts || {};
    var q = opts.quality || (F1.settings ? F1.settings.preset() : {});
    var aniso = q.anisotropy || 8;
    var theme = meta.theme || {};
    var rnd = F1.rng(hashStr(meta.id + '|surf'));
    var group = new THREE.Group();
    group.name = 'surface';
    var stats = { tris: 0, meshes: 0 };

    function add(mesh, name) {
      if (name) mesh.name = name;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      if (mesh.geometry) {
        mesh.geometry.computeBoundingSphere();
        stats.tris += (mesh.geometry.index ? mesh.geometry.index.count / 3 : 0);
      }
      stats.meshes++;
      group.add(mesh);
      return mesh;
    }

    /* ---------------- asphalt ---------------------------------------- */
    var maps = aggregateMaps(512);
    maps.albedo.anisotropy = aniso;
    maps.normal.anisotropy = aniso;
    maps.rough.anisotropy = aniso;
    var lapTex = lapMap(model, meta, { aniso: Math.max(4, Math.min(aniso, 8)) });
    var wetUniform = { value: 0 };
    var roadMat = asphaltMaterial(maps, lapTex, wetUniform);

    var roadGeo = swept(model, function (k, w) {
      return [{ off: -w, y: 0 }, { off: -w * 0.5, y: 0.012 }, { off: 0, y: 0.02 },
              { off: w * 0.5, y: 0.012 }, { off: w, y: 0 }];
    }, { step: 2, vScale: 9 });
    var road = new THREE.Mesh(roadGeo, roadMat);
    road.receiveShadow = true;
    road.name = 'asphalt';
    add(road);

    /* ---------------- white edge lines -------------------------------- */
    var whiteMat = paintMaterial(0xe9e9e4, { roughness: 0.55 });
    var lineGeoR = swept(model, function (k, w) {
      return [{ off: w - 0.30, y: 0.018 }, { off: w - 0.02, y: 0.018 }];
    }, { step: 2, vScale: 6 });
    var lineGeoL = swept(model, function (k, w) {
      return [{ off: -w + 0.02, y: 0.018 }, { off: -w + 0.30, y: 0.018 }];
    }, { step: 2, vScale: 6 });
    add(new THREE.Mesh(lineGeoR, whiteMat), 'lineR');
    add(new THREE.Mesh(lineGeoL, whiteMat), 'lineL');

    /* ---------------- kerbs ------------------------------------------- */
    /* Kerb style per sample: chicanes and slow corners get a raised
       sawtooth, fast corners a flat painted strip. The profiles below are
       real cross-sections in metres, swept along the lap. */
    var kerbKind = function (k) {
      var cu = Math.abs(model.curvature ? model.curvature[k] : 0);
      if (cu > 1 / 45) return 2;      // chicane / hairpin: raised sawtooth
      if (cu > 1 / 110) return 1;     // medium: raised flat top
      return 0;                       // fast: flat strip
    };
    var kerbTex = (function () {
      var c = cv(8, 128), ctx = c.getContext('2d');
      var accent = theme.accent || '#E10600';
      ctx.fillStyle = accent; ctx.fillRect(0, 0, 8, 64);
      ctx.fillStyle = '#f2f2ee'; ctx.fillRect(0, 64, 8, 64);
      /* scuffed paint */
      var rk = F1.rng(99);
      for (var i = 0; i < 90; i++) {
        ctx.fillStyle = 'rgba(30,30,30,' + (0.05 + rk() * 0.16) + ')';
        ctx.fillRect(rk() * 8, rk() * 128, 1 + rk() * 2, 1 + rk() * 6);
      }
      return texFrom(c, { repeat: [1, 1], aniso: aniso });
    })();

    var kerbMat = new THREE.MeshStandardMaterial({
      map: kerbTex, roughness: 0.66, metalness: 0.02, side: THREE.DoubleSide
    });

    function kerbProfile(side) {
      return function (k, wHalf) {
        var kind = kerbKind(k);
        var s = side;
        if (kind === 0) {
          return [
            { off: s * (wHalf - 0.02), y: 0.019 },
            { off: s * (wHalf + 0.55), y: 0.05 },
            { off: s * (wHalf + 1.05), y: 0.05 },
            { off: s * (wHalf + 1.18), y: 0.012 }
          ];
        }
        if (kind === 1) {
          return [
            { off: s * (wHalf - 0.02), y: 0.019 },
            { off: s * (wHalf + 0.18), y: 0.075 },
            { off: s * (wHalf + 0.95), y: 0.075 },
            { off: s * (wHalf + 1.20), y: 0.010 }
          ];
        }
        /* raised sawtooth: three ridges along the kerb */
        return [
          { off: s * (wHalf - 0.02), y: 0.019 },
          { off: s * (wHalf + 0.16), y: 0.10 },
          { off: s * (wHalf + 0.30), y: 0.055 },
          { off: s * (wHalf + 0.48), y: 0.10 },
          { off: s * (wHalf + 0.64), y: 0.055 },
          { off: s * (wHalf + 0.86), y: 0.10 },
          { off: s * (wHalf + 1.02), y: 0.06 },
          { off: s * (wHalf + 1.22), y: 0.010 }
        ];
      };
    }
    [-1, 1].forEach(function (side) {
      var geo = swept(model, kerbProfile(side), { step: 2, vScale: 2.0 });
      var m = new THREE.Mesh(geo, kerbMat);
      m.castShadow = true; m.receiveShadow = true;
      add(m, 'kerb' + (side > 0 ? 'R' : 'L'));
    });

    /* ---------------- run-off: gravel + asphalt apron ------------------ */
    var isDesert = theme.style === 'desert';
    var gravelTex = F1.world && F1.world.textures ? F1.world.textures.gravel() : null;
    var gravelMat = new THREE.MeshStandardMaterial({
      color: isDesert ? 0xd8c9a6 : 0xc3b49c,
      map: gravelTex,
      roughness: 1, metalness: 0,
      side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    });
    if (gravelTex) { gravelTex.repeat.set(3, 3); gravelTex.anisotropy = aniso; }

    /* a 2.4 m mown verge all the way round, then traps where the car can
       actually go off */
    var vergeMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(F1.util.mixHex(theme.ground || '#3f6836', '#8aa86a', 0.35)),
      map: F1.world && F1.world.textures ? F1.world.textures.grass() : null,
      roughness: 1, metalness: 0, side: THREE.DoubleSide
    });
    if (vergeMat.map) { vergeMat.map = vergeMat.map.clone(); vergeMat.map.repeat.set(1, 1); vergeMat.map.anisotropy = aniso; vergeMat.map.needsUpdate = true; }

    var vergeGeoR = swept(model, function (k, w) { return [{ off: w + 1.2, y: -0.02 }, { off: w + 3.6, y: -0.06 }]; }, { step: 3, vScale: 7 });
    var vergeGeoL = swept(model, function (k, w) { return [{ off: -w - 3.6, y: -0.06 }, { off: -w - 1.2, y: -0.02 }]; }, { step: 3, vScale: 7 });
    add(new THREE.Mesh(vergeGeoR, vergeMat));
    add(new THREE.Mesh(vergeGeoL, vergeMat));

    /* gravel traps: outside of slow/medium corners, where cars run wide */
    var trapSpans = [];
    var run = 0;
    for (var i = 0; i < model.count; i++) {
      var cu = Math.abs(model.curvature ? model.curvature[i] : 0);
      var outside = model.curvature && model.curvature[i] > 0 ? -1 : 1;
      if (cu > 1 / 150) {
        if (!run) run = { from: i, side: outside };
        run.to = i;
      } else if (run) {
        if (run.to - run.from > 12) trapSpans.push(run);
        run = 0;
      }
    }
    if (run && run.to - run.from > 12) trapSpans.push(run);

    trapSpans.slice(0, 6).forEach(function (tr) {
      var a = tr.from, b = tr.to;
      var side = tr.side;
      var geo = swept(model, function (k, w) {
        if (k < a || k > b) return [{ off: side * (w + 3.4), y: -0.055 }, { off: side * (w + 3.5), y: -0.055 }];
        return [
          { off: side * (w + 3.3), y: -0.045 },
          { off: side * (w + 9.5), y: -0.075 },
          { off: side * (w + 17), y: -0.09 }
        ];
      }, { step: 2, vScale: 6 });
      var m = new THREE.Mesh(geo, gravelMat);
      m.receiveShadow = true;
      add(m, 'gravel');
    });

    /* ---------------- start / finish and grid ------------------------- */
    var paint = new THREE.Group();
    paint.name = 'paint';
    var atFunc = model.at;
    function placeAt(s, lat, y) {
      var p = atFunc(s, {});
      return {
        x: p.x - model.origin.x + Math.cos(p.heading) * lat,
        y: p.y + (y || 0),
        z: p.z - model.origin.z - Math.sin(p.heading) * lat,
        h: p.heading, w: p.width
      };
    }

    /* flat quads laid straight onto the track: built in world space from the
       centreline, so there is no rotation-order guesswork and the paint
       always follows the tarmac exactly. */
    function flatQuad(s0, s1, lat0, lat1, y) {
      var p0 = atFunc(s0, {}), p1 = atFunc(s1, {});
      var o = model.origin;
      var c0 = Math.cos(p0.heading), s0n = Math.sin(p0.heading);
      var c1 = Math.cos(p1.heading), s1n = Math.sin(p1.heading);
      var ax = p0.x - o.x + c0 * lat0, az = p0.z - o.z - s0n * lat0;
      var bx = p0.x - o.x + c0 * lat1, bz = p0.z - o.z - s0n * lat1;
      var cx = p1.x - o.x + c1 * lat0, cz = p1.z - o.z - s1n * lat0;
      var dx = p1.x - o.x + c1 * lat1, dz = p1.z - o.z - s1n * lat1;
      var ya = p0.y + y, yb = p1.y + y;
      var pos = [ax, ya, az, bx, ya, bz, dx, yb, dz, cx, yb, cz];
      var uv = [0, 0, 1, 0, 1, 1, 0, 1];
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      g.computeVertexNormals();
      return g;
    }

    /* chequered start/finish band, 2 rows deep */
    (function () {
      var cols = 22, rows = 2;
      var p = atFunc(0, {});
      var w = p.width - 0.1;
      var cell = w / cols;
      var c = cv(512, 64), ctx = c.getContext('2d');
      var cw = 512 / cols;
      for (var yy = 0; yy < rows; yy++) {
        for (var xx = 0; xx < cols; xx++) {
          ctx.fillStyle = (xx + yy) % 2 ? '#0c0c10' : '#f4f4ef';
          ctx.fillRect(xx * cw, yy * 32, cw + 0.5, 32);
        }
      }
      var t = texFrom(c, { aniso: aniso });
      var mat = paintMaterial(0xffffff, { roughness: 0.5 });
      mat.map = t;
      var g = flatQuad(-cell * rows * 0.5, cell * rows * 0.5, -w / 2, w / 2, 0.021);
      add(new THREE.Mesh(g, mat), 'startLine');
      group.add(group.children[group.children.length - 1]);
    })();

    /* grid slots: the painted "T" boxes, drawn as thin bars */
    (function () {
      var white = paintMaterial(0xe8e8e2, { roughness: 0.6 });
      var boxes = 10;
      for (var i = 0; i < boxes; i++) {
        var s = 34 + i * 16;
        var side = i % 2 ? 1 : -1;
        var pw = atFunc(s, {}).width;
        var lat = side * pw * 0.2;
        /* two front bars + a centre stem, like a real grid slot */
        [[lat - 0.95, lat - 0.75], [lat + 0.75, lat + 0.95]].forEach(function (r) {
          var m = new THREE.Mesh(flatQuad(s - 1.15, s - 0.95, r[0], r[1], 0.02), white);
          group.add(m);
        });
        var stem = new THREE.Mesh(flatQuad(s - 0.98, s + 1.0, lat - 0.1, lat + 0.1, 0.02), white);
        group.add(stem);
      }
    })();

    /* ---------------- wetness ---------------------------------------- */
    function setWetness(v) {
      v = Math.max(0, Math.min(1, v));
      wetUniform.value = v;
      gravelMat.color.setHex(v > 0.5 ? 0x8f8676 : (isDesert ? 0xd8c9a6 : 0xc3b49c));
      roadMat.envMapIntensity = 1.05 + v * 0.9;
    }

    group.traverse(function (o) {
      if (o.isMesh) { o.matrixAutoUpdate = false; o.updateMatrix(); }
    });

    return {
      group: group,
      setWetness: setWetness,
      materials: { road: roadMat, kerb: kerbMat, gravel: gravelMat, white: whiteMat },
      stats: stats,
      update: function () {}
    };
  };
})(window.F1 = window.F1 || {});
