# 005 Procedural audio system

Status: open (rewritten as full plan)

## Context
Zero audio infra today. Grep `Audio|AudioContext|oscillator|WebAudio|AudioListener|
THREE.Audio|PositionalAudio` across `src/` -> 0 hits; only `005:6` notes the gap.
Repo is fully procedural (no `.mp3`/`.wav`/`.ogg` assets); keep zero-asset
philosophy -> all sound synthesized via Web Audio API in-memory.

The current sketch (`005:1-31`) is a wish list, not a plan. Real constraints it
ignores:

- No user gesture exists. `main.ts:19-20` constructs Game + calls `game.start()`
  unconditionally on page load; no button, key, or pointer interaction. Web Audio
  `AudioContext` cannot run before a gesture -> 005 must NOT create the context at
  module load or in the ctor, only inside `resume()` invoked from a gesture handler.
- The gesture source is 006's Start button (`006:19`, "Resume AudioContext on
  Start click (005 gesture)"). Decision (strict block on 006): 005 ships the
  `AudioManager` API + silent Game wiring; it does NOT add its own gesture hook.
  Audible result lands when 006 wires Start -> `resume()`. 005 is still greenfield-
  first and independently typecheck-clean; dev-audible verify uses the existing
  debug hook `window.__game` (`main.ts:25`) by calling `__game.audio.resume()` in
  the console.
- `kart.speed` exists (`Kart.ts:164-166`, m/s, signed) and Game reads it at
  `Game.ts:79`. `isDrifting` exists (`KartController.ts:274-276`, backed by
  `driftActive` field `KartController.ts:92`) and Game reads it at `Game.ts:79`.
  But throttle does NOT live on the kart: it is the per-frame `KartInput.throttle`
  (`Input.ts:4`, -1..1), held only in the local `const kartInput` at `Game.ts:66`.
  Audio update must read throttle from that same `frame` scope (it is in-scope at
  the per-render block `Game.ts:77-83`).
- `DEFAULT_TUNING.maxSpeed = 34` (`KartController.ts:32`) is the RPM denominator.
  `driftActive` requires `speedAbs > 7` (`KartController.ts:134`) -> drift voice
  gate matches that threshold.
- No `Game.update(dt, time)`; audio updates at RENDER rate (variable dt) from the
  per-frame block `Game.ts:77-83`, NOT the fixed-step block `Game.ts:70-75`.
- `Game.dispose()` is shallow (`Game.ts:49-56`): frees only WebGLRenderer + removes
  dom/hud. No precedent for freeing nodes/bodies. AudioManager owns its own
  teardown, added next to `this.hud.remove()` (`Game.ts:55`).
- UI pattern: plain `HTMLElement`, `cssText`, `appendChild`, `remove` on teardown
  (`Game.createHud` `Game.ts:93-119`; `hud.remove()` `Game.ts:55`). No `src/ui/`
  dir yet -> 006 creates it. 005 only needs callable `uiBeep(kind)` from DOM
  handlers (006 owns the DOM).
- `package.json` has NO `test`/`lint`/`format` script today (only `typecheck`
  `package.json:11`). 000 owns the vitest+eslint+prettier harness + hooks.
  So 005's test gate is: typecheck always; vitest tests run once 000 lands
  (dormant meanwhile, mirrors 003/004 "per 000 harness").
- `tsconfig` strict w/ `noUnusedLocals`/`noUnusedParameters`
  (`tsconfig.json:17-18`) -> audio signature params used or `_`-prefixed. `lib`
  includes DOM (`tsconfig.json:6`) -> `AudioContext` global, no dep needed.
- `src/core/math.ts` (`math.ts:1-26`) has NO noise/RNG/smoothstep. Wind does NOT
  need determinism (Web Audio `AudioBuffer` filled w/ `Math.random()` is
  stochastic noise) -> 005 does not depend on 004's planned `rng.ts`.

## Goal
`AudioManager` (raw Web Audio API, no `THREE.Audio`, no asset files) synthesizing
engine + drift/skid + wind + UI/countdown beeps. Engine pitch tracks speed via a
6-gear fake-RPM curve; drift noise gated by `isDrifting && speed>7`; wind rises
with speed; UI beeps fire on demand. `AudioContext` created only inside `resume()`
(gesture). Standalone-first: 005 compiles + wires into Game silent; 006 supplies
the Start-button gesture that makes it audible.

Scope boundary (decided): engine/drift/wind/UI/countdown only. Non-goals:
collision/impact sound (KartController has no collision-event hook today), respawn
cue, music, positional/3D pan, doppler, 2P split-screen audio. Zero audio asset
files added.

## Architecture (new)

