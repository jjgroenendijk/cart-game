/**
 * 005 wind voice (shared). Loops the shared white-noise buffer through a
 * lowpass (~500Hz) into a gain that rises linearly with the max human speed.
 * Shared across all players (driven by the max human speed); the per-player
 * engine+drift pan lives in each VoiceSet's destination.
 *
 * Extracted from AudioManager (054 commit 4) so that file stays under its
 * line cap. Mirrors CollisionVoice/RainVoice (persistent noise bed). Pure-ish
 * (Web Audio nodes only); the mock ctx (mockAudioContext) exercises it.
 */

export interface WindVoiceOptions {
  /** Lowpass cutoff (Hz). */
  cutoffHz: number;
  /** Gain at full speed. */
  gainCeiling: number;
  /** Gain ramp time constant (s). */
  tau: number;
}

/**
 * Persistent wind bed: noise -> lowpass -> gain (0) -> destination. Built
 * after the per-player voice sets and before the rain bed, so the wind gain
 * keeps its stable index (5 for 1P / 7 for 2P). {@link update} ramps the gain
 * with the live speed fraction.
 */
export class WindVoice {
  private readonly source: AudioBufferSourceNode;
  private readonly lowpass: BiquadFilterNode;
  private readonly gain: GainNode;

  constructor(
    ctx: AudioContext,
    noise: AudioBuffer,
    destination: AudioNode,
    opts: WindVoiceOptions,
  ) {
    this.source = ctx.createBufferSource();
    this.source.buffer = noise;
    this.source.loop = true;
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = "lowpass";
    this.lowpass.frequency.value = opts.cutoffHz;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.source.connect(this.lowpass);
    this.lowpass.connect(this.gain);
    this.gain.connect(destination);
    this.source.start();
  }

  /**
   * Ramp the gain with the live speed fraction `level01` (0..1) toward
   * `gainCeiling`. Ramps via setTargetAtTime (no hard gate clicks).
   */
  update(now: number, level01: number, opts: WindVoiceOptions): void {
    this.gain.gain.setTargetAtTime(level01 * opts.gainCeiling, now, opts.tau);
  }

  /** Stop the looping source defensively (double-stop throws on real Web Audio). */
  stop(): void {
    stopSource(this.source);
    this.source.disconnect();
  }

  /** Disconnect the lowpass + gain. Source should be stop()'d first. */
  dispose(): void {
    this.lowpass.disconnect();
    this.gain.disconnect();
  }
}

function stopSource(src: { stop?: () => void } | null): void {
  if (!src) return;
  try {
    src.stop?.();
  } catch {
    // Already stopped; ignore.
  }
}
