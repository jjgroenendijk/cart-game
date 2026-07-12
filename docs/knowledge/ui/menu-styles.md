---
type: Subsystem
title: Menu Styles
description: "Editorial menu kit: buttons, layout primitives, overlay scaffolding."
tags: [ui, menu, styling]
timestamp: 2026-07-12T00:00:00Z
---

# Menu Styles

Single source for overlay visuals. Pure string builders (no DOM mutation in
builders), so overlays keep the plain `HTMLElement + cssText` pattern and jsdom
tests assert on the produced strings directly. The kit was reskinned from the
old arcade look (yellow/blue gradients) to a flat, biome-neutral editorial
language and added a layout-primitive vocabulary.

## Neutral Tokens

Centralized so the chrome reads over any biome background (the warm tropical
palette belongs to the tropical scene only, not here).

| Token         | Value                        | Use                                |
| ------------- | ---------------------------- | ---------------------------------- |
| `INK`         | `#eef2f7`                    | Near-white body/heading ink        |
| `INK_MUTED`   | `rgba(238,242,247,0.6)`      | Kicker labels, telemetry keys      |
| `PANEL_INK`   | `rgba(10,14,20,0.62)`        | Translucent dark panel fill        |
| `HAIRLINE`    | `rgba(238,242,247,0.22)`     | Rules, dividers, corner marks      |
| `SERIF_STACK` | `Georgia,"Times New Roman"…` | System serif display (no web font) |
| `MENU_INK`    | `#0b0f14`                    | Dark ink text on filled buttons    |
| `MENU_ACCENT` | `#ffd23f`                    | Focus-outline accent only          |

## Button Kinds

Flat, sharp-cornered (`border-radius:0`), tracked uppercase — no gradient, no
3D lift.

| Kind        | Visual                                | Use                            |
| ----------- | ------------------------------------- | ------------------------------ |
| `primary`   | Near-white `INK` fill, dark ink text  | Screen confirm action          |
| `secondary` | Translucent + hairline border, `INK`  | Supporting: settings/back/quit |
| `ghost`     | Transparent + faint border, muted ink | Low-emphasis inside panels     |

- **`buttonStyle(kind, extra)`**: returns cssText; `extra` appends after the
  base so callers override size/padding per screen (last declaration wins).
- **`styleMenuButton(btn, kind, extra)`**: applies cssText + adds
  `gc-btn gc-btn-<kind>` classes so the shared `MENU_CSS` hover/active/focus
  rules fire.

`MENU_CSS` uses `:focus` (not `:focus-visible`) because `MenuNav` drives focus
programmatically for keyboard AND gamepad — both need a visible ring. Primary
buttons get a white focus outline; all others use `MENU_ACCENT`. `MENU_CSS`
also carries the `gc-pulse` status-dot keyframe.

## Editorial Layout Primitives

Pure cssText builders composing the "field notes" language. Each styles one
node; the overlay assembles them.

| Builder                          | Produces                                     |
| -------------------------------- | -------------------------------------------- |
| `kickerLabel` / `kickerRow`      | Tracked uppercase muted label + its row      |
| `hairlineRule(len, vertical?)`   | 1px translucent rule (divider / leader)      |
| `displayHeading`/`displayAccent` | Serif light display + italic accent span     |
| `telemetryRow`/`Key`/`Value`     | Right-aligned key/value (muted key, bright)  |
| `statusDot`                      | ~6px dot on the `gc-pulse` keyframe          |
| `cornerMark(corner, size?)`      | 1px L-bracket for one framed corner          |
| `vignetteLayer`                  | Full-inset radial corner-darkening layer     |
| `grainLayer`                     | Full-inset film grain (inline SVG; see note) |

`grainLayer`'s image is an inline SVG `feTurbulence` data URI — no committed
asset file (zero-media rule).

The legacy arcade primitives (`PANEL_STYLE`, `SELECTOR_*_STYLE`,
`CHEVRON_STYLE`) are gone; the editorial selector-row set below replaced them.

## Overlay Scaffolding

Every full-screen overlay shares one skeleton so screens stay consistent and
new ones are cheap to add:

- **`overlayRootStyle({dim?})`**: full-bleed absolute root, z-index 10,
  `pointer-events:none`, `overflow:hidden` (clips the frame layers). `dim`
  adds the shared `rgba(0,0,0,0.55)` backdrop (pause/settings).
- **`overlayScrollerStyle(gap?)`**: the centered content column INSIDE the
  root — `overflow-y:auto` + `justify-content:safe center` (with plain
  `center` fallback) so short viewports scroll instead of clipping the
  centered flex content. Carries the responsive edge padding.
- **`mountEditorialFrame(root, {grain?})`**: appends the decorative frame —
  `gc-vignette`, optional `gc-grain`, four `gc-corner` brackets — classed so
  CSS media rules can adapt them. Append before content so content stacks
  above.

Interactive key/value rows share the selector set: `selectorRowStyle()`
(hairline-topped, focusable, cycles on click; tag `gc-row` for the focus
ring), `telemetryKey()` for the label, `selectorValueStyle()` for the value,
`selectorChevronStyle()` for prev/next tap targets, and `hintRowStyle()` for
keyboard-hint lines (tag `gc-kb-hints`; hidden on coarse pointers).

## Responsive / Touch Rules

`MENU_CSS` carries them on the shared classes: coarse pointers get >=44px
`gc-btn` targets, >=38px `gc-chevron` targets, and `gc-kb-hints` hidden;
viewports <=480px stretch `gc-btn-primary`/`gc-btn-secondary` toward full
width so stacked overlay actions read as a column (ghost buttons keep
content width — they sit inline in rows like the seed-picker header).
`displayHeading()` clamps down to 32px so serif mastheads fit phones.

## Start-Menu Presentation Split

`src/ui/startMenuStyles.ts` holds the start menu's field-journal presentation —
copy (`MODE_LABELS`, `META_LINE`, `controlsHtml`) + cssText constants
(`ROOT_STYLE`, `IDENTITY_STYLE`, `SEED_BLOCK_STYLE`, `SEED_HEAD_STYLE`,
`HINTS_STYLE`,
`CONSOLE_STYLE`, `START_BTN_STYLE`, `SETTINGS_BTN_STYLE`, the `ROW_*` selector
styles, `DIVIDER_STYLE`) + a `LOCAL_CSS` block. Split out to keep `StartMenu.ts`
under the 600-line cap; still pure strings.

The console controls (START, MODE/BIOME rows, chevrons, SETTINGS) are
transparent text with sharp corners; their hover fill lives in `LOCAL_CSS`
(`.gc-start:hover`, `.gc-settings:hover`, `.gc-console-row:hover`,
`.gc-cchev:hover`), which also neutralizes the shared `gc-btn` hover transform.
`LOCAL_CSS` further styles the masthead shadow + the keycap chips in the
drive-controls hint, and carries the small-screen restack: at
`(max-width: 720px)` or `(max-height: 460px)` the `gc-menu-root` becomes a
scrollable column (identity, seed, console; hints + corner brackets hidden),
using `!important` to beat the corner blocks' inline cssText.

## Overlay Integration

Overlays call `styleMenuButton(el, "primary")` etc. and inject `MENU_CSS` (plus
any local CSS) once via their `<style>` node. Enter/Space in `StartMenu`
activates the currently **FOCUSED** control: SETTINGS opens settings, everything
else confirms START.

## Citations

- [Overlays](/ui/overlays.md)