```
src/audio/
  engineCurve.ts   # PURE: speed/maxSpeed/throttle -> {freq, gain}. No
                   #   AudioContext -> unit-testable in any env. 6 gear bands
                   #   across [0,maxSpeed]: within a gear rpm rises; at shift
                   #   point freq drops to next gear's low (arcade feel).
                   #   gear = min(5, floor(speed01*6)); local = speed01*6-gear;
                   #   tierPeak = idleHz*pow(topHz/idleHz, gear/5);
                   #   freq = tierPeak*lerp(lowRatio, highRatio, local).
                   #   gain = lerp(idleGain, fullGain, clamp(throttle,0,1))
                   #     when throttle>0 else idleGain.
  noiseBuffer.ts   # makeNoiseBuffer(ctx, seconds=2) -> AudioBuffer filled w/
                   #   Math.random()*2-1 (white noise). Built once on resume;
                   #   shared by drift + wind voices (separate BufferSource
                   #   per voice, same buffer). Not an asset file.
  AudioManager.ts  # Web Audio graph. ctor does NOT create ctx (no graph before
                   #   gesture). Lazy ctx + persistent voices built on first
                   #   resume(). API:
                   #     resume(): idempotent. If ctx null -> create graph +
                   #       start persistent voices; if ctx.state=='suspended' ->
                   #       ctx.resume(). Set gestured=true.
                   #     update(dt, {speed, throttle, drifting}): no-op if ctx
                   #       null. Drives engine freq/gain via engineCurve +
                   #       setTargetAtTime; drift gain by drifting&&speed>7;
                   #       wind gain by speed/maxSpeed.
                   #     uiBeep(kind: 'hover'|'click'|'beep'|'go'): no-op if ctx
                   #       null. Create-on-demand osc+gain->master, schedule
                   #       envelope (linearRamp), osc.stop(now+dur),
                   #       onended->disconnect (no leak).
                   #     setEngineActive(b): ramp engineGain target up/down.
                   #     setVolume(v)/mute(b): master.gain ramp.
                   #     suspend(): ctx.suspend() (visibility hidden).
                   #     dispose(): stop sources, disconnect nodes, ctx.close().
                   #   Graph: master GainNode -> DynamicsCompressor ->
                   #     ctx.destination. Persistent voices (engine/drift/wind)
                   #     -> master. Transient beep nodes -> master (self-clean).
src/core/
  Game.ts          # ctor: build `this.audio = new AudioManager()` after hud
                   #   (`Game.ts:36`). DO NOT resume (006 owns gesture). frame:
                   #   at per-render block (`Game.ts:77-83`) call
                   #   `this.audio.update(dt, { speed: this.kart.speed,
                   #     throttle: kartInput.throttle,
                   #     drifting: this.kart.controller.isDrifting })`
                   #   (`kartInput` is in-scope from `Game.ts:66`). dispose:
                   #   `this.audio.dispose()` next to `this.hud.remove()`
                   #   (`Game.ts:55`).
src/main.ts        # NO change in 005 (006 owns Start->resume wiring). Dev
                   #   audible verify via console: `__game.audio.resume()`
                   #   (uses existing `window.__game` debug hook, `main.ts:25`).
```

Graph detail:
- master = ctx.createGain() (master.gain = volume) -> compressor
  (threshold -24, ratio 4, catches drift/beep peaks) -> ctx.destination.
- engine: 3 saw OscillatorNode (detune {-12,0,+12} cents) + 1 sub sine (oct
  below) -> engineLowpass (BiquadFilter lowpass) -> engineGain (GainNode) ->
  master. Persistent; started once via osc.start(); freq + cutoff via
  setTargetAtTime from engineCurve. setEngineActive ramps engineGain.
- drift: noiseBuffer -> driftSource (BufferSource, loop) -> driftBandpass
  (bandpass 1500Hz Q 0.8) -> driftGain -> master.
- wind: noiseBuffer -> windSource (separate BufferSource, loop) -> windLowpass
  (lowpass 500Hz) -> windGain -> master.
- beep: osc (sine/triangle) + gain -> master; envelope via
  linearRampToValueAtTime; osc.onended -> osc.disconnect()+gain.disconnect().

## Contracts with 006 (cross-backlog)
- 006 calls `audio.resume()` from the Start-button click handler (`006:19`).
  005 adds NO gesture wiring of its own (strict block on 006).
- 006 `Countdown.ts` calls `audio.uiBeep('beep')` on 3/2/1 and `audio.uiBeep('go')`
  on GO (`006:14`).
- 006 game state machine (`006:15`): 006 calls `audio.setEngineActive(false)` in
  `'menu'|'countdown'` and `audio.setEngineActive(true)` on entering `'racing'`.
- 006 menu hover/click call `audio.uiBeep('hover'|'click')`.
- 005 exposes a stable public API (above); 006 consumes it, does not edit it.

## Contracts with 000/004 (cross-backlog)
- 000 harness: 005 tests target the vitest 000 introduces. Until 000 lands,
  typecheck is the only gate; tests dormant (mirrors 003/004). 005's
  `engineCurve` tests are pure (no AudioContext) -> pass in any env once vitest
  exists.
- 004 `rng.ts`: 005 does NOT depend on it. Wind noise is stochastic
  (`Math.random()` buffer fill), not deterministic. Cross-note only.
- 002/003: no audio interaction.

## Commits (each atomic + green; gate = typecheck always + vitest once 001 lands)
1. `feat(audio): add engineCurve pure 6-gear RPM mapping + tests`
   - `src/audio/engineCurve.ts`; pure fn (no AudioContext). 6 gear bands.
   - tests: freq=idleHz*lowRatio at speed 0; freq=topHz at maxSpeed; freq rises
     monotonically WITHIN a gear; freq DROPS at each of 5 shift points (gear
     boundaries); gain rises with throttle>0; gain=idleGain at throttle<=0;
     deterministic (pure).
2. `feat(audio): add noiseBuffer + AudioManager core (ctx/master/compressor,
   resume, dispose)`
   - `noiseBuffer.ts` + `AudioManager.ts` skeleton. No voices yet. resume()
     lazy-creates ctx + master+compressor; no-op-safe before gesture. suspend()
     on visibility hidden; resume() on visible if gestured. dispose() closes ctx.
   - tests (mock AudioContext factory): ctx null until resume(); resume()
     idempotent; gestured flag set; dispose() calls ctx.close() + disconnects
     master/compressor; no nodes created at module load.
3. `feat(audio): add engine voice (detuned saws -> lowpass -> gain, RPM via
   engineCurve)`
   - 3 detuned saws + sub sine; engineLowpass; engineGain; setEngineActive ramps;
     update sets freq/cutoff via setTargetAtTime + gain via engineCurve.
   - tests: update() before ctx is no-op; setEngineActive(true) ramps engineGain
     target up; osc.frequency follows engineCurve freq for a sample speed;
     setEngineActive(false) ramps down.
4. `feat(audio): add drift + wind voices (shared noise buffer -> bandpass/
   lowpass -> gains)`
   - driftSource+driftBandpass+driftGain; windSource+windLowpass+windGain; both
     loop the shared noiseBuffer; gates per Defaults.
   - tests: noiseBuffer length>0; driftGain target 0 when !drifting OR speed<=7;
     driftGain target>0 when drifting&&speed>7; windGain target 0 at speed 0,
     max at maxSpeed; update before ctx no-op.
5. `feat(audio): add UI beeps (hover/click/beep/go) w/ auto-cleanup`
   - create-on-demand osc+gain->master; envelope via linearRampToValueAtTime;
     osc.stop(now+dur); osc.onended->disconnect. Kinds map to {type,freq,dur,peak}.
   - tests: uiBeep before ctx is no-op; after resume creates an osc, schedules
     stop, and onended disconnects (node count returns to baseline); each kind
     uses its freq/type.
6. `refactor(game): wire AudioManager into loop + dispose (silent until 006)`
   - Game ctor builds `this.audio` after hud (`Game.ts:36`); frame calls
     `this.audio.update(dt, {speed, throttle, drifting})` at `Game.ts:77-83`
     (throttle from `kartInput` `Game.ts:66`); dispose calls `this.audio.dispose()`
     next to `this.hud.remove()` (`Game.ts:55`). Expose `audio` for 006 + dev
     verify. NO resume() call in 005.
   - tests: Game constructs AudioManager; update called once/frame with the right
     3 signals (mock audio); dispose calls audio.dispose().
7. `docs: update backlog 005 + todo + README + troubleshooting case`
   - mark 005 plan done in `docs/todo.md`; README project structure adds
     `src/audio/`; add `docs/troubleshooting/<DATE>_audio-verify.md` recording
     the dev-verify path (`__game.audio.resume()` in console) since audible
     verify is gated on 006.

## Risks
- Autoplay policy / no gesture today (`main.ts:19-20` auto-start): 005 creates
  ctx ONLY inside resume(); resume() has no call site in 005 -> no graph before
  006's Start click. Guarantee = static: grep `new AudioContext|webkitAudioContext`
  lives only in resume(); no module-load ctx. No console "not allowed to start"
  error by construction.
- Audible verify impossible in `npm run dev` before 006: dev path = console
  `__game.audio.resume()` via existing `window.__game` (`main.ts:25`); full
  audible verify (Start->countdown->race) lands w/ 006. Log in
  `docs/troubleshooting/` (precedent: `2026-06-20_visual-verification-fallback.md`).
- Headless testability: `AudioContext` absent in node/vitest-jsdom -> mock factory
  in AudioManager tests (records graph calls); engineCurve is pure -> tested
  directly w/o any audio. Real DSP verify manual in browser.
- Node leaks (beeps): `osc.onended -> disconnect` + `osc.stop()` scheduled; guard
  test counts nodes back to baseline.
- Clicks/pops: never set `.value` on an active param; always
  `setTargetAtTime`/`linearRampToValueAtTime`. Voice gates ramp, never hard-set.
- Context resume races: guard w/ `gestured` + `ctx.state` flags; resume()
  idempotent.
- Safari `webkitAudioContext`: feature-detect
  `(window.AudioContext || window.webkitAudioContext)`; if absent AudioManager
  degrades to no-op (all methods early-return) -> game still playable, silent.
- Tab-hidden stutter: `visibilitychange` -> suspend() hidden / resume() visible
  (only if gestured).
- Engine too thin/synth: 3 detuned saws + sub + lowpass sweep; tune at verify,
  adjust `engineCurve` ratios + lowpass range in Defaults.
- Strict TS (`tsconfig.json:17-18`): all `dt`/`time` params in audio signatures
  used or `_`-prefixed; no unused locals.
- Test harness absent today: typecheck-only gate until 000's vitest lands;
  document (mirrors 003/004 "per 000 harness").

## Acceptance
- [ ] `src/audio/{engineCurve,noiseBuffer,AudioManager}.ts` present
- [ ] 0 audio asset files added (grep `.mp3|.wav|.ogg|.flac` in repo -> none)
- [ ] 0 `new AudioContext`/`webkitAudioContext` outside `resume()` (grep) ->
      no graph before user gesture; no autoplay block error
- [ ] `resume()` idempotent; ctx null until first resume(); all public methods
      no-op before resume()
- [ ] Engine pitch tracks speed via 6-gear engineCurve; freq drops at shift
      points; gain rises with throttle
- [ ] Drift noise gated by `isDrifting && speed>7`; wind rises with
      speed/maxSpeed; both silent at rest
- [ ] `uiBeep('hover'|'click'|'beep'|'go')` fires on demand; transient nodes
      auto-disconnect (no leak)
- [ ] `setEngineActive` ramps engine gain; `setVolume`/`mute` work on master
- [ ] `dispose()` closes AudioContext + disconnects every node (no leak)
- [ ] `npm run typecheck` clean; if 001 vitest present, engineCurve + AudioManager
      (mock) tests green
- [ ] Dev-verify path documented in `docs/troubleshooting/`; full audible verify
      gated on 006
- [ ] No black screen / no console error at `npm run dev`

## Defaults
- master gain: 0.8; mute: off; compressor: threshold -24, ratio 4, knee 30
- sample rate: read from ctx (don't hardcode)
- engine: 3 saw osc detune {-12,0,+12} cents + 1 sub sine (oct down); idleHz 55,
  topHz 320; lowRatio 0.55, highRatio 1.0; lowpass 700Hz idle -> 3800Hz top;
  idleGain 0.05, fullGain 0.20; setTargetAtTime tau 0.08s
- 6 gears: band g covers [g*maxSpeed/6, (g+1)*maxSpeed/6]; tierPeak =
  idleHz*pow(topHz/idleHz, gear/5); freq = tierPeak*lerp(lowRatio,highRatio,local)
- drift: noiseBuffer 2s loop; bandpass 1500Hz Q 0.8; gain 0 -> 0.16; ramp 0.05s;
  gated by `isDrifting && speed>7` (matches `KartController.ts:134`)
- wind: lowpass 500Hz; gain 0 -> 0.09 at maxSpeed; ramp 0.2s
- ui: hover sine 880Hz 60ms peak 0.12; click triangle 520Hz 90ms peak 0.16;
  beep sine 660Hz 160ms peak 0.22; go sine 990Hz 420ms peak 0.26
- visibility suspend: on
- maxSpeed: 34 (from `DEFAULT_TUNING.maxSpeed`, `KartController.ts:32`) —
  AudioManager reads it from the kart tuning at wire-up, not hardcoded
- out of scope: collision/impact, respawn cue, music, positional/3D pan, doppler,
  2P split-screen audio

## Previous implementation
None. Greenfield — grep `Audio|AudioContext|oscillator|WebAudio` across `src/`
returns 0 hits. No audio assets. 005 builds the audio layer from scratch.

## Depends on
000 (vitest+eslint+prettier harness + hooks — test gate; dormant until landed,
typecheck-only meanwhile). 006 (Start-button gesture -> `resume()`; Countdown
`uiBeep`; `setEngineActive` by game state). Merge order: 005 before 006 (005 =
audio API provider, 006 = gesture/integration consumer); 005 ships silent until
006 calls resume(). 002/003: no interaction. 004 `rng.ts`: not required (noise
buffer stochastic).
