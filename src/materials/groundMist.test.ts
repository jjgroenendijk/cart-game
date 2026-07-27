import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  DEFAULT_MIST_PARAMS,
  fbm,
  hash2,
  mistTimeFactor,
  mistWetnessBoost,
  vnoise,
} from "./groundMistMath";
import { GroundMistPass } from "./groundMist";

function makePass() {
  const depthTexture = new THREE.DepthTexture(64, 48);
  return { depthTexture, pass: new GroundMistPass(depthTexture) };
}

function uniforms(pass: GroundMistPass) {
  return (pass as unknown as { fsQuad: { material: THREE.ShaderMaterial } }).fsQuad.material
    .uniforms;
}

function fragSrc(pass: GroundMistPass) {
  return (pass as unknown as { fsQuad: { material: THREE.ShaderMaterial } }).fsQuad.material
    .fragmentShader;
}

describe("GroundMistPass defaults", () => {
  it("defaults uMistStrength to 0 (identity until Renderer wires)", () => {
    const { pass } = makePass();
    expect(pass.mistStrength).toBe(0);
    expect(uniforms(pass).uMistStrength.value).toBe(0);
  });

  it("wires the provided DepthTexture into the tDepth uniform", () => {
    const { depthTexture, pass } = makePass();
    expect(uniforms(pass).tDepth.value).toBe(depthTexture);
  });

  it("declares every required uniform", () => {
    const u = uniforms(makePass().pass);
    expect(u.tColor).toBeDefined();
    expect(u.tDepth).toBeDefined();
    expect(u.uInvViewProj).toBeDefined();
    expect(u.uCamPos).toBeDefined();
    expect(u.uFogColor).toBeDefined();
    expect(u.uTimeFactor).toBeDefined();
    expect(u.uWetness).toBeDefined();
    expect(u.uTime).toBeDefined();
    expect(u.uMistStrength).toBeDefined();
    expect(u.uPoolY).toBeDefined();
    expect(u.uThinY).toBeDefined();
    expect(u.uNearFadeStart).toBeDefined();
    expect(u.uNearFadeEnd).toBeDefined();
    expect(u.uFbmScale).toBeDefined();
    expect(u.uDriftSpeed).toBeDefined();
    expect(u.uDensityScale).toBeDefined();
  });

  it("GroundMistParams defaults match DEFAULT_MIST_PARAMS", () => {
    const u = uniforms(makePass().pass);
    expect(u.uPoolY.value).toBeCloseTo(DEFAULT_MIST_PARAMS.poolY, 6);
    expect(u.uThinY.value).toBeCloseTo(DEFAULT_MIST_PARAMS.thinY, 6);
    expect(u.uNearFadeStart.value).toBeCloseTo(DEFAULT_MIST_PARAMS.nearFadeStart, 6);
    expect(u.uNearFadeEnd.value).toBeCloseTo(DEFAULT_MIST_PARAMS.nearFadeEnd, 6);
    expect(u.uFbmScale.value).toBeCloseTo(DEFAULT_MIST_PARAMS.fbmScale, 6);
    expect(u.uDriftSpeed.value).toBeCloseTo(DEFAULT_MIST_PARAMS.driftSpeed, 6);
    expect(u.uDensityScale.value).toBeCloseTo(DEFAULT_MIST_PARAMS.densityScale, 6);
    expect(u.uPoolY.value).toBeCloseTo(-6, 6);
    expect(u.uThinY.value).toBeCloseTo(2, 6);
    expect(u.uNearFadeStart.value).toBeCloseTo(10, 6);
    expect(u.uNearFadeEnd.value).toBeCloseTo(30, 6);
    expect(u.uFbmScale.value).toBeCloseTo(0.15, 6);
    expect(u.uDriftSpeed.value).toBeCloseTo(0.02, 6);
    expect(u.uDensityScale.value).toBeCloseTo(0.55, 6);
  });

  it("ctor opts override the defaults", () => {
    const pass = new GroundMistPass(new THREE.DepthTexture(64, 48), { thinY: 4 });
    expect(uniforms(pass).uThinY.value).toBeCloseTo(4, 6);
    // Untouched params keep their defaults.
    expect(uniforms(pass).uPoolY.value).toBeCloseTo(DEFAULT_MIST_PARAMS.poolY, 6);
  });
});

