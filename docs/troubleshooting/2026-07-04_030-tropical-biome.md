# 030 tropical biome — verify log

Date: 2026-07-04
Item: 030 (tropical / jungle biome)
Status: code-verified + live visual capture DONE this pass

## Scope

Fifth biome on the 025 framework. A lush tropical/jungle world: vivid green
rolling relief, palms, ferns, mossy jungle rocks, warm rain, saturated bright
sky, shallow pale-teal water. Registered as pure data into `BIOMES` + the flora
registry; the one non-data piece is the new `warmRain` weather preset (a
heavier + warmer rain variant). No engine change to
heightAt/colorAt/normalAt or to Weather's generic buildField path. Distinct
from temperate/desert/alpine/tundra: tropical is LUSH + WARM (vivid saturated
green field, dense palms/ferns, mossy rock only on steeper grades, warm rain +
clear weather, shallow teal water, deep-blue zenith + warm greenish haze).

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(environment): warmRain weather preset` — `weatherPresets.ts`
   (`WeatherPreset` union += "warmRain"; `WEATHER_PRESET_CONFIG.warmRain`
   heavier+warmer than rain; APPEND to `PRESET_ORDER` after storm, parity-safe);
   `weatherChannels.ts` `WEATHER_CHANNELS.warmRain` (required by the
   `Record<WeatherPreset, ...>` typing — rain-variant channels: dim 1, wind 1.1,
   wetness 1); `Weather.test.ts` + `weatherChannels.test.ts` coverage.
   warmRain rides the generic buildField path (Weather.ts:348 else branch).
2. `feat(environment): tropical flora set` — `flora/tropical.ts` (palm
   big/cylinder bespoke trunk + 2-3 splayed frond cones; jungleRock big/ball
   via ballRock with shared `jungleRockRadius`; fernShrub decor/none via
   lumpyShrub; tropicalFlower decor/none via groundDecor petal); side-effect
   import in PropField; `flora/tropical.test.ts` registration + collider +
   build/dispose + radius determinism.
3. `feat(terrain): register tropical biome` — `BIOMES.tropical` (vivid-green
   terrain overrides, palm/jungleRock/fernShrub/tropicalFlora flora,
   clear/rain/warmRain weather, shallow teal waterColor + waterLevel -2,
   saturated skyFogBias). `biomes.test.ts` + `biomes.registry.test.ts` +
   `biomeValidate.test.ts` updated. Menu picker auto-lists Tropical (fifth
   button) with no UI code change.
4. `docs: 030 tropical troubleshooting` — this file.

## Code-verified (this pass)

- Tropical data: `biomes.test.ts` asserts `BIOMES` now lists tropical; tropical
  flora/weather/waterColor/waterLevel/skyFogBias; `biomeTerrain("tropical")`
  overrides the listed fields (noiseAmp 8, noiseFreq 0.014, sandLevel -2,
  rockSlope 1.1, vivid palette) and keeps the rest at DEFAULT_TERRAIN_CONFIG.
- Flora contract: `flora/tropical.test.ts` — palm/jungleRock big
  (cylinder/ball), fernShrub/tropicalFlower decor (none);
  `jungleRockRadius(seed)` matches its visual's first RNG draw
  `makeRNG(seed).range(0.9,1.8)` (collider tracks the visible bulk); each
  builder produces disposable geometry.
- Validator: `validateBiome(tropical, <full ctx>)` returns ZERO findings (no
  errors, no warns). PALETTE_READABILITY did not fire (road-grass ~0.16,
  grass-rock ~0.13, both > 0.10 floor). Corridor floor (~-1.47) sits above
  waterLevel (-2) so WATER_FLORA_SUNK did not fire. DRIVE_GRADE is
  spline-independent (heightAt on the centerline == spline.y) so biome relief
  can't trip it. `biomeValidate.test.ts` + `biomes.registry.test.ts` green
  (every-shipped-biome loop covers tropical).
- warmRain: `Weather.test.ts` "new presets" build/dispose loop covers warmRain;
  `weatherChannels.test.ts` asserts the warmRain channel + level-0 identity.
  DEFAULT_WEATHER_WEIGHTS has no warmRain key -> clear/rain/snow cumulative walk
  unchanged (parity-safe append after storm).
- Temperate/desert/alpine/tundra parity held: floraParity + all existing
  Environment/StartMenu/Game tests green unchanged (no global flora-registry
  count assertion; adding kinds is safe).
- Full `npm run verify` gate green on all three code commits
  (format -> typecheck -> lint -> lint:secrets -> test -> build -> lint:repo).

## Live-verify (CAPTURED this pass)

Chrome DevTools MCP against `npm run dev` (vite, localhost:5174). Repo rule
forbids committed media, so no PNG is committed; the live console readout below
substitutes for the F3 screenshot (same convention as 026/027/028). Start menu
auto-rendered a fifth biome button ("Tropical") with no UI change; selecting
Tropical + Start rebuilt the whole world menu-time; race ran playable with 5
rivals; player kart rested on the ground (no fall-through).

Captured readout (`window.__game` + F3 StatsHud):

```text
currentBiome   : "tropical"
flowState      : "racing"
terrain        : noiseAmp 8, noiseFreq 0.014, rockSlope 1.1, sandLevel -2
                 colorRoad 0x5e5a3e, colorGrass 0x3f8a3a,
                 colorSand 0xc8b87a, colorRock 0x6a7a5a
