# 025 Biome framework + temperate baseline

Status: open (full plan; ready for execution)

## Context

Today the world is one hardcoded biome, pinned at four spots:

- `heightmap.ts:28-41` `DEFAULT_TERRAIN_CONFIG`: one temperate profile (grass/
  road/rock/sand palette, one simplex hill field, fixed sandLevel/rockSlope).
  `colorAt` (`:156-192`) branches hard on sand/rock/road/grass.
- `propFactory.ts:25-32,42-82`: one temperate flora set (tree/rock/bush/
  flower/grass).
- `propSampler.ts:18` `PropType` is a fixed string union; `PropField.ts:33-71`
  hardcodes `BIG_TYPES`, `DECOR_BUILDERS`, `DEFAULT_PROP_COUNTS`. No plug point
  for cactus/pine/palm/mangrove/basalt.
- `Weather.ts:17,41-47`: `WeatherPreset` = clear|rain|snow; global weighted
  pick; biome-agnostic.

Already biome-shaped (free wins):

- `TerrainConfig` (`heightmap.ts:4-26`) is data-driven; a biome is mostly a
  `Partial<TerrainConfig>` override. `Terrain.ts:23-36,77` already merges
  `{...DEFAULT_TERRAIN_CONFIG, ...opts.config}`.
- `EnvironmentOptions` (`Environment.ts:12-20`) is option-driven; Game just
  does not pass a biome (`Game.ts:74-77`).
- 010 weather, 017 wildlife, 014 clouds, dayCycle fog/sky tints
  (`dayCycle.ts:51-88`) are data-fed -> biome bias is data, not engine.
- Menu: `StartMenu` (`StartMenu.ts:139-252`) has a `modeButton` cycle pattern
  - `MenuNav` vertical arrow/gamepad nav + `onStart(mode)`; a biome list
    mirrors it and `onStart` grows to carry the chosen biome.

Gaps this item closes:

- `Game.ts:70-78` builds Terrain + Environment once in the ctor; `:184-185`
  disposes them only on `Game.dispose()`. The proven rebuild path
  (`Game.onStart:266-278` -> `field.dispose()` + `field.build()`) rebuilds ONLY
  the kart field (`FieldBuilder.ts:186-200`). A biome switch needs a new
  world-rebuild (dispose terrain + env + field, rebuild with the chosen biome).
  Shared with 020 (circuit change needs the same) -> extract once.
- Flora is not extensible: generalize propSampler + PropField + propFactory
  off the fixed `PropType` union onto a kind registry.
- No menu surface to pick a biome.

Scope decision: the user picks ONE biome per session in the menu (a
single-biome world). A biome = a TerrainConfig override + flora set + weather
weights + water/sky-fog bias + wildlife set. This item is the framework that
makes any biome possible AND ships Temperate (the current world, refactored
into the registry) as the parity baseline. Each further biome is its own small
follow-on item (026+). A blended multi-biome world is out of scope (would be a
later item; not needed for menu selection).

Constraints, resolved against code:

- One shared `heightAt`/`colorAt` (`src/AGENTS.md:71`); biome changes only the
  TerrainConfig VALUES -> formula + semantics unchanged.
- Mesh + collider verts identical by construction (`src/AGENTS.md:74`); both
  consume one heightAt -> holds for any biome.
- `rockRadius(seed)` shared visual + collider (`propFactory.ts:57-59`); the
  flora registry generalizes this to a per-kind `colliderRadius(seed)`.
- Zero committed media (repo rule): all flora/weather is procedural cel +
  Points, no assets.
- File caps: PropField 300, propFactory 241, propSampler 173, Weather 213 ->
  room; per-biome flora splits into `src/environment/flora/<biome>.ts`.

## Goal

- Pure `BiomeDefinition` record + `BIOMES` registry + `selectBiome` +
  `resolveBiome`, exported from a pure `biomes.ts` (jsdom-testable).
