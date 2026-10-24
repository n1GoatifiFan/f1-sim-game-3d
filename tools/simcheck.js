/* ==========================================================================
   F1 2026 — tools/simcheck.js   (developer tool, not shipped in the game)
   Headless physics/AI check: drives one car round a circuit with the real
   vehicle and driver code and prints lap times, top speed and how often the
   car leaves the road. No renderer, no browser.

     node tools/simcheck.js                     # Monza, 3 laps
     node tools/simcheck.js <circuit> [laps] [--pace 0.97] [--skill 0.98]
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const circuit = args[0] && !args[0].startsWith('--') ? args[0] : 'italy';
const lapsWanted = args[1] && !args[1].startsWith('--') ? Number(args[1]) : 3;
function opt(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : def;
}

/* ---- tiny browser shim ---- */
const sandbox = {
  console,
  performance: { now: () => Date.now() },
  Math, Date, Object, Array, Number, String, JSON, Float32Array, Infinity, NaN,
  navigator: { userAgent: 'node' },
  window: {}
};
sandbox.window = sandbox;
sandbox.THREE = { MathUtils: { clamp: (v, a, b) => Math.min(b, Math.max(a, v)), degToRad: d => d * Math.PI / 180 } };
sandbox.document = { createElement: () => ({ getContext: () => ({}), style: {}, appendChild() {} }) };
vm.createContext(sandbox);

function load(rel) {
  const file = path.join(ROOT, rel);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: rel });
}

load('core/utils.js');
load('data/teams.js');
load('data/drivers.js');
load('data/circuits/index.js');
load('data/circuits/' + circuit + '.js');
load('physics/track.js');
load('physics/tyres.js');
load('physics/vehicle.js');
load('ai/driver.js');

const F1 = sandbox.F1;
const track = F1.getTrack(circuit);
if (!track) { console.error('no track', circuit); process.exit(1); }

const teamId = args.includes('--team') ? args[args.indexOf('--team') + 1] : 'mclaren';
const spec = F1.vehicle.specFor(teamId);
const car = F1.vehicle.create(track, spec, { startS: 0, compound: 'medium', tyreTempC: 85 });

const prof = F1.ai.profile(track, car, { vTop: 96 });
const drv = F1.ai.createDriver(car, track, prof, {
  skill: opt('skill', 0.97),
  pace: opt('pace', 1.0),
  aggression: 0.5
});

console.log(`--- ${circuit} | ${(track.length / 1000).toFixed(3)} km | ${track.count} samples`);
console.log(`    profile lap ${prof.lapTime.toFixed(3)} s`);

const STEP = 1 / 120;
let t = 0, lapT = 0, lastS = 0, lap = 0;
let top = 0, offT = 0, wallCt = 0, spinT = 0, nan = -1;
const lapTimes = [];
let started = false;

for (let i = 0; i < 120 * 900; i++) {
  const inp = drv.update(STEP);
  car.ersMode = 'balanced';
  F1.vehicle.step(car, inp, STEP, track, {
    assists: { abs: 1, traction: 1 }, ambientC: 22
  });
  car.throttle = inp.throttle;
  car.brake = inp.brake;
  t += STEP; lapT += STEP;

  if (!isFinite(car.x) || !isFinite(car.vx)) { nan = t; break; }

  const kmh = Math.abs(car.vx) * 3.6;
  if (kmh > top) top = kmh;
  if (car.surface !== 'asphalt' && car.surface !== 'kerb') offT += STEP;
  if (car.wallContact > 0.5) wallCt++;
  if (Math.abs(car.slipR) > 0.35) spinT += STEP;

  const s = car.s;
  if (s < lastS - track.length * 0.5) {
    if (!started) { started = true; }
    else { lapTimes.push(lapT); lap++; }
    lapT = 0;
  }
  lastS = s;

  if (lap >= lapsWanted) break;
}

console.log(`    laps [${lapTimes.map(x => x.toFixed(3)).join(', ')}] in ${t.toFixed(1)} s`);
console.log(`    top ${top.toFixed(0)} km/h | off-track ${offT.toFixed(1)} s | wall ${wallCt} | slide ${spinT.toFixed(1)} s | nan ${nan > 0 ? nan.toFixed(1) : -1}`);
console.log(`    fuel ${car.fuel.toFixed(1)} kg | tyres ${['fl','fr','rl','rr'].map(k => car.tyres[k].tempC.toFixed(0)).join('/')} °C | wear ${['fl','fr','rl','rr'].map(k => car.tyres[k].wear.toFixed(2)).join('/')}`);
