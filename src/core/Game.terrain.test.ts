import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import "./Game.test.mocks";

// Import AFTER vi.mock so Game receives the mocked Renderer.
import { Game, type GameOptions } from "./Game";

beforeEach(() => {
  // jsdom has no 2D canvas; stub getContext so the Minimap built inside Game
  // exercises its null-guard path without log noise.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeGame(opts?: GameOptions): Game {
  const container = document.createElement("div");
  return new Game(container, opts);
}

describe("Game — 019 terrain LOD + dispose wiring", () => {
  type Internals = {
    terrain: {
      dispose: () => void;
      update: (cams: unknown[]) => void;
      terrainOpts: unknown;
    };
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

describe("Game — 023 streaming config forwarding", () => {
  type Internals = { terrain: { terrainOpts: unknown } };
  const internals = (g: Game): Internals => g as unknown as Internals;

  it("forwards terrain streaming opts to Terrain", () => {
    const game = makeGame({
      terrain: { streamRadius: 50, cullRadius: 70, maxActivations: 2 },
    });
    expect(internals(game).terrain.terrainOpts).toMatchObject({
      streamRadius: 50,
      cullRadius: 70,
      maxActivations: 2,
    });
    game.dispose();
  });

  it("default Game constructs Terrain with biome config + no streaming opts", () => {
    const game = makeGame();
    const opts = internals(game).terrain.terrainOpts as Record<string, unknown>;
    expect(opts.config).toBeDefined(); // biomeTerrain(temperate)
    expect(opts.streamRadius).toBeUndefined();
    expect(opts.cullRadius).toBeUndefined();
    expect(opts.maxActivations).toBeUndefined();
    game.dispose();
  });
});
