# Circuit art overhaul — work log

Branch `arena/6ebcb6d1-f1-sim-game-3d`. Reference board: `debug/before/` (all 24
circuits, four fixed cameras each) and `debug/after/` (re-shot as each circuit
is reworked). `debug/DIAGNOSIS.md` is the problem list the rework is answering.

## How the shots are taken

`world/shots.js` builds a circuit with `F1.trackScene.create(id, {mode:'shots'})`
and frames four standard cameras:

| view | camera | what it is for |
|------|--------|----------------|
| `chase` | 8.5 m behind the start line, 2.1 m up, 58° | what the player sees |
| `tv` | 46 m up, long lens (34°), outside of T1 | broadcast wide |
| `trackside` | 1.55 m up, 13 m from the white line | low angle, speed |
| `aerial` | ~0.95 × circuit span above the middle | layout / surroundings |

`verify/shots.js` (headless Chromium) walks the 24 circuits and writes the PNGs,
so before/after pairs are always the same four framings. In a browser,
`index.html?shots=1&circuit=italy` or `?shots=1&all=1` downloads the same shots.

## Progress

### Section 10.1 — diagnosis ✅
See `debug/DIAGNOSIS.md`: 13 problems, from "world ends at the track edge" to
"Monza isn't Monza", plus the fix list in the order it is being executed.

### Section 10.2 — global pipeline ✅
Everything below is local, offline, `file://`-safe and quality-gated.

* **`lib/three-post.js`** (139 KB) — the official three.js addons bundled as one
  IIFE against the existing `lib/three.min.js`: `EffectComposer`, `RenderPass`,
  `ShaderPass`, `UnrealBloomPass`, `OutputPass`, `SSAOPass`, `SMAAPass`,
  `CopyShader`, `FXAAShader`, `LuminosityHighPassShader`, `Sky`, `Water`,
  `BufferGeometryUtils`. Built with esbuild; the only transformation was
  aliasing `three` to a shim that re-exports `window.THREE`.
* **`world/post.js`** — the chain: HDR (half-float) render target with MSAA when
  the preset has it → SSAO (half res, high/ultra only) → UnrealBloom →
  `OutputPass` (ACES + sRGB + exposure) → custom grade → SMAA (when MSAA is 0).
  The grade pass does exposure, filmic contrast, saturation, split-tone,
  vignette, film grain, chromatic aberration and a speed-blur hook.
* **`world/sky.js`** — analytical Preetham-style dome authored in linear HDR:
  Rayleigh-ish zenith→horizon ramp, HDR sun disc with limb darkening,
  forward-scatter halo, horizon haze matched to the fog, a two-layer fbm cloud
  dome, a star field for night rounds, and a **PMREM environment map generated
  from that same dome** so reflections and ambient match the visible sky.
* **`core/renderer.js`** — renders through the composer, rebuilds it when the
  scene or quality changes, and keeps `renderer.toneMappingExposure` as the
  single exposure control (so ACES is applied exactly once).
* **`core/settings.js`** — the four presets now carry the full art budget:
  `qualityRank`, `pixelRatio`, `shadowSize`, `shadowHalf`, `anisotropy` (4/8/16/16),
  `bloomStrength/Radius/Threshold`, `ssao`, `grassDensity`, `cloudDetail`,
  `wetReflections`, `maxLights`.
* **Fog** is now `FogExp2` with a per-view density: tight for driving views,
  loose for orbit/aerial so the circuit reads from 2 km up.
* **Shadows**: texel-snapped focus (`setShadowFocus`), `PCFSoftShadowMap`, frustum
  sized from the preset (90–170 m half-extent).
* **Exposure/grade** are per time-of-day (`world/exposure`, `world/grade`) and
  applied when a circuit scene is created.

Fixed along the way (each was a real bug that affected the before shots):

* the concrete texture was authored at `#565a5f`, i.e. 0.09 linear — every
  barrier and wall rendered almost black. Now `#b7bcc2` with grime and streaks.
* wall ribbons self-shadowed (a one-quad-thick receiver at the same depth as the
  caster) — `receiveShadow` is off on them now.
* the PMREM dome clone was scaled to 600× a 3000 m sphere, so it was outside the
  cube camera's far plane and the environment map came out black. The env has to
  be scaled *down* to ~500 m.
* the sky/cloud/star dome is now parented to a group that follows the camera, so
  the aerial camera is never outside the sky.
* the initial camera mode never ran `applyFog()`, so every `shots` scene fogged
  its 2 km aerial view to white.
* canvas 2D stores **premultiplied** pixels: the lap map was written with
  `alpha = 0`, which erased its RGB, which made the asphalt albedo black
  (it read as dark navy, lit only by reflections). Alpha is 255 now.

### Section 10.3 — track surface (Monza) ✅
`world/surface.js` replaces the old flat ribbons with a swept, measured surface:

* **Swept geometry at true scale.** `swept(model, profileFn)` walks the same
  centreline the physics uses and sweeps an arbitrary 2D cross-section. The road
  gets a 20 mm crown; kerbs are real extruded profiles.
* **Asphalt**: 512² aggregate albedo + Sobel-derived normal + roughness maps,
  tiled in metres (3× across, 9 m along) with anisotropy 16.
