# 058 Short circuit codes + seed UI

Status: open (full plan; ready for execution). Stage 3 of 037 v3.

## Context

The seed system needs a shareable identity and a menu to enter/copy/randomize
it. The rejected v2 got the concept right but the encoding wrong:

- 32 base64 chars, of which 20 bytes were deterministic filler - unwieldy to
  read aloud, screenshot, or retype.
- Biome came from `selectBiome(seed)` (`src/terrain/biomes.ts`) = an RNG
  partition over the `BIOMES` insertion order. Adding a biome shifts the
  partition, so every previously-shared code silently changes biome. The code
  must store the derived biome index, not re-derive it.

Since v1/v2 never merged, there are NO codes in the wild - no legacy decode
path needed. Ship one clean format.

This stage adds the code + UI on top of 057's generator (still single loop,
constant width). `Game` starts carrying a `CircuitId {seed, biome}` instead of
a bare seed so 059/060 can extend the world identity later.

## Goal

A player sees a short code (e.g. `KX7Q-2M9F-P4`), copies it, randomizes it, or
pastes a friend's; the same code always reproduces the same world (layout +
biome), stable across future biome additions.

## Non-goals

- Live menu preview of the loop (-> 044, easier once the generator is pure).
- Width/branch fields in the code (059/060 are seed-derived, not separately
  encoded; the seed already determines them).
- Legacy 32-char decode (no such codes exist).

## Architecture (change)

```text
src/terrain/
  circuitCode.ts      # NEW PURE: 50-bit payload = 10 Crockford base32 chars,
                      #   shown XXXX-XXXX-XX.
                      #   bits 49..46 version(=1), 45..40 biome index (0..63),
                      #   39..8 uint32 seed, 7..0 CRC-8 (poly 0x07).
                      #   Alphabet 0-9 A-Z minus I L O U; input case-
                      #   insensitive, I/L->1, O->0, dashes/spaces stripped.
                      #   encodeCircuitCode(id)->string (canonical),
                      #   parseCircuitCode(code)->CircuitId|null (strict:
                      #   structure + CRC), decodeCircuitCode (lenient ->
                      #   DEFAULT_ID), isValidCircuitCode.
  circuitCode.test.ts # round-trip over 10000 {seed,biome}; CRC rejects any
                      #   single-char mutation; Crockford aliasing (i/l/o,
                      #   case); lenient decode never throws.
  biomes.ts           # +BIOME_ORDER: readonly BiomeId[] (APPEND-ONLY, index
                      #   is the stable code field) + biomeByIndex(i) (out of
                      #   range -> temperate) + biomeIndexOf(id). selectBiome
                      #   survives ONLY as randomize-time derivation.
  circuit.ts          # generateCircuit takes waterLevel from the STORED biome
                      #   (biomeByIndex(id.biome).waterLevel), not selectBiome.
src/core/
  circuitStorage.ts   # NEW localStorage gamecart.circuit key; persists
                      #   {version, seed, biome}; try/catch, DEFAULT_ID
                      #   fallback, never throws (mirrors kartSelectionStorage).
  circuitStorage.test.ts
  Game.ts             # currentSeed -> current: CircuitId. buildWorld(id),
                      #   rebuildWorld(id?), onStart(mode, id). RANDOM makes a
                      #   fresh seed and derives biome once via selectBiome,
                      #   then stores the index.
src/ui/
  SeedPicker.ts       # NEW (v2 archived): label TRACK CODE, editable input
                      #   (parseCircuitCode; invalid -> revert render), COPY,
                      #   RANDOM, read-only biome label from
                      #   biomeByIndex(id.biome).label. Renders XXXX-XXXX-XX.
                      #   Suppresses StartMenu global confirm while focused.
  SeedPicker.test.ts  # valid code carried into onStart; invalid reverts;
                      #   RANDOM changes seed; biome label matches index.
```

## Commits

1. `feat(terrain): short circuit code codec`
   - `circuitCode.ts` + tests.
2. `feat(terrain): stable biome index registry`
   - `BIOME_ORDER`/`biomeByIndex`/`biomeIndexOf`; `generateCircuit` reads
     water level from stored biome.
3. `feat(core): circuit id storage + Game plumbing`
   - `circuitStorage.ts` + `Game` `CircuitId` threading (+tests).
4. `feat(ui): seed picker with short code`
   - `SeedPicker.ts` + wiring into StartMenu + MenuNav; tests.

## Risks

- Biome index drift if someone reorders `BIOME_ORDER`: documented APPEND-ONLY;
  a test pins the current order and existing indices.
- Code confusability (0/O, 1/I/L): Crockford alphabet + input normalization
  handle it; CRC catches remaining typos.
- Randomize biome distribution: `selectBiome` still governs the odds at
  RANDOM time; unchanged feel, just frozen into the code afterward.

## Acceptance

- [ ] Code round-trips over 10000 ids; CRC rejects single-char mutations;
      input is case/dash/alias insensitive.
- [ ] Same code -> same world across a simulated biome addition (append a
      biome to BIOME_ORDER; old codes keep their biome). Test.
- [ ] SeedPicker COPY/RANDOM/paste work; choice persists; MenuNav reaches it.
- [ ] verify green; touched files <= 600 lines.

## Depends on

057 (generator produces the worlds these codes name). 025 (biome framework /
BIOMES). Amends 044 (free seed entry ships here; preview deferred). Feeds
059/060 (extend the same CircuitId world).
