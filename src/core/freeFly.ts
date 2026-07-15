/**
 * Pure input -> transform math for a free-fly ("noclip" spectator) camera.
 *
 * Split from any WebGL/PointerLockControls wrapper so the pose math is
 * jsdom-testable and free of a GL context: the GL wrapper owns the
 * `pointerlock` listener + mouse-delta capture and the actual THREE camera,
 * and calls {@link stepFreeFly} each frame to advance an immutable state.
 *
 * Conventions match the rest of the engine (right-handed three.js, camera
 * forward along local -Z; see src/core/math.ts FORWARD/RIGHT/UP and
 * src/kart/KartController.ts). yaw/pitch are the source of truth and map to a
 * THREE.Euler(pitch, yaw, 0, "YXZ") orientation, so the wrapper can copy the
 * derived quaternion straight onto the camera. Positive yaw turns the look
 * direction from -Z toward -X; positive pitch tilts it up. Only `three` core
 * math (Euler/Quaternion/Vector3) is imported — no WebGL — which runs under
 * node/jsdom.
 */

import * as THREE from "three";
import { clamp, degToRad, type Vec3 } from "./math";

/**
 * Per-frame intent, already reduced from raw devices by the wrapper.
 * `forward`/`right`/`up` are axis values in [-1, 1] (WASD + Q/E); `forward` > 0
 * flies the way the camera looks, `right` > 0 strafes camera-right, `up` > 0
 * rises along world +Y. `yawDelta`/`pitchDelta` are radians from mouse motion
 * (added to yaw/pitch; pitch is clamped). `boost` scales speed when held.
 */
export interface FreeFlyInput {
  forward: number;
  right: number;
  up: number;
  yawDelta: number;
  pitchDelta: number;
  boost: boolean;
}

/** Immutable camera pose. yaw/pitch (radians) are the orientation source. */
export interface FreeFlyState {
  position: Vec3;
  yaw: number;
  pitch: number;
}

/** Tuning for {@link stepFreeFly}. */
export interface FreeFlyOptions {
  /** Base move speed in world units per second. */
  baseSpeed: number;
  /** Multiplier applied to `baseSpeed` while `boost` is held. */
  boostMultiplier: number;
  /** Max absolute pitch (radians); prevents flipping over the poles. */
  pitchLimit: number;
}

/** Sensible defaults: brisk fly speed, 4x boost, ~89 deg pitch clamp. */
export const FREE_FLY_DEFAULTS: FreeFlyOptions = {
  baseSpeed: 40,
  boostMultiplier: 4,
  pitchLimit: degToRad(89),
};

/** Camera-local forward at yaw=pitch=0 (three.js camera looks down -Z). */
const BASE_FORWARD = new THREE.Vector3(0, 0, -1);

/** Orientation derived from yaw/pitch: a look-direction plus a quaternion. */
export interface FreeFlyOrientation {
  /** Unit look direction in world space (includes pitch). */
  forward: Vec3;
  /** THREE.Euler(pitch, yaw, 0, "YXZ") as a quaternion for the GL camera. */
  quaternion: THREE.Quaternion;
}

/**
 * Build the world-space orientation for a yaw/pitch pair. The quaternion uses
 * "YXZ" order (yaw about world Y, then pitch about local X) so vertical look
 * stays free of roll, matching PointerLockControls' behavior.
 */
export function orientationFromYawPitch(yaw: number, pitch: number): FreeFlyOrientation {
  const euler = new THREE.Euler(pitch, yaw, 0, "YXZ");
  const quaternion = new THREE.Quaternion().setFromEuler(euler);
  const forward = BASE_FORWARD.clone().applyQuaternion(quaternion);
  return { forward: { x: forward.x, y: forward.y, z: forward.z }, quaternion };
}

/** Horizontal camera-right (yaw only) so strafing never tilts vertically. */
function rightFromYaw(yaw: number): Vec3 {
  return { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
}

/**
 * Advance the fly-camera pose by one frame and return a new immutable state.
 *
 * Mouse deltas fold into yaw/pitch (pitch clamped to +/-`pitchLimit`). The move
 * direction sums the full look-forward (`forward`), horizontal camera-right
 * (`right`), and world-up (`up`) axes, is normalized so diagonals are not
 * faster, then advances position by `baseSpeed * (boost ? boostMultiplier : 1)
 * * dt`. Zero input (and zero mouse delta) returns the position unchanged.
 */
export function stepFreeFly(
  state: FreeFlyState,
  input: FreeFlyInput,
  dt: number,
  opts: FreeFlyOptions = FREE_FLY_DEFAULTS,
): FreeFlyState {
  const yaw = state.yaw + input.yawDelta;
  const pitch = clamp(state.pitch + input.pitchDelta, -opts.pitchLimit, opts.pitchLimit);

  const { forward } = orientationFromYawPitch(yaw, pitch);
  const right = rightFromYaw(yaw);

  let mx = forward.x * input.forward + right.x * input.right;
  let my = forward.y * input.forward + input.up;
  let mz = forward.z * input.forward + right.z * input.right;

  const len = Math.hypot(mx, my, mz);
  let position = state.position;
  if (len > 1e-6) {
    const speed = opts.baseSpeed * (input.boost ? opts.boostMultiplier : 1);
    const scale = (speed * dt) / len;
    mx *= scale;
    my *= scale;
    mz *= scale;
    position = {
      x: state.position.x + mx,
      y: state.position.y + my,
      z: state.position.z + mz,
    };
  }

  return { position, yaw, pitch };
}
