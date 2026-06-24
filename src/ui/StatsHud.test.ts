import { describe, expect, it, afterEach } from "vitest";
import { StatsHud, formatStats, type RenderInfoSnapshot } from "./StatsHud";
import { classify, DEFAULT_BUDGET_1P, type PerfSample } from "../core/stats";

function sample(over: Partial<PerfSample> = {}): PerfSample {
  return {
    frameMs: 10,
    fps: 100,
    drawCalls: 50,
    tris: 210000,
    geometries: 42,
    textures: 8,
    ...over,
  };
}

function fixedSnapshot(): RenderInfoSnapshot {
  return { calls: 50, triangles: 210000, geometries: 42, textures: 8 };
}

function fireF3(): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "F3" }));
}

describe("formatStats", () => {
  it("clean (all ok) sample has no status glyphs", () => {
    const s = sample();
    const cls = classify(s, DEFAULT_BUDGET_1P);
    const out = formatStats(s, cls);
    expect(out).not.toContain("~");
    expect(out).not.toContain("!");
    expect(out).toContain("FPS 100");
    expect(out).toContain("FRAME 10.0 ms");
    expect(out).toContain("CALLS 50");
    expect(out).toContain("TRIS 210k");
    expect(out).toContain("GEO 42");
    expect(out).toContain("TEX 8");
  });

  it("tags warn/bad metrics with ~ and ! glyphs on the right lines", () => {
    const s = sample({ frameMs: 15, fps: 66.666, drawCalls: 130, tris: 400000 });
    const cls = classify(s, DEFAULT_BUDGET_1P);
    const out = formatStats(s, cls);
    expect(out).toContain("FPS 67");
    expect(out).toContain("~FRAME 15.0 ms");
    expect(out).toContain("!CALLS 130");
    expect(out).toContain("~TRIS 400k");
  });

  it("formats tris in thousands with a k suffix", () => {
    const big = sample({ tris: 999999 });
    expect(formatStats(big, classify(big, DEFAULT_BUDGET_1P))).toContain("TRIS 1000k");
    const small = sample({ tris: 1000 });
    expect(formatStats(small, classify(small, DEFAULT_BUDGET_1P))).toContain("TRIS 1k");
  });
});

describe("StatsHud", () => {
  let toRemove: StatsHud | null = null;

  afterEach(() => {
    toRemove?.remove();
    toRemove = null;
  });

  it("builds a .gc-stats node appended to the container, hidden by default", () => {
    const container = document.createElement("div");
    toRemove = new StatsHud(container, fixedSnapshot);
    const el = container.querySelector(".gc-stats") as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.style.display).toBe("none");
  });

  it("F3 toggles visibility on then off", () => {
    const container = document.createElement("div");
    toRemove = new StatsHud(container, fixedSnapshot);
    const el = () => container.querySelector(".gc-stats") as HTMLElement;
    fireF3();
    expect(el().style.display).toBe("block");
    fireF3();
    expect(el().style.display).toBe("none");
  });

  it("remove() detaches the .gc-stats node", () => {
    const container = document.createElement("div");
    const hud = new StatsHud(container, fixedSnapshot);
    expect(container.querySelector(".gc-stats")).not.toBeNull();
    hud.remove();
    expect(container.querySelector(".gc-stats")).toBeNull();
  });

  it("remove() stops F3 from affecting the detached node", () => {
    const container = document.createElement("div");
    const hud = new StatsHud(container, fixedSnapshot);
    hud.remove();
    fireF3();
    expect(container.querySelector(".gc-stats")).toBeNull();
  });

  it("visibleWhen=false keeps the overlay hidden even after toggling", () => {
    const container = document.createElement("div");
    toRemove = new StatsHud(container, fixedSnapshot, () => false);
    const el = () => container.querySelector(".gc-stats") as HTMLElement;
    fireF3();
    expect(el().style.display).toBe("none");
  });
});
