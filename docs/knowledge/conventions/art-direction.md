---
type: Convention
title: Art Direction — Painted Wilds (realism)
description: "Grounded realism: physically-based light, natural palettes, per-biome mood registers."
tags: [art-direction, rendering, palette, convention]
timestamp: 2026-07-31T00:00:00Z
---

# Art Direction — Painted Wilds (realism)

The game's visual identity is a grounded, realistic natural world: believable
outdoor light, weather, and materials in the register of Skyrim / The Witcher 3
landscapes. Mood and atmosphere stay first-class, but they are carried by real
optics — sun angle, skylight, haze, wet surfaces — not by stylized cel bands or
ink outlines. The world reads natural and grounded, never neon, never arcade
glossy, never cartoon. This doc is the contract; subsystem docs own the mechanics.

## Direction change

The project previously targeted a painterly cel look (soft toon bands, black
Sobel + inverted-hull outlines, a posterized painted sky, canvas/watercolor
finishing). That direction is retired in favour of realism. Several rendering
subsystems still carry cel-era artifacts and are being reworked to match this
contract; where the current implementation diverges from the laws below it is
called out as in-flight, and the matching rendering issues track the work.

## Pillars

- Real, not printed: physically-motivated shading and tone mapping, natural
  atmospheric haze, no hard toon snap, no ink outlines, no canvas/paper texture.
- Mood is data: registers live entirely in palette / fog / light / sky tables,
  one vibe per biome, never in shader or pass forks. One shader runs a warm
  temperate morning and a cold nordic tundra.
- Grounded fantasy: Skyrim / Witcher landscape moods — cold mist, mossy greens,
  snowlines, low raking sun — carried by the biome and day-phase tables.
- Procedural everything: zero committed media stays policy; all visual identity
  is code (shaders, palettes, css builders).

## Shading law

- Surfaces shade with smooth lambert diffuse plus a soft, sun-tinted
  Blinn-Phong specular term (per-material roughness) with continuous falloff.
  All world surfaces (`src/materials/cel.ts`) default to smooth diffuse; the
  banded toon path stays compilable behind `banded:true` for byte-identity
  tests but has no runtime consumers. Specular is opt-in per surface that wants
  a highlight (karts/painted metal/wet rock); it is a few ALU and is on at
  every quality tier (no settings row). See
  [cel-material](/materials/cel-material.md).
- Lighting carries warm-sun / cool-shade temperature contrast (the `tempGrade`
  grade on every CelMaterial behind the `TEMP_GRADE` define: lit faces lean
  toward the warm `uSunColor`, unlit toward the cool `uShadeTint`, strength from
  the day-cycle `uTempContrast` scalar — neutral at noon, strongest at golden
  hour) and soft ambient occlusion in contact points; shadows deepen toward the
  skylight-lit ambient floor rather than crushing to flat black.
- Bloom/glow reads as real HDR light bleed on genuinely bright pixels (sun,
  glints, snow sparkle) only — never emissive stylization on ordinary surfaces.

## Line law

- No black toon outlines. The cel-era inverted-hull silhouette shells on
  karts/props and the post-process Sobel terrain edge pass have both been
  removed game-wide. New code must not add hard silhouette lines. Form reads
  from lighting, occlusion, and material, not from drawn edges.
- The non-sky depth the Sobel pass once captured (layers 0+1) is now captured by
  the shared `DepthCapturePass` (`src/materials/depthCapture.ts`) that
  `SkyPosterizePass` reads for the sky mask + god rays; see the render-pipeline
  docs.

## Color law

- Sky: a continuous view-direction (world-elevation) gradient graded onto the
  physical Preetham dome (`src/materials/skyPosterize.ts`), no longer a
  screen-space cel-era ramp. Day-cycle zenith/horizon colors from
  `src/environment/dayCycle.ts` drive it; the horizon endpoint is aligned to
  fog for a seamless haze transition where fog meets sky.
