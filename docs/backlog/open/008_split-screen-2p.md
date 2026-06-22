# 008 2-player split-screen

Status: open (full plan — ready for execution, gated only by review of 007)

## Context

README calls out "local 2-player split-screen co-op" (`README:4-5`) and lists it
undone (`README:23`). No split infra today: `Game.frame()` runs one fixed-step
physics pass + one render to one ChaseCamera (`Game.ts:185-234`,
`Game.ts:230`). Concept sketch flagged this a render/loop/audio multiplexing
problem, not a gameplay-rules one. Real constraints the sketch left open:

- Loop already steps N karts in ONE physics world. 007 steps P1 + 5 rivals
  (`Game.ts:258-308`) against the single `PhysicsWorld`, calling
  `physics.step()` once. P2 is just another `Kart` (`Kart.ts:38-48`, palette by
  `playerIndex` `Kart.ts:18-23`) -> no new world, no physics change. Decision:
  single world with two human karts (preferred over two worlds).
- Input is already 2P-ready. `PLAYER_BINDINGS[1]` = arrows
  (`Input.ts:30-37`); `sample(player, gamepadIndex=player)` maps P2 -> gamepad 1
  (`Input.ts:82`). No input change needed; Game just calls `sample(1)`.
- Render is the real work. `Renderer.render(camera)` builds ONE EffectComposer
  lazily (`Renderer.ts:98-128`, `Renderer.ts:138-149`) and rebinds one camera on
  every pass each frame. The two post passes are per-camera + per-size
  instantiable (`postOutline.ts:113-157`, `skyPosterize.ts:162-206`), and their
  fsQuad draws respect the renderer viewport + scissor -> two composers (one per
  view), rendered sequentially with `setScissorTest(true)` + per-view
  `setViewport`/`setScissor`, is the clean path. Shared shadow map (one
  DirectionalLight, `Renderer.ts:64-77`).
- Audio is single-voice today: one engine + one drift + one wind voice driven
  by one `{speed,throttle,drifting}` (`AudioManager.ts:204-208`). Per-player pan
  needs a second engine+drift voice with a `StereoPannerNode`. 008 owns the
  BASIC pan now (decision); 009 keeps positional/3D, doppler, music, collision.
  `AudioManager.ts` is 480 lines -> extracting a voice-set helper keeps it under
  the 600-line cap AND generalizes for N players.
- Race finish (007) ends when the LEADER completes N laps (`007` plan c3; shows
  P1's position). 2P must continue until BOTH humans finish. RaceManager needs a
  mode-dependent finish condition; 1P default stays 'leader' (no 007 regression).
- 006's machine is `menu|countdown|racing`, racing terminal (`gameState.ts:13`,
  `gameState.ts:21-29`). No change: both humans share the single `racing` state.
- Countdown settles the grid by zeroing XZ linvel (`Game.ts:302-305`,
  `zeroHorizontalLinvel` `Game.ts:369`). Extend the loop to also zero P2.
- `Game.ts` is 493 lines. 2P wiring (P2 kart, 2 views, per-human coast, audio
  multi-voice) blows the 600-line cap -> extract a `PlayerView` bundle.
- `Game.test.ts` mocks `Renderer.render` (`Game.test.ts:7-18`) and spies on
  `audio.update` reading a single state (`Game.test.ts:64-80`). Switching to
  `renderViews`/`updatePlayers` updates those tests (c7+c8).
- `dispose` already removes rival bodies + groups (`Game.ts:174-177`); extend to
  P2's body + group + HUD (PlayerView.dispose).
- tsconfig strict + noUnusedLocals/Parameters (`007` plan c8); DOM lib present
  -> DOM HUD + canvas minimap fine. jsdom has no WebGL/canvas2d -> keep
  WebGL-free pure helpers exported for unit tests (splitRects, panForIndex,
  viewHudAnchor).

## Goal

Local 2-player split-screen (top/bottom) co-op on the 007 circuit:

- second human kart (own RigidBody + KartController + mesh), grid slot 1
- two viewports, two cameras (one EffectComposer per view, scissor split)
- P2 input via existing PLAYER_BINDINGS[1] (arrows) / gamepad 1
- per-player HUD (speed + lap/pos/timer) anchored to each viewport
- per-player audio: second engine+drift voice, StereoPanner pan (P1 left, P2
  right); shared wind
