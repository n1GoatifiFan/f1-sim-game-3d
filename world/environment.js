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
        ctx.fillStyle = '#565a5f';
        ctx.fillRect(0, 0, w, h);
        for (var i = 0; i < 900; i++) {
          ctx.fillStyle = 'rgba(255,255,255,' + (rnd() * 0.06) + ')';
          ctx.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 6, 2 + rnd() * 6);
        }
        ctx.strokeStyle = 'rgba(30,32,35,0.5)';
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
      var yA = cy + Math.tan(bank) * la + (opts.lift || 0);
      var yB = cy + Math.tan(bank) * lb + (opts.lift || 0);
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

    /* ---------------- lighting + sky ---------------- */
    var skyPreset = SKY_PRESETS[meta.timeOfDay] || SKY_PRESETS.day;
    var sky = makeSky(skyPreset);
    sky.renderOrder = -1000;      // always behind everything else
    sky.material.depthTest = false;
    group.add(sky);

    var ambientLevel = skyPreset.ambient * 3.0;
    if (meta.timeOfDay === 'night') ambientLevel = Math.max(ambientLevel, 0.5);
    if (meta.timeOfDay === 'twilight') ambientLevel = Math.max(ambientLevel, 1.6);
    var ambient = new THREE.HemisphereLight(
      new THREE.Color(skyPreset.bottom), new THREE.Color(theme.ground), ambientLevel);
    ambient.position.set(0, 300, 0);
    group.add(ambient);

    // daylight in the physically-correct units of r155+: a sun is ~3 lux,
    // an overcast sky ~1.3. Anything below ~1 renders black asphalt.
    var sunElev = meta.timeOfDay === 'golden' ? 0.34 : meta.timeOfDay === 'twilight' ? 0.12 : 0.95;
    var sun = new THREE.DirectionalLight(0xfff3e0, skyPreset.sun * 3.4);
    sun.position.set(420, 620 * sunElev, 260);
    if (meta.timeOfDay === 'golden') sun.color.setHex(0xffd3a0);
    if (meta.timeOfDay === 'night') sun.color.setHex(0x8fa6d8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    // A shadow map spanning the whole circuit is ~1 m per texel and makes
    // every flat surface self-shadow (black tarmac). Keep the frustum tight
    // and move it with the action instead (setShadowFocus).
    var SHADOW_HALF = 150;
    sun.shadow.camera.left = -SHADOW_HALF; sun.shadow.camera.right = SHADOW_HALF;
    sun.shadow.camera.top = SHADOW_HALF; sun.shadow.camera.bottom = -SHADOW_HALF;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 1500;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.06;
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.position.set(0, 0, 0);
    sun.position.set(420, 589, 260);
    group.add(sun, sun.target);
    var sunDir = sun.position.clone().normalize().multiplyScalar(700);
    function setShadowFocus(x, z) {
      sun.target.position.set(x, 0, z);
      sun.position.set(x + sunDir.x, sunDir.y, z + sunDir.z);
      sun.target.updateMatrixWorld();
    }

    var isNight = meta.timeOfDay === 'night' || meta.timeOfDay === 'twilight';
    var floodlights = [];
    if (isNight) {
      // Floodlights: point lights spaced along the lap, hung over the track
      // edge. Physically-correct units in r155+ mean candela values in the
      // thousands are needed to read as "lit" from 30 m up.
      var nFlood = Math.min(14, Math.max(6, Math.round(model.length / 340)));
      for (var fi = 0; fi < nFlood; fi++) {
        var sF = (fi / nFlood) * model.length;
        var pF = atW(sF, {});
        var side = fi % 2 ? 1 : -1;
        var latF = side * (model.width[Math.round(sF / model.step) % model.count] * 0.5 + 16);
        var fl = new THREE.PointLight(0xfff2d8, 4200, 300, 1.7);
        fl.position.set(pF.x + Math.cos(pF.heading) * latF, pF.y + 30,
                        pF.z - Math.sin(pF.heading) * latF);
        group.add(fl);
        floodlights.push(fl);
      }
      // a soft cool "moon" so nothing is pitch black away from the lamps
      var moon = new THREE.DirectionalLight(0x9fb6e0, 0.85);
      moon.position.set(-300, 500, 220);
      group.add(moon);
    }

    /* ---------------- ground ---------------- */
    var spanW = Math.max(model.bounds.maxX - model.bounds.minX, model.bounds.maxZ - model.bounds.minZ);
    var groundSize = Math.max(3200, spanW * 2.4);
    var groundTex = (theme.sand ? Textures.sand() : Textures.grass());
    groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(groundSize / 26, groundSize / 26);
    var groundMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(theme.sand ? '#c9b98f' : F1.util.mixHex(theme.ground, '#ffffff', 0.55)),
      map: groundTex, roughness: 0.98, metalness: 0
    });
    // ground box: the visible top face plus a thick skirt so low camera
    // angles never see the void under the terrain
    var groundGeo = new THREE.BoxGeometry(groundSize, 240, groundSize);
    var ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.set(0, -120 - 0.35, 0);
    ground.receiveShadow = false;      // too large for reliable shadow reception
    group.add(ground);

    /* ---------------- run-off (grass/gravel/sand apron) ---------------- */
    var runMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(theme.sand ? '#d7c49a' : (theme.style === 'desert' ? '#c4ac80' : '#7d9a63')),
      map: (theme.sand ? Textures.sand() : Textures.grass()),
      roughness: 0.98, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, side: THREE.DoubleSide
    });
    runMat.map.repeat.set(60, 60);
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

    /* ---------------- barriers or street walls ---------------- */
    var wallTex = Textures.concrete();
    var barrierMat = new THREE.MeshStandardMaterial({
      map: wallTex, color: 0xcfd4d8, roughness: 0.8, side: THREE.DoubleSide
    });
    var wallMesh = new THREE.Mesh(wallRibbon(model, function (k) {
      return model.width[k] * 0.5 + 2.2;
    }, 0.95, { step: 2 }), barrierMat);
    wallMesh.castShadow = true; wallMesh.receiveShadow = true;
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
    var standMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.85 });
    var roofMat = new THREE.MeshStandardMaterial({ color: 0xdfe3e7, roughness: 0.6, metalness: 0.25 });
    var crowdMat = new THREE.MeshStandardMaterial({ map: Textures.crowd(), roughness: 0.9 });
    var standGeos = [], roofGeos = [], crowdPlacements = [];

    function addGrandstand(s, side, sizeMul) {
      var w = model.width[s];
      var lat = side * (w * 0.5 + (theme.walls ? 8 : 12));
      var h = model.heading[s];
      var px = model.x[s] - ORIGIN.x + Math.cos(h) * lat;
      var pz = model.z[s] - ORIGIN.z - Math.sin(h) * lat;
      var py = model.y[s];
      var len = 46 * (sizeMul || 1);
      var depth = 15;
      var tiers = 6;
      var base = new THREE.BoxGeometry(depth, 1.2, len);
      var local = new THREE.Matrix4().compose(
        new THREE.Vector3(px, py + 1.4, pz),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, h + (side > 0 ? 0 : Math.PI), 0)),
        new THREE.Vector3(1, 1, 1));
      standGeos.push({ geo: base, matrix: local });
      for (var ti = 0; ti < tiers; ti++) {
        var tierGeo = new THREE.BoxGeometry(depth * 0.9, 0.55, len);
        var off = side * (ti * 1.5 - 3);
        var tm = new THREE.Matrix4().compose(
          new THREE.Vector3(px + Math.cos(h) * off, py + 2 + ti * 1.05, pz - Math.sin(h) * off),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, h + (side > 0 ? 0 : Math.PI), 0)),
          new THREE.Vector3(1, 1, 1));
        standGeos.push({ geo: tierGeo, matrix: tm });
        // crowd clusters on each tier
        var seats = Math.round(9 * (sizeMul || 1));
        for (var c2 = 0; c2 < seats; c2++) {
          var off2 = side * (ti * 1.5 - 3) + (rnd() - 0.5) * 1.0;
          var along = (rnd() - 0.5) * len * 0.92;
          crowdPlacements.push({
            x: px + Math.cos(h) * off2 + Math.sin(h) * along,
            y: py + 2.4 + ti * 1.05,
            z: pz - Math.sin(h) * off2 + Math.cos(h) * along,
            s: 0.8 + rnd() * 0.5
          });
        }
      }
      var roofGeo = new THREE.BoxGeometry(depth * 1.15, 0.35, len * 1.02);
      var rm = new THREE.Matrix4().compose(
        new THREE.Vector3(px + Math.cos(h) * side * 1.5, py + 2 + tiers * 1.05 + 1.6, pz - Math.sin(h) * side * 1.5),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, h + (side > 0 ? 0 : Math.PI), 0)),
        new THREE.Vector3(1, 1, 1));
      roofGeos.push({ geo: roofGeo, matrix: rm });
      // support pillars
      [-len * 0.42, len * 0.42].forEach(function (al) {
        var pg = new THREE.BoxGeometry(0.4, 7.5, 0.4);
        var pm = new THREE.Matrix4().compose(
          new THREE.Vector3(px + Math.sin(h) * al + Math.cos(h) * side * 5, py + 5.5, pz + Math.cos(h) * al - Math.sin(h) * side * 5),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, h, 0)),
          new THREE.Vector3(1, 1, 1));
        standGeos.push({ geo: pg, matrix: pm });
      });
    }

    var standSpots = opts.stands || [
      { s: model.length * 0.985, side: 1, size: 1.5 },
      { s: model.length * 0.05, side: -1, size: 1.2 },
      { s: model.length * 0.28, side: 1, size: 0.9 },
      { s: model.length * 0.55, side: -1, size: 0.9 },
      { s: model.length * 0.74, side: 1, size: 0.8 }
    ];
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
        var bm = new THREE.Matrix4().compose(
          new THREE.Vector3(bx, pp.y + 3.2, bz),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, pp.h, 0)),
          new THREE.Vector3(1, 1, 1));
        buildingGeos.push({ geo: new THREE.BoxGeometry(12, 6.4, garageLen * 0.98), matrix: bm });
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
    var treeCount = theme.trees === 'none' ? 0 : Math.round((theme.trees === 'sparse' ? 160 : 520) * (opts.density || 1));
    if (treeCount) {
      var trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 3.2, 6);
      var leafGeo = theme.trees === 'pine'
        ? new THREE.ConeGeometry(2.4, 7.5, 7)
        : theme.palm
          ? new THREE.ConeGeometry(0.9, 3.2, 5)
          : new THREE.IcosahedronGeometry(2.4, 1);
      var trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.95 });
      var leafMat = new THREE.MeshStandardMaterial({
        color: theme.trees === 'pine' ? 0x21402a : (theme.palm ? 0x3d6b3a : 0x33572e),
        roughness: 0.9, flatShading: true
      });
      var spots = scatter(model, treeCount, rnd, { minOff: 12, range: 150, minScale: 0.7, scaleVar: 0.9 });
      var trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
      var leaves = new THREE.InstancedMesh(leafGeo, leafMat, spots.length);
      var mm = new THREE.Matrix4();
      spots.forEach(function (sp, si) {
        var sc = sp.scale * (theme.trees === 'pine' ? 1.1 : 0.9);
        mm.compose(new THREE.Vector3(sp.x, sp.y + 1.6 * sc, sp.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sp.rot, 0)),
          new THREE.Vector3(sc, sc, sc));
        trunks.setMatrixAt(si, mm);
        mm.compose(new THREE.Vector3(sp.x, sp.y + (theme.trees === 'pine' ? 5.6 : 4.4) * sc, sp.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sp.rot, 0)),
          new THREE.Vector3(sc, sc, sc));
        leaves.setMatrixAt(si, mm);
      });
      trunks.instanceMatrix.needsUpdate = true;
      leaves.instanceMatrix.needsUpdate = true;
      trunks.castShadow = leaves.castShadow = true;
      group.add(trunks, leaves);
    }

    /* ---------------- city blocks (street circuits) ---------------- */
    if (theme.city) {
      var blockMatA = new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.7, metalness: 0.2 });
      var blockMatB = new THREE.MeshStandardMaterial({
        color: 0x1e242c, roughness: 0.35, metalness: 0.5, map: Textures.facade(true)
      });
      var blocksA = [], blocksB = [];
      var cityCount = 46;
      var spots2 = scatter(model, cityCount, rnd, { minOff: 30, range: 130 });
      spots2.forEach(function (sp, si) {
        var hgt = 14 + rnd() * 60;
        var wid = 18 + rnd() * 26;
        var dep = 18 + rnd() * 26;
        var geo = new THREE.BoxGeometry(wid, hgt, dep);
        var m2 = mat(sp.x, sp.y + hgt / 2, sp.z, 0, sp.rot, 0);
        (si % 2 ? blocksA : blocksB).push({ geo: geo, matrix: m2 });
      });
      var cityA = new THREE.Mesh(mergeNonIndexed(blocksA), blockMatA);
      var cityB = new THREE.Mesh(mergeNonIndexed(blocksB), blockMatB);
      cityA.castShadow = true; cityB.castShadow = true;
      group.add(cityA, cityB);
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
        var offP = sideP * (pP.width * 0.5 + 26);
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
    var features = meta.features || [];
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
      var duneMat = new THREE.MeshStandardMaterial({ color: 0xc2ae86, roughness: 0.95, flatShading: true });
      for (var d2 = 0; d2 < 22; d2++) {
        var sp2 = scatter(model, 1, rnd, { minOff: 60, range: 220 })[0];
        var dune = new THREE.Mesh(new THREE.SphereGeometry(20 + rnd() * 30, 10, 7), duneMat);
        dune.scale.set(1.8 + rnd(), 0.35 + rnd() * 0.2, 1.4 + rnd());
        dune.position.set(sp2.x, -3, sp2.z);
        group.add(dune);
      }
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
      envMap: makeEnvMap(skyPreset),
      sun: sun,
      ambient: ambient,
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
        var base = SKY_PRESETS[meta.timeOfDay] || SKY_PRESETS.day;
        roadMat.roughness = wet ? 0.22 : 0.85;
        roadMat.metalness = wet ? 0.4 : 0.02;
        ambient.intensity = base.ambient * (meta.timeOfDay === 'night' ? 0.5 : 3.0) * (overcast ? 1.1 : 1);
        sun.intensity = base.sun * (meta.timeOfDay === 'night' ? 0.85 : 3.4) * (overcast ? 0.3 : 1);
        var top = wet ? 0x4a5560 : (overcast ? 0xb7c1c9 : null);
        var bottom = wet ? 0x7c8792 : (overcast ? 0xcfd8de : null);
        if (top !== null) {
          sky.material.uniforms.top.value.setHex(top);
          sky.material.uniforms.bottom.value.setHex(bottom);
          if (fogHook) fogHook(new THREE.Color(bottom));
        } else {
          sky.material.uniforms.top.value.set(skyPreset.top);
          sky.material.uniforms.bottom.value.set(skyPreset.bottom);
          if (fogHook) fogHook(new THREE.Color(skyPreset.bottom));
        }
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
