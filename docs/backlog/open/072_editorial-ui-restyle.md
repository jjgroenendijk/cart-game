# 072 Editorial UI restyle (biome-neutral, all overlays)

Status: open (full plan; ready for execution)

## Context

The reference scene "Palm Shore — Golden Hour" pairs a warm 3D scene with an
editorial UI layout: a thin uppercase tracked kicker label with a leading
hairline rule, a large serif display heading with an italic accent, hairline
dividers, a right-aligned key/value telemetry block, a bottom status bar with
pulsing dots + a controls hint, L-shaped corner brackets, a soft vignette, and a
film-grain overlay. The current menus (070 redesign) use an arcade look: yellow
gradient buttons, a "GAME CART" gradient-shine title, a checkered ribbon.

The user wants the reference's LAYOUT + TYPOGRAPHY language (not its warm coral/
amber palette) adopted across all overlays. The chrome must be biome-neutral: the
menu renders over a live 3D background of whatever biome is selected, so the
styling must read on any biome. The warm palette belongs only to the tropical
scene (see 073); this task stays neutral.

UI today is plain-DOM overlays in `src/ui/`: no framework, no CSS modules. Styling
is inline `element.style.cssText` built from exported string builders in
`src/ui/menuStyles.ts`, plus one injected `<style>` node per overlay for
pseudo-states/keyframes. jsdom tests (`src/ui/StartMenu.test.ts`) assert on the
produced strings, so builders must stay pure. Only two named color constants
exist (`MENU_INK`, `MENU_ACCENT`); there is no token/spacing scale and no web
fonts (system stacks only, per the zero-asset rule).

## Goal

Extend the `menuStyles.ts` kit with an editorial layout vocabulary and apply it
to every overlay, biome-neutral:

- Kicker labels, serif display heading, hairline dividers, telemetry rows,
  pulsing status dots, corner brackets, vignette layer, film-grain layer.
- A small neutral token set (near-white ink, translucent dark panel, hairline
  greys) so the palette is centralized; keep the focus-outline accent.
- Serif display + system-sans body via system font stacks only (no web fonts).
- Retire the arcade motifs (checkered ribbon, gradient-shine title) in favor of
  the editorial heading; keep button affordances (primary/secondary/ghost) but
  reskin them neutral.

## Non-goals

