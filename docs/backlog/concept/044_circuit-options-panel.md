# 044 Circuit options panel

Status: open (concept - to be refined)

## Context

Split from 037. Superseded in part by 037 v3: layout + biome are now purely
seed-derived (no difficulty/elevation knobs shape the track), and free seed
entry + randomize + copy ship in the `SeedPicker` (stage 058). What remains
worth doing is the LIVE PREVIEW - showing the seed's loop (and, once branches
exist, its shape) in the menu before committing.

## Goal

- Live preview of the resulting loop in the menu: a minimap-style outline of
  the mainline (+ branch polylines once 060 lands) redrawn per seed change.
  Cheap because the generator is pure (058/057) - no `rebuildWorld`.
- (Optional) a fuller Race Setup screen if more per-race options accrue.

## Needs refinement

- Preview cost: re-running `generateCircuit` + a 2D outline per change is
  cheap (pure); a live menu-cam rebuild is not (`rebuildWorld`). Use the
  outline, not the cam.
- Where the outline draws: reuse `Minimap` shape rendering (060) in a menu
  panel, or a dedicated canvas.
- If a Race Setup screen is added, reuse 024/042's `onHorizontal` MenuNav.

## Depends on

058 (`generateCircuit` + `SeedPicker` + short code). 060 (`Minimap` branch
shape rendering to reuse for the preview). 024/042 (MenuNav / Race Setup
pattern) if a fuller screen is built.
