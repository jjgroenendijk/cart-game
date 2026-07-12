import * as THREE from "three";
import { makeRNG } from "../../core/rng";
import { type BuiltProp, buildOnce, mergeOrFirst, prepPart } from "../propFactory";
import type { FloraBuilder } from "../floraRegistry";

/**
 * Tree archetypes (see `./archetypes.ts` for the library overview).
 *
 *   coniferTree   -> alpinePine / pine / fir (stacked-cone spire)
 *   canopyTree    -> tree / birch            (canopy-on-trunk broadleaf)
 *   branchingTree -> oak / kapok             (visible limbs + wide crown)
 *   snagTree      -> snag / deadSpruce       (bare weathered dead tree)
 *
 * All geometry is authored base-at-y=0 (PropField places the origin at
 * terrain height), deterministic from seed, and WebGL-free (jsdom-testable).
 *
 * Per-seed height: tree configs accept `trunkHRange` so a stand carries
 * real height variation instead of one cloned silhouette. When set, the
 * trunk height is the FIRST RNG draw; when unset the fixed `trunkH` is used
 * and the draw sequence stays byte-identical to the pre-knob builders. The
 * static collider uses the range midpoint (colliders are per-kind, and only
 * the lower trunk matters for kart impacts).
 */

/** Stacked-cone conifer (fir/spruce/pine spire). Big, cylinder collider. */
export interface ConiferTreeConfig {
  trunkH?: number;
  /** Per-seed trunk height range [min, max); overrides trunkH when set. */
  trunkHRange?: readonly [number, number];
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
  /** Per-seed trunk height range [min, max); overrides trunkH when set. */
  trunkHRange?: readonly [number, number];
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

/** Broadleaf with visible limbs + wide lump crown. Big, cylinder collider. */
export interface BranchingTreeConfig {
  trunkH?: number;
  /** Per-seed trunk height range [min, max); overrides trunkH when set. */
  trunkHRange?: readonly [number, number];
  /** Trunk base radius; top tapers to ~0.7x. */
  trunkRadius?: number;
  /** Per-seed limb count via rng.pick. Each limb carries a foliage lump. */
  limbCounts?: readonly number[];
  /** Limb length (horizontal reach ~= limbLen, rise ~= limbLen * 0.7). */
  limbLen?: number;
  /** Max radius of a crown lump; limb lumps use ~0.55x. */
  canopyR?: number;
  /** Per-seed crown lump count via rng.pick. */
  crownCounts?: readonly number[];
  foliage?: readonly number[];
  trunkColor?: number;
}

/** Bare weathered dead tree (no foliage). Big, cylinder collider. */
export interface SnagTreeConfig {
  trunkH?: number;
  /** Per-seed trunk height range [min, max); overrides trunkH when set. */
  trunkHRange?: readonly [number, number];
  /** Trunk base radius; tapers to a near-point (~0.25x). */
  trunkRadius?: number;
  /** Per-seed bare limb count via rng.pick. */
  limbCounts?: readonly number[];
  /** Weathered wood color (single). */
  color?: number;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Cylinder spanning p0 -> p1 (radius rBot at p0, rTop at p1); the limb
 * primitive branchingTree/snagTree hang off the trunk. Default cylinder axis
 * is +Y centred at the origin; rotate +Y onto the segment direction, then
 * translate to the midpoint. WebGL-free (pure BufferGeometry math).
 */
function limbBetween(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  rTop: number,
  rBot: number,
  radial: number,
): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(rTop, rBot, Math.hypot(x1 - x0, y1 - y0, z1 - z0), radial);
  const dir = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize();
  geo.applyMatrix4(
    new THREE.Matrix4().makeRotationFromQuaternion(
      new THREE.Quaternion().setFromUnitVectors(UP, dir),
    ),
  );
  geo.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return geo;
}

/**
 * Stacked-cone conifer: trunk cylinder + tapering cone tiers overlapping
 * upward. Big, cylinder collider. capColor paints the top tier so a cold
 * biome can express a snow-laden crown (undefined -> all tiers use foliage).
 */
export function coniferTree(cfg: ConiferTreeConfig = {}): FloraBuilder {
  const trunkHRange = cfg.trunkHRange;
  const trunkH = cfg.trunkH ?? 8;
  const colliderTrunkH = trunkHRange ? (trunkHRange[0] + trunkHRange[1]) / 2 : trunkH;
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
        // Per-seed height FIRST so a fixed trunkH keeps the legacy sequence.
        const th = trunkHRange ? rng.range(trunkHRange[0], trunkHRange[1]) : trunkH;
        const parts: THREE.BufferGeometry[] = [];

        // Trunk: gentle taper (top ~0.8x base), matching the bespoke pine ratio.
        const trunk = new THREE.CylinderGeometry(trunkRadius * 0.8, trunkRadius, th, 6);
        trunk.translate(0, th / 2, 0);
        parts.push(prepPart(trunk, trunkColor));

        // Stacked conical tiers, each shrinking ~15% and overlapping the next
        // by half its height so the silhouette carries several lumps
        // (cel-readable at distance). The topmost tier takes capColor when set.
        const count = tierCounts && tierCounts.length > 0 ? rng.pick(tierCounts) : tiers;
        let baseY = th - tierH * 0.5;
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
      halfHeight: colliderTrunkH * 0.5,
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
  const trunkHRange = cfg.trunkHRange;
  const trunkH = cfg.trunkH ?? 4;
  const colliderTrunkH = trunkHRange ? (trunkHRange[0] + trunkHRange[1]) / 2 : trunkH;
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
        // Per-seed height FIRST so a fixed trunkH keeps the legacy sequence.
        const th = trunkHRange ? rng.range(trunkHRange[0], trunkHRange[1]) : trunkH;
        const parts: THREE.BufferGeometry[] = [];

        // Trunk: stronger taper (top ~0.64x base), matching the temperate tree.
        const trunk = new THREE.CylinderGeometry(trunkRadius * 0.64, trunkRadius, th, 6);
        trunk.translate(0, th / 2, 0);
        parts.push(prepPart(trunk, trunkColor));

        // Stacked icosahedron lumps shrinking upward, each randomly offset and
        // palette-picked so the crown reads as a leafy canopy. Per-lump radius
        // is rng-scaled within [0.65, 1.0) of canopyR, then shrunk ~12%/tier.
        const count = lobeCounts && lobeCounts.length > 0 ? rng.pick(lobeCounts) : lobes;
        let y = th * 0.9;
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
      halfHeight: colliderTrunkH * 0.4,
      radius: trunkRadius * 1.1,
    },
  };
}

