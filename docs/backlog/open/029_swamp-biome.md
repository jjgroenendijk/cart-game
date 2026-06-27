# 029 Biome: Swamp

Status: open (full plan; ready for execution)

## Context

Fourth biome on the 025 framework. A swamp/wetland: bogs, marsh, mud, mangrove
roots, reeds, fog, low visibility (the Velen + Crookback Bog vibe). Pure data
on 025's registry -> adds a `BiomeDefinition` + a `flora/swamp.ts` set; no
engine change. 025 ships the registry, flora registry, weather presets (incl.
fog), the menu picker, and world rebuild.

## Goal

Register a Swamp biome, visually distinct from Temperate:

- Terrain: murky palette; low flat relief (low amp); HIGH sand level ->
  flooded (water plane covers most of the world; karts buoyant under 018).
- Flora: mangrove (big, cylinder, root skirt), cattail (decor), moss-rock (big,
  ball); dense reeds near water.
- Weather: rain/fog-heavy, low visibility.
- Water: HIGH level (flooded), murky green tint; buoyancy active (018).
- Sky/fog bias: dim, greenish, low visibility.

## Non-goals

- Engine changes (all on 025).
- Per-surface grip (mud slip) -> later item.
- Deep-water swimming physics -> 018 buoyancy only.

## Architecture (change)

```text
src/environment/flora/swamp.ts  # NEW: registerFlora mangrove/cattail/mossRock
                                # (cel geometry, base-at-y=0; mangrove +
                                # mossRock big w/ collider + radius; cattail
                                # decor). Mangrove gets a root skirt.
src/terrain/biomes.ts           # ADD BIOMES.swamp: terrain overrides, flora
                                # counts, weather weights, water (high), sky/
                                # fog bias.
src/terrain/biomes.test.ts      # swamp resolves a full cfg; >=2 big + >=1
                                # decor kind registered; build(seed) disposes.
```

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(environment): swamp flora set`
   - `flora/swamp.ts` + registry; tests (build/dispose, collider kind).
2. `feat(terrain): register swamp biome`
   - `biomes.ts` BIOMES.swamp + tests. Menu picker now lists Swamp.
3. `docs: 029 swamp troubleshooting`
   - F3 + screenshot: flooded + murky + reeds; buoyancy drain/recover playable
     (018); low-visibility fog.

## Risks

- Flooded world vs drivability: high water level must not make the race
  unplayable (018 buoyancy drains life). Tune water level so the corridor stays
  mostly dry; verify life drain/recover loop.
- Low visibility (fog) vs race readability: tune fog far so checkpoints +
  rivals stay visible enough; verify playability.
- Mangrove root skirt collider: keep the cylinder collider simple (trunk only)
  so it is fair; roots are visual.

## Acceptance

- [ ] Swamp selectable in the menu; visually distinct (flooded bog +
      mangroves + reeds + fog/rain weather) (1P + 2P)
- [ ] 2+ big + 1+ decor flora kinds build/dispose; colliders track visuals
- [ ] heightAt/normalAt semantics unchanged; parity invariant holds across
      seams; buoyancy (018) drain/recover playable
- [ ] Zero asset files; touched files <= 600 lines
- [ ] `typecheck && lint && test` + hook green
- [ ] F3 + screenshot in `docs/troubleshooting/`

## Defaults

- Palette (sRGB hex): road 0x5a4a32 (mud), grass 0x4a5a3a (murky), sand(mud)
  0x6a5a3a, rock(mossy) 0x5a5a4a.
- Terrain overrides: noiseAmp ~3, noiseFreq ~0.012, sandLevel HIGH (flooded),
  rockSlope ~0.9.
- Flora counts: mangrove ~80, moss-rock ~50, cattail ~1200 (dense reeds).
- Weather weights: clear .4, rain .4, fog .2.
- Water: HIGH level (flooded), murky green tint 0x3a4a3a. Sky/fog: dim greenish
  (zenith 0x4a5a5a, horizon 0x6a6a4a).

## Depends on

025 (framework: registry, flora registry, weather presets, menu, rebuild). 018
(water buoyancy + life bar). Coordinate with OPEN 021 (colorAt palette).
Independent of 005-017/019-024/037.
