import { clamp } from "../core/math";
import { playThunder } from "./rainVoice";
import { playBeep } from "./beeps";
import {
  buildGraph,
  buildHumanVoices,
  startPersistentVoices,
  stopPersistentVoices,
  stopHumanVoices,
  driveWind,
  resolveEngineOpts,
  resolveDriftWindOpts,
  type EngineVoiceOptions,
  type DriftWindOptions,
  type PersistentVoices,
} from "./audioGraph";
import { impactTier, DEFAULT_IMPACT, type ImpactTierOptions } from "./collisionVoice";
import { playRespawnCue } from "./respawnCue";
import { DEFAULT_MUSIC, type MusicPhase, type MusicOptions } from "./musicEngine";
import type { ListenerTransform, RivalAudioState } from "./rivalVoices";
import { RivalVoiceBank } from "./rivalVoices";
import type { DriftVoiceConfig, EngineVoiceConfig } from "./voiceSet";

export type { EngineVoiceOptions, DriftWindOptions } from "./audioGraph";

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
 *
 * Graph construction lives in audioGraph.ts (046); this class owns the public
 * API, the resume/suspend/dispose lifecycle, bus-state, and the per-frame
 * update fan-out. Every no-op-before-resume guard stays in the public methods.
 */

export type AudioContextFactory = () => AudioContext | null;

/** Per-frame audio signals for one player (feeds a VoiceSet). */
export interface PlayerAudioState {
  speed: number;
  throttle: number;
  drifting: boolean;
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

/** Rain bed gain ceiling (setRainLevel scales 0..1 against this). */
const RAIN_GAIN = 0.12;

/** Weather-wind bed gain ceiling (setWeatherWindLevel scales 0..1 against this). */
const WEATHER_WIND_GAIN = 0.1;

const defaultCreateContext: AudioContextFactory = () => {
  const w = globalThis as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  return Ctor ? new Ctor() : null;
};

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  // Independent music + sfx bus gains feeding master (012): lets the settings
  // sliders move one bus without touching the other. Null until buildGraph.
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;

  // Persistent voices bundle (engine/drift/wind/music/collision/rivals).
  // Null until resume() builds it; dropped on dispose().
  private persistent: PersistentVoices | null = null;

  private humanCount = 1;
  private engineActive = true;
  private readonly engine: EngineVoiceConfig;
  private readonly driftCfg: DriftVoiceConfig;
  private readonly dw: Required<DriftWindOptions>;
  private readonly impact: ImpactTierOptions;
  private readonly music: MusicOptions;
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
  private paused = false;

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
   * Set the number of human voices. Pre-resume this just records the count
   * (resume() builds the voices from it); post-resume it rebuilds the live
   * voice sets + panners so a 1P->2P switch mid-session adds the P2 voice.
   * 1P -> 1 centered voice; 2P -> 2 voices panned left/right.
   */
  setHumanCount(n: number): void {
    const next = Math.max(1, n | 0);
    if (next === this.humanCount) return;
    this.humanCount = next;
    this.rebuildHumanVoices();
  }
  /**
   * Set the number of rival voices. Pre-resume records the count; post-resume
   * rebuilds the rival bank so a field rebuild that changes the rival count
   * (e.g. 1P 5 rivals -> 2P 4 rivals) re-creates the positional voices.
   */
  setRivalCount(n: number): void {
    const next = Math.max(0, n | 0);
    if (next === this.rivalCount) return;
    this.rivalCount = next;
    this.rebuildRivals();
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
      const g = buildGraph(ctx);
      this.master = g.master;
      this.sfxBus = g.sfxBus;
      this.musicBus = g.musicBus;
      this.compressor = g.compressor;
      this.persistent = startPersistentVoices(ctx, g.sfxBus, g.musicBus, {
        humanCount: this.humanCount,
        engine: this.engine,
        driftCfg: this.driftCfg,
        dw: this.dw,
        positional: this.positional,
        hrtf: this.hrtf,
        engineActive: this.engineActive,
        rivalCount: this.rivalCount,
        music: this.music,
        impact: this.impact,
      });
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
    if (!this.ctx || !this.persistent) return;
    const pv = this.persistent;
    const now = this.ctx.currentTime;
    let maxSpeed = 0;
    for (let i = 0; i < pv.voices.length; i++) {
      const s = states[i];
      if (!s) continue;
      pv.voices[i]!.update(this.ctx, now, s.speed, s.throttle, s.drifting);
      if (s.speed > maxSpeed) maxSpeed = s.speed;
    }
    driveWind(now, maxSpeed, pv.wind.gain, this.engine.maxSpeed, this.dw);
  }
  updateRivals(_dt: number, states: readonly RivalAudioState[], listener: ListenerTransform): void {
    if (!this.ctx || !this.persistent) return;
    this.persistent.rivals.update(this.ctx, this.ctx.currentTime, states, listener);
  }

  /**
   * Fire a transient UI beep. No-op until resume(). Each call creates an
   * oscillator+gain on demand, schedules an attack/decay envelope, stops the
   * osc at the end, and self-cleans via osc.onended -> disconnect (no leak).
   * 006 calls this from Countdown + menu hover/click handlers.
   */
  uiBeep(kind: "hover" | "click" | "beep" | "go"): void {
    if (!this.ctx || !this.sfxBus) return;
    playBeep(this.ctx, this.sfxBus, kind);
  }

