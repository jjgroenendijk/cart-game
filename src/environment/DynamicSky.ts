import * as THREE from "three";
import {
  computeDayCycle,
  dayCycleState,
  type DayCycleOptions,
  type DayCycleState,
} from "./dayCycle";
import { makeRNG } from "../core/rng";

const TAU = Math.PI * 2;

const SKY_LAYER = 0;
const STAR_SHELL = 1500; // inside far plane (2000), beyond fog far (~360)
const MOON_SHELL = 1500; // anti-sun mirror distance for the moon disc
const DEFAULT_STAR_COUNT = 600; // 010 plan Defaults
const DEFAULT_STAR_SEED = 987654;
const DEFAULT_MOON_RADIUS = 40; // cel-cartoony oversized disc
const DEFAULT_DAY_LENGTH = 120; // mirrors dayCycle DEFAULT_DAY_LENGTH

export interface DynamicSkyOptions extends DayCycleOptions {
  /** Star point count on the shell (default 600). */
  starCount?: number;
  /** Deterministic seed for star placement (default 987654). */
  starSeed?: number;
  /** Moon disc radius in world units (default 40). */
  moonRadius?: number;
}

/**
 * 010 commit 3: the day-cycle driver. Advances the clock each frame, calls
 * {@link computeDayCycle}, and REPLACES the {@link dayCycleState} singleton
 * fields — its documented contract (dayCycle.ts:195-197) is that Vector3/Color
 * refs are swapped to fresh values, not mutated in place, so consumers like the
 * Renderer copy values fresh each frame. Also owns a procedural star field
 * (THREE.Points, seeded uniform-on-sphere) and a low-poly moon disc
 * (MeshBasicMaterial). Both sit on render layer 0 with fog:false and
 * renderOrder -1: layer 0 keeps them visible through the sky-posterize depth
 * mask while skipping the Sobel outline (layer 1) and sky-gradient replace
 * (layer 2); fog:false stops scene fog from erasing them at the 1500-unit shell
 * distance.
 *
 * The moon mirrors the anti-sun direction: when the sun is below the horizon
 * the moon is above it, so the single night DirectionalLight approximates
 * moonlight without a separate moon light vector.
 */
export class DynamicSky {
  readonly group = new THREE.Group();
  private elapsed = 0;
  private readonly dayLength: number;
  private readonly opts: DayCycleOptions;
  private readonly stars: THREE.Points;
  private readonly starsMaterial: THREE.PointsMaterial;
  private readonly moon: THREE.Mesh;
  private readonly moonMaterial: THREE.MeshBasicMaterial;

  constructor(opts: DynamicSkyOptions = {}) {
    this.opts = opts;
    this.dayLength = opts.dayLengthSeconds ?? DEFAULT_DAY_LENGTH;
    // Start the clock at the requested phase (default 0 = dawn). The game
    // passes daytimeStartSeconds() so a session opens lit, not at dawn.
    this.elapsed = opts.dayStartSeconds ?? 0;

    const starCount = opts.starCount ?? DEFAULT_STAR_COUNT;
    const rng = makeRNG(opts.starSeed ?? DEFAULT_STAR_SEED);
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      // Uniform sphere sample: acos(2v-1) keeps area-uniform density.
      const u = rng.next();
      const v = rng.next();
      const theta = TAU * u;
      const phi = Math.acos(2 * v - 1);
      const sp = Math.sin(phi);
      const o = i * 3;
      positions[o] = STAR_SHELL * sp * Math.cos(theta);
      positions[o + 1] = STAR_SHELL * Math.cos(phi);
      positions[o + 2] = STAR_SHELL * sp * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.starsMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 24,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    this.stars = new THREE.Points(starGeo, this.starsMaterial);
    this.stars.layers.set(SKY_LAYER);
    this.stars.renderOrder = -1;
    this.stars.visible = false;
    this.group.add(this.stars);

    const moonGeo = new THREE.IcosahedronGeometry(opts.moonRadius ?? DEFAULT_MOON_RADIUS, 1);
    this.moonMaterial = new THREE.MeshBasicMaterial({
      color: 0xeef2ff,
      fog: false,
      transparent: true,
      opacity: 0,
    });
    this.moon = new THREE.Mesh(moonGeo, this.moonMaterial);
    this.moon.layers.set(SKY_LAYER);
    this.moon.renderOrder = -1;
    this.moon.visible = false;
    this.group.add(this.moon);
  }

  /**
   * Advance the clock by dt; recompute the day-cycle state and write the
   * singleton; fade + position the star field and moon disc by nightFactor.
   */
  update(dt: number): void {
    this.elapsed = (this.elapsed + dt) % this.dayLength;
    const fresh = computeDayCycle(this.elapsed, this.opts);
    this.writeState(fresh, dayCycleState);

    const nf = fresh.nightFactor;
    this.starsMaterial.opacity = nf;
    this.stars.visible = nf > 0.001;
    this.moonMaterial.opacity = nf;
    this.moon.visible = nf > 0.05; // pops in slightly after stars begin
    this.moon.position.copy(fresh.sunDirWorld).multiplyScalar(-MOON_SHELL);
  }

  /** Free star + moon geometry and materials. Idempotent. */
  dispose(): void {
    this.stars.geometry.dispose();
    this.starsMaterial.dispose();
    this.moon.geometry.dispose();
    this.moonMaterial.dispose();
  }

  /**
   * Copy every field of `src` onto `dst` by REFERENCE replacement (not in-place
   * copy). The {@link dayCycleState} contract (dayCycle.ts:195-197) requires
   * Vector3/Color fields be swapped to fresh refs each write so consumers that
   * retain a field value copy it rather than alias the singleton's mutating
   * storage. Scalars are plain assigns.
   */
  private writeState(src: DayCycleState, dst: DayCycleState): void {
    dst.elapsed = src.elapsed;
    dst.sunElevationDeg = src.sunElevationDeg;
    dst.sunAzimuthDeg = src.sunAzimuthDeg;
    dst.sunDirWorld = src.sunDirWorld;
    dst.phase = src.phase;
    dst.nightFactor = src.nightFactor;
    dst.sunColor = src.sunColor;
    dst.sunIntensity = src.sunIntensity;
    dst.ambientColor = src.ambientColor;
    dst.ambientIntensity = src.ambientIntensity;
    dst.skyZenith = src.skyZenith;
    dst.skyHorizon = src.skyHorizon;
    dst.fogColor = src.fogColor;
    dst.fogNear = src.fogNear;
    dst.fogFar = src.fogFar;
    dst.shadowFade = src.shadowFade;
  }
}
