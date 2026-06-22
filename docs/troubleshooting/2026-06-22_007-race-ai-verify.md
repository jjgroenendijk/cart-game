# 2026-06-22 007 race + AI verify

007 Track 01 race + AI opponents. Verify path for the full race flow
(menu -> countdown -> race vs 5 AI rivals) after all 007 commits landed.

## Scope

Verified on the dev server (`npm run dev`) with Chrome DevTools MCP.
Prior items 001-006 are in `pending-review/`; 007 is the first to stage
a multi-kart grid, drive AI rivals, and run the race manager + overlays.

## Result

Menu -> countdown -> race flows; RaceHud (lap/pos/timer) + Minimap show
only while racing; 5 AI rivals drive off the grid under pure-pursuit; no
black screen; no JS errors. P1 starts on pole but with no keyboard input
it falls to POS 6/6 as the rivals overtake (expected).

Steps + observations:

- `npm run typecheck && npm run lint && npm test`: green (333 tests).
- `npm run build`: bundles clean (56 modules, no errors).
- Boot: `#loading` hides, StartMenu renders ("GAME CART", START).
  Page-title set; no console errors.
- Pixel-sample (fallback per `2026-06-20_visual-verification-fallback.md`):
  the WebGL canvas has `preserveDrawingBuffer` off, so a 2d drawImage
  downscale -> getImageData reads all-black (artifact, NOT a black
  screen). Cross-checked via the DevTools screenshot: menu frame PNG is
  ~1.50 MB and the race frame PNG ~0.86 MB for 2402x1318 -> high-entropy
  real scene (a black screen compresses to a few KB). Rendering healthy.
- Click START -> countdown -> race. RaceHud reads `LAP 1/3`, `POS 6/6`,
  timer advancing; `#hud-speed` present; `.gc-minimap` displayed with a
  160x160 canvas; `.gc-race-hud` present.
- Only console error during the run: `GET /favicon.ico -> 404` (vite
  ships no favicon; pre-existing, unrelated to 007).

## Notes / OWED

- AI driving line + overtaking feel not frame-by-frame inspected; pure
  unit tests (AiDriver) cover steer sign, throttle easing, avoidance,
  stuck reset, determinism. In-browser lap completion + finish overlay
  not driven to completion (needs sustained input); covered by
  raceManager unit tests (finish fires once, freezes).
- Rubber-band + closestPoint cost: desktop-safe at 6 karts (~6
  O(samples) closestPoint scans / sub-step). 011 owns the LOD/perf
  budget for higher counts.
- Leader-finish can end the race before a trailing human completes their
  laps (documented design choice per 007 plan; switchable later).
