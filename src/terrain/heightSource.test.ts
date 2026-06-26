import { describe, expect, it } from "vitest";
import { SplineTrack } from "./SplineTrack";
import { SplineFieldCache, DEFAULT_TERRAIN_CONFIG, heightAt, colorAt } from "./heightmap";
import { SimplexNoise2D } from "./noise";
import { WorldHeightSource } from "./heightSource";

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
