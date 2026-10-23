/* ==========================================================================
   F1 2026 — physics/track.js
   Track geometry engine. Turns a compact segment definition (straights and
   corners, the arrays stored in data/circuits/<id>.js) into a sampled,
   closed centreline with width, camber, elevation, kerbs, sectors and DRS
   zones, plus fast spatial queries used by physics, AI, HUD and the world
   builder.

   Coordinate system
     X east/right, Y up, Z north. The track lies in the XZ plane.
     heading 0 = +Z, positive heading rotates towards +X (which is a LEFT
     turn when driving along +Z with +Y up). Position = (sin h, cos h).
     `s` = distance along the centreline in metres, 0 at the start/finish
     line, increasing in the direction of travel.

   Segment definition (see data/circuits/defs.js)
     ['s', metres]                 straight
     ['r', degrees, radius]        right-hand corner (clockwise)
     ['l', degrees, radius]        left-hand corner
     ['k', deg, r, deg, r, ...]    alternating chicane shorthand (r,l,r,l...)
   Definition fields:
     segs, width, widthScale, elevation [[frac, metres]...], banking
     [[frac0, frac1, degrees]...], drs [[frac0, frac1]...], sectors [f1, f2],
     startFrac (where S/F sits in the loop), pit { entry, exit, offset }
   ========================================================================== */
