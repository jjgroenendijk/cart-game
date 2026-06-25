/**
 * 015 positional rival audio. Manual doppler + PannerNode spatialization for
 * non-human (rival) sources. PannerNode/AudioListener built-in doppler is
 * deprecated in modern browsers -> doppler is computed here as a pure freq
 * multiplier applied to the rival engine osc frequency. Rivals get ENGINE
 * only (no drift; non-goal of 015). Each PositionalVoice is a 3-saw + sub-sine
 * synth mirroring voiceSet.ts, routed through its own PannerNode -> caller dest
 * (sfxBus). RivalVoiceBank owns N voices + drives ctx.listener pos/forward/up.
 *
 * Pure helpers (dopplerShift, pannerDefaults) are side-effect free; the Web
 * Audio node graph is exercised via mockAudioContext under jsdom.
 */

import { clamp, lerp, type Vec3 } from "../core/math";
import { engineCurve } from "./engineCurve";
import type { EngineVoiceConfig } from "./voiceSet";

/** Detune offsets (cents) for the 3 detuned engine saws. */
const ENGINE_DETUNES = [-12, 0, 12];

/** Per-frame rival state fed to PositionalVoice.update. */
export interface RivalAudioState {
  pos: Vec3;
  vel: Vec3;
  speed: number;
  throttle: number;
  drifting: boolean;
}

/** Listener (human midpoint) transform fed to RivalVoiceBank.update. */
export interface ListenerTransform {
  pos: Vec3;
  forward: Vec3;
  vel: Vec3;
}

/** Doppler tuning; unset fields resolve to the 015 Defaults. */
export interface DopplerOptions {
  speedOfSound?: number;
  factor?: number;
  min?: number;
  max?: number;
}

const DOPPLER_DEFAULTS = {
  speedOfSound: 343,
  factor: 1,
  min: 0.5,
  max: 2,
};

/**
 * Manual doppler freq multiplier from source/listener pos + vel. dir =
 * (lisPos - srcPos)/dist; vRel = (srcVel - lisVel) . dir (>0 = approaching).
 * mult = c / (c - factor*vRel): approach -> denominator shrinks -> mult>1 ->
 * pitch up; recede -> mult<1. Returns 1 when dist~0 (coincident, dir undefined).
 * Pure + deterministic; clamps to [min, max].
 */
export function dopplerShift(
  srcPos: Vec3,
  srcVel: Vec3,
  lisPos: Vec3,
  lisVel: Vec3,
  opts?: DopplerOptions,
): number {
  const o = { ...DOPPLER_DEFAULTS, ...opts };
  const dx = lisPos.x - srcPos.x;
  const dy = lisPos.y - srcPos.y;
  const dz = lisPos.z - srcPos.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-4) return 1;
  const inv = 1 / dist;
  const vRel =
    (srcVel.x - lisVel.x) * (dx * inv) +
    (srcVel.y - lisVel.y) * (dy * inv) +
    (srcVel.z - lisVel.z) * (dz * inv);
  const mult = o.speedOfSound / (o.speedOfSound - o.factor * vRel);
  return clamp(mult, o.min, o.max);
}

/**
 * PannerNode defaults for rival voices (015 Defaults). equalpower keeps cost
 * low (HRTF is opt-in via setHrtf); inverse distance, refDistance 5m,
 * maxDistance 120m fades far-straight rivals on the ~377m loop.
 */
export function pannerDefaults(): {
  panningModel: PanningModelType;
  distanceModel: DistanceModelType;
  refDistance: number;
  maxDistance: number;
  rolloffFactor: number;
} {
  return {
    panningModel: "equalpower",
    distanceModel: "inverse",
    refDistance: 5,
    maxDistance: 120,
    rolloffFactor: 1,
  };
}

/**
 * One rival's positional engine voice. 3 detuned saws + sub sine -> lowpass ->
 * engineGain -> PannerNode -> caller dest. update() sets panner pos, computes
 * doppler, ramps osc freq*mult + gain/cutoff. spatial=false pins the panner to
 * the listener (centered, no doppler) so rivals stay audible but unspatialized;
 * setActive(false) gates gain to 0 (menu/countdown silence).
 */
