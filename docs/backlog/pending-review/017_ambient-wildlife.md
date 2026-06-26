# 017 Ambient wildlife

Status: implemented (pending-review)

## Context

Split from 010 (was "ambient wildlife", `004:42`). Pure atmosphere decor:
instanced, non-interactive critters that animate the static 004 environment.
No gameplay, no colliders. 010 owns the time driver; this item is independent
of 010 in v1 (wildlife placement + motion are seed-driven, not phase-driven).

Today the world is static. Precedents to mirror: `Clouds` (instanced
`InstancedMesh` + seeded placement, `Clouds.ts:39-66`), `PropField` (seeded
terrain placement via `propSampler` corridor rejection + full GL/body dispose,
`PropField.ts:143-160` dispose guard, `:265-284` instanced decor), and the
seeded RNG helpers (`rng.ts:58-70` makeRNG, `:77-84` hashSeed for labeled
sub-seeds).

Real constraints, resolved against the code:

- `Game.ts` is 443/600 (the 012 FieldBuilder refactor freed ~157 lines). This
  item still adds ZERO Game lines by design: wildlife is an `Environment`
  child driven by the existing `env.update(dt, time)` cascade
  (`Environment.ts:56`, `Game.ts:215`). No Game edits are required —
  `Environment` constructs children from their own default seeds (cf. `Clouds`,
  `Clouds.ts:54`) and already holds the `terrain` (`Environment.ts:35`) it
  passes to terrain-aware children like `PropField`.
- Placement must keep the drivable corridor clear: reuse the `propSampler`
  corridor test (`propSampler.ts:135-136`, `closestPoint(x,z).dist`), the
  slope/spawn rejection shape, and `SamplerTerrain.heightAt`/`normalAt`
  (`propSampler.ts:9-16`).
- Determinism: single world seed; derive sub-seeds via
  `hashSeed("critter") ^ seed` etc. so species are reproducible (`rng.ts:77-84`).
  Same seed -> identical placement AND identical motion at a given time (the
  pose is a pure fn of time, not mutable matrix state).
- Zero-asset policy: critters are procedural low-poly geometry, no textures.
- No Rapier bodies (non-interactive): strictly simpler than `PropField` — only
  GL resources to track and free on dispose.
- Tests run under jsdom with no WebGL: export the pure placement + pose helpers
  and assert them directly (mirrors `propSampler` exports, `posterizeChannel`).

## Goal

Ambient non-interactive critters that fly over the world:

- Instanced critters (birds in v1): procedural geometry, seeded placement on
  terrain-conforming anchors split across a sky band and a ground band,
  corridor-aware so perches/anchors stay off the racing line.
- Per-frame motion: each critter flies a seeded orbital path (elliptical orbit
  - sinusoidal altitude bob); the pose is a deterministic pure fn of time. No
    colliders, no gameplay effect, no wrap-pop.

## Non-goals

- Interactive/huntable/fishable wildlife (ambient only).
- Colliders or physics response (kart passes through).
- Boids/flocking (v1 = per-instance independent orbits; extensible later).
- Species modeling beyond simple birds (one species in v1; extensible).
- Phase coupling (v1 ignores the 010 day cycle; per-phase activity is a later
  soft tie).
- Wing-flap animation (deferred; needs a second mesh or vertex anim).
- Sound (no bird calls; 005 owns audio).

## Architecture (new)

```text
src/environment/
  critters.ts        # PURE placeCritters(terrain, opts)->PlacedCritter[]:
                     #   jittered grid + corridor/slope/spawn rejection
                     #   (mirrors propSampler); sky + ground altitude bands;
                     #   sub-seed via hashSeed("critter") ^ seed.
                     #   critterPose(p, t, out)->{pos,yaw,scale}: seeded
                     #   elliptical orbit + alt bob; PURE fn of t. Both
                     #   exported for jsdom unit tests (no WebGL).
  Wildlife.ts        # Environment child. InstancedMesh layer 0, flat-shaded
                     #   CelMaterial, NO outline (instanced draws have no
                     #   inverted-hull path; cf. Clouds.ts:28-29). Seeded
                     #   placement via placeCritters; update(dt,time)
                     #   recomputes every instance matrix via critterPose(time)
                     #   (deterministic: same seed + same t -> identical
                     #   matrices). dispose() frees geometry/material +
                     #   resets instanceMatrix; idempotent
                     #   (PropField.ts:143-160 guard pattern).
src/environment/
  Environment.ts     # ADD WildlifeOptions + construct Wildlife child +
                     #   cascade update(dt,time) + dispose. 71 lines now;
                     #   ample headroom under 600.
```

`PlacedCritter` mirrors `PlacedProp` (a data struct, not `Matrix4`, so tests
assert without decomposing a matrix):

```text
PlacedCritter {
  x, z, baseY        # orbit anchor (corridor/slope/spawn-cleared)
  radius, speed      # seeded orbit shape + angular rate
  phase, tilt        # start angle + orbit-plane inclination
  altAmp, altFreq    # sinusoidal altitude bob
  scale, seed        # instance scale + reproducibility key
  band               # "sky" | "ground"
}
```

## Contracts with 001-012

