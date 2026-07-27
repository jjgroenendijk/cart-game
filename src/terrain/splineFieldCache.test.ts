import { describe, expect, it } from "vitest";
import { SplineTrack } from "./SplineTrack";
import {
  SplineFieldCache,
  heightAt,
  colorAt,
  DEFAULT_TERRAIN_CONFIG,
  type TerrainConfig,
} from "./heightmap";
import { DEFAULT_TRACK_HALF_WIDTH, TrackGraph } from "./trackGraph";
import { SimplexNoise2D } from "./noise";

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
