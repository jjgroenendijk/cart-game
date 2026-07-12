/**
 * 012 settings v1 DOM overlay. Plain HTMLElements + cssText (no assets),
 * mirroring StartMenu/Countdown/PauseOverlay. One editorial telemetry table
 * sectioned by kicker eyebrows: MIX (MASTER/MUSIC/SFX sliders + MUTE),
 * SPATIAL (POSITIONAL/HRTF), EFFECTS (159 SUN HALO / GOD RAYS / LENS FLARE
 * toggles), and a BACK button. Checkbox rows are <label> elements (tap
 * anywhere toggles). Every slider drag or checkbox toggle fires onChange with
 * the full updated SettingsState so Game can live-apply + persist; BACK fires
 * onBack.
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
  MENU_ACCENT,
  MENU_CSS,
  displayHeading,
  hairlineRule,
  kickerLabel,
  kickerRow,
  mountEditorialFrame,
  overlayRootStyle,
  overlayScrollerStyle,
  selectorValueStyle,
  styleMenuButton,
  telemetryKey,
} from "./menuStyles";

export interface SettingsCallbacks {
  /** Fired with the full updated state on EVERY slider/checkbox change. */
  onChange: (settings: SettingsState) => void;
  onBack: () => void;
}

// Editorial header stack (072): TUNING kicker over a serif "Settings" heading.
const HEADER_STYLE = [
  "display:flex",
  "flex-direction:column",
  "align-items:center",
  "gap:12px",
].join(";");

// Hairline-topped rows read as one telemetry table (mirrors RaceConfig);
// the wrap's bottom hairline closes the last row.
const ROWS_WRAP_STYLE = [
  "display:flex",
  "flex-direction:column",
  "width:min(400px,92vw)",
  "border-bottom:1px solid rgba(238,242,247,0.22)",
  "text-align:left",
].join(";");

// One setting line: tracked label left, control (range+readout or checkbox)
// right. Checkbox rows are <label> elements so tapping anywhere toggles.
const ROW_STYLE = [
  "display:flex",
  "align-items:center",
  "justify-content:space-between",
  "gap:16px",
  "border-top:1px solid rgba(238,242,247,0.22)",
  "width:100%",
  "box-sizing:border-box",
  "padding:12px 6px",
  "pointer-events:auto",
].join(";");

const RANGE_STYLE = [
  "pointer-events:auto",
  "flex:1",
  "min-width:0",
  "max-width:260px",
  `accent-color:${INK}`,
  "cursor:pointer",
].join(";");

const READOUT_EXTRA = ["min-width:48px", "text-align:right"].join(";");

const CHECKBOX_STYLE = [
  "pointer-events:auto",
  "width:20px",
  "height:20px",
  `accent-color:${INK}`,
  "cursor:pointer",
  "margin:0",
].join(";");

// Section eyebrow spacing inside the rows column.
const SECTION_EXTRA = "margin-top:16px;padding-bottom:6px";

// BACK visuals come from the shared menuStyles kit (070, secondary kind);
// hover/active/focus rules ride in via MENU_CSS.
const BACK_EXTRA = ["padding:10px 26px"];

