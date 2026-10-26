# Build log — F1 2026

Milestones from PROJECT_PLAN.md, with the interface card later sections build on.
Rule: a section is only "done" when `index.html` opens over `file://` with no console
errors and the section's exit test passes.

---

## Section 1 — Engine shell, data, menu  ✅ (build 0.1)

**Delivered**
- `lib/three.min.js` — Three.js **r158** UMD build (651 KB, no CDN, no modules).
- `index.html` — classic `<script>` load order, boot screen, error overlay, toasts.
- `core/utils.js` — math, seeded RNG (`F1.rng`, mulberry32), events bus,
  `F1.storage` (localStorage wrapped in try/catch + in-memory fallback + export/import).
- `core/settings.js` — persisted settings, 4 quality presets, default key binds.
- `core/input.js` — keyboard + Gamepad API (analogue steer/throttle/brake, rumble,
  rebinding), analogue ramps shared by all driving code.
- `core/renderer.js` — renderer/camera/resize, FPS meter, **auto-quality** (drops a
  preset if FPS < 40 for 5 s), ACES tone mapping, sRGB output.
- `core/app.js` — boot sequence (real steps: data validation, geometry build, shader
  compile), screen registry `F1.screens`, scene switching, main loop, perf overlay.
- `data/teams.js` — all 11 teams (2026 names, PUs, principals, HQs, colours, perf seeds)
  + `regulations2026` block (X/Z aero, boost, 768 kg, 50/50 split, sustainable fuel).
- `data/drivers.js` — all 22 drivers, helmet specs, hidden rating stats, career totals,
  Norris as #1 (2025 champion), **"mid-season edits" comment block**, `driverOverall()`.
- `data/sponsors.js` — real title/major partners per team, editable, `// VERIFY` marks.
- `data/circuits/index.js` — the **24-round 2026 calendar** (metadata, themes, dates,
  sprint flags, `cancelledIRL` for Bahrain + Jeddah, ACCURATE/APPROXIMATE tags).
- `world/car_model.js` — **procedural 2026 car**: lofted monocoque/nose/sidepods,
  active-aero front + rear wings (animated flap), halo, floor + diffuser, 18" wheel
  covers, suspension rods, driver helmet with canvas livery, sponsor wordmark decals
  on sidepods / engine cover / wings / halo / nose. `F1.buildCar({teamId, driverId, lod})`.
  LOD 0 = ~10-mesh distant car, LOD 2 = full detail. Geometry cached and shared.
- `world/showroom.js` — studio stage, turntable, orbit/zoom, per-team ring + floor text.
- `ui/ui.js` — main menu, **Garage** (11 cars, driver switch, perf bars, partners),
  **2026 Grid**, **Quick Race** circuit browser (22/24 rounds, sprint chips, race length),
  **Settings** (graphics/audio/gameplay/assists/key rebinding/save export-import).
- Placeholder screens for Career / Time Trial / Championship (clearly labelled).

**Exit test:** `file:///…/index.html` → boots, menu, rotating car, Garage switches all
11 teams, no console errors. Verified with headless Chromium (WebGL2 / SwiftShader) at
1440×810 and 1280×720. Zero page errors; only Three.js's "three.min.js deprecated" notice.

**Interface card (used by later sections)**
```js
F1.util.{clamp,lerp,damp,wrapAngle,fmtTime,fmtTimeShort,pad,rand,pick,shuffle,mixHex,luminance,textOn}
F1.rng(seed) -> rng() with .range/.int/.pick/.normal/.chance/.shuffle ; F1.rng.string(str)
F1.storage.{get,set,remove,available,exportAll,importAll}
F1.settings.{preset(),save(),reset(),speedFromMs(),speedUnit()}  (F1.settings.gameplay/assists/...)
F1.input.{update(dt),action(name),pressed(name),getSteer(),getThrottle(),getBrake(),rumble()}
F1.renderer.{init(canvas),render(scene,camera),tick(dt),setQuality(name),onResize(fn),info()}
F1.app.{show(name,params),register,back,toast,boot,progress,setScene(api),getShowroom()}
F1.screens[name] = { mount(root, params) -> Node, unmount() }
F1.DATA.{teams,teamById,getTeam,drivers,driverById,getDriver,driversOf,teamOf,driverOverall,
         sponsors,sponsorsOf,titleSponsor,circuits,getCircuitMeta,activeCalendar,regulations2026}
F1.buildCar({teamId,driverId,lod}) -> Group (+userData.wheels/setBrakeGlow/setAeroMode)
```
Scene API contract: `{ scene, camera, update(dt), mode }` — the app renders it every frame.

**Known limitations (Section 1)**
- Career/Time Trial/Championship buttons open labelled placeholders (Sections 5–6).
- Car is procedural: proportions read correctly, fine detail (suspension fairings,
  wheel covers engraving) is low-poly by design.
- Windows Chrome lacks flag emoji: country codes are shown as chips instead.
- Circuits exist only as metadata until Section 2 builds geometry + track models.
- `F1.DATA.circuits[].date` uses provisional 2026 dates — edit freely in
  `data/circuits/index.js`.


---

## Section 2 — Circuits + procedural environment  ✅ (build 0.2)

**Delivered**
- `physics/track.js` — track model builder.
  - `build(def)`: turns a segment list (`straight` / `corner` with radius) into a
    centreline by **analytic corner arcs** + straights scaled to absorb the length
    delta; steering bias (`biasCurv`) drives the fit, ≤12 iterations, always < 0.12 %
    length error on the 8 hand-traced layouts.
  - `buildFromPoints(def)`: delta-encoded surveyed centrelines (cm/dm steps),
    exact closure + uniform rescale to the official lap length (`def.scaledBy`).
  - `finalize()`: 4 m resample + heading, curvature, width, banking, kerbs, sectors,
    DRS zones, pit lane, bounds, `origin`, `minY/maxY`, and helpers
    `wrapS/indexAt/at/offsetPoint/project/onTrack/frac/info`.
  - `F1.getTrack(id)` caches one model per circuit (`F1.clearTrackCache()`).
