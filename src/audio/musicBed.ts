/**
 * 009 procedural music bed. Zero asset files: a sustained detuned-saw pad
 * (-> lowpass -> gain) plus an arpeggiator that schedules short triangle notes
 * on a ctx-time lookahead timer (NOT rAF, so it survives frame drops). Both
 * feed a music bus gain into the caller's destination (AudioManager master),
 * sitting under the master/compressor graph.
 *
 * setState ramps pad/arp gains + tempo per the race phase (menu/countdown =
 * soft pad build, racing = full pad + arp, finished = fade). The arp only
 * schedules notes while its gain is > 0, so the menu/countdown bed is pad-only.
 *
 * Pure: musicStateFor(phase) -> MusicState and nextArpNote(step) -> {freq,dur}.
 * MusicBed is pure-ish (Web Audio + a setInterval); the mock ctx exercises the
 * build/setState/schedule/stop/dispose paths under jsdom with fake timers.
 */

export type MusicPhase = "menu" | "countdown" | "racing" | "finished";

export interface MusicState {
  /** Pad bus target gain. */
  pad: number;
  /** Arp bus target gain (>0 enables the scheduler). */
  arp: number;
  /** Tempo (BPM) -> note duration. */
  tempo: number;
}

export interface MusicOptions {
  /** Full-racing pad gain. */
  padGain: number;
  /** Full-racing arp gain. */
  arpGain: number;
  /** Arp root frequency (Hz). */
  rootHz: number;
  /** Semitone offsets from root forming the arp scale (cycled). */
  scale: number[];
  /** Racing tempo (BPM). */
  tempo: number;
}

export const DEFAULT_MUSIC: MusicOptions = {
  padGain: 0.05,
  arpGain: 0.06,
  rootHz: 110,
  scale: [0, 3, 5, 7, 10],
  tempo: 120,
};

const PAD_DETUNES = [-7, 0, 7];
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;
const TAU = 0.1;
const ARP_PEAK = 1.0;
const PAD_LOWPASS = 800;

/**
 * Derive the music state for a race phase. Pure. menu/countdown = pad-only
 * build (arp silent); racing = full pad + arp; finished = fade to silence.
 */
export function musicStateFor(phase: MusicPhase, opts: MusicOptions = DEFAULT_MUSIC): MusicState {
  switch (phase) {
    case "menu":
      return { pad: opts.padGain * 0.4, arp: 0, tempo: 90 };
    case "countdown":
      return { pad: opts.padGain * 0.6, arp: 0, tempo: 100 };
    case "racing":
      return { pad: opts.padGain, arp: opts.arpGain, tempo: opts.tempo };
    case "finished":
      return { pad: 0, arp: 0, tempo: opts.tempo };
  }
}

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

/**
 * Next arp note for a sequencer step. Pure, deterministic: cycles the scale,
 * alternating octave every full cycle for melodic movement. Returns the freq
 * + duration (eighth note at the racing tempo).
 */
export function nextArpNote(
  step: number,
  opts: MusicOptions = DEFAULT_MUSIC,
): { freq: number; dur: number } {
  const scale = opts.scale;
  const degree = scale[Math.abs(step) % scale.length]!;
  const octave = Math.floor(Math.abs(step) / scale.length) % 2;
  const semis = degree + 12 * octave;
  const freq = opts.rootHz * Math.pow(2, semis / 12);
  const dur = 60 / opts.tempo / 2; // eighth notes
  return { freq, dur };
}

export class MusicBed {
  private readonly ctx: AudioContext;
  private readonly opts: MusicOptions;
  private readonly bus: GainNode;
  private readonly padLow: BiquadFilterNode;
  private readonly padGain: GainNode;
  private readonly pads: OscillatorNode[] = [];
  private readonly arpGain: GainNode;
  private tempo: number;
  private arpLevel = 0;
  private nextNoteTime = 0;
  private step = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: AudioContext, destination: AudioNode, opts: MusicOptions = DEFAULT_MUSIC) {
    this.ctx = ctx;
    this.opts = opts;
    this.tempo = opts.tempo;

    this.bus = ctx.createGain();
    this.bus.gain.value = 1;
    this.bus.connect(destination);

    this.padLow = ctx.createBiquadFilter();
    this.padLow.type = "lowpass";
    this.padLow.frequency.value = PAD_LOWPASS;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    this.padLow.connect(this.padGain);
    this.padGain.connect(this.bus);
    for (const detune of PAD_DETUNES) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = opts.rootHz;
      osc.detune.value = detune;
      osc.connect(this.padLow);
      osc.start();
      this.pads.push(osc);
    }

    this.arpGain = ctx.createGain();
    this.arpGain.gain.value = 0;
    this.arpGain.connect(this.bus);

    this.nextNoteTime = ctx.currentTime;
    this.applyState(musicStateFor("menu", opts));
    this.timer = setInterval(this.pump, LOOKAHEAD_MS);
  }

  /** Ramp pad/arp gains + tempo for a new state. */
  setState(state: MusicState): void {
    this.applyState(state);
  }

  private applyState(state: MusicState): void {
    const now = this.ctx.currentTime;
    this.tempo = state.tempo;
    this.padGain.gain.setTargetAtTime(state.pad, now, TAU);
    this.arpGain.gain.setTargetAtTime(state.arp, now, TAU);
    this.arpLevel = state.arp;
  }

  /** Lookahead scheduler: schedule arp notes up to SCHEDULE_AHEAD ahead. */
  private pump = (): void => {
    const now = this.ctx.currentTime;
    if (this.arpLevel <= 0) {
      this.nextNoteTime = now;
      this.step = 0;
      return;
    }
    const horizon = now + SCHEDULE_AHEAD;
    while (this.nextNoteTime < horizon) {
      const note = nextArpNote(this.step, { ...this.opts, tempo: this.tempo });
      this.scheduleNote(this.nextNoteTime, note.freq, note.dur);
      this.nextNoteTime += note.dur;
      this.step++;
    }
  };

  private scheduleNote(time: number, freq: number, dur: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, time);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(ARP_PEAK, time + 0.008);
    g.gain.linearRampToValueAtTime(0, time + dur);
    osc.connect(g);
    g.connect(this.arpGain);
    osc.start(time);
    osc.stop(time + dur);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  }

  /** Stop the scheduler + pad sources (idempotent). */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const o of this.pads) {
      stopSource(o);
      o.disconnect();
    }
    this.pads.length = 0;
  }

  /** Disconnect the graph. stop() should be called first. */
  dispose(): void {
    this.stop();
    this.padLow.disconnect();
    this.padGain.disconnect();
    this.arpGain.disconnect();
    this.bus.disconnect();
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
