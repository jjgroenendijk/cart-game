# 015 positional audio — verify log

Date: 2026-06-25
Item: 015 (positional / 3D rival audio + doppler + listener)
Status: code-verified; live audible verify deferred to review

## Scope

Add true 3D spatialization for non-human (rival) sources: one `PannerNode`
(equalpower default, inverse distance) per rival routed through sfxBus; a single
`AudioListener` fed from the human midpoint; manual doppler (freq multiplier)
since PannerNode/AudioListener built-in doppler is deprecated. POSITIONAL +
HRTF toggles in settings. Humans untouched (008 StereoPanner stays).

## Code-verified (this pass)

- `src/audio/rivalVoices.ts` present; `dopplerShift` pure (approach -> mult>1,
  recede -> mult<1, clamp [0.5,2.0], dist~0 -> 1); `pannerDefaults` returns
  equalpower/inverse/5/120/1.
- `PositionalVoice`: 3 detuned saws + sub -> lowpass -> gain -> PannerNode ->
  sfxBus; update sets panner pos + osc freq\*dopplerMult + gain/cutoff; spatial
  off pins panner to listener (audible, unspatialized); setActive gates gain.
- `RivalVoiceBank`: N voices; update writes ctx.listener pos/forward/up
  (positionX feature-detect + deprecated setPosition fallback).
- AudioManager: builds bank in startPersistentVoices; setRivalCount/updateRivals/
  setPositional/setHrtf; setEngineActive gates bank; dispose frees panners. AM
  600/600. 1P/2P human voices/wind/impacts paths unchanged (no regression).
- FieldBuilder.rivalAudioStates (throttle 1 racing, 0 else) +
  listenerTransform (human midpoint via pure listenerMidpoint); Game.frame calls
  updateRivals after updatePlayers.
- settings.ts + SettingsOverlay (2 checkbox rows) + Game.applySettings forward
  positional/hrtf; no schema bump (old v1 stores load + default the new fields).
- Gate: typecheck + eslint + markdownlint + prettier + secretlint + pre-commit
  all green. 773 tests (new: dopplerShift, pannerDefaults, PositionalVoice build/
  update/spatial-off/active/hrtf/dispose, RivalVoiceBank listener write + hrtf,
  AudioManager rival wiring, listenerMidpoint pure, Game updateRivals spy,
  settings coercion, overlay toggle/nav).
- Production build: `npm run build` (tsc --noEmit + vite build) succeeds; bundle
  emits (chunk-size warning is pre-existing, unrelated).

## Deferred to review

- Live audible verify: no browser audio device / gesture in this env. Reviewer
  should `npm run dev`, Start (gesture), race, and confirm:
  - rival engines pan + fade with distance as they pass the human(s);
  - doppler pitch rises as a rival approaches, drops as it recedes;
  - POSITIONAL OFF -> rivals centered (still audible); HRTF ON -> wider imaging;
  - 2P: single midpoint listener (rival equidistant from both humans pans center);
  - rivals silent in menu/countdown; no clicks/pops on resume.
- No-black-screen: build is green (strong proxy); reviewer confirms the dev
  canvas renders on Start (composer rebind unaffected; 015 touches audio graph
  only, never the render path).

## Notes

- AudioManager at the 600-line cap; future audio work must extract before adding
  to AM.
- Deprecated-fallback casts use typed intersections, not `as any`.
- Rival throttle is an approximation (1 while racing); revisit if rival engine
  loudness feels off vs humans.
