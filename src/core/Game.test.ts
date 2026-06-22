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

describe("Game — state machine + menu/countdown wiring (006)", () => {
  type GameInternals = {
    renderer: { render: (c: { fov: number }) => void };
    physics: { step: () => void };
    onStart: () => void;
    onCountdownDone: () => void;
    startMenu: { hide: () => void };
    countdown: { hide: () => void };
  };
  const internals = (g: Game): GameInternals => g as unknown as GameInternals;

  it("constructs in the 'menu' state", () => {
    const game = makeGame();
    expect(game.currentState).toBe("menu");
    game.dispose();
  });

  it("HUD is speed-only (controls list moved to the StartMenu)", () => {
    const { container } = makeGameWithContainer();
    const hud = container.querySelector("#hud") as HTMLElement | null;
    expect(hud).not.toBeNull();
    expect(hud!.querySelector("#hud-speed")).not.toBeNull();
    // No controls block: only the speed div is a child.
    expect(hud!.children).toHaveLength(1);
    expect(hud!.textContent).not.toContain("WASD");
  });

  it("menu frame renders the menu camera and steps NO physics", async () => {
    const game = makeGame();
    const renderSpy = vi.spyOn(internals(game).renderer, "render");
    const stepSpy = vi.spyOn(internals(game).physics, "step");
    game.start();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(renderSpy).toHaveBeenCalled();
    const cam = renderSpy.mock.calls.at(-1)![0];
    expect(cam.fov).toBe(55); // MenuCamera; ChaseCamera is 62
    expect(stepSpy).not.toHaveBeenCalled(); // ctor prime already ran pre-spy
    game.dispose();
  });

  it("onStart -> countdown + audio.resume + engine off + menu hidden", () => {
    const game = makeGame();
    const resumeSpy = vi.spyOn(game.audio, "resume");
    const engineSpy = vi.spyOn(game.audio, "setEngineActive");
    const hideSpy = vi.spyOn(internals(game).startMenu, "hide");
    internals(game).onStart();
    expect(game.currentState).toBe("countdown");
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(engineSpy).toHaveBeenCalledWith(false);
    expect(hideSpy).toHaveBeenCalledTimes(1);
    game.dispose();
  });

  it("onCountdownDone -> racing + engine on + countdown hidden + HUD shown", () => {
    const game = makeGame();
    // Move into countdown first (legal transition path).
    internals(game).onStart();
    const engineSpy = vi.spyOn(game.audio, "setEngineActive");
    const hideSpy = vi.spyOn(internals(game).countdown, "hide");
    internals(game).onCountdownDone();
    expect(game.currentState).toBe("racing");
    expect(engineSpy).toHaveBeenCalledWith(true);
    expect(hideSpy).toHaveBeenCalledTimes(1);
    game.dispose();
  });

  it("racing is terminal (onStart after racing stays racing)", () => {
    const game = makeGame();
    internals(game).onStart();
    internals(game).onCountdownDone();
    expect(game.currentState).toBe("racing");
    internals(game).onStart(); // ignored
    expect(game.currentState).toBe("racing");
    game.dispose();
  });

  it("dispose detaches StartMenu + Countdown + HUD from the container", () => {
    const { container, game } = makeGameWithContainer();
    expect(container.children.length).toBeGreaterThan(0);
    game.dispose();
    expect(container.children).toHaveLength(0);
  });
});

function makeGameWithContainer(): { container: HTMLElement; game: Game } {
  const container = document.createElement("div");
  const game = new Game(container);
  return { container, game };
}
