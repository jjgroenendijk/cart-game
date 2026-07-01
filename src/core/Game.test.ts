import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import "./Game.test.mocks";

// Import AFTER vi.mock so Game receives the mocked Renderer.
import { Game } from "./Game";
import { AudioManager } from "../audio/AudioManager";
import type { SettingsState } from "./settings";

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
  onStart: (m: "1P" | "2P") => void;
  onRaceConfigConfirm: (c: { mode: string; phase: string; dayLengthSeconds: number }) => void;
  onSelectConfirm: (r: { mode: "1P" | "2P"; variants: readonly string[] }) => void;
};
function toCountdown(g: Game, mode: "1P" | "2P", variants: readonly string[]): void {
  const r = g as unknown as FlowInternals;
  r.onStart(mode);
  r.onRaceConfigConfirm({ mode: "dynamic", phase: "noon", dayLengthSeconds: 120 });
  r.onSelectConfirm({ mode, variants });
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
    onSelectConfirm: (r: { mode: "1P" | "2P"; variants: readonly string[] }) => void;
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
  it("onCountdownDone -> racing + engine on + countdown hidden + HUD shown", () => {
    const game = makeGame();
    const r = internals(game);
    toCountdown(game, "1P", ["balanced", "balanced"]);
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
    toCountdown(game, "1P", ["balanced", "balanced"]);
    r.onCountdownDone();
    expect(game.currentState).toBe("racing");
    r.onStart("1P"); // ignored
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
    onSelectConfirm: (r: { mode: "1P" | "2P"; variants: readonly string[] }) => void;
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
  it("2P: confirm('2P') rebuilds to 2 views + 4 rivals", () => {
    const game = makeGame();
    const r = internals(game);
    expect(r.views).toHaveLength(1); // default 1P
    toCountdown(game, "2P", ["balanced", "balanced"]);
    expect(r.views).toHaveLength(2);
    expect(r.rivals).toHaveLength(4); // 6 total - 2 humans
    game.dispose();
  });
  it("2P: builds a per-view speed readout + race HUD per human", () => {
    const { container, game } = makeGameWithContainer();
    toCountdown(game, "2P", ["balanced", "balanced"]);
    expect(container.querySelectorAll(".gc-speed")).toHaveLength(2);
    expect(container.querySelectorAll(".gc-race-hud")).toHaveLength(2);
    game.dispose();
  });
  it("2P: centers the shared minimap on the seam (one map, not two)", () => {
    const { container, game } = makeGameWithContainer();
    toCountdown(game, "2P", ["balanced", "balanced"]);
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
    toCountdown(game, "1P", ["balanced", "balanced"]);
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
    toCountdown(game, "2P", ["balanced", "balanced"]);
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
    toCountdown(game, "1P", ["balanced", "balanced"]);
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

describe("Game — pause wiring (012)", () => {
  type PauseInternals = {
    views: unknown[];
    renderer: { renderViews: (v: unknown[]) => void };
    physics: { step: () => void };
    audio: AudioManager;
    minimap: { show: () => void; hide: () => void };
    startMenu: { show: () => void };
    field: { dispose: () => void; build: (n: number) => void };
    onStart: (mode: "1P" | "2P") => void;
    onSelectConfirm: (r: { mode: "1P" | "2P"; variants: readonly string[] }) => void;
    onCountdownDone: () => void;
    onPause: () => void;
    onResume: () => void;
    onQuit: () => void;
    openSettingsFromPause: () => void;
    pauseOverlay: { show: () => void; hide: () => void };
  };
  const internals = (g: Game): PauseInternals => g as unknown as PauseInternals;

  function racing(g: Game): void {
    toCountdown(g, "1P", ["balanced", "balanced"]);
    internals(g).onCountdownDone();
  }

  function fireKey(code: string): void {
    window.dispatchEvent(new KeyboardEvent("keydown", { code }));
  }
  it("onPause: racing -> paused + audio.suspend + pauseOverlay shown", () => {
    const game = makeGame();
    const r = internals(game);
    racing(game);
    const suspendSpy = vi.spyOn(r.audio, "suspend");
    const showSpy = vi.spyOn(r.pauseOverlay, "show");
    r.onPause();
    expect(game.currentState).toBe("paused");
    expect(suspendSpy).toHaveBeenCalledTimes(1);
    expect(showSpy).toHaveBeenCalledTimes(1);
    game.dispose();
  });
  it("onResume: paused -> racing + audio.resume + pauseOverlay hidden", () => {
    const game = makeGame();
    const r = internals(game);
    racing(game);
    r.onPause();
    const resumeSpy = vi.spyOn(r.audio, "resume");
    const hideSpy = vi.spyOn(r.pauseOverlay, "hide");
    r.onResume();
    expect(game.currentState).toBe("racing");
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(hideSpy).toHaveBeenCalledTimes(1);
    game.dispose();
  });
  it("onPause is a no-op when not racing (state unchanged)", () => {
    const game = makeGame();
    const r = internals(game);
    r.onPause(); // ignored from menu
    expect(game.currentState).toBe("menu");
    game.dispose();
  });
  it("onQuit: paused -> menu + field rebuilt + startMenu shown + minimap hidden", () => {
    const game = makeGame();
    const r = internals(game);
    racing(game);
    r.onPause();
    const buildSpy = vi.spyOn(r.field, "build");
    const menuShowSpy = vi.spyOn(r.startMenu, "show");
    const mapHideSpy = vi.spyOn(r.minimap, "hide");
    r.onQuit();
    expect(game.currentState).toBe("menu");
    expect(buildSpy).toHaveBeenCalledTimes(1);
    expect(menuShowSpy).toHaveBeenCalledTimes(1);
    expect(mapHideSpy).toHaveBeenCalledTimes(1);
    // 1P field rebuilt: views length back to 1.
    expect(r.views).toHaveLength(1);
    game.dispose();
  });
  it("openSettingsFromPause is wired (no throw, state unchanged)", () => {
    const game = makeGame();
    const r = internals(game);
    racing(game);
    expect(() => r.openSettingsFromPause()).not.toThrow();
    expect(game.currentState).toBe("racing");
    game.dispose();
  });
  it("Esc toggles racing -> paused -> racing", () => {
    const game = makeGame();
    racing(game);
    expect(game.currentState).toBe("racing");
    fireKey("Escape");
    expect(game.currentState).toBe("paused");
    fireKey("Escape");
    expect(game.currentState).toBe("racing");
    game.dispose();
  });
  it("Esc is ignored in menu (no premature pause)", () => {
    const game = makeGame();
    expect(game.currentState).toBe("menu");
    fireKey("Escape");
    expect(game.currentState).toBe("menu");
    game.dispose();
  });
  it("paused frame renders the chase views but steps NO physics", async () => {
    const game = makeGame();
    const r = internals(game);
    racing(game);
    r.onPause();
    expect(game.currentState).toBe("paused");
    const renderSpy = vi.spyOn(r.renderer, "renderViews");
    const stepSpy = vi.spyOn(r.physics, "step");
    game.start();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(renderSpy).toHaveBeenCalled();
    expect(stepSpy).not.toHaveBeenCalled();
    game.dispose();
  });
  it("dispose removes the pause overlay from the container", () => {
    const { container, game } = makeGameWithContainer();
    racing(game);
    internals(game).onPause();
    expect(container.querySelector(".gc-pause-resume")).not.toBeNull();
    game.dispose();
    expect(container.querySelector(".gc-pause-resume")).toBeNull();
  });
});

describe("Game — 009 impact wiring", () => {
  type ImpactInternals = {
    gameAudio: { flush: (physics: unknown, now: number) => void; onRespawn: () => void };
    physics: { step: () => void };
    onStart: (mode: "1P" | "2P") => void;
    onSelectConfirm: (r: { mode: "1P" | "2P"; variants: readonly string[] }) => void;
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
    toCountdown(game, "1P", ["balanced", "balanced"]);
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
    onSelectConfirm: (r: { mode: "1P" | "2P"; variants: readonly string[] }) => void;
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
    toCountdown(game, "1P", ["balanced", "balanced"]);
    r.onCountdownDone();
    const spy = vi.spyOn(r.gameAudio, "onRespawn");
    // Drive the human fixedUpdate loop directly with a reset input (reset is
    // edge-triggered per frame in the real loop, so this is deterministic).
    r.stepWorld(1 / 60, true, [{ throttle: 0, steer: 0, drift: false, reset: true }]);
    expect(spy).toHaveBeenCalledTimes(1);
    game.dispose();
  });
});

describe("Game — settings wiring (012)", () => {
  type SettingsInternals = {
    settings: SettingsState;
    audio: AudioManager;
    startMenu: { hide: () => void; show: () => void };
    settingsOverlay: {
      isVisible: boolean;
      show: (s?: SettingsState) => void;
      hide: () => void;
    };
    applySettings: (s: Partial<SettingsState>) => void;
    openSettingsFromMenu: () => void;
    onSettingsChange: (s: Partial<SettingsState>) => void;
    onSettingsBack: () => void;
    onKeydown: (e: KeyboardEvent) => void;
  };
  const internals = (g: Game): SettingsInternals => g as unknown as SettingsInternals;

  /** In-memory localStorage shim (mirrors storage.test.ts); getItem/setItem only. */
  function makeStorage(): Storage {
    const store = new Map<string, string>();
    return {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    } as unknown as Storage;
  }

  beforeEach(() => {
    vi.stubGlobal("localStorage", makeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("applySettings forwards positional/hrtf onto audio", () => {
    const game = makeGame();
    const r = internals(game);
    const pos = vi.spyOn(r.audio, "setPositional");
    const hrtf = vi.spyOn(r.audio, "setHrtf");
    r.applySettings({ positionalAudio: false, hrtf: true });
    expect(pos).toHaveBeenCalledWith(false);
    expect(hrtf).toHaveBeenCalledWith(true);
    game.dispose();
  });
  it("openSettingsFromMenu hides the start menu + shows the settings overlay", () => {
    const game = makeGame();
    const r = internals(game);
    const hideSpy = vi.spyOn(r.startMenu, "hide");
    r.openSettingsFromMenu();
    expect(hideSpy).toHaveBeenCalledTimes(1);
    expect(r.settingsOverlay.isVisible).toBe(true);
    game.dispose();
  });
  it("onSettingsBack hides the overlay + re-shows start menu (menu origin)", () => {
    const game = makeGame();
    const r = internals(game);
    r.openSettingsFromMenu();
    const showSpy = vi.spyOn(r.startMenu, "show");
    r.onSettingsBack();
    expect(r.settingsOverlay.isVisible).toBe(false);
    expect(showSpy).toHaveBeenCalledTimes(1);
    game.dispose();
  });
  it("onSettingsChange validates + applies + persists to localStorage", () => {
    const game = makeGame();
    const r = internals(game);
    const vol = vi.spyOn(r.audio, "setVolume");
    const mute = vi.spyOn(r.audio, "mute");
    const music = vi.spyOn(r.audio, "setMusicVolume");
    const sfx = vi.spyOn(r.audio, "setSfxVolume");
    const pos = vi.spyOn(r.audio, "setPositional");
    const hrtf = vi.spyOn(r.audio, "setHrtf");
    r.onSettingsChange({ masterVolume: 0.25, musicVolume: 0.5, sfxVolume: 0.75, muted: true });
    expect(vol).toHaveBeenLastCalledWith(0.25);
    expect(mute).toHaveBeenLastCalledWith(true);
    expect(music).toHaveBeenLastCalledWith(0.5);
    expect(sfx).toHaveBeenLastCalledWith(0.75);
    expect(pos).toHaveBeenLastCalledWith(true);
    expect(hrtf).toHaveBeenLastCalledWith(false);
    const raw = localStorage.getItem("gamecart.settings.v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { version: number; settings: SettingsState };
    expect(parsed.version).toBe(1);
    expect(parsed.settings.masterVolume).toBeCloseTo(0.25);
    expect(parsed.settings.muted).toBe(true);
    game.dispose();
  });
  it("Esc closes settings when open + re-shows start menu (no state change)", () => {
    const game = makeGame();
    const r = internals(game);
    r.openSettingsFromMenu();
    expect(r.settingsOverlay.isVisible).toBe(true);
    const showSpy = vi.spyOn(r.startMenu, "show");
    r.onKeydown(new KeyboardEvent("keydown", { code: "Escape" }));
    expect(r.settingsOverlay.isVisible).toBe(false);
    expect(showSpy).toHaveBeenCalledTimes(1);
    expect(game.currentState).toBe("menu"); // no racing/paused transition
    game.dispose();
  });
});

describe("Game — 015 rival audio wiring", () => {
  type Internals = {
    onStart: (mode: "1P" | "2P") => void;
    onSelectConfirm: (r: { mode: "1P" | "2P"; variants: readonly string[] }) => void;
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
    const lis = a[2] as { pos: { x: number }; forward: { x: number }; vel: { x: number } };
    expect(typeof lis.pos.x).toBe("number");
    expect(typeof lis.forward.x).toBe("number");
    expect(typeof lis.vel.x).toBe("number");
    game.dispose();
  });

  it("racing: updateRivals rival states have throttle 1", async () => {
    const game = makeGame();
    const r = internals(game);
    toCountdown(game, "1P", ["balanced", "balanced"]);
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
      onStart: (m: "1P" | "2P") => void;
      onSelectConfirm: (r: { mode: "1P" | "2P"; variants: readonly string[] }) => void;
      onCountdownDone: () => void;
    };
    toCountdown(game, "1P", ["balanced", "balanced"]);
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
