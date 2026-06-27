import { describe, expect, it } from "vitest";
import { SplineTrack } from "./SplineTrack";
import { SplineFieldCache, DEFAULT_TERRAIN_CONFIG, heightAt, colorAt } from "./heightmap";
import { SimplexNoise2D } from "./noise";
import { WorldHeightSource, normalFromHeight } from "./heightSource";

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
