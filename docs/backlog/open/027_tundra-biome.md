# 027 Biome: Tundra

Status: open (full plan; ready for execution)

## Context

Second biome on the 025 framework. A frozen tundra: flat snowy plains, ice,
pines, blizzards. Pure data on 025's registry -> adds a `BiomeDefinition` + a
`flora/tundra.ts` set; no engine change. 025 ships the registry, flora
registry, weather presets (incl. blizzard), the menu picker, and world rebuild.

## Goal

Register a Tundra biome, visually distinct from Temperate:

- Terrain: pale snow palette; low flat relief with drifts (low amp, moderate
  freq); frozen surface (sand shows as exposed ground/ice).
- Flora: pine (big, cylinder), snow-bush (decor), ice-rock (big, ball); sparse
  counts.
- Weather: clear/snow-heavy, occasional blizzard.
- Water: frozen (low level, pale tint); buoyancy still works under it.
- Sky/fog bias: cold pale overcast; low contrast.

## Non-goals

- Engine changes (all on 025).
- Per-surface grip (ice slip) -> later item.

## Architecture (change)

```text
src/environment/flora/tundra.ts  # NEW: registerFlora pine/snowBush/iceRock
                                 # (cel geometry, base-at-y=0; pine + iceRock
                                 # big w/ collider + radius; snowBush decor).
src/terrain/biomes.ts            # ADD BIOMES.tundra: terrain overrides, flora
                                 # counts, weather weights, water, sky/fog bias.
src/terrain/biomes.test.ts       # tundra resolves a full cfg; >=2 big + >=1
                                 # decor kind registered; build(seed) disposes.
```

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(environment): tundra flora set`
   - `flora/tundra.ts` + registry; tests (build/dispose, collider kind).
2. `feat(terrain): register tundra biome`
   - `biomes.ts` BIOMES.tundra + tests. Menu picker now lists Tundra.
3. `docs: 027 tundra troubleshooting`
   - F3 + screenshot: distinct palette/flora/weather vs Temperate + Desert.

## Risks

- Low-amp snow relief flattens cel bands: keep enough amplitude for readable
  shading; verify F3 tri count stays bounded.
- Blizzard fog + low visibility: tune fog pull so the kart/corridor stay
  readable; verify race is playable in a blizzard.
- Pale palette vs snow band: snow shows broadly; tune sandLevel + palette.

## Acceptance

- [ ] Tundra selectable in the menu; visually distinct (snow plains + pines +
      blizzard/snow weather) (1P + 2P)
- [ ] 2+ big + 1+ decor flora kinds build/dispose; colliders track visuals
- [ ] heightAt/normalAt semantics unchanged; parity invariant holds across
      seams
- [ ] Zero asset files; touched files <= 600 lines
- [ ] `typecheck && lint && test` + hook green
- [ ] F3 + screenshot in `docs/troubleshooting/`

## Defaults

- Palette (sRGB hex): road 0x8a8a8a, grass(snow-grass) 0xd8e0d8, sand 0xc2b280,
  rock 0x9aa0a8.
- Terrain overrides: noiseAmp ~3, noiseFreq ~0.014, sandLevel low, rockSlope
  ~0.9.
- Flora counts: pine ~70, ice-rock ~60, snow-bush ~150 (sparse).
- Weather weights: clear .5, snow .35, blizzard .15.
- Water: frozen (low level, pale tint 0xb8d0d8). Sky/fog: cold pale (zenith
  0xb8c4cc, horizon 0xd8dde0).

## Depends on

025 (framework: registry, flora registry, weather presets, menu, rebuild).
Coordinate with OPEN 021 (colorAt palette). Independent of 005-024/037.
