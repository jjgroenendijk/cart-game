import { describe, expect, it, beforeEach, vi, afterEach, type Mock } from "vitest";
import { GameFlow, type FlowHost } from "./GameFlow";
import { AudioManager } from "../audio/AudioManager";
import type { TimeOfDayConfig } from "./timeOfDayConfig";
import type { WeatherChoice } from "./weatherConfig";

/** In-memory localStorage shim; the load* fns read it at GameFlow ctor time. */
function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  } as unknown as Storage;
}

function makeFlow(): { flow: GameFlow; host: FlowHost } {
  const audio = new AudioManager();
  const host = {
    audio,
    race: { startRace: vi.fn() },
    raceHuds: [],
    minimap: { show: vi.fn(), hide: vi.fn() },
    humanCount: 1,
    current: { seed: 1, biome: 0 },
    currentBiome: "temperate",
    builtPicks: [
      { variant: "balanced", colorway: "ember" },
      { variant: "balanced", colorway: "ember" },
    ],
    rebuildWorld: vi.fn(),
    rebuildField: vi.fn(),
    applyTimeOfDay: vi.fn(),
    applyWeatherMode: vi.fn(),
    applyEffectSettings: vi.fn(),
    applyTouchConfig: vi.fn(),
  } as unknown as FlowHost;
  const container = document.createElement("div");
  const flow = new GameFlow({ host, container, audio });
  return { flow, host };
}

const esc = (): KeyboardEvent => new KeyboardEvent("keydown", { code: "Escape" });
const RC: TimeOfDayConfig = { mode: "dynamic", phase: "noon", dayLengthSeconds: 120 };

/** Drive the flow to racing the same way Game.test.ts drives Game. */
function toRacing(flow: GameFlow): void {
  flow.onStart("1P");
  flow.onRaceConfigConfirm(RC);
  flow.onSelectConfirm({
    mode: "1P",
    picks: [
      { variant: "balanced", colorway: "ember" },
      { variant: "balanced", colorway: "ember" },
    ],
  });
  flow.onCountdownDone();
}

