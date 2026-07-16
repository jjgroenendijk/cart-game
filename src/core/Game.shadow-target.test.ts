import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import "./Game.test.mocks";

// Import AFTER vi.mock so Game receives the mocked Renderer/Environment/Terrain.
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

describe("Game — 224 shadow-target routing (menu vs racing)", () => {
  type Internals = {
    state: string;
    running: boolean;
    frame: (n: number) => void;
    menuFocusX: number;
    menuFocusZ: number;
    renderer: { setShadowTarget: (x: number, z: number) => void };
    rebuildWorld: () => void;
    onStart: (m: "1P" | "2P") => void;
    onRaceConfigConfirm: (c: { mode: string; phase: string; dayLengthSeconds: number }) => void;
    onSelectConfirm: (r: {
      mode: "1P" | "2P";
      picks: readonly { variant: string; colorway: string }[];
    }) => void;
    onCountdownDone: () => void;
    onPause?: () => void;
  };
  const internals = (g: Game): Internals => g as unknown as Internals;
  const rc = { mode: "dynamic", phase: "noon", dayLengthSeconds: 120 };
  const picks = {
    mode: "1P" as const,
    picks: [
      { variant: "balanced", colorway: "ember" },
      { variant: "balanced", colorway: "ember" },
    ],
  };
  const lastCall = (spy: ReturnType<typeof vi.fn>): [number, number] =>
    spy.mock.calls[spy.mock.calls.length - 1] as [number, number];

  function spyTarget(r: Internals): ReturnType<typeof vi.fn> {
    return vi.spyOn(r.renderer, "setShadowTarget") as unknown as ReturnType<typeof vi.fn>;
  }

  it("menu frame targets the menu focus, not the kart grid", () => {
    const game = makeGame();
    const r = internals(game);
    // spline mock: getPoint(0.5) = (500,0,500); humansMidpoint mock = origin.
    expect(r.state).toBe("menu");
    const spy = spyTarget(r);
    r.running = true;
    r.frame(0);
    expect(lastCall(spy)).toEqual([500, 500]);
    game.dispose();
  });

  it("select frame keeps the shadow target on the menu focus", () => {
    const game = makeGame();
    const r = internals(game);
    r.onStart("1P");
    r.onRaceConfigConfirm(rc);
    expect(r.state).toBe("select");
    const spy = spyTarget(r);
    r.running = true;
    r.frame(0);
    expect(lastCall(spy)).toEqual([500, 500]);
    game.dispose();
  });

  it("countdown frame keeps the shadow target on the menu focus", () => {
    const game = makeGame();
    const r = internals(game);
    r.onStart("1P");
    r.onRaceConfigConfirm(rc);
    r.onSelectConfirm(picks);
    expect(r.state).toBe("countdown");
    const spy = spyTarget(r);
    r.running = true;
    r.frame(0);
    expect(lastCall(spy)).toEqual([500, 500]);
    game.dispose();
  });

  it("racing frame targets the human midpoint", () => {
    const game = makeGame();
    const r = internals(game);
    r.onStart("1P");
    r.onRaceConfigConfirm(rc);
    r.onSelectConfirm(picks);
    r.onCountdownDone();
    expect(r.state).toBe("racing");
    const spy = spyTarget(r);
    r.running = true;
    r.frame(0);
    // humansMidpoint mock returns the origin, distinct from menuFocus (500).
    expect(lastCall(spy)).toEqual([0, 0]);
    game.dispose();
  });

  it("paused frame keeps the shadow target on the human midpoint", () => {
    const game = makeGame();
    const r = internals(game);
    r.onStart("1P");
    r.onRaceConfigConfirm(rc);
    r.onSelectConfirm(picks);
    r.onCountdownDone();
    r.onPause?.();
    expect(r.state).toBe("paused");
    const spy = spyTarget(r);
    r.running = true;
    r.frame(0);
    // Paused freezes the race camera on the karts, so shadows stay on them.
    expect(lastCall(spy)).toEqual([0, 0]);
    game.dispose();
  });

  it("rebuild reapplies the target to the fresh world, not a stale one", () => {
    const game = makeGame();
    const r = internals(game);
    const spy = spyTarget(r);
    r.rebuildWorld();
    // buildWorld reapplies the (fresh) menu focus immediately on rebuild.
    expect(lastCall(spy)).toEqual([500, 500]);
    game.dispose();
  });
});
