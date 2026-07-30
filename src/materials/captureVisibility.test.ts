import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { suppressNonDepthWritingObjects } from "./captureVisibility";

describe("suppressNonDepthWritingObjects", () => {
  it("hides visible drawables whose material opts out of depth writes", () => {
    const scene = new THREE.Scene();
    const particles = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ depthWrite: false }),
    );
    scene.add(particles);

    const restore = suppressNonDepthWritingObjects(scene);
    expect(particles.visible).toBe(false);

    restore();
    expect(particles.visible).toBe(true);
  });

  it("preserves depth-writing and already-hidden objects", () => {
    const scene = new THREE.Scene();
    const solid = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const alreadyHidden = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ depthWrite: false }),
    );
    alreadyHidden.visible = false;
    scene.add(solid, alreadyHidden);

    const restore = suppressNonDepthWritingObjects(scene);
    expect(solid.visible).toBe(true);
    expect(alreadyHidden.visible).toBe(false);

    restore();
    expect(solid.visible).toBe(true);
    expect(alreadyHidden.visible).toBe(false);
  });

  it("only suppresses a multi-material drawable when every material opts out", () => {
    const scene = new THREE.Scene();
    const mixed = new THREE.Mesh(new THREE.BufferGeometry(), [
      new THREE.MeshBasicMaterial({ depthWrite: false }),
      new THREE.MeshBasicMaterial({ depthWrite: true }),
    ]);
    const overlay = new THREE.Mesh(new THREE.BufferGeometry(), [
      new THREE.MeshBasicMaterial({ depthWrite: false }),
      new THREE.MeshBasicMaterial({ depthWrite: false }),
    ]);
    scene.add(mixed, overlay);

    const restore = suppressNonDepthWritingObjects(scene);
    expect(mixed.visible).toBe(true);
    expect(overlay.visible).toBe(false);

    restore();
    expect(mixed.visible).toBe(true);
    expect(overlay.visible).toBe(true);
  });
});
