import RAPIER from "@dimforge/rapier3d-compat";

// Re-export so callers can flag colliders without importing the rapier default
// binding themselves (009 enables CONTACT_FORCE_EVENTS on the kart collider).
export { ActiveEvents } from "@dimforge/rapier3d-compat";

let initialized = false;

// Solver iteration count for the 022 perf pass. Was 8 (2x Rapier default of
// 4); lowered to 6 to save ~25% solver cost. Revert to 8 if suspension
// softens or stacking/contacts jitter on the 6-kart field; verify live with
// a chrome-devtools perf trace before treating this as settled.
const SOLVER_ITERATIONS = 6;

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
  private readonly rayHitScratch: {
    toi: number;
    point: RAPIER.Vector;
    normal: RAPIER.Vector;
  } = { toi: 0, point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 } };

  constructor(gravity = -24) {
    this.world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
    this.world.timestep = 1 / 60;
    // More solver iterations = stiffer, more stable suspension/contacts.
    this.world.integrationParameters.numSolverIterations = SOLVER_ITERATIONS;
    this.eventQueue = new RAPIER.EventQueue(true);
    // Reusable downward ray (origin/dir overwritten each cast).
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  step(): void {
    this.world.step(this.eventQueue);
  }

  /**
   * Drain contact-force events accumulated by the last step(). MUST run right
   * after each step() (per fixed sub-step): the EventQueue is autoDrain, so it
   * is cleared BEFORE the next step. The TempContactForceEvent is only valid
   * inside the callback. 009 routes these to impact SFX.
   */
  drainContactForceEvents(cb: (event: RAPIER.TempContactForceEvent) => void): void {
    this.eventQueue.drainContactForceEvents(cb);
  }

  castRayDown(
    origin: { x: number; y: number; z: number },
    maxToi: number,
    excludeBody: RAPIER.RigidBody,
  ): { toi: number; point: RAPIER.Vector; normal: RAPIER.Vector } | null {
    this.ray.origin = origin;
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
    const out = this.rayHitScratch;
    out.toi = hit.timeOfImpact;
    out.point.x = origin.x;
    out.point.y = origin.y - out.toi;
    out.point.z = origin.z;
    out.normal = hit.normal;
    return out;
  }
}
