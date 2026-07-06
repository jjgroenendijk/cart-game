/**
 * 012 settings v1 DOM overlay. Plain HTMLElements + cssText (no assets),
 * mirroring StartMenu/Countdown/PauseOverlay. Three labeled range sliders
 * (MASTER/MUSIC/SFX), a MUTE checkbox, and a BACK button. Every slider drag
 * or checkbox toggle fires onChange with the full updated SettingsState so
 * Game can live-apply + persist; BACK fires onBack.
 *
 * Built hidden (root display none). show(state?) refreshes the controls from
 * the passed state first, then reveals. Game owns the settings state + opens
 * this overlay from the StartMenu SETTINGS button or the Pause SETTINGS
 * button; Esc in Game closes it via the isVisible getter.
 *
 * Audio taken as the MenuAudio interface (uiBeep) so the overlay is
 * unit-testable with a stub and stays decoupled from AudioManager.
 */

import type { MenuAudio } from "./StartMenu";
import type { SettingsState } from "../core/settings";
import { MenuNav } from "./menuNav";
import {
  INK,
  MENU_CSS,
  cornerMark,
  displayHeading,
  hairlineRule,
  kickerLabel,
  kickerRow,
  styleMenuButton,
  vignetteLayer,
} from "./menuStyles";

export interface SettingsCallbacks {
  /** Fired with the full updated state on EVERY slider/checkbox change. */
  onChange: (settings: SettingsState) => void;
  onBack: () => void;
}

// z-index 10 + dim backdrop per 012 Defaults (matches PauseOverlay).
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
  "gap:12px",
  "background:rgba(0,0,0,0.55)",
  "font-family:system-ui,sans-serif",
  `color:${INK}`,
  "pointer-events:none",
  "text-align:center",
  "text-shadow:0 2px 10px rgba(0,0,0,0.85)",
].join(";");

// Editorial header stack (072): AUDIO kicker over a serif "Settings" heading.
const HEADER_STYLE = [
  "display:flex",
  "flex-direction:column",
  "align-items:center",
  "gap:12px",
].join(";");

// Row: label + range + readout (or checkbox + label). pointer-events none on
// the row itself; the interactive child opts back into auto.
const ROW_STYLE = [
  "display:flex",
  "flex-direction:row",
  "align-items:center",
  "gap:12px",
  "font-size:16px",
  "font-weight:700",
  "letter-spacing:1px",
].join(";");

const LABEL_STYLE = ["min-width:64px", "text-align:right"].join(";");

const RANGE_STYLE = [
  "pointer-events:auto",
  "width:clamp(140px,24vw,260px)",
  `accent-color:${INK}`,
  "cursor:pointer",
].join(";");

const READOUT_STYLE = ["min-width:44px", "text-align:left", "opacity:0.9"].join(";");

const CHECKBOX_STYLE = [
  "pointer-events:auto",
  "width:20px",
  "height:20px",
  `accent-color:${INK}`,
  "cursor:pointer",
].join(";");

// BACK: muted secondary, mirrors the PauseOverlay secondary cue.
// BACK visuals come from the shared menuStyles kit (070, secondary kind);
// hover/active/focus rules ride in via MENU_CSS.
const BACK_EXTRA = ["padding:8px 22px", "border-radius:10px"];

/** Format a range value string as a rounded percentage readout. */
function pct(v: string): string {
  const n = parseFloat(v);
  return `${Math.round((Number.isFinite(n) ? n : 0) * 100)}%`;
}

export class SettingsOverlay {
  private readonly root: HTMLElement;
  private readonly audio: MenuAudio;
  private readonly master: HTMLInputElement;
  private readonly music: HTMLInputElement;
  private readonly sfx: HTMLInputElement;
  private readonly mute: HTMLInputElement;
  private readonly positional: HTMLInputElement;
  private readonly hrtf: HTMLInputElement;
  private readonly masterReadout: HTMLSpanElement;
  private readonly musicReadout: HTMLSpanElement;
  private readonly sfxReadout: HTMLSpanElement;
  private readonly back: HTMLButtonElement;
  private readonly cb: SettingsCallbacks;
  private nav: MenuNav | null = null;

