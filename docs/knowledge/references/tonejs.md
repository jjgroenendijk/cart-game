---
type: Reference
title: Tone.js
description: "Tone.js 15.1: adaptive procedural score, shared AudioContext, Transport scheduling."
tags: [reference, tone, audio]
timestamp: 2026-07-14T00:00:00Z
---

# Schema

Tone.js (npm `tone` ^15.1.22) drives the adaptive procedural score in
`src/audio/musicEngine.ts`. One `MusicEngine` per `AudioManager`, built at
voice position #5 (voices -> wind -> rain -> weatherWind -> music ->
collision -> rivals).

| Feature         | Usage                                                        |
| --------------- | ------------------------------------------------------------ |
| `setContext`    | Bind Tone to this AudioManager's AudioContext (single owner) |
| `getTransport`  | Schedule pad/bass/lead/drum Sequences + Patterns per phase   |
| `Gain`          | Engine bus: every synth feeds it into the caller `musicBus`  |
| `PolySynth`     | AMSynth chord pad (routes through Reverb)                    |
| `MonoSynth`     | Sawtooth bass; square lead (routes through FeedbackDelay)    |
| `MembraneSynth` | Kick; `NoiseSynth` snare; `MetalSynth` hat                   |
| `supportsTone`  | Probes `createConstantSource`; degrades to a silent no-op    |

**Routing**: every synth connects into a Tone `Gain` engine bus that feeds
the caller-supplied `musicBus` (NOT `ctx.destination`), so the music-volume
slider, mute, and master compressor all still apply.

**Single AudioContext**: `setContext(ctx)` runs inside the engine
constructor (supported path only); no second AudioContext is created.

**Transport**: `getTransport()` owns scheduling. `setPhase(phase)` disposes
the active Sequences/Patterns, ramps each voice gain + BPM, and rebuilds the
phase patterns. The constructor calls `applyGains` so the initial menu pad
ramps from its 0 init to the phase target.

**Graceful degrade**: `supportsTone(ctx)` probes `createConstantSource`
(present on a real AudioContext, absent on the jsdom mock). When false the
engine builds ZERO nodes and all methods no-op, keeping voice node indices
stable; a constructor try/catch also degrades on any real-but-unsupported
context so the game stays playable.

# Examples

```ts
// buildMusic lives in `src/audio/audioGraph.ts`; MusicEngine in
// `src/audio/musicEngine.ts`. Music is voice #5, fed into musicBus.
const musicEngine = buildMusic(ctx, musicBus, opts.music);
// AudioManager.setMusicPhase -> musicEngine.setPhase(phase) swaps the
// active Tone Sequences/Patterns + ramps Transport BPM and voice gains.
```

# Citations

- [Music Engine](/audio/music-engine.md)
- [AudioGraph](/audio/audio-graph.md)
- [Audio Lifecycle](/data-flows/audio-lifecycle.md)
