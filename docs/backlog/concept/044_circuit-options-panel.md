# 044 Circuit options panel

Status: open (concept - to be refined)

## Context

Split from 037. 037 v1 exposes circuits as named presets (each bundles a seed

- difficulty + elevation) plus RANDOM in the start menu. Per-knob control is
  deferred here so 037 stays a clean vertical slice.

## Goal

- Difficulty cycle (easy/medium/hard) + elevation cycle (flat/rolling/alpine)
  as their own menu rows, feeding `generateCircuit` opts directly instead of
  via preset bundles.
- Free seed text input (`hashSeed` the string) + a randomize button.
- Live preview of the resulting loop (minimap outline or menu cam).

## Needs refinement

- Cycle-row UI: reuse 024/042's `onHorizontal` MenuNav pattern.
- Where it lives: a Race Setup screen (like 042) vs. extra start-menu rows.
- Preview cost: re-running `generateCircuit` + a spline outline per change is
  cheap (pure), but a live menu-cam rebuild is not (rebuildWorld). Decide.
- Persist the free seed string (own localStorage key, schema-versioned).

## Depends on

037 (`generateCircuit` + `CircuitOptions`). 024/042 (cycle-row + MenuNav +
Race Setup pattern). 045 if width is also surfaced.
