import * as THREE from "three";
import { dayCycleState } from "./dayCycle";

const SUN_DISC_LAYER = 0; // same as DynamicSky moon/stars
const SUN_SHELL = 1500; // matches DynamicSky MOON_SHELL/STAR_SHELL
const DEFAULT_SUN_RADIUS = 40; // matches DynamicSky DEFAULT_MOON_RADIUS
// dayCycle day SUN_TINT (dayCycle.ts:41); disc reads as same warm sun
const DEFAULT_SUN_COLOR = 0xffe8b0;
// mirrors DynamicSky moon visibility pop (DynamicSky.ts:119)
const VISIBILITY_OPACITY = 0.05;

/**
 * 074: corona scale + dim factor. The corona is a larger, dimmer additive
 * halo around the bright core so UnrealBloomPass has a soft gradient to
 * bloom instead of a single hard-edged flat dot. Tuned for F3 visual pass.
 */
export const CORONA_SCALE = 2.5;
export const CORONA_OPACITY = 0.25;

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
 *
 * 074 commit 5: split into a bright CORE + a larger dimmer CORONA halo so
 * bloom reads a glowing core rather than a hard flat dot. Both meshes share
 * one position + color, stay additive, layer 0, fog:false, depthWrite:false,
 * and fade by `1 - nightFactor`. Child order is load-bearing:
 * `group.children = [core, corona]` (core at index 0 — Environment reaches
 * it there). Corona renderOrder -2 draws before the core (-1) so the bright
 * core composites on top.
 */
export class SunDisc {
  readonly group = new THREE.Group();
  private readonly coreMesh: THREE.Mesh;
  private readonly coronaMesh: THREE.Mesh;
  private readonly coreMaterial: THREE.MeshBasicMaterial;
  private readonly coronaMaterial: THREE.MeshBasicMaterial;

  constructor(opts: SunDiscOptions = {}) {
    const radius = opts.radius ?? DEFAULT_SUN_RADIUS;
    const color = opts.color ?? DEFAULT_SUN_COLOR;
    // Core: bright dot, same as pre-074.
    this.coreMaterial = new THREE.MeshBasicMaterial({
      color,
      fog: false,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.coreMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), this.coreMaterial);
    this.coreMesh.layers.set(SUN_DISC_LAYER);
    this.coreMesh.renderOrder = -1;
    this.coreMesh.visible = false;
    // Corona: larger, dimmer additive halo -> soft bloom gradient.
    this.coronaMaterial = new THREE.MeshBasicMaterial({
      color,
      fog: false,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.coronaMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(radius * CORONA_SCALE, 1),
      this.coronaMaterial,
    );
    this.coronaMesh.layers.set(SUN_DISC_LAYER);
    this.coronaMesh.renderOrder = -2;
    this.coronaMesh.visible = false;
    // Order matters: core at index 0 (see class doc).
    this.group.add(this.coreMesh, this.coronaMesh);
  }

  /** Position + fade the core + corona from the live dayCycleState. */
  update(): void {
    const pos = dayCycleState.sunDirWorld.clone().multiplyScalar(SUN_SHELL);
    this.coreMesh.position.copy(pos);
    this.coronaMesh.position.copy(pos);
    // Unclamped by design (see test): 1 - nightFactor can fall outside [0,1].
    const coreOpacity = 1 - dayCycleState.nightFactor;
    this.coreMaterial.opacity = coreOpacity;
    this.coronaMaterial.opacity = coreOpacity * CORONA_OPACITY;
    const visible = coreOpacity > VISIBILITY_OPACITY;
    this.coreMesh.visible = visible;
    this.coronaMesh.visible = visible;
  }

  /** Free both geometries + both materials. Idempotent. */
  dispose(): void {
    this.coreMesh.geometry.dispose();
    this.coronaMesh.geometry.dispose();
    this.coreMaterial.dispose();
    this.coronaMaterial.dispose();
  }
}