- `data/circuits/<id>.js` — **all 24 circuits**, 252 KB total (largest 12.4 KB).
  Encoding: `{id, source, accuracy, length, width, x0, z0, dx[], dz[], w[],
  elevation, banking?, drs, sectors, pit}` with 5 m spacing.
- `tools/circuit_source.js` — the 24 traced definitions (also the source of
  elevation / DRS / sectors / pit / width for imported circuits).
- `tools/gen_circuits.js` — `--check` validates every def (length, closure,
  self-intersection, min radius) and `--svg <dir>` writes preview sheets.
- `tools/tum_import.js` — converts the TUMFTM `racetrack-database` CSVs into the
  compact format (decimate to 5 m, delta-encode, validate in `vm`, write files).
- `tools/preview_tracks.js` — SVG contact sheet of the shipped geometry.
- `world/environment.js` — procedural circuit world, origin-local (all geometry is
  built around `model.origin` so float precision stays sane):
  road, kerbs, white lines, side run-off, barriers/street walls + fences, tyre walls,
  marshal posts, grandstands + instanced crowd, pit lane + pit building with per-garage
  team-colour banners, race-control tower, start gantry with light pods, DRS gantries,
  trees / palms / pylons / floodlights (instanced), landmarks per circuit feature
  (harbour, dunes, sphere, lake, mountains…), sky dome shader, equirectangular canvas
  env-map used as `scene.environment`, sun + hemisphere lighting, floodlights at night.
- `world/track_scene.js` — `F1.trackScene.create(id)` → `{scene, camera, world, track,
  meta, update(dt), setCameraMode('flyover'|'orbit'|'trackside'), destroy()}`.
- `ui/ui.js` — `track-preview` screen: builds a circuit from the Quick Race screen with
  session info (length, samples, sectors, DRS zones, time of day, data provenance) and
  Flyover / Orbit / Trackside buttons; orbit mode supports drag + wheel.

**Circuit accuracy**

| Source | Count | Tag | Circuits |
|---|---|---|---|
| TUMFTM `racetrack-database` (surveyed GPS centrelines) | 16 | `ACCURATE` | australia, china, japan, barcelona, austria, britain, belgium, hungary, netherlands, italy, usa, mexico, brazil, bahrain, canada, abudhabi |
| Hand-traced from published layout diagrams + official lengths | 8 | `APPROXIMATE` | miami, monaco, madrid, azerbaijan, singapore, lasvegas, qatar, saudi |

All 24 lap lengths are within **0.12 %** of the official figure, e.g. monaco
3334.3 m vs 3337 m, lasvegas 6194.1 m vs 6201 m, italy 5788.3 m vs 5793 m. The 8
approximate files carry `// APPROXIMATE` headers and an `approximate: true` flag in
the calendar metadata; README.txt (Section 8) lists them for the player.

**Data provenance / licence**
- Geometry for the 16 surveyed circuits derives from the **TUMFTM racetrack-database**
  (`github.com/TUMFTM/racetrack-database`), **LGPL-3.0**. Only derived centreline
  coordinates are stored (no code is linked); the attribution notice ships in
  README.txt and at the top of every imported `data/circuits/*.js` file.
- Lengths, corner counts, DRS zones, sectors and elevation profiles are authored in
  `tools/circuit_source.js` from public circuit data (`// VERIFY` where provisional).

