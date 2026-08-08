import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { DepthCapturePass } from "./depthCapture";

describe("DepthCapturePass", () => {
  function makePass() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.layers.enable(1);
    camera.layers.enable(2);
    return { scene, camera, pass: new DepthCapturePass(scene, camera, 64, 48) };
  }

  it("builds a portable RGBA8 packed-depth RT without a native DepthTexture", () => {
    const { pass } = makePass();
    expect(pass.depthRT).toBeInstanceOf(THREE.WebGLRenderTarget);
    expect(pass.depthRT.texture.format).toBe(THREE.RGBAFormat);
    expect(pass.depthRT.texture.type).toBe(THREE.UnsignedByteType);
    expect(pass.depthRT.texture.colorSpace).toBe(THREE.NoColorSpace);
    expect(pass.depthRT.depthTexture).toBeNull();
  });

  it("uses Three's instancing-aware MeshDepthMaterial with RGBA packing", () => {
    const { pass } = makePass();
    expect(pass.depthMaterial).toBeInstanceOf(THREE.MeshDepthMaterial);
    expect(pass.depthMaterial.depthPacking).toBe(THREE.RGBADepthPacking);
    expect(pass.depthMaterial.blending).toBe(THREE.NoBlending);
  });

  it("exposes depthRT.texture as the shared packed-depth handle", () => {
    const { pass } = makePass();
    expect(pass.depthTexture).toBe(pass.depthRT.texture);
    expect(pass.depthTexture).toBeInstanceOf(THREE.Texture);
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

    pass.render(renderer, null, pass.depthRT);

    expect(visibleDuringRender).toBe(false);
    expect(particles.visible).toBe(true);
  });

  it("restores visibility, override material, and camera layers when rendering throws", () => {
    const { scene, camera, pass } = makePass();
    const particles = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ depthWrite: false }),
    );
    const priorOverride = new THREE.MeshBasicMaterial();
    const priorMask = camera.layers.mask;
    scene.add(particles);
    scene.overrideMaterial = priorOverride;
    const renderer = {
      getClearColor: (out: THREE.Color) => out.set(0x123456),
      getClearAlpha: () => 0.5,
      setRenderTarget: vi.fn(),
      setClearColor: vi.fn(),
      clear: vi.fn(),
      render: () => {
        throw new Error("render failed");
      },
    } as unknown as THREE.WebGLRenderer;

    expect(() => pass.render(renderer, null, pass.depthRT)).toThrow("render failed");
    expect(particles.visible).toBe(true);
    expect(scene.overrideMaterial).toBe(priorOverride);
    expect(camera.layers.mask).toBe(priorMask);
  });

  it("does not disturb the composer color buffers (needsSwap = false)", () => {
    const { pass } = makePass();
    expect(pass.needsSwap).toBe(false);
  });

  it("setSize resizes the depth RT and keeps the same texture instance", () => {
    const { pass } = makePass();
    const before = pass.depthTexture;
    pass.setSize(128, 96);
    expect(pass.depthRT.width).toBe(128);
    expect(pass.depthRT.height).toBe(96);
    // The shared handle stays the identical object so consumers' tDepth ref holds.
    expect(pass.depthTexture).toBe(before);
  });

  it("exposes a mutable camera so Renderer can rebind it (006 cam swap)", () => {
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
