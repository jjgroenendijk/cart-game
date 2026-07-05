/**
 * 070 shared menu style kit. Single source for the overlay button visual
 * language (primary/secondary/ghost), the frosted menu panel, and the
 * RaceConfig-style selector row, plus one shared injected-CSS block for
 * hover/active/focus states. Pure string builders (no DOM), so overlays keep
 * their plain HTMLElement + cssText pattern and jsdom tests can assert on the
 * strings directly.
 *
 * Kinds:
 * - primary:   yellow gradient, ink text — the screen's confirm action.
 * - secondary: blue, ink text — supporting actions (settings/back/quit).
 * - ghost:     translucent bordered — low-emphasis actions inside panels.
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

const BTN_BASE = [
  "pointer-events:auto",
  "font-family:inherit",
  "font-weight:700",
  "letter-spacing:1px",
  "font-size:16px",
  "padding:10px 24px",
  "border:none",
  "border-radius:12px",
  "cursor:pointer",
  "transition:transform 0.08s ease,box-shadow 0.08s ease,filter 0.08s ease",
];

const BTN_KIND: Record<ButtonKind, string[]> = {
  primary: [
    `color:${MENU_INK}`,
    "background:linear-gradient(180deg,#ffe082,#ffd23f 55%,#f2b02c)",
    "box-shadow:0 5px 0 #c9a31f,0 8px 20px rgba(0,0,0,0.45)",
  ],
  secondary: [
    `color:${MENU_INK}`,
    "background:linear-gradient(180deg,#bfe0ff,#9ad0ff 60%,#7fbcf0)",
    "box-shadow:0 4px 0 #5a9fd6,0 6px 16px rgba(0,0,0,0.4)",
  ],
  ghost: [
    "color:#cfe8ff",
    "background:rgba(20,30,45,0.5)",
    "border:2px solid rgba(150,200,255,0.35)",
    "box-shadow:0 4px 12px rgba(0,0,0,0.3)",
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

/** Frosted card that groups a screen's controls over the live 3D bg. */
export const PANEL_STYLE = [
  "pointer-events:auto",
  "display:flex",
  "flex-direction:column",
  "gap:12px",
  "width:min(340px,88vw)",
  "padding:20px",
  "border-radius:18px",
  "background:rgba(8,14,22,0.62)",
  "border:1px solid rgba(150,200,255,0.22)",
  "box-shadow:0 18px 50px rgba(0,0,0,0.45)",
  "backdrop-filter:blur(10px) saturate(1.2)",
].join(";");

/** Focusable `LABEL  < value >` selector row (gc-row for shared focus CSS). */
export const SELECTOR_ROW_STYLE = [
  "pointer-events:auto",
  "display:flex",
  "align-items:center",
  "gap:10px",
  "padding:8px 12px",
  "border-radius:12px",
  "background:rgba(255,255,255,0.06)",
  "border:2px solid rgba(150,200,255,0.18)",
  "cursor:pointer",
].join(";");

export const SELECTOR_LABEL_STYLE = [
  "min-width:56px",
  "text-align:left",
  "font-size:13px",
  "font-weight:800",
  "letter-spacing:1px",
  "opacity:0.85",
].join(";");

export const SELECTOR_VALUE_STYLE = [
  "flex:1",
  "text-align:center",
  "font-size:17px",
  "font-weight:800",
  "letter-spacing:1px",
].join(";");

/** Small chevron button inside a selector row. */
export const CHEVRON_STYLE = [
  "pointer-events:auto",
  "font-family:inherit",
  "font-size:14px",
  "font-weight:800",
  "line-height:1",
  "color:#cfe8ff",
  "background:rgba(150,200,255,0.12)",
  "border:none",
  "border-radius:8px",
  "width:28px",
  "height:28px",
  "cursor:pointer",
].join(";");

/**
 * Shared hover/active/focus rules for gc-btn/gc-row/gc-chevron. Overlays
 * prepend this to their injected <style> text. Plain :focus (not
 * :focus-visible) because MenuNav drives focus programmatically for
 * keyboard AND gamepad; both need a visible ring.
 */
export const MENU_CSS = `
.gc-btn:hover { transform: translateY(-2px); }
.gc-btn:active { transform: translateY(2px); filter: brightness(0.95); }
.gc-btn:focus, .gc-row:focus {
  outline: 3px solid ${MENU_ACCENT};
  outline-offset: 2px;
}
.gc-btn-primary:focus { outline-color: #fff; }
.gc-chevron:hover { background: rgba(150, 200, 255, 0.3); }
.gc-chevron:active { transform: translateY(1px); }
`;