- Flora registry: `FloraKind = string` + `registerFlora(kind, {build, big,
collider, radius})`. propSampler/PropField become kind-agnostic. Move the
  existing tree/rock/bush/flower/grass to `flora/temperate.ts`
  (behavior-identical).
- Weather extension: presets += fog|sandstorm|blizzard|heatHaze|aurora;
  weighted `selectWeatherPreset(weights, seed)` (pure). All presets land here
  so biome items only set weight tables.
- Menu biome picker: a biome list row in `StartMenu` (MenuNav nav), selected
  biome highlighted, carried into `onStart(mode, biome)`; default Temperate.
- World rebuild: `Game.rebuildWorld(biome)` (dispose terrain + env + field,
  rebuild with biome, re-prime broadphase). Wired to the menu pick (never
  mid-race).
- Thread biome through Game -> Terrain (config) + Environment (flora, weather,
  water, sky/fog bias, wildlife).
- Ship Temperate as the first registered biome (parity with today).

## Non-goals

- Asset-based biomes (zero-asset rule; all procedural).
- Changing `heightAt`/`colorAt` formula or the mesh/collider parity invariant.
  Biome changes VALUES only.
- Replacing 010 weather wholesale (extend it; keep the seeded-pick contract).
- Per-surface grip (ice/snow slip) -> needs heightmap-driven friction; later.
- Blended multi-biome world (menu selects 1 biome; blending is a later item).
- A dedicated select screen (020 owns that later; for now the picker lives in
  StartMenu and 020 absorbs it).
- Procedural circuit generation (concept/037; biomes compose with a circuit
  but do not own track generation).

## Architecture (change)

```text
src/terrain/
  biomes.ts            # NEW PURE: BiomeDefinition, BiomeId, FloraEntry,
                       # BiomeWeather, BIOMES registry, selectBiome(seed),
                       # resolveBiome(id?), biomeTerrain(id). Temperate =
                       # current DEFAULT_TERRAIN_CONFIG. jsdom-testable.
  biomes.test.ts       # NEW: registry completeness; selectBiome determinism
                       # + coverage; temperate == current defaults (parity);
                       # every biome resolves a full terrain cfg.
  heightmap.ts         # UNCHANGED (reads cfg as today). colorAt stays.
src/environment/
  floraRegistry.ts     # NEW PURE: FloraKind = string; FloraBuilder { build(
                       # seed): BuiltProp; big: boolean; collider:
                       # "cylinder"|"ball"; radius?(seed) }; registerFlora +
                       # floraFor(kind). jsdom-testable.
  flora/temperate.ts   # NEW: register tree/rock/bush/flower/grass (moved from
                       # propFactory.ts) -> behavior-identical.
  propFactory.ts       # SHRINK to shared helpers (prepPart/paintColor/
                       # mergeOrFirst) + re-export; rockRadius + ROCK_BURY
                       # stay (shared visual + collider).
  propSampler.ts       # PropType -> FloraKind (string); PropLayer.kind.
  PropField.ts         # Kind-agnostic: drop hardcoded BIG_TYPES +
                       # DECOR_BUILDERS; read big/collider/radius from the
                       # registry. spawnBigBucket/spawnDecor/createBody
                       # dispatch via floraFor(kind). Per-biome counts via
                       # PropFieldOptions.counts (already supported).
  Weather.ts           # WeatherPreset += fog|sandstorm|blizzard|heatHaze|
                       # aurora; selectWeatherPreset(weights, seed) (pure);
                       # buildField branches per preset. If >600, extract a
                       # pure weatherPresets.ts table; Weather stays GL owner.
  Water.ts             # WaterOptions += color?; CelWaterMaterial tint uniform
                       # (biome water). Default = today (no tint).
  Environment.ts       # EnvironmentOptions += biome?: BiomeId|BiomeDefinition.
                       # ctor resolves it, fans terrain cfg to PropField
                       # counts, Weather weights/preset, Water color/level,
                       # sky/fog bias, wildlife set.
  Environment.test.ts  # biome fan-out asserts (counts/weights/color routed).
src/ui/
  StartMenu.ts         # ADD a biome list row (one button per registered
                       # biome; selected highlighted). selectedBiome getter.
                       # MenuNav elements() includes the biome buttons.
                       # onStart grows to (mode, biome). Default = temperate.
  StartMenu.test.ts    # biome pick carried into onStart; nav reaches biomes.
src/core/
  Game.ts              # ctor resolves menu -> biome (default temperate) ->
                       # Terrain (config) + Environment (biome). NEW
                       # rebuildWorld(biome): dispose terrain + env + field,
                       # rebuild all three, re-prime broadphase (field.build
                       # primes), reset menu cam target. onStart calls
                       # rebuildWorld(chosenBiome) when the biome differs.
                       # Never mid-race.
  Game.test.ts         # rebuildWorld restores body count to baseline (no
                       # leak); temperate bit-identical when biome unset.
  FieldBuilder.ts      # No change (terrain/env owned by Game; world rebuild
                       # in Game). FieldBuilder dispose/build unchanged.
```

