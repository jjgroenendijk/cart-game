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
