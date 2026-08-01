import { describe, expect, it } from "vitest";
import { makeCel } from "./cel";
import { lightUniforms } from "./lightUniforms";

describe("envReflect (sky-capture reflection)", () => {
  it("default drops the ENV_REFLECT define + no reflection sampling", () => {
    const m = makeCel();
    expect(m.defines.ENV_REFLECT).toBeUndefined();
    expect(m.fragmentShader).not.toContain("ENV_REFLECT");
    expect(m.fragmentShader).not.toContain("textureCubeLodEXT");
    expect(m.fragmentShader).not.toContain("uEnvStrength");
    expect(m.fragmentShader).not.toContain("uEnvRoughness");
    expect(m.fragmentShader).not.toContain("uGroundTint");
    expect(m.fragmentShader).not.toContain("uSkyEnvMipCount");
    expect(m.fragmentShader).not.toContain("vWorldPos");
    // The vertex shader always carries the #ifdef ENV_REFLECT-guarded vWorldPos
    // declaration (mirror of the vWorldNormal guard) — it is compiled out, not
    // stripped from source, so only assert its absence in the fragment.
  });

  it("envReflect:true samples the sky cube at a roughness-selected mip, fresnel-weighted", () => {
    const m = makeCel({ envReflect: true, roughness: 0.4, envStrength: 0.3 });
    expect(m.defines.ENV_REFLECT).toBe("");
    const fs = m.fragmentShader;
    expect(fs).toContain("#ifdef ENV_REFLECT");
    expect(fs).toContain("uniform samplerCube uSkyEnv;");
    expect(fs).toContain("uniform float uSkyEnvMipCount;");
    expect(fs).toContain("uniform vec3 uGroundTint;");
    expect(fs).toContain("uniform float uEnvStrength;");
    expect(fs).toContain("uniform float uEnvRoughness;");
    // Reflection vector + view direction in world space.
    expect(fs).toContain("vec3 Vworld = normalize(cameraPosition - vWorldPos)");
    expect(fs).toContain("vec3 R = reflect(-Vworld, Nworld)");
    // Roughness->mip LOD mirrors roughnessToMipLevel(): floor(r*(mips-1)+0.5).
    expect(fs).toContain("float envMip = floor(");
    expect(fs).toContain("clamp(uEnvRoughness, 0.0, 1.0) * max(uSkyEnvMipCount - 1.0, 0.0)");
    expect(fs).toContain("textureCubeLodEXT(uSkyEnv, R, envMip)");
    // Fresnel concentrates at grazing angles so face-on liveries stay read.
    expect(fs).toContain("float fres = pow(1.0 - NdotV, 3.0)");
    expect(fs).toContain("clamp(uEnvStrength, 0.0, 1.0)");
    // Ground-bounce tint for downward rays (sky capture is sky-only).
    expect(fs).toContain("R.y < 0.0");
    expect(fs).toContain("uGroundTint");
    // Tier gate: the sample + contribution sit inside a `uSkyEnvMipCount > 0.0`
    // branch so low tier (skyEnvSize 0 -> mipCount 0) is identity at runtime and
    // the null uSkyEnv is never sampled.
    expect(fs).toContain("if (uSkyEnvMipCount > 0.0)");
    expect(fs).toMatch(/if \(uSkyEnvMipCount > 0\.0\)[\s\S]*textureCubeLodEXT/);
    // Vertex exports the world position + world normal under ENV_REFLECT.
    expect(m.vertexShader).toContain(
      "#if defined(SNOW_COVER) || defined(SKY_ENV) || defined(ENV_REFLECT)",
    );
    expect(m.vertexShader).toContain("varying vec3 vWorldPos;");
    expect(m.vertexShader).toContain("vWorldPos = worldPosition.xyz;");
  });

  it("off-path fragment is byte-identical (envReflect absent == envReflect:false)", () => {
    const baseline = makeCel().fragmentShader;
    const off = makeCel({ envReflect: false }).fragmentShader;
    expect(off).toBe(baseline);
    const on = makeCel({ envReflect: true }).fragmentShader;
    expect(on).not.toBe(baseline);
  });

  it("uEnvStrength + uEnvRoughness are per-material; shared uniforms arrive by-ref", () => {
    const m = makeCel({ envReflect: true, roughness: 0.4, envStrength: 0.3 });
    expect(m.uniforms.uEnvStrength.value).toBeCloseTo(0.3, 6);
    expect(m.uniforms.uEnvRoughness.value).toBeCloseTo(0.4, 6);
    // Shared reflection inputs fan out via the ...lightUniforms spread.
    expect(m.uniforms.uSkyEnv).toBe(lightUniforms.uSkyEnv);
    expect(m.uniforms.uSkyEnvMipCount).toBe(lightUniforms.uSkyEnvMipCount);
    expect(m.uniforms.uGroundTint).toBe(lightUniforms.uGroundTint);
    // Even without envReflect the shared uniforms are present (spread), but the
    // per-material reflection uniforms are absent.
    const d = makeCel();
    expect(d.uniforms.uEnvStrength).toBeUndefined();
    expect(d.uniforms.uEnvRoughness).toBeUndefined();
    expect(d.uniforms.uSkyEnvMipCount).toBe(lightUniforms.uSkyEnvMipCount);
  });

  it("defaults: envStrength 0.25, envRoughness reuses roughness ?? 0.4", () => {
    const m = makeCel({ envReflect: true });
    expect(m.uniforms.uEnvStrength.value).toBeCloseTo(0.25, 6);
    expect(m.uniforms.uEnvRoughness.value).toBeCloseTo(0.4, 6);
    // roughness also drives the specular path when specular is on; both stay in
    // sync from one opts.roughness value.
    const s = makeCel({ envReflect: true, specular: true, roughness: 0.5 });
    expect(s.uniforms.uEnvRoughness.value).toBeCloseTo(0.5, 6);
    expect(s.uniforms.uRoughness.value).toBeCloseTo(0.5, 6);
  });

  it("envReflect + skyEnv coexist without double-declaring uSkyEnv", () => {
    const m = makeCel({ envReflect: true, skyEnv: true });
    expect(m.defines.ENV_REFLECT).toBe("");
    expect(m.defines.SKY_ENV).toBe("");
    const fs = m.fragmentShader;
    // uSkyEnv declared once by the skyEnv block; the envReflect block guards its
    // own declaration out when SKY_ENV is also defined, so the GLSL preprocessor
    // resolves to a single declaration. Verify the guard wraps the duplicate.
    expect(fs).toContain(
      "#if defined(ENV_REFLECT) && !defined(SKY_ENV)\n  uniform samplerCube uSkyEnv;\n  #endif",
    );
  });

  it("envReflect + snowCover coexist: vWorldNormal declarations are mutually exclusive", () => {
    const m = makeCel({ envReflect: true, snowCover: true });
    expect(m.defines.ENV_REFLECT).toBe("");
    expect(m.defines.SNOW_COVER).toBe("");
    const fs = m.fragmentShader;
    expect(fs).toContain("#if defined(ENV_REFLECT) && !defined(SKY_ENV) && !defined(SNOW_COVER)");
    expect(fs).toMatch(/#ifdef SNOW_COVER[\s\S]*varying vec3 vWorldNormal;/);
  });
});
