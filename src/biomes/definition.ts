import type { TerrainConfig } from "../terrain/heightmap";
import type { TrackTraits } from "../terrain/trackTraits";

/** Biome identity; a string so future biomes register without union churn. */
export type BiomeId = string;

/** Flora placement request per biome (kind name resolved later by a flora registry). */
export interface FloraEntry {
  /** Flora kind name (resolved later via a flora registry, e.g. "tree"). */
  kind: string;
  /** How many to place. */
  count: number;
}

/** Weather preset weights; partial record (selectWeatherPreset normalises later). */
export type BiomeWeather = Readonly<Record<string, number>>;

export interface BiomeDefinition {
  id: BiomeId;
  /** Display label for the menu (later commit). */
  label: string;
  /** Terrain cfg OVERRIDES only; resolved against DEFAULT_TERRAIN_CONFIG. */
  terrain: Partial<TerrainConfig>;
  /** Flora placement set (kind name + count). */
  flora: ReadonlyArray<FloraEntry>;
  /** Weather preset weights (clear/rain/snow now; more in a later commit). */
  weather: BiomeWeather;
  /** Optional water surface color override (sRGB hex); undefined = default. */
  waterColor?: number;
  /** Optional water level override; undefined = DEFAULT_TERRAIN_CONFIG.sandLevel. */
  waterLevel?: number;
  /**
   * Optional shallow-water tint (sRGB hex); undefined = CelWaterMaterial
   * shader default (identity).
   */
  waterShallow?: number;
  /**
   * Optional deep-water tint (sRGB hex); undefined = CelWaterMaterial shader
   * default (identity).
   */
  waterDeep?: number;
  /**
   * Optional sky/fog/light tint bias for the biome. All fields optional;
   * undefined = identity (temperate leaves it unset). Lerps the just-written
   * dayCycleState colors per frame; default factor is BIOME_TINT_FACTOR.
   */
  skyFogBias?: Readonly<{
    fogTint?: number;
    /** Applied to both zenith + horizon (existing behavior; desert/alpine/tundra). */
    skyTint?: number;
    /** Optional separate zenith tint (overrides skyTint for zenith when set). */
    skyZenithTint?: number;
    /** Optional separate horizon tint (overrides skyTint for horizon when set). */
    skyHorizonTint?: number;
    /** Optional sun-light tint bias (warm). */
    sunTint?: number;
    /** Optional ambient-light tint bias (warm). */
    ambientTint?: number;
    /** Optional per-biome bias strength (default BIOME_TINT_FACTOR 0.2). */
    factor?: number;
  }>;
  /** Optional ambient wildlife kind names (later commit). */
  wildlife?: ReadonlyArray<string>;
  /**
   * Optional track character OVERRIDES: width band + variation, branch
   * chance + kind bias. undefined = DEFAULT_TRACK_TRAITS parity.
   */
  track?: Readonly<Partial<TrackTraits>>;
}
