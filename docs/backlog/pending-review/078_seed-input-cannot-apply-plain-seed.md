# 078 Seed input cannot apply a plain seed

Status: open (full plan; ready for execution). Refines the 078 concept stub.

## Context

Discovered while restyling the start menu (072). The menu's seed control is
`src/ui/SeedPicker.ts`, labeled `TRACK CODE`. It is a short-code field, not a
seed field: it edits the canonical `XXXX-XXXX-XX` code (10 Crockford base32
symbols carrying version + biome + uint32 seed + CRC-8), decoded by
`parseCircuitCode` in `src/terrain/circuitCode.ts`.

`SeedPicker.commit()` (Enter / blur / change) runs:

```ts
const parsed = parseCircuitCode(this.input.value);
if (parsed !== null && changed) this.setId(parsed, true);
else this.input.value = encodeCircuitCode(this.id); // silent revert
```

`parseCircuitCode` returns `null` unless the input is a full 10-symbol code
with a matching CRC-8 and the right version. So anything that is not a complete
valid code -> silent revert to the previous code.

## Symptom

A player who types a plain number (e.g. `12345`) as a "seed" and presses Enter
sees the field snap back to the old code. There is no numeric seed entry and no
reject feedback, so applying an arbitrary seed is effectively impossible. The
only ways to change the seed today are RANDOM or pasting a complete valid code.

## Not a code defect

The field, parser, and commit path all behave as written; the CRC guard is
intended (it rejects typos in shared codes). This is a UX gap: there is no path
from "I have a seed number" to "apply it".

## Approach

Smart single field. The TRACK CODE input accepts EITHER a valid short code OR
a plain integer seed (decimal, or hex with a `0x` prefix). The field stays one
control; no new nav stop, no layout change. Invalid input is shown a brief
reject cue instead of snapping back silently.

Disambiguation rule (no code/seed collision): a trimmed input that is all
decimal digits (`^\d{1,10}$`, value <= `0xFFFFFFFF`) or hex with a `0x` prefix
(`^0x[0-9a-f]{1,8}$`, case-insensitive) takes the plain-seed path and never
reaches `parseCircuitCode`. This removes the ~1/4096 accidental-code collision
(a pure-digit string is a seed, not a code). Bare hex without `0x` (e.g.
`deadbeef`) is rejected to avoid ambiguity with mistyped codes.

Biome on a plain-seed entry is DERIVED via `selectBiome(seed)` then frozen to
its `BIOME_ORDER` index, exactly like RANDOM. `selectBiome` is a pure function
of the seed, so reusing a seed always yields the same biome. The BIOME row
syncs through the existing `handleCircuitChange` path.

After any apply the field re-renders to the canonical `XXXX-XXXX-XX` code (the
field is a TRACK CODE field; the number was a shorthand). The accept beep +
world rebuild are the feedback.

## Architecture (change)

```text
src/terrain/
  circuitCode.ts        # +parsePlainSeed(str): number | null. Pure: trims,
                        #   accepts ^\d{1,10}$ (<=0xFFFFFFFF) or ^0x[0-9a-f]{1,8}$
                        #   (case-insensitive), returns seed >>> 0 or null. No
                        #   DOM, no biome coupling.
  circuitCode.test.ts   # parsePlainSeed: decimal, 0x-hex, uppercase hex,
                        #   overflow reject, bare-hex reject, empty/garbage
                        #   reject, 0xFFFFFFFF boundary.
src/ui/
  SeedPicker.ts         # commit(): plain-seed path first, then parseCircuitCode,
                        #   else flashReject() + render(). flashReject() toggles
                        #   a `gc-reject` class on the input (~400ms via
                        #   setTimeout). Numeric apply beeps ("beep").
  SeedPicker.test.ts    # decimal entry fires onChange with derived biome;
                        #   0x-hex entry applies; same-value re-entry is a no-op;
                        #   invalid input toggles gc-reject + reverts + no
                        #   onChange; valid dashed code still round-trips; biome
                        #   row syncs after numeric entry (via onChange payload).
  startMenuStyles.ts    # LOCAL_CSS: +.gc-code-input.gc-reject shake keyframe
                        #   (biome-neutral; string-only -> jsdom-safe).
```

## Commits

1. `feat(terrain): parse plain numeric seeds in the code codec`
   - `parsePlainSeed` + tests.
2. `feat(ui): accept plain seeds + reject cue in the seed picker`
   - `SeedPicker.commit()` smart logic, `flashReject`, `gc-reject` CSS, tests.
3. `docs(ui): note plain-seed entry in the menu knowledge doc`
   - Knowledge freshness; lint:okf.

## Acceptance

- [ ] Typing a decimal seed (e.g. `12345`) + Enter applies it; the world
      rebuilds and the field shows the canonical code.
- [ ] Typing `0x`-prefixed hex applies; bare hex is rejected.
- [ ] The applied biome is `selectBiome(seed)` (deterministic; same seed ->
      same biome).
- [ ] Invalid input flashes `gc-reject` and reverts; no silent snap-back.
- [ ] Sharing a track code still round-trips (encode/parse unchanged).
- [ ] `npm run verify:changed` green; touched files <= 600 lines; lines <= 100
      chars.

## Touch points

- `src/ui/SeedPicker.ts` (input, commit, render).
- `src/terrain/circuitCode.ts` (+`parsePlainSeed`; encode/parse unchanged).
- `src/ui/startMenuStyles.ts` (`LOCAL_CSS` reject keyframe).
- `src/ui/SeedPicker.test.ts`, `src/terrain/circuitCode.test.ts`.
- `docs/knowledge/ui/*.md` (freshness hook).

## Related

- 058 shipped the SeedPicker + short-code codec.
- 044 (circuit options panel) concept covers a live seed preview; this entry
  path stays compatible with it.
