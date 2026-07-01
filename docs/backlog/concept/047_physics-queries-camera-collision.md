# 047 Physics queries (generic ray + intersection events) and camera collision

Status: open (concept - to be refined)

## Context

PhysicsWorld (src/physics/PhysicsWorld.ts) exposes only a downward ray
(`castRayDown`, L58-81) and drains only `CONTACT_FORCE_EVENTS` (L54). That
caps what the rest of the sim can do:

- ChaseCamera (src/kart/ChaseCamera.ts:22-55) is a pure lerp; the camera
  clips terrain hills, trees, and rocks because no scene query pulls it in.
- Sensor/trigger gameplay (item boxes, pickups, water enter/exit) needs
  `ActiveEvents.INTERSECTION_EVENTS` + a drain path, which is not wired.
- Terrain-following nature (critters, floating debris) needs an arbitrary
  origin/dir ray, not only straight down.

The downward ray + contact-force pipeline are proven (009 impacts, kart
suspension); both new capabilities are small additive extensions of the same
allocation/reuse patterns (Ray + reused scratch objects, PhysicsWorld.ts:41).

## Goal

Two wrapper additions, then the immediate payoff (camera collision):

1. `castRay(origin, dir, maxToi, excludeBody?, filterGroups?)` generalising
   `castRayDown`. Reuse the `Ray` + `rayHitScratch`; keep `castRayDown` as a
   thin special-case caller so existing callers are untouched.
2. `drainIntersectionEvents(cb)` wrapping
   `eventQueue.drainIntersectionEvents`; re-export `ActiveCollisionTypes`
   alongside the existing `ActiveEvents` re-export (L5).
3. ChaseCamera spring-arm: cast from kartPos toward desiredPos; clamp the
   camera to `hit.toi + normal*skin` (skin ~0.3) so it never sits inside
   geometry. Exclude the kart body. Keep the existing exp-lerp smoothing
   toward the (possibly clamped) target.

## Needs refinement

- Generic ray scratch: the reused `{toi,point,normal}` must be written as
  `origin + dir*toi`; confirm dir normalisation at call time.
- Filter groups: Rapier collision groups / query-interaction masks. Decide
  whether the camera ray ignores decor (layer-0 props) or stops on terrain
  - big props only.
- Spring-arm stability: a ray origin inside a collider yields a false
  near-zero toi. Offset origin toward the kart and clamp a min camera
  distance; verify no jitter on hills at speed (F3 perf overlay).
- Intersection-event ownership: a sensor collider needs contact/sensor
  flags + a new collider->kind map; align with the colliderHandle->kartIndex
  map in gameAudio (src/audio/gameAudio.ts:43-52).
- Tests: extend PhysicsWorld.test.ts (generic ray vs tilted collider;
  intersection event on sensor overlap); add a pure `clampCameraDistance`
  helper in kart/ (jsdom-testable).

## Depends on

009 (contact-force event precedent). 022 (allocation discipline). Feeds 048
(splash sensor), 050 (impact spawns reuse event types), 051 (collider
queries). Camera payoff is standalone.
