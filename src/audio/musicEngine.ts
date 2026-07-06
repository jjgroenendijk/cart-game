/**
 * 075 procedural music engine. Replaces the 009 detuned-pad + arp bed with a
 * Tone.js-driven adaptive score: per-phase chord pad, bass, generative lead,
 * and a synthesized drum kit (kick/snare/hat), routed through the shared
 * musicBus so the music-volume slider + mute + compressor still apply.
 *
 * Zero asset files: every voice is a Tone synth (oscillator/noise based), so
 * the repo's zero-media policy is intact. Tone.js is a runtime dependency
 * (~80 KB gzip); it shares this AudioManager's AudioContext via setContext
 * (single owner) and its synths connect into the caller-supplied destination
 * GainNode rather than ctx.destination.
 *
 * Adaptive state: setPhase(phase) swaps the active Tone Sequences/Patterns +
 * ramps each voice gain + the Transport BPM. menu = ambient pad only;
 * countdown = tense pedal + building drums; racing = full kit + bass + lead;
 * finished = triumphant major cadence.
 *
 * Graceful degrade: jsdom's MockAudioContext is too thin for Tone (its params
 * are not real AudioParam instances, and Tone's standardized-audio-context
 * validates that at construction, leaving a stray node on each failed build).
 * supportsTone() probes createConstantSource (present on real AudioContext,
 * absent on the mock) so the engine builds ZERO nodes and no-ops under jsdom,
 * keeping the load-bearing voice node indices stable. In a real browser with
 * an unsupported AudioContext the constructor's try/catch also degrades to a
 * silent no-op so the game stays playable.
 *
 * Pure exports: musicPhaseFor (game/race state -> phase), PHASE_CONFIG (the
 * per-phase note arrays + gains, asserted by the engine test).
 */

import {
  setContext,
  getTransport,
  MembraneSynth,
  MetalSynth,
  NoiseSynth,
  PolySynth,
  MonoSynth,
  AMSynth,
  Reverb,
  FeedbackDelay,
  Sequence,
  Pattern,
  Gain,
} from "tone";

/** Tone Pattern generator names (mirrors tone's PatternGenerator union). */
type PatternName =
  | "up"
  | "down"
  | "upDown"
  | "downUp"
  | "alternateUp"
  | "alternateDown"
  | "random"
  | "randomOnce"
  | "randomWalk";

export type MusicPhase = "menu" | "countdown" | "racing" | "finished";

/** Engine tuning. The musicBus already owns the user-facing volume slider. */
export interface MusicOptions {
  /** Engine bus trim feeding musicBus (0..1). Default 0.5. */
  gain: number;
}

export const DEFAULT_MUSIC: MusicOptions = { gain: 0.5 };

/**
 * Map the game/race state to a music phase. Pure. racing + race finished ->
 * finished; otherwise follow the game state. Used by GameAudioDriver so Game
 * needs no music hooks (the phase is observed each sub-step inside flush).
 */
export function musicPhaseFor(gameState: string, racePhase: string): MusicPhase {
  if (gameState === "countdown") return "countdown";
  if (gameState === "racing") return racePhase === "finished" ? "finished" : "racing";
  return "menu";
}

/** A2 root (110 Hz) keeps continuity with the 009 bed's pitch centre. */
const ROOT_HZ = 110;

// Chord voicings (A minor context); roots sit an octave below for the bass.
const AM = ["A3", "C4", "E4"];
const FM = ["F3", "A3", "C4"];
const CM = ["C4", "E4", "G4"];
const GM = ["G3", "B3", "D4"];
/** Suspended, tense Am colour for the countdown build. */
const AMSUS = ["A3", "D4", "E4", "G4"];

/** A-minor pentatonic lead pool (algorithmic Pattern source). */
const LEAD_POOL = ["A4", "C5", "D5", "E5", "G5", "A5"];
/** Resolving major-pentatonic pool for the finished fanfare. */
const FINISH_POOL = ["C5", "D5", "E5", "G5", "A5", "C6"];

/** Repeat a note across n grid slots (four-on-floor kick, steady hat). */
function repeat(n: number, note: string): (string | null)[] {
  return Array.from({ length: n }, () => note);
}

