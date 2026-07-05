/**
 * 072 start-menu presentation: the cssText constants + copy for the field-
 * journal layout, split out of StartMenu.ts to keep that file behavior-focused
 * (and under the 600-line cap). Pure strings only — no DOM — so the overlay
 * keeps its plain-element + cssText pattern and stays jsdom-testable.
 *
 * Corner-anchored asymmetry (biome-neutral; per-biome tint is 073): identity
 * top-left, telemetry top-right, hints bottom-right, and the interactive
 * console bottom-left over the live 3D scene. Console controls are transparent
 * text buttons — no fill until hover — with sharp corners and hairline
 * dividers, matching the editorial "field notes" language.
 */

import type { GameMode } from "./StartMenu";

/** Human-facing mode labels, indexed like MODE_VALUES in StartMenu. */
export const MODE_LABELS = ["1 PLAYER", "2 PLAYERS"];

/** Poetic masthead meta line under the identity block. */
export const META_LINE = "Every seed forges a new circuit. Choose a world, take the wheel.";

/** Controls list for the given mode (P2 arrows row appears only in 2P). */
export function controlsHtml(mode: GameMode): string {
  if (mode === "2P") {
    return [
      "<b>P1: WASD</b> &mdash; drive",
      "<b>Space</b> &mdash; drift (P1)",
      "<b>P2: Arrows</b> &mdash; drive",
      "<b>ShiftRight / Enter</b> &mdash; drift (P2)",
      "<b>R</b> / <b>Slash</b> &mdash; reset",
      "<b>Gamepad</b> also supported",
    ].join("<br>");
  }
  return [
    "<b>WASD / Arrows</b> &mdash; drive",
    "<b>Space</b> &mdash; drift",
    "<b>S</b> &mdash; brake / reverse",
    "<b>R</b> &mdash; reset kart",
    "<b>Gamepad</b> also supported",
  ].join("<br>");
}

// z-index 10 mirrors #loading (index.html) so the menu sits above the canvas
// at the same stacking level as the (now hidden) loading veil. The overlay is
// a full-bleed positioning context: every content block is absolutely anchored
// to a corner, so the middle stays clear for the scene. display:flex is kept
// only so show() can restore it (tests + GameFlow rely on the "flex" value);
// nothing flows through it since all children are absolute. pointer-events:none
// lets drags reach the canvas (orbit the preview); the console opts back in.
// overflow:hidden clips the grain + vignette.
export const ROOT_STYLE = [
  "position:absolute",
  "inset:0",
  "z-index:10",
  "overflow:hidden",
  "display:flex",
  "font-family:system-ui,sans-serif",
  "color:#eef2f7",
  "pointer-events:none",
  "text-shadow:0 2px 12px rgba(0,0,0,0.7)",
].join(";");

// Shared corner insets: clamp so the chrome breathes on large screens but hugs
// the edges on small ones.
const EDGE_V = "clamp(16px,4vh,44px)";
const EDGE_H = "clamp(16px,4vw,52px)";

// Top-left identity column: kicker + serif masthead + hairline + meta.
export const IDENTITY_STYLE = [
  "position:absolute",
  `top:${EDGE_V}`,
  `left:${EDGE_H}`,
  "display:flex",
  "flex-direction:column",
  "align-items:flex-start",
  "gap:12px",
  "max-width:min(48vw,460px)",
  "text-align:left",
  "pointer-events:none",
].join(";");

// Editorial serif masthead (072): displayHeading() + extra uppercase tracking.
// "CART" is the italic accent span. Keyframe-free — the arcade motifs are gone.
export const TITLE_EXTRA = "letter-spacing:0.12em";

export const META_STYLE = [
  "margin:0",
  "font-size:12px",
  "line-height:1.6",
  "letter-spacing:0.03em",
  "color:rgba(238,242,247,0.62)",
  "max-width:340px",
].join(";");

// Read-only scene telemetry, top-right, right-aligned. Non-interactive.
export const TELEMETRY_STYLE = [
  "position:absolute",
  `top:${EDGE_V}`,
  `right:${EDGE_H}`,
  "display:flex",
  "flex-direction:column",
  "align-items:stretch",
  "gap:2px",
  "min-width:160px",
  "pointer-events:none",
  "text-align:right",
].join(";");

export const TELEMETRY_HEAD_STYLE = ["margin-bottom:4px", "text-align:right"].join(";");

// Bottom-right hints: the drive-controls list, right-aligned + muted.
export const HINTS_STYLE = [
  "position:absolute",
  `bottom:${EDGE_V}`,
  `right:${EDGE_H}`,
  "max-width:min(46vw,360px)",
  "text-align:right",
  "pointer-events:none",
].join(";");
export const CONTROLS_STYLE = [
  "margin:0",
  "font-size:12px",
  "line-height:1.85",
  "letter-spacing:0.02em",
  "color:rgba(238,242,247,0.72)",
].join(";");

