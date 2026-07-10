import * as THREE from "three";
import { CelWaterMaterial } from "../materials/celWater";
import type { HeightMapField } from "../materials/cel";
import type { Pt } from "../kart/kartLod";
import { chunkBounds, chunkCenter, chunkKey, parseChunkKey } from "../terrain/streamGrid";
import { planStream, type StreamPolicy } from "../terrain/chunkStream";

const WATER_LAYER = 1;
const DEFAULT_LEVEL = -3; // matches 003 sandLevel (valley hook)
const DEFAULT_CHUNK = 50; // metres per water tile edge
/** Segment density matching the pre-071 single plane (200 m / 64 segs). */
const WAVE_M_PER_SEG = 200 / 64;

export interface WaterChunkManagerOptions {
  /** Water surface height (valley height; 003 sand band). */
  level?: number;
  /** World-space tile edge length (metres). Default 50. */
  chunkSize?: number;
  /** sRGB hex overall hue (biome waterColor); undefined = white/identity. */
  color?: number;
  /** sRGB hex shallow tint; undefined = CelWater default. */
  shallow?: number;
  /** sRGB hex deep tint; undefined = CelWater default. */
  deep?: number;
  /**
   * Baked bed-height field (terrain). When set, tiles overlapping it render
   * depth tint + shore foam per-fragment; tiles (or fragments) past its bounds
   * fall back to the facing-only look automatically (the shader's in-field
   * test), so ONE heightMap-bound material serves both near and far tiles.
   */
  heightMap?: HeightMapField;
  /** Water surface world Y for the depth math. Defaults to {@link level}. */
  waterY?: number;
  /** Activate tiles within this XZ distance of any focus. Default 180. */
  streamRadius?: number;
  /** Deactivate tiles beyond this XZ distance (hysteresis). Default 220. */
  cullRadius?: number;
  /** Max new tile activations per update() (hitch budget). Default 6. */
  maxActivations?: number;
}

interface WaterTile {
  gx: number;
  gz: number;
  mesh: THREE.Mesh;
}

/**
 * 071 streaming cel water. Replaces the single 080 water plane with a signed
 * chunk grid (streamGrid) streamed around the observer set via the shared
 * planStream planner, so an effectively endless world only instantiates water
 * near the camera instead of one field-sized quad. Tiles baked over a terrain
 * bed-field are PINNED (never culled) so the depth foam always covers the
 * authored field regardless of camera position; tiles past the field stream in
 * and out around the focus as the kart drives.
 *
 * All tiles share ONE CelWaterMaterial: with a heightMap the shader is
 * depth-aware per-fragment (foam inside the field, facing-only fallback past
 * it); without one it is the legacy facing look everywhere (test/stub parity).
 * Each tile's geometry is authored in WORLD space (mesh transform stays at
 * identity) so the object-space vertex wave sin(pos.x)+sin(pos.z) is one
 * continuous field across tile seams instead of restarting per tile.
 */
export class WaterChunkManager {
  readonly group = new THREE.Group();

  private readonly material: CelWaterMaterial;
  private readonly level: number;
  private readonly chunkSize: number;
  private readonly seg: number;
  private readonly policy: StreamPolicy;
  private readonly pinned: Set<string>;
  private readonly tiles = new Map<string, WaterTile>();
  private disposed = false;