/** Offbeat mask: note on odd slots (snare on 2 + 4). */
function offbeat(slots: number, note: string): (string | null)[] {
  const grid: (string | null)[] = Array.from({ length: slots }, () => null);
  for (let i = 1; i < slots; i += 2) grid[i] = note;
  return grid;
}

/** Per-phase score data. Pure; the engine test asserts its shape + invariants. */
export interface PhaseConfig {
  /** Transport BPM. */
  bpm: number;
  /** Pad chord events, one per measure (Sequence loops the array). */
  chords: string[][];
  /** Pad note duration (Tone transport time, e.g. "1m"). */
  padDur: string;
  /** Bass 8th-note grid; null = rest. Empty array disables bass. */
  bass: (string | null)[];
  /** Lead note pool; empty disables the lead. */
  lead: string[];
  /** Lead Pattern generator + subdivision. */
  leadType: PatternName;
  leadSub: string;
  /** Kick quarter-note grid; empty disables kick. */
  kick: (string | null)[];
  /** Snare 8th-note grid; empty disables snare. */
  snare: (string | null)[];
  /** Hat 16th-note grid; empty disables hat. */
  hat: (string | null)[];
  /** Target voice gains (0 = silent). Pad never fully 0 except finished fade. */
  pad: number;
  bassGain: number;
  leadGain: number;
  drumGain: number;
  hatGain: number;
}

const KICK = "C1";
const HAT = "C6";
const SNARE = "x";

export const PHASE_CONFIG: Record<MusicPhase, PhaseConfig> = {
  menu: {
    bpm: 80,
    chords: [AM, AM, AM, AM, FM, FM, FM, FM, CM, CM, CM, CM, GM, GM, GM, GM],
    padDur: "1m",
    bass: [],
    lead: [],
    leadType: "up",
    leadSub: "1m",
    kick: [],
    snare: [],
    hat: [],
    pad: 0.12,
    bassGain: 0,
    leadGain: 0,
    drumGain: 0,
    hatGain: 0,
  },
  countdown: {
    bpm: 100,
    chords: [AMSUS],
    padDur: "1m",
    bass: [ROOT_HZ / 2 + "", null, ROOT_HZ / 2 + "", null],
    lead: [],
    leadType: "up",
    leadSub: "1m",
    kick: [KICK, null, null, null],
    snare: [],
    hat: offbeat(8, HAT),
    pad: 0.16,
    bassGain: 0.14,
    leadGain: 0,
    drumGain: 0.18,
    hatGain: 0.05,
  },
  racing: {
    bpm: 140,
    chords: [AM, FM, CM, GM],
    padDur: "1m",
    bass: [ROOT_HZ + "", null, null, ROOT_HZ + "", null, ROOT_HZ + "", null, null],
    lead: LEAD_POOL,
    leadType: "alternateUp",
    leadSub: "8n",
    kick: repeat(4, KICK),
    snare: offbeat(8, SNARE),
    hat: repeat(16, HAT),
    pad: 0.14,
    bassGain: 0.18,
    leadGain: 0.1,
    drumGain: 0.22,
    hatGain: 0.05,
  },
  finished: {
    bpm: 110,
    chords: [CM, FM, GM, CM],
    padDur: "2m",
    bass: [ROOT_HZ + "", null, ROOT_HZ + "", null],
    lead: FINISH_POOL,
    leadType: "up",
    leadSub: "4n",
    kick: [KICK, null, KICK, null],
    snare: [],
    hat: [],
    pad: 0.13,
    bassGain: 0.12,
    leadGain: 0.1,
    drumGain: 0.14,
    hatGain: 0,
  },
};

/** Ramp time for voice-gain transitions between phases (no hard clicks). */
const GAIN_TAU = 0.6;

/** Disposable scheduled part (Sequence or Pattern). */
interface Part {
  start(at: number): unknown;
  stop(): unknown;
  dispose(): unknown;
}

/**
 * True only when the context can host Tone (real AudioContext). The jsdom
 * MockAudioContext lacks createConstantSource, and constructing any Tone node
 * against it throws after leaking a stray gain, so we probe the capability
 * rather than try/catch a build (which would pollute the mock node arrays and
 * shift the load-bearing voice indices).
 */
function supportsTone(ctx: AudioContext): boolean {
  return typeof (ctx as { createConstantSource?: unknown }).createConstantSource === "function";
}

