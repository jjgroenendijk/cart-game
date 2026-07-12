/**
 * 070 shared menu style kit. Single source for the overlay button visual
 * language (primary/secondary/ghost), the frosted menu panel, and the
 * RaceConfig-style selector row, plus one shared injected-CSS block for
 * hover/active/focus states. Pure string builders (no DOM), so overlays keep
 * their plain HTMLElement + cssText pattern and jsdom tests can assert on the
 * strings directly.
 *
 * Kinds (072 reskin — flat neutral editorial, no arcade gradient):
 * - primary:   near-white fill, dark ink text — the screen's confirm action.
 * - secondary: translucent + hairline border — supporting (settings/back/quit).
 * - ghost:     transparent + faint border — low-emphasis actions inside panels.
 *
 * 072 also adds an editorial layout vocabulary (kicker/hairline/serif heading/
 * telemetry/status dot/corner marks/vignette/grain) as pure cssText builders +
 * a neutral token set (INK/INK_MUTED/PANEL_INK/HAIRLINE/SERIF_STACK).
 *
 * The overlay scaffolding (overlayRootStyle/overlayScrollerStyle/
 * mountEditorialFrame) is the one screen skeleton every full-screen overlay
 * shares: full-bleed frame-holding root + a scrollable centered content
 * column, so small viewports scroll instead of clipping. Selector rows
 * (selectorRowStyle + telemetryKey/selectorValueStyle/selectorChevronStyle)
 * are the interactive key/value language; MENU_CSS carries the touch-target
 * and narrow-viewport rules on the shared gc-* classes.
 *
 * `buttonStyle(kind, extra)` appends `extra` AFTER the base declarations, so
 * callers override size/padding per screen (last declaration wins in cssText).
 * `styleMenuButton` also tags the element with `gc-btn gc-btn-<kind>` so the
 * shared MENU_CSS hover/active/focus rules apply; overlays inject MENU_CSS
 * once via their existing <style> node.
 */

export type ButtonKind = "primary" | "secondary" | "ghost";

/** Ink color used on filled buttons (matches the HUD dark). */
export const MENU_INK = "#0b0f14";
/** Accent yellow shared with HUD highlights + focus outlines. */
export const MENU_ACCENT = "#ffd23f";

/*
 * 072 editorial tokens — a small NEUTRAL palette so the chrome reads over any
 * biome background (the warm tropical palette belongs to 073, not here). Ink
 * is near-white, the panel is a translucent dark, hairlines are translucent
 * greys. The focus-outline accent stays MENU_ACCENT.
 */
/** Near-white body/heading ink. */
export const INK = "#eef2f7";
/** Muted ink for kicker labels + telemetry keys. */
export const INK_MUTED = "rgba(238,242,247,0.6)";
/** Translucent dark panel fill (holds contrast over bright + dark biomes). */
export const PANEL_INK = "rgba(10,14,20,0.62)";
/** Hairline grey for rules, dividers, corner marks, telemetry separators. */
export const HAIRLINE = "rgba(238,242,247,0.22)";
/** System serif stack for the editorial display heading (no web fonts). */
export const SERIF_STACK = 'Georgia,"Times New Roman",serif';

// 072 reskin: flat editorial buttons — tracked uppercase sans, sharp corners,
// no arcade gradient or chunky 3D lift. Palette is neutral (near-white primary,
// hairline-bordered secondary/ghost) so buttons read over any biome.
const BTN_BASE = [
  "pointer-events:auto",
  "font-family:inherit",
  "font-weight:600",
  "letter-spacing:0.18em",
  "text-transform:uppercase",
  "font-size:13px",
  "padding:11px 24px",
  "border-radius:0",
  "cursor:pointer",
  "text-shadow:none",
  "transition:transform 0.08s ease,background 0.12s ease,border-color 0.12s ease",
];

const BTN_KIND: Record<ButtonKind, string[]> = {
  primary: [`color:${MENU_INK}`, `background:${INK}`, `border:1px solid ${INK}`],
  secondary: [`color:${INK}`, "background:rgba(238,242,247,0.07)", `border:1px solid ${HAIRLINE}`],
  ghost: [
    `color:${INK_MUTED}`,
    "background:transparent",
    "border:1px solid rgba(238,242,247,0.14)",
  ],
};

