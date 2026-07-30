/**
 * 046 audio graph builders. Pure functions that construct Web Audio nodes and
 * RETURN handles; no AudioManager state. Split out of AudioManager so the
 * graph-construction seam (buses + persistent voices + wind/music/collision)
 * lives apart from the lifecycle + per-frame fan-out. Node creation order is
 * load-bearing for the AudioManager mock tests, so every builder is a verbatim
 * relocation (only this.X -> params/return).
 */

import { clamp } from "../core/math";
import type { EngineCurveOptions } from "./engineCurve";
import { makeNoiseBuffer } from "./noiseBuffer";
import { VoiceSet, type DriftVoiceConfig, type EngineVoiceConfig } from "./voiceSet";
import { CollisionVoice, type ImpactTierOptions } from "./collisionVoice";
import { MusicEngine, type MusicOptions } from "./musicEngine";
import { RainVoice } from "./rainVoice";
import { RivalVoiceBank } from "./rivalVoices";

const ENGINE_LOWPASS_IDLE = 700;
const ENGINE_LOWPASS_TOP = 3800;
const ENGINE_TAU = 0.08;

/** Engine voice tuning. Defaults match 005 Defaults (idle 55Hz, top 320Hz). */
export interface EngineVoiceOptions extends EngineCurveOptions {
  /** Forward speed at top gear (m/s, from kart tuning). Default 34. */
  maxSpeed?: number;
  /** Lowpass cutoff at idle (Hz). */
  lowpassIdle?: number;
  /** Lowpass cutoff at top speed (Hz). */
  lowpassTop?: number;
  /** setTargetAtTime time constant (s) for freq/gain ramps. */
  tau?: number;
}

/** Drift + wind voice tuning. Defaults match 005 Defaults. */
export interface DriftWindOptions {
  /** Drift gain when active. */
  driftGain?: number;
  /** Drift bandpass center frequency (Hz). */
  driftBandHz?: number;
  /** Drift bandpass Q. */
  driftQ?: number;
  /** Drift gain ramp time constant (s). */
  driftTau?: number;
  /** Min speed for drift gate (m/s). Default 7 (matches KartController). */
  driftThreshold?: number;
  /** Wind gain at maxSpeed. */
  windGain?: number;
  /** Wind lowpass cutoff (Hz). */
  windCutoffHz?: number;
  /** Wind gain ramp time constant (s). */
  windTau?: number;
}

export function resolveEngineOpts(o?: EngineVoiceOptions): Required<EngineVoiceOptions> {
  return {
    maxSpeed: o?.maxSpeed ?? 34,
    idleHz: o?.idleHz ?? 55,
    topHz: o?.topHz ?? 320,
    lowRatio: o?.lowRatio ?? 0.55,
    highRatio: o?.highRatio ?? 1.0,
    idleGain: o?.idleGain ?? 0.05,
    fullGain: o?.fullGain ?? 0.2,
    gears: o?.gears ?? 6,
    lowpassIdle: o?.lowpassIdle ?? ENGINE_LOWPASS_IDLE,
    lowpassTop: o?.lowpassTop ?? ENGINE_LOWPASS_TOP,
    tau: o?.tau ?? ENGINE_TAU,
  };
}

export function resolveDriftWindOpts(o?: DriftWindOptions): Required<DriftWindOptions> {
  return {
    driftGain: o?.driftGain ?? 0.16,
    driftBandHz: o?.driftBandHz ?? 1500,
    driftQ: o?.driftQ ?? 0.8,
    driftTau: o?.driftTau ?? 0.05,
    driftThreshold: o?.driftThreshold ?? 7,
    windGain: o?.windGain ?? 0.09,
    windCutoffHz: o?.windCutoffHz ?? 500,
    windTau: o?.windTau ?? 0.2,
  };
}

export interface GraphBuses {
  master: GainNode;
  sfxBus: GainNode;
  musicBus: GainNode;
  compressor: DynamicsCompressorNode;
}

