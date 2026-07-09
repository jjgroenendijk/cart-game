# 082 Warm line color (sepia / near-iron)

Status: open (concept - to be refined)

## Context

Flagged as open work by the Painted Wilds art direction
(`docs/knowledge/conventions/art-direction.md`, line law). The direction
targets a WARM dark line, not pure black: sepia `#3a2f28` for warm
registers (Ghibli/BotW) and near-iron `#2e2a26` for nordic ones
(Skyrim/Witcher), fading with distance on the terrain Sobel pass. Today
both outline systems are pure black:

- Inverted-hull shells on karts/props (`src/materials/outline.ts`) emit a
  hard-coded `vec4(0.0, 0.0, 0.0, 1.0)` in the fragment shader — no color
  uniform at all.
- Terrain Sobel pass (`src/materials/postOutline.ts`) already has a
  `uLineColor` uniform mixed via `mix(color, uLineColor, edge)`, but its
  default is `0x000000` and nothing drives it from the register table.

The art-direction doc states the rule: new code must take the line color
from the register table rather than hard-coding black, and the current
black defaults are the retuning target.

## Goal (to refine)

Both outline systems read their line color from the mood register (warm
sepia vs nordic near-iron, per biome + day phase), not a hard-coded
black. The terrain Sobel line additionally fades with distance so far
silhouettes soften into haze (a painted, not inked, edge). Cel/kart
outlines stay crisp up close.

Candidate shape:

- `outline.ts`: add a `uLineColor` uniform (replace the hard-coded black
  emit); driven per-frame like the other `lightUniforms`.
- `postOutline.ts`: drive the existing `uLineColor` from the register;
  add a distance/depth-based fade to the edge mix.
- A register lookup (biome + day phase -> line color) feeding both, so
  one source owns warm vs nordic.

## Needs refinement

- Register source: does the line color live in the biome table, the
  day-phase table, or a blend of both (like the sky/fog registers)?
  Art-direction's register table names warm vs nordic per knob.
- Distance-fade model on the Sobel pass: linear depth lerp toward fog
  color, or toward the line color itself? Verify it still reads as an
  outline at mid-distance and dissolves cleanly at the far plane.
- Parity: temperate + the four shipped biomes change look (black -> warm
  line). That is intended; confirm it reads neutral, not muddy, on each.
- 2P split-screen: both views share the same register-driven uniform;
  confirm no per-slot divergence is needed.
- Identity path: is a `0x000000` register value a documented escape
  hatch, or is warm always-on?

## Depends on

`docs/knowledge/conventions/art-direction.md` (the line-law contract),
both outline systems (`src/materials/outline.ts`,
`src/materials/postOutline.ts`), the biome + day-phase register tables
(`src/terrain/biomes.ts`, `src/environment/dayCycle.ts`). Independent of
074 (074 keeps outlines; this retunes their color).
