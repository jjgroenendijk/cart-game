import { describe, expect, it, beforeAll } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { PhysicsWorld, ActiveEvents } from "./PhysicsWorld";

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
