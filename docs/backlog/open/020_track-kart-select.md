# 020 Track + kart select

Status: open (concept — to be refined)

## Context

Split from 012 (pause + settings v1). 012's concept bundled select, but
select needs real plumbing absent today. Retired here as its own concept.

## Goal

- Track select: pick between circuits (needs >1 circuit).
- Kart select: pick kart (cosmetic colors + maybe a tuning variant).

## Needs refinement

- Multi-track: SplineTrack is config-driven (`SplineTrack.ts:56-59`,
  `TerrainOptions.control` `Terrain.ts:30-31`) BUT the circuit geometry is
  hardcoded across Game + FieldBuilder: `AI_AHEAD_STEP`, `CORRIDOR_HALF_WIDTH`,
  `RESPAWN_AHEAD_T` now live in `FieldBuilder.ts` (moved out of Game by 012
  commit 1), `MENU_CAM_*` stay in `Game.ts`, shadow ortho `Renderer.ts:130`,
  fog `Renderer.ts:99`. A 2nd circuit retunes these. Parameterize a
  CircuitPreset {control, worldSize, trackHalfWidth, aiStep, cam, fog,
  shadow}; pass through Game -> FieldBuilder -> Terrain -> SplineTrack.
- Kart param: add `colors: KartColors` ctor arg to `Kart` (`Kart.ts:38-46`,
  currently index-derived from `PALETTE` `:18-23`) + plumb chosen `tuning`
  (`KartController tuning` `KartController.ts:98-103`, `DEFAULT_TUNING`
  `:28-47`) through FieldBuilder.build. Kart index must stay (audio pan/voice
  routing, `AudioManager.setHumanCount`). Kart variant = a preset registry.
- Flow placement: menu -> select -> countdown? New `select` state or a menu
  sub-screen? Reuse 006 overlay pattern (`src/ui/`).
- Gamepad nav: reuse 012's `menuNav` (`src/ui/menuNav.ts`) — landed.
- Field rebuild on circuit/mode change already proven by `onStart`'s
  `field.dispose()` + `field.build()` pair (`Game.ts`); extend to chosen
  preset.

## Dependencies

012 (menuNav, settings persistence pattern, overlay conventions). 007 (>0
finished circuit). Kart tuning extraction (already present). Multi-track gate
(CircuitPreset + retuned constants) is the hard part.
