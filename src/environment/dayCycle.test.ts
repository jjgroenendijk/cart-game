import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  computeDayCycle,
  dayCycleState,
  DAYTIME_START_FRACTION,
  daytimeStartSeconds,
  phaseFor,
  shadowFadeFor,
} from "./dayCycle";

const DAY = 120;
const MAX_ELEV = 62;

describe("daytime start helper", () => {
  it("daytimeStartSeconds scales with day length", () => {
    expect(daytimeStartSeconds(120)).toBeCloseTo(DAYTIME_START_FRACTION * 120, 6);
    expect(daytimeStartSeconds(60)).toBeCloseTo(DAYTIME_START_FRACTION * 60, 6);
  });

  it("defaults to the 120s cycle length", () => {
    expect(daytimeStartSeconds()).toBeCloseTo(daytimeStartSeconds(120), 6);
  });

  it("starts the session lit and well above the horizon (shadow-friendly)", () => {
    const state = computeDayCycle(daytimeStartSeconds());
    expect(state.sunElevationDeg).toBeGreaterThan(20);
    expect(state.sunElevationDeg).toBeLessThan(MAX_ELEV);
    expect(state.phase).toBe("day");
  });
});

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

describe("cycleT", () => {
  it("cycleT=0 at dawn (elapsed 0)", () => {
    expect(computeDayCycle(0).cycleT).toBeCloseTo(0, 6);
  });

  it("cycleT=0.25 at noon (elapsed 30)", () => {
    expect(computeDayCycle(30).cycleT).toBeCloseTo(0.25, 6);
  });

  it("cycleT=0.5 at dusk (elapsed 60)", () => {
    expect(computeDayCycle(60).cycleT).toBeCloseTo(0.5, 6);
  });

  it("cycleT=0.75 at deep night (elapsed 90)", () => {
    expect(computeDayCycle(90).cycleT).toBeCloseTo(0.75, 6);
  });

  it("wraps: cycleT(DAY) ~= 0 (DAY=120 default)", () => {
    expect(computeDayCycle(DAY).cycleT).toBeCloseTo(0, 6);
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
    const horizon = new THREE.Color(0xb6ad9e); // day horizon matches FOG_TINTS
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

  it("golden-hour tempContrast > noon; shadeTint cooler at night than noon", () => {
    const noon = computeDayCycle(30); // cycleT 0.25
    const goldenEvening = computeDayCycle(0.46 * DAY); // cycleT 0.46 strongest
    const night = computeDayCycle(90); // cycleT 0.75
    expect(goldenEvening.tempContrast).toBeGreaterThan(noon.tempContrast);
    // shadeTint at night is cooler (b > r) than at noon (near-neutral).
    expect(night.shadeTint.b).toBeGreaterThan(night.shadeTint.r);
    expect(noon.shadeTint.b).toBeLessThanOrEqual(night.shadeTint.b);
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
    expect(b.tempContrast).toBeCloseTo(a.tempContrast, 12);
    expect(b.sunColor.r).toBeCloseTo(a.sunColor.r, 12);
    expect(b.sunColor.g).toBeCloseTo(a.sunColor.g, 12);
    expect(b.skyZenith.b).toBeCloseTo(a.skyZenith.b, 12);
    expect(b.shadeTint.r).toBeCloseTo(a.shadeTint.r, 12);
    expect(b.shadeTint.g).toBeCloseTo(a.shadeTint.g, 12);
    expect(b.shadeTint.b).toBeCloseTo(a.shadeTint.b, 12);
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

  it("pools Color/Vector3 scratch (callers must copy retained values)", () => {
    const a = computeDayCycle(0); // dawn
    const dawnZenithR = a.skyZenith.r;
    const b = computeDayCycle(90); // night
    // Color/Vector3 fields alias module-level scratch: a second call
    // overwrites them, so any retained value must be copied. The outer
    // state shells are still distinct objects.
    expect(a).not.toBe(b);
    expect(a.sunDirWorld).toBe(b.sunDirWorld);
    expect(a.sunColor).toBe(b.sunColor);
    expect(a.skyZenith).toBe(b.skyZenith);
    // Scratch now holds the night values (last call), not dawn.
    expect(a.skyZenith.r).not.toBeCloseTo(dawnZenithR, 6);
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

describe("shadowFadeFor / shadowFade ramp", () => {
  it("is 0 below and at the low edge, 1 at and above the high edge", () => {
    expect(shadowFadeFor(2)).toBe(0); // below low
    expect(shadowFadeFor(3)).toBe(0); // at low edge (smoothstep == 0 at e0)
    expect(shadowFadeFor(18)).toBe(1); // at high edge
    expect(shadowFadeFor(20)).toBe(1); // above high
  });

  it("crosses 0.5 at the midpoint of the fade band", () => {
    // midpoint of 3..18 is 10.5; cubic Hermite smoothstep is symmetric.
    expect(shadowFadeFor(10.5)).toBeCloseTo(0.5, 6);
  });

  it("is monotonic non-decreasing across 3..18 deg", () => {
    let prev = -Infinity;
    for (let elev = 3; elev <= 18; elev += 1) {
      const sf = shadowFadeFor(elev);
      expect(sf).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = sf;
    }
  });

  it("is dawn/dusk symmetric via computeDayCycle (elevation-only)", () => {
    // elevation = 10 occurs rising at cycleT_up and setting at cycleT_down.
    const elevTarget = 10;
    const cycleT_up = Math.asin(elevTarget / MAX_ELEV) / (Math.PI * 2);
    const cycleT_down = 0.5 - cycleT_up;
    const up = computeDayCycle(cycleT_up * DAY).shadowFade;
    const down = computeDayCycle(cycleT_down * DAY).shadowFade;
    expect(up).toBeCloseTo(down, 6);
  });

  it("is 1 at noon (high sun) and 0 in deep night", () => {
    expect(computeDayCycle(30).shadowFade).toBeCloseTo(1, 6); // elev ~62
    expect(computeDayCycle(90).shadowFade).toBe(0); // elev ~-62
  });
});

describe("computeDayCycle exposure", () => {
  it("stays within [0.9, 1.15] across a dense sweep of cycleT", () => {
    const samples = [
      0, 0.05, 0.1, 0.15, 0.25, 0.35, 0.4, 0.46, 0.5, 0.56, 0.65, 0.75, 0.85, 0.9, 0.95,
    ];
    for (const t of samples) {
      const exp = computeDayCycle(t * DAY).exposure;
      expect(exp).toBeGreaterThanOrEqual(0.9);
      expect(exp).toBeLessThanOrEqual(1.15);
    }
  });

  it("is ~1.0 at noon (cycleT 0.25)", () => {
    expect(computeDayCycle(30).exposure).toBeCloseTo(1.0, 6);
  });

  it("is ~0.9 at deep night (cycleT 0.75)", () => {
    expect(computeDayCycle(90).exposure).toBeCloseTo(0.9, 6);
  });

  it("golden-morning reads higher than noon; blue hour reads lower than noon", () => {
    const noonExp = computeDayCycle(30).exposure; // cycleT 0.25
    const goldenExp = computeDayCycle(0.1 * DAY).exposure; // golden morning cycleT 0.10
    const blueExp = computeDayCycle(0.56 * DAY).exposure; // blue hour cycleT 0.56
    expect(goldenExp).toBeGreaterThan(noonExp);
    expect(blueExp).toBeLessThan(noonExp);
  });
});

describe("computeDayCycle keyframe segment coverage", () => {
  it("every scalar + color component is finite across a fine sweep of [0,1)", () => {
    for (let i = 0; i < 100; i++) {
      const t = i / 100;
      const s = computeDayCycle(t * DAY);
      expect(Number.isFinite(s.sunIntensity)).toBe(true);
      expect(Number.isFinite(s.ambientIntensity)).toBe(true);
      expect(Number.isFinite(s.fogNear)).toBe(true);
      expect(Number.isFinite(s.fogFar)).toBe(true);
      expect(Number.isFinite(s.exposure)).toBe(true);
      expect(Number.isFinite(s.tempContrast)).toBe(true);
      expect(s.tempContrast).toBeGreaterThanOrEqual(0);
      expect(s.tempContrast).toBeLessThanOrEqual(0.4);
      // Colors are LINEAR: may slightly exceed 1 but must be finite + >= 0.
      for (const c of [
        s.sunColor,
        s.ambientColor,
        s.skyZenith,
        s.skyHorizon,
        s.fogColor,
        s.shadeTint,
      ]) {
        expect(Number.isFinite(c.r)).toBe(true);
        expect(Number.isFinite(c.g)).toBe(true);
        expect(Number.isFinite(c.b)).toBe(true);
        expect(c.r).toBeGreaterThanOrEqual(0);
        expect(c.g).toBeGreaterThanOrEqual(0);
        expect(c.b).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("produces no NaN anywhere across the sweep (incl. wrap region 0.9-1.0)", () => {
    for (let i = 0; i < 100; i++) {
      const t = i / 100;
      const s = computeDayCycle(t * DAY);
      expect(s.cycleT).not.toBeNaN();
      expect(s.sunElevationDeg).not.toBeNaN();
      expect(s.sunAzimuthDeg).not.toBeNaN();
      expect(s.nightFactor).not.toBeNaN();
      expect(s.sunIntensity).not.toBeNaN();
      expect(s.ambientIntensity).not.toBeNaN();
      expect(s.fogNear).not.toBeNaN();
      expect(s.fogFar).not.toBeNaN();
      expect(s.exposure).not.toBeNaN();
      expect(s.shadowFade).not.toBeNaN();
      expect(s.tempContrast).not.toBeNaN();
    }
  });
});

describe("computeDayCycle regression anchors", () => {
  it("noon matches prior constants (cycleT 0.25, exact anchor)", () => {
    const s = computeDayCycle(30);
    expect(s.sunIntensity).toBeCloseTo(2.0, 6);
    expect(s.ambientIntensity).toBeCloseTo(1.0, 6);
    expect(s.fogNear).toBeCloseTo(90, 6);
    expect(s.fogFar).toBeCloseTo(360, 6);
    const zenith = new THREE.Color(0x4a8fcf);
    expect(s.skyZenith.r).toBeCloseTo(zenith.r, 5);
    expect(s.skyZenith.g).toBeCloseTo(zenith.g, 5);
    expect(s.skyZenith.b).toBeCloseTo(zenith.b, 5);
    const horizon = new THREE.Color(0xb6ad9e);
    expect(s.skyHorizon.r).toBeCloseTo(horizon.r, 5);
    expect(s.skyHorizon.g).toBeCloseTo(horizon.g, 5);
    expect(s.skyHorizon.b).toBeCloseTo(horizon.b, 5);
    const sunC = new THREE.Color(0xffe8b0);
    expect(s.sunColor.r).toBeCloseTo(sunC.r, 5);
    expect(s.sunColor.g).toBeCloseTo(sunC.g, 5);
    expect(s.sunColor.b).toBeCloseTo(sunC.b, 5);
    const ambC = new THREE.Color(0x8090a0);
    expect(s.ambientColor.r).toBeCloseTo(ambC.r, 5);
    expect(s.ambientColor.g).toBeCloseTo(ambC.g, 5);
    expect(s.ambientColor.b).toBeCloseTo(ambC.b, 5);
    const fogC = new THREE.Color(0xb6ad9e);
    expect(s.fogColor.r).toBeCloseTo(fogC.r, 5);
    expect(s.fogColor.g).toBeCloseTo(fogC.g, 5);
    expect(s.fogColor.b).toBeCloseTo(fogC.b, 5);
    // tempContrast is 0 at noon (near-neutral); shadeTint is 0x809098.
    expect(s.tempContrast).toBeCloseTo(0, 6);
    const shadeC = new THREE.Color(0x809098);
    expect(s.shadeTint.r).toBeCloseTo(shadeC.r, 5);
    expect(s.shadeTint.g).toBeCloseTo(shadeC.g, 5);
    expect(s.shadeTint.b).toBeCloseTo(shadeC.b, 5);
  });

  it("night matches prior constants (cycleT 0.75, exact anchor)", () => {
    const s = computeDayCycle(90);
    expect(s.sunIntensity).toBeCloseTo(0.15, 6);
    expect(s.ambientIntensity).toBeCloseTo(0.3, 6);
    expect(s.fogNear).toBeCloseTo(70, 6);
    expect(s.fogFar).toBeCloseTo(280, 6);
    const zenith = new THREE.Color(0x05060f);
    expect(s.skyZenith.r).toBeCloseTo(zenith.r, 5);
    expect(s.skyZenith.g).toBeCloseTo(zenith.g, 5);
    expect(s.skyZenith.b).toBeCloseTo(zenith.b, 5);
    const horizon = new THREE.Color(0x1a1a25);
    expect(s.skyHorizon.r).toBeCloseTo(horizon.r, 5);
    expect(s.skyHorizon.g).toBeCloseTo(horizon.g, 5);
    expect(s.skyHorizon.b).toBeCloseTo(horizon.b, 5);
    const fogC = new THREE.Color(0x1a1a25);
    expect(s.fogColor.r).toBeCloseTo(fogC.r, 5);
    expect(s.fogColor.g).toBeCloseTo(fogC.g, 5);
    expect(s.fogColor.b).toBeCloseTo(fogC.b, 5);
    // tempContrast ~0.15 at night; shadeTint 0x20203a leans cool (b > r).
    expect(s.tempContrast).toBeCloseTo(0.15, 6);
    expect(s.shadeTint.b).toBeGreaterThan(s.shadeTint.r);
    const shadeC = new THREE.Color(0x20203a);
    expect(s.shadeTint.r).toBeCloseTo(shadeC.r, 5);
    expect(s.shadeTint.g).toBeCloseTo(shadeC.g, 5);
    expect(s.shadeTint.b).toBeCloseTo(shadeC.b, 5);
  });

  it("dawn matches prior constants (cycleT 0.0, exact anchor)", () => {
    const s = computeDayCycle(0);
    expect(s.sunIntensity).toBeCloseTo(1.2, 6);
    expect(s.ambientIntensity).toBeCloseTo(0.6, 6);
    expect(s.fogNear).toBeCloseTo(90, 6);
    expect(s.exposure).toBeCloseTo(1.0, 6);
  });
});
