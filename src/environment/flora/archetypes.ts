import * as THREE from "three";
import { makeRNG } from "../../core/rng";
import { type BuiltProp, buildOnce, mergeOrFirst, prepPart, ROCK_BURY } from "../propFactory";
import type { FloraBuilder } from "../floraRegistry";

/**
 * Parameterized flora archetype builders (backlog 055 commit 1). Each
 * archetype takes a config of knobs and returns the same {build, big,
 * collider} shape `registerFlora` consumes, so a new biome assembles its
 * flora from data instead of hand-building bespoke geometry. The shapes
 * mirror the four recurring structures across temperate/desert/alpine/
 * tundra:
 *   coniferTree  -> alpinePine / pine             (stacked-cone spire)
 *   canopyTree   -> tree                           (canopy-on-trunk broadleaf)
 *   ballRock     -> rock/sandRock/screeRock/iceRock (noisy dodeca)
 *   lumpyShrub   -> bush/dryShrub/lichenBush/snowBush (squashed ico)
 *   groundDecor  -> grass (blade) / flower (petal)
 *
 * Pure addition — nothing imports this yet; no kinds are registered. Commit 2
 * migrates tundra onto it; new biomes (029-036) consume it directly. All
 * geometry is authored base-at-y=0 (PropField places the origin at terrain
 * height), deterministic from seed, and WebGL-free (jsdom-testable like the
 * bespoke modules).
 *
 * Decor builders (lumpyShrub, groundDecor) ignore the seed arg (shared
 * template) — `() => BuiltProp` is assignable to `(seed: number) => BuiltProp`.
 */

// ---------------------------------------------------------------------------
// config types
// ---------------------------------------------------------------------------

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

/** Noisy dodecahedron rock. Big, ball collider sharing the visual radius. */
export interface BallRockConfig {
  rMin?: number;
  rMax?: number;
  /** Rock color (single). */
  color?: number;
  /** Optional y-scale for squashed rocks (e.g. scattered flagstone). */
  flatten?: number;
}

/** Squashed icosahedron shrub. Decor (big=false), collider none. */
export interface LumpyShrubConfig {
  r?: number;
  /** Y-scale squash (lower = hugging the ground). */
  squashY?: number;
  color?: number;
  /** Vertical offset (lifts the base off the ground). */
  yOffset?: number;
}

/** Flat ground decor: crossed blades or stem+petal. Decor, collider none. */
export interface GroundDecorConfig {
  /** "blade" = crossed planes (grass); "petal" = stem + petal blobs. */
  mode?: "blade" | "petal";
  /** Blade or stem height. */
  h?: number;
  /** Blade or petal count (defaults: blade 3, petal 1). */
  count?: number;
  /** Color palette; blades/petals cycle through it by index. */
  palette?: readonly number[];
  /** Stem color (petal mode only). */
  stemColor?: number;
}

// ---------------------------------------------------------------------------
// builders
// ---------------------------------------------------------------------------

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

/**
 * Noisy dodecahedron rock: the exact per-corner displacement algorithm shared
 * by rock/sandRock/screeRock/iceRock. Big, ball collider whose radius derives
 * from the same first RNG draw as the visual so the collider tracks the
 * visible bulk. flatten (y-scale) squashes the rock for flagstone reads.
 */
