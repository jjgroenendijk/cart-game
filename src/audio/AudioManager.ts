import { clamp } from "../core/math";
import type { EngineCurveOptions } from "./engineCurve";
import { makeNoiseBuffer } from "./noiseBuffer";
import { VoiceSet, type DriftVoiceConfig, type EngineVoiceConfig } from "./voiceSet";

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
  /** Drift + wind voice tuning. */
  driftWind?: DriftWindOptions;
}

const DEFAULT_VOLUME = 0.8;
const ENGINE_LOWPASS_IDLE = 700;
const ENGINE_LOWPASS_TOP = 3800;
const ENGINE_TAU = 0.08;

interface BeepDef {
  type: OscillatorType;
  freq: number;
  dur: number;
  peak: number;
}

/** UI beep kinds -> {type, freq, dur(s), peak}. Tuned per 005 Defaults. */
const BEEP_DEFS: Record<"hover" | "click" | "beep" | "go", BeepDef> = {
  hover: { type: "sine", freq: 880, dur: 0.06, peak: 0.12 },
  click: { type: "triangle", freq: 520, dur: 0.09, peak: 0.16 },
  beep: { type: "sine", freq: 660, dur: 0.16, peak: 0.22 },
  go: { type: "sine", freq: 990, dur: 0.42, peak: 0.26 },
};

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

function resolveDriftWindOpts(o?: DriftWindOptions): Required<DriftWindOptions> {
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

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;

  // Per-player voice sets (engine + drift each). 1P -> 1 voice into master.
  // 008 extends this to N panned voices for split-screen.
  private voices: VoiceSet[] = [];
  private engineActive = true;
  private readonly engine: EngineVoiceConfig;
  private readonly driftCfg: DriftVoiceConfig;

  // Wind voice (shared; driven by the max human speed). Shares the noise
  // buffer with the per-player drift voices.
  private noise: AudioBuffer | null = null;
  private windSource: AudioBufferSourceNode | null = null;
  private windLowpass: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private readonly dw: Required<DriftWindOptions>;

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
    this.dw = resolveDriftWindOpts(opts.driftWind);
    this.driftCfg = {
      driftGain: this.dw.driftGain,
      driftBandHz: this.dw.driftBandHz,
      driftQ: this.dw.driftQ,
      driftTau: this.dw.driftTau,
      driftThreshold: this.dw.driftThreshold,
    };
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
   * throttle, drifting from the per-render scope in Game.frame. Delegates
   * engine + drift to voice[0]; drives the shared wind from speed.
   */
  update(_dt: number, state: { speed: number; throttle: number; drifting: boolean }): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.voices[0]?.update(this.ctx, now, state.speed, state.throttle, state.drifting);
    this.updateWind(now, state.speed);
  }

  /**
   * Fire a transient UI beep. No-op until resume(). Each call creates an
   * oscillator+gain on demand, schedules an attack/decay envelope, stops the
   * osc at the end, and self-cleans via osc.onended -> disconnect (no leak).
   * 006 calls this from Countdown + menu hover/click handlers.
   */
  uiBeep(kind: "hover" | "click" | "beep" | "go"): void {
    if (!this.ctx || !this.master) return;
    const def = BEEP_DEFS[kind];
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = def.type;
    osc.frequency.setValueAtTime(def.freq, now);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(def.peak, now + def.dur * 0.1);
    gain.gain.linearRampToValueAtTime(0, now + def.dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + def.dur);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  /**
   * Ramp the engine voice in (racing) or out (menu/countdown). Delegates to
   * voice[0]; the flag is remembered so it applies once voices exist.
   */
  setEngineActive(active: boolean): void {
    this.engineActive = active;
    if (this.ctx) this.voices[0]?.setActive(this.ctx, active);
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

  /**
   * Build + start the persistent voices: one per-player VoiceSet (engine +
   * drift) into master, plus the shared wind voice. Order matters for the
   * audio tests (engine nodes precede drift precede wind), so the voice set is
   * built before wind.
   */
  private startPersistentVoices(ctx: AudioContext): void {
    this.noise = makeNoiseBuffer(ctx);
    this.voices = [
      new VoiceSet(ctx, this.master!, this.noise!, {
        engine: this.engine,
        drift: this.driftCfg,
      }),
    ];
    this.buildWind(ctx);
    // Apply the remembered engine gate so a pre-resume setEngineActive(false)
    // takes effect once the voice exists.
    this.voices[0]!.setActive(ctx, this.engineActive);
  }

  /** Stop + disconnect the persistent voices (voice sets + wind). */
  private stopPersistentVoices(): void {
    for (const v of this.voices) {
      v.stop();
      v.dispose();
    }
    this.voices = [];
    this.stopWind();
  }

  /**
   * Wind voice: loops the shared noise buffer through a lowpass (500Hz) into a
   * gain that rises linearly with speed/maxSpeed. Shared across all players
   * (driven by the max human speed); the per-player engine+drift pan lives in
   * each VoiceSet's destination.
   */
  private buildWind(ctx: AudioContext): void {
    const d = this.dw;
    this.windSource = ctx.createBufferSource();
    this.windSource.buffer = this.noise;
    this.windSource.loop = true;
    this.windLowpass = ctx.createBiquadFilter();
    this.windLowpass.type = "lowpass";
    this.windLowpass.frequency.value = d.windCutoffHz;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSource.connect(this.windLowpass);
    this.windLowpass.connect(this.windGain);
    this.windGain.connect(this.master!);
    this.windSource.start();
  }

  private stopWind(): void {
    this.stopSource(this.windSource);
    this.windSource?.disconnect();
    this.windSource = null;
    this.windLowpass?.disconnect();
    this.windLowpass = null;
    this.windGain?.disconnect();
    this.windGain = null;
    this.noise = null;
  }

  /** Stop a started source defensively (double-stop throws on real Web Audio). */
  private stopSource(src: { stop?: () => void } | null): void {
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
  private updateWind(now: number, speed: number): void {
    const d = this.dw;
    const wind01 = this.engine.maxSpeed > 0 ? clamp(speed / this.engine.maxSpeed, 0, 1) : 0;
    this.windGain?.gain.setTargetAtTime(wind01 * d.windGain, now, d.windTau);
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
