---
type: Subsystem
title: Menu Styles
description: Shared menu button/panel/selector visual kit — primary, secondary, ghost styles.
tags: [ui, menu, styling]
timestamp: 2026-07-05T00:00:00Z
---

# Menu Styles (070)

Single source for overlay button visuals. Pure string builders (no DOM
mutation in builders), so overlays keep the plain `HTMLElement + cssText`
pattern and jsdom tests assert on strings directly.

## Button Kinds

| Kind        | Visual                      | Use                            |
| ----------- | --------------------------- | ------------------------------ |
| `primary`   | Yellow gradient, ink text   | Screen confirm action (START)  |
| `secondary` | Blue gradient, ink text     | Supporting: settings/back/quit |
| `ghost`     | Translucent bordered, light | Low-emphasis inside panels     |

**Accent color**: `MENU_ACCENT = #ffd23f` (shared with HUD highlights +
focus outlines).

## API

- **`buttonStyle(kind, extra)`**: Returns cssText string. `extra` appends
  after base declarations so callers override size/padding per screen.
- **`styleMenuButton(btn, kind, extra)`**: Applies cssText + adds
  `gc-btn gc-btn-<kind>` CSS classes so the shared `MENU_CSS` hover/active
  rules fire.

## Shared Styles

| Export                 | Use                                    |
| ---------------------- | -------------------------------------- |
| `PANEL_STYLE`          | Frosted card grouping controls         |
| `SELECTOR_ROW_STYLE`   | Focusable `LABEL  < value >` row       |
| `SELECTOR_LABEL_STYLE` | Left-aligned row label                 |
| `SELECTOR_VALUE_STYLE` | Centered row value                     |
| `CHEVRON_STYLE`        | Small step-button inside selector rows |
| `MENU_CSS`             | Shared hover/active/focus CSS block    |

`MENU_CSS` uses `:focus` (not `:focus-visible`) because `MenuNav` drives
focus programmatically for keyboard AND gamepad navigation — both need a
visible ring. Primary buttons get a white focus outline; all others use
`MENU_ACCENT`.

## Overlay Integration

Overlays call `styleMenuButton(el, "primary")` etc. and inject `MENU_CSS`
once via their existing `<style>` node. Enter/Space in `StartMenu` activates
the currently **FOCUSED** control: SETTINGS opens settings, everything else
confirms START.

## Citations

- [Overlays](/ui/overlays.md)
