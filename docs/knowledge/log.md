# Knowledge wiki change log

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