// Bottom-left interactive console: a left-aligned column of transparent text
// controls over the scene (no frosted card). Holds the LAUNCH kicker, START,
// the MODE/BIOME rows, the TRACK CODE picker, and SETTINGS, split by hairlines.
export const CONSOLE_STYLE = [
  "position:absolute",
  `bottom:${EDGE_V}`,
  `left:${EDGE_H}`,
  "display:flex",
  "flex-direction:column",
  "align-items:stretch",
  "gap:6px",
  "width:min(300px,80vw)",
  "pointer-events:auto",
  "text-align:left",
].join(";");

// Full-width 1px hairline separating console sections (a decorative rule).
export const DIVIDER_STYLE = [
  "height:1px",
  "width:100%",
  "background:rgba(238,242,247,0.22)",
  "border:none",
  "flex:none",
].join(";");

// Primary action as a transparent, sharp-cornered, left-aligned text button.
// The hover fill comes from LOCAL_CSS (.gc-start:hover), not the base style.
export const START_BTN_STYLE = [
  "pointer-events:auto",
  "display:block",
  "width:100%",
  "text-align:left",
  "font-family:inherit",
  "font-weight:600",
  "font-size:16px",
  "letter-spacing:0.24em",
  "text-transform:uppercase",
  "color:#eef2f7",
  "background:transparent",
  "border:none",
  "border-radius:0",
  "padding:11px 12px",
  "cursor:pointer",
  "transition:background 0.14s ease,color 0.14s ease",
].join(";");

// Low-emphasis SETTINGS: same transparent/sharp treatment, muted + smaller.
export const SETTINGS_BTN_STYLE = [
  "pointer-events:auto",
  "display:block",
  "width:100%",
  "text-align:left",
  "font-family:inherit",
  "font-weight:600",
  "font-size:12px",
  "letter-spacing:0.22em",
  "text-transform:uppercase",
  "color:rgba(238,242,247,0.6)",
  "background:transparent",
  "border:none",
  "border-radius:0",
  "padding:9px 12px",
  "cursor:pointer",
  "transition:background 0.14s ease,color 0.14s ease",
].join(";");

// Focusable MODE/BIOME row: label left, `◀ value ▶` group right. Transparent +
// sharp; hover fill via LOCAL_CSS (.gc-console-row:hover).
export const ROW_STYLE = [
  "pointer-events:auto",
  "display:flex",
  "align-items:center",
  "justify-content:space-between",
  "gap:12px",
  "padding:8px 12px",
  "background:transparent",
  "border:none",
  "border-radius:0",
  "cursor:pointer",
].join(";");

export const ROW_LABEL_STYLE = [
  "flex:none",
  "font-size:11px",
  "font-weight:600",
  "letter-spacing:0.22em",
  "text-transform:uppercase",
  "color:rgba(238,242,247,0.6)",
].join(";");

// The `◀ value ▶` cluster sitting at the right end of a row.
export const ROW_CONTROLS_STYLE = ["display:inline-flex", "align-items:center", "gap:10px"].join(
  ";",
);

export const ROW_VALUE_STYLE = [
  "min-width:96px",
  "text-align:center",
  "font-size:13px",
  "font-weight:600",
  "letter-spacing:0.06em",
  "color:#eef2f7",
].join(";");

// Transparent, sharp chevron; hover fill via LOCAL_CSS (.gc-cchev:hover).
export const ROW_CHEVRON_STYLE = [
  "pointer-events:auto",
  "font-family:inherit",
  "font-size:12px",
  "line-height:1",
  "color:rgba(238,242,247,0.6)",
  "background:transparent",
  "border:none",
  "border-radius:0",
  "width:18px",
  "height:18px",
  "cursor:pointer",
  "transition:background 0.12s ease,color 0.12s ease",
].join(";");

// Local styling injected once by StartMenu: a soft masthead shadow, keycap
// chips for the controls hint, and the hover/active fills for the console's
// transparent controls (they override the shared gc-btn transform/hover).
export const LOCAL_CSS = `
h1.gc-title { text-shadow: 0 6px 40px rgba(0, 0, 0, 0.55); }
.gc-controls b {
  display: inline-block;
  padding: 0 6px;
  background: rgba(238, 242, 247, 0.08);
  border: 1px solid rgba(238, 242, 247, 0.18);
  font-weight: 600;
}
.gc-start:hover, .gc-settings:hover { background: rgba(238, 242, 247, 0.08); transform: none; }
.gc-start:active, .gc-settings:active { transform: none; }
.gc-console-row:hover { background: rgba(238, 242, 247, 0.05); }
.gc-cchev:hover { background: rgba(238, 242, 247, 0.16); color: #eef2f7; }
`;