**Bugs found and fixed while getting the 3D view right** (recorded so later sections
don't reintroduce them)
1. Ribbon geometry was wound downwards → the whole road was back-face culled and lit
   from below. Each quad now picks its winding from the edge cross product, and road /
   kerb / line / wall materials are `DoubleSide`.
2. The run-off apron was a single ribbon from `-(w+9)` to `+(w+9)` — it covered the
   asphalt. Split into two side aprons that start at the track edge.
3. The UI scrim (`.screen::before`) darkened the entire 3D view — on narrow viewports
   the mobile media query made it ~85 % opaque. Screens can now set `noScrim: true`;
   `track-preview` does, and only a soft left-hand gradient remains for the info panel.
4. The sky dome (r = 3000) sat beyond the camera far plane (2.6–3.2 km) and was
   clipped away. Radius is now 1500 and the shader includes the tone-mapping and
   colour-space chunks (a custom `ShaderMaterial` does not get them automatically).
5. Shadow acne: a shadow camera covering a 2 km circuit is ~1 m/texel and blackens
   every flat surface. The frustum is now ±150 m and follows the camera
   (`world.setShadowFocus(x, z)`), with `normalBias` 0.06.
6. `CanvasTexture.clone()` loses `colorSpace` and the per-instance repeat; the world
   now mutates the cached texture instead of cloning it.
7. Night races were pitch black: floodlights are physically-correct point lights
   (4200 cd, 30 m above the track) plus a cool "moon" directional and a raised
   hemisphere floor.

**Interface card (used by later sections)**
```js
F1.getTrack(id) / F1.track.build(def) / F1.track.buildFromPoints(def) / F1.clearTrackCache()
track model: {count, step, length, targetLength, x[], y[], z[], heading[], width[],
              curvature[], banking[], kerbLeft[], kerbRight[], sectors, drs[],
              pit, bounds, origin, minY, maxY, source, accuracy,
              at(s, out) -> {x,y,z,heading,width,curvature},  // WORLD space
              offsetPoint(s, lat, out), project(x,z), onTrack(x,z), indexAt(s), wrapS(s)}
F1.trackScene.create(id, opts) ->
  { scene, camera, world, track, meta,
    update(dt), setCameraMode('flyover'|'orbit'|'trackside'), destroy() }
F1.world.build(model, meta, opts) ->
  { group, sky, envMap, sun, ambient, floodlights, meta, model,
    update(dt), setWeather('dry'|'wet'|'overcast'), setShadowFocus(x,z),
    setFogHook(fn), dispose() }
// IMPORTANT: the track model is in world space, the rendered world is origin-local.
// Subtract track.origin.{x,z} at every boundary (camera, raycast, minimap, HUD).
F1.world.minimapPath(model, w, h, pad) -> {pts, toScreen(x,z)}
```

**Environment polish pass (second half of Section 2)**

The first pass proved the pipeline but the world still read as "boxes in a
field". This pass rebuilt the scenery layer so each circuit has a recognisable
character, while staying inside the draw-call and triangle budget.

* **City corridor** (9 circuits) — a continuous street canyon instead of random
  blocks: front row hugging the track at ~24 m, back row set back at ~62 m,
  sidewalk aprons between track edge and buildings, facade UVs scaled so window
  size stays constant regardless of building size, roof caps, and accent-coloured
  LED crown strips on neon circuits. Blocks are skipped along the pit straight
  (the pit building owns that side) and behind grandstands.
* **Street surfaces** — street/harbour circuits get an asphalt/concrete verge
  between the track and the walls; only park/desert circuits get grass or sand.
* **Water** — lake/harbour/marina sites are chosen by scanning a grid for the
  largest plot at least 150 m clear of the lap (falling back to the most open
  infield plot, and skipping water entirely on dense street circuits where
  there is no room). Adds shoreline ring and, on harbour/marina/city circuits,
  moored yachts with masts.
* **Ridges** — a 72-segment silhouette ring (two depth layers, baked vertical
  gradient, unlit, fogged) replaces the cone mountains: a proper horizon from
  every camera, and it never clips.
* **Terrain** — track elevation data is now re-based so the lowest point of the
  lap sits at y = 0. Circuits that climb (Spa +36 m, Monaco +40 m, Austria,
  COTA…) get an embankment ribbon blending the verge down to the flat ground, so
  nothing floats and the ground plane is continuous.
* **Grandstands** — proper tiered stands (8 decks climbing away from the track,
  58 m long, roof + back wall + supports) placed automatically: one large main
  straight stand plus up to six secondary stands at the tightest corners, spaced
  at least 260 m apart. Instanced crowd sits on the decks. Stand material
  changed from near-black to light concrete so it reads from a distance.
* **Pit building** — garage pods now run to the ground instead of hovering on
  elevated circuits.
* **Trees** — four proper kinds (round, pine, palm, cypress belt) with trunks,
  merged per kind; palm fronds are a second merged mesh. The `forest` feature
  adds a dense conifer belt around Spa/Austria.
* **Landmarks** — a compact kit maps the calendar's 40 named features to a
  handful of primitives (palace, hall, tower, hotel, hill, sign wall, fountain,
  oval) placed by lap fraction. Monza gets the abandoned oval banking beside
  the lap; Montreal gets its island; desert circuits get dunes set well back.
* **Circuit themes corrected** — Montreal, Interlagos and Mexico City were tagged
  as downtown street circuits; they are park circuits (with the city on the
  horizon), so they no longer build a city canyon over the infield.
* **Trackside camera** — now a fixed TV-style rig: 22 m back from the barrier,
  13.5 m up, framing 55 m down the track, starting on the pit straight so the
  main grandstand and pit building are in shot.

**Exit test** (headless Chromium, WebGL2/SwiftShader, `file://`)
- All 24 circuits build and render: **45–100 draw calls, 41 k–90 k triangles**
  (budget was < 400 calls). Scene JS cost per frame is < 0.05 ms; the headless
  SwiftShader software rasteriser is the only bottleneck in CI, not the game.
- Track lengths: 24/24 within 0.12 %; `node tools/gen_circuits.js --check` → 24/24 OK.
- No page errors or console errors on any circuit; the only console output is
  Three.js's r150 UMD deprecation notice.
- Visual check: orbit contact sheet (all 24), plus flyover/trackside/night captures
  for Monza, Monaco, Spa, Zandvoort, Bahrain, Las Vegas, Singapore, Canada, Mexico.
- `node tools/gen_circuits.js --check` → 24 circuits, worst length error 0.112 %, all OK.

---

## Section 3 — physics, cameras, HUD (driveable prototype)

Six new files, all registered in `index.html` in dependency order
(`tyres → vehicle → ai/driver → cameras → session → hud → race`).

### `physics/tyres.js` (new)
Five compounds with grip, wear rate, peak temperature, heat gain and wet ability,
the normalised slip curve (`F1.tyres.curve`, 1.0 at the peak, 0.84 sliding), a
load/temperature/wear-aware `mu()`, seven surface types and a per-wheel thermal
model (`step`): slip power plus brake heat in, convection out, wear from slip
energy only. Tyres are separate state per corner (FL/FR/RL/RR) so a lock-up or a
spun rear shows up individually on the HUD.

### `physics/vehicle.js` (new)
Classic two-axle bicycle model at a fixed 120 Hz, ~700 lines:

* **Power unit** — 405 kW ICE torque curve, 8-speed gearbox with a 45 ms shift,
  300 kW ERS (350 kW in overtake) out of an 8 MJ store, 250 kW regen under
  braking, fuel burn 0.0275 kg/s at full throttle.
* **Aero** — X mode (drag 0.86 / downforce 1.95) and Z mode (1.24 / 4.60),
  auto-switching with straight-line and lateral-g gates, DRS reducing downforce
  by 28 %; front-wing/floor/rear-wing damage scales it down.
* **Tyres** — per-axle slip angles, combined-slip friction ellipse, load
  sensitivity, weight transfer from the previous step's longitudinal g, ABS
  (0.905–0.755 of available grip depending on level) and traction control that
  trims the drive force before the rears break away.
* **Barriers** — the world builds its walls 2.2 m outside the white line
  (`world/environment.js`), so the engine measures exactly the same distance from
  the *track's own width* instead of a fixed radius. Contact reflects the outward
  velocity with 0.35 restitution, scrubs speed, and damages the wing and
  suspension according to impact speed. Hitting a wall at 300 km/h costs a wing;
  a nudge at 40 km/h costs nothing.

Measured with `node tools/simcheck.js`: **0–100 km/h 3.1 s, 0–200 km/h 6.7 s,
0–300 km/h 11.2 s**, peak 323 km/h in X mode at Monza, 4.1 g under braking from
300 km/h, 1.36 g sustained cornering on the hard tyre at 22 °C.

### `ai/driver.js` (new, finished in Section 4)
A speed profile is solved once per circuit: a cornering pass from the track's own
curvature and the car's downforce (`v² = r·μ·(g + k·v²)`, curvature averaged over
~20 m and radius floored at 18 m), a forward acceleration pass from the power
unit, and a backward braking pass from the downforce. The driver then runs a
Stanley controller (track heading + cross-track error) with yaw damping, samples
the profile for pedals, anticipates braking from the deceleration needed over the
next 20 m, counter-steers when the rear steps out, and has a three-state recovery
machine (run → reverse → recover) so a tap of the barrier cannot end a session.
It drives the *same* `F1.vehicle.step` as the player; nothing about it cheats.

