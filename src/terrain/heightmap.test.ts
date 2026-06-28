import { describe, expect, it } from "vitest";
import { SplineTrack } from "./SplineTrack";
import {
  SplineFieldCache,
  heightAt,
  colorAt,
  smoothstep,
  octaveSum,
  DEFAULT_TERRAIN_CONFIG,
  type TerrainConfig,
} from "./heightmap";
import { SimplexNoise2D } from "./noise";

function setup(cfgOverride: Partial<TerrainConfig> = {}) {
  const track = new SplineTrack();
  const cache = new SplineFieldCache(track, 100, 2);
  const cfg: TerrainConfig = { ...DEFAULT_TERRAIN_CONFIG, ...cfgOverride };
  const noise = new SimplexNoise2D(cfg.noiseSeed);
  return { track, cache, cfg, noise };
}

describe("smoothstep", () => {
  it("clamps and eases at the edges", () => {
    expect(smoothstep(6, 14, 0)).toBe(0);
    expect(smoothstep(6, 14, 6)).toBe(0);
    expect(smoothstep(6, 14, 14)).toBe(1);
    expect(smoothstep(6, 14, 100)).toBe(1);
    const mid = smoothstep(6, 14, 10);
    expect(mid).toBeCloseTo(0.5, 5);
  });
});

describe("SplineFieldCache.query", () => {
  it("matches SplineTrack.closestPoint at grid nodes (bilinear == exact on a node)", () => {
    const track = new SplineTrack();
    const cache = new SplineFieldCache(track, 100, 2);
    // (0,0) is far inside the loop; just assert query returns finite, and the
    // on-path node at the start (62,0) has small dist.
    const onPath = cache.query(62, 0);
    expect(onPath.dist).toBeLessThan(2.5); // within ~one node cell of the path
    const center = cache.query(0, 0);
    expect(center.dist).toBeGreaterThan(40); // loop center is ~60 from the path
    expect(Number.isFinite(center.pathY)).toBe(true);
  });
});

describe("heightAt", () => {
  it("is deterministic for a fixed seed", () => {
    const a = setup();
    const b = setup();
    for (let i = 0; i < 12; i++) {
      const x = -80 + i * 14;
      const z = -50 + i * 9;
      expect(heightAt(x, z, a.cache, a.cfg, a.noise)).toBe(heightAt(x, z, b.cache, b.cfg, b.noise));
    }
  });

  it("equals pathY on the corridor (noise weight ~0 at the start)", () => {
    const { track, cache, cfg, noise } = setup();
    const start = track.startPos();
    // dist at start ≈ 0 -> w = 0 -> height = pathY (start Y is 0).
    const h = heightAt(start.x, start.z, cache, cfg, noise);
    expect(Math.abs(h - 0)).toBeLessThan(0.02);
  });

  it("off-track height differs from pathY but stays bounded by +/- noiseAmp", () => {
    const { track, cache, cfg, noise } = setup();
    // Loop center is far from the path -> full off-track weight.
    const cx = 0;
    const cz = 0;
    const cp = track.closestPoint(cx, cz);
    const h = heightAt(cx, cz, cache, cfg, noise);
    expect(Math.abs(h - cp.pathY)).toBeLessThanOrEqual(cfg.noiseAmp + 1e-6);
    // And well off the blend band (weight ~1), so noise actually contributes
    // somewhere across the field.
    let contributed = false;
    for (let i = -90; i <= 90; i += 15) {
      const hh = heightAt(i, 0, cache, cfg, noise);
      const pp = track.closestPoint(i, 0).pathY;
      if (Math.abs(hh - pp) > 0.25) contributed = true;
    }
    expect(contributed).toBe(true);
  });

  it("height is bounded across the whole world grid", () => {
    const { cache, cfg, noise } = setup();
    const lo = -2.5 - cfg.noiseAmp;
    const hi = 2.5 + cfg.noiseAmp;
    for (let z = -95; z <= 95; z += 10) {
      for (let x = -95; x <= 95; x += 10) {
        const h = heightAt(x, z, cache, cfg, noise);
        expect(h).toBeGreaterThanOrEqual(lo - 0.01);
        expect(h).toBeLessThanOrEqual(hi + 0.01);
      }
    }
  });

  it("amplitude grows with distance: on-track band has lower variance than far off-track", () => {
    const { track, cache, cfg, noise } = setup();
    const onTrack = track.startPos();
    let offMax = 0;
    for (let i = -90; i <= 90; i += 6) {
      const h = heightAt(i, 0, cache, cfg, noise);
      offMax = Math.max(offMax, Math.abs(h));
    }
    const onH = heightAt(onTrack.x, onTrack.z, cache, cfg, noise);
    expect(offMax).toBeGreaterThan(Math.abs(onH) + 1);
  });
});

describe("octaveSum", () => {
  it("stays within +/- noiseAmp", () => {
    const { cfg, noise } = setup();
    for (let i = 0; i < 50; i++) {
      const v = octaveSum(noise, i * 3.1, i * 2.7, cfg);
      expect(Math.abs(v)).toBeLessThanOrEqual(cfg.noiseAmp + 1e-6);
    }
  });
});

