import RAPIER from "@dimforge/rapier3d-compat";

// Re-export so callers can flag colliders without importing the rapier default
// binding themselves (009 enables CONTACT_FORCE_EVENTS on the kart collider).
export { ActiveEvents, ActiveCollisionTypes } from "@dimforge/rapier3d-compat";

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

  /**
   * Drain collision (sensor/intersection) events accumulated by the last
   * step(). MUST run right after each step() (per fixed sub-step): the
   * EventQueue is autoDrain, so it is cleared BEFORE the next step.
   * `started=true` means overlap began; `started=false` means overlap ended.
   * This is how sensor/trigger gameplay (item boxes, pickups, water
   * enter/exit) reads overlap events — pair a sensor collider
   * (`setSensor(true)` + `setActiveEvents(COLLISION_EVENTS)`) with this drain.
   */
  drainCollisionEvents(cb: (handle1: number, handle2: number, started: boolean) => void): void {
    this.eventQueue.drainCollisionEvents(cb);
  }

  /**
   * Generic world-space ray query (147), generalising castRayDown. `dir` is
   * normalized internally so `maxToi` + the returned `toi` are always in world
   * units regardless of caller. Reuses the shared `ray` + `rayHitScratch`
   * (down-cast callers must consume the result before the next cast). `point`
   * is written as `origin + dir*toi`. `excludeBody` skips one RigidBody (the
   * kart); `filterGroups` is the Rapier query (memberships, filter) pair,
   * default none. Returns null on miss.
   */
  castRay(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    maxToi: number,
    excludeBody?: RAPIER.RigidBody,
    filterGroups?: number,
  ): { toi: number; point: RAPIER.Vector; normal: RAPIER.Vector } | null {
    const r = this.ray;
    r.origin.x = origin.x;
    r.origin.y = origin.y;
    r.origin.z = origin.z;
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    r.dir.x = dir.x / len;
    r.dir.y = dir.y / len;
    r.dir.z = dir.z / len;
    const hit = this.world.castRayAndGetNormal(
      r,
      maxToi,
      true,
      undefined,
      filterGroups,
      undefined,
      excludeBody,
    );
    if (!hit) return null;
    const out = this.rayHitScratch;
    out.toi = hit.timeOfImpact;
    out.point.x = origin.x + r.dir.x * out.toi;
    out.point.y = origin.y + r.dir.y * out.toi;
    out.point.z = origin.z + r.dir.z * out.toi;
    out.normal = hit.normal;
    return out;
  }

  /**
   * Downward raycast (suspension). Delegates to `castRay` with dir {0,-1,0};
   * point is `(origin.x, origin.y - toi, origin.z)` and behavior is identical
   * to the pre-147 implementation.
   */
  castRayDown(
    origin: { x: number; y: number; z: number },
    maxToi: number,
    excludeBody: RAPIER.RigidBody,
  ): { toi: number; point: RAPIER.Vector; normal: RAPIER.Vector } | null {
    return this.castRay(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: 0, y: -1, z: 0 },
      maxToi,
      excludeBody,
    );
  }

  private readonly colliderKinds = new Map<number, string>();

  /**
   * Centralizes collider→kind ownership so intersection-event consumers can
   * resolve drained handle pairs to semantic kinds (mirrors the
   * colliderHandle→kartIndex map in gameAudio.ts). Callers register kinds
   * when they create sensor colliders and clear on rebuild.
   */
  setColliderKind(handle: number, kind: string): void {
    this.colliderKinds.set(handle, kind);
  }

  colliderKind(handle: number): string | undefined {
    return this.colliderKinds.get(handle);
  }

  clearColliderKinds(): void {
    this.colliderKinds.clear();
  }
}
