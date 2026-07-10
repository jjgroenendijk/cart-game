/**
 * 024/083 kart-select DOM overlay. Pre-race sub-screen with two stages per
 * player: cycle the six KART_VARIANTS (name + stat bars), confirm, then cycle
 * the KART_COLORWAYS paint (name + two-tone swatch), confirm. In 2P, P1's
 * paint confirm hands off to P2; the final confirm delivers both picks. Back
 * unwinds one step: paint -> model, P2 model -> P1 paint, P1 model -> menu
 * (onBack).
 *
 * Plain HTMLElements + cssText + a tiny injected <style>, mirroring StartMenu.
 * Root pointer-events none; CONFIRM/BACK buttons pointer-events auto. Own
 * keydown handler cycles (ArrowLeft/Right), confirms (Enter), backs out
 * (Escape), guarded on root display so a hidden overlay is inert. MenuNav
 * drives vertical focus between the two buttons + gamepad: onHorizontal cycles,
 * A confirms via the focused-button click, B dispatches a synthetic Escape that
 * this handler turns into back(). A `finished` guard makes double-confirm a
 * no-op (mirrors StartMenu's `started`).
 */

import { MenuNav } from "./menuNav";
import { type GameMode, type MenuAudio } from "./StartMenu";
import {
  INK,
  INK_MUTED,
  MENU_CSS,
  cornerMark,
  displayHeading,
  hairlineRule,
  kickerLabel,
  kickerRow,
  styleMenuButton,
  vignetteLayer,
} from "./menuStyles";
import { KART_VARIANTS, type KartVariant } from "../kart/kartVariants";
import { KART_COLORWAYS } from "../kart/kartColorways";
import type { KartPick } from "../core/kartSelection";

export interface KartSelectResult {
  mode: GameMode;
  picks: KartPick[];
}

export interface KartSelectOverlayOptions {
  initialPicks?: KartPick[];
  onConfirm: (result: KartSelectResult) => void;
  onBack: () => void;
}

type Stage = "model" | "paint";

type StatKey = keyof KartVariant["statBars"];

const STAT_ROWS: { key: StatKey; label: string }[] = [
  { key: "speed", label: "SPEED" },
  { key: "accel", label: "ACCEL" },
  { key: "grip", label: "GRIP" },
  { key: "mass", label: "MASS" },
];

// z-index 10 mirrors StartMenu + #loading so the overlay sits above canvas.
// overflow:hidden clips the editorial vignette + corner marks (072).
const ROOT_STYLE = [
  "position:absolute",
  "inset:0",
  "z-index:10",
  "overflow:hidden",
  "display:flex",
  "flex-direction:column",
  "align-items:center",
  "justify-content:center",
  "gap:14px",
  "font-family:system-ui,sans-serif",
  `color:${INK}`,
  "pointer-events:none",
  "text-align:center",
  "text-shadow:0 2px 10px rgba(0,0,0,0.85)",
].join(";");

// Muted player prompt sub-line (072): the kart NAME is the serif display head.
const PROMPT_STYLE = [
  "margin:0",
  "font-size:11px",
  "font-weight:600",
  "letter-spacing:0.28em",
  "text-transform:uppercase",
  `color:${INK_MUTED}`,
].join(";");

const SWATCH_STYLE = [
  "width:44px",
  "height:44px",
  "border-radius:10px",
  "border:3px solid rgba(255,255,255,0.85)",
  "box-shadow:0 4px 12px rgba(0,0,0,0.5)",
  "display:flex",
  "overflow:hidden",
].join(";");

// Two-tone paint chip: body color fills, accent rides as a right-side stripe.
const SWATCH_BODY_STYLE = ["flex:1", "height:100%"].join(";");
const SWATCH_ACCENT_STYLE = ["width:30%", "height:100%"].join(";");

const STATS_WRAP_STYLE = [
  "display:flex",
  "flex-direction:column",
  "gap:6px",
  "width:min(320px,80vw)",
].join(";");

