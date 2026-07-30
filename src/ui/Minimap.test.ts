import { beforeAll, describe, expect, it, vi } from "vitest";
import { Minimap, projectXZ, type MinimapPath } from "./Minimap";

// jsdom has no 2D canvas (no `canvas` dep); it logs "Not implemented" when
// getContext is called. Stub it to return null so Minimap's null-guard path is
// exercised without the noise. Scoped to this file (vitest isolates per file).
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

/** Fake loop: a circle of radius R so projections are easy to reason about. */
function circlePath(radius: number): MinimapPath {
  return {
    getPoint(t: number) {
      const a = Math.PI * 2 * (((t % 1) + 1) % 1);
      return { x: radius * Math.cos(a), z: radius * Math.sin(a) };
    },
  };
}

describe("projectXZ", () => {
  it("maps the world centre to the canvas centre", () => {
    const c = projectXZ(0, 0, 160, 100);
    expect(c.px).toBeCloseTo(80, 5);
    expect(c.py).toBeCloseTo(80, 5);
  });

  it("maps +X right and +Z up (north-up), clamped at the extents", () => {
    const right = projectXZ(100, 0, 160, 100); // east edge
    const up = projectXZ(0, 100, 160, 100); // north edge
    expect(right.px).toBeCloseTo(160, 5);
    expect(up.py).toBeCloseTo(0, 5);
  });

  it("maps corners symmetrically", () => {
    const ne = projectXZ(100, 100, 160, 100);
    const sw = projectXZ(-100, -100, 160, 100);
    expect(ne.px).toBeCloseTo(160, 5);
    expect(ne.py).toBeCloseTo(0, 5);
    expect(sw.px).toBeCloseTo(0, 5);
    expect(sw.py).toBeCloseTo(160, 5);
  });

  it("keeps in-bounds track points inside the canvas", () => {
    const path = circlePath(60);
    for (let i = 0; i < 64; i++) {
      const p = path.getPoint(i / 64);
      const c = projectXZ(p.x, p.z, 160, 100);
      expect(c.px).toBeGreaterThanOrEqual(0);
      expect(c.px).toBeLessThanOrEqual(160);
      expect(c.py).toBeGreaterThanOrEqual(0);
      expect(c.py).toBeLessThanOrEqual(160);
    }
  });
});

describe("Minimap", () => {
  it("caches the polyline once with the requested sample count", () => {
    const container = document.createElement("div");
    const mm = new Minimap(container, circlePath(60), { samples: 48 });
    expect(mm.polyline.length).toBe(48);
    // All cached points land inside the canvas bounds.
    for (const [px, py] of mm.polyline) {
      expect(px).toBeGreaterThanOrEqual(0);
      expect(px).toBeLessThanOrEqual(160);
      expect(py).toBeGreaterThanOrEqual(0);
      expect(py).toBeLessThanOrEqual(160);
    }
  });

  it("the polyline is stable across constructions (cached deterministically)", () => {
    const a = new Minimap(document.createElement("div"), circlePath(60), { samples: 32 });
    const b = new Minimap(document.createElement("div"), circlePath(60), { samples: 32 });
    expect(a.polyline).toEqual(b.polyline);
  });

  it("appends a non-interactive canvas overlay (pointer-events none)", () => {
    const container = document.createElement("div");
    new Minimap(container, circlePath(60));
    const root = container.querySelector(".gc-minimap") as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.style.pointerEvents).toBe("none");
    expect(root.querySelector("canvas")).not.toBeNull();
  });

  it("starts hidden until show()", () => {
    const container = document.createElement("div");
    const mm = new Minimap(container, circlePath(60));
    const root = container.querySelector(".gc-minimap") as HTMLElement;
    expect(root.style.display).toBe("none");
    mm.show();
    expect(root.style.display).toBe("block");
    mm.hide();
    expect(root.style.display).toBe("none");
  });

  it("update() does not throw without a 2D context (jsdom) and accepts N karts", () => {
    const container = document.createElement("div");
    const mm = new Minimap(container, circlePath(60));
    const karts = [
      { x: 60, z: 0, player: true },
      { x: 0, z: 60, player: false },
      { x: -60, z: 0, player: false },
    ];
    expect(() => mm.update(karts)).not.toThrow();
  });

  it("remove() detaches the overlay", () => {
    const container = document.createElement("div");
    const mm = new Minimap(container, circlePath(60));
    expect(container.querySelector(".gc-minimap")).not.toBeNull();
    mm.remove();
    expect(container.querySelector(".gc-minimap")).toBeNull();
  });
});

describe("Minimap — default position", () => {
  it("defaults to bottom-right", () => {
    const container = document.createElement("div");
    new Minimap(container, circlePath(60));
    const root = container.querySelector(".gc-minimap") as HTMLElement;
    expect(root.style.right).toBe("14px");
    expect(root.style.bottom).toBe("14px");
  });
});

describe("Minimap shape (060 branches)", () => {
  it("projects branch polylines thinner-layer data alongside the mainline", () => {
    const container = document.createElement("div");
    const shape = {
      main: [
        { x: -60, z: 0 },
        { x: 0, z: 60 },
        { x: 60, z: 0 },
        { x: 0, z: -60 },
      ],
      branches: [
        [
          { x: 0, z: 60 },
          { x: 30, z: 80 },
          { x: 60, z: 0 },
        ],
      ],
    };
    const mm = new Minimap(container, shape, { halfExtent: 100 });
    expect(mm.polyline.length).toBe(4);
    expect(mm.branchPolylines.length).toBe(1);
    expect(mm.branchPolylines[0]!.length).toBe(3);
    // Branch points project with the same transform as the mainline.
    const pr = projectXZ(30, 80, 160, 100);
    expect(mm.branchPolylines[0]![1]![0]).toBeCloseTo(pr.px, 5);
    expect(mm.branchPolylines[0]![1]![1]).toBeCloseTo(pr.py, 5);
  });

  it("setShape re-projects and rescales for a new world", () => {
    const container = document.createElement("div");
    const mm = new Minimap(container, circlePath(60), { samples: 8, halfExtent: 100 });
    expect(mm.branchPolylines.length).toBe(0);
    const before = mm.polyline[0]!;
    mm.setShape(
      {
        main: [{ x: 60, z: 0 }],
        branches: [
          [
            { x: 0, z: 0 },
            { x: 10, z: 10 },
          ],
        ],
      },
      200,
    );
    expect(mm.branchPolylines.length).toBe(1);
    // Same world point, doubled halfExtent -> closer to the canvas centre.
    expect(Math.abs(mm.polyline[0]![0] - 80)).toBeLessThan(Math.abs(before[0] - 80));
  });
});
