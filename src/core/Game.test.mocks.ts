import { vi } from "vitest";

// Mock Renderer so Game can construct without WebGL (jsdom has no GL), but
// keep the real pure splitRects (Game imports it from this module).
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

vi.mock("../physics/PhysicsWorld", () => ({
  PhysicsWorld: class {
    world = { removeRigidBody: () => {} };
    step(): void {}
    drainContactForceEvents(): void {}
  },
}));

vi.mock("../terrain/Terrain", async () => {
  const THREE = await import("three");
  return {
    Terrain: class {
      /** Captures the opts Game forwarded (for the Game.terrain test). */
      terrainOpts: unknown;
      group = new THREE.Group();
      waterLevel = -1.2;
      spline = {
        getPoint: (_t: number, out = new THREE.Vector3()) => out.set(0, 0, 0),
      };
      constructor(_physics: unknown, opts?: unknown) {
        this.terrainOpts = opts;
      }
      heightAt(): number {
        return 0;
      }
      startPos(out = new THREE.Vector3()): typeof out {
        return out.set(0, 0, 0);
      }
      startYaw(): number {
        return 0;
      }
      dispose(): void {}
    },
  };
});

vi.mock("../environment/Environment", async () => {
  const THREE = await import("three");
  return {
    Environment: class {
      group = new THREE.Group();
      update(): void {}
      dispose(): void {}
    },
  };
});

