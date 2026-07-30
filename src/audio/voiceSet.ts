/**
 * 008 human voice set. Bundles the single human engine voice (3 detuned saws
 * + sub sine -> lowpass -> gain) + drift voice (noise -> bandpass -> gain),
 * all feeding a caller-provided destination AudioNode (sfxBus, centered). Wind
 * stays shared in AudioManager (one voice driven by the human speed); the
 * voice set owns only the engine + drift.
 *
 * There is exactly one human voice (the 2P StereoPanner left/right split was
 * removed in 277); AI rivals use a separate RivalVoiceBank.
 *
 * Pure-ish: Web Audio nodes only; the mock ctx (mockAudioContext) exercises
 * the build/update/stop/dispose paths under jsdom.
 */

import { clamp, lerp } from "../core/math";
import { engineCurve, type EngineCurveOptions } from "./engineCurve";

/** Detune offsets (cents) for the 3 detuned engine saws. */
const ENGINE_DETUNES = [-12, 0, 12];

/**
 * Resolved (required) engine voice config. Structurally matches
 * AudioManager's resolved EngineVoiceOptions so the manager can hand its
 * resolved object straight through.
 */
export interface EngineVoiceConfig extends Required<EngineCurveOptions> {
  /** Forward speed at top gear (m/s). */
  maxSpeed: number;
  /** Lowpass cutoff at idle (Hz). */
  lowpassIdle: number;
  /** Lowpass cutoff at top speed (Hz). */
  lowpassTop: number;
  /** setTargetAtTime time constant (s) for freq/gain ramps. */
  tau: number;
}

/** Resolved (required) drift voice config (the drift subset of DriftWindOptions). */
export interface DriftVoiceConfig {
  driftGain: number;
  driftBandHz: number;
  driftQ: number;
  driftTau: number;
  /** Min speed for the drift gate (m/s). */
  driftThreshold: number;
}

export interface VoiceSetOptions {
  engine: EngineVoiceConfig;
  drift: DriftVoiceConfig;
}

/**
 * One player's engine + drift synthesis bundle. Built once against a shared
 * noise buffer + a destination node; update() drives freq/gain from the per-
 * frame speed/throttle/drifting signals. dispose() tears the whole bundle
 * down so AudioManager can rebuild it.
 */
export class VoiceSet {
  private readonly engine: EngineVoiceConfig;
  private readonly drift: DriftVoiceConfig;
  private readonly destination: AudioNode;

  // Engine voice
  private engineOscs: OscillatorNode[] = [];
  private engineSub: OscillatorNode | null = null;
  private engineLowpass: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private engineActive = true;
  private engineLastGain: number;

  // Drift voice
  private driftSource: AudioBufferSourceNode | null = null;
  private driftBandpass: BiquadFilterNode | null = null;
  private driftGain: GainNode | null = null;

  constructor(
    ctx: AudioContext,
    destination: AudioNode,
    noise: AudioBuffer,
    opts: VoiceSetOptions,
  ) {
    this.engine = opts.engine;
    this.drift = opts.drift;
    this.destination = destination;
    this.engineLastGain = this.engine.idleGain;
    this.buildEngine(ctx);
    this.buildDrift(ctx, noise);
  }

