# 028 Biome: Alpine

Status: open (full plan; ready for execution)

## Context

Third biome on the 025 framework. An alpine world: high snowy peaks, pine
forests, granite cliffs, thin cold air. Pure data on 025's registry -> adds a
`BiomeDefinition` + a `flora/alpine.ts` set; no engine change. 025 ships the
registry, flora registry, weather presets (incl. blizzard), the menu picker,
and world rebuild. Distinct from Tundra (027): alpine is vertical (peaks +
cliffs), tundra is flat (plains).

## Goal

Register an Alpine biome, visually distinct from Temperate + Tundra:

- Terrain: granite palette; HIGH amplitude mountains (high amp, moderate freq);
  rock shows on steep cliffs (lower rockSlope).
- Flora: alpine-pine (big, cylinder), scree-rock (big, ball), lichen-bush
  (decor); treeline density (denser low, sparse high).
- Weather: clear/snow-heavy, occasional blizzard.
- Water: cold mountain lakes (low level, pale tint).
- Sky/fog bias: cold thin air; peaks clear above the fog.

## Non-goals

- Engine changes (all on 025).
- Per-surface grip (ice slip) -> later item.

## Architecture (change)

```text
src/environment/flora/alpine.ts  # NEW: registerFlora alpinePine/screeRock/
                                 # lichenBush (cel geometry, base-at-y=0;
                                 # alpinePine + screeRock big w/ collider +
                                 # radius; lichenBush decor).
src/terrain/biomes.ts            # ADD BIOMES.alpine: terrain overrides, flora
                                 # counts, weather weights, water, sky/fog bias.
src/terrain/biomes.test.ts       # alpine resolves a full cfg; >=2 big + >=1
                                 # decor kind registered; build(seed) disposes.
```

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(environment): alpine flora set`
   - `flora/alpine.ts` + registry; tests (build/dispose, collider kind).
2. `feat(terrain): register alpine biome`
   - `biomes.ts` BIOMES.alpine + tests. Menu picker now lists Alpine.
3. `docs: 028 alpine troubleshooting`
   - F3 + screenshot: distinct relief (peaks) + flora vs Temperate/Tundra;
     parity across chunk seams on steep terrain.

## Risks

- High amplitude -> steep trimesh: verify kart climbs/drives the grades + ray
  parity holds on cliffs (019 invariant). Collider parity by construction.
- Peaks vs fog/ceiling: keep peaks above the fog band so summits read; verify.
- Denser geometry cost: high amp may need more verts to read -> verify F3 tris.

## Acceptance

- [ ] Alpine selectable in the menu; visually distinct (peaks + pines +
      cliffs + blizzard/snow weather) (1P + 2P)
- [ ] 2+ big + 1+ decor flora kinds build/dispose; colliders track visuals
- [ ] heightAt/normalAt semantics unchanged; parity invariant holds across
      seams, including steep cliffs
- [ ] Zero asset files; touched files <= 600 lines
- [ ] `typecheck && lint && test` + hook green
- [ ] F3 + screenshot in `docs/troubleshooting/`

## Defaults

- Palette (sRGB hex): road 0x6e6256, grass 0x4f7a3a, sand 0xc2b280, rock
  (granite) 0x8a8a92.
- Terrain overrides: noiseAmp ~14, noiseFreq ~0.01, noiseOctaves ~4, rockSlope
  ~0.7 (rock shows on cliffs).
- Flora counts: alpine-pine ~90, scree-rock ~80, lichen-bush ~200.
- Weather weights: clear .55, snow .35, blizzard .1.
- Water: cold lakes (low level, pale tint 0xaec4cc). Sky/fog: cold thin
  (zenith 0x4a6a8a, horizon 0xb8c4cc).

## Depends on

025 (framework: registry, flora registry, weather presets, menu, rebuild).
Coordinate with OPEN 021 (colorAt palette). Independent of 005-024/037.