- 1P/2P mode toggle on the StartMenu (default 1P -> zero 1P regression)
- race continues until both humans finish; results show both positions
- shared minimap, centered on the horizontal seam in 2P

Scope boundary (decided): human 2P only. Non-goals below.

## Architecture (new)

```text
src/audio/
  voiceSet.ts        # PER-PLAYER voice bundle: engine (3 detuned saws + sub
                     #   sine -> lowpass -> gain) + drift (noise -> bandpass ->
                     #   gain) + StereoPannerNode. build/stop/update/dispose.
                     #   Pure-ish (Web Audio nodes; testable via mockAudioContext).
                     #   Exports panForIndex(i, n): 1 voice -> 0; 2 -> -1,+1.
src/core/
  PlayerView.ts      # Bundles one human's race surface: {kart, chaseCam,
                     #   speedHud el, raceHud, viewportRect}. update(dt, input,
                     #   driving) drives cam + flags; sync() copies kart xform;
                     #   hud(state) positions DOM. Exports PURE splitRects(w,h,
                     #   axis, n) -> Rect[] (WebGL bottom-origin) + viewHudAnchor(
                     #   rect, corner) -> CSS {left,top} for tests. dispose().
  Renderer.ts        # ADD renderViews(views:{camera,rect}[]). Lazy one
                     #   composer per slot index, sized to its rect; on rect
                     #   resize, setSize composer + passes. Per view:
                     #   setScissorTest(true) + setViewport/setScissor(rect);
                     #   rebind pass cameras; camera.layers.enable(1)/(2);
                     #   updateLightUniforms per camera; composer.render().
                     #   render(camera) -> renderViews([{camera, fullScreenRect}]).
                     #   setShadowTarget(midpoint of humans) in Game.
src/race/
  raceManager.ts     # ADD opts finishWhen:'leader'|'allHumans' (default
                     #   'leader') + humanCount. Finish fires once when
                     #   (leader lap>=N) OR (all human laps>=N). Ranking unchanged.
src/ui/
  StartMenu.ts       # ADD 1P/2P toggle (two buttons or a cycle). onStart(mode).
                     #   Default 1P. Hover/click beeps (006 pattern). Controls
                     #   list adds the P2 arrows row when 2P.
  RaceHud.ts         # ADD ctor anchor {left,top} so each view's HUD sits inside
                     #   its own viewport. update() unchanged.
  Minimap.ts         # ADD place({left,top}) so 2P centers it on the seam; 1P
                     #   keeps bottom-right.
src/core/
  Game.ts            # mode (1P|2P) from StartMenu. humanCount = mode. rivalCount
                     #   = TARGET_FIELD(6) - humanCount. Grid for 6; slots 0..h-1
                     #   = humans (P1 slot 0, P2 slot 1), rest rivals. Build
                     #   PlayerView[] (1 or 2). frame(): renderViews(views) with
                     #   each view's chase cam (menu cam still single full-screen
                     #   pre-race). stepWorld: step each human view.kart with
                     #   input.sample(humanIndex) when driving AND that human not
                     #   yet finished (lap>=N -> zeroInput coast); rivals as 007.
                     #   countdown zeroes all humans. audio.updatePlayers(dt,
                     #   humanStates[]). shadow target = midpoint of humans.
                     #   results: both humans' positions. dispose: each view.
```

## Contracts with 001/002/003/004/005/006/007/009

