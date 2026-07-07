# 073 Tropical golden-hour reskin

Status: open (full plan; ready for execution)

## Context

The tropical biome "looks like a swamp". In `src/terrain/biomes.ts` the
`tropical` entry (lines ~205-230) uses a saturated mid-green field
(`colorGrass 0x3f8a3a`), muted olive sand (`colorSand 0xc8b87a`) that rarely
shows because `sandLevel -2` only exposes sand in low pockets, greenish fog
(`skyFogBias.fogTint 0xb8c8a0`), a plain daytime-blue sky
(`skyFogBias.skyTint 0x3a7ad8`), a flat pale-teal water tint
(`waterColor 0x8fcfc0`), and rain-heavy weather (clear 0.4 / rain 0.3 /
warmRain 0.3). Together these read as a wet green bog.

The reference "Palm Shore — Golden Hour" is a bright warm beach: sand-dominant
shore, sun-bleached greenery, warm coral/amber sky, teal->deep-blue water, palms.
The user wants tropical to look like that while keeping a DYNAMIC day/night cycle
(warm-biased, not a locked dusk) so races stay readable. Lighting today varies
only by time-of-day (`src/environment/dayCycle.ts` tables consumed by
`Renderer.applyDayCycle` ~367-396), not by biome; biomes only bias sky/fog tint
via `applyBiomeSkyFogBias()` (`src/environment/Environment.ts:324`,
`BIOME_TINT_FACTOR 0.2`). Water exposes `uShallow`/`uDeep` uniforms in
`src/materials/celWater.ts`, but only `waterColor` -> `uTint` is wired per biome
(`Environment.ts:64-77`).

The palm builder already exists (`src/environment/flora/tropical.ts` `buildPalm`).
The actual sun HALO/bloom comes from 074; this task is the color/water/weather/
flora/light-bias reskin.

## Goal

Make tropical read as a bright golden-hour palm shore, data-first, without
touching terrain geometry or physics:

- Sand-dominant bright beach; sun-bleached (not saturated) greenery.
- Warm coral/amber sky bias + warm fog (still dynamic across the day cycle).
- Teal->deep-blue water via per-biome `shallow`/`deep` (new small plumbing).
- Warm-biased dynamic lighting via an optional per-biome sun/ambient/sky tint
  bias (default-identity for every other biome).
- Dry, warm weather mix; palm-forward flora (fewer swampy ferns).
- `heightAt`, colliders, suspension raycasts, and parity invariants unchanged;
  `validateBiome` stays zero-error.

## Non-goals

- No terrain geometry / collider / `heightAt` changes (pure color + data + a
  color-only material uniform).
- No bloom / sun-halo pass (that is 074).
- No locked time-of-day (keep the dynamic cycle; only warm-bias it).
- No changes to other biomes' appearance (per-biome hooks default to identity).
- No new flora species (rebalance existing palm/fern/flower/rock counts).

## Architecture (change)

