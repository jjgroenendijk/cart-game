# Materials

- [CelMaterial](/materials/cel-material.md) — Cel-shaded toon material
  with vertex colors for terrain layer
- [Light Uniforms](/materials/light-uniforms.md) — Shared lighting uniform
  buffer written once per frame
- [Water Shading](/materials/water-shading.md) — Depth-aware cel water GLSL and
  pure math mirror
- [Post Grade Math](/materials/post-grade.md) — Pure vignette + day-phase
  color-grade math mirrored into the final composer pass
- [Aerial Perspective](/materials/aerial-perspective.md) — distance desaturation
  - atmosphere tint on world CelMaterials behind AERIAL; math mirror
- [Terrain Surface Detail](/materials/terrain-detail.md) — fbm albedo mottle
  - micro-normal bump behind SURFACE_DETAIL, tier-gated, shading-only
- [Sun Light Effects](/materials/sun-effects.md) — analytic sun halo, god rays,
  and lens flare in the final pass; each user-toggleable, no HDR bloom
- [Ground Mist](/materials/ground-mist.md) — screen-space height-based valley
  mist reading the shared depth buffer; dawn/dusk-peaked, fog-tinted, tier-gated
- [Foliage Impostors](/materials/impostors.md) — runtime-baked albedo+normal
  atlas + instanced yaw billboards relit via shared light uniforms + cel bands
