import { describe, expect, it } from "vitest";
import type { RaceSnapshot } from "../race/raceManager";
import type { PlayerView } from "../core/PlayerView";
import { createResultsEl, ordinal, renderResults } from "./resultsDisplay";

function makeSnap(positions: number[]): RaceSnapshot {
  return {
    phase: "finished",
    timer: 0,
    leaderLap: 0,
    positions,
    order: [],
    progress: [],
  };
}

function makeViews(n: number): PlayerView[] {
  return new Array(n).fill(null) as unknown as PlayerView[];
}

describe("ordinal", () => {
  it("formats 1/2/3 with st/nd/rd", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
  });

  it("uses -th for the teens (11/12/13)", () => {
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
  });

  it("resumes st/nd/rd after the teens", () => {
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(101)).toBe("101st");
    expect(ordinal(112)).toBe("112th");
  });
});

describe("createResultsEl", () => {
  it("returns the .gc-results root", () => {
    const el = createResultsEl();
    expect(el.classList.contains("gc-results")).toBe(true);
  });

  it("root is non-interactive (pointer-events none)", () => {
    const el = createResultsEl();
    expect(el.style.pointerEvents).toBe("none");
  });

  it("contains the FINISH kicker", () => {
    const el = createResultsEl();
    expect(el.textContent).toContain("FINISH");
  });

  it("contains a serif display heading", () => {
    const el = createResultsEl();
    const heading = el.querySelector(".gc-results-heading") as HTMLElement;
    expect(heading).not.toBeNull();
    expect(heading.style.fontFamily).toContain("Georgia");
    expect(el.textContent).toContain("Race");
    expect(el.textContent).toContain("Complete");
  });

  it("has an empty ranking container", () => {
    const el = createResultsEl();
    const rows = el.querySelector(".gc-results-rows") as HTMLElement;
    expect(rows).not.toBeNull();
    expect(rows.children.length).toBe(0);
  });

  it("has four corner-mark brackets on the card", () => {
    const el = createResultsEl();
    const corners = el.querySelectorAll(".gc-results-corner");
    expect(corners.length).toBe(4);
  });
});

describe("renderResults", () => {
  it("builds one telemetry row per human view (2 views)", () => {
    const el = createResultsEl();
    const rows = el.querySelector(".gc-results-rows") as HTMLElement;
    renderResults(el, makeSnap([1, 2]), makeViews(2));
    expect(rows.children.length).toBe(2);
    expect(rows.children[0]!.textContent).toContain("P1");
    expect(rows.children[0]!.textContent).toContain("1st");
    expect(rows.children[1]!.textContent).toContain("P2");
    expect(rows.children[1]!.textContent).toContain("2nd");
  });

  it("handles a single view", () => {
    const el = createResultsEl();
    const rows = el.querySelector(".gc-results-rows") as HTMLElement;
    renderResults(el, makeSnap([1]), makeViews(1));
    expect(rows.children.length).toBe(1);
    expect(rows.children[0]!.textContent).toContain("P1");
    expect(rows.children[0]!.textContent).toContain("1st");
  });

  it("clears the container before rebuilding", () => {
    const el = createResultsEl();
    const rows = el.querySelector(".gc-results-rows") as HTMLElement;
    renderResults(el, makeSnap([1, 2]), makeViews(2));
    expect(rows.children.length).toBe(2);
    renderResults(el, makeSnap([1]), makeViews(1));
    expect(rows.children.length).toBe(1);
  });
});
