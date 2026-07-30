import { describe, expect, it } from "vitest";
import { RaceHud, formatTime, type HudState } from "./RaceHud";

function makeHud(targetLaps = 3, totalKarts = 6): { hud: RaceHud; container: HTMLElement } {
  const container = document.createElement("div");
  const hud = new RaceHud(container, targetLaps, totalKarts);
  return { hud, container };
}

describe("formatTime", () => {
  it("formats seconds as m:ss.cc", () => {
    expect(formatTime(0)).toBe("0:00.00");
    expect(formatTime(5.129)).toBe("0:05.12");
    expect(formatTime(65.5)).toBe("1:05.50");
    expect(formatTime(125.999)).toBe("2:05.99");
  });

  it("clamps negatives to zero", () => {
    expect(formatTime(-3)).toBe("0:00.00");
  });
});

describe("RaceHud", () => {
  it("builds the three display elements (lap/pos/time) appended to the container", () => {
    const { container } = makeHud(3, 6);
    expect(container.querySelector(".gc-race-hud")).not.toBeNull();
    const hud = container.querySelector(".gc-race-hud") as HTMLElement;
    expect(hud.children.length).toBe(3);
  });

  it("starts hidden (display none) until show()", () => {
    const { hud, container } = makeHud();
    const el = container.querySelector(".gc-race-hud") as HTMLElement;
    expect(el.style.display).toBe("none");
    hud.show();
    expect(el.style.display).toBe("block");
    hud.hide();
    expect(el.style.display).toBe("none");
  });

  it("update sets lap x/N, position p/total, and the formatted timer", () => {
    const { hud, container } = makeHud(3, 6);
    const state: HudState = { lap: 2, targetLaps: 3, position: 4, totalKarts: 6, timer: 72.5 };
    hud.update(state);
    const el = container.querySelector(".gc-race-hud") as HTMLElement;
    expect(el.textContent).toContain("LAP");
    expect(el.textContent).toContain("2/3");
    expect(el.textContent).toContain("POS");
    expect(el.textContent).toContain("4/6");
    expect(el.textContent).toContain("1:12.50");
  });

  it("clamps the displayed lap into [1, targetLaps]", () => {
    const { hud, container } = makeHud(3, 6);
    hud.update({ lap: 0, targetLaps: 3, position: 1, totalKarts: 6, timer: 0 });
    expect((container.querySelector(".gc-race-hud") as HTMLElement).textContent).toContain("1/3");
    hud.update({ lap: 9, targetLaps: 3, position: 1, totalKarts: 6, timer: 0 });
    expect((container.querySelector(".gc-race-hud") as HTMLElement).textContent).toContain("3/3");
  });

  it("remove() detaches the overlay from the container", () => {
    const { hud, container } = makeHud();
    expect(container.querySelector(".gc-race-hud")).not.toBeNull();
    hud.remove();
    expect(container.querySelector(".gc-race-hud")).toBeNull();
  });

  it("overlay is non-interactive (pointer-events none)", () => {
    const { container } = makeHud();
    const el = container.querySelector(".gc-race-hud") as HTMLElement;
    expect(el.style.pointerEvents).toBe("none");
  });
});

describe("RaceHud — per-viewport anchor (008)", () => {
  it("defaults to the 1P top-left position when no anchor is given", () => {
    const container = document.createElement("div");
    new RaceHud(container, 3, 6);
    const el = container.querySelector(".gc-race-hud") as HTMLElement;
    expect(el.style.left).toBe("14px");
    expect(el.style.top).toBe("58px");
  });

  it("places the root at the anchor when an anchor is given", () => {
    const container = document.createElement("div");
    new RaceHud(container, 3, 6, { left: 14, top: 358 });
    const el = container.querySelector(".gc-race-hud") as HTMLElement;
    expect(el.style.left).toBe("14px");
    expect(el.style.top).toBe("358px");
  });
});
