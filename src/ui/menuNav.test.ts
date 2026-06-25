import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { digestGamepad, MenuNav, NAV_DEADZONE, NAV_REPEAT_MS, type GamepadSnap } from "./menuNav";

const rest = (): GamepadSnap => ({ axes: [0, 0], buttons: [] });

describe("digestGamepad (pure)", () => {
  it("Y axis crossing +deadzone from rest emits 'down'", () => {
    const r = digestGamepad(rest(), { axes: [0, 0.9], buttons: [] }, 0);
    expect(r.edges).toEqual(["down"]);
  });

  it("Y axis crossing -deadzone emits 'up'", () => {
    const r = digestGamepad(rest(), { axes: [0, -0.9], buttons: [] }, 0);
    expect(r.edges).toEqual(["up"]);
  });

  it("jitter within deadzone emits nothing", () => {
    expect(digestGamepad(rest(), { axes: [0, 0.1], buttons: [] }, 0).edges).toEqual([]);
    expect(digestGamepad(rest(), { axes: [0.17, 0], buttons: [] }, 0).edges).toEqual([]);
  });

  it("held direction does NOT repeat immediately", () => {
    const a = digestGamepad(rest(), { axes: [0, 0.9], buttons: [] }, 0);
    expect(a.edges).toEqual(["down"]);
    const b = digestGamepad(a.next, { axes: [0, 0.9], buttons: [] }, 10);
    expect(b.edges).toEqual([]);
  });

  it("held direction repeats after >= NAV_REPEAT_MS", () => {
    const a = digestGamepad(rest(), { axes: [0, 0.9], buttons: [] }, 0);
    expect(a.edges).toEqual(["down"]);
    const b = digestGamepad(a.next, { axes: [0, 0.9], buttons: [] }, NAV_REPEAT_MS + 1);
    expect(b.edges).toEqual(["down"]);
  });

  it("X axis emits 'left' / 'right'", () => {
    expect(digestGamepad(rest(), { axes: [-0.9, 0], buttons: [] }, 0).edges).toEqual(["left"]);
    expect(digestGamepad(rest(), { axes: [0.9, 0], buttons: [] }, 0).edges).toEqual(["right"]);
  });

  it("button 0 false -> true emits 'confirm'", () => {
    const r = digestGamepad(rest(), { axes: [0, 0], buttons: [true] }, 0);
    expect(r.edges).toEqual(["confirm"]);
  });

  it("button 1 false -> true emits 'back'", () => {
    const r = digestGamepad(rest(), { axes: [0, 0], buttons: [false, true] }, 0);
    expect(r.edges).toEqual(["back"]);
  });

  it("button held does NOT repeat", () => {
    const a = digestGamepad(rest(), { axes: [0, 0], buttons: [true] }, 0);
    const b = digestGamepad(a.next, { axes: [0, 0], buttons: [true] }, 1000);
    expect(b.edges).toEqual([]);
  });

  it("release then re-press fires again", () => {
    const a = digestGamepad(rest(), { axes: [0, 0.9], buttons: [] }, 0);
    const rel = digestGamepad(a.next, rest(), 100);
    expect(rel.edges).toEqual([]);
    const c = digestGamepad(rel.next, { axes: [0, 0.9], buttons: [] }, 200);
    expect(c.edges).toEqual(["down"]);
  });

  it("deadzone boundary: equal does not fire, just above does", () => {
    expect(digestGamepad(rest(), { axes: [0, NAV_DEADZONE], buttons: [] }, 0).edges).toEqual([]);
    expect(
      digestGamepad(rest(), { axes: [0, NAV_DEADZONE + 0.001], buttons: [] }, 0).edges,
    ).toEqual(["down"]);
  });

  it("carries timing forward via next so repeat works across polls", () => {
    const a = digestGamepad(rest(), { axes: [0.9, 0], buttons: [] }, 0);
    expect(a.next.nav).toBeDefined();
    const b = digestGamepad(a.next, { axes: [0.9, 0], buttons: [] }, NAV_REPEAT_MS + 1);
    expect(b.edges).toEqual(["right"]);
  });

  it("malformed/empty input -> no edges, no throw", () => {
    expect(() => digestGamepad(null, null as unknown as GamepadSnap, 0)).not.toThrow();
    expect(digestGamepad(null, null as unknown as GamepadSnap, 0).edges).toEqual([]);
    expect(digestGamepad(null, { axes: [0, 0] } as GamepadSnap, 0).edges).toEqual([]);
    expect(
      digestGamepad(null, { axes: undefined, buttons: undefined } as unknown as GamepadSnap, 0)
        .edges,
    ).toEqual([]);
  });
});

