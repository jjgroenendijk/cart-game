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

export interface SettingsCallbacks {
  /** Fired with the full updated state on EVERY slider/checkbox change. */
  onChange: (settings: SettingsState) => void;
  onBack: () => void;
}

// z-index 10 + dim backdrop per 012 Defaults (matches PauseOverlay).
const ROOT_STYLE = [
  "position:absolute",
  "inset:0",
  "z-index:10",
  "display:flex",
  "flex-direction:column",
  "align-items:center",
  "justify-content:center",
  "gap:12px",
  "background:rgba(0,0,0,0.55)",
  "font-family:system-ui,sans-serif",
  "color:#fff",
  "pointer-events:none",
  "text-align:center",
  "text-shadow:0 2px 10px rgba(0,0,0,0.85)",
].join(";");

const TITLE_STYLE = [
  "margin:0",
  "font-size:clamp(26px,5vw,48px)",
  "font-weight:800",
  "letter-spacing:3px",
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
  "accent-color:#ffd23f",
  "cursor:pointer",
].join(";");

const READOUT_STYLE = ["min-width:44px", "text-align:left", "opacity:0.9"].join(";");

const CHECKBOX_STYLE = [
  "pointer-events:auto",
  "width:20px",
  "height:20px",
  "accent-color:#ffd23f",
  "cursor:pointer",
].join(";");

// BACK: muted secondary, mirrors the PauseOverlay secondary cue.
const BACK_STYLE = [
  "pointer-events:auto",
  "font-family:inherit",
  "font-size:16px",
  "font-weight:700",
  "letter-spacing:1px",
  "color:#0b0f14",
  "background:#9ad0ff",
  "border:none",
  "border-radius:10px",
  "padding:8px 22px",
  "cursor:pointer",
  "box-shadow:0 4px 0 #5a9fd6,0 6px 16px rgba(0,0,0,0.4)",
  "transition:transform 0.08s ease,box-shadow 0.08s ease",
].join(";");

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
  private readonly masterReadout: HTMLSpanElement;
  private readonly musicReadout: HTMLSpanElement;
  private readonly sfxReadout: HTMLSpanElement;
  private readonly cb: SettingsCallbacks;

  constructor(
    container: HTMLElement,
    audio: MenuAudio,
    initial: SettingsState,
    cb: SettingsCallbacks,
  ) {
    this.audio = audio;
    this.cb = cb;

    const title = document.createElement("h1");
    title.textContent = "SETTINGS";
    title.style.cssText = TITLE_STYLE;

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

    const back = document.createElement("button");
    back.type = "button";
    back.className = "gc-settings-back";
    back.textContent = "BACK";
    back.style.cssText = BACK_STYLE;
    back.addEventListener("click", () => {
      this.audio.uiBeep("click");
      this.cb.onBack();
    });
    back.addEventListener("mouseenter", () => this.audio.uiBeep("hover"));

    this.root = document.createElement("div");
    this.root.style.cssText = ROOT_STYLE;
    this.root.style.display = "none";
    this.root.append(title, master.row, music.row, sfx.row, muteRow, back);

    container.appendChild(this.root);
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
    });
  }

  /** Repopulate the sliders + checkbox + readouts from a state. */
  private refresh(s: SettingsState): void {
    this.master.value = String(s.masterVolume);
    this.music.value = String(s.musicVolume);
    this.sfx.value = String(s.sfxVolume);
    this.mute.checked = s.muted;
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
  }

  hide(): void {
    this.root.style.display = "none";
  }

  /** Detach the overlay from the DOM. */
  remove(): void {
    this.root.remove();
  }
}
