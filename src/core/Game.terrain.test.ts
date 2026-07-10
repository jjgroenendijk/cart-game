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

  it("default Game scales terrain draw distance to the world (fog horizon)", () => {
    const game = makeGame();
    const opts = internals(game).terrain.terrainOpts as Record<string, unknown>;
    expect(opts.config).toBeDefined(); // biomeTerrain(temperate)
    // World-scaled: streams out toward the fog horizon, capped so the largest
    // worlds do not build an unbounded collider ring. cull > stream (hysteresis).
    const stream = opts.streamRadius as number;
    const cull = opts.cullRadius as number;
    expect(stream).toBeGreaterThanOrEqual(140);
    expect(stream).toBeLessThanOrEqual(360);
    expect(cull).toBeGreaterThan(stream);
    expect(cull).toBeLessThanOrEqual(390);
    // maxActivations is still left to the Terrain default (hitch budget).
    expect(opts.maxActivations).toBeUndefined();
    game.dispose();
  });
});

describe("Game — 057 showcase circuit forwarding", () => {
  type CircuitOpts = {
    control: ReadonlyArray<readonly [number, number, number]>;
    worldSize: number;
  };
  type Internals = { terrain: { terrainOpts: CircuitOpts } };
  const internals = (g: Game): Internals => g as unknown as Internals;

  it("forwards the showcase circuit control + worldSize to Terrain", () => {
    const game = makeGame();
    const opts = internals(game).terrain.terrainOpts;
    expect(Array.isArray(opts.control)).toBe(true);
    expect(opts.control.length).toBeGreaterThanOrEqual(8);
    // Not the seed-independent fallback (16-pt regular r=100 circle).
    expect(opts.control.length).not.toBe(16);
    // Scalable generator: bigger than the old ~200 m hard-coded world, in cap.
    expect(opts.worldSize).toBeGreaterThan(200);
    expect(opts.worldSize).toBeLessThanOrEqual(768);
    for (const c of opts.control) {
      expect(c.length).toBe(3);
      for (const v of c) expect(typeof v).toBe("number");
    }
    game.dispose();
  });

  it("is deterministic: two Games share the same showcase control", () => {
    const a = makeGame();
    const b = makeGame();
    const ca = internals(a).terrain.terrainOpts.control;
    const cb = internals(b).terrain.terrainOpts.control;
    expect(JSON.stringify(ca)).toBe(JSON.stringify(cb));
    a.dispose();
    b.dispose();
  });
});