/**
 * Branching broadleaf: tapered trunk + per-seed limbs reaching outward-up,
 * each tipped with a foliage lump, under a wide multi-lump crown. The visible
 * limb structure is what separates it from canopyTree (whose crown floats on
 * a bare pole); use it for the biggest, most characterful trees. Big,
 * cylinder collider (lower trunk only; limbs sit above kart height).
 */
export function branchingTree(cfg: BranchingTreeConfig = {}): FloraBuilder {
  const trunkHRange = cfg.trunkHRange;
  const trunkH = cfg.trunkH ?? 7;
  const colliderTrunkH = trunkHRange ? (trunkHRange[0] + trunkHRange[1]) / 2 : trunkH;
  const trunkRadius = cfg.trunkRadius ?? 0.6;
  const limbCounts = cfg.limbCounts ?? [2, 3, 3];
  const limbLen = cfg.limbLen ?? 2.4;
  const canopyR = cfg.canopyR ?? 3.2;
  const crownCounts = cfg.crownCounts ?? [3, 4];
  const foliage = cfg.foliage ?? [0x4f7a3a, 0x5b8a42];
  const trunkColor = cfg.trunkColor ?? 0x6b4f2e;

  const build = (seed: number): BuiltProp =>
    buildOnce(
      () => {
        const rng = makeRNG(seed);
        // Per-seed height FIRST (mirrors the trunkHRange contract above).
        const th = trunkHRange ? rng.range(trunkHRange[0], trunkHRange[1]) : trunkH;
        const parts: THREE.BufferGeometry[] = [];

        // Trunk: moderate taper (top ~0.7x base).
        const trunk = new THREE.CylinderGeometry(trunkRadius * 0.7, trunkRadius, th, 6);
        trunk.translate(0, th / 2, 0);
        parts.push(prepPart(trunk, trunkColor));

        // Limbs: fork from the upper trunk, splayed around evenly with a
        // per-limb azimuth wobble, reaching outward and up. Each carries a
        // foliage lump at its tip so the crown silhouette breaks out of a
        // single blob and reads as a real branching tree at distance.
        const limbs = rng.pick(limbCounts);
        for (let i = 0; i < limbs; i++) {
          const az = (i / limbs) * Math.PI * 2 + rng.range(-0.4, 0.4);
          const y0 = th * rng.range(0.55, 0.75);
          const reach = limbLen * rng.range(0.8, 1.2);
          const x1 = Math.cos(az) * reach;
          const z1 = Math.sin(az) * reach;
          const y1 = y0 + reach * 0.7;
          const limb = limbBetween(0, y0, 0, x1, y1, z1, trunkRadius * 0.3, trunkRadius * 0.5, 5);
          parts.push(prepPart(limb, trunkColor));
          const lump = new THREE.IcosahedronGeometry(rng.range(0.5, 0.62) * canopyR, 0);
          lump.translate(x1, y1 + canopyR * 0.2, z1);
          parts.push(prepPart(lump, rng.pick(foliage)));
        }

        // Crown: stacked lumps over the trunk top (canopyTree-style).
        const crown = rng.pick(crownCounts);
        let y = th * 0.95;
        for (let i = 0; i < crown; i++) {
          const r = rng.range(canopyR * 0.7, canopyR) * (1 - i * 0.14);
          const lump = new THREE.IcosahedronGeometry(r, 0);
          lump.translate(rng.range(-0.6, 0.6), y, rng.range(-0.6, 0.6));
          parts.push(prepPart(lump, rng.pick(foliage)));
          y += r * 0.65;
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
      halfHeight: colliderTrunkH * 0.45,
      radius: trunkRadius * 1.3,
    },
  };
}

/**
 * Bare weathered snag: sharply tapered dead trunk + a few thin bare limbs.
 * No foliage — a punctuation mark between living trees that makes a stand
 * read as a place with history instead of a repeated asset. Big, cylinder
 * collider.
 */
export function snagTree(cfg: SnagTreeConfig = {}): FloraBuilder {
  const trunkHRange = cfg.trunkHRange;
  const trunkH = cfg.trunkH ?? 6;
  const colliderTrunkH = trunkHRange ? (trunkHRange[0] + trunkHRange[1]) / 2 : trunkH;
  const trunkRadius = cfg.trunkRadius ?? 0.4;
  const limbCounts = cfg.limbCounts ?? [2, 3];
  const color = cfg.color ?? 0x8a7a68;

  const build = (seed: number): BuiltProp =>
    buildOnce(
      () => {
        const rng = makeRNG(seed);
        // Per-seed height FIRST (mirrors the trunkHRange contract above).
        const th = trunkHRange ? rng.range(trunkHRange[0], trunkHRange[1]) : trunkH;
        const parts: THREE.BufferGeometry[] = [];

        // Trunk: hard taper to a near-point (storm-broken spire read).
        const trunk = new THREE.CylinderGeometry(trunkRadius * 0.25, trunkRadius, th, 6);
        trunk.translate(0, th / 2, 0);
        parts.push(prepPart(trunk, color));

        // Bare limbs: thin, kinked upward, ending in nothing. Azimuths are
        // spread + wobbled so no two snags share a silhouette.
        const limbs = rng.pick(limbCounts);
        for (let i = 0; i < limbs; i++) {
          const az = (i / limbs) * Math.PI * 2 + rng.range(-0.5, 0.5);
          const y0 = th * rng.range(0.35, 0.7);
          const reach = th * rng.range(0.18, 0.3);
          const x1 = Math.cos(az) * reach;
          const z1 = Math.sin(az) * reach;
          const y1 = y0 + reach * rng.range(0.6, 1.1);
          const limb = limbBetween(0, y0, 0, x1, y1, z1, trunkRadius * 0.12, trunkRadius * 0.3, 4);
          parts.push(prepPart(limb, color));
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
      halfHeight: colliderTrunkH * 0.5,
      radius: trunkRadius * 1.5,
    },
  };
}
