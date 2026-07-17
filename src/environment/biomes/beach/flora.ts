import * as THREE from "three";
import { makeRNG, type RNG } from "../../../core/rng";
import { type BuiltProp, buildOnce, mergeOrFirst, prepPart } from "../../propFactory";
import { registerFlora } from "../../floraRegistry";
import { ballRock, groundDecor } from "../../flora/archetypes";

/**
 * Beach / Coast flora (cel, low-poly). 5 kinds for the bright warm-sand
 * shore: palm + driftwood + seaRock (big, with colliders) and duneGrass +
 * shell (decor, no collider). Palette sits in the bright-beach register —
 * sun-bleached greens/tans on the fronds, weathered grey-tan driftwood, and
 * a wet tide-grey rock — so props read as belonging to the near-white sand
 * instead of a saturated jungle. palm + driftwood are bespoke (buildOnce +
 * mergeOrFirst + prepPart); seaRock is a flattened ballRock archetype;
 * duneGrass + shell are groundDecor archetype configs. All geometry is
 * authored base-at-y=0 (PropField places the origin at terrain height),
 * deterministic from seed, WebGL-free (jsdom-testable).
 *
 * Decor builders ignore the seed arg (shared template for an InstancedMesh) —
 * `() => BuiltProp` is assignable to `(seed: number) => BuiltProp`. seaRock
 * (ballRock) exposes the ball-collider radius fn that draws the same first RNG
 * value as its visual, so the Rapier collider tracks the visible bulk.
 */

// Bright-beach palette (sRGB hex). Sun-bleached greens tint toward pale gold so
// the fronds sit on warm near-white sand; driftwood is a weathered grey-tan;
// the tide rock is a wet warm-grey. Natural pigment only (no neon).
const PALM_TRUNK_COLOR = 0x9a7a52; // pale sun-baked tan-brown bark
const PALM_FROND_COLORS = [0x9aae66, 0x8aa658, 0x7f9a50] as const; // bleached fronds
const COCONUT_COLOR = 0x6a4a2c; // dry husk brown
const DRIFTWOOD_COLORS = [0xbdb199, 0xa89c82, 0xcabfa8] as const; // bleached grey-tan log
const SEA_ROCK_COLOR = 0x8f8577; // wet tide-worn warm grey
const DUNE_GRASS_COLORS = [0xc9c079, 0xb7bd7a, 0xa9b56e] as const; // pale golden dune blades
const SHELL_COLORS = [0xe8dcc4, 0xd8c9a8, 0xcbb894] as const; // pale shore shell/pebble specks

const UP = new THREE.Vector3(0, 1, 0);

// Palm root-flare height (fixed); trunk HEIGHT + lean vary per seed so a
// coastal cluster reads as distinct leaning trees, not identical clones.
const PALM_BASE_H = 0.4;

// Tide-worn stone: a low flattened warm-grey boulder rounded by the surf.
// big=true, ball collider tracking the visual radius (from ballRock).
const seaRock = ballRock({
  rMin: 0.9,
  rMax: 1.7,
  flatten: 0.6,
  color: SEA_ROCK_COLOR,
});

// Dune grass: pale golden/green crossed blades tufting the sand. Decor, none.
const duneGrass = groundDecor({
  mode: "blade",
  h: 0.6,
  w: 0.06,
  count: 4,
  palette: DUNE_GRASS_COLORS,
});

// Shell: a tiny low pale shore speck (shell/pebble bloom). Decor, none.
const shell = groundDecor({
  mode: "petal",
  h: 0.08,
  count: 1,
  palette: SHELL_COLORS,
  stemColor: SHELL_COLORS[1],
});

/** Big prop: bespoke leaning coconut palm — flared base + curved trunk + crown. */
export function buildPalm(seed: number): BuiltProp {
  return buildOnce(() => buildPalmGeometry(makeRNG(seed)), {
    vertexColors: true,
  });
}

/** Big prop: bespoke bleached driftwood log resting on the sand + a stub branch. */
export function buildDriftwood(seed: number): BuiltProp {
  return buildOnce(() => buildDriftwoodGeometry(makeRNG(seed)), {
    vertexColors: true,
  });
}

/** Big prop: per-instance flattened tide-worn warm-grey stone. */
export function buildSeaRock(seed: number): BuiltProp {
  return seaRock.build(seed);
}

/** Decor: shared pale golden dune-grass tuft (seed ignored). */
export function buildDuneGrass(): BuiltProp {
  return duneGrass.build(0);
}

/** Decor: shared low pale shore-shell speck (seed ignored). */
export function buildShell(): BuiltProp {
  return shell.build(0);
}

