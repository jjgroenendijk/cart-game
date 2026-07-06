import * as THREE from "three";
import { makeRNG, type RNG } from "../../core/rng";
import { type BuiltProp, buildOnce, mergeOrFirst, prepPart } from "../propFactory";
import { registerFlora } from "../floraRegistry";
import { ballRock, groundDecor } from "./archetypes";

/**
 * Tropical flora (cel, low-poly). 6 kinds for the 073 golden-hour palm-shore
 * reskin: palm + jungleRock (big) and fernShrub/tropicalFlower/seaOats/
 * hibiscus (decor). Warm sun-bleached palette aligned to the 073 terrain
 * (grass 0x8fae5a, warm rock) so props belong to the shore instead of
 * clashing as a dark saturated jungle. palm/fernShrub/seaOats/hibiscus are
 * bespoke (buildOnce + mergeOrFirst + prepPart); jungleRock + tropicalFlower
 * are archetype configs. All geometry is base-at-y=0, deterministic from
 * seed, WebGL-free (jsdom-testable).
 *
 * Decor builders ignore the seed (shared template for an InstancedMesh) —
 * `() => BuiltProp` is assignable to `(seed: number) => BuiltProp`.
 * jungleRockRadius delegates to the ballRock radius fn so the visual + Rapier
 * ball collider share the first RNG draw.
 */

// Warm sun-bleached golden-hour palette (073). Greens relate to the terrain
// grass (0x8fae5a); blooms stay hot (coral/amber/gold) for a vivid shore read.
const PALM_TRUNK_COLOR = 0x7a5a36;
const PALM_FROND_COLORS = [0x8fae5a, 0x7fae4a, 0x6f9a44] as const;
const COCONUT_COLOR = 0x5a3a22;
const JUNGLE_ROCK_COLOR = 0x8a6a4a;
const FERN_COLORS = [0x7fae4a, 0x8fae5a, 0x6f9a44] as const;
const FLOWER_COLORS = [0xff6a4a, 0xff9a3a, 0xffd83a, 0xff4a7a] as const;
const FLOWER_STEM_COLOR = 0x6f9a44;
const SEA_OAT_STALK_COLOR = 0x9a8a5a;
const SEA_OAT_HEAD_COLOR = 0xd8b86a;
const HIBISCUS_FOLIAGE_COLOR = 0x7fae4a;
const HIBISCUS_BLOOM_COLORS = [0xff5a7a, 0xff8a4a, 0xffd04a] as const;

// Palm knobs (tall thin trunk + full splayed crown).
const PALM_BASE_H = 0.4;
const PALM_TRUNK_H = 6;

const jungleRock = ballRock({
  rMin: 0.9,
  rMax: 1.8,
  color: JUNGLE_ROCK_COLOR,
});

// Small hot ground bloom (mass of shore colour); 2 petals keeps the decor
// triangle budget modest while reading as a hibiscus-like flower.
const tropicalFlower = groundDecor({
  mode: "petal",
  h: 0.5,
  count: 2,
  palette: FLOWER_COLORS,
  stemColor: FLOWER_STEM_COLOR,
});

/** Big prop: bespoke palm — woody base + tall thin trunk + full frond crown + coconuts. */
export function buildPalm(seed: number): BuiltProp {
  return buildOnce(() => buildPalmGeometry(makeRNG(seed)), { vertexColors: true });
}

/** Big prop: per-instance noisy dodecahedron warm jungle rock. */
export function buildJungleRock(seed: number): BuiltProp {
  return jungleRock.build(seed);
}

/** Decor: bespoke fern clump — radiating warm frond blades (seed ignored). */
export function buildFernShrub(): BuiltProp {
  return buildOnce(buildFernGeometry, { vertexColors: true });
}

/** Decor: shared hot-coloured multi-petal bloom (seed ignored). */
export function buildTropicalFlower(): BuiltProp {
  return tropicalFlower.build(0);
}

/** Decor: bespoke beach sea-oats — tall golden seed-head stalks (seed ignored). */
export function buildSeaOats(): BuiltProp {
  return buildOnce(buildSeaOatsGeometry, { vertexColors: true });
}

