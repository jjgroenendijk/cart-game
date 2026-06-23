# 017 Ambient wildlife

Status: open (refined plan)

## Context

Split from 010 (was "ambient wildlife", `004:42`). Pure atmosphere decor:
instanced, non-interactive critters that animate the static 004 environment.
No gameplay, no colliders. 010 owns the time driver; this item is independent
of 010 (wildlife placement is terrain-seeded, not phase-driven in v1).

Today the world is static. Precedents to mirror: `Clouds` (instanced
`InstancedMesh` + seeded placement + group drift/wrap, `Clouds.ts:46-72`),
`PropField` (seeded terrain placement via `propSampler` corridor rejection +
full GL/body dispose, `PropField.ts:117-132,179-201`), and the seeded RNG
helpers (`rng.ts:58-84`, `hashSeed` for labeled sub-seeds).

Real constraints, resolved against the code:

- `Game.ts` is 600/600 lines. This item adds ZERO Game lines: wildlife is an
  `Environment` child driven by the existing `env.update(dt, time)` cascade
  (`Environment.ts:35`, `Game.ts:292`).
- Placement must keep the drivable corridor clear: reuse the `propSampler`
  corridor test (`propSampler.ts:14-15`, `closestPoint(x,z).dist`), the
  slope/spawn rejection shape, and `SamplerTerrain.heightAt`/`normalAt`
  (`propSampler.ts:9-16`).
- Determinism: single world seed; derive sub-seeds via
  `hashSeed("bird") ^ seed` etc. so species are reproducible (`rng.ts:77-84`).
  Same seed -> identical instance matrices (tested like `Clouds.test.ts`).
- Zero-asset policy: critters are procedural low-poly geometry, no textures.
- No Rapier bodies (non-interactive): strictly simpler than `PropField` — only
  GL resources to track and free on dispose.
- Tests run under jsdom with no WebGL: export the pure placement helper and
  assert it directly (mirrors `posterizeChannel`, propSampler exports).

## Goal

Ambient non-interactive critters that drift/fly over the world:

- Instanced critters (birds in v1): procedural geometry, seeded placement on
  the terrain + a sky band, corridor-aware so the track stays clear.
- Per-frame motion: flock/drift + wrap (reuse the `Clouds` group-drift shape),
  no colliders, no gameplay effect.

## Non-goals

- Interactive/huntable/fishable wildlife (ambient only).
- Colliders or physics response (kart passes through).
- Species modeling beyond simple birds (one species in v1; extensible).
- Phase coupling (v1 placement ignores 010 day cycle; per-phase activity is a
  later soft tie).
- Sound (no bird calls; 005 owns audio).

## Architecture (new)

```text
src/environment/
  wildlife.ts        # PURE placeWildlife(rng, terrain, opts)->Matrix4[]:
                     #   jittered grid + corridor/slope/spawn rejection
                     #   (mirrors propSampler). Seeded sub-seeds per species.
                     #   Exported for jsdom unit tests (no WebGL).
  Wildlife.ts        # Environment child. InstancedMesh (layer 0, cel +
                     #   outline like props), seeded placement via
                     #   placeWildlife. update(dt,time): group drift + wrap
                     #   (Clouds.ts:69-72 shape) + gentle wing/alt jitter.
                     #   dispose(): free geometry/material/InstancedMesh +
                     #   setMatrixAt reset; idempotent (PropField dispose
                     #   guard pattern, PropField.ts:117-132).
src/environment/
  Environment.ts     # construct Wildlife child + cascade update/dispose.
                     # ~46 lines now, ample headroom.
```

## Contracts with 001-009

- 001: critters on layer 0 get cel + inverted-hull outline like props
  (`src/AGENTS.md` layer 0). Verify outline reads on small instanced meshes.
- 003: placement queries `heightAt`/`normalAt` (`Terrain.ts:74-87`).
- 004: new `Environment` child; Clouds/Water/PropField unchanged. Mirrors
  `PropField` placement + `Clouds` motion precedents.
- 010: independent in v1 (no phase read). 014 (clouds) independent.
- All others: none (decor only, no physics/audio/UI).

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(world): pure seeded wildlife placement`
   - `wildlife.ts`: `placeWildlife` (jittered grid + corridor/slope/spawn
     rejection via `SamplerTerrain`); sub-seed derivation via `hashSeed`.
   - tests: same seed -> identical matrices; corridor cells rejected; output
     count respects opts caps; slope/spawn rejection gates fire.
2. `feat(world): Wildlife instanced critters + drift`
   - `Wildlife.ts` child; InstancedMesh layer 0 from `placeWildlife`;
     `update(dt,time)` group drift + wrap + jitter; dispose frees resources.
   - tests: instance count + layer bits; drift advances + wraps; dispose
     idempotent + frees geometry/material; determinism from seed.
3. `docs: refine 017 plan + todo + README`
   - mark 017 full plan in `docs/todo.md`; README project structure adds new
     files.

## Risks

- Game.ts 600/600: zero new lines (Environment child + cascade only).
- Corridor leakage: if rejection is loose, critters sit on the racing line.
  Reuse the exact `propSampler` corridor distance threshold; add a margin.
- Instance count vs 011 perf budget: cap critters (e.g. ~24, like Clouds);
  cross-ref 011.
- Outline on tiny meshes can shimmer; tune instance scale in review.
- Determinism: never mutate matrices outside `placeWildlife` + deterministic
  drift; seeded RNG only (`rng.ts`), no `Math.random` in placement.
- Strict TS noUnusedLocals: all pure-fn params used; `_`-prefix unused.

## Acceptance

- [ ] `wildlife.ts` present; `placeWildlife` pure + tested
- [ ] Instanced critters render on layer 0 with cel + outline
- [ ] Placement clears the drivable corridor (sample assertion)
- [ ] Drift/wrap motion runs; same seed -> identical matrices
- [ ] `dispose()` frees GL resources + is idempotent
- [ ] `Game.ts` unchanged in line count
- [ ] `npm run typecheck && lint && test` green; pre-commit hook green
- [ ] No black screen at `npm run dev`; visual verify logged in
      `docs/troubleshooting/`

## Defaults

- species: birds (one species v1); ~24 instances (Clouds parity)
- placement: jittered grid over world bounds, corridor margin + slope/spawn
  rejection (propSampler parity); some on a sky altitude band, some near
  terrain
- motion: group drift + wrap (Clouds shape) + small wing/alt jitter
- seed: `hashSeed("wildlife") ^ baseSeed`; sub-seeds per later species

## Previous implementation

None. Closest patterns: `Clouds.ts:46-72` (instanced + seeded + drift/wrap),
`PropField.ts:117-132,179-201` (seeded terrain placement + dispose),
`propSampler.ts:9-16` (corridor/slope/spawn rejection), `rng.ts:58-84`.

## Depends on

000 (harness; test gate live). 003 (heightAt/normalAt for placement). 004
(Environment child pattern + seeded placement precedent). Independent of 010
in v1. 011 (perf budget) cross-ref.
