# 049 Collision gameplay effects

Status: open (concept - to be refined)

## Context

Karts are dynamic Rapier bodies, so kart-kart + kart-prop contacts already
resolve physically, and the contact-force pipeline already routes impacts to
SFX: FieldBuilder flushes (src/core/FieldBuilder.ts:363), gameAudio drains
(src/audio/gameAudio.ts:60-67), `impactRouting` returns `{index, force}` per
kart (src/audio/impactRouting.ts:57-86). But contacts drive NOTHING gameplay:
no spinout, no damage, no boost-on-bump, no mass-variant feel.

Both collider handles per event are already available
(`TempContactForceEvent.collider1()/collider2()`); only the routing treats
them as kart-generic. A collision category (kart-kart vs kart-prop vs
kart-terrain) is the missing tag.

## Goal

Convert contact force into gameplay, with no new physics bodies:

- Tag each routed hit with a collision category by resolving the non-kart
  handle against a prop/terrain body registry (extend the
  colliderHandle->kartIndex map in gameAudio to a handle->kind map).
- Effect tiers keyed off force magnitude: heavy hit -> spinout (set high
  angvel via KartController), light bump -> speed tap, rival-vs-rival ->
  small mutual boost. All via existing KartController impulse/torque APIs.
- Keep the pure tier->effect decision in a new `race/collisionEffects.ts`
  (no Rapier/Three deps, jsdom-testable); FieldBuilder applies the returned
  impulses so the sim step owns the write.

## Needs refinement

- Body-kind registry: prop colliders (PropField.ts:288) + terrain trimesh
  (TerrainChunkManager.ts:330) need handle->kind entries; lifecycle on chunk
  activate/deactivate + field dispose.
- Force thresholds + effect tables: tune per category; impact SFX already
  uses a 300 N threshold (DEFAULT_IMPACT_ROUTE, impactRouting.ts:38).
- Spinout coupling: a spinout generates more contacts -> feedback loop.
  Reuse the per-kart cooldown (impactRouting.ts:80) to gate.
- Finish/fairness: decide whether spinout affects AI + humans equally
  (steering sign invariant, AGENTS.md).
- Tests: `collisionEffects` pure tier->effect mapping; verify no double-fire.

## Depends on

009 (impact pipeline). No new physics; reuses existing KartController
impulse APIs. Independent of 047/048/050/051.
