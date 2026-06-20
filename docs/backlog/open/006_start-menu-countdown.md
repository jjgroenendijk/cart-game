# 006 Start menu + countdown + game state machine

Status: open (rewritten as full plan)

## Context
Zero menu/state infra today. Grep `StartMenu|Countdown|GameState|MenuCamera`
across `src/` -> 0 hits. The current sketch (`006:1-30`) was a wish list, not a
plan. Real constraints it ignored:

- Loop fusion: `Game.frame()` (`Game.ts:58-84`) runs fixed-step physics +
  render in ONE callback. Goal wants render always; physics/kart-input only
  when racing. 006 must gate the `while(acc>=STEP)` block (`Game.ts:70-75`)
  + `input.sample` (`Game.ts:66`) on `state==='racing'`, keep the per-render
  block (`Game.ts:77-83`) + RAF (`Game.ts:60`) always.
- Sketch `006:17` "don't call game.start() unconditionally" is WRONG.
  start() (`Game.ts:42-47`) only starts RAF; the live 3D bg needs it. 006
  keeps main.ts calling start(); race entry moves into the state machine on
  Start. main.ts change is ~nil (loop stays; `#loading` still hides after
  start `main.ts:22`, menu sits above it).
- ChaseCamera (`ChaseCamera.ts:43-46`) snaps on first update (`initialized`
  flag) and is welded to kart pos/forward/speed. Menu wants a separate
  cinematic camera -> needs a separate camera object. Switching back to
  racing must leave ChaseCamera.initialized=false so it snaps to desired on
  first racing frame (no lerp sweep from menu cam). Separate objects achieve
  this for free.
- Input never disabled: `Input` listens on window always (`Input.ts:47`);
  Space/Arrows preventDefault (`Input.ts:52`). Kart only moves if
  `input.sample` is called -> gating sample on racing (above) freezes the
  kart w/o an Input flag. Menu confirm uses StartMenu's OWN listeners
  (click + Enter/Space), not input.sample.
- Spawn today `(0,1.5,24)` (`Game.ts:31`) floats above ground; in menu (no
  physics step) kart hangs in air. Post-003 spawn = spline start at terrain
  height. A few settle steps during countdown drop it onto the surface so
  it reads resting + avoids a lurch at GO.
- HUD today = speed + controls list (`Game.ts:93-119`), always shown after
  ctor (`Game.ts:36`). 006 makes the menu own the controls list and reduces
  the racing HUD to speed-only (single source). HUD hidden in menu/countdown.
- 005 owns audio API + ships it SILENT (`005:193` exposes `audio` on Game);
  005 strict-blocks on 006 for the gesture. 006 wires Start->resume(),
  hover/click->uiBeep, countdown->uiBeep('beep'/'go'), state->
  setEngineActive. 006 consumes 005's API, never edits it.
- Game.dispose is shallow (`Game.ts:49-56`); 004/005 already extend it.
  006 adds menu/countdown DOM + listener + menu-cam teardown.
- UI pattern: plain HTMLElement, cssText, appendChild, remove on teardown
  (`Game.createHud` `Game.ts:93-119`; `hud.remove()` `Game.ts:55`). No
  `src/ui/` dir yet -> 006 creates it (005 note `005:42-43`).
- package.json has NO test/lint scripts today (only typecheck
  `package.json:11`). 000 owns the vitest+eslint+prettier harness + hooks.
  006 test gate = typecheck always; vitest once 000 lands (dormant meanwhile,
  mirrors 003/004/005).
- tsconfig strict + noUnusedLocals/Parameters (`tsconfig.json:17-18`); DOM
  lib present (`tsconfig.json:6`) -> StartMenu/Countdown DOM code fine.

## Goal
Title screen w/ animated "GAME CART" title + Start button + controls list
over a live 3D bg (cinematic high-altitude camera sweeping over the track).
Start (click / Enter / Space) -> resume audio -> 3-2-1-GO countdown w/ beeps
-> racing. State machine `'menu' | 'countdown' | 'racing'` gates
physics/input; render loop always runs.

Scope boundary (decided): menu + countdown + state machine only. Non-goals:
pause/settings, track/kart select, gamepad menu nav, camera blend/handoff
polish, traveling flyover along the spline, multi-language, credits. No
asset files (matches zero-asset repo).

## Architecture (new)

