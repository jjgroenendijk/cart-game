import { describe, expect, it } from "vitest";
import {
  FADE_DISCARD_GLSL,
  FADE_DISCARD_INV_GLSL,
  FADE_GLSL,
  FADE_UNIFORM_GLSL,
  fadeThreshold,
} from "./fade";

/** Reference 4x4 Bayer matrix (row y, col x). */
const M4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

describe("fadeThreshold (TS mirror of the GLSL dither)", () => {
  it("reproduces the canonical 4x4 Bayer matrix", () => {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(fadeThreshold(x, y)).toBeCloseTo((M4[y]![x]! + 0.5) / 16, 9);
      }
    }
  });

  it("stays strictly inside (0,1) so uFade=1 keeps and uFade=0 drops all", () => {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const t = fadeThreshold(x, y);
        expect(t).toBeGreaterThan(0);
        expect(t).toBeLessThan(1);
      }
    }
  });

  it("tiles with period 4 (matches mod(fragCoord, 4.0)), incl. fractional centres", () => {
    // gl_FragCoord samples land on pixel centres (x+0.5); floor() must map
    // them onto the same integer lattice the matrix is defined over.
    expect(fadeThreshold(4.5, 7.5)).toBeCloseTo(fadeThreshold(0, 3), 9);
    expect(fadeThreshold(9.5, 2.5)).toBeCloseTo(fadeThreshold(1, 2), 9);
  });

  it("GLSL snippets carry the same fn names the discard references", () => {
    expect(FADE_GLSL).toContain("float fadeThreshold(vec2 fragCoord)");
    expect(FADE_GLSL).toContain("float fadeBayer2(vec2 p)");
    expect(FADE_UNIFORM_GLSL).toContain("uniform float uFade;");
    expect(FADE_DISCARD_GLSL).toContain("fadeThreshold(gl_FragCoord.xy) > uFade");
    expect(FADE_DISCARD_GLSL).toContain("discard");
  });

  it("inverse discard is the exact complement of the normal discard (same uFade)", () => {
    // Normal keeps threshold <= uFade (discards > uFade); inverse keeps
    // threshold > uFade (discards <= uFade). Together they partition every
    // pixel between the two cross-fading tiers with no overlap or gap.
    expect(FADE_DISCARD_INV_GLSL).toContain("fadeThreshold(gl_FragCoord.xy) <= uFade");
    expect(FADE_DISCARD_INV_GLSL).toContain("discard");
    expect(FADE_DISCARD_INV_GLSL).not.toContain("> uFade");
  });
});
