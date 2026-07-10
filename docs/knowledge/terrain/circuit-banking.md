---
type: Subsystem
title: Circuit Banking
description: >
  Signed per-station corner bank profile: derived from centerline curvature,
  hard-masked where a tilted cross-section would break the world.
tags: [terrain, circuit, banking, procedural]
timestamp: 2026-07-10T00:00:00Z
---

# Schema

`src/terrain/circuitBank.ts` derives a `BankProfile` (`{s[], bank[]}`, rad,
`+` = left side of travel raised; shape in `src/terrain/stationProfile.ts`)
for the closed mainline. Pure and rng-free: banking is a deterministic
function of the accepted geometry, branches, and `traits.bankMax`.

## generateBankProfile(input, branches, bankMax)

Input is the arc-even ~3 m sample ring (`x`, `z`, `ds`, signed `kappa`,
`length`) that `finishCircuit` in `src/terrain/circuit.ts` already samples
for width choreography. Stations every `BANK_STATION_STEP = 5` m.

Pipeline:

1. Box-smooth signed curvature (+-12 m) so the sign cannot jitter, then
   `raw = -sign(ks) * bankMax * smoothstep(1/90, 1/30, |ks|)` — bank ramps
   in from corner radius 90 m, saturates at 30 m, inside edge low.
2. Proximity mask: per sample, min XZ distance to any sample more than
   60 m away in arc (`SampleIndex` radius query); level below 24 m,
   full bank beyond 40 m. The relax floors (20/34 m) put every keyhole
   hairpin bay under this mask, so hairpins stay level by design.
3. Start-zone mask: exactly 0 over `t in [0.92, 1) u [0, 0.045]` (strictly
   containing the width `START_ZONE` [0.93, 0.03]) with a 20 m ramp, so the
   gantry, start decal, and grid always sit on a level cross-section.
4. Junction mask: 0 within +-30 m of each branch anchor `tA`/`tB`
   (> `RIDGE_BLEND = 24`), 20 m ramp — the ridge blend mixes two edges'
   `pathY` and needs a level corridor.
5. Twist-rate cap: `BANK_SLOPE_MAX = 0.35 deg/m` (~10 deg over 30 m) via a
   toward-zero relaxation that shrinks the larger-magnitude side of each
   violating pair — masked zeros stay exactly zero.

`traits.bankMax` defaults to 10 deg, clamped to `BANK_MAX_CEILING = 12 deg`
in `resolveTrackTraits` (0 disables banking). Rationale for the ceiling: at
half-width 6 m, 10 deg is ~1.06 m of edge offset (inside the 8 m corridor
blend); world-down suspension rays lose < 2% length (cos), and an
unmodified AI only gains grip margin on a bank.

## Consumption

`GeneratedCircuit.mainBank` flows `Game.buildWorld` -> `TerrainOptions.
mainBank` -> `TrackGraph` (per-station `TrackEdge.bank` table + `bankAt(s)`,
zeros when absent; branch edges are always level) -> the `SplineFieldCache`
bake, which tilts the cached `pathY` grid inside the corridor (see
[height-pipeline.md](height-pipeline.md) "Corridor Invariance"). Everything
downstream — mesh, collider, colors, normals, skid marks — flows through
the one shared `heightAt`, so no other consumer changes. The kart follows
the tilt because its upright torque targets the averaged suspension contact
normals (`uprightTargetFromNormals` in `src/kart/KartController.ts`).

# Citations

- [Circuits](/terrain/circuits.md) — `generateCircuit` + accept gate
- [Height Pipeline](/terrain/height-pipeline.md) — field cache + `heightAt`
- [Track Traits](/terrain/track-traits.md) — `bankMax`
