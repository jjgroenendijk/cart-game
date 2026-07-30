import { vi } from "vitest";

// Mock Renderer so Game can construct without WebGL (jsdom has no GL).
vi.mock("./Renderer", async (importActual) => {
  const actual = await importActual<typeof import("./Renderer")>();
  return {
    ...actual,
    Renderer: class {
      scene = { add: () => {}, remove: () => {} };
      domElement = { remove: () => {} };
      setShadowTarget(): void {}
      setQuality(): void {}
      setEffects(): void {}
      render(): void {}
      renderView(): void {}
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
        getPoint: (t: number, out = new THREE.Vector3()) =>
          out.set(t * 1000 + 500, 0, t * 1000 + 500),
      };
      /** 060 minimal track graph stub (minimapShape reads edges). */
      graph = { loopLength: 1000, edges: [] as unknown[] };
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
      /** 202 collider-range pass stub (real impl gates trimesh colliders). */
      updateColliders(): void {}
      /** 206 spawn-prime stub (real impl force-seeds deferred spawn chunks). */
      primeSeed(): void {}
      dispose(): void {}
    },
  };
});

vi.mock("../environment/Environment", async () => {
  const THREE = await import("three");
  return {
    Environment: class {
      group = new THREE.Group();
      /** Last focus XZ passed to update() (for env focus-routing tests). */
      lastFocus: { x: number; z: number } | null = null;
      update(_dt: number, _time: number, focusX = 0, focusZ = 0): void {
        this.lastFocus = { x: focusX, z: focusZ };
      }
      /** 202 collider-range pass stub (real impl gates prop bodies). */
      updateColliders(): void {}
      /** 042: no-op sky reconfig stub (real impl lives in Environment). */
      setTimeOfDay(): void {}
      /** 054: no-op weather mode reconfig stub (real impl in Environment). */
      setWeatherMode(): void {}
      /** 054: safe-default weather snapshot stub (real impl in Environment). */
      get weatherInfo(): { preset: string; level: number; elapsed: number; seed: number } {
        return { preset: "clear", level: 0, elapsed: 0, seed: 0 };
      }
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
        progress: [{ lap: 0 }],
        positions: [1],
        timer: 0,
      };
    }
  }

  function makeView(
    container: HTMLElement,
    variantId = "balanced",
  ): {
    kart: {
      speed: number;
      controller: { life: number; inWater: boolean; tuning: { mass: number; maxSpeed: number } };
      group: InstanceType<typeof THREE.Group>;
      capturePrevPose: () => void;
    };
    chaseCam: { camera: { fov: number }; setAspect: () => void };
    rect: { x: number; y: number; w: number; h: number };
    speedEl: HTMLElement;
    sync: () => void;
    updateCamera: () => void;
    applyLayout: () => void;
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
        capturePrevPose: () => {},
      },
      chaseCam: { camera: { fov: 62 }, setAspect: () => {} },
      rect: { x: 0, y: 0, w: 800, h: 600 },
      speedEl,
      sync: () => {},
      updateCamera: () => {},
      applyLayout: () => {},
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
    applyLayout: () => void;
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
      applyLayout: () => {},
      remove: () => root.remove(),
    };
  }

  class FieldBuilder {
    view: ReturnType<typeof makeView> = null as unknown as ReturnType<typeof makeView>;
    rivals: Array<{
      controller: { body: unknown; life: number; inWater: boolean };
      group: InstanceType<typeof THREE.Group>;
      speed: number;
      sync: () => void;
      capturePrevPose: () => void;
    }> = [];
    race = new MockRace();
    raceHud: ReturnType<typeof makeRaceHud> = null as unknown as ReturnType<typeof makeRaceHud>;

    constructor(
      private readonly deps: {
        physics: { step: () => void };
        scene: { add: (o: unknown) => void; remove: (o: unknown) => void };
        container: HTMLElement;
        gameAudio: {
          flush: (physics: unknown, now: number) => void;
          onRespawn: () => void;
          updateWeather: (info: unknown) => void;
        };
        minimap: { show: () => void; hide: () => void; update: (karts: unknown[]) => void };
        results: HTMLElement;
      },
    ) {}

    build(humanPicks: readonly { variant: string; colorway: string }[] = []): void {
      this.dispose();
      this.view = makeView(this.deps.container, humanPicks[0]?.variant);
      this.rivals = Array.from({ length: TARGET_FIELD - 1 }, () => ({
        controller: { body: {}, life: 1, inWater: false },
        group: new THREE.Group(),
        speed: 0,
        sync: () => {},
        capturePrevPose: () => {},
      }));
      this.race = new MockRace();
      this.raceHud = makeRaceHud(this.deps.container);
      this.deps.scene.add(this.view.kart.group);
      for (const rival of this.rivals) this.deps.scene.add(rival.group);
      this.deps.results.style.display = "none";
    }

    dispose(): void {
      if (this.view) {
        this.deps.scene.remove(this.view.kart.group);
        this.view.removeHud();
      }
      for (const rival of this.rivals) this.deps.scene.remove(rival.group);
      this.raceHud?.remove();
      this.rivals = [];
    }

    updateMinimap(): void {}

    setQuality(): void {}

    humansMidpoint(): InstanceType<typeof THREE.Vector3> {
      return new THREE.Vector3();
    }

    humanAudioStates(
      driving: boolean,
      inputs: readonly { throttle: number; drift: boolean }[],
    ): Array<{ speed: number; throttle: number; drifting: boolean }> {
      return [
        {
          speed: 0,
          throttle: driving ? (inputs[0]?.throttle ?? 0) : 0,
          drifting: driving ? (inputs[0]?.drift ?? false) : false,
        },
      ];
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

    updateVfx(): void {}
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
