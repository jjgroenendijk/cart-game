---
type: Subsystem
title: Menu Styles
description: "Editorial menu kit: neutral buttons, layout primitives, start-menu split."
tags: [ui, menu, styling]
timestamp: 2026-07-06T00:00:00Z
---

# Menu Styles (070 kit, 072 editorial reskin)

Single source for overlay visuals. Pure string builders (no DOM mutation in
builders), so overlays keep the plain `HTMLElement + cssText` pattern and jsdom
tests assert on the produced strings directly. 072 reskinned the kit from the
old arcade look (yellow/blue gradients) to a flat, biome-neutral editorial
language and added a layout-primitive vocabulary.

## Neutral Tokens

Centralized so the chrome reads over any biome background (the warm tropical
palette belongs to 073, not here).

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

## Editorial Layout Primitives (072)

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

Legacy shared styles (`PANEL_STYLE`, `SELECTOR_ROW_STYLE`,
`SELECTOR_LABEL_STYLE`, `SELECTOR_VALUE_STYLE`, `CHEVRON_STYLE`) remain for the
panel-based overlays (race-config etc.). The start menu no longer uses them; it
supplies its own transparent/sharp console styles (below).

## Start-Menu Presentation Split

`src/ui/startMenuStyles.ts` holds the start menu's field-journal presentation —
copy (`MODE_LABELS`, `META_LINE`, `controlsHtml`) + cssText constants
(`ROOT_STYLE`, `IDENTITY_STYLE`, `TELEMETRY_STYLE`, `HINTS_STYLE`,
`CONSOLE_STYLE`, `START_BTN_STYLE`, `SETTINGS_BTN_STYLE`, the `ROW_*` selector
styles, `DIVIDER_STYLE`) + a `LOCAL_CSS` block. Split out to keep `StartMenu.ts`
under the 600-line cap; still pure strings.

The console controls (START, MODE/BIOME rows, chevrons, SETTINGS) are
transparent text with sharp corners; their hover fill lives in `LOCAL_CSS`
(`.gc-start:hover`, `.gc-settings:hover`, `.gc-console-row:hover`,
`.gc-cchev:hover`), which also neutralizes the shared `gc-btn` hover transform.
`LOCAL_CSS` further styles the masthead shadow + the keycap chips in the
drive-controls hint.

## Overlay Integration

Overlays call `styleMenuButton(el, "primary")` etc. and inject `MENU_CSS` (plus
any local CSS) once via their `<style>` node. Enter/Space in `StartMenu`
activates the currently **FOCUSED** control: SETTINGS opens settings, everything
else confirms START.

## Citations

- [Overlays](/ui/overlays.md)
