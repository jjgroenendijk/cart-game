import { clamp, lerp } from "../core/math";
import { engineCurve, type EngineCurveOptions } from "./engineCurve";

/**
 * 005 procedural audio manager. Raw Web Audio API (no THREE.Audio, no asset
 * files). Synthesizes engine + drift + wind + UI/countdown beeps from
 * oscillators + a shared white-noise buffer.
 *
 * Autoplay policy: the AudioContext is created ONLY inside resume(), which 006
 * wires to its Start-button click handler. Before the first resume() every
 * public method is a no-op (ctx null) so constructing AudioManager at Game
 * init can never trip the browser autoplay block. Dev-audible verify before
 * 006 lands: `__game.audio.resume()` in the console.
 *
 * If AudioContext is unavailable (older Safari w/o webkitAudioContext), the
 * factory returns null and AudioManager degrades to a permanent no-op: the
 * game stays playable, just silent.
 */

export type AudioContextFactory = () => AudioContext | null;

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

export interface AudioManagerOptions {
  /**
   * Injector for the AudioContext. Default feature-detects
   * AudioContext/webkitAudioContext on window. Tests pass a mock factory.
   */
  createContext?: AudioContextFactory;
  /** Master volume [0,1]. */
  volume?: number;
  /** Wire visibilitychange -> suspend/resume. Default true. */
  attachVisibility?: boolean;
  /** Engine voice tuning. */
  engine?: EngineVoiceOptions;
}

const DEFAULT_VOLUME = 0.8;
const ENGINE_DETUNES = [-12, 0, 12];
const ENGINE_LOWPASS_IDLE = 700;
const ENGINE_LOWPASS_TOP = 3800;
const ENGINE_TAU = 0.08;

const defaultCreateContext: AudioContextFactory = () => {
  const w = globalThis as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  return Ctor ? new Ctor() : null;
};

