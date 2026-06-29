# 025 biome framework — verify log

Date: 2026-06-29
Item: 025 (biome framework)
Status: code-verified; live visual + F3 verify deferred to review

## Scope

Single-biome-per-session framework: a biome = a TerrainConfig override +
flora set + weather weights + water/sky-fog/wildlife bias. Ships Temperate
(the pre-biome world) as the parity baseline; 026+ biomes are data-only
follow-ons that register into BIOMES + the flora registry. Framework makes
any biome possible without touching engine code.

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `ec7e79b feat(terrain): biome data model + registry` — `biomes.ts`
   (BiomeDefinition/BIOMES/selectBiome/resolveBiome/biomeTerrain); Temperate
   == DEFAULT_TERRAIN_CONFIG. `biomes.test.ts` parity assert.
2. `361b5cf refactor(environment): flora registry + kind-agnostic
sampler/propfield` — `floraRegistry.ts` + `flora/temperate.ts` (builders
   moved byte-identical); propSampler/PropField kind-agnostic via
   `floraFor(kind)`. `floraParity.test.ts` determinism + big/decor
   classification. Temperate placement bit-identical.
3. `c61f510 feat(environment): weather presets + biome-weighted pick` —
   `weatherPresets.ts` (8 presets: clear/rain/snow/fog/sandstorm/blizzard/
   heatHaze/aurora) + weighted `selectWeatherPreset(weights, seed)`. Rain/snow
   particle init unchanged (parity); each new preset builds + disposes.
4. `e057145 feat(ui): biome picker in start menu` — `StartMenu.ts` biome row
   (one button per registered biome, selected highlighted, default temperate)
   - `selectedBiome` + `onStart(mode, biome)`. MenuNav reaches biome buttons.
5. `4db18b5 feat(core): thread biome through Game + world rebuild` —
   `Game.buildWorld`/`rebuildWorld(biome)` (dispose terrain+env+field,
   rebuild with biome, re-prime broadphase); `Environment.biome?` + pure
   `biomeEnvironmentOptions` helper (flora counts + weather weights);
   menu-time only. `Game.biome.test.ts` (mock harness) + `Game.rebuild.test.ts`
   (REAL Rapier: body count returns to baseline over 3 switches — no leak).
6. `493f83f feat(environment): biome water/sky-fog/wildlife bias` — Water
   `uTint` (white=identity); Environment per-frame sky/fog bias (lerp
   fogColor/skyZenith/skyHorizon by 0.2 after DynamicSky, before Weather);
   Wildlife `kinds` (empty set opts out). Temperate = all undefined =
   bit-identical parity.

## Code-verified (this pass)

- Temperate parity: `biomeTerrain("temperate")` == DEFAULT_TERRAIN_CONFIG
  (`biomes.test.ts`); flora placement determinism + big/decor classification
  unchanged (`floraParity.test.ts`); rain/snow weather particle init
  unchanged (`Weather.test.ts`); temperate Environment fan-out ==
  DEFAULT_PROP_COUNTS / DEFAULT_WEATHER_WEIGHTS; biome bias no-op for
  temperate (uTint white, applyBiomeSkyFogBias no-op, wildlife present) —
  `Environment.test.ts`.
- World rebuild no-leak: `Game.rebuild.test.ts` (REAL Rapier) rebuilds the
  world 3x and asserts physics body count returns to baseline each switch
  (no leak). Mocked `Game.biome.test.ts` asserts terrain/env become new
  instances + renderer.terrain rewired + onStart only rebuilds when biome
  differs (temperate->temperate is a no-op).
- Flora/weather extensibility: flora registry register/lookup/throw +
  collider dispatch (`floraRegistry.test.ts`); 8 weather presets each
  build+dispose + weighted pick reaches them (`Weather.test.ts`).
- UI: StartMenu biome picker carries selection into onStart(mode, biome);
  MenuNav reaches biome buttons (`StartMenu.test.ts`).

## Mesh/collider parity invariant

Unchanged. Biome changes only TerrainConfig VALUES (colors/noise/sandLevel)
consumed by the shared heightAt/colorAt; both mesh + collider read one
HeightSource. Documented in `src/AGENTS.md`. Kart drives gap-free across
chunk seams (chunk normals author from one normalAt).

## Live verify deferred to review (manual checklist the reviewer runs)

- `npm run dev`; load the page (expect: no black screen, world renders,
  Temperate).
- Open StartMenu -> biome picker shows Temperate selected.
- Start -> countdown -> race (kart drives, no fall-through).
- Press F3 -> record draw calls / tris / frame ms for Temperate.
- Confirm cel bands continuous across chunk seams (no stripy borders).
- Confirm body count stable. Note these are environment-specific numbers not
  captured here.

## Risks/notes

- rebuildWorld is a menu-time hitch (dispose + rebuild terrain trimesh +
  props) — acceptable at menu, never mid-race.
- skyTint applied per-frame via the mutable dayCycleState skyZenith/
  skyHorizon scratch refs (lerp 0.2).
- wildlife multi-kind dispatch is forward (only birds render today; empty
  set opts out).

## File budgets

All touched files <= 600 lines; all hand-written lines <= 100 chars. Watch
list for future edits near cap: Game.ts (585), PropField.ts (320),
StartMenu.ts (375).
