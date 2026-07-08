import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SkyPosterizePass, posterizeChannel, skyReplaceMix } from "./skyPosterize";

describe("posterizeChannel", () => {
  it("snaps a 0..1 gradient to bands+1 levels (floor(value*bands)/bands)", () => {
    // bands=4 -> levels {0, 0.25, 0.5, 0.75, 1.0} across 0..1
    const steps = [0, 0.1, 0.25, 0.4, 0.5, 0.7, 0.75, 0.99, 1.0].map((v) => posterizeChannel(v, 4));
    expect(steps).toEqual([0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1.0]);
  });

  it("matches cel.ts floor(NdL*bands)/bands convention", () => {
    // Same math, just on a generic channel value instead of NdL.
    expect(posterizeChannel(0.34, 3)).toBeCloseTo(1 / 3, 6);
    expect(posterizeChannel(0.67, 3)).toBeCloseTo(2 / 3, 6);
    expect(posterizeChannel(1.0, 3)).toBeCloseTo(1.0, 6);
  });
});

describe("skyReplaceMix", () => {
  it("dim pixel (lum < 0.75) keeps full replacement (bandMix)", () => {
    expect(skyReplaceMix(0.5, 0.7)).toBeCloseTo(0.7, 6);
  });

  it("bright pixel (lum in smoothstep band) reduces replacement below bandMix", () => {
    expect(skyReplaceMix(0.9, 0.7)).toBeLessThan(0.7);
  });

  it("very bright pixel (lum > 0.95) keeps 0% replacement", () => {
    expect(skyReplaceMix(1.0, 0.7)).toBeCloseTo(0, 6);
  });

  it("bandMix 0 -> no replacement regardless of luminance", () => {
    expect(skyReplaceMix(0.5, 0)).toBe(0);
  });
});

describe("SkyPosterizePass", () => {
  function makePass() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.layers.enable(1);
    camera.layers.enable(2);
    return { scene, camera, pass: new SkyPosterizePass(scene, camera, 64, 48) };
  }

  it("builds a non-sky depth RT with a DepthTexture attachment", () => {
    const { pass } = makePass();
    expect(pass.depthRT).toBeInstanceOf(THREE.WebGLRenderTarget);
    const dt = pass.depthRT.depthTexture;
    expect(dt).toBeInstanceOf(THREE.DepthTexture);
    expect(dt!.format).toBe(THREE.DepthFormat);
    expect(dt!.type).toBe(THREE.UnsignedIntType);
  });

  it("has a depth-only override material (no normal/color output)", () => {
    const { pass } = makePass();
    expect(pass.depthMaterial).toBeInstanceOf(THREE.ShaderMaterial);
    expect(pass.depthMaterial.fragmentShader).toContain("vec4(0.0, 0.0, 0.0, 1.0)");
  });

  it("default nonSkyLayersMask = layers 0+1 (sky on layer 2 masked in)", () => {
    const { pass } = makePass();
    expect(pass.nonSkyLayersMask).toBe(0b011);
  });

  it("defaults to smooth gradient (uSkyBands = 0, uBandMix = 0.7, uSkyStart = 0.55)", () => {
    const { pass } = makePass();
    expect(pass.skyBands).toBe(0);
    expect(pass.bandMix).toBeCloseTo(0.7, 6);
    expect(pass.bandSharpness).toBeCloseTo(0, 6);
    pass.skyBands = 4;
    pass.bandMix = 0.5;
    pass.bandSharpness = 0.8;
    expect(pass.skyBands).toBe(4);
    expect(pass.bandMix).toBeCloseTo(0.5, 6);
    expect(pass.bandSharpness).toBeCloseTo(0.8, 6);
  });

  it("default zenith/horizon tints match Ghibli palette", () => {
    const { pass } = makePass();
    const u = (pass as unknown as { fsQuad: { material: THREE.ShaderMaterial } }).fsQuad.material
      .uniforms;
    expect((u.uSkyZenith.value as THREE.Color).getHex()).toBe(0x4a8fcf);
    expect((u.uSkyHorizon.value as THREE.Color).getHex()).toBe(0xfde8c0);
    expect(u.uSkyStart.value).toBeCloseTo(0.55, 6);
  });

  it("shader composites smooth gradient over readBuffer color, masked by non-sky depth", () => {
    const { pass } = makePass();
    const src = (pass as unknown as { fsQuad: { material: THREE.ShaderMaterial } }).fsQuad.material;
    const u = src.uniforms;
    expect(u.tColor).toBeDefined();
    expect(u.tDepth).toBeDefined();
    expect(u.uSkyBands.value).toBe(0);
    expect(u.uBandSharpness.value).toBeCloseTo(0, 6);
    expect(u.uDepthEps.value).toBeCloseTo(1e-4, 10);
    expect(u.uBandMix.value).toBeCloseTo(0.7, 6);
    expect(u.uSkyStart.value).toBeCloseTo(0.55, 6);
    // GLSL masks sky via depth == 1.0 (cleared far plane).
    expect(src.fragmentShader).toContain("depth >= 1.0 - uDepthEps");
    // Smooth gradient: remap visible-sky vUv.y to [0,1] then mix zenith/horizon.
    expect(src.fragmentShader).toContain("(vUv.y - uSkyStart) / (1.0 - uSkyStart)");
    expect(src.fragmentShader).toContain("mix(uSkyHorizon, uSkyZenith, gradient)");
    expect(src.fragmentShader).toContain("mix(color, synthetic, uBandMix * keepThrough)");
    // Opt-in soft banding guarded by uSkyBands > 0.
    expect(src.fragmentShader).toContain("if (uSkyBands > 0.0)");
    expect(src.fragmentShader).toContain("smoothstep(0.0, 1.0, bandFrac)");
    expect(src.fragmentShader).toContain("mix(soft, hard, uBandSharpness)");
  });

  it("setSize resizes the depth RT", () => {
    const { pass } = makePass();
    pass.setSize(128, 96);
    expect(pass.depthRT.width).toBe(128);
    expect(pass.depthRT.height).toBe(96);
  });

  it("does not throw on dispose", () => {
    const { pass } = makePass();
    expect(() => pass.dispose()).not.toThrow();
  });

  it("exposes a mutable camera so Renderer can rebind it (006 cam swap)", () => {
    const { pass } = makePass();
    const before = pass.camera;
    const next = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    pass.camera = next;
    expect(pass.camera).toBe(next);
    expect(pass.camera).not.toBe(before);
  });
});