/** cssText for a menu button; `extra` declarations override the base. */
export function buttonStyle(kind: ButtonKind, extra: string[] = []): string {
  return [...BTN_BASE, ...BTN_KIND[kind], ...extra].join(";");
}

/** Apply kind cssText + the shared gc-btn classes to a button. */
export function styleMenuButton(
  btn: HTMLButtonElement,
  kind: ButtonKind,
  extra: string[] = [],
): void {
  btn.classList.add("gc-btn", `gc-btn-${kind}`);
  btn.style.cssText = buttonStyle(kind, extra);
}

/*
 * Shared overlay scaffolding. Every full-screen overlay is the same sandwich:
 * a full-bleed root (stacking context + decorative frame holder) with a
 * scrollable centered content column inside it, so short/narrow viewports
 * scroll instead of clipping the centered flex content.
 */

/**
 * Full-bleed overlay root: absolute inset, z-index 10, pointer-events none
 * (interactive children opt back in). Holds the editorial frame layers;
 * `dim` adds the shared rgba(0,0,0,0.55) backdrop (pause/settings).
 */
export function overlayRootStyle(opts: { dim?: boolean } = {}): string {
  return [
    "position:absolute",
    "inset:0",
    "z-index:10",
    "overflow:hidden",
    "display:flex",
    "font-family:system-ui,sans-serif",
    `color:${INK}`,
    "pointer-events:none",
    "text-align:center",
    "text-shadow:0 2px 10px rgba(0,0,0,0.85)",
    ...(opts.dim ? ["background:rgba(0,0,0,0.55)"] : []),
  ].join(";");
}

/**
 * Scrollable centered content column inside an overlay root. `safe center`
 * (where supported) keeps tall content reachable by scroll instead of
 * clipping both ends; the duplicate justify-content declaration is the
 * fallback (last valid wins, invalid is dropped).
 */
export function overlayScrollerStyle(gap = 14): string {
  return [
    "position:relative",
    "flex:1",
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "justify-content:center",
    "justify-content:safe center",
    `gap:${gap}px`,
    "padding:clamp(20px,5vh,48px) clamp(16px,5vw,48px)",
    "overflow-y:auto",
    "overflow-x:hidden",
    "box-sizing:border-box",
    "pointer-events:none",
  ].join(";");
}

/**
 * Mount the editorial frame (vignette, optional film grain, four corner
 * brackets) into an overlay root, classed so MENU_CSS media rules can adapt
 * them. Decorative layers only — appended first so content stacks above.
 */
export function mountEditorialFrame(root: HTMLElement, opts: { grain?: boolean } = {}): void {
  const vignette = document.createElement("div");
  vignette.className = "gc-vignette";
  vignette.style.cssText = vignetteLayer();
  root.append(vignette);
  if (opts.grain) {
    const grain = document.createElement("div");
    grain.className = "gc-grain";
    grain.style.cssText = grainLayer();
    root.append(grain);
  }
  for (const c of ["tl", "tr", "bl", "br"] as const) {
    const mark = document.createElement("div");
    mark.className = "gc-corner";
    mark.style.cssText = cornerMark(c, 28);
    root.append(mark);
  }
}

/**
 * Interactive telemetry-style selector row: hairline-topped key/value line
 * that is focusable + cycles on click. Pair with `telemetryKey()` for the
 * label, `selectorValueStyle()` for the value, `selectorChevronStyle()` for
 * the prev/next taps. Tag rows `gc-row` for the shared focus ring.
 */
export function selectorRowStyle(): string {
  return [
    "display:flex",
    "align-items:center",
    "justify-content:space-between",
    "gap:16px",
    `border-top:1px solid ${HAIRLINE}`,
    "width:100%",
    "box-sizing:border-box",
    "padding:12px 6px",
    "background:transparent",
    "pointer-events:auto",
    "cursor:pointer",
    "transition:background 0.12s ease",
  ].join(";");
}