const STAT_ROW_STYLE = ["display:flex", "align-items:center", "gap:10px"].join(";");

const STAT_LABEL_STYLE = [
  "width:64px",
  "text-align:right",
  "font-size:13px",
  "font-weight:700",
  "letter-spacing:1px",
].join(";");

const TRACK_STYLE = [
  "flex:1",
  "height:12px",
  "background:rgba(255,255,255,0.2)",
  "border-radius:6px",
  "overflow:hidden",
].join(";");

const FILL_STYLE = ["height:100%", "width:0%", `background:${INK}`, "border-radius:6px"].join(";");

const HINTS_STYLE = [
  "display:flex",
  "gap:40px",
  "font-size:14px",
  "opacity:0.9",
  "letter-spacing:1px",
].join(";");

// Button visuals come from the shared menuStyles kit (070); hover/active/
// focus rules ride in via MENU_CSS.
const BUTTON_EXTRA = ["font-size:18px", "padding:10px 30px"];

const KEYFRAMES_CSS = MENU_CSS;

function hexColor(value: number): string {
  return "#" + value.toString(16).padStart(6, "0");
}

export class KartSelectOverlay {
  private readonly root: HTMLElement;
  private readonly audio: MenuAudio;
  private readonly mode: GameMode;
  private readonly onConfirm: (result: KartSelectResult) => void;
  private readonly onBack: () => void;
  private readonly onKeydown: (e: KeyboardEvent) => void;
  private readonly promptEl: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly swatchEl: HTMLElement;
  private readonly swatchBodyEl: HTMLElement;
  private readonly swatchAccentEl: HTMLElement;
  private readonly fills: HTMLDivElement[];
  private readonly confirmButton: HTMLButtonElement;
  private readonly backButton: HTMLButtonElement;
  private readonly picks: KartPick[];
  private player = 0;
  private stage: Stage = "model";
  private currentModel = 0;
  private currentPaint = 0;
  private finished = false;
  private nav: MenuNav | null = null;

