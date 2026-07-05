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
- **Bus-state**: Holds bus nodes (master, music, SFX, wind, UI, rival) for volume/routing.
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
  private buses: AudioBuses;
  private voiceSet: VoiceSet;

  async resume(): Promise<void> {
    if (!this.ctx) {
      // create AudioContext, run audioGraph, start persistent voices
    }
    await this.ctx.resume();
  }

  update(dt: number): void {
    // no-op when suspended or no context
  }

  get isSuspended(): boolean {
    return this.ctx?.state !== "running";
  }
}
```

# Citations

- [AudioGraph](/audio/audio-graph.md)
- [Render Pipeline](/data-flows/render-pipeline.md)
