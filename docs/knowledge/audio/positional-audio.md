---
type: Subsystem
title: Positional Audio
description: Manual doppler + PannerNode spatial audio for rivals, midpoint listener.
tags: [audio, spatial, positional, doppler]
timestamp: 2026-07-30T22:30:41Z
---

# Positional Audio

Rival engine voices use raw Web Audio `PannerNode` + `AudioListener`
for spatial positioning. The single human kart's engine + drift are
non-spatial — one centered `VoiceSet` routed straight into `sfxBus` (no
`StereoPanner`). No `THREE.Audio` dependencies.

## Manual Doppler

Web Audio built-in doppler is deprecated, so a pure `dopplerShift`
helper computes the pitch multiplier:

```text
mult = speedOfSound / (speedOfSound - factor * vRel)
```

- `speedOfSound = 343`, `factor = 1` (defaults).
- `vRel` = relative velocity along the position delta (approach ->
  pitch up). Clamped to `[0.5, 2.0]`.

## Panner Config (`pannerDefaults`)

| Param         | Value        |
| ------------- | ------------ |
| panningModel  | `equalpower` |
| distanceModel | `inverse`    |
| refDistance   | 5 m          |
| maxDistance   | 120 m        |
| rolloffFactor | 1            |

HRTF is opt-in: `setHrtf(true)` swaps `panningModel` to `HRTF`
(costlier convolution; default off).

## Listener Policy

Single `AudioListener` per `AudioContext`. `listenerMidpoint`
(`src/core/listenerTransform.ts`) places the listener at the one human
kart's position/forward (the array API stays length-1; the average is
trivially the kart itself). Listener velocity = human kart linvel proxy.

## Flat-but-Audible

`spatial = false` pins each panner at the listener position with
doppler mult 1 — rivals are audible at uniform gain, not silent.

## Silence Gate

Rivals beyond `SKIP_DISTANCE = 120` m skip panner writes (CPU savings).
`setEngineActive(false)` gates the entire bank (menu/pause).

## Rivals = Engine Only

Rival voices carry only the engine sound (no drift/wind). The human
voice is a single non-spatial `VoiceSet`.

## Per-frame Wiring

`Game.frame` calls
`audio.updateRivals(dt, field.rivalAudioStates(driving), field.listenerTransform())`.
`RivalVoiceBank.update` drives `ctx.listener` position/orientation +
per-voice panner + doppler mult.

## Related

- [AudioManager](/audio/audio-manager.md)
- [AudioGraph](/audio/audio-graph.md)
- [Audio Lifecycle](/data-flows/audio-lifecycle.md)
