import * as THREE from "three";

/**
 * 006 cinematic high-orbit camera for the title screen. Slowly yaws around a
 * fixed scenic track point at a large radius + altitude so the world sweeps
 * under a high cam (kart small / off-frame). All-layers PerspectiveCamera (it
 * sees the solid, terrain, and sky layers). No kart-physics dependency.
 *
 * The target is sampled ONCE (by Game, from SplineTrack.getPoint at
 * construction) and passed in; MenuCamera never touches the spline per frame.
 * A separate camera object from ChaseCamera keeps ChaseCamera.initialized
 * false until the first racing frame, so it snaps to the kart on race start.
 */

export interface MenuCameraOptions {
  aspect: number;
  /** Scenic orbit focus point (e.g. SplineTrack.getPoint(0.5)). Default origin. */
  target?: THREE.Vector3;
  /** Orbit radius (m). Default 28. */
  radius?: number;
  /** Orbit altitude above the target (m). Default 18. */
  altitude?: number;
  /** Yaw rate (rad/s). Default 0.12. */
  yawSpeed?: number;
  /** Vertical bob amplitude (m). Default 1.0. */
  bobAmp?: number;
  /** Vertical bob period (s). Default 8. */
  bobPeriod?: number;
  /** Camera field of view (deg). Default 55. */
  fov?: number;
}

const DEFAULT_RADIUS = 28;
const DEFAULT_ALTITUDE = 18;
const DEFAULT_YAW_SPEED = 0.12;
const DEFAULT_BOB_AMP = 1.0;
const DEFAULT_BOB_PERIOD = 8;
const DEFAULT_FOV = 55;

export class MenuCamera {
  readonly camera: THREE.PerspectiveCamera;
  private readonly target = new THREE.Vector3();
  private readonly radius: number;
  private readonly altitude: number;
  private readonly yawSpeed: number;
  private readonly bobAmp: number;
  private readonly bobPeriod: number;
  private yaw = 0;
  private time = 0;

  constructor(opts: MenuCameraOptions) {
    this.radius = opts.radius ?? DEFAULT_RADIUS;
    this.altitude = opts.altitude ?? DEFAULT_ALTITUDE;
    this.yawSpeed = opts.yawSpeed ?? DEFAULT_YAW_SPEED;
    this.bobAmp = opts.bobAmp ?? DEFAULT_BOB_AMP;
    this.bobPeriod = opts.bobPeriod ?? DEFAULT_BOB_PERIOD;
    if (opts.target) this.target.copy(opts.target);

    this.camera = new THREE.PerspectiveCamera(opts.fov ?? DEFAULT_FOV, opts.aspect, 0.1, 4000);
    // See the solid (0), terrain (1), and sky (2) layers.
    this.camera.layers.enable(1);
    this.camera.layers.enable(2);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.yaw += this.yawSpeed * dt;
    this.time += dt;
    const bob = this.bobAmp * Math.sin((2 * Math.PI * this.time) / this.bobPeriod);
    const cx = this.target.x + Math.cos(this.yaw) * this.radius;
    const cz = this.target.z + Math.sin(this.yaw) * this.radius;
    const cy = this.target.y + this.altitude + bob;
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(this.target);
  }
}