// Focus ring for the naked inputs (MenuNav drives focus onto them) + a soft
// row hover; touch gets bigger checkbox targets.
const LOCAL_CSS = `
.gc-set-row:hover { background: rgba(238, 242, 247, 0.04); }
.gc-set-row input:focus { outline: 3px solid ${MENU_ACCENT}; outline-offset: 2px; }
@media (pointer: coarse) {
  .gc-set-row input[type="checkbox"] { width: 26px; height: 26px; }
}
`;

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
  private readonly sunHalo: HTMLInputElement;
  private readonly godRays: HTMLInputElement;
  private readonly lensFlare: HTMLInputElement;
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
    style.textContent = MENU_CSS + LOCAL_CSS;

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

    const mute = this.makeCheckboxRow("MUTE", "gc-settings-mute", initial.muted);
    const positional = this.makeCheckboxRow(
      "POSITIONAL AUDIO",
      "gc-settings-positional",
      initial.positionalAudio,
    );
    const hrtf = this.makeCheckboxRow("HRTF", "gc-settings-hrtf", initial.hrtf);
    this.mute = mute.input;
    this.positional = positional.input;
    this.hrtf = hrtf.input;

    // 159 EFFECTS group: one checkbox per analytic sun light effect. Each
    // toggle fires the same emit() so Game live-applies + persists the flags.
    const halo = this.makeCheckboxRow("SUN HALO", "gc-settings-halo", initial.effects.sunHalo);
    const rays = this.makeCheckboxRow("GOD RAYS", "gc-settings-godrays", initial.effects.godRays);
    const flare = this.makeCheckboxRow(
      "LENS FLARE",
      "gc-settings-flare",
      initial.effects.lensFlare,
    );
    this.sunHalo = halo.input;
    this.godRays = rays.input;
    this.lensFlare = flare.input;

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

    // One telemetry table, sectioned by kicker eyebrows: MIX (levels + mute),
    // SPATIAL (positional/HRTF), EFFECTS (159 sun-light toggles).
    const rowsWrap = document.createElement("div");
    rowsWrap.style.cssText = ROWS_WRAP_STYLE;
    rowsWrap.append(
      this.buildKicker("MIX"),
      master.row,
      music.row,
      sfx.row,
      mute.row,
      this.buildKicker("SPATIAL"),
      positional.row,
      hrtf.row,
      this.buildKicker("EFFECTS"),
      halo.row,
      rays.row,
      flare.row,
    );

    this.root = document.createElement("div");
    this.root.style.cssText = overlayRootStyle({ dim: true });
    this.root.style.display = "none";
    // Editorial frame first (behind), then the scroll-safe content column.
    // Grain is omitted here to keep the slider tracks + readouts crisp.
    this.root.append(style);
    mountEditorialFrame(this.root);
    const scroller = document.createElement("div");
    scroller.style.cssText = overlayScrollerStyle(14);
    scroller.append(header, rowsWrap, back);
    this.root.append(scroller);

    container.appendChild(this.root);
  }

  /** Editorial header: TUNING kicker over a serif "Settings" heading + rule. */
  private buildHeader(): HTMLElement {
    const kicker = document.createElement("div");
    kicker.className = "gc-settings-kicker";
    kicker.style.cssText = kickerRow();
    const kickerLine = document.createElement("span");
    kickerLine.style.cssText = hairlineRule(28);
    const kickerText = document.createElement("span");
    kickerText.textContent = "TUNING";
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

  /** Build a label-left / range+readout-right row; wires input -> emit. */
  private makeSliderRow(
    label: string,
    className: string,
    value: number,
  ): { row: HTMLElement; input: HTMLInputElement; readout: HTMLSpanElement } {
    const row = document.createElement("div");
    row.className = "gc-set-row";
    row.style.cssText = ROW_STYLE;

    const lab = document.createElement("span");
    lab.textContent = label;
    lab.style.cssText = telemetryKey();

    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "1";
    input.step = "0.01";
    input.value = String(value);
    input.className = className;
    input.style.cssText = RANGE_STYLE;
    input.addEventListener("input", () => this.emit());

    // Readout stays the input's next sibling (tests + screen-reader flow).
    const readout = document.createElement("span");
    readout.textContent = pct(input.value);
    readout.style.cssText = selectorValueStyle() + ";" + READOUT_EXTRA;

    row.append(lab, input, readout);
    return { row, input, readout };
  }

  /** Build a hairline + kicker eyebrow row (section divider). */
  private buildKicker(text: string): HTMLElement {
    const kicker = document.createElement("div");
    kicker.style.cssText = kickerRow() + ";" + SECTION_EXTRA;
    const line = document.createElement("span");
    line.style.cssText = hairlineRule(28);
    const label = document.createElement("span");
    label.textContent = text;
    label.style.cssText = kickerLabel();
    kicker.append(line, label);
    return kicker;
  }

  /**
   * Build a label-left / checkbox-right row; wires change -> emit. The row is
   * a <label> so clicking/tapping anywhere on the line toggles the box.
   */
  private makeCheckboxRow(
    label: string,
    className: string,
    checked: boolean,
  ): { row: HTMLElement; input: HTMLInputElement } {
    const row = document.createElement("label");
    row.className = "gc-set-row";
    row.style.cssText = ROW_STYLE + ";cursor:pointer";
    const lab = document.createElement("span");
    lab.textContent = label;
    lab.style.cssText = telemetryKey();
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = className;
    box.checked = checked;
    box.style.cssText = CHECKBOX_STYLE;
    box.addEventListener("change", () => this.emit());
    row.append(lab, box);
    return { row, input: box };
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
      effects: {
        sunHalo: this.sunHalo.checked,
        godRays: this.godRays.checked,
        lensFlare: this.lensFlare.checked,
      },
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
    this.sunHalo.checked = s.effects.sunHalo;
    this.godRays.checked = s.effects.godRays;
    this.lensFlare.checked = s.effects.lensFlare;
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
        this.sunHalo,
        this.godRays,
        this.lensFlare,
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
