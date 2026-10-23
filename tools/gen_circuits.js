#!/usr/bin/env node
/* ==========================================================================
   tools/gen_circuits.js
   Validates tools/circuit_source.js and writes one shipped data file per
   circuit:  data/circuits/<id>.js  ->  F1.DATA.circuitGeom[<id>] = {...}

   Usage:
     node tools/gen_circuits.js            # validate + write files
     node tools/gen_circuits.js --check    # validate only (CI style)
     node tools/gen_circuits.js --svg dir  # also write an SVG preview each
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = require('./circuit_source.js');

/* --- load the browser-side track engine into a fake window --------------- */
const ctx = { window: {}, console, Math, performance: { now: () => Date.now() } };
ctx.window.F1 = {};
const sandbox = vm.createContext(ctx);
function load(file) {
  const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
  vm.runInContext(code, sandbox, { filename: file });
}
load('core/utils.js');
sandbox.window.F1.DATA = sandbox.window.F1.DATA || {};
sandbox.window.F1.DATA.circuitGeom = {};
load('physics/track.js');
const F1 = sandbox.window.F1;

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const svgDir = args.includes('--svg') ? args[args.indexOf('--svg') + 1] : null;

const ids = Object.keys(SRC);
let fails = 0;
const report = [];

ids.forEach((id) => {
  const def = SRC[id];
  if (def.id !== id) throw new Error('id mismatch for ' + id);

  F1.clearTrackCache();
  const t0 = Date.now();
  let model;
  try {
    model = F1.track.build(def);
  } catch (e) {
    console.error('BUILD FAILED', id, e.message);
    fails++;
    return;
  }
  const buildMs = Date.now() - t0;
  const errPct = ((model.length - def.length) / def.length) * 100;
  const info = model.info();

  // closure check: last sample must equal the first
  const closed = Math.hypot(model.x[0] - model.x[model.count], model.z[0] - model.z[model.count]) < 0.01;

  // min radius sanity (a real F1 corner is never below ~7 m: Monaco hairpin)
  const minR = info.minRadius;

  const ok = Math.abs(errPct) < 1 && closed && minR > 6;
  if (!ok) fails++;

  // max elevation gradient (should be < 20% for real tracks)
  let maxGrade = 0;
  for (let i = 1; i <= model.count; i++) {
    const dy = Math.abs(model.y[i] - model.y[i - 1]);
    maxGrade = Math.max(maxGrade, dy / model.step);
  }

  report.push({
    id, target: def.length, built: +model.length.toFixed(1), errPct: +errPct.toFixed(3),
    samples: model.count, minR: +minR.toFixed(1), maxGrade: +(maxGrade * 100).toFixed(1),
    buildMs, ok, accuracy: def.accuracy
  });

  if (!checkOnly) {
    const body = `/* F1 2026 — data/circuits/${id}.js
   ${def.accuracy} · ${(def.length / 1000).toFixed(3)} km · radius/width data used by
   physics/track.js. Generated from tools/circuit_source.js — edit that file and
   run \`node tools/gen_circuits.js\` instead of hand-editing this one. */
(function (F1) {
  F1.DATA.circuitGeom = F1.DATA.circuitGeom || {};
  F1.DATA.circuitGeom['${id}'] = ${JSON.stringify(def, null, 2).replace(/\n/g, '\n  ')};
})(window.F1 = window.F1 || {});
`;
    fs.writeFileSync(path.join(ROOT, 'data/circuits', id + '.js'), body);
  }

  if (svgDir) {
    fs.mkdirSync(svgDir, { recursive: true });
    let d = '';
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i <= model.count; i += 2) {
      const X = model.x[i], Z = -model.z[i];      // flip Z so north is up
      d += (i === 0 ? 'M' : 'L') + X.toFixed(1) + ',' + Z.toFixed(1) + ' ';
      minX = Math.min(minX, X); maxX = Math.max(maxX, X);
      minZ = Math.min(minZ, Z); maxZ = Math.max(maxZ, Z);
    }
    const pad = 60;
    const vw = (maxX - minX) + pad * 2, vh = (maxZ - minZ) + pad * 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${(minX - pad).toFixed(1)} ${(minZ - pad).toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}">
  <rect x="${(minX - pad).toFixed(1)}" y="${(minZ - pad).toFixed(1)}" width="${vw.toFixed(1)}" height="${vh.toFixed(1)}" fill="#0d1117"/>
  <path d="${d}Z" fill="none" stroke="#3a4450" stroke-width="34" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="${d}Z" fill="none" stroke="#e10600" stroke-width="5" stroke-linejoin="round"/>
  <circle cx="${model.x[0].toFixed(1)}" cy="${(-model.z[0]).toFixed(1)}" r="16" fill="#fff"/>
  <text x="${(minX - pad + 10).toFixed(0)}" y="${(minZ - pad + 34).toFixed(0)}" fill="#8b97a4" font-family="Arial" font-size="34">${id} · ${(model.length / 1000).toFixed(3)} km</text>
</svg>`;
    fs.writeFileSync(path.join(svgDir, id + '.svg'), svg);
  }
});

report.sort((a, b) => a.target - b.target);
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
console.log(pad('circuit', 14) + padL('target', 8) + padL('built', 9) + padL('err%', 8) +
  padL('samples', 9) + padL('minR', 8) + padL('grade%', 8) + padL('ms', 6) + '  ' + 'accuracy');
report.forEach(r => {
  console.log(pad(r.id, 14) + padL(r.target, 8) + padL(r.built, 9) + padL(r.errPct, 8) +
    padL(r.samples, 9) + padL(r.minR, 8) + padL(r.maxGrade, 8) + padL(r.buildMs, 6) + '  ' +
    r.accuracy + (r.ok ? '' : '   <-- FAIL'));
});

const worst = report.reduce((a, r) => Math.max(a, Math.abs(r.errPct)), 0);
console.log('\n' + report.length + ' circuits · worst length error ' + worst.toFixed(3) +
  '% · ' + (fails ? fails + ' FAILURES' : 'all OK'));
if (fails) process.exit(1);
