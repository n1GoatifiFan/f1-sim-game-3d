#!/usr/bin/env node
/* ==========================================================================
   tools/tum_import.js
   Imports real centreline + track-width data from the open-source TUMFTM
   `racetrack-database` (https://github.com/TUMFTM/racetrack-database,
   LGPL-3.0) and bakes it into compact JS data files.

   Usage:
     node tools/tum_import.js /path/to/racetrack-database-master/tracks

   For every circuit present in the database it writes
     data/circuits/<id>.js  ->  F1.DATA.circuitGeom['<id>'] = {...}
   with:
     x0/z0            first centreline point, centimetres
     dx/dz            delta-encoded centreline, centimetres (integers)
     w                track width per point, decimetres (integers)
   plus elevation/banking/DRS/sector/pit data taken from tools/circuit_source.js.

   Circuits not in the database keep their hand-traced definition from
   tools/circuit_source.js and are tagged APPROXIMATE.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const TRACED = require('./circuit_source.js');
const DB = process.argv[2];
if (!DB) { console.error('usage: node tools/tum_import.js <tracks-dir>'); process.exit(1); }

/* track id -> file in the TUM dataset */
const MAP = {
  australia: 'Melbourne',
  china: 'Shanghai',
  japan: 'Suzuka',
  bahrain: 'Sakhir',
  miami: null,            // not in the database
  canada: 'Montreal',
  monaco: null,           // not in the database (traced)
  barcelona: 'Catalunya',
  austria: 'Spielberg',
  britain: 'Silverstone',
  belgium: 'Spa',
  hungary: 'Budapest',
  netherlands: 'Zandvoort',
  italy: 'Monza',
  madrid: null,
  azerbaijan: null,
  singapore: null,
  usa: 'Austin',
  mexico: 'MexicoCity',
  brazil: 'SaoPaulo',
  lasvegas: null,
  qatar: null,
  abudhabi: 'YasMarina',
  saudi: null
};

/* --- browser-side track engine for validation ---------------------------- */
const ctx = { window: {}, console, Math, performance: { now: () => Date.now() } };
ctx.window.F1 = {};
const sandbox = vm.createContext(ctx);
const run = (f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
run('core/utils.js');
sandbox.window.F1.DATA = sandbox.window.F1.DATA || {};
sandbox.window.F1.DATA.circuitGeom = {};
run('physics/track.js');
const F1 = sandbox.window.F1;

function readCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#'));
  return lines.map(l => {
    const p = l.split(',');
    return { x: +p[0], y: +p[1], wr: +p[2], wl: +p[3] };
  }).filter(p => isFinite(p.x) && isFinite(p.y));
}

function summarise(id, def) {
  F1.clearTrackCache();
  sandbox.window.F1.DATA.circuitGeom[id] = def;
  const m = F1.getTrack(id);
  return m;
}

