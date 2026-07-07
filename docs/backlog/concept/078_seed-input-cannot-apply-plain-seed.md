# 078 Seed input cannot apply a plain seed

Status: open (concept - bug report, to be refined)

## Context

Discovered while restyling the start menu (072). The menu's seed control is
`src/ui/SeedPicker.ts`, labeled `TRACK CODE`. It is NOT a seed field: it edits
the canonical short code `XXXX-XXXX-XX` (10 Crockford base32 symbols carrying
version + biome + uint32 seed + CRC-8), decoded by `parseCircuitCode` in
`src/terrain/circuitCode.ts`.

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
Telemetry shows the seed as hex while the field shows base32, compounding the
confusion.

## Not a code defect

The field, parser, and commit path all behave as written; the CRC guard is
intended (it rejects typos in shared codes). This is a UX gap: there is no path
from "I have a seed number" to "apply it".

## Candidate fixes (to be refined)

- Smart single field: accept EITHER a valid track code OR a plain integer
  (decimal, coerced to uint32; biome stays current). On invalid input show a
  brief reject cue instead of a silent revert.
- Separate numeric SEED control (spinner / field) alongside the shareable
  CODE field.
- Keep code-only but add explicit reject feedback + a hint that the field
  wants a full code, so the silent revert stops surprising players.

## Acceptance (draft)

- A player can enter a seed and have it applied to the previewed world.
- Invalid input is visibly rejected, not silently reverted.
- Sharing a track code still round-trips (encode/parse unchanged).

## Touch points

- `src/ui/SeedPicker.ts` (input, commit, render).
- `src/terrain/circuitCode.ts` (parse/encode; a numeric-seed helper may live
  here).
- `src/ui/StartMenu.ts` (host wiring: `handleCircuitChange`, telemetry, nav
  order), and `SeedPicker.test.ts` / `StartMenu.test.ts`.

## Related

- 058 shipped the SeedPicker + short-code codec.
- 044 (circuit options panel) concept covers a live seed preview; a seed-entry
  redesign here should stay compatible with that.