### `physics/cameras.js` (new)
Five rigs — T-cam, cockpit/nose cam, chase, broadcast and cinematic — with
damped positions, speed/kerb shake, roll and look-back. The broadcast director
pre-computes 14 posts around the lap from the geometry and cuts between them,
holding each shot for at least a second.

### `game/session.js` (new)
The session owns the clock: real time accumulates, whole 1/120 s physics steps
run (max 12 per frame), and the body transform is interpolated by the leftover
fraction so the car is smooth at 60 and 144 Hz. It handles the 3-2-1 lights
(the car is held on the grid, throttle only revs the engine), lap/sector timing
against the track's own sector boundaries, a ghost delta against the best lap,
DRS/overtake zones from the track data, ERS modes (harvest/balanced/deploy/
overtake), fuel burn, pauses, car resets, and the HUD feed.

### `ui/hud.js` + `css/hud.css` (new)
Broadcast layout: position/lap block, timing tower, five start lights, radio
banner, minimap with DRS zones and the car's dot, per-corner tyre temperatures
and wear bars, compound chip, fuel bar, 15 RPM LEDs, gear/speed, throttle/brake
pipes, ERS/aero/DRS/surface pills, last/best/sector times, countdown number and
the chequered-flag card. `H` cycles full → minimal → off.

### `ui/race.js` (new)
The driveable screen: builds the circuit scene, mounts the session and HUD,
forwards keys, and owns the pause menu (resume / restart / camera / quit) and
the results card (position, laps, best and last lap). Leaving the screen
disposes the world, the session and the HUD in that order.

### Wiring
`App.startQuickRace` now launches the session instead of the track preview: it
derives the lap count from the race-length setting and stores the last circuit.
`world/track_scene.js` gained a `race` mode that stops running its own inspection
camera and hands the frame to `api.onFrame` (the session).

**Exit test** (headless Chromium, WebGL2/SwiftShader, `file://`)
- Quick Race → grid: countdown runs, lights come on, car launches; 15 s of
  throttle from the line reaches **320 km/h in 6th, 14 253 rpm**.
- All five cameras render the road, the car and the scenery; `C` cycles them,
  `H` cycles the HUD, `Esc` pauses, `R` resets, `F` changes ERS mode.
- A full lap with the AI driving completes, the chequered flag fires, the
  results card opens, and quitting returns to the menu with the scene, session
  and HUD all disposed.
- No page errors and no console errors on any of it.
- Known gap: AI lap pace is 5–40 % off the target depending on circuit (Monza
  154 s vs 111 s achievable, Belgium 142 s, Brazil 95 s, Singapore 106 s) and
  Monaco still has barrier incidents. Pace and contact avoidance are Section 4
  work; the player car, physics, cameras, timing and HUD are all in place.

---

## Section 4 — 21 opponents, race control, pits, weather

The field is real: every opponent is an `F1.vehicle` with the player's tyre
model, drag, downforce and barrier contact. The AI (`ai/driver.js`) only ever
returns pedals and steering, so there is no grip cheating anywhere in the
field — a slow car is slow because the model says so.

### AI re-base (the important part)

Two compounding measurement errors were found and fixed before the field could
work:

1. **The aerodynamics were ~50× too strong.** `downX/Z` were 1.95 / 4.60, which
   gave 4.9 kN of downforce at 150 km/h (a real 2026 car makes ~90 N there at
   that speed). The speed profile trusted that number and planned corners the
   tyres could never deliver. Re-based to **2.30 / 5.50** (≈170 N at 150 km/h,
   ≈3.8 kN at 300 km/h).
2. **The lateral-g readout was 0.00 everywhere**, so every measurement taken
   against it was meaningless. It is now tracked, and a synthetic-circle sweep
   puts the real sustained cornering load at **2.3–2.6 g**.

