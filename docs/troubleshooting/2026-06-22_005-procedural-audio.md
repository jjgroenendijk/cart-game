# 005 procedural audio troubleshooting

Tracking the autoplay-policy guard, the headless testability split, and
the dev-verify path for audible verification, per the 005 acceptance criteria.

## Autoplay policy / no user gesture

- Constraint: Web Audio `AudioContext` cannot run before a user gesture.
  `main.ts` auto-starts the Game on page load with no button/key/pointer
  interaction, so 005 MUST NOT create the context at module load or in the
  AudioManager ctor — only inside `resume()`.
- Guarantee (by construction): `new AudioContext` / `webkitAudioContext`
  lives ONLY in the `defaultCreateContext` factory, which is called ONLY
  from `AudioManager.resume()`. `resume()` has NO call site in 005
  (Game constructs AudioManager and drives `update()`, but never resumes).
  So no graph exists before 006's Start click, and no "not allowed to start"
  console error can occur.
- Verify: grep `new AudioContext|webkitAudioContext` -> one site
  (`defaultCreateContext`), reachable only via `resume()`.
- Safari: feature-detect `AudioContext ?? webkitAudioContext`; if both
  absent, factory returns null and AudioManager degrades to a permanent
  no-op (all public methods early-return). Game stays playable, silent.

## Headless testability

- `AudioContext` is absent in node/vitest-jsdom, so AudioManager tests
  inject a mock factory (`mockAudioContext.ts`) that hands out a
  `MockAudioContext` recording node creation + param ramps. The mock grew
  alongside the voices (gain+compressor at the skeleton, osc+biquad at the
  engine voice, bufferSource at drift/wind, onended at beeps) and is shared
  by the 3 AudioManager suites to stay under the 600-line file cap.
- `engineCurve.ts` is PURE (no AudioContext) -> tested directly in any env,
  no mock. Covers endpoints, within-gear monotonic rise, 5 shift-point
  drops, throttle gain curve, determinism.
- Real DSP (osc detune spread, lowpass sweep timbre, noise-buffer character)
  is NOT assertable in a mock; manual browser verify is the only path.

## Audible verify path (gated on 006)

- 005 ships SILENT by design: Game builds AudioManager and drives
  `update(dt, {speed, throttle, drifting})` every frame, but never calls
  `resume()`. Audible verify in `npm run dev` requires a gesture.
- Dev verify before 006 lands (uses the existing `window.__game` debug hook
  at `main.ts:25`):
  1. `npm run dev`, open the printed URL.
  2. Open the console.
  3. Run `__game.audio.resume()` — creates the AudioContext + voices and
     brings the master gain up. Should produce an idle engine hum (speed 0).
  4. Drive the kart (WASD) — engine pitch should rise through 6 gear bands
     (freq drops at each shift point), lowpass opens with speed, wind rises
     at high speed, drift noise kicks in while drifting above 7 m/s.
  5. `__game.audio.uiBeep('go')` / `'beep'` / `'hover'` / `'click'` fire
     the transient beeps (auto-clean via osc.onended).
  6. `__game.audio.mute(true)` / `setVolume(0.5)` exercise the master bus.
- Full audible verify (Start -> countdown -> race, engine gated by game
  state) lands with 006, which wires Start click -> `resume()` and
  Countdown -> `uiBeep('beep'|'go')` and `setEngineActive(false|true)` by
  game state. No black screen / no console error expected at `npm run dev`
  (build verified: 44 modules bundle; autoplay guard holds).

## Node leaks (beeps)

- Transient beep nodes (osc + gain) self-clean via `osc.onended ->
disconnect` scheduled at `osc.stop(now + dur)`. Guard test asserts both
  nodes' disconnect count increments after `onended` fires, so the resting
  graph returns to baseline once the envelope finishes.

## Clicks/pops

- Never set `.value` on an active param; always `setTargetAtTime` (voices)
  or `linearRampToValueAtTime` (beep envelopes). Voice gates (drift, engine
  active, wind) ramp, never hard-set. engineGain starts at 0 and only ramps
  up on the first `update()`, so `resume()` never pops.
