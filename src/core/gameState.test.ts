import { describe, expect, it } from "vitest";
import { transition, type GameEvent, type GameState } from "./gameState";

describe("gameState — transition (006/024)", () => {
  it("menu --openSelect--> select", () => {
    expect(transition("menu", "openSelect")).toBe("select");
  });

  it("select --confirm--> countdown", () => {
    expect(transition("select", "confirm")).toBe("countdown");
  });

  it("select --quit--> menu", () => {
    expect(transition("select", "quit")).toBe("menu");
  });

  it("countdown --countdownDone--> racing", () => {
    expect(transition("countdown", "countdownDone")).toBe("racing");
  });

  it("racing stays racing except pause leaves to paused", () => {
    const stay: GameEvent[] = ["openSelect", "confirm", "countdownDone", "resume", "quit"];
    for (const e of stay) expect(transition("racing", e)).toBe("racing");
    expect(transition("racing", "pause")).toBe("paused");
  });

  it("illegal countdownDone from menu stays in menu", () => {
    expect(transition("menu", "countdownDone")).toBe("menu");
  });

  it("illegal openSelect from countdown stays in countdown", () => {
    expect(transition("countdown", "openSelect")).toBe("countdown");
  });

  it("illegal combos from select leave select unchanged", () => {
    const cases: Array<[GameState, GameEvent]> = [
      ["select", "countdownDone"],
      ["select", "pause"],
      ["select", "resume"],
      ["select", "openSelect"],
    ];
    for (const [s, e] of cases) expect(transition(s, e)).toBe("select");
  });

  it("is deterministic: every legal state/event pair is stable", () => {
    const cases: Array<[GameState, GameEvent, GameState]> = [
      ["menu", "openSelect", "select"],
      ["menu", "confirm", "menu"],
      ["menu", "countdownDone", "menu"],
      ["select", "confirm", "countdown"],
      ["select", "quit", "menu"],
      ["select", "countdownDone", "select"],
      ["select", "pause", "select"],
      ["select", "openSelect", "select"],
      ["countdown", "countdownDone", "racing"],
      ["countdown", "openSelect", "countdown"],
      ["countdown", "confirm", "countdown"],
      ["countdown", "quit", "countdown"],
      ["racing", "openSelect", "racing"],
      ["racing", "confirm", "racing"],
      ["racing", "countdownDone", "racing"],
      ["racing", "resume", "racing"],
      ["racing", "quit", "racing"],
      ["racing", "pause", "paused"],
      ["paused", "resume", "racing"],
      ["paused", "quit", "menu"],
      ["paused", "confirm", "paused"],
      ["paused", "pause", "paused"],
    ];
    for (const [s, e, want] of cases) {
      expect(transition(s, e)).toBe(want);
      expect(transition(s, e)).toBe(want);
    }
  });
});

describe("pause transitions (012)", () => {
  it("racing --pause--> paused", () => {
    expect(transition("racing", "pause")).toBe("paused");
  });

  it("paused --resume--> racing", () => {
    expect(transition("paused", "resume")).toBe("racing");
  });

  it("paused --quit--> menu", () => {
    expect(transition("paused", "quit")).toBe("menu");
  });

  it("illegal combos leave the state unchanged", () => {
    const cases: Array<[GameState, GameEvent, GameState]> = [
      ["menu", "pause", "menu"],
      ["select", "pause", "select"],
      ["countdown", "pause", "countdown"],
      ["racing", "resume", "racing"],
      ["racing", "quit", "racing"],
      ["paused", "confirm", "paused"],
      ["paused", "countdownDone", "paused"],
      ["paused", "pause", "paused"],
    ];
    for (const [s, e, want] of cases) {
      expect(transition(s, e)).toBe(want);
    }
  });
});
