/**
 * 009 respawn cue. A short descending blip (sine glide 660Hz -> 220Hz) shaped
 * by an attack/decay envelope, fired once per respawn (human R/reset during
 * racing, and rival respawnAhead). One-shot: each call builds an osc+gain on
 * demand and self-cleans via osc.onended -> disconnect, exactly like the 005 UI
 * beep. No persistent nodes, no asset files.
 *
 * Pure: cueSpec resolves the spec (defaults). playRespawnCue is pure-ish (Web
 * Audio nodes only); the mock ctx (mockAudioContext) exercises it under jsdom.
 */

export interface RespawnCueOptions {
  /** Glide start frequency (Hz). */
  fromHz: number;
  /** Glide end frequency (Hz). */
  toHz: number;
  /** Total glide + envelope length (s). */
  decay: number;
  /** Envelope peak gain. */
  peak: number;
  /** Attack fraction of decay (0..1). */
  attack: number;
}

export const DEFAULT_RESPAWN: RespawnCueOptions = {
  fromHz: 660,
  toHz: 220,
  decay: 0.2,
  peak: 0.22,
  attack: 0.15,
};

/** Resolve a (partial) cue spec against the defaults. Pure. */
export function cueSpec(opts?: Partial<RespawnCueOptions>): RespawnCueOptions {
  return { ...DEFAULT_RESPAWN, ...opts };
}

/**
 * Play one descending respawn blip into `destination` at ctx time `now`.
 * Freq glides fromHz -> toHz (exponential, musical); gain ramps 0 -> peak -> 0
 * and the osc self-stops + disconnects at the end (no leak).
 */
export function playRespawnCue(
  ctx: AudioContext,
  destination: AudioNode,
  now: number,
  opts: RespawnCueOptions = DEFAULT_RESPAWN,
): void {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(opts.fromHz, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.toHz), now + opts.decay);
  const gain = ctx.createGain();
  const attack = opts.decay * opts.attack;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(opts.peak, now + attack);
  gain.gain.linearRampToValueAtTime(0, now + opts.decay);
  osc.connect(gain);
  gain.connect(destination);
  osc.start(now);
  osc.stop(now + opts.decay);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}
