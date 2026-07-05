/**
 * 072 start-menu presentation: the cssText constants + copy for the field-
 * journal layout, split out of StartMenu.ts to keep that file behavior-focused
 * (and under the 600-line cap). Pure strings only — no DOM — so the overlay
 * keeps its plain-element + cssText pattern and stays jsdom-testable.
 *
 * Corner-anchored asymmetry (biome-neutral; per-biome tint is 073): identity
 * top-left, telemetry top-right, status bottom-left, hints bottom-right, and
 * the interactive strip bottom-center over the live 3D scene.
 */

import type { GameMode } from "./StartMenu";

/** Human-facing mode labels, indexed like MODE_VALUES in StartMenu. */
export const MODE_LABELS = ["1 PLAYER", "2 PLAYERS"];

/** Poetic masthead meta line under the identity block. */
export const META_LINE = "Every seed forges a new circuit. Choose a world, take the wheel.";

/** Bottom-left live-sim status cues (each rendered with a pulsing dot). */
export const STATUS_LINES = ["READY", "TERRAIN · PROCEDURAL", "PHYSICS · LIVE"];

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
// to a corner or the bottom-center, so the middle stays clear for the scene.
// display:flex is kept only so show() can restore it (tests + GameFlow rely on
// the "flex" value); nothing flows through it since all children are absolute.
// pointer-events:none lets drags reach the canvas (orbit the preview); the
// bottom strip opts back in. overflow:hidden clips the grain + vignette.
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

// Bottom-left status column: pulsing-dot live-sim cues.
export const STATUS_STYLE = [
  "position:absolute",
  `bottom:${EDGE_V}`,
  `left:${EDGE_H}`,
  "display:flex",
  "flex-direction:column",
  "align-items:flex-start",
  "gap:9px",
  "pointer-events:none",
].join(";");
export const STATUS_LINE_STYLE = ["display:inline-flex", "align-items:center", "gap:8px"].join(";");

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

// Bottom-center interactive strip: transparent (no frosted card), so the scene
// reads through. Centered via left:50% + translateX(-50%).
export const STRIP_STYLE = [
  "position:absolute",
  "bottom:clamp(20px,6vh,56px)",
  "left:50%",
  "transform:translateX(-50%)",
  "display:flex",
  "flex-direction:column",
  "align-items:stretch",
  "gap:12px",
  "width:min(360px,86vw)",
  "pointer-events:auto",
  "text-align:center",
].join(";");

// MODE | BIOME sit side by side inside the strip.
export const SELECTORS_ROW_STYLE = ["display:flex", "gap:10px", "align-items:stretch"].join(";");

// Local keycap-chip treatment for the controls hint + a soft masthead shadow;
// MENU_CSS (hover/active/focus + gc-pulse) is prepended in the StartMenu ctor.
export const LOCAL_CSS = `
h1.gc-title { text-shadow: 0 6px 40px rgba(0, 0, 0, 0.55); }
.gc-controls b {
  display: inline-block;
  padding: 0 6px;
  border-radius: 3px;
  background: rgba(238, 242, 247, 0.08);
  border: 1px solid rgba(238, 242, 247, 0.18);
  font-weight: 600;
}
`;