## Contracts with 001-024

- 001: none (biome flora reuse CelMaterial + vertexColors; same cel pipeline).
- 002/010/014: biome ships sky/fog tint bias + weather weights fed INTO 010's
  dayCycle/weather; no sky-engine change.
- 003: consumes heightAt/colorAt/SplineFieldCache unchanged; biome retunes
  TerrainConfig values only.
- 004: PropField/flora registry is the core refactor; disposition + Rapier
  bodies + bucketing unchanged. Per-kind colliderRadius generalizes
  rockRadius.
- 005/009/015: none.
- 006: biome picker lives in StartMenu; phase gating unchanged (rebuildWorld
  at menu -> countdown, never mid-race).
- 007/008: rivals/humans drive biome terrain (same heightAt, parity holds).
- 011: F3 StatsHud = verify readout across biomes + body count after a switch.
- 017: wildlife set per biome (data; same InstancedMesh child).
- 018: water level per biome (cfg.sandLevel); buoyancy unchanged.
- 019: chunks reuse one HeightSource; biome retunes the cfg it reads.
- 020 (OPEN): track select + biome are select dimensions; SHARED world-rebuild
  (both need dispose + rebuild terrain + env + field on a select change) ->
  extract once, reuse.
- 021 (OPEN): colorAt palette + 021's smoothstep share `heightmap.ts` colorAt.
  COORDINATE: sequence 025 after 021 (or merge the colorAt change).
- 023 (OPEN): independent now (biome = single-biome world; 023 just streams
  it).
