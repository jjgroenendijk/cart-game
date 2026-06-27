import { describe, expect, it, beforeAll, beforeEach, vi, afterEach } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import type * as THREE from "three";

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
import { FieldBuilder } from "./FieldBuilder";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { Terrain } from "../terrain/Terrain";
import type { AudioManager } from "../audio/AudioManager";
import type { GameAudioDriver } from "../audio/gameAudio";
import type { Minimap } from "../ui/Minimap";

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

describe("FieldBuilder — per-human variant select (024)", () => {
  // Build FieldBuilder directly with real physics + terrain (RAPIER init in
  // beforeAll) and stubbed collaborators mirroring FieldBuilderDeps.
  function makeField(): FieldBuilder {
    const physics = new PhysicsWorld(-24);
    const terrain = new Terrain(physics);
    return new FieldBuilder({
      physics,
      terrain,
      scene: { add: () => {}, remove: () => {} } as unknown as THREE.Scene,
      container: document.createElement("div"),
      audio: { setHumanCount: () => {} } as unknown as AudioManager,
      gameAudio: { setSources: () => {} } as unknown as GameAudioDriver,
      minimap: { place: () => {} } as unknown as Minimap,
      results: document.createElement("div"),
    });
  }

  it("build(1) defaults the human to balanced (backward compat)", () => {
    const field = makeField();
    field.build(1);
    expect(field.views[0]!.kart.controller.tuning.maxSpeed).toBe(34);
    field.dispose();
  });

  it("build(1, ['speed']) wires the speed variant tuning", () => {
    const field = makeField();
    field.build(1, ["speed"]);
    expect(field.views[0]!.kart.controller.tuning.maxSpeed).toBe(39);
    field.dispose();
  });

  it("build(2, ['grip','heavy']) maps each human to its variant", () => {
    const field = makeField();
    field.build(2, ["grip", "heavy"]);
    expect(field.views[0]!.kart.controller.tuning.maxSpeed).toBe(30);
    expect(field.views[1]!.kart.controller.tuning.mass).toBe(340);
    field.dispose();
  });
});
