# 003 terrain + heightfield troubleshooting

Tracking the Rapier heightfield column-major vs PlaneGeometry row-major
orientation trap, plus kart-on-terrain spawn/rest verification, per the
003 acceptance criteria.

## Baseline (pre-implementation)

- typecheck clean, lint clean, 34 tests pass (see baseline run).
- Branch `feat/002-sky-smooth-gradient` -> created `feat/003-terrain-height-variation`.
- `makeCel` (materials/cel.ts) has NO vertexColors support yet. 003 contract
  with 001 requires it. Adding as prereq commit before Terrain.
- No `simplex-noise` dependency. Implementing a seeded 2D simplex noise
  in-repo (pure, jsdom-testable) rather than adding a dep.
- Rapier API: `ColliderDesc.heightfield(nrows, ncols, Float32Array, scale,
HeightFieldFlags?)`. heights are column-major: `heights[icol*nrows+irow]`.
  `HeightFieldFlags.FIX_INTERNAL_EDGES = 1`.
- KartController.respawn() hardcodes (0,2,0); Game spawns at (0,1.5,24).

## Prereq: CelMaterial vertexColors

- Added `vertexColors` opt to CelOpts + VERTEX_COLORS define + vColor varying.
- Fragment multiplies linear base by vColor (guarded). Default off -> no
  behavior change for existing flat-color call sites.
- Committed `c129881 feat(materials): add vertexColors support to CelMaterial`.

## SplineTrack (commit 1)

- Closed centripetal CatmullRomCurve3, 12 authored control points radius ~60,
  Y +-2.5m. Arc-length sample table (1024) backs closestPoint(x,z) (O(N)
  scan, build-time only).
- Verified: getPoint(0)==getPoint(1) (closed); tangent unit-length; loop
  radius 45..75 (fat, contained); non-adjacent control points >45m apart (no
  self-intersection); closestPoint dist <0.6m at a control point.
- startYaw uses XZ-projected tangent (yaw discards tangent Y); forward
  (-sin yaw, -cos yaw) matches XZ-normalized tangent.
- Committed next.

## Heightmap + heightfield orientation (commit 2,3)

Pending: verify column-major heights match row-major PlaneGeometry vertices
via transpose-guard test (4 corners + center).

### Rapier heightfield API — actual contract (probed in Node)

The 003 plan assumed heights length = nrows\*ncols and irow->X. WRONG on both.
Probed the real behavior by tagging each heightfield vertex with its linear
index and raycasting a grid (after world.step()):

- `ColliderDesc.heightfield(nrows, ncols, heights, scale, flags)`:
  - nrows = number of CELLS along the Z axis
  - ncols = number of CELLS along the X axis
  - heights length MUST be (nrows+1)*(ncols+1) (vertex count, not cells).
    nr*nc panics with wasm `unreachable` at creation; (nr+1)\*(nc+1) builds.
  - column-major: heights[icol*(nrows+1) + irow]
  - icol indexes world X (icol=0 at X=-scale.x/2); irow indexes world Z
    (irow=0 at Z=-scale.z/2). irow->Z, icol->X (opposite of plan's guess).
  - spans [-scale.x/2, scale.x/2] x [-scale.z/2, scale.z/2], centered at the
    rigid-body origin. identity rotation.
- Raycasts (castRayAndGetNormal) return null until world.step() has run once
  (broadphase built on step). The game loop steps every frame before kart
  raycasts, so this is fine at runtime; tests must step() before asserting.

Mesh (PlaneGeometry W,W,N,N then rotateX(-PI/2)): vertex (ix,iy) sits at
X=(ix/N-0.5)*W, Z=(iy/N-0.5)*W -> ix<->X, iy<->Z. So mesh vertex (ix,iy)
corresponds to collider vertex (irow=iy, icol=ix); both sample the SAME
heightAt(X,Z) -> agreement by construction.

Verified mapping with nr=nc=2, heights[index]=index, scale=20:
(X=-10,Z=-10)->idx0, (X=10,Z=-10)->idx6 (icol2,irow0), (X=-10,Z=10)->idx2
(irow2), (X=10,Z=10)->idx8, center->idx4. Confirms icol<->X, irow<->Z.

### Pivot: heightfield -> trimesh collider (Rapier 0.14 ray bug)

003 planned a Rapier heightfield + FIX_INTERNAL_EDGES. Blocked by a Rapier
0.14 defect: downward raycasts against a heightfield miss ~60% of the surface
even when flat (217/361 misses on a flat y=5 heightfield; pattern is a
triangle-winding/back-face stripe, independent of solid flag, FIX flag, or
ray origin height). The kart's suspension is ray-based (KartController
castRayDown at 4 wheels/frame), so a heightfield would make it undrivable.

Verified alternatives (same world, downward ray grid 361 pts, +box-drop):

- CUBOID rays: 0/361 misses (baseline).
- TRIMESH rays: 0/361 misses; box rests at y=5.998 on flat y=5 (contacts ok).
- HEIGHTFIELD contacts: box rests at y=5.998 (contacts fine) — only RAYS break.

Decision: collider is a TRIMESH built from the SAME displaced mesh vertices

- index, so mesh and collider are identical by construction (still one shared
  heightAt, never sampling one from the other's raw array). Kart ray-suspension
  works unchanged. FIX_INTERNAL_EDGES is heightfield-only; trimesh uses default
  flags (contact drop-test passes). Acceptance item "heightfield column-major
  test" is superseded by the raycast orientation guard against heightAt (0
  misses, <0.3m error) in Terrain.test.ts.