  constructor(
    container: HTMLElement,
    audio: MenuAudio,
    mode: GameMode,
    opts: KartSelectOverlayOptions,
  ) {
    this.audio = audio;
    this.mode = mode;
    this.onConfirm = opts.onConfirm;
    this.onBack = opts.onBack;
    const fallback: KartPick = { variant: "balanced", colorway: "ember" };
    const init = opts.initialPicks ?? [];
    this.picks = [{ ...(init[0] ?? fallback) }, { ...(init[1] ?? fallback) }];
    this.focusPlayer(0);

    const style = document.createElement("style");
    style.textContent = KEYFRAMES_CSS;

    this.promptEl = document.createElement("div");
    this.promptEl.className = "gc-kart-prompt";
    this.promptEl.style.cssText = PROMPT_STYLE;

    this.swatchEl = document.createElement("div");
    this.swatchEl.className = "gc-kart-swatch";
    this.swatchEl.style.cssText = SWATCH_STYLE;
    this.swatchBodyEl = document.createElement("div");
    this.swatchBodyEl.className = "gc-kart-swatch-body";
    this.swatchBodyEl.style.cssText = SWATCH_BODY_STYLE;
    this.swatchAccentEl = document.createElement("div");
    this.swatchAccentEl.className = "gc-kart-swatch-accent";
    this.swatchAccentEl.style.cssText = SWATCH_ACCENT_STYLE;
    this.swatchEl.append(this.swatchBodyEl, this.swatchAccentEl);

    // The kart name is the serif display heading (072 editorial anchor).
    this.nameEl = document.createElement("div");
    this.nameEl.className = "gc-kart-name";
    this.nameEl.style.cssText = displayHeading();

    const statsWrap = document.createElement("div");
    statsWrap.className = "gc-kart-stats";
    statsWrap.style.cssText = STATS_WRAP_STYLE;
    this.fills = STAT_ROWS.map((row) => {
      const rowEl = document.createElement("div");
      rowEl.style.cssText = STAT_ROW_STYLE;
      const label = document.createElement("span");
      label.textContent = row.label;
      label.style.cssText = STAT_LABEL_STYLE;
      const track = document.createElement("div");
      track.style.cssText = TRACK_STYLE;
      const fill = document.createElement("div");
      fill.className = "gc-kart-fill";
      fill.style.cssText = FILL_STYLE;
      track.appendChild(fill);
      rowEl.append(label, track);
      statsWrap.appendChild(rowEl);
      return fill;
    });

    const hints = document.createElement("div");
    hints.style.cssText = HINTS_STYLE;
    const leftHint = document.createElement("span");
    leftHint.textContent = "< LEFT";
    const rightHint = document.createElement("span");
    rightHint.textContent = "RIGHT >";
    hints.append(leftHint, rightHint);

    this.confirmButton = document.createElement("button");
    this.confirmButton.type = "button";
    this.confirmButton.className = "gc-kart-confirm";
    this.confirmButton.textContent = "CONFIRM";
    styleMenuButton(this.confirmButton, "primary", BUTTON_EXTRA);
    this.confirmButton.addEventListener("click", () => this.confirm());
    this.confirmButton.addEventListener("mouseenter", () => this.audio.uiBeep("hover"));

    this.backButton = document.createElement("button");
    this.backButton.type = "button";
    this.backButton.className = "gc-kart-back";
    this.backButton.textContent = "BACK";
    styleMenuButton(this.backButton, "secondary", BUTTON_EXTRA);
    this.backButton.addEventListener("click", () => this.back());
    this.backButton.addEventListener("mouseenter", () => this.audio.uiBeep("hover"));

    const kicker = document.createElement("div");
    kicker.className = "gc-kart-kicker";
    kicker.style.cssText = kickerRow();
    const kickerLine = document.createElement("span");
    kickerLine.style.cssText = hairlineRule(28);
    const kickerText = document.createElement("span");
    kickerText.textContent = "CHOOSE KART";
    kickerText.style.cssText = kickerLabel();
    kicker.append(kickerLine, kickerText);

    this.root = document.createElement("div");
    this.root.style.cssText = ROOT_STYLE;
    // Decorative editorial layers first (behind), then the content stack. Grain
    // is omitted here to keep the stat bars + swatch crisp.
    const vignette = document.createElement("div");
    vignette.style.cssText = vignetteLayer();
    this.root.append(style, vignette);
    for (const c of ["tl", "tr", "bl", "br"] as const) {
      const mark = document.createElement("div");
      mark.style.cssText = cornerMark(c, 28);
      this.root.append(mark);
    }
    this.root.append(
      kicker,
      this.promptEl,
      this.nameEl,
      this.swatchEl,
      statsWrap,
      hints,
      this.confirmButton,
      this.backButton,
    );

    // Left/Right cycle, Enter confirms, Escape backs out. preventDefault on the
    // arrows stops page scroll; on Enter it also cancels the native focused
    // button click so confirm runs once (the `finished` guard covers the rest).
    // The display guard keeps a hidden overlay inert (e.g. while another screen
    // is open). MenuNav owns ArrowUp/Down focus + gamepad; this owns the rest.
    this.onKeydown = (e: KeyboardEvent) => {
      if (this.root.style.display === "none") return;
      switch (e.code) {
        case "ArrowLeft":
          e.preventDefault();
          this.cycle(-1);
          break;
        case "ArrowRight":
          e.preventDefault();
          this.cycle(1);
          break;
        case "Enter":
          e.preventDefault();
          this.confirm();
          break;
        case "Escape":
          e.preventDefault();
          this.back();
          break;
      }
    };
    window.addEventListener("keydown", this.onKeydown);

    container.appendChild(this.root);

    this.render();
    this.startNav();
  }

  /** Point the cursors at `player`'s persisted pick and reset to model stage. */
  private focusPlayer(player: number): void {
    this.player = player;
    this.stage = "model";
    const pick = this.picks[player]!;
    const vi = KART_VARIANTS.findIndex((v) => v.id === pick.variant);
    const ci = KART_COLORWAYS.findIndex((c) => c.id === pick.colorway);
    this.currentModel = vi < 0 ? 0 : vi;
    this.currentPaint = ci < 0 ? 0 : ci;
  }