  /** Build engine: 3 detuned saws + sub sine -> lowpass -> gain -> destination. */
  private buildEngine(ctx: AudioContext): void {
    const e = this.engine;
    this.engineLowpass = ctx.createBiquadFilter();
    this.engineLowpass.type = "lowpass";
    this.engineLowpass.frequency.value = e.lowpassIdle;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineLowpass.connect(this.engineGain);
    this.engineGain.connect(this.destination);

    const startFreq = e.idleHz * e.lowRatio;
    for (const detune of ENGINE_DETUNES) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = startFreq;
      osc.detune.value = detune;
      osc.connect(this.engineLowpass);
      osc.start();
      this.engineOscs.push(osc);
    }
    this.engineSub = ctx.createOscillator();
    this.engineSub.type = "sine";
    this.engineSub.frequency.value = startFreq / 2;
    this.engineSub.connect(this.engineLowpass);
    this.engineSub.start();
  }

  /** Build drift: noise -> bandpass -> gain -> destination. */
  private buildDrift(ctx: AudioContext, noise: AudioBuffer): void {
    const d = this.drift;
    this.driftSource = ctx.createBufferSource();
    this.driftSource.buffer = noise;
    this.driftSource.loop = true;
    this.driftBandpass = ctx.createBiquadFilter();
    this.driftBandpass.type = "bandpass";
    this.driftBandpass.frequency.value = d.driftBandHz;
    this.driftBandpass.Q.value = d.driftQ;
    this.driftGain = ctx.createGain();
    this.driftGain.gain.value = 0;
    this.driftSource.connect(this.driftBandpass);
    this.driftBandpass.connect(this.driftGain);
    this.driftGain.connect(this.destination);
    this.driftSource.start();
  }

  /**
   * Drive engine freq/gain/cutoff + drift gain from the per-frame signals.
   * Engine follows engineCurve; drift gates on drifting && speed>threshold.
   */
  update(ctx: AudioContext, now: number, speed: number, throttle: number, drifting: boolean): void {
    if (!this.engineActive) return; // 022 silence-gate: skip inaudible writes
    this.updateEngine(ctx, now, speed, throttle);
    this.updateDrift(ctx, now, speed, drifting);
  }

  private updateEngine(ctx: AudioContext, now: number, speed: number, throttle: number): void {
    const e = this.engine;
    const out = engineCurve({ speed, maxSpeed: e.maxSpeed, throttle }, e);
    this.engineLastGain = out.gain;
    const tau = e.tau;
    for (const osc of this.engineOscs) {
      osc.frequency.setTargetAtTime(out.freq, now, tau);
    }
    this.engineSub?.frequency.setTargetAtTime(out.freq / 2, now, tau);
    const speed01 = e.maxSpeed > 0 ? clamp(speed / e.maxSpeed, 0, 1) : 0;
    const cutoff = lerp(e.lowpassIdle, e.lowpassTop, speed01);
    this.engineLowpass?.frequency.setTargetAtTime(cutoff, now, tau);
    this.applyEngineGain(ctx, now);
  }

  private updateDrift(ctx: AudioContext, now: number, speed: number, drifting: boolean): void {
    void ctx;
    const d = this.drift;
    const driftOn = drifting && speed > d.driftThreshold;
    this.driftGain?.gain.setTargetAtTime(driftOn ? d.driftGain : 0, now, d.driftTau);
  }

  /** Ramp the engine voice in (racing) or out (menu/countdown). */
  setActive(ctx: AudioContext, active: boolean, now?: number): void {
    this.engineActive = active;
    this.applyEngineGain(ctx, now);
  }

  private applyEngineGain(ctx: AudioContext, now?: number): void {
    if (!this.engineGain) return;
    const target = this.engineLastGain * (this.engineActive ? 1 : 0);
    this.engineGain.gain.setTargetAtTime(target, now ?? ctx.currentTime, this.engine.tau);
  }

  /** Stop started sources defensively (double-stop throws on real Web Audio). */
  stop(): void {
    for (const osc of this.engineOscs) {
      stopSource(osc);
      osc.disconnect();
    }
    this.engineOscs = [];
    if (this.engineSub) {
      stopSource(this.engineSub);
      this.engineSub.disconnect();
      this.engineSub = null;
    }
    stopSource(this.driftSource);
    this.driftSource?.disconnect();
    this.driftSource = null;
  }

  /** Disconnect every node (graph teardown). Sources should be stop()'d first. */
  dispose(): void {
    this.engineLowpass?.disconnect();
    this.engineGain?.disconnect();
    this.engineLowpass = null;
    this.engineGain = null;
    this.driftBandpass?.disconnect();
    this.driftGain?.disconnect();
    this.driftBandpass = null;
    this.driftGain = null;
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
