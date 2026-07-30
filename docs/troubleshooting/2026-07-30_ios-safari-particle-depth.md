# iOS Safari square sky holes after packed-depth migration

## Symptom

After moving the shared depth capture to RGBA8 packed depth, physical iPhone
Safari showed large white square holes through the synthetic sky gradient in
snowy weather. Solid terrain, trees, clouds, and the kart rendered normally.
Chromium did not expose the squares at the same mobile viewport.

## Diagnosis

`DepthCapturePass` and `NormalCapturePass` render the scene with opaque override
materials. That override discarded the original `depthWrite:false` contract on
weather and VFX materials, so transparent point sprites wrote solid square
depth/normal footprints. Safari exposed the undefined/driver-specific point
size of the mesh override path as large blocks. The sky pass then classified
those footprints as non-sky and left the near-white natural sky visible.

## Resolution

- Added a shared capture-visibility helper that temporarily hides visible
  drawables when all their original materials set `depthWrite:false`.
- Applied it to both depth and normal captures.
- Restored object visibility, scene override material, camera layers, and clear
  color in `finally` blocks.
- Kept solid and mixed-material drawables in both captures.

Weather, waterfall mist, kart particles, skid marks, and snow tracks remain
visible in the main color render but no longer occlude the sky, participate in
GTAO, or feed ground-mist world reconstruction.

## Verification

- Unit coverage for visible, already-hidden, solid, and multi-material objects.
- Focused capture/post-processing suites.
- Mobile alpine/snow visual smoke test before and after the fix.
