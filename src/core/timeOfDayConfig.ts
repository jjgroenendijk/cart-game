/**
 * 042 pure time-of-day config. Owns the mode/phase/speed presets, the
 * phase->cycleT map (mirrors dayCycle.ts fractions: 0 dawn, 0.25 noon, 0.5
 * dusk, 0.75 night), and validateTimeOfDayConfig, which normalizes any input
 * into a safe TimeOfDayConfig (bad fields fall back to defaults, never
 * throws). timeOfDayToEnvParams maps a config to the DynamicSky setter
 * params Environment.setTimeOfDay consumes. Pure (no DOM, no localStorage);
 * timeOfDayStorage.ts persists it. Mirrors the settings/kartSelection split.
 */

export type TimeOfDayMode = "static" | "dynamic";
export type TimeOfDayPhase = "dawn" | "morning" | "noon" | "afternoon" | "dusk" | "night";

export interface TimeOfDayConfig {
  mode: TimeOfDayMode;
  phase: TimeOfDayPhase;
  dayLengthSeconds: number;
}

export const PHASE_TO_CYCLE_T: Record<TimeOfDayPhase, number> = {
  dawn: 0,
  morning: 0.12,
  noon: 0.25,
  afternoon: 0.38,
  dusk: 0.5,
  night: 0.75,
};

export const SPEED_PRESETS = { slow: 240, normal: 120, fast: 60 } as const;
export type TimeOfDaySpeed = keyof typeof SPEED_PRESETS;

export const DEFAULT_TIME_OF_DAY: TimeOfDayConfig = {
  mode: "dynamic",
  phase: "morning",
  dayLengthSeconds: SPEED_PRESETS.normal,
};

const VALID_MODES: ReadonlySet<TimeOfDayMode> = new Set(["static", "dynamic"]);

/** Elapsed seconds for a phase at a given cycle length (phase fraction * length). */
export function phaseToStartSeconds(phase: TimeOfDayPhase, dayLengthSeconds: number): number {
  return PHASE_TO_CYCLE_T[phase] * dayLengthSeconds;
}

/**
 * Validate + normalize unknown input to a safe TimeOfDayConfig. Clamps bad
 * mode/phase to defaults and bad dayLengthSeconds to the default. Never
 * throws and always returns a fresh object (never the DEFAULT ref).
 */
export function validateTimeOfDayConfig(input: unknown): TimeOfDayConfig {
  const fallback: TimeOfDayConfig = { ...DEFAULT_TIME_OF_DAY };
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return fallback;
  }
  const rec = input as Record<string, unknown>;
  const mode: TimeOfDayMode =
    typeof rec.mode === "string" && VALID_MODES.has(rec.mode as TimeOfDayMode)
      ? (rec.mode as TimeOfDayMode)
      : DEFAULT_TIME_OF_DAY.mode;
  const phase: TimeOfDayPhase =
    typeof rec.phase === "string" && rec.phase in PHASE_TO_CYCLE_T
      ? (rec.phase as TimeOfDayPhase)
      : DEFAULT_TIME_OF_DAY.phase;
  const dayLengthSeconds =
    typeof rec.dayLengthSeconds === "number" &&
    Number.isFinite(rec.dayLengthSeconds) &&
    rec.dayLengthSeconds > 0
      ? rec.dayLengthSeconds
      : DEFAULT_TIME_OF_DAY.dayLengthSeconds;
  return { mode, phase, dayLengthSeconds };
}

/**
 * Map a config to the DynamicSky setter params (the shape
 * Environment.setTimeOfDay consumes). startElapsed is phase-fraction *
 * dayLength; frozen is true in static mode.
 */
export function timeOfDayToEnvParams(config: TimeOfDayConfig): {
  dayLengthSeconds: number;
  startElapsed: number;
  frozen: boolean;
} {
  return {
    dayLengthSeconds: config.dayLengthSeconds,
    startElapsed: phaseToStartSeconds(config.phase, config.dayLengthSeconds),
    frozen: config.mode === "static",
  };
}
