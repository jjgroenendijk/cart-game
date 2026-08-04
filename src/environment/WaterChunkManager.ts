import * as THREE from "three";
import { CelWaterMaterial } from "../materials/celWater";
import { EMISSIVE_LAYER } from "../materials/emissiveCapture";
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
  /**
   * Render a fogged far-water disc past the streamed ring so the horizon reads
   * as water, not void (071 fog-far fallback). Default true.
   */
  farSkirt?: boolean;
  /**
   * Outer radius (m) of the far-water disc. SHOULD exceed the max scene fog-far
   * (~360) so its rim saturates to fog and never shows a hard edge. Default 480.
   */
  farRadius?: number;
}

interface WaterTile {
  gx: number;
  gz: number;
  mesh: THREE.Mesh;
  /**
   * Layer-3-only sibling clone sharing {@link WaterTile.mesh} geometry and the
   * shared emissive material, so the bloom pre-pass captures only the water
   * sun-glint (#315). Present only while glint is active (non-low tier).
   */
  emissive?: THREE.Mesh;
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
 *
 * Past the streamed ring a single FOGGED FAR-WATER DISC (farSkirt, 071 fog-far)
 * fills the void so the horizon reads as water rather than sky/void: a flat
 * (amp 0), facing-only (no HEIGHT_MAP), glint-free CelWaterMaterial disc that
 * follows the observer centroid. It sits a hair below the tile troughs
 * (waterY - amp - epsilon) and renders after the tiles (renderOrder 1) so the
 * opaque near tiles always occlude it (no z-fight; early-Z rejects the covered
 * center). Its radius exceeds the max scene fog-far so its rim saturates to the
 * horizon haze with no hard edge. Disabled with farSkirt:false.
 */
export class WaterChunkManager {
  readonly group = new THREE.Group();
  /** Fogged far-water disc that fills the horizon past the streamed ring (071). */
  readonly farSkirt: THREE.Mesh | null = null;

  private readonly material: CelWaterMaterial;
  /**
   * Shared emissive-output variant of {@link material} (EMISSIVE_OUTPUT define):
   * emits ONLY the isolated sun-glint term (black elsewhere). Bound to one
   * layer-3 sibling clone per tile (#315). Uniforms that change per-frame /
   * per-state (uGlintIntensity, uTime, HEIGHT_MAP set; lightUniforms already
   * shared as module singletons) are aliased by-ref onto this material so it
   * stays in lock-step with the visible material without a second write path.
   */
  readonly emissiveMaterial: CelWaterMaterial;
  private readonly farMaterial: CelWaterMaterial | null = null;
  private readonly farDropY: number;
  private readonly level: number;
  private readonly chunkSize: number;
  private readonly seg: number;
  private readonly policy: StreamPolicy;
  private readonly pinned: Set<string>;
  private readonly tiles = new Map<string, WaterTile>();
  private disposed = false;
  /** Whether layer-3 glint clones are currently attached (glint active). */
  private glintActive = true;

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
    // Selective-bloom sibling material: same shading opts + EMISSIVE_OUTPUT so
    // the fragment emits only glintTerm (black elsewhere). Built BEFORE tiles
    // activate so addEmissive can bind it. Uniforms that mutate at runtime are
    // shared by-ref with this.material so a single write fans to both (the
    // ...lightUniforms spread already shares uSunColor/uSunDirWorld/etc as
    // module singletons; cameraPosition is a renderer-built-in). The farSkirt
    // material (glintIntensity:0) intentionally gets NO clone.
    this.emissiveMaterial = new CelWaterMaterial({
      tint: opts.color,
      shallow: opts.shallow,
      deep: opts.deep,
      heightMap: field,
      waterY: this.level,
      emissiveOutput: true,
    });
    this.emissiveMaterial.uniforms.uGlintIntensity = this.material.uniforms.uGlintIntensity;
    this.emissiveMaterial.uniforms.uTime = this.material.uniforms.uTime;
    if (field) {
      this.emissiveMaterial.uniforms.uHeightMap = this.material.uniforms.uHeightMap;
      this.emissiveMaterial.uniforms.uHeightOrigin = this.material.uniforms.uHeightOrigin;
      this.emissiveMaterial.uniforms.uHeightSize = this.material.uniforms.uHeightSize;
      this.emissiveMaterial.uniforms.uHeightTexels = this.material.uniforms.uHeightTexels;
    }
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
    // Far-water skirt: one flat fogged disc below the tile troughs, added LAST
    // so children[0] stays a streamed tile. Sits amp + epsilon under the water
    // line so the oscillating opaque tiles always win the depth test.
    const amp = this.material.uniforms.uAmp.value as number;
    this.farDropY = this.level - amp - 0.1;
    if (opts.farSkirt !== false) {
      this.farMaterial = new CelWaterMaterial({
        tint: opts.color,
        shallow: opts.shallow,
        deep: opts.deep,
        amp: 0, // flat calm sheet; the near tiles carry the ripples
        glintIntensity: 0, // no specular band on the distant low-poly disc
      });
      const geo = new THREE.CircleGeometry(opts.farRadius ?? 480, 96);
      geo.rotateX(-Math.PI / 2); // face +Y, lie flat
      const mesh = new THREE.Mesh(geo, this.farMaterial);
      mesh.layers.set(WATER_LAYER);
      mesh.receiveShadow = false;
      // Draw after the near tiles (renderOrder 0) so early-Z rejects the
      // tile-covered center; only the horizon annulus actually shades.
      mesh.renderOrder = 1;
      mesh.userData.farSkirt = true;
      mesh.matrixAutoUpdate = false;
      this.farSkirt = mesh;
      this.positionSkirt(0, 0); // start under the spawn focus
      this.group.add(mesh);
    }
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

