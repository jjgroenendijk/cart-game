/**
 * Pure whole-game debug snapshot assembler (dependency-injected).
 *
 * `buildDebugSnapshot(accessors)` folds already-read subsystem state into one
 * plain, JSON-serializable object. It imports NO Game, NO WebGL, NO THREE:
 * every input arrives through the `accessors` bag so jsdom specs (and Game's
 * real wiring) both feed it directly. Game owns reading the live subsystems;
 * this module owns the shape + defensive copying.
 *
 * Two copies matter here:
 *   - RaceManager.snapshot() REUSES an internal buffer, so we deep-copy it (a
 *     retained reference would mutate under the next snapshot() call).
 *   - dayCycleState's Color/Vector3 fields alias pooled scratch, so we extract
 *     only the plain numeric/phase fields (JSON-safe, non-aliasing).
 *
 * Missing optional accessors resolve to null consistently; `karts` defaults to
 * an empty array. No DOM, no side effects.
 */

import { kartToJSON, type KartLike, type KartSnapshot } from "../kart/kartSnapshot";
import type { KartProgress, RaceSnapshot } from "../race/raceManager";
import type { PerfSample } from "./stats";

/** Weather summary (structural mirror of Environment.weatherInfo). */
export interface WeatherLike {
  preset: string;
  level: number;
  elapsed: number;
  seed: number;
}

/**
 * Day-cycle summary: the JSON-safe numeric/phase subset of dayCycleState. The
 * Color/Vector3 fields on the real state are intentionally excluded (they alias
 * pooled scratch and are not JSON-serializable).
 */
export interface DayLike {
  elapsed: number;
  cycleT: number;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  phase: string;
  nightFactor: number;
  sunIntensity: number;
  ambientIntensity: number;
  fogNear: number;
  fogFar: number;
  shadowFade: number;
}

/**
 * Injected accessors. All fields except `karts` are optional; undefined ones
 * resolve to null in the output. `race` is a live RaceManager.snapshot() (deep
 * copied here). `quality` is an opaque passthrough (renderer quality report).
 */
export interface DebugSnapshotAccessors {
  state?: string;
  time?: number;
  seed?: number;
  biome?: string;
  weather?: WeatherLike;
  day?: DayLike;
  quality?: unknown;
  perf?: PerfSample;
  karts?: readonly KartLike[];
  race?: RaceSnapshot;
}

/** Deep-copied race snapshot (independent of RaceManager's reused buffer). */
export interface RaceSnapshotJSON {
  phase: RaceSnapshot["phase"];
  timer: number;
  leaderLap: number;
  positions: number[];
  order: number[];
  progress: KartProgress[];
}

/** Assembled whole-game debug snapshot. All keys always present. */
export interface DebugSnapshot {
  state: string | null;
  time: number | null;
  seed: number | null;
  biome: string | null;
  weather: WeatherLike | null;
  day: DayLike | null;
  quality: unknown;
  perf: PerfSample | null;
  race: RaceSnapshotJSON | null;
  karts: KartSnapshot[];
}

/** Structural subset of the renderer's FrameStats the perf sample reads. */
export interface FrameStatsLike {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

/**
 * Adapt renderer FrameStats + a smoothed frame time (ms) into a PerfSample.
 * getFrameStats() is NOT a PerfSample (calls/triangles vs drawCalls/tris), so
 * Game routes through here rather than passing the raw stats. NaN frameMs (no
 * frame sampled yet) maps to 0.
 */
export function perfFromFrameStats(fs: FrameStatsLike, frameMs: number): PerfSample {
  const ms = Number.isNaN(frameMs) ? 0 : frameMs;
  return {
    frameMs: ms,
    fps: ms > 0 ? 1000 / ms : 0,
    drawCalls: fs.calls,
    tris: fs.triangles,
    geometries: fs.geometries,
    textures: fs.textures,
  };
}

/** Nullish -> null, else the value (keeps the output shape uniform). */
function orNull<T>(v: T | undefined): T | null {
  return v ?? null;
}

/** Copy the weather summary into a fresh literal. */
function copyWeather(w: WeatherLike): WeatherLike {
  return { preset: w.preset, level: w.level, elapsed: w.elapsed, seed: w.seed };
}

/** Copy the day summary into a fresh literal (numeric/phase fields only). */
function copyDay(d: DayLike): DayLike {
  return {
    elapsed: d.elapsed,
    cycleT: d.cycleT,
    sunElevationDeg: d.sunElevationDeg,
    sunAzimuthDeg: d.sunAzimuthDeg,
    phase: d.phase,
    nightFactor: d.nightFactor,
    sunIntensity: d.sunIntensity,
    ambientIntensity: d.ambientIntensity,
    fogNear: d.fogNear,
    fogFar: d.fogFar,
    shadowFade: d.shadowFade,
  };
}

/** Copy a PerfSample into a fresh literal (shadowCasters stays optional). */
function copyPerf(p: PerfSample): PerfSample {
  const out: PerfSample = {
    frameMs: p.frameMs,
    fps: p.fps,
    drawCalls: p.drawCalls,
    tris: p.tris,
    geometries: p.geometries,
    textures: p.textures,
  };
  if (p.shadowCasters !== undefined) out.shadowCasters = p.shadowCasters;
  return out;
}

/** Deep-copy one KartProgress row. */
function copyProgress(p: KartProgress): KartProgress {
  return {
    lap: p.lap,
    sectorIdx: p.sectorIdx,
    cumArcLen: p.cumArcLen,
    lastT: p.lastT,
    finished: p.finished,
    finishTime: p.finishTime,
  };
}

/**
 * Deep-copy a RaceManager snapshot. RaceManager reuses its buffer across
 * snapshot() calls, so a retained reference would be clobbered next frame; we
 * slice the arrays and clone each progress row into owned objects.
 */
function copyRace(r: RaceSnapshot): RaceSnapshotJSON {
  return {
    phase: r.phase,
    timer: r.timer,
    leaderLap: r.leaderLap,
    positions: r.positions.slice(),
    order: r.order.slice(),
    progress: r.progress.map(copyProgress),
  };
}

/**
 * Assemble the whole-game debug snapshot from injected accessors. Pure: reads
 * only, deep-copies the race snapshot + day/weather/perf summaries, and calls
 * kartToJSON on each kart. Absent optional accessors resolve to null.
 */
export function buildDebugSnapshot(accessors: DebugSnapshotAccessors): DebugSnapshot {
  return {
    state: orNull(accessors.state),
    time: orNull(accessors.time),
    seed: orNull(accessors.seed),
    biome: orNull(accessors.biome),
    weather: accessors.weather ? copyWeather(accessors.weather) : null,
    day: accessors.day ? copyDay(accessors.day) : null,
    quality: accessors.quality ?? null,
    perf: accessors.perf ? copyPerf(accessors.perf) : null,
    race: accessors.race ? copyRace(accessors.race) : null,
    karts: (accessors.karts ?? []).map(kartToJSON),
  };
}