describe("SkyPosterizePass post-grade (064)", () => {
  function makePass() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.layers.enable(1);
    camera.layers.enable(2);
    return new SkyPosterizePass(scene, camera, 64, 48);
  }

  function uniforms(pass: SkyPosterizePass) {
    return (pass as unknown as { fsQuad: { material: THREE.ShaderMaterial } }).fsQuad.material
      .uniforms;
  }

  function fragSrc(pass: SkyPosterizePass) {
    return (pass as unknown as { fsQuad: { material: THREE.ShaderMaterial } }).fsQuad.material
      .fragmentShader;
  }

  it("defaults to neutral uniforms (identity output until Renderer wires)", () => {
    const u = uniforms(makePass());
    expect(u.uVignetteStrength.value).toBe(0);
    expect(u.uVignetteRadius.value).toBeCloseTo(0.35, 6);
    expect(u.uGradeSat.value).toBe(0);
    expect(u.uGradeWarm.value).toBe(0);
    expect(u.uGradeLift.value).toBe(0);
  });

  it("declares the 5 new grade+vignette uniforms on the material", () => {
    const u = uniforms(makePass());
    expect(u.uVignetteStrength).toBeDefined();
    expect(u.uVignetteRadius).toBeDefined();
    expect(u.uGradeSat).toBeDefined();
    expect(u.uGradeWarm).toBeDefined();
    expect(u.uGradeLift).toBeDefined();
  });

  it("shader source mirrors the pure grade expressions", () => {
    const src = fragSrc(makePass());
    expect(src).toContain("float gray = dot(color, vec3(0.299, 0.587, 0.114))");
    expect(src).toContain("mix(vec3(gray), color, 1.0 + uGradeSat)");
    expect(src).toContain("color.r += uGradeWarm");
    expect(src).toContain("color.b -= uGradeWarm");
    expect(src).toContain("color += vec3(uGradeLift)");
  });

  it("shader source mirrors the pure vignette expressions", () => {
    const src = fragSrc(makePass());
    expect(src).toContain("length(vUv - vec2(0.5))");
    expect(src).toContain("smoothstep(uVignetteRadius, 0.70710678, vd)");
    expect(src).toContain("1.0 - uVignetteStrength");
  });

  it("grade+vignette come AFTER the sky posterize branch", () => {
    const src = fragSrc(makePass());
    const posterizeEnd = src.indexOf("mix(color, synthetic, uBandMix * keepThrough)");
    const gradeStart = src.indexOf("float gray = dot");
    expect(posterizeEnd).toBeGreaterThanOrEqual(0);
    expect(gradeStart).toBeGreaterThan(posterizeEnd);
  });

  it("getters/setters round-trip all 5 uniforms", () => {
    const pass = makePass();
    pass.vignetteStrength = 0.2;
    pass.vignetteRadius = 0.4;
    pass.gradeSaturation = 0.06;
    pass.gradeWarmth = 0.04;
    pass.gradeLift = 0.01;
    expect(pass.vignetteStrength).toBeCloseTo(0.2, 6);
    expect(pass.vignetteRadius).toBeCloseTo(0.4, 6);
    expect(pass.gradeSaturation).toBeCloseTo(0.06, 6);
    expect(pass.gradeWarmth).toBeCloseTo(0.04, 6);
    expect(pass.gradeLift).toBeCloseTo(0.01, 6);
  });
});