export class MusicEngine {
  private readonly destination: AudioNode;
  private readonly opts: MusicOptions;
  private ok = false;
  private started = false;

  private bus: Gain | null = null;
  private padGain: Gain | null = null;
  private bassGain: Gain | null = null;
  private leadGain: Gain | null = null;
  private drumGain: Gain | null = null;
  private hatGain: Gain | null = null;
  private pad: PolySynth | null = null;
  private bass: MonoSynth | null = null;
  private lead: MonoSynth | null = null;
  private kick: MembraneSynth | null = null;
  private snare: NoiseSynth | null = null;
  private hat: MetalSynth | null = null;
  private reverb: Reverb | null = null;
  private delay: FeedbackDelay | null = null;
  private parts: Part[] = [];
  private phase: MusicPhase = "menu";

  constructor(ctx: AudioContext, destination: AudioNode, opts: MusicOptions = DEFAULT_MUSIC) {
    this.destination = destination;
    this.opts = opts;
    if (!supportsTone(ctx)) return;
    try {
      setContext(ctx);
      this.buildGraph();
      // applyGains ramps the menu voice gains from their 0 init to the menu
      // targets (a bare buildPhase leaves them silent). The Transport +
      // Sequences follow the canonical Tone pattern (schedule then start).
      this.phase = "menu";
      this.applyGains("menu");
      this.buildPhase("menu");
      getTransport().start();
      this.started = true;
      this.ok = true;
    } catch {
      this.teardown();
      this.ok = false;
    }
  }

  /** True when the Tone graph built (false under jsdom / unsupported audio). */
  get isOk(): boolean {
    return this.ok;
  }

