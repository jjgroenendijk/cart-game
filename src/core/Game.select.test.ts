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

describe("Game — 024 menu -> select -> countdown wiring", () => {
  type Internals = {
    onStart: (mode: "1P" | "2P") => void;
    onSelectConfirm: (r: { mode: "1P" | "2P"; variants: readonly string[] }) => void;
    onSelectBack: () => void;
    startMenu: { hide: () => void; show: () => void };
  };
  const internals = (g: Game): Internals => g as unknown as Internals;

  it("onStart opens select: audio.resume + engine off + start menu hidden", () => {
    const game = makeGame();
    const r = internals(game);
    const resumeSpy = vi.spyOn(game.audio, "resume");
    const engineSpy = vi.spyOn(game.audio, "setEngineActive");
    const hideSpy = vi.spyOn(r.startMenu, "hide");
    r.onStart("1P");
    expect(game.currentState).toBe("select");
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(engineSpy).toHaveBeenCalledWith(false);
    expect(hideSpy).toHaveBeenCalledTimes(1);
    game.dispose();
  });

  it("confirm rebuilds the field with the chosen variant (1P)", () => {
    const game = makeGame();
    const r = internals(game);
    r.onStart("1P");
    expect(game.currentState).toBe("select");
    r.onSelectConfirm({ mode: "1P", variants: ["speed", "balanced"] });
    expect(game.currentState).toBe("countdown");
    // speed variant tuning wired into the rebuilt human kart.
    expect(game.views[0]!.kart.controller.tuning.maxSpeed).toBe(39);
    game.dispose();
  });

  it("confirm to 2P rebuilds two humans each on its variant", () => {
    const game = makeGame();
    const r = internals(game);
    r.onStart("2P");
    r.onSelectConfirm({ mode: "2P", variants: ["grip", "heavy"] });
    expect(game.currentState).toBe("countdown");
    expect(game.views).toHaveLength(2);
    expect(game.views[0]!.kart.controller.tuning.maxSpeed).toBe(30); // grip
    expect(game.views[1]!.kart.controller.tuning.mass).toBe(340); // heavy
    game.dispose();
  });

  it("back from select returns to menu + re-shows the start menu", () => {
    const game = makeGame();
    const r = internals(game);
    r.onStart("1P");
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
    r.onStart("1P");
    expect(game.currentState).toBe("select");
    const showSpy = vi.spyOn(r.startMenu, "show");
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    expect(game.currentState).toBe("menu");
    expect(showSpy).toHaveBeenCalledTimes(1);
    game.dispose();
  });
});
