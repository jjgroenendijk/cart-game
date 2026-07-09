# 055 Biome authoring kit: flora archetypes, validation, auto coverage

Status: pending-review

## Context

The 025 framework made a biome pure data (`terrain/biomes.ts`:
`BiomeDefinition` = terrain overrides + flora counts + weather weights +
water + skyFogBias + wildlife) and it works - four biomes shipped with
zero engine change. But scaling it is about to get expensive: eight biome
stubs are queued (029-036), and each biome today costs two things the
framework does not help with:

- A bespoke flora module. `flora/temperate.ts` 191 lines, `desert.ts` 194,
  `alpine.ts` 156, `tundra.ts` 159 - ~700 lines of hand-built primitive
  geometry for what are structurally the same four archetypes over and
  over: a canopy-on-trunk tree (tree/alpinePine/pine), a ball rock
  (rock/sandRock/screeRock/iceRock), a lumpy shrub (bush/dryShrub/
  lichenBush/snowBush), and flat ground decor (flower/grass). The queued
  stubs repeat them again (palm, cypress, autumn-tree, basalt-rock...).
  Eight more biomes at this rate is ~1400 lines of near-duplicate
  geometry code written by juniors without the original author.
- Unvalidated data. Nothing checks a `BiomeDefinition` beyond TypeScript
  shapes. Every stub's "Needs refinement" list repeats the same risks:
  relief vs drivability (031), palette vs rockSlope readability (031),
  flora below water (043, an actual shipped bug class), unknown weather
  keys (selectWeatherPreset silently filters them - a typo means the
  weight never applies). Today these are caught by eye, or not at all.

Useful existing seams: `floraRegistry.ts` (57 lines) already decouples
kind names from builders; `biomeTerrain()` is the single terrain-config
resolution point; `biomes.test.ts` exists but hand-enumerates cases;
`heightAt` under a given config is pure and jsdom-testable, so corridor
drivability is computable without WebGL; the biome registry drives
the menu + the validator.

## Goal

Adding a biome becomes a data-only afternoon task with guardrails: a
`BiomeDefinition` (~40 lines) + a flora config of parameterized archetypes
(~30 lines), and the framework itself proves the result is drivable,
readable, registered, and above water - before anyone runs the game.

## Non-goals

- No new biomes here (029-036 consume the kit; this plan builds it).
- No spatial biome blending / multi-biome circuits -> concept stub 056
  created during execution (the visually big follow-up; needs this
  validation layer first).
- No per-biome ambience audio (birds/wind beds) -> concept stub 057.
- No change to placement runtime (PropField/DressingChunkManager
  untouched); 043's water-placement fix stays its own item - the
  validator here catches the DATA case (flora biome whose terrain floor
  is below waterLevel), 043 fixes the placement sampler.
- No migration of temperate/desert/alpine flora builders (parity risk for
  zero gain; they stay as-is behind the same registry).

## Architecture (change)

