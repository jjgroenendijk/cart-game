import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { EmissiveCapturePass, EMISSIVE_LAYER } from "./emissiveCapture";

describe("EmissiveCapturePass", () => {
  function makePass() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.layers.enable(1);
    camera.layers.enable(2);
    return { scene, camera, pass: new EmissiveCapturePass(scene, camera, 64, 48) };
  }

  it("builds a HalfFloat HDR RT in LINEAR (NoColorSpace)", () => {
    const { pass } = makePass();
    expect(pass.emissiveRT).toBeInstanceOf(THREE.WebGLRenderTarget);
    expect(pass.emissiveRT.texture.type).toBe(THREE.HalfFloatType);
    expect(pass.emissiveRT.texture.colorSpace).toBe(THREE.NoColorSpace);
  });

  it("is needsSwap=false (never touches the composer color buffers)", () => {
    expect(makePass().pass.needsSwap).toBe(false);
  });

  it("renders only the emissive layer (3) -> mask = 1 << 3", () => {
    expect(EMISSIVE_LAYER).toBe(3);
    expect(makePass().pass.emissiveLayerMask).toBe(1 << 3);
  });

  it("masks the camera to the emissive layer during render, then restores", () => {
    const { camera, pass } = makePass();
    const prior = camera.layers.mask;
    const renderer = {
      getClearColor: (out: THREE.Color) => out.set(0x123456),
      getClearAlpha: () => 0.5,
      setRenderTarget: vi.fn(),
      setClearColor: vi.fn(),
      clear: vi.fn(),
      render: () => {
        // During the render the camera must see ONLY the emissive layer.
        expect(camera.layers.mask).toBe(1 << 3);
      },
    } as unknown as THREE.WebGLRenderer;

    pass.render(renderer, null, pass.emissiveRT);
    expect(camera.layers.mask).toBe(prior); // restored afterward
  });

  it("clears the emissive RT to black so non-emitters contribute nothing", () => {
    const { pass } = makePass();
    const renderer = {
      getClearColor: (out: THREE.Color) => out.set(0x000000),
      getClearAlpha: () => 1,
      setRenderTarget: vi.fn(),
      setClearColor: vi.fn(),
      clear: vi.fn(),
      render: vi.fn(),
    } as unknown as THREE.WebGLRenderer;
    pass.render(renderer, null, pass.emissiveRT);
    expect(renderer.setClearColor).toHaveBeenCalledWith(0x000000, 0);
  });

  it("setSize resizes the emissive RT", () => {
    const { pass } = makePass();
    pass.setSize(128, 96);
    expect(pass.emissiveRT.width).toBe(128);
    expect(pass.emissiveRT.height).toBe(96);
  });
});
