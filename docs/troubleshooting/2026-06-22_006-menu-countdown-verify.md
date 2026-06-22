# 2026-06-22 006 menu + countdown verify

006 start menu + countdown + game state machine. Verify path + a latent
004 crash surfaced by the full menu->race flow.

## Scope

Verified on the dev server (`npm run dev`) with Chrome DevTools MCP after
all 006 commits landed. Prior items 001-005 are in `pending-review/`; 006
is the first item to drive the whole menu->countdown->race flow on screen,
so it is the first to exercise the render path end-to-end with the overlays.

## Result

Menu -> countdown -> race flows; HUD shows only in racing; kart drives
under throttle; audio is gestured on Start. No black screen.

Steps + observations:

- Boot: `#loading` hides, StartMenu overlay renders (animated "GAME CART"
  h1, START button, controls list). `__game.currentState === "menu"`.
  HUD display `none`.
- Click START (gesture): `audio.resume()` builds the ctx (`isGestured`
  true), state -> `countdown`, StartMenu hidden, Countdown shown.
  Beeps fire on each phase change (3/2/1 = beep, GO = go).
- After ~2.85s: Countdown `update()` returns `done`, state -> `racing`,
  Countdown hidden, `audio.setEngineActive(true)`, HUD display `block`.
- Throttle (KeyW) in racing: kart speed climbs (e.g. 13 -> 27 m/s over
  ~0.6s), so input + physics + chase camera are live. MenuCamera is not
  used after race start.
- dispose path unit-tested (StartMenu + Countdown + HUD detach).

Out of scope (non-goals per plan): pause/settings, track/kart select,
gamepad menu nav, camera blend/handoff, traveling flyover.

## Issue found: CelWaterMaterial USE_FOG crash (latent 004 bug)

Symptom: on first dev-server load, the console flooded with
`THREE.WebGLProgram: Shader Error ... 'fogNear' : undeclared identifier`
followed by `Uncaught TypeError: Cannot read properties of undefined
(reading 'value')` every frame at `Renderer.ts` `composer.render()`.

Root cause: `CelWaterMaterial` (004) is a custom `THREE.ShaderMaterial`
with `fog: true`. For a raw ShaderMaterial three.js defines `USE_FOG` but
does NOT inject the `fogColor/fogNear/fogFar` declarations (those come
from `#include <fog_pars_fragment>` for built-in materials only). The
manual `#ifdef USE_FOG` block referenced undeclared uniforms -> the water
shader failed to compile -> the program was invalid -> uniform upload
threw each frame.

Why it broke 006 specifically: the throw is inside `composer.render()`,
which sits mid-`Game.frame`. The per-frame throw aborted the composer
(near-black / broken 3D bg) AND skipped every line after `render()`:
HUD visibility, `audio.update`, `env.update`, `input.endFrame`. So the
HUD never showed in racing even though the state machine was correct.
Latent since 004; only surfaced now because 006 is the first item to
run the full flow on screen. 004/005 had deferred visual verify.

Fix (separate `fix` commit): declare `fogColor/fogNear/fogFar` in the
fragment (guarded by `USE_FOG`) and add matching uniform entries; the
renderer pushes scene-fog values into them each frame. The manual fog
mix block is unchanged, so 004's `Water.test` (asserts the fog block
source) still passes.

Lesson: a ShaderMaterial that opts into `fog: true` must declare the fog
uniforms itself (or `#include` the fog chunks); three.js only auto-injects
them for ShaderLib-based materials. Worth a lint-style note if more cel
materials add fog later.

## Verify limitations

- Full audible verify (engine/drift/wind/beep quality) is subjective and
  deferred to the review pass; the wiring is asserted by unit tests
  (resume on Start, setEngineActive toggling, uiBeep kinds) and the
  gesture path is confirmed live (`isGestured` true after START).
- Pixel-sample fallback (per `2026-06-20_visual-verification-fallback.md`)
  was not needed: the live dev-server flow rendered correctly once the
  celWater crash was fixed.

## Settlement deviation from plan

Plan said "zero linvel each countdown step". Implemented as zero XZ linvel
only (keep Y). Rationale: zeroing all linvel each step wipes the downward
velocity from gravity, so the kart hovers at spawn clearance and then
lurches on GO (the opposite of the plan's stated goal). Keeping Y lets it
fall + settle onto the surface while XZ stays at spawn. Verified: kart
rests near spawn XZ entering racing.
