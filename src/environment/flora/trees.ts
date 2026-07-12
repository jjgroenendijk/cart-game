import * as THREE from "three";
import { makeRNG } from "../../core/rng";
import { type BuiltProp, buildOnce, mergeOrFirst, prepPart } from "../propFactory";
import type { FloraBuilder } from "../floraRegistry";

/**
 * Tree archetypes (split from the single archetypes.ts module; see
 * `./archetypes.ts` for the library overview). Builders are moved verbatim:
 * same knobs, same RNG draw order, same geometry for a given seed.
 *
 *   coniferTree  -> alpinePine / pine  (stacked-cone spire)
 *   canopyTree   -> tree               (canopy-on-trunk broadleaf)
 *
 * All geometry is authored base-at-y=0 (PropField places the origin at
 * terrain height), deterministic from seed, and WebGL-free (jsdom-testable).
 */

/** Stacked-cone conifer (fir/spruce/pine spire). Big, cylinder collider. */
export interface ConiferTreeConfig {
  trunkH?: number;
  /** Trunk base radius; top tapers to ~0.8x. */
  trunkRadius?: number;
  /** Fixed foliage tier count; ignored when tierCounts is set. */
  tiers?: number;
  /** Per-seed tier count via rng.pick (mirrors alpine [4,5] / tundra [3,4]). */
  tierCounts?: readonly number[];
  /** Base radius of the bottom tier; upper tiers shrink ~15%/tier. */
  tierRadius?: number;
  /** Height of each foliage cone tier. */
  tierH?: number;
  /** Foliage palette; each non-cap tier picks one (single-element = uniform). */
  foliage?: readonly number[];
  trunkColor?: number;
  /** Optional color painted on the TOP tier only (snow-laden crown). */
  capColor?: number;
}

/** Canopy-on-trunk broadleaf tree. Big, cylinder collider. */
export interface CanopyTreeConfig {
  trunkH?: number;
  /** Trunk base radius; top tapers to ~0.64x. */
  trunkRadius?: number;
  /** Fixed foliage lump count; ignored when lobeCounts is set. */
  lobes?: number;
  /** Per-seed lump count via rng.pick (mirrors temperate [2,3,3,4]). */
  lobeCounts?: readonly number[];
  /** Max radius of a foliage lump; per-lump radius is rng-scaled down. */
  canopyR?: number;
  foliage?: readonly number[];
  trunkColor?: number;
  /** Horizontal offset range per lump (offset drawn in [-jitter, jitter]). */
  jitter?: number;
}

/**
 * Stacked-cone conifer: trunk cylinder + tapering cone tiers overlapping
 * upward. Big, cylinder collider. capColor paints the top tier so a cold
 * biome can express a snow-laden crown (undefined -> all tiers use foliage).
 */
export function coniferTree(cfg: ConiferTreeConfig = {}): FloraBuilder {
  const trunkH = cfg.trunkH ?? 8;
  const trunkRadius = cfg.trunkRadius ?? 0.5;
  const tiers = cfg.tiers ?? 4;
  const tierCounts = cfg.tierCounts;
  const tierRadius = cfg.tierRadius ?? 2.6;
  const tierH = cfg.tierH ?? 3.2;
  const foliage = cfg.foliage ?? [0x2f4a2a];
  const trunkColor = cfg.trunkColor ?? 0x4a3526;
  const capColor = cfg.capColor;

  const build = (seed: number): BuiltProp =>
    buildOnce(
      () => {
        const rng = makeRNG(seed);
        const parts: THREE.BufferGeometry[] = [];

        // Trunk: gentle taper (top ~0.8x base), matching the bespoke pine ratio.
        const trunk = new THREE.CylinderGeometry(trunkRadius * 0.8, trunkRadius, trunkH, 6);
        trunk.translate(0, trunkH / 2, 0);
        parts.push(prepPart(trunk, trunkColor));

        // Stacked conical tiers, each shrinking ~15% and overlapping the next
        // by half its height so the silhouette carries several lumps
        // (cel-readable at distance). The topmost tier takes capColor when set.
        const count = tierCounts && tierCounts.length > 0 ? rng.pick(tierCounts) : tiers;
        let baseY = trunkH - tierH * 0.5;
        for (let i = 0; i < count; i++) {
          const r = tierRadius * (1 - i * 0.15);
          const cone = new THREE.ConeGeometry(r, tierH, 7);
          cone.translate(0, baseY + tierH / 2, 0);
          const isCap = i === count - 1;
          const color = isCap && capColor !== undefined ? capColor : rng.pick(foliage);
          parts.push(prepPart(cone, color));
          baseY += tierH * 0.5;
        }

        return mergeOrFirst(parts);
      },
      { vertexColors: true },
    );

  return {
    build,
    big: true,
    collider: {
      shape: "cylinder",
      halfHeight: trunkH * 0.5,
      radius: trunkRadius * 1.5,
    },
  };
}

/**
 * Canopy-on-trunk broadleaf: trunk cylinder + stacked icosahedron lumps
 * shrinking upward, each randomly offset and palette-picked. Big, cylinder
 * collider. Mirrors the temperate tree silhouette.
 */
export function canopyTree(cfg: CanopyTreeConfig = {}): FloraBuilder {
  const trunkH = cfg.trunkH ?? 4;
  const trunkRadius = cfg.trunkRadius ?? 0.55;
  const lobes = cfg.lobes ?? 3;
  const lobeCounts = cfg.lobeCounts;
  const canopyR = cfg.canopyR ?? 2.4;
  const foliage = cfg.foliage ?? [0x4f7a3a, 0x5b8a42];
  const trunkColor = cfg.trunkColor ?? 0x6b4f2e;
  const jitter = cfg.jitter ?? 0.5;

  const build = (seed: number): BuiltProp =>
    buildOnce(
      () => {
        const rng = makeRNG(seed);
        const parts: THREE.BufferGeometry[] = [];

        // Trunk: stronger taper (top ~0.64x base), matching the temperate tree.
        const trunk = new THREE.CylinderGeometry(trunkRadius * 0.64, trunkRadius, trunkH, 6);
        trunk.translate(0, trunkH / 2, 0);
        parts.push(prepPart(trunk, trunkColor));

        // Stacked icosahedron lumps shrinking upward, each randomly offset and
        // palette-picked so the crown reads as a leafy canopy. Per-lump radius
        // is rng-scaled within [0.65, 1.0) of canopyR, then shrunk ~12%/tier.
        const count = lobeCounts && lobeCounts.length > 0 ? rng.pick(lobeCounts) : lobes;
        let y = trunkH * 0.9;
        for (let i = 0; i < count; i++) {
          const r = rng.range(canopyR * 0.65, canopyR) * (1 - i * 0.12);
          const lump = new THREE.IcosahedronGeometry(r, 0);
          lump.translate(rng.range(-jitter, jitter), y, rng.range(-jitter, jitter));
          parts.push(prepPart(lump, rng.pick(foliage)));
          y += r * 0.7;
        }

        return mergeOrFirst(parts);
      },
      { vertexColors: true },
    );

  return {
    build,
    big: true,
    collider: {
      shape: "cylinder",
      halfHeight: trunkH * 0.4,
      radius: trunkRadius * 1.1,
    },
  };
}