```text
src/terrain/biomes.ts          # tropical: warm palette (sand-dominant), raise
                               # sandLevel, sun-bleached grass, warm rock/road;
                               # warm skyFogBias (sky + fog); water shallow/deep
                               # + warm tint; dry weather weights; TROPICAL_FLORA
                               # rebalance (more palm, fewer fern).
src/terrain/biomes.ts          # BiomeDefinition: OPTIONAL waterShallow/waterDeep
                               # + optional warm light/sky bias fields (default
                               # undefined -> identity).
src/terrain/biomes.test.ts     # tropical resolves full cfg; validateBiome zero
                               # errors; other biomes' resolved cfg unchanged.
src/environment/Environment.ts # biomeEnvironmentOptions: pass shallow/deep into
                               # WaterOptions; extend applyBiomeSkyFogBias to
                               # nudge sky zenith/horizon + sun/ambient tint warm
                               # when the biome defines a bias (identity if not).
src/materials/celWater.ts      # set uShallow/uDeep from WaterOptions (uniforms
                               # already exist; only tint was wired before).
```

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(terrain): warm sand-dominant tropical palette + dry weather`
   - `biomes.ts` colors + `sandLevel` + weather weights; `biomes.test.ts`.
2. `feat(environment): per-biome water shallow/deep; tropical teal->deep`
   - `biomes.ts` optional `waterShallow`/`waterDeep`; `Environment.ts` wiring;
     `celWater.ts` uniforms; identity default for other biomes.
3. `feat(environment): warm-biased per-biome sky + light tint (golden lean)`
   - `biomes.ts` optional bias fields; `Environment.ts` `applyBiomeSkyFogBias`
     extension; tropical warm sky/fog/light; assert non-tropical identity.
4. `feat(environment): tropical flora rebalance (more palms, fewer ferns)`
   - `biomes.ts` `TROPICAL_FLORA` counts (respect `MAX_BIG_PROPS_PER_CHUNK 8`).
5. `docs: biomes knowledge + tropical troubleshooting screenshot; move 073`
   - `docs/knowledge/terrain/...`; `docs/troubleshooting/<date>_073-tropical.md`.

## Defaults (sRGB hex)

- Palette: `colorSand 0xe8c896` (bright warm sand), `colorGrass 0x8fae5a`
  (sun-bleached), `colorRock 0x9a7a55` (warm), `colorRoad` warm sand-path
  (~`0x9a8258`).
- Terrain: raise `sandLevel` from `-2` so shore/sand dominates near water; keep
  `noiseAmp 8`/`noiseFreq 0.014` (do not flatten drivable relief).
- Sky/fog bias: `fogTint 0xffb488` (warm, was greenish `0xb8c8a0`); sky lean
  coral/amber (horizon ~`0xffc78a`, zenith warm ~`0x3a5aa8`), applied with a
  slightly stronger bias than the default `0.2` for tropical only.
- Water: `waterShallow 0x2db8b8`, `waterDeep 0x0a3a55`; warm horizon tint.
- Warm light bias: nudge sun/ambient tint warm (small factor) so noon still
  reads golden without going dark; identity for non-tropical.
- Weather weights: clear ~0.7, warmRain ~0.2, rain ~0.1 (was 0.4/0.3/0.3).
- Flora: more `palm`, fewer `fernShrub`; keep big-prop sum under
  `MAX_BIG_PROPS_PER_CHUNK 8`.

## Risks

- Sand-dominant + higher `sandLevel` must not flood the corridor or flatten
  relief — verify drivability and that beach reads as shore, not swamp.
- Warm fog vs checkpoint/rival visibility — tune fog far so the race stays
  readable across the dynamic cycle.
- Per-biome light/sky bias must NOT regress other biomes — assert resolved
  identity in tests.
- `validateBiome` must stay zero-error (flora counts, water level).
- Parity invariants: color-only changes must not alter `heightAt`/normals or
  collider verts.

## Acceptance

- [ ] Tropical reads as a bright golden-hour palm shore (sand-dominant, warm
      sky/fog, teal->deep water, palm-forward) across the dynamic day cycle
      (1P + 2P).
- [ ] Water shows a teal->deep-blue gradient (shallow/deep wired per biome).
- [ ] Sky/fog/light warm-biased for tropical; other biomes visually unchanged
      (identity assertions pass).
- [ ] Weather is dry/warm-biased; race stays readable.
- [ ] `heightAt`/normals/colliders unchanged; parity holds across seams;
      `validateBiome` zero errors.
- [ ] Zero asset files; touched files `<= 600` lines; lines `<= 100` chars.
- [ ] `npm run verify` + hooks green.
- [ ] F3 + screenshot in `docs/troubleshooting/`.

## Verification

- `npm run dev`, select Tropical; F3 sweep across dawn/day/dusk — confirm warm
  sky/fog, bright sand shore, teal->deep water, palm-forward dressing, readable
  race. Confirm a different biome (e.g. Alpine) is visually unchanged (A/B).
- Drive a lap: corridor stays dry/drivable; checkpoints visible under warm fog.
- `npm run test` for `biomes.test.ts` (tropical cfg + non-tropical identity);
  `npm run verify:changed` per commit.

## Depends on

074 for the actual sun HALO (bloom) — the color/water/weather/light reskin here
is independent and can land first. Coordinate with pending-review 030 (tropical),
062 (water shore foam/depth tint), 042 (time-of-day config), and 025 (biome
framework). Independent of 072.