describe("GroundMistPass shader (228)", () => {
  it("has the identity early-out at uMistStrength <= 0", () => {
    expect(fragSrc(makePass().pass)).toContain("if (uMistStrength <= 0.0)");
  });

  it("skips sky pixels (depth >= 1.0 - uDepthEps)", () => {
    expect(fragSrc(makePass().pass)).toContain("depth >= 1.0 - uDepthEps");
  });

  it("reconstructs world position via the unproject (uInvViewProj * ndc)", () => {
    const src = fragSrc(makePass().pass);
    expect(src).toContain("uInvViewProj * ndc");
    expect(src).toContain("world.xyz /= world.w");
  });

  it("has the altitude falloff smoothstep(uThinY, uPoolY, world.y)", () => {
    expect(fragSrc(makePass().pass)).toContain("smoothstep(uThinY, uPoolY, world.y)");
  });

  it("has the near-distance fade smoothstep(uNearFadeStart, uNearFadeEnd, dist)", () => {
    expect(fragSrc(makePass().pass)).toContain("smoothstep(uNearFadeStart, uNearFadeEnd, dist)");
  });

  it("drives fbm with #define MIST_OCTAVES 3 and the fbm(p, MIST_OCTAVES) call", () => {
    const src = fragSrc(makePass().pass);
    expect(src).toContain("#define MIST_OCTAVES 3");
    expect(src).toContain("fbm(p, MIST_OCTAVES)");
  });

  it("composites toward the fog tint via mix(color, uFogColor, density)", () => {
    expect(fragSrc(makePass().pass)).toContain("mix(color, uFogColor, density)");
  });
});

describe("GroundMistPass.setMist", () => {
  it("writes the per-frame non-camera uniforms in one call", () => {
    const { pass } = makePass();
    pass.setMist(12.5, 0.8, new THREE.Color(0.2, 0.3, 0.4), 0.6, 0.5);
    const u = uniforms(pass);
    expect(u.uTime.value).toBeCloseTo(12.5, 6);
    expect(u.uMistStrength.value).toBeCloseTo(0.8, 6);
    expect((u.uFogColor.value as THREE.Color).r).toBeCloseTo(0.2, 6);
    expect((u.uFogColor.value as THREE.Color).g).toBeCloseTo(0.3, 6);
    expect((u.uFogColor.value as THREE.Color).b).toBeCloseTo(0.4, 6);
    expect(u.uTimeFactor.value).toBeCloseTo(0.6, 6);
    expect(u.uWetness.value).toBeCloseTo(0.5, 6);
  });

  it("mistStrength getter reflects setMist's strength argument", () => {
    const { pass } = makePass();
    pass.setMist(0, 0.42, new THREE.Color(0, 0, 0), 0, 0);
    expect(pass.mistStrength).toBeCloseTo(0.42, 6);
  });
});

describe("mistTimeFactor", () => {
  it("returns 0 in deep night (nightFactor 1)", () => {
    expect(mistTimeFactor(0, 1)).toBe(0);
    expect(mistTimeFactor(20, 1)).toBe(0);
  });

  it("is densest (1.0) at the horizon at full day", () => {
    expect(mistTimeFactor(0, 0)).toBeCloseTo(1.0, 6);
  });

  it("floors at 0.35 at midday peak elevation", () => {
    const mid = mistTimeFactor(62, 0);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.4);
  });

  it("stays dense at dusk before the night ramp (elev < 0, small nightFactor)", () => {
    const dusk = mistTimeFactor(-2, 0.2);
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeCloseTo(0.8, 6);
  });
});

describe("mistWetnessBoost", () => {
  it("returns 1 at dry (wetness 0) and ~1.6 at soaked (wetness 1)", () => {
    expect(mistWetnessBoost(0)).toBeCloseTo(1, 6);
    expect(mistWetnessBoost(1)).toBeCloseTo(1.6, 6);
  });

  it("is monotonic in wetness", () => {
    expect(mistWetnessBoost(0.25)).toBeLessThanOrEqual(mistWetnessBoost(0.5));
    expect(mistWetnessBoost(0.5)).toBeLessThanOrEqual(mistWetnessBoost(0.75));
  });
});

describe("GroundMistMath fbm mirror", () => {
  it("fbm stays in [0,1] for sample inputs", () => {
    for (const [x, y] of [
      [0.1, 0.2],
      [1.7, 3.3],
      [-2.5, 4.1],
      [10.3, -7.7],
    ]) {
      const v = fbm(x, y, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("vnoise at an integer lattice corner equals hash2 at that corner (f=0 -> c00)", () => {
    expect(vnoise(5, 7)).toBeCloseTo(hash2(5, 7), 6);
    expect(vnoise(0, 0)).toBeCloseTo(hash2(0, 0), 6);
  });

  it("is deterministic", () => {
    expect(fbm(2.3, 4.8, 3)).toBe(fbm(2.3, 4.8, 3));
  });
});

describe("GroundMistPass dispose", () => {
  it("does not throw on dispose", () => {
    const { pass } = makePass();
    expect(() => pass.dispose()).not.toThrow();
  });
});