```text
src/environment/flora/
  archetypes.ts       # NEW: parameterized builders returning the same
                      #   {build, big, collider} shape registerFlora
                      #   takes. coniferTree{trunkH, tiers, spread,
                      #   palette}, canopyTree{lobes, canopyR, palette},
                      #   ballRock{rBase, flatten, palette},
                      #   lumpyShrub{lobes, r, palette},
                      #   groundDecor{blade|petal, h, palette}. All
                      #   seeded-RNG deterministic, base-at-y=0,
                      #   collider radius shared with the visual
                      #   (rockRadius discipline). Pure geometry math
                      #   split out for jsdom tests (propSampler
                      #   pattern).
  archetypes.test.ts  # determinism per seed; base-at-y=0; collider ==
                      #   visual radius; vertex budget caps per archetype
                      #   (big <= ~600 tris, decor <= ~60 - kartLod/
                      #   bucket-merge budgets hold as biomes multiply).
  tundra.ts           # MIGRATION PROOF: rebuilt on archetypes (newest
                      #   biome, least bespoke). Gate = manual F3 tundra
                      #   visual parity; if the look drifts, keep the
                      #   old builders and the kit ships for NEW biomes
                      #   only (decision recorded in the commit body).
src/terrain/
  biomeValidate.ts    # NEW PURE: validateBiome(def) -> findings[]
                      #   {level: error|warn, code, msg}. Checks:
                      #   - flora kinds registered + counts within
                      #     per-chunk budget (sum of "big" <= cap);
                      #   - weather keys are known presets, weights > 0
                      #     sum > 0 (catches silent-filter typos);
                      #   - water sanity: waterLevel vs terrain floor -
                      #     sampled min heightAt off-corridor; flora
                      #     biome floor below waterLevel = warn (043
                      #     link);
                      #   - drivability: sample heightAt along the
                      #     default spline corridor under biomeTerrain
                      #     (def); max grade + step roughness under
                      #     kart-suspension-derived thresholds;
                      #   - palette readability: LINEAR-space contrast
                      #     floors road-vs-grass and grass-vs-rock (cel
                      #     bands must read; numbers tuned from the four
                      #     shipped biomes, which must all pass).
  biomeValidate.test.ts # each check red on a crafted bad fixture + green
                      #   on all shipped biomes.
  biomes.registry.test.ts # NEW registry-driven suite: for EVERY entry in
                      #   BIOMES - validateBiome has no errors; temperate
                      #   stays all-undefined-overrides (parity guard);
                      #   resolveBiome round-trips. New biomes get
                      #   coverage by existing, not by writing tests.
src/terrain/
  AGENTS.md           # runbook: definition checklist, archetype menu +
                      #   knobs, validator codes + what each failure
                      #   means, "copy tundra" as the reference
                      #   implementation.
```

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(env): parameterized flora archetype builders`
   - `archetypes.ts` + tests; no consumer change yet.
2. `refactor(env): tundra flora on archetypes` (or documented no-go)
   - Swap builders behind the same registered kind names; placement,
     counts, colliders unchanged. Gate: manual F3 tundra visual parity +
     body-count test unchanged. On visible drift: revert, record the
     no-go, kit remains new-biome-only.
3. `feat(terrain): biome validator + registry-driven test suite`
   - `biomeValidate.ts` + fixtures + `biomes.registry.test.ts`; the four
     shipped biomes pass; thresholds documented next to the numbers.
4. `docs: biome authoring runbook + stubs 067/068, update 029/030`
   - Runbook; retarget open plans 029 (swamp) + 030 (tropical) to consume
     archetypes + validator (their flora sections shrink); create
     `concept/067_biome-blending.md` + `concept/068_biome-ambience.md`;
     move 055 to pending-review.

## Risks

- Archetypes too rigid: a biome needs a shape the knobs cannot express
  (saguaro arms, mushroom caps). Mitigation: the registry contract is
  unchanged - bespoke builders remain first-class; archetypes are the
  default, not a cage. The runbook says exactly when to drop to bespoke.
- Tundra migration look-drift: gated by a manual F3 visual check with an
  explicit no-go path (commit 2); worst case the kit still pays for 8
  future biomes.
- Validator false positives blocking honest biomes: thresholds are
  derived from the four shipped biomes (all must pass untouched) and
  drivability checks reuse the same `heightAt` the game runs; warns vs
  errors are separated so soft heuristics (palette) never hard-block.
- Threshold rot as terrain evolves: checks live next to the constants
  they derive from (kart suspension, cel band math) with comments naming
  the source; registry suite fails loudly if a terrain change breaks
  every biome at once (signal: threshold, not biomes).
- Per-chunk big-prop budget interplay with streaming (023): budget cap in
  the validator mirrors DressingChunkManager's per-chunk expectations;
  test asserts the two constants are imported from one place.

## Acceptance

- [ ] A demo biome written during review (definition + archetype flora
      config, <= 80 lines total, no new builder code) registers, passes
      the validator, renders, and appears in the menu with zero
      test-file edits.
- [ ] All four shipped biomes pass `validateBiome` with no errors;
      temperate parity untouched (all-undefined overrides asserted).
- [ ] Each validator check demonstrably red on its bad fixture (flora
      typo, weather-key typo, sunken-flora water level, undrivable
      relief, unreadable palette).
- [ ] Tundra migration: manual F3 visual parity + prop body count
      unchanged - or the documented no-go with builders reverted.
- [ ] Archetype vertex budgets enforced by test (big/decor caps).
- [ ] 029/030 open plans updated to consume the kit; runbook committed.
- [ ] All files <= 600 lines; `npm run verify` + hooks green.

## Verification

- Build the demo biome by following only `src/terrain/AGENTS.md` -
  the doc is acceptance-tested by use.
- F3 lap on migrated tundra vs main: silhouettes, colliders (drive into a
  rock), night look.
- Deliberately break a fixture each way and watch the registry suite name
  the right validator code.
- `npm run verify:changed` per commit; `npm run verify` at the end.

## Depends on

025 (framework being extended), 027 (tundra = migration target), 023
(per-chunk streaming budgets the validator mirrors). Unblocks/cheapens
029-036
(every queued biome). Complements 043 (data-level check here, sampler fix
there). Stubs 056 (spatial biome blending) + 057 (biome ambience audio)
during execution; 056/057 are the next free indices at time of writing
(047-051 are physics concepts, 053-054 sibling plans).
