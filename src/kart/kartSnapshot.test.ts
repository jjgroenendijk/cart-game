import { describe, expect, it } from "vitest";
import { kartToJSON, type KartLike, type WheelStateLike } from "./kartSnapshot";

function fakeWheel(over: Partial<WheelStateLike> = {}): WheelStateLike {
  return {
    grounded: true,
    compression: 0.1,
    steerAngle: 0.2,
    spin: 3,
    ...over,
  };
}

function fakeKart(over: Partial<KartLike["controller"]> = {}): KartLike {
  const body = {
    translation: () => ({ x: 1, y: 2, z: 3 }),
    rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
    linvel: () => ({ x: 4, y: 5, z: 6 }),
    angvel: () => ({ x: 7, y: 8, z: 9 }),
  };
  return {
    speed: 12.5,
    controller: {
      body,
      grounded: true,
      isDrifting: true,
      driftActive: true,
      life: 0.75,
      inWater: false,
      wheels: [fakeWheel(), fakeWheel({ grounded: false, compression: 0 })],
      tuning: {
        mass: 260,
        maxSpeed: 34,
        engineForce: 9000,
        brakeForce: 11000,
        grip: 9.5,
        wheelRadius: 0.35,
      },
      ...over,
    },
  };
}

describe("kartToJSON", () => {
  it("reads the authoritative body pose (translation/rotation/linvel/angvel)", () => {
    const snap = kartToJSON(fakeKart());
    expect(snap.pos).toEqual({ x: 1, y: 2, z: 3 });
    expect(snap.rot).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(snap.linvel).toEqual({ x: 4, y: 5, z: 6 });
    expect(snap.angvel).toEqual({ x: 7, y: 8, z: 9 });
  });

  it("captures scalar kart state", () => {
    const snap = kartToJSON(fakeKart());
    expect(snap.speed).toBe(12.5);
    expect(snap.grounded).toBe(true);
    expect(snap.drifting).toBe(true);
    expect(snap.life).toBe(0.75);
    expect(snap.inWater).toBe(false);
  });

  it("copies per-wheel state", () => {
    const snap = kartToJSON(fakeKart());
    expect(snap.wheels).toHaveLength(2);
    expect(snap.wheels[0]).toEqual({
      grounded: true,
      compression: 0.1,
      steerAngle: 0.2,
      spin: 3,
    });
    expect(snap.wheels[1].grounded).toBe(false);
  });

  it("summarizes tuning", () => {
    const snap = kartToJSON(fakeKart());
    expect(snap.tuning).toEqual({
      mass: 260,
      maxSpeed: 34,
      engineForce: 9000,
      brakeForce: 11000,
      grip: 9.5,
      wheelRadius: 0.35,
    });
  });

  it("falls back to driftActive when isDrifting is undefined", () => {
    const kart = fakeKart();
    // Fakes that only set driftActive (no getter) must still report drift.
    (kart.controller as { isDrifting?: boolean }).isDrifting = undefined;
    kart.controller.driftActive = true;
    expect(kartToJSON(kart).drifting).toBe(true);
  });

  it("does not alias Rapier scratch: copies vectors field-by-field", () => {
    const shared = { x: 1, y: 2, z: 3 };
    const kart = fakeKart();
    kart.controller.body.translation = () => shared;
    const snap = kartToJSON(kart);
    shared.x = 999; // mutate the "scratch" after serialization
    expect(snap.pos.x).toBe(1);
  });

  it("produces a JSON-serializable object", () => {
    const snap = kartToJSON(fakeKart());
    expect(() => JSON.stringify(snap)).not.toThrow();
  });
});