const report = [];
Object.keys(MAP).forEach((id) => {
  const file = MAP[id];
  if (!file) return;
  const csv = path.join(DB, file + '.csv');
  if (!fs.existsSync(csv)) { console.warn('missing CSV for', id, file); return; }
  const rows = readCsv(csv);
  if (rows.length < 200) { console.warn('too few rows for', id); return; }

  const base = TRACED[id];
  let x0 = rows[0].x, y0 = rows[0].y;

  /* decimate to ~5 m spacing: keeps files small, the engine resamples at 4 m */
  const keep = [];
  let lastX = null, lastY = null, acc = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (lastX !== null) acc += Math.hypot(r.x - lastX, r.y - lastY);
    lastX = r.x; lastY = r.y;
    if (i === 0 || i === rows.length - 1 || acc >= 5.0) {
      keep.push(r);
      acc = 0;
    }
  }

  const dx = [], dz = [], w = [];
  for (let i = 1; i < keep.length; i++) {
    dx.push(Math.round((keep[i].x - keep[i - 1].x) * 100));
    dz.push(Math.round(-(keep[i].y - keep[i - 1].y) * 100));   // north -> -Z
    w.push(Math.round((keep[i].wr + keep[i].wl) * 10));
  }

  const def = {
    id,
    source: 'TUMFTM racetrack-database',
    accuracy: 'ACCURATE',
    length: base.length,
    width: base.width,
    x0: Math.round(x0 * 100),
    z0: Math.round(-y0 * 100),
    dx, dz, w,
    elevation: base.elevation,
    banking: base.banking || null,
    drs: base.drs,
    sectors: base.sectors,
    pit: base.pit
  };

  const model = summarise(id, def);
  const err = ((model.length - base.length) / base.length) * 100;

  const body = `/* F1 2026 — data/circuits/${id}.js
   ${base.accuracy === 'APPROX' ? 'APPROXIMATE' : 'ACCURATE'} · ${(model.length / 1000).toFixed(3)} km
   Centreline + track width imported from the TUMFTM racetrack-database
   (https://github.com/TUMFTM/racetrack-database, LGPL-3.0, ${file}.csv),
   decimated to 5 m and delta-encoded in centimetres. Elevation, DRS zones,
   sectors and pit lane come from tools/circuit_source.js.
   Regenerate with: node tools/tum_import.js <racetrack-database>/tracks */
(function (F1) {
  F1.DATA.circuitGeom = F1.DATA.circuitGeom || {};
  F1.DATA.circuitGeom['${id}'] = {
    id: '${id}', source: 'tum', accuracy: 'ACCURATE',
    length: ${base.length}, width: ${base.width},
    x0: ${def.x0}, z0: ${def.z0},
    dx: [${dx.join(',')}],
    dz: [${dz.join(',')}],
    w: [${w.join(',')}],
    elevation: ${JSON.stringify(base.elevation)},
    ${base.banking ? 'banking: ' + JSON.stringify(base.banking) + ',' : ''}
    drs: ${JSON.stringify(base.drs)},
    sectors: ${JSON.stringify(base.sectors)},
    pit: ${JSON.stringify(base.pit)}
  };
})(window.F1 = window.F1 || {});
`;
  fs.writeFileSync(path.join(ROOT, 'data/circuits', id + '.js'), body);
  report.push({ id, file, points: keep.length, km: model.length / 1000, err: err.toFixed(2), kb: (body.length / 1024).toFixed(1) });
});

/* --- write the remaining (traced) circuits from circuit_source.js ------- */
Object.keys(TRACED).forEach((id) => {
  if (MAP[id]) return;                        // handled above
  const def = TRACED[id];
  def.accuracy = def.accuracy || 'APPROX';
  const model = summarise(id, def);
  let body = `/* F1 2026 — data/circuits/${id}.js
   APPROXIMATE · ${(model.length / 1000).toFixed(3)} km
   Hand-traced corner sequence (tools/circuit_source.js): the lap length and
   corner order are right, individual radii are best effort. Replace with
   surveyed data when available. */
(function (F1) {
  F1.DATA.circuitGeom = F1.DATA.circuitGeom || {};
  F1.DATA.circuitGeom['${id}'] = ${JSON.stringify(def, null, 2).split('\n').join('\n  ')};
})(window.F1 = window.F1 || {});
`;
  fs.writeFileSync(path.join(ROOT, 'data/circuits', id + '.js'), body);
  report.push({ id, file: '(traced)', points: model.count, km: model.length / 1000, err: (((model.length - def.length) / def.length) * 100).toFixed(2), kb: (body.length / 1024).toFixed(1) });
});

report.sort((a, b) => a.id.localeCompare(b.id));
report.forEach(r => console.log(
  r.id.padEnd(12) + r.file.padEnd(14) + String(r.points).padStart(6) + ' pts  ' +
  r.km.toFixed(3).padStart(8) + ' km  err ' + String(r.err).padStart(6) + '%  ' + r.kb.padStart(6) + ' KB'));
const total = report.reduce((a, r) => a + +r.kb, 0);
console.log('\n' + report.length + ' files, ' + total.toFixed(1) + ' KB total');
