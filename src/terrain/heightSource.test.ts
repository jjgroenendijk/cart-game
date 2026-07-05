import { describe, expect, it } from "vitest";
import { SplineTrack } from "./SplineTrack";
import {
  SplineFieldCache,
  DEFAULT_TERRAIN_CONFIG,
  heightAt,
  colorAt,
  smoothstep,
  octaveSum,
} from "./heightmap";
import { SimplexNoise2D } from "./noise";
import { WorldHeightSource, StreamingHeightSource, normalFromHeight } from "./heightSource";

function makeSrc() {
  const track = new SplineTrack();
  const cache = new SplineFieldCache(track, 10, 2);
  const cfg = DEFAULT_TERRAIN_CONFIG;
  const noise = new SimplexNoise2D(1);
  return { cache, cfg, noise, src: new WorldHeightSource(cache, cfg, noise) };
}

describe("WorldHeightSource", () => {
  it("heightAt returns a finite number for a small real cache", () => {
    const { src } = makeSrc();
    expect(Number.isFinite(src.heightAt(3, 4))).toBe(true);
  });

  it("colorAt returns a 3-element LINEAR rgb array", () => {
    const { src } = makeSrc();
    const c = src.colorAt(2, -1);
    expect(c.length).toBe(3);
    for (const v of c) expect(Number.isFinite(v)).toBe(true);
  });

  it("heightAt delegates to the world-global heightAt fn", () => {
    const { cache, cfg, noise, src } = makeSrc();
    expect(src.heightAt(2, -3)).toBe(heightAt(2, -3, cache, cfg, noise));
  });

  it("colorAt delegates to the world-global colorAt fn", () => {
    const { cache, cfg, noise, src } = makeSrc();
    expect(src.colorAt(1, 1)).toEqual(colorAt(1, 1, cache, cfg, noise));
  });

  it("colorAt writes into the passed out buffer", () => {
    const { src } = makeSrc();
    const out: [number, number, number] = [9, 9, 9];
    const ret = src.colorAt(0, 0, out);
    expect(ret).toBe(out);
    expect(out).toEqual(src.colorAt(0, 0));
  });
});

describe("WorldHeightSource.normalAt", () => {
  it("returns a unit-length 3-element normal", () => {
    const { src } = makeSrc();
    const n = src.normalAt(2, -1);
    expect(n.length).toBe(3);
    const len = Math.hypot(n[0], n[1], n[2]);
    expect(len).toBeCloseTo(1, 6);
  });

  it("writes into the passed out buffer and returns it", () => {
    const { src } = makeSrc();
    const out: [number, number, number] = [9, 9, 9];
    const ret = src.normalAt(1, 1, out);
    expect(ret).toBe(out);
    expect(out).not.toEqual([9, 9, 9]);
  });

  it("matches normalFromHeight over the same heightAt", () => {
    const { src } = makeSrc();
    const expected = normalFromHeight(3, 4, (x, z) => src.heightAt(x, z));
    expect(src.normalAt(3, 4)).toEqual(expected);
  });
});

describe("normalFromHeight (pure helper)", () => {
  it("flat height fn -> straight up (0,1,0)", () => {
    const n = normalFromHeight(5, 5, () => 10);
    expect(n[0]).toBeCloseTo(0, 6);
    expect(n[1]).toBeCloseTo(1, 6);
    expect(n[2]).toBeCloseTo(0, 6);
  });

  it("h = x -> normal tilts toward -X (slope rises with x)", () => {
    const n = normalFromHeight(0, 0, (x, _z) => x);
    expect(n[0]).toBeLessThan(0);
    expect(n[1]).toBeGreaterThan(0);
    expect(n[2]).toBeCloseTo(0, 6);
  });

  it("is deterministic: same inputs -> same normal", () => {
    const hAt = (x: number, z: number) => Math.sin(x) * Math.cos(z);
    expect(normalFromHeight(1.3, 2.1, hAt)).toEqual(normalFromHeight(1.3, 2.1, hAt));
  });
});

function makeStream() {
  const track = new SplineTrack();
  const cache = new SplineFieldCache(track, 100, 2); // worldHalf 100, cell 2
  const cfg = DEFAULT_TERRAIN_CONFIG;
  const noise = new SimplexNoise2D(1);
  return {
    track,
    cache,
    cfg,
    noise,
    src: new StreamingHeightSource(cache, cfg, noise),
  };
}

describe("StreamingHeightSource", () => {
  it("in-bounds heightAt matches WorldHeightSource exactly", () => {
    const { cache, cfg, noise, src } = makeStream();
    const world = new WorldHeightSource(cache, cfg, noise);
    const pts: ReadonlyArray<readonly [number, number]> = [
      [3, 4],
      [20, -15],
      [-30, 40],
      [0, 0],
    ];
    for (const [x, z] of pts) {
      expect(src.heightAt(x, z)).toBe(world.heightAt(x, z));
    }
  });

  it("in-bounds colorAt matches WorldHeightSource exactly", () => {
    const { cache, cfg, noise, src } = makeStream();
    const world = new WorldHeightSource(cache, cfg, noise);
    expect(src.colorAt(5, -8)).toEqual(world.colorAt(5, -8));
  });

  it("out-of-bounds heightAt matches the closestPoint formula", () => {
    const { track, cfg, noise, src } = makeStream();
    const x = 120;
    const z = 130;
    const cp = track.closestPoint(x, z);
    const w = smoothstep(cfg.trackHalfWidth, cfg.trackHalfWidth + cfg.blendWidth, cp.dist);
    const expected = cp.pathY + octaveSum(noise, x, z, cfg) * w;
    expect(src.heightAt(x, z)).toBeCloseTo(expected, 6);
  });

  it("out-of-bounds returns finite height and a 3-element color", () => {
    const { src } = makeStream();
    const h = src.heightAt(150, -140);
    expect(Number.isFinite(h)).toBe(true);
    const c = src.colorAt(150, -140);
    expect(c.length).toBe(3);
    for (const v of c) expect(Number.isFinite(v)).toBe(true);
  });

  it("height is seamless across the world boundary (no step)", () => {
    const { cache, src } = makeStream();
    const worldMax = cache.min + (cache.n - 1) * cache.cell;
    const z = 40;
    // Walk a line across worldMax; no consecutive pair may jump.
    let prev = src.heightAt(worldMax - 3, z);
    let maxStep = 0;
    for (let dx = -2; dx <= 3; dx++) {
      const h = src.heightAt(worldMax + dx, z);
      maxStep = Math.max(maxStep, Math.abs(h - prev));
      prev = h;
    }
    expect(maxStep).toBeLessThan(0.5);
    // Direct neighbours across the boundary are close.
    const inside = src.heightAt(worldMax - 1, z);
    const outside = src.heightAt(worldMax + 1, z);
    expect(Math.abs(outside - inside)).toBeLessThan(0.5);
  });

  it("out-of-bounds normalAt is unit-length", () => {
    const { src } = makeStream();
    const n = src.normalAt(130, -120);
    expect(n.length).toBe(3);
    const len = Math.hypot(n[0], n[1], n[2]);
    expect(len).toBeCloseTo(1, 6);
  });

  it("out-of-bounds heightAt is deterministic", () => {
    const { src } = makeStream();
    expect(src.heightAt(140, 150)).toBe(src.heightAt(140, 150));
  });
});
