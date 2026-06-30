import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import "./Game.test.mocks";

// Import AFTER vi.mock so Game receives the mocked Environment/Terrain.
import { Game } from "./Game";

beforeEach(() => {
  // jsdom has no 2D canvas; stub getContext so the Minimap null-guard runs
  // without log noise.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeGame(): Game {
  const container = document.createElement("div");
  return new Game(container);
}

describe("Game — 023 env focus routing (menu vs racing)", () => {
  type Internals = {
    state: string;
    running: boolean;
    frame: (n: number) => void;
    menuFocusX: number;
    menuFocusZ: number;
    env: { lastFocus: { x: number; z: number } | null };
    onStart: (m: "1P" | "2P") => void;
    onSelectConfirm: (r: { mode: "1P" | "2P"; variants: readonly string[] }) => void;
    onCountdownDone: () => void;
  };
  const internals = (g: Game): Internals => g as unknown as Internals;

  it("menu frame centers env on the menu camera target, not the kart grid", () => {
    const game = makeGame();
    const r = internals(game);
    // spline mock: getPoint(0.5) = (500,0,500); humansMidpoint mock = origin.
    expect(r.menuFocusX).toBe(500);
    expect(r.menuFocusZ).toBe(500);
    r.running = true;
    r.frame(0);
    expect(r.env.lastFocus).toEqual({ x: 500, z: 500 });
    game.dispose();
  });

  it("racing frame centers env on the human midpoint", () => {
    const game = makeGame();
    const r = internals(game);
    r.onStart("1P");
    r.onSelectConfirm({ mode: "1P", variants: ["balanced", "balanced"] });
    r.onCountdownDone();
    expect(r.state).toBe("racing");
    r.running = true;
    r.frame(0);
    // humansMidpoint mock returns the origin, distinct from menuFocus (500).
    expect(r.env.lastFocus).toEqual({ x: 0, z: 0 });
    game.dispose();
  });

  it("select frame keeps env on the menu camera target (water stays in view)", () => {
    const game = makeGame();
    const r = internals(game);
    r.onStart("1P");
    expect(r.state).toBe("select");
    r.running = true;
    r.frame(0);
    // MenuCamera is still the renderer in select; env/water must follow it,
    // not the kart grid start (origin) where the plane would be culled.
    expect(r.env.lastFocus).toEqual({ x: 500, z: 500 });
    game.dispose();
  });

  it("countdown frame keeps env on the menu camera target", () => {
    const game = makeGame();
    const r = internals(game);
    r.onStart("1P");
    r.onSelectConfirm({ mode: "1P", variants: ["balanced", "balanced"] });
    expect(r.state).toBe("countdown");
    r.running = true;
    r.frame(0);
    // Countdown still renders via the MenuCamera, so keep the menu focus.
    expect(r.env.lastFocus).toEqual({ x: 500, z: 500 });
    game.dispose();
  });
});
