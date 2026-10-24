F1 2026 - 3D CAREER RACING GAME
================================

An offline Formula 1 racing game. No install, no server, no internet.
Double-click index.html and it runs (Chrome, Edge, Firefox, Safari - anything
with WebGL2). Everything you see and hear is generated in code: cars are
geometry plus canvas-painted liveries, circuits are built from real centrelines,
and all audio is synthesised with the Web Audio API. No image, model or sound
files are included.

Folder: 75 files, 1.7 MB on disk / 1.54 MB of file content
         (budget: 40 MB target, 128 MB hard limit).
Saves:   localStorage under the f1_2026_ prefix, with JSON export/import.


HOW TO PLAY
-----------
1. Unzip the folder anywhere, keeping the structure.
2. Double-click index.html.
3. Choose a mode with the mouse or the arrow keys and Enter.


MODES
-----
Career        Create a driver or take a real seat; contracts, credits, R&D,
              driver market, three save slots, JSON export/import.
Quick Race    One circuit, one grid, any car, from 3 laps up.
Time Trial    Three solo laps per circuit, personal bests per circuit, and a
              translucent ghost of your best lap in that car.
Championship  Any driver, any subset of the 22 rounds, sprint points on/off,
              drivers' and constructors' tables. Race or simulate each round.
Garage        Inspect the 11 cars, change livery, read specs.
Grid          22-round calendar (24 with the cancelled rounds enabled), each
              circuit with flyover, orbit and trackside cameras.
Settings      Graphics, audio, assists, units, controls, display, saves.

Weekend:  FP1/FP2/FP3 -> Q1/Q2/Q3 -> Sprint (6 rounds) -> Grand Prix with a
formation lap and start lights. Race control runs yellow, VSC, safety car, red
and blue flags; track limits give warnings and five-second penalties; the pit
lane is a real corridor with an 80 km/h limit.

Points:   GP 25-18-15-12-10-8-6-4-2-1.  Sprint 8-7-6-5-4-3-2-1.
          No fastest-lap point (2026 regulations).


KEYBOARD CONTROLS
-----------------
W / S  or  Up / Down      throttle / brake
A / D  or  Left / Right   steer left / right
E / Q  (Shift / Ctrl)     gear up / down
Space                     boost / overtake
F                         ERS mode
B                         brake balance
P                         pit request
[ / ]                     pit tyre compound
C                         camera
X                         look back
R                         reset car to the track
H                         cycle HUD layout
T                         replay
V                         photo mode (drag to orbit, W/S to move, saves a PNG)
Esc                       pause
M                         mute / unmute (remembered)
F3                        performance overlay

GAMEPAD (standard mapping)
Left stick steers, RT throttle, LT brake, LB/RB assist throttle/brake,
A boost, X overtake, B radio, Y camera, Start pause, D-pad up/down gears.