  constructor(
    container: HTMLElement,
    audio: MenuAudio,
    initial: SettingsState,
    cb: SettingsCallbacks,
  ) {
    this.audio = audio;
    this.cb = cb;

    const style = document.createElement("style");
    style.textContent = MENU_CSS;

    const header = this.buildHeader();

    const master = this.makeSliderRow("MASTER", "gc-settings-master", initial.masterVolume);
    const music = this.makeSliderRow("MUSIC", "gc-settings-music", initial.musicVolume);
    const sfx = this.makeSliderRow("SFX", "gc-settings-sfx", initial.sfxVolume);
    this.master = master.input;
    this.music = music.input;
    this.sfx = sfx.input;
    this.masterReadout = master.readout;
    this.musicReadout = music.readout;
    this.sfxReadout = sfx.readout;

    const muteRow = document.createElement("div");
    muteRow.style.cssText = ROW_STYLE;
    const muteBox = document.createElement("input");
    muteBox.type = "checkbox";
    muteBox.className = "gc-settings-mute";
    muteBox.checked = initial.muted;
    muteBox.style.cssText = CHECKBOX_STYLE;
    muteBox.addEventListener("change", () => this.emit());
    const muteLab = document.createElement("span");
    muteLab.textContent = "MUTE";
    muteLab.style.cssText = LABEL_STYLE;
    muteRow.append(muteBox, muteLab);
    this.mute = muteBox;

    const positionalRow = document.createElement("div");
    positionalRow.style.cssText = ROW_STYLE;
    const positionalBox = document.createElement("input");
    positionalBox.type = "checkbox";
    positionalBox.className = "gc-settings-positional";
    positionalBox.checked = initial.positionalAudio;
    positionalBox.style.cssText = CHECKBOX_STYLE;
    positionalBox.addEventListener("change", () => this.emit());
    const positionalLab = document.createElement("span");
    positionalLab.textContent = "POSITIONAL AUDIO";
    positionalLab.style.cssText = LABEL_STYLE;
    positionalRow.append(positionalBox, positionalLab);
    this.positional = positionalBox;

    const hrtfRow = document.createElement("div");
    hrtfRow.style.cssText = ROW_STYLE;
    const hrtfBox = document.createElement("input");
    hrtfBox.type = "checkbox";
    hrtfBox.className = "gc-settings-hrtf";
    hrtfBox.checked = initial.hrtf;
    hrtfBox.style.cssText = CHECKBOX_STYLE;
    hrtfBox.addEventListener("change", () => this.emit());
    const hrtfLab = document.createElement("span");
    hrtfLab.textContent = "HRTF";
    hrtfLab.style.cssText = LABEL_STYLE;
    hrtfRow.append(hrtfBox, hrtfLab);
    this.hrtf = hrtfBox;

    const back = document.createElement("button");
    back.type = "button";
    back.className = "gc-settings-back";
    back.textContent = "BACK";
    styleMenuButton(back, "secondary", BACK_EXTRA);
    back.addEventListener("click", () => {
      this.audio.uiBeep("click");
      this.cb.onBack();
    });
    back.addEventListener("mouseenter", () => this.audio.uiBeep("hover"));
    this.back = back;

    this.root = document.createElement("div");
    this.root.style.cssText = ROOT_STYLE;
    this.root.style.display = "none";
    // Decorative editorial layers first (behind), then the content stack. Grain
    // is omitted here to keep the slider tracks + readouts crisp.
    const vignette = document.createElement("div");
    vignette.style.cssText = vignetteLayer();
    this.root.append(style, vignette);
    for (const c of ["tl", "tr", "bl", "br"] as const) {
      const mark = document.createElement("div");
      mark.style.cssText = cornerMark(c, 28);
      this.root.append(mark);
    }
    this.root.append(header, master.row, music.row, sfx.row, muteRow, positionalRow, hrtfRow, back);

    container.appendChild(this.root);
  }

