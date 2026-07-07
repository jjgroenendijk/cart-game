import * as THREE from "three";
import { CelWaterMaterial } from "../materials/celWater";
import type { HeightMapField } from "../materials/cel";

const WATER_LAYER = 1;
const DEFAULT_LEVEL = -3; // matches 003 sandLevel (valley hook)
const DEFAULT_SIZE = 200; // matches the 003 world extent
const SEGMENTS = 64;

export interface WaterOptions {
  /** Water surface height (valley height; 003 sand band). */
  level?: number;
  /** Full world span of the plane (square). */
  size?: number;
  /** sRGB hex overall hue (biome waterColor); undefined = white/identity. */
  color?: number;
  /** sRGB hex shallow tint (biome waterShallow); undefined = CelWater default. */
  shallow?: number;
  /** sRGB hex deep tint (biome waterDeep); undefined = CelWater default. */
  deep?: number;
  /** Baked bed-height field (terrain); enables depth tint + shore foam. */
  heightMap?: HeightMapField;
  /**
   * Water surface world Y for the depth math. Defaults to {@link level} so
   * uWaterY tracks the actual plane height; Environment plumbs
   * terrain.waterLevel here so mesh + depth uniform agree.
   */
  waterY?: number;
}

/**
 * Low-poly cel water plane for 004 valley fills. A subdivided PlaneGeometry
 * (flat in XZ) shaded by CelWaterMaterial: animated vertex waves via uTime,
 * depth tint + shore foam + sun glints (062) when a heightMap is supplied, on
 * render layer 1 (edges get the post-Sobel outline). Visual only: no Rapier
 * collider, no buoyancy — the kart drives through valleys under the surface.
 */
export class Water {
  readonly mesh: THREE.Mesh;
  private readonly material: CelWaterMaterial;

  constructor(opts: WaterOptions = {}) {
    const field = opts.heightMap;
    const size = opts.size ?? field?.size ?? DEFAULT_SIZE;
    const level = opts.waterY ?? opts.level ?? DEFAULT_LEVEL;
    const geo = new THREE.PlaneGeometry(size, size, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2);

    this.material = new CelWaterMaterial({
      tint: opts.color,
      shallow: opts.shallow,
      deep: opts.deep,
      heightMap: opts.heightMap,
      waterY: level,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    const centerX = field ? field.origin[0] + field.size * 0.5 : 0;
    const centerZ = field ? field.origin[1] + field.size * 0.5 : 0;
    this.mesh.position.set(centerX, level, centerZ);
    this.mesh.receiveShadow = true;
    this.mesh.layers.set(WATER_LAYER);
    // Transform never changes (waves are a material uTime uniform, not a
    // mesh transform) -> freeze the world matrix after placement so the
    // renderer skips the per-frame compose across every render pass.
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
  }

  /**
   * Advance the wave phase (Game passes the elapsed time in seconds). The
   * plane stays pinned to the baked bed-height field: that texture is baked
   * once over the static worldSize square and shared with the cel terrain
   * normals, so the plane must coincide with that square or the shore
   * foam/depth tint only covers part of the water (the rest is foamless).
   * Following the focus would slide the plane past the baked field and leave a
   * foamless band at the down-drift edge. matrixAutoUpdate is false and the
   * transform never changes, so the constructor's baked matrixWorld stays
   * valid (no per-frame matrix update needed).
   */
  update(time: number): void {
    this.material.uTime = time;
  }

  /** Scale the sun glint strength (0 disables; low-tier knob, commit 3). */
  setGlintIntensity(v: number): void {
    this.material.glintIntensity = v;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