  private buildGraph(): void {
    this.bus = new Gain(this.opts.gain);
    this.bus.connect(this.destination);

    this.reverb = new Reverb({ decay: 4, wet: 0.4 });
    void this.reverb.generate();
    this.delay = new FeedbackDelay({
      delayTime: "8n",
      feedback: 0.25,
      wet: 0.2,
    });

    this.padGain = new Gain(0);
    this.bassGain = new Gain(0);
    this.leadGain = new Gain(0);
    this.drumGain = new Gain(0);
    this.hatGain = new Gain(0);

    this.pad = new PolySynth(AMSynth, {
      envelope: { attack: 0.6, decay: 0.4, sustain: 0.6, release: 1.5 },
    });
    this.bass = new MonoSynth({
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.02, decay: 0.2, sustain: 0.5, release: 0.4 },
      filterEnvelope: { attack: 0.02, decay: 0.2, sustain: 0.4, release: 0.4 },
    });
    this.lead = new MonoSynth({
      oscillator: { type: "square" },
      envelope: { attack: 0.01, decay: 0.15, sustain: 0.3, release: 0.2 },
    });
    this.kick = new MembraneSynth();
    this.snare = new NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.2, sustain: 0 },
    });
    this.hat = new MetalSynth({
      envelope: { attack: 0.001, decay: 0.05, release: 0.01 },
      harmonicity: 5.1,
      modulationIndex: 32,
      resonance: 4000,
      octaves: 1.5,
    });

    this.pad.connect(this.padGain);
    this.padGain.connect(this.reverb);
    this.reverb.connect(this.bus);
    this.bass.connect(this.bassGain);
    this.bassGain.connect(this.bus);
    this.lead.connect(this.leadGain);
    this.leadGain.connect(this.delay);
    this.delay.connect(this.bus);
    this.kick.connect(this.drumGain);
    this.snare.connect(this.drumGain);
    this.drumGain.connect(this.bus);
    this.hat.connect(this.hatGain);
    this.hatGain.connect(this.bus);
  }

  /** Swap the active sequences + ramp gains + BPM for a new phase. */
  setPhase(phase: MusicPhase): void {
    if (!this.ok) return;
    if (phase === this.phase && this.parts.length > 0) return;
    this.disposeParts();
    this.phase = phase;
    this.applyGains(phase);
    this.buildPhase(phase);
  }

  /** Ramp BPM + every voice gain to the phase targets. */
  private applyGains(phase: MusicPhase): void {
    const cfg = PHASE_CONFIG[phase];
    getTransport().bpm.rampTo(cfg.bpm, GAIN_TAU);
    this.rampVoice(this.padGain, cfg.pad);
    this.rampVoice(this.bassGain, cfg.bassGain);
    this.rampVoice(this.leadGain, cfg.leadGain);
    this.rampVoice(this.drumGain, cfg.drumGain);
    this.rampVoice(this.hatGain, cfg.hatGain);
  }

  private rampVoice(gain: Gain | null, target: number): void {
    gain?.gain.rampTo(target, GAIN_TAU);
  }

  private buildPhase(phase: MusicPhase): void {
    const cfg = PHASE_CONFIG[phase];
    if (cfg.chords.length > 0 && this.pad) {
      const pad = this.pad;
      const chords = cfg.chords;
      // Flat index events, not the chord arrays: Tone Sequence subdivides
      // nested arrays, passing each NOTE string to the callback (not the
      // chord), so a chord gate would never fire. Indices yield one callback
      // per subdivision; the full chord is looked up here.
      const indices = chords.map((_, i) => i);
      const seq = new Sequence(
        (time, i) => {
          const chord = chords[(i as number) % chords.length]!;
          pad.triggerAttackRelease(chord, cfg.padDur, time);
        },
        indices,
        "1m",
      );
      seq.start(0);
      this.parts.push(seq);
    }
    if (cfg.bass.length > 0 && this.bass) {
      const bass = this.bass;
      const seq = new Sequence(
        (time, note) => {
          if (note) bass.triggerAttackRelease(note as string, "8n", time);
        },
        cfg.bass,
        "8n",
      );
      seq.start(0);
      this.parts.push(seq);
    }
    if (cfg.lead.length > 0 && this.lead) {
      const lead = this.lead;
      const pat = new Pattern(
        (time, note) => {
          lead.triggerAttackRelease(note as string, cfg.leadSub === "4n" ? "8n" : "16n", time);
        },
        cfg.lead,
        cfg.leadType,
      );
      pat.interval = cfg.leadSub;
      pat.start(0);
      this.parts.push(pat);
    }
    if (cfg.kick.length > 0 && this.kick) {
      const kick = this.kick;
      const seq = new Sequence(
        (time, note) => {
          if (note) kick.triggerAttackRelease(note as string, "8n", time);
        },
        cfg.kick,
        "4n",
      );
      seq.start(0);
      this.parts.push(seq);
    }
    if (cfg.snare.length > 0 && this.snare) {
      const snare = this.snare;
      const seq = new Sequence(
        (time, note) => {
          if (note) snare.triggerAttackRelease("8n", time);
        },
        cfg.snare,
        "8n",
      );
      seq.start(0);
      this.parts.push(seq);
    }
    if (cfg.hat.length > 0 && this.hat) {
      const hat = this.hat;
      const seq = new Sequence(
        (time, note) => {
          if (note) hat.triggerAttackRelease("C5", "32n", time, 0.3);
        },
        cfg.hat,
        "16n",
      );
      seq.start(0);
      this.parts.push(seq);
    }
  }

  private disposeParts(): void {
    for (const p of this.parts) {
      try {
        p.stop();
      } catch {
        // Already stopped.
      }
      p.dispose();
    }
    this.parts = [];
  }

  /** Stop + disconnect everything. Idempotent. */
  dispose(): void {
    if (!this.ok) return;
    this.teardown();
    this.ok = false;
  }

  private teardown(): void {
    this.disposeParts();
    const nodes = [this.hat, this.snare, this.kick, this.lead, this.bass, this.pad];
    for (const n of nodes) {
      try {
        n?.dispose();
      } catch {
        // Already disposed.
      }
    }
    const gains = [this.hatGain, this.drumGain, this.leadGain, this.bassGain, this.padGain];
    for (const g of gains) {
      try {
        g?.dispose();
      } catch {
        // Already disposed.
      }
    }
    for (const fx of [this.delay, this.reverb]) {
      try {
        fx?.dispose();
      } catch {
        // Already disposed.
      }
    }
    try {
      this.bus?.dispose();
    } catch {
      // Already disposed.
    }
    this.pad = this.bass = this.lead = this.kick = this.snare = this.hat = null;
    this.padGain = this.bassGain = this.leadGain = this.drumGain = this.hatGain = null;
    this.reverb = this.delay = null;
    this.bus = null;
    if (this.started) {
      try {
        getTransport().stop();
      } catch {
        // Transport already stopped.
      }
      this.started = false;
    }
  }
}
