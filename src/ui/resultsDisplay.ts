/**
 * Results overlay DOM builder + post-race ranking renderer. Pure DOM/string
 * helpers (no `this`, no Game state); extracted from Game to free the
 * 600-line cap. Editorial system (158): FINISH kicker + serif display
 * heading + per-player telemetry rows + corner brackets, composed from
 * menuStyles.ts primitives. createResultsEl() builds the shell (argless,
 * Game.ts untouched); renderResults() fills the ranking container.
 */

import type { PlayerView } from "../core/PlayerView";
import type { RaceManager } from "../race/raceManager";
import {
  HAIRLINE,
  MENU_ACCENT,
  PANEL_INK,
  cornerMark,
  displayAccent,
  displayHeading,
  hairlineRule,
  kickerLabel,
  kickerRow,
  telemetryKey,
  telemetryRow,
  telemetryValue,
} from "./menuStyles";

const ROOT_STYLE = [
  "position:absolute",
  "inset:0",
  "z-index:10",
  "display:flex",
  "align-items:center",
  "justify-content:center",
  "pointer-events:none",
].join(";");

const CARD_STYLE = [
  "position:relative",
  "display:flex",
  "flex-direction:column",
  "align-items:center",
  "gap:14px",
  "width:min(420px,86vw)",
  "padding:32px 28px",
  `background:${PANEL_INK}`,
  `border:1px solid ${HAIRLINE}`,
  "text-align:center",
  "pointer-events:none",
].join(";");

const HEADING_STYLE = [displayHeading(), "text-shadow:0 4px 18px rgba(0,0,0,0.85)"].join(";");

const ACCENT_STYLE = [displayAccent(), `color:${MENU_ACCENT}`].join(";");

const ROWS_STYLE = ["display:flex", "flex-direction:column", "width:100%"].join(";");

const CORNERS = ["tl", "tr", "bl", "br"] as const;

/** Build the (hidden) results overlay element. Pure DOM; caller appends/shows. */
export function createResultsEl(): HTMLElement {
  const el = document.createElement("div");
  el.className = "gc-results";
  el.style.cssText = ROOT_STYLE;

  const card = document.createElement("div");
  card.className = "gc-results-card";
  card.style.cssText = CARD_STYLE;
  el.appendChild(card);

  const kicker = document.createElement("div");
  kicker.className = "gc-results-kicker";
  kicker.style.cssText = kickerRow();

  const rule = document.createElement("div");
  rule.style.cssText = hairlineRule(28);
  kicker.appendChild(rule);

  const label = document.createElement("span");
  label.textContent = "FINISH";
  label.style.cssText = kickerLabel();
  kicker.appendChild(label);
  card.appendChild(kicker);

  const heading = document.createElement("div");
  heading.className = "gc-results-heading";
  heading.style.cssText = HEADING_STYLE;
  const accent = document.createElement("span");
  accent.textContent = "Complete";
  accent.style.cssText = ACCENT_STYLE;
  heading.append("Race ", accent);
  card.appendChild(heading);

  const rows = document.createElement("div");
  rows.className = "gc-results-rows";
  rows.style.cssText = ROWS_STYLE;
  card.appendChild(rows);

  for (const corner of CORNERS) {
    const mark = document.createElement("div");
    mark.className = "gc-results-corner";
    mark.style.cssText = cornerMark(corner);
    card.appendChild(mark);
  }

  return el;
}

/**
 * Fill the ranking container inside `el` with one telemetry row (P1 +
 * ordinal of snap.positions[0]). Reads only `snap.positions[0]`. Safe to call
 * repeatedly; clears + rebuilds the container. Population is one-shot
 * (guarded by hudSync's resultsShown).
 */
export function renderResults(
  el: HTMLElement,
  snap: ReturnType<RaceManager["snapshot"]>,
  view: PlayerView,
): void {
  void view;
  const container = el.querySelector(".gc-results-rows");
  if (!(container instanceof HTMLElement)) return;
  container.replaceChildren();
  const pos = snap.positions[0]!;
  const row = document.createElement("div");
  row.style.cssText = telemetryRow();

  const key = document.createElement("span");
  key.textContent = "P1";
  key.style.cssText = telemetryKey();

  const value = document.createElement("span");
  value.textContent = ordinal(pos);
  value.style.cssText = telemetryValue();

  row.appendChild(key);
  row.appendChild(value);
  container.appendChild(row);
}

/** 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 11 -> "11th", 12 -> "12th". Pure. */
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}