  /**
   * Fire an intensity-tiered collision impact (009). force is a Rapier
   * totalForceMagnitude (already threshold/dedupe'd by routeImpacts in Game).
   * No-op until resume(). A single reused CollisionVoice plays the hit;
   * retriggers restart its envelope so a contact flurry never stacks.
   */
  triggerImpact(force: number): void {
    if (!this.ctx || !this.persistent) return;
    const now = this.ctx.currentTime;
    this.persistent.collision.trigger(this.ctx, now, impactTier(force, this.impact));
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
   * Set the music phase for the race (075). No-op until resume().
   * GameAudioDriver observes the game/race state each sub-step and calls this
   * only on phase transitions. Under jsdom the engine is a no-op.
   */
  setMusicPhase(phase: MusicPhase): void {
    if (!this.persistent) return;
    this.persistent.musicEngine.setPhase(phase);
  }

  /** Ramp the rain bed gain with the weather level (0..1 -> RAIN_GAIN). */
  setRainLevel(level: number): void {
    if (!this.ctx || !this.persistent) return;
    this.persistent.rain.setLevel(this.ctx, level, RAIN_GAIN);
  }

  /**
   * Ramp the weather-wind bed gain with the weather level (0..1 ->
   * WEATHER_WIND_GAIN). Driven for gale-force presets (sandstorm/blizzard/
   * storm); distinct from the car-speed wind voice (driveWind).
   */
  setWeatherWindLevel(level: number): void {
    if (!this.ctx || !this.persistent) return;
    this.persistent.weatherWind.setLevel(this.ctx, level, WEATHER_WIND_GAIN);
  }

  /**
   * Fire a transient thunder rumble (054 commit 4). No-op until resume().
   * Nodes created per call (voice indices stay stable); delegates to
   * playThunder (rainVoice.ts).
   */
  thunder(strength: number, delaySec: number): void {
    if (!this.ctx || !this.sfxBus || !this.persistent) return;
    playThunder(this.ctx, this.sfxBus, this.persistent.noise, strength, delaySec);
  }

  /**
   * Ramp the engine voice in (racing) or out (menu/countdown). Applies the
   * flag to every human voice + the rival bank; the flag is remembered so it
   * applies once voices exist (pre-resume) and to rebuilt voices.
   */
  setEngineActive(active: boolean): void {
    this.engineActive = active;
    if (this.ctx && this.persistent) {
      for (const v of this.persistent.voices) v.setActive(this.ctx, active);
      this.persistent.rivals.setActive(this.ctx, active);
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
    this.persistent?.rivals.setSpatial(on);
  }
  setHrtf(on: boolean): void {
    this.hrtf = on;
    this.persistent?.rivals.setHrtf(on);
  }

  /** Suspend the ctx (e.g. tab hidden). No-op if ctx null/not running. */
  suspend(): void {
    if (this.ctx && this.ctx.state === "running") void this.ctx.suspend();
  }

  /**
   * Mark audio as explicitly paused (GameFlow pause overlay). Suspends when
   * true, resumes when false. While true the visibility handler will not
   * auto-resume on tab return, so audio stays silent under the pause overlay.
   * No-op safe pre-resume.
   */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.suspend();
    else this.resume();
  }

  /** Stop everything, disconnect nodes, close the ctx. Idempotent. */
  dispose(): void {
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
    if (this.persistent) {
      stopPersistentVoices(this.persistent);
      this.persistent = null;
    }
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
      else if (this.gestured && !this.paused) this.resume();
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);
  }

  /**
   * Rebuild the per-human voices when humanCount changes post-resume. Keeps
   * the shared noise/wind/rain/music/collision; disposes the old voice sets +
   * panners and builds the new count into the existing sfx bus, then re-applies
   * the remembered engine gate. No-op before resume().
   */
  private rebuildHumanVoices(): void {
    if (!this.ctx || !this.persistent) return;
    const pv = this.persistent;
    stopHumanVoices(pv.voices, pv.panners);
    const built = buildHumanVoices(
      this.ctx,
      this.sfxBus!,
      pv.noise,
      this.humanCount,
      this.engine,
      this.driftCfg,
    );
    pv.voices = built.voices;
    pv.panners = built.panners;
    for (const v of pv.voices) v.setActive(this.ctx, this.engineActive);
  }

  /**
   * Rebuild the rival bank when rivalCount changes post-resume. Disposes the
   * old bank and builds a new one from the shared noise + engine config into
   * the existing sfx bus, then re-applies spatial/hrtf/engine gate. No-op
   * before resume().
   */
  private rebuildRivals(): void {
    if (!this.ctx || !this.persistent) return;
    const pv = this.persistent;
    pv.rivals.dispose();
    pv.rivals = new RivalVoiceBank(this.ctx, this.sfxBus!, pv.noise, this.engine, this.rivalCount);
    pv.rivals.setSpatial(this.positional);
    pv.rivals.setHrtf(this.hrtf);
    pv.rivals.setActive(this.ctx, this.engineActive);
  }
}
