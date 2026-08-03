// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { formatFreeFlyPose, FreeFlyHud } from "./FreeFlyHud";
import type { FreeFlyState } from "../core/freeFly";

let hud: FreeFlyHud | null = null;
function make(): FreeFlyHud {
  hud = new FreeFlyHud(document.createElement("div"));
  return hud;
}

afterEach(() => {
  hud?.remove();
  hud = null;
});

const POSE: FreeFlyState = { position: { x: 12.345, y: 5.5, z: -8.2 }, yaw: 1.5708, pitch: -0.35 };

describe("formatFreeFlyPose (pure)", () => {
  it("formats position to 1 decimal and yaw/pitch to degrees", () => {
    const out = formatFreeFlyPose(POSE);
    expect(out).toContain("POS  12.3 5.5 -8.2");
    // pi/2 rad ~= 90 deg
    expect(out).toContain("YAW  90.0");
    // -0.35 rad ~= -20.1 deg
    expect(out).toContain("PITCH -20.1");
  });

  it("renders yaw=0 / pitch=0 as 0.0 deg", () => {
    const out = formatFreeFlyPose({ position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 });
    expect(out).toContain("POS  0.0 0.0 0.0");
    expect(out).toContain("YAW  0.0");
    expect(out).toContain("PITCH 0.0");
  });
});

describe("FreeFlyHud (DOM)", () => {
  it("starts hidden (display:none) and pointer-events:none", () => {
    const h = make();
    expect(h["root"].style.display).toBe("none");
    expect(h["root"].style.pointerEvents).toBe("none");
  });

  it("show/hide toggles display", () => {
    const h = make();
    h.show();
    expect(h["root"].style.display).toBe("block");
    h.hide();
    expect(h["root"].style.display).toBe("none");
  });

  it("update writes the formatted pose into the readout textContent", () => {
    const h = make();
    h.update(POSE);
    expect(h["readout"].textContent).toBe(formatFreeFlyPose(POSE));
  });

  it("reticle has two styled bars (a background is set on each)", () => {
    const h = make();
    const reticle = h["root"].firstElementChild as HTMLElement;
    const bars = reticle.children;
    expect(bars.length).toBe(2);
    for (const bar of Array.from(bars)) {
      expect((bar as HTMLElement).style.backgroundColor).not.toBe("");
    }
  });

  it("remove detaches the root", () => {
    const container = document.createElement("div");
    const h = new FreeFlyHud(container);
    expect(container.children.length).toBe(1);
    h.remove();
    expect(container.children.length).toBe(0);
    hud = null;
  });
});
