import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import "./Game.test.mocks";

// Import AFTER vi.mock so Game receives the mocked Renderer.
import { Game } from "./Game";
import { AudioManager } from "../audio/AudioManager";

type SelectResult = {
  mode: "1P" | "2P";
  picks: readonly { variant: string; colorway: string }[];
};

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

function makeGameWithContainer(): { container: HTMLElement; game: Game } {
  const container = document.createElement("div");
  const game = new Game(container);
  return { container, game };
}

type FlowInternals = {
  onStart: (m: "1P" | "2P") => void;
  onRaceConfigConfirm: (c: { mode: string; phase: string; dayLengthSeconds: number }) => void;
  onSelectConfirm: (r: SelectResult) => void;
};
function toCountdown(g: Game, mode: "1P" | "2P", variants: readonly string[]): void {
  const picks = variants.map((v) => ({ variant: v, colorway: "ember" }));
  const r = g as unknown as FlowInternals;
  r.onStart(mode);
  r.onRaceConfigConfirm({
    mode: "dynamic",
    phase: "noon",
    dayLengthSeconds: 120,
  });
  r.onSelectConfirm({ mode, picks });
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
    onSelectConfirm: (r: SelectResult) => void;
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
