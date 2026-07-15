/**
 * Dev URL-flag parser. Turns a raw query string (e.g. location.search) into a
 * typed, validated DevFlags override bundle for fast iteration: jump straight
 * into a biome/seed/weather/time/kart/quality without clicking through menus,
 * plus boolean toggles (autostart/debug/garage/freefly). Every override is
 * "no opinion unless valid" — unknown params, omitted params, and values that
 * are not in the canonical vocabulary all resolve to undefined (Game keeps its
 * normal default); a bad value never throws. Enum matching is case-INSENSITIVE
 * (input is lowercased) so ?biome=Tundra and ?biome=tundra both resolve. seed
 * is a base-10 integer (undefined when NaN). Vocabularies are reused from their
 * source modules (not re-typed) so a new biome/kart/weather stays in sync.
 * Pure: no DOM, no WebGL, no side effects; safe under node + jsdom.
 */

import { BIOME_ORDER, type BiomeId } from "../environment/biomes/registry";
import { KART_MODELS, type KartVariantId } from "../kart/models";
import { WEATHER_MODE_VALUES, type WeatherChoice } from "./weatherConfig";
import { PHASE_TO_CYCLE_T, type TimeOfDayPhase } from "./timeOfDayConfig";
import type { QualityTier } from "./quality";

/** Parsed dev overrides. Optional fields = "no override"; booleans = presence. */
export interface DevFlags {
  /** Biome id to force (one of BIOME_ORDER). */
  biome?: BiomeId;
  /** World seed (base-10 int; undefined when the param is NaN). */
  seed?: number;
  /** Weather choice to force (one of WEATHER_MODE_VALUES, incl. "auto"). */
  weather?: WeatherChoice;
  /** Time-of-day phase to force (one of the TimeOfDayPhase keys). */
  time?: TimeOfDayPhase;
  /** Kart variant to force (one of the registered KART_MODELS ids). */
  kart?: KartVariantId;
  /** Render quality tier to force. */
  quality?: QualityTier;
  /** Skip the menu and launch a race immediately. */
  autostart: boolean;
  /** Enable debug overlays/logging. */
  debug: boolean;
  /** Open the garage/kart-select on boot. */
  garage: boolean;
  /** Enable the free-fly spectator camera. */
  freefly: boolean;
}

/** low|med|high has no runtime array upstream; kept as a subset of the type. */
const QUALITY_TIERS = ["low", "med", "high"] as const satisfies readonly QualityTier[];

const BIOME_IDS: ReadonlySet<string> = new Set(BIOME_ORDER);
const WEATHER_IDS: ReadonlySet<string> = new Set(WEATHER_MODE_VALUES);
const TIME_IDS: ReadonlySet<string> = new Set(Object.keys(PHASE_TO_CYCLE_T));
const KART_IDS: ReadonlySet<string> = new Set(KART_MODELS.map((m) => m.id));
const QUALITY_IDS: ReadonlySet<string> = new Set(QUALITY_TIERS);

/**
 * Case-insensitive enum lookup. Returns the lowercased value typed as T when it
 * is a member of `valid`, otherwise undefined (no override). Null (param
 * absent) also yields undefined.
 */
function pickEnum<T extends string>(raw: string | null, valid: ReadonlySet<string>): T | undefined {
  if (raw === null) return undefined;
  const value = raw.toLowerCase();
  return valid.has(value) ? (value as T) : undefined;
}

/** Parse a seed param as a base-10 integer; undefined when absent or NaN. */
function parseSeed(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Parse a URL query string into validated DevFlags. Accepts the raw search
 * string (a single leading "?" is stripped by URLSearchParams), so pass
 * location.search directly. Never throws.
 */
export function parseDevFlags(search: string): DevFlags {
  const p = new URLSearchParams(search);
  return {
    biome: pickEnum<BiomeId>(p.get("biome"), BIOME_IDS),
    seed: parseSeed(p.get("seed")),
    weather: pickEnum<WeatherChoice>(p.get("weather"), WEATHER_IDS),
    time: pickEnum<TimeOfDayPhase>(p.get("time"), TIME_IDS),
    kart: pickEnum<KartVariantId>(p.get("kart"), KART_IDS),
    quality: pickEnum<QualityTier>(p.get("quality"), QUALITY_IDS),
    autostart: p.has("autostart"),
    debug: p.has("debug"),
    garage: p.has("garage"),
    freefly: p.has("freefly"),
  };
}
