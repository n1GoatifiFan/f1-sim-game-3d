# F1 2026 — 3D Career Racing Game

An offline, double-click-to-play Formula 1 game built on Three.js r158 (UMD).
No build step, no server, no network at runtime: open `index.html` from the
folder and it runs.

Everything is procedural — cars are built from geometry and canvas-painted
liveries, skies/elevation/scenery are generated per circuit, and every sound is
synthesised with the Web Audio API. There are no image, model or audio files in
the folder.

---

## Play

1. Unzip the folder anywhere (keep the structure intact).
2. Double-click **`index.html`** — Chrome, Edge, Firefox or Safari recent enough
   for WebGL2.
3. Pick a mode with the mouse or `↑`/`↓` + `Enter`.

`file://` works because the game uses classic `<script>` tags only: no ES
modules, no `fetch`, no XHR, no CDN. Saves live in `localStorage` (with an
in-memory fallback if the browser blocks it).

**Size:** ~2.3 MB on disk, 82 files. All textures are generated in-page at load
(no image files), so the download stays small while the GPU budget grows.

**Art overhaul:** the circuit renderer was rebuilt for broadcast-quality visuals —
see [`debug/OVERHAUL.md`](debug/OVERHAUL.md) for the pipeline, the per-circuit
surface system and the measured before/after shots in `debug/before` and
`debug/after`.

---

## Controls

### Keyboard

| Action | Key |
|---|---|
| Throttle / brake | `W` `S` (or `↑` `↓`) |
| Steer left / right | `A` `D` (or `←` `→`) |
| Gear up / down | `E` / `Q` (`Shift` / `Ctrl`) |
| Boost / overtake | `Space` |
| ERS mode | `F` |
| Brake balance | `B` |
| Pit request | `P` |
| Pit tyre compound | `[` / `]` |
| Camera | `C` |
| Look back | `X` |
| Reset car to track | `R` |
| Cycle HUD layout | `H` |
| Replay | `T` |
| Photo mode | `V` |
| Pause | `Esc` |
| Mute / unmute * | `M` |
| Performance overlay | `F3` |

\* works anywhere, and the state is remembered.

### Gamepad (standard mapping)

Left stick steers, `RT` throttle, `LT` brake, `LB`/`RB` assist throttle/brake,
`A` boost, `X` overtake, `B` radio, `Y` camera, `Start` pause, D-pad up/down
gears. Deadzone, sensitivity and rumble are in Settings → Controls.

### Photo mode

`V` freezes the simulation, lets you fly the camera (drag to orbit, `W`/`S` to
move) and saves a PNG of the current frame next to your downloads.

---

## Modes

- **Career** — create a driver or take a real seat, sign contracts, earn
  credits, invest in five R&D departments (which really change the car's
  performance), survive the driver market, and chase a contract objective over
  seasons. Three save slots plus JSON export/import.
- **Quick Race** — pick **any of the 22 seats** on the 2026 grid (team strip →
  team-mate strip), then any circuit, then go. The seat is remembered between
  sessions and is independent of your career contract, so a quick race never
  moves your career driver. From 3 laps up.
- **Time Trial** — three solo laps per circuit, personal bests per circuit, and
  a translucent **ghost** of your best lap in that car. The ghost is the pose
  trace the session records; it is saved the moment a lap is banked.
- **Championship** — any driver, any subset of the 22 rounds, sprint points on
  or off; drivers' and constructors' tables, *Race this round* or *Simulate*.
- **Garage** — inspect any of the 11 cars, change the livery, read the specs.
- **Grid / Track browser** — the 22-round calendar (24 with the two cancelled
  Middle East rounds enabled), each circuit with a flyover, orbit and trackside
  camera.

### Weekend format

Friday practice → qualifying Q1/Q2/Q3 → sprint (at six rounds) → Grand Prix
with a formation lap and light sequence. Race control runs yellow, VSC, safety
car, red flag and blue flags, track limits give warnings and five-second
penalties, and the pit lane is a real corridor with an 80 km/h limit.

### Points

Grand Prix: 25-18-15-12-10-8-6-4-2-1. Sprint: 8-7-6-5-4-3-2-1. There is no
fastest-lap point (2026 regulations).

---

## Settings

Graphics preset (low/medium/high/ultra + auto), resolution scale, draw
distance, shadows, FOV, performance overlay; master / engine / tyres / crowd /
radio / engineer volumes and a global mute; assist levels for traction control,
ABS, steering, racing line and gearbox; units (km/h or mph), race length,
difficulty, "include cancelled rounds", colour-blind HUD palette, HUD scale and
minimap toggle; rebindable controls; save export/import.

Stored under the `f1_2026_` prefix in `localStorage`.

---

## Folder structure

```
index.html            boot + script order (classic scripts only)
main.js               entry point, global hotkeys
lib/three.min.js      Three.js r158 UMD (MIT)
css/                  ui.css (screens) and hud.css (broadcast HUD)

core/                 utils, settings, storage, input, renderer, audio, app shell
data/                 teams (11), drivers (22), sponsors, calendar + 24 circuit files
world/                procedural car model, showroom, environment, track scenery, weather
physics/              track builder, tyre model, vehicle dynamics, cameras
ai/                   driver profile + Stanley-style controller
game/                 session, 21-car field, race control, pit lane, weekend, replay,
                      career, championship
ui/                   main menu, garage, grid, quick race, weekend, career,
                      time trial, championship, settings + HUD
tools/                dev-only track generators/preview pages (not used at runtime)
```

The script order in `index.html` is load-order significant: core → data →
world → physics → ai → game → ui → `core/app.js` → `main.js`.

