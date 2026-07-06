# 076 Editorial restyle — in-race HUD, countdown, results

Status: open (concept — carve-out from 072, to be refined)

## Context

Carved out of 072 (editorial UI restyle) Commit 4. The menus + overlays
(start menu field-journal layout, pause, settings, race-config, kart-select)
adopted the editorial "field notes" language: neutral tokens, kicker labels,
serif display heading, hairline dividers, telemetry rows, corner brackets,
vignette + grain — all from the pure cssText builders in `src/ui/menuStyles.ts`
(kit) + `src/ui/startMenuStyles.ts` (start-menu presentation). The in-race
surfaces still carry the older arcade look and were split out so the menu work
could land + be reviewed independently.

## Scope

Bring the editorial language to the surfaces shown during a race:

- `src/ui/RaceHud.ts` — speed gauge, position, lap counter.
- `src/ui/Minimap.ts` — canvas frame + labels.
- `src/ui/LifeBar.ts` — water life-drain bar.
- `src/ui/StatsHud.ts` — F3 perf overlay (already key/value-ish → telemetry rows).
- `src/ui/Countdown.ts` — serif numerals + neutral treatment.
- `src/ui/resultsDisplay.ts` — editorial results layout.

## Approach (to be refined)

- Reuse the `menuStyles.ts` primitives (kickerLabel, telemetryRow/Key/Value,
  hairlineRule, cornerMark, displayHeading, neutral tokens) so the HUD reads as
  the same system as the menus. No new palette.
- The HUD is not an overlay panel: it sits over live gameplay and must stay
  glanceable. Prefer telemetry-style key/value rows + hairlines over heavy
  chrome. Keep the accent minimal.
- Countdown numerals in the serif display stack (Georgia), light weight, large
  clamp — but verify legibility at speed.

## Risks

- 2P split-screen legibility: verify BOTH halves at their reduced size. HUD
  text must stay readable; avoid dense telemetry blocks that crowd a half.
- Grain + vignette were deliberately kept OFF the race HUD in 072 (they hurt
  readability + the settings sliders). Do NOT bring the grain/vignette layers
  onto the race HUD; gate them to menu/overlay screens only.
- Per-frame cost: RaceHud/Minimap update every frame — keep restyle to static
  cssText set once; no per-frame string building.
- Canvas surfaces (Minimap) are drawn, not DOM-styled — the editorial "restyle"
  there is limited to frame/label chrome around the canvas.

## Acceptance (draft)

- HUD, countdown, results read as the same editorial system as the menus.
- 1P and 2P split-screen both stay legible; no grain/vignette on the race HUD.
- No new palette (biome-neutral); no committed assets; builders stay pure.
- All touched files <= 600 lines; each line <= 100 chars; verify + hooks green.

## Touch points

- `src/ui/RaceHud.ts`, `Minimap.ts`, `LifeBar.ts`, `StatsHud.ts`,
  `Countdown.ts`, `resultsDisplay.ts` (+ their tests).
- `src/ui/menuStyles.ts` (reuse primitives; extend only if a HUD-specific
  builder is genuinely shared).
- `docs/knowledge/ui/overlays.md` (document the HUD restyle when it lands).

## Related

- 072 editorial UI restyle (menus + overlays; this is its deferred Commit 4).
- 073 tropical warm scene palette (HUD stays neutral; tint is 073's scene only).
