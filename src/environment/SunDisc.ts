import * as THREE from "three";
import { dayCycleState } from "./dayCycle";

const SUN_DISC_LAYER = 0; // same as DynamicSky moon/stars
const SUN_SHELL = 1500; // matches DynamicSky MOON_SHELL/STAR_SHELL
const DEFAULT_SUN_RADIUS = 40; // matches DynamicSky DEFAULT_MOON_RADIUS
// dayCycle day SUN_TINT (dayCycle.ts:41); disc reads as same warm sun
const DEFAULT_SUN_COLOR = 0xffe8b0;
// mirrors DynamicSky moon visibility pop (DynamicSky.ts:119)
const VISIBILITY_OPACITY = 0.05;

export interface SunDiscOptions {
  /** Disc radius in world units (default 40, matches moon). */
  radius?: number;
  /** sRGB hex sun tint (default 0xffe8b0, dayCycle day sun). */
  color?: number;
}

/**
 * 014 commit 3: additive world-space sun disc mirroring the 010 moon. Reads
 * {@link dayCycleState} each frame, sits along sunDirWorld at SUN_SHELL, and
 * fades by `1 - nightFactor` (visible by day, gone at night — the inverse of
 * the moon's nightFactor fade). Additive blending + depthWrite:false give a
 * glow instead of a solid occluder. Owned by Environment so 010's DynamicSky
 * stays untouched. Pays the 002 "Sun-disc fallback" debt.
 */
export class SunDisc {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;

  constructor(opts: SunDiscOptions = {}) {
    const geo = new THREE.IcosahedronGeometry(opts.radius ?? DEFAULT_SUN_RADIUS, 1);
    this.material = new THREE.MeshBasicMaterial({
      color: opts.color ?? DEFAULT_SUN_COLOR,
      fog: false,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.layers.set(SUN_DISC_LAYER);
    this.mesh.renderOrder = -1;
    this.mesh.visible = false;
    this.group.add(this.mesh);
  }

  /** Position + fade the disc from the live dayCycleState (no dt needed). */
  update(): void {
    this.mesh.position.copy(dayCycleState.sunDirWorld).multiplyScalar(SUN_SHELL);
    const opacity = 1 - dayCycleState.nightFactor;
    this.material.opacity = opacity;
    this.mesh.visible = opacity > VISIBILITY_OPACITY;
  }

  /** Free geometry + material. Idempotent. */
  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