/** Decor: bespoke hibiscus — leafy mound + hot blooms (seed ignored). */
export function buildHibiscus(): BuiltProp {
  return buildOnce(buildHibiscusGeometry, { vertexColors: true });
}

// ---------------------------------------------------------------------------
// bespoke geometry
// ---------------------------------------------------------------------------

/**
 * Splay a base-at-origin part outward + around: tilt off vertical by `tilt`
 * (rotateZ) then spin to `azimuth` (rotateY). Shared by palm fronds + sea-oat
 * stalks/heads so a blade built pointing +y fans radially from the crown/base.
 */
function splay(geo: THREE.BufferGeometry, tilt: number, azimuth: number): void {
  geo.rotateZ(tilt);
  geo.rotateY(azimuth);
}

function buildPalmGeometry(rng: RNG): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Woody root flare + tall thin tapering trunk.
  const base = new THREE.CylinderGeometry(0.34, 0.42, PALM_BASE_H, 6);
  base.translate(0, PALM_BASE_H / 2, 0);
  parts.push(prepPart(base, PALM_TRUNK_COLOR));

  const trunk = new THREE.CylinderGeometry(0.2, 0.28, PALM_TRUNK_H, 6);
  trunk.translate(0, PALM_BASE_H + PALM_TRUNK_H / 2, 0);
  parts.push(prepPart(trunk, PALM_TRUNK_COLOR));

  const crownY = PALM_BASE_H + PALM_TRUNK_H;

  // Crown knuckle anchoring the fronds + coconuts so the join reads as one.
  const knuckle = new THREE.IcosahedronGeometry(0.4, 0);
  knuckle.translate(0, crownY, 0);
  parts.push(prepPart(knuckle, rng.pick(PALM_FROND_COLORS)));

  // Coconuts: 2-3 small spheres clustered just under the crown.
  const coconuts = rng.pick([2, 3]);
  for (let i = 0; i < coconuts; i++) {
    const a = (i / coconuts) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const coconut = new THREE.IcosahedronGeometry(0.18, 0);
    coconut.translate(Math.cos(a) * 0.35, crownY - 0.35, Math.sin(a) * 0.35);
    parts.push(prepPart(coconut, COCONUT_COLOR));
  }

  // Fronds: 5-7 flattened leaf blades splayed + drooping radially from the
  // crown. A cone flattened thin in z reads as a feathery frond; a near-
  // horizontal tilt + the count gives a full palm crown that holds at distance
  // (the pre-073 2-3 thin cones read as a bare pole).
  const fronds = rng.pick([5, 6, 7]);
  for (let i = 0; i < fronds; i++) {
    const azimuth = (i / fronds) * Math.PI * 2 + rng.range(-0.25, 0.25);
    const len = rng.range(2.4, 3.0);
    const tilt = rng.range(1.2, 1.5); // ~69-86 deg off vertical (outward splay)
    const frond = new THREE.ConeGeometry(0.45, len, 4);
    frond.translate(0, len / 2, 0);
    frond.scale(1, 1, 0.2); // flatten into a leaf blade
    splay(frond, tilt, azimuth);
    frond.translate(0, crownY, 0);
    parts.push(prepPart(frond, rng.pick(PALM_FROND_COLORS)));
  }

  return mergeOrFirst(parts);
}

function buildFernGeometry(): THREE.BufferGeometry {
  // Fern clump: warm frond blades fanning around + one upright centre blade.
  // Each blade is a flattened tapered cone tilted outward so the cluster reads
  // as a fern (the pre-073 single squashed ico read as a green blob).
  const parts: THREE.BufferGeometry[] = [];
  const blades = 5;
  for (let i = 0; i < blades; i++) {
    const azimuth = (i / blades) * Math.PI * 2;
    const len = 0.9 + (i % 2) * 0.2;
    const tilt = 0.5 + (i % 2) * 0.2;
    const blade = new THREE.ConeGeometry(0.16, len, 4);
    blade.translate(0, len / 2, 0);
    blade.scale(1, 1, 0.25);
    splay(blade, tilt, azimuth);
    parts.push(prepPart(blade, FERN_COLORS[i % FERN_COLORS.length]!));
  }
  const centre = new THREE.ConeGeometry(0.16, 1.0, 4);
  centre.translate(0, 0.5, 0);
  centre.scale(1, 1, 0.25);
  parts.push(prepPart(centre, FERN_COLORS[0]!));
  return mergeOrFirst(parts);
}

