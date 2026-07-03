# 050 Impact particles, sparks, and debris

Status: open (concept - to be refined)

053 shipped the wheel-dust / drift-smoke / skid-marks half this concept once
also sketched; it is removed below. This concept now covers only the
contact-force sparks/debris remainder.

## Context

No impact/spark/debris system exists. The contact pipeline already yields
everything needed to spawn impact VFX each sub-step:
`drainContactForceEvents` carries the contact point + total force
(PhysicsWorld.ts:54, gameAudio.ts:60-67). Weather (environment/Weather.ts)
is the precedent for moving particles GPU-side; 053's `KartVfxLayer.ts` is
the now-shipped precedent for a self-owned kart-space `THREE.Points` on
layer 0 (pooled ring buffer, GPU advance by `uTime`).

## Goal

CPU-driven pooled spark/debris system on render layer 0, keyed off the
contact-force drain:

- Impact sparks/debris spawned from the contact-force drain: force tier ->
  count; contact point + normal -> emit direction + origin.
- Pooled `THREE.Points`; bounded by the 011 perf budget. Reuse the 053
  `kartVfx.ts` ring-buffer + `KartVfxLayer.ts` GL idiom (same `burst()`
  shape as the respawn poof) rather than a second GL owner.

## Needs refinement

- Drain site: spawn during the existing FieldBuilder flush after
  `world.step` (FieldBuilder.ts:363), alongside `gameAudio.flush`, so events
  are read once.
- Force -> count mapping + emit direction from the contact normal (pure
  `impactToParticles(force, point, normal)` emit-list builder,
  jsdom-testable, mirroring `kartVfx.ts` emissionRate).
- Optional debris physics: short-lived Rapier bodies vs pure cosmetic
  sprites (decide vs cost; sparks are cosmetic by default).
- Determinism vs chaos: particles are cosmetic; decide whether they seed
  from the global RNG (replay-stable) or free. The replay invariant may or
  may not apply to transient sparks.
- Perf: cap live particle count; verify F3 tris/draw stay bounded (011).

## Non-goals

- Speed lines, boost flames (still unscoped).
- Wheel dust, drift smoke, skid marks - shipped in 053.

## Depends on

009 (contact-force events as the trigger). 047 optional (event types). 011
(perf budget gate). 053 shipped the wheel-dust/drift-smoke/skid-marks half;
this concept is the contact-force sparks/debris remainder. Independent of
048/049/051.
