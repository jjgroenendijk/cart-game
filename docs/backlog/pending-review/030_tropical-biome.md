# 030 Biome: Tropical / Jungle

Status: open (full plan; ready for execution)

## Context

Fifth biome on the 025 framework. A lush tropical/jungle world: palms, ferns,
dense undergrowth, warm rain, vivid saturated sky. Mostly pure data on 025's
registry -> a `BiomeDefinition` + a `flora/tropical.ts` set; the one non-data
piece is a new `warmRain` weather preset (heavier + warmer than `rain`). 025
ships the registry, flora registry, weather presets, the menu picker, and world
rebuild; the menu auto-renders one button per `BIOMES` entry so a new biome
appears + live-previews with no UI change.

## Goal

Register a Tropical biome, visually distinct from Temperate + Swamp:

- Terrain: vivid green palette; moderate rolling relief; green-dominant (rock
  only on the steeper grades).
- Flora via archetypes (see src/terrain/AGENTS.md): palm -> coniferTree /
  canopyTree (fronds read as cone/ico lumps) or bespoke if a frond silhouette
  is load-bearing, jungle-rock -> ballRock, fern / tropical-shrub ->
  lumpyShrub / groundDecor (petal); dense undergrowth counts.
- Weather: warm rain + clear; a new `warmRain` preset (heavier, warmer tint).
- Water: shallow warm (pale teal tint) in low pockets; not flooded.
- Sky/fog bias: saturated bright (deep blue zenith, warm greenish haze).

## Non-goals

- Engine changes beyond the `warmRain` preset config (a table entry; `Weather`
  keeps `buildField` unchanged -> warmRain rides the generic config path).
- Per-surface grip (mud slip) -> later item.
- Flooded world (that is swamp/029) -> water stays shallow here.
- Wildlife set -> later item (data; same InstancedMesh child).
- Changing `heightAt`/`colorAt` formula or mesh/collider parity.

## Architecture (change)

```text
src/environment/weatherPresets.ts  # WeatherPreset += "warmRain"; add
                                   # WEATHER_PRESET_CONFIG.warmRain (heavier +
                                   # warm vs rain); APPEND to PRESET_ORDER
                                   # (safe: not in DEFAULT weights -> no parity
                                   # impact). warmRain is NOT parity-bound ->
                                   # generic buildField path, no Weather.ts edit.
src/environment/Weather.test.ts    # newPresets array += "warmRain" so the
                                   # all-presets build/dispose loop covers it.
src/environment/flora/tropical.ts  # NEW: flora via archetypes where possible
                                    # (src/terrain/AGENTS.md). jungleRock ->
                                    # ballRock (shares ballRock radius fn);
                                    # fern / tropicalShrub -> lumpyShrub /
                                    # groundDecor; palm -> coniferTree /
                                    # canopyTree or bespoke if a frond
                                    # silhouette is load-bearing (escape
                                    # hatch). All base-at-y=0, registerFlora'd.
src/environment/flora/tropical.test.ts  # NEW: build/dispose; collider kind per
                                         # kind; ballRock radius parity.
src/terrain/biomes.ts              # ADD BIOMES.tropical: terrain overrides,
                                   # flora counts, weather weights, waterColor,
                                   # waterLevel, skyFogBias.
src/terrain/biomes.test.ts         # registry key list += tropical; add a
                                   # tropical describe block (>=2 big + >=1
                                   # decor; build(seed) disposes).
```

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(environment): warmRain weather preset`
   - `weatherPresets.ts` (type + config + PRESET_ORDER append) +
     `Weather.test.ts` newPresets array. warmRain builds + disposes; weighted
     pick reaches it.
2. `feat(environment): tropical flora set`
   - `flora/tropical.ts` (archetypes + optional bespoke palm) +
     `flora/tropical.test.ts`. Tests: build/dispose, collider kind, ballRock
     radius parity.
3. `feat(terrain): register tropical biome`
   - `biomes.ts` BIOMES.tropical + `biomes.test.ts`. Menu picker now lists
     Tropical (auto).
4. `docs: 030 tropical troubleshooting`
   - F3 + screenshot: vivid jungle + palms + warm rain; shallow teal water;
     distinct vs Temperate + Tundra.

## Risks

- warmRain adds a `WeatherPreset` union member + a `WEATHER_PRESET_CONFIG` key:
  the `Record<Exclude<clear>, config>` forces a config entry at compile time
  (no silent gap). `Weather.test.ts` `newPresets` array MUST add warmRain or the
  all-presets build/dispose loop skips it. PRESET_ORDER append is parity-safe
  (DEFAULT weights enumerate clear/rain/snow only).
- Dense-flora draw-call budget: fern + shrub are InstancedMesh decor (one draw
  per kind per chunk); verify F3 stays bounded (011).
- Warm rain vs race readability: keep the corridor clear; tune fog pull so
  checkpoints + rivals stay visible; verify playability.
- Palm silhouette: trunk + >=2 frond lumps so the cel read holds at distance
  (temperate tree / alpine pine convention).
- jungleRock collider tracks `jungleRockRadius(seed)` so the ball matches the
  visible bulk (PropField.createBody parity).

## Acceptance

- [ ] Tropical selectable in the menu; visually distinct (vivid jungle + palms +
      ferns + warm-rain/clear weather) (1P + 2P)
- [ ] warmRain preset builds + disposes; weighted pick reaches it
- [ ] 2+ big + 1+ decor flora kinds build/dispose; colliders track visuals
- [ ] tropical passes validateBiome with zero errors (gate before merge; see
      src/terrain/AGENTS.md)
- [ ] heightAt/normalAt semantics unchanged; parity invariant holds across
      seams
- [ ] Zero asset files; touched files <= 600 lines
- [ ] `typecheck && lint && test` + hook green
- [ ] F3 + screenshot in `docs/troubleshooting/`

## Defaults

- Palette (sRGB hex): road 0x5e5a3e, grass 0x3f8a3a (vivid), sand 0xc8b87a
  (pale warm), rock 0x6a7a5a (mossy).
- Terrain overrides: noiseAmp ~8, noiseFreq ~0.014, sandLevel -2, rockSlope
  ~1.1 (green-dominant; rock on steeper grades only).
- Flora via archetypes (src/terrain/AGENTS.md): palm -> coniferTree /
  canopyTree or bespoke; jungle-rock -> ballRock; fern / tropical-shrub ->
  lumpyShrub / groundDecor. Per-chunk counts; big sum must pass
  validateBiome's FLORA_COUNT cap (MAX_BIG_PROPS_PER_CHUNK = 8).
- Weather weights: clear .4, rain .3, warmRain .3.
- warmRain config (heavier + warmer than rain): color 0x9a8a78, size 1.6,
  opacity 0.65, fall -28, windFactor 1.1, drift 1.2, fogTint 0x7a6a5a,
  fogNearFactor 0.25, fogFarFactor 0.2.
- Water: shallow warm, level -2, pale teal tint 0x8fcfc0.
- Sky/fog bias: saturated bright (skyTint 0x3a7ad8 deep blue, fogTint 0xb8c8a0
  warm greenish haze).

## Depends on

025 (framework: registry, flora registry, weather presets, menu, rebuild).
Coordinate with OPEN 021 (colorAt palette). Independent of 005-024/037.
