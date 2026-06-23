import { describe, expect, it, beforeAll, beforeEach, vi, afterEach } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";

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

// Import AFTER vi.mock so Game receives the mocked Renderer.
import { Game } from "./Game";
import { AudioManager } from "../audio/AudioManager";

let ready = false;
beforeAll(async () => {
  await RAPIER.init();
  ready = true;
});

beforeEach(() => {
  // jsdom has no 2D canvas (no `canvas` dep); stub getContext so the Minimap
  // built inside Game exercises its null-guard path without the log noise.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeGame(): Game {
  const container = document.createElement("div");
  return new Game(container);
}

describe("Game — audio wiring (005/008)", () => {
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

  it("audio.updatePlayers is called per frame with the human signals", async () => {
    const game = makeGame();
    const spy = vi.spyOn(game.audio, "updatePlayers");
    game.start();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(spy).toHaveBeenCalled();
    const states = spy.mock.calls.at(-1)![1] as readonly { speed: number; throttle: number }[];
    expect(states).toHaveLength(1); // 1P
    expect(states[0]!.throttle).toBe(0); // no input held
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
    onStart: (mode: "1P" | "2P") => void;
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

  it("builds a per-view speed readout (.gc-speed)", () => {
    const { container } = makeGameWithContainer();
    expect(container.querySelectorAll(".gc-speed")).toHaveLength(1); // 1P
    expect(container.querySelector(".gc-speed")?.textContent).toContain("km/h");
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
    internals(game).onStart("1P");
    expect(game.currentState).toBe("countdown");
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(engineSpy).toHaveBeenCalledWith(false);
    expect(hideSpy).toHaveBeenCalledTimes(1);
    game.dispose();
  });

  it("onCountdownDone -> racing + engine on + countdown hidden + HUD shown", () => {
    const game = makeGame();
    internals(game).onStart("1P"); // menu -> countdown
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
    internals(game).onStart("1P");
    internals(game).onCountdownDone();
    expect(game.currentState).toBe("racing");
    internals(game).onStart("1P"); // ignored
    expect(game.currentState).toBe("racing");
    game.dispose();
  });

  it("dispose detaches StartMenu + Countdown + speed HUD from the container", () => {
    const { container, game } = makeGameWithContainer();
    expect(container.children.length).toBeGreaterThan(0);
    game.dispose();
    expect(container.children).toHaveLength(0);
  });
});

describe("Game — 1P/2P field wiring (007/008)", () => {
  type FieldInternals = {
    views: unknown[];
    rivals: Array<{ controller: { body: unknown }; group: { parent: unknown } }>;
    race: { startRace: () => void; phase: string; snapshot: () => { phase: string } };
    raceHuds: Array<{ show: () => void; hide: () => void }>;
    minimap: { show: () => void; hide: () => void };
    renderer: { scene: { remove: () => void }; renderViews: (v: unknown[]) => void };
    onStart: (mode: "1P" | "2P") => void;
    onCountdownDone: () => void;
  };
  const internals = (g: Game): FieldInternals => g as unknown as FieldInternals;

  it("1P: builds 1 view + 5 rivals (6 karts total)", () => {
    const game = makeGame();
    const r = internals(game);
    expect(r.views).toHaveLength(1);
    expect(r.rivals).toHaveLength(5);
    game.dispose();
  });

  it("2P: onStart('2P') rebuilds to 2 views + 4 rivals", () => {
    const game = makeGame();
    const r = internals(game);
    expect(r.views).toHaveLength(1); // default 1P
    r.onStart("2P");
    expect(r.views).toHaveLength(2);
    expect(r.rivals).toHaveLength(4); // 6 total - 2 humans
    game.dispose();
  });

  it("2P: builds a per-view speed readout + race HUD per human", () => {
    const { container, game } = makeGameWithContainer();
    internals(game).onStart("2P");
    expect(container.querySelectorAll(".gc-speed")).toHaveLength(2);
    expect(container.querySelectorAll(".gc-race-hud")).toHaveLength(2);
    game.dispose();
  });

  it("2P: centers the shared minimap on the seam (one map, not two)", () => {
    const { container, game } = makeGameWithContainer();
    internals(game).onStart("2P");
    const maps = container.querySelectorAll(".gc-minimap");
    expect(maps).toHaveLength(1); // shared, never duplicated
    const root = maps[0] as HTMLElement;
    expect(root.style.left).not.toBe(""); // place() set an explicit left
    expect(root.style.right).toBe("auto");
    game.dispose();
  });

  it("race sub-state is 'grid' at construction", () => {
    const game = makeGame();
    expect(internals(game).race.phase).toBe("grid");
    game.dispose();
  });

  it("countdown-done calls race.startRace + shows HUDs + minimap", () => {
    const game = makeGame();
    const r = internals(game);
    r.onStart("1P");
    const startSpy = vi.spyOn(r.race, "startRace");
    const hudSpy = vi.spyOn(r.raceHuds[0]!, "show");
    const mapSpy = vi.spyOn(r.minimap, "show");
    r.onCountdownDone();
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(hudSpy).toHaveBeenCalledTimes(1);
    expect(mapSpy).toHaveBeenCalledTimes(1);
    expect(game.currentState).toBe("racing");
    game.dispose();
  });

  it("does NOT modify 006's gameState.ts contract (racing is terminal)", () => {
    const game = makeGame();
    internals(game).onStart("1P");
    internals(game).onCountdownDone();
    expect(game.currentState).toBe("racing");
    internals(game).onStart("1P"); // ignored
    expect(game.currentState).toBe("racing");
    game.dispose();
  });

  it("1P dispose removes every rival rigidbody + group + race overlays", () => {
    const { container, game } = makeGameWithContainer();
    const r = internals(game);
    const sceneRemove = vi.spyOn(r.renderer.scene, "remove");
    game.dispose();
    // Human + rival groups removed from the scene (>= rival count + humans).
    expect(sceneRemove.mock.calls.length).toBeGreaterThanOrEqual(r.rivals.length + 1);
    expect(container.querySelector(".gc-race-hud")).toBeNull();
    expect(container.querySelector(".gc-minimap")).toBeNull();
    expect(container.querySelector(".gc-results")).toBeNull();
    expect(container.querySelector(".gc-speed")).toBeNull();
  });

  it("2P dispose removes both humans' groups + bodies + HUDs", () => {
    const { container, game } = makeGameWithContainer();
    const r = internals(game);
    r.onStart("2P");
    const sceneRemove = vi.spyOn(r.renderer.scene, "remove");
    game.dispose();
    // 2 humans + 4 rivals = 6 karts removed from the scene.
    expect(sceneRemove.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(container.querySelectorAll(".gc-speed")).toHaveLength(0);
    expect(container.querySelectorAll(".gc-race-hud")).toHaveLength(0);
  });

  it("rivals are not stepped while in the menu (no physics in menu)", async () => {
    const game = makeGame();
    game.start();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(game.currentState).toBe("menu");
    game.dispose();
  });

  it("racing frame calls renderViews (multi-view render path)", async () => {
    const game = makeGame();
    const r = internals(game);
    r.onStart("1P");
    r.onCountdownDone();
    const spy = vi.spyOn(r.renderer, "renderViews");
    game.start();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(spy).toHaveBeenCalled();
    game.dispose();
  });
});

function makeGameWithContainer(): { container: HTMLElement; game: Game } {
  const container = document.createElement("div");
  const game = new Game(container);
  return { container, game };
}

describe("Game — 009 impact wiring", () => {
  type ImpactInternals = {
    gameAudio: { flush: (physics: unknown, now: number) => void; onRespawn: () => void };
    physics: { step: () => void };
    onStart: (mode: "1P" | "2P") => void;
    onCountdownDone: () => void;
  };
  const internals = (g: Game): ImpactInternals => g as unknown as ImpactInternals;

  it("constructs the GameAudioDriver (gameAudio present)", () => {
    const game = makeGame();
    expect(internals(game).gameAudio).toBeTruthy();
    game.dispose();
  });

  it("flush runs each racing sub-step (drains after physics.step)", async () => {
    const game = makeGame();
    const r = internals(game);
    r.onStart("1P");
    r.onCountdownDone();
    const spy = vi.spyOn(r.gameAudio, "flush");
    game.start();
    // The fixed-step accumulator may need a few frames before it crosses 1/60
    // and runs stepWorld; poll until flush is observed.
    await vi.waitFor(() => expect(spy).toHaveBeenCalled(), { timeout: 1000, interval: 20 });
    game.dispose();
  });
});

describe("Game — 009 respawn cue wiring", () => {
  type RespawnInternals = {
    gameAudio: { onRespawn: () => void };
    rivals: Array<{ controller: { body: unknown }; group: unknown }>;
    respawnAhead: (rival: unknown) => void;
    stepWorld: (step: number, driving: boolean, inputs: unknown[]) => void;
    onStart: (mode: "1P" | "2P") => void;
    onCountdownDone: () => void;
  };
  const internals = (g: Game): RespawnInternals => g as unknown as RespawnInternals;

  it("rival respawnAhead fires the respawn cue once", () => {
    const game = makeGame();
    const r = internals(game);
    const spy = vi.spyOn(r.gameAudio, "onRespawn");
    r.respawnAhead(r.rivals[0]!);
    expect(spy).toHaveBeenCalledTimes(1);
    game.dispose();
  });

  it("human R/reset during racing fires the respawn cue", () => {
    const game = makeGame();
    const r = internals(game);
    r.onStart("1P");
    r.onCountdownDone();
    const spy = vi.spyOn(r.gameAudio, "onRespawn");
    // Drive the human fixedUpdate loop directly with a reset input (reset is
    // edge-triggered per frame in the real loop, so this is deterministic).
    r.stepWorld(1 / 60, true, [{ throttle: 0, steer: 0, drift: false, reset: true }]);
    expect(spy).toHaveBeenCalledTimes(1);
    game.dispose();
  });
});
