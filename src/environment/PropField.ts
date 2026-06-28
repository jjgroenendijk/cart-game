import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import type { SamplerTerrain } from "./propSampler";
import {
  sampleProps,
  type PlacedProp,
  type PropLayer,
  type PropType,
  type SamplerOptions,
} from "./propSampler";
import {
  buildBush,
  buildFlower,
  buildGrass,
  buildRock,
  buildTree,
  rockRadius,
  ROCK_BURY,
  type BuiltProp,
} from "./propFactory";
import { addOutline, removeOutline } from "../materials/outline";
import { makeCel } from "../materials/cel";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { degToRad } from "../core/math";

const PROP_LAYER = 0;
const PROP_OUTLINE = 0.02;
/** Shared yaw axis for every big-prop transform bake. */
const UP_Y = new THREE.Vector3(0, 1, 0);

/** Decorative (no collider) vs big (Rapier body) classification. */
const BIG_TYPES: ReadonlySet<PropType> = new Set(["tree", "rock"]);
const DECOR_BUILDERS: Record<"bush" | "flower" | "grass", () => BuiltProp> = {
  bush: buildBush,
  flower: buildFlower,
  grass: buildGrass,
};

export interface PropFieldOptions {
  seed?: number;
  worldHalfExtent?: number;
  edgeMargin?: number;
  cell?: number;
  maxAttemptsPerSlot?: number;
  trackHalfWidth?: number;
  corridorMargin?: number;
  spawnExclusionRadius?: number;
  /** Max surface tilt for big props (degrees). Decor uses a looser limit. */
  maxSlopeDeg?: number;
  /** Per-type placement counts (defaults in DEFAULT_PROP_COUNTS). */
  counts?: Partial<Record<PropType, number>>;
  colliderFriction?: number;
  colliderRestitution?: number;
  /**
   * Number of spatial buckets to merge big props (tree/rock) into. Default 4
   * -> 2x2 grid (Math.round(sqrt(n))). Each non-empty bucket becomes one
   * merged BufferGeometry + one cel material + one inverted-hull outline,
   * collapsing ~400 main-pass draw calls to <= 8 merged meshes. Rapier
   * colliders stay per-prop (unchanged by bucketing).
   */
  bigPropBuckets?: number;
}

const DEFAULT_PROP_COUNTS: Record<PropType, number> = {
  tree: 120,
  rock: 80,
  bush: 200,
  flower: 1500,
  grass: 3000,
};

/** Uniform ±20% scale band (per 004 Defaults). */
const SCALE_MIN = 0.8;
const SCALE_MAX = 1.2;

const TREE_COLLIDER = { halfHeight: 1.5, radius: 0.6 };

export interface PropFieldStats {
  bigProps: number;
  instancesByType: Partial<Record<PropType, number>>;
}

/**
 * Orchestrates 004 prop dressing: runs the deterministic sampler over the
 * terrain, then spawns:
 *  - big props (tree/rock): merged into spatial buckets (one BufferGeometry +
 *    cel material + inverted-hull outline per non-empty bucket; layer 0,
 *    cast+receive shadow) + a fixed Rapier body per prop (cylinder for trees,
 *    ball for rocks). Tracks merged GL resources + bodies for dispose.
 *  - decorative props (bush/flower/grass): one InstancedMesh per type (layer 0,
 *    receive shadow, no cast -> shadow-map cost stays low). One shared
 *    geometry+material per type -> thousands of instances in one draw call.
 *
 * `group` is added to the scene; `dispose()` frees all GL resources and removes
 * every Rapier body (sets the dispose precedent for 004).
 */
export class PropField {
  readonly group = new THREE.Group();
  readonly stats: PropFieldStats;

  private readonly physics: PhysicsWorld;
  private readonly mergedGeos: THREE.BufferGeometry[] = [];
  private readonly mergedMats: THREE.Material[] = [];
  private readonly bigOutlines: THREE.Mesh[] = [];
  private readonly decorBuilt: BuiltProp[] = [];
  private readonly bodies: RAPIER.RigidBody[] = [];
  private disposed = false;