FOLDER STRUCTURE
----------------
index.html            boot + script order (classic scripts only, file:// safe)
main.js               entry point and global hotkeys
lib/three.min.js      Three.js r158 UMD (MIT)
css/ui.css            menu, garage, career, time trial, championship screens
css/hud.css           broadcast HUD
core/                 utils, settings, storage, input, renderer, audio, app shell
data/                 teams (11), drivers (22), sponsors, calendar, 24 circuits
world/                procedural car, showroom, environment, track scenery, weather
physics/              track builder, tyre model, vehicle dynamics, cameras
ai/                   driver profiles + Stanley-style controller
game/                 session, 21-car field, race control, pit lane, weekend,
                      replay, career, championship
ui/                   menu, garage, grid, quick race, weekend, career, time trial,
                      championship, settings, HUD
tools/                dev-only track generators and preview pages (not used at runtime)

Load order in index.html matters: core -> data -> world -> physics -> ai ->
game -> ui -> core/app.js -> main.js.


SIZE BUDGET
-----------
lib/ (Three.js r158 UMD)                       640 KB
data/ (24 circuits, teams, drivers, sponsors)  284 KB
world/                                         156 KB
game/                                          148 KB
ui/                                            144 KB
physics/                                        76 KB
css/                                            68 KB
core/                                           68 KB
ai/                                             16 KB
tools/ (dev only)                               56 KB
root files (index.html, main.js, docs)          60 KB
------------------------------------------------------
TOTAL (75 files, excluding .git)             1.7 MB on disk

Largest single file: lib/three.min.js, 637 KB.
Every circuit file is under 20 KB.


CIRCUIT ACCURACY
----------------
Every lap length is within 0.12 % of the real figure (worst: Austria,
4313 m built vs 4318 m real). Sixteen centrelines are imported from the
TUMFTM racetrack-database (surveyed x/y/width) and tagged ACCURATE. Eight
circuits have no surveyed public data: they are hand-traced from official
corner diagrams, match the real length and corner order, but individual radii
are best effort. Those files start with an "APPROXIMATE" comment and are
tagged APPROXIMATE in game.

 #   Circuit                      Length    Geometry
 1   Australia (Albert Park)       5 278 m  ACCURATE
 2   China (Shanghai)              5 451 m  ACCURATE   sprint
 3   Japan (Suzuka)                5 807 m  ACCURATE
 4   Bahrain                       5 412 m  ACCURATE   cancelled IRL, off by default
 5   Saudi Arabia (Jeddah)         6 174 m  APPROXIMATE cancelled IRL, off by default
 6   Miami                         5 412 m  APPROXIMATE sprint
 7   Canada (Montreal)             4 361 m  ACCURATE   sprint
 8   Monaco                        3 337 m  APPROXIMATE
 9   Spain (Barcelona)             4 657 m  ACCURATE
10   Austria (Spielberg)           4 318 m  ACCURATE
11   Great Britain (Silverstone)   5 891 m  ACCURATE   sprint
12   Belgium (Spa)                 7 004 m  ACCURATE
13   Hungary                       4 381 m  ACCURATE
14   Netherlands (Zandvoort)       4 259 m  ACCURATE   sprint
15   Italy (Monza)                 5 793 m  ACCURATE
16   Spain (Madrid / Madring)      5 474 m  APPROXIMATE
17   Azerbaijan (Baku)             6 003 m  APPROXIMATE
18   Singapore                     4 940 m  APPROXIMATE night race
19   United States (Austin)        5 513 m  ACCURATE
20   Mexico                        4 304 m  ACCURATE
21   Brazil (Interlagos)           4 309 m  ACCURATE
22   Las Vegas                     6 201 m  APPROXIMATE night race
23   Qatar (Lusail)                5 419 m  ACCURATE   sprint
24   Abu Dhabi (Yas Marina)        5 281 m  ACCURATE

Bahrain and Saudi Arabia were removed from the real 2026 calendar. They ship
disabled; enable "Include cancelled rounds" in Settings -> Gameplay to add them
to quick races, championships and careers.


CREDITS AND LICENSING
---------------------
Three.js r158 (UMD build) - MIT, (c) 2010-2023 Three.js authors. The licence
header is kept at the top of lib/three.min.js.

TUMFTM racetrack-database - the 16 surveyed centrelines are derived from it.
(c) Technical University of Munich, LGPL-3.0. The derived centreline data in
data/circuits/<id>.js is therefore distributed under the same licence.
Source: https://github.com/TUMFTM/racetrack-database

All other code, geometry generation, liveries and audio are original.
No official Formula 1, FIA, team or sponsor logos, fonts, images or audio are
included. Team and driver names are used factually; sponsor marks are stylised
shapes and text, not trademarks.


KNOWN LIMITATIONS
-----------------
- The AI is clean on 21 of 24 circuits; at Monaco the Rascasse hairpin
  occasionally draws a barrier touch.
- Field pace is about 20 % off real qualifying times - the tyre model, not the
  AI profile, is the limit.
- APPROXIMATE circuits have the right length and corner order but simplified
  radii.
- Cars are intentionally low-poly procedural models.

See BUILD_LOG.md for the development record and PROJECT_PLAN.md for the
milestone map.
