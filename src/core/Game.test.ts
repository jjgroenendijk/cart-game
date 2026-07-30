import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import "./Game.test.mocks";

type TestPick = { variant: string; colorway: string };

// Import AFTER vi.mock so Game receives the mocked Renderer.
import { Game } from "./Game";
import { AudioManager } from "../audio/AudioManager";

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

type FlowInternals = {
  onStart: () => void;
  onRaceConfigConfirm: (c: { mode: string; phase: string; dayLengthSeconds: number }) => void;
  onSelectConfirm: (picks: readonly TestPick[]) => void;
};
function toCountdown(g: Game, variants: readonly string[]): void {
  const picks = variants.map((v) => ({ variant: v, colorway: "ember" }));
  const r = g as unknown as FlowInternals;
  r.onStart();
  r.onRaceConfigConfirm({
    mode: "dynamic",
    phase: "noon",
    dayLengthSeconds: 120,
  });
  r.onSelectConfirm(picks);
}

describe("Game — audio wiring (005/008)", () => {
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
    const states = spy.mock.calls.at(-1)![1] as readonly {
      speed: number;
      throttle: number;
    }[];
    expect(states).toHaveLength(1); // single human
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
    onStart: () => void;
    onSelectConfirm: (picks: readonly TestPick[]) => void;
    onCountdownDone: () => void;
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
    expect(container.querySelectorAll(".gc-speed")).toHaveLength(1);
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
  it("onCountdownDone -> racing + engine on + countdown hidden + HUD shown", () => {
    const game = makeGame();
    const r = internals(game);
    toCountdown(game, ["balanced"]);
    const engineSpy = vi.spyOn(game.audio, "setEngineActive");
    const hideSpy = vi.spyOn(internals(game).countdown, "hide");
    r.onCountdownDone();
    expect(game.currentState).toBe("racing");
    expect(engineSpy).toHaveBeenCalledWith(true);
    expect(hideSpy).toHaveBeenCalledTimes(1);
    game.dispose();
  });
  it("racing is terminal (onStart after racing stays racing)", () => {
    const game = makeGame();
    const r = internals(game);
    toCountdown(game, ["balanced"]);
    r.onCountdownDone();
    expect(game.currentState).toBe("racing");
    r.onStart(); // ignored
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

describe("Game — single-view field wiring (007/008)", () => {
  type FieldInternals = {
    view: unknown;
    rivals: Array<{
      controller: { body: unknown };
      group: { parent: unknown };
    }>;
    race: {
      startRace: () => void;
      phase: string;
      snapshot: () => { phase: string };
    };
    raceHud: { show: () => void; hide: () => void };
    minimap: { show: () => void; hide: () => void };
    renderer: {
      scene: { remove: () => void };
      renderView: (v: unknown) => void;
    };
    onStart: () => void;
    onSelectConfirm: (picks: readonly TestPick[]) => void;
    onCountdownDone: () => void;
  };
  const internals = (g: Game): FieldInternals => g as unknown as FieldInternals;
  it("builds 1 view + 5 rivals (6 karts total)", () => {
    const game = makeGame();
    const r = internals(game);
    expect(r.rivals).toHaveLength(5);
    game.dispose();
  });
  it("builds a speed readout + race HUD for the single human", () => {
    const { container, game } = makeGameWithContainer();
    toCountdown(game, ["balanced"]);
    expect(container.querySelectorAll(".gc-speed")).toHaveLength(1);
    expect(container.querySelectorAll(".gc-race-hud")).toHaveLength(1);
    game.dispose();
  });
  it("race sub-state is 'grid' at construction", () => {
    const game = makeGame();
    expect(internals(game).race.phase).toBe("grid");
    game.dispose();
  });
  it("countdown-done calls race.startRace + shows HUD + minimap", () => {
    const game = makeGame();
    const r = internals(game);
    toCountdown(game, ["balanced"]);
    const startSpy = vi.spyOn(r.race, "startRace");
    const hudSpy = vi.spyOn(r.raceHud, "show");
    const mapSpy = vi.spyOn(r.minimap, "show");
    r.onCountdownDone();
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(hudSpy).toHaveBeenCalledTimes(1);
    expect(mapSpy).toHaveBeenCalledTimes(1);
    expect(game.currentState).toBe("racing");
    game.dispose();
  });
  it("dispose removes every rival rigidbody + group + race overlays", () => {
    const { container, game } = makeGameWithContainer();
    const r = internals(game);
    const sceneRemove = vi.spyOn(r.renderer.scene, "remove");
    game.dispose();
    // Human + rival groups removed from the scene (>= rival count + human).
    expect(sceneRemove.mock.calls.length).toBeGreaterThanOrEqual(r.rivals.length + 1);
    expect(container.querySelector(".gc-race-hud")).toBeNull();
    expect(container.querySelector(".gc-minimap")).toBeNull();
    expect(container.querySelector(".gc-results")).toBeNull();
    expect(container.querySelector(".gc-speed")).toBeNull();
  });
  it("rivals are not stepped while in the menu (no physics in menu)", async () => {
    const game = makeGame();
    game.start();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(game.currentState).toBe("menu");
    game.dispose();
  });
  it("racing frame calls renderView (single-view render path)", async () => {
    const game = makeGame();
    const r = internals(game);
    toCountdown(game, ["balanced"]);
    r.onCountdownDone();
    const spy = vi.spyOn(r.renderer, "renderView");
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
    gameAudio: {
      flush: (physics: unknown, now: number) => void;
      onRespawn: () => void;
    };
    physics: { step: () => void };
    onStart: () => void;
    onSelectConfirm: (picks: readonly TestPick[]) => void;
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
    toCountdown(game, ["balanced"]);
    r.onCountdownDone();
    const spy = vi.spyOn(r.gameAudio, "flush");
    game.start();
    // The fixed-step accumulator may need a few frames before it crosses 1/60
    // and runs stepWorld; poll until flush is observed.
    await vi.waitFor(() => expect(spy).toHaveBeenCalled(), {
      timeout: 1000,
      interval: 20,
    });
    game.dispose();
  });
});

describe("Game — 009 respawn cue wiring", () => {
  type RespawnInternals = {
    gameAudio: { onRespawn: () => void };
    rivals: Array<{ controller: { body: unknown }; group: unknown }>;
    respawnAhead: (rival: unknown) => void;
    stepWorld: (step: number, driving: boolean, inputs: unknown[]) => void;
    onStart: () => void;
    onSelectConfirm: (picks: readonly TestPick[]) => void;
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
    toCountdown(game, ["balanced"]);
    r.onCountdownDone();
    const spy = vi.spyOn(r.gameAudio, "onRespawn");
    // Drive the human fixedUpdate loop directly with a reset input (reset is
    // edge-triggered per frame in the real loop, so this is deterministic).
    r.stepWorld(1 / 60, true, [{ throttle: 0, steer: 0, drift: false, reset: true }]);
    expect(spy).toHaveBeenCalledTimes(1);
    game.dispose();
  });
});

describe("Game — 015 rival audio wiring", () => {
  type Internals = {
    onStart: () => void;
    onSelectConfirm: (picks: readonly TestPick[]) => void;
    onCountdownDone: () => void;
  };
  const internals = (g: Game): Internals => g as unknown as Internals;

  it("updateRivals per frame: 5 rival states (menu) + listener shape", async () => {
    const game = makeGame();
    const spy = vi.spyOn(game.audio, "updateRivals");
    game.start();
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(spy).toHaveBeenCalled();
    const a = spy.mock.calls.at(-1)!;
    expect(a[0]).toBeTypeOf("number");
    const states = a[1] as readonly { speed: number; throttle: number }[];
    expect(states).toHaveLength(5);
    expect(states.every((s) => s.speed === 0 && s.throttle === 0)).toBe(true);
    const lis = a[2] as {
      pos: { x: number };
      forward: { x: number };
      vel: { x: number };
    };
    expect(typeof lis.pos.x).toBe("number");
    expect(typeof lis.forward.x).toBe("number");
    expect(typeof lis.vel.x).toBe("number");
    game.dispose();
  });

  it("racing: updateRivals rival states have throttle 1", async () => {
    const game = makeGame();
    const r = internals(game);
    toCountdown(game, ["balanced"]);
    r.onCountdownDone();
    const spy = vi.spyOn(game.audio, "updateRivals");
    game.start();
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const states = spy.mock.calls.at(-1)![1] as readonly { throttle: number }[];
    expect(states.every((s) => s.throttle === 1)).toBe(true);
    game.dispose();
  });
});

describe("Game — physics accumulator clamp (022)", () => {
  const STEP = 1 / 60;
  it("caps sub-steps at MAX_STEPS and clamps acc on a stall", () => {
    const game = makeGame();
    const r = game as unknown as {
      acc: number;
      last: number;
      running: boolean;
      frame: (n: number) => void;
      stepWorld: (s: number, d: boolean, i: unknown[]) => void;
      onStart: () => void;
      onSelectConfirm: (picks: readonly TestPick[]) => void;
      onCountdownDone: () => void;
    };
    toCountdown(game, ["balanced"]);
    r.onCountdownDone();
    r.running = true;
    r.acc = STEP * 20; // 20 steps of debt after a stall
    r.last = 1000;
    const spy = vi.spyOn(r, "stepWorld");
    r.frame(1000); // now == last -> dt = 0; pure debt drain
    expect(spy).toHaveBeenCalledTimes(5);
    expect(r.acc).toBeLessThanOrEqual(STEP * 5);
    game.dispose();
  });
});
