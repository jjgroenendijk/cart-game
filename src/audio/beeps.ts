/**
 * 005 UI beep table + one-shot player. Pure: playBeep synthesizes a short
 * osc+gain envelope into the caller's sfx bus and self-cleans via osc.onended
 * (no node leak). Extracted from AudioManager (046) so the beep tuning table
 * lives apart from the graph/lifecycle code.
 */

export type BeepKind = "hover" | "click" | "beep" | "go";

interface BeepDef {
  type: OscillatorType;
  freq: number;
  dur: number;
  peak: number;
}

/** UI beep kinds -> {type, freq, dur(s), peak}. Tuned per 005 Defaults. */
const BEEP_DEFS: Record<BeepKind, BeepDef> = {
  hover: { type: "sine", freq: 880, dur: 0.06, peak: 0.12 },
  click: { type: "triangle", freq: 520, dur: 0.09, peak: 0.16 },
  beep: { type: "sine", freq: 660, dur: 0.16, peak: 0.22 },
  go: { type: "sine", freq: 990, dur: 0.42, peak: 0.26 },
};

/**
 * Fire a transient UI beep. Creates an osc+gain on demand, schedules an
 * attack/decay envelope, stops the osc at the end, and self-cleans via
 * osc.onended -> disconnect (no leak). Caller guards the pre-resume no-op.
 */
export function playBeep(ctx: AudioContext, sfxBus: GainNode, kind: BeepKind): void {
  const def = BEEP_DEFS[kind];
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = def.type;
  osc.frequency.setValueAtTime(def.freq, now);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(def.peak, now + def.dur * 0.1);
  gain.gain.linearRampToValueAtTime(0, now + def.dur);
  osc.connect(gain);
  gain.connect(sfxBus);
  osc.start(now);
  osc.stop(now + def.dur);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}
