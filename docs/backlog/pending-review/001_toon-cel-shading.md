# 001 Toon cel-shading + outlines

Status: completed (pending review)
Commit: `26f8622 feat(toon): cel-shaded materials + inverted-hull outlines`

## Context
Game looked flat — all `MeshStandardMaterial`, no art direction. Need cartoony
cel-shaded look (oversaturated, banded lighting, black outlines) as base for the
visual overhaul.

## Change
- `src/materials/toon.ts`: procedural 3-band `RedFormat` gradient map driving
  `MeshToonMaterial`; inverted-hull outline `ShaderMaterial` (BackSide,
  normal-expanded in vert shader); `flatGeometry()` helper bakes per-face normals
  (`MeshToonMaterial` has no `flatShading` flag in three@0.169).
- `Kart.ts`, `tracks/TestArena.ts`: swap all `MeshStandardMaterial` → toon,
  add outlines to kart parts + decorations.

## Acceptance
- [x] 0 `MeshStandardMaterial` remain (verified: 86 toon fills + 46 outlines)
- [x] typecheck clean
- [x] scene renders w/ sky-blue + grass pixels, no black screen

## Notes
Sky + terrain will follow in 002/003; arena here is interim (replaced in 003).
