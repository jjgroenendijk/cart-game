import { describe, expect, it, beforeAll } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { PhysicsWorld, ActiveEvents, ActiveCollisionTypes } from "./PhysicsWorld";

let ready = false;
beforeAll(async () => {
  await RAPIER.init();
  ready = true;
});

describe("PhysicsWorld — contact-force events (009)", () => {
  it("rapier wasm initialized for the suite", () => {
    expect(ready).toBe(true);
  });

  it("drainContactForceEvents fires per resting contact (real rapier step)", () => {
    const physics = new PhysicsWorld(-24);
    // Fixed floor (no flag needed; events fire if EITHER collider is flagged).
    const floorDesc = RAPIER.ColliderDesc.cuboid(5, 0.5, 5)
      .setTranslation(0, -0.5, 0)
      .setFriction(1.0);
    physics.world.createCollider(floorDesc);

    // Flagged dynamic cuboid dropped onto the floor.
    const body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.6, 0),
    );
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
        .setActiveEvents(ActiveEvents.CONTACT_FORCE_EVENTS)
        .setFriction(1.0),
      body,
    );

    // Settle under gravity for ~1s (the cuboid must contact + bear its weight).
    let events = 0;
    for (let i = 0; i < 120; i++) {
      physics.step();
      physics.drainContactForceEvents(() => events++);
    }
    expect(events).toBeGreaterThan(0);
  });

  it("the drained TempContactForceEvent exposes collider handles + force", () => {
    const physics = new PhysicsWorld(-24);
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(5, 0.5, 5).setTranslation(0, -0.5, 0));
    const body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.6, 0),
    );
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setActiveEvents(ActiveEvents.CONTACT_FORCE_EVENTS),
      body,
    );

    let seen = false;
    for (let i = 0; i < 120 && !seen; i++) {
      physics.step();
      physics.drainContactForceEvents((e) => {
        seen = true;
        expect(typeof e.collider1()).toBe("number");
        expect(typeof e.collider2()).toBe("number");
        expect(e.totalForceMagnitude()).toBeGreaterThan(0);
      });
    }
    expect(seen).toBe(true);
  });

  it("drainContactForceEvents is a no-op when no contact occurred", () => {
    const physics = new PhysicsWorld(-24);
    let calls = 0;
    physics.step();
    physics.drainContactForceEvents(() => calls++);
    expect(calls).toBe(0);
  });
});

describe("PhysicsWorld — generic castRay (147)", () => {
  it("hits a collider and reports toi, point, and unit-ish normal", () => {
    const physics = new PhysicsWorld(-24);
    // 1x1x1 cuboid centred at (0, 0, 0); ray from (0, 5, 0) straight down.
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setTranslation(0, 0, 0));
    physics.step(); // update broad-phase so the new collider is ray-queryable
    const hit = physics.castRay({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 10);
    expect(hit).not.toBeNull();
    expect(hit!.toi).toBeCloseTo(4.5, 5); // top face at y=0.5, origin at 5
    expect(hit!.point.y).toBeCloseTo(0.5, 5);
    expect(hit!.normal.y).toBeCloseTo(1, 5); // face points up toward origin
  });

  it("normalizes dir so toi is in world units for a non-unit direction", () => {
    const physics = new PhysicsWorld(-24);
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setTranslation(0, 0, 0));
    // Same ray as above but dir is {0,-2,0} (length 2). toi must still be ~4.5.
    physics.step();
    const hit = physics.castRay({ x: 0, y: 5, z: 0 }, { x: 0, y: -2, z: 0 }, 10);
    expect(hit).not.toBeNull();
    expect(hit!.toi).toBeCloseTo(4.5, 5);
  });

  it("hits an offset collider along +X with the correct point", () => {
    const physics = new PhysicsWorld(-24);
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setTranslation(3, 0, 0));
    physics.step();
    const hit = physics.castRay({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 10);
    expect(hit).not.toBeNull();
    // Box left face at x=2.5, origin at 0 -> toi 2.5.
    expect(hit!.toi).toBeCloseTo(2.5, 5);
    expect(hit!.point.x).toBeCloseTo(2.5, 5);
  });

  it("returns null on a miss (no collider in range)", () => {
    const physics = new PhysicsWorld(-24);
    const hit = physics.castRay({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 2);
    expect(hit).toBeNull();
  });

  it("excludeBody skips the excluded rigid body", () => {
    const physics = new PhysicsWorld(-24);
    const body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0, 0),
    );
    physics.world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);
    physics.step();
    const hit = physics.castRay({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 10, body);
    expect(hit).toBeNull();
  });

  it("castRayDown still delegates and matches the generic ray", () => {
    const physics = new PhysicsWorld(-24);
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setTranslation(0, 0, 0));
    physics.step();
    // excludeBody required by signature; create a throwaway body to exclude.
    const other = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(50, 50, 50),
    );
    const down = physics.castRayDown({ x: 0, y: 5, z: 0 }, 10, other);
    const generic = physics.castRay({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }, 10, other);
    expect(down).not.toBeNull();
    expect(generic).not.toBeNull();
    expect(down!.toi).toBeCloseTo(generic!.toi, 7);
    expect(down!.point.y).toBeCloseTo(generic!.point.y, 7);
  });
});

describe("PhysicsWorld — sensor / collision events (216)", () => {
  it("sensor collider fires an enter then exit event via drainCollisionEvents", () => {
    const physics = new PhysicsWorld(-24);
    // Fixed sensor cuboid centred at the origin. ALL collision types so a
    // fixed sensor still reports overlaps against the dynamic body.
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(2, 2, 2)
        .setSensor(true)
        .setActiveEvents(ActiveEvents.COLLISION_EVENTS)
        .setActiveCollisionTypes(ActiveCollisionTypes.ALL),
    );

    // Small dynamic cuboid dropped from above the sensor.
    const body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 10, 0),
    );
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5), body);

    let sawStart = false;
    let sawStop = false;
    for (let i = 0; i < 120; i++) {
      physics.step();
      physics.drainCollisionEvents((_h1, _h2, started) => {
        if (started) sawStart = true;
        else sawStop = true;
      });
    }
    expect(sawStart).toBe(true);
    expect(sawStop).toBe(true);
  });

  it("drainCollisionEvents is a no-op when nothing overlaps", () => {
    const physics = new PhysicsWorld(-24);
    let calls = 0;
    physics.step();
    physics.drainCollisionEvents(() => calls++);
    expect(calls).toBe(0);
  });

  it("collider→kind registry registers, looks up, and clears", () => {
    const physics = new PhysicsWorld(-24);
    const col = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5));
    const handle = col.handle;
    physics.setColliderKind(handle, "water");
    expect(physics.colliderKind(handle)).toBe("water");
    expect(physics.colliderKind(999999)).toBeUndefined();
    physics.clearColliderKinds();
    expect(physics.colliderKind(handle)).toBeUndefined();
  });
});
