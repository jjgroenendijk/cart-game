import { describe, expect, it } from "vitest";
import { SplineTrack } from "./SplineTrack";
import {
  SplineFieldCache,
  heightAt,
  colorAt,
  cachedColors,
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

  it("varies smoothly across a cell (no nearest-snap plateaus)", () => {
    // The base cell index must be floor, not round: round snaps the sample to
    // the nearest node for half of every cell, so dist/pathY go flat-then-ramp
    // each cell -> wobbly road + stripy terrain. In a real gradient cell the
    // bilinear value must change at every step (no consecutive equal samples).
    const track = new SplineTrack();
    const cell = 2;
    const cache = new SplineFieldCache(track, 100, cell);
    const z = 0;
    let checkedGradientCell = false;
    for (let x0 = -70; x0 <= 50; x0 += cell) {
      const samples: number[] = [];
      for (let s = 0; s <= 8; s++) {
        samples.push(cache.query(x0 + (s / 8) * cell, z).dist);
      }
      const range = Math.max(...samples) - Math.min(...samples);
      if (range < 0.2) continue; // flat cell, skip
      checkedGradientCell = true;
      let plateaus = 0;
      for (let s = 1; s < samples.length; s++) {
        if (Math.abs(samples[s] - samples[s - 1]) < 1e-6) plateaus++;
      }
      expect(plateaus).toBe(0);
      break; // one gradient cell is enough to prove smooth interpolation
    }
    expect(checkedGradientCell).toBe(true);
  });
});