---

## Size budget

| Folder / file | Size |
|---|---|
| `lib/` (Three.js r158 UMD) | 640 KB |
| `data/` (24 circuits + teams/drivers/sponsors) | 284 KB |
| `world/` | 180 KB |
| `game/` | 148 KB |
| `ui/` | 148 KB |
| `physics/` | 76 KB |
| `css/` | 72 KB |
| `core/` | 68 KB |
| `ai/` | 16 KB |
| `tools/` (dev only) | 56 KB |
| root files (`index.html`, `main.js`, docs) | 60 KB |
| **Total (75 files, no `.git`)** | **1.8 MB on disk** (1.57 MB of content) |

Budget: **40 MB target, 128 MB hard limit** — used 4.3 % of the target.
Largest single file: `lib/three.min.js` at 637 KB. Every circuit file is under
20 KB (the generator inputs live in `tools/`, which is dev-only).

---

## Circuit accuracy

The lap length of every circuit is within **0.12 %** of the real figure
(worst: Austria, 4313 m built vs 4318 m real). Sixteen centrelines come from
the [TUMFTM racetrack-database](https://github.com/TUMFTM/racetrack-database)
(surveyed x/y/width data) and are tagged **ACCURATE**. Eight circuits have no
surveyed public data and are hand-traced from official corner diagrams; they
match the real lap length and corner order but individual radii are best
effort — those files carry an `APPROXIMATE` header comment and are tagged
**APPROXIMATE** in game.

| # | Circuit | Length | Geometry | Notes |
|---|---|---|---|---|
| 1 | Australia (Albert Park) | 5 278 m | ACCURATE | surveyed |
| 2 | China (Shanghai) | 5 451 m | ACCURATE | sprint |
| 3 | Japan (Suzuka) | 5 807 m | ACCURATE | surveyed |
| 4 | Bahrain | 5 412 m | ACCURATE | cancelled IRL — off by default |
| 5 | Saudi Arabia (Jeddah) | 6 174 m | APPROXIMATE | cancelled IRL — off by default |
| 6 | Miami | 5 412 m | APPROXIMATE | sprint |
| 7 | Canada (Montréal) | 4 361 m | ACCURATE | sprint |
| 8 | Monaco | 3 337 m | APPROXIMATE | traced street layout |
| 9 | Spain (Barcelona) | 4 657 m | ACCURATE | surveyed |
| 10 | Austria (Spielberg) | 4 318 m | ACCURATE | surveyed |
| 11 | Great Britain (Silverstone) | 5 891 m | ACCURATE | sprint |
| 12 | Belgium (Spa) | 7 004 m | ACCURATE | surveyed |
| 13 | Hungary | 4 381 m | ACCURATE | surveyed |
| 14 | Netherlands (Zandvoort) | 4 259 m | ACCURATE | sprint |
| 15 | Italy (Monza) | 5 793 m | ACCURATE | surveyed |
| 16 | Spain (Madrid / Madring) | 5 474 m | APPROXIMATE | new venue, no public survey |
| 17 | Azerbaijan (Baku) | 6 003 m | APPROXIMATE | traced street layout |
| 18 | Singapore | 4 940 m | APPROXIMATE | night race, traced street layout |
| 19 | United States (Austin) | 5 513 m | ACCURATE | surveyed |
| 20 | Mexico | 4 304 m | ACCURATE | surveyed |
| 21 | Brazil (Interlagos) | 4 309 m | ACCURATE | surveyed |
| 22 | Las Vegas | 6 201 m | APPROXIMATE | night race, traced street layout |
| 23 | Qatar (Lusail) | 5 419 m | ACCURATE | sprint |
| 24 | Abu Dhabi (Yas Marina) | 5 281 m | ACCURATE | surveyed |

Bahrain and Saudi Arabia were dropped from the real 2026 calendar; they ship
disabled and can be switched on in Settings → Gameplay ("Include cancelled
rounds"), which is also what career and championship calendars read.

---

## Credits and licensing

- **Three.js r158** (UMD build) — MIT, © 2010-2023 Three.js authors. The
  licence header is retained at the top of `lib/three.min.js`.
- **TUMFTM racetrack-database** — used for the 16 surveyed centrelines.
  © Technical University of Munich, **LGPL-3.0**; the derived centreline data
  lives in `data/circuits/<id>.js`, so those files are distributed under the
  same licence. Source: https://github.com/TUMFTM/racetrack-database
- Everything else (code, geometry generation, liveries, audio synthesis) is
  original to this project.

No official Formula 1, FIA, team or sponsor logos, fonts, images or audio are
included. Team and driver names are used factually; sponsor marks are drawn as
stylised shapes and text, not trademarks.

---

## Known limitations

- The AI is clean on 21 of the 24 circuits; at **Monaco** the Rascasse hairpin
  occasionally draws a barrier touch (steering saturates before the command).
- Field pace is roughly 20 % off real qualifying times: the tyre model, not the
  AI profile, is the limit.
- Cars are procedural rather than downloaded: no third-party model with a usable
  licence exists for the 2026 regulations, and a real one would blow the size
  budget. The model is a lofted body (about 20 k triangles at full detail,
  780 at the far-LOD) with carbon/paint material splits, a lathe-turned tyre
  with a polar-mapped Pirelli sidewall, and canvas-painted wheel faces.
- Hand-traced (APPROXIMATE) circuits have correct length and corner order but
  simplified radii.

See `BUILD_LOG.md` for the section-by-section development record and
`PROJECT_PLAN.md` for the milestone map.
