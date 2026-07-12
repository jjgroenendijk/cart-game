/**
 * 042 race-setup DOM overlay. Pre-race sky config screen between the start
 * menu and kart-select: MODE (static/dynamic), TIME (phase), SPEED (day
 * cycle length), WEATHER (054 auto/clear/rain/snow/storm). Each row is a
 * focusable editorial telemetry line with a `◀ value ▶` cluster: left/right
 * keys, chevron taps, and row clicks all cycle the value and fire onApply so
 * Game can drive a live sky preview via setTimeOfDay; WEATHER fires
 * onWeatherApply (live weather preview via setWeatherMode); CONFIRM fires
 * onConfirm, BACK/Escape fires onBack. The SPEED row dims and is locked while
 * MODE is static (a static sky has no cycle speed); WEATHER is never locked.
 *
 * Mirrors KartSelectOverlay: plain HTMLElements + cssText + a tiny injected
 * <style>, an own keydown handler guarded on root display so a hidden overlay
 * is inert, CONFIRM/BACK buttons with hover/active transforms, and a MenuNav
 * started on show / disposed on hide+remove. MenuNav owns ArrowUp/Down focus
 * across [mode, time, speed, weather, confirm, back] + gamepad; gamepad horizontal
 * cycles the focused row. This handler owns ArrowLeft/Right (cycle focused
 * row), Enter (confirm), Escape (back). A `finished` guard makes double-
 * confirm / double-back a no-op.
 */

import { MenuNav } from "./menuNav";
import { type MenuAudio } from "./StartMenu";
import {
  MENU_CSS,
  displayHeading,
  hairlineRule,
  hintRowStyle,
  kickerLabel,
  kickerRow,
  mountEditorialFrame,
  overlayRootStyle,
  overlayScrollerStyle,
  selectorChevronStyle,
  selectorRowStyle,
  selectorValueStyle,
  styleMenuButton,
  telemetryKey,
} from "./menuStyles";
import {
  SPEED_PRESETS,
  type TimeOfDayConfig,
  type TimeOfDayMode,
  type TimeOfDayPhase,
  type TimeOfDaySpeed,
} from "../core/timeOfDayConfig";
import {
  DEFAULT_WEATHER_MODE,
  WEATHER_MODE_LABELS,
  WEATHER_MODE_VALUES,
  type WeatherChoice,
} from "../core/weatherConfig";

export interface RaceConfigOverlayOptions {
  initial: TimeOfDayConfig;
  onApply: (config: TimeOfDayConfig) => void;
  onConfirm: (config: TimeOfDayConfig) => void;
  onBack: () => void;
  /** 054: initial weather row value (default DEFAULT_WEATHER_MODE). */
  initialWeather?: WeatherChoice;
  /** 054: live weather preview (no rebuild); default no-op. */
  onWeatherApply?: (mode: WeatherChoice) => void;
}

const MODE_VALUES: TimeOfDayMode[] = ["static", "dynamic"];
const MODE_LABELS = ["STATIC", "DYNAMIC"];
const PHASE_VALUES: TimeOfDayPhase[] = ["dawn", "morning", "noon", "afternoon", "dusk", "night"];
const PHASE_LABELS = ["DAWN", "MORNING", "NOON", "AFTERNOON", "DUSK", "NIGHT"];
const SPEED_VALUES: TimeOfDaySpeed[] = ["slow", "normal", "fast"];
const SPEED_LABELS = ["SLOW", "NORMAL", "FAST"];

// Editorial header stack (072): RACE SETUP kicker over a serif heading.
const HEADER_STYLE = [
  "display:flex",
  "flex-direction:column",
  "align-items:center",
  "gap:12px",
].join(";");

// Hairline-topped rows read as one telemetry table; the wrap's bottom
// hairline closes the last row.
const ROWS_WRAP_STYLE = [
  "display:flex",
  "flex-direction:column",
  "width:min(400px,92vw)",
  "border-bottom:1px solid rgba(238,242,247,0.22)",
].join(";");

// Value between its chevrons; fixed min width so cycling does not jitter.
const ROW_VALUE_EXTRA = ["min-width:104px", "text-align:center"].join(";");

