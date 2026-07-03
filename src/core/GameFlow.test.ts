import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { GameFlow, type FlowHost } from "./GameFlow";
import { AudioManager } from "../audio/AudioManager";
import type { TimeOfDayConfig } from "./timeOfDayConfig";

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
    currentBiome: "temperate",
    builtVariants: ["balanced", "balanced"],
    rebuildWorld: vi.fn(),
    rebuildField: vi.fn(),
    applyTimeOfDay: vi.fn(),
    applyWeatherMode: vi.fn(),
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
  flow.onSelectConfirm({ mode: "1P", variants: ["balanced", "balanced"] });
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
