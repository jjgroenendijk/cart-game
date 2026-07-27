import { describe, expect, it } from "vitest";
import { SplineTrack } from "./SplineTrack";
import {
  SplineFieldCache,
  heightAt,
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
