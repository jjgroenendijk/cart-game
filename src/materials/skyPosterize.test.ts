import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SkyPosterizePass, posterizeChannel, skyGradientT } from "./skyPosterize";

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

describe("SkyPosterizePass", () => {
  function makePass() {
    const depthTexture = new THREE.Texture();
    return { depthTexture, pass: new SkyPosterizePass(depthTexture) };
  }

  it("sky mask + god-ray march both read one combined sceneDepth (single tDepth)", () => {
    const { pass } = makePass();
    const src = (pass as unknown as { fsQuad: { material: THREE.ShaderMaterial } }).fsQuad.material;
    // sceneDepth reads the single shared layers-0+1 depth buffer.
    expect(src.fragmentShader).toContain("#include <packing>");
    expect(src.fragmentShader).toContain("return unpackRGBAToDepth(texture2D(tDepth, uv));");
    // Both the sky mask and the god-ray march read the combined sceneDepth.
    expect(src.fragmentShader).toContain("float depth = sceneDepth(vUv);");
    expect(src.fragmentShader).toContain("step(1.0 - uDepthEps, sceneDepth(gpos))");
  });

  it("wires the externally-provided packed-depth texture into tDepth", () => {
    const { depthTexture, pass } = makePass();
    const u = (pass as unknown as { fsQuad: { material: THREE.ShaderMaterial } }).fsQuad.material
      .uniforms;
    expect(u.tDepth.value).toBe(depthTexture);
  });

  it("defaults to smooth gradient (uSkyBands = 0, uBandMix = 0.35)", () => {
    const { pass } = makePass();
    expect(pass.skyBands).toBe(0);
    expect(pass.bandMix).toBeCloseTo(0.35, 6);
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
    expect((u.uSkyHorizon.value as THREE.Color).getHex()).toBe(0xb6ad9e);
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
    expect(u.uBandMix.value).toBeCloseTo(0.35, 6);
    // View-direction gradient uniforms declared; screen-space uSkyStart gone.
    expect(u.uInvViewProj).toBeDefined();
    expect(u.uHorizonElev.value).toBeCloseTo(0, 6);
    expect(u.uZenithElev.value).toBeCloseTo(0.55, 6);
    expect(u.uSkyStart).toBeUndefined();
    // GLSL masks sky via depth == 1.0 (cleared far plane).
    expect(src.fragmentShader).toContain("depth >= 1.0 - uDepthEps");
    // View-direction (world elevation) ramp replaces the screen-space one.
    expect(src.fragmentShader).toContain("uInvViewProj");
    expect(src.fragmentShader).not.toContain("(vUv.y - uSkyStart)");
    expect(src.fragmentShader).toContain("smoothstep(uHorizonElev, uZenithElev, elev)");
    expect(src.fragmentShader).toContain("float elev = viewDir.y;");
    expect(src.fragmentShader).toContain("mix(uSkyHorizon, uSkyZenith, gradient)");
    expect(src.fragmentShader).toContain("mix(color, synthetic, uBandMix)");
    // Opt-in soft banding guarded by uSkyBands > 0.
    expect(src.fragmentShader).toContain("if (uSkyBands > 0.0)");
    expect(src.fragmentShader).toContain("smoothstep(0.0, 1.0, bandFrac)");
    expect(src.fragmentShader).toContain("mix(soft, hard, uBandSharpness)");
  });

  it("does not throw on dispose", () => {
    const { pass } = makePass();
    expect(() => pass.dispose()).not.toThrow();
  });
});

describe("SkyPosterizePass view-direction gradient (280)", () => {
  function makePass() {
    return new SkyPosterizePass(new THREE.Texture());
  }

  function uniforms(pass: SkyPosterizePass) {
    return (pass as unknown as { fsQuad: { material: THREE.ShaderMaterial } }).fsQuad.material
      .uniforms;
  }

  it("setView writes uInvViewProj = matrixWorld * projectionMatrixInverse", () => {
    const pass = makePass();
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(1, 2, 3);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    const expected = new THREE.Matrix4().multiplyMatrices(
      cam.matrixWorld,
      cam.projectionMatrixInverse,
    );
    pass.setView(cam);
    const u = uniforms(pass);
    const got = u.uInvViewProj.value as THREE.Matrix4;
    for (let i = 0; i < 16; i++) {
      expect(got.elements[i]).toBeCloseTo(expected.elements[i], 6);
    }
  });

  it("horizonElev/zenithElev getters round-trip", () => {
    const pass = makePass();
    expect(pass.horizonElev).toBeCloseTo(0, 6);
    expect(pass.zenithElev).toBeCloseTo(0.55, 6);
    pass.horizonElev = 0.1;
    pass.zenithElev = 0.7;
    expect(pass.horizonElev).toBeCloseTo(0.1, 6);
    expect(pass.zenithElev).toBeCloseTo(0.7, 6);
  });
});