```
src/core/
  gameState.ts      # PURE: type GameState='menu'|'countdown'|'racing';
                    #   type GameEvent='start'|'countdownDone'.
                    #   transition(state, event): GameState. menu--start->
                    #   countdown; countdown--countdownDone->racing; racing
                    #   terminal; illegal/unknown -> state unchanged.
                    #   Unit-testable, no DOM/Game deps (mirrors 005
                    #   engineCurve pattern).
src/ui/
  StartMenu.ts      # DOM overlay (matches HUD pattern). Builds: root div
                    #   (pointer-events:none, z 10), animated title (CSS
                    #   @keyframes pulse/scale), Start button (pointer-events
                    #   auto), controls list. Confirm = button click OR
                    #   window keydown Enter/Space -> onStart() ONCE (guard
                    #   `started` flag; remove listener after). hover/click
                    #   -> audio.uiBeep('hover'|'click'). ctor(container,
                    #   audio, onStart). show()/hide()/remove() (detach DOM
                    #   + keydown listener). No assets.
  Countdown.ts      # DOM overlay: big centered number. update(dt): advances
                    #   phases at intervals (3,2,1,go); on phase CHANGE fires
                    #   audio.uiBeep('beep') for 3/2/1, uiBeep('go') for GO;
                    #   returns 'running'|'done'. On 'done' caller transitions
                    #   to racing. ctor(container, audio). show()/remove().
src/kart/
  MenuCamera.ts     # Cinematic high orbit OVER THE TRACK. PerspectiveCamera
                    #   (all layers, sees 0/1/2). target = scenic track point
                    #   sampled ONCE at ctor via SplineTrack.getPoint(t0)
                    #   (raised to orbit altitude look-height). update(dt):
                    #   yaw += yawSpeed*dt; pos = target + (cos*r, alt+bob,
                    #   sin*r); lookAt(target) w/ slight downward pitch.
                    #   Slow yaw => world/track sweeps under a high cam; kart
                    #   small/off-frame. setAspect on resize. Needs only ONE
                    #   getPoint at ctor (no per-frame spline dep, no
                    #   tangent). No kart-physics dependency.
src/core/
  Game.ts           # ctor: state='menu'; sample SplineTrack.getPoint(t0) for
                    #   MenuCamera target; build StartMenu(container, audio,
                    #   this.onStart) + Countdown(container, audio); append.
                    #   HUD hidden. createHud -> SPEED-ONLY (drop controls
                    #   block Game.ts:107-116; controls now on menu).
                    #   frame: RAF always; if state==='racing' -> run
                    #   fixed-step block + input.sample (existing
                    #   Game.ts:66-75) w/ real kartInput; elif state===
                    #   'countdown' -> fixed-step w/ ZERO input + linvel
                    #   zeroed each step (settle; kart rests at spawn); else
                    #   (menu) -> NO physics step. per-render: pick camera
                    #   (MenuCamera when state!=='racing' else ChaseCamera);
                    #   audio.update(dt, racing? real signals : zeros); HUD
                    #   visible iff racing. onStart: audio.resume(); state=
                    #   transition(state,'start'); audio.setEngineActive(
                    #   false); hide menu; show countdown. countdown 'done':
                    #   state=transition(state,'countdownDone'); audio.
                    #   setEngineActive(true); hide countdown; show HUD.
                    #   onResize: also menuCam.setAspect. dispose:
                    #   startMenu/countdown/menuCam teardown added next to
                    #   hud.remove() (Game.ts:55).
src/main.ts         # ~unchanged: game.start() (loop) stays; loading hides
                    #   after start (main.ts:22); menu already shown by Game
                    #   ctor above #loading. NO race-on-load.
```

## Contracts with 005 (cross-backlog)
- 006 calls `audio.resume()` from Start confirm handler (click OR Enter/Space
  -> all are gestures). Synchronous in handler (no async gap before resume).
- 006 StartMenu hover/click -> `audio.uiBeep('hover'|'click')`.
- 006 Countdown -> `audio.uiBeep('beep')` on 3/2/1 phase change,
  `audio.uiBeep('go')` on GO.
- 006 state machine: `audio.setEngineActive(false)` on entering
  menu/countdown; `audio.setEngineActive(true)` on entering racing.
- 006 consumes 005's public API only; edits nothing in `src/audio/`.

## Contracts with 003/001/002 (cross-backlog)
- 003: MenuCamera target = `SplineTrack.getPoint(t0)` (scenic point) sampled
  once at ctor; CatmullRomCurve3 (which 003 wraps) provides getPoint.
  Contract: 003 exposes `getPoint(t)` (or the raw curve). If absent,
  fallback target = world origin raised (0, alt, 0). Kart spawn = spline
  start at terrain height (post-003). 006 lands after 003 -> uses spline.
