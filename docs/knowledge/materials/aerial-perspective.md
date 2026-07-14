---
type: Shader
title: Aerial Perspective
description: Distance desaturation + atmosphere tint on world CelMaterials behind the AERIAL define.
tags: [materials, shader, cel-shading, atmosphere, art-direction]
timestamp: 2026-07-14T00:00:00Z
---

# Aerial Perspective

Aerial (atmospheric) perspective is the landscape-painting law that distant
surfaces lose saturation and drift toward the colour of the intervening
atmosphere: warm, saturated foreground; cold blue-grey distance. It is the mood
multiplier the Painted Wilds direction calls for in the Skyrim / Witcher
register — cold mist depth carried by data, not a pass fork.

## Mechanism

A shading-only grade folded into the `CelMaterial` fragment behind the `AERIAL`
define, nested inside the existing `USE_FOG` block (it reuses `fogColor` and
view-space depth). Applied BEFORE the linear haze mix so the world cools with
distance while the far edge still dissolves into full haze.

```glsl
float aerial = smoothstep(uAerialNear, uAerialFar, -vViewPos.z);
float aerialLum = dot(color, vec3(0.2126, 0.7152, 0.0722)); // Rec.709
color = mix(color, vec3(aerialLum), aerial * uAerialDesat);  // desaturate
color = mix(color, fogColor, aerial * uAerialTint);          // atmosphere tint
```

The tint target is `fogColor` — the day-cycle + biome horizon colour three.js
already writes into the fog uniforms each frame — so the atmosphere register is
per-biome and per-day-phase for free: dawn/dusk warm, tundra cold mist, night
cool-dark. Mood stays data; one shader runs every register.

## Uniforms (defaults from `src/materials/aerial.ts` `AERIAL_DEFAULTS`)

| Uniform        | Default | Role                                             |
| -------------- | ------- | ------------------------------------------------ |
| `uAerialNear`  | 45      | View depth where the grade begins ramping in     |
| `uAerialFar`   | 340     | View depth where the grade reaches full strength |
| `uAerialDesat` | 0.5     | Max desaturation toward luminance at full ramp   |
| `uAerialTint`  | 0.35    | Max tint toward `fogColor` at full ramp          |

The ramp starts nearer than the haze (`fogNear` 90) so mid-distance already
cools before geometry fully hazes, and reaches full by the fog far plane. desat
and tint stay < 1 so distance recedes into painterly depth, not a flat grey
wash. Tune the look by editing `AERIAL_DEFAULTS`.

## Pure-math mirror

`src/materials/aerial.ts` exports `applyAerial` / `smoothstep` / `AERIAL_LUMA`,
a WebGL-free TS mirror of the fragment math (posterizeChannel / postGrade
precedent) so jsdom specs assert exact graded values. `src/materials/aerial.test.ts`
covers the ramp, desaturation, and tint; `src/materials/cel.test.ts` asserts the
`AERIAL` define + `uAerial*` uniforms and the fog dependency.

## Ownership

- Opt in via `makeCel({ aerial: true })`. Requires fog: with `fog:false` the
  define and uniforms are dropped (no atmosphere without haze).
- Enabled on WORLD surfaces only: terrain near + far
  (`src/terrain/TerrainChunkManager.ts`) and flora props
  (`src/environment/propFactory.ts`).
- Deliberately OFF on karts. The colour law reserves saturated liveries as a
  gameplay read that pops against the muted, receding world; washing hero and
  rival karts cold at distance would fight legibility.
- Off (default) => no `AERIAL` define, no `uAerial*` uniforms, compiled fragment
  byte-identical to the pre-aerial path.

## Related

- [cel-material](/materials/cel-material.md) — host material + fog path
- [art-direction](/conventions/art-direction.md) — Painted Wilds atmosphere law
- [post-grade](/materials/post-grade.md) — final-pass day-phase grade (sibling
  pure-math mirror pattern)
