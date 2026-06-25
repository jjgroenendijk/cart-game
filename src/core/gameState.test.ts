import { describe, expect, it } from "vitest";
import { transition, type GameEvent, type GameState } from "./gameState";

describe("gameState — transition (006)", () => {
  it("menu --start--> countdown", () => {
    expect(transition("menu", "start")).toBe("countdown");
  });

  it("countdown --countdownDone--> racing", () => {
    expect(transition("countdown", "countdownDone")).toBe("racing");
  });

  it("racing stays racing except pause leaves to paused", () => {
    const stay: GameEvent[] = ["start", "countdownDone", "resume", "quit"];
    for (const e of stay) expect(transition("racing", e)).toBe("racing");
    expect(transition("racing", "pause")).toBe("paused");
  });

  it("illegal countdownDone from menu stays in menu", () => {
    expect(transition("menu", "countdownDone")).toBe("menu");
  });

  it("illegal start from countdown stays in countdown", () => {
    expect(transition("countdown", "start")).toBe("countdown");
  });

  it("is deterministic: every legal state/event pair is stable", () => {
    const cases: Array<[GameState, GameEvent, GameState]> = [
      ["menu", "start", "countdown"],
      ["menu", "countdownDone", "menu"],
      ["countdown", "countdownDone", "racing"],
      ["countdown", "start", "countdown"],
      ["racing", "start", "racing"],
      ["racing", "countdownDone", "racing"],
      ["racing", "resume", "racing"],
      ["racing", "quit", "racing"],
      ["racing", "pause", "paused"],
      ["paused", "resume", "racing"],
      ["paused", "quit", "menu"],
      ["paused", "start", "paused"],
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
      ["countdown", "pause", "countdown"],
      ["racing", "resume", "racing"],
      ["racing", "quit", "racing"],
      ["paused", "start", "paused"],
      ["paused", "countdownDone", "paused"],
      ["paused", "pause", "paused"],
    ];
    for (const [s, e, want] of cases) {
      expect(transition(s, e)).toBe(want);
    }
  });
});
