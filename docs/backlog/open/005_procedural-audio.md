# 005 Procedural audio system

Status: open

## Context
Zero audio infra — no AudioListener, no files, no synth. Need engine/drift/UI/wind
sound. Repo is fully procedural; keep zero-asset philosophy.

## Goal
`AudioManager` (Web Audio API) synthesizing all sound. Resume `AudioContext` on
first user gesture (Start button in 006) to satisfy autoplay policy.

## Scope
- New `src/audio/AudioManager.ts`.
- Engine: detuned sawtooth oscillators -> lowpass; freq from `kart.speed` + fake
  RPM curve; gain from throttle.
- Drift/skid: white-noise buffer -> bandpass; gain from
  `controller.isDrifting` * speed.
- Wind: low-passed noise rising w/ speed (subtle).
- UI: short osc blips (hover/click), countdown beeps, higher "GO" tone.
- API: `resume()`, `update(dt, { speed, throttle, drifting })`, `uiBeep(kind)`,
  `setEngineActive(bool)`, volume master.
- Wire into `Game.ts` loop + menu (006).

## Acceptance
- [ ] Engine pitch tracks speed; drift noise on slide; UI beeps on menu/countdown
- [ ] No audio before user gesture (no autoplay block errors)
- [ ] typecheck clean; no asset files added

## Depends on
006 for Start-gesture wiring (but AudioManager standalone-first).
