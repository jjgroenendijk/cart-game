/**
 * 042 race-setup DOM overlay. Pre-race sky config screen between the start
 * menu and kart-select: MODE (static/dynamic), TIME (phase), SPEED (day
 * cycle length). Each row is focusable; left/right cycles that row's value
 * and fires onApply so Game can drive a live sky preview via setTimeOfDay;
 * CONFIRM fires onConfirm, BACK/Escape fires onBack. The SPEED row dims and
 * is locked while MODE is static (a static sky has no cycle speed).
 *
 * Mirrors KartSelectOverlay: plain HTMLElements + cssText + a tiny injected
 * <style>, an own keydown handler guarded on root display so a hidden overlay
 * is inert, CONFIRM/BACK buttons with hover/active transforms, and a MenuNav
 * started on show / disposed on hide+remove. MenuNav owns ArrowUp/Down focus
 * across [mode, time, speed, confirm, back] + gamepad; gamepad horizontal
 * cycles the focused row. This handler owns ArrowLeft/Right (cycle focused
 * row), Enter (confirm), Escape (back). A `finished` guard makes double-
 * confirm / double-back a no-op.
 */

import { MenuNav } from "./menuNav";
import { type MenuAudio } from "./StartMenu";
import {
  SPEED_PRESETS,
  type TimeOfDayConfig,
  type TimeOfDayMode,
  type TimeOfDayPhase,
  type TimeOfDaySpeed,
} from "../core/timeOfDayConfig";

export interface RaceConfigOverlayOptions {
  initial: TimeOfDayConfig;
  onApply: (config: TimeOfDayConfig) => void;
  onConfirm: (config: TimeOfDayConfig) => void;
  onBack: () => void;
}

const MODE_VALUES: TimeOfDayMode[] = ["static", "dynamic"];
const MODE_LABELS = ["STATIC", "DYNAMIC"];
const PHASE_VALUES: TimeOfDayPhase[] = ["dawn", "morning", "noon", "afternoon", "dusk", "night"];
const PHASE_LABELS = ["DAWN", "MORNING", "NOON", "AFTERNOON", "DUSK", "NIGHT"];
const SPEED_VALUES: TimeOfDaySpeed[] = ["slow", "normal", "fast"];
const SPEED_LABELS = ["SLOW", "NORMAL", "FAST"];

// z-index 10 mirrors StartMenu + KartSelectOverlay so the overlay sits above
// the canvas at the same stacking level as the (hidden) start menu.
const ROOT_STYLE = [
  "position:absolute",
  "inset:0",
  "z-index:10",
  "display:flex",
  "flex-direction:column",
  "align-items:center",
  "justify-content:center",
  "gap:16px",
  "font-family:system-ui,sans-serif",
  "color:#fff",
  "pointer-events:none",
  "text-align:center",
  "text-shadow:0 2px 10px rgba(0,0,0,0.85)",
].join(";");

const TITLE_STYLE = [
  "margin:0",
  "font-size:clamp(24px,5vw,40px)",
  "font-weight:800",
  "letter-spacing:2px",
].join(";");

const ROWS_WRAP_STYLE = [
  "display:flex",
  "flex-direction:column",
  "gap:10px",
  "width:min(360px,86vw)",
].join(";");

const ROW_STYLE = [
  "display:flex",
  "align-items:center",
  "gap:16px",
  "padding:10px 18px",
  "border-radius:12px",
  "background:rgba(0,0,0,0.35)",
  "border:2px solid rgba(255,255,255,0.15)",
].join(";");

const ROW_LABEL_STYLE = [
  "width:80px",
  "text-align:left",
  "font-size:14px",
  "font-weight:800",
  "letter-spacing:1px",
  "opacity:0.85",
].join(";");

const ROW_VALUE_STYLE = [
  "flex:1",
  "text-align:right",
  "font-size:clamp(18px,3vw,24px)",
  "font-weight:800",
  "letter-spacing:1px",
].join(";");

const HINTS_STYLE = [
  "display:flex",
  "gap:28px",
  "font-size:13px",
  "opacity:0.9",
  "letter-spacing:1px",
].join(";");

const CONFIRM_STYLE = [
  "pointer-events:auto",
  "font-family:inherit",
  "font-size:18px",
  "font-weight:700",
  "letter-spacing:1px",
  "color:#0b0f14",
  "background:#ffd23f",
  "border:none",
  "border-radius:12px",
  "padding:10px 30px",
  "cursor:pointer",
  "box-shadow:0 5px 0 #c9a31f,0 8px 20px rgba(0,0,0,0.45)",
  "transition:transform 0.08s ease,box-shadow 0.08s ease",
].join(";");

