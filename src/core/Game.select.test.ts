import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import "./Game.test.mocks";

// Import AFTER vi.mock so Game receives the mocked Renderer.
import { Game } from "./Game";

type TestPick = { variant: string; colorway: string };

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

describe("Game — 024 menu -> select -> countdown wiring", () => {
  type Internals = {
    onStart: () => void;
    onRaceConfigConfirm: (c: { mode: string; phase: string; dayLengthSeconds: number }) => void;
    onSelectConfirm: (picks: readonly TestPick[]) => void;
    onSelectBack: () => void;
    startMenu: { hide: () => void; show: () => void };
  };
  const internals = (g: Game): Internals => g as unknown as Internals;
  const rc = { mode: "dynamic", phase: "noon", dayLengthSeconds: 120 };

  it("onStart opens select: audio.resume + engine off + start menu hidden", () => {
    const game = makeGame();
    const r = internals(game);
    const resumeSpy = vi.spyOn(game.audio, "resume");
    const engineSpy = vi.spyOn(game.audio, "setEngineActive");
    const hideSpy = vi.spyOn(r.startMenu, "hide");
    r.onStart();
    r.onRaceConfigConfirm(rc);
    expect(game.currentState).toBe("select");
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(engineSpy).toHaveBeenCalledWith(false);
    expect(hideSpy).toHaveBeenCalledTimes(1);
    game.dispose();
  });

  it("confirm rebuilds the field with the chosen variant", () => {
    const game = makeGame();
    const r = internals(game);
    r.onStart();
    r.onRaceConfigConfirm(rc);
    expect(game.currentState).toBe("select");
    r.onSelectConfirm([{ variant: "speed", colorway: "glacier" }]);
    expect(game.currentState).toBe("countdown");
    // speed variant tuning wired into the rebuilt human kart.
    expect(game.view.kart.controller.tuning.maxSpeed).toBe(39);
    game.dispose();
  });

  it("back from select returns to menu + re-shows the start menu", () => {
    const game = makeGame();
    const r = internals(game);
    r.onStart();
    r.onRaceConfigConfirm(rc);
    expect(game.currentState).toBe("select");
    const showSpy = vi.spyOn(r.startMenu, "show");
    r.onSelectBack();
    expect(game.currentState).toBe("menu");
    expect(showSpy).toHaveBeenCalledTimes(1);
    game.dispose();
  });

  it("Esc from select returns to menu exactly once (overlay owns Esc)", () => {
    const game = makeGame();
    const r = internals(game);
    r.onStart();
    r.onRaceConfigConfirm(rc);
    expect(game.currentState).toBe("select");
    const showSpy = vi.spyOn(r.startMenu, "show");
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    expect(game.currentState).toBe("menu");
    expect(showSpy).toHaveBeenCalledTimes(1);
    game.dispose();
  });
});
