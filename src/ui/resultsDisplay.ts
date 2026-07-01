/**
 * Results overlay DOM builder + post-race results text. Pure DOM/string
 * helpers (no `this`, no Game state); extracted from Game to free the
 * 600-line cap. Logic byte-identical; Game delegates.
 */

import type { PlayerView } from "../core/PlayerView";
import type { RaceManager } from "../race/raceManager";

/** Build the (hidden) results overlay element. Pure DOM; caller appends/shows. */
export function createResultsEl(): HTMLElement {
  const el = document.createElement("div");
  el.className = "gc-results";
  el.style.cssText =
    "position:absolute;inset:0;z-index:10;display:flex;align-items:center;" +
    "justify-content:center;pointer-events:none;font-family:system-ui,sans-serif;" +
    "font-weight:800;font-size:clamp(28px,5vw,56px);color:#fff;" +
    "text-shadow:0 4px 18px rgba(0,0,0,0.85);text-align:center";
  return el;
}

/**
 * Build the results string for every human view, e.g. "P1: 1st   P2: 2nd".
 * Reads only the per-view position from the snapshot. Pure.
 */
export function resultsText(
  snap: ReturnType<RaceManager["snapshot"]>,
  views: PlayerView[],
): string {
  const parts = views.map((_, i) => {
    const pos = snap.positions[i]!;
    return `P${i + 1}: ${ordinal(pos)}`;
  });
  return parts.join("   ");
}

/** 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 11 -> "11th", 12 -> "12th". Pure. */
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}