* **Lap map** (512 × 2048, one row per ~2.8 m of lap): macro patches, tar seams,
  repair patches, plus a **rubber line computed from curvature** (heavily box-
  blurred so it is a line a car could follow) and marbles outside it. It is a
  per-lap map, so it cannot tile and it puts rubber where the corner is.
* **Kerbs**: three profiles chosen by corner radius — flat strip on fast corners,
  raised flat-top through medium corners, raised sawtooth with three ridges at
  chicanes and the Lesmos. Red/white paint at 1 m intervals with scuffing, so
  the stripe spacing is right whatever the corner speed.
* **Paint**: chequered start/finish band, staggered grid boxes, each built in
  world space from the centreline (no rotation-order guesswork) and lifted 20 mm
  with `polygonOffset` — no z-fighting, crisp at any distance.
* **Run-off**: mown verge either side, plus gravel traps on the outside of every
  corner above a curvature threshold (Monza's Parabolica and Lesmo exits).
* **Wetness API**: `setWetness(0…1)` darkens the asphalt, drops roughness from
  0.94 to 0.08, raises the environment reflection and cools the gravel. Wired to
  `world.setWeather('wet')`.

## 10.4 — Monza trackside environment

Three new modules, all classic scripts, no network and no new dependency:

* `world/props.js` (`F1.props.build`) — Jersey plinth + Armco beam with posts and
  bolts swept along the lap (painted street wall on street/harbour themes),
  alpha-tested catch fencing only where `|curvature| > 1/200`, TecPro and tyre
  stacks where `|curvature| > 1/70`, 12 grandstands with roof + fascia + posts
  and an instanced, bobbing crowd, pit complex painted in the 2026 team primary
  colours (one garage per team), pit wall, start gantry with five bulbs, marshal
  huts and flags, braking boards, sponsor hoardings, two bridges, lighting masts.
* `world/vegetation.js` (`F1.vegetation.build`) — six species (poplar, plane,
  pine, cypress, palm, oak) as one trunk + one leaf `InstancedMesh` each, wind
  via `onBeforeCompile`, instanced grass tufts, a 48-segment backdrop treeline.
  An occupancy grid keeps trees off the track, run-off and stands.
* `data/environments/italy.js` (`F1.ENVIRONMENTS.italy`) — palette, mood,
  per-circuit look deltas and `landmarks()`: the swept, banked 1955 oval (deck,
  earth bank, parapet, two link roads), a plane-tree colonnade with Italian
  flags, Parabolica gravel traps, and four FORZA FERRARI banners.

The legacy barrier → grandstand → pit → tree → landmark run in
`world/environment.js` is now skipped whenever a circuit has props/vegetation or
an environment module, so the two generations never stack (this also removed a
duplicate oval and a floating grass disc that showed up in the first passes).

Bugs found and fixed in this section, all of them visible in the after shots:

* **Sky was milky white.** The cloud and star shaders tone-mapped and sRGB
  encoded their output while the composer's `OutputPass` tone-mapped again.
  They now skip both chunks when the composer is active (`RAW_HDR` define).
* **Crowd read as grey noise, then as thin blades.** Each spectator quad showed
  the whole texture (averaging to mush) and was rotated 90° to the stand. Now an
  8×8 atlas cell is picked per instance in the vertex shader, the quads face the
  track and stand on the front lip of each tread.
* **Oval sat across the main straight** — 210 m *ahead* of the start line, a
  green wall across the road in the chase shot. Placement now walks outward
  along the normal and rejects any position whose footprint comes within 26 m of
  a centreline sample.
* **Armco swallowed the sky** (metalness 0.55 on a vertical face under a high
  sun) and read navy black; now galvanised with a bright albedo.
* Ground now carries world-space mowing stripes and pasture variation, so the
  grass no longer tiles visibly.

Still open in this section (honest list): the asphalt is a stop lighter than
broadcast Monza in the far distance, the crowd is a texture-lit block rather
than individually modelled people, the banking is invented geometry placed for
silhouette rather than surveyed, and SSAO is off below High.

### Next

* 10.5 time-of-day/weather, 10.6 the other 23 circuits in batches.

## Size budget

| item | before | after | note |
|------|-------:|------:|------|
| `lib/three.min.js` | 652 KB | 652 KB | unchanged, three r158 UMD |
| `lib/three-post.js` | — | 143 KB | 20 addons, minified IIFE |
| `world/sky.js` | — | 17 KB | new |
| `world/post.js` | — | 10 KB | new |
| `world/surface.js` | — | 27 KB | new |
| `world/shots.js` | — | 8 KB | new (dev tool, safe to ship) |
| `world/props.js` | — | 40 KB | new: barriers, stands, crowd, pit, gantries |
| `world/vegetation.js` | — | 18 KB | new: 6 species, grass, treeline |
| `data/environments/italy.js` | — | 16 KB | new: Monza look + landmarks |
| generated textures | — | ~24 MB GPU | canvas-generated at load, 0 KB on disk |
| `debug/` before+after | — | 16 MB | reference shots, not loaded by the game |

Runtime textures are generated in-page, so the download size barely moves:
the whole game is still ~2.4 MB on disk (82 → 85 files). VRAM cost is what grows (two 512×2048
lap maps, 512² asphalt maps, PMREM cube, HDR render targets).
