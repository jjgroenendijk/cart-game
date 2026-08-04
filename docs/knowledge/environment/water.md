---
type: Subsystem
title: Water
description: Streamed depth-aware cel water tiles with shore foam, depth tint, and sun glint.
tags: [environment, water, shader, streaming]
timestamp: 2026-07-10T00:00:00Z
---

# Schema

`CelWaterMaterial` — the shader material class in `celWater.ts` —
powers the water tiles on layer 1. `CelWater` is the containing module, not
the class name.

`WaterChunkManager` (`WaterChunkManager.ts`, 071) streams the water surface as
a signed chunk grid instead of one field-sized plane: it drives the shared
`planStream` planner ([Chunk Streaming](/terrain/chunk-streaming.md)) to
activate/cull tiles around the observer focus, so an effectively endless world
only instantiates water near the camera. Tiles overlapping the baked
bed-height field are PINNED (never culled) so foam always covers the authored
region regardless of camera position; tiles past the field stream in and out.

All tiles share ONE `CelWaterMaterial`. With a heightMap the shader is
depth-aware per-fragment (foam inside the field, facing-only fallback past its
bounds via the shader's in-field test), so a single material serves both near
and far tiles — no separate far material. Each tile's geometry is authored in
WORLD space (mesh transform stays at identity) so the object-space vertex wave
`sin(pos.x)+sin(pos.z)` is one continuous field across seams. `uTime` is
written once per frame for every tile.

## Far-water skirt (071 fog-far)

Past the streamed ring the void would read as sky/nothing on larger or endless
worlds (fog-far reaches ~360 m but tiles only stream ~215 m out). `farSkirt`
(default on; `farSkirt:false` disables) fills it with ONE flat fogged disc that
follows the observer centroid each `update`:

- A separate facing-only `CelWaterMaterial` (no `HEIGHT_MAP` define, `uAmp` 0,
  glint 0) — the calm fogged fallback look; it inherits the biome
  `color`/`shallow`/`deep` for horizon color continuity with the near tiles.
- Sits at `waterY - amp - 0.1` (below the deepest tile trough) and renders after
  the tiles (`renderOrder` 1), so the opaque near tiles always occlude it: no
  z-fight, and early-Z rejects the tile-covered center so only the horizon
  annulus shades.
- Radius (`farRadius`, default 480 m) exceeds the max scene fog-far, so the rim
  saturates to the horizon haze with no hard edge.

The disc is `group.userData.farSkirt`-tagged so tile queries skip it; it is not
a streamed chunk and does not count toward `activeCount`. `setGlintIntensity`
targets the tiles only — the skirt stays glint-free.

Depth-aware: samples terrain bed-height field for banded shore-foam line and
shallow-to-deep tint computed from true water depth.

Quantized world-space sun glint tracks sun position. Low quality tier zeroes
glints via `waterGlintIntensity`. Since #315 each tile also carries a layer-3
sibling clone (an `EMISSIVE_OUTPUT` `CelWaterMaterial` variant) so the glint
bleeds into the selective-bloom pass; `setGlintIntensity` adds/removes the clones
with the glint state (off on low) so low tier pays no extra layer-3 draw.

## Shading

Pure math mirror lives in `materials/waterShading.ts`. The
shared WAVE table is the single source of truth.

`waterColor` from biome feeds `uTint` (white = identity for temperate).

`waterShallow`/`waterDeep` (BiomeDefinition) flow Environment ->
WaterChunkManager -> CelWater `uShallow`/`uDeep`; undefined = CelWater shader
defaults (identity).
Tropical sets teal->deep-blue (`0x2db8b8`/`0x0a3a55`); beach
(`0x1fb6c8`/`0x06304a`), autumn (`0x9aa06a`/`0x2a3830`), and mediterranean
(`0x5fae9a`/`0x1c4a44`) also set them; alpine and tundra omit them (defaults).

Outside baked field, falls back to legacy facing look — no seam pop.

# Examples

```glsl
// Water depth tint in fragment shader (positive = deeper)
float depth = uWaterY - bedH;
vec3 tint = mix(shallowColor, deepColor, smoothstep(0.0, maxDepth, depth));
```

# Cross-References

- [CelMaterial](/materials/cel-material.md)
- [Water Shading](/materials/water-shading.md)
- [Biomes](/biomes/framework.md)