- 001: menu cam sees all render layers (0/1/2) -> default layer mask; no
  special handling. World (kart+terrain) already in scene from Game ctor.
- 002: sky dome is the menu backdrop (aesthetic only, no API).

## Commits (each atomic + green; gate = typecheck always + vitest once 001 lands)
1. `feat(core): add GameState machine (menu/countdown/racing) + tests`
   - `src/core/gameState.ts`: states, events, pure `transition()`. tests:
     menu--start-->countdown; countdown--countdownDone-->racing; racing
     terminal (any event -> racing); illegal event on menu (e.g.
     countdownDone) -> unchanged; deterministic (pure).
2. `feat(ui): add StartMenu overlay (title, Start, controls, beeps)`
   - `src/ui/StartMenu.ts`. CSS-animated title; Start btn + Enter/Space
     confirm -> onStart ONCE (guard flag + listener removal); hover/click ->
     audio.uiBeep. pointer-events root none / btn auto. remove() detaches.
     tests (jsdom): builds title+button+controls; click fires onStart; Enter
     fires onStart; second confirm no-op (guard); remove() detaches + stops
     firing.
3. `feat(ui): add Countdown overlay (3-2-1-GO timer + phase beeps)`
   - `src/ui/Countdown.ts`. update(dt) advances phases at intervals; phase
     CHANGE -> uiBeep('beep' for 3/2/1, 'go' for GO); returns
     'running'|'done'. tests: feed dt sequence -> phases 3,2,1,go at right
     cumulative times; each beep fires exactly once per phase; 'done' after
     GO hold; update before show no-op.
4. `feat(kart): add MenuCamera (cinematic high orbit over track)`
   - `src/kart/MenuCamera.ts`. target = scenic SplineTrack.getPoint(t0)
     (once); slow yaw orbit at large radius + altitude, slight downward
     look; all-layers PerspectiveCamera; setAspect. tests: pos stays on
     radius from target across dt; altitude within [alt-bob,alt+bob];
     setAspect updates projection; lookAt targets target. (Fallback ctor
     path w/ explicit target for tests w/o a spline.)
5. `refactor(game): wire state machine + cam select + HUD speed-only`
   - Game: state='menu'; createHud -> speed-only (drop Game.ts:107-116);
     HUD hidden initially. frame gates fixed-step + sample to racing;
     countdown = settle steps (zero input + linvel zeroed); menu = no step;
     per-render picks MenuCamera vs ChaseCamera; audio.update w/ zeros when
     !racing; HUD visible iff racing; setEngineActive by state; onStart/
     countdown-done transitions; dispose adds menu/countdown/menuCam
     teardown. main.ts stays (loop on, race gated). tests (mock audio +
     jsdom): ctor state=menu; createHud has NO controls block; frame in
     menu steps NO physics + renders menu cam; onStart -> state countdown +
     resume called + menu hidden; countdown done -> state racing +
     setEngineActive(true) + HUD visible; dispose detaches all three.
6. `docs: update backlog 006 + todo + README + troubleshooting`
   - mark 006 plan done in docs/todo.md; README project structure adds
     `src/ui/`; note state machine + menu flow + HUD-now-speed-only; add
     docs/troubleshooting/<DATE>_menu-countdown-verify.md recording the
     verify path (full menu->race visible only after 001-005 land; pixel-
     sample fallback per 2026-06-20_visual-verification-fallback.md).

## Risks
- Cam handoff snap (menu->chase) on race start: ChaseCamera.initialized
  stays false until first racing frame -> snaps to desired (existing
  behavior, ChaseCamera.ts:43-46). Acceptable; blend = polish, out of scope.
- Countdown settle drift: settle steps w/ zero input could nudge kart if
  linvel not zeroed. Mitigation: zero linvel each countdown step (Default);
  verify kart XZ stays at spawn within eps, log in docs/troubleshooting/.
- MenuCamera target needs 003 `SplineTrack.getPoint(t)`. CatmullRomCurve3
  provides it; if 003 doesn't expose, fallback target = (0, alt, 0).
  Verify at c4; one ctor sample only (no per-frame spline cost).
- Audio resume race: Enter/Space confirm must call resume() synchronously in
  the gesture handler (no await before). Autoplay policy else blocks.
- Double-Start: click + keydown both fire. Mitigation: `started` guard in
  StartMenu; first wins, removes listener.