describe("GameFlow — Escape routing early-outs", () => {
  beforeEach(() => vi.stubGlobal("localStorage", makeStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("onKeydown(Escape) in select is a no-op (overlay owns Escape)", () => {
    const { flow } = makeFlow();
    flow.onStart("1P");
    flow.onRaceConfigConfirm(RC);
    expect(flow.state).toBe("select");
    flow.onKeydown(esc());
    expect(flow.state).toBe("select"); // onKeydown did not transition
    flow.dispose();
  });

  it("onKeydown(Escape) in raceConfig is a no-op (overlay owns Escape)", () => {
    const { flow } = makeFlow();
    flow.onStart("1P");
    expect(flow.state).toBe("raceConfig");
    flow.onKeydown(esc());
    expect(flow.state).toBe("raceConfig");
    flow.dispose();
  });

  it("onKeydown(Escape) with settings visible -> onSettingsBack", () => {
    const { flow } = makeFlow();
    flow.openSettingsFromMenu();
    expect(flow.settingsOverlay.isVisible).toBe(true);
    flow.onKeydown(esc());
    expect(flow.settingsOverlay.isVisible).toBe(false);
    expect(flow.state).toBe("menu"); // no racing/paused transition
    flow.dispose();
  });

  it("onKeydown(Escape) racing -> paused", () => {
    const { flow } = makeFlow();
    toRacing(flow);
    expect(flow.state).toBe("racing");
    flow.onKeydown(esc());
    expect(flow.state).toBe("paused");
    flow.dispose();
  });

  it("onKeydown(Escape) paused -> racing", () => {
    const { flow } = makeFlow();
    toRacing(flow);
    flow.onPause();
    expect(flow.state).toBe("paused");
    flow.onKeydown(esc());
    expect(flow.state).toBe("racing");
    flow.dispose();
  });
});

describe("GameFlow — settings origin dual-entry", () => {
  beforeEach(() => vi.stubGlobal("localStorage", makeStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("openSettingsFromMenu hides start menu; back re-shows it (menu origin)", () => {
    const { flow } = makeFlow();
    const hideSpy = vi.spyOn(flow.startMenu, "hide");
    const showSpy = vi.spyOn(flow.startMenu, "show");
    flow.openSettingsFromMenu();
    expect(hideSpy).toHaveBeenCalledTimes(1);
    expect(flow.settingsOverlay.isVisible).toBe(true);
    flow.onSettingsBack();
    expect(flow.settingsOverlay.isVisible).toBe(false);
    expect(showSpy).toHaveBeenCalledTimes(1); // re-shown for menu origin
    flow.dispose();
  });

  it("openSettingsFromPause does NOT re-show start menu on back (pause origin)", () => {
    const { flow } = makeFlow();
    toRacing(flow);
    flow.onPause();
    const showSpy = vi.spyOn(flow.startMenu, "show");
    flow.openSettingsFromPause();
    expect(flow.settingsOverlay.isVisible).toBe(true);
    flow.onSettingsBack();
    expect(flow.settingsOverlay.isVisible).toBe(false);
    expect(showSpy).not.toHaveBeenCalled(); // pause origin: menu stays hidden
    flow.dispose();
  });
});

describe("GameFlow — menu audio invariant (engine off + menu music)", () => {
  beforeEach(() => vi.stubGlobal("localStorage", makeStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("onQuit asserts engine off + menu phase", () => {
    const { flow, host } = makeFlow();
    const engineSpy = vi.spyOn(host.audio, "setEngineActive");
    const musicSpy = vi.spyOn(host.audio, "setMusicPhase");
    toRacing(flow); // setEngineActive(true) at countdown-done
    flow.onPause();
    flow.onQuit();
    expect(flow.state).toBe("menu");
    expect(engineSpy).toHaveBeenLastCalledWith(false);
    expect(musicSpy).toHaveBeenLastCalledWith("menu");
    flow.dispose();
  });

  it("onSelectBack asserts engine off + menu phase", () => {
    const { flow, host } = makeFlow();
    const engineSpy = vi.spyOn(host.audio, "setEngineActive");
    const musicSpy = vi.spyOn(host.audio, "setMusicPhase");
    flow.onStart("1P");
    flow.onRaceConfigConfirm(RC);
    flow.onSelectBack();
    expect(flow.state).toBe("menu");
    expect(engineSpy).toHaveBeenLastCalledWith(false);
    expect(musicSpy).toHaveBeenLastCalledWith("menu");
    flow.dispose();
  });

  it("onRaceConfigBack asserts engine off + menu phase", () => {
    const { flow, host } = makeFlow();
    const engineSpy = vi.spyOn(host.audio, "setEngineActive");
    const musicSpy = vi.spyOn(host.audio, "setMusicPhase");
    flow.onStart("1P");
    flow.onRaceConfigBack();
    expect(flow.state).toBe("menu");
    expect(engineSpy).toHaveBeenLastCalledWith(false);
    expect(musicSpy).toHaveBeenLastCalledWith("menu");
    flow.dispose();
  });

  it("first menu gesture resumes audio + sets menu phase, then idles", () => {
    const { flow, host } = makeFlow();
    const resumeSpy = vi.spyOn(host.audio, "resume");
    const musicSpy = vi.spyOn(host.audio, "setMusicPhase");
    expect(flow.state).toBe("menu");
    flow.onFirstGesture();
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(musicSpy).toHaveBeenLastCalledWith("menu");
    flow.onFirstGesture(); // idempotent: no second call
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    flow.dispose();
  });

  it("first gesture is ignored outside menu", () => {
    const { flow, host } = makeFlow();
    const resumeSpy = vi.spyOn(host.audio, "resume");
    toRacing(flow); // onStart calls resume() here
    resumeSpy.mockClear(); // isolate onFirstGesture's own effect
    flow.onFirstGesture();
    expect(resumeSpy).not.toHaveBeenCalled();
    flow.dispose();
  });
});

describe("GameFlow — settings apply (159 effects)", () => {
  beforeEach(() => vi.stubGlobal("localStorage", makeStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("applies effect toggles to the host on boot and on every change", () => {
    const { flow, host } = makeFlow();
    // Boot applySettings already pushed the persisted effects once.
    expect(host.applyEffectSettings).toHaveBeenCalled();
    (host.applyEffectSettings as unknown as Mock).mockClear();
    flow.onSettingsChange({
      masterVolume: 0.5,
      musicVolume: 0.5,
      sfxVolume: 0.5,
      muted: false,
      positionalAudio: true,
      hrtf: false,
      effects: { sunHalo: false, godRays: true, lensFlare: true, groundMist: true },
      tilt: { enabled: true, sensitivity: 1, invert: false },
    });
    expect(host.applyEffectSettings).toHaveBeenCalledWith({
      sunHalo: false,
      godRays: true,
      lensFlare: true,
      groundMist: true,
    });
    flow.dispose();
  });
});

describe("GameFlow — race-config weather pending state", () => {
  beforeEach(() => vi.stubGlobal("localStorage", makeStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("onStart resets pendingWeatherMode to the persisted mode (no stale carryover)", () => {
    const { flow } = makeFlow();
    expect(flow.weatherMode).toBe("auto");
    // Simulate a prior aborted config session that previewed "rain".
    flow.onStart("1P");
    (flow as unknown as { pendingWeatherMode: WeatherChoice }).pendingWeatherMode = "rain";
    flow.onRaceConfigBack(); // reverts live weather; pending left stale pre-fix
    // Reopen: onStart must re-sync pending to the persisted mode.
    flow.onStart("1P");
    const pending = (flow as unknown as { pendingWeatherMode: WeatherChoice }).pendingWeatherMode;
    expect(pending).toBe(flow.weatherMode); // "auto", not stale "rain"
    flow.dispose();
  });
});
