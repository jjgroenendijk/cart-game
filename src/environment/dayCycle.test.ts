import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { computeDayCycle, dayCycleState, phaseFor } from "./dayCycle";

const DAY = 120;
const MAX_ELEV = 62;

describe("phaseFor", () => {
  it("returns day at/above the twilight threshold regardless of direction", () => {
    expect(phaseFor(8, true)).toBe("day");
    expect(phaseFor(8, false)).toBe("day");
    expect(phaseFor(30, true)).toBe("day");
    expect(phaseFor(30, false)).toBe("day");
  });

  it("returns dawn for twilight while rising, dusk while setting", () => {
    expect(phaseFor(7, true)).toBe("dawn");
    expect(phaseFor(7, false)).toBe("dusk");
    expect(phaseFor(0, true)).toBe("dawn");
    expect(phaseFor(0, false)).toBe("dusk");
  });

  it("returns night below the horizon (elev < 0) regardless of direction", () => {
    expect(phaseFor(-1, true)).toBe("night");
    expect(phaseFor(-1, false)).toBe("night");
    expect(phaseFor(-62, true)).toBe("night");
  });

  it("all four phases are reachable", () => {
    const reached = new Set([
      phaseFor(10, true), // day
      phaseFor(4, true), // dawn
      phaseFor(4, false), // dusk
      phaseFor(-5, true), // night
    ]);
    expect(reached.has("day")).toBe(true);
    expect(reached.has("dawn")).toBe(true);
    expect(reached.has("dusk")).toBe(true);
    expect(reached.has("night")).toBe(true);
  });
});

describe("computeDayCycle sun arc", () => {
  it("at cycleT=0 (dawn) elev ~0, phase dawn, az 90, sun points +X (east)", () => {
    const s = computeDayCycle(0);
    expect(s.sunElevationDeg).toBeCloseTo(0, 6);
    expect(s.phase).toBe("dawn");
    expect(s.sunAzimuthDeg).toBeCloseTo(90, 6);
    // setFromSphericalCoords(1, pi/2, pi/2) -> (1,0,0): east is +X.
    expect(s.sunDirWorld.x).toBeCloseTo(1, 6);
    expect(s.sunDirWorld.y).toBeCloseTo(0, 6);
    expect(s.sunDirWorld.z).toBeCloseTo(0, 6);
    expect(s.sunDirWorld.length()).toBeCloseTo(1, 6);
  });

  it("at cycleT=0.25 (noon) elev ~MAX, phase day, sun overhead (y largest)", () => {
    const s = computeDayCycle(30); // 30/120 = 0.25
    expect(s.sunElevationDeg).toBeCloseTo(MAX_ELEV, 6);
    expect(s.phase).toBe("day");
    expect(s.sunAzimuthDeg).toBeCloseTo(180, 6);
    expect(s.sunDirWorld.y).toBeGreaterThan(Math.abs(s.sunDirWorld.x));
    expect(s.sunDirWorld.y).toBeGreaterThan(Math.abs(s.sunDirWorld.z));
    expect(s.sunDirWorld.y).toBeGreaterThan(0);
  });

  it("at cycleT=0.5 (dusk) elev ~0 setting, phase dusk, az 270, sun -X (west)", () => {
    const s = computeDayCycle(60); // 60/120 = 0.5
    expect(s.sunElevationDeg).toBeCloseTo(0, 6);
    expect(s.phase).toBe("dusk");
    expect(s.sunAzimuthDeg).toBeCloseTo(270, 6);
    expect(s.sunDirWorld.x).toBeCloseTo(-1, 6);
  });

  it("at cycleT=0.75 (deep night) elev ~-MAX, phase night, nightFactor ~1", () => {
    const s = computeDayCycle(90); // 90/120 = 0.75
    expect(s.sunElevationDeg).toBeCloseTo(-MAX_ELEV, 6);
    expect(s.phase).toBe("night");
    expect(s.sunAzimuthDeg).toBeCloseTo(0, 6); // (90 + 270) % 360
    expect(s.nightFactor).toBeCloseTo(1, 6);
    // sun below horizon -> sunDirWorld.y negative.
    expect(s.sunDirWorld.y).toBeLessThan(0);
  });

  it("elevation follows a sine of cycleT over the cycle", () => {
    const samples = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
    for (const t of samples) {
      const s = computeDayCycle(t * DAY);
      const expected = Math.sin(t * Math.PI * 2) * MAX_ELEV;
      expect(s.sunElevationDeg).toBeCloseTo(expected, 6);
    }
  });

  it("azimuth sweeps 90 -> 180 -> 270 -> 0 over the four quarter points", () => {
    expect(computeDayCycle(0).sunAzimuthDeg).toBeCloseTo(90, 6);
    expect(computeDayCycle(30).sunAzimuthDeg).toBeCloseTo(180, 6);
    expect(computeDayCycle(60).sunAzimuthDeg).toBeCloseTo(270, 6);
    expect(computeDayCycle(90).sunAzimuthDeg).toBeCloseTo(0, 6);
  });

  it("elapsed wraps to [0, dayLength)", () => {
    expect(computeDayCycle(0).elapsed).toBeCloseTo(0, 6);
    expect(computeDayCycle(130).elapsed).toBeCloseTo(10, 6);
    expect(computeDayCycle(DAY).elapsed).toBeCloseTo(0, 6);
  });
});

