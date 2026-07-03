/**
 * 054 commit 4 rain bed + thunder one-shot. The rain bed is a persistent
 * voice: the shared white-noise buffer looped through a bandpass (~1000Hz
 * hiss) into a gain that tracks the weather envelope level. Thunder is a
 * transient one-shot: a muffled lowpass rumble created per call that
 * self-cleans (no persistent node, so voice indices stay stable).
 *
 * Mirrors CollisionVoice (persistent noise bed) + playRespawnCue (transient
 * one-shot). Pure-ish (Web Audio nodes only); the mock ctx
 * (mockAudioContext) exercises it under jsdom.
 */

import { clamp01 } from "../core/rng";

/** Rain bandpass center (Hz) — a hissing mid band. */
const RAIN_BAND_HZ = 1000;
/** Rain bandpass Q. */
const RAIN_BAND_Q = 0.7;
/** Thunder lowpass cutoff (Hz) — muffled rumble. */
const THUNDER_CUTOFF_HZ = 400;
/** Thunder envelope decay (seconds). */
const THUNDER_DECAY_SEC = 1.2;
/** Thunder attack length (s) — short punch into the rumble. */
const THUNDER_ATTACK_SEC = 0.05;

/**
 * Persistent rain bed: noise -> bandpass (~1000Hz) -> gain (0) -> destination.
 * {@link setLevel} ramps the gain with the weather envelope level so the bed
 * fades in/out with the front. Built right after wind so wind's gain index is
 * unchanged; rainGain takes the next index.
 */
export class RainVoice {
  private readonly source: AudioBufferSourceNode;
  private readonly filter: BiquadFilterNode;
  private readonly gain: GainNode;

  constructor(ctx: AudioContext, noise: AudioBuffer, destination: AudioNode) {
    this.source = ctx.createBufferSource();
    this.source.buffer = noise;
    this.source.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "bandpass";
    this.filter.frequency.value = RAIN_BAND_HZ;
    this.filter.Q.value = RAIN_BAND_Q;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.source.connect(this.filter);
    this.filter.connect(this.gain);
    this.gain.connect(destination);
    this.source.start();
  }

  /**
   * Ramp the gain with the weather envelope level. 0 silences the bed; 1 ->
   * `gainCeiling`. Ramps via setTargetAtTime so the front fades without clicks.
   */
  setLevel(ctx: AudioContext, level: number, gainCeiling: number): void {
    this.gain.gain.setTargetAtTime(clamp01(level) * gainCeiling, ctx.currentTime, 0.1);
  }

  /** Stop the looping source defensively (double-stop throws on real Web Audio). */
  stop(): void {
    stopSource(this.source);
    this.source.disconnect();
  }

  /** Disconnect the filter + gain. Source should be stop()'d first. */
  dispose(): void {
    this.filter.disconnect();
    this.gain.disconnect();
  }
}

/**
 * Play one thunder rumble into `destination` at ctx time `now + delaySec`
 * (delay = sound travel time after the flash). A looping noise source ->
 * lowpass (~400Hz muffled rumble) -> env gain (peak ~ strength*0.5) ->
 * destination, decaying over ~1.2s. Self-cleans via source.onended. Nodes are
 * created per call (no persistent gain), so downstream voice indices stay
 * stable. No-op-safe: callers guard ctx/destination/noise externally.
 */
export function playThunder(
  ctx: AudioContext,
  destination: AudioNode,
  noise: AudioBuffer,
  strength: number,
  delaySec: number,
): void {
  const at = ctx.currentTime + Math.max(0, delaySec);
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = THUNDER_CUTOFF_HZ;
  const gain = ctx.createGain();
  const peak = clamp01(strength) * 0.5;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(peak, at + THUNDER_ATTACK_SEC);
  gain.gain.linearRampToValueAtTime(0, at + THUNDER_DECAY_SEC);
  src.connect(lp);
  lp.connect(gain);
  gain.connect(destination);
  src.start(at);
  src.stop(at + THUNDER_DECAY_SEC);
  src.onended = () => {
    src.disconnect();
    lp.disconnect();
    gain.disconnect();
  };
}

function stopSource(src: { stop?: () => void } | null): void {
  if (!src) return;
  try {
    src.stop?.();
  } catch {
    // Already stopped; ignore.
  }
}
