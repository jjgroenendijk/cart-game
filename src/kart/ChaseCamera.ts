import * as THREE from 'three';
import { damp, clamp } from '../core/math';

export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private readonly currentPos = new THREE.Vector3();
  private readonly currentLook = new THREE.Vector3();
  private initialized = false;
  private height = 3.2;
  private distance = 7.5;
  private lookAhead = 6;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.1, 2000);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(
    dt: number,
    kartPos: THREE.Vector3,
    kartForward: THREE.Vector3,
    speed: number,
    drifting: boolean,
  ): void {
    const speedNorm = clamp(speed / 30, 0, 1);
    const dist = this.distance + speedNorm * 2.0;
    const height = this.height + speedNorm * 0.5;

    const back = tmpBack.copy(kartForward).multiplyScalar(-dist);
    const desiredPos = tmpDesired
      .copy(kartPos)
      .add(back)
      .add(tmpUp.multiplyScalar(height));

    const lookTarget = tmpLook.copy(kartPos).addScaledVector(kartForward, this.lookAhead);
    lookTarget.y += 1.0;

    const lambda = drifting ? 2.5 : 5.5;
    if (!this.initialized) {
      this.currentPos.copy(desiredPos);
      this.currentLook.copy(lookTarget);
      this.initialized = true;
    } else {
      this.currentPos.lerp(desiredPos, 1 - Math.exp(-lambda * dt));
      this.currentLook.lerp(lookTarget, 1 - Math.exp(-(lambda + 2) * dt));
    }

    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLook);
    void damp;
  }

  get position(): THREE.Vector3 {
    return this.camera.position;
  }
}

const tmpBack = new THREE.Vector3();
const tmpUp = new THREE.Vector3(0, 1, 0);
const tmpDesired = new THREE.Vector3();
const tmpLook = new THREE.Vector3();
