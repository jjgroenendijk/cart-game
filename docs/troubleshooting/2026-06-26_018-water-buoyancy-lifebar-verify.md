# 018 water buoyancy + life bar — verify log

Date: 2026-06-26
Item: 018 (water buoyancy + life bar)
Status: code-verified; live visual verify deferred to review

## Scope

Water was visual-only (004 plane): karts drove through valleys under the
surface. 018 makes water a forgiving arcade hazard: buoyancy (upward impulse
proportional to submerged depth + XZ drag) + a blue per-human life bar that
drains while submerged and recovers out of water. Empty bar -> respawn
spline-ahead (`respawnAhead`) + life reset, for humans AND rivals. Buoyancy is
inert unless a `waterLevel` is passed (backward compatible).

## Commits (each atomic + green)

1. `feat(kart): pure buoyancy + life-delta helpers` — `buoyancy.ts` +
   tests (`buoyancyForce`, `lifeDelta`, `clampLife`, `DEFAULT_BUOYANCY`,
   `DEFAULT_LIFE`).
2. `feat(kart): apply buoyancy + gated life drain in fixedUpdate` —
   KartController + Kart: optional `waterLevel` param (disabled default);
   `applyBuoyancy` after suspension; `inWater`/`life` tracking; `resetLife`;
   `fixedUpdate(dt, input, drainLife=false)`. + tests. Root AGENTS.md Runtime
   Flow refreshed (governance 1000-LOC reset).
3. `feat(ui): blue life bar bound per view` — `LifeBar.ts` + tests
   (`update(life, inWater)`, `setAnchor`, `remove`).
4. `feat(core): wire buoyancy + life into FieldBuilder/PlayerView/Game` —
   FieldBuilder passes `terrain.waterLevel` into every Kart, builds a LifeBar
   per human into PlayerView, drains life only while driving
   (`fixedUpdate(step, inp, driving && !finished)` for humans, `driving` for
   rivals), and respawns-ahead + resets life on empty. PlayerView gains
   `setLife` + `repositionLife`; Game.frame `updateLifeBars` + onResize
   reposition. + tests.
5. `docs: refine 018 plan + todo + README + troubleshooting` — this file,
   task move to pending-review, todo + README.

## Code-verified (this pass)

- `src/kart/buoyancy.ts` present (PURE, WebGL-/Rapier-free, jsdom-testable).
  `buoyancyForce(depth, opts)`: depth<=0 -> `{up:0,drag:1}`; else linear
  `floatStrength*clamp(depth,maxDepth)` with `drag=dragFactor`.
  `DEFAULT_BUOYANCY = {floatStrength:60, maxDepth:1.0, dragFactor:0.85}`:
  at maxDepth `up`≈60 > gravity impulse (mass*g*dt = 260\*9.81/60≈42.5) so the
  kart floats strong when deep, partial near the surface. `lifeDelta` drains
  at `1/7`/s submerged, recovers at `0.5`/s out. `clampLife` -> [0,1].
- `src/kart/KartController.ts` (322 -> 373): optional trailing `waterLevel`
  ctor param (null = disabled, backward compatible). `fixedUpdate(dt, input,
drainLife=false)` calls `applyBuoyancy` after suspension: upward impulse at
  the chassis point + XZ linvel scaled by drag (Y untouched); `inWaterState`
  - `lifeValue` updated (drain only when `submerged && drainLife`, recover
    when out of water). `get life()`/`get inWater()`; `resetLife()`; `respawn()`
    also resets life. NO self-respawn on empty (FieldBuilder owns fail-out).
- `src/kart/Kart.ts` (183 -> 184): forwards `waterLevel` + `drainLife`.
- `src/ui/LifeBar.ts` present (80 lines): blue gradient fill, dark track,
  `update(life,inWater)` sets width % + toggles display, `setAnchor` +
  `remove`. Follows the RaceHud DOM pattern.
- `src/core/FieldBuilder.ts` (394 -> 418): humans + rivals constructed with
  `this.terrain.waterLevel`; one `LifeBar` per human into `PlayerView`
  (`LIFE_BAR_TOP_OFFSET=108`). `stepWorld` passes `driving && !finished`
  (humans) / `driving` (rivals) as `drainLife`; after each kart's step,
  `life<=0` -> `respawnAhead(kart)` + `resetLife()` (humans + rivals).
- `src/core/PlayerView.ts` (115 -> 135): required `lifeBar` ctor param,
  `setLife(life, inWater)`, `repositionLife(left, top)`, `removeHud()` now
  also removes the life bar.
- `src/core/Game.ts` (450 -> 464): `updateLifeBars()` in the racing frame
  block (between speed HUDs and race UI); onResize repositions the life bar
  like the speed element.
- Gate: typecheck + eslint + markdownlint + prettier + secretlint + pre-commit
  all green. 818 tests (new: buoyancy 9, KartController buoyancy +5, LifeBar
  7, FieldBuilder water wiring 3). Existing Game/PlayerView tests unchanged
  (PlayerView.test tests only the pure `viewHudAnchor`).
- Production build: `npm run build` (tsc --noEmit + vite build) succeeds; only
  the pre-existing chunk-size warning (unrelated).

## Deferred to review

- Live visual verify: no browser canvas in this env. Reviewer should
  `npm run dev`, Start, race into a valley lake, and confirm:
  - kart floats (does not sink through the floor of the valley); strong
    upward push when deep, partial near the surface;
  - horizontal speed drops while submerged (slow paddle-out, not stuck);
  - blue life bar appears per human only while in water, drains while
    submerged, refills after leaving the water;
  - empty bar -> kart respawns spline-ahead (above water) and the bar resets;
  - no drain during countdown (bar holds); drain on while racing; 1P + 2P
    each get their own bar in their viewport half;
  - rivals that enter water also float + auto-respawn-ahead on empty (no
    bar); no respawn thrash loop.
- No-black-screen: build is green (strong proxy); buoyancy adds impulse +
  drag inside the existing fixed step, render path (composer/layers)
  untouched.

## Notes

- Fixed-step only: buoyancy uses `STEP` (1/60), never variable dt.
- `waterLevel` defaults to null (disabled) -> every existing KartController
  caller (003 respawn tests, etc.) is bit-identical; buoyancy is opt-in via
  FieldBuilder passing `terrain.waterLevel` (-3).
- Fail-out reuses `respawnAhead` (no new checkpoint pose; 006/007 precedent)
  so humans + rivals share one helper; `gameAudio.onRespawn()` fires on water
  fail-out (consistent with the AI-stuck + manual-reset paths).
- Wave `uTime` is intentionally ignored (static `waterLevel`, per non-goals).
- Drain rate (`1/7`/s, ~7s to empty) tuned forgiving; recover (`0.5`/s, 2s)
  so a quick splash never costs the bar. Adjustable in review.
