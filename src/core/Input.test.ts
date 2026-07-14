import { describe, expect, it } from "vitest";
import { Input, PLAYER_BINDINGS, mergeKartInput, zeroInput } from "./Input";

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

describe("mergeKartInput (touch overlay over base)", () => {
  it("overlay nonzero axes win; zero axes defer to base", () => {
    const base = { throttle: 1, steer: 0.5, drift: false, reset: false };
    const overlay = { throttle: 0, steer: -0.8, drift: false, reset: false };
    const merged = mergeKartInput(base, overlay);
    expect(merged.throttle).toBe(1); // overlay 0 -> base wins
    expect(merged.steer).toBe(-0.8); // overlay nonzero -> overlay wins
  });

  it("drift/reset OR together across sources", () => {
    const merged = mergeKartInput(
      { throttle: 0, steer: 0, drift: true, reset: false },
      { throttle: 0, steer: 0, drift: false, reset: true },
    );
    expect(merged.drift).toBe(true);
    expect(merged.reset).toBe(true);
  });

  it("a zero overlay leaves the base untouched", () => {
    const base = { throttle: -1, steer: 0.3, drift: true, reset: false };
    expect(mergeKartInput(base, zeroInput())).toEqual(base);
  });
});
