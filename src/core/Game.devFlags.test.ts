import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import "./Game.test.mocks";

// Import AFTER vi.mock so Game receives the mocked Renderer/Field/etc.
import { Game } from "./Game";
import type { DevFlags } from "./devFlags";

beforeEach(() => {
  // jsdom has no 2D canvas; stub getContext so the Minimap null-guard path runs.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Build a full DevFlags with only the overrides under test set. */
function flags(over: Partial<DevFlags>): DevFlags {
  return { autostart: false, debug: true, garage: false, freefly: false, ...over };
}

function makeGame(dev: DevFlags): Game {
  return new Game(document.createElement("div"), { dev });
}

describe("Game — dev URL flags (Phase 2 entry)", () => {
  it("dev.biome forces the built circuit biome", () => {
    const game = makeGame(flags({ biome: "tundra" }));
    expect(game.currentBiome).toBe("tundra");
    game.dispose();
  });

  it("dev.seed forces the built circuit seed", () => {
    const game = makeGame(flags({ seed: 4242 }));
    expect(game.current.seed).toBe(4242);
    game.dispose();
  });

  it("no dev flags leaves the normal menu boot (state = menu)", () => {
    const game = makeGame(flags({}));
    expect(game.state).toBe("menu");
    game.dispose();
  });

  it("dev.autostart drops straight into racing", () => {
    const game = makeGame(flags({ autostart: true }));
    expect(game.state).toBe("racing");
    game.dispose();
  });

  it("dev.autostart honors a forced biome in the racing world", () => {
    const game = makeGame(flags({ autostart: true, biome: "desert" }));
    expect(game.state).toBe("racing");
    expect(game.currentBiome).toBe("desert");
    game.dispose();
  });
});
