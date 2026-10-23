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

## Next steps (queue)
1. Section 2: track model generator + 24 circuits + procedural environments.
2. Section 3: vehicle physics, cameras, broadcast HUD.
3. Section 4: AI, race control, pits, weather.
4. Section 5: weekend formats, replays, classification.
5. Section 6: career, R&D, market, saves.
6. Section 7: audio, polish, size audit, README.txt.