export function ballRock(cfg: BallRockConfig = {}): FloraBuilder {
  const rMin = cfg.rMin ?? 0.9;
  const rMax = cfg.rMax ?? 1.8;
  const color = cfg.color ?? 0x7d8a96;
  const flatten = cfg.flatten;

  // radius(seed) is the single source of truth shared by the visual + the
  // ball collider: both draw the same first RNG value so the collider tracks
  // the visible rock bulk (PropField.createBody parity with bespoke rocks).
  const radius = (seed: number): number => makeRNG(seed).range(rMin, rMax);

  const build = (seed: number): BuiltProp =>
    buildOnce(
      () => {
        const rng = makeRNG(seed);
        // First draw MUST match radius(seed) above.
        const r = rng.range(rMin, rMax);
        const geo = new THREE.DodecahedronGeometry(r, 0);
        if (flatten !== undefined) geo.scale(1, flatten, 1);
        const pos = geo.attributes.position as THREE.BufferAttribute;

        // DodecahedronGeometry is non-indexed: each triangle owns 3 fresh
        // verts, so the ~20 spatial corners are duplicated ~3x. A per-entry RNG
        // scale would tear coincident verts apart -> gaps between every face.
        // Displace by a scale keyed on the quantized base position so shared
        // corners land together and the mesh stays a single closed surface.
        const scaleByKey = new Map<number, number>();
        const keyOf = (x: number, y: number, z: number): number =>
          (Math.round(x * 1e4) * 73856093) ^
          (Math.round(y * 1e4) * 19349663) ^
          (Math.round(z * 1e4) * 83492791);

        const v = new THREE.Vector3();
        let minY = Infinity;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          const k = keyOf(v.x, v.y, v.z);
          let d = scaleByKey.get(k);
          if (d === undefined) {
            d = 1 + rng.unit() * 0.3;
            scaleByKey.set(k, d);
          }
          v.multiplyScalar(d);
          pos.setXYZ(i, v.x, v.y, v.z);
          if (v.y < minY) minY = v.y;
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();
        // Author the base below y=0 by ROCK_BURY*r: the lowest displaced
        // corner would otherwise balance the rock on a single point. PropField
        // places the origin at terrain height, so sinking embeds the lower
        // faces into the ground. Track the displaced min Y so the offset is
        // exact.
        geo.translate(0, -minY - r * ROCK_BURY, 0);
        return prepPart(geo, color);
      },
      { vertexColors: true },
    );

  return {
    build,
    big: true,
    collider: { shape: "ball", radius, bury: ROCK_BURY },
  };
}

/**
 * Squashed icosahedron shrub (bush/dry/lichen/snow read). Decor (big=false),
 * collider none. Shared template — ignores seed for an InstancedMesh.
 */
export function lumpyShrub(cfg: LumpyShrubConfig = {}): FloraBuilder {
  const r = cfg.r ?? 0.9;
  const squashY = cfg.squashY ?? 0.7;
  const color = cfg.color ?? 0x4f7a3a;
  const yOffset = cfg.yOffset ?? 0.45;

  const build = (): BuiltProp =>
    buildOnce(
      () => {
        const geo = new THREE.IcosahedronGeometry(r, 0);
        geo.scale(1, squashY, 1);
        geo.translate(0, yOffset, 0);
        return geo;
      },
      { color },
    );

  return { build, big: false, collider: { shape: "none" } };
}

/**
 * Flat ground decor. "blade" = crossed PlaneGeometry blades (grass);
 * "petal" = stem cylinder + icosahedron petal blobs (flower). Decor
 * (big=false), collider none. Shared template — ignores seed.
 */
export function groundDecor(cfg: GroundDecorConfig = {}): FloraBuilder {
  const mode = cfg.mode ?? "blade";
  const h = cfg.h ?? 0.5;
  const palette = cfg.palette ?? [0x5b8a42];
  const stemColor = cfg.stemColor ?? 0x4f7a3a;
  // Petal mode is heavier (stem + ico blobs); default to 1 bloom so the
  // decor triangle budget (<= 60) holds. Blade mode defaults to 3 blades.
  const count = cfg.count ?? (mode === "blade" ? 3 : 1);

  const build = (): BuiltProp =>
    buildOnce(
      () => {
        const parts: THREE.BufferGeometry[] = [];
        if (mode === "blade") {
          // Crossed plane blades (like grass); each rotated around Y.
          const w = 0.08;
          for (let i = 0; i < count; i++) {
            const blade = new THREE.PlaneGeometry(w, h);
            blade.translate(0, h / 2, 0);
            blade.rotateY((i / count) * Math.PI);
            parts.push(prepPart(blade, palette[i % palette.length]!));
          }
        } else {
          // Stem + petal blobs (like a flower). count=1 centres a single
          // bloom; count>1 rings petals around the stem top.
          const stem = new THREE.CylinderGeometry(0.03, 0.04, h, 4);
          stem.translate(0, h / 2, 0);
          parts.push(prepPart(stem, stemColor));
          for (let i = 0; i < count; i++) {
            const ang = (i / count) * Math.PI * 2;
            const rad = count > 1 ? 0.12 : 0;
            const petal = new THREE.IcosahedronGeometry(0.14, 0);
            petal.translate(Math.cos(ang) * rad, h + 0.05, Math.sin(ang) * rad);
            parts.push(prepPart(petal, palette[i % palette.length]!));
          }
        }
        return mergeOrFirst(parts);
      },
      { vertexColors: true },
    );

  return { build, big: false, collider: { shape: "none" } };
}