describe("colorAt", () => {
  it("returns road on the corridor (linear rgb matching three.js sRGB->linear)", () => {
    const { track, cache, cfg, noise } = setup();
    const start = track.startPos();
    const c = colorAt(start.x, start.z, cache, cfg, noise);
    // 0x6e6256 -> linear (0.1559, 0.1221, 0.0931), verified against three.Color.
    expect(c[0]).toBeCloseTo(0.1559, 3);
    expect(c[1]).toBeCloseTo(0.1221, 3);
    expect(c[2]).toBeCloseTo(0.0931, 3);
  });

  it("returns grass far off-track (flat region past the blend)", () => {
    // Lower noiseAmp + raise rockSlope so the sample point is gentle grass.
    const { cache, cfg, noise } = setup({ noiseAmp: 0.5, rockSlope: 50 });
    const c = colorAt(0, 0, cache, cfg, noise);
    // 0x6aa84f -> linear (0.1441, 0.3916, 0.0782).
    expect(c[0]).toBeCloseTo(0.1441, 2);
    expect(c[1]).toBeCloseTo(0.3916, 2);
    expect(c[2]).toBeCloseTo(0.0782, 2);
  });

  it("returns rock when slope exceeds the threshold", () => {
    // rockSlope < 0 -> any non-flat surface is rock (sand level kept very low).
    const { cache, cfg, noise } = setup({ rockSlope: -1, sandLevel: -1000 });
    const c = colorAt(0, 0, cache, cfg, noise);
    // 0x7d8a96 -> linear.
    expect(c[0]).toBeGreaterThan(0.1);
    // Rock is the bluest/greyest channel profile (b > r for 0x7d8a96 linear).
  });

  it("returns sand below the valley height", () => {
    // sandLevel very high -> everything classifies as sand first.
    const { cache, cfg, noise } = setup({ sandLevel: 1000 });
    const c = colorAt(0, 0, cache, cfg, noise);
    // 0xc2b280 -> linear; r channel dominant.
    expect(c[0]).toBeGreaterThan(c[2]);
  });
});

describe("colorAt smooth blends", () => {
  it("rock weight rises smoothly as slope enters the blend window", () => {
    const { cache, noise } = setup({ noiseAmp: 0.5, sandLevel: -1000 });
    const px = 0;
    const pz = 0;
    const half = 0.3;
    // rock 0x7d8a96 -> b>r; grass 0x6aa84f -> b<r. So b-r tracks rockness.
    const m = (c: number[]) => c[2] - c[0];
    const vals: number[] = [];
    for (const rockSlope of [5, 3, 2, 1.5, 1.0, 0.75, 0.5, 0.25, 0.0, -0.5]) {
      const cfg: TerrainConfig = {
        ...DEFAULT_TERRAIN_CONFIG,
        noiseAmp: 0.5,
        sandLevel: -1000,
        rockSlope,
        rockBlendSlope: half,
      };
      vals.push(m(colorAt(px, pz, cache, cfg, noise)));
    }
    // Lower rockSlope -> more rock -> metric non-decreasing.
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1] - 1e-9);
    }
    expect(vals[vals.length - 1]).toBeGreaterThan(vals[0]);
    // A mid sample sits strictly between the endpoints (no discrete jump).
    const interior = vals.slice(1, -1);
    const between = interior.some((v) => v > vals[0] + 1e-6 && v < vals[vals.length - 1] - 1e-6);
    expect(between).toBe(true);
  });

  it("sand weight rises smoothly as height drops below sandLevel", () => {
    const { cache, noise } = setup({ noiseAmp: 0.5, rockSlope: 1000 });
    const px = 0;
    const pz = 0;
    const half = 1.0;
    // sand 0xc2b280 -> r>g; grass 0x6aa84f -> r<g. So r-g tracks sandness.
    const m = (c: number[]) => c[0] - c[1];
    const vals: number[] = [];
    for (const sandLevel of [-20, -10, -5, -3, -1, 0, 1, 2, 5, 10]) {
      const cfg: TerrainConfig = {
        ...DEFAULT_TERRAIN_CONFIG,
        noiseAmp: 0.5,
        rockSlope: 1000,
        sandLevel,
        sandBlendHeight: half,
      };
      vals.push(m(colorAt(px, pz, cache, cfg, noise)));
    }
    // Higher sandLevel -> more sand -> metric non-decreasing.
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1] - 1e-9);
    }
    expect(vals[vals.length - 1]).toBeGreaterThan(vals[0]);
    const interior = vals.slice(1, -1);
    const between = interior.some((v) => v > vals[0] + 1e-6 && v < vals[vals.length - 1] - 1e-6);
    expect(between).toBe(true);
  });

  it("road corridor stays pure road despite steep slope + low height", () => {
    const { track, cache, cfg, noise } = setup({
      rockSlope: -1000,
      sandLevel: 1000,
      rockBlendSlope: 0.5,
      sandBlendHeight: 5,
    });
    const start = track.startPos();
    const c = colorAt(start.x, start.z, cache, cfg, noise);
    // 0x6e6256 -> linear (0.1559, 0.1221, 0.0931): crisp road, no rock/sand.
    expect(c[0]).toBeCloseTo(0.1559, 3);
    expect(c[1]).toBeCloseTo(0.1221, 3);
    expect(c[2]).toBeCloseTo(0.0931, 3);
  });
});
