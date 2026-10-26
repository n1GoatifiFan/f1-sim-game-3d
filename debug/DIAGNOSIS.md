# Circuit art overhaul — diagnosis

Captured with `world/shots.js` → `verify/shots.js`, four fixed cameras per
circuit, 1600×900, headless Chromium (SwiftShader), `file://` navigation.
Before images: `debug/before/<circuit>_<view>.png`.

Views: **chase** (start line, 2.1 m up), **tv** (46 m broadcast, long lens),
**trackside** (1.55 m, 13 m from the white line), **aerial** (420 m over the
middle of the lap).

---

## What the before images actually show

### 1. The world ends at the track edge
The ground is a single flat box with a tiling grass texture. There is no
terrain relief, no verge, no infield detail. In `italy_tv` the "infield" is an
unbroken green plane with trees dotted on a regular-ish scatter; in
`italy_aerial` the whole circuit floats on a pastel field with a visible seam
where the run-off apron ends and the ground box begins.

### 2. Nothing is at human scale near the track
The barriers are the only trackside object, and they are a single flat ribbon
of concrete texture with no posts, no bolts, no Armco profile, no catch fence.
There are no marshal posts, no camera positions, no distance boards, no
billboards at ground level. `italy_chase` shows the consequence: a 500 m
straight bounded by two grey strips with an empty green field behind them.

### 3. Buildings are untextured white boxes
The pit building reads as two white cuboids with black rectangles cut into
them (`italy_chase`, `italy_tv`). No glazing, no team colours, no roof detail,
no garage interiors, no pit wall, no gantries, no start lights. The one
readable object on the whole start straight is the `ARAMCO` bridge board.

### 4. The asphalt is a single flat texture
One tiling aggregate map with a constant roughness. No macro variation, no
patches or repairs, no rubber line, no marbling, no camber or crown, no
painted grid boxes, no start/finish chequer, no braking boards on the
approach. Up close (`italy_chase`) it reads as grey noise; from above
(`italy_tv`) it reads as a flat grey ribbon.

### 5. Kerbs are flat painted strips
Red/white stripes on a flat ribbon at a constant 5 cm lift, on every corner.
Real Monza has raised, profiled kerbs at the chicanes and Lesmos, flat ones
elsewhere, and the paint is scuffed. There is no geometry to catch a shadow.

### 6. Trees are two primitives
Spheres on cylinders and cones. Same two variants everywhere in the world, at
roughly the same scale, with no LOD and no colour variation. Monza is a royal
park of plane trees and poplars; the render reads as a low-poly toy forest.

### 7. The sky is an empty gradient
A two-colour vertical gradient with no sun disc, no clouds, no horizon haze
and no distant backdrop. `italy_trackside` is 40 % empty pale sky. There is no
atmospheric perspective, so trees 400 m away are as saturated as trees 20 m
away.

### 8. The aerial shot is almost white
`italy_aerial` is dominated by fog: the fog near/far are computed from the
camera's far plane, and at 420 m the whole circuit is inside the fog band. The
scene's most impressive angle is currently unreadable.

### 9. Shadows are hard and unattached
One 2048 map over a 300 m box, `PCFSoft`, and nothing is snapped to texels, so
edges crawl. Objects have no contact shadow: the pit building and the trees
visibly float.

### 10. No post-processing at all
The image goes straight to the canvas. No bloom, no AO, no tone curve shaping,
no vignette, no AA beyond MSAA. Bright sky and mid-grey asphalt are compressed
into the same narrow band, which is a large part of why it looks flat.

### 11. No time-of-day or weather variation on the surface
Only the light and the sky colour change between `day`, `golden`, `night`.
The asphalt, grass and barriers are identical at noon in Monza and at night in
Singapore, and there is no wet look, no puddles, no reflections.

### 12. Landmark assets don't carry the circuit
Monza has `temple-of-speed`, `parabolica`, `monza-oval` in its feature list,
but none of them reads in any of the four shots. There is no oval banking
silhouette, no poplar avenue, no Italian colour. Swap the palette and the
circuit could be any of the other 23.

### 13. Draw-call and material budget is unmeasured
No overlay, no per-feature toggle, so there is no way to find what is
expensive. The whole world is built eagerly at load: every tree, every
grandstand, every distant prop is one merged mesh each with no culling.

---

## Fix list, in the order I'll do it

| # | Problem | Fix |
|---|---------|-----|
| 1 | Flat fog / white aerial | Rewrite the atmosphere: height fog, per-time-of-day tint, exposure, sky with sun disc + clouds, distant backdrop ring |
| 2 | No post FX | Post chain: bloom, AO, colour grade, vignette, SMAA — quality gated |
| 3 | Asphalt reads as noise | Layered procedural asphalt (macro + micro + normal + roughness), rubber line, marbling, camber |
| 4 | No markings | Marking system: edge lines, chequered start line, grid boxes, braking boards, DRS lines, pit markings |
| 5 | Flat kerbs | Profiled 3D kerbs, corner-dependent, scuffed paint |
| 6 | Hard shadows, floating props | Texel-snapped shadow frustum + tight fit, contact shadows, AO |
| 7 | Empty trackside | Barrier system (Armco + posts, TecPro, tyre walls, catch fence), marshal posts, cameras, boards |
| 8 | Toy trees, dead terrain | Terrain relief + vegetation system: 3 tree variants per biome, instanced, billboard LOD, grass tufts |
| 9 | White box buildings | Building kit: pit complex with glazing/team colours, grandstands with crowd, gantries |
| 10 | Monza isn't Monza | Per-circuit environment module: landmarks, palette, mood |
| 11 | No weather reaction | Wet surface pipeline: wetness, puddles, roughness drop, spray |
| 12 | No way to measure | Debug overlay: FPS, draw calls, tris, texture memory, feature toggles |

Work order: 1+2 (pipeline), 3+4+5 (surface), 6, 7+8+9 (trackside),
10 (Monza art pass), 11, 12, then re-shoot and compare.