/**
 * master Gain -> DynamicsCompressor -> ctx.destination, with independent
 * sfx + music bus gains feeding master (012). Persistent voices + transient
 * beeps feed sfxBus; the music bed feeds musicBus. Bus gains default 1 so
 * the mix is unchanged until a settings slider moves one. Compressor
 * (threshold -24, ratio 4) catches drift/beep peaks so master never clips.
 */
export function buildGraph(ctx: AudioContext): GraphBuses {
  const master = ctx.createGain();
  master.gain.value = 0;
  const sfxBus = ctx.createGain();
  sfxBus.gain.value = 1;
  const musicBus = ctx.createGain();
  musicBus.gain.value = 1;
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.ratio.value = 4;
  compressor.knee.value = 30;
  sfxBus.connect(master);
  musicBus.connect(master);
  master.connect(compressor);
  compressor.connect(ctx.destination);
  return { master, sfxBus, musicBus, compressor };
}

/** Wind handle: looping noise -> lowpass -> gain, into the sfx bus. */
export interface WindVoice {
  source: AudioBufferSourceNode;
  lowpass: BiquadFilterNode;
  gain: GainNode;
}

/**
 * Wind voice: loops the shared noise buffer through a lowpass (500Hz) into a
 * gain that rises linearly with speed/maxSpeed. Shared across all players
 * (driven by the max human speed); the per-player engine+drift pan lives in
 * each VoiceSet's destination.
 */
export function buildWind(
  ctx: AudioContext,
  noise: AudioBuffer,
  sfxBus: GainNode,
  dw: Required<DriftWindOptions>,
): WindVoice {
  const d = dw;
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = d.windCutoffHz;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(lowpass);
  lowpass.connect(gain);
  gain.connect(sfxBus);
  source.start();
  return { source, lowpass, gain };
}

/** Stop + disconnect the wind voice (source, lowpass, gain). */
export function stopWind(wind: WindVoice): void {
  stopSource(wind.source);
  wind.source.disconnect();
  wind.lowpass.disconnect();
  wind.gain.disconnect();
}

/**
 * Procedural music engine (075): a Tone.js adaptive score (per-phase chord
 * pad, bass, generative lead, drum kit) into a music bus -> master. Built
 * before the collision voice so the collision nodes remain last (stable test
 * indices). Under jsdom the engine degrades to a no-op (supportsTone probe),
 * so it adds ZERO nodes and the load-bearing voice indices stay stable.
 * GameAudioDriver drives phase transitions via setMusicPhase -> setPhase.
 */
export function buildMusic(
  ctx: AudioContext,
  musicBus: GainNode,
  music: MusicOptions,
): MusicEngine {
  return new MusicEngine(ctx, musicBus, music);
}

/** Dispose the music engine (stops transport + disconnects nodes). */
export function stopMusic(musicEngine: MusicEngine): void {
  musicEngine.dispose();
}

/**
 * Collision impact voice (009): loops the shared noise buffer -> lowpass ->
 * a single reused env gain -> master. triggerImpact restarts the env on the
 * reused gain node. Built last so existing voice node indices stay stable.
 */
export function buildCollision(
  ctx: AudioContext,
  sfxBus: GainNode,
  noise: AudioBuffer,
  impact: ImpactTierOptions,
): CollisionVoice {
  return new CollisionVoice(ctx, sfxBus, noise, impact);
}

/** Stop + dispose the collision voice. */
export function stopCollision(v: CollisionVoice): void {
  v.stop();
  v.dispose();
}

/** Stop a started source defensively (double-stop throws on real Web Audio). */
export function stopSource(src: { stop?: () => void } | null): void {
  if (!src) return;
  try {
    src.stop?.();
  } catch {
    // Already stopped; ignore.
  }
}

/**
 * Drive the shared wind gain. Rises linearly with speed/maxSpeed and ramps
 * via setTargetAtTime (no hard gate clicks).
 */
