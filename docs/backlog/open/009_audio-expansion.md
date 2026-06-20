# 009 Audio expansion

Status: open (concept — to be refined)

## Context
005 ships engine/drift/wind/UI/countdown only. Explicitly out of scope
(`005:64-66`): collision/impact, respawn cue, music, positional/3D pan,
doppler, 2P split-screen audio. Two of those have hard upstream gaps:
collision sound needs a collision-event hook `KartController` does not expose
today (`005:64`); positional audio needs a listener + pan model 005 omits
(005 uses raw Web Audio, no `THREE.AudioListener`/`PositionalAudio`).

This item extends 005's `AudioManager` + Web Audio graph. Zero-asset
philosophy holds (`005:9`) — music bed synthesized or sequenced, not sampled.

## Goal
Extend the audio layer:
- collision/impact: impact intensity -> pitch/gain tier (needs new collision
  event source; see KartController hook below)
- respawn cue: short descending blip on respawn (`KartController.respawn`,
  `KartController.ts:267`)
- music bed: simple procedural/sequenced loop (synth pads + arp), start/stop
  by game state
- positional/3D pan: PannerNode per voice or master listener transform sync
  with ChaseCamera; doppler on fast sources (rivals/kart)
- 2P audio policy (feeds 008): single mix vs per-view pan

## Non-goals
- Licensed/recorded music tracks (zero-asset)
- Full dynamic music stems per race event (keep simple bed + state gating)
- Environmental reverb zones
- Voice/chat

## Dependencies
005 (`AudioManager` API, noise buffer, master/compressor graph). 008 (2P
audio policy — shared concern). 007 (rival karts as positional sources).
Transitively none of 001-004 are audio-blocking.

## Needs refinement
- Collision event source: Rapier contact event (`world.onContact`?) vs
  KartController impulse threshold poll — pick one; defines the public hook
- Music scope: is a procedural bed in-scope or defer music entirely to a
  later item? (could split music out if scope balloons)
- Positional model: raw PannerNode vs adopting `THREE.PositionalAudio`
  (005 deliberately avoided THREE.Audio — decide if that holds)
- Doppler parameters + listener velocity source
- CPU budget for music synth + panners on low-end
