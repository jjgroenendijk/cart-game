---
type: System
title: AudioManager
description: Public Web Audio API managing lifecycle, bus-state, and per-frame update fan-out.
tags: [audio, webaudio, core]
timestamp: 2026-07-30T22:30:41Z
---

# Schema

Central audio system managing the full audio lifecycle:

- **Lifecycle**: `resume()` (creates Web Audio after user gesture), `suspend()`, `dispose()`.
- **Bus-state**: Holds bus nodes (`master`, `sfxBus`, `musicBus`, `compressor`
  DynamicsCompressorNode) for volume/routing. Wind, UI beeps, and rivals
  all feed into `sfxBus`. There are no separate wind/UI/rival buses.
- **Per-frame update fan-out**: Drives engine synthesis, wind/rain voices, collision, rivals.
- **No-op guards**: ALL methods MUST be no-op-safe before `resume()` and without AudioContext.
- **Higher-level audio events**: Delegated to `gameAudio`
  (impacts, respawn cues, music transitions, weather).
- **UI beeps**: `src/audio/beeps.ts` table keyed by event name.
- **Impact routing**: `src/audio/impactRouting.ts` routes collision events.
- **Music engine**: `src/audio/musicEngine.ts` — a Tone.js adaptive score driven by
  `setMusicPhase`. Synthesizes a per-phase chord pad, bass, generative lead,
  and drum kit. `setMusicPhase` is a no-op before `resume()` builds persistent
  voices and under jsdom when AudioContext support is unavailable.
- **Noise buffer**: `src/audio/noiseBuffer.ts` generates shared noise for the
  wind + drift voices (and the collision/rain voices). The kart engine is
  oscillator-based (3 detuned saws + sub-sine) and uses NO noise.
- **Voices**: `src/audio/engineCurve.ts` (engine synthesis),
  `src/audio/windVoice.ts` / `src/audio/rainVoice.ts` (ambient),
  `src/audio/collisionVoice.ts` (impacts), `src/audio/rivalVoices.ts`
  (positional rivals), `src/audio/voiceSet.ts` (the single centered human
  engine+drift voice, non-spatial),
  `src/audio/respawnCue.ts` (respawn sounds). `engineCurve` guards `gears < 2` to a
  single degenerate band (no divide by `gears - 1`) so freq/gain stay finite.

# Examples

```ts
// src/audio/AudioManager.ts — public API sketch
class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode;
  private compressor: DynamicsCompressorNode;
  private sfxBus: GainNode;
  private musicBus: GainNode;
  private persistent: PersistentVoices | null;

  async resume(): Promise<void> {
    if (!this.ctx) {
      // create AudioContext, build graph, start persistent voices
      // (pre-resume setRivalCount records the count; post-resume it
      // rebuilds the rival bank; the single human voice is always one)
    }
    await this.ctx.resume();
    // Subsequent calls are idempotent: just resume the context
  }

  update(_dt: number, state: PlayerAudioState): void {
    // no-op when suspended or no context; delegates to updatePlayers
  }

  get isRunning(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  setRivalCount(n: number): void {
    /* pre-resume records n; post-resume disposes + rebuilds the rival bank */
  }

  uiBeep(kind: "hover" | "click" | "beep" | "go"): void {
    /* ... */
  }
}
```

- **Visibility handler**: Auto-suspend on tab hidden, auto-resume on tab visible.
- **`resume()` idempotence**: First call builds graph + starts persistent voices;
  subsequent calls just resume the context.
- **`setRivalCount()`**: Pre-resume records the count (the bank is built from
  it at first `resume()`); post-resume disposes + rebuilds the rival bank so a
  field rebuild that changes the count re-creates the positional voices. The
  single human `VoiceSet` is always one (built once at resume, centered, no
  panner).
- **`uiBeep()`** accepts 4 kinds: `"hover"`, `"click"`, `"beep"`, `"go"`.

## Supporting Modules

`src/core/listenerTransform.ts` — `listenerMidpoint(positions, forwards,
velocities, out?)` places the single Web Audio listener at the one human
kart's position/forward (the array API stays length-1; the average is
trivially the kart itself). Game feeds the result to AudioManager each frame.

`src/core/fieldAudioStates.ts` — `fillHumanAudioStates(view, driving,
input, buf)` and `fillRivalAudioStates(rivals, driving, buf)` build
per-kart audio state snapshots (position, velocity, speed, throttle, drift)
into caller-owned buffers. Game.frame (`src/core/gameFrame.ts`) consumes
these each frame via `audio.updatePlayers`/`updateRivals`; `GameAudioDriver`
(`src/audio/gameAudio.ts`) only drives impacts, music phase, and weather,
never voice states.

# Citations

- [AudioGraph](/audio/audio-graph.md)
- [Render Pipeline](/data-flows/render-pipeline.md)