function buildSeaOatsGeometry(): THREE.BufferGeometry {
  // Beach sea-oats: tall thin stalks fanning from the base, each tipped with a
  // small golden seed-head. Tan stalk + gold head reads as dune grass. The
  // head is placed at the un-rotated stalk top (0,h,0) then given the SAME
  // tilt+azimuth splay so it lands exactly at the stalk tip.
  const parts: THREE.BufferGeometry[] = [];
  const stalks = 6;
  for (let i = 0; i < stalks; i++) {
    const azimuth = (i / stalks) * Math.PI * 2;
    const h = 1.1 + (i % 2) * 0.25;
    const tilt = 0.25 + (i % 2) * 0.15;
    const stalk = new THREE.CylinderGeometry(0.025, 0.03, h, 4);
    stalk.translate(0, h / 2, 0);
    splay(stalk, tilt, azimuth);
    parts.push(prepPart(stalk, SEA_OAT_STALK_COLOR));
    const head = new THREE.ConeGeometry(0.1, 0.28, 4);
    head.translate(0, h, 0);
    splay(head, tilt, azimuth);
    parts.push(prepPart(head, SEA_OAT_HEAD_COLOR));
  }
  return mergeOrFirst(parts);
}

function buildHibiscusGeometry(): THREE.BufferGeometry {
  // Hibiscus: a low leafy mound + 2 hot blooms on top for warm shore colour.
  const parts: THREE.BufferGeometry[] = [];
  const foliage = new THREE.IcosahedronGeometry(0.55, 0);
  foliage.scale(1, 0.6, 1);
  foliage.translate(0, 0.35, 0);
  parts.push(prepPart(foliage, HIBISCUS_FOLIAGE_COLOR));
  const blooms = 2;
  for (let i = 0; i < blooms; i++) {
    const a = (i / blooms) * Math.PI * 2;
    const bloom = new THREE.IcosahedronGeometry(0.18, 0);
    bloom.translate(Math.cos(a) * 0.25, 0.6, Math.sin(a) * 0.25);
    parts.push(prepPart(bloom, HIBISCUS_BLOOM_COLORS[i % HIBISCUS_BLOOM_COLORS.length]!));
  }
  return mergeOrFirst(parts);
}

// ballRock always yields a ball collider exposing the radius fn that draws
// the same first RNG value as the visual; delegate so jungleRockRadius tracks
// the archetype's rMin/rMax knob and stays the single source of truth.
const jungleRockRadiusOf =
  jungleRock.collider.shape === "ball"
    ? jungleRock.collider.radius
    : (seed: number): number => makeRNG(seed).range(0.9, 1.8);

/**
 * Base dodeca radius for a jungleRock seed. Delegates to the ballRock
 * archetype's radius fn so the visual + Rapier ball collider share the
 * first RNG draw (PropField.createBody parity). Stable:
 * jungleRockRadius(s) == makeRNG(s).range(0.9, 1.8).
 */
export function jungleRockRadius(seed: number): number {
  return jungleRockRadiusOf(seed);
}

// ---------------------------------------------------------------------------
// registry wiring (pure addition; the tropical biome selects these kinds)
// ---------------------------------------------------------------------------

registerFlora("palm", {
  build: buildPalm,
  big: true,
  // Collider pinned to the trunk (mirrors the desert cactus contract): the
  // cylinder spans the lower trunk bulk a kart collides with (y 0..4); the
  // frond crown + coconuts sit above kart height and need no collider.
  collider: { shape: "cylinder", halfHeight: 2.0, radius: 0.5 },
});

registerFlora("jungleRock", jungleRock);

registerFlora("fernShrub", { build: buildFernShrub, big: false, collider: { shape: "none" } });

registerFlora("tropicalFlower", tropicalFlower);

registerFlora("seaOats", { build: buildSeaOats, big: false, collider: { shape: "none" } });

registerFlora("hibiscus", { build: buildHibiscus, big: false, collider: { shape: "none" } });