(function (F1) {
  'use strict';

  var TAU = Math.PI * 2;
  var STEP = 4;                    // centreline sampling step (metres)
  var KERB_COLOR = { normal: '#d8232a', soft: '#f2f2f2' };

  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */
  function smoothstep(a, b, t) {
    t = Math.max(0, Math.min(1, (t - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  /* sample a keyframe list [[frac, value]...] with smooth (cosine) blending */
  function sampleKeys(keys, frac, wrap) {
    if (!keys || !keys.length) return 0;
    if (keys.length === 1) return keys[0][1];
    var f = frac;
    var f1, v1, f2, v2, i;
    for (i = 0; i < keys.length - 1; i++) {
      if (f >= keys[i][0] && f <= keys[i + 1][0]) {
        f1 = keys[i][0]; v1 = keys[i][1];
        f2 = keys[i + 1][0]; v2 = keys[i + 1][1];
        var t = (f - f1) / Math.max(1e-6, (f2 - f1));
        return v1 + (v2 - v1) * (t * t * (3 - 2 * t));
      }
    }
    if (wrap) {
      f1 = keys[keys.length - 1][0]; v1 = keys[keys.length - 1][1];
      f2 = keys[0][0] + 1; v2 = keys[0][1];
      var fw = f < f1 ? f + 1 : f;
      var tw = (fw - f1) / Math.max(1e-6, (f2 - f1));
      return v1 + (v2 - v1) * (tw * tw * (3 - 2 * tw));
    }
    return keys[f < keys[0][0] ? 0 : keys.length - 1][1];
  }

  /* ------------------------------------------------------------------ */
  /* 1. expand segments into an ordered command list                     */
  /* ------------------------------------------------------------------ */
  function expandSegments(def) {
    var out = [];
    def.segs.forEach(function (seg) {
      var kind = seg[0];
      if (kind === 's') {
        out.push({ type: 's', len: +seg[1] });
      } else if (kind === 'r' || kind === 'l') {
        var deg = +seg[1], r = +seg[2];
        out.push({ type: 'c', deg: (kind === 'r' ? -1 : 1) * deg, r: r });
      } else if (kind === 'k') {
        // chicane: pairs of (deg, radius) alternating right, left, right...
        for (var i = 1; i < seg.length - 1; i += 2) {
          var sgn = ((i - 1) / 2) % 2 === 0 ? -1 : 1;
          out.push({ type: 'c', deg: sgn * +seg[i], r: +seg[i + 1] });
        }
      }
    });
    return out;
  }

  /* turn the command list into a polyline; `lengthScale` scales straights,
     `angleScale` scales every corner angle (used to close the loop) */
  function buildPolyline(cmds, lengthScale, angleScale, startPos, startHeading, arcStep, biasCurv) {
    var pts = [{ x: startPos.x, z: startPos.z, h: startHeading }];
    var x = startPos.x, z = startPos.z, h = startHeading;
    arcStep = arcStep || 1.5;
    biasCurv = biasCurv || 0;
    cmds.forEach(function (cmd) {
      if (cmd.type === 's') {
        var n = Math.max(1, Math.min(4000, Math.ceil(cmd.len * lengthScale / 4)));
        var d = cmd.len * lengthScale / n;
        for (var i = 0; i < n; i++) {
          var hMidS = h + biasCurv * d * 0.5;
          x += Math.sin(hMidS) * d; z += Math.cos(hMidS) * d;
          h += biasCurv * d;
          pts.push({ x: x, z: z, h: h });
        }
      } else {
        var ang = cmd.deg * Math.PI / 180 * angleScale;
        var arcLen = Math.abs(ang) * cmd.r;
        var n2 = Math.max(2, Math.min(4000, Math.ceil(arcLen / arcStep)));
        var dAng = ang / n2;
        for (var j = 0; j < n2; j++) {
          // chord approximation: rotate the heading then advance half way
          var chord = 2 * cmd.r * Math.sin(Math.abs(dAng) / 2);
          var hMid = h + dAng * 0.5 + biasCurv * chord * 0.5;
          x += Math.sin(hMid) * chord;
          z += Math.cos(hMid) * chord;
          h += dAng + biasCurv * chord;
          pts.push({ x: x, z: z, h: h });
        }
      }
    });
    return pts;
  }

  function polylineLength(pts) {
    var len = 0;
    for (var i = 1; i < pts.length; i++) {
      len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    }
    return len;
  }

  /* apply a quadratic closing offset so the loop ends exactly at the start */
  function closeLoop(pts) {
    var n = pts.length;
    var gapX = pts[0].x - pts[n - 1].x;
    var gapZ = pts[0].z - pts[n - 1].z;
    // distances must be measured on the ORIGINAL geometry: shifting points
    // in place while accumulating would feed the offset back into the maths
    var cum = new Float64Array(n);
    for (var c = 1; c < n; c++) {
      cum[c] = cum[c - 1] + Math.hypot(pts[c].x - pts[c - 1].x, pts[c].z - pts[c - 1].z);
    }
    var total = cum[n - 1] || 1;
    for (var i = 1; i < n; i++) {
      var t = cum[i] / total;
      var w = t * t;                    // 0 at the start, 1 at the end
      pts[i].x += gapX * w;
      pts[i].z += gapZ * w;
    }
    // refresh headings from the corrected geometry
    for (var j = 0; j < n; j++) {
      var a = pts[Math.max(0, j - 1)], b = pts[Math.min(n - 1, j + 1)];
      pts[j].h = Math.atan2(b.x - a.x, b.z - a.z);
    }
    return pts;
  }

  /* ------------------------------------------------------------------ */
  /* 2. resample at a fixed step                                          */
  /* ------------------------------------------------------------------ */
  function resample(pts, step) {
    var out = [];
    var x = pts[0].x, z = pts[0].z;
    var seg = 0;
    var segStartX = pts[0].x, segStartZ = pts[0].z;
    var segEndX = pts[1].x, segEndZ = pts[1].z;
    var segLen = Math.hypot(segEndX - segStartX, segEndZ - segStartZ) || 1;
    var travelled = 0;
    var target = 0;
    out.push({ x: pts[0].x, z: pts[0].z });
    var guard = 0;
    while (guard++ < 200000) {
      var need = step - (travelled - target);
      if (need <= segLen - (travelled - target)) {
        var t = (travelled - target + need) / segLen;
        t = Math.min(1, t);
        x = segStartX + (segEndX - segStartX) * t;
        z = segStartZ + (segEndZ - segStartZ) * t;
        out.push({ x: x, z: z });
        travelled += need;
        // advance along the same segment for the next sample
        var newT = (travelled - target) / segLen;
        if (newT > 1) { /* move to next segment below */ }
      }
      // move to next segment
      target += segLen;
      seg++;
      if (seg >= pts.length - 1) break;
      segStartX = pts[seg - 1].x; segStartZ = pts[seg - 1].z;
      segEndX = pts[seg].x; segEndZ = pts[seg].z;
      segLen = Math.hypot(segEndX - segStartX, segEndZ - segStartZ) || 0.0001;
    }
    return out;
  }

  /* simpler + robust resample: walk the polyline by arclength */
  function resampleByArc(pts, step) {
    var cum = [0];
    for (var i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    }
    var total = cum[cum.length - 1];
    var count = Math.max(8, Math.round(total / step));
    var out = new Array(count + 1);
    var j = 0;
    for (var k = 0; k <= count; k++) {
      var target = (k / count) * total;
      while (j < cum.length - 2 && cum[j + 1] < target) j++;
      var span = cum[j + 1] - cum[j] || 1e-6;
      var t = Math.max(0, Math.min(1, (target - cum[j]) / span));
      out[k] = {
        x: pts[j].x + (pts[j + 1].x - pts[j].x) * t,
        z: pts[j].z + (pts[j + 1].z - pts[j].z) * t,
        w: (pts[j].w !== undefined || pts[j + 1].w !== undefined)
          ? ((pts[j].w || 12) + ((pts[j + 1].w || 12) - (pts[j].w || 12)) * t) : 0
      };
    }
    out.length = count + 1;
    out[count] = { x: out[0].x, z: out[0].z, w: out[0].w };   // exact closure
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 3. the track model                                                   */
  /* ------------------------------------------------------------------ */
  function build(def) {
    var cmds = expandSegments(def);
    var totalTurn = 0;

    // rotate/rescale the definition so the lap length matches the real value
    var start = { x: 0, z: 0 };
    var target = def.length || 5000;
    var pts, len, iter;

    /* --- 1. direction normalisation ------------------------------------
       Any closed lap turns through exactly +/-360 degrees. Hand-authored
       corner lists rarely balance, so scale corners that turn the intended
       way up and corner arcs that fight it down until the net rotation is
       right. Chicanes stay asymmetric (as they are in reality) instead of
       being mirrored, which keeps the circuit's character. */
    var cw = def.cw !== false;
    var netTarget = def.netTurn !== undefined ? def.netTurn : (cw ? -360 : 360);
    var R = 0, O = 0;
    cmds.forEach(function (c) {
      if (c.type !== 'c') return;
      if (Math.sign(c.deg) === Math.sign(netTarget) || netTarget === 0) R += Math.abs(c.deg);
      else O += Math.abs(c.deg);
    });
    var aScale = 1, bScale = 1;
    if (netTarget !== 0 && R > 0) {
      var k = 0.42;
      aScale = F1.util.clamp(Math.abs(netTarget) / Math.max(1, R - k * O), 0.65, 1.45);
      bScale = k * aScale;
    }
    cmds = cmds.map(function (c) {
      if (c.type !== 'c') return c;
      var intended = netTarget === 0 || Math.sign(c.deg) === Math.sign(netTarget);
      var f = intended ? aScale : bScale;
      return { type: 'c', deg: c.deg * f, r: c.r * F1.util.clamp(Math.sqrt(f), 0.7, 1.5) };
    });
    totalTurn = cmds.reduce(function (acc, c) { return acc + (c.type === 'c' ? c.deg : 0); }, 0);

    /* --- 2. fit the lap -------------------------------------------------
       Three things must line up: total rotation (+/-360), a closed position
       loop, and the real lap length. Corner arcs are computed analytically
       and the straights absorb the length difference; any rotation still
       missing is spread over the whole lap as a tiny constant curvature
       (straights on real circuits are never perfectly straight either). */
    function cornerLength() {
      return cmds.reduce(function (acc, c) {
        return acc + (c.type === 'c' ? Math.abs(c.deg) * Math.PI / 180 * c.r : 0);
      }, 0);
    }
    var st0 = cmds.reduce(function (acc, c) { return acc + (c.type === 's' ? c.len : 0); }, 0);
    var netTurn = cmds.reduce(function (acc, c) { return acc + (c.type === 'c' ? c.deg : 0); }, 0);

    var lengthScale = F1.util.clamp((target - cornerLength()) / Math.max(1, st0), 0.08, 8);
    var biasCurv = -((netTarget - netTurn) * Math.PI / 180) / Math.max(1, target);
    var closedOk = false;
    var shrinkGuard = 0;

    for (iter = 0; iter < 12; iter++) {
      pts = buildPolyline(cmds, lengthScale, 1, start, 0, 1.5, biasCurv);
      var rawLen = polylineLength(pts);
      var endH = Math.atan2(Math.sin(pts[pts.length - 1].h), Math.cos(pts[pts.length - 1].h));
      pts = closeLoop(pts);
      len = polylineLength(pts);

      var lenErr = Math.abs(len - target) / target;
      if (lenErr < 0.0012 && Math.abs(endH) < 0.003) { closedOk = true; break; }

      // steer the heading home
      if (Math.abs(endH) > 0.002) biasCurv -= endH / Math.max(1, rawLen);

      // push the length towards the target through the straights
      var need = target - len;
      if (Math.abs(need) > target * 0.0012 && st0 > 40) {
        lengthScale = F1.util.clamp(lengthScale + need / st0 * 0.9, 0.06, 8);
      } else if (Math.abs(need) > target * 0.0012 && shrinkGuard++ < 3) {
        // no straights left to stretch: trim the corner radii instead
        var shrink = F1.util.clamp(target / Math.max(1, cornerLength()), 0.3, 1);
        cmds = cmds.map(function (c) {
          return c.type === 'c' ? { type: 'c', deg: c.deg, r: Math.max(7, c.r * shrink) } : c;
        });
      }
    }
    if (!closedOk) {
      pts = closeLoop(buildPolyline(cmds, lengthScale, 1, start, 0, 1.5, biasCurv));
      len = polylineLength(pts);
    }

    return finalize(def, pts);
  }

  /* ------------------------------------------------------------------ */
  /* 3b. shared post-processing: resample + derive every per-sample data */
  /* ------------------------------------------------------------------ */
  function finalize(def, inputPts) {
    var step = def.step || STEP;
    var rs = resampleByArc(inputPts, step);
    var n = rs.length;
    var count = n - 1;
    var segLen = 0;
    for (var q = 1; q < n; q++) segLen += Math.hypot(rs[q].x - rs[q - 1].x, rs[q].z - rs[q - 1].z);
    segLen = segLen / count;

    var x = new Float32Array(count + 1);
    var y = new Float32Array(count + 1);
    var z = new Float32Array(count + 1);
    var heading = new Float32Array(count + 1);
    var width = new Float32Array(count + 1);
    var curvature = new Float32Array(count + 1);
    var banking = new Float32Array(count + 1);
    var sArc = new Float32Array(count + 1);
    var wIn = new Float32Array(count + 1);

    var i;
    for (i = 0; i <= count; i++) {
      x[i] = rs[i].x; z[i] = rs[i].z;
      sArc[i] = i * segLen;
      wIn[i] = rs[i].w || 0;
    }
    for (i = 0; i <= count; i++) {
      var a = (i - 1 + count) % count, b = (i + 1) % count;
      heading[i] = Math.atan2(x[b] - x[a], z[b] - z[a]);
    }
    for (i = 0; i <= count; i++) {
      var prev = (i - 1 + count) % count, next = (i + 1) % count;
      var dh = heading[next] - heading[prev];
      while (dh > Math.PI) dh -= TAU;
      while (dh < -Math.PI) dh += TAU;
      curvature[i] = dh / (2 * segLen);
    }
    function boxSmooth(arr, radius) {
      var out = new Float32Array(arr.length);
      for (var p2 = 0; p2 < arr.length; p2++) {
        var acc = 0, cnt = 0;
        for (var q2 = -radius; q2 <= radius; q2++) { acc += arr[(p2 + q2 + count) % count]; cnt++; }
        out[p2] = acc / cnt;
      }
      out[count] = out[0];
      return out;
    }
    curvature = boxSmooth(curvature, 2);

    var baseW = def.width || 12;
    var hasWidth = false;
    for (i = 0; i < count; i++) if (wIn[i] > 2) { hasWidth = true; break; }
    if (hasWidth) {
      for (i = 0; i <= count; i++) width[i] = F1.util.clamp(wIn[i], 7, 22);
      var smoothed = boxSmooth(width, 2);
      for (i = 0; i <= count; i++) width[i] = smoothed[i];
    } else {
      for (i = 0; i <= count; i++) {
        var k = Math.abs(curvature[i]);
        var straightness = 1 - Math.min(1, k * 120);
        width[i] = baseW * (0.94 + 0.14 * straightness);
      }
    }

    for (i = 0; i <= count; i++) {
      var frac = i / count;
      y[i] = sampleKeys(def.elevation, frac, true);
      if (def.banking) {
        var bank = 0;
        def.banking.forEach(function (band) {
          if (frac >= band[0] && frac <= band[1]) {
            var inT = smoothstep(band[0], band[0] + 0.015, frac);
            var outT = 1 - smoothstep(band[1] - 0.015, band[1], frac);
            bank = Math.max(bank, band[2] * Math.min(inT, outT));
          }
        });
        banking[i] = bank * Math.PI / 180;
      }
    }
    y[count] = y[0];

    var kerbLeft = new Uint8Array(count + 1);
    var kerbRight = new Uint8Array(count + 1);
    for (i = 0; i <= count; i++) {
      var kk = curvature[i];
      if (Math.abs(kk) > 1 / 260) {
        if (kk > 0) kerbLeft[i] = 1; else kerbRight[i] = 1;
      }
    }

    var sectors = def.sectors || [0.33, 0.66];
    var drs = def.drs || [[0.06, 0.13], [0.42, 0.5], [0.78, 0.86]];
    var length = count * segLen;

    var tx = new Float32Array(count + 1), tz = new Float32Array(count + 1);
    var nx = new Float32Array(count + 1), nz = new Float32Array(count + 1);
    for (i = 0; i <= count; i++) {
      tx[i] = Math.sin(heading[i]); tz[i] = Math.cos(heading[i]);
      nx[i] = tz[i]; nz[i] = -tx[i];
    }

    var model = {
      id: def.id,
      def: def,
      count: count,
      step: length / count,
      length: length,
      targetLength: def.length || length,
      x: x, y: y, z: z,
      heading: heading, tx: tx, tz: tz, nx: nx, nz: nz,
      width: width, curvature: curvature, banking: banking,
      kerbLeft: kerbLeft, kerbRight: kerbRight,
      elevationKeys: def.elevation,
      sectors: sectors,
      drs: drs,
      pit: def.pit || { entry: 0.94, exit: 0.06, offset: 11 },
      startFrac: 0,
      source: def.source || 'traced',
      name: def.id
    };

    var cum = new Float32Array(count + 1);
    for (i = 1; i <= count; i++) cum[i] = cum[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]);
    length = cum[count];
    model.length = length;
    model.step = length / count;

    /* ---------------- queries ---------------- */
    model.wrapS = function (s) {
      var m = s % length;
      return m < 0 ? m + length : m;
    };

    model.indexAt = function (s) {
      var idx = Math.floor(model.wrapS(s) / model.step);
      return idx >= 0 && idx <= count ? idx : 0;
    };

    /* position + heading at distance s (linear interpolation) */
    model.at = function (s, out) {
      s = model.wrapS(s);
      var f = s / model.step;
      var i0 = Math.floor(f), i1 = Math.min(count, i0 + 1);
      var t = f - i0;
      out = out || {};
      out.x = x[i0] + (x[i1] - x[i0]) * t;
      out.y = y[i0] + (y[i1] - y[i0]) * t;
      out.z = z[i0] + (z[i1] - z[i0]) * t;
      out.heading = heading[i0] + F1.util.wrapAngle(heading[i1] - heading[i0]) * t;
      out.width = width[i0] + (width[i1] - width[i0]) * t;
      out.curvature = curvature[i0];
      out.banking = banking[i0];
      out.kerbLeft = kerbLeft[i0];
      out.kerbRight = kerbRight[i0];
      return out;
    };

    /* point a given lateral offset from the centreline */
    model.offsetPoint = function (s, lateral, out) {
      var p = model.at(s, out || {});
      var h = p.heading;
      // banking tilts the surface, so a lateral offset also gains height
      p.x += Math.cos(h) * lateral;
      p.z += -Math.sin(h) * lateral;
      p.y += Math.abs(lateral) * Math.tan(p.banking || 0);
      return p;
    };

    /* nearest centreline projection, accelerated with a uniform grid */
    var GRID = 40;
    var gx = {}, gz = {};
    var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (i = 0; i < count; i++) {
      if (x[i] < minX) minX = x[i]; if (x[i] > maxX) maxX = x[i];
      if (z[i] < minZ) minZ = z[i]; if (z[i] > maxZ) maxZ = z[i];
    }
    var maxYv = -Infinity, minYv = Infinity;
    for (i = 0; i < count; i++) { if (y[i] > maxYv) maxYv = y[i]; if (y[i] < minYv) minYv = y[i]; }
    model.maxY = maxYv; model.minY = minYv;
    model.bounds = { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ };
    model.origin = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
    function cellKey(cx, cz) { return cx + ',' + cz; }
    for (i = 0; i < count; i++) {
      var cxi = Math.floor((x[i] - minX) / GRID), czi = Math.floor((z[i] - minZ) / GRID);
      var key = cellKey(cxi, czi);
      (gx[key] = gx[key] || []).push(i);
    }

    model.project = function (px, pz, hintIdx) {
      var best = -1, bestD = Infinity;
      // fast path: scan around the hint
      if (hintIdx !== undefined && hintIdx !== null) {
        for (var d = -40; d <= 40; d++) {
          var ii = (hintIdx + d + count) % count;
          var ddx = x[ii] - px, ddz = z[ii] - pz;
          var dd = ddx * ddx + ddz * ddz;
          if (dd < bestD) { bestD = dd; best = ii; }
        }
        if (bestD < 900) return finishProjection(best, px, pz, bestD);
      }
      var c0x = Math.floor((px - minX) / GRID), c0z = Math.floor((pz - minZ) / GRID);
      for (var ringW = 0; ringW < 24; ringW++) {
        for (var ax = -ringW; ax <= ringW; ax++) {
          for (var az = -ringW; az <= ringW; az++) {
            if (Math.max(Math.abs(ax), Math.abs(az)) !== ringW) continue;
            var list = gx[cellKey(c0x + ax, c0z + az)];
            if (!list) continue;
            for (var q = 0; q < list.length; q++) {
              var j = list[q];
              var dx2 = x[j] - px, dz2 = z[j] - pz;
              var d2 = dx2 * dx2 + dz2 * dz2;
              if (d2 < bestD) { bestD = d2; best = j; }
            }
          }
        }
        if (best >= 0 && Math.sqrt(bestD) < (ringW) * GRID) break;
      }
      if (best < 0) best = 0;
      return finishProjection(best, px, pz, bestD);
    };

    function finishProjection(idx, px, pz, d2) {
      // refine with the neighbouring segment projection
      var i0 = idx, i1 = (idx + 1) % count;
      var ax2 = x[i0], az2 = z[i0], bx2 = x[i1], bz2 = z[i1];
      var abx = bx2 - ax2, abz = bz2 - az2;
      var t = ((px - ax2) * abx + (pz - az2) * abz) / Math.max(1e-6, abx * abx + abz * abz);
      t = Math.max(0, Math.min(1, t));
      var cx = ax2 + abx * t, cz = az2 + abz * t;
      var lateral = ((px - cx) * nx[idx] + (pz - cz) * nz[idx]);
      return {
        s: cum[idx] + t * (cum[i1] - cum[idx] || model.step),
        idx: idx,
        lateral: lateral,
        distance: Math.hypot(px - cx, pz - cz),
        heading: heading[idx]
      };
    }

    /* is a lateral offset within the paved road? */
    model.onTrack = function (s, lateral) {
      var i0 = model.indexAt(s);
      return Math.abs(lateral) <= width[i0] * 0.5;
    };

    /* fraction of a lap for a distance */
    model.frac = function (s) { return model.wrapS(s) / length; };

    /* fit a list of [[lat, extraWidth]...] to a polyline (unused for now) */
    model.info = function () {
      var minRadius = Infinity;
      for (var k = 0; k < count; k++) {
        if (Math.abs(curvature[k]) > 1e-5) minRadius = Math.min(minRadius, 1 / Math.abs(curvature[k]));
      }
      return {
        id: def.id, length: length, target: model.targetLength,
        error: (length - model.targetLength) / model.targetLength,
        samples: count, step: model.step, minRadius: minRadius,
        elevationRange: [Math.min.apply(null, Array.from(y)), Math.max.apply(null, Array.from(y))],
        drsZones: drs.length, sectors: sectors
      };
    };

    return model;
  }

  /* ------------------------------------------------------------------ */
  /* 3c. import real centreline data (TUMFTM racetrack-database etc.)    */
  /* ------------------------------------------------------------------ */
  function buildFromPoints(def) {
    var pts = [];
    var px = 0, pz = 0;
    var n = def.dx.length;
    for (var i = 0; i < n; i++) {
      px += def.dx[i]; pz += def.dz[i];
      pts.push({ x: px / 100, z: pz / 100, w: def.w ? def.w[i] / 10 : 0 });   // cm -> m, dm -> m
    }
    // close the ring exactly
    pts.push({ x: pts[0].x, z: pts[0].z, w: pts[0].w });

    // surveyed data can describe an older layout (Abu Dhabi pre-2021, etc.):
    // scale uniformly so the lap length matches the 2026 figure exactly
    if (def.length) {
      var len = 0;
      for (var k = 1; k < pts.length; k++) {
        len += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z);
      }
      var f = def.length / len;
      if (Math.abs(f - 1) > 0.001) {
        for (var j = 0; j < pts.length; j++) { pts[j].x *= f; pts[j].z *= f; }
        def = Object.assign({}, def, { scaledBy: f });
      }
    }
    return finalize(def, pts);
  }

  F1.track = {
    build: build,
    buildFromPoints: buildFromPoints,
    expandSegments: expandSegments,
    sampleKeys: sampleKeys,
    STEP: STEP
  };

  /* ------------------------------------------------------------------ */
  /* 4. lazy per-circuit loader (data/circuits/<id>.js sets the def)     */
  /* ------------------------------------------------------------------ */
  var cache = {};
  F1.getTrack = function (id) {
    if (cache[id]) return cache[id];
    var def = F1.DATA.circuitGeom && F1.DATA.circuitGeom[id];
    if (!def) {
      console.warn('[track] no geometry for', id);
      return null;
    }
    var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    var model = def.dx ? buildFromPoints(def) : build(def);
    var t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    console.log('[track] ' + id + ' built: ' + model.length.toFixed(1) + ' m (target ' +
      def.length + '), ' + model.count + ' samples, min radius ' +
      model.info().minRadius.toFixed(1) + ' m, ' + (t1 - t0).toFixed(1) + ' ms');
    cache[id] = model;
    return model;
  };
  F1.clearTrackCache = function () { cache = {}; };

})(window.F1 = window.F1 || {});
