import { describe, expect, it } from "vitest";
import { makeCel } from "./cel";
import { FADE_DISCARD_GLSL, FADE_GLSL, FADE_HAZE_GLSL, FADE_UNIFORM_GLSL } from "./fade";

describe("fade (dither dissolve)", () => {
  it("fade:true adds uFade (default 1 = solid) + a dither discard opening main", () => {
    const m = makeCel({ fade: true });
    expect(m.uniforms.uFade.value).toBe(1);
    const fs = m.fragmentShader;
    expect(fs).toContain("uniform float uFade;");
    expect(fs).toContain("float fadeThreshold(vec2 fragCoord)");
    const discard = fs.indexOf("fadeThreshold(gl_FragCoord.xy) > uFade) discard;");
    const shading = fs.indexOf("vec3 N;");
    // Early-out: dissolved fragments must skip all shading work.
    expect(discard).toBeGreaterThan(-1);
    expect(discard).toBeLessThan(shading);
  });

  it("uFade is per-material so streamed bundles fade independently", () => {
    const a = makeCel({ fade: true });
    const b = makeCel({ fade: true });
    expect(a.uniforms.uFade).not.toBe(b.uniforms.uFade);
  });

  it("fadeInvert splices the complementary discard (keeps what fade drops)", () => {
    const m = makeCel({ fadeInvert: true });
    expect(m.uniforms.uFade.value).toBe(1);
    const fs = m.fragmentShader;
    expect(fs).toContain("uniform float uFade;");
    expect(fs).toContain("float fadeThreshold(vec2 fragCoord)");
    const discard = fs.indexOf("fadeThreshold(gl_FragCoord.xy) <= uFade) discard;");
    const shading = fs.indexOf("vec3 N;");
    expect(discard).toBeGreaterThan(-1);
    expect(discard).toBeLessThan(shading);
    // Inverse, not the normal discard: the two never coincide in one material.
    expect(fs).not.toContain("> uFade) discard");
  });

  it("fade vs fadeInvert share the header but flip only the discard comparator", () => {
    const normal = makeCel({ fade: true }).fragmentShader;
    const invert = makeCel({ fadeInvert: true }).fragmentShader;
    expect(normal.replace("> uFade) discard", "<= uFade) discard")).toBe(invert);
  });

  it("off-path is byte-identical: fade only splices the exported snippets", () => {
    const off = makeCel({});
    expect(off.uniforms.uFade).toBeUndefined();
    expect(off.fragmentShader).not.toContain("uFade");
    expect(off.fragmentShader).not.toContain("discard");
    const expected = off.fragmentShader
      .replace(
        "\n\n  varying vec3 vViewPos;",
        `\n  ${FADE_UNIFORM_GLSL}${FADE_GLSL}\n\n  varying vec3 vViewPos;`,
      )
      .replace("void main() {", `void main() {\n    ${FADE_DISCARD_GLSL}`);
    expect(makeCel({ fade: true }).fragmentShader).toBe(expected);
  });
});

describe("fadeHaze (materialise out of the haze)", () => {
  it("adds uFade (default 1) + the fog-colour reveal, no dither discard", () => {
    const m = makeCel({ fadeHaze: true }); // fog defaults on
    expect(m.uniforms.uFade.value).toBe(1);
    const fs = m.fragmentShader;
    expect(fs).toContain("uniform float uFade;");
    expect(fs).toContain(FADE_HAZE_GLSL);
    // Reveal, not dissolve: no Bayer threshold fn and no discard.
    expect(fs).not.toContain("fadeThreshold");
    expect(fs).not.toContain("discard");
  });

  it("splices the reveal INSIDE the fog block, AFTER the fog mix", () => {
    const fs = makeCel({ fadeHaze: true }).fragmentShader;
    const fogMix = fs.indexOf("color = mix(color, fogColor, fogFactor);");
    const haze = fs.indexOf(FADE_HAZE_GLSL);
    expect(fogMix).toBeGreaterThan(-1);
    expect(haze).toBeGreaterThan(fogMix); // reveal lerps the already-fogged colour
  });

  it("is a no-op without fog (no haze target): no uFade, byte-identical", () => {
    const off = makeCel({});
    const haze = makeCel({ fadeHaze: true, fog: false });
    expect(haze.uniforms.uFade).toBeUndefined();
    expect(haze.fragmentShader).not.toContain("uFade");
    // Same fragment as an unfogged plain material (fog:false already drops fog).
    expect(haze.fragmentShader).toBe(makeCel({ fog: false }).fragmentShader);
    expect(off.uniforms.uFade).toBeUndefined();
  });

  it("uFade is per-material so streamed bundles reveal independently", () => {
    const a = makeCel({ fadeHaze: true });
    const b = makeCel({ fadeHaze: true });
    expect(a.uniforms.uFade).not.toBe(b.uniforms.uFade);
  });
});