describe("SplineFieldCache.queryPose (t cache)", () => {
  // Circular distance between two loop params in [0,1): the short way around.
  const circ = (a: number, b: number): number => {
    const d = Math.abs(a - b) % 1;
    return Math.min(d, 1 - d);
  };

  it("dist matches query() everywhere (shared bilinear index math)", () => {
    const track = new SplineTrack();
    const cache = new SplineFieldCache(track, 100, 2);
    for (let x = -95; x <= 95; x += 7) {
      for (let z = -95; z <= 95; z += 7) {
        const a = cache.query(x, z).dist;
        const b = cache.queryPose(x, z).dist;
        expect(Math.abs(a - b)).toBeLessThan(1e-6);
      }
    }
  });

  it("t matches closestPoint within tolerance on + near the corridor", () => {
    // Walk the loop and probe the corridor band race/AI pose queries run in.
    // closestPoint.t is quantised to 1/1024; the bilinear cache blends the
    // surrounding nodes' nearest-sample t -> error stays sub-sample here.
    const track = new SplineTrack();
    const cache = new SplineFieldCache(track, 100, 2);
    let maxErr = 0;
    for (let i = 0; i < 96; i++) {
      const p = track.getPoint(i / 96);
      for (const off of [0, 2, -2, 4]) {
        const x = p.x + off;
        const z = p.z;
        const brute = track.closestPoint(x, z).t;
        const cached = cache.queryPose(x, z).t;
        maxErr = Math.max(maxErr, circ(brute, cached));
      }
    }
    expect(maxErr).toBeLessThan(0.02);
  });

  it("t respects the closed loop at the seam (unwrap, no 0.5 collapse)", () => {
    // Seam is t=0 at startPos (~62,0,0). Straddle it: just before (~0.99) and
    // just after (~0.01). A naive bilinear blends 0.99 and 0.01 -> ~0.5; the
    // wrap-aware cache must stay on the correct side of the seam.
    const track = new SplineTrack();
    const cache = new SplineFieldCache(track, 100, 2);
    let maxErr = 0;
    for (const dt of [0.99, 0.995, 0.0, 0.005, 0.01]) {
      const p = track.getPoint(dt);
      const brute = track.closestPoint(p.x, p.z).t;
      const cached = cache.queryPose(p.x, p.z).t;
      maxErr = Math.max(maxErr, circ(brute, cached));
    }
    expect(maxErr).toBeLessThan(0.05);
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

describe("cachedColors (per-cfg LINEAR cache)", () => {
  it("memoizes per cfg and gives each color its own array (no aliasing)", () => {
    const { cfg } = setup();
    const c = cachedColors(cfg);
    // Same cfg -> same cached entry.
    expect(cachedColors(cfg)).toBe(c);
    // Each of the four colors is its own distinct array reference; the old
    // shared scratchRGB returned the SAME array for grass/rock/sand, so a
    // later call (or an aliased `out`) would clobber an earlier one.
    const seen: [number, number, number][] = [c.road, c.grass, c.rock, c.sand];
    for (let i = 0; i < seen.length; i++) {
      for (let j = i + 1; j < seen.length; j++) {
        expect(seen[i]).not.toBe(seen[j]);
      }
    }
  });

  it("different cfg objects get their own cached entries", () => {
    const a = setup();
    const b = setup();
    expect(cachedColors(a.cfg)).not.toBe(cachedColors(b.cfg));
  });
});

describe("colorAt road->grass blend band", () => {
  // Flatten noise + disable rock/sand so the only varying input is
  // w = smoothstep(trackHalfWidth, trackHalfWidth + blendWidth, dist). At the
  // start point dist ~= 0, so sweeping trackHalfWidth walks w from 0 (pure
  // road) through the blend to 1 (pure grass).
  const flat = { noiseAmp: 0, sandLevel: -1000, rockSlope: 1000 } as const;

  it("w=0 -> pure road, w=1 -> pure grass, mid-blend strictly between", () => {
    const { track, cache, noise } = setup(flat);
    const start = track.startPos();
    const road = colorAt(start.x, start.z, cache, { ...DEFAULT_TERRAIN_CONFIG, ...flat }, noise);
    // trackHalfWidth far negative -> dist(0) past edge1 -> w=1 -> pure grass.
    const grass = colorAt(
      start.x,
      start.z,
      cache,
      { ...DEFAULT_TERRAIN_CONFIG, ...flat, trackHalfWidth: -10, blendWidth: 1 },
      noise,
    );
    // trackHalfWidth = -2, blendWidth = 4 -> smoothstep(-2, 2, 0) = 0.5.
    const mid = colorAt(
      start.x,
      start.z,
      cache,
      { ...DEFAULT_TERRAIN_CONFIG, ...flat, trackHalfWidth: -2, blendWidth: 4 },
      noise,
    );
    // Endpoints: pure road / pure grass.
    expect(road[0]).toBeCloseTo(0.1559, 4); // 0x6e6256 linear r
    expect(grass[0]).toBeCloseTo(0.1441, 3); // 0x6aa84f linear r
    expect(grass[1]).toBeCloseTo(0.3916, 3); // 0x6aa84f linear g
    // Mid-blend strictly between on the green channel (road g < grass g).
    expect(mid[1]).toBeGreaterThan(road[1] + 1e-4);
    expect(mid[1]).toBeLessThan(grass[1] - 1e-4);
  });

  it("color rises monotonically road->grass as trackHalfWidth sweeps the blend", () => {
    const { track, cache, noise } = setup(flat);
    const start = track.startPos();
    // Grass is g-dominant, road is not; g-r rises with grassness.
    const metric = (c: number[]) => c[1] - c[0];
    const vals: number[] = [];
    for (const trackHalfWidth of [10, 6, 4, 2, 0, -2, -4, -6, -10]) {
      const cfg: TerrainConfig = {
        ...DEFAULT_TERRAIN_CONFIG,
        ...flat,
        trackHalfWidth,
        blendWidth: 4,
      };
      vals.push(metric(colorAt(start.x, start.z, cache, cfg, noise)));
    }
    // Smaller trackHalfWidth -> farther into blend -> more grass -> rises.
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1] - 1e-9);
    }
    expect(vals[vals.length - 1]).toBeGreaterThan(vals[0]);
    const interior = vals.slice(1, -1);
    const between = interior.some((v) => v > vals[0] + 1e-6 && v < vals[vals.length - 1] - 1e-6);
    expect(between).toBe(true);
  });
});