  /** Editorial header: AUDIO kicker over a serif "Settings" heading + rule. */
  private buildHeader(): HTMLElement {
    const kicker = document.createElement("div");
    kicker.className = "gc-settings-kicker";
    kicker.style.cssText = kickerRow();
    const kickerLine = document.createElement("span");
    kickerLine.style.cssText = hairlineRule(28);
    const kickerText = document.createElement("span");
    kickerText.textContent = "AUDIO";
    kickerText.style.cssText = kickerLabel();
    kicker.append(kickerLine, kickerText);

    const title = document.createElement("h1");
    title.className = "gc-settings-title";
    title.textContent = "Settings";
    title.style.cssText = displayHeading();

    const divider = document.createElement("div");
    divider.style.cssText = hairlineRule(56);

    const header = document.createElement("div");
    header.className = "gc-settings-header";
    header.style.cssText = HEADER_STYLE;
    header.append(kicker, title, divider);
    return header;
  }

  /** Build a label + range + readout row; wires input -> emit. */
  private makeSliderRow(
    label: string,
    className: string,
    value: number,
  ): { row: HTMLElement; input: HTMLInputElement; readout: HTMLSpanElement } {
    const row = document.createElement("div");
    row.style.cssText = ROW_STYLE;

    const lab = document.createElement("span");
    lab.textContent = label;
    lab.style.cssText = LABEL_STYLE;

    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "1";
    input.step = "0.01";
    input.value = String(value);
    input.className = className;
    input.style.cssText = RANGE_STYLE;
    input.addEventListener("input", () => this.emit());

    const readout = document.createElement("span");
    readout.textContent = pct(input.value);
    readout.style.cssText = READOUT_STYLE;

    row.append(lab, input, readout);
    return { row, input, readout };
  }

  /** Read the DOM, refresh readouts, beep, and push the new state out. */
  private emit(): void {
    this.masterReadout.textContent = pct(this.master.value);
    this.musicReadout.textContent = pct(this.music.value);
    this.sfxReadout.textContent = pct(this.sfx.value);
    this.audio.uiBeep("click");
    this.cb.onChange({
      masterVolume: parseFloat(this.master.value),
      musicVolume: parseFloat(this.music.value),
      sfxVolume: parseFloat(this.sfx.value),
      muted: this.mute.checked,
      positionalAudio: this.positional.checked,
      hrtf: this.hrtf.checked,
    });
  }

  /** Repopulate the sliders + checkbox + readouts from a state. */
  private refresh(s: SettingsState): void {
    this.master.value = String(s.masterVolume);
    this.music.value = String(s.musicVolume);
    this.sfx.value = String(s.sfxVolume);
    this.mute.checked = s.muted;
    this.positional.checked = s.positionalAudio;
    this.hrtf.checked = s.hrtf;
    this.masterReadout.textContent = pct(this.master.value);
    this.musicReadout.textContent = pct(this.music.value);
    this.sfxReadout.textContent = pct(this.sfx.value);
  }

  get isVisible(): boolean {
    return this.root.style.display !== "none";
  }

  show(state?: SettingsState): void {
    if (state) this.refresh(state);
    this.root.style.display = "flex";
    this.startNav();
  }

  hide(): void {
    this.root.style.display = "none";
    this.stopNav();
  }

  /** Detach the overlay from the DOM. */
  remove(): void {
    this.stopNav();
    this.root.remove();
  }

  private startNav(): void {
    if (this.nav) return;
    this.nav = new MenuNav({
      elements: () => [
        this.master,
        this.music,
        this.sfx,
        this.mute,
        this.positional,
        this.hrtf,
        this.back,
      ],
      onHorizontal: (dir, el) => this.stepSlider(el, dir),
    });
    this.nav.start();
  }

  private stopNav(): void {
    this.nav?.dispose();
    this.nav = null;
  }

  /** Step a range slider by +/-0.1 (clamped to [0,1]) + emit so onChange fires. */
  private stepSlider(el: HTMLElement, dir: 1 | -1): void {
    if (!(el instanceof HTMLInputElement) || el.type !== "range") return;
    const v = Math.min(1, Math.max(0, parseFloat(el.value) + dir * 0.1));
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}