- Input still captures Space/Arrows in menu (Input.ts:52 preventDefault) ->
  harmless (sample not called). Stale keys into racing: pressedThisFrame
  cleared each frame (Input.endFrame) -> no leak.
- Menu DOM over canvas: root pointer-events:none, button auto -> button
  clickable, canvas not blocked; overlay removed on start.
- z-index: `#loading` z 10 (index.html). Menu/countdown z 10 (parity);
  loading hides before menu is visible (main.ts:22). Confirmed non-overlap.
- Countdown beep kinds: depends on 005 shipping 'beep' + 'go' kinds
  (005:266-267). 005 lands first -> satisfied.
- HUD speed-only is a behavior change (controls no longer visible while
  racing). Decided: menu owns controls. Acceptable.
- Strict TS (tsconfig.json:17-18): MenuCamera/Countdown dt params used;
  StartMenu audio param used. No unused locals.
- Test harness absent until 000: typecheck-only gate meanwhile (mirrors
  003/004/005).
- Full visual verify (menu->countdown->race) gated on 001/002/003/005 all
  landed; pixel-sample fallback meanwhile (precedent:
  2026-06-20_visual-verification-fallback.md).
- Gamepad menu confirm: NOT wired (non-goal); keyboard+mouse only.

## Acceptance
- [ ] `src/core/gameState.ts`, `src/ui/{StartMenu,Countdown}.ts`,
      `src/kart/MenuCamera.ts` present; `src/ui/` dir created
- [ ] Title screen shows animated "GAME CART" + Start + controls over live
      3D bg (cinematic high orbit over the track)
- [ ] Racing HUD is speed-only; controls list lives on the menu
- [ ] Start (click OR Enter OR Space) -> audio.resume() -> 3-2-1-GO w/ beeps
      -> driving
- [ ] No kart physics/input before racing (kart frozen in menu; settle-only
      w/ zero linvel in countdown)
- [ ] State machine: menu--start-->countdown--done-->racing; illegal events
      no-op; racing terminal
- [ ] HUD hidden in menu/countdown, shown in racing
- [ ] audio.setEngineActive(false) in menu/countdown, (true) entering racing
- [ ] MenuCamera sweeps over the track; ChaseCamera used only when racing
- [ ] dispose() removes StartMenu + Countdown DOM + listeners + MenuCamera
- [ ] 0 new asset files added
- [ ] `npm run typecheck && lint && test` green; pre-commit hook green
- [ ] No black screen at `npm run dev`; visual verify (pixel-sample fallback
      until full stack lands), logged in docs/troubleshooting/

## Defaults
- states: 'menu' | 'countdown' | 'racing'
- events: 'start' | 'countdownDone'
- countdown: phase interval 0.75s (3,2,1), GO hold 0.6s; total ~2.85s
  (tunable)
- countdown settle: ON -> fixed-step physics w/ zero input + linvel zeroed
  each step (kart rests at spawn); menu = NO step (truly frozen)
- menu camera: orbit radius 28, altitude 18 (above terrain), yaw speed
  0.12 rad/s, bob amp 1.0m period 8s, fov 55, slight downward pitch, all
  layers; target = SplineTrack.getPoint(0.5) (scenic), fallback (0,alt,0)
- title: CSS @keyframes pulse/scale, no assets
- audio: hover sine / click triangle beeps on buttons; resume() on Start
  gesture; setEngineActive by state; uiBeep('beep') x3 + ('go') x1
- HUD: speed-only; visible iff state==='racing'
- menu confirm: left click, Enter, Space (gamepad = non-goal)
- z-index: StartMenu/Countdown 10 (parity w/ #loading, index.html)
- out of scope: pause/settings, track/kart select, gamepad menu nav, camera
  blend, traveling spline flyover, multi-language, credits

## Previous implementation
None. Greenfield -> grep `StartMenu|Countdown|GameState|MenuCamera` across
src/ = 0. Closest existing DOM-overlay patterns: `#loading` (index.html,
title "GAME CART", .hidden class) + `Game.createHud` (Game.ts:93-119,
cssText/appendChild/remove). 006 builds the menu/countdown layer from
scratch following the HUD pattern.

## Depends on
000 (harness). 005 (AudioManager API: resume/uiBeep/setEngineActive; ships
silent, 006 = gesture/integration consumer). 003 (SplineTrack.getPoint for
menu cam target + Terrain + spline-start spawn). 001 (render-layer system;
menu cam sees all layers — transitive via 003). 002 (sky backdrop —
aesthetic, transitive). Merge order: 006 LAST (after 000, 001, 002, 003, 005).
