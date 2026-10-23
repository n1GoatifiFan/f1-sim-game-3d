#!/usr/bin/env node
/* dev tool: writes an SVG outline of every circuit from the shipped data */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const ctx = { window: {}, console: { log(){}, warn(){}, error(){} }, Math, performance: { now: () => Date.now() } };
ctx.window.F1 = {};
const sb = vm.createContext(ctx);
const run = f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
run('core/utils.js'); run('physics/track.js');
sb.window.F1.DATA = sb.window.F1.DATA || {}; sb.window.F1.DATA.circuitGeom = {};
const files = fs.readdirSync(path.join(ROOT, 'data/circuits')).filter(f => f.endsWith('.js') && f !== 'index.js');
const outDir = process.argv[2] || '/tmp/verify/tracks2';
fs.mkdirSync(outDir, { recursive: true });
files.forEach(f => {
  run(path.join('data/circuits', f));
});
const F1 = sb.window.F1;
Object.keys(F1.DATA.circuitGeom).forEach(id => {
  const m = F1.getTrack(id);
  let d = '', minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i <= m.count; i += 2) {
    const X = m.x[i], Z = -m.z[i];
    d += (i === 0 ? 'M' : 'L') + X.toFixed(1) + ',' + Z.toFixed(1) + ' ';
    minX = Math.min(minX, X); maxX = Math.max(maxX, X); minZ = Math.min(minZ, Z); maxZ = Math.max(maxZ, Z);
  }
  const pad = 80, vw = (maxX - minX) + pad * 2, vh = (maxZ - minZ) + pad * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${(minX-pad).toFixed(1)} ${(minZ-pad).toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}">
  <rect x="${(minX-pad).toFixed(1)}" y="${(minZ-pad).toFixed(1)}" width="${vw.toFixed(1)}" height="${vh.toFixed(1)}" fill="#0d1117"/>
  <path d="${d}Z" fill="none" stroke="#39434f" stroke-width="36" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="${d}Z" fill="none" stroke="#e10600" stroke-width="5" stroke-linejoin="round"/>
  <circle cx="${m.x[0].toFixed(1)}" cy="${(-m.z[0]).toFixed(1)}" r="18" fill="#fff"/>
  <text x="${(minX-pad+14).toFixed(0)}" y="${(minZ-pad+40).toFixed(0)}" fill="#8b97a4" font-family="Arial" font-size="38">${id} · ${(m.length/1000).toFixed(3)} km · ${m.source}</text>
</svg>`;
  fs.writeFileSync(path.join(outDir, id + '.svg'), svg);
});
console.log('wrote', Object.keys(F1.DATA.circuitGeom).length, 'previews to', outDir);
