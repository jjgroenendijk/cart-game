import { describe, expect, it } from "vitest";
import { SplineTrack } from "./SplineTrack";
import {
  SplineFieldCache,
  colorAt,
  cachedColors,
  DEFAULT_TERRAIN_CONFIG,
  type TerrainConfig,
} from "./heightmap";
import { TrackGraph } from "./trackGraph";
import { SimplexNoise2D } from "./noise";

function setup(cfgOverride: Partial<TerrainConfig> = {}) {
  const track = new SplineTrack();
  const cache = new SplineFieldCache(track, 100, 2);
  const cfg: TerrainConfig = { ...DEFAULT_TERRAIN_CONFIG, ...cfgOverride };
  const noise = new SimplexNoise2D(cfg.noiseSeed);
  return { track, cache, cfg, noise };
}

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

  // 059: the baked per-station halfWidth is authoritative, so the blend band
  // sweeps via the graph's mainWidth (cfg.trackHalfWidth is only the
  // fallback for samples without a baked width).
  const widthCache = (track: SplineTrack, halfWidth: number) =>
    new SplineFieldCache(new TrackGraph(track, { mainWidth: halfWidth }), 100, 2);

  it("w=0 -> pure road, w=1 -> pure grass, mid-blend strictly between", () => {
    const { track, cache, noise } = setup(flat);
    const start = track.startPos();
    const road = colorAt(start.x, start.z, cache, { ...DEFAULT_TERRAIN_CONFIG, ...flat }, noise);
    // halfWidth far negative -> dist(0) past edge1 -> w=1 -> pure grass.
    const grass = colorAt(
      start.x,
      start.z,
      widthCache(track, -10),
      { ...DEFAULT_TERRAIN_CONFIG, ...flat, blendWidth: 1 },
      noise,
    );
    // halfWidth = -2, blendWidth = 4 -> smoothstep(-2, 2, 0) = 0.5.
    const mid = colorAt(
      start.x,
      start.z,
      widthCache(track, -2),
      { ...DEFAULT_TERRAIN_CONFIG, ...flat, blendWidth: 4 },
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

  it("color rises monotonically road->grass as halfWidth sweeps the blend", () => {
    const { track, noise } = setup(flat);
    const start = track.startPos();
    // Grass is g-dominant, road is not; g-r rises with grassness.
    const metric = (c: number[]) => c[1] - c[0];
    const vals: number[] = [];
    for (const halfWidth of [10, 6, 4, 2, 0, -2, -4, -6, -10]) {
      const cfg: TerrainConfig = {
        ...DEFAULT_TERRAIN_CONFIG,
        ...flat,
        blendWidth: 4,
      };
      vals.push(metric(colorAt(start.x, start.z, widthCache(track, halfWidth), cfg, noise)));
    }
    // Smaller halfWidth -> farther into blend -> more grass -> rises.
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1] - 1e-9);
    }
    expect(vals[vals.length - 1]).toBeGreaterThan(vals[0]);
    const interior = vals.slice(1, -1);
    const between = interior.some((v) => v > vals[0] + 1e-6 && v < vals[vals.length - 1] - 1e-6);
    expect(between).toBe(true);
  });
});
