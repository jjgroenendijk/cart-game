# Knowledge wiki change log

## 2026-07-09

- Scoped the nordic (Skyrim/Witcher) mood register to the tundra biome only;
  it is no longer the flagship mood for temperate/alpine/tundra. Registers are
  now framed as one vibe per biome; the art-direction register table became a
  per-biome table with tundra pinned and the others open `(to be defined)`.
  No shader or pipeline change — registers stay data; line color (sepia
  default, near-iron for tundra) remains per-biome table data, still open work.
- Recorded the art direction decision as a convention: "Painted Wilds"
  painterly cel identity (soft 3-band cel + rim, pigment palettes, warm
  sepia/iron line targets, editorial journal UI) with warm and nordic
  mood registers defined as table data, not pipeline forks.

## 2026-07-07

- Knowledge audit: refreshed references (three.js 0.185, added
  tonejs), corrected the render-layer table (walls removed), and added
  missing subsystem docs (FieldBuilder, persistence, RNG, routing,
  circuit branches/width, start-line dressing). Reconciled the root
  index tree and aligned terrain index links to absolute paths.

## 2026-07-06

- Prettier 3.9 collapses single-arg `Array.from`/`.map` calls and short
  type unions to one line; reformatted affected `src/` files to match.

## 2026-07-05

- Retired the AGENTS.md 1000-LOC refresh rule; replaced it with a wiki
  freshness gate requiring a `docs/knowledge/` touch on any commit that
  changes `src/`.
- Strengthened `okf-lint`: required `title`, `description`, `tags`;
  ISO-8601 UTC `timestamp`; source-path liveness for backtick `src/` and
  `test/` references; no backlog IDs or PR refs in knowledge bodies.
