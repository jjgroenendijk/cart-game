# 003 Terrain height variation + closed-loop circuit

Status: open (reopening — current `003` was a sketch, rewritten as full plan)

## Context

Track is 100% flat: `src/tracks/TestArena.ts:35` builds one `BoxGeometry(400,2,400)`
ground at y=-1 with a Rapier `cuboid(200,1,200)` collider (`TestArena.ts:35-55`).
No heightmap, no terrain system, no Rapier heightfield. Kart game needs elevation.

Two landmines the sketch ignored:

- `KartController.respawn()` hardcodes `(0,2,0)` (`KartController.ts:267`); breaks
  the instant terrain has height.
- `Game.ts:31` spawns the kart at `(0,1.5,24)` flat-world style; must sit on the
  spline start at terrain height.
- Sketch references `makeToon({vertexColors:true})` — STALE. 001 deletes
  `src/materials/toon.ts` (`001:103`) and ships `makeCel` + a render-layer
  system (terrain = layer 1, post Sobel outline, NOT inverted hull). 003 must
  consume 001's new API.

## Goal

Closed-loop kart circuit (Catmull-Rom spline) on terrain with height variation:
gentle rolling drivable corridor on-track, procedural hills off-track. Visual
terrain mesh + matching Rapier heightfield collider derived from ONE height fn
so physics/visuals agree by construction. Distinct road surface on the corridor.

Scope boundary (decided): geometry only — no checkpoints, no lap counting, no
race UI (README "Track 01 — laps, checkpoints" stays a separate future item).

## Architecture (new)

```text
src/terrain/
  SplineTrack.ts   # closed CatmullRomCurve3. Authored control points (XZ +
                   #   gentle Y). closestPoint(x,z) via precomputed sample
                   #   table (arc-length). startPos()/startYaw() (tangent at
                   #   t=0). Reusable by future race systems.
  heightmap.ts     # SplineFieldCache: builds dist/pathY/t grid over world from
                   #   SplineTrack (one-time O(N) build -> O(1) bilinear query).
                   #   heightAt(x,z) = pathY + noiseY*smoothstep(dist). Pure,
                   #   deterministic (seeded SimplexNoise). colorAt(x,z) =
                   #   road/grass/sand/rock by dist + slope (finite-diff grad).
  Terrain.ts       # orchestrator: PlaneGeometry (XZ, rotateX -PI/2) displaced
                   #   per-vertex via heightAt; vertex colors via colorAt;
                   #   makeCel vertexColors on layer 1, receiveShadow. Rapier
                   #   heightfield (column-major) from same heightAt. Perimeter
                   #   boundary wall (layer 0). exposes heightAt/normalAt +
                   #   spline for spawn.
src/kart/KartController.ts  # respawn() resets to ctor spawn (not 0,2,0).
src/core/Game.ts            # Terrain replaces TestArena; kart spawn from
                             #   SplineTrack.startPos()/startYaw() at terrain
                             #   height (sample heightAt + clearance).
src/tracks/TestArena.ts     # DELETED (replaced by Terrain).
```

### Height fn contract

`heightAt(x,z)`:

1. `cp = fieldCache.query(x,z)` -> `{dist, pathY}` (O(1) bilinear from cache).
2. `w = smoothstep(trackHalfWidth, trackHalfWidth + blendWidth, dist)`.
3. `noiseY = octaveSum(simplex, x, z)` (amplitude off-track).
4. return `pathY + noiseY * w`.

- On-track (dist < trackHalfWidth): w=0 -> height = pathY (corridor = smooth
  spline surface, no per-cell bumpiness -> kart never bounces on corridor).
- Off-track (dist > trackHalfWidth+blend): w=1 -> pathY + hills.
- `colorAt(x,z)`: road if dist < trackHalfWidth; lerp road->grass across blend;
  rock where slope > thresh; sand near valley height (hook for 004 water).

### Mesh vs collider layout (the orientation trap)

- Mesh: `PlaneGeometry(W,D,segX,segZ)`, `rotateX(-PI/2)`, displace vertex y by
  `heightAt(vx,vz)`; row-major vertex order. Color attr N\*3.
- Collider: `ColliderDesc.heightfield(nrows, ncols, heights, scale, flags)`
  (`rapier geometry/collider.d.ts:596`). heights are COLUMN-MAJOR:
  `heights[icol*nrows + irow]`; scale = full (W,D) x/z dimension; centered at
  rigid-body origin; identity rotation.
- Both emit from the SAME world->heightAt eval -> agreement by construction,
  NOT by sharing one raw array (fragile). Dedicated transpose-guard test on
  4 corners + center.

## Contracts with 001 (cross-backlog)

- CelMaterial MUST support `vertexColors:true` (road/grass/rock coloring).
  Add to `001` Defaults/contract; 003 blocks until present.
- Terrain mesh on render layer 1 (post Sobel outline), NOT inverted hull.
- 003 imports 001's `makeCel` factory, never `makeToon`.

## Commits (each atomic + green: typecheck + lint + test per 000 harness)

