import type { QualityTier } from "../core/quality";
import type { TerrainLodOpts } from "./terrainLod";

/**
 * Construction options for {@link TerrainChunkManager}. Pure config contract;
 * split out so the manager owns behavior and this module owns the schema.
 */
export interface TerrainChunkManagerOptions {
  /** Full world extent in metres (square). Default 200. */
  worldSize?: number;
  /** Chunks per axis (grid is gridCount x gridCount). World-size-scaled. */
  gridCount?: number;
  /** Quality tier keys the near segment count. Default "high". */
  quality?: QualityTier;
  /** Skirt vertical drop (metres, positive), below chunk terrain edge. Default 30. */
  skirtDrop?: number;
  /** LOD band + hysteresis opts. Default DEFAULT_TERRAIN_LOD. */
  lod?: TerrainLodOpts;
  /**
   * Heightmap texels per axis used for per-pixel terrain normals (square).
   * World-size-scaled (clamp(pow2ish(worldSize*1.4),384,1024)). The texture
   * spans worldSize, so each texel is worldSize/texels metres. Finer than the
   * chunk mesh resolution so the fragment-shader normal is smooth and
   * independent of the quad triangulation (no diagonal/diamond cel-band
   * artifacts).
   */
  heightTexels?: number;
  /** Activate chunks within this distance of any camera focus. Default 140. */
  streamRadius?: number;
  /** Deactivate chunks beyond this distance (hysteresis past streamRadius). Default 170. */
  cullRadius?: number;
  /** Max new chunk activations per update() (hitch budget). Default 4. */
  maxActivations?: number;
  /**
   * 206 incremental ctor seed. Caps both the synchronous ctor seed and the
   * per-frame drain (ChunkSeeder): finite -> the ctor seeds only the nearest
   * `seedBudget` chunks and update() drains the rest nearest-camera-first over
   * frames (removes the large-world load hitch; fog hazes the fill-in). Default
   * Infinity -> full synchronous seed (pre-206; tests keep a seeded world).
   */
  seedBudget?: number;
  /**
   * 202 collider-range decoupling. A chunk builds its trimesh collider only
   * while its center is within colliderRadius (XZ) of a collider focus (kart/AI
   * position, passed to refreshColliders); the collider is disabled once the
   * center passes colliderCullRadius (hysteresis). The per-chunk fixed body is
   * always created (it is near-free without an enabled collider), so bodyCount
   * still equals activeCount; only the trimesh BVH + broadphase presence is
   * gated. Visual streaming keeps using streamRadius/cullRadius around the
   * camera, so terrain renders out to the fog horizon while colliders stay
   * bounded near the karts. Both default to Infinity -> every active chunk
   * keeps its collider (pre-202 coupled behavior).
   */
  colliderRadius?: number;
  colliderCullRadius?: number;
  /**
   * Seconds for a chunk's LOD tier swap to dither cross-fade (old tier OUT /
   * new tier IN through the fog band) instead of snapping. Default 0 = instant
   * swap. Gated off on the low tier (budget: transient double draw + discard).
   */
  crossFadeSeconds?: number;
  /** Monotonic clock (SECONDS) for frame-rate-independent fades. Tests inject it. */
  now?: () => number;
}
