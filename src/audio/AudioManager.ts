import { clamp } from "../core/math";
import { RainVoice, playThunder } from "./rainVoice";
import { WindVoice } from "./windVoice";
import type { EngineCurveOptions } from "./engineCurve";
import { makeNoiseBuffer } from "./noiseBuffer";
import { VoiceSet, panForIndex, type DriftVoiceConfig, type EngineVoiceConfig } from "./voiceSet";
import {
  CollisionVoice,
  impactTier,
  DEFAULT_IMPACT,
  type ImpactTierOptions,
} from "./collisionVoice";
import { playRespawnCue } from "./respawnCue";
import {
  MusicBed,
  musicStateFor,
  DEFAULT_MUSIC,
  type MusicPhase,
  type MusicOptions,
} from "./musicBed";
import { RivalVoiceBank, type ListenerTransform, type RivalAudioState } from "./rivalVoices";

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

/** Per-frame audio signals for one player (feeds a VoiceSet). */
export interface PlayerAudioState {
  speed: number;
  throttle: number;
  drifting: boolean;
}

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
  /** Collision impact one-shot tuning (009). */
  impact?: ImpactTierOptions;
  /** Procedural music bed tuning (009). */
  music?: MusicOptions;
}

const DEFAULT_VOLUME = 0.8;
const ENGINE_LOWPASS_IDLE = 700;
const ENGINE_LOWPASS_TOP = 3800;
const ENGINE_TAU = 0.08;
/** Rain bed gain ceiling (setRainLevel scales 0..1 against this). */
const RAIN_GAIN = 0.12;

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
  // Independent music + sfx bus gains feeding master (012): lets the settings
  // sliders move one bus without touching the other. Null until buildGraph.
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;

  // Per-player voice sets (engine + drift each). 1P -> 1 voice into master.
  // 008 extends this to N panned voices for split-screen.
  private voices: VoiceSet[] = [];
  /** Per-player StereoPanners (1 per 2P voice); empty for 1P (center). */
  private panners: StereoPannerNode[] = [];
  private humanCount = 1;
  private engineActive = true;
  private readonly engine: EngineVoiceConfig;
  private readonly driftCfg: DriftVoiceConfig;

  // Shared noise buffer + wind voice (driven by the max human speed).
  private noise: AudioBuffer | null = null;
  private wind: WindVoice | null = null;
  private readonly dw: Required<DriftWindOptions>;

  // Rain bed (054 commit 4): tracks the weather level. See rainVoice.ts.
  private rain: RainVoice | null = null;

  // Collision impact one-shot (009). Single reused voice; retrigger restarts
  // the envelope so a flurry of contacts never stacks into a clip.
  private collisionVoice: CollisionVoice | null = null;
  private readonly impact: ImpactTierOptions;

  // Procedural music bed (009): pads + arp under the master bus.
  private musicBed: MusicBed | null = null;
  private readonly music: MusicOptions;
  private rivals: RivalVoiceBank | null = null;
  private rivalCount = 0;
  private positional = true;
  private hrtf = false;

  private gestured = false;
  private volume: number;
  private sfxVolume = 1;
  private musicVolume = 1;
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
    this.impact = opts.impact ?? DEFAULT_IMPACT;
    this.music = opts.music ?? DEFAULT_MUSIC;
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
   * Set the number of human voices. Must be called before the first resume()
   * (Game calls it from onStart, before the Start gesture resumes the ctx).
   * 1P -> 1 centered voice; 2P -> 2 voices panned left/right.
   */
  setHumanCount(n: number): void {
    this.humanCount = Math.max(1, n | 0);
  }
  setRivalCount(n: number): void {
    this.rivalCount = Math.max(0, n | 0);
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
      this.applyBuses();
    } else if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    this.gestured = true;
    if (this.attachVisibility && !this.visibilityHandler) this.attachVisibilityHandler();
  }

  /**
   * Per-frame driver for a single player. No-op until resume(). Equivalent to
   * updatePlayers with one state; kept for the 1P path + existing tests.
   */
  update(_dt: number, state: PlayerAudioState): void {
    this.updatePlayers(_dt, [state]);
  }

  /**
   * Per-frame driver for N humans (008). Drives each voice[i] from states[i]
   * (engine + drift) and the shared wind from the max human speed. No-op until
   * resume(). Extra states beyond the voice count are ignored.
   */
  updatePlayers(_dt: number, states: readonly PlayerAudioState[]): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    let maxSpeed = 0;
    for (let i = 0; i < this.voices.length; i++) {
      const s = states[i];
      if (!s) continue;
      this.voices[i]!.update(this.ctx, now, s.speed, s.throttle, s.drifting);
      if (s.speed > maxSpeed) maxSpeed = s.speed;
    }
    this.updateWind(now, maxSpeed);
  }
  updateRivals(_dt: number, states: readonly RivalAudioState[], listener: ListenerTransform): void {
    if (!this.ctx || !this.rivals) return;
    this.rivals.update(this.ctx, this.ctx.currentTime, states, listener);
  }

  /**
   * Fire a transient UI beep. No-op until resume(). Each call creates an
   * oscillator+gain on demand, schedules an attack/decay envelope, stops the
   * osc at the end, and self-cleans via osc.onended -> disconnect (no leak).
   * 006 calls this from Countdown + menu hover/click handlers.
   */
  uiBeep(kind: "hover" | "click" | "beep" | "go"): void {
    if (!this.ctx || !this.sfxBus) return;
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
    gain.connect(this.sfxBus);
    osc.start(now);
    osc.stop(now + def.dur);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  /**
   * Fire an intensity-tiered collision impact (009). force is a Rapier
   * totalForceMagnitude (already threshold/dedupe'd by routeImpacts in Game).
   * No-op until resume(). A single reused CollisionVoice plays the hit;
   * retriggers restart its envelope so a contact flurry never stacks.
   */
  triggerImpact(force: number): void {
    if (!this.ctx || !this.collisionVoice) return;
    const now = this.ctx.currentTime;
    this.collisionVoice.trigger(this.ctx, now, impactTier(force, this.impact));
  }

  /**
   * Fire the respawn cue — a short descending blip (009). One-shot into
   * master; self-cleans. No-op until resume(). Game fires it on human R/reset
   * during racing and on rival respawnAhead.
   */
  onRespawn(): void {
    if (!this.ctx || !this.master) return;
    playRespawnCue(this.ctx, this.master, this.ctx.currentTime);
  }

  /**
   * Set the music bed state for a race phase (009). No-op until resume().
   * GameAudioDriver observes the game/race state each sub-step and calls this
   * only on phase transitions.
   */
  setMusicPhase(phase: MusicPhase): void {
    if (!this.musicBed) return;
    this.musicBed.setState(musicStateFor(phase, this.music));
  }

  /** Ramp the rain bed gain with the weather level (0..1 -> RAIN_GAIN). */
  setRainLevel(level: number): void {
    if (!this.ctx || !this.rain) return;
    this.rain.setLevel(this.ctx, level, RAIN_GAIN);
  }

  /**
   * Fire a transient thunder rumble (054 commit 4). No-op until resume().
   * Nodes created per call (voice indices stay stable); delegates to
   * playThunder (rainVoice.ts).
   */
  thunder(strength: number, delaySec: number): void {
    if (!this.ctx || !this.sfxBus || !this.noise) return;
    playThunder(this.ctx, this.sfxBus, this.noise, strength, delaySec);
  }

  /**
   * Ramp the engine voice in (racing) or out (menu/countdown). Delegates to
   * voice[0]; the flag is remembered so it applies once voices exist.
   */
  setEngineActive(active: boolean): void {
    this.engineActive = active;
    if (this.ctx) {
      this.voices[0]?.setActive(this.ctx, active);
      this.rivals?.setActive(this.ctx, active);
    }
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

  /** Set SFX bus volume [0,1]; ramps via setTargetAtTime (no clicks). */
  setSfxVolume(v: number): void {
    this.sfxVolume = clamp(v, 0, 1);
    this.applyBuses();
  }

  /** Set music bus volume [0,1]; ramps via setTargetAtTime (no clicks). */
  setMusicVolume(v: number): void {
    this.musicVolume = clamp(v, 0, 1);
    this.applyBuses();
  }
  setPositional(on: boolean): void {
    this.positional = on;
    this.rivals?.setSpatial(on);
  }
  setHrtf(on: boolean): void {
    this.hrtf = on;
    this.rivals?.setHrtf(on);
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
    this.sfxBus?.disconnect();
    this.musicBus?.disconnect();
    this.master = null;
    this.compressor = null;
    this.sfxBus = null;
    this.musicBus = null;
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.gestured = false;
  }

  // --- graph construction (extended in following commits) -----------------

  /**
   * master Gain -> DynamicsCompressor -> ctx.destination, with independent
   * sfx + music bus gains feeding master (012). Persistent voices + transient
   * beeps feed sfxBus; the music bed feeds musicBus. Bus gains default 1 so
   * the mix is unchanged until a settings slider moves one. Compressor
   * (threshold -24, ratio 4) catches drift/beep peaks so master never clips.
   */
  private buildGraph(ctx: AudioContext): void {
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 1;
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 1;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -24;
    this.compressor.ratio.value = 4;
    this.compressor.knee.value = 30;
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.master.connect(this.compressor);
    this.compressor.connect(ctx.destination);
  }

  /**
   * Build + start the persistent voices: per-player VoiceSets (engine +
   * drift), then wind, rain, music, collision, rivals. Order matters for the
   * audio tests (engine -> drift -> wind -> rain); see AGENTS.md.
   */
  private startPersistentVoices(ctx: AudioContext): void {
    this.noise = makeNoiseBuffer(ctx);
    this.voices = [];
    this.panners = [];
    for (let i = 0; i < this.humanCount; i++) {
      let dest: AudioNode = this.sfxBus!;
      if (this.humanCount > 1) {
        const panner = ctx.createStereoPanner();
        panner.pan.value = panForIndex(i, this.humanCount);
        panner.connect(this.sfxBus!);
        this.panners.push(panner);
        dest = panner;
      }
      this.voices.push(
        new VoiceSet(ctx, dest, this.noise!, {
          engine: this.engine,
          drift: this.driftCfg,
        }),
      );
    }
    this.buildWind(ctx);
    this.rain = new RainVoice(ctx, this.noise!, this.sfxBus!);
    this.buildMusic(ctx);
    this.buildCollision(ctx);
    this.rivals = new RivalVoiceBank(ctx, this.sfxBus!, this.noise!, this.engine, this.rivalCount);
    this.rivals.setSpatial(this.positional);
    this.rivals.setHrtf(this.hrtf);
    this.rivals.setActive(ctx, this.engineActive);
    // Apply the remembered engine gate so a pre-resume setEngineActive(false)
    // takes effect once each voice exists.
    for (const v of this.voices) v.setActive(ctx, this.engineActive);
  }

  /** Stop + disconnect the persistent voices (voice sets + wind + rain + collision). */
  private stopPersistentVoices(): void {
    for (const v of this.voices) {
      v.stop();
      v.dispose();
    }
    this.voices = [];
    for (const p of this.panners) p.disconnect();
    this.panners = [];
    this.stopWind();
    this.stopRain();
    this.stopMusic();
    this.stopCollision();
    this.rivals?.dispose();
    this.rivals = null;
  }
  /** Build the shared wind bed (see WindVoice). */
  private buildWind(ctx: AudioContext): void {
    this.wind = new WindVoice(ctx, this.noise!, this.sfxBus!, {
      cutoffHz: this.dw.windCutoffHz,
      gainCeiling: this.dw.windGain,
      tau: this.dw.windTau,
    });
  }
  private stopWind(): void {
    this.wind?.stop();
    this.wind?.dispose();
    this.wind = null;
    this.noise = null;
  }
  /** Stop + disconnect the rain bed. */
  private stopRain(): void {
    this.rain?.stop();
    this.rain?.dispose();
    this.rain = null;
  }
  /**
   * Collision impact voice (009): loops the shared noise buffer -> lowpass ->
   * a single reused env gain -> master. triggerImpact restarts the env on the
   * reused gain node. Built last so existing voice node indices stay stable.
   */
  private buildCollision(ctx: AudioContext): void {
    this.collisionVoice = new CollisionVoice(ctx, this.sfxBus!, this.noise!, this.impact);
  }
  private stopCollision(): void {
    this.collisionVoice?.stop();
    this.collisionVoice?.dispose();
    this.collisionVoice = null;
  }
  /**
   * Procedural music bed (009): detuned-saw pads + a ctx-time lookahead arp
   * into a music bus -> master. Built before the collision voice so the
   * collision nodes remain last (stable test indices). Defaults to the menu
   * pad; GameAudioDriver drives phase transitions via setMusicPhase.
   */
  private buildMusic(ctx: AudioContext): void {
    this.musicBed = new MusicBed(ctx, this.musicBus!, this.music);
  }
  private stopMusic(): void {
    this.musicBed?.dispose();
    this.musicBed = null;
  }
  /** Drive the shared wind gain from the live speed fraction. */
  private updateWind(now: number, speed: number): void {
    const wind01 = this.engine.maxSpeed > 0 ? clamp(speed / this.engine.maxSpeed, 0, 1) : 0;
    this.wind?.update(now, wind01, {
      cutoffHz: this.dw.windCutoffHz,
      gainCeiling: this.dw.windGain,
      tau: this.dw.windTau,
    });
  }
  private applyMaster(): void {
    if (!this.master || !this.ctx) return;
    const target = this.muted ? 0 : this.volume;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
  }

  /** Ramp the sfx + music bus gains to their stored targets (no clicks). */
  private applyBuses(): void {
    if (!this.sfxBus || !this.musicBus || !this.ctx) return;
    this.sfxBus.gain.setTargetAtTime(this.sfxVolume, this.ctx.currentTime, 0.05);
    this.musicBus.gain.setTargetAtTime(this.musicVolume, this.ctx.currentTime, 0.05);
  }

  private attachVisibilityHandler(): void {
    this.visibilityHandler = () => {
      if (document.hidden) this.suspend();
      else if (this.gestured) this.resume();
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);
  }
}