// Button visuals come from the shared menuStyles kit (070); hover/active/
// focus rules ride in via MENU_CSS. Rows carry gc-row for the shared
// hover/focus ring.
const BUTTON_EXTRA = ["font-size:18px", "padding:10px 30px"];

const ACTIONS_STYLE = ["display:flex", "flex-wrap:wrap", "justify-content:center", "gap:12px"].join(
  ";",
);

/**
 * One selector row: tracked label left, a `◀ value ▶` cluster right.
 * Chevron clicks cycle that direction (mouse/touch parity with the arrow
 * keys); clicking the row body cycles forward. The row is the focus unit;
 * chevrons stay tabIndex -1 (mouse-only).
 */
function makeRow(
  label: string,
  className: string,
  cycle: (dir: 1 | -1) => void,
): { row: HTMLDivElement; value: HTMLSpanElement } {
  const row = document.createElement("div");
  row.className = `gc-row gc-rc-row gc-rc-${className}`;
  row.tabIndex = 0;
  row.style.cssText = selectorRowStyle();
  row.addEventListener("click", () => cycle(1));

  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  labelEl.style.cssText = telemetryKey();

  const value = document.createElement("span");
  value.className = `gc-rc-${className}-value`;
  value.style.cssText = selectorValueStyle() + ";" + ROW_VALUE_EXTRA;

  const chevron = (dir: 1 | -1, cls: string, text: string): HTMLButtonElement => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `gc-chevron ${cls}`;
    btn.tabIndex = -1;
    btn.textContent = text;
    btn.style.cssText = selectorChevronStyle();
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      cycle(dir);
    });
    return btn;
  };

  const cluster = document.createElement("div");
  cluster.style.cssText = "display:inline-flex;align-items:center;gap:8px";
  cluster.append(
    chevron(-1, `gc-rc-${className}-prev`, "◀"),
    value,
    chevron(1, `gc-rc-${className}-next`, "▶"),
  );

  row.append(labelEl, cluster);
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
  private readonly weatherRow: HTMLDivElement;
  private readonly modeValue: HTMLSpanElement;
  private readonly timeValue: HTMLSpanElement;
  private readonly speedValue: HTMLSpanElement;
  private readonly weatherValue: HTMLSpanElement;
  private readonly confirmButton: HTMLButtonElement;
  private readonly backButton: HTMLButtonElement;
  private readonly rowEls: HTMLDivElement[];
  private modeIndex = 0;
  private phaseIndex = 0;
  private speedIndex = 0;
  private weatherIndex = 0;
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
    const wInit = opts.initialWeather ?? DEFAULT_WEATHER_MODE;
    this.weatherIndex = Math.max(0, WEATHER_MODE_VALUES.indexOf(wInit));

    const style = document.createElement("style");
    style.textContent = MENU_CSS;

    const header = this.buildHeader();

    const modeRow = makeRow("MODE", "mode", (dir) => this.cycleRow(0, dir));
    const timeRow = makeRow("TIME", "time", (dir) => this.cycleRow(1, dir));
    const speedRow = makeRow("SPEED", "speed", (dir) => this.cycleRow(2, dir));
    const weatherRow = makeRow("WEATHER", "weather", (dir) => this.cycleRow(3, dir));
    this.modeRow = modeRow.row;
    this.timeRow = timeRow.row;
    this.speedRow = speedRow.row;
    this.weatherRow = weatherRow.row;
    this.modeValue = modeRow.value;
    this.timeValue = timeRow.value;
    this.speedValue = speedRow.value;
    this.weatherValue = weatherRow.value;
    this.rowEls = [this.modeRow, this.timeRow, this.speedRow, this.weatherRow];

    const rowsWrap = document.createElement("div");
    rowsWrap.style.cssText = ROWS_WRAP_STYLE;
    rowsWrap.append(this.modeRow, this.timeRow, this.speedRow, this.weatherRow);

    const hints = document.createElement("div");
    hints.className = "gc-kb-hints";
    hints.style.cssText = hintRowStyle();
    for (const text of ["< / > CHANGE", "^ / v ROW", "ENTER CONFIRM", "ESC BACK"]) {
      const span = document.createElement("span");
      span.textContent = text;
      hints.appendChild(span);
    }

    this.confirmButton = document.createElement("button");
    this.confirmButton.type = "button";
    this.confirmButton.className = "gc-rc-confirm";
    this.confirmButton.textContent = "CONFIRM";
    styleMenuButton(this.confirmButton, "primary", BUTTON_EXTRA);
    this.confirmButton.addEventListener("click", () => this.confirm());
    this.confirmButton.addEventListener("mouseenter", () => this.audio.uiBeep("hover"));

    this.backButton = document.createElement("button");
    this.backButton.type = "button";
    this.backButton.className = "gc-rc-back";
    this.backButton.textContent = "BACK";
    styleMenuButton(this.backButton, "secondary", BUTTON_EXTRA);
    this.backButton.addEventListener("click", () => this.back());
    this.backButton.addEventListener("mouseenter", () => this.audio.uiBeep("hover"));

    const actions = document.createElement("div");
    actions.style.cssText = ACTIONS_STYLE;
    actions.append(this.backButton, this.confirmButton);

    this.root = document.createElement("div");
    this.root.style.cssText = overlayRootStyle();
    // Editorial frame first (behind), then the scroll-safe content column.
    // Grain is omitted here to keep the selector rows crisp.
    this.root.append(style);
    mountEditorialFrame(this.root);
    const scroller = document.createElement("div");
    scroller.style.cssText = overlayScrollerStyle(16);
    scroller.append(header, rowsWrap, hints, actions);
    this.root.append(scroller);

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

  /** Editorial header: RACE SETUP kicker over a serif "Conditions" heading. */
  private buildHeader(): HTMLElement {
    const kicker = document.createElement("div");
    kicker.className = "gc-rc-kicker";
    kicker.style.cssText = kickerRow();
    const kickerLine = document.createElement("span");
    kickerLine.style.cssText = hairlineRule(28);
    const kickerText = document.createElement("span");
    kickerText.textContent = "RACE SETUP";
    kickerText.style.cssText = kickerLabel();
    kicker.append(kickerLine, kickerText);

    const title = document.createElement("h2");
    title.className = "gc-rc-title";
    title.textContent = "Conditions";
    title.style.cssText = displayHeading();

    const divider = document.createElement("div");
    divider.style.cssText = hairlineRule(56);

    const header = document.createElement("div");
    header.className = "gc-rc-header";
    header.style.cssText = HEADER_STYLE;
    header.append(kicker, title, divider);
    return header;
  }

  /** Cycle the row that currently holds focus (no-op for buttons/no focus). */
  private cycleFocused(dir: 1 | -1): void {
    const el = document.activeElement as HTMLElement | null;
    const i = this.rowEls.indexOf(el as HTMLDivElement);
    if (i >= 0) this.cycleRow(i, dir);
  }

  /**
   * Wrap-around advance of a row's index. SPEED (row 2) is a no-op while MODE
   * is static. WEATHER (row 3) is always cycleable. After a real change: beep,
   * re-render, fire onApply (live sky preview) and for WEATHER onWeatherApply
   * (live weather preview). Finished ignores.
   */
  private cycleRow(rowIndex: number, dir: 1 | -1): void {
    if (this.finished) return;
    if (rowIndex === 2 && MODE_VALUES[this.modeIndex] === "static") return;
    const len =
      rowIndex === 0
        ? MODE_VALUES.length
        : rowIndex === 1
          ? PHASE_VALUES.length
          : rowIndex === 2
            ? SPEED_VALUES.length
            : WEATHER_MODE_VALUES.length;
    const cur =
      rowIndex === 0
        ? this.modeIndex
        : rowIndex === 1
          ? this.phaseIndex
          : rowIndex === 2
            ? this.speedIndex
            : this.weatherIndex;
    const next = (((cur + dir) % len) + len) % len;
    if (rowIndex === 0) this.modeIndex = next;
    else if (rowIndex === 1) this.phaseIndex = next;
    else if (rowIndex === 2) this.speedIndex = next;
    else this.weatherIndex = next;
    this.audio.uiBeep("beep");
    this.render();
    if (rowIndex === 3) {
      this.opts.onWeatherApply?.(WEATHER_MODE_VALUES[this.weatherIndex]!);
    } else {
      this.opts.onApply(this.buildConfig());
    }
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
    this.weatherValue.textContent = WEATHER_MODE_LABELS[this.weatherIndex];
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
        this.weatherRow,
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
