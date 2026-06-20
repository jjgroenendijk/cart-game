import * as THREE from "three";

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const damp = (a: number, b: number, lambda: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-lambda * dt));

export const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);

export const degToRad = (d: number): number => (d * Math.PI) / 180;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const tmpV3 = new THREE.Vector3();
export const tmpQuat = new THREE.Quaternion();
export const tmpMat4 = new THREE.Matrix4();
export const UP = new THREE.Vector3(0, 1, 0);
export const FORWARD = new THREE.Vector3(0, 0, -1);
export const RIGHT = new THREE.Vector3(1, 0, 0);
