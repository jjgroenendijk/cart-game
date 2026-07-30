---
type: DataFlow
title: Audio Lifecycle
description: Web Audio initialization sequence and voice startup order.
tags: [audio, lifecycle, pipeline]
timestamp: 2026-07-30T22:30:41Z
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

## Voice Count Changes

`setRivalCount` is called from `FieldBuilder.build`. Before `resume()` it only
records the count (resume builds from it). After resume a rival-count change
disposes + recreates the `RivalVoiceBank` in place. The single human `VoiceSet`
is always exactly one — built once straight into `sfxBus` at `resume()`
(centered, no panner) — so a count change never touches it. The shared noise
buffer, wind, rain, music, and collision voices stay alive across the rival
rebuild.

`setEngineActive` gates the single human voice + the rival bank, so the
countdown-done flip silences/restores the whole field. `FieldBuilder`
also calls `setRivalCount(rivals.length)` so the bank matches the live grid.

## Per-Frame Update

`update()` fans out to engine synthesis, `updateWeather()` (rain bed + thunder),
wind/rain voices, collision, and rivals.

## Menu Audio

The engine voice cluster is gated by a single `engineActive` boolean, flipped
on at `countdown-done` (`GameFlow.onCountdownDone`) and asserted off whenever
the menu is re-entered. `GameAudioDriver.flush()` — the music-phase observer
that calls `setMusicPhase` — only runs when `state` is not `menu`/`paused`
(see `Game.frame`), so it cannot drive audio while the menu is shown.

Consequences handled by `GameFlow.enterMenu()` (called from `onQuit`,
`onSelectBack`, `onRaceConfigBack`):

- `setEngineActive(false)` — otherwise the gate set at countdown-done leaks
  into the menu and the engine idles at its 55 Hz hum.
- `setMusicPhase("menu")` — otherwise the engine holds its last
  racing/finished phase after quitting a race. The engine also defaults to its
  menu phase at construction (`MusicEngine` ctor), so a fresh resume() starts
  menu music without an explicit call.

Fresh-boot menu: the AudioContext is not created until a user gesture
(autoplay policy). `GameFlow` registers a one-shot `pointerdown`/`keydown`
listener that calls `resume()` + `setMusicPhase("menu")` on the first menu
interaction, then detaches. `resume()` is idempotent; the later `onStart`
resume() is a safe no-op. The driver phase cache self-heals on the next
active `flush()` (raceConfig/select also map to the menu phase).

## Safety

All methods are no-op-safe before `resume()` — calling play, stop, or volume
methods before initialization is silently ignored.

## Pause + Visibility Suspend

`GameFlow.onPause` calls `AudioManager.setPaused(true)`, which suspends the ctx
and sets an internal pause flag. `onResume`/`onQuit` call `setPaused(false)` to
clear the flag and resume. The visibility handler (tab hidden/visible) calls
`suspend()` on hide and `resume()` on return, but skips the resume while the
pause flag is set — so tab-away-while-paused keeps audio suspended under the
pause overlay, and tab-away-while-racing still resumes on return. The resume
gate stays AudioManager-local (no GameFlow state query from the handler).

## Related

- [AudioManager](/audio/audio-manager.md)
- [audioGraph](/audio/audio-graph.md)