export class PositionalVoice {
  private readonly engine: EngineVoiceConfig;
  private readonly panner: PannerNode;
  private readonly hasPositionX: boolean;
  private engineOscs: OscillatorNode[] = [];
  private engineSub: OscillatorNode | null = null;
  private engineLowpass: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private engineActive = true;
  private engineLastGain: number;
  private dopplerMult = 1;
  private spatial = true;

  constructor(ctx: AudioContext, dest: AudioNode, _noise: AudioBuffer, engine: EngineVoiceConfig) {
    this.engine = engine;
    this.engineLastGain = engine.idleGain;

    const panner = ctx.createPanner();
    const d = pannerDefaults();
    panner.panningModel = d.panningModel;
    panner.distanceModel = d.distanceModel;
    panner.refDistance = d.refDistance;
    panner.maxDistance = d.maxDistance;
    panner.rolloffFactor = d.rolloffFactor;
    panner.connect(dest);
    this.panner = panner;
    this.hasPositionX = "positionX" in panner;

    this.buildEngine(ctx);
  }

  /** Build engine: 3 detuned saws + sub sine -> lowpass -> gain -> panner. */
  private buildEngine(ctx: AudioContext): void {
    const e = this.engine;
    this.engineLowpass = ctx.createBiquadFilter();
    this.engineLowpass.type = "lowpass";
    this.engineLowpass.frequency.value = e.lowpassIdle;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineLowpass.connect(this.engineGain);
    this.engineGain.connect(this.panner);

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

  /**
   * spatial off -> pin panner to listener.pos (centered) + doppler mult 1.
   * spatial on -> doppler mult recomputed each update.
   */
  setSpatial(ctx: AudioContext, on: boolean, listener?: ListenerTransform): void {
    this.spatial = on;
    if (!on) {
      this.dopplerMult = 1;
      if (listener) this.writePannerPosition(ctx.currentTime, listener.pos);
    }
  }

  /** Swap panningModel (equalpower default; HRTF opt-in). */
  setHrtf(_ctx: AudioContext, on: boolean): void {
    this.panner.panningModel = on ? "HRTF" : "equalpower";
  }

  /** Gate engine gain (false -> 0; true -> last curve gain). */
  setActive(ctx: AudioContext, active: boolean, now?: number): void {
    this.engineActive = active;
    this.applyEngineGain(ctx, now);
  }

  /**
   * Drive panner pos + doppler + engine freq/gain/cutoff from the per-frame
   * rival state. spatial on -> panner at state.pos + doppler from relative
   * radial vel; spatial off -> panner pinned to listener + mult 1.
   */
  update(
    ctx: AudioContext,
    now: number,
    state: RivalAudioState,
    listener: ListenerTransform,
  ): void {
    if (this.spatial) {
      this.writePannerPosition(now, state.pos);
      this.dopplerMult = dopplerShift(state.pos, state.vel, listener.pos, listener.vel);
    } else {
      this.writePannerPosition(now, listener.pos);
      this.dopplerMult = 1;
    }

    const e = this.engine;
    const out = engineCurve(
      { speed: state.speed, maxSpeed: e.maxSpeed, throttle: state.throttle },
      e,
    );
    this.engineLastGain = out.gain;
    const freq = out.freq * this.dopplerMult;
    const tau = e.tau;
    for (const osc of this.engineOscs) {
      osc.frequency.setTargetAtTime(freq, now, tau);
    }
    this.engineSub?.frequency.setTargetAtTime(freq / 2, now, tau);
    const speed01 = e.maxSpeed > 0 ? clamp(state.speed / e.maxSpeed, 0, 1) : 0;
    const cutoff = lerp(e.lowpassIdle, e.lowpassTop, speed01);
    this.engineLowpass?.frequency.setTargetAtTime(cutoff, now, tau);
    this.applyEngineGain(ctx, now);
  }

  private writePannerPosition(now: number, pos: Vec3): void {
    if (this.hasPositionX) {
      this.panner.positionX.setValueAtTime(pos.x, now);
      this.panner.positionY.setValueAtTime(pos.y, now);
      this.panner.positionZ.setValueAtTime(pos.z, now);
    } else {
      (this.panner as PannerNode & LegacyPannerPosition).setPosition?.(pos.x, pos.y, pos.z);
    }
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
  }

  /** Disconnect every node (graph teardown). Sources stop()'d first. */
  dispose(): void {
    this.engineLowpass?.disconnect();
    this.engineGain?.disconnect();
    this.panner.disconnect();
    this.engineLowpass = null;
    this.engineGain = null;
  }
}

/**
 * N rival voices + ctx.listener driver. Owns one PositionalVoice per rival;
 * update() writes the listener transform (pos/forward/up = (0,1,0)) then each
 * voice. setSpatial/setHrtf delegate to every voice; setActive gates the bank.
 */
export class RivalVoiceBank {
  private readonly ctx: AudioContext;
  private readonly voices: PositionalVoice[] = [];
  private readonly hasListenerPositionX: boolean;
  private readonly defaultListener: ListenerTransform = {
    pos: { x: 0, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: -1 },
    vel: { x: 0, y: 0, z: 0 },
  };

