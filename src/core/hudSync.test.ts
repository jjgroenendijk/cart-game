// @vitest-environment jsdom
import { describe, expect, it, vi, type Mock } from "vitest";
import {
  updateHudVisibility,
  updateLifeBars,
  updateRaceUi,
  updateSpeedHuds,
  type RaceUiDeps,
} from "./hudSync";
import type { PlayerView } from "./PlayerView";
import type { HudState, RaceHud } from "../ui/RaceHud";
import type { Minimap, MinimapKart } from "../ui/Minimap";
import type { RaceManager } from "../race/raceManager";
import type { Kart } from "../kart/Kart";
import { createResultsEl } from "../ui/resultsDisplay";

/** Minimal fake view exposing only speedEl (for visibility toggling). */
function speedElView(): { view: PlayerView; speedEl: HTMLElement } {
  const speedEl = document.createElement("div");
  return { view: { speedEl } as unknown as PlayerView, speedEl };
}

/** Minimal fake view exposing only kart.speed + setSpeed. */
function speedView(speed: number): { view: PlayerView; setSpeed: Mock } {
  const setSpeed = vi.fn();
  return { view: { kart: { speed }, setSpeed } as unknown as PlayerView, setSpeed };
}

/** Minimal fake view exposing only controller state + setLife. */
function lifeView(life: number, inWater: boolean): { view: PlayerView; setLife: Mock } {
  const setLife = vi.fn();
  return {
    view: {
      kart: { controller: { life, inWater } },
      setLife,
    } as unknown as PlayerView,
    setLife,
  };
}

/** Minimal fake view exposing only kart.group.position (for minimap blips). */
function posView(x: number, z: number): PlayerView {
  return { kart: { group: { position: { x, z } } } } as unknown as PlayerView;
}

/** Minimal fake rival exposing only group.position (for minimap blips). */
function posRival(x: number, z: number): Kart {
  return { group: { position: { x, z } } } as unknown as Kart;
}

interface FakeSnap {
  phase: string;
  progress: Array<{ lap: number }>;
  positions: number[];
  timer: number;
}

/** Minimal fake RaceManager exposing only snapshot/targetLaps/kartCount. */
function fakeRace(snap: FakeSnap, targetLaps = 3, kartCount = 6): RaceManager {
  return {
    targetLaps,
    kartCount,
    snapshot: () => snap,
  } as unknown as RaceManager;
}

describe("updateHudVisibility", () => {
  it("sets speedEl display to block when racing, none otherwise", () => {
    const { view, speedEl } = speedElView();
    updateHudVisibility([view], true);
    expect(speedEl.style.display).toBe("block");
    updateHudVisibility([view], false);
    expect(speedEl.style.display).toBe("none");
  });

  it("toggles every view's speedEl independently", () => {
    const a = speedElView();
    const b = speedElView();
    updateHudVisibility([a.view, b.view], true);
    expect(a.speedEl.style.display).toBe("block");
    expect(b.speedEl.style.display).toBe("block");
  });
});

describe("updateSpeedHuds", () => {
  it("rounds speed*3.6 -> setSpeed", () => {
    const { view, setSpeed } = speedView(10); // 10 m/s -> 36 km/h
    updateSpeedHuds([view]);
    expect(setSpeed).toHaveBeenCalledWith(36);
  });

  it("clamps speed to 999 before scaling", () => {
    const { view, setSpeed } = speedView(1000); // clamp 999 -> 999*3.6=3596.4
    updateSpeedHuds([view]);
    expect(setSpeed).toHaveBeenCalledWith(3596);
  });

  it("clamps negative speed to 0 -> 0 km/h", () => {
    const { view, setSpeed } = speedView(-5);
    updateSpeedHuds([view]);
    expect(setSpeed).toHaveBeenCalledWith(0);
  });
});

describe("updateLifeBars", () => {
  it("calls setLife with controller.life + inWater", () => {
    const { view, setLife } = lifeView(0.5, true);
    updateLifeBars([view]);
    expect(setLife).toHaveBeenCalledWith(0.5, true);
  });

  it("passes dry karts through unchanged", () => {
    const { view, setLife } = lifeView(1, false);
    updateLifeBars([view]);
    expect(setLife).toHaveBeenCalledWith(1, false);
  });
});

