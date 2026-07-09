# 078 Seed input cannot apply a plain seed

Status: pending-review (shipped, #108). Supersedes the take-1 plan that shipped
in #106 (plain numeric seeds + a reject cue). Take 1 made plain decimal/hex
seeds apply but still REJECTED arbitrary strings and only varied the track.

## Context

Take 1 (#106) added `parsePlainSeed` (decimal / `0x`-hex in uint32) and a
`gc-reject` shake cue. Two problems remained:

1. Seeds could be "invalid." Anything that was not a number or a share code
   (e.g. `hello`, bare hex `deadbeef`) flashed a reject cue and reverted. A
   seed should never be invalid — like Minecraft, every input should resolve
   to a world.
2. The seed only changed the TRACK. Terrain relief noise is fixed at `1337`
   (`src/terrain/heightmap.ts`), and dressing/clouds/wildlife/weather default
   to `1337`/`0`. Two different seeds produced identical hills, trees, clouds,
   and weather — only the road differed. So seeds did not "work" visually.

## Approach (take 2)

### A. Every input resolves to a seed (no rejects)

Add `resolveSeed(value): number` to `src/terrain/circuitCode.ts`: a decimal or
`0x`-hex integer in uint32 range is used directly; every other string hashes
to a stable uint32 via FNV-1a (`hashSeed` in `src/core/rng.ts`). Never null.
`SeedPicker.commit()` order: a plain number (`parsePlainSeed`) is always a
seed; otherwise a valid share code (`parseCircuitCode`) decodes its frozen
biome; otherwise the string hashes (`resolveSeed`). Empty input = no-op
revert. The `gc-reject` shake cue is removed entirely (no invalid state).

### B. The seed drives the whole world

Wire `CircuitId.seed` into every seeded subsystem using the existing
`hashSeed(label) ^ seed` convention:

- Terrain relief: `Game.buildWorld` sets `terrainCfg.noiseSeed` to
  `(hashSeed("terrain") ^ id.seed) >>> 0` after `biomeTerrain(biome)`.
- Environment: `EnvironmentOptions` gains a top-level `seed`; the ctor fans
  out `(hashSeed(label) ^ seed) >>> 0` into `dressing.baseSeed`,
  `clouds.seed`, `weather.seed`, `wildlife.seed` (only when the caller did
  not set one — explicit still wins).

The track already self-mixes the root seed (`generateCircuit`), so it is
untouched. `selectBiome` already derives from the seed. Net: same seed ->
same full world; different seed -> visibly different everywhere. Share codes
round-trip to the same full world.

## Impact (intended)

Existing saved seeds look different (terrain/scenery previously did not vary
by seed). The default showcase (seed 1) gets new hills. Both deterministic and
valid — this is the point.

## Architecture (change)

```text
src/terrain/
  circuitCode.ts        # +resolveSeed(str): number. parsePlainSeed ?? hashSeed.
                        #   parsePlainSeed unchanged. Pure, no DOM.
  circuitCode.test.ts   # +resolveSeed: direct number, always-uint32,
                        #   deterministic, distinguishes strings.
src/ui/
  SeedPicker.ts         # commit(): number -> code -> resolveSeed(hash). Remove
                        #   flashReject. Empty = no-op. applyOrRevert -> apply.
  SeedPicker.test.ts    # string seeds apply; reject tests -> hash tests.
  startMenuStyles.ts    # remove gc-shake keyframe (dead).
src/core/
  Game.ts               # buildWorld: terrainCfg.noiseSeed = labeled sub-seed;
                        #   pass seed: id.seed to Environment.
src/environment/
  Environment.ts        # +seed?: number option + pure worldSubSeeds(seed)
                        #   helper; fan out into the 4 slice seeds (explicit
                        #   wins).
  Environment.test.ts   # +worldSubSeeds: labels differ, explicit wins.
```

## Commits

1. `feat(terrain): resolve any string to a seed`
   - `resolveSeed` + tests + `circuit-code.md`.
2. `feat(ui): never reject seed input`
   - `SeedPicker.commit` rewrite, remove `flashReject` + keyframe, tests,
     `overlays.md`.
3. `feat(world): drive terrain + scenery from the circuit seed`
   - `Game.ts` + `Environment.ts` + tests + `height-pipeline.md`.

## Acceptance

- [ ] Typing any non-empty string (e.g. `hello`) + Enter applies a seed and
      rebuilds the world; the field shows the canonical code.
- [ ] Same string -> same world (deterministic); different strings differ.
- [ ] Decimal / `0x`-hex in range used directly; bare hex hashes (not the
      number).
- [ ] No reject cue anywhere; empty input is a no-op.
- [ ] Different seeds vary terrain relief, dressing, clouds, wildlife, AND
      weather (not just the track).
- [ ] Share codes round-trip to the same full world.
- [ ] `npm run verify` green; files <= 600 lines; lines <= 100 chars.

## Touch points

- `src/terrain/circuitCode.ts`, `src/terrain/circuitCode.test.ts`.
- `src/ui/SeedPicker.ts`, `src/ui/SeedPicker.test.ts`,
  `src/ui/startMenuStyles.ts`.
- `src/core/Game.ts`, `src/environment/Environment.ts`,
  `src/environment/Environment.test.ts`.
- `docs/knowledge/terrain/circuit-code.md`, `docs/knowledge/ui/overlays.md`,
  `docs/knowledge/terrain/height-pipeline.md` (freshness hook).

## Related

- 058 shipped the SeedPicker + short-code codec.
- #106 (take 1) added `parsePlainSeed` + the reject cue; take 2 keeps
  `parsePlainSeed` for number-detection and removes the reject cue.