describe("SkyPosterizePass sun halo (074)", () => {
  function makePass() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.layers.enable(1);
    camera.layers.enable(2);
    return new SkyPosterizePass(scene, camera, 64, 48);
  }

  function uniforms(pass: SkyPosterizePass) {
    return (pass as unknown as { fsQuad: { material: THREE.ShaderMaterial } }).fsQuad.material
      .uniforms;
  }

  function fragSrc(pass: SkyPosterizePass) {
    return (pass as unknown as { fsQuad: { material: THREE.ShaderMaterial } }).fsQuad.material
      .fragmentShader;
  }

  it("declares the 6 new sun-halo uniforms on the material", () => {
    const u = uniforms(makePass());
    expect(u.uSunUv).toBeDefined();
    expect(u.uSunVisible).toBeDefined();
    expect(u.uSunGlowRadius).toBeDefined();
    expect(u.uSunGlowIntensity).toBeDefined();
    expect(u.uSunGlowColor).toBeDefined();
    expect(u.uAspect).toBeDefined();
  });

  it("defaults are neutral (identity output until Renderer wires)", () => {
    const u = uniforms(makePass());
    expect((u.uSunUv.value as THREE.Vector2).x).toBeCloseTo(0.5, 6);
    expect((u.uSunUv.value as THREE.Vector2).y).toBeCloseTo(0.5, 6);
    expect(u.uSunVisible.value).toBe(0);
    expect(u.uSunGlowRadius.value).toBeCloseTo(0.25, 6);
    expect(u.uSunGlowIntensity.value).toBe(0);
    expect((u.uSunGlowColor.value as THREE.Color).getHex()).toBe(0xff9050);
    expect(u.uAspect.value).toBeCloseTo(1, 6);
  });

  it("shader source contains the aspect-corrected delta", () => {
    const src = fragSrc(makePass());
    expect(src).toContain("sunDelta.x /= uAspect");
    expect(src).toContain("float sunDist = length(sunDelta)");
  });

  it("shader source contains the visibility + intensity guard", () => {
    const src = fragSrc(makePass());
    expect(src).toContain("uSunVisible > 0.5");
    expect(src).toContain("uSunGlowIntensity > 0.0");
  });

  it("shader source contains the halo and hotspot gaussian falloffs", () => {
    const src = fragSrc(makePass());
    expect(src).toContain("exp(-sunDist * sunDist");
    // Hotspot uses ~1/16 the radius^2 (tighter gaussian).
    expect(src).toContain("uSunGlowRadius * uSunGlowRadius * 0.0625");
  });

  it("shader source adds glow into synthetic before the bandMix", () => {
    const src = fragSrc(makePass());
    expect(src).toContain("synthetic += glow");
    // Ordering: glow add comes after the gradient mix, before bandMix.
    const gradientMix = src.indexOf("mix(uSkyHorizon, uSkyZenith, gradient)");
    const glowAdd = src.indexOf("synthetic += glow");
    const bandMix = src.indexOf("mix(color, synthetic, uBandMix * keepThrough)");
    expect(gradientMix).toBeGreaterThanOrEqual(0);
    expect(glowAdd).toBeGreaterThan(gradientMix);
    expect(bandMix).toBeGreaterThan(glowAdd);
  });

  it("guard string present -> intensity 0 is a byte-identical no-op", () => {
    const src = fragSrc(makePass());
    // The if-guard IS the identity guarantee: at intensity 0 the whole
    // additive term is skipped, so synthetic is untouched.
    expect(src).toContain("if (uSunVisible > 0.5 && uSunGlowIntensity > 0.0)");
  });

  it("scalar getters/setters round-trip", () => {
    const pass = makePass();
    pass.sunVisible = 1;
    pass.sunGlowRadius = 0.4;
    pass.sunGlowIntensity = 0.7;
    pass.aspect = 1.5;
    expect(pass.sunVisible).toBeCloseTo(1, 6);
    expect(pass.sunGlowRadius).toBeCloseTo(0.4, 6);
    expect(pass.sunGlowIntensity).toBeCloseTo(0.7, 6);
    expect(pass.aspect).toBeCloseTo(1.5, 6);
  });

  it("sunUv getter returns the live mutable uniform Vector2", () => {
    const pass = makePass();
    const u = uniforms(pass);
    const ref = pass.sunUv;
    expect(ref).toBe(u.uSunUv.value);
    ref.copy(new THREE.Vector2(0.3, 0.8));
    expect((u.uSunUv.value as THREE.Vector2).x).toBeCloseTo(0.3, 6);
    expect((u.uSunUv.value as THREE.Vector2).y).toBeCloseTo(0.8, 6);
  });

  it("sunGlowColor getter returns the live mutable uniform Color", () => {
    const pass = makePass();
    const u = uniforms(pass);
    const ref = pass.sunGlowColor;
    expect(ref).toBe(u.uSunGlowColor.value);
    ref.set(0x00ff00);
    expect((u.uSunGlowColor.value as THREE.Color).getHex()).toBe(0x00ff00);
  });
});