vi.mock("./FieldBuilder", async () => {
  const THREE = await import("three");
  const TARGET_FIELD = 6;

  class MockRace {
    phase = "grid";
    targetLaps = 3;
    kartCount = TARGET_FIELD;

    constructor(private readonly humanCount: number) {}

    startRace(): void {
      this.phase = "racing";
    }

    snapshot(): {
      phase: string;
      progress: Array<{ lap: number }>;
      positions: number[];
      timer: number;
    } {
      return {
        phase: this.phase,
        progress: Array.from({ length: this.humanCount }, () => ({ lap: 0 })),
        positions: Array.from({ length: this.humanCount }, (_, i) => i + 1),
        timer: 0,
      };
    }
  }

  function makeView(
    container: HTMLElement,
    index: number,
    variantId = "balanced",
  ): {
    kart: {
      speed: number;
      controller: { life: number; inWater: boolean; tuning: { mass: number; maxSpeed: number } };
      group: InstanceType<typeof THREE.Group>;
    };
    chaseCam: { camera: { fov: number }; setAspect: () => void };
    rect: { x: number; y: number; w: number; h: number };
    speedEl: HTMLElement;
    sync: () => void;
    updateCamera: () => void;
    setSpeed: (speed: number) => void;
    setLife: () => void;
    repositionLife: () => void;
    removeHud: () => void;
  } {
    const speedEl = document.createElement("div");
    speedEl.className = "gc-speed";
    speedEl.textContent = "0 km/h";
    container.appendChild(speedEl);
    const lifeEl = document.createElement("div");
    lifeEl.className = "gc-life-bar";
    container.appendChild(lifeEl);
    return {
      kart: {
        speed: 0,
        controller: {
          life: 1,
          inWater: false,
          tuning: variantTuning(variantId),
        },
        group: new THREE.Group(),
      },
      chaseCam: { camera: { fov: 62 }, setAspect: () => {} },
      rect: { x: 0, y: index * 300, w: 800, h: 300 },
      speedEl,
      sync: () => {},
      updateCamera: () => {},
      setSpeed: (speed: number) => {
        speedEl.textContent = `${speed} km/h`;
      },
      setLife: () => {},
      repositionLife: () => {},
      removeHud: () => {
        speedEl.remove();
        lifeEl.remove();
      },
    };
  }

  function makeRaceHud(container: HTMLElement): {
    root: HTMLElement;
    show: () => void;
    hide: () => void;
    update: () => void;
    remove: () => void;
  } {
    const root = document.createElement("div");
    root.className = "gc-race-hud";
    container.appendChild(root);
    return {
      root,
      show: () => {
        root.style.display = "block";
      },
      hide: () => {
        root.style.display = "none";
      },
      update: () => {},
      remove: () => root.remove(),
    };
  }

  class FieldBuilder {
    views: ReturnType<typeof makeView>[] = [];
    rivals: Array<{
      controller: { body: unknown; life: number; inWater: boolean };
      group: InstanceType<typeof THREE.Group>;
      speed: number;
      sync: () => void;
    }> = [];
    race = new MockRace(1);
    raceHuds: ReturnType<typeof makeRaceHud>[] = [];
    humanCount = 1;

    constructor(
      private readonly deps: {
        physics: { step: () => void };
        scene: { add: (o: unknown) => void; remove: (o: unknown) => void };
        container: HTMLElement;
        gameAudio: { flush: (physics: unknown, now: number) => void; onRespawn: () => void };
        minimap: { show: () => void; hide: () => void; update: (karts: unknown[]) => void };
        results: HTMLElement;
      },
    ) {}

    build(humanCount: number, humanVariants: readonly string[] = []): void {
      this.dispose();
      this.humanCount = humanCount;
      this.views = Array.from({ length: humanCount }, (_, i) =>
        makeView(this.deps.container, i, humanVariants[i]),
      );
      this.rivals = Array.from({ length: TARGET_FIELD - humanCount }, () => ({
        controller: { body: {}, life: 1, inWater: false },
        group: new THREE.Group(),
        speed: 0,
        sync: () => {},
      }));
      this.race = new MockRace(humanCount);
      this.raceHuds = Array.from({ length: humanCount }, () => makeRaceHud(this.deps.container));
      for (const view of this.views) this.deps.scene.add(view.kart.group);
      for (const rival of this.rivals) this.deps.scene.add(rival.group);
      this.placeMinimap();
      this.deps.results.style.display = "none";
    }

    dispose(): void {
      for (const view of this.views) {
        this.deps.scene.remove(view.kart.group);
        view.removeHud();
      }
      for (const rival of this.rivals) this.deps.scene.remove(rival.group);
      for (const hud of this.raceHuds) hud.remove();
      this.views = [];
      this.rivals = [];
      this.raceHuds = [];
    }

    placeMinimap(): void {
      const root = this.deps.container.querySelector<HTMLElement>(".gc-minimap");
      if (!root) return;
      root.style.left = "320px";
      root.style.right = "auto";
    }

    humansMidpoint(): InstanceType<typeof THREE.Vector3> {
      return new THREE.Vector3();
    }

    humanAudioStates(
      driving: boolean,
      inputs: readonly { throttle: number; drift: boolean }[],
    ): Array<{ speed: number; throttle: number; drifting: boolean }> {
      return this.views.map((_, i) => ({
        speed: 0,
        throttle: driving ? (inputs[i]?.throttle ?? 0) : 0,
        drifting: driving ? (inputs[i]?.drift ?? false) : false,
      }));
    }

    rivalAudioStates(driving: boolean): Array<{ speed: number; throttle: number }> {
      return this.rivals.map(() => ({ speed: 0, throttle: driving ? 1 : 0 }));
    }

    listenerTransform(): {
      pos: { x: number; y: number; z: number };
      forward: { x: number; y: number; z: number };
      vel: { x: number; y: number; z: number };
    } {
      return {
        pos: { x: 0, y: 0, z: 0 },
        forward: { x: 0, y: 0, z: -1 },
        vel: { x: 0, y: 0, z: 0 },
      };
    }

    stepWorld(
      _step: number,
      _driving: boolean,
      inputs: readonly { reset?: boolean }[],
      time: number,
    ): void {
      this.deps.physics.step();
      if (inputs.some((input) => input.reset)) this.deps.gameAudio.onRespawn();
      this.deps.gameAudio.flush(this.deps.physics, time);
    }

    respawnAhead(): void {
      this.deps.gameAudio.onRespawn();
    }
  }

  return {
    FieldBuilder,
    rectAspect: (rect: { w: number; h: number }) => rect.w / rect.h,
    SPEED_OFFSET: 14,
    HUD_OFFSET: 58,
    LIFE_BAR_TOP_OFFSET: 108,
  };
});

function variantTuning(id: string): { mass: number; maxSpeed: number } {
  switch (id) {
    case "speed":
      return { mass: 240, maxSpeed: 39 };
    case "grip":
      return { mass: 250, maxSpeed: 30 };
    case "heavy":
      return { mass: 340, maxSpeed: 32 };
    default:
      return { mass: 260, maxSpeed: 34 };
  }
}
