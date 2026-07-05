---
type: System
title: AudioManager
description: Public Web Audio API managing lifecycle, bus-state, and per-frame update fan-out.
tags: [audio, webaudio, core]
timestamp: 2026-07-05T00:00:00Z
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
- **UI beeps**: `beeps.ts` table keyed by event name.
- **Impact routing**: `impactRouting.ts` routes collision events.
- **Music bed**: `musicBed.ts` manages adaptive music layers.
- **Noise buffer**: `noiseBuffer.ts` generates shared noise for wind/engine synthesis.
- **Voices**: `engineCurve.ts` (engine synthesis),
  `windVoice.ts` / `rainVoice.ts` (ambient),
  `collisionVoice.ts` / `rivalVoices.ts` / `voiceSet.ts` (positional),
  `respawnCue.ts` (respawn sounds).

# Examples

```ts
// manager.ts — public API sketch
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
      // (setHumanCount/setRivalCount must be called before first resume)
    }
    await this.ctx.resume();
    // Subsequent calls are idempotent: just resume the context
  }

  update(dt: number): void {
    // no-op when suspended or no context
  }

  get isRunning(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  setHumanCount(n: number): void {
    /* call before first resume() */
  }
  setRivalCount(n: number): void {
    /* call before first resume() */
  }

  uiBeep(kind: "hover" | "click" | "beep" | "go"): void {
    /* ... */
  }
}
```

- **Visibility handler**: Auto-suspend on tab hidden, auto-resume on tab visible.
- **`resume()` idempotence**: First call builds graph + starts persistent voices;
  subsequent calls just resume the context.
- **`setHumanCount()` / `setRivalCount()`**: Must be called before first `resume()`
  to allocate correct voice counts.
- **`uiBeep()`** accepts 4 kinds: `"hover"`, `"click"`, `"beep"`, `"go"`.

# Citations

- [AudioGraph](/audio/audio-graph.md)
- [Render Pipeline](/data-flows/render-pipeline.md)
