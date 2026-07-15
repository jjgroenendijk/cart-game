/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { createGarage } from "./Garage";
import { formatDimensions, metersToRefPixels, pixelsPerMeter } from "./garageMeasure";
import { measureKart } from "../kart/models/measure";

describe("garageMeasure.formatDimensions", () => {
  it("emits one labelled, 2-decimal meter line per metric in a stable order", () => {
    const lines = formatDimensions(measureKart("balanced"));
    expect(lines).toHaveLength(6);
    expect(lines.map((l) => l.split(" ")[0])).toEqual([
      "length",
      "width",
      "height",
      "wheelbase",
      "track",
      "ride",
    ]);
    for (const line of lines) {
      // "<label...> <value> m" with the value fixed to exactly 2 decimals.
      expect(line).toMatch(/\d+\.\d{2} m$/);
    }
  });

  it("rounds to 2 decimals", () => {
    const lines = formatDimensions({
      variant: "balanced",
      length: 2.4321,
      width: 1.6,
      height: 1,
      wheelbase: 1.599,
      trackWidth: 1.234,
      rideHeight: 0.314,
      bounds: null,
    });
    expect(lines[0]).toBe("length 2.43 m");
    expect(lines[3]).toBe("wheelbase 1.60 m");
    expect(lines[5]).toBe("ride height 0.31 m");
  });
});

describe("garageMeasure.pixelsPerMeter", () => {
  it("divides reference pixels by the known real length", () => {
    expect(pixelsPerMeter(480, 2.4)).toBe(200);
  });

  it("returns 0 (uncalibrated) for non-positive input", () => {
    expect(pixelsPerMeter(480, 0)).toBe(0);
    expect(pixelsPerMeter(480, -1)).toBe(0);
    expect(pixelsPerMeter(0, 2.4)).toBe(0);
  });
});

describe("garageMeasure.metersToRefPixels", () => {
  it("scales meters into reference pixels at the given scale", () => {
    expect(metersToRefPixels(1.6, 200)).toBe(320);
  });

  it("returns 0 when the scale is uncalibrated", () => {
    expect(metersToRefPixels(1.6, 0)).toBe(0);
  });
});

describe("createGarage (agent-tooling)", () => {
  it("returns null where no WebGL context is available (jsdom)", () => {
    // jsdom canvases have no webgl context -> the factory degrades to null
    // without throwing, mirroring createKartPreview so tests keep passing.
    expect(createGarage(document.createElement("div"))).toBeNull();
  });
});
