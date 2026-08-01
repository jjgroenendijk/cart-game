---
type: Subsystem
title: Kart Variants
description: "Six kart archetypes with tuning, silhouette, stock colorway, and stat bars."
tags: [kart, variants, colorways, gameplay]
timestamp: 2026-07-10T00:00:00Z
---

# Schema

Six playable archetypes — balanced, speed, grip, heavy, feather, trail —
each fully defined by its own `KartModelDef` file under `src/kart/models/`:
`KartTuning` override, `KartSilhouette` (base dimensions consumed by the
chassis builder in the same file), wheel stance, stock colorway, and the
build fn. `src/kart/kartVariants.ts` derives the presentation-facing
`KART_VARIANTS` from the registry, adding resolved stock colors and
precomputed `StatBars`. Pure and WebGL-free, so unit tests run under jsdom.
Stat bar bounds are scanned once from the registered tunings at module
load; `statBarsFor` normalizes any `KartTuning` against those bounds.

Source: `src/kart/kartVariants.ts`, `src/kart/models/index.ts`.

## Colorways (paint registry)

`src/kart/kartColorways.ts` owns the 8 named body+accent paints — ember,
glacier, moss, violet, amber, lagoon, midnight, pearl — picked independently
of the chassis model. The first six are the legacy variant colors, so every
variant's `colorway` field maps its stock look 1:1 (`colors` on the variant
is derived via `colorwayById(colorway).colors`). `colorwayForRival(seed,
index)` deals deterministic rival paint with a different hash constant than
`variantForRival`, so a rival's model and paint decorrelate.

## The six variants

| id       | name        | stock paint | Key tuning deviations from DEFAULT_TUNING     |
| -------- | ----------- | ----------- | --------------------------------------------- |
| balanced | Balanced    | ember       | None (spread of DEFAULT_TUNING)               |
| speed    | Speedster   | glacier     | maxSpeed 39, engineForce 8200, grip 8.5,      |
|          |             |             | mass 270, maxSteerRate 2.4,                   |
|          |             |             | topSpeedSteerFactor 0.6, driftBoost 1.14      |
| grip     | Grip        | moss        | maxSpeed 30, engineForce 10500, grip 11.5,    |
|          |             |             | driftGrip 2.0, mass 250, maxSteerRate 2.9,    |
|          |             |             | brake 12500                                   |
| heavy    | Heavy       | violet      | mass 340, maxSpeed 32, engineForce 9400,      |
|          |             |             | grip 10.5, driftGrip 1.9, maxSteerRate 2.3,   |
|          |             |             | uprightTorque 34                              |
| feather  | Feather     | amber       | mass 200, maxSpeed 33, engineForce 8800,      |
|          |             |             | grip 8.8, driftGrip 1.3, maxSteerRate 3.0,    |
|          |             |             | driftBoost 1.18, uprightTorque 22             |
| trail    | Trailblazer | lagoon      | mass 280, maxSpeed 33, engineForce 9200,      |
|          |             |             | grip 9.0, suspensionStiffness 30000,          |
|          |             |             | suspensionDamping 3000, suspensionTravel 0.4, |
|          |             |             | wheelRadius 0.42                              |

`DEFAULT_TUNING` values and field meanings:
see [KartController](/kart/controller.md).

## Types

```ts
type KartVariantId = "balanced" | "speed" | "grip" | "heavy" | "feather" | "trail";

interface KartSilhouette {
  bodyDims: [w: number, h: number, d: number];
  tireRadius: number;
  noseZ: number;
  spoilerH: number;
}

interface StatBars {
  speed: number;
  accel: number;
  grip: number;
  mass: number;
}

interface KartVariant {
  id: KartVariantId;
  name: string;
  colorway: KartColorwayId; // stock paint (see kartColorways.ts)
  colors: KartColors; // resolved stock colors, derived from colorway
  tuning: KartTuning;
  silhouette: KartSilhouette;
  statBars: StatBars;
}
```

`KartColors` (from `src/kart/Kart.ts`) is `{ body: number; accent: number }`
in sRGB hex. `KartTuning` (from `src/kart/KartController.ts`) is the 18-field
physics parameter struct documented in
[KartController](/kart/controller.md).

## Stat bar normalization

At module load, `boundsOf` scans the six variant specs to find the min/max
of four tuning fields: `maxSpeed`, `engineForce`, `grip`, and `mass`. These
four `[min, max]` pairs become the fixed normalization bounds.

`statBarsFor(tuning: KartTuning): StatBars` normalizes any tuning against
those bounds. Each field maps to `norm(value, min, max)` (linear
interpolation to 0..1). The `mass` bar is inverted (`1 - norm(...)`) so a
lighter kart reads as a fuller bar. Divide-by-zero is guarded: `norm`
returns 1 when `max === min`.

The `KART_VARIANTS` const array is built by mapping each spec through
`statBarsFor` so every variant's `statBars` is precomputed at module load.

## Exports

- `KART_VARIANTS: KartVariant[]` — precomputed array of all six variants
  with stat bars filled in. Source of truth for UI and rival assignment.
- `variantById(id: KartVariantId): KartVariant` — lookup by id; throws on
  unknown id.
- `variantForRival(seed: number, index: number): KartVariantId` —
  deterministic rival variant via `makeRNG` (seed XOR-index hash). Used by
  FieldBuilder for AI kart assignment.
- `statBarsFor(tuning: KartTuning): StatBars` — normalize any tuning
  against the six-variant bounds.

## FieldBuilder integration

`src/core/FieldBuilder.ts` resolves model + paint for both human and rival
karts:

- Human karts use `variantById(humanPicks[i].variant)` and
  `colorwayById(humanPicks[i].colorway)` per player slot (stock balanced
  when the pick is absent).
- Rivals use `variantForRival(AI_BASE_SEED, i)` for the model and
  `colorwayForRival(AI_BASE_SEED, i)` for the paint per AI slot.
- Each kart's `spawnClearance(variant.tuning)` sets the spawn Y above
  terrain so the suspension starts uncompressed — see
  [KartController](/kart/controller.md) spawn clearance.
- The `Kart` constructor receives a `KartStyle` (`{ model, colors }`) and
  `variant.tuning`; the model id selects the chassis builder + wheel stance
  (see [Kart Mesh](/kart/kart-mesh.md)).

## KartSelectOverlay integration

`src/ui/KartSelectOverlay.ts` is the pre-race DOM sub-screen where each
player picks in two stages: cycle the six variants (model), confirm, then
cycle the eight colorways (paint), confirm. It reads:

- `v.name` / colorway name for the heading, per stage.
- The focused colorway's body + accent for the two-tone swatch chips.
- `v.statBars[row.key] * 100%` for the four stat bar widths (speed, accel,
  grip, mass) — shown in both stages.
- Confirming a model switch snaps the paint cursor to that variant's stock
  colorway; re-confirming the persisted model keeps the saved paint.
- Confirm delivers `KartPick[]` (`{ variant, colorway }` per player).

# Citations

- [KartController](/kart/controller.md)
- [Kart Mesh](/kart/kart-mesh.md)
- [PlayerView](/core/player-view.md)
