# 004 environment dressing troubleshooting

Tracking the InstancedMesh + custom-ShaderMaterial interactions and the prop
conformity guarantee, per the 004 acceptance criteria.

## InstancedMesh + CelMaterial (commit 3b)

- Symptom risk: custom ShaderMaterials that write `gl_Position =
projectionMatrix * modelViewMatrix * vec4(position,1.0)` render every
  InstancedMesh instance stacked at the mesh origin. three.js declares
  `instanceMatrix` under `USE_INSTANCING` (WebGLProgram prefix) but only
  APPLIES it inside shader chunks (`<project_vertex>`, `<defaultnormal>`)
  that CelMaterial does not include.
- Verified against three r169 source: `WebGLProgram.js` lines 551 + 670-672
  declare the attribute + define; no automatic application for hand-written
  main() bodies.
- Fix (committed `646bc1d feat(materials): apply instanceMatrix in
CelMaterial for InstancedMesh`): CEL_VERT applies `instanceMatrix` to
  position and `mat3(instanceMatrix)` to normal under `#ifdef USE_INSTANCING`.
  Non-instanced path unchanged (transformed initialised from position/normal
  before the guard). Uniform-scale decor/clouds only -> normal transform is
  correct.
- Covers: 004 instanced decor (bushes/flowers/grass) + clouds. Big props stay
  individual meshes (addOutline unaffected).

## Instanced inverted-hull outline spike (commit 6)

- Decision: ship clouds WITHOUT an outline. The 001 InvertedHullMaterial has
  no instance-matrix path; adding one needs a second InstancedMesh sharing the
  cloud geometry (BackSide, inflated) plus the same USE_INSTANCING fix in
  outline.ts. Clouds are soft, high-altitude cel blobs -> outline adds little
  and the fallback is the plan's accepted outcome (004 Risks).
- Decor also ships without outline (receive-only, no cast) for the same
  reason; big props (trees/rocks) keep their per-mesh outline via addOutline.

## Prop conformity to terrain

- Guarantee (by construction, no sampling needed): props seat via the sampler
  reading `Terrain.heightAt(x,z)` for their y. 003 built BOTH the displaced
  mesh and the Rapier trimesh collider from the SAME `heightAt` fn (see 003
  troubleshooting: 0/361 ray misses), so a prop placed at heightAt sits flush
  with the visual surface AND the collider surface simultaneously.
- Verification plan for integration (c7): sample N prop bases, cast
  `PhysicsWorld.castRayDown` from above each, assert `toi`-derived surface Y
  within eps of the prop's placed y. Logged here when run.

## Shadow receive on custom materials

- CelMaterial / CelWaterMaterial do not sample shadow maps (no shadow chunk).
  Setting `receiveShadow = true` on prop/water meshes is the intent flag but
  yields no in-shader shadow today; casters (trees/rocks, sun) still produce
  the shadow MAP, it is just not read by cel surfaces. Accepted for the toon
  look (hard cel bands, not soft shadows). Revisit if 005/011 require it.
