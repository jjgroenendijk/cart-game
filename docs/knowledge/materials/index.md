# Materials

- [CelMaterial](/materials/cel-material.md) — Cel-shaded toon material
  with vertex colors for terrain layer
- [Light Uniforms](/materials/light-uniforms.md) — Shared lighting uniform
  buffer written once per frame
- [Outlines](/materials/outlines.md) — Inverted-hull and post-Sobel outline passes
- [Water Shading](/materials/water-shading.md) — Depth-aware cel water GLSL and
  pure math mirror
- [Post Grade Math](/materials/post-grade.md) — Pure vignette + day-phase
  color-grade math mirrored into the final composer pass
- Sun Glow Helpers — `src/materials/sunGlow.ts` pure sun-uv projection +
  glow-intensity math for the sky halo (helpers only; composer wiring pending)