With honest numbers the profile is built from a measured cap,
`aLatMax = G·grip + 0.0040·v²`, instead of the full downforce term; tyre grips
were re-based (soft 2.52 / medium 2.38 / hard 2.20 / inter 2.05 / wet 1.62) and
the peak slip angle widened from 0.122 to 0.165 rad. The corner-radius guard in
the profile now floors at 8 m so Monaco's hairpins survive.

**AI soak** (`tools/simcheck.js`, single car): Monza 100.5 s, Silverstone 119.1,
Spa 134.0, Suzuka 116.8 — repeatable to ±0.1 s with **zero off-track time on 21
of 24 circuits**. Monaco still needs care (see next steps).

### `game/field.js` (new, 21 cars)

- Grid slots shared with the session (`F1.field.slotPos`) so the player lines up
  in a real slot (default P6) with cars around them.
- Per-car AI: skill from the driver's overall, pace from the difficulty
  setting and the team's performance ratings; one team-mate is not identical to
  the other.
- **Traffic model**: each car is told the gap to the car in front and the side
  with room. It queues at that gap and pulls out to pass; it never drives
  through anybody. Contact is positional (a shove plus a lift), not a 2D solver.
- Lap timing, sector-less classification by distance covered (negative before
  the first crossing, so a grid behind the line is not "a lap ahead").
- Pit strategy: one scheduled stop over races of 8+ laps, or an emergency stop
  when the average wear passes 0.72. The car drives the pit lane under the same
  runner the player uses.
- `setLimit` (safety car delta), `setFrozen` (red flag) and `setConditions`
  (wetness / ambient) let race control and the weather act on the whole field.

### `game/racecontrol.js` (new)

Flags **green / yellow / VSC / SC / red**, per-sector yellows, deployment logic
(three incidents in 20 s → SC; a sector that will not clear → recovery SC;
standing water → SC), the SC cycle (deploy → neutralised → in this lap → green),
and a red flag that freezes the field and restarts it behind the car.
Penalties: 5 s for every fourth track-limits warning and 5 s for exceeding the
safety-car delta for 2.5 s. Weather is a four-state walk (dry → cloudy → showers
→ heavy rain) with a wetness value that ramps up faster than it dries, feeds
`vehicle.step`, the AI target speed and the sky.

### `game/pitlane.js` (new)

The lane is a path offset from the centreline (the same geometry the pit
building was drawn against), 6.8 % of a lap long, **80 km/h limit**, an entry
blend from the racing line, a box at 42 %, a 2.2–2.8 s stop, and an exit that
rejoins after the start line (so a stop does not lose a lap). The car is driven
kinematically while in the lane; the normal tyre model resumes at the exit.
`P` requests a stop, `[` / `]` choose the compound.

### `world/weatherfx.js` (new)

2 600 rain streaks in one `THREE.Points` cloud that follows the camera, with
opacity and fall speed driven by race control's rain intensity. The road's
roughness/metalness and the sky are switched by the existing
`world.setWeather()`.

### HUD additions

Flag banner (yellow / SC / VSC / red / blue), weather chip with a track-wetness
bar, pit request and pit-stop banners, a penalty chip, and a live timing tower:
**metres** before the first lap time exists, **seconds** after, and **+N LAPS**
once a car is lapped. The tower used to redraw its rows only when the number of
rows changed, which froze every gap; it now caches the elements and rewrites
the numbers each frame.

**Exit test** (headless Chromium, `file://`)
- 22-car grid at Monza: player P6, 21 opponents on the grid, countdown, launch,
  P2 by 15 s, lapped traffic, gaps live in the tower.
- 90 s race with the field running: no page errors, no console errors.
- Pit stop: `requestPit` → `entry` → `box` → `exit` → fresh softs at 0.00 wear,
  `stops = 1`.
- Heavy rain at Spa: wetness 0.82, sky `rain`, 2 600 streaks visible, AI speeds
  down ~40 %, yellow flag out.
- Finish: chequered flag card, 22-row classification, penalty chip (+10 s).
- 10-lap race at Austria in Node: **21 stops**, one safety car (27 s), zero
  recoveries, zero barrier contacts, no NaNs.

---

## Section 5 — weekend, formation lap, replay, photo mode

### `game/weekend.js` (new)
A weekend is data: `fp1 fp2 fp3 q1 q2 q3 race` for a standard round and
`fp1 sq sprint q1 q2 q3 race` for a sprint round. Each session carries its own
result list and state. Qualifying really knocks out — Q1 runs all 22 drivers and
only the fastest 15 reach Q2, ten reach Q3 — and the grid for the race is built
from that survivor list, so knocking out in Q1 starts you 16th. AI times come
from the same speed profile the on-track field uses, plus a per-session wobble
and a 14 % chance of a dirty lap. `points()` is the single source of the 25-18-15
… and 8-7-6-5-4-3-2-1 tables (fastest lap is deliberately not rewarded).

### `ui/weekend.js` (new)
The paddock: session list on the left (done / next / selected), timing on the
right, a provisional grid, and *Drive* / *Simulate* for the next session. Every
session started from here hands the race screen an explicit grid order, so a
qualifying result actually decides the grid. Results written back by the race
screen are stored on the weekend object, which is what makes "return to paddock"
work after a race.

### Formation lap and re-grid
A grand prix started with `formationLap: true` begins in a `formation` state:
the field rolls round at 60 % pace with the player's car driven for them, no lap
timing runs, and the moment the car crosses the line `field.regrid()` puts all
22 cars back on their slots and the lights start. The HUD says FORMATION LAP
instead of a countdown.

### `game/replay.js` (new)
A 12 Hz ring buffer of 95 s holding position, heading, steering, wheel spin and
lateral g for all 22 cars. `T` rewinds 14 s and plays it back with the meshes
and the camera interpolated between samples; the HUD shows a REPLAY badge. Photo
mode (`V`) freezes the simulation through a frame guard (not the pause menu),
hands the camera to a mouse-driven orbit rig and dims the HUD; `J` re-renders and
downloads a PNG (the drawing buffer is not preserved, so it must be re-rendered
immediately before the read).