  private readonly scratchMat = new THREE.Matrix4();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchPos = new THREE.Vector3();
  private readonly scratchScale = new THREE.Vector3();

  constructor(physics: PhysicsWorld, terrain: SamplerTerrain, opts: PropFieldOptions = {}) {
    this.physics = physics;
    const placed = sampleProps(terrain, this.buildSamplerOptions(opts));
    let bigProps = 0;
    const instancesByType: Partial<Record<PropType, number>> = {};

    const bigByType: Record<"tree" | "rock", PlacedProp[]> = { tree: [], rock: [] };
    for (const p of placed) {
      if (BIG_TYPES.has(p.type)) {
        bigByType[p.type as "tree" | "rock"].push(p);
        this.createBody(p);
        bigProps++;
      }
    }
    const buckets = opts.bigPropBuckets ?? 4;
    const half = opts.worldHalfExtent ?? 100;
    this.spawnBigBuckets("tree", bigByType.tree, buckets, half);
    this.spawnBigBuckets("rock", bigByType.rock, buckets, half);

    for (const type of ["bush", "flower", "grass"] as const) {
      const of = placed.filter((p) => p.type === type);
      if (of.length > 0) {
        this.spawnDecor(type, of);
        instancesByType[type] = of.length;
      }
    }

    this.stats = { bigProps, instancesByType };
    // The field group is parented once and never transformed again ->
    // freeze its matrix so the renderer skips its per-frame compose.
    this.group.matrixAutoUpdate = false;
    this.group.updateMatrix();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const outline of this.bigOutlines) removeOutline(outline);
    this.bigOutlines.length = 0;
    for (const g of this.mergedGeos) g.dispose();
    this.mergedGeos.length = 0;
    for (const m of this.mergedMats) m.dispose();
    this.mergedMats.length = 0;
    for (const b of this.decorBuilt) b.dispose();
    this.decorBuilt.length = 0;

    for (const body of this.bodies) this.physics.world.removeRigidBody(body);
    this.bodies.length = 0;

