# 017 ambient wildlife — verify log

Date: 2026-06-26
Item: 017 (ambient wildlife)
Status: code-verified; live visual verify deferred to review

## Scope

Ambient, non-interactive critters that animate the static 004 environment.
Instanced low-poly bird silhouettes on layer 0 (flat-shaded cel, NO outline),
seeded placement split across a sky altitude band (high, wide orbits) and a
ground band (terrain-hugging, tight orbits), corridor/slope/spawn cleared.
Per-frame motion is a pure deterministic fn of absolute time (seeded
elliptical orbit + sinusoidal altitude bob); no colliders, no gameplay effect,
no day-cycle coupling in v1.

## Commits (each atomic + green)

1. `feat(world): pure seeded critter placement + orbit pose` — `critters.ts`
   - tests.
2. `feat(world): Wildlife instanced critters on orbital paths` — `Wildlife.ts`
   - tests.
3. `feat(world): wire Wildlife into Environment cascade` — `Environment.ts`
   edits + test.
4. `docs(agents): refresh env node + note critters helper` — governance reset
   (root Runtime Flow was stale; missing 010/014 weather/sun).
5. `docs: log 017 verify + README` — this file + task move.

## Code-verified (this pass)

- `src/environment/critters.ts` present (PURE, WebGL-free). `placeCritters`
  runs a jittered grid with corridor/slope/spawn/bounds rejection; single
  sub-seeded RNG `makeRNG((seed ^ hashSeed("critter")) >>> 0)`; sky vs ground
  altitude bands (sky baseY height+20..34, radius 10..18; ground baseY
  height+1.5..3.5, radius 3..6). `critterPose` is a pure fn of (placed, t):
  inclined orbit (radius*sinA*tilt) + alt bob (altAmp*sin(altFreq*t+phase)),
  tangent yaw (angle+PI/2). Same seed -> identical field; same (p,t) ->
  identical pose. No `Math.random`.
- `src/environment/Wildlife.ts` present. One flat-shaded `CelMaterial`
  `InstancedMesh` of a 4-vertex flat bird silhouette (forward +Z) on layer 0,
  castShadow/receiveShadow false, NO outline child (group.children.length === 1
  — inverted-hull shader has no instance-matrix path; Clouds/decor parity).
  Constructor seeds t=0 matrices; `update(_dt, time)` recomputes every matrix
  via `critterPose(time)` -> motion is a pure fn of absolute time.
  `dispose()` frees geo+material, guarded flag + idempotent.
- `Environment.ts` (80 -> 88 lines): constructs `Wildlife(terrain, opts)` from
  the terrain it already holds, appends its group LAST (index 6; indices 0-5
  stay stable so the SunDisc children[4] + clouds groups[1] tests hold),
  cascades `update(dt, time)`, disposes. `EnvironmentOptions.wildlife?` added.
- `Game.ts` line count UNCHANGED (Environment owns the cascade; children
  self-seed like Clouds). Acceptance: no Game edit.
- Gate: typecheck + eslint + markdownlint + prettier + secretlint + pre-commit
  all green. 794 tests (new: critters 13, Wildlife 7, Environment cascade +1).
- Production build: `npm run build` (tsc --noEmit + vite build) succeeds; only
  the pre-existing chunk-size warning (unrelated).

## Deferred to review

- Live visual verify: no browser canvas in this env. Reviewer should
  `npm run dev`, Start, race, and confirm:
  - dark bird blobs are visible against sky/terrain (read as birds, not dots);
  - sky-band birds circle high on wide orbits; ground-band birds hug terrain;
  - motion is smooth (no wrap-pop) and deterministic (same spot each replay);
  - no bird clips the kart path badly enough to read as a collision (no
    colliders by design; kart passes through);
  - draw-call budget: one extra instanced draw call (011 parity, <=24 default).
- No-black-screen: build is green (strong proxy); Environment wiring adds one
  child + one update line, render path (composer/layers) untouched.

## Notes

- One species (birds) in v1; extensible (band + per-instance seed ready for
  later species). Boids/flocking + wing-flap + sound + day-cycle activity tie
  are explicit non-goals (deferred).
- `critters.ts` reuses the `SamplerTerrain` type from `propSampler` (type-only
  import; no runtime coupling).
- AGENTS.md refreshed (governance counter reset): root Runtime Flow env node
  now lists the real children (props, clouds, water, sky, sun, weather).