### Fixes found by the section-5 harness
- **Steering was mirrored**: the physics wants a positive angle to turn *left*
  (that is how the AI's Stanley controller is written) while the keyboard read
  right as positive. The negation now happens once, in `core/input.js`.
- The pause key was bound to `KeyP`, which shadowed the pit request; pause is
  now `Esc` only.
- `ui/race.js` compared `session.state` (an object) to `'finished'` in six
  places, so the results card never appeared, `Enter` did nothing and the pause
  panel never hid. All of them read `session.state.state` now.
- The timing tower rebuilt its rows only when the row count changed, so gaps
  froze; it now caches the elements and rewrites the numbers per frame, shows
  metres before the first lap time exists, seconds after it, and `+N LAPS` for
  lapped cars.
- The finish banner and the results card stacked on top of each other; the card
  now hides the banner and the card scrolls if the table is long.

---

## Section 6 — career

`game/career.js` is a career as plain JSON: identity, team, contract, season,
results, championship points, R&D levels, market and history. It is deterministic
from its seed, so a save reloads into exactly the same state.

- **Create a driver** (name, code, number, country, 76 overall, backmarker deal)
  or **take a real seat** (the driver's rating, team and contract come with it).
- **Team offers** are gated by rating: a team of strength S will talk to a driver
  of S−8 or better, so a rookie sees Aston Martin down while McLaren is locked.
- **Rounds** advance from the real result: points (25-18-15…), a race fee, a
  reputation nudge, and a simulated rest-of-field so the championship table is
  consistent with the weekend's reference pace.
- **Season end** checks the contract objective, pays a prize, records history,
  rolls the season over and opens the **market** (offers scaled by finishing
  position and reputation). Signing swaps the team and contract.
- **R&D**: five departments (aero, power, chassis, reliability, pit crew), eight
  levels each, cost rising 55 % per level. Levels are written straight into
  `team.performance`, so an upgraded car really is faster in the physics and the
  AI field.
- **Saves**: three slots in `localStorage` (with the memory fallback the rest of
  the game uses), a slot list with name / team / season / position / credits, and
  **JSON export/import** through a downloaded file and a file picker.

### `ui/career.js` (new)
`career-setup` (the create/real/team picker) and `career` (the hub: next race,
championship, R&D, market, saves, contract, the 22-round grid). A career race
writes itself back on the chequered flag and the results card offers *Back to
career*.

**Exit test** (headless Chromium, `file://`)
- Create a driver → 11 teams listed, 5 locked at 76 overall → sign with Cadillac
  → hub renders the next race, the 22-round grid and the contract.
- R&D: investing in aero takes the team from 68 to 69 and the cost from 340 up.
- Save → reload → same name; export → import round-trips; three slots list.
- A full 22-round season runs through to the market: champion, prize paid,
  contract expired, six offers waiting.
- A career race: 2 laps, chequered flag, round advances 1 → 2, 25 points banked
  (not double-counted), credits paid, *Back to career* returns to the hub with
  the next race on screen.
- No page errors, no console errors.

---

## Section 7 — audio, time trial, championship

### `core/audio.js` (new) — 100 % synthesised, no audio files
Two sawtooth oscillators plus a square sub-octave feed a lowpass and a soft
waveshaper; a band-passed noise voice adds turbo spool, a second adds tyre scrub
(level from slip, centre frequency from surface), a third is wind (speed), a
fourth is the crowd (excitement from nearby cars). Each chain has its own bus
(`engine`, `tyres`, `crowd`, `ui`, `engineer`) into a compressor and a master
gain. No `AudioContext` is built at boot: `core/app.js` arms a one-shot
`pointerdown | keydown | touchstart` listener that constructs and resumes the
context, which is what browsers require.

- `F1.audio.update({rpm, throttle, speed, slip, latG, surface, excitement})` is
  fed from `game/session.js` after each render.
- `beep(kind)` sounds the chassis radio squelch, UI clicks, the start-light
  tones, the chequered flag and penalty chimes.
- `radio(text)` emits `radio-message` on `F1.bus`; `ui/hud.js` types it out at
  ~40 ms/char under an `ENGINEER` chip and leaves it for four seconds.
- The **race engineer** now calls the first lap, half distance, the final lap,
  every flag change, pit entry and the pit stop, rate limited to one line every
  3.2 s (flag calls ignore the limit).
- **M** mutes anywhere (`body.audio-muted` chip in menus, `.hud-mute` in the
  session) and the setting persists; the mixer rows in Settings write straight
  into the live graph (`applyVolumes()` is finite-guarded, so a corrupted save
  cannot throw).

### Time trial (`ui/timetrial.js`, new)
Solo three-lap screen per circuit, a PB stored per circuit in `localStorage`,
a searchable circuit list and a PB board. The **ghost** is the pose trace the
session records at 10 Hz every lap (`St.ghostRec`); the best lap keeps its trace
(`session.ghost`) and the screen stores it the moment the lap is banked, so
quitting early cannot lose it. A fresh session with `params.ghost` rebuilds the
car, makes every material 42 % opaque and depth-write-free, and interpolates
between trace points on the clock. Verified: a 1:44.007 lap is saved, 974
points, appears on the screen as the PB, and the ghost mesh reappears in the
next session at exactly the spline position its timestamp predicts.

### Championship (`game/championship.js`, `ui/championship.js`, new)
Any driver, any subset of the 22 rounds, sprint points on or off. Setup is a
team-grouped driver list and a two-column round grid; the hub shows round,
position, points, leader, the next round, drivers' and constructors' tables,
plus *Race this round* and *Simulate*. Every other car is simulated from the
weekend's reference pace with a small form term; finishing a round writes the
result into `champ_active` through `F1.championshipScreen.record` and the
results card offers *Back to championship*.

**Exit test** (headless Chromium, `file://`)
- All ten `beep` kinds and an unknown kind: no throw; `suspend()`/`resume()`
  round-trip to `suspended`/`running`; mute survives a reload.
- Live engine feed at 13 944 rpm: engine gain 0.43, filter 682 Hz, master 0.72;
  muted master 0, unmuted 0.72; settings sliders move the same graph (master
  40 % → 0.36).
- Engineer: "First lap done. P1. Push on." fires on the lap after lights-out.
- Time trial round-trip as above; championship: P1 (25 pts) and P5 with a
  simulated sprint (12 pts) → table of 22 drivers / 11 constructors, next
  round correct; a 4-lap round finishing P3 banks 15 points and returns to a
  hub pointing at the next circuit.
- Regression harness unchanged and clean: 21-car grid, pit stop, all five
  flags, replay + photo, 22-car classification, paddock, formation lap.
- No page errors, no console errors.

### Size audit
74 files, **1.7 MB** excluding `.git` (3.0 MB with it). Largest: `lib/three.min.js`
637 KB, `world/environment.js` 87 KB, `css/ui.css` 43 KB, `game/session.js`
41 KB. Every `data/circuits/<id>.js` is well under the 20 KB target.

---

## Section 8 — docs, polish and the final run

### Documentation
`README.md` and `README.txt` rewritten as the player-facing manual: how to run it
from `file://`, the full keyboard and gamepad maps, every mode, the weekend
format, the points tables, all settings, the folder structure with the load
order, the **size-budget table** and the **circuit accuracy list** (per round:
length, ACCURATE/APPROXIMATE, notes). Both carry the credits section — Three.js
(r158 UMD, MIT) and the TUMFTM racetrack-database (LGPL-3.0, the derived
centreline files inherit it) — and the known limitations.

### Accuracy tags corrected
The accuracy audit found four hand-traced circuits still labelled ACCURATE in
their generated files (Azerbaijan, Monaco, Qatar, Singapore) and seven traced
circuits missing the `approximate: true` metadata flag, so the game would have
shown them as surveyed. Both are fixed: **16 ACCURATE / 8 APPROXIMATE**, and the
browser check confirms the flag reaches the UI (time trial header, grid badges).

### Polish pass
- Every screen was measured at **1280×720**: no horizontal or vertical overflow
  on garage, grid, quick race, settings, time trial, championship or career.
- The main menu footer was colliding with entry 06 at 720p and the garage list
  hid its eleventh team behind a scrollbar; both now fit (menu/footer gap 88 px,
  all 11 teams visible) via a `max-height: 780px` block, not a redesign.
- Stale build labels removed ("Section 1 build", "Driving arrives in Section 3",
  "opponents arrive in the AI milestone"): the menu footer now reads
  `v1.0 · 2026 season` and the pause card explains Esc / M / F3 instead.
- The mute chip is drawn twice on purpose: `body.audio-muted::after` in menus and
  `.hud-mute` inside a session (the body chip is suppressed under
  `#screen-root.race-active` with `:has()`).

### Final run (headless Chromium, `file:///…/index.html`, no server)
- Boot: main menu, 11 teams, 22 drivers, 24 circuits (22 active), 6 menu items,
  0 page errors, 0 console errors.
- All eight screens mount from a real `file://` navigation and paint content.
- Quick race: 21 AI cars, 5 788 m Monza geometry, audio graph live after a real
  pointer gesture (master 0.72), engineer radio visible in the HUD
  ("Yellow flag ahead. Be ready to slow.").
- Pause opens and closes, `M` mutes and unmutes, exiting to the menu removes the
  race layer cleanly.
- Regression: 21-car grid · pit stop soft→medium with wear reset to 0 · all five
  flags (yellow, VSC + limit, SC + limit, red, green) · replay (95 s ring) +
  photo mode · 22-car classification · results card · paddock with 7 sessions ·
  formation lap → countdown → racing.
- Models: career (11 offers, P4 → 12 pts, R&D aero → level 1), championship
  (P2 → 18 pts, leader NOR), time trial (PB stored, slower lap rejected).

### Size
**75 files, 1.54 MB of file content (1.7 MB on disk), 120 KB of `.git`.**
Target 40 MB, hard limit 128 MB — 3.9 % of the target. Largest file
`lib/three.min.js` at 637 KB; no circuit file reaches 20 KB.

---

## Section 9 — car model rework + quick-race seat picker

Two follow-up requests: *the 3D models look bad — make them realistic*, and
*let the player pick a driver in quick races*.

### The car model, rewritten (`world/car_model.js`, 58 KB)
The old car was a handful of overlapping flat loft panels: a bright painted
slab with decals floating outside the bodywork and a front-wing stack visibly
detached from the nose. It was replaced wholesale rather than patched.

- **Hull**: one continuous loft from nose (z = −2.62) to rear crash structure
  (z = +2.18), driven by a 23-station table of explicit cross-section points
  (floor edge, undercut, sidepod shoulder, deck, engine-cover crown) instead of
  ellipses. Section heights follow a real car: 0.30 m nose, 0.60 m cockpit
  deck, 0.99 m airbox, 1.02 m rear wing. The belly rises at both ends so the
  nose floats and the tub sits on the floor.
- **Two-tone material split**: `loftHull()` sorts faces by height into two
  material groups — carbon below the split, team paint above. That single
  change is what makes the bodywork read as a car rather than a painted blob;
  the plane view shows the carbon floor edge running under the painted pods.
- **Separate sidepods** with `x`-offset support added to the ring builder.
  (The first attempt silently ignored the offset, drawing both pods on the
  centreline and flattening the whole car — found with a material-debug render,
  not by eye.)
- **Wings** are closed cambered solids (`wingElement`) with taper and sweep,
  not single-sided ribbons; the rear wing is painted with a team-coloured flap
  and carries the endplate decals.
- **Wheel faces** are painted once into a 256 px canvas per team accent — five
  forged spokes, a machined lip, a centre nut — instead of five modelled box
  spokes. Cheaper, and it reads at race distance.
- **Deleted** the dead `cockpitStations()` stub and the old `mergeStatic`
  multi-material path (merging rebuilds geometry without groups, which silently
  turned whole cars carbon-black).
- Budget: 20 482 triangles / 64 meshes at LOD 2, 16 902 / 48 at LOD 1 (AI),
  780 / 13 at LOD 0 (distant and ghost). Bounding box 5.24 × 2.04 × 1.09 m.

### Studio lighting (`world/showroom.js`)
Car paint is mostly a mirror, so the old near-black environment made every
car look like a dark slab no matter how many lights were added. The equirect
environment was rebuilt as a bright cyclorama with two big softboxes, a
horizon band and a warm kicker; `environmentIntensity` is 1.15, and a second
fill was added on the left flank so bodywork is never lit from one side only.
Garage framing was pulled back (dist 10.2) so the car is fully in frame and
clear of the team list and the driver card.

### Quick-race seat picker (`ui/ui.js`, `css/ui.css`, `core/settings.js`)
- A **Your car** panel sits between the race-length toolbar and the circuit
  grid: an eleven-team strip, then the two drivers in that team with their
  numbers and overall ratings. Selection is saved to
  `settings.gameplay.seatTeam` / `seatDriver` (a new settings key, separate
  from `career.teamId` — a quick race never moves your career driver).
- Both launch buttons use it: *Quick race* passes `teamId`/`driverId` into
  `F1.app.startQuickRace`, and *Full weekend* hands the same seat to the
  weekend flow.
- Verified end to end: Ferrari → Hamilton selected → saved → race starts with
  21 AI cars, no duplicate entry for the player, HAM highlighted at P6 in the
  tower.

### Layout bug found while doing it
The circuit grid cards collapsed to 30 px rows whenever the seat panel was
present. The cause was not the card CSS: a CSS grid that is itself a
`flex: 1` child gets a definite height, and Blink then treats `auto` rows as
equal shares of it. Fixed by moving the scroll to a
`.circuit-grid-wrap` and giving the grid `grid-auto-rows: max-content` —
132 px cards at every window size (1280×720, 1024×640, 1600×900), all scrolling
inside the wrap.

### Verification
- `node --check` clean across every shipped `.js`.
- Garage + race screenshots re-shot; menu, garage, grid, quick race, settings
  and career all repaint from `file://` with **0 page errors, 0 console
  errors**.
- Full regression re-run after the changes: 8 screens mount (52/118/374/134/
  158/156/208/211 nodes) · race 21 cars, 175 km/h, five camera modes, pause
  toggles · formation → countdown → racing · pit stop soft→medium with wear
  reset to 0 · all five flags (yellow, VSC, SC, red, green) · replay starts and
  photo mode activates · 22-car classification with the player row present ·
  time trial 101.067 s best lap · career signs a rookie (Haas, round 1/22,
  900 credits, 2-year deal) · localStorage round-trips.
- All 22 driver/team combinations build a valid car with four wheels and a
  working `setAeroMode` / `setBrakeGlow`.

### Size
**75 files, 1.57 MB of file content (1.8 MB on disk).** `world/` grew from
156 KB to 180 KB; everything else is within a few KB. 4.3 % of the 40 MB
target.

---

## Next steps (queue)
1. Done: Sections 1–9 are complete and pushed. The build is the deliverable.
2. Optional polish if work continues: Monaco Rascasse steering saturation, and
   closing the ~20 % gap to real lap times by retuning the tyre model rather
   than the AI profile. Both are recorded in README's known limitations.

---

## Section 10 — circuit art overhaul (in progress)

Full detail lives in `debug/OVERHAUL.md`; the problem list that drives it is
`debug/DIAGNOSIS.md`; before/after shots are in `debug/before` and `debug/after`.

* **10.1 Diagnosis** — done. 13 concrete problems found from four fixed camera
  angles across all 24 circuits (see the diagnosis file). A standard shot rig
  (`world/shots.js` + `verify/shots.js`) was built first so every later change
  can be compared like for like.
* **10.2 Global pipeline** — done. Offline-bundled three.js post addons
  (`lib/three-post.js`), composer chain (SSAO → bloom → ACES output → grade →
  SMAA), analytical HDR sky with clouds/stars/sun disc, PMREM environment
  generated from that sky, exp2 fog, texel-snapped shadows, four quality presets
  that actually drive the art budget. Several long-standing rendering bugs were
  fixed on the way (black concrete texture, self-shadowing walls, black PMREM,
  fog on aerial cameras, premultiplied-alpha lap map -> black asphalt).
* **10.3 Track surface, Monza** — done. New `world/surface.js`: swept asphalt
  with a real crown, aggregate albedo/normal/roughness, a per-lap macro map with
  a curvature-derived rubber line and marbles, three kerb profiles (flat, raised,
  sawtooth) with correct stripe spacing, painted start line and grid boxes,
  mown verges, gravel traps, and a wetness API wired to `world.setWeather`.
* **10.4 Trackside environment, Monza** — next. Barriers, grandstands, pit
  complex, gantries, vegetation, and `data/environments/italy.js`.