// ---------------------------------------------------------------------------
// bespoke geometry
// ---------------------------------------------------------------------------

/**
 * Cylinder spanning p0 -> p1 (base radius rBot at p0, top radius rTop at p1).
 * Default cylinder axis is +Y centered at the origin; rotate +Y onto the
 * segment direction, then translate to the midpoint. Shared by the palm trunk
 * segments + the driftwood log. WebGL-free (pure BufferGeometry math).
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
 * Splay a base-at-origin part outward + around: tilt off vertical by `tilt`
 * (rotateZ) then spin to `azimuth` (rotateY). Fronds built pointing +y fan
 * radially from the crown.
 */
function splay(geo: THREE.BufferGeometry, tilt: number, azimuth: number): void {
  geo.rotateZ(tilt);
  geo.rotateY(azimuth);
}

function buildPalmGeometry(rng: RNG): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Per-palm variation: trunk height, lean direction + amount, crown scale, so
  // a shore cluster reads as distinct leaning trees rather than clones.
  const trunkH = rng.range(8.5, 11.5);
  const leanAz = rng.range(0, Math.PI * 2);
  const lean = rng.range(0.7, 1.8); // crown horizontal offset (m)
  const crownScale = rng.range(1.0, 1.3);
  const lx = Math.cos(leanAz);
  const lz = Math.sin(leanAz);
  const SEGS = 4;

  // Root flare: vertical, grounded at y=0.
  const base = new THREE.CylinderGeometry(0.34, 0.44, PALM_BASE_H, 6);
  base.translate(0, PALM_BASE_H / 2, 0);
  parts.push(prepPart(base, PALM_TRUNK_COLOR));

  // Curved leaning trunk: 4 segments following a quadratic offset curve
  // (offset ∝ (i/SEGS)^1.6) so the lower trunk stays inside the base collider
  // while the crown leans out over the surf — a real palm bow, not a tilted pole.
  const px: number[] = [0];
  const py: number[] = [PALM_BASE_H];
  const pz: number[] = [0];
  for (let i = 1; i <= SEGS; i++) {
    const f = Math.pow(i / SEGS, 1.6);
    px.push(lx * lean * f);
    py.push(PALM_BASE_H + trunkH * (i / SEGS));
    pz.push(lz * lean * f);
  }
  for (let i = 0; i < SEGS; i++) {
    const rBot = THREE.MathUtils.lerp(0.34, 0.2, i / SEGS);
    const rTop = THREE.MathUtils.lerp(0.34, 0.2, (i + 1) / SEGS);
    const seg = limbBetween(
      px[i]!,
      py[i]!,
      pz[i]!,
      px[i + 1]!,
      py[i + 1]!,
      pz[i + 1]!,
      rTop,
      rBot,
      6,
    );
    parts.push(prepPart(seg, PALM_TRUNK_COLOR));
  }

  const crownX = px[SEGS]!;
  const crownY = py[SEGS]!;
  const crownZ = pz[SEGS]!;

  // Crown knuckle anchoring fronds + coconuts at the leaning trunk top.
  const knuckle = new THREE.IcosahedronGeometry(0.42 * crownScale, 0);
  knuckle.translate(crownX, crownY, crownZ);
  parts.push(prepPart(knuckle, rng.pick(PALM_FROND_COLORS)));

  // Coconuts: 2-3 small spheres clustered just under the crown.
  const coconuts = rng.pick([2, 3]);
  for (let i = 0; i < coconuts; i++) {
    const a = (i / coconuts) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const coconut = new THREE.IcosahedronGeometry(0.17, 0);
    coconut.translate(crownX + Math.cos(a) * 0.35, crownY - 0.35, crownZ + Math.sin(a) * 0.35);
    parts.push(prepPart(coconut, COCONUT_COLOR));
  }

  // Fronds: 6-9 flattened leaf blades splayed radially from the crown. Tilt +
  // length vary per frond for an asymmetric, drooping crown that holds at range.
  const fronds = rng.pick([6, 7, 8, 9]);
  for (let i = 0; i < fronds; i++) {
    const azimuth = (i / fronds) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const len = rng.range(2.6, 3.8) * crownScale;
    const tilt = rng.range(0.95, 1.55); // ~54-89 deg off vertical
    const frond = new THREE.ConeGeometry(0.46 * crownScale, len, 5);
    frond.translate(0, len / 2, 0);
    frond.scale(1, 1, 0.2); // flatten into a leaf blade
    splay(frond, tilt, azimuth);
    frond.translate(crownX, crownY, crownZ);
    parts.push(prepPart(frond, rng.pick(PALM_FROND_COLORS)));
  }

  return mergeOrFirst(parts);
}

