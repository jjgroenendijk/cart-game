# Materials

- [CelMaterial](/materials/cel-material.md) — Cel-shaded toon material
  with vertex colors for terrain layer
- [Light Uniforms](/materials/light-uniforms.md) — Shared lighting uniform
  buffer written once per frame
- [Outlines](/materials/outlines.md) — Inverted-hull outline (solid geometry)
- [Water Shading](/materials/water-shading.md) — Depth-aware cel water GLSL and
  pure math mirror
- [Post Grade Math](/materials/post-grade.md) — Pure vignette + day-phase
  color-grade math mirrored into the final composer pass
- Sun Glow Helpers — `src/materials/sunGlow.ts` pure sun-uv projection
  (`projectSunUv`) + glow-intensity (`glowIntensity`) math for the sky
  halo; wired per slot by `Renderer.applySunGlow` from `dayCycleState`.
- Bloom pipeline — `UnrealBloomPass` runs in linear HDR before
  OutputPass; tier-gated via `QualityKnobs.bloom`
  {strength,radius,threshold} (low softer, not off). The SunDisc
  corona (074) feeds bloom (see [SunDisc](/environment/sun-disc.md)).
- `SkyPosterizePass` owns a sun-aware sky halo (074): a radial glow +
  hotspot folded into the synthetic sky gradient around the projected
  sun screen-uv, sky-masked (terrain/walls occlude for free), driven
  per slot by the Renderer from dayCycle + `1 - nightFactor`. Neutral
  defaults reproduce the pre-074 frame.
- Luminance keep-through (3a): the sky replacement `mix(color, synthetic,
uBandMix)` is scaled by `keepThrough = 1 - smoothstep(0.75, 0.95, lum)`.
  Bright tonemapped pixels (bloom halos, HDR sources) punch through the
  dimmer synthetic gradient so their glow survives the replacement.
  Mirrored by the pure `skyReplaceMix(luminance, bandMix)` helper in
  `src/materials/skyPosterize.ts`.
- Screen-space godrays (074): a 24-tap march from each pixel toward the
  projected sun UV over the depth mask (reuses `tDepth`), additive over
  sRGB color, guarded by `uGodrayStrength > 0.0` so the default frame is
  byte-identical. Wired per slot by `Renderer.applySunGlow` from
  `godrayPhaseStrength` (sun elevation) + `godrayScreenFade` (edge/off-
  screen) + the tier `godrayScale`; tint follows the day-cycle sun color.
  Helpers in `src/materials/postFxPhase.ts`.