const BACK_STYLE = [
  "pointer-events:auto",
  "font-family:inherit",
  "font-size:18px",
  "font-weight:700",
  "letter-spacing:1px",
  "color:#0b0f14",
  "background:#cfd8dc",
  "border:none",
  "border-radius:12px",
  "padding:10px 30px",
  "cursor:pointer",
  "box-shadow:0 5px 0 #9aa7ad,0 8px 20px rgba(0,0,0,0.45)",
  "transition:transform 0.08s ease,box-shadow 0.08s ease",
].join(";");

const KEYFRAMES_CSS = `
.gc-rc-row:focus { outline: 3px solid #ffd23f; outline-offset: 1px; }
button.gc-rc-confirm:hover, button.gc-rc-back:hover { transform: translateY(-2px); }
button.gc-rc-confirm:active, button.gc-rc-back:active { transform: translateY(2px); }
`;

function makeRow(
  label: string,
  className: string,
): { row: HTMLDivElement; value: HTMLSpanElement } {
  const row = document.createElement("div");
  row.className = `gc-rc-row gc-rc-${className}`;
  row.tabIndex = 0;
  row.style.cssText = ROW_STYLE;
  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  labelEl.style.cssText = ROW_LABEL_STYLE;
  const value = document.createElement("span");
  value.className = `gc-rc-${className}-value`;
  value.style.cssText = ROW_VALUE_STYLE;
  row.append(labelEl, value);
  return { row, value };
}

export class RaceConfigOverlay {
  private readonly root: HTMLElement;
  private readonly audio: MenuAudio;
  private readonly opts: RaceConfigOverlayOptions;
  private readonly onKeydown: (e: KeyboardEvent) => void;
  private readonly modeRow: HTMLDivElement;
  private readonly timeRow: HTMLDivElement;
  private readonly speedRow: HTMLDivElement;
  private readonly modeValue: HTMLSpanElement;
  private readonly timeValue: HTMLSpanElement;
  private readonly speedValue: HTMLSpanElement;
  private readonly confirmButton: HTMLButtonElement;
  private readonly backButton: HTMLButtonElement;
  private readonly rowEls: HTMLDivElement[];
  private modeIndex = 0;
  private phaseIndex = 0;
  private speedIndex = 0;
  private finished = false;
  private nav: MenuNav | null = null;