describe("skyGradientT", () => {
  it("skyGradientT mirrors GLSL smoothstep elevation ramp", () => {
    expect(skyGradientT(-0.2, 0.0, 0.55)).toBeCloseTo(0, 6); // below horizon -> horizon
    expect(skyGradientT(0.0, 0.0, 0.55)).toBeCloseTo(0, 6); // at horizon
    expect(skyGradientT(0.55, 0.0, 0.55)).toBeCloseTo(1, 6); // at zenith
    expect(skyGradientT(1.0, 0.0, 0.55)).toBeCloseTo(1, 6); // above zenith -> zenith
    // midpoint of the smoothstep
    const mid = skyGradientT(0.275, 0.0, 0.55);
    expect(mid).toBeCloseTo(0.5, 6);
  });
});

describe("SkyPosterizePass post-grade (064)", () => {
  function makePass() {
    return new SkyPosterizePass(new THREE.Texture());
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
    const posterizeEnd = src.indexOf("mix(color, synthetic, uBandMix)");
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

describe("SkyPosterizePass sun effects (159)", () => {
  function makePass() {
    return new SkyPosterizePass(new THREE.Texture());
  }

  function uniforms(pass: SkyPosterizePass) {
    return (pass as unknown as { fsQuad: { material: THREE.ShaderMaterial } }).fsQuad.material
      .uniforms;
  }

  function fragSrc(pass: SkyPosterizePass) {
    return (pass as unknown as { fsQuad: { material: THREE.ShaderMaterial } }).fsQuad.material
      .fragmentShader;
  }

  it("defaults every effect gain to 0 (identity: no halo/rays/flare)", () => {
    const pass = makePass();
    expect(pass.haloIntensity).toBe(0);
    expect(pass.godrayIntensity).toBe(0);
    expect(pass.flareIntensity).toBe(0);
    const u = uniforms(pass);
    expect(u.uSunFront.value).toBe(0);
    expect((u.uSunUv.value as THREE.Vector2).x).toBeCloseTo(0.5, 6);
    expect((u.uSunUv.value as THREE.Vector2).y).toBeCloseTo(0.5, 6);
  });

  it("declares the sun-effect uniforms with tunable defaults", () => {
    const u = uniforms(makePass());
    expect(u.uSunUv).toBeDefined();
    expect(u.uSunColor).toBeDefined();
    expect(u.uAspect.value).toBe(1);
    expect(u.uHaloRadius.value).toBeCloseTo(0.32, 6);
    expect(u.uGodrayDensity.value).toBeCloseTo(0.9, 6);
    expect(u.uGodrayDecay.value).toBeCloseTo(0.96, 6);
    expect(u.uGodrayWeight.value).toBeCloseTo(1.0, 6);
  });

  it("shader guards the god-ray + flare blocks so disabled = free + identity", () => {
    const src = fragSrc(makePass());
    expect(src).toContain("if (uGodrayIntensity * uSunFront > 0.0)");
    expect(src).toContain("if (uFlareIntensity * uSunFront > 0.0)");
    // God rays + flare scale by uSunFront so the wash fades out smoothly as the
    // sun turns behind the camera instead of popping off at the binary boundary.
    expect(src).toContain("uGodrayIntensity * illum * uSunFront * uSunColor");
    expect(src).toContain("uFlareIntensity * flare * uSunFront * sunVis * uSunColor");
    // Each effect is a gated additive term (0 gain -> exact no-op).
    expect(src).toContain("uHaloIntensity * uSunFront * sky * halo * uSunColor");
    expect(src).toContain("for (int i = 0; i < GODRAY_SAMPLES; i++)");
  });

  it("effects come AFTER the grade block and BEFORE the vignette", () => {
    const src = fragSrc(makePass());
    const gradeEnd = src.indexOf("color += vec3(uGradeLift)");
    const effects = src.indexOf("159: sun light effects");
    const vignette = src.indexOf("064: vignette corner darkening");
    expect(effects).toBeGreaterThan(gradeEnd);
    expect(vignette).toBeGreaterThan(effects);
  });

  it("setSunEffects writes the per-frame sun uniforms in one call", () => {
    const pass = makePass();
    pass.setSunEffects(0.7, 0.6, 1, 1.5, new THREE.Color(1, 0.8, 0.5), 0.9, 0.4, 0.2);
    const u = uniforms(pass);
    expect((u.uSunUv.value as THREE.Vector2).x).toBeCloseTo(0.7, 6);
    expect((u.uSunUv.value as THREE.Vector2).y).toBeCloseTo(0.6, 6);
    expect(u.uSunFront.value).toBe(1);
    expect(u.uAspect.value).toBeCloseTo(1.5, 6);
    expect((u.uSunColor.value as THREE.Color).g).toBeCloseTo(0.8, 6);
    expect(pass.haloIntensity).toBeCloseTo(0.9, 6);
    expect(pass.godrayIntensity).toBeCloseTo(0.4, 6);
    expect(pass.flareIntensity).toBeCloseTo(0.2, 6);
  });

  it("front=0 clears uSunFront (sun behind camera draws nothing)", () => {
    const pass = makePass();
    pass.setSunEffects(0.5, 0.5, 0, 1, new THREE.Color(1, 1, 1), 1, 1, 1);
    expect(uniforms(pass).uSunFront.value).toBe(0);
  });

  it("writes a fractional front weight through unchanged (smooth crossover)", () => {
    const pass = makePass();
    pass.setSunEffects(0.5, 0.5, 0.35, 1, new THREE.Color(1, 1, 1), 1, 1, 1);
    expect(uniforms(pass).uSunFront.value).toBeCloseTo(0.35, 6);
  });
});

describe("SkyPosterizePass lens-flare occlusion (208)", () => {
  function makePass() {
    return new SkyPosterizePass(new THREE.Texture());
  }

  function uniforms(pass: SkyPosterizePass) {
    return (pass as unknown as { fsQuad: { material: THREE.ShaderMaterial } }).fsQuad.material
      .uniforms;
  }

  function fragSrc(pass: SkyPosterizePass) {
    return (pass as unknown as { fsQuad: { material: THREE.ShaderMaterial } }).fsQuad.material
      .fragmentShader;
  }

  it("depth-masks the flare with a 5-tap sun-coverage kernel at uSunUv", () => {
    const src = fragSrc(makePass());
    // One center read + a 4-neighbor cross, averaged -> a smooth 0..1 fade as
    // the sun dips behind a ridge (not a binary snap).
    expect(src).toContain("step(1.0 - uDepthEps, sceneDepth(uSunUv))");
    expect(src).toContain("sceneDepth(uSunUv + vec2(uFlareOccRadius, 0.0))");
    expect(src).toContain("sceneDepth(uSunUv - vec2(uFlareOccRadius, 0.0))");
    expect(src).toContain("sceneDepth(uSunUv + vec2(0.0, uFlareOccRadius))");
    expect(src).toContain("sceneDepth(uSunUv - vec2(0.0, uFlareOccRadius))");
    expect(src).toContain("float sunVis = cov / 5.0;");
    // sunVis multiplies the flare term so the whole flare fades out.
    expect(src).toContain("uFlareIntensity * flare * uSunFront * sunVis * uSunColor");
  });

  it("declares uFlareOccRadius with the default 0.01", () => {
    const u = uniforms(makePass());
    expect(u.uFlareOccRadius).toBeDefined();
    expect(u.uFlareOccRadius.value).toBeCloseTo(0.01, 6);
  });

  it("flareOccRadius ctor opt overrides the default", () => {
    const pass = new SkyPosterizePass(new THREE.Texture(), {
      flareOccRadius: 0.02,
    });
    const u = uniforms(pass);
    expect(u.uFlareOccRadius.value).toBeCloseTo(0.02, 6);
  });
});