  /** Center the far-water disc on (x,z) at its fixed drop height. */
  private positionSkirt(x: number, z: number): void {
    const mesh = this.farSkirt;
    if (!mesh) return;
    mesh.position.set(x, this.farDropY, z);
    mesh.updateMatrix(); // matrixAutoUpdate is off -> recompute + flag world dirty
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
    const tile: WaterTile = { gx, gz, mesh };
    this.tiles.set(key, tile);
    if (this.glintActive) this.addEmissive(tile);
  }

  /**
   * Attach a layer-3-only sibling clone of a tile mesh: shares the tile
   * geometry (freed once by the visible mesh on deactivate) and the single
   * shared emissive material, transform-matched (both identity; world coords
   * live in the shared geometry). Layer 3 ONLY so the main RenderPass skips it
   * and the EmissiveCapturePass picks it up. No shadow receive (glint is an
   * emissive term, not lit).
   */
  private addEmissive(tile: WaterTile): void {
    if (tile.emissive) return;
    const emissive = new THREE.Mesh(tile.mesh.geometry, this.emissiveMaterial);
    emissive.layers.set(EMISSIVE_LAYER);
    emissive.matrixAutoUpdate = false;
    emissive.updateMatrix();
    emissive.receiveShadow = false;
    emissive.userData.emissive = true;
    tile.emissive = emissive;
    this.group.add(emissive);
  }

  /** Detach the layer-3 clone; does NOT dispose geometry (owned by the visible mesh). */
  private removeEmissive(tile: WaterTile): void {
    if (!tile.emissive) return;
    this.group.remove(tile.emissive);
    tile.emissive = undefined;
  }

  private deactivate(gx: number, gz: number): void {
    const key = chunkKey(gx, gz);
    if (this.pinned.has(key)) return;
    const t = this.tiles.get(key);
    if (!t) return;
    this.removeEmissive(t);
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
    // Keep the far-water disc under the observer set (centroid covers 1P
    // exactly and split-screen karts, which race the same track together).
    if (this.farSkirt) {
      let sx = 0;
      let sz = 0;
      for (const f of foci) {
        sx += f.x;
        sz += f.z;
      }
      this.positionSkirt(sx / foci.length, sz / foci.length);
    }
  }

  /**
   * Scale the sun glint strength (0 disables; low-tier knob). Writes the
   * shared uGlintIntensity uniform (aliased by-ref onto emissiveMaterial, so
   * both materials advance together) and gates the layer-3 sibling clones:
   * clones exist only while glint is active (non-low tier) so low tier pays no
   * extra layer-3 draw call. Toggling back >0 re-creates clones on all live
   * tiles (pinned + streamed).
   */
  setGlintIntensity(v: number): void {
    this.material.glintIntensity = v; // shared by-ref -> emissiveMaterial too
    const active = v > 0;
    if (active === this.glintActive) return;
    this.glintActive = active;
    for (const t of this.tiles.values()) {
      if (active) this.addEmissive(t);
      else this.removeEmissive(t);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const t of this.tiles.values()) {
      this.removeEmissive(t);
      t.mesh.geometry.dispose();
    }
    this.tiles.clear();
    this.material.dispose();
    this.emissiveMaterial.dispose();
    if (this.farSkirt) this.farSkirt.geometry.dispose();
    this.farMaterial?.dispose();
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
