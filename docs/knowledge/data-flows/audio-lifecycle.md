---
type: DataFlow
title: Audio Lifecycle
description: Web Audio initialization sequence and voice startup order.
tags: [audio, lifecycle, pipeline]
timestamp: 2026-07-05T00:00:00Z
---

# Audio Lifecycle

## Initialization

AudioManager creates the Web Audio context only from `resume()`, which must be
called after a user gesture to satisfy browser autoplay policies.

`resume()` executes:

1. `buildGraph` - Constructs the full audio graph (buses, voices, effects)
2. `startPersistentVoices` - Starts always-on voice sources

## Voice Startup Order (load-bearing)

1. Voices
2. Wind
3. Rain
4. Music
5. Collision
6. Rivals

This order is load-bearing; changing it may cause audio graph connection errors.

## Per-Frame Update

`update()` fans out to engine synthesis, `updateWeather()` (rain bed + thunder),
wind/rain voices, collision, and rivals.

## Safety

All methods are no-op-safe before `resume()` — calling play, stop, or volume
methods before initialization is silently ignored.

## Related

- [AudioManager](/audio/audio-manager.md)
- [audioGraph](/audio/audio-graph.md)