/** Bright value text inside a selector row (editorial, tracked). */
export function selectorValueStyle(): string {
  return [
    "font-size:15px",
    "font-weight:600",
    "letter-spacing:0.08em",
    "text-transform:uppercase",
    `color:${INK}`,
  ].join(";");
}

/** Transparent sharp prev/next chevron button inside a selector row. */
export function selectorChevronStyle(): string {
  return [
    "pointer-events:auto",
    "font-family:inherit",
    "font-size:12px",
    "line-height:1",
    `color:${INK_MUTED}`,
    "background:transparent",
    "border:none",
    "border-radius:0",
    "width:26px",
    "height:26px",
    "cursor:pointer",
    "flex:none",
    "transition:background 0.12s ease,color 0.12s ease",
  ].join(";");
}

/** Muted tracked keyboard-hint row; hidden on coarse pointers via MENU_CSS. */
export function hintRowStyle(): string {
  return [
    "display:flex",
    "gap:24px",
    "flex-wrap:wrap",
    "justify-content:center",
    "font-size:10px",
    "font-weight:600",
    "letter-spacing:0.22em",
    "text-transform:uppercase",
    `color:${INK_MUTED}`,
  ].join(";");
}

/*
 * 072 editorial primitives. Pure cssText builders (no DOM), so overlays keep
 * the plain HTMLElement + cssText pattern and jsdom tests assert on strings.
 * The overlay composes elements; each builder styles one node.
 */

/**
 * Uppercase tracked kicker label (~10px, 0.4em spacing). Pair with a leading
 * `hairlineRule(28)` inside an inline-flex row for the reference look.
 */
export function kickerLabel(): string {
  return [
    "font-size:10px",
    "font-weight:600",
    "letter-spacing:0.4em",
    "text-transform:uppercase",
    `color:${INK_MUTED}`,
  ].join(";");
}

/** Inline-flex row wrapping `hairlineRule` + `kickerLabel` text. */
export function kickerRow(): string {
  return ["display:inline-flex", "align-items:center", "gap:10px"].join(";");
}

/**
 * A 1px translucent hairline. Horizontal by default (`len`px wide); pass
 * `vertical` for a column rule. Used for kicker leaders + section dividers.
 */
export function hairlineRule(len = 48, vertical = false): string {
  const size = vertical ? ["width:1px", `height:${len}px`] : [`width:${len}px`, "height:1px"];
  return [...size, `background:${HAIRLINE}`, "border:none", "flex:none"].join(";");
}

/**
 * Serif display heading: light weight, large clamp, tight leading. Wrap an
 * italic accent word in a span styled with `displayAccent()`.
 */
export function displayHeading(): string {
  return [
    "margin:0",
    `font-family:${SERIF_STACK}`,
    "font-weight:300",
    "font-size:clamp(32px,8vw,84px)",
    "letter-spacing:0.5px",
    "line-height:1.02",
    `color:${INK}`,
  ].join(";");
}

/** Italic accent span for the display heading. */
export function displayAccent(): string {
  return ["font-style:italic", "font-weight:400"].join(";");
}

/** Right-aligned key/value telemetry row (muted key, brighter value). */
export function telemetryRow(): string {
  return [
    "display:flex",
    "align-items:baseline",
    "justify-content:space-between",
    "gap:16px",
    `border-top:1px solid ${HAIRLINE}`,
    "padding:6px 0",
  ].join(";");
}

/** Muted key text inside a telemetry row. */
export function telemetryKey(): string {
  return [
    "font-size:10px",
    "font-weight:600",
    "letter-spacing:0.22em",
    "text-transform:uppercase",
    `color:${INK_MUTED}`,
  ].join(";");
}

/** Brighter value text inside a telemetry row. */
export function telemetryValue(): string {
  return ["font-size:14px", "font-weight:600", "letter-spacing:0.04em", `color:${INK}`].join(";");
}