- 024 (OPEN kart variant): none (orthogonal select dimension).
- 026+ (biome items): each DEPENDS on 025; each is data (flora set + palette +
  weather weights + bias) registering into BIOMES + the flora registry.

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(terrain): biome data model + registry`
   - `biomes.ts` + `biomes.test.ts`. Temperate == current DEFAULT_TERRAIN_CONFIG
     (parity assert).
2. `refactor(environment): flora registry + kind-agnostic sampler/propfield`
   - `floraRegistry.ts`; move temperate builders to `flora/temperate.ts`;
     shrink `propFactory.ts`. propSampler PropType -> FloraKind; PropField
     kind-agnostic. Tests: temperate placement golden vs pre-refactor; collider
     kind dispatch.
3. `feat(environment): weather presets + biome-weighted pick`
   - `Weather.ts` fog/sandstorm/blizzard/heatHaze/aurora + weighted
     selectWeatherPreset(weights, seed). Tests: distribution + reachability;
     each preset builds + disposes.
4. `feat(ui): biome picker in start menu`
   - `StartMenu.ts` biome list row + selectedBiome + onStart(mode, biome);
     MenuNav reaches biomes. Tests: pick carried into onStart.
5. `feat(core): thread biome through Game + world rebuild`
   - `Game.ts` resolve menu -> biome -> Terrain config + Environment(biome);
     `rebuildWorld(biome)`. `Environment.ts` biome fan-out + tests. Tests:
     rebuild restores body count to baseline (no leak over 3 switches);
     temperate bit-identical when unset.
6. `feat(environment): biome water/sky-fog/wildlife bias`
   - `Water.ts` color option; Environment applies biome sky/fog tint bias +
     water color + wildlife set. Tests: bias routed; defaults unchanged.
7. `docs: refine 025 plan + todo + troubleshooting`
   - mark 025 full plan in `docs/todo.md`; troubleshooting case (F3: draw
     calls/tris/ms; body count before vs after a Temperate rebuild; no black
     screen; parity across chunk seams).

## Risks

- Flora refactor touches PropField (300) + propSampler (173) + propFactory
  (241): placement drift risk. Mitigation: golden temperate placement test vs
  pre-refactor; identical algorithm + seeds; only the kind label + builder
  source move.
- World-rebuild hitch (dispose + rebuild terrain trimesh + all props on
  switch). Acceptable at menu (not mid-race); mirror field.build broadphase
  prime. Verify F3 frame ms + body count returns to baseline.
- Weather near 600 with 5 new presets: extract a pure weatherPresets.ts table
  if it crosses; keep Weather as the GL/Points owner.
- 021 coordination: colorAt palette + 021's smoothstep share colorAt. Sequence
  025 after 021 (or merge). Documented dependency.
- 020 coordination: shared world-rebuild -> agree the Game API so 020's
  circuit change + 025's biome change both call rebuildWorld.
- Determinism: flora seeds stable so a re-pick reproduces the world. Test.
- Strict TS noUnusedLocals: every biome record field used; `_`-prefix unused.

## Acceptance

- [ ] Framework compiles; Temperate registered + bit-identical to today (golden
      placement + parity asserts green) (1P + 2P)
- [ ] Flora registry kind-agnostic; PropField/propSampler build/dispose any
      kind
- [ ] New weather presets build + dispose; weighted pick drives selection
- [ ] StartMenu biome picker selects + carries the choice into onStart; MenuNav + gamepad reach it
- [ ] Biome switch rebuilds the whole world; physics body count returns to
      baseline (no leak over 3 switches); never runs mid-race
- [ ] heightAt/normalAt/waterLevel semantics unchanged; mesh/collider parity
      invariant holds; kart drives gap-free across chunk seams
- [ ] Zero asset files; all touched files <= 600 lines
- [ ] `typecheck && lint && test` + hook green
- [ ] F3 readout in `docs/troubleshooting/`: draw calls/tris/frame ms; body
      count before vs after a switch; no black screen; parity seam check

## Defaults

- BiomeDefinition fields default from Temperate (= current DEFAULT_TERRAIN_CONFIG
  - current flora counts + 010 weather weights).
- Menu: biome list row in StartMenu; default selected = temperate.
- rebuildWorld: menu -> countdown only; never mid-race.
- Weather weight tables live on each BiomeDefinition (biome items set them).

## Previous implementation

None. Built on 010 (Weather), 003/019 (heightmap + chunks + HeightSource), 004
(PropField/flora + propSampler), 017 (Wildlife), 014 (Clouds tint), 006
(StartMenu + MenuNav), dayCycle (`dayCycle.ts:51-88`). Seeding: hashSeed/makeRNG
(`rng.ts:58-84`).

## Depends on

000 (harness). 003 (heightmap/colorAt/TerrainConfig). 004 (PropField/flora/
sampler). 006 (StartMenu + MenuNav). 010 (Weather -> extended). 019 (chunks +
HeightSource). Coordinate with OPEN 021 (colorAt palette -> recommend 025 lands
after 021). Composes with OPEN 020 (select + shared world-rebuild) and concept
037 (procedural circuits: a generated circuit + a chosen biome = a track).
Independent of 005/007-009/012/014-018/023/024. 026+ biome items depend on THIS
item.