  constructor(container: HTMLElement, audio: MenuAudio, opts: RaceConfigOverlayOptions) {
    this.audio = audio;
    this.opts = opts;

    const init = opts.initial;
    this.modeIndex = Math.max(0, MODE_VALUES.indexOf(init.mode));
    this.phaseIndex = Math.max(0, PHASE_VALUES.indexOf(init.phase));
    const sIdx = SPEED_VALUES.findIndex((k) => SPEED_PRESETS[k] === init.dayLengthSeconds);
    this.speedIndex = sIdx < 0 ? SPEED_VALUES.indexOf("normal") : sIdx;

    const style = document.createElement("style");
    style.textContent = KEYFRAMES_CSS;

    const title = document.createElement("h2");
    title.textContent = "RACE SETUP";
    title.style.cssText = TITLE_STYLE;

    const modeRow = makeRow("MODE", "mode");
    const timeRow = makeRow("TIME", "time");
    const speedRow = makeRow("SPEED", "speed");
    this.modeRow = modeRow.row;
    this.timeRow = timeRow.row;
    this.speedRow = speedRow.row;
    this.modeValue = modeRow.value;
    this.timeValue = timeRow.value;
    this.speedValue = speedRow.value;
    this.rowEls = [this.modeRow, this.timeRow, this.speedRow];

    const rowsWrap = document.createElement("div");
    rowsWrap.style.cssText = ROWS_WRAP_STYLE;
    rowsWrap.append(this.modeRow, this.timeRow, this.speedRow);

    const hints = document.createElement("div");
    hints.style.cssText = HINTS_STYLE;
    for (const text of ["< / > CHANGE", "^ / v ROW", "ENTER CONFIRM", "ESC BACK"]) {
      const span = document.createElement("span");
      span.textContent = text;
      hints.appendChild(span);
    }

    this.confirmButton = document.createElement("button");
    this.confirmButton.type = "button";
    this.confirmButton.className = "gc-rc-confirm";
    this.confirmButton.textContent = "CONFIRM";
    this.confirmButton.style.cssText = CONFIRM_STYLE;
    this.confirmButton.addEventListener("click", () => this.confirm());
    this.confirmButton.addEventListener("mouseenter", () => this.audio.uiBeep("hover"));

    this.backButton = document.createElement("button");
    this.backButton.type = "button";
    this.backButton.className = "gc-rc-back";
    this.backButton.textContent = "BACK";
    this.backButton.style.cssText = BACK_STYLE;
    this.backButton.addEventListener("click", () => this.back());
    this.backButton.addEventListener("mouseenter", () => this.audio.uiBeep("hover"));

    this.root = document.createElement("div");
    this.root.style.cssText = ROOT_STYLE;
    this.root.append(style, title, rowsWrap, hints, this.confirmButton, this.backButton);

    // Left/Right cycle the focused row, Enter confirms, Escape backs out.
    // preventDefault on the arrows stops page scroll; on Enter it also cancels
    // the native focused-button click so confirm runs once (the `finished`
    // guard covers the rest). The display guard keeps a hidden overlay inert
    // (e.g. while kart-select is open). MenuNav owns ArrowUp/Down focus +
    // gamepad; this owns the rest.
    this.onKeydown = (e: KeyboardEvent) => {
      if (this.root.style.display === "none") return;
      switch (e.code) {
        case "ArrowLeft":
          e.preventDefault();
          this.cycleFocused(-1);
          break;
        case "ArrowRight":
          e.preventDefault();
          this.cycleFocused(1);
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

  /** Cycle the row that currently holds focus (no-op for buttons/no focus). */
  private cycleFocused(dir: 1 | -1): void {
    const el = document.activeElement as HTMLElement | null;
    const i = this.rowEls.indexOf(el as HTMLDivElement);
    if (i >= 0) this.cycleRow(i, dir);
  }

  /**
   * Wrap-around advance of a row's index. SPEED (row 2) is a no-op while MODE
   * is static. After a real change: beep, re-render, fire onApply (live sky
   * preview). Finished ignores.
   */
  private cycleRow(rowIndex: number, dir: 1 | -1): void {
    if (this.finished) return;
    if (rowIndex === 2 && MODE_VALUES[this.modeIndex] === "static") return;
    const len =
      rowIndex === 0
        ? MODE_VALUES.length
        : rowIndex === 1
          ? PHASE_VALUES.length
          : SPEED_VALUES.length;
    const cur =
      rowIndex === 0 ? this.modeIndex : rowIndex === 1 ? this.phaseIndex : this.speedIndex;
    const next = (((cur + dir) % len) + len) % len;
    if (rowIndex === 0) this.modeIndex = next;
    else if (rowIndex === 1) this.phaseIndex = next;
    else this.speedIndex = next;
    this.audio.uiBeep("beep");
    this.render();
    this.opts.onApply(this.buildConfig());
  }

  /** Assemble the current selection into a TimeOfDayConfig. */
  private buildConfig(): TimeOfDayConfig {
    return {
      mode: MODE_VALUES[this.modeIndex]!,
      phase: PHASE_VALUES[this.phaseIndex]!,
      dayLengthSeconds: SPEED_PRESETS[SPEED_VALUES[this.speedIndex]!],
    };
  }

  /** Sync each row's value text + dim the SPEED row while MODE is static. */
  private render(): void {
    this.modeValue.textContent = MODE_LABELS[this.modeIndex];
    this.timeValue.textContent = PHASE_LABELS[this.phaseIndex];
    this.speedValue.textContent = SPEED_LABELS[this.speedIndex];
    const speedLocked = MODE_VALUES[this.modeIndex] === "static";
    this.speedRow.style.opacity = speedLocked ? "0.4" : "1";
  }

  /** Idempotent confirm: first caller wins, later calls are no-ops. */
  private confirm(): void {
    if (this.finished) return;
    this.finished = true;
    this.audio.uiBeep("click");
    this.opts.onConfirm(this.buildConfig());
  }

  /** Idempotent back: first caller wins, later calls are no-ops. */
  private back(): void {
    if (this.finished) return;
    this.finished = true;
    this.audio.uiBeep("click");
    this.opts.onBack();
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
      elements: () => [
        this.modeRow,
        this.timeRow,
        this.speedRow,
        this.confirmButton,
        this.backButton,
      ],
      onHorizontal: (dir, el) => {
        const i = this.rowEls.indexOf(el as HTMLDivElement);
        if (i >= 0) this.cycleRow(i, dir);
      },
    });
    this.nav.start();
  }

  private stopNav(): void {
    this.nav?.dispose();
    this.nav = null;
  }
}