/** ~6px pulsing status dot (uses the `gc-pulse` keyframe in MENU_CSS). */
export function statusDot(): string {
  return [
    "width:6px",
    "height:6px",
    "border-radius:50%",
    `background:${INK}`,
    "animation:gc-pulse 2.4s ease-in-out infinite",
  ].join(";");
}

/** L-shaped corner bracket for one of the four corners of an inset frame. */
export function cornerMark(corner: "tl" | "tr" | "bl" | "br", size = 24): string {
  const top = corner[0] === "t";
  const left = corner[1] === "l";
  return [
    "position:absolute",
    top ? "top:0" : "bottom:0",
    left ? "left:0" : "right:0",
    `width:${size}px`,
    `height:${size}px`,
    `border-${top ? "top" : "bottom"}:1px solid ${HAIRLINE}`,
    `border-${left ? "left" : "right"}:1px solid ${HAIRLINE}`,
    "pointer-events:none",
  ].join(";");
}

/** Soft corner-darkening vignette layer (full-inset, non-interactive). */
export function vignetteLayer(): string {
  return [
    "position:absolute",
    "inset:0",
    "pointer-events:none",
    "background:radial-gradient(ellipse at center,transparent 55%,rgba(0,0,0,0.12) 100%)",
  ].join(";");
}

/*
 * Inline SVG feTurbulence grain as a data URI — NO asset file (zero-media
 * rule). `#` is percent-encoded so the URL parses inside cssText. This single
 * unbreakable token is exempt from the 100-char line cap.
 */
// prettier-ignore
const GRAIN_SVG =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='140'%20height='140'%3E%3Cfilter%20id='n'%3E%3CfeTurbulence%20type='fractalNoise'%20baseFrequency='0.8'%20numOctaves='2'%20stitchTiles='stitch'/%3E%3C/filter%3E%3Crect%20width='100%25'%20height='100%25'%20filter='url(%23n)'/%3E%3C/svg%3E";

/** Film-grain overlay layer (full-inset, non-interactive, static div). */
export function grainLayer(): string {
  return [
    "position:absolute",
    "inset:0",
    "pointer-events:none",
    "opacity:0.08",
    "mix-blend-mode:overlay",
    `background-image:url("${GRAIN_SVG}")`,
  ].join(";");
}

/**
 * Shared hover/active/focus rules for gc-btn/gc-row/gc-chevron, plus the
 * `gc-pulse` status-dot keyframe and the responsive/touch rules. Overlays
 * prepend this to their injected <style> text. Plain :focus (not
 * :focus-visible) because MenuNav drives focus programmatically for keyboard
 * AND gamepad; both need a visible ring.
 *
 * Touch/small-screen rules ride on the shared classes: coarse pointers get
 * >=44px button targets + bigger chevrons and lose the keyboard-hint rows
 * (`gc-kb-hints`); narrow viewports stretch primary/secondary buttons toward
 * full width so stacked overlay actions read as a clean column (ghosts stay
 * content-width — they live inline in rows like the seed picker header).
 */
export const MENU_CSS = `
.gc-btn:hover { transform: translateY(-2px); }
.gc-btn:active { transform: translateY(2px); filter: brightness(0.95); }
.gc-btn:focus, .gc-row:focus {
  outline: 3px solid ${MENU_ACCENT};
  outline-offset: 2px;
}
.gc-btn-primary:focus { outline-color: #fff; }
.gc-row:hover { background: rgba(238, 242, 247, 0.05); }
.gc-chevron:hover { background: rgba(238, 242, 247, 0.16); color: ${INK}; }
.gc-chevron:active { transform: translateY(1px); }
@keyframes gc-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(238, 242, 247, 0.5); }
  50% { opacity: 0.45; box-shadow: 0 0 7px 2px rgba(238, 242, 247, 0.35); }
}
@media (pointer: coarse) {
  .gc-btn { min-height: 44px; }
  .gc-chevron { min-width: 38px; min-height: 38px; }
  .gc-kb-hints { display: none; }
}
@media (max-width: 480px) {
  .gc-btn-primary, .gc-btn-secondary { width: min(320px, 88vw); }
}
`;
