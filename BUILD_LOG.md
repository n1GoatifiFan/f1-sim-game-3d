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

## Next steps (queue)
1. Section 3: vehicle physics, cameras, broadcast HUD.
2. Section 4: AI, race control, pits, weather.
3. Section 5: weekend formats, replays, classification.
4. Section 6: career, R&D, market, saves.
5. Section 7: audio, polish, size audit, README.txt.
6. Section 8: README/README.txt, final size + `file://` verification.
