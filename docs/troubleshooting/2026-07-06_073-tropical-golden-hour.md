# 073 tropical golden-hour reskin — verify log

Date: 2026-07-06
Item: 073 (tropical golden-hour reskin)
Status: code-verified + data-pinned readout this pass; live re-capture deferred

## Scope

Reskin the tropical biome from the 030 "swampy green bog" into a bright
golden-hour palm shore: sand-dominant beach, sun-bleached (not saturated)
greenery, warm coral/amber sky + warm fog (still dynamic across the day
cycle), teal->deep-blue water via per-biome shallow/deep, warm-biased
sun/ambient light tint, dry warm weather mix, and a palm-forward flora
rebalance. Data + color-only material-uniform plumbing only — no terrain
geometry, no collider, no heightAt, no normals change. Non-tropical biomes
keep identity (new optional bias fields default undefined).

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `cc76181 feat(terrain): warm sand-dominant tropical palette + dry weather`
   — `biomes.ts` tropical terrain colors (bright warm sand, sun-bleached
   grass, warm rock/road), sandLevel 2 (shore-dominant), dry weather weights
   (clear .7 / warmRain .2 / rain .1); `biomes.test.ts`.
2. `317e1ec feat(environment): per-biome water shallow/deep; tropical teal->deep`
   — `biomes.ts` optional `waterShallow`/`waterDeep`; `Environment.ts` wiring
   into WaterOptions; `celWater.ts` sets `uShallow`/`uDeep`; identity default
   for other biomes; `Water.test.ts` shallow/deep -> uniform + ctor-default
   parity.
3. `77dcd12 feat(environment): warm-biased per-biome sky + light tint (golden lean)`
   — `biomes.ts` optional `skyZenithTint`/`skyHorizonTint`/`sunTint`/
   `ambientTint`/`factor` bias fields; `Environment.ts`
   `applyBiomeSkyFogBias` extended (zenith/horizon win over shared skyTint,
   sun/ambient bias light); tropical warm sky/fog/light; non-tropical
   identity asserted.
4. `f26aca6 feat(environment): tropical flora rebalance (more palms, fewer ferns)`
   — `biomes.ts` `TROPICAL_FLORA` counts (palm 4, jungleRock 2, fernShrub 3,
   tropicalFlower 10); big-prop sum 6 <= `MAX_BIG_PROPS_PER_CHUNK 8`.
5. `docs: 073 tropical golden-hour verify log + move to pending-review`
   — this file; backlog open -> pending-review.

## Code-verified (this pass)

- Tropical terrain palette + shore: `biomes.test.ts` asserts
  `biomeTerrain("tropical")` overrides colorRoad `0x9a8258`, colorGrass
  `0x8fae5a`, colorSand `0xe8c896`, colorRock `0x9a7a55`, sandLevel `2`,
  and keeps noiseAmp 8 / noiseFreq 0.014 / rockSlope 1.1 (rest at
  DEFAULT_TERRAIN_CONFIG). Bright warm sand reads shore-dominant, not the
  030 low-pocket olive band.
- Dry warm weather: `biomes.test.ts` asserts tropical weather
  `{ clear: 0.7, warmRain: 0.2, rain: 0.1 }` (was 0.4/0.3/0.3 — dry lean).
- Water shallow/deep: `biomes.test.ts` asserts `waterShallow 0x2db8b8` +
  `waterDeep 0x0a3a55`; `Water.test.ts` proves `{ shallow, deep }` opts
  route to `uShallow`/`uDeep` uniforms, and a default `Water` keeps the
  CelWater ctor defaults (`uShallow 0x2a6a8a`, `uDeep 0x123a52`) — other
  biomes unaffected.
- Warm sky/fog/light bias: `biomes.test.ts` asserts tropical `skyFogBias`
  fogTint `0xffb488`, skyHorizonTint `0xffc78a`, skyZenithTint `0x3a5aa8`,
  sunTint `0xffd0a0`, ambientTint `0xffd9b0`, factor `0.28`.
- Flora rebalance: `biomes.test.ts` asserts tropical flora palm 4 /
  jungleRock 2 / fernShrub 3 / tropicalFlower 10 (palm-forward; big sum 6).
- Non-tropical identity: `biomes.test.ts` "skyFogBias identity" block —
  temperate `skyFogBias` undefined; desert/alpine/tundra keep `fogTint` +
  `skyTint` only with sunTint/ambientTint/skyZenithTint/skyHorizonTint/
  factor ALL undefined. No other biome regressed.
- Validator: `biomeValidate.test.ts` every-shipped-biome loop returns ZERO
  error-level findings for tropical (PALETTE_READABILITY / WATER_FLORA_SUNK
  / DRIVE_GRADE / FLORA_COUNT all clear).
- Full `npm run verify` gate green on all four code commits
  (format -> typecheck -> lint -> lint:secrets -> test -> build ->
  lint:repo). heightAt / trimesh / normals unchanged (color + material
  uniforms only).

## Live-verify

Repo rule forbids committed media, so no PNG is committed; the readout below
substitutes for the F3 screenshot (same convention as 026-030). Interactive
re-capture was deferred this pass (a prior browser session held the Chrome
DevTools MCP profile lock), but every value is pinned by the green test
suite cited above — deterministic from `src/terrain/biomes.ts` source, not
observed live. Unmeasured perf numbers (FPS/calls/tris) are omitted rather
than fabricated.

```text
currentBiome   : "tropical"
flowState      : "racing"
terrain        : noiseAmp 8, noiseFreq 0.014, rockSlope 1.1, sandLevel 2
                 colorRoad 0x9a8258, colorGrass 0x8fae5a,
                 colorSand 0xe8c896, colorRock 0x9a7a55
waterLevel     : -2
waterColor     : 0x8fcfc0
waterShallow   : 0x2db8b8      (-> CelWater uShallow)
waterDeep      : 0x0a3a55      (-> CelWater uDeep)
weatherWeights : clear .7 / warmRain .2 / rain .1   (dry warm lean)
skyFogBias     : fogTint 0xffb488, skyHorizonTint 0xffc78a,
                 skyZenithTint 0x3a5aa8, sunTint 0xffd0a0,
                 ambientTint 0xffd9b0, factor 0.28
flora (per-chunk): palm 4, jungleRock 2 (big sum 6 <= 8),
                    fernShrub 3, tropicalFlower 10
```

## Mesh/collider parity invariant

Unchanged. 073 changes only TerrainConfig VALUES + color-only CelWater
material uniforms (`uShallow`/`uDeep`) consumed by the shared heightAt/
colorAt path. heightAt, the trimesh collider, suspension raycasts, and
chunk normals are untouched; mesh + collider read one HeightSource. Flora
counts stay under `MAX_BIG_PROPS_PER_CHUNK 8`; palm/jungleRock colliders
derive from the same radius fns as the 030 visuals.

## File budgets

All touched files <= 600 lines; all hand-written lines <= 100 chars.
biomes.ts, biomes.test.ts (commits 1-4); Environment.ts, Water.ts,
celWater.ts, Water.test.ts (commits 2-3); this file (commit 5).
