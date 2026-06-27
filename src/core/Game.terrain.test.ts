import { describe, expect, it, beforeAll, beforeEach, vi, afterEach } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";

// Mock Renderer so Game can construct without WebGL (jsdom has no GL), but
// keep the real pure splitRects (Game imports it from this module).
vi.mock("./Renderer", async (importActual) => {
  const actual = await importActual<typeof import("./Renderer")>();
  return {
    ...actual,
    Renderer: class {
      scene = { add: () => {}, remove: () => {} };
      domElement = { remove: () => {} };
      setShadowTarget(): void {}
      render(): void {}
      renderViews(): void {}
      resize(): void {}
      dispose(): void {}
    },
  };
});

// Import AFTER vi.mock so Game receives the mocked Renderer.
import { Game } from "./Game";

let ready = false;
beforeAll(async () => {
  await RAPIER.init();
  ready = true;
});

beforeEach(() => {
  // jsdom has no 2D canvas; stub getContext so the Minimap built inside Game
  // exercises its null-guard path without log noise.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeGame(): Game {
  const container = document.createElement("div");
  return new Game(container);
}

describe("Game — 019 terrain LOD + dispose wiring", () => {
  type Internals = {
    terrain: { dispose: () => void; update: (cams: unknown[]) => void };
    renderer: { terrain: unknown };
    physics: { world: { forEachRigidBody: (cb: () => void) => void } };
  };
  const internals = (g: Game): Internals => g as unknown as Internals;

  function bodyCount(g: Game): number {
    let n = 0;
    internals(g).physics.world.forEachRigidBody(() => n++);
    return n;
  }

  it("rapier wasm initialized for the suite", () => {
    expect(ready).toBe(true);
  });

  it("Game wires renderer.terrain to the terrain (LOD pass source)", () => {
    const game = makeGame();
    const r = internals(game);
    expect(r.renderer.terrain).toBe(r.terrain);
    game.dispose();
  });

  it("dispose frees every terrain body (chunks + walls) -> body count 0", () => {
    const game = makeGame();
    expect(bodyCount(game)).toBeGreaterThan(0);
    game.dispose();
    expect(bodyCount(game)).toBe(0);
  });
});
