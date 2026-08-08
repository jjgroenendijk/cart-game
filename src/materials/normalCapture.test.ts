import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { NormalCapturePass } from "./normalCapture";

describe("NormalCapturePass", () => {
  function makePass() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.layers.enable(1);
    camera.layers.enable(2);
    return { scene, camera, pass: new NormalCapturePass(scene, camera, 64, 48) };
  }

  it("builds a portable RGBA8 non-sky normal RT", () => {
    const { pass } = makePass();
    expect(pass.normalRT).toBeInstanceOf(THREE.WebGLRenderTarget);
    expect(pass.normalRT.texture.format).toBe(THREE.RGBAFormat);
    expect(pass.normalRT.texture.type).toBe(THREE.UnsignedByteType);
    expect(pass.normalRT.texture.colorSpace).toBe(THREE.NoColorSpace);
  });

  it("uses Three's instancing-aware normal override material", () => {
    const { pass } = makePass();
    expect(pass.normalMaterial).toBeInstanceOf(THREE.MeshNormalMaterial);
    expect(pass.normalMaterial.blending).toBe(THREE.NoBlending);
  });

  it("exposes normalRT.texture as the shared normalTexture handle", () => {
    const { pass } = makePass();
    expect(pass.normalTexture).toBe(pass.normalRT.texture);
  });

  it("captures combined layers 0+1 (props/karts/weather + terrain)", () => {
    const { pass } = makePass();
    expect(pass.nonSkyLayersMask).toBe(0b011);
  });

  it("suppresses depthWrite:false drawables only during the override render", () => {
    const { scene, pass } = makePass();
    const particles = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ depthWrite: false }),
    );
    scene.add(particles);
    let visibleDuringRender = true;
    const renderer = {
      getClearColor: (out: THREE.Color) => out.set(0x123456),
      getClearAlpha: () => 0.5,
      setRenderTarget: vi.fn(),
      setClearColor: vi.fn(),
      clear: vi.fn(),
      render: () => {
        visibleDuringRender = particles.visible;
      },
    } as unknown as THREE.WebGLRenderer;

    pass.render(renderer, null, pass.normalRT);

    expect(visibleDuringRender).toBe(false);
    expect(particles.visible).toBe(true);
  });

  it("does not disturb the composer color buffers (needsSwap = false)", () => {
    const { pass } = makePass();
    expect(pass.needsSwap).toBe(false);
  });

  it("setSize resizes the normal RT and keeps the same texture instance", () => {
    const { pass } = makePass();
    const before = pass.normalTexture;
    pass.setSize(128, 96);
    expect(pass.normalRT.width).toBe(128);
    expect(pass.normalRT.height).toBe(96);
    // The shared handle stays the identical object so consumers' tNormal ref holds.
    expect(pass.normalTexture).toBe(before);
  });

  it("exposes a mutable camera so Renderer can rebind it", () => {
    const { pass } = makePass();
    const next = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    expect(() => {
      pass.mainCamera = next;
    }).not.toThrow();
  });

  it("does not throw on dispose", () => {
    const { pass } = makePass();
    expect(() => pass.dispose()).not.toThrow();
  });
});