describe("computeDayCycle nightFactor", () => {
  it("is 0 at/above the horizon and ramps to 1 by -10 deg", () => {
    expect(computeDayCycle(0).nightFactor).toBeCloseTo(0, 6); // elev 0
    expect(computeDayCycle(30).nightFactor).toBeCloseTo(0, 6); // elev 62
    // elev = sin(t*2pi)*62; solve elev=-5 for t in (0.5, 0.75).
    const tMid = 0.5 + Math.asin(5 / 62) / (Math.PI * 2);
    expect(computeDayCycle(tMid * DAY).nightFactor).toBeCloseTo(0.5, 6);
    expect(computeDayCycle(90).nightFactor).toBeCloseTo(1, 6); // elev -62
  });

  it("is monotonic non-decreasing as elevation drops below 0", () => {
    let prev = -Infinity;
    for (let t = 0.5; t <= 0.75 + 1e-9; t += 0.01) {
      const nf = computeDayCycle(t * DAY).nightFactor;
      expect(nf).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = nf;
    }
  });
});

describe("computeDayCycle colors + intensities", () => {
  it("night is darker than day (ambient + sun intensity)", () => {
    const day = computeDayCycle(30); // noon
    const night = computeDayCycle(90); // deep night
    expect(night.ambientIntensity).toBeLessThan(day.ambientIntensity);
    expect(night.sunIntensity).toBeLessThan(day.sunIntensity);
  });

  it("day sunColor is bright warm (high luminance, red >= blue)", () => {
    const day = computeDayCycle(30);
    expect(day.sunColor.r).toBeGreaterThan(0.5);
    expect(day.sunColor.r).toBeGreaterThanOrEqual(day.sunColor.b);
  });

  it("day sky tints match the Renderer defaults (zenith/horizon)", () => {
    // day keyframe is exact at cycleT=0.25 (segment boundary, blend 0).
    const day = computeDayCycle(30);
    const zenith = new THREE.Color(0x4a8fcf);
    const horizon = new THREE.Color(0xfde8c0);
    expect(day.skyZenith.r).toBeCloseTo(zenith.r, 5);
    expect(day.skyZenith.g).toBeCloseTo(zenith.g, 5);
    expect(day.skyHorizon.r).toBeCloseTo(horizon.r, 5);
  });

  it("day fog distances match Renderer defaults (near 90, far 360)", () => {
    const day = computeDayCycle(30);
    expect(day.fogNear).toBeCloseTo(90, 6);
    expect(day.fogFar).toBeCloseTo(360, 6);
  });

  it("dusk/night fog pulls closer than day", () => {
    const day = computeDayCycle(30);
    const night = computeDayCycle(90);
    expect(night.fogNear).toBeLessThan(day.fogNear);
    expect(night.fogFar).toBeLessThan(day.fogFar);
  });
});

describe("computeDayCycle determinism + options", () => {
  it("returns equal field values across two calls (deterministic)", () => {
    const a = computeDayCycle(37.3);
    const b = computeDayCycle(37.3);
    expect(b.sunElevationDeg).toBeCloseTo(a.sunElevationDeg, 12);
    expect(b.sunAzimuthDeg).toBeCloseTo(a.sunAzimuthDeg, 12);
    expect(b.phase).toBe(a.phase);
    expect(b.nightFactor).toBeCloseTo(a.nightFactor, 12);
    expect(b.sunIntensity).toBeCloseTo(a.sunIntensity, 12);
    expect(b.ambientIntensity).toBeCloseTo(a.ambientIntensity, 12);
    expect(b.sunColor.r).toBeCloseTo(a.sunColor.r, 12);
    expect(b.sunColor.g).toBeCloseTo(a.sunColor.g, 12);
    expect(b.skyZenith.b).toBeCloseTo(a.skyZenith.b, 12);
    expect(b.fogNear).toBeCloseTo(a.fogNear, 12);
  });

  it("dayLengthSeconds scales the cycle (quarter of either length -> noon)", () => {
    const a = computeDayCycle(30, { dayLengthSeconds: 120 });
    const b = computeDayCycle(15, { dayLengthSeconds: 60 });
    expect(b.sunElevationDeg).toBeCloseTo(a.sunElevationDeg, 6);
    expect(b.phase).toBe(a.phase); // day
    expect(b.sunAzimuthDeg).toBeCloseTo(a.sunAzimuthDeg, 6);
  });

  it("maxElevationDeg changes the peak elevation", () => {
    const s = computeDayCycle(30, { maxElevationDeg: 45 });
    expect(s.sunElevationDeg).toBeCloseTo(45, 6);
  });

  it("returns a fresh object each call (no shared references)", () => {
    const a = computeDayCycle(0);
    const b = computeDayCycle(0);
    expect(a).not.toBe(b);
    expect(a.sunDirWorld).not.toBe(b.sunDirWorld);
    expect(a.sunColor).not.toBe(b.sunColor);
  });
});

describe("dayCycleState singleton", () => {
  it("exists with sane dawn defaults at module load (no throw)", () => {
    expect(dayCycleState).toBeDefined();
    expect(dayCycleState.phase).toBe("dawn");
    expect(dayCycleState.elapsed).toBeCloseTo(0, 6);
    expect(dayCycleState.sunElevationDeg).toBeCloseTo(0, 6);
    expect(dayCycleState.sunDirWorld.length()).toBeCloseTo(1, 6);
  });

  it("mirrors computeDayCycle(0)", () => {
    const fresh = computeDayCycle(0);
    expect(dayCycleState.phase).toBe(fresh.phase);
    expect(dayCycleState.sunAzimuthDeg).toBeCloseTo(fresh.sunAzimuthDeg, 6);
    expect(dayCycleState.sunIntensity).toBeCloseTo(fresh.sunIntensity, 6);
  });
});
