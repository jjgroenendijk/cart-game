---
type: Subsystem
title: Kart Variants
description: "Six kart archetypes with tuning, silhouette, colorway, and stat bars."
tags: [kart, variants, gameplay]
timestamp: 2026-07-10T00:00:00Z
---

# Schema

Six playable archetypes — balanced, speed, grip, heavy, feather, trail — each
defined by a full `KartTuning` override, a `KartSilhouette` (body dimensions
that drive the procedural mesh), a colorway, and precomputed `StatBars`. Pure
and WebGL-free (only imports `KartTuning`, `KartColors`, and `makeRNG`), so
unit tests run under jsdom. Stat bar bounds are scanned once from the six
tunings at module load; `statBarsFor` normalizes any `KartTuning` against
those bounds.

Source: `src/kart/kartVariants.ts`.

## The six variants

| id       | name        | body     | accent   | Key tuning deviations from DEFAULT_TUNING     |
| -------- | ----------- | -------- | -------- | --------------------------------------------- |
| balanced | Balanced    | 0xff5252 | 0xffd23f | None (spread of DEFAULT_TUNING)               |
| speed    | Speedster   | 0x4fc3f7 | 0xffffff | maxSpeed 39, engineForce 8200, grip 8.5,      |
|          |             |          |          | mass 270, maxSteerRate 2.4, driftBoost 1.14   |
| grip     | Grip        | 0x66bb6a | 0x222222 | maxSpeed 30, engineForce 10500, grip 11.5,    |
|          |             |          |          | driftGrip 2.0, maxSteerRate 2.9, brake 12500  |
| heavy    | Heavy       | 0xab47bc | 0xffd23f | mass 340, maxSpeed 32, engineForce 9400,      |
|          |             |          |          | grip 10.5, driftGrip 1.9, uprightTorque 34    |
| feather  | Feather     | 0xff9800 | 0xfff3e0 | mass 200, maxSpeed 33, engineForce 8800,      |
|          |             |          |          | maxSteerRate 3.0, driftBoost 1.18,            |
|          |             |          |          | uprightTorque 22                              |
| trail    | Trailblazer | 0x26a69a | 0xc6ff00 | mass 280, suspensionStiffness 30000,          |
|          |             |          |          | suspensionDamping 3000, suspensionTravel 0.4, |
|          |             |          |          | wheelRadius 0.42                              |

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
  colors: KartColors;
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

`src/core/FieldBuilder.ts` resolves variants for both human and rival karts:

- Human karts use `variantById(humanVariants[i])` per player slot.
- Rivals use `variantForRival(AI_BASE_SEED, i)` per AI slot.
- Each kart's `spawnClearance(variant.tuning)` sets the spawn Y above
  terrain so the suspension starts uncompressed — see
  [KartController](/kart/controller.md) spawn clearance.
- The `Kart` constructor receives `variant.colors`, `variant.silhouette`,
  and `variant.tuning`, which feed the procedural mesh and physics body.

## KartSelectOverlay integration

`src/ui/KartSelectOverlay.ts` is the pre-race DOM sub-screen where each
player cycles the six variants. It imports `KART_VARIANTS` and reads:

- `v.name` for the heading.
- `v.colors.body` (via `hexColor`) for the swatch fill.
- `v.statBars[row.key] * 100%` for the four stat bar widths (speed, accel,
  grip, mass).
- `KART_VARIANTS.findIndex` / `.length` for wrap-around cycling.
- `KART_VARIANTS[current].id` to lock the pick on confirm.

# Citations

- [KartController](/kart/controller.md)
- [Kart Mesh](/kart/kart-mesh.md)
- [PlayerView](/core/player-view.md)