  constructor(opts: WaterChunkManagerOptions = {}) {
    const field = opts.heightMap;
    this.chunkSize = opts.chunkSize ?? DEFAULT_CHUNK;
    this.level = opts.waterY ?? opts.level ?? DEFAULT_LEVEL;
    this.seg = Math.max(1, Math.round(this.chunkSize / WAVE_M_PER_SEG));
    this.material = new CelWaterMaterial({
      tint: opts.color,
      shallow: opts.shallow,
      deep: opts.deep,
      heightMap: field,
      waterY: this.level,
    });
    this.policy = {
      chunkSize: this.chunkSize,
      streamRadius: opts.streamRadius ?? 180,
      cullRadius: opts.cullRadius ?? 220,
      maxActivations: opts.maxActivations ?? 6,
    };
    // Pin every tile overlapping the baked field: foam must cover the whole
    // authored region even when the camera sits at one edge of a large circuit.
    this.pinned = field ? fieldTileKeys(field, this.chunkSize) : new Set();
    for (const key of this.pinned) {
      const { gx, gz } = parseChunkKey(key);
      this.activate(gx, gz);
    }
    // Seed the spawn-area ring so 1P/menu focus has water before the first
    // update(); the planner throttles later ticks.
    const seed = planStream(this.activeKeys(), [{ x: 0, y: 0, z: 0 }], {
      ...this.policy,
      maxActivations: Infinity,
    });
    for (const c of seed.activate) this.activate(c.gx, c.gz);
    // The group is parented once and never transformed -> freeze its matrix.
    this.group.matrixAutoUpdate = false;
    this.group.updateMatrix();
  }

  get activeCount(): number {
    return this.tiles.size;
  }

  get pinnedCount(): number {
    return this.pinned.size;
  }

  private activeKeys(): Set<string> {
    return new Set(this.tiles.keys());
  }

  private activate(gx: number, gz: number): void {
    if (this.disposed) return;
    const key = chunkKey(gx, gz);
    if (this.tiles.has(key)) return;
    const c = chunkCenter(gx, gz, this.chunkSize);
    const geo = new THREE.PlaneGeometry(this.chunkSize, this.chunkSize, this.seg, this.seg);
    geo.rotateX(-Math.PI / 2);
    // Author in world space so the vertex wave (object-space pos.x/pos.z) is
    // one seamless field across tiles; the mesh transform stays at identity.
    geo.translate(c.x, this.level, c.z);
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.receiveShadow = true;
    mesh.layers.set(WATER_LAYER);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    this.tiles.set(key, { gx, gz, mesh });
  }

  private deactivate(gx: number, gz: number): void {
    const key = chunkKey(gx, gz);
    if (this.pinned.has(key)) return;
    const t = this.tiles.get(key);
    if (!t) return;
    this.group.remove(t.mesh);
    t.mesh.geometry.dispose();
    this.tiles.delete(key);
  }

  /**
   * Advance the wave phase (elapsed seconds) and stream tiles around the
   * observer set (single focus today, N-camera ready). Pinned in-field tiles
   * are never culled; the shared material's uTime is written once for all tiles.
   */
  update(foci: readonly Pt[], time: number): void {
    if (this.disposed) return;
    this.material.uTime = time;
    if (foci.length === 0) return;
    const plan = planStream(this.activeKeys(), foci, this.policy);
    for (const c of plan.deactivate) this.deactivate(c.gx, c.gz);
    for (const c of plan.activate) this.activate(c.gx, c.gz);
  }

  /** Scale the sun glint strength (0 disables; low-tier knob). */
  setGlintIntensity(v: number): void {
    this.material.glintIntensity = v;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const t of this.tiles.values()) t.mesh.geometry.dispose();
    this.tiles.clear();
    this.material.dispose();
    this.group.clear();
  }
}

/**
 * Keys of every tile whose bounds overlap the baked field rect (origin +
 * square size). Overlap (not containment) so edge tiles still tile the field
 * border with no gap. Pure.
 */
function fieldTileKeys(field: HeightMapField, chunkSize: number): Set<string> {
  const x0 = field.origin[0];
  const z0 = field.origin[1];
  const x1 = x0 + field.size;
  const z1 = z0 + field.size;
  const gxMin = Math.round(x0 / chunkSize) - 1;
  const gxMax = Math.round(x1 / chunkSize) + 1;
  const gzMin = Math.round(z0 / chunkSize) - 1;
  const gzMax = Math.round(z1 / chunkSize) + 1;
  const out = new Set<string>();
  for (let gx = gxMin; gx <= gxMax; gx++) {
    for (let gz = gzMin; gz <= gzMax; gz++) {
      const b = chunkBounds(gx, gz, chunkSize);
      if (b.x1 > x0 && b.x0 < x1 && b.z1 > z0 && b.z0 < z1) out.add(chunkKey(gx, gz));
    }
  }
  return out;
}
