import { afterEach, describe, expect, it } from "vitest";
import { TouchControls } from "./TouchControls";

const live: TouchControls[] = [];

function mount(): { tc: TouchControls; container: HTMLElement } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const tc = new TouchControls(container);
  live.push(tc);
  return { tc, container };
}

function pedal(container: HTMLElement, cls: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`.${cls}`);
  if (!el) throw new Error(`missing pedal .${cls}`);
  return el;
}

function pointer(el: HTMLElement, type: string, pointerId = 1): void {
  const e = new Event(type, { bubbles: true, cancelable: true });
  (e as unknown as { pointerId: number }).pointerId = pointerId;
  el.dispatchEvent(e);
}

function orient(beta: number, gamma: number): void {
  const e = new Event("deviceorientation");
  Object.assign(e, { beta, gamma });
  window.dispatchEvent(e);
}

afterEach(() => {
  for (const tc of live.splice(0)) tc.remove();
  document.body.innerHTML = "";
});

describe("TouchControls DOM", () => {
  it("builds pedals + enable prompt, hidden until shown", () => {
    const { tc, container } = mount();
    const root = container.querySelector<HTMLElement>(".gc-touch-root")!;
    expect(root.style.display).toBe("none");
    expect(container.querySelector(".gc-touch-gas")).not.toBeNull();
    expect(container.querySelector(".gc-touch-brake")).not.toBeNull();
    expect(container.querySelector(".gc-touch-drift")).not.toBeNull();
    expect(container.querySelector(".gc-touch-reset")).not.toBeNull();
    expect(container.querySelector(".gc-touch-enable")).not.toBeNull();
    tc.showRace();
    expect(root.style.display).toBe("block");
    tc.hide();
    expect(root.style.display).toBe("none");
  });

  it("interactive controls opt back into pointer events (root is none)", () => {
    const { container } = mount();
    // Regression: pedals inheriting the root's pointer-events:none were dead on
    // real iOS Safari (synthetic-event tests bypass hit-testing and missed it).
    for (const cls of ["gc-touch-gas", "gc-touch-brake", "gc-touch-drift", "gc-touch-reset"]) {
      expect(pedal(container, cls).style.pointerEvents).toBe("auto");
    }
  });

  it("prompt shows on the menu surface, pedals show on the race surface", () => {
    const { tc, container } = mount();
    const prompt = container.querySelector<HTMLElement>(".gc-touch-prompt")!;
    const gas = pedal(container, "gc-touch-gas");
    const recenter = container.querySelector<HTMLElement>(".gc-touch-recenter")!;
    // Off: everything hidden.
    expect(prompt.style.display).toBe("none");
    // Menu: prompt visible, pedals hidden, recenter hidden.
    tc.showMenu();
    expect(prompt.style.display).toBe("flex");
    expect(gas.style.display).toBe("none");
    expect(recenter.style.display).toBe("none");
    // Race: pedals visible, prompt hidden.
    tc.showRace();
    expect(prompt.style.display).toBe("none");
    expect(gas.style.display).toBe("flex");
  });
});

describe("TouchControls pedals", () => {
  it("gas press yields throttle 1, release yields 0", () => {
    const { tc, container } = mount();
    pointer(pedal(container, "gc-touch-gas"), "pointerdown");
    expect(tc.sample().throttle).toBe(1);
    pointer(pedal(container, "gc-touch-gas"), "pointerup");
    expect(tc.sample().throttle).toBe(0);
  });

  it("brake press yields throttle -1", () => {
    const { tc, container } = mount();
    pointer(pedal(container, "gc-touch-brake"), "pointerdown");
    expect(tc.sample().throttle).toBe(-1);
  });

  it("drift press sets drift true", () => {
    const { tc, container } = mount();
    pointer(pedal(container, "gc-touch-drift"), "pointerdown");
    expect(tc.sample().drift).toBe(true);
  });

  it("gas + drift held together both register (multi-touch)", () => {
    const { tc, container } = mount();
    pointer(pedal(container, "gc-touch-gas"), "pointerdown", 1);
    pointer(pedal(container, "gc-touch-drift"), "pointerdown", 2);
    const s = tc.sample();
    expect(s.throttle).toBe(1);
    expect(s.drift).toBe(true);
  });

  it("reset is a one-shot latch (true once, then false)", () => {
    const { tc, container } = mount();
    pointer(pedal(container, "gc-touch-reset"), "pointerdown");
    expect(tc.sample().reset).toBe(true);
    expect(tc.sample().reset).toBe(false);
  });
});

describe("TouchControls tilt", () => {
  function enable(container: HTMLElement): void {
    container.querySelector<HTMLButtonElement>(".gc-touch-enable")!.click();
  }

  it("steer stays 0 until tilt is enabled", () => {
    const { tc } = mount();
    orient(0, 20);
    expect(tc.sample().steer).toBe(0);
  });

  it("after enabling, rolling right (gamma up) turns right: negative steer", () => {
    const { tc, container } = mount();
    enable(container);
    orient(0, 0); // captures baseline
    orient(0, 25); // roll right
    expect(tc.sample().steer).toBeLessThan(0);
  });

  it("invert flips the tilt steer sign", () => {
    const { tc, container } = mount();
    enable(container);
    orient(0, 0);
    orient(0, 25);
    const plain = tc.sample().steer;
    tc.setConfig({ enabled: true, sensitivity: 1, invert: true });
    orient(0, 25);
    expect(tc.sample().steer).toBeCloseTo(-plain, 6);
  });

  it("recenter re-captures the neutral baseline", () => {
    const { tc, container } = mount();
    enable(container);
    orient(0, 0);
    orient(0, 30); // steering hard right
    expect(tc.sample().steer).toBeLessThan(0);
    tc.recenter();
    orient(0, 30); // 30 is the new neutral
    expect(tc.sample().steer).toBe(0);
  });

  it("disabling via setConfig drops steering + hides the prompt path", () => {
    const { tc, container } = mount();
    enable(container);
    orient(0, 0);
    orient(0, 25);
    expect(tc.sample().steer).toBeLessThan(0);
    tc.setConfig({ enabled: false, sensitivity: 1, invert: false });
    orient(0, 40);
    expect(tc.sample().steer).toBe(0);
  });
});