describe("updateRaceUi", () => {
  it("builds hudStates with lap=min(progress.lap+1, targetLaps)", () => {
    const hud0 = vi.fn();
    const hud1 = vi.fn();
    const race = fakeRace({
      phase: "racing",
      progress: [{ lap: 1 }, { lap: 5 }], // min(2,3)=2 ; min(6,3)=3
      positions: [1, 2],
      timer: 12.5,
    });
    const deps: RaceUiDeps = {
      views: [posView(0, 0), posView(1, 1)],
      rivals: [],
      raceHuds: [{ update: hud0 } as unknown as RaceHud, { update: hud1 } as unknown as RaceHud],
      race,
      minimap: { update: vi.fn() } as unknown as Minimap,
      resultsEl: document.createElement("div"),
      resultsShown: false,
    };
    updateRaceUi(deps);
    const s0 = hud0.mock.calls[0]![0] as HudState;
    const s1 = hud1.mock.calls[0]![0] as HudState;
    expect(s0.lap).toBe(2);
    expect(s1.lap).toBe(3);
    expect(s0).toMatchObject({ targetLaps: 3, position: 1, totalKarts: 6, timer: 12.5 });
    expect(s1.position).toBe(2);
  });

  it("pushes player (i===0) + non-player + rival blips via minimap.update", () => {
    const mapUpdate = vi.fn();
    const deps: RaceUiDeps = {
      views: [posView(1, 2), posView(3, 4)],
      rivals: [posRival(5, 6), posRival(7, 8)],
      raceHuds: [],
      race: fakeRace({ phase: "racing", progress: [], positions: [], timer: 0 }),
      minimap: { update: mapUpdate } as unknown as Minimap,
      resultsEl: document.createElement("div"),
      resultsShown: false,
    };
    updateRaceUi(deps);
    const blips = mapUpdate.mock.calls[0]![0] as MinimapKart[];
    expect(blips).toEqual([
      { x: 1, z: 2, player: true },
      { x: 3, z: 4, player: false },
      { x: 5, z: 6, player: false },
      { x: 7, z: 8, player: false },
    ]);
  });

  it("reveals results exactly once: first finished sets text + flex, returns true", () => {
    const resultsEl = createResultsEl();
    resultsEl.style.display = "none";
    const race = fakeRace({
      phase: "finished",
      progress: [{ lap: 3 }],
      positions: [1],
      timer: 60,
    });
    const deps: RaceUiDeps = {
      views: [posView(0, 0)],
      rivals: [],
      raceHuds: [{ update: vi.fn() } as unknown as RaceHud],
      race,
      minimap: { update: vi.fn() } as unknown as Minimap,
      resultsEl,
      resultsShown: false,
    };
    const out = updateRaceUi(deps);
    expect(out).toBe(true);
    expect(resultsEl.style.display).toBe("flex");
    expect(resultsEl.textContent).toContain("P1");

    // Second call with resultsShown=true: no re-set of text/display.
    resultsEl.textContent = "STALE";
    const out2 = updateRaceUi({ ...deps, resultsShown: true });
    expect(out2).toBe(true);
    expect(resultsEl.textContent).toBe("STALE");
  });

  it("does not reveal results while still racing (returns prior flag)", () => {
    const resultsEl = document.createElement("div");
    const deps: RaceUiDeps = {
      views: [posView(0, 0)],
      rivals: [],
      raceHuds: [{ update: vi.fn() } as unknown as RaceHud],
      race: fakeRace({ phase: "racing", progress: [{ lap: 0 }], positions: [1], timer: 1 }),
      minimap: { update: vi.fn() } as unknown as Minimap,
      resultsEl,
      resultsShown: false,
    };
    const out = updateRaceUi(deps);
    expect(out).toBe(false);
    expect(resultsEl.style.display).toBe("");
    expect(resultsEl.textContent).toBe("");
  });
});