// ---- MenuNav keyboard focus traversal (jsdom) ----

describe("MenuNav keyboard focus traversal", () => {
  let btns: HTMLButtonElement[];
  let nav: MenuNav | null;

  beforeEach(() => {
    document.body.innerHTML = "";
    btns = [0, 1, 2].map(() => {
      const b = document.createElement("button");
      b.type = "button";
      document.body.appendChild(b);
      return b;
    });
    nav = null;
  });

  afterEach(() => {
    nav?.dispose();
    nav = null;
    vi.unstubAllGlobals();
    try {
      delete (navigator as unknown as { getGamepads?: unknown }).getGamepads;
    } catch {
      // ignore
    }
  });

  function fire(code: string): KeyboardEvent {
    const e = new KeyboardEvent("keydown", { code, cancelable: true, bubbles: true });
    window.dispatchEvent(e);
    return e;
  }

  it("start() focuses the first element", () => {
    nav = new MenuNav({ elements: () => btns });
    nav.start();
    expect(document.activeElement).toBe(btns[0]);
  });

  it("ArrowDown moves focus to the next control", () => {
    nav = new MenuNav({ elements: () => btns });
    nav.start();
    fire("ArrowDown");
    expect(document.activeElement).toBe(btns[1]);
    fire("ArrowDown");
    expect(document.activeElement).toBe(btns[2]);
  });

  it("ArrowDown wraps around to the first control", () => {
    nav = new MenuNav({ elements: () => btns });
    nav.start();
    fire("ArrowDown");
    fire("ArrowDown");
    fire("ArrowDown");
    expect(document.activeElement).toBe(btns[0]);
  });

  it("ArrowUp moves focus backwards (and wraps)", () => {
    nav = new MenuNav({ elements: () => btns });
    nav.start();
    fire("ArrowUp");
    expect(document.activeElement).toBe(btns[2]);
  });

  it("ArrowDown/ArrowUp are preventDefaulted (stops page scroll)", () => {
    nav = new MenuNav({ elements: () => btns });
    nav.start();
    expect(fire("ArrowDown").defaultPrevented).toBe(true);
    expect(fire("ArrowUp").defaultPrevented).toBe(true);
  });

  it("ignores non-arrow keys (Enter/Escape left to existing handlers)", () => {
    nav = new MenuNav({ elements: () => btns });
    nav.start();
    const e = fire("Enter");
    expect(e.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(btns[0]); // focus unchanged
  });

  it("dispose() stops further traversal", () => {
    nav = new MenuNav({ elements: () => btns });
    nav.start();
    nav.dispose();
    const before = document.activeElement;
    fire("ArrowDown");
    expect(document.activeElement).toBe(before);
  });

  it("start() and dispose() are idempotent", () => {
    nav = new MenuNav({ elements: () => btns });
    nav.start();
    expect(() => nav!.start()).not.toThrow();
    nav.dispose();
    expect(() => nav!.dispose()).not.toThrow();
  });
});

// ---- MenuNav gamepad edge -> action mapping (deterministic, stubbed rAF) ----
// Gamepad-through-rAF is driven by a captured rAF callback + a stubbed
// navigator.getGamepads, so the edge -> action wiring is asserted without
// real timer flakiness. Crossing fires on the first poll (prev=null), so
// performance.now() need not be controlled here.

function fakeGamepad(axes: [number, number], buttons: boolean[]): Gamepad {
  return {
    axes,
    buttons: buttons.map((p) => ({ pressed: p, value: p ? 1 : 0 })),
    id: "",
    index: 0,
    connected: true,
    timestamp: 0,
    mapping: "standard",
    hapticActuators: [],
  } as unknown as Gamepad;
}

function stubRaf(): { fire: () => void } {
  let cb: FrameRequestCallback | null = null;
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    cb = fn;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    cb = null;
  });
  return { fire: () => cb?.(0) };
}

