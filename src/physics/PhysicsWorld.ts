import RAPIER from '@dimforge/rapier3d-compat';

let initialized = false;

export async function initRapier(): Promise<void> {
  if (!initialized) {
    await RAPIER.init();
    initialized = true;
  }
}

export type { RAPIER };

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly eventQueue: RAPIER.EventQueue;
  readonly ray: RAPIER.Ray;

  constructor(gravity = -24) {
    this.world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
    this.world.timestep = 1 / 60;
    // More solver iterations = stiffer, more stable suspension/contacts.
    this.world.integrationParameters.numSolverIterations = 8;
    this.eventQueue = new RAPIER.EventQueue(true);
    // Reusable downward ray (origin/dir overwritten each cast).
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  step(): void {
    this.world.step(this.eventQueue);
  }

  castRayDown(
    origin: { x: number; y: number; z: number },
    maxToi: number,
    excludeBody: RAPIER.RigidBody,
  ): { toi: number; point: RAPIER.Vector; normal: RAPIER.Vector } | null {
    this.ray.origin = origin;
    this.ray.dir = { x: 0, y: -1, z: 0 };
    const hit = this.world.castRayAndGetNormal(
      this.ray,
      maxToi,
      true,
      undefined,
      undefined,
      undefined,
      excludeBody,
    );
    if (!hit) return null;
    const toi = hit.timeOfImpact;
    return {
      toi,
      point: { x: origin.x, y: origin.y - toi, z: origin.z },
      normal: hit.normal,
    };
  }
}
