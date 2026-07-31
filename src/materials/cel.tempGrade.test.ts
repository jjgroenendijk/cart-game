import { describe, expect, it } from "vitest";
import { CelMaterial, makeCel } from "./cel";
import { lightUniforms } from "./lightUniforms";

// 237 warm-sun / cool-shade temperature contrast (TEMP_GRADE define).
describe("tempGrade (warm-sun/cool-shade contrast)", () => {
  it("default drops the TEMP_GRADE define + no tint uniforms in source", () => {
    const m = makeCel();
    expect(m.defines.TEMP_GRADE).toBeUndefined();
    expect(m.fragmentShader).not.toContain("TEMP_GRADE");
    expect(m.fragmentShader).not.toContain("uShadeTint");
    expect(m.fragmentShader).not.toContain("uTempContrast");
  });

  it("tempGrade:true adds the TEMP_GRADE define + tint uniforms + weight block", () => {
    const m = makeCel({ tempGrade: true });
    expect(m.defines.TEMP_GRADE).toBe("");
    expect(m.fragmentShader).toContain("#ifdef TEMP_GRADE");
    expect(m.fragmentShader).toContain("uniform vec3 uShadeTint;");
    expect(m.fragmentShader).toContain("uniform float uTempContrast;");
    // Warm/cool weight lands after the color line, before rim.
    expect(m.fragmentShader).toContain("color *= mix(coolW, warmW, lit);");
  });

  it("off-path fragment is byte-identical whether tempGrade is absent or false", () => {
    // 237 byte-identical-when-off contract: absent + false both reproduce the
    // no-tempGrade fragment exactly, with no tint text leaking.
    const baseline = makeCel({ vertexColors: true }).fragmentShader;
    expect(makeCel({ vertexColors: true }).fragmentShader).toBe(baseline);
    const off = makeCel({ vertexColors: true, tempGrade: false });
    expect(off.fragmentShader).toBe(baseline);
    expect(off.defines.TEMP_GRADE).toBeUndefined();
    expect(off.fragmentShader).not.toContain("TEMP_GRADE");
    expect(off.fragmentShader).not.toContain("uShadeTint");
  });

  it("shares uShadeTint + uTempContrast by reference (one write fans out)", () => {
    // The ...lightUniforms spread copies shared uniform refs into every
    // CelMaterial regardless of tempGrade (mirrors uSunColor/uAmbient).
    const a = new CelMaterial();
    const b = new CelMaterial();
    expect(a.uniforms.uShadeTint).toBe(b.uniforms.uShadeTint);
    expect(a.uniforms.uTempContrast).toBe(b.uniforms.uTempContrast);
    expect(a.uniforms.uShadeTint).toBe(lightUniforms.uShadeTint);
    expect(a.uniforms.uTempContrast).toBe(lightUniforms.uTempContrast);
  });
});
