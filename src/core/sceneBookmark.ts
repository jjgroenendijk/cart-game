import { resolveBiome, type BiomeId } from "../terrain/biomes";
import { PHASE_TO_CYCLE_T, type TimeOfDayPhase } from "./timeOfDayConfig";
import { validateWeatherMode, type WeatherChoice } from "./weatherConfig";

export type SceneCam = "menu" | "chase";

export interface SceneBookmark {
  biome: BiomeId;
  cycleT: number;
  weather: WeatherChoice;
  cam: SceneCam;
  camT: number;
  time: number;
  /** Raw tod source (preset name or decimal-hours string) for round-tripping. */
  tod: string;
}

export const DEFAULT_SCENE_BOOKMARK: SceneBookmark = {
  biome: "temperate",
  cycleT: PHASE_TO_CYCLE_T.noon,
  weather: "clear",
  cam: "menu",
  camT: 0.5,
  time: 1 / 60,
  tod: "noon",
};

/** Frames the deterministic render loop runs before signalling __sceneReady. */
export const SCENE_SETTLE_FRAMES = 8;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Map decimal hours [0,24) to a sky cycleT fraction so the preset anchors hold:
 * 06:00 -> 0 (dawn), 12:00 -> 0.25 (noon), 18:00 -> 0.5 (dusk),
 * 00:00/24:00 -> 0.75 (night). Uses mathematical modulo (always non-negative).
 */
function hoursToCycleT(hours: number): number {
  const shifted = (((hours - 6) % 24) + 24) % 24;
  return shifted / 24;
}

function resolveTod(raw: string | undefined): { cycleT: number; tod: string } {
  if (raw !== undefined && raw in PHASE_TO_CYCLE_T) {
    return { cycleT: PHASE_TO_CYCLE_T[raw as TimeOfDayPhase], tod: raw };
  }
  if (raw !== undefined && raw.trim() !== "") {
    const hours = Number(raw);
    if (Number.isFinite(hours)) return { cycleT: hoursToCycleT(hours), tod: String(hours) };
  }
  return { cycleT: PHASE_TO_CYCLE_T.noon, tod: "noon" };
}

function applyToken(bm: SceneBookmark, key: string, value: string): void {
  switch (key) {
    case "biome": {
      bm.biome = resolveBiome(value).id;
      break;
    }
    case "tod": {
      const r = resolveTod(value);
      bm.cycleT = r.cycleT;
      bm.tod = r.tod;
      break;
    }
    case "weather": {
      bm.weather = validateWeatherMode(value);
      break;
    }
    case "cam": {
      bm.cam = value === "chase" ? "chase" : "menu";
      break;
    }
    case "camT": {
      const n = Number(value);
      if (Number.isFinite(n)) bm.camT = clamp01(n);
      break;
    }
    case "time": {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) bm.time = n;
      break;
    }
  }
}

/**
 * Parse + validate + default a scene bookmark from the raw ?scene= value.
 * Order-independent; unknown keys ignored; bad values fall back to defaults.
 * Never throws and always returns a fresh object.
 */
export function parseSceneBookmark(raw: string | null | undefined): SceneBookmark {
  const bm: SceneBookmark = { ...DEFAULT_SCENE_BOOKMARK };
  if (raw === null || raw === undefined) return bm;
  for (const token of raw.split(",")) {
    const colon = token.indexOf(":");
    if (colon < 0) continue;
    const key = token.slice(0, colon).trim();
    const value = token.slice(colon + 1).trim();
    if (key === "" || value === "") continue;
    applyToken(bm, key, value);
  }
  return bm;
}

/** Serialize a bookmark to the canonical comma-separated key:value string. */
export function serializeSceneBookmark(bm: SceneBookmark): string {
  return [
    `biome:${bm.biome}`,
    `tod:${bm.tod}`,
    `weather:${bm.weather}`,
    `cam:${bm.cam}`,
    `camT:${bm.camT}`,
    `time:${bm.time}`,
  ].join(",");
}

/**
 * Pull the `scene` query param from a search string. Defaults to
 * location.search when available so jsdom can inject. Returns null when absent.
 */
export function readSceneQuery(search?: string): string | null {
  const q = search ?? (typeof location !== "undefined" ? location.search : "");
  if (!q) return null;
  return new URLSearchParams(q).get("scene");
}
