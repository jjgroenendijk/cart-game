# 045 Variable road width

Status: open (concept - to be refined)

## Context

Split from 037. `trackHalfWidth=6` is duplicated as a literal across 8 source
files (heightmap, AiDriver, FieldBuilder, KartGrid, propSampler, Environment,
critters, PropField). 037 v1 keeps width fixed at 6 so all stay correct;
varying corridor width per-circuit needs the literals consolidated to one
threaded source first, then per-circuit width is safe.

## Goal

- Consolidate the 8 `trackHalfWidth` literals onto one config source
  (`TerrainConfig.trackHalfWidth`); `AiDriver.CORRIDOR_HALF_WIDTH`,
  `FieldBuilder`, and `KartGrid` read it from there.
- Let `CircuitPreset` carry a `trackHalfWidth`; widen/narrow corridors per
  circuit (tight chicanes vs wide speed bowls).

## Needs refinement

- Threading path: TerrainConfig -> AiTuning (so AiDriver reads it) +
  FieldBuilder/KartGrid read from terrain. Avoid a new global.
- Min-width floor: corridor must stay >= kart width + margin so 2-wide racing
  - grid spacing hold; derive from `KartGrid` spawn spacing.
- Validator: 037's curvature validator is width-independent, but a narrow
  width + sharp radius can make the AI run off-corridor; add a width x radius
  sanity check.

## Depends on

037 (`CircuitPreset` + generator). 003 (`TerrainConfig.trackHalfWidth`). 007
(`AiDriver` corridor + `KartGrid` spawn spacing).