  constructor(
    ctx: AudioContext,
    dest: AudioNode,
    noise: AudioBuffer,
    engine: EngineVoiceConfig,
    count: number,
  ) {
    this.ctx = ctx;
    this.hasListenerPositionX = "positionX" in ctx.listener;
    for (let i = 0; i < count; i++) {
      this.voices.push(new PositionalVoice(ctx, dest, noise, engine));
    }
  }

  /** Delegate spatial on/off to every voice (default listener at origin). */
  setSpatial(on: boolean, listener?: ListenerTransform): void {
    const lis = listener ?? this.defaultListener;
    for (const v of this.voices) v.setSpatial(this.ctx, on, lis);
  }

  /** Delegate panningModel swap to every voice. */
  setHrtf(on: boolean): void {
    for (const v of this.voices) v.setHrtf(this.ctx, on);
  }

  /** Gate every voice (false -> silent; true -> restored). */
  setActive(ctx: AudioContext, active: boolean, now?: number): void {
    for (const v of this.voices) v.setActive(ctx, active, now);
  }

  /**
   * Write ctx.listener (pos + forward + up=(0,1,0)) then drive each voice with
   * its state. Feature-detects positionX vs deprecated setPosition.
   */
  update(
    ctx: AudioContext,
    now: number,
    states: readonly RivalAudioState[],
    listener: ListenerTransform,
  ): void {
    const lis = ctx.listener;
    if (this.hasListenerPositionX) {
      lis.positionX.setValueAtTime(listener.pos.x, now);
      lis.positionY.setValueAtTime(listener.pos.y, now);
      lis.positionZ.setValueAtTime(listener.pos.z, now);
      lis.forwardX.setValueAtTime(listener.forward.x, now);
      lis.forwardY.setValueAtTime(listener.forward.y, now);
      lis.forwardZ.setValueAtTime(listener.forward.z, now);
      lis.upX.setValueAtTime(0, now);
      lis.upY.setValueAtTime(1, now);
      lis.upZ.setValueAtTime(0, now);
    } else {
      const legacy = lis as AudioListener & LegacyListener;
      legacy.setPosition?.(listener.pos.x, listener.pos.y, listener.pos.z);
      legacy.setOrientation?.(listener.forward.x, listener.forward.y, listener.forward.z, 0, 1, 0);
    }
    const n = Math.min(this.voices.length, states.length);
    for (let i = 0; i < n; i++) {
      this.voices[i]!.update(ctx, now, states[i]!, listener);
    }
  }

  /** Stop every voice's sources. */
  stop(): void {
    for (const v of this.voices) v.stop();
  }

  /** Stop + disconnect every voice (graph teardown). */
  dispose(): void {
    for (const v of this.voices) {
      v.stop();
      v.dispose();
    }
  }
}

/** Deprecated PannerNode position API (old Safari); feature-detected fallback. */
interface LegacyPannerPosition {
  setPosition?(x: number, y: number, z: number): void;
}

/** Deprecated AudioListener pose API (old Safari); feature-detected fallback. */
interface LegacyListener {
  setPosition?(x: number, y: number, z: number): void;
  setOrientation?(fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void;
}

function stopSource(src: { stop?: () => void } | null): void {
  if (!src) return;
  try {
    src.stop?.();
  } catch {
    // Already stopped; ignore.
  }
}
