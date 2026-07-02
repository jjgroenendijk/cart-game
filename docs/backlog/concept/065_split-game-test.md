# 065 Test headroom: split Game.test.ts

Status: open (concept - to be refined)

## Context

`src/core/Game.test.ts` is 596/600 lines, flagged by the headroom report
added in 046. It bundles nine unrelated `describe` blocks: audio wiring,
state machine + menu/countdown, 1P/2P field wiring, pause, impacts, respawn,
settings, rival audio, and the physics accumulator clamp. The shared
helpers (`makeGame`, `makeGameWithContainer`, `toCountdown`) + the various
`*Internals` cast types live inline, and it depends on `Game.test.mocks.ts`.

046 left Game.ts at 399 + the GameFlow facade, so the casts reach a mix of
Game + flow members; the split must preserve that surface verbatim.

## Goal

Split `Game.test.ts` into focused files (one per describe, ~50-90 lines each)
mirroring the existing `Game.<topic>.test.ts` naming already used by
`Game.select/biome/env-focus/rebuild/terrain.test.ts`. No behavior, assertion,
or mock change - pure relocation so the file is comfortably under cap and
creep is visible again.

## Needs refinement

- Seam choice: one file per describe (Game.audio / Game.state / Game.field /
  Game.pause / Game.impacts / Game.respawn / Game.settings / Game.rivals /
  Game.accumulator) vs grouping small ones.
- Shared helpers: extract `makeGame`/`makeGameWithContainer`/`toCountdown`
  into a `Game.test.helpers.ts` (or reuse `Game.test.mocks.ts`) so each
  split file imports them; keep the `*Internals` cast types local to each.
- Confirm every file stays jsdom-gated via the existing `domTests` glob
  (`src/core/Game*.test.ts`) - new names already match.
- Gate: full `npm run verify` green, zero assertion diffs.

## Depends on

Nothing. Surfaced by 046's headroom report (chore(tools) commit). Unblocks
future Game tests from approaching the cap unseen.
