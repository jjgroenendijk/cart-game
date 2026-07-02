# 050 Impact particles, sparks, and debris

Status: open (concept - to be refined)

## Context

No particle/debris/smoke system exists (grep for
`particle|skid|spark|dust|smoke|debris` hits only Weather GPU rain/snow +
CSS). The contact pipeline already yields everything needed to spawn impact
VFX each sub-step: `drainContactForceEvents` carries the contact point +
total force (PhysicsWorld.ts:54, gameAudio.ts:60-67). Wheel dust/drift smoke
can key off `controller.driftActive` + the suspension ground state
(KartController.ts:186-221, `state.grounded`).

Weather (src/environment/Weather.ts) is the precedent for moving particles
GPU-side; Wildlife (src/environment/Wildlife.ts) is the precedent for a
self-owned GL mesh child (InstancedMesh) that a subsystem manages.

## Goal

CPU-driven pooled particle system on render layer 0:

- Impact sparks/debris spawned from the contact-force drain: force tier ->
  count; contact point + normal -> emit direction + origin.
- Drift smoke / wheel dust keyed off `driftActive` + grounded, sampled at
  the wheel point (reuse suspension world position, KartController.ts:189).
- Pooled `THREE.Points` or instanced quads; bounded by the 011 perf budget.

## Needs refinement

- Drain site: spawn during the existing FieldBuilder flush after
  `world.step` (FieldBuilder.ts:363), alongside `gameAudio.flush`, so events
  are read once.
- GL ownership: follow the Wildlife InstancedMesh pattern (self-owned child,
  `remove()` on dispose); do not leak points across field rebuilds.
- Determinism vs chaos: particles are cosmetic; decide whether they seed
  from the global RNG (replay-stable) or free (livelier). The replay
  invariant (AGENTS.md, critters) may or may not apply to transient sparks.
- Perf: cap live particle count; verify F3 tris/draw stay bounded (011).
- Materials: sparks on layer 0 with the cel/outline pipeline (Renderer
  layers, src/AGENTS.md).
- Tests: pure `impactToParticles(force, point, normal)` emit-list builder
  (jsdom-testable); pool grow/shrink asserts.

## Depends on

009 (contact-force events as the trigger). 047 optional (event types). 011
(perf budget gate). Independent of 048/049/051.
