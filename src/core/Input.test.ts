import { describe, expect, it } from "vitest";
import { Input, PLAYER_BINDINGS } from "./Input";

/**
 * Minimal EventTarget double: collects listeners so a test can fire synthetic
 * keydown/keyup events at the Input instance. Input only uses addEventListener
 * (never removeEventListener), so a plain record suffices.
 */
class FakeTarget {
  private readonly handlers = new Map<string, EventListener[]>();
  addEventListener(type: string, fn: EventListener): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
  }
  dispatch(type: string, code: string): void {
    const evt = { code, preventDefault(): void {} } as unknown as Event;
    for (const fn of this.handlers.get(type) ?? []) fn(evt);
  }
}

describe("Input steering sign", () => {
  // Engine convention (KartController + AiDriver): positive steer = turn LEFT.
  // Human input must map left -> +1 and right -> -1 so the kart turns the way
  // the player presses. These lock the sign that regressed at scaffold time.
  it("KeyA (P1 left) yields steer > 0 (turn left)", () => {
    const t = new FakeTarget();
    const input = new Input(t as unknown as EventTarget);
    input.beginFrame();
    t.dispatch("keydown", PLAYER_BINDINGS[0]!.left[0]!);
    const { steer } = input.sample(0);
    expect(steer).toBeGreaterThan(0);
  });

  it("KeyD (P1 right) yields steer < 0 (turn right)", () => {
    const t = new FakeTarget();
    const input = new Input(t as unknown as EventTarget);
    input.beginFrame();
    t.dispatch("keydown", PLAYER_BINDINGS[0]!.right[0]!);
    const { steer } = input.sample(0);
    expect(steer).toBeLessThan(0);
  });

  it("ArrowLeft (P2 left) yields steer > 0", () => {
    const t = new FakeTarget();
    const input = new Input(t as unknown as EventTarget);
    input.beginFrame();
    t.dispatch("keydown", PLAYER_BINDINGS[1]!.left[0]!);
    const { steer } = input.sample(1);
    expect(steer).toBeGreaterThan(0);
  });

  it("ArrowRight (P2 right) yields steer < 0", () => {
    const t = new FakeTarget();
    const input = new Input(t as unknown as EventTarget);
    input.beginFrame();
    t.dispatch("keydown", PLAYER_BINDINGS[1]!.right[0]!);
    const { steer } = input.sample(1);
    expect(steer).toBeLessThan(0);
  });

  it("no input yields zero steer", () => {
    const t = new FakeTarget();
    const input = new Input(t as unknown as EventTarget);
    input.beginFrame();
    const { steer } = input.sample(0);
    expect(steer).toBe(0);
  });
});

describe("Input touch/tilt merge", () => {
  const make = (): Input => {
    const input = new Input(new FakeTarget() as unknown as EventTarget);
    input.beginFrame();
    return input;
  };

  it("touch steer/throttle/drift merge into player 0", () => {
    const input = make();
    input.setTouchSteer(0.6);
    input.setTouchThrottle(-1);
    input.setTouchDrift(true);
    const s = input.sample(0);
    expect(s.steer).toBeCloseTo(0.6);
    expect(s.throttle).toBe(-1);
    expect(s.drift).toBe(true);
  });

  it("touch contributions clamp to [-1, 1]", () => {
    const input = make();
    input.setTouchSteer(5);
    input.setTouchThrottle(-5);
    const s = input.sample(0);
    expect(s.steer).toBe(1);
    expect(s.throttle).toBe(-1);
  });

  it("touch never bleeds into player 1", () => {
    const input = make();
    input.setTouchSteer(1);
    input.setTouchThrottle(1);
    input.setTouchDrift(true);
    const s = input.sample(1);
    expect(s.steer).toBe(0);
    expect(s.throttle).toBe(0);
    expect(s.drift).toBe(false);
  });

  it("pulseTouchReset latches once then clears", () => {
    const input = make();
    input.pulseTouchReset();
    expect(input.sample(0).reset).toBe(true);
    expect(input.sample(0).reset).toBe(false);
  });

  it("clearTouch zeroes every contribution", () => {
    const input = make();
    input.setTouchSteer(1);
    input.setTouchThrottle(1);
    input.setTouchDrift(true);
    input.pulseTouchReset();
    input.clearTouch();
    const s = input.sample(0);
    expect(s.steer).toBe(0);
    expect(s.throttle).toBe(0);
    expect(s.drift).toBe(false);
    expect(s.reset).toBe(false);
  });
});
