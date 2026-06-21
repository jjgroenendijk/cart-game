import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { lightUniforms, sunWorldPosition, updateLightUniforms } from "./lightUniforms";

describe("lightUniforms", () => {
  it("exposes sun dir / sun dir world / sun color / ambient uniforms with defaults", () => {
    expect(lightUniforms.uSunDir).toBeInstanceOf(Object);
    expect(lightUniforms.uSunDir.value).toBeInstanceOf(THREE.Vector3);
    expect(lightUniforms.uSunDirWorld.value).toBeInstanceOf(THREE.Vector3);
    expect(lightUniforms.uSunColor.value).toBeInstanceOf(THREE.Color);
    expect(lightUniforms.uAmbient.value).toBeInstanceOf(THREE.Color);
  });

  it("default uSunDirWorld is a unit vector (computed from elev/azimuth)", () => {
    expect(lightUniforms.uSunDirWorld.value.length()).toBeCloseTo(1, 6);
  });

  it("updateLightUniforms writes a normalized view-space sun direction + world copy", () => {
    const u = {
      uSunDir: { value: new THREE.Vector3() },
      uSunDirWorld: { value: new THREE.Vector3() },
      uSunColor: { value: new THREE.Color() },
      uAmbient: { value: new THREE.Color() },
    } as typeof lightUniforms;

    const sunWorld = new THREE.Vector3(3, 4, 0); // length 5, not normalized
    const view = new THREE.Matrix4(); // identity -> view dir == world dir
    updateLightUniforms(
      u,
      sunWorld,
      new THREE.Color(0.5, 0.5, 0.5),
      new THREE.Color(0.1, 0.2, 0.3),
      view,
    );

    expect(u.uSunDir.value.length()).toBeCloseTo(1, 6);
    expect(u.uSunDir.value.x).toBeCloseTo(0.6, 4);
    expect(u.uSunDir.value.y).toBeCloseTo(0.8, 4);
    // uSunDirWorld stores the un-normalized input verbatim (source of truth).
    expect(u.uSunDirWorld.value.x).toBeCloseTo(3, 6);
    expect(u.uSunDirWorld.value.y).toBeCloseTo(4, 6);
    expect(u.uSunColor.value.r).toBeCloseTo(0.5, 6);
    expect(u.uAmbient.value.b).toBeCloseTo(0.3, 6);
  });

  it("updateLightUniforms transforms the sun dir by the view matrix", () => {
    const u = {
      uSunDir: { value: new THREE.Vector3() },
      uSunDirWorld: { value: new THREE.Vector3() },
      uSunColor: { value: new THREE.Color() },
      uAmbient: { value: new THREE.Color() },
    } as typeof lightUniforms;

    // 180-degree Y rotation: world +X sun -> view -X.
    const view = new THREE.Matrix4().makeRotationY(Math.PI);
    updateLightUniforms(
      u,
      new THREE.Vector3(1, 0, 0),
      new THREE.Color(1, 1, 1),
      new THREE.Color(0, 0, 0),
      view,
    );
    expect(u.uSunDir.value.x).toBeCloseTo(-1, 4);
    expect(u.uSunDir.value.z).toBeCloseTo(0, 4);
  });
});

describe("sunWorldPosition", () => {
  it("places the target at distance units along the sun direction (anchored at origin)", () => {
    const out = new THREE.Vector3();
    const result = sunWorldPosition(new THREE.Vector3(1, 0, 0), out, 160);
    expect(result).toBe(out);
    expect(out.x).toBeCloseTo(160, 6);
    expect(out.y).toBeCloseTo(0, 6);
    expect(out.z).toBeCloseTo(0, 6);
  });

  it("works for an arbitrary unit sun direction", () => {
    const out = new THREE.Vector3();
    sunWorldPosition(new THREE.Vector3(0, 1, 0), out, 200);
    expect(out.y).toBeCloseTo(200, 6);
  });

  it("preserves direction for non-unit inputs (caller-normalized)", () => {
    // sunWorldPosition does NOT normalize; Renderer reads uSunDirWorld which
    // is initialized from setFromSphericalCoords(1, ...) -> unit length.
    const out = new THREE.Vector3();
    sunWorldPosition(new THREE.Vector3(0, 2, 0), out, 100);
    expect(out.y).toBeCloseTo(200, 6);
  });
});
