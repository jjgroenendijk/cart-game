# 037 Procedural circuits v3 (umbrella)

Status: pending-review (stages 056-060 in pending-review; umbrella tracks them)

## Context

037 was implemented twice on `feat/037-procedural-circuits` (PR 59) and both
attempts were rejected in review; the PR was reset to docs-only (impl archived
on local branch `archive/037-v2`). What the attempts got right and wrong:

- v1 (named presets + difficulty/elevation knobs): polar-monotone generator
  `r(theta)` around origin, `BASE_RADIUS=60` -> ~380 m near-round loops. Review:
  boring, too short. Difficulty coupled into layout via per-preset `minRadius`
  floors. Rejected: AI difficulty is a driver-quality knob, not a track-shape
  knob (-> concept 061).
- v2 (seed system): layout + biome 100% seed-driven, `SeedPicker` with a
  32-char base64 code. Right idea, wrong execution: 20 of 24 code bytes were
  deterministic filler; `selectBiome(seed)` = RNG partition over `BIOMES`
  insertion order, so adding a biome silently re-maps every existing code;
  loops stayed short and round-ish (same polar construction).
- Both: AI drives generated tracks poorly. `FieldBuilder.sampleAhead` steps
  `curve.getPoint(t + k*step)` with `step = meters/loopLength`, but `getPoint`
  is not arc-length parameterized -> lookahead spacing in metres varies around
  irregular loops. `AiDriver.curvatureThrottle` estimates one turn angle from
  3 points -> blind past ~50 m, no braking-distance model.

v3 keeps v2's core decision (seed = world) and replaces everything else. The
review discussion also locked new requirements: lap length 600-1500 m
(seed-varied), variable road width, and split/rejoin alternate paths (narrow
hard shortcut vs wide easy detour), plus room for future gameplay features
attached to track locations.

## Locked decisions

- One shareable code = one world. Layout AND biome derive from the seed; the
  derived biome index is explicitly encoded in the code so future biome
  additions never re-map existing codes. No biome selector row (replaced by
  the code UI; `selectBiome` survives only as randomize-time derivation).
- Code is short + human-friendly: 10 Crockford base32 chars shown
  `XXXX-XXXX-XX` (version + biome + seed + checksum). No legacy format: v1/v2
  never merged, so no codes exist in the wild.
- Lap length seed-varied 600-1500 m; polar construction replaced by
  scatter -> convex hull -> midpoint displacement (S-bends, folds).
- Road half-width varies along the track (4.5-9 m), folding concept 045.
- Circuits may branch: mainline + split/rejoin edges. Requires a track-graph
  model; race progress stays a single scalar `t` by projecting branch
  positions onto the mainline parameterization.
- Same-level crossroads and grade-separated bridges are out: `heightAt(x,z)`
  is single-valued (core terrain invariant) so no stacking, and a crossing
  makes projected `t` ill-defined at the intersection point. Future concept if
  ever wanted.
- AI difficulty is NOT seed-derived and not in scope -> concept 061. But AI
  must drive every generated circuit competently (stage 056).

## Architecture (summary; details live in the stage plans)

- Progress model: mainline stays one closed `SplineTrack` (edge 0); branches
  are open Catmull-Rom edges anchored on it. A kart on a branch reports
  `t = wrapLerp(tA, tB, s/branchLen)`. RaceManager, checkpoints, ranking,
  rubber-band, HUD consume projected `t` unchanged. Branch windows sit inside
  `t in [0.08, 0.92]` and span <= 0.22 of the lap (< FORWARD_CUT 0.34), so the
  start zone stays pure mainline and cut detection keeps working.
- Terrain: `SplineFieldCache` bakes per-cell `{dist, pathY, t, edgeId, s,
halfWidth}` over all edges via a bucket-grid `SampleIndex` (also fixes bake
  cost at 600-768 m worlds). `heightFromField`/`colorFromField` read the
  per-sample `halfWidth` instead of the fixed `trackHalfWidth`.
  `StreamingHeightSource` out-of-bounds goes through the same graph query ->
  seamless. Generation-time min-separation between non-adjacent track sections
  guarantees closest-edge snapping is unambiguous for any on-road kart.
- AI: arc-length-true lookahead (`SplineTrack.pointAtArc` over the existing
  equal-arc sample table), braking-distance speed model (pure `aiSpeed.ts`),
  width-aware stuck corridor, deterministic per-rival branch choice (pure
  `routeChoice.ts`), edge-local respawn.
- Future hooks: `TrackMarker {kind, edgeId, s, lateral, data?}` carried by the
  preset (empty for now) so items/boost pads/hazards later attach to track
  stations without generator changes. Biome + weather frameworks untouched.

## Stages

Each stage is a full plan, independently green + playable when implemented:

1. 056 AI on arbitrary loops - `pointAtArc`, metre-true `sampleAhead`,
   `aiSpeed.ts` braking-distance model, width plumbing (value still 6).
2. 057 Scalable circuit generator - hull/displace generator 600-1500 m,
   `SampleIndex`, separation validation, world-size-scaled terrain budgets;
   wired at a fixed default seed (no UI yet).
3. 058 Short circuit codes + seed UI - codec (version/biome/seed/CRC),
   `BIOME_ORDER` registry, `SeedPicker`, storage, `Game` `CircuitId` plumbing.
4. 059 Track graph + variable width - graph types, width profiles, multi-edge
   field cache, width threaded to all consumers. Folds + retires 045.
5. 060 Branching circuits - branch generation/validation, projected-t race
   integration, AI route choice, minimap branches, `TrackMarker` shape.

Concept 061 (AI difficulty selector) follows separately after 056.

## Acceptance

- [ ] Stages 056-060 individually accepted (each carries its own gates).
- [ ] End state: RANDOM -> a 600-1500 m world with varying width, possibly a
      branch; the code round-trips through a friend's input to the identical
      world; AI races it cleanly on both routes.

## Depends on

003 (SplineTrack/TerrainOptions contract), 007 (race/AI stack), 025 (biome
framework). Retires 020's track-select half (absorbed; kart-select shipped in
024). Folds 045 (via 059). Amends 044 (seed entry ships in 058; 044 keeps the
live-preview idea). Spawns 061 (AI difficulty).
