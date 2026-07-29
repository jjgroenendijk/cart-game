# iOS Safari tiled sky/depth mask

## Symptom

Physical iPhone Safari screenshots showed hard rectangular sky-color patches
and stair-stepped dark blocks over terrain. The same deployed build rendered
cleanly in Chromium at a 390x844 viewport and DPR 2. Instanced cloud puffs also
read as washed-out sky fragments.

## Diagnosis

`DepthCapturePass` rendered layers 0+1 into a native unsigned-int
`DepthTexture`. Sky posterization, GTAO, and ground mist all sampled that one
attachment, so tiled/corrupt iOS WebKit depth values fanned into every effect.
The custom depth vertex shader omitted `instanceMatrix`; the normal capture
transformed instance normals but also omitted the instance transform from
vertex position.

## Resolution

- Replaced the native sampleable depth attachment with an ordinary RGBA8 color
  RT written by `THREE.MeshDepthMaterial` + `RGBADepthPacking`.
- All consumers now call `unpackRGBAToDepth`.
- Replaced the custom normal shader/HalfFloat RT with
  `THREE.MeshNormalMaterial` + RGBA8.
- Runtime quality changes now propagate pixel ratio to existing composers.

The built-in materials use Three's standard instancing/batching/morph chunks,
and the same portable RGBA8 path now runs on Chrome and Safari without a
user-agent branch.

## Verification

- Focused depth/normal/sky/mist/AO/sun-effect unit suites.
- TypeScript typecheck.
- Full repository verification before publication.
