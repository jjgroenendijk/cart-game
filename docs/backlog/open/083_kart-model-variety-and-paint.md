# 083 Kart model variety + paint picker

## Problem

All six kart variants share one box-built mesh that only varies in
dimensions and a fixed colorway. Karts read as basic and interchangeable;
the player cannot express any visual choice beyond the archetype's baked-in
color.

## Goal

- Each variant gets a visually distinct procedural chassis model
  (formula, wide racer, mini-truck, buggy, off-roader, classic kart) —
  cel primitives only, zero assets, painterly register intact.
- Decouple paint from model: a colorway registry the player picks from
  after choosing the model; rivals draw seeded model + paint combos.
- Persist per-player `{ variant, colorway }` (selection schema v2 with
  v1 migration).

## Plan

1. `src/kart/kartModels.ts`: per-variant body builders + wheel stances;
   `Kart` delegates chassis build, keeps wheel rigs + sync.
2. `src/kart/kartColorways.ts`: 8 named colorways; variants map their
   legacy colors to default colorways (stock looks unchanged).
3. Selection v2 (`kartSelection`/`kartSelectionStorage`), paint stage in
   `KartSelectOverlay`, wiring through GameFlow/Game/FieldBuilder.

## Done when

- Six distinct silhouettes on track; player picks model then paint;
  choice persists across reloads; rivals vary in both axes; verify green.
