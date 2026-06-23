# 2026-06-23 008 split-screen verify

008 local 2-player split-screen. Verify the multi-view render path + per-
player HUD/audio/wiring on the dev server after all 008 commits landed.

## Scope

Verified on the dev server (`npm run dev`) with Chrome DevTools MCP after
the 8 008 commits. 001-007 are in `pending-review/`. 008 is the first item
to drive `Renderer.renderViews` (two EffectComposers + scissor/viewport)
and the per-player voice graph on screen.

## Result

Menu renders the 3D scene; 2P toggle -> START -> countdown -> split-screen
race. Two stacked viewports, two HUDs (speed + lap/pos/timer), two distinct
positions, shared seam minimap. Audio gestured on Start. No black screen.
1P path unchanged.

Steps + observations:

- Boot: `#loading` hides, StartMenu renders (animated "GAME CART" h1, a
  "1 PLAYER" mode toggle, START button, controls list). Default mode 1P.
  Screenshot confirms the cel-shaded track (sky, terrain, dirt path,
  props, karts on the grid) renders behind the overlay — not black.
  `getContext('webgl2')` is live; canvas is 2402x1318.
- WebGL readPixels returns `[0,0,0,0]` outside the render loop — expected:
  `preserveDrawingBuffer` defaults false, so the buffer is cleared after
  composite. The screenshot (analyzed, not readPixels) is the real signal.
- Toggle "1 PLAYER" -> "2 PLAYERS": controls list grows a "P2: Arrows"
  row + "ShiftRight / Enter" drift line.
- Click START (gesture): `audio.resume()` builds the ctx with
  `humanCount=2` (set in onStart before resume), so 2 StereoPanner voices
  (P1 pan -1, P2 pan +1) + shared wind are built. `isGestured`/`isRunning`
  true. State -> countdown, StartMenu hidden.
- After countdown: state -> racing, `renderViews` drives two composers
  (top half P1, bottom half P2), each a fullscreen-triangle composite in
  its scissor rect. `autoClear=false` so the two halves do not erase each
  other.
- Screenshot of the racing frame confirms the split: top + bottom halves
  each show a different chase-camera view; each half has its own speed
  readout + "LAP 1/3" + a distinct position (P1 POS 5/6, P2 POS 6/6) +
  the shared timer. One minimap centered on the seam (not two).
- No console errors/warnings across the flow.

## Notes / handoffs

- Two EffectComposers double post-process RT memory (each half-height ~
  the same total as one full-screen composer). Desktop-safe; flag for 011
  (LOD/perf) along with the scissor/viewport cost.
- Shadow frustum is +/-80m; the shadow target is the humans' midpoint, so
  if the two humans drift >160m apart one loses shadows. Acceptable v1.
- Basic per-player pan (StereoPanner) landed here. 009 keeps positional/3D
  pan, doppler, and the music bed; the 009 sketch notes the handoff.
- Top/bottom view aspect (w / h/2) is wider; per-view `setAspect` is set
  from `rectAspect` on build + resize. FOV tuning deferred (felt OK).
