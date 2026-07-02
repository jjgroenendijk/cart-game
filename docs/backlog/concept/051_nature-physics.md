# 051 Nature physics: destructible props, loose debris, floating objects

Status: open (concept - to be refined)

## Context

PropField props are fixed Rapier bodies today (src/environment/PropField.ts:
260-290: cylinder for trees, ball for rocks, `RigidBodyDesc.fixed()`). The
kart bounces off them but nature never reacts. Three candidate directions
for physics-reactive scenery, all built on the existing PropField + streaming
dressing framework (023 DressingChunkManager, 025 flora registry).

Deliberate non-candidate: swaying flora (concept 046) stays shader/vertex-
driven. Thousands of decor instances + the determinism/replay invariant make
per-instance physics the wrong tool; 046 is the cheap path for sway.

## Goal

Refine to ONE or more of:

1. Destructible props: on a hard kart impact, swap a fixed tree/rock
   collider for spawned dynamic debris shards (CCD bodies, like the kart,
   KartController.ts:394). Contact force (gameAudio pipeline) is the trigger;
   shards sleep/remove after settling.
2. Loose rolling props: boulders / logs / fruit as DYNAMIC bodies (not fixed)
   karts can knock around. New `FloraCollider` kind or a `dynamic` flag in
   the flora registry (floraRegistry.ts:10-29).
3. Buoyant floating debris: logs / lily pads on water, sampled against the
   048 `waterSurfaceHeight` so they bob on the real wave surface.

## Needs refinement

- Streaming lifecycle (hard): DressingChunkManager activate/deactivate must
  own dynamic body lifecycle. Decide sleep-on-deactivate (preserve state) vs
  remove+respawn; fixed-cap pool per chunk to bound body count.
- Determinism: dynamic bodies break the seeded-stable field unless their
  initial state is seeded; clarify whether nature physics opts out of replay
  determinism (AGENTS.md critters invariant).
- Perf: dynamic bodies are costlier than fixed (solver). Budget per chunk;
  verify F3 + a chrome-devtools trace (011).
- Collider-tracks-visual invariant (AGENTS.md): rock visual radius + collider
  both derive from `rockRadius(seed)`; debris shards must follow.
- Destructible art: procedural shard geometry must stay code-native (no
  binary assets, repo rule).
- Tests: pure debris-shard transform builders; body-count leak asserts across
  build/dispose (PropField.test.ts precedent).

## Depends on

047 (collider queries, sensor events for triggers). 048 (`waterSurfaceHeight`
for floating debris). 023 (DressingChunkManager streaming), 025 (flora
registry). 011 (perf budget). 046 is the explicit non-overlap (sway stays
shader-side).