    this.group.clear();
  }

  private buildSamplerOptions(opts: PropFieldOptions): SamplerOptions {
    const counts = { ...DEFAULT_PROP_COUNTS, ...opts.counts };
    const maxSlope = degToRad(opts.maxSlopeDeg ?? 35);
    const layers: PropLayer[] = (["tree", "rock", "bush", "flower", "grass"] as const).map(
      (type) => ({
        type,
        count: counts[type],
        minScale: SCALE_MIN,
        maxScale: SCALE_MAX,
        // Decor tolerates steeper ground than big props.
        maxSlope: BIG_TYPES.has(type) ? maxSlope : maxSlope + degToRad(25),
      }),
    );
    return {
      seed: opts.seed ?? 1337,
      worldHalfExtent: opts.worldHalfExtent ?? 100,
      edgeMargin: opts.edgeMargin ?? 4,
      cell: opts.cell ?? 3,
      maxAttemptsPerSlot: opts.maxAttemptsPerSlot ?? 4,
      trackHalfWidth: opts.trackHalfWidth ?? 6,
      corridorMargin: opts.corridorMargin ?? 3,
      spawnExclusionRadius: opts.spawnExclusionRadius ?? 12,
      maxSlope,
      layers,
    };
  }

  /**
   * Partition one big-prop type's placements into a square grid of spatial
   * buckets and emit one merged mesh per non-empty bucket. Every prop is
   * baked (transform + per-seed geometry) into exactly one bucket.
   */
  private spawnBigBuckets(
    type: "tree" | "rock",
    props: PlacedProp[],
    buckets: number,
    half: number,
  ): void {
    if (props.length === 0) return;
    const gridSize = Math.max(1, Math.round(Math.sqrt(buckets)));
    const cells: PlacedProp[][] = Array.from({ length: gridSize * gridSize }, () => []);
    for (const p of props) {
      const bx = clampInt(Math.floor(((p.x + half) / (2 * half)) * gridSize), 0, gridSize - 1);
      const bz = clampInt(Math.floor(((p.z + half) / (2 * half)) * gridSize), 0, gridSize - 1);
      cells[bz * gridSize + bx]!.push(p);
    }
    for (const cell of cells) {
      if (cell.length === 0) continue;
      this.spawnBigBucket(type, cell);
    }
  }

  private spawnBigBucket(type: "tree" | "rock", props: PlacedProp[]): void {
    const parts: THREE.BufferGeometry[] = [];
    for (const p of props) {
      const built = type === "tree" ? buildTree(p.seed) : buildRock(p.seed);
      built.material.dispose();
      this.scratchQuat.setFromAxisAngle(UP_Y, yawFromSeed(p.seed));
      this.scratchPos.set(p.x, p.y, p.z);
      this.scratchScale.set(p.scale, p.scale, p.scale);
      this.scratchMat.compose(this.scratchPos, this.scratchQuat, this.scratchScale);
      built.geometry.applyMatrix4(this.scratchMat);
      parts.push(built.geometry);
    }
    const merged = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    if (!merged) throw new Error("PropField: mergeGeometries returned null");
    const material = makeCel({ flatShading: true, vertexColors: true });
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.layers.set(PROP_LAYER);
    // Geometry is baked into world space (per-prop applyMatrix4) and the
    // mesh itself never moves -> freeze its matrix after placement.
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    const outline = addOutline(mesh, PROP_OUTLINE);
    // Outline is a static child of a frozen parent -> freeze it too so the
    // renderer skips its per-frame compose.
    outline.matrixAutoUpdate = false;
    outline.updateMatrix();
    this.bigOutlines.push(outline);
    this.mergedGeos.push(merged);
    this.mergedMats.push(material);
  }

  private createBody(p: PlacedProp): void {
    const friction = 0.8;
    const restitution = 0.1;
    let cy: number;
    let colliderDesc: RAPIER.ColliderDesc;
    if (p.type === "tree") {
      const c = TREE_COLLIDER;
      // Cylinder is centred on the body origin; raise so it spans the trunk
      // (base rests on the terrain, top at +2*halfHeight).
      cy = p.y + c.halfHeight;
      colliderDesc = RAPIER.ColliderDesc.cylinder(c.halfHeight, c.radius);
    } else {
      // Derive the ball radius from the same per-seed value the visual rock
      // uses (rockRadius) so the collider tracks the visible bulk instead of a
      // fixed 0.9. Sink the centre by ROCK_BURY*r to match the visual: the
      // geometry's base is buried that far below the placement origin, so the
      // ball follows instead of floating above the embedded rock.
      const r = rockRadius(p.seed) * p.scale;
      cy = p.y + r * (1 - ROCK_BURY);
      colliderDesc = RAPIER.ColliderDesc.ball(r);
    }
    colliderDesc.setFriction(friction).setRestitution(restitution);
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(p.x, cy, p.z),
    );
    this.physics.world.createCollider(colliderDesc, body);
    this.bodies.push(body);
  }

  private spawnDecor(type: "bush" | "flower" | "grass", placed: PlacedProp[]): void {
    const built = DECOR_BUILDERS[type]();
    this.decorBuilt.push(built);
    const instanced = new THREE.InstancedMesh(built.geometry, built.material, placed.length);
    instanced.castShadow = false;
    instanced.receiveShadow = true;
    instanced.layers.set(PROP_LAYER);

    const dummy = new THREE.Object3D();
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i]!;
      dummy.position.set(p.x, p.y, p.z);
      dummy.scale.setScalar(p.scale);
      dummy.rotation.set(0, yawFromSeed(p.seed), 0);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
    }
    instanced.instanceMatrix.needsUpdate = true;
    // Per-instance matrices live in instanceMatrix; the InstancedMesh's own
    // transform never moves -> freeze it after placement.
    instanced.matrixAutoUpdate = false;
    instanced.updateMatrix();
    this.group.add(instanced);
  }
}

function yawFromSeed(seed: number): number {
  return ((seed % 360) / 360) * Math.PI * 2;
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