- No warm coral/amber palette (that is 073's tropical scene only).
- No web fonts / no committed font binaries (system stacks only).
- No 3D/scene changes (bloom, vignette-in-shader, sky) — those are 074.
- No behavior/navigation changes (menuNav focus model, SeedPicker logic stay).
- No new overlay screens; restyle existing ones only.

## Architecture (change)

```text
src/ui/menuStyles.ts        # ADD editorial primitives (pure string builders):
                            # kickerLabel, displayHeading (system serif stack),
                            # hairlineRule/dividerRule, telemetryRow,
                            # statusDot, cornerMarks, vignetteLayer, grainLayer
                            # (inline SVG feTurbulence data URI; NO asset file).
                            # ADD neutral token consts (ink/panel/hairline) +
                            # `gc-pulse` keyframe in MENU_CSS. If file nears the
                            # 600-line cap, split into menuStyles.editorial.ts.
src/ui/menuStyles.test.ts   # NEW: unit tests for the new string builders.
index.html                  # body font stack: system serif display + sans body;
                            # optional neutral :root custom properties.
src/ui/StartMenu.ts         # kicker + serif title + telemetry sidebar + bottom
                            # status bar/controls hint + corner marks + vignette
                            # + grain; drop checkered ribbon + gradient-shine.
src/ui/StartMenu.test.ts    # update string assertions to new markup.
src/ui/PauseOverlay.ts      # editorial header + hairline + neutral buttons.
src/ui/SettingsOverlay.ts   # editorial header + telemetry-style rows.
src/ui/RaceConfigOverlay.ts # editorial header + selector rows restyle.
src/ui/KartSelectOverlay.ts # editorial header restyle.
src/ui/RaceHud.ts           # kicker/telemetry language; keep 2P legibility.
src/ui/Minimap.ts           # frame/label restyle to match.
src/ui/LifeBar.ts           # restyle to match.
src/ui/StatsHud.ts          # telemetry rows (already key/value-ish).
src/ui/Countdown.ts         # serif numerals + neutral treatment.
src/ui/resultsDisplay.ts    # editorial results layout.
docs/knowledge/ui/menu-styles.md  # document new primitives + tokens.
docs/knowledge/ui/overlays.md     # document editorial layout language.
```

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(ui): editorial kit primitives (labels, telemetry, corner marks, vignette, grain)`
   - `menuStyles.ts` builders + neutral tokens + `gc-pulse` keyframe;
     `menuStyles.test.ts` covers each builder (pure-string assertions).
2. `feat(ui): restyle start menu with editorial layout`
   - `StartMenu.ts` kicker + serif title + telemetry sidebar + bottom status bar
     - corner marks + vignette + grain; drop ribbon/shine; `index.html` fonts;
       update `StartMenu.test.ts`.
3. `feat(ui): restyle pause, settings, race-config, kart-select overlays`
   - `PauseOverlay.ts`, `SettingsOverlay.ts`, `RaceConfigOverlay.ts`,
     `KartSelectOverlay.ts` to the editorial language.
4. `feat(ui): restyle in-race HUD, countdown, results`
   - `RaceHud.ts`, `Minimap.ts`, `LifeBar.ts`, `StatsHud.ts`, `Countdown.ts`,
     `resultsDisplay.ts`; verify legibility in 2P split.
5. `docs: refresh ui knowledge + move 072 to pending-review`
   - `docs/knowledge/ui/menu-styles.md`, `docs/knowledge/ui/overlays.md`.

## Look targets

- Kicker: ~10px, uppercase, ~0.4em letter-spacing, leading 28px hairline rule.
- Display heading: system serif stack (`Georgia, "Times New Roman", serif`),
  light weight, `clamp(...)` large, italic-accent span support.
- Dividers: 1px, translucent, ~40-60px hairlines.
- Telemetry: right-aligned key/value rows, muted key, brighter value.
- Status dot: ~6px, `gc-pulse` glow.
- Corner brackets: ~24px L-shapes, 1px translucent, all four corners.
- Vignette: ~12% corner darkening, wide radius. Grain: ~8% opacity, `overlay`.
- Neutral on every biome (no warm palette).

## Risks

- 600-line cap on `menuStyles.ts` — split into a second module if needed.
- jsdom tests assert strings — keep all builders pure (no DOM mutation).
- HUD legibility in 2P split-screen — verify both halves; grain/vignette on the
  HUD may hurt readability, so gate those to menu/overlay screens, not the race
  HUD, if they interfere.
- Full-screen grain `mix-blend-mode: overlay` cost — it is a single static div;
  confirm no per-frame cost.
- Neutral palette must still contrast over bright biomes (desert/tundra) and dark
  ones (swamp) — verify panel translucency holds.

## Acceptance

- [ ] Editorial kit primitives exist in `menuStyles.ts` with passing unit tests.
- [ ] Start menu shows kicker + serif heading + telemetry + status bar + corner
      marks + vignette + grain; no checkered ribbon / gradient-shine remain.
- [ ] Pause, settings, race-config, kart-select, HUD, countdown, results all use
      the editorial language and stay legible (1P + 2P).
- [ ] Palette is biome-neutral; readable over every biome background.
- [ ] No web fonts / no committed font or image assets (grain is inline SVG).
- [ ] Navigation/focus (menuNav) and SeedPicker behavior unchanged.
- [ ] All touched files `<= 600` lines; each line `<= 100` chars.
- [ ] `npm run verify` + hooks green.

## Verification

- `npm run dev`; open start menu — confirm kicker/serif/telemetry/status/corner/
  vignette/grain over 2-3 different biome backgrounds (neutral read on each).
- Tab/arrow/gamepad through controls — focus outlines intact (menuNav unchanged).
- Enter a race: check HUD, pause (Esc), settings, results; verify 2P split-screen
  legibility. Countdown numerals render.
- `npm run verify:changed` per commit; `npm run test` for `menuStyles.test.ts` +
  `StartMenu.test.ts`.

## Depends on

Builds on 070 (menuStyles kit, pending-review). Independent of 073/074. Touches
all `src/ui/` overlays; coordinate with any in-flight overlay work.