export function driveWind(
  now: number,
  speed: number,
  windGain: GainNode,
  maxSpeed: number,
  dw: Required<DriftWindOptions>,
): void {
  const d = dw;
  const wind01 = maxSpeed > 0 ? clamp(speed / maxSpeed, 0, 1) : 0;
  windGain.gain.setTargetAtTime(wind01 * d.windGain, now, d.windTau);
}

export interface PersistentVoices {
  noise: AudioBuffer;
  voices: VoiceSet[];
  panners: StereoPannerNode[];
  wind: WindVoice;
  rain: RainVoice;
  musicEngine: MusicEngine;
  collision: CollisionVoice;
  rivals: RivalVoiceBank;
}

export interface PersistentVoiceOpts {
  engine: EngineVoiceConfig;
  driftCfg: DriftVoiceConfig;
  dw: Required<DriftWindOptions>;
  positional: boolean;
  hrtf: boolean;
  engineActive: boolean;
  rivalCount: number;
  music: MusicOptions;
  impact: ImpactTierOptions;
}

/**
 * Build the single human VoiceSet routed straight into sfxBus (centered, no
 * panner). The 2P StereoPanner left/right split was removed in 277; there is
 * exactly one human voice. Returns a length-1 `voices` array (kept so
 * updatePlayers/setEngineActive/dispose loops stay simple) and an always-empty
 * `panners` array (kept for the PersistentVoices field shape).
 */
export function buildHumanVoices(
  ctx: AudioContext,
  sfxBus: GainNode,
  noise: AudioBuffer,
  engine: EngineVoiceConfig,
  drift: DriftVoiceConfig,
): { voices: VoiceSet[]; panners: StereoPannerNode[] } {
  const voiceSet = new VoiceSet(ctx, sfxBus, noise, { engine, drift });
  return { voices: [voiceSet], panners: [] };
}

/** Stop + dispose the human voice (partial graph teardown). `panners` is
 * always empty now but kept so the signature stays stable. */
export function stopHumanVoices(voices: VoiceSet[], panners: StereoPannerNode[]): void {
  for (const v of voices) {
    v.stop();
    v.dispose();
  }
  for (const p of panners) p.disconnect();
}

/**
 * Build + start the persistent voices: the single human VoiceSet (engine +
 * drift) straight into sfxBus (centered), plus the shared wind. Order matters
 * for the audio tests (engine nodes precede drift precede wind), so the voice
 * set is built before wind.
 */
export function startPersistentVoices(
  ctx: AudioContext,
  sfxBus: GainNode,
  musicBus: GainNode,
  opts: PersistentVoiceOpts,
): PersistentVoices {
  const noise = makeNoiseBuffer(ctx);
  const { voices, panners } = buildHumanVoices(ctx, sfxBus, noise, opts.engine, opts.driftCfg);
  const wind = buildWind(ctx, noise, sfxBus, opts.dw);
  const rain = new RainVoice(ctx, noise, sfxBus);
  const musicEngine = buildMusic(ctx, musicBus, opts.music);
  const collision = buildCollision(ctx, sfxBus, noise, opts.impact);
  const rivals = new RivalVoiceBank(ctx, sfxBus, noise, opts.engine, opts.rivalCount);
  rivals.setSpatial(opts.positional);
  rivals.setHrtf(opts.hrtf);
  rivals.setActive(ctx, opts.engineActive);
  // Apply the remembered engine gate so a pre-resume setEngineActive(false)
  // takes effect once each voice exists.
  for (const v of voices) v.setActive(ctx, opts.engineActive);
  return { noise, voices, panners, wind, rain, musicEngine, collision, rivals };
}

/** Stop + disconnect the persistent voices (voice sets + wind + collision). */
export function stopPersistentVoices(pv: PersistentVoices): void {
  for (const v of pv.voices) {
    v.stop();
    v.dispose();
  }
  pv.voices.length = 0;
  for (const p of pv.panners) p.disconnect();
  pv.panners.length = 0;
  stopWind(pv.wind);
  pv.rain.stop();
  pv.rain.dispose();
  stopMusic(pv.musicEngine);
  stopCollision(pv.collision);
  pv.rivals.dispose();
}
