import { describe, expect, it, beforeAll, vi, afterEach } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";

// Mock Renderer so Game can construct without WebGL (jsdom has no GL).
// The stub scene is a plain object with add() — the real Terrain/Environment
// groups are passed in but never rendered, which is fine for wiring tests.
vi.mock("./Renderer", () => {
  return {
    Renderer: class {
      scene = { add: () => {} };
      domElement = { remove: () => {} };
      setShadowTarget(): void {}
      render(): void {}
      resize(): void {}
      dispose(): void {}
    },
  };
});

// Import AFTER vi.mock so Game receives the mocked Renderer.
import { Game } from "./Game";
import { AudioManager } from "../audio/AudioManager";

let ready = false;
beforeAll(async () => {
  await RAPIER.init();
  ready = true;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeGame(): Game {
  const container = document.createElement("div");
  return new Game(container);
}

describe("Game — audio wiring (005)", () => {
  it("rapier wasm initialized for the suite", () => {
    expect(ready).toBe(true);
  });

  it("Game constructs an AudioManager (audio field present, public)", () => {
    const game = makeGame();
    expect(game.audio).toBeInstanceOf(AudioManager);
    game.dispose();
  });

  it("AudioManager is built silent at construction (no gesture, no ctx)", () => {
    const game = makeGame();
    expect(game.audio.isGestured).toBe(false);
    expect(game.audio.isRunning).toBe(false);
    game.dispose();
  });

  it("audio.update is called per frame with the 3 kart signals", async () => {
    const game = makeGame();
    const spy = vi.spyOn(game.audio, "update");
    game.start();
    // Wait one animation frame so Game.frame has run at least once.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(spy).toHaveBeenCalled();
    const state = spy.mock.calls.at(-1)![1] as {
      speed: number;
      throttle: number;
      drifting: boolean;
    };
    expect(state).toHaveProperty("speed");
    expect(state.throttle).toBe(0); // no input held
    expect(state.drifting).toBe(false);
    game.dispose();
  });

  it("dispose() calls audio.dispose()", () => {
    const game = makeGame();
    const spy = vi.spyOn(game.audio, "dispose");
    game.dispose();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
