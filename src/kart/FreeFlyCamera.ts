import * as THREE from "three";
import {
  orientationFromYawPitch,
  stepFreeFly,
  type FreeFlyInput,
  type FreeFlyState,
} from "../core/freeFly";

/**
 * GL/DOM wrapper around the pure free-fly math (`src/core/freeFly.ts`) for a
 * dev "noclip" spectator camera. Owns a THREE.PerspectiveCamera and the raw
 * device plumbing the pure step deliberately excludes: WASD + Q/E + Shift key
 * state, mouse-delta capture, and pointer lock. Each frame it reduces the held
 * keys and accumulated mouse motion into a {@link FreeFlyInput}, advances an
 * immutable {@link FreeFlyState} via `stepFreeFly`, and copies the pose onto
 * the camera.
 *
 * A persistent window `keydown` toggle on `KeyC` enters/exits free-fly; the
 * movement listeners (window key + document mouse) attach only while active.
 * Pointer-lock calls are guarded (`?.`) so the wrapper stays inert under jsdom
 * where those APIs are undefined — the pose math still runs, so tests can drive
 * key/mouse events without a GL context.
 */

/** Mouse look sensitivity in radians per pixel of pointer motion. */
const MOUSE_SENSITIVITY = 0.0022;

/** Elevated vantage looking slightly down, matching a spectator entry pose. */
const INITIAL_STATE: FreeFlyState = {
  position: { x: 0, y: 30, z: 40 },
  yaw: 0,
  pitch: -0.35,
};

/** Keyboard `code`s the movement reducer reads each frame. */
const MOVE_CODES = new Set([
  "KeyW",
  "KeyS",
  "KeyA",
  "KeyD",
  "KeyE",
  "KeyQ",
  "ShiftLeft",
  "ShiftRight",
]);

export class FreeFlyCamera {
  readonly camera: THREE.PerspectiveCamera;

  private readonly container: HTMLElement;
  private state: FreeFlyState = { ...INITIAL_STATE };
  private isActive = false;

  private readonly pressed = new Set<string>();
  private mouseDx = 0;
  private mouseDy = 0;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (MOVE_CODES.has(e.code)) this.pressed.add(e.code);
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.pressed.delete(e.code);
  };
  private readonly onMouseMove = (e: MouseEvent): void => {
    this.mouseDx += e.movementX;
    this.mouseDy += e.movementY;
  };
  private readonly onToggleKey = (e: KeyboardEvent): void => {
    if (e.code === "KeyC") this.toggle();
  };

  constructor(container: HTMLElement, opts?: { aspect?: number }) {
    this.container = container;
    const aspect = opts?.aspect ?? window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 2000);
    this.writePose();
    // Persistent toggle: stays attached for the wrapper's lifetime.
    window.addEventListener("keydown", this.onToggleKey);
  }

  get active(): boolean {
    return this.isActive;
  }

  setActive(on: boolean): void {
    if (on === this.isActive) return;
    this.isActive = on;
    if (on) {
      this.pressed.clear();
      this.mouseDx = 0;
      this.mouseDy = 0;
      window.addEventListener("keydown", this.onKeyDown);
      window.addEventListener("keyup", this.onKeyUp);
      document.addEventListener("mousemove", this.onMouseMove);
      this.container.requestPointerLock?.();
    } else {
      window.removeEventListener("keydown", this.onKeyDown);
      window.removeEventListener("keyup", this.onKeyUp);
      document.removeEventListener("mousemove", this.onMouseMove);
      document.exitPointerLock?.();
    }
  }

  toggle(): void {
    this.setActive(!this.isActive);
  }

  update(dt: number): void {
    if (!this.isActive) return;
    const input: FreeFlyInput = {
      forward: axis(this.pressed, "KeyW", "KeyS"),
      right: axis(this.pressed, "KeyD", "KeyA"),
      up: axis(this.pressed, "KeyE", "KeyQ"),
      // Mouse right (movementX > 0) turns look right, which is a yaw DECREASE
      // (positive yaw turns toward -X); mouse up (movementY < 0) pitches up.
      yawDelta: -this.mouseDx * MOUSE_SENSITIVITY,
      pitchDelta: -this.mouseDy * MOUSE_SENSITIVITY,
      boost: this.pressed.has("ShiftLeft") || this.pressed.has("ShiftRight"),
    };
    this.mouseDx = 0;
    this.mouseDy = 0;
    this.state = stepFreeFly(this.state, input, dt);
    this.writePose();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.setActive(false);
    window.removeEventListener("keydown", this.onToggleKey);
  }

  /** Copy the current pose (position + yaw/pitch orientation) onto the camera. */
  private writePose(): void {
    const { position, yaw, pitch } = this.state;
    this.camera.position.set(position.x, position.y, position.z);
    this.camera.quaternion.copy(orientationFromYawPitch(yaw, pitch).quaternion);
  }
}

/** Reduce a pos/neg key pair to a [-1, 1] axis value. */
function axis(pressed: Set<string>, pos: string, neg: string): number {
  return (pressed.has(pos) ? 1 : 0) - (pressed.has(neg) ? 1 : 0);
}
