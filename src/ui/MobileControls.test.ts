import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileControls } from "./MobileControls";
import type { Input } from "../core/Input";

/** Captures the touch setter calls MobileControls makes on Input. */
function makeInputStub() {
  return {
    steer: 0,
    throttle: 0,
    drift: false,
    resetPulses: 0,
    cleared: 0,
    setTouchSteer(v: number) {
      this.steer = v;
    },
    setTouchThrottle(v: number) {
      this.throttle = v;
    },
    setTouchDrift(v: boolean) {
      this.drift = v;
    },
    pulseTouchReset() {
      this.resetPulses++;
    },
    clearTouch() {
      this.cleared++;
      this.steer = 0;
      this.throttle = 0;
      this.drift = false;
    },
  };
}

function findByText(root: HTMLElement, text: string): HTMLElement {
  const el = Array.from(root.querySelectorAll<HTMLElement>("div")).find(
    (n) => n.textContent === text,
  );
  if (!el) throw new Error(`button "${text}" not found`);
  return el;
}

function press(el: HTMLElement): void {
  el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
}
function release(el: HTMLElement): void {
  el.dispatchEvent(new Event("pointerup", { bubbles: true }));
}

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
  globalThis.localStorage?.clear();
  delete (globalThis as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent;
});

function build(): {
  mc: MobileControls;
  input: ReturnType<typeof makeInputStub>;
  root: HTMLElement;
} {
  const input = makeInputStub();
  const mc = new MobileControls(container, input as unknown as Input, {
    forceEnabled: true,
    prefs: { tiltEnabled: false, invert: false },
    persist: () => {},
  });
  const root = container.querySelector<HTMLElement>(".gc-mobile-controls")!;
  return { mc, input, root };
}

describe("MobileControls", () => {
  it("mounts hidden and reveals on show() when enabled", () => {
    const { mc, root } = build();
    expect(root.style.display).toBe("none");
    mc.show();
    expect(root.style.display).toBe("block");
  });

  it("stays hidden on non-touch devices", () => {
    const input = makeInputStub();
    const mc = new MobileControls(container, input as unknown as Input, {
      forceEnabled: false,
      prefs: { tiltEnabled: false, invert: false },
      persist: () => {},
    });
    const root = container.querySelector<HTMLElement>(".gc-mobile-controls")!;
    mc.show();
    expect(mc.isEnabled).toBe(false);
    expect(root.style.display).toBe("none");
  });

  it("gas pedal drives positive throttle, released returns to zero", () => {
    const { root, input } = build();
    const gas = findByText(root, "▲");
    press(gas);
    expect(input.throttle).toBe(1);
    release(gas);
    expect(input.throttle).toBe(0);
  });

  it("brake pedal drives negative throttle", () => {
    const { root, input } = build();
    press(findByText(root, "▼"));
    expect(input.throttle).toBe(-1);
  });

  it("steer buttons follow the sign convention (left +, right -)", () => {
    const { root, input } = build();
    const left = findByText(root, "◀");
    const right = findByText(root, "▶");
    press(left);
    expect(input.steer).toBe(1);
    release(left);
    press(right);
    expect(input.steer).toBe(-1);
  });

  it("drift button toggles drift hold", () => {
    const { root, input } = build();
    const drift = findByText(root, "Drift");
    press(drift);
    expect(input.drift).toBe(true);
    release(drift);
    expect(input.drift).toBe(false);
  });

  it("reset button latches a one-shot reset", () => {
    const { root, input } = build();
    press(findByText(root, "Reset"));
    expect(input.resetPulses).toBe(1);
  });

  it("hide() clears touch input", () => {
    const { mc, root, input } = build();
    mc.show();
    press(findByText(root, "▲"));
    mc.hide();
    expect(input.cleared).toBeGreaterThan(0);
    expect(input.throttle).toBe(0);
  });

  it("enabling tilt (no permission gate) hides steer buttons and listens", () => {
    // Non-iOS DeviceOrientationEvent: present, no requestPermission -> granted.
    (globalThis as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent = function () {};
    const addSpy = vi.spyOn(window, "addEventListener");
    const { mc, root, input } = build();
    mc.show();
    findByText(root, "Tilt").dispatchEvent(new Event("pointerdown"));
    return Promise.resolve().then(() => {
      expect(findByText(root, "◀").style.display).toBe("none");
      expect(addSpy).toHaveBeenCalledWith("deviceorientation", expect.any(Function));
      // First reading calibrates the neutral baseline (gamma 0); the second
      // reading tilts the right edge down (gamma 30) -> steer right (negative).
      const orient = (gamma: number): void => {
        const evt = new Event("deviceorientation") as Event & { beta: number; gamma: number };
        evt.beta = 0;
        evt.gamma = gamma;
        window.dispatchEvent(evt);
      };
      orient(0);
      expect(input.steer).toBe(0);
      orient(30);
      expect(input.steer).toBeLessThan(0);
      mc.remove();
      addSpy.mockRestore();
    });
  });

  it("repeated show() while visible does not re-arm tilt calibration", () => {
    (globalThis as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent = function () {};
    const { mc, root, input } = build();
    mc.show();
    findByText(root, "Tilt").dispatchEvent(new Event("pointerdown"));
    return Promise.resolve().then(() => {
      const orient = (gamma: number): void => {
        const evt = new Event("deviceorientation") as Event & { beta: number; gamma: number };
        evt.beta = 0;
        evt.gamma = gamma;
        window.dispatchEvent(evt);
      };
      orient(0); // calibrate neutral at 0
      mc.show(); // per-frame re-call: must be a no-op, keep the baseline
      orient(30);
      expect(input.steer).toBeLessThan(0); // still steers, not pinned to 0
      mc.remove();
    });
  });

  it("denied tilt permission shows a hint and does not hide steer", async () => {
    (globalThis as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent = {
      requestPermission: () => Promise.resolve("denied"),
    };
    const { mc, root } = build();
    mc.show();
    findByText(root, "Tilt").dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    await Promise.resolve();
    expect(findByText(root, "◀").style.display).not.toBe("none");
    mc.remove();
  });
});