describe("SkyPosterizePass luminance keep-through (3a)", () => {
  function fragSrc() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.layers.enable(1);
    camera.layers.enable(2);
    const pass = new SkyPosterizePass(scene, camera, 64, 48);
    return (pass as unknown as { fsQuad: { material: THREE.ShaderMaterial } }).fsQuad.material
      .fragmentShader;
  }

  it("shader source contains the keep-through luminance guard", () => {
    const src = fragSrc();
    expect(src).toContain("keepThrough");
    expect(src).toContain("smoothstep(0.75, 0.95");
  });

  it("shader source multiplies bandMix by keepThrough", () => {
    const src = fragSrc();
    expect(src).toContain("uBandMix * keepThrough");
  });
});

describe("SkyPosterizePass godrays (074)", () => {
  function makePass() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.layers.enable(1);
    camera.layers.enable(2);
    return new SkyPosterizePass(scene, camera, 64, 48);
  }

  function uniforms(pass: SkyPosterizePass) {
    return (pass as unknown as { fsQuad: { material: THREE.ShaderMaterial } }).fsQuad.material
      .uniforms;
  }

  function fragSrc(pass: SkyPosterizePass) {
    return (pass as unknown as { fsQuad: { material: THREE.ShaderMaterial } }).fsQuad.material
      .fragmentShader;
  }

  it("shader source declares the godray uniforms", () => {
    const src = fragSrc(makePass());
    expect(src).toContain("uniform float uGodrayStrength;");
    expect(src).toContain("uniform vec3 uGodrayTint;");
  });

  it("default godrayStrength is 0 and godrayTint is a THREE.Color", () => {
    const u = uniforms(makePass());
    expect(u.uGodrayStrength.value).toBe(0);
    expect(u.uGodrayTint.value).toBeInstanceOf(THREE.Color);
  });

  it("godrayStrength getter/setter round-trips", () => {
    const pass = makePass();
    expect(pass.godrayStrength).toBe(0);
    pass.godrayStrength = 0.5;
    expect(pass.godrayStrength).toBeCloseTo(0.5, 6);
  });

  it("godrayTint getter returns the live mutable uniform Color", () => {
    const pass = makePass();
    const u = uniforms(pass);
    const ref = pass.godrayTint;
    expect(ref).toBe(u.uGodrayTint.value);
    ref.set(0x00ff00);
    expect((u.uGodrayTint.value as THREE.Color).getHex()).toBe(0x00ff00);
  });

  it("shader source contains the 24-tap march loop", () => {
    const src = fragSrc(makePass());
    expect(src).toContain("for (int i = 0; i < 24; i++)");
  });

  it("shader source guards the march on uGodrayStrength > 0.0", () => {
    const src = fragSrc(makePass());
    expect(src).toContain("if (uGodrayStrength > 0.0)");
  });
});
