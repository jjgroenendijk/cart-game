import { describe, expect, it, beforeAll, beforeEach, vi, afterEach } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import type * as THREE from "three";

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

// Build FieldBuilder directly with real physics + terrain (RAPIER init in
// beforeAll) and stubbed collaborators mirroring FieldBuilderDeps.
function makeField(container = document.createElement("div")): {
  field: FieldBuilder;
  terrain: Terrain;
} {
  const physics = new PhysicsWorld(-24);
  const terrain = new Terrain(physics, {
    worldSize: 40,
    gridCount: 2,
    cacheCell: 2,
    config: { noiseSeed: 1 },
    // Tiny streamRadius: cache covers [-20,20], so the production default 140
    // would seed ~145 out-of-cache chunks whose verts now resolve through
    // StreamingHeightSource.closestPoint (023 A4) -> ctor timeout. 25 keeps the
    // seed to a 5-chunk plus-shape (centers 0/±20), fast + covers the spawn.
    streamRadius: 25,
    cullRadius: 40,
  });
  return {
    field: new FieldBuilder({
      physics,
      terrain,
      scene: { add: () => {}, remove: () => {} } as unknown as THREE.Scene,
      container,
      audio: { setHumanCount: () => {}, setRivalCount: () => {} } as unknown as AudioManager,
      gameAudio: { setSources: () => {} } as unknown as GameAudioDriver,
      minimap: { place: () => {} } as unknown as Minimap,
      results: document.createElement("div"),
    }),
    terrain,
  };
}

describe("Game — water life bar wiring (018)", () => {
  it("builds one .gc-life-bar per human and starts full + dry", () => {
    const container = document.createElement("div");
    const { field, terrain } = makeField(container);
    field.build(1);
    expect(container.querySelectorAll(".gc-life-bar")).toHaveLength(field.humanCount);
    expect(field.views[0]!.kart.controller.life).toBe(1);
    expect(field.views[0]!.kart.controller.inWater).toBe(false);
    field.dispose();
    terrain.dispose();
  });

  it("setLife drives the life bar fill width + water visibility", () => {
    const container = document.createElement("div");
    const { field, terrain } = makeField(container);
    field.build(1);
    field.views[0]!.setLife(0.3, true);
    const fill = container.querySelector(".gc-life-bar-fill") as HTMLElement;
    const root = container.querySelector(".gc-life-bar") as HTMLElement;
    expect(fill.style.width).toBe("30%");
    expect(root.style.display).toBe("block");
    field.dispose();
    terrain.dispose();
  });

  it("setLife hides the bar when out of water", () => {
    const container = document.createElement("div");
    const { field, terrain } = makeField(container);
    field.build(1);
    field.views[0]!.setLife(0.5, false);
    const root = container.querySelector(".gc-life-bar") as HTMLElement;
    expect(root.style.display).toBe("none");
    field.dispose();
    terrain.dispose();
  });
});

describe("FieldBuilder — per-human variant select (024)", () => {
  it("build(1) defaults the human to balanced (backward compat)", () => {
    const { field, terrain } = makeField();
    field.build(1);
    expect(field.views[0]!.kart.controller.tuning.maxSpeed).toBe(34);
    field.dispose();
    terrain.dispose();
  });

  it("build(1, ['speed']) wires the speed variant tuning", () => {
    const { field, terrain } = makeField();
    field.build(1, [{ variant: "speed", colorway: "glacier" }]);
    expect(field.views[0]!.kart.controller.tuning.maxSpeed).toBe(39);
    field.dispose();
    terrain.dispose();
  });

  it("build(2, ['grip','heavy']) maps each human to its variant", () => {
    const { field, terrain } = makeField();
    field.build(2, [
      { variant: "grip", colorway: "moss" },
      { variant: "heavy", colorway: "violet" },
    ]);
    expect(field.views[0]!.kart.controller.tuning.maxSpeed).toBe(30);
    expect(field.views[1]!.kart.controller.tuning.mass).toBe(340);
    field.dispose();
    terrain.dispose();
  });
});
