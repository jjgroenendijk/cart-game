# 026 Biome: Desert

Status: open (full plan; ready for execution)

## Context

First biome on the 025 framework. A desert world: rolling dunes, sandstone,
cacti, heat haze, rare rain. Pure data on 025's registry -> adds a
`BiomeDefinition` + a `flora/desert.ts` set; no engine change.

025 ships: `BiomeDefinition`/`BIOMES` registry (`biomes.ts`), the flora
registry (`floraRegistry.ts`), weather presets (incl. sandstorm + heatHaze),
the menu picker, and world rebuild. This item registers Desert into all four.

## Goal

Register a Desert biome, visually distinct from Temperate:

- Terrain: pale sand palette; broad low rolling dunes (lower amp, lower freq);
  high sand level (mostly sand surface).
- Flora: cactus (big, cylinder), yucca + dry-shrub (decor), sand-rock (big,
  ball); sparse counts.
- Weather: clear-heavy, occasional sandstorm + heat-haze.
- Water: absent / very low (oasis only); no water plane by default.
- Sky/fog bias: warm pale zenith/horizon; distant haze.

## Non-goals

- Engine changes (all on 025). Mirages / refractive heat distortion -> later.
- Per-surface grip (sand slip) -> later item.

## Architecture (change)

```text
src/environment/flora/desert.ts  # NEW: registerFlora cactus/yucca/dryShrub/
                                 # sandRock (cel geometry, base-at-y=0; cactus
                                 # + sandRock big w/ collider + radius; yucca
                                 # + dryShrub decor). Reuses propFactory
                                 # helpers (prepPart/paintColor/mergeOrFirst).
src/terrain/biomes.ts            # ADD BIOMES.desert: terrain overrides, flora
                                 # counts, weather weights, water (none), sky/
                                 # fog bias.
src/terrain/biomes.test.ts       # desert resolves a full cfg; >=2 big + >=1
                                 # decor kind registered; build(seed) disposes.
```

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(environment): desert flora set`
   - `flora/desert.ts` + registry; tests (build/dispose, collider kind).
2. `feat(terrain): register desert biome`
   - `biomes.ts` BIOMES.desert + tests. Menu picker now lists Desert.
3. `docs: 026 desert troubleshooting`
   - F3 + screenshot: distinct palette/flora/weather vs Temperate; parity
     seams.

## Risks

- Cactus silhouette reads as cel at distance: keep >=2 lump silhouette like the
  temperate tree; verify outline pass.
- Sand palette vs sandLevel interplay (colorAt sand branch): confirm sand shows
  broadly; tune sandLevel + palette together. Coordinate with 021 colorAt work.
- Sparse flora + broad dunes: verify PropField still buckets cleanly (>=1
  mesh/bucket even when sparse).

## Acceptance

- [ ] Desert selectable in the menu; visually distinct (pale dunes + cacti +
      sandstorm/heat-haze weather) (1P + 2P)
- [ ] 2+ big + 1+ decor flora kinds build/dispose; colliders track visuals
- [ ] heightAt/normalAt semantics unchanged; parity invariant holds across
      seams
- [ ] Zero asset files; touched files <= 600 lines
- [ ] `typecheck && lint && test` + hook green
- [ ] F3 + screenshot in `docs/troubleshooting/`

## Defaults

- Palette (sRGB hex): road 0xb39b6e, grass(scrub) 0xc2a14d, sand 0xe3cf8e,
  rock(sandstone) 0xb08d5a.
- Terrain overrides: noiseAmp ~4, noiseFreq ~0.008, sandLevel high (mostly
  sand), rockSlope ~1.1 (sandstone slumps, less bare rock).
- Flora counts: cactus ~60, sand-rock ~50, yucca ~120, dry-shrub ~600 (sparse).
- Weather weights: clear .85, sandstorm .1, heatHaze .05.
- Water: none (level below world). Sky/fog: warm pale (zenith 0x8fb6c8, horizon
  0xe8cf9a); light haze.

## Depends on

025 (framework: registry, flora registry, weather presets, menu, rebuild).
Coordinate with OPEN 021 (colorAt palette). Independent of 005-024/037.