function buildDriftwoodGeometry(rng: RNG): THREE.BufferGeometry {
  // Bleached driftwood: a mostly-horizontal sun-weathered log section resting
  // on the sand, given a gentle two-segment bow (waterworn), plus a short stub
  // branch angling up. Per-seed length/thickness/orientation vary the silhouette.
  // Built around y=0 then re-grounded (translate by -minY) so the lowest point
  // of the resting bulk sits exactly on the sand.
  const parts: THREE.BufferGeometry[] = [];

  const az = rng.range(0, Math.PI * 2); // log lies along this heading
  const dx = Math.cos(az);
  const dz = Math.sin(az);
  const half = rng.range(1.3, 2.1); // half the log length (m)
  const r0 = rng.range(0.3, 0.42); // trunk radius at the thicker butt end
  const r1 = r0 * rng.range(0.55, 0.8); // tapered tip radius
  const bow = rng.range(0.1, 0.3); // gentle sag/rise of the mid section
  const sag = rng.pick([-1, 1]) * bow; // bow up or down at the midpoint

  // Two segments meeting at a slightly raised/lowered midpoint for a waterworn
  // curve. Axis runs at y = r0 so the thicker butt rests on the sand.
  const bx = -dx * half;
  const bz = -dz * half;
  const tx = dx * half;
  const tz = dz * half;
  const my = r0 + sag;
  const rMid = (r0 + r1) / 2;
  parts.push(prepPart(limbBetween(bx, r0, bz, 0, my, 0, rMid, r0, 7), DRIFTWOOD_COLORS[0]!));
  parts.push(prepPart(limbBetween(0, my, 0, tx, r0, tz, r1, rMid, 7), DRIFTWOOD_COLORS[1]!));

  // Bleached end-cap knot on the butt so the cut end reads as a solid stump.
  const cap = new THREE.IcosahedronGeometry(r0 * 1.05, 0);
  cap.translate(bx, r0, bz);
  parts.push(prepPart(cap, DRIFTWOOD_COLORS[2]!));

  // Stub branch: a short limb angling up + out from a point along the log.
  const t = rng.range(-0.3, 0.3); // attach fraction along the axis
  const sxRoot = dx * half * t;
  const szRoot = dz * half * t;
  const bAz = az + rng.range(1.0, 2.1); // off to the side of the log
  const bLen = rng.range(0.5, 0.9);
  const sxTip = sxRoot + Math.cos(bAz) * bLen * 0.6;
  const szTip = szRoot + Math.sin(bAz) * bLen * 0.6;
  const syTip = r0 + bLen * 0.8;
  const branchR = r1 * rng.range(0.5, 0.75);
  parts.push(
    prepPart(
      limbBetween(sxRoot, r0, szRoot, sxTip, syTip, szTip, branchR * 0.6, branchR, 6),
      DRIFTWOOD_COLORS[1]!,
    ),
  );

  const geo = mergeOrFirst(parts);
  // Re-ground: sink so the lowest resting point touches y=0 exactly.
  geo.computeBoundingBox();
  const minY = geo.boundingBox!.min.y;
  geo.translate(0, -minY, 0);
  return geo;
}

// ---------------------------------------------------------------------------
// registry wiring (side-effect at module load; the beach biome selects these)
// ---------------------------------------------------------------------------

registerFlora("palm", {
  build: buildPalm,
  big: true,
  // Cluster: palms form small coastal groves (up to 3 within 4.5 m) instead of a
  // uniform scatter, so the shore reads as clumps of leaning beach palms.
  cluster: { radius: 4.5, perCluster: 3 },
  // Collider pinned to the lower trunk (mirrors the tropical palm contract): the
  // cylinder spans the lower-trunk bulk a kart collides with (y 0..6). The
  // curved trunk keeps the lower trunk inside radius 0.55 of the base; the
  // leaning crown + coconuts sit above kart height and need no collider.
  collider: { shape: "cylinder", halfHeight: 3.0, radius: 0.55 },
});

registerFlora("driftwood", {
  build: buildDriftwood,
  big: true,
  // Collider sized to the resting log bulk: a low vertical cylinder whose
  // radius covers the horizontal footprint of the longest log (half up to
  // ~2.1 m) and whose short halfHeight keeps it hugging the sand.
  collider: { shape: "cylinder", halfHeight: 0.45, radius: 0.9 },
});

registerFlora("seaRock", seaRock);

registerFlora("duneGrass", {
  build: buildDuneGrass,
  big: false,
  collider: { shape: "none" },
});

registerFlora("shell", {
  build: buildShell,
  big: false,
  collider: { shape: "none" },
});