waterLevel     : -2            (shallow warm lakes in low pockets)
waterColor     : 0x8fcfc0      (pale teal tint)
weatherWeights : clear .4 / rain .3 / warmRain .3   (warmRain wired into the mix)
weatherPreset  : "clear"       (AUTO started clear this run; level 0)
biomeFogTint   : 0xb8c8a0      (warm greenish haze)
biomeSkyTint   : 0x3a7ad8      (deep blue zenith)
dressingChunks : 119           (streamed per-chunk PropFields)
F3 StatsHud    : FPS 60, FRAME 16.8 ms, CALLS 649, TRIS 175k, GEO 783, TEX 9
```

Confirm: menu shows Temperate + Desert + Alpine + Tundra + Tropical; selecting
Tropical rebuilds terrain + env + field menu-time; vivid jungle reads at speed
(green-dominant, mossy rock only on steeper grades); F3 stays bounded (649 calls
/ 175k tris at 60 FPS — dense flora stays within the draw-call budget, 011).

## Mesh/collider parity invariant

Unchanged. Tropical changes only TerrainConfig VALUES consumed by the shared
heightAt/colorAt; mesh + collider read one HeightSource. Chunk normals author
from one normalAt -> cel bands continuous across seams. Flora jungleRock visual
radius + Rapier ball radius both derive from the shared `jungleRockRadius(seed)`
first RNG draw (delegates to ballRock's radius fn); palm cylinder halfHeight 2.0

- radius 0.5 spans the trunk bulk (y 0..4, the kart-collision zone; the frond
  crown at y~6.4 sits above kart height). Kart drives gap-free; colliders track
  heightAt + flora visuals everywhere (streamed-collider + collider-tracks-visual
  parity green).

## Notes

- Repo rule forbids committed media, so no PNG is committed; the live readout
  block above substitutes for the F3 screenshot (captured this pass).
- warmRain runtime build: the jsdom `Weather.test.ts` new-presets loop proves
  warmRain builds + disposes; the live weights `{clear .4, rain .3, warmRain
.3}` confirm the weighted pick reaches it. The director's `update()` resolves
  the preset config from `WEATHER_PRESET_CONFIG`, so warmRain rides the generic
  buildField path with no Weather.ts edit (verified Weather.ts:348 else branch).
- Flora counts are PER-CHUNK: palm 2, jungleRock 2 (big sum 4 <= 8 cap),
  fernShrub 5, tropicalFlower 8 (dense undergrowth via InstancedMesh decor).
- Terrain tuning (plan-flagged risks): noiseAmp 8 (moderate rolling relief) +
  noiseFreq 0.014; sandLevel -2 (low) so the pale warm sand band reads in the
  low pockets; rockSlope 1.1 (green-dominant — rock only on the steeper
  grades). waterLevel -2 (shallow warm, decoupled from sandLevel via the 025
  fix) sits in the lowest pockets — not flooded (that is swamp/029).
- Palm is visually distinct from temperate's tree + alpine's pine: a bespoke
  tall thin trunk (trunkH 6) + 2-3 splayed frond cones (load-bearing frond
  silhouette for the tropical read — bespoke escape hatch per src/terrain/AGENTS.md;
  canopyTree/coniferTree archetypes cover jungleRock/fernShrub/tropicalFlower).
- Pre-existing (NOT introduced by 030; on origin/main from 053): the kart VFX
  particle fragment shader logs a compile error (`uTime` undeclared identifier,
  KartVfxLayer), so drift/dust/splash/poof particles don't render. Biome-
  independent — reproduces on temperate. Out of scope here; flagged for a
  separate 053 follow-up.

## File budgets

All touched files <= 600 lines; all hand-written lines <= 100 chars.
weatherPresets.ts, weatherChannels.ts, Weather.test.ts, weatherChannels.test.ts
(commit 1); flora/tropical.ts 162, flora/tropical.test.ts 101 (commit 2);
biomes.ts, biomes.test.ts, biomes.registry.test.ts, biomeValidate.test.ts,
PropField.ts (+1 side-effect import) (commit 3).
