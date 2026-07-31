import { describe, expect, it } from "vitest";
import { makeCel } from "./cel";
import { lightUniforms } from "./lightUniforms";

describe("skyEnv (sky-capture ambient)", () => {
  it("default drops the SKY_ENV define + no uSkyEnv sampling in fragment", () => {
    const m = makeCel();
    expect(m.defines.SKY_ENV).toBeUndefined();
    expect(m.fragmentShader).not.toContain("textureCube(uSkyEnv");
    expect(m.fragmentShader).not.toContain("SKY_ENV");
    expect(m.fragmentShader).not.toContain("uSkyEnvStrength");
    expect(m.fragmentShader).toContain("vec3 color = diffuse + base * uAmbient;");
    expect(m.fragmentShader).not.toContain("ambientTerm");
  });

  it("skyEnv:true samples uSkyEnv with the world normal blended by uSkyEnvStrength", () => {
    const m = makeCel({ skyEnv: true });
    expect(m.defines.SKY_ENV).toBe("");
    expect(m.fragmentShader).toContain("#ifdef SKY_ENV");
    expect(m.fragmentShader).toContain("uniform samplerCube uSkyEnv;");
    expect(m.fragmentShader).toContain("uniform float uSkyEnvStrength;");
    expect(m.fragmentShader).toContain("textureCube(uSkyEnv, normalize(vWorldNormal))");
    expect(m.fragmentShader).toContain("mix(uAmbient, skyAmb");
    expect(m.fragmentShader).toContain("clamp(uSkyEnvStrength, 0.0, 1.0)");
    expect(m.vertexShader).toContain("#if defined(SNOW_COVER) || defined(SKY_ENV)");
    expect(m.vertexShader).toContain("vWorldNormal = mat3(modelMatrix)");
  });

  it("off-path fragment is byte-identical (skyEnv absent == skyEnv:false)", () => {
    const baseline = makeCel().fragmentShader;
    const off = makeCel({ skyEnv: false }).fragmentShader;
    expect(off).toBe(baseline);
    const on = makeCel({ skyEnv: true }).fragmentShader;
    expect(on).not.toBe(baseline);
  });

  it("uSkyEnv + uSkyEnvStrength are shared by-ref from lightUniforms (spread)", () => {
    const m = makeCel({ skyEnv: true });
    expect(m.uniforms.uSkyEnv).toBe(lightUniforms.uSkyEnv);
    expect(m.uniforms.uSkyEnvStrength).toBe(lightUniforms.uSkyEnvStrength);
    const d = makeCel();
    expect(d.uniforms.uSkyEnv).toBe(lightUniforms.uSkyEnv);
    expect(d.uniforms.uSkyEnvStrength).toBe(lightUniforms.uSkyEnvStrength);
  });

  it("skyEnv + snowCover coexist: vWorldNormal declarations are mutually exclusive", () => {
    const m = makeCel({ skyEnv: true, snowCover: true });
    expect(m.defines.SKY_ENV).toBe("");
    expect(m.defines.SNOW_COVER).toBe("");
    const fs = m.fragmentShader;
    expect(fs).toContain("#if defined(SKY_ENV) && !defined(SNOW_COVER)");
    expect(fs).toContain("varying vec3 vWorldNormal;");
    expect(fs).toMatch(/#ifdef SNOW_COVER[\s\S]*varying vec3 vWorldNormal;/);
  });
});
