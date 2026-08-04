import { describe, expect, it } from "vitest";
import { makeCel } from "./cel";

describe("CelMaterial — emissiveOutput (selective-bloom glint emit, 315)", () => {
  it("emissiveOutput:true adds the EMISSIVE_OUTPUT define", () => {
    const m = makeCel({ snowCover: true, emissiveOutput: true });
    expect(m.defines.EMISSIVE_OUTPUT).toBe("");
    // EMISSIVE_OUTPUT branch + the isolated glint accumulator are present.
    expect(m.fragmentShader).toContain("#ifdef EMISSIVE_OUTPUT");
    expect(m.fragmentShader).toContain("vec4(emissiveGlint, 1.0)");
    expect(m.fragmentShader).toContain("emissiveGlint +=");
    m.dispose();
  });

  it("absent / false: no EMISSIVE_OUTPUT define (byte-identical fallback)", () => {
    const absent = makeCel({ snowCover: true });
    expect(absent.defines.EMISSIVE_OUTPUT).toBeUndefined();
    const off = makeCel({ snowCover: true, emissiveOutput: false });
    expect(off.defines.EMISSIVE_OUTPUT).toBeUndefined();
  });

  it("EMISSIVE_OUTPUT is gated only on the opt (independent of snowSparkle)", () => {
    // emissiveOutput without snowCover + without sparkle still has the define;
    // the material simply emits black (no sparkle write feeds emissiveGlint).
    const m = makeCel({ emissiveOutput: true });
    expect(m.defines.EMISSIVE_OUTPUT).toBe("");
    expect(m.defines.SNOW_COVER).toBeUndefined();
    expect(m.defines.SNOW_SPARKLE).toBeUndefined();
    // emissiveGlint is declared so the output branch compiles even with no
    // sparkle; it stays vec3(0) -> the clone emits black.
    expect(m.fragmentShader).toContain("vec3 emissiveGlint = vec3(0.0);");
    m.dispose();
  });

  it("plain material (no snow, no emissive) does not inject the glint declaration", () => {
    const m = makeCel({});
    expect(m.defines.EMISSIVE_OUTPUT).toBeUndefined();
    // The output #ifdef EMISSIVE_OUTPUT guard stays in source (stripped when the
    // define is absent, like SPECULAR/FLAT), but the in-main accumulator
    // declaration is NOT injected for plain materials -> main() byte-identical.
    expect(m.fragmentShader).not.toContain("vec3 emissiveGlint = vec3(0.0);");
    m.dispose();
  });
});
