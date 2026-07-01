# 020 Track + kart select

Status: retired (subsumed by 037: track-select + CircuitPreset absorbed
there; kart-select half shipped in 024)

## Context

Split from 012 (pause + settings v1). 012's concept bundled select, but
select needs real plumbing absent today. Retired here as its own concept.
The kart-variant half split off into 024 (full plan, ready for
execution); this item now covers track select only.

## Goal

- Track select: pick between circuits (needs >1 circuit).

## Needs refinement

- Multi-track: SplineTrack is config-driven (`SplineTrack.ts:56-59`,
  `TerrainOptions.control` `Terrain.ts:30-31`) BUT the circuit geometry is
  hardcoded across Game + FieldBuilder: `AI_AHEAD_STEP`,
  `CORRIDOR_HALF_WIDTH`, `RESPAWN_AHEAD_T` now live in `FieldBuilder.ts`
  (moved out of Game by 012 commit 1), `MENU_CAM_*` stay in `Game.ts`,
  shadow ortho `Renderer.ts:130`, fog `Renderer.ts:99`. A 2nd circuit
  retunes these. Parameterize a CircuitPreset {control, worldSize,
  trackHalfWidth, aiStep, cam, fog, shadow}; pass through Game ->
  FieldBuilder -> Terrain -> SplineTrack.
- Flow placement: menu -> select -> countdown? Reuse the select state +
  overlay pattern landed by 024.
- Gamepad nav: reuse 012's `menuNav` (`src/ui/menuNav.ts`) — landed; 024
  adds the `onHorizontal` L/R cycling pattern.
- Field rebuild on circuit/mode change already proven by `onStart`'s
  `field.dispose()` + `field.build()` pair (`Game.ts`); 024 extends the
  same pair to variant/circuit presets.

## Dependencies

012 (menuNav, settings persistence pattern, overlay conventions). 007
(>0 finished circuit). 024 (select state + KartSelectOverlay pattern;
kart variant plumbing through FieldBuilder). Multi-track gate
(CircuitPreset + retuned constants) is the hard part.
