import { describe, expect, it } from "vitest";
import { transition, type GameEvent, type GameState } from "./gameState";

describe("gameState — transition (006)", () => {
  it("menu --start--> countdown", () => {
    expect(transition("menu", "start")).toBe("countdown");
  });

  it("countdown --countdownDone--> racing", () => {
    expect(transition("countdown", "countdownDone")).toBe("racing");
  });

  it("racing is terminal for every event", () => {
    const events: GameEvent[] = ["start", "countdownDone"];
    for (const e of events) expect(transition("racing", e)).toBe("racing");
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
    ];
    for (const [s, e, want] of cases) {
      expect(transition(s, e)).toBe(want);
      expect(transition(s, e)).toBe(want);
    }
  });
});
