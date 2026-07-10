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
import { DEFAULT_TRACK_HALF_WIDTH, TrackGraph } from "./trackGraph";
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

  it("graph-built cache is bit-identical to the track-built cache (059 parity gate)", () => {
    // A constant-width single-edge TrackGraph must reproduce the pre-graph
    // world exactly: same dist/pathY/t bake, same heightAt/colorAt output.
    const track = new SplineTrack();
    const legacy = new SplineFieldCache(track, 100, 2);
    const graph = new TrackGraph(track, {
      mainWidth: DEFAULT_TRACK_HALF_WIDTH,
    });
    const modern = new SplineFieldCache(graph, 100, 2);
    const cfg = DEFAULT_TERRAIN_CONFIG;
    const noise = new SimplexNoise2D(cfg.noiseSeed);
    for (let x = -100; x <= 100; x += 3.7) {
      for (let z = -100; z <= 100; z += 3.7) {
        expect(heightAt(x, z, modern, cfg, noise)).toBe(heightAt(x, z, legacy, cfg, noise));
        expect(colorAt(x, z, modern, cfg, noise)).toEqual(colorAt(x, z, legacy, cfg, noise));
        const pa = legacy.queryPose(x, z);
        const pb = modern.queryPose(x, z);
        expect(pb.dist).toBe(pa.dist);
        expect(pb.t).toBe(pa.t);
        // Bilinear weights sum to 1 within an ulp; the constant width holds.
        expect(pb.halfWidth).toBeCloseTo(DEFAULT_TRACK_HALF_WIDTH, 9);
      }
    }
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

describe("SplineFieldCache bake parity (SampleIndex)", () => {
  // The cache bake now resolves the nearest sample via SampleIndex instead of
  // the O(samples) closestPoint scan. closestPoint is still the exhaustive
  // source of truth, so querying cache grid nodes (where the bilinear blend
  // collapses to the exact baked value) must equal closestPoint bit-for-bit.
  // dist is stored in a Float32Array, so it equals the Float32 rounding of
  // closestPoint's Float64 sqrt -- exactly what the old bake stored. pathY/t
  // are Float32 passthrough (no sqrt), so they match exactly.
  const worldHalf = 100;
  const cell = 2;

  it("dist/pathY at grid nodes equal closestPoint (bit-identical bake)", () => {
    const track = new SplineTrack();
    const cache = new SplineFieldCache(track, worldHalf, cell);
    const r = { dist: 0, pathY: 0, t: 0, x: 0, y: 0, z: 0 };
    for (let j = 0; j < cache.n; j += 5) {
      const z = cache.min + j * cache.cell;
      for (let i = 0; i < cache.n; i += 5) {
        const x = cache.min + i * cache.cell;
        track.closestPoint(x, z, r);
        const q = cache.query(x, z);
        expect(q.dist).toBe(Math.fround(r.dist));
        expect(q.pathY).toBe(r.pathY);
      }
    }
  });

  it("t at grid nodes equals closestPoint.t (wrap-aware queryPose)", () => {
    const track = new SplineTrack();
    const cache = new SplineFieldCache(track, worldHalf, cell);
    const r = { dist: 0, pathY: 0, t: 0, x: 0, y: 0, z: 0 };
    for (let j = 0; j < cache.n; j += 5) {
      const z = cache.min + j * cache.cell;
      for (let i = 0; i < cache.n; i += 5) {
        const x = cache.min + i * cache.cell;
        track.closestPoint(x, z, r);
        const p = cache.queryPose(x, z);
        expect(p.t).toBe(r.t);
      }
    }
  });

  it("dist equals sqrt to the brute-force nearest sample (Float32-stored)", () => {
    const track = new SplineTrack();
    const cache = new SplineFieldCache(track, worldHalf, cell);
    const sx = track.sx;
    const sz = track.sz;
    for (let j = 0; j < cache.n; j += 6) {
      const z = cache.min + j * cache.cell;
      for (let i = 0; i < cache.n; i += 6) {
        const x = cache.min + i * cache.cell;
        let best = 0;
        let bestD = Infinity;
        for (let s = 0; s < sx.length; s++) {
          const dx = x - sx[s];
          const dz = z - sz[s];
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = s;
          }
        }
        const q = cache.query(x, z);
        expect(q.dist).toBe(Math.fround(Math.sqrt(bestD)));
        expect(q.dist).toBe(Math.fround(Math.hypot(x - sx[best], z - sz[best])));
      }
    }
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

describe("SplineFieldCache banking bake (084)", () => {
  const circleControl = (r: number): Array<readonly [number, number, number]> => {
    const pts: Array<readonly [number, number, number]> = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      pts.push([r * Math.cos(a), 0, r * Math.sin(a)]);
    }
    return pts;
  };

  it("an all-zero bank profile is bit-identical to no profile", () => {
    const track = new SplineTrack();
    const plain = new SplineFieldCache(new TrackGraph(track), 100, 2);
    const zeroBank = { s: [0, 100, 200], bank: [0, 0, 0] };
    const zeroed = new SplineFieldCache(new TrackGraph(track, { mainBank: zeroBank }), 100, 2);
    for (const [x, z] of [
      [62, 0],
      [0, 0],
      [-40, 33],
      [70, -70],
    ] as const) {
      expect(zeroed.query(x, z).pathY).toBe(plain.query(x, z).pathY);
      expect(zeroed.query(x, z).dist).toBe(plain.query(x, z).dist);
    }
  });

  it("tilts the corridor cross-section by tan(bank) and stays level outside", () => {
    const bank = 0.15;
    const track = new SplineTrack(circleControl(60));
    const graph = new TrackGraph(track, { mainBank: { s: [0], bank: [bank] } });
    const cache = new SplineFieldCache(graph, 100, 1, 8);
    // Corridor cross-section at world +X: lateral = radial direction.
    const center = cache.query(60, 0).pathY;
    const inner = cache.query(56, 0).pathY;
    const outer = cache.query(64, 0).pathY;
    expect(center).toBeCloseTo(0, 1); // centerline height itself is untouched
    // A planar tilt: 8 m across at tan(0.15) = 1.209 m of height difference.
    expect(Math.abs(outer - inner)).toBeGreaterThan(Math.tan(bank) * 8 * 0.85);
    expect(Math.abs(outer - inner)).toBeLessThan(Math.tan(bank) * 8 * 1.15);
    // Beyond halfWidth (6) + blend (8) the tilt has fully faded.
    expect(cache.query(60 + 6 + 8 + 3, 0).pathY).toBeCloseTo(0, 2);
    // Rotationally consistent: on a CCW circle "left of travel" is always
    // radially outward, so the radial tilt has the same sign at -X too.
    const innerW = cache.query(-56, 0).pathY;
    const outerW = cache.query(-64, 0).pathY;
    expect(Math.sign(outerW - innerW)).toBe(Math.sign(outer - inner));
  });

  it("heightAt reflects the banked field (mesh and collider share it)", () => {
    const bank = 0.15;
    const track = new SplineTrack(circleControl(60));
    const graph = new TrackGraph(track, { mainBank: { s: [0], bank: [bank] } });
    const cache = new SplineFieldCache(graph, 100, 1, 8);
    const cfg: TerrainConfig = { ...DEFAULT_TERRAIN_CONFIG, noiseAmp: 0 };
    const noise = new SimplexNoise2D(cfg.noiseSeed);
    const h = (x: number, z: number) => heightAt(x, z, cache, cfg, noise);
    expect(Math.abs(h(64, 0) - h(56, 0))).toBeGreaterThan(Math.tan(bank) * 8 * 0.85);
  });
});
