import { describe, expect, it } from "vitest";
import {
  buildStationTable,
  profileAt,
  widthProfileAt,
  DEFAULT_TRACK_HALF_WIDTH,
} from "./stationProfile";

describe("profileAt", () => {
  const s = [0, 10, 20, 30];
  const v = [1, 3, 5, 7];

  it("interpolates linearly between stations", () => {
    expect(profileAt(s, v, 5, 40)).toBeCloseTo(2);
    expect(profileAt(s, v, 25, 40)).toBeCloseTo(6);
  });

  it("wraps the final segment on closed edges", () => {
    // Station 30 (7) wraps to station 0 (1) over the 30..40 span.
    expect(profileAt(s, v, 35, 40, true)).toBeCloseTo(4);
    expect(profileAt(s, v, -5, 40, true)).toBeCloseTo(4);
  });

  it("clamps to end stations on open edges", () => {
    expect(profileAt(s, v, -5, 40, false)).toBe(1);
    expect(profileAt(s, v, 99, 40, false)).toBe(7);
  });

  it("returns the fallback for empty and the value for single-station", () => {
    expect(profileAt([], [], 5, 40, true, 9)).toBe(9);
    expect(profileAt([0], [4], 33, 40)).toBe(4);
  });
});

describe("widthProfileAt", () => {
  it("delegates with the corridor fallback", () => {
    expect(widthProfileAt({ s: [], halfWidth: [] }, 5, 40)).toBe(DEFAULT_TRACK_HALF_WIDTH);
    expect(widthProfileAt({ s: [0, 10], halfWidth: [4, 8] }, 5, 20)).toBeCloseTo(6);
  });
});

describe("buildStationTable", () => {
  it("fills constants and the fallback", () => {
    expect(Array.from(buildStationTable(3, (i) => i, 3, 2.5, 6))).toEqual([2.5, 2.5, 2.5]);
    expect(Array.from(buildStationTable(2, (i) => i, 2, undefined, 6))).toEqual([6, 6]);
  });

  it("samples a profile at each station position", () => {
    const table = buildStationTable(4, (i) => i * 10, 40, { s: [0, 20], v: [0, 4] }, 6, true);
    expect(Array.from(table)).toEqual([0, 2, 4, 2]);
  });
});
