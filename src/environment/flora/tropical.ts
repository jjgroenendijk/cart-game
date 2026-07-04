import * as THREE from "three";
import { makeRNG, type RNG } from "../../core/rng";
import { type BuiltProp, buildOnce, mergeOrFirst, prepPart } from "../propFactory";
import { registerFlora } from "../floraRegistry";
import { ballRock, lumpyShrub, groundDecor } from "./archetypes";

/**
 * Tropical flora: 4 cel kinds (palm/jungleRock/fernShrub/tropicalFlower) for
 * backlog 030. A lush jungle read: tall palms with splayed frond crowns,
 * mossy rocks, vivid ferns, and hot-coloured ground flowers. Pure addition
 * — nothing references these kinds yet; registering at module load wires them
 * into the flora registry so a later commit resolves them by kind name from a
 * Tropical biome selector.
 *
 * palm is bespoke (buildOnce + mergeOrFirst + prepPart, mirroring the desert
 * cactus): the radial frond silhouette is load-bearing for the tropical read,
 * so the src/terrain/AGENTS.md escape hatch applies — no archetype knob expresses
 * a splayed crown. jungleRock/fernShrub/tropicalFlower are pure archetype
 * configs. All geometry is base-at-y=0, deterministic from seed, WebGL-free
 * (jsdom-testable like the bespoke modules).
 *
 * Decor builders (fernShrub/tropicalFlower) ignore the seed arg (shared
 * template) — `() => BuiltProp` is assignable to `(seed: number) => BuiltProp`.
 * jungleRockRadius delegates to the ballRock archetype's radius fn so the
 * visual + Rapier ball collider share the first RNG draw.
 */

/** Palette (sRGB hex; vivid jungle read aligned to the 030 terrain). */
const PALM_TRUNK_COLOR = 0x6b4f2e;
const PALM_FROND_COLORS = [0x2f6a2a, 0x3f8a3a] as const;
const JUNGLE_ROCK_COLOR = 0x6a7a5a;
const FERN_COLOR = 0x3f8a3a;
const FLOWER_COLORS = [0xd84a4a, 0xe89a3a, 0xe8d83a] as const;
const FLOWER_STEM_COLOR = 0x4f7a3a;

// Knobs tuned to a tall, thin palm (commit 2 of 030).
const PALM_BASE_H = 0.4;
const PALM_TRUNK_H = 6;

const jungleRock = ballRock({
  rMin: 0.9,
  rMax: 1.8,
  color: JUNGLE_ROCK_COLOR,
});

const fernShrub = lumpyShrub({
  r: 0.8,
  squashY: 0.6,
  color: FERN_COLOR,
  yOffset: 0.4,
});

const tropicalFlower = groundDecor({
  mode: "petal",
  palette: FLOWER_COLORS,
  stemColor: FLOWER_STEM_COLOR,
});

/** Big prop: bespoke palm — woody base + tall thin trunk + splayed frond crown. */
export function buildPalm(seed: number): BuiltProp {
  return buildOnce(() => buildPalmGeometry(makeRNG(seed)), { vertexColors: true });
}

/** Big prop: per-instance noisy dodecahedron mossy jungle rock. */
export function buildJungleRock(seed: number): BuiltProp {
  return jungleRock.build(seed);
}

/** Decor: shared squashed vivid-green fern for an InstancedMesh (seed ignored). */
export function buildFernShrub(): BuiltProp {
  return fernShrub.build(0);
}

/** Decor: shared stem + hot-coloured petal bloom (seed ignored). */
export function buildTropicalFlower(): BuiltProp {
  return tropicalFlower.build(0);
}

// ---------------------------------------------------------------------------
// palm geometry (bespoke; the frond silhouette is load-bearing)
// ---------------------------------------------------------------------------

function buildPalmGeometry(rng: RNG): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Woody root flare: a slightly wider stub so the palm reads as rooted.
  const base = new THREE.CylinderGeometry(0.34, 0.42, PALM_BASE_H, 6);
  base.translate(0, PALM_BASE_H / 2, 0);
  parts.push(prepPart(base, PALM_TRUNK_COLOR));

  // Tall thin tapering trunk (ringed read via cel bands on the cylinder).
  const trunk = new THREE.CylinderGeometry(0.2, 0.28, PALM_TRUNK_H, 6);
  trunk.translate(0, PALM_BASE_H + PALM_TRUNK_H / 2, 0);
  parts.push(prepPart(trunk, PALM_TRUNK_COLOR));

  // Crown height where fronds emerge (top of the trunk).
  const crownY = PALM_BASE_H + PALM_TRUNK_H;

  // Crown knuckle: a small icosahedron bud anchoring the fronds so the join
  // reads as a single crown rather than floating cones.
  const knuckle = new THREE.IcosahedronGeometry(0.4, 0);
  knuckle.translate(0, crownY, 0);
  parts.push(prepPart(knuckle, rng.pick(PALM_FROND_COLORS)));

  // Fronds: >=2 lumps (plan risk: trunk + >=2 frond lumps so the cel read
  // holds at distance). Each is an elongated cone splayed radially + tilted
  // outward from the crown, palette-picked. Count + length + tilt vary per
  // seed; pick([2,3]) reconciles the spec's "1-3 fronds" range with the hard
  // >=2 floor (1 is excluded so the silhouette never reads as a bare pole).
  const fronds = rng.pick([2, 3]);
  for (let i = 0; i < fronds; i++) {
    const azimuth = (i / fronds) * Math.PI * 2 + rng.range(-0.25, 0.25);
    const len = rng.range(2.0, 2.6);
    const tilt = rng.range(1.0, 1.3); // ~57-74 deg off vertical (outward splay)
    const frond = new THREE.ConeGeometry(0.16, len, 4);
    // Base (thick end) at origin, apex at +y; tilt outward then spin to azimuth.
    frond.translate(0, len / 2, 0);
    frond.rotateZ(tilt);
    frond.rotateY(azimuth);
    frond.translate(0, crownY, 0);
    parts.push(prepPart(frond, rng.pick(PALM_FROND_COLORS)));
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
// registry wiring (pure addition; a later commit selects biome flora)
// ---------------------------------------------------------------------------

registerFlora("palm", {
  build: buildPalm,
  big: true,
  // Collider pinned to the trunk (mirrors the desert cactus contract): the
  // cylinder spans the lower trunk bulk a kart collides with (y 0..4); the
  // frond crown sits above kart height and needs no collider.
  collider: { shape: "cylinder", halfHeight: 2.0, radius: 0.5 },
});

registerFlora("jungleRock", jungleRock);

registerFlora("fernShrub", fernShrub);

registerFlora("tropicalFlower", tropicalFlower);
