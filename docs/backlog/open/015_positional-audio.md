# 015 Positional audio

Status: open (concept — split from 009)

## Context

009 refined to collision + respawn + music bed; positional/3D/doppler split
out (deferred polish). 008 landed BASIC per-player pan (StereoPanner, P1 -1
/ P2 +1 via `voiceSet.ts:59-62`), which covers human-side spatial
perception. This item adds true 3D spatialization for non-human sources
(rivals) + a listener transform + doppler. `voiceSet.ts:57` already notes
"009 may extend toward a positional model."

## Goal

- positional/3D: `PannerNode` per rival voice (equalpower, cheaper than
  HRTF) routed through the master chain; relative to an audio listener fed
  from the active ChaseCamera transform.
- doppler: manual pitch shift from relative source/listener velocity
  (`PannerNode` doppler is deprecated/unreliable in browsers -> compute
  shift on the source frequency).
- rival sources: 5 AI karts (`Game.ts:184-189`) become positional engine
  voices; gain-scaled by distance so distant rivals fade.
- 2P policy: which listener? single midpoint listener or P1's view; decide
  at refinement.

## Non-goals

- Reverb / environmental zones (echo in tunnels).
- HRTF head tracking.
- Human-side positional (008 StereoPanner stays).
- Music spatialization (bed stays stereo).

## Dependencies

005 (AudioManager graph). 007 (rival karts as sources). 008 (per-player pan
baseline). 009 (collision/respawn/music land first; 015 is additive on the
same AudioManager). Optional 012 (settings: toggle positional/HRTF).

## Needs refinement

- PannerNode vs `THREE.PositionalAudio`: 005 deliberately avoided THREE.Audio
  (raw Web Audio). Keep raw `PannerNode` (consistency) or adopt THREE (gets
  listener wiring free)? Recommend raw to stay consistent.
- Listener source in 2P: midpoint of humans vs P1 camera vs per-view mix.
- Doppler constants + listener velocity source (derive from delta camera
  pos; no velocity field on ChaseCamera today).
- Panner model: `equalpower` (cheap) default, `HRTF` opt-in (012)?
- Rival voice budget: 5 `PannerNode`s + 5 engine voices on low-end CPU.
- Mock gap: `mockAudioContext.ts:112-173` has no `createPanner`/`listener`
  -> 015 adds them.