function resolveEngineOpts(o?: EngineVoiceOptions): Required<EngineVoiceOptions> {
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

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;

  // Engine voice
  private engineOscs: OscillatorNode[] = [];
  private engineSub: OscillatorNode | null = null;
  private engineLowpass: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private engineActive = true;
  private engineLastGain = 0.05;
  private readonly engine: Required<EngineVoiceOptions>;

  private gestured = false;
  private volume: number;
  private muted = false;
  private readonly createContext: AudioContextFactory;
  private readonly attachVisibility: boolean;
  private visibilityHandler: (() => void) | null = null;

  constructor(opts: AudioManagerOptions = {}) {
    this.createContext = opts.createContext ?? defaultCreateContext;
    this.volume = clamp(opts.volume ?? DEFAULT_VOLUME, 0, 1);
    this.attachVisibility = opts.attachVisibility ?? true;
    this.engine = resolveEngineOpts(opts.engine);
    this.engineLastGain = this.engine.idleGain;
  }

  /** True once a user gesture drove resume() at least once. */
  get isGestured(): boolean {
    return this.gestured;
  }

  /** True if the AudioContext has been built (post-gesture). */
  get isRunning(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  /**
   * Idempotent. First call builds the graph + persistent voices and starts
   * them; subsequent calls just ctx.resume() if suspended. No-op degrade if
   * AudioContext is unsupported. 006 calls this from the Start-button handler.
   */
  resume(): void {
    if (this.ctx === null) {
      const ctx = this.createContext();
      if (!ctx) return;
      this.ctx = ctx;
      this.buildGraph(ctx);
      this.startPersistentVoices(ctx);
      this.applyMaster();
    } else if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    this.gestured = true;
    if (this.attachVisibility && !this.visibilityHandler) this.attachVisibilityHandler();
  }

  /**
   * Per-frame driver. No-op until resume() builds the ctx. 005 reads speed,
   * throttle, drifting from the per-render scope in Game.frame.
   */
  update(_dt: number, state: { speed: number; throttle: number; drifting: boolean }): void {
    if (!this.ctx) return;
    this.updateEngine(state.speed, state.throttle);
  }

  /**
   * Fire a transient UI beep. No-op until resume(). Each call creates an
   * oscillator+gain on demand and self-cleans via osc.onended.
   */
  uiBeep(_kind: "hover" | "click" | "beep" | "go"): void {
    // Implemented in a following commit; intentionally empty here.
  }

  /**
   * Ramp the engine voice in (racing) or out (menu/countdown). The next
   * update() applies the new target via setTargetAtTime; setEngineActive also
   * nudges it immediately so it responds even between frames.
   */
  setEngineActive(active: boolean): void {
    this.engineActive = active;
    this.applyEngineGain();
  }

  /** Set master volume [0,1]; ramps via setTargetAtTime (no clicks). */
  setVolume(v: number): void {
    this.volume = clamp(v, 0, 1);
    this.applyMaster();
  }

  /** Mute/unmute master; ramps via setTargetAtTime. */
  mute(muted: boolean): void {
    this.muted = muted;
    this.applyMaster();
  }

  /** Suspend the ctx (e.g. tab hidden). No-op if ctx null/not running. */
  suspend(): void {
    if (this.ctx && this.ctx.state === "running") void this.ctx.suspend();
  }

  /** Stop everything, disconnect nodes, close the ctx. Idempotent. */
  dispose(): void {
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
    this.stopPersistentVoices();
    this.master?.disconnect();
    this.compressor?.disconnect();
    this.master = null;
    this.compressor = null;
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.gestured = false;
  }

  // --- graph construction (extended in following commits) -----------------

  /**
   * master Gain -> DynamicsCompressor -> ctx.destination. Persistent voices
   * and transient beeps feed into master. Compressor (threshold -24, ratio 4)
   * catches drift/beep peaks so the master bus never clips.
   */
  private buildGraph(ctx: AudioContext): void {
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -24;
    this.compressor.ratio.value = 4;
    this.compressor.knee.value = 30;
    this.master.connect(this.compressor);
    this.compressor.connect(ctx.destination);
  }

  /** Build + start the persistent voices (engine/drift/wind). Extended later. */
  private startPersistentVoices(ctx: AudioContext): void {
    this.buildEngineVoice(ctx);
  }

  /** Stop + disconnect the persistent voices. Extended later. */
  private stopPersistentVoices(): void {
    this.stopEngineVoice();
  }

  /**
   * Engine voice: 3 detuned sawtooth oscillators + 1 sub sine (octave below)
   * -> shared lowpass (tracks speed) -> engineGain (tracks throttle + the
   * engineActive gate) -> master. Persistent; started once via osc.start().
   */
  private buildEngineVoice(ctx: AudioContext): void {
    const e = this.engine;
    this.engineLowpass = ctx.createBiquadFilter();
    this.engineLowpass.type = "lowpass";
    this.engineLowpass.frequency.value = e.lowpassIdle;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineLowpass.connect(this.engineGain);
    this.engineGain.connect(this.master!);

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

  private stopEngineVoice(): void {
    for (const osc of this.engineOscs) {
      this.stopSource(osc);
      osc.disconnect();
    }
    this.engineOscs = [];
    if (this.engineSub) {
      this.stopSource(this.engineSub);
      this.engineSub.disconnect();
      this.engineSub = null;
    }
    this.engineLowpass?.disconnect();
    this.engineGain?.disconnect();
    this.engineLowpass = null;
    this.engineGain = null;
  }

  /** Stop a started source defensively (double-stop throws on real Web Audio). */
  private stopSource(src: { stop?: () => void }): void {
    try {
      src.stop?.();
    } catch {
      // Already stopped; ignore.
    }
  }

  /** Drive engine freq/gain/cutoff from the current speed + throttle. */
  private updateEngine(speed: number, throttle: number): void {
    const e = this.engine;
    const out = engineCurve({ speed, maxSpeed: e.maxSpeed, throttle }, e);
    this.engineLastGain = out.gain;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const tau = e.tau;
    for (const osc of this.engineOscs) {
      osc.frequency.setTargetAtTime(out.freq, now, tau);
    }
    this.engineSub?.frequency.setTargetAtTime(out.freq / 2, now, tau);
    const speed01 = e.maxSpeed > 0 ? clamp(speed / e.maxSpeed, 0, 1) : 0;
    const cutoff = lerp(e.lowpassIdle, e.lowpassTop, speed01);
    this.engineLowpass?.frequency.setTargetAtTime(cutoff, now, tau);
    this.applyEngineGain(now);
  }

  private applyEngineGain(now?: number): void {
    if (!this.ctx || !this.engineGain) return;
    const target = this.engineLastGain * (this.engineActive ? 1 : 0);
    this.engineGain.gain.setTargetAtTime(target, now ?? this.ctx.currentTime, this.engine.tau);
  }

  private applyMaster(): void {
    if (!this.master || !this.ctx) return;
    const target = this.muted ? 0 : this.volume;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
  }

  private attachVisibilityHandler(): void {
    this.visibilityHandler = () => {
      if (document.hidden) this.suspend();
      else if (this.gestured) this.resume();
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);
  }
}