1. `feat(terrain): add SplineTrack closed Catmull-Rom + closestPoint cache`
   - control points (XZ + gentle Y, evenly spaced); `closed:true`; arc-length
     sample table; `closestPoint(x,z)`, `startPos()`, `startYaw()` (tangent)
   - tests: `getPoint(0)≈getPoint(1)` (closed); tangent unit-length;
     closestPoint dist≈0 at a control point; min-segment-distance > 0 (no
     self-intersection)
2. `feat(terrain): add heightmap fn + SplineFieldCache + colorAt`
   - SplineFieldCache (dist/pathY grid from SplineTrack); seeded SimplexNoise
     octave sum; heightAt; colorAt (dist+slope)
   - tests: heightAt deterministic (same seed); dist< trackHalfWidth ->
     height≈pathY (corridor); amplitude grows with dist beyond blend; bounded;
     colorAt returns road inside / grass outside / rock on synthetic steep
3. `feat(terrain): add Terrain (mesh + Rapier heightfield from shared fn)`
   - PlaneGeometry XZ displaced per-vertex; vertex colors; makeCel vertexColors
     on layer 1, receiveShadow; Rapier heightfield (column-major) with
     `HeightFieldFlags.FIX_INTERNAL_EDGES`; perimeter boundary wall (layer 0);
     exposes heightAt/normalAt + spline
   - tests: vertex+color attr sizes; heights length = nrows\*ncols; 4 corners +
     center match heightAt (transpose guard); collider has FIX_INTERNAL_EDGES;
     mesh.layers = 1
4. `refactor(kart,game): spawn + respawn on terrain; delete TestArena`
   - KartController.respawn() -> reset to ctor spawn pos/yaw (not 0,2,0);
     Game: Terrain replaces TestArena; kart spawn = spline start at
     heightAt+clearance
   - delete `src/tracks/TestArena.ts`; README project structure updated
   - tests: respawn resets to ctor spawn; Game wires Terrain + spawn; grep:
     no TestArena refs remain
5. `docs: update backlog 003 + todo + README for terrain`

## Risks

- Rapier heightfield column-major + center-origin vs PlaneGeometry row-major +
  rotateX. Mitigation: both sample heightAt by world coord; transpose-guard
  test; verify by downward raycast (`PhysicsWorld.castRayDown`) + visual,
  log in `docs/troubleshooting/`.
- Gentle rolling on-track grade vs arcade suspension (`maxRay≈0.9`,
  `KartController.ts:102`). Mitigation: cap spline Y +-2.5m, min control-point
  spacing ~25m (grade <12%); FIX_INTERNAL_EDGES kills seam-bounce. Spike @c3.
- CelMaterial vertexColors support — 001 contract (above). Blocks if absent.
- Build cost: heightAt sampled ~100k+ (mesh+heightfield). Mitigation:
  SplineFieldCache -> O(1) heightAt; build ~0.5-1s sync hitch acceptable.
  Web-worker build out of scope.
- Catmull-Rom closed overshoot with uneven points -> corridor self-intersect.
  Mitigation: evenly-spaced control points; min-segment-distance test @c1.

## Acceptance

- [ ] `src/tracks/TestArena.ts` deleted; no TestArena refs remain (grep)
- [ ] `src/terrain/{SplineTrack,heightmap,Terrain}.ts` present
- [ ] Kart spawns on spline start at terrain surface (no float/sink) — raycast + visual verify, logged in `docs/troubleshooting/`
- [ ] Kart drives a closed loop; gentle rolling on-track, hills off-track
- [ ] Kart rests on terrain everywhere on corridor (no float/sink) — raycast
- [ ] Rapier heightfield orientation correct (column-major corner/center test
      green) -> no sink/float
- [ ] Respawn (R) places kart on spline start at terrain height (not 0,2,0)
- [ ] Terrain mesh on render layer 1 (post Sobel, no hull) per 001
- [ ] Vertex-color road surface visible on corridor, distinct from grass
- [ ] FIX_INTERNAL_EDGES set -> no corridor bounce
- [ ] `npm run typecheck && lint && test` green; pre-commit hook green
- [ ] No black screen at `npm run dev`; visual verify in browser

## Defaults

- world: 200x200 (half-extent 100); physics heightfield 200x200 (1m cell);
  mesh 200x200 segs (~1m)
- trackHalfWidth: 6; blendWidth: 8
- spline: ~12 control points, radius ~55-70, Y amplitude +-2.5m
- noise: 3 octaves, base freq 0.012, amplitude 7m (off-track)
- colors: road 0x6e6256, grass 0x6aa84f, sand 0xc2b280, rock 0x7d8a96
- FIX_INTERNAL_EDGES: on; ground friction: 1.0
- boundary: low visible wall (h=2) on layer 0
- layer: 1 (terrain, per 001/002 layer system)
- checkpoints/laps/water/dressing: out of scope (future Track 01 / 004)

## Previous implementation

None. Current ground = flat box (`TestArena.ts:35-55`), superseded.

## Depends on

000 (harness). 001 (makeCel + vertexColors + render-layer system; deletes
makeToon). Must land first. 002 layer system is shared but 001 is the hard
gate.
