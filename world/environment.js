/* ==========================================================================
   F1 2026 — world/environment.js
   Procedural circuit environment built from a track model (physics/track.js)
   plus the per-circuit theme in data/circuits/index.js.

   Everything is procedural and merged/instanced to stay inside the draw-call
   budget:
     road + kerbs + white lines + run-off   -> 1 mesh each (ribbon geometry)
     barriers / tyre walls / marshal posts  -> InstancedMesh
     grandstands + crowd                    -> merged geometry + 1 instanced crowd
     pit building, gantries, pit lane walls -> merged geometry
     trees / floodlights / palm / pylons    -> InstancedMesh per type
     landmarks (harbour, dunes, sphere, ...) -> a handful of meshes

   F1.world.build(trackModel, meta) -> {
     group,           // add to scene
     lights, sky, sun,
     update(dt),      // animated bits (crowd noise, neon flicker, flags)
     setTimeOfDay(mode), setWeather(state),
     dispose()
   }
   ========================================================================== */
(function (F1) {
  'use strict';

  var TAU = Math.PI * 2;

  /* ================================================================== */
  /* canvas texture factory                                             */
  /* ================================================================== */
  var TEXCACHE = {};

  var ORIGIN = { x: 0, z: 0 };
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

  function tex(name, draw, opts) {
    if (TEXCACHE[name]) return TEXCACHE[name];
    opts = opts || {};
    var c = cv(opts.w || 256, opts.h || 256);
    var ctx = c.getContext('2d');
    var rnd = F1.rng(hashStr(name));
    draw(ctx, c.width, c.height, rnd);
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = opts.aniso || 4;
    if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
    TEXCACHE[name] = t;
    return t;
  }

  function noise(ctx, w, h, rnd, amt, alpha) {
    var img = ctx.getImageData(0, 0, w, h);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var n = (rnd() - 0.5) * amt;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
      if (alpha !== undefined) d[i + 3] = alpha;
    }
    ctx.putImageData(img, 0, 0);
  }

  var Textures = {
    asphalt: function (tint) {
      return tex('asphalt' + tint, function (ctx, w, h, rnd) {
        ctx.fillStyle = tint || '#8b8f96';
        ctx.fillRect(0, 0, w, h);
        // aggregate speckle
        for (var i = 0; i < 2600; i++) {
          var g = 90 + rnd() * 80;
          ctx.fillStyle = 'rgba(' + g + ',' + g + ',' + (g + 4) + ',' + (0.05 + rnd() * 0.25) + ')';
          var r = 0.6 + rnd() * 1.9;
          ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, r, 0, TAU); ctx.fill();
        }
        // tarmac seams
        ctx.strokeStyle = 'rgba(24,24,26,0.16)';
        ctx.lineWidth = 1;
        for (var s = 0; s < 2; s++) {
          ctx.beginPath();
          var y = rnd() * h;
          ctx.moveTo(0, y);
          ctx.bezierCurveTo(w * 0.3, y + (rnd() - 0.5) * 20, w * 0.7, y + (rnd() - 0.5) * 20, w, y + (rnd() - 0.5) * 12);
          ctx.stroke();
        }
        noise(ctx, w, h, rnd, 14);
      }, { w: 512, h: 512, repeat: [1, 6] });
    },
    grass: function () {
      return tex('grass', function (ctx, w, h, rnd) {
        ctx.fillStyle = '#9fbf8f';
        ctx.fillRect(0, 0, w, h);
        for (var i = 0; i < 5000; i++) {
          var g = 110 + rnd() * 90;
          ctx.fillStyle = 'rgba(' + Math.round(g * 0.6) + ',' + Math.round(g + 20) + ',' + Math.round(g * 0.5) + ',' + (0.15 + rnd() * 0.4) + ')';
          ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 3);
        }
        noise(ctx, w, h, rnd, 18);
      }, { repeat: [24, 24] });
    },
    gravel: function () {
      return tex('gravel', function (ctx, w, h, rnd) {
        ctx.fillStyle = '#b3aa99';
        ctx.fillRect(0, 0, w, h);
        for (var i = 0; i < 3000; i++) {
          var g = 90 + rnd() * 90;
          ctx.fillStyle = 'rgba(' + g + ',' + (g - 6) + ',' + (g - 18) + ',' + (0.3 + rnd() * 0.5) + ')';
          ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, 1 + rnd() * 2.4, 0, TAU); ctx.fill();
        }
        noise(ctx, w, h, rnd, 20);
      }, { repeat: [10, 10] });
    },
    sand: function () {
      return tex('sand', function (ctx, w, h, rnd) {
        ctx.fillStyle = '#b9a179';
        ctx.fillRect(0, 0, w, h);
        for (var i = 0; i < 2200; i++) {
          var g = 140 + rnd() * 70;
          ctx.fillStyle = 'rgba(' + g + ',' + (g - 14) + ',' + (g - 44) + ',' + (0.2 + rnd() * 0.35) + ')';
          ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
        }
        noise(ctx, w, h, rnd, 12);
      }, { repeat: [16, 16] });
    },
    concrete: function () {
      return tex('concrete', function (ctx, w, h, rnd) {
        ctx.fillStyle = '#b7bcc2';
        ctx.fillRect(0, 0, w, h);
        for (var i = 0; i < 1400; i++) {
          ctx.fillStyle = 'rgba(255,255,255,' + (rnd() * 0.09) + ')';
          ctx.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 6, 2 + rnd() * 6);
        }
        /* grime and rain streaks: what a 30-year-old Monza wall looks like */
        for (var g2 = 0; g2 < 90; g2++) {
          ctx.fillStyle = 'rgba(70,68,62,' + (0.03 + rnd() * 0.07) + ')';
          ctx.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 14, 8 + rnd() * 60);
        }
        ctx.strokeStyle = 'rgba(96,100,104,0.55)';
        ctx.lineWidth = 2;
        for (var x = 0; x < w; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
        for (var y = 0; y < h; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
        noise(ctx, w, h, rnd, 12);
      }, { repeat: [6, 1] });
    },
    kerb: function (col) {
      // 8 blocks stacked along V so they read as alternating blocks as the
      // car drives over them (U runs across the 1.2 m kerb width)
      return tex('kerb' + col, function (ctx, w, h) {
        var n = 8;
        for (var i = 0; i < n; i++) {
          ctx.fillStyle = i % 2 ? '#f2f2f2' : col;
          ctx.fillRect(0, (i / n) * h, w, h / n);
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.12)';
        ctx.lineWidth = 1;
        for (var j = 0; j <= n; j++) {
          ctx.beginPath(); ctx.moveTo(0, (j / n) * h); ctx.lineTo(w, (j / n) * h); ctx.stroke();
        }
      }, { w: 64, h: 256, repeat: [1, 1] });
    },
    tyreWall: function () {
      return tex('tyrewall', function (ctx, w, h, rnd) {
        ctx.fillStyle = '#141416';
        ctx.fillRect(0, 0, w, h);
        var r = 12;
        for (var y = 0; y < h; y += r * 1.7) {
          for (var x = ((y / (r * 1.7)) % 2) * r; x < w; x += r * 2.1) {
            var g = 20 + rnd() * 26;
            ctx.fillStyle = 'rgb(' + g + ',' + g + ',' + (g + 2) + ')';
            ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke();
          }
        }
      }, { w: 256, h: 128, repeat: [1, 1] });
    },
    crowd: function () {
      return tex('crowd', function (ctx, w, h, rnd) {
        ctx.fillStyle = '#1b1f26';
        ctx.fillRect(0, 0, w, h);
        var cols = ['#e8e8e8', '#e10600', '#ff8000', '#ffd400', '#00a19b', '#1868db', '#b25cff', '#2d6a4f'];
        for (var i = 0; i < 2600; i++) {
          ctx.fillStyle = cols[Math.floor(rnd() * cols.length)];
          ctx.globalAlpha = 0.45 + rnd() * 0.5;
          var x = rnd() * w, y = rnd() * h;
          ctx.fillRect(x, y, 1 + rnd() * 2.6, 1 + rnd() * 3.4);
        }
        ctx.globalAlpha = 1;
      }, { repeat: [1, 1] });
    },
    facade: function (glass) {
      return tex('facade' + (glass ? 'g' : 'c'), function (ctx, w, h, rnd) {
        ctx.fillStyle = glass ? '#1a2430' : '#3b4048';
        ctx.fillRect(0, 0, w, h);
        var cols = Math.floor(w / 16), rows = Math.floor(h / 16);
        for (var y = 0; y < rows; y++) {
          for (var x = 0; x < cols; x++) {
            var lit = rnd();
            if (glass) {
              ctx.fillStyle = lit > 0.82 ? 'rgba(255,236,190,' + (0.5 + rnd() * 0.5) + ')' : 'rgba(90,130,160,' + (0.08 + rnd() * 0.16) + ')';
            } else {
              ctx.fillStyle = 'rgba(200,210,220,' + (0.04 + rnd() * 0.08) + ')';
            }
            ctx.fillRect(x * 16 + 2, y * 16 + 2, 12, 11);
          }
        }
        noise(ctx, w, h, rnd, 10);
      }, { repeat: [1, 1] });
    },
    billboard: function (text, bg, fg) {
      return tex('bb' + text + bg, function (ctx, w, h) {
        ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = fg;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        var size = 120;
        ctx.font = 'italic 900 ' + size + 'px "Arial Narrow", Arial, sans-serif';
        while (ctx.measureText(text).width > w * 0.86 && size > 20) {
          size -= 6;
          ctx.font = 'italic 900 ' + size + 'px "Arial Narrow", Arial, sans-serif';
        }
        ctx.fillText(text, w / 2, h / 2);
      }, { w: 512, h: 128 });
    }
  };

  /* ================================================================== */
  /* geometry helpers                                                    */
  /* ================================================================== */
  function mergeNonIndexed(list) {
    // list: [{geo, matrix}] -> single BufferGeometry (position/normal/uv)
    var pos = [], nor = [], uv = [];
    var tmp = new THREE.Matrix3();
    list.forEach(function (item) {
      var g = item.geo.index ? item.geo.toNonIndexed() : item.geo;
      var p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
      tmp.getNormalMatrix(item.matrix);
      var v = new THREE.Vector3();
      for (var i = 0; i < p.count; i++) {
        v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(item.matrix);
        pos.push(v.x, v.y, v.z);
        if (n) { v.set(n.getX(i), n.getY(i), n.getZ(i)).applyMatrix3(tmp).normalize(); nor.push(v.x, v.y, v.z); }
        else nor.push(0, 1, 0);
        if (u) uv.push(u.getX(i), u.getY(i)); else uv.push(0, 0);
      }
    });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return geo;
  }

  var _m4 = new THREE.Matrix4();
  var _q = new THREE.Quaternion();
  var _v = new THREE.Vector3();
  var _s = new THREE.Vector3(1, 1, 1);
  function mat(x, y, z, rx, ry, rz) {
    _q.setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0));
    return _m4.clone().compose(_v.set(x, y, z), _q, _s);
  }

  /* Build a surface ribbon (road / kerb / run-off) along the track between two
     lateral offsets, following elevation + banking.

     Every quad is wound independently: the correct winding is chosen from the
     cross product of the quad edges, so the surface normal always faces up
     whatever the direction of travel or the sign of the lateral offsets. */
  function ribbon(model, latA, latB, opts) {
    opts = opts || {};
    var n = model.count;
    var step = opts.step || 2;
    var pos = [], uv = [], idx = [];
    var vLen = 0;
    var prev = null;
    var rows = [];

    for (var i = 0; i <= n; i += step) {
      var k = i % n;
      var h = model.heading[k];
      var cos = Math.cos(h), sin = Math.sin(h);
      var bank = model.banking[k] || 0;
      var wHalf = model.width[k] * 0.5;
      var la = typeof latA === 'function' ? latA(k, wHalf) : latA;
      var lb = typeof latB === 'function' ? latB(k, wHalf) : latB;
      var cx = model.x[k] - ORIGIN.x, cz = model.z[k] - ORIGIN.z, cy = model.y[k];
      var yA = opts.yA ? opts.yA(k, la) : cy + Math.tan(bank) * la + (opts.lift || 0);
      var yB = opts.yB ? opts.yB(k, lb) : cy + Math.tan(bank) * lb + (opts.lift || 0);
      var ax = cx + cos * la, az = cz - sin * la;
      var bx = cx + cos * lb, bz = cz - sin * lb;
      if (prev) vLen += Math.hypot(cx - prev.x, cz - prev.z);
      prev = { x: cx, z: cz };
      rows.push({ ax: ax, ay: yA, az: az, bx: bx, by: yB, bz: bz, v: vLen });
    }

    var rep = opts.uvLength || 12;
    for (var r = 0; r < rows.length; r++) {
      var rw = rows[r];
      pos.push(rw.ax, rw.ay, rw.az, rw.bx, rw.by, rw.bz);
      uv.push(0, rw.v / rep, 1, rw.v / rep);
    }
    for (var q = 0; q < rows.length - 1; q++) {
      var p0 = rows[q], p1 = rows[q + 1];
      var a = q * 2, b = q * 2 + 1, c = q * 2 + 2, d = q * 2 + 3;
      // normal of (A0 -> B0 -> B1): if it points down, flip this quad
      var e1x = p0.bx - p0.ax, e1y = p0.by - p0.ay, e1z = p0.bz - p0.az;
      var e2x = p1.bx - p0.ax, e2y = p1.by - p0.ay, e2z = p1.bz - p0.az;
      var ny = e1z * e2x - e1x * e2z;   // y component of e1 x e2
      if (ny >= 0) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /* a ribbon built left-to-right can end up wound the wrong way round for a
     clockwise track; if the surface normals point down, flip the triangles */
  function flipIfUpsideDown(geo) {
    var n = geo.attributes.normal;
    var sum = 0;
    for (var i = 0; i < n.count; i++) sum += n.getY(i);
    if (sum < 0) {
      var idx = geo.getIndex();
      var arr = idx.array;
      for (var t = 0; t < arr.length; t += 3) {
        var tmp = arr[t + 1]; arr[t + 1] = arr[t + 2]; arr[t + 2] = tmp;
      }
      idx.needsUpdate = true;
      geo.computeVertexNormals();
    }
    return geo;
  }

  /* vertical wall ribbon along the track at a lateral offset */
  function wallRibbon(model, lateral, height, opts) {
    opts = opts || {};
    var n = model.count;
    var step = opts.step || 3;
    var pos = [], uv = [], idx = [];
    var vLen = 0;
    var prev = null;
    for (var i = 0; i <= n; i += step) {
      var k = i % n;
      var h = model.heading[k];
      var cos = Math.cos(h), sin = Math.sin(h);
      var lat = typeof lateral === 'function' ? lateral(k) : lateral;
      var cx = model.x[k] - ORIGIN.x + cos * lat, cz = model.z[k] - ORIGIN.z - sin * lat, cy = model.y[k];
      pos.push(cx, cy - 0.1, cz);
      pos.push(cx, cy + height, cz);
      if (prev) vLen += Math.hypot(cx - prev.x, cz - prev.z);
      prev = { x: cx, z: cz };
      uv.push(vLen / 10, 0, vLen / 10, 1);
    }
    var rows = pos.length / 6;
    for (var r = 0; r < rows - 1; r++) {
      var a = r * 2, b = r * 2 + 1, c = r * 2 + 2, d = r * 2 + 3;
      idx.push(a, c, b, b, c, d);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /* instanced scatter helper with seeded RNG */
  function scatter(model, count, rnd, opts) {
    var out = [];
    var n = model.count;
    for (var i = 0; i < count; i++) {
      var k = Math.floor(rnd() * n);
      var side = rnd() < 0.5 ? -1 : 1;
      var lat = side * (model.width[k] * 0.5 + (opts.minOff || 8) + rnd() * (opts.range || 40));
      var h = model.heading[k];
      out.push({
        x: model.x[k] - ORIGIN.x + Math.cos(h) * lat,
        y: model.y[k],
        z: model.z[k] - ORIGIN.z - Math.sin(h) * lat,
        rot: rnd() * TAU,
        scale: (opts.minScale || 0.7) + rnd() * (opts.scaleVar || 0.8)
      });
    }
    return out;
  }

  /* ================================================================== */
  /* sky + lighting                                                     */
  /* ================================================================== */
  var SKY_PRESETS = {
    day:      { top: '#7fb2e5', bottom: '#dbe8f2', sun: 1.0, ambient: 0.55, fog: '#c8d8e6', exposure: 1.0 },
    golden:   { top: '#5a8bc4', bottom: '#ffcf9a', sun: 0.95, ambient: 0.5, fog: '#e8c49a', exposure: 1.05 },
    twilight: { top: '#243b6b', bottom: '#c96f4a', sun: 0.55, ambient: 0.35, fog: '#5b4a5a', exposure: 1.1 },
    night:    { top: '#03040a', bottom: '#0d1526', sun: 0.06, ambient: 0.16, fog: '#0a0f18', exposure: 1.2 }
  };

  /* equirectangular canvas used as scene.environment: gives every PBR
     material ambient reflections + light from the sky without any HDR file */
  function makeEnvMap(preset) {
    var key = 'env_' + preset.top + preset.bottom;
    if (TEXCACHE[key]) return TEXCACHE[key];
    var c = cv(512, 256), ctx = c.getContext('2d');
    var grad = ctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, preset.top);
    grad.addColorStop(1, preset.bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 128);
    var g2 = ctx.createLinearGradient(0, 128, 0, 256);
    g2.addColorStop(0, preset.bottom);
    g2.addColorStop(1, '#191d16');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 128, 512, 128);
    // sun disc + glow where the light comes from (u = 0.25)
    var sx = 128, sy = 96;
    var glow = ctx.createRadialGradient(sx, sy, 2, sx, sy, 70);
    glow.addColorStop(0, 'rgba(255,255,245,1)');
    glow.addColorStop(0.15, 'rgba(255,246,220,0.85)');
    glow.addColorStop(1, 'rgba(255,240,210,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(sx, sy, 70, 0, TAU); ctx.fill();
    var t = new THREE.CanvasTexture(c);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.SRGBColorSpace;
    TEXCACHE[key] = t;
    return t;
  }

  function makeSky(preset) {
    // radius must stay well inside the camera far plane (2.6-3.2 km) or the
    // dome is clipped and the scene renders against the clear colour
    var geo = new THREE.SphereGeometry(1500, 32, 20);
    var mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(preset.top) },
        bottom: { value: new THREE.Color(preset.bottom) },
        offset: { value: 0.12 }
      },
      vertexShader: 'varying vec3 vWorld; void main(){ vWorld = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; uniform float offset; varying vec3 vWorld;' +
        'void main(){ float h = clamp((vWorld.y + offset) * 1.6, 0.0, 1.0);' +
        'vec3 c = mix(bottom, top, pow(h, 0.75)); gl_FragColor = vec4(c, 1.0);\n' +
        '#include <tonemapping_fragment>\n' +
        '#include <colorspace_fragment>\n}'
    });
    var sky = new THREE.Mesh(geo, mat);
    sky.frustumCulled = false;
    return sky;
  }

  /* ================================================================== */
  /* main world builder                                                 */
  /* ================================================================== */
  F1.world = { textures: Textures, skyPresets: SKY_PRESETS };

  F1.world.build = function (model, meta, opts) {
    opts = opts || {};
    // everything is authored in the track's world space; ship it centred on
    // the origin so physics/rendering work with small floating-point numbers
    ORIGIN.x = model.origin.x;
    ORIGIN.z = model.origin.z;
    var atRaw = model.at;            // capture before the helper shadows it
    var atW = function (s, out) {
      var p = atRaw(s, out || {});
      p.x -= ORIGIN.x; p.z -= ORIGIN.z;
      return p;
    };
    var theme = meta.theme;
    var rnd = F1.rng(F1.rng.string(meta.id + '|world'));
    var group = new THREE.Group();
    group.name = 'world_' + meta.id;
    var ladder = [];      // things to dispose later
    var animated = [];
    var fogHook = null;   // track_scene registers its THREE.Fog here
    var weather = 'dry';
    var setSurfaceWet = null;   // installed by the surface module
    var features = meta.features || [];

    /* ---------------- lighting + atmosphere ---------------- */
    /* The sky is a real Preetham dome with a cloud layer, and the environment
       map is generated from that dome by PMREM — so reflections, ambient and
       the visible sky always agree. Quality decides shadow budget. */
    var q = opts.quality || (F1.settings && F1.settings.preset ? F1.settings.preset() : {});
    var atmo = F1.sky.create(meta, { quality: q });
    group.add(atmo.group);
    var sky = atmo.sky;
    var envMap = atmo.envMap;
    var ambient = atmo.hemi;
    var sun = atmo.sun;
    var sunDir = atmo.sunDir.clone().multiplyScalar(700);

    var SHADOW_HALF = q.shadowHalf || 130;
    var shadowSize = q.shadowSize || 2048;
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    sun.shadow.camera.left = -SHADOW_HALF; sun.shadow.camera.right = SHADOW_HALF;
    sun.shadow.camera.top = SHADOW_HALF; sun.shadow.camera.bottom = -SHADOW_HALF;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 1400;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.055;
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.position.set(0, 0, 0);
    sun.position.copy(sunDir).multiplyScalar(0.8);
    group.add(sun.target);
    sun.updateMatrixWorld();

    /* Texel snapping: move the shadow frustum in whole texel steps so the
       shadow edges do not crawl as the camera follows the car. */
    var shadowTexel = (SHADOW_HALF * 2) / shadowSize;
    function setShadowFocus(x, z) {
      var sx = Math.round(x / shadowTexel) * shadowTexel;
      var sz = Math.round(z / shadowTexel) * shadowTexel;
      sun.target.position.set(sx, 0, sz);
      sun.position.set(sx + sunDir.x * 0.8, sunDir.y * 0.8, sz + sunDir.z * 0.8);
      sun.target.updateMatrixWorld();
    }

    var isNight = meta.timeOfDay === 'night' || meta.timeOfDay === 'twilight';
    var floodlights = [];
    if (meta.timeOfDay === 'night') {
      // Floodlights: point lights spaced along the lap, hung over the track
      // edge. Physically-correct units in r155+ mean candela values in the
      // thousands are needed to read as "lit" from 30 m up.
      var maxLights = q.maxLights || 8;
      var nFlood = Math.min(maxLights, Math.max(4, Math.round(model.length / 340)));
      for (var fi = 0; fi < nFlood; fi++) {
        var sF = (fi / nFlood) * model.length;
        var pF = atW(sF, {});
        var side = fi % 2 ? 1 : -1;
        var latF = side * (model.width[Math.round(sF / model.step) % model.count] * 0.5 + 16);
        var fl = new THREE.PointLight(0xfff2d8, 5200, 340, 1.65);
        fl.position.set(pF.x + Math.cos(pF.heading) * latF, pF.y + 30,
                        pF.z - Math.sin(pF.heading) * latF);
        group.add(fl);
        floodlights.push(fl);
      }
    }

    /* ---------------- track surface ---------------- */
    /* The dedicated surface module owns asphalt, paint, kerbs and run-off.
       It is built from the same centreline as the physics, so lines and kerbs
       cannot drift away from where the car is allowed to drive. */
    var surface = null;
    if (F1.surface && opts.surface !== false) {
      surface = F1.surface.build(model, meta, { quality: q, theme: theme, atW: atW });
      group.add(surface.group);
      setSurfaceWet = surface.setWetness;
    }

    /* ---------------- ground ---------------- */
    var spanW = Math.max(model.bounds.maxX - model.bounds.minX, model.bounds.maxZ - model.bounds.minZ);
    var groundSize = Math.max(4200, spanW * 3.0);
    var isDesert = theme.style === 'desert';
    var groundTex = (isDesert ? Textures.sand() : Textures.grass());
    groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(groundSize / 26, groundSize / 26);
    var groundMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(isDesert ? '#c9b98f' : F1.util.mixHex(theme.ground, '#9fae86', 0.35)),
      map: groundTex, roughness: 0.98, metalness: 0
    });
    // ground box: the visible top face plus a thick skirt so low camera
    // angles never see the void under the terrain
    var groundGeo = new THREE.BoxGeometry(groundSize, 240, groundSize);
    var ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.set(0, -120 - 0.35, 0);
    ground.receiveShadow = false;      // too large for reliable shadow reception
    group.add(ground);

    if (!surface) {
    /* ---------------- run-off (grass/gravel/sand apron) ---------------- */
    // street circuits have concrete/asphalt verges between the track and the
    // walls; park/desert circuits get grass or sand
    var streetStyle = theme.style === 'street' || theme.style === 'harbour' ||
      (theme.walls && theme.city);
    var runMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(isDesert ? '#c4ac80'
        : F1.util.mixHex(theme.ground, '#7f9a5e', 0.45)),
      map: (isDesert ? Textures.sand() : Textures.grass()).clone(),
      roughness: 0.98, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1,
      side: THREE.DoubleSide
    });
    if (streetStyle) {
      runMat = new THREE.MeshStandardMaterial({
        color: 0x8f949a, map: Textures.asphalt('#6a6e74').clone(),
        roughness: 0.92, metalness: 0.02, polygonOffset: true,
        polygonOffsetFactor: -1, side: THREE.DoubleSide
      });
    }
    runMat.map.colorSpace = THREE.SRGBColorSpace;
    runMat.map.needsUpdate = true;
    runMat.map.repeat.set(1, 1);   // the ribbon UVs already tile every 40 m
    // two side aprons only: a full-width ribbon would draw over the asphalt
    [-1, 1].forEach(function (side) {
      var runoff = new THREE.Mesh(ribbon(model,
        function (k, w) { return side * w; },
        function (k, w) { return side * (w + 14); },
        { uvLength: 40, step: 3 }), runMat);
      runoff.position.y = -0.06;
      runoff.receiveShadow = false;
      runoff.renderOrder = -1;
      group.add(runoff);
    });

    /* embankment: blend from the track edge down to the flat ground so
       elevated circuits (Spa, Monaco, COTA, Austria...) don't float above a
       perfectly flat plain. Also stops grandstands/buildings hanging in air. */
    var GROUND_Y = -0.32;
    var shoulderMat = new THREE.MeshStandardMaterial({
      color: groundMat.color.clone(),
      map: groundTex,
      roughness: 1, metalness: 0, side: THREE.DoubleSide
    });
    var elevSpread = model.maxY - model.minY;
    // only needed where the lap actually climbs: on flat circuits the ground
    // plane already sits at the track height
    if (elevSpread > 4) [-1, 1].forEach(function (side) {
      var shoulder = new THREE.Mesh(ribbon(model,
        function (k, w) { return side * (w + 13.6); },
        function (k, w) { return side * (w + 95); },
        {
          uvLength: 26, step: 3,
          yA: function (k) { return model.y[k] - 0.12; },
          yB: function () { return GROUND_Y; }
        }), shoulderMat);
      shoulder.receiveShadow = false;
      group.add(shoulder);
    });

    /* ---------------- asphalt ---------------- */
    var asphaltTex = Textures.asphalt('#43474d');
    asphaltTex.repeat.set(1, 1);
    var roadMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: asphaltTex, roughness: 0.85, metalness: 0.02, side: THREE.DoubleSide
    });
    var road = new THREE.Mesh(ribbon(model, function (k, w) { return -w; }, function (k, w) { return w; },
      { uvLength: 9, step: 2 }), roadMat);
    road.receiveShadow = true;
    road.name = 'road';
    group.add(road);

    /* white track-limit lines */
    var lineMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.55, side: THREE.DoubleSide });
    [-1, 1].forEach(function (side) {
      var line = new THREE.Mesh(ribbon(model,
        function (k, w) { return side * (w - 0.28); },
        function (k, w) { return side * (w - 0.02); },
        { uvLength: 8, step: 2, lift: 0.012 }), lineMat);
      group.add(line);
    });

    /* ---------------- kerbs ---------------- */
    var kerbMat = new THREE.MeshStandardMaterial({
      map: Textures.kerb('#d8232a'), roughness: 0.6, metalness: 0.02, side: THREE.DoubleSide
    });
    kerbMat.map.repeat.set(1, 1);
    [-1, 1].forEach(function (side) {
      var kerbGeo = ribbon(model,
        function (k, w) { return side * w; },
        function (k, w) { return side * (w + 1.25); },
        { uvLength: 8, step: 2, lift: 0.05 });
      var kerb = new THREE.Mesh(kerbGeo, kerbMat);
      kerb.receiveShadow = true;
      group.add(kerb);
    });

    }

    /* ---------------- barriers or street walls ---------------- */
    var wallTex = Textures.concrete();
    var barrierMat = new THREE.MeshStandardMaterial({
      map: wallTex, color: 0xcfd4d8, roughness: 0.8, side: THREE.DoubleSide
    });
    var wallMesh = new THREE.Mesh(wallRibbon(model, function (k) {
      return model.width[k] * 0.5 + 2.2;
    }, 0.95, { step: 2 }), barrierMat);
    wallMesh.castShadow = true; wallMesh.receiveShadow = false;
    group.add(wallMesh);
    var wallMeshL = new THREE.Mesh(wallRibbon(model, function (k) {
      return -(model.width[k] * 0.5 + 2.2);
    }, 0.95, { step: 2 }), barrierMat);
    wallMeshL.castShadow = true;
    group.add(wallMeshL);

    if (theme.style === 'street' || theme.walls) {
      // taller painted walls + catch fencing for street circuits
      var streetMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(theme.accent), roughness: 0.72, metalness: 0.05
      });
      [-1, 1].forEach(function (side) {
        var wm = new THREE.Mesh(wallRibbon(model, function (k) {
          return side * (model.width[k] * 0.5 + 2.6);
        }, 2.4, { step: 2 }), streetMat);
        group.add(wm);
      });
    } else {
      // armco + catch fence look: thin bright top rail over the concrete
      var railMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, metalness: 0.9, roughness: 0.35 });
      [-1, 1].forEach(function (side) {
        var rail = new THREE.Mesh(wallRibbon(model, function (k) {
          return side * (model.width[k] * 0.5 + 2.24);
        }, 1.05, { step: 3 }), railMat);
        rail.scale.y = 0.22;
        rail.position.y = 0.72;
        group.add(rail);
      });
    }

    /* ---------------- tyre walls on the outside of fast corners -------- */
    var tyreMat = new THREE.MeshStandardMaterial({ map: Textures.tyreWall(), roughness: 0.95 });
    var tyrePlacements = [];
    for (var i = 2; i < model.count - 2; i += 6) {
      var cur = Math.abs(model.curvature[i]);
      if (cur > 1 / 90) {
        var side = model.curvature[i] > 0 ? -1 : 1;   // outside of the corner
        var lat = side * (model.width[i] * 0.5 + 3.1);
        var hh = model.heading[i];
        tyrePlacements.push({
          x: model.x[i] - ORIGIN.x + Math.cos(hh) * lat,
          y: model.y[i] + 0.32,
          z: model.z[i] - ORIGIN.z - Math.sin(hh) * lat,
          ry: hh
        });
      }
    }
    if (tyrePlacements.length) {
      var tyreGeo = new THREE.BoxGeometry(1.1, 0.65, 0.28);
      var tyres = new THREE.InstancedMesh(tyreGeo, tyreMat, Math.min(tyrePlacements.length, 900));
      var m4 = new THREE.Matrix4();
      for (var t = 0; t < Math.min(tyrePlacements.length, 900); t++) {
        var tp = tyrePlacements[t];
        m4.compose(new THREE.Vector3(tp.x, tp.y, tp.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, tp.ry, 0)), new THREE.Vector3(1, 1, 1));
        tyres.setMatrixAt(t, m4);
      }
      tyres.instanceMatrix.needsUpdate = true;
      tyres.count = Math.min(tyrePlacements.length, 900);
      group.add(tyres);
    }

    /* ---------------- grandstands + crowd ---------------- */
    var standMat = new THREE.MeshStandardMaterial({
      color: 0xcfd3d8, roughness: 0.82, side: THREE.DoubleSide
    });
    var roofMat = new THREE.MeshStandardMaterial({ color: 0xdfe3e7, roughness: 0.6, metalness: 0.25 });
    var crowdMat = new THREE.MeshStandardMaterial({ map: Textures.crowd(), roughness: 0.9 });
    var standGeos = [], roofGeos = [], crowdPlacements = [];

    function addGrandstand(s, side, sizeMul) {
      var w = model.width[s];
      var lat = side * (w * 0.5 + (theme.walls ? 7 : 11));
      var h = model.heading[s];
      var px = model.x[s] - ORIGIN.x + Math.cos(h) * lat;
      var pz = model.z[s] - ORIGIN.z - Math.sin(h) * lat;
      var py = model.y[s];
      var len = 58 * (sizeMul || 1);
      var depth = 17;
      var tiers = 8;
      var tierRise = 0.95;
      var tierDepth = depth / tiers;
      var rotY = h + (side > 0 ? 0 : Math.PI);

      // Concrete base slab, sitting ON the ground (y = py is the track level)
      standGeos.push({
        geo: new THREE.BoxGeometry(depth, 1.0, len),
        matrix: new THREE.Matrix4().compose(
          new THREE.Vector3(px, py + 0.4, pz),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
          new THREE.Vector3(1, 1, 1))
      });

      // Seating decks climb away from the track
      for (var ti = 0; ti < tiers; ti++) {
        var stepOut = (ti + 0.5) / tiers * depth - depth / 2;
        var deckX = px + Math.cos(h) * side * stepOut;
        var deckZ = pz - Math.sin(h) * side * stepOut;
        var deckY = py + 1.0 + ti * tierRise;
        standGeos.push({
          geo: new THREE.BoxGeometry(tierDepth * 1.02, 0.7, len),
          matrix: new THREE.Matrix4().compose(
            new THREE.Vector3(deckX, deckY, deckZ),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
            new THREE.Vector3(1, 1, 1))
        });
        // crowd clusters on each deck
        var seats = Math.max(3, Math.round(8 * (sizeMul || 1)));
        for (var c2 = 0; c2 < seats; c2++) {
          var along = (rnd() - 0.5) * len * 0.9;
          crowdPlacements.push({
            x: deckX + Math.sin(h) * along,
            y: deckY + 0.75,
            z: deckZ + Math.cos(h) * along,
            s: 0.8 + rnd() * 0.45
          });
        }
      }

      // Coloured back wall + roof
      standGeos.push({
        geo: new THREE.BoxGeometry(1.0, tiers * tierRise + 3.2, len * 1.02),
        matrix: new THREE.Matrix4().compose(
          new THREE.Vector3(px + Math.cos(h) * side * (depth * 0.56), py + (tiers * tierRise + 3.2) / 2,
            pz - Math.sin(h) * side * (depth * 0.56)),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
          new THREE.Vector3(1, 1, 1))
      });
      roofGeos.push({
        geo: new THREE.BoxGeometry(depth * 1.12, 0.4, len * 1.03),
        matrix: new THREE.Matrix4().compose(
          new THREE.Vector3(px + Math.cos(h) * side * (depth * 0.04), py + tiers * tierRise + 2.6,
            pz - Math.sin(h) * side * (depth * 0.04)),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
          new THREE.Vector3(1, 1, 1))
      });
      // roof supports at both ends
      [-len * 0.44, len * 0.44].forEach(function (al) {
        standGeos.push({
          geo: new THREE.BoxGeometry(0.45, tiers * tierRise + 2.4, 0.45),
          matrix: new THREE.Matrix4().compose(
            new THREE.Vector3(px + Math.cos(h) * side * (depth * 0.52) + Math.sin(h) * al,
              py + (tiers * tierRise + 2.4) / 2,
              pz - Math.sin(h) * side * (depth * 0.52) + Math.cos(h) * al),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
            new THREE.Vector3(1, 1, 1))
        });
      });
    }

    var standSpots = opts.stands;
    if (!standSpots) {
      standSpots = [{ s: model.length * 0.985, side: 1, size: 1.8 }];
      // pick the four tightest corners as secondary stand locations
      var cornerCands = [];
      for (var ci2 = 6; ci2 < model.count - 6; ci2 += 3) {
        var kk = Math.abs(model.curvature[ci2]);
        if (kk > 1 / 150) cornerCands.push({ s: ci2 * model.step, k: kk });
      }
      cornerCands.sort(function (a, b) { return b.k - a.k; });
      var used = [];
      cornerCands.forEach(function (cc) {
        if (standSpots.length >= 7) return;
        for (var u = 0; u < used.length; u++) {
          var d = Math.abs(cc.s - used[u]);
          if (Math.min(d, model.length - d) < 260) return;
        }
        used.push(cc.s);
        standSpots.push({ s: cc.s, side: standSpots.length % 2 ? 1 : -1, size: 0.85 });
      });
    }
    standSpots.forEach(function (sp) {
      addGrandstand(model.indexAt(sp.s), sp.side, sp.size);
    });

    if (standGeos.length) {
      var standMesh = new THREE.Mesh(mergeNonIndexed(standGeos), standMat);
      standMesh.castShadow = true; standMesh.receiveShadow = true;
      group.add(standMesh);
      ladder.push(standMesh.geometry);
    }
    if (roofGeos.length) {
      var roofMesh = new THREE.Mesh(mergeNonIndexed(roofGeos), roofMat);
      roofMesh.castShadow = true;
      group.add(roofMesh);
    }
    if (crowdPlacements.length) {
      var cGeo = new THREE.BoxGeometry(0.55, 0.75, 0.4);
      var crowdMesh = new THREE.InstancedMesh(cGeo, crowdMat, crowdPlacements.length);
      var cm4 = new THREE.Matrix4();
      crowdPlacements.forEach(function (cp, ci) {
        cm4.compose(new THREE.Vector3(cp.x, cp.y, cp.z), new THREE.Quaternion(), new THREE.Vector3(cp.s, cp.s, cp.s));
        crowdMesh.setMatrixAt(ci, cm4);
      });
      crowdMesh.instanceMatrix.needsUpdate = true;
      group.add(crowdMesh);
    }

    /* ---------------- pit lane, pit building, gantry ---------------- */
    var pitFrac = model.pit.entry !== undefined ? model.pit.entry : 0.95;
    var pitS0 = model.length * (pitFrac - 0.055 + 1) % model.length;
    var pitS1 = model.length * (model.pit.exit + 0.02);

    var pitLine = [];
    (function buildPit() {
      // sample the pit lane as an offset curve on the inside of the main straight
      var steps = 46;
      var side = -1;
      var startS = model.length * 0.945;
      for (var p = 0; p <= steps; p++) {
        var t = p / steps;
        var s = startS + t * model.length * 0.11;
        var k = model.indexAt(s);
        var ramp = Math.min(1, Math.min(t * 6, (1 - t) * 6));
        var lat = side * (model.width[k] * 0.5 + 3 + ramp * 7);
        var h = model.heading[k];
        pitLine.push({
          x: model.x[k] - ORIGIN.x + Math.cos(h) * lat,
          y: model.y[k] + 0.02,
          z: model.z[k] - ORIGIN.z - Math.sin(h) * lat,
          h: h
        });
      }
      var pos = [], idx = [], uv = [];
      var vL = 0, prev = null;
      pitLine.forEach(function (pt) {
        if (prev) vL += Math.hypot(pt.x - prev.x, pt.z - prev.z);
        prev = pt;
        var nx = Math.cos(pt.h), nz = -Math.sin(pt.h);
        pos.push(pt.x - nx * 4, pt.y, pt.z - nz * 4);
        pos.push(pt.x + nx * 4, pt.y, pt.z + nz * 4);
        uv.push(0, vL / 8, 1, vL / 8);
      });
      for (var r = 0; r < pitLine.length - 1; r++) {
        var a = r * 2, b = r * 2 + 1, c = r * 2 + 2, dd = r * 2 + 3;
        idx.push(a, b, c, b, dd, c);
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      flipIfUpsideDown(g);
      var pitRoad = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
        map: Textures.asphalt('#4d4f55'), roughness: 0.7, metalness: 0.05, side: THREE.DoubleSide
      }));
      pitRoad.receiveShadow = true;
      group.add(pitRoad);

      // pit wall dividing pit lane and track
      var wallGeo = wallRibbon(model, function (k) { return -(model.width[k] * 0.5 + 2.9); }, 1.1, { step: 3 });
      group.add(new THREE.Mesh(wallGeo, barrierMat));

      // pit building along the middle of the pit lane
      var mid = pitLine[Math.floor(pitLine.length * 0.5)];
      var buildMat = new THREE.MeshStandardMaterial({ color: 0xe8eaec, roughness: 0.55, metalness: 0.15 });
      var glassMat = new THREE.MeshStandardMaterial({
        color: 0x1c2a38, roughness: 0.12, metalness: 0.75,
        map: Textures.facade(true)
      });
      var buildingGeos = [], glassGeos = [];
      var garages = 11;
      var garageLen = 8.2;
      var totalLen = garages * garageLen;
      for (var gi = 0; gi < garages; gi++) {
        var t2 = (gi + 0.5) / garages;
        var idx2 = Math.min(pitLine.length - 1, Math.floor(t2 * (pitLine.length - 1)));
        var pp = pitLine[idx2];
        var nx2 = Math.cos(pp.h), nz2 = -Math.sin(pp.h);
        var off = 11;
        var bx = pp.x - nx2 * off, bz = pp.z - nz2 * off;
        // garages run from the ground up so nothing floats beside the pit lane
        var podH = 6.4 + Math.max(0, pp.y);
        var podM = new THREE.Matrix4().compose(
          new THREE.Vector3(bx, pp.y + 3.2 - Math.max(0, pp.y) / 2, bz),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, pp.h, 0)),
          new THREE.Vector3(1, 1, 1));
        buildingGeos.push({ geo: new THREE.BoxGeometry(12, podH, garageLen * 0.98), matrix: podM });
        var gm = new THREE.Matrix4().compose(
          new THREE.Vector3(bx + nx2 * 6.05, pp.y + 2.3, bz + nz2 * 6.05),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, pp.h, 0)),
          new THREE.Vector3(1, 1, 1));
        glassGeos.push({ geo: new THREE.BoxGeometry(0.3, 3.4, garageLen * 0.86), matrix: gm });
      }
      var pitBuilding = new THREE.Mesh(mergeNonIndexed(buildingGeos), buildMat);
      pitBuilding.castShadow = true; pitBuilding.receiveShadow = true;
      group.add(pitBuilding);
      group.add(new THREE.Mesh(mergeNonIndexed(glassGeos), glassMat));

      // team colours along the pit wall + big start/finish sign on the roof
      var bannerGeos = [];
      var teamCols = F1.DATA.teams.map(function (t) { return t.colors.primary; });
      for (var tc = 0; tc < garages; tc++) {
        var t2b = (tc + 0.5) / garages;
        var idxB = Math.min(pitLine.length - 1, Math.floor(t2b * (pitLine.length - 1)));
        var ppB = pitLine[idxB];
        var nxB = Math.cos(ppB.h), nzB = -Math.sin(ppB.h);
        var bb = new THREE.Mesh(new THREE.PlaneGeometry(garageLen * 0.9, 0.9),
          new THREE.MeshBasicMaterial({ color: teamCols[tc % teamCols.length] }));
        bb.position.set(ppB.x + nxB * 6.1, ppB.y + 5.1, ppB.z + nzB * 6.1);
        bb.rotation.y = ppB.h + Math.PI / 2;
        group.add(bb);
      }
      var signTex = Textures.billboard(meta.name.toUpperCase(), '#0b0f15', '#ffffff');
      var roofSign = new THREE.Mesh(new THREE.PlaneGeometry(28, 4),
        new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide }));
      roofSign.position.set(mid.x - Math.cos(mid.h) * 11, mid.y + 9.2, mid.z + Math.sin(mid.h) * 11);
      roofSign.rotation.y = mid.h + Math.PI / 2;
      group.add(roofSign);

      // roof + antenna masts
      var roofPit = new THREE.Mesh(new THREE.BoxGeometry(13, 0.4, totalLen * 1.02), roofMat);
      roofPit.position.set(mid.x - Math.cos(mid.h) * 11, mid.y + 6.5, mid.z + Math.sin(mid.h) * 11);
      roofPit.rotation.y = mid.h;
      roofPit.castShadow = true;
      group.add(roofPit);

      // start gantry over the line
      var s0 = atW(0, {});
      var gantry = new THREE.Group();
      var pylonMat = new THREE.MeshStandardMaterial({ color: 0x20242a, metalness: 0.6, roughness: 0.4 });
      [-1, 1].forEach(function (sd) {
        var px = s0.x + Math.cos(s0.heading) * sd * (s0.width * 0.5 + 1.4);
        var pz = s0.z - Math.sin(s0.heading) * sd * (s0.width * 0.5 + 1.4);
        var pylon = new THREE.Mesh(new THREE.BoxGeometry(0.55, 7.4, 0.55), pylonMat);
        pylon.position.set(px, s0.y + 3.7, pz);
        gantry.add(pylon);
      });
      var beam = new THREE.Mesh(new THREE.BoxGeometry(s0.width + 4.4, 0.6, 0.9), pylonMat);
      beam.position.set(s0.x, s0.y + 7.2, s0.z);
      beam.rotation.y = s0.heading;
      gantry.add(beam);
      // light pods
      for (var li = 0; li < 5; li++) {
        var pod = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.3),
          new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: 0xff2200, emissiveIntensity: 0.0 }));
        var frac = (li - 2) * 0.16;
        pod.position.set(s0.x + Math.cos(s0.heading + Math.PI / 2) * frac * s0.width,
          s0.y + 6.7, s0.z - Math.sin(s0.heading + Math.PI / 2) * frac * s0.width);
        pod.userData.startLight = true;
        gantry.add(pod);
        animated.push(pod);
      }
      group.add(gantry);

      // start/finish line + grid boxes
      var sfGeo = new THREE.PlaneGeometry(s0.width, 1.1);
      var sfMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
      var sfLine = new THREE.Mesh(sfGeo, sfMat);
      sfLine.rotation.x = -Math.PI / 2;
      sfLine.rotation.z = -s0.heading;
      sfLine.position.set(s0.x, s0.y + 0.02, s0.z);
      group.add(sfLine);
      var gridMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6 });
      for (var gb = 0; gb < 8; gb++) {
        var gs = atW(8 + gb * 12, {});
        var box = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.22), gridMat);
        box.rotation.x = -Math.PI / 2;
        box.rotation.z = -gs.heading;
        var lat = (gb % 2 ? -1 : 1) * gs.width * 0.24;
        box.position.set(gs.x + Math.cos(gs.heading) * lat, gs.y + 0.02, gs.z - Math.sin(gs.heading) * lat);
        group.add(box);
      }
    })();

    /* ---------------- DRS / boost zone gantries ---------------- */
    model.drs.forEach(function (zone) {
      var s = atW(model.length * zone[0], {});
      var g = new THREE.Group();
      var pm = new THREE.MeshStandardMaterial({ color: 0x1a1e24, metalness: 0.5, roughness: 0.4 });
      [-1, 1].forEach(function (sd) {
        var pylon = new THREE.Mesh(new THREE.BoxGeometry(0.35, 6, 0.35), pm);
        pylon.position.set(s.x + Math.cos(s.heading) * sd * (s.width * 0.5 + 2.2), s.y + 3,
          s.z - Math.sin(s.heading) * sd * (s.width * 0.5 + 2.2));
        g.add(pylon);
      });
      var sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.9),
        new THREE.MeshBasicMaterial({ map: Textures.billboard('BOOST', '#0b3d3a', '#00e0c7'), side: THREE.DoubleSide }));
      sign.position.set(s.x, s.y + 5.4, s.z);
      sign.rotation.y = s.heading;
      g.add(sign);
      group.add(g);
    });

    /* ---------------- trees / palms / cacti ---------------- */
    var treeKind = theme.trees || 'mixed';
    if (treeKind !== 'none') {
      var spots = scatter(model, 520, rnd, { minOff: 14, range: 190 });
      var trunkGeos = [], leafGeos = [];
      var pineGeos = [], palmTrunkGeos = [], palmLeafGeos = [];
      var trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 3.4, 5);
      var leafGeo = new THREE.IcosahedronGeometry(2.4, 1);
      var pineGeo = new THREE.ConeGeometry(1.9, 6.4, 6, 1);
      var palmTrunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 8.5, 5);
      var palmLeafGeo = new THREE.ConeGeometry(2.1, 1.0, 5, 1);

      spots.forEach(function (sp) {
        var kind = treeKind;
        if (kind === 'mixed') kind = rnd() < 0.3 ? 'pine' : 'round';
        if (kind === 'sparse' && rnd() < 0.55) return;
        // never put trees in a walled street circuit's frontage
        if (theme.city && Math.abs(sp.x) < 1e9 && theme.walls) {
          // measured distance from the array origin is enough here: walls run
          // along the lap, so keep the whole inner band clear
        }
        var sc = (theme.city ? 0.7 : 1) * (0.8 + rnd() * 0.6);
        if (kind === 'palm') {
          palmTrunkGeos.push({
            geo: palmTrunkGeo,
            matrix: new THREE.Matrix4().compose(
              new THREE.Vector3(sp.x, sp.y + 4.2 * sc, sp.z),
              new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sp.rot, 0)),
              new THREE.Vector3(sc, sc, sc))
          });
          for (var pl = 0; pl < 4; pl++) {
            palmLeafGeos.push({
              geo: palmLeafGeo,
              matrix: new THREE.Matrix4().compose(
                new THREE.Vector3(sp.x, sp.y + 8.6 * sc, sp.z),
                new THREE.Quaternion().setFromEuler(
                  new THREE.Euler(pl % 2 ? 0.9 : -0.9, sp.rot + pl * 1.6, 0)),
                new THREE.Vector3(sc, sc, sc))
            });
          }
        } else if (kind === 'pine') {
          trunkGeos.push({
            geo: trunkGeo,
            matrix: new THREE.Matrix4().compose(
              new THREE.Vector3(sp.x, sp.y + 1.5 * sc, sp.z),
              new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sp.rot, 0)),
              new THREE.Vector3(sc * 0.8, sc * 0.8, sc * 0.8))
          });
          pineGeos.push({
            geo: pineGeo,
            matrix: new THREE.Matrix4().compose(
              new THREE.Vector3(sp.x, sp.y + 5.0 * sc, sp.z),
              new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sp.rot, 0)),
              new THREE.Vector3(sc, sc * 1.15, sc))
          });
        } else {
          trunkGeos.push({
            geo: trunkGeo,
            matrix: new THREE.Matrix4().compose(
              new THREE.Vector3(sp.x, sp.y + 1.5 * sc, sp.z),
              new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sp.rot, 0)),
              new THREE.Vector3(sc, sc, sc))
          });
          leafGeos.push({
            geo: leafGeo,
            matrix: new THREE.Matrix4().compose(
              new THREE.Vector3(sp.x, sp.y + 4.6 * sc, sp.z),
              new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sp.rot, 0)),
              new THREE.Vector3(sc, sc * 1.1, sc))
          });
        }
      });

      var trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b4630, roughness: 0.95 });
      var leafMat = new THREE.MeshStandardMaterial({ color: 0x35662d, roughness: 0.9 });
      var pineMat = new THREE.MeshStandardMaterial({ color: 0x25482c, roughness: 0.95 });
      var palmTrunkMat = new THREE.MeshStandardMaterial({ color: 0x8a7350, roughness: 0.95 });
      var palmLeafMat = new THREE.MeshStandardMaterial({ color: 0x3f7a35, roughness: 0.9 });
      if (trunkGeos.length) group.add(new THREE.Mesh(mergeNonIndexed(trunkGeos), trunkMat));
      if (leafGeos.length) group.add(new THREE.Mesh(mergeNonIndexed(leafGeos), leafMat));
      if (pineGeos.length) group.add(new THREE.Mesh(mergeNonIndexed(pineGeos), pineMat));
      if (palmTrunkGeos.length) group.add(new THREE.Mesh(mergeNonIndexed(palmTrunkGeos), palmTrunkMat));
      if (palmLeafGeos.length) group.add(new THREE.Mesh(mergeNonIndexed(palmLeafGeos), palmLeafMat));
    }

    // centreline samples reused by the city block / water placement code
    var trackPtsWater = [];
    for (var tw = 0; tw < model.count; tw += 3) {
      trackPtsWater.push([model.x[tw] - ORIGIN.x, model.z[tw] - ORIGIN.z]);
    }

    /* ---------------- city corridor (street + city circuits) ---------- */
    // Street circuits need a continuous wall of buildings hugging the lap,
    // not random boxes in a field: walk the centreline and lay a front row
    // (close, low) and a back row (set back, tall) on each side.
    if (theme.city) {
      var trackPts = trackPtsWater;
      function clearOfTrack(x, z, radius) {
        var lim = radius * radius;
        for (var q = 0; q < trackPts.length; q++) {
          var dx = trackPts[q][0] - x, dz = trackPts[q][1] - z;
          if (dx * dx + dz * dz < lim) return false;
        }
        return true;
      }

      var pavMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.95 });
      [-1, 1].forEach(function (side) {
        var pave = new THREE.Mesh(ribbon(model,
          function (k, w) { return side * (w + 7); },
          function (k, w) { return side * (w + 19); },
          { uvLength: 10, step: 3, lift: 0.03 }), pavMat);
        pave.receiveShadow = false;
        group.add(pave);
      });

      var matGlass = new THREE.MeshStandardMaterial({
        map: Textures.facade(true), color: 0xdfe8f2, roughness: 0.28, metalness: 0.35
      });
      var matStone = new THREE.MeshStandardMaterial({
        map: Textures.facade(false), color: 0xd8d2c6, roughness: 0.88, metalness: 0.04
      });
      var matDark = new THREE.MeshStandardMaterial({ color: 0x6a7280, roughness: 0.7, metalness: 0.2 });
      var geosG = [], geosS = [], geosD = [], neonGeos = [], roofGeosCity = [];

      var pitEntry = model.pit.entry !== undefined ? model.pit.entry : 0.95;
      var pitExit = model.pit.exit !== undefined ? model.pit.exit : 0.05;
      function inPitSpan(f) {
        if (pitEntry > pitExit) return f > pitEntry || f < pitExit;
        return f > pitEntry && f < pitExit;
      }
      var standFracs = standSpots.map(function (sp) { return sp.s / model.length; });
      function nearStand(f) {
        for (var q = 0; q < standFracs.length; q++) {
          var d = Math.abs(f - standFracs[q]);
          if (Math.min(d, 1 - d) < 0.02) return true;
        }
        return false;
      }

      for (var sB = 0; sB < model.length; sB += 26) {
        var kB = model.indexAt(sB);
        var fB = sB / model.length;
        if (nearStand(fB)) continue;
        var hB = model.heading[kB];
        var yB = model.y[kB];
        var wB = model.width[kB] * 0.5;
        for (var sIdx = 0; sIdx < 2; sIdx++) {
          var side = sIdx === 0 ? -1 : 1;
          // the pit side of the main straight is occupied by the pit building
          if (side < 0 && inPitSpan(fB)) continue;
          for (var row = 0; row < 2; row++) {
            var depthOff = row === 0 ? (wB + 24 + rnd() * 6) : (wB + 62 + rnd() * 34);
            var bw = 15 + rnd() * 12;
            var bd = 14 + rnd() * 16;
            var bh = row === 0 ? (9 + rnd() * 16) : (22 + rnd() * 58);
            var along = (rnd() - 0.5) * 6;
            var bx = model.x[kB] - ORIGIN.x + Math.cos(hB) * side * depthOff + Math.sin(hB) * along;
            var bz = model.z[kB] - ORIGIN.z - Math.sin(hB) * side * depthOff + Math.cos(hB) * along;
            if (!clearOfTrack(bx, bz, Math.max(bw, bd) * 0.62 + 11)) continue;
            var geo = new THREE.BoxGeometry(bd, bh, bw);
            // buildings reach down to the flat ground, whatever the local
            // track elevation is, so nothing appears to float
            var baseY = -0.30;
            var topY = yB + bh;
            var totalH = Math.max(bh, topY - baseY);
            geo.dispose();
            geo = new THREE.BoxGeometry(bd, totalH, bw);
            var uvs2 = geo.attributes.uv;
            for (var uj = 0; uj < uvs2.count; uj++) {
              uvs2.setXY(uj, uvs2.getX(uj) * Math.max(1, Math.round(bw / 11)),
                uvs2.getY(uj) * Math.max(1, Math.round(topY / 8)));
            }
            var mB = new THREE.Matrix4().compose(
              new THREE.Vector3(bx, baseY + totalH / 2, bz),
              new THREE.Quaternion().setFromEuler(new THREE.Euler(0, hB, 0)),
              new THREE.Vector3(1, 1, 1));
            var bucket = rnd();
            (bucket < 0.45 ? geosG : bucket < 0.82 ? geosS : geosD).push({ geo: geo, matrix: mB });
            roofGeosCity.push({
              geo: new THREE.BoxGeometry(bd * 1.06, 0.8, bw * 1.06),
              matrix: new THREE.Matrix4().compose(
                new THREE.Vector3(bx, baseY + totalH + 0.35, bz),
                new THREE.Quaternion().setFromEuler(new THREE.Euler(0, hB, 0)),
                new THREE.Vector3(1, 1, 1))
            });
            if (theme.neon && bh > 18 && rnd() < 0.55) {
              neonGeos.push({
                geo: new THREE.BoxGeometry(bd * 0.98, 0.9, bw * 0.98),
                matrix: new THREE.Matrix4().compose(
                  new THREE.Vector3(bx, yB + bh - 2.2, bz),
                  new THREE.Quaternion().setFromEuler(new THREE.Euler(0, hB, 0)),
                  new THREE.Vector3(1, 1, 1))
              });
            }
          }
        }
      }
      var cityMats = [matGlass, matStone, matDark];
      [geosG, geosS, geosD].forEach(function (list, li) {
        if (!list.length) return;
        var cm = cityMats[li].clone();
      cm.map = cm.map ? cm.map.clone() : null;
      if (cm.map) { cm.map.colorSpace = THREE.SRGBColorSpace; cm.map.needsUpdate = true; }
      var mesh = new THREE.Mesh(mergeNonIndexed(list), cm);
        mesh.castShadow = li !== 2;
        mesh.name = 'city-' + li;
        group.add(mesh);
      });
      if (roofGeosCity.length) {
        var roofCityMesh = new THREE.Mesh(mergeNonIndexed(roofGeosCity),
          new THREE.MeshStandardMaterial({ color: 0x8d939b, roughness: 0.9, metalness: 0.1 }));
        roofCityMesh.castShadow = false;
        roofCityMesh.name = 'city-roofs';
        group.add(roofCityMesh);
      }
      if (neonGeos.length) {
        var neonMat = new THREE.MeshStandardMaterial({
          color: 0x111318, emissive: new THREE.Color(theme.accent),
          emissiveIntensity: 1.6, roughness: 0.5
        });
        neonMat.userData.neon = true;
        var neonMesh = new THREE.Mesh(mergeNonIndexed(neonGeos), neonMat);
        group.add(neonMesh);
      }
    }

    /* ---------------- water: lake / harbour / marina ------------------ */
    if (theme.water) {
      // find the largest patch of open ground so the water never sits on the
      // circuit: sample a grid, keep the point furthest from every track sample
      var best = { x: 0, z: 0, score: -1e9, open: 0 };
      var bestOpen = { x: 0, z: 0, open: -1 };
      var reach = Math.max(model.bounds.maxX - model.bounds.minX, model.bounds.maxZ - model.bounds.minZ) * 0.9 + 420;
      for (var gx = -1; gx <= 1.0001; gx += 0.1) {
        for (var gz = -1; gz <= 1.0001; gz += 0.1) {
          var wx = gx * reach, wz = gz * reach;
          var nearest = 1e9;
          for (var q2 = 0; q2 < trackPtsWater.length; q2++) {
            var ddx = trackPtsWater[q2][0] - wx, ddz = trackPtsWater[q2][1] - wz;
            var dd = ddx * ddx + ddz * ddz;
            if (dd < nearest) nearest = dd;
          }
          nearest = Math.sqrt(nearest);
          // the water must sit clear of the circuit (min 150 m), then prefer
          // the largest open area while staying reasonably near the lap
          if (nearest > bestOpen.open) bestOpen = { x: wx, z: wz, open: nearest };
          if (nearest < 150) continue;
          var score = Math.min(nearest, 520) - Math.hypot(wx, wz) * 0.55;
          if (score > best.score) best = { x: wx, z: wz, score: score, open: nearest };
        }
      }
      // dense street circuits have no plot 150 m clear of the lap: fall back
      // to the most open spot, which is the infield (Marina Bay, Miami...)
      if (best.score < -1e8) {
        if (bestOpen.open < 45) {
          best = null;
        } else {
          best = { x: bestOpen.x, z: bestOpen.z, open: bestOpen.open };
        }
      }
      var wRad = best ? F1.util.clamp(best.open * 0.72, 90, 420) : 0;
      if (!best) return;   // no water on this circuit after all
      var waterMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(isDesert ? '#2f8199' : '#1f5f7d'),
        roughness: 0.08, metalness: 0.6, envMapIntensity: 1.2
      });
      var water = new THREE.Mesh(new THREE.CircleGeometry(1, 56), waterMat);
      water.rotation.x = -Math.PI / 2;
      water.scale.set(wRad, wRad * (0.62 + rnd() * 0.3), 1);
      water.position.set(best.x, -0.16, best.z);
      water.name = 'water';
      group.add(water);
      var shore = new THREE.Mesh(new THREE.RingGeometry(0.985, 1.0, 56),
        new THREE.MeshStandardMaterial({ color: 0xd8cfae, roughness: 0.95 }));
      shore.rotation.x = -Math.PI / 2;
      shore.scale.copy(water.scale);
      shore.position.copy(water.position);
      shore.position.y = -0.14;
      group.add(shore);

      // yachts / boats for harbour and marina circuits
      if (features.indexOf('yachts') >= 0 || features.indexOf('marina') >= 0 ||
          features.indexOf('fake-marina') >= 0 || theme.style === 'harbour' || theme.city) {
        var hullGeos = [], mastGeos = [];
        var nBoats = 4 + Math.floor(rnd() * 4);
        for (var bi2 = 0; bi2 < nBoats; bi2++) {
          var ang = rnd() * TAU, rr = rnd() * 0.62;
          var bxx = best.x + Math.cos(ang) * wRad * rr;
          var bzz = best.z + Math.sin(ang) * wRad * rr * 0.7;
          var yawB = rnd() * TAU;
          var lenB = 12 + rnd() * 18;
          hullGeos.push({
            geo: new THREE.BoxGeometry(3.4, 1.6, lenB),
            matrix: new THREE.Matrix4().compose(
              new THREE.Vector3(bxx, 0.6, bzz),
              new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yawB, 0)),
              new THREE.Vector3(1, 1, 1))
          });
          var mastH = 9 + rnd() * 14;
          mastGeos.push({
            geo: new THREE.CylinderGeometry(0.09, 0.13, mastH, 5),
            matrix: new THREE.Matrix4().compose(
              new THREE.Vector3(bxx, 0.6 + mastH * 0.5, bzz),
              new THREE.Quaternion(),
              new THREE.Vector3(1, 1, 1))
          });
        }
        group.add(new THREE.Mesh(mergeNonIndexed(hullGeos),
          new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.35, metalness: 0.1 })));
        group.add(new THREE.Mesh(mergeNonIndexed(mastGeos),
          new THREE.MeshStandardMaterial({ color: 0xdadfe4, roughness: 0.4, metalness: 0.3 })));
      }
    }

    /* ---------------- distant mountain ridges ------------------------- */
    // A single silhouette ring, 1.6-2.4 km out: reads as a mountain horizon
    // from every camera angle without the polycount (or the clipping) of
    // individual cones.
    if (theme.mountains) {
      var ringRnd = F1.rng(F1.rng.string(meta.id + '|ridge'));
      var N = 72;
      // built as a flat curtain with baked vertical shading (unlit + fog), so
      // there are no normals to get wrong and it reads as atmospheric haze
      function buildRidge(radiusBase, radiusVar, peakMin, peakVar, colLow, colHigh, name) {
        var pos = [], col = [], idx = [];
        var cLow = new THREE.Color(colLow), cHigh = new THREE.Color(colHigh);
        var seedRnd = F1.rng(F1.rng.string(meta.id + name));
        for (var ri = 0; ri <= N; ri++) {
          var a = (ri / N) * TAU;
          var rad = radiusBase + seedRnd() * radiusVar;
          var peak = peakMin + seedRnd() * peakVar;
          if (ri % 3 === 0) peak *= 0.5;
          if (ri % 7 === 0) peak *= 1.5;
          var x = Math.cos(a) * rad, z = Math.sin(a) * rad;
          pos.push(x, -10, z, x * 0.992, peak, z * 0.992);
          col.push(cLow.r, cLow.g, cLow.b, cHigh.r, cHigh.g, cHigh.b);
          if (ri < N) {
            var b2 = ri * 2;
            idx.push(b2, b2 + 1, b2 + 2, b2 + 1, b2 + 3, b2 + 2);
          }
        }
        var g2 = new THREE.BufferGeometry();
        g2.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g2.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        g2.setIndex(idx);
        var m2 = new THREE.MeshBasicMaterial({
          vertexColors: true, side: THREE.DoubleSide, fog: true
        });
        var mesh2 = new THREE.Mesh(g2, m2);
        mesh2.name = name;
        group.add(mesh2);
        return mesh2;
      }
      buildRidge(1550, 600, 90, 240,
        theme.sand ? '#a3947a' : '#3f5349', theme.sand ? '#cbb99a' : '#7d9488', 'ridge-ring');
      buildRidge(2250, 900, 160, 320,
        theme.sand ? '#a89b83' : '#5d6f6a', theme.sand ? '#d6c7ac' : '#9db0a8', 'ridge-ring-2');
    }

    /* ---------------- floodlight poles ---------------- */
    if (isNight) {
      var poleMat = new THREE.MeshStandardMaterial({ color: 0x33383e, metalness: 0.7, roughness: 0.35 });
      var lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2cc, emissiveIntensity: 2.2 });
      var poleGeo = new THREE.CylinderGeometry(0.35, 0.5, 26, 6);
      var lampGeo = new THREE.BoxGeometry(5.2, 1.2, 0.6);
      var poles = [], lamps = [];
      for (var pl = 0; pl < 30; pl++) {
        var sP = (pl / 30) * model.length;
        var pP = atW(sP, {});
        var sideP = pl % 2 ? 1 : -1;
        var offP = sideP * (pP.width * 0.5 + (theme.city ? 30 : 22));
        var px2 = pP.x + Math.cos(pP.heading) * offP;
        var pz2 = pP.z - Math.sin(pP.heading) * offP;
        poles.push({ geo: poleGeo, matrix: mat(px2, pP.y + 13, pz2, 0, pP.heading, 0) });
        lamps.push({ geo: lampGeo, matrix: mat(px2, pP.y + 25.4, pz2, 0, pP.heading, 0) });
      }
      var poleMesh = new THREE.Mesh(mergeNonIndexed(poles), poleMat);
      var lampMesh = new THREE.Mesh(mergeNonIndexed(lamps), lampMat);
      group.add(poleMesh, lampMesh);
    }

    /* ---------------- circuit-specific landmarks ---------------- */
    function feature(name, fn) { if (features.indexOf(name) >= 0) fn(); }

    feature('sphere', function () {
      // Las Vegas: the giant LED sphere
      var s = atW(model.length * 0.55, {});
      var sphereGeo = new THREE.SphereGeometry(48, 32, 24);
      var matSphere = new THREE.MeshBasicMaterial({ map: Textures.billboard('F1', '#1b2a6b', '#ffd400') });
      var mesh = new THREE.Mesh(sphereGeo, matSphere);
      var off = 180;
      mesh.position.set(s.x + Math.cos(s.heading + Math.PI / 2) * off, 52, s.z - Math.sin(s.heading + Math.PI / 2) * off);
      group.add(mesh);
    });

    feature('ferris-wheel', function () {
      var s = atW(model.length * 0.30, {});
      var wheel = new THREE.Group();
      var rim = new THREE.Mesh(new THREE.TorusGeometry(22, 0.6, 6, 40),
        new THREE.MeshStandardMaterial({ color: 0xdfe6ee, metalness: 0.6, roughness: 0.3 }));
      wheel.add(rim);
      for (var sp = 0; sp < 12; sp++) {
        var spoke = new THREE.Mesh(new THREE.BoxGeometry(0.25, 44, 0.25),
          new THREE.MeshStandardMaterial({ color: 0xc8d2dc, metalness: 0.5, roughness: 0.4 }));
        spoke.rotation.z = (sp / 12) * TAU;
        wheel.add(spoke);
      }
      var hub = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 2.6, 10),
        new THREE.MeshStandardMaterial({ color: 0x9aa4ae, metalness: 0.7, roughness: 0.3 }));
      hub.rotation.x = Math.PI / 2;
      wheel.add(hub);
      wheel.position.set(s.x + Math.cos(s.heading - 0.9) * 120, s.y + 24, s.z - Math.sin(s.heading - 0.9) * 120);
      wheel.rotation.y = s.heading;
      wheel.castShadow = true;
      group.add(wheel);
      animated.push({ userData: { spinWheel: true }, object3d: wheel });
    });

    feature('tunnel', function () {
      // Monaco tunnel: a tube over the track for a stretch of the lap
      var from = Math.floor(model.count * 0.42), to = Math.floor(model.count * 0.55);
      var pos = [], idx = [];
      var rows = 0;
      for (var ti = from; ti <= to; ti += 2) {
        var k = ti % model.count;
        var hd = model.heading[k];
        var wHalf = model.width[k] * 0.5 + 3.2;
        var cx = model.x[k] - ORIGIN.x, cz = model.z[k] - ORIGIN.z, cy = model.y[k];
        var steps = 8;
        for (var a2 = 0; a2 <= steps; a2++) {
          var ang = Math.PI * (a2 / steps);
          var lx = Math.cos(ang) * wHalf;
          var ly = Math.sin(ang) * 7.5 + 2.2;
          pos.push(cx + Math.cos(hd) * lx, cy + ly, cz - Math.sin(hd) * lx);
        }
        rows++;
      }
      var per = 9;
      for (var r2 = 0; r2 < rows - 1; r2++) {
        for (var c3 = 0; c3 < per - 1; c3++) {
          var a3 = r2 * per + c3, b3 = r2 * per + c3 + 1, c4 = (r2 + 1) * per + c3 + 1, d3 = (r2 + 1) * per + c3;
          idx.push(a3, c4, b3, a3, d3, c4);
        }
      }
      var tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      tg.setIndex(idx);
      tg.computeVertexNormals();
      var tunnelMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2e, roughness: 0.85, side: THREE.DoubleSide });
      group.add(new THREE.Mesh(tg, tunnelMat));
      // tunnel lights
      var lightMat = new THREE.MeshStandardMaterial({ color: 0xfff3cf, emissive: 0xffdd99, emissiveIntensity: 2 });
      for (var li2 = 0; li2 < 10; li2++) {
        var ss = model.length * (0.43 + li2 * 0.011);
        var pp2 = atW(ss, {});
        var lamp2 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.7), lightMat);
        lamp2.position.set(pp2.x, pp2.y + 8.5, pp2.z);
        group.add(lamp2);
      }
    });

    feature('yachts', function () {
      var hullMat = new THREE.MeshStandardMaterial({ color: 0xf2f5f8, roughness: 0.3, metalness: 0.2 });
      for (var y = 0; y < 9; y++) {
        var sy = model.length * (0.78 + y * 0.012);
        var py = atW(sy, {});
        var yacht = new THREE.Group();
        var hull = new THREE.Mesh(new THREE.BoxGeometry(4, 1.4, 16), hullMat);
        yacht.add(hull);
        var cabin = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.6, 7), new THREE.MeshStandardMaterial({ color: 0xdfe6ec, roughness: 0.4 }));
        cabin.position.set(0, 1.4, -1);
        yacht.add(cabin);
        var lat = (y % 2 ? 1 : -1) * (40 + rnd() * 30);
        yacht.position.set(py.x + Math.cos(py.heading) * lat, 0.4, py.z - Math.sin(py.heading) * lat);
        yacht.rotation.y = py.heading + (rnd() - 0.5) * 0.4;
        group.add(yacht);
      }
    });

    feature('dunes', function () {
      // low, wide sand mounds set well back from the lap: at Zandvoort they
      // are a horizon detail, not boulders beside the track
      var duneMat = new THREE.MeshStandardMaterial({
        color: 0xb9b083, roughness: 0.98, flatShading: true
      });
      var duneGeos = [];
      for (var d2 = 0; d2 < 16; d2++) {
        var sp2 = scatter(model, 1, rnd, { minOff: 190, range: 340 })[0];
        var sc2 = 0.9 + rnd() * 0.6;
        duneGeos.push({
          geo: new THREE.SphereGeometry(30, 9, 6),
          matrix: new THREE.Matrix4().compose(
            new THREE.Vector3(sp2.x, -9 - rnd() * 6, sp2.z),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * TAU, 0)),
            new THREE.Vector3(2.2 * sc2, 0.30 * sc2, 1.6 * sc2))
        });
      }
      group.add(new THREE.Mesh(mergeNonIndexed(duneGeos), duneMat));
    });

    feature('flame-towers', function () {
      var fMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, metalness: 0.6, roughness: 0.4, emissive: 0x5a3a10, emissiveIntensity: 0.4 });
      var towers = [];
      for (var t3 = 0; t3 < 3; t3++) {
        var s3 = atW(model.length * (0.62 + t3 * 0.02), {});
        var lat3 = -90 - t3 * 24;
        towers.push({
          geo: new THREE.ConeGeometry(7, 90, 6),
          matrix: mat(s3.x + Math.cos(s3.heading) * lat3, 45, s3.z - Math.sin(s3.heading) * lat3, 0, 0, 0)
        });
      }
      var tm2 = new THREE.Mesh(mergeNonIndexed(towers), fMat);
      group.add(tm2);
    });

    feature('yas-hotel', function () {
      var s4 = atW(model.length * 0.5, {});
      var hotelMat = new THREE.MeshStandardMaterial({ color: 0x2a3550, metalness: 0.6, roughness: 0.25, emissive: 0x10203a, emissiveIntensity: 0.6 });
      var grid = new THREE.Mesh(new THREE.BoxGeometry(150, 3, 130), hotelMat);
      grid.position.set(s4.x, 58, s4.z);
      grid.rotation.y = s4.heading + 0.3;
      group.add(grid);
      var legMat = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, metalness: 0.5, roughness: 0.4 });
      for (var lg = 0; lg < 6; lg++) {
        var leg = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.2, 58, 8), legMat);
        leg.position.set(s4.x + Math.cos(lg * 1.2) * 46, 29, s4.z + Math.sin(lg * 1.2) * 40);
        group.add(leg);
      }
    });

    feature('observation-tower', function () {
      var s5 = atW(model.length * 0.18, {});
      var twr = new THREE.Group();
      var shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.4, 56, 8),
        new THREE.MeshStandardMaterial({ color: 0xb9c0c8, metalness: 0.6, roughness: 0.4 }));
      shaft.position.y = 28;
      twr.add(shaft);
      var pod = new THREE.Mesh(new THREE.CylinderGeometry(9, 7, 6, 12),
        new THREE.MeshStandardMaterial({ color: 0xd8232a, metalness: 0.4, roughness: 0.4 }));
      pod.position.y = 58;
      twr.add(pod);
      twr.position.set(s5.x + Math.cos(s5.heading) * 130, 0, s5.z - Math.sin(s5.heading) * 130);
      group.add(twr);
    });

    feature('banking', function () {
      // Zandvoort's banked finale already comes from the track model; add the
      // characteristic orange glow of the crowd on the banking
      var bankMat = new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.8, emissive: 0x662000, emissiveIntensity: 0.3 });
      var s6 = atW(model.length * 0.94, {});
      for (var b2 = 0; b2 < 14; b2++) {
        var t4 = b2 / 14;
        var s7 = model.length * (0.9 + t4 * 0.08);
        var p7 = atW(s7, {});
        var blk = new THREE.Mesh(new THREE.BoxGeometry(30, 2.4, 8), bankMat);
        var lat4 = p7.width * 0.5 + 26;
        blk.position.set(p7.x + Math.cos(p7.heading) * lat4, p7.y + 1.2 + t4 * 6, p7.z - Math.sin(p7.heading) * lat4);
        blk.rotation.y = p7.heading;
        group.add(blk);
      }
    });

    feature('marina-bay', function () { /* handled by city + neon */ });
    feature('fake-marina', function () { /* the water builder adds the boats */ });

    feature('forest', function () {
      // Spa / Austria: a dense conifer belt instead of scattered trees
      var beltGeos = [];
      var beltRnd = F1.rng(F1.rng.string(meta.id + '|forest'));
      var reachF = Math.max(model.bounds.maxX - model.bounds.minX, model.bounds.maxZ - model.bounds.minZ) * 0.75 + 260;
      for (var fbi = 0; fbi < 260; fbi++) {
        var fa = beltRnd() * TAU, fr = reachF * (0.55 + beltRnd() * 0.65);
        var fx = Math.cos(fa) * fr, fz = Math.sin(fa) * fr;
        var clear = true;
        for (var fq = 0; fq < model.count; fq += 6) {
          var fdx = model.x[fq] - ORIGIN.x - fx, fdz = model.z[fq] - ORIGIN.z - fz;
          if (fdx * fdx + fdz * fdz < 62 * 62) { clear = false; break; }
        }
        if (!clear) continue;
        var fsc = 0.8 + beltRnd() * 0.9;
        beltGeos.push({
          geo: new THREE.ConeGeometry(2.1, 9.5, 5, 1),
          matrix: new THREE.Matrix4().compose(
            new THREE.Vector3(fx, 4.2 * fsc, fz),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, beltRnd() * TAU, 0)),
            new THREE.Vector3(fsc, fsc, fsc))
        });
      }
      if (beltGeos.length) {
        group.add(new THREE.Mesh(mergeNonIndexed(beltGeos),
          new THREE.MeshStandardMaterial({ color: 0x25482c, roughness: 0.95 })));
      }
    });

    feature('island', function () {
      // Montreal: the circuit sits on its own island in the St Lawrence
      var isl = new THREE.Mesh(new THREE.CylinderGeometry(560, 600, 6, 40), groundMat);
      isl.position.set(0, -3.2, 0);
      isl.name = 'island';
      group.add(isl);
    });

    /* ---- generic landmark kit, placed by lap fraction -------------------
       The calendar lists a lot of named corners/buildings. Rather than one
       bespoke builder per name (unmaintainable, and unverifiable without
       photos), each id maps to a small primitive from a shared kit placed at
       a lap fraction. Keeps the silhouette readable from the car and costs
       almost nothing. -----------------------------------------------------*/
    var KIT = {
      // id: [kind, s-fraction, lateral offset (m, + = right), scale]
      'casino':           ['palace', 0.30, 60, 1.4],
      'old-town':         ['palace', 0.12, 46, 1.0],
      'castle-section':   ['palace', 0.58, 52, 1.2],
      'rascasse':         ['palace', 0.86, 40, 0.8],
      'campus':           ['palace', 0.44, 70, 1.1],
      'exhibition-centre':['hall', 0.10, 74, 1.5],
      'wing-complex':     ['hall', 0.28, 66, 1.6],
      'temple-of-speed':  ['hall', 0.62, 62, 1.3],
      'paddock-club':     ['hall', 0.04, 58, 1.2],
      'paddock':          ['hall', 0.05, 54, 1.0],
      'hotel':            ['tower', 0.52, 82, 1.2],
      'observation-tower':['tower', 0.40, 120, 1.6],
      'hill-turn1':       ['bump', 0.02, 0, 1],
      'hills':            ['bump', 0.5, 0, 1],
      'valley':           ['bump', 0.35, 0, 1],
      'senna-s':          ['kerbs', 0.22, 0, 1],
      'esses':            ['kerbs', 0.18, 0, 1],
      'eau-rouge':        ['kerbs', 0.10, 0, 1],
      'pouhon':           ['kerbs', 0.42, 0, 1],
      'parabolica':       ['kerbs', 0.93, 0, 1],
      'peraltada':        ['kerbs', 0.80, 0, 1],
      'rascasse-kerb':    ['kerbs', 0.86, 0, 1],
      'wall-of-champions':['signwall', 0.02, 0, 1],
      'banked-corner':    ['kerbs', 0.5, 0, 1],
      'monza-oval':       ['oval', 0.80, 250, 1.35],
      'figure-eight':     ['bump', 0.6, 0, 1],
      'interlagos':       ['bump', 0.0, 0, 1],
      'stadium':          ['hall', 0.7, 90, 1.8],
      'harbour':          ['signwall', 0.5, 0, 1],
      'corniche':         ['signwall', 0.3, 0, 1],
      'fountains':        ['fountain', 0.36, 70, 1.0],
      'strip':            ['signwall', 0.45, 0, 1],
      'grandstand-helix': ['hall', 0.16, 70, 1.4],
      'grandstand':       ['hall', 0.2, 60, 1.2]
    };

    var kitStone = new THREE.MeshStandardMaterial({ color: 0xb9b1a3, roughness: 0.9 });
    var kitRoof = new THREE.MeshStandardMaterial({ color: 0x6e5a44, roughness: 0.85 });
    var kitGlass = new THREE.MeshStandardMaterial({ color: 0x7f97ad, roughness: 0.25, metalness: 0.55 });
    var kitWhite = new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.7 });

    features.forEach(function (fid) {
      var kit = KIT[fid];
      if (!kit) return;
      var kind = kit[0], frac = kit[1], latOff = kit[2], scale = kit[3] || 1;
      var pk = atW(model.length * frac, {});
      var side = latOff < 0 ? -1 : 1;
      var lat = latOff === 0 ? 0 : side * (pk.width * 0.5 + Math.abs(latOff));
      var px = pk.x + Math.cos(pk.heading) * lat;
      var pz = pk.z - Math.sin(pk.heading) * lat;
      var ry = pk.heading + (side > 0 ? Math.PI : 0);

      if (kind === 'palace') {
        var pg = new THREE.Group();
        var bw = 34 * scale, bd = 22 * scale, bh = 13 * scale;
        var body = new THREE.Mesh(new THREE.BoxGeometry(bd, bh, bw), kitStone);
        body.position.y = bh / 2;
        pg.add(body);
        var roof = new THREE.Mesh(new THREE.ConeGeometry(bw * 0.62, 7 * scale, 4), kitRoof);
        roof.position.y = bh + 3.5 * scale;
        roof.rotation.y = Math.PI / 4;
        pg.add(roof);
        var wing = new THREE.Mesh(new THREE.BoxGeometry(bd * 0.7, bh * 0.55, bw * 0.32), kitStone);
        wing.position.set(0, bh * 0.28, bw * 0.62);
        pg.add(wing);
        pg.position.set(px, pk.y - 0.2, pz);
        pg.rotation.y = ry;
        group.add(pg);
      } else if (kind === 'hall') {
        var hg = new THREE.Group();
        var hw = 52 * scale, hd = 34 * scale, hh = 15 * scale;
        var hall = new THREE.Mesh(new THREE.BoxGeometry(hd, hh, hw), kitWhite);
        hall.position.y = hh / 2;
        hall.castShadow = true;
        hg.add(hall);
        var glass = new THREE.Mesh(new THREE.BoxGeometry(hd * 1.01, hh * 0.62, hw * 0.99), kitGlass);
        glass.position.y = hh * 0.62;
        hg.add(glass);
        var lip = new THREE.Mesh(new THREE.BoxGeometry(hd * 1.2, 1.0, hw * 1.06), kitWhite);
        lip.position.y = hh + 0.5;
        hg.add(lip);
        hg.position.set(px, pk.y - 0.2, pz);
        hg.rotation.y = ry;
        group.add(hg);
      } else if (kind === 'tower') {
        var th = 70 * scale;
        var tower = new THREE.Group();
        var shaft = new THREE.Mesh(new THREE.CylinderGeometry(4.2 * scale, 6.4 * scale, th, 8), kitGlass);
        shaft.position.y = th / 2;
        tower.add(shaft);
        var deck = new THREE.Mesh(new THREE.CylinderGeometry(11 * scale, 8 * scale, 7 * scale, 10), kitWhite);
        deck.position.y = th * 0.82;
        tower.add(deck);
        var spire = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.2, th * 0.32, 6), kitWhite);
        spire.position.y = th * 1.05;
        tower.add(spire);
        tower.position.set(px, pk.y - 0.2, pz);
        group.add(tower);
      } else if (kind === 'bump') {
        // grass hill with a few trees: enough to break the flat horizon
        var hill = new THREE.Mesh(new THREE.SphereGeometry(58 * scale, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshStandardMaterial({ color: 0x53703f, roughness: 1 }));
        hill.position.set(px, pk.y - 8, pz);
        hill.scale.y = 0.28;
        group.add(hill);
      } else if (kind === 'signwall') {
        var sw = new THREE.Mesh(new THREE.PlaneGeometry(38, 7),
          new THREE.MeshBasicMaterial({
            map: Textures.billboard(meta.name.toUpperCase(), '#0c1420', '#f0f4f8'),
            side: THREE.DoubleSide
          }));
        var latW = pk.width * 0.5 + 20;
        sw.position.set(pk.x + Math.cos(pk.heading) * latW, pk.y + 5.2, pk.z - Math.sin(pk.heading) * latW);
        sw.rotation.y = pk.heading + Math.PI / 2;
        group.add(sw);
      } else if (kind === 'fountain') {
        var fount = new THREE.Mesh(new THREE.CylinderGeometry(14 * scale, 16 * scale, 2.2, 16), kitStone);
        fount.position.set(px, pk.y + 1.0, pz);
        group.add(fount);
        var jet = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.6, 12 * scale, 8),
          new THREE.MeshStandardMaterial({
            color: 0xdff2ff, transparent: true, opacity: 0.55,
            roughness: 0.1, metalness: 0.1
          }));
        jet.position.set(px, pk.y + 7, pz);
        group.add(jet);
      } else if (kind === 'oval') {
        // the old Monza banking, sitting just off the final straight
        var ovalMat = new THREE.MeshStandardMaterial({ color: 0x7d7a72, roughness: 0.98 });
        var ovalPts = [], ovalIdx = [];
        for (var oi = 0; oi <= 48; oi++) {
          var oa = (oi / 48) * Math.PI * 2;
          var orad = 118;
          var ox2 = Math.cos(oa) * orad, oz2 = Math.sin(oa) * orad * 0.55;
          ovalPts.push(ox2, 0, oz2);
          ovalPts.push(ox2 * 0.86, 9.5, oz2 * 0.86);
          if (oi < 48) {
            var ob = oi * 2;
            ovalIdx.push(ob, ob + 1, ob + 2, ob + 1, ob + 3, ob + 2);
          }
        }
        var ovalGeo = new THREE.BufferGeometry();
        ovalGeo.setAttribute('position', new THREE.Float32BufferAttribute(ovalPts, 3));
        ovalGeo.setIndex(ovalIdx);
        ovalGeo.computeVertexNormals();
        var oval = new THREE.Mesh(ovalGeo, ovalMat);
        oval.material.side = THREE.DoubleSide;
        oval.position.set(px, pk.y + 0.2, pz);
        oval.rotation.y = pk.heading;
        group.add(oval);
        // the oval is mostly overgrown: a low green apron under it
        var ovalGrass = new THREE.Mesh(new THREE.CircleGeometry(150, 32),
          new THREE.MeshStandardMaterial({ color: 0x5c7a45, roughness: 1 }));
        ovalGrass.rotation.x = -Math.PI / 2;
        ovalGrass.position.set(px, pk.y - 0.1, pz);
        group.add(ovalGrass);
      }
    });

    /* neon signage for Singapore / Vegas / Jeddah */
    if (theme.neon) {
      var words = ['SINGAPORE', 'F1', 'MARINA BAY', 'NIGHT RACE'];
      words.forEach(function (wd, wi) {
        var s8 = atW(model.length * (0.2 + wi * 0.17), {});
        var banner = new THREE.Mesh(new THREE.PlaneGeometry(46, 11),
          new THREE.MeshBasicMaterial({
            map: Textures.billboard(wd, wi % 2 ? '#12002b' : '#001c2b', wi % 3 === 0 ? '#ff2d9b' : '#00e0c7'),
            side: THREE.DoubleSide
          }));
        var lat5 = (wi % 2 ? 1 : -1) * (model.width[model.indexAt(model.length * (0.2 + wi * 0.17))] * 0.5 + 34);
        banner.position.set(s8.x + Math.cos(s8.heading) * lat5, s8.y + 13, s8.z - Math.sin(s8.heading) * lat5);
        banner.rotation.y = s8.heading + Math.PI / 2;
        group.add(banner);
      });
    }

    /* ---------------- trackside advertising boards ---------------- */
    var boards = [];
    var boardWords = ['PIRELLI', 'ARAMCO', 'DHL', 'ROLEX', 'HEINEKEN'];
    for (var bi = 0; bi < 26; bi++) {
      var s9 = atW((bi / 26) * model.length, {});
      var sideB = bi % 2 ? 1 : -1;
      var lat6 = sideB * (s9.width * 0.5 + 4.6);
      var wd2 = boardWords[bi % boardWords.length];
      boards.push({
        geo: new THREE.PlaneGeometry(9, 1.5),
        matrix: new THREE.Matrix4().compose(
          new THREE.Vector3(s9.x + Math.cos(s9.heading) * lat6, s9.y + 0.95, s9.z - Math.sin(s9.heading) * lat6),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s9.heading + (sideB > 0 ? Math.PI : 0), 0)),
          new THREE.Vector3(1, 1, 1)),
        tex: wd2
      });
    }
    var boardGroups = {};
    boards.forEach(function (b3) {
      (boardGroups[b3.tex] = boardGroups[b3.tex] || []).push({ geo: b3.geo, matrix: b3.matrix });
    });
    Object.keys(boardGroups).forEach(function (key) {
      var mesh = new THREE.Mesh(mergeNonIndexed(boardGroups[key]),
        new THREE.MeshBasicMaterial({ map: Textures.billboard(key, '#101820', '#f2f6fa'), side: THREE.DoubleSide }));
      group.add(mesh);
    });

    /* ---------------- animated bits ---------------- */
    var startLightsOn = 0;
    function update(dt) {
      if (atmo) atmo.update(dt);
      var t = performance.now() * 0.001;
      // start lights idle blink when not in a race
      if (!opts.raceActive) {
        for (var i = 0; i < animated.length; i++) {
          var o = animated[i];
          if (o.userData && o.userData.startLight) {
            o.material.emissiveIntensity = (Math.floor(t * 2) % 2) ? 2.2 : 0.1;
          }
        }
      }
      for (var w = 0; w < animated.length; w++) {
        var an = animated[w];
        if (an.userData && an.userData.spinWheel && an.object3d) an.object3d.rotation.z += dt * 0.12;
      }
      if (theme.neon) {
        // gentle neon shimmer
        group.traverse(function (o) {
          if (o.isMesh && o.material && o.material.emissiveIntensity !== undefined && o.material.emissive) {
            if (o.material.userData && o.material.userData.neon) {
              o.material.emissiveIntensity = 1.4 + Math.sin(t * 5 + o.id) * 0.35;
            }
          }
        });
      }
    }

    /* ---------------- API ---------------- */
    return {
      group: group,
      sky: sky,
      atmo: atmo,
      envMap: envMap,
      sun: sun,
      ambient: ambient,
      fogColor: atmo.fogColor,
      fogNearK: atmo.fogNearK,
      fogFarK: atmo.fogFarK,
      exposure: atmo.exposure,
      grade: atmo.grade,
      floodlights: floodlights,
      update: update,
      setShadowFocus: setShadowFocus,
      meta: meta,
      model: model,
      setFogHook: function (fn) { fogHook = fn; },
      setWeather: function (state) {
        weather = state;
        var wet = state === 'wet';
        var overcast = state === 'overcast' || wet;
        var base = atmo.preset;
        if (atmo.setWeather) atmo.setWeather(overcast ? 'overcast' : 'dry');
        if (F1.post && F1.post.setGrade) {
          F1.post.setGrade({
            exposure: base.exposure * (overcast ? 1.12 : 1),
            saturation: (base.grade.saturation || 1.05) * (overcast ? 0.9 : 1)
          });
        }
        if (fogHook) fogHook(atmo.fogColor.clone().lerp(new THREE.Color(0x8b96a0), overcast ? 0.55 : 0));
        if (setSurfaceWet) setSurfaceWet(wet ? 1 : overcast ? 0.45 : 0);
      },
      dispose: function () {
        group.traverse(function (o) {
          if (o.isMesh) {
            if (o.geometry) o.geometry.dispose();
            if (o.material) {
              var mats = Array.isArray(o.material) ? o.material : [o.material];
              mats.forEach(function (m) { m.dispose(); });
            }
          }
        });
      }
    };

  };

  /* ------------------------------------------------------------------ */
  /* minimap path (used by the HUD in Section 3)                        */
  /* ------------------------------------------------------------------ */
  F1.world.minimapPath = function (model, w, h, pad) {
    pad = pad || 8;
    var minX = model.bounds.minX, maxX = model.bounds.maxX;
    var minZ = model.bounds.minZ, maxZ = model.bounds.maxZ;
    var sx = (w - pad * 2) / Math.max(1e-6, maxX - minX);
    var sz = (h - pad * 2) / Math.max(1e-6, maxZ - minZ);
    var s = Math.min(sx, sz);
    var ox = pad + ((w - pad * 2) - (maxX - minX) * s) / 2;
    var oz = pad + ((h - pad * 2) - (maxZ - minZ) * s) / 2;
    var pts = [];
    for (var i = 0; i <= model.count; i += 4) {
      pts.push([ox + (model.x[i] - minX) * s, oz + (model.z[i] - minZ) * s]);
    }
    return {
      pts: pts,
      toScreen: function (x, z) {
        return [ox + (x - minX) * s, oz + (z - minZ) * s];
      }
    };
  };

})(window.F1 = window.F1 || {});