function stubGamepads(gp: Gamepad | null): void {
  Object.defineProperty(navigator, "getGamepads", {
    value: () => [gp],
    configurable: true,
  });
}

describe("MenuNav gamepad edge -> action mapping", () => {
  let nav: MenuNav | null;

  beforeEach(() => {
    document.body.innerHTML = "";
    nav = null;
  });

  afterEach(() => {
    nav?.dispose();
    nav = null;
    vi.unstubAllGlobals();
    try {
      delete (navigator as unknown as { getGamepads?: unknown }).getGamepads;
    } catch {
      // ignore
    }
  });

  it("right edge calls onHorizontal(1, focused)", () => {
    const onHorizontal = vi.fn();
    const el = document.createElement("input");
    el.type = "range";
    document.body.appendChild(el);
    const { fire } = stubRaf();
    stubGamepads(fakeGamepad([0.9, 0], [false, false]));

    nav = new MenuNav({ elements: () => [el], onHorizontal });
    nav.start();
    expect(document.activeElement).toBe(el); // focused on start
    fire(); // one poll: crossing right
    expect(onHorizontal).toHaveBeenCalledWith(1, el);
  });

  it("left edge calls onHorizontal(-1, focused)", () => {
    const onHorizontal = vi.fn();
    const el = document.createElement("input");
    el.type = "range";
    document.body.appendChild(el);
    const { fire } = stubRaf();
    stubGamepads(fakeGamepad([-0.9, 0], [false, false]));

    nav = new MenuNav({ elements: () => [el], onHorizontal });
    nav.start();
    fire();
    expect(onHorizontal).toHaveBeenCalledWith(-1, el);
  });

  it("confirm edge clicks the focused element", () => {
    const el = document.createElement("button");
    const clicked = vi.fn();
    el.addEventListener("click", clicked);
    document.body.appendChild(el);
    const { fire } = stubRaf();
    stubGamepads(fakeGamepad([0, 0], [true, false]));

    nav = new MenuNav({ elements: () => [el] });
    nav.start();
    fire();
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("back edge dispatches an Escape keydown on window", () => {
    const el = document.createElement("button");
    document.body.appendChild(el);
    const seen: string[] = [];
    const h = (e: KeyboardEvent) => seen.push(e.code);
    window.addEventListener("keydown", h);

    const { fire } = stubRaf();
    stubGamepads(fakeGamepad([0, 0], [false, true]));

    nav = new MenuNav({ elements: () => [el] });
    nav.start();
    fire();
    window.removeEventListener("keydown", h);
    expect(seen).toContain("Escape");
  });

  it("missing navigator.getGamepads -> no poll, no throw (keyboard still works)", () => {
    // Ensure getGamepads is absent (jsdom default).
    try {
      delete (navigator as unknown as { getGamepads?: unknown }).getGamepads;
    } catch {
      // ignore
    }
    const el = document.createElement("button");
    const onHorizontal = vi.fn();
    document.body.appendChild(el);
    expect(() => {
      nav = new MenuNav({ elements: () => [el], onHorizontal });
      nav.start();
    }).not.toThrow();
    expect(document.activeElement).toBe(el); // keyboard nav ready
    expect(onHorizontal).not.toHaveBeenCalled();
  });
});