- 001: critters are an InstancedMesh on layer 0 with a flat-shaded CelMaterial
  and NO outline — the inverted-hull shader has no instance-matrix path
  (`materials/outline.ts`; `Clouds.ts:28-29` notes this). Same render
  treatment as `Clouds` and decor props (`PropField.ts:265-284`).
- 003: placement queries `heightAt`/`normalAt` (`Terrain.ts:74-87`).
- 004: new `Environment` child; Clouds/Water/PropField/DynamicSky/Weather
  unchanged. Mirrors `PropField` placement + `Clouds` render precedents.
- 010: independent in v1 (no phase read). 014 (clouds) independent.
- All others: none (decor only, no physics/audio/UI).

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(world): pure seeded critter placement + orbit pose`
   - `critters.ts`: `placeCritters` (jittered grid + corridor/slope/spawn
     rejection via `SamplerTerrain`; sky/ground altitude bands; sub-seed
     `hashSeed("critter") ^ seed`) + `critterPose(p, t, out)` (seeded
     elliptical orbit + alt bob, pure fn of t).
   - tests: same seed -> identical descriptors; corridor/slope/spawn
     rejection gates fire; count respects opts caps; sky vs ground band split;
     `critterPose` advances with t and is pure (same p + t -> identical pose).
2. `feat(world): Wildlife instanced critters on orbital paths`
   - `Wildlife.ts` child; InstancedMesh layer 0 (cel flatShading, NO outline);
     seeded placement via `placeCritters`; `update(dt,time)` recomputes
     matrices via `critterPose(time)`; dispose frees geo/mat + idempotent.
   - tests: instance count + layer 0 + CelMaterial + no outline child; pose
     advances deterministically with time (same seed + same t -> identical
     matrices); dispose idempotent + frees geometry/material.
3. `feat(world): wire Wildlife into Environment cascade`
   - `Environment.ts`: `WildlifeOptions` field + construct child + add to
     group + `update` cascade + `dispose`. Game untouched (children self-seed
     like Clouds; Environment already holds `terrain`).
   - tests: `Environment.test.ts` — child present, update cascades to
     Wildlife, dispose frees it.
4. `docs: log 017 verify + README project structure`
   - README project structure adds `critters.ts`/`Wildlife.ts`; troubleshooting
     visual-verify case; move task to `pending-review/`.

## Risks

- Game.ts 443/600: zero Game edits by design (Environment child + cascade;
  children self-seed like Clouds). `Environment.ts` 71 -> ~80 lines, well under
  the 600 cap.
- Corridor leakage: if anchor rejection is loose, perches sit on the racing
  line. Reuse the exact `propSampler` corridor distance threshold + a margin.
- Orbit radius vs corridor: airborne birds may dip over track edges mid-orbit;
  acceptable (non-interactive). Keep sky-band radius clear of terrain peaks and
  ground-band radius modest so birds do not clip the surface.
- Instance count vs 011 perf budget: cap critters (~24, Clouds parity); one
  draw call. Cross-ref 011.
- Readability without silhouette: instanced cel blobs have no outline
  (Clouds/decor parity); tune instance scale + flatShading so small birds read
  as birds, not dots.
- Determinism: never mutate matrices outside `placeCritters`; motion is a pure
  fn of `(placed, t)`. Seeded RNG only (`rng.ts`), no `Math.random`.
- Strict TS noUnusedLocals: all pure-fn params used; `_`-prefix unused.

## Acceptance

- [ ] `critters.ts` present; `placeCritters` + `critterPose` pure + tested
- [ ] Instanced critters render on layer 0, flat-shaded cel, NO outline
      (Clouds/decor parity)
- [ ] Placement clears the drivable corridor (sample assertion)
- [ ] Orbital motion runs as a pure fn of time; same seed + same t ->
      identical matrices
- [ ] `dispose()` frees GL resources + is idempotent
- [ ] `Game.ts` unchanged in line count
- [ ] `npm run typecheck && lint && test` green; pre-commit hook green
- [ ] No black screen at `npm run dev`; visual verify logged in
      `docs/troubleshooting/`

## Defaults

- species: birds (one species v1); ~24 instances (Clouds parity)
- placement: jittered grid over world bounds, corridor margin + slope/spawn
  rejection (propSampler parity); split across a sky altitude band (high, wide
  orbits) and a ground band (terrain-hugging, tight orbits)
- motion: per-instance seeded elliptical orbits + sinusoidal alt bob; pose =
  pure fn of time (no wrap-pop, no mutable matrix state). Wing-flap deferred
- orbit params: sky radius ~10-18 / ground radius ~3-6; seeded speed, phase,
  tilt, altAmp, altFreq per instance
- seed: `hashSeed("critter") ^ baseSeed`; sub-seeds per later species

## Previous implementation

None. Closest patterns: `Clouds.ts:39-78` (instanced cel + seeded place +
drift), `PropField.ts:143-160` (dispose guard) + `:265-284` (instanced decor),
`propSampler.ts:78-152` (sampleProps + trySlot rejection), `rng.ts:58-84`
(makeRNG/hashSeed).

## Depends on

000 (harness; test gate live). 003 (heightAt/normalAt for placement). 004
(Environment child pattern + seeded placement precedent). Independent of 010
in v1. 011 (perf budget) cross-ref.
