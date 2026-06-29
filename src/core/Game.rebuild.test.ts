import { describe, expect, it, beforeAll, beforeEach, vi, afterEach } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";

// Mock ONLY Renderer (jsdom has no WebGL); keep real splitRects so Game's
// split-screen math runs for real. Real PhysicsWorld/Terrain/Environment/
// FieldBuilder exercise the full Rapier body lifecycle in jsdom.
vi.mock("./Renderer", async (importActual) => {
  const actual = await importActual<typeof import("./Renderer")>();
  return {
    ...actual,
    Renderer: class {
      scene = { add: () => {}, remove: () => {} };
      domElement = { remove: () => {} };
      terrain: unknown = null;
      setShadowTarget(): void {}
      setQuality(): void {}
      render(): void {}
      renderViews(): void {}
      resize(): void {}
      dispose(): void {}
    },
  };
});

import { Game } from "./Game";

beforeAll(async () => {
  await RAPIER.init();
});

beforeEach(() => {
  // jsdom has no 2D canvas; stub getContext so Minimap exercises its null-guard.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

type RealInternals = {
  physics: { world: { forEachRigidBody: (cb: () => void) => void } };
  renderer: { terrain: unknown };
  terrain: unknown;
  rebuildWorld: (b: string) => void;
};

function bodyCount(game: Game): number {
  const physics = (game as unknown as RealInternals).physics;
  let n = 0;
  physics.world.forEachRigidBody(() => n++);
  return n;
}

describe("Game — real-physics world rebuild no-leak (025)", () => {
  it("rebuildWorld 3x returns body count to baseline (no leak)", () => {
    const container = document.createElement("div");
    const game = new Game(container);
    const r = game as unknown as RealInternals;

    const baseline = bodyCount(game);
    expect(baseline).toBeGreaterThan(0);

    for (let i = 0; i < 3; i++) {
      const prevTerrain = r.renderer.terrain;
      game.rebuildWorld("temperate");
      expect(bodyCount(game)).toBe(baseline);
      expect(r.renderer.terrain).not.toBe(prevTerrain); // new terrain assigned
    }

    game.dispose();
    expect(bodyCount(game)).toBe(0);
  });
});