- 001: transitively. P2 reuses `Kart` (makeCel); 008 imports no material.
- 002: none directly. Two composers each run SkyPosterize; the sky layer-2 mask
  contract holds per view (each view's depth pre-pass is its own camera).
- 003: consume `SplineTrack` + `Terrain.heightAt` (grid Y, respawn) as 007.
- 004: none new (rng already consumed by 007).
- 005: extends `AudioManager` (voice-set extraction). 1P audio bit-identical.
  Autoplay guard (ctx lazy in resume) preserved: voices built inside resume().
- 006: hook StartMenu (onStart now carries mode); countdown-done transition
  unchanged. Does NOT modify `gameState.ts` (`gameState.ts:21-29`). Split
  manifests only in `racing`; menu/countdown stay single full-screen view.
- 007: consume RaceManager + RaceHud + Minimap + KartGrid + rivals. RaceManager
  gains finishWhen/humanCount (additive; 1P default = 007 behavior). Rivals
  reduced by 1 in 2P (6 total). 007 must be reviewed/landed first (P2 grids
  alongside rivals; per-kart ranking reused).
- 009: 008 takes BASIC per-player pan (StereoPanner). 009 keeps positional/3D,
  doppler, music bed, collision/respawn cues. Note handoff in 008 plan body;
  009 sketch updated at 008 implementation time.

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `refactor(audio): extract per-player voice set helper`
   - `src/audio/voiceSet.ts`: engine+drift+panner bundle; build/stop/update/
     dispose; `panForIndex(i,n)`.
   - `AudioManager`: hold `VoiceSet[]` (1, center); `update(dt,state)` delegates
     to voice[0]. 1P behavior + existing audio tests unchanged.
   - tests: voiceSet build wires nodes (mock ctx); panForIndex(0,1)=0,
     panForIndex(0,2)=-1, panForIndex(1,2)=+1.
2. `feat(render): multi-view composer (viewport+scissor) + pure splitRects`
   - `Renderer.renderViews(views[])`: lazy composer per slot sized to rect;
     scissor+viewport per view; per-camera layers + light uniforms.
     `render(camera)` -> 1-view shorthand.
   - tests: `splitRects(w,h,'horizontal',2)` -> top/bottom halves (WebGL
     bottom-origin y); 1-view = full rect; determinism.
3. `feat(core): add PlayerView + viewport CSS anchor helpers`
   - `src/core/PlayerView.ts`. Pure `splitRects` lives here (or Renderer; pick
     one owner, re-export). `viewHudAnchor(rect,corner)` -> CSS {left,top}.
   - tests: anchor maps a top-half rect to screen-top CSS; bottom-half to
     mid-screen; clamps inside viewport.
4. `feat(ui): positionable per-viewport HUD + shared seam minimap`
   - `RaceHud` ctor anchor; second instance for P2. `Minimap.place({left,top})`;
     2P seam-centered, 1P bottom-right. Speed HUD per view.
   - tests: RaceHud anchor positions root; Minimap place sets style; 2P shows
     one minimap (not two).
5. `feat(race): mode-dependent finish (all-humans for 2P)`
   - `raceManager` opts `finishWhen` + `humanCount`. Finish once when condition
     met; ranking + timer unchanged.
   - tests: 1P leader-finish unchanged; 2P continues past leader finish until
     both humans lap>=N; finish fires exactly once.
6. `feat(ui): 1P/2P mode toggle on StartMenu`
   - toggle (default 1P); `onStart(mode)`; controls list adds P2 arrows in 2P.
   - tests: default 1P; toggle -> 2P; onStart carries mode; beep on toggle.
7. `refactor(game): wire 2P (P2 kart/view/input/audio/settle/dispose)`
   - Game: mode -> humanCount; rivalCount = 6 - humanCount; grid for 6; build
     PlayerView[] (P1 slot 0, P2 slot 1). frame renderViews; stepWorld steps P2
     (sample(1)) when driving + not finished; coast human on lap>=N; countdown
     zeroes all humans; audio.updatePlayers(humanStates); shadow midpoint;
     results both humans; dispose P2. Update Game.test.ts mocks (renderViews)
     - audio spy (updatePlayers).
   - tests: 1P builds 1 view + 5 rivals; 2P builds 2 views + 4 rivals; P2 stepped
     only when racing; countdown zeroes P2; dispose removes P2 body+group+HUD.
8. `docs: refine 008 plan + todo + README + troubleshooting + 009 note`
   - mark 008 plan ready in `docs/todo.md` (concept -> full plan); README
     project structure adds `src/audio/voiceSet.ts` + `src/core/PlayerView.ts`;
     009 sketch notes basic pan moved to 008; troubleshooting case for verify.

## Risks

- Two EffectComposers = 2x post-process RT memory (each half-height -> ~same
  total as one full; +1 normalDepth RT + 1 depth RT). Desktop-safe; flag for 011.
- Scissor+viewport with autoClear: clear must stay inside the scissor rect.
  Mitigation: setScissorTest(true) + setScissor(rect) BEFORE each
  composer.render(); verify no whole-screen clear leaks (webgl_multiple_views
  pattern). Pixel-sample at c2.
- Shadow frustum is +/-80m (`Renderer.ts:69`). Humans >160m apart -> one loses
  shadows. Acceptable v1; midpoint target follows both while close. Note for 011.
- `AudioManager.ts` near cap (480). voiceSet extraction is what holds it under
  600; if it still crosses, split drift vs engine into voiceSet internals.
- Per-human coast-on-finish: a finished human parks; rivals/other human keep
  accruing rank -> finished human can drop in live position display after finish.
  Acceptable (position locked at finish for results; live HUD reflects current).
- Top/bottom view aspect (w / h/2) is wider than tall; ChaseCamera FOV 62
  (`ChaseCamera.ts:14`) may feel different. Mitigation: per-view setAspect; tune
  if needed; verify.
- P2 arrows share the keyboard with browser shortcuts (Space drifts P1; arrows
  scroll). Input already preventDefault on Space/Arrow (`Input.ts:52`). Verify
  P2 drift keys (ShiftRight/ControlRight/Enter) don't conflict with menu.
- Game.test.ts audio test reads `update` arg (`Game.test.ts:71`); c7 switches to
  updatePlayers -> test updated same commit (green gate).
- Strict TS noUnusedLocals: all PlayerView/voiceSet params used; `_`-prefix
  unused.
- 2P grid: P2 in slot 1 (front row, beside P1) -> both on the front row.
  Verify no spawn overlap (KartGrid lateral +/-2.0, `KartGrid.ts:41-47`).

## Acceptance

- [ ] `src/audio/voiceSet.ts` + `src/core/PlayerView.ts` present
- [ ] 1P mode bit-identical to pre-008 (1 view, 5 rivals, center audio, leader
      finish, bottom-right minimap) — existing audio + Game tests green
- [ ] 2P mode: 2 views top/bottom (scissor split), 4 rivals (6 total), P2 slot 1
- [ ] P2 driven by arrows (PLAYER_BINDINGS[1]) / gamepad 1; both playable
- [ ] Per-player HUD (speed + lap/pos/timer) anchored inside each viewport
- [ ] Per-player audio: 2 engine+drift voices, P1 pan -1 / P2 pan +1; wind shared
- [ ] 1P/2P toggle on StartMenu (default 1P); onStart carries mode
- [ ] Race continues until both humans finish; results show both positions;
      1P still ends on leader finish
- [ ] One shared minimap, seam-centered in 2P; bottom-right in 1P
- [ ] Shadow target follows midpoint of humans
- [ ] `dispose()` removes P2 body + group + HUD; no leaks
- [ ] `npm run typecheck && lint && test` green; pre-commit hook green
- [ ] No black screen at `npm run dev`; visual verify (2P split, both drive,
      audio pans), logged in `docs/troubleshooting/`

## Defaults

- mode: 1P (default); 2P opt-in via StartMenu toggle
- field: 6 karts total. 1P = 1 human + 5 rivals; 2P = 2 humans + 4 rivals
- grid: 2 columns (`KartGrid` defaults); P1 slot 0, P2 slot 1 (front row)
- split: top/bottom; P1 top, P2 bottom. view aspect = w/(h/2)
- audio: voiceCount = humanCount. pan = panForIndex(i,n) (-1/+1 for 2). wind
  shared, driven by max human speed. 1P pan 0 (unchanged)
- finish: 1P leader-finish (007); 2P all-humans-finish. human coasts (zeroInput)
  once lap>=N
- minimap: 1P bottom-right (unchanged); 2P centered on horizontal seam
- HUD: per-view speed (top-left of each half) + RaceHud (under speed). results
  show "P1: Xth, P2: Yth"
- shadow: single DirectionalLight, target = midpoint of humans
- out of scope: 3+ players, online, dynamic split (merge when close), per-view
  minimap, positional/3D audio + doppler + music + collision sound (009),
  per-player camera blend, AI field + 2P combined beyond 6 total

## Previous implementation

None. Greenfield. Closest patterns: 007 multi-kart single world (`Game.ts:258`),
DOM HUD (`Game.ts:400-449`), `src/ui/` from 006, EffectComposer chain
(`Renderer.ts:138-149`), AudioManager voice build (`AudioManager.ts:317-398`).

## Depends on

000 (harness; test gate live). 001 (transitive: Kart makeCel). 002 (none new).
003 (SplineTrack + heightAt, as 007). 004 (none new). 005 (AudioManager extend;
1P preserved). 006 (StartMenu hook + state machine; gameState.ts untouched). 007
(RaceManager + RaceHud + Minimap + KartGrid + rivals) — review/land first. 009
(handoff: 008 takes basic pan; 009 keeps the rest). Merge order: after 007.
