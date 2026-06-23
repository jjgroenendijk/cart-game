/**
 * 009 collision impact one-shot. A single reused Web Audio voice that turns a
 * Rapier contact-force magnitude into an intensity-tiered impact sound: a short
 * burst of the shared white-noise buffer through a lowpass whose cutoff tracks
 * the hit weight, shaped by an attack/decay envelope on one reused gain node.
 *
 * Retrigger restarts the envelope on that same gain node (cancel + ramp), so a
 * flurry of contacts never stacks gain into a clip (009 risk: machine-gun). The
 * noise source loops continuously at gain 0 between hits — no per-hit source
 * churn, no leak.
 *
 * Pure: impactTier maps a force scalar to {gain,freq,decay} and is fully unit
 * tested. CollisionVoice is pure-ish (Web Audio nodes only); the mock ctx
 * (mockAudioContext) exercises build/trigger/stop/dispose under jsdom.
 */

import { clamp, lerp } from "../core/math";

export interface ImpactTierOptions {
  /** Force (N) at the low-tier floor. Below this the tier gain floor applies. */
  lowForce: number;
  /** Force (N) at the high-tier ceiling. Above this the high tier is clamped. */
  highForce: number;
  /** Peak gain at the low tier. */
  lowGain: number;
  /** Peak gain at the high tier. */
  highGain: number;
  /** Lowpass cutoff (Hz) at the low tier (muffled thud). */
  lowFreq: number;
  /** Lowpass cutoff (Hz) at the high tier (crisp crack). */
  highFreq: number;
  /** Decay (s) at the low tier. */
  decay: number;
  /** Decay (s) at the high tier (tighter). */
  decayHigh: number;
}

/** Per-hit sound parameters produced by impactTier and consumed by trigger(). */
export interface ImpactParams {
  /** Envelope peak gain. */
  gain: number;
  /** Lowpass cutoff (Hz). */
  freq: number;
  /** Decay tail length (s) after the attack. */
  decay: number;
}

export const DEFAULT_IMPACT: ImpactTierOptions = {
  lowForce: 300,
  highForce: 6000,
  lowGain: 0.18,
  highGain: 0.5,
  lowFreq: 180,
  highFreq: 600,
  decay: 0.18,
  decayHigh: 0.09,
};

/** Attack (s) — short so each hit punches in instead of fading up. */
const ATTACK = 0.004;

/**
 * Map a Rapier totalForceMagnitude to {gain,freq,decay}. Pure + monotonic:
 * gain and freq rise with force; decay tightens with force. force<=0 yields a
 * silent tier (gain 0) so the router can pass anything it did not skip.
 */
export function impactTier(force: number, opts: ImpactTierOptions = DEFAULT_IMPACT): ImpactParams {
  if (force <= 0) return { gain: 0, freq: opts.lowFreq, decay: opts.decay };
  const t = clamp((force - opts.lowForce) / (opts.highForce - opts.lowForce), 0, 1);
  return {
    gain: lerp(opts.lowGain, opts.highGain, t),
    freq: lerp(opts.lowFreq, opts.highFreq, t),
    decay: lerp(opts.decay, opts.decayHigh, t),
  };
}

export class CollisionVoice {
  private readonly source: AudioBufferSourceNode;
  private readonly lowpass: BiquadFilterNode;
  private readonly gain: GainNode;

  constructor(
    ctx: AudioContext,
    destination: AudioNode,
    noise: AudioBuffer,
    opts: ImpactTierOptions = DEFAULT_IMPACT,
  ) {
    this.source = ctx.createBufferSource();
    this.source.buffer = noise;
    this.source.loop = true;
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = "lowpass";
    this.lowpass.frequency.value = opts.lowFreq;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.source.connect(this.lowpass);
    this.lowpass.connect(this.gain);
    this.gain.connect(destination);
    this.source.start();
  }

  /**
   * Fire one impact. Sets the cutoff to params.freq and restarts the envelope
   * (cancel + 0 -> peak over ATTACK -> 0 over decay) on the reused gain node,
   * so rapid retriggers replace rather than stack.
   */
  trigger(ctx: AudioContext, now: number, params: ImpactParams): void {
    void ctx;
    this.lowpass.frequency.setValueAtTime(params.freq, now);
    const g = this.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(0, now);
    g.linearRampToValueAtTime(params.gain, now + ATTACK);
    g.linearRampToValueAtTime(0, now + ATTACK + params.decay);
  }

  /** Stop started source defensively (double-stop throws on real Web Audio). */
  stop(): void {
    stopSource(this.source);
    this.source.disconnect();
  }

  /** Disconnect the graph nodes. Source should be stop()'d first. */
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