- Biomes (`src/environment/biomes/registry.ts`) bias toward natural pigment:
  olive/mossy greens, warm earth roads, grey-blue rock. Saturated primaries are
  reserved for gameplay reads (kart liveries, checkpoints, hazards) so they pop
  against the muted natural world (`src/kart/Kart.ts` palette).
- Tundra (nordic) register anchors: overcast zenith `#5f6c7c` / horizon
  `#c4beac`, mist fog `#b6c0c2`, moss `#6e7c4e`, pine `#31503f`, snowline on
  high remote terrain, muted liveries (oxblood `#a8452f`, steel `#41707f`,
  brass accent `#c9a86a`). The tundra terrain table already carries this mood.
- Each biome may swing temperature and value; it may not introduce neon hues or
  unshaded flat fills. Shadow contrast may run deep and natural, but reads as
  sky-lit shade, not a pure-black cutout.

## Atmosphere law

- Aerial perspective: distant world surfaces desaturate and drift toward the
  atmosphere colour (the day-cycle/biome `fogColor`), so the landscape recedes
  cold and blue-grey while the foreground stays saturated. Implemented as a
  shading-only grade behind the `AERIAL` define on world CelMaterials
  (`src/materials/aerial.ts`, [aerial-perspective](/materials/aerial-perspective.md)).
- Height-based / volumetric mist pools in valleys and thins with altitude,
  densest at dawn and dusk, tinted from the same `fogColor` register.
- Atmosphere is data, not a fork: the tint target is `fogColor`, so each biome
  and day-phase carries its own depth register for free (tundra cold mist,
  dusk warmth, night cool-dark) through one shader.
- Aerial rides world surfaces only (terrain, flora); karts stay off it so their
  saturated liveries keep popping as a gameplay read against the muted world.

## UI law

- Menus/overlays keep the biome-neutral editorial field-journal voice
  (`src/ui/menuStyles.ts`): serif masthead, tracked kickers, hairlines, grain,
  accent `#ffd23f`. The journal frames the natural world; it never goes arcade.
- Subtle film grain / lens character may extend from UI into the scene grade to
  unify chrome and world; HUD elements stay grain-free for readability. Grain is
  lens character, not canvas texture.

## Register table (mood presets)

Every biome owns one register: a full mood (sky, fog, sun, plus a livery palette
noted in each biome's register anchors). Registers are per-biome AND per-day-phase
data, never shader or pass forks. Each biome's register lives in its art + vibe
guide under [docs/knowledge/biomes](/biomes/index.md); the guide is also the
vibe contract for future per-biome music/audio.

| Biome     | Sky                               | Fog        | Sun          |
| --------- | --------------------------------- | ---------- | ------------ |
| temperate | deep blue -> cream                | neutral    | warm morning |
| desert    | dusty `#8fb6c8` -> dust `#e8cf9a` | warm dust  | white-hot    |
| alpine    | steel `#4a6a8a`                   | cold slate | hard, clear  |
| tundra    | grey-blue -> khaki                | cold mist  | low, pale    |
| tropical  | amber -> deep blue                | peach      | low amber    |

The default warm baseline is TEMPERATE's register, not a global fallback:
untinted day-cycle tables, deep-blue zenith to cream horizon. The nordic
register is tundra's mood alone: cold mist, mossy greens, snowlines, low
raking sun. Neither leaks into other biomes — every biome owns its own
distinct vibe per its guide ([temperate](/biomes/temperate.md),
[desert](/biomes/desert.md), [alpine](/biomes/alpine.md),
[tundra](/biomes/tundra.md), [tropical](/biomes/tropical.md)).

## Related

- [biome art & vibe guides](/biomes/index.md) — per-biome registers + music direction
- [render-layers](/conventions/render-layers.md) — pass chain the direction rides on
- [cel-material](/materials/cel-material.md) — surface shading mechanics
- [dynamic-sky](/environment/dynamic-sky.md) — sky dome + gradient
- [menu-styles](/ui/menu-styles.md) — editorial journal UI kit
