# Core

- [debug-snapshot](/core/debug-snapshot.md) — window.__game.debugSnapshot()
  whole-game JSON state dump for dev/agent inspection
- [dev-flags](/core/dev-flags.md) — URL query-param overrides to boot a
  deterministic frame without menu clicks
- [field-builder](/core/field-builder.md) — Per-field composition + lifecycle:
  humans, rivals, race, VFX, AI fixed step
- [game](/core/game.md) — Central orchestrator: composition, lifecycle, field
  rebuilds
- [game-flow](/core/game-flow.md) — Screen state machine: overlays, pause,
  countdown, persistence
- [hud-sync](/core/hud-sync.md) — HUD data binding and sync between game state
  and overlay DOM
- [input](/core/input.md) — Keyboard and gamepad input mapping
- [persistence](/core/persistence.md) — Versioned localStorage for settings,
  kart selection, time-of-day
- [player-view](/core/player-view.md) — Per-human kart, camera, viewport,
  speed-HUD binding
- [quality](/core/quality.md) — Quality tier system for performance scaling
- [renderer](/core/renderer.md) — Three.js EffectComposer with 3 render layers
- [rng](/core/rng.md) — Cross-cutting seeded PRNG (mulberry32) for
  deterministic placement
- [stats](/core/stats.md) — StatsHud F3 perf overlay and runtime metrics