  /** Wrap-around cycle of the focused list (model or paint) for the stage. */
  private cycle(dir: 1 | -1): void {
    if (this.finished) return;
    if (this.stage === "model") {
      const n = KART_VARIANTS.length;
      this.currentModel = (((this.currentModel + dir) % n) + n) % n;
    } else {
      const n = KART_COLORWAYS.length;
      this.currentPaint = (((this.currentPaint + dir) % n) + n) % n;
    }
    this.audio.uiBeep("beep");
    this.render();
  }

  /** Render prompt, heading, two-tone swatch + stat bars for the stage. */
  private render(): void {
    const p = this.player === 0 ? "P1" : "P2";
    const v = KART_VARIANTS[this.currentModel];
    const c = KART_COLORWAYS[this.currentPaint];
    this.promptEl.textContent =
      this.stage === "model" ? `${p} choose your kart` : `${p} choose your paint`;
    this.nameEl.textContent = this.stage === "model" ? v.name : c.name;
    this.swatchBodyEl.style.background = hexColor(c.colors.body);
    this.swatchAccentEl.style.background = hexColor(c.colors.accent);
    STAT_ROWS.forEach((row, i) => {
      this.fills[i].style.width = `${v.statBars[row.key] * 100}%`;
    });
  }

  /**
   * Advance one step: model -> paint; paint locks the player's pick, then
   * 1P or P2 -> deliver, 2P P1 -> hand off to P2's model stage.
   */
  private confirm(): void {
    if (this.finished) return;
    if (this.stage === "model") {
      const chosen = KART_VARIANTS[this.currentModel];
      const pickRef = this.picks[this.player]!;
      // A model switch resets the paint cursor to the model's stock colorway;
      // re-confirming the persisted model keeps the player's saved paint.
      if (pickRef.variant !== chosen.id) {
        pickRef.variant = chosen.id;
        pickRef.colorway = chosen.colorway;
        const ci = KART_COLORWAYS.findIndex((c) => c.id === chosen.colorway);
        this.currentPaint = ci < 0 ? 0 : ci;
      }
      this.stage = "paint";
      this.audio.uiBeep("click");
      this.render();
      return;
    }
    this.picks[this.player]!.colorway = KART_COLORWAYS[this.currentPaint].id;
    if (this.mode === "1P" || this.player === 1) {
      this.finished = true;
      this.audio.uiBeep("click");
      this.onConfirm({ mode: this.mode, picks: this.picks.map((pk) => ({ ...pk })) });
      return;
    }
    this.focusPlayer(1);
    this.audio.uiBeep("click");
    this.render();
  }

  /**
   * Unwind one step: paint -> model; P2 model -> P1 paint; P1 model -> menu
   * (onBack). Finished ignores.
   */
  private back(): void {
    if (this.finished) return;
    this.audio.uiBeep("click");
    if (this.stage === "paint") {
      this.stage = "model";
      this.render();
      return;
    }
    if (this.player === 1) {
      this.focusPlayer(0);
      this.stage = "paint";
      this.render();
      return;
    }
    this.onBack();
  }

  show(): void {
    this.root.style.display = "flex";
    this.startNav();
  }

  hide(): void {
    this.root.style.display = "none";
    this.stopNav();
  }

  /** Detach the overlay from the DOM + drop the keydown listener + nav. */
  remove(): void {
    this.stopNav();
    window.removeEventListener("keydown", this.onKeydown);
    this.root.remove();
  }

  private startNav(): void {
    if (this.nav) return;
    this.nav = new MenuNav({
      elements: () => [this.confirmButton, this.backButton],
      onHorizontal: (dir) => this.cycle(dir),
    });
    this.nav.start();
  }

  private stopNav(): void {
    this.nav?.dispose();
    this.nav = null;
  }
}
