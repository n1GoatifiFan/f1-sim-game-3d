# F1 2026 — 3D Career Racing Game

An offline, double-click-to-play Formula 1 game built with Three.js (no build step,
no server, no internet at runtime).

**Status:** Section 1 of 7 complete — engine shell, 2026 grid data, procedural car,
main menu, Garage, Grid, circuit browser and Settings. See `PROJECT_PLAN.md` for the
section map and `BUILD_LOG.md` for what works today.

## Play

Open `index.html` in Chrome, Edge or Firefox (double-click it — `file://` is supported).
The full `README.txt` (controls, structure, size budget, ACCURATE vs APPROXIMATE
circuits) ships with Section 7.

## Structure

```
index.html          boot + script load order (classic scripts only)
lib/                three.min.js (r158 UMD, vendored)
css/                ui.css (+ hud.css from Section 3)
core/               utils, settings, input, renderer, app shell
data/               teams, drivers, sponsors, circuits (metadata)
world/              procedural car model, showroom; environments from Section 2
physics/ ai/ game/  vehicle, AI, race flow (Sections 3–5)
career/             career simulation (Section 6)
audio/              Web Audio synthesis (Section 7)
ui/                 screens + HUD
tools/              dev-only generators/preview pages (not shipped at runtime)
```
