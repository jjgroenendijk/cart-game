# 006 Start menu + countdown + game state machine

Status: open

## Goal
Fancy title screen -> Start -> 3-2-1-GO countdown -> race. Gate the simulation
behind a state machine so the menu gets a live 3D background while physics/input
stay frozen until racing.

## Scope
- New `src/ui/StartMenu.ts` (DOM overlay, matches loading/HUD pattern):
  animated "GAME CART" title, Start button, controls list, live 3D bg
  (cinematic cam orbit over track / spinning kart).
- New `src/ui/Countdown.ts`: 3-2-1-GO overlay, audio beeps (005), -> racing.
- Game state machine in `src/core/Game.ts`: `'menu' | 'countdown' | 'racing'`.
  Render loop always runs; fixed-timestep physics/kart-input only when racing.
- Change `main.ts`: don't call `game.start()` unconditionally; show menu first,
  start race on Start -> countdown -> racing.
- Resume AudioContext on Start click (005 gesture).

## Non-goals
- No pause/settings (out of chosen scope). No track/kart select.

## Acceptance
- [ ] Title shows w/ live 3D bg -> Start -> 3-2-1-GO w/ beeps -> driving
- [ ] No physics/input before racing
- [ ] typecheck clean

## Depends on
003 (terrain for menu bg), 005 (audio beeps).
