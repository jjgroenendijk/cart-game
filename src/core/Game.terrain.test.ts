import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import "./Game.test.mocks";

// Import AFTER vi.mock so Game receives the mocked Renderer.
import { Game } from "./Game";

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
  };
  const internals = (g: Game): Internals => g as unknown as Internals;

  it("Game wires renderer.terrain to the terrain (LOD pass source)", () => {
    const game = makeGame();
    const r = internals(game);
    expect(r.renderer.terrain).toBe(r.terrain);
    game.dispose();
  });

  it("dispose delegates to terrain.dispose()", () => {
    const game = makeGame();
    const disposeSpy = vi.spyOn(internals(game).terrain, "dispose");
    game.dispose();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });
});
