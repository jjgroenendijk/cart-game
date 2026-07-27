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
    r.onSettingsChange({
      masterVolume: 0.25,
      musicVolume: 0.5,
      sfxVolume: 0.75,
      muted: true,
    });
    expect(vol).toHaveBeenLastCalledWith(0.25);
    expect(mute).toHaveBeenLastCalledWith(true);
    expect(music).toHaveBeenLastCalledWith(0.5);
    expect(sfx).toHaveBeenLastCalledWith(0.75);
    expect(pos).toHaveBeenLastCalledWith(true);
    expect(hrtf).toHaveBeenLastCalledWith(false);
    const raw = localStorage.getItem("gamecart.settings.v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as {
      version: number;
      settings: SettingsState;
    };
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
