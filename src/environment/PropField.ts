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
  type BuiltProp,
} from "./propFactory";
import { addOutline, removeOutline } from "../materials/outline";
import { degToRad } from "../core/math";

const PROP_LAYER = 0;
const PROP_OUTLINE = 0.02;

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
 *  - big props (tree/rock): one merged THREE.Mesh each (layer 0, cast+receive
 *    shadow, inverted-hull outline) + a fixed Rapier body (cylinder for trees,
 *    ball for rocks). Tracks bodies for dispose.
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
  private readonly bigBuilt: BuiltProp[] = [];
  private readonly bigOutlines: THREE.Mesh[] = [];
  private readonly decorBuilt: BuiltProp[] = [];
  private readonly bodies: RAPIER.RigidBody[] = [];
  private disposed = false;

  constructor(physics: PhysicsWorld, terrain: SamplerTerrain, opts: PropFieldOptions = {}) {
    this.physics = physics;
    const placed = sampleProps(terrain, this.buildSamplerOptions(opts));
    let bigProps = 0;
    const instancesByType: Partial<Record<PropType, number>> = {};

    for (const p of placed) {
      if (BIG_TYPES.has(p.type)) {
        this.spawnBig(p);
        bigProps++;
      }
    }
    for (const type of ["bush", "flower", "grass"] as const) {
      const of = placed.filter((p) => p.type === type);
      if (of.length > 0) {
        this.spawnDecor(type, of);
        instancesByType[type] = of.length;
      }
    }

    this.stats = { bigProps, instancesByType };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const outline of this.bigOutlines) removeOutline(outline);
    this.bigOutlines.length = 0;
    for (const b of this.bigBuilt) b.dispose();
    this.bigBuilt.length = 0;
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

  private spawnBig(p: PlacedProp): void {
    const built = p.type === "tree" ? buildTree(p.seed) : buildRock(p.seed);
    this.bigBuilt.push(built);

    const mesh = new THREE.Mesh(built.geometry, built.material);
    mesh.position.set(p.x, p.y, p.z);
    mesh.scale.setScalar(p.scale);
    mesh.rotation.y = yawFromSeed(p.seed);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.layers.set(PROP_LAYER);
    const outline = addOutline(mesh, PROP_OUTLINE);
    this.bigOutlines.push(outline);
    this.group.add(mesh);

    this.createBody(p);
  }

  private createBody(p: PlacedProp): void {
    const friction = 0.8;
    const restitution = 0.1;
    let cy = p.y;
    let colliderDesc: RAPIER.ColliderDesc;
    if (p.type === "tree") {
      const c = TREE_COLLIDER;
      // Cylinder is centred on the body origin; raise so it spans the trunk
      // (base rests on the terrain, top at +2*halfHeight).
      cy = p.y + c.halfHeight;
      colliderDesc = RAPIER.ColliderDesc.cylinder(c.halfHeight, c.radius);
    } else {
      const r = 0.9 * p.scale;
      cy = p.y + r * 0.6;
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
    this.group.add(instanced);
  }
}

function yawFromSeed(seed: number): number {
  return ((seed % 360) / 360) * Math.PI * 2;
}
