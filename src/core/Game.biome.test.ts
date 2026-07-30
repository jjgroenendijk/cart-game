import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import "./Game.test.mocks";

import { Game } from "./Game";
import type { CircuitId } from "../terrain/circuitCode";

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

type RebuildInternals = {
  terrain: object;
  env: object;
  field: { view: unknown };
  renderer: { terrain: unknown; scene: { remove: () => void } };
  currentBiome: string;
  rebuildWorld: (id: CircuitId) => void;
  onStart: (b?: string) => void;
  onBiomeChange: (b: string) => void;
};

function makeGame(): Game {
  const container = document.createElement("div");
  return new Game(container);
}

describe("Game — biome world rebuild (025)", () => {
  const internals = (g: Game): RebuildInternals => g as unknown as RebuildInternals;

  it("rebuildWorld(temperate) swaps terrain + env for new instances", () => {
    const game = makeGame();
    const r = internals(game);
    const oldTerrain = r.terrain;
    const oldEnv = r.env;
    r.rebuildWorld({ seed: 1, biome: 0 });
    expect(r.terrain).not.toBe(oldTerrain);
    expect(r.env).not.toBe(oldEnv);
    expect(r.renderer.terrain).toBe(r.terrain);
    expect(r.field.view).toBeDefined(); // single-view field rebuilt
    game.dispose();
  });

  it("rebuildWorld sets currentBiome", () => {
    const game = makeGame();
    const r = internals(game);
    expect(r.currentBiome).toBe("temperate");
    r.rebuildWorld({ seed: 1, biome: 0 });
    expect(r.currentBiome).toBe("temperate");
    game.dispose();
  });

  it("onStart() with no biome does NOT rebuild (temperate parity)", () => {
    const game = makeGame();
    const r = internals(game);
    const terrainRef = r.terrain;
    r.onStart();
    expect(r.terrain).toBe(terrainRef);
    game.dispose();
  });

  it("onStart('temperate') does NOT rebuild (same biome)", () => {
    const game = makeGame();
    const r = internals(game);
    const terrainRef = r.terrain;
    r.onStart("temperate");
    expect(r.terrain).toBe(terrainRef);
    game.dispose();
  });

  it("onBiomeChange(desert) rebuilds the world + sets currentBiome", () => {
    const game = makeGame();
    const r = internals(game);
    const terrainRef = r.terrain;
    const envRef = r.env;
    r.onBiomeChange("desert");
    expect(r.terrain).not.toBe(terrainRef);
    expect(r.env).not.toBe(envRef);
    expect(r.currentBiome).toBe("desert");
    expect(r.renderer.terrain).toBe(r.terrain);
    game.dispose();
  });

  it("onBiomeChange(currentBiome) is a no-op (no rebuild)", () => {
    const game = makeGame();
    const r = internals(game);
    const terrainRef = r.terrain;
    r.onBiomeChange("temperate"); // currentBiome is temperate
    expect(r.terrain).toBe(terrainRef);
    expect(r.currentBiome).toBe("temperate");
    game.dispose();
  });
});
