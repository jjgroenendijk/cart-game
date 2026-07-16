# Dev

Dev/agent tooling: surfaces that help humans and AI agents inspect, drive, and
see the game. All are gated (dev build or `?debug`) so production boots clean.
Related core docs: [debug-snapshot](/core/debug-snapshot.md),
[dev-flags](/core/dev-flags.md).

- [garage](/dev/garage.md) — Kart inspection viewer: orbit/zoom, live
  measurements, and a user-supplied reference-image overlay with scale
  calibration
- [garage-compare](/dev/garage-compare.md) — Diff a 2x2 reference car image
  against the in-game kart per angle (silhouette diff contact sheet) to guide
  model edits
- [screenshot-harness](/dev/screenshot-harness.md) — Headless capture of a
  deterministic frame (PNG + debugSnapshot JSON) via playwright-core
