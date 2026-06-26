import { describe, expect, it, beforeAll, beforeEach, vi, afterEach } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";

vi.mock("./Renderer", async (importActual) => {
  const actual = await importActual<typeof import("./Renderer")>();
  return {
    ...actual,
    Renderer: class {
      scene = { add: () => {}, remove: () => {} };
      domElement = { remove: () => {} };
      setShadowTarget(): void {}
      render(): void {}
      renderViews(): void {}
      resize(): void {}
      dispose(): void {}
    },
  };
});

import { Game } from "./Game";

beforeAll(async () => {
  await RAPIER.init();
});

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Game — water life bar wiring (018)", () => {
  it("builds one .gc-life-bar per human and starts full + dry", () => {
    const container = document.createElement("div");
    const game = new Game(container);
    expect(container.querySelectorAll(".gc-life-bar")).toHaveLength(game.humanCount);
    expect(game.views[0]!.kart.controller.life).toBe(1);
    expect(game.views[0]!.kart.controller.inWater).toBe(false);
    game.dispose();
  });

  it("setLife drives the life bar fill width + water visibility", () => {
    const container = document.createElement("div");
    const game = new Game(container);
    game.views[0]!.setLife(0.3, true);
    const fill = container.querySelector(".gc-life-bar-fill") as HTMLElement;
    const root = container.querySelector(".gc-life-bar") as HTMLElement;
    expect(fill.style.width).toBe("30%");
    expect(root.style.display).toBe("block");
    game.dispose();
  });

  it("setLife hides the bar when out of water", () => {
    const container = document.createElement("div");
    const game = new Game(container);
    game.views[0]!.setLife(0.5, false);
    const root = container.querySelector(".gc-life-bar") as HTMLElement;
    expect(root.style.display).toBe("none");
    game.dispose();
  });
});
