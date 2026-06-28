import * as THREE from "three";
import { CelWaterMaterial } from "../materials/celWater";

const WATER_LAYER = 1;
const DEFAULT_LEVEL = -3; // matches 003 sandLevel (valley hook)
const DEFAULT_SIZE = 200; // matches the 003 world extent
const SEGMENTS = 64;

export interface WaterOptions {
  /** Water surface height (valley height; 003 sand band). */
  level?: number;
  /** Full world span of the plane (square). */
  size?: number;
}

/**
 * Low-poly cel water plane for 004 valley fills. A subdivided PlaneGeometry
 * (flat in XZ) shaded by CelWaterMaterial: animated vertex waves via uTime, cel
 * bands + depth tint + fresnel rim, on render layer 1 (edges get the post-Sobel
 * outline). Visual only: no Rapier collider, no buoyancy — the kart drives
 * through valleys under the surface.
 */
export class Water {
  readonly mesh: THREE.Mesh;
  private readonly material: CelWaterMaterial;

  constructor(opts: WaterOptions = {}) {
    const size = opts.size ?? DEFAULT_SIZE;
    const geo = new THREE.PlaneGeometry(size, size, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2);

    this.material = new CelWaterMaterial();
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.y = opts.level ?? DEFAULT_LEVEL;
    this.mesh.receiveShadow = true;
    this.mesh.layers.set(WATER_LAYER);
  }

  /** Advance the wave phase (Game passes the elapsed time in seconds). */
  update(time: number, focusX = 0, focusZ = 0): void {
    this.material.uTime = time;
    this.mesh.position.x = focusX;
    this.mesh.position.z = focusZ;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
