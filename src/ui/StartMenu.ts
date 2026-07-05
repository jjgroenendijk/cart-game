/**
 * 006 start-menu DOM overlay, redesigned in 070. Plain HTMLElements + cssText
 * + one injected <style> (menuStyles.MENU_CSS + local keyframes); no asset
 * files. Built visible over the live 3D bg.
 *
 * Layout (072 editorial restyle): a kicker (hairline + tracked label) over a
 * serif masthead (italic "CART" accent) — the arcade gradient-shine title +
 * checkered ribbon are retired. Then a panel with START RACE (primary, first
 * focus) -> MODE selector row -> BIOME selector row -> SETTINGS (ghost). A
 * read-only SCENE telemetry block (MODE/BIOME/SEED) sits top-right, and a
 * bottom status bar (pulsing dot + READY kicker + controls hint) anchors the
 * base. Corner marks + a soft vignette + a film-grain layer frame the whole
 * overlay, biome-neutral. MODE and BIOME are RaceConfig-style `< value >` rows:
 * chevron clicks, row clicks,
 * ArrowLeft/Right on the focused row, and gamepad horizontal all cycle.
 * Cycling BIOME fires onBiomeChange so the menu preview world rebuilds live
 * (008 mode toggle + 025 biome buttons folded into these rows).
 *
 * Enter/Space activates the FOCUSED control: SETTINGS opens settings (012 —
 * previously Enter anywhere started the race, hijacking a focused SETTINGS);
 * any other focus target confirms START. onStart(mode, biome) fires exactly
 * once via a `started` guard; show() re-arms it after a Back.
 *
 * Audio is taken as a minimal interface (uiBeep only) so the overlay is
 * unit-testable with a stub and stays decoupled from the full AudioManager.
 */

import { MenuNav } from "./menuNav";
import { BIOMES, type BiomeId, resolveBiome } from "../terrain/biomes";
import { type CircuitId, DEFAULT_ID } from "../terrain/circuitCode";
import {
  CHEVRON_STYLE,
  MENU_CSS,
  PANEL_STYLE,
  SELECTOR_LABEL_STYLE,
  SELECTOR_ROW_STYLE,
  SELECTOR_VALUE_STYLE,
  styleMenuButton,
  cornerMark,
  displayAccent,
  displayHeading,
  grainLayer,
  hairlineRule,
  kickerLabel,
  kickerRow,
  statusDot,
  telemetryKey,
  telemetryRow,
  telemetryValue,
  vignetteLayer,
} from "./menuStyles";
import { SeedPicker } from "./SeedPicker";

/** Race mode selected on the start menu. */
export type GameMode = "1P" | "2P";

export interface MenuAudio {
  uiBeep(kind: "hover" | "click" | "beep" | "go"): void;
}

const MODE_VALUES: GameMode[] = ["1P", "2P"];
const MODE_LABELS = ["1 PLAYER", "2 PLAYERS"];

/** Controls list for the given mode (P2 arrows row appears only in 2P). */
function controlsHtml(mode: GameMode): string {
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
// at the same stacking level as the (now hidden) loading veil. position:relative
// anchors the absolute editorial layers (corner marks / vignette / grain /
// telemetry). overflow:hidden clips the full-bleed grain + vignette.
const ROOT_STYLE = [
  "position:absolute",
  "inset:0",
  "z-index:10",
  "overflow:hidden",
  "display:flex",
  "flex-direction:column",
  "align-items:center",
  "justify-content:center",
  "gap:26px",
  "font-family:system-ui,sans-serif",
  "color:#eef2f7",
  "pointer-events:none",
  "text-align:center",
  "text-shadow:0 2px 12px rgba(0,0,0,0.7)",
].join(";");

// Editorial serif masthead (072): displayHeading() + extra uppercase tracking.
// "CART" is the italic accent span. Keyframe-free — the arcade gradient-shine
// + float are retired.
const TITLE_EXTRA = ["letter-spacing:0.12em"].join(";");

const CONTROLS_STYLE = [
  "margin:0",
  "font-size:12px",
  "line-height:1.85",
  "letter-spacing:0.02em",
  "color:rgba(238,242,247,0.82)",
  "max-width:340px",
].join(";");

// Vertical bottom status bar: pulsing dot + READY kicker over the controls hint.
const STATUSBAR_STYLE = [
  "display:flex",
  "flex-direction:column",
  "align-items:center",
  "gap:12px",
].join(";");
const STATUS_LINE_STYLE = ["display:inline-flex", "align-items:center", "gap:8px"].join(";");

// Read-only scene telemetry, top-right. Non-interactive so it never blocks
// clicks on the panel behind it.
const TELEMETRY_STYLE = [
  "position:absolute",
  "top:clamp(16px,4vh,44px)",
  "right:clamp(16px,4vw,52px)",
  "display:flex",
  "flex-direction:column",
  "gap:2px",
  "min-width:148px",
  "pointer-events:none",
  "text-align:left",
].join(";");

const TELEMETRY_HEAD_STYLE = ["margin-bottom:4px"].join(";");

// Local keycap-chip treatment for the controls hint; MENU_CSS (hover/active/
// focus for gc-btn/gc-row/gc-chevron + gc-pulse) is prepended in the ctor.
// One <style> node, no external assets, no arcade keyframes.
const LOCAL_CSS = `
h1.gc-title { text-shadow: 0 3px 18px rgba(0, 0, 0, 0.6); }
.gc-controls b {
  display: inline-block;
  padding: 0 6px;
  border-radius: 3px;
  background: rgba(238, 242, 247, 0.08);
  border: 1px solid rgba(238, 242, 247, 0.18);
  font-weight: 600;
}
`;

/** One `LABEL  < value >` selector row: focusable div + chevrons + value. */
interface SelectorRow {
  row: HTMLDivElement;
  value: HTMLSpanElement;
}

export class StartMenu {
  private readonly root: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly settingsButton: HTMLButtonElement;
  private readonly modeRow: HTMLDivElement;
  private readonly modeValue: HTMLSpanElement;
  private readonly biomeRow: HTMLDivElement;
  private readonly biomeValue: HTMLSpanElement;
  private readonly modeTelemetry: HTMLSpanElement;
  private readonly biomeTelemetry: HTMLSpanElement;
  private readonly seedTelemetry: HTMLSpanElement;
  private readonly controls: HTMLElement;
  private readonly audio: MenuAudio;
  private readonly onStart: (mode: GameMode, biome: BiomeId) => void;
  private readonly onSettings?: () => void;
  private readonly onBiomeChange?: (biome: BiomeId) => void;
  private readonly onKeydown: (e: KeyboardEvent) => void;
  private readonly seedPicker: SeedPicker;
  private readonly onCircuitChange?: (id: CircuitId) => void;
  private readonly biomeDefs = Object.values(BIOMES);
  private started = false;
  private modeIndex = 0;
  private biomeIndex: number;
  private circuit: CircuitId;
  private nav: MenuNav | null = null;

  constructor(
    container: HTMLElement,
    audio: MenuAudio,
    onStart: (mode: GameMode, biome: BiomeId) => void,
    onSettings?: () => void,
    onBiomeChange?: (biome: BiomeId) => void,
    initialCircuit: CircuitId = DEFAULT_ID,
    onCircuitChange?: (id: CircuitId) => void,
  ) {
    this.audio = audio;
    this.onStart = onStart;
    this.onSettings = onSettings;
    this.onBiomeChange = onBiomeChange;
    this.circuit = initialCircuit;
    this.onCircuitChange = onCircuitChange;
    const defaultBiome = resolveBiome("temperate").id;
    this.biomeIndex = Math.max(
      0,
      this.biomeDefs.findIndex((d) => d.id === defaultBiome),
    );

    const style = document.createElement("style");
    style.textContent = MENU_CSS + LOCAL_CSS;

    // Kicker (leading hairline + tracked label) over a serif masthead with an
    // italic "CART" accent. textContent stays "GAME CART".
    const kicker = document.createElement("div");
    kicker.className = "gc-kicker";
    kicker.style.cssText = kickerRow();
    const kickerLine = document.createElement("span");
    kickerLine.style.cssText = hairlineRule(28);
    const kickerText = document.createElement("span");
    kickerText.textContent = "PROCEDURAL KART RACING";
    kickerText.style.cssText = kickerLabel();
    kicker.append(kickerLine, kickerText);

    const title = document.createElement("h1");
    title.className = "gc-title";
    title.style.cssText = displayHeading() + ";" + TITLE_EXTRA;
    title.append("GAME ");
    const accent = document.createElement("span");
    accent.className = "gc-title-accent";
    accent.textContent = "CART";
    accent.style.cssText = displayAccent();
    title.append(accent);

    const header = document.createElement("div");
    header.append(kicker, title);

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "gc-start";
    this.button.textContent = "START RACE";
    styleMenuButton(this.button, "primary", [
      "font-size:15px",
      "padding:15px 24px",
      "letter-spacing:0.22em",
      "width:100%",
    ]);
    this.button.addEventListener("click", () => this.confirm());
    this.button.addEventListener("mouseenter", () => this.audio.uiBeep("hover"));

    const mode = this.makeSelectorRow("MODE", "gc-mode", (dir) => this.cycleMode(dir));
    this.modeRow = mode.row;
    this.modeValue = mode.value;

    const biome = this.makeSelectorRow("BIOME", "gc-biome", (dir) => this.cycleBiome(dir));
    this.biomeRow = biome.row;
    this.biomeValue = biome.value;

    this.settingsButton = document.createElement("button");
    this.settingsButton.type = "button";
    this.settingsButton.className = "gc-settings";
    this.settingsButton.textContent = "SETTINGS";
    styleMenuButton(this.settingsButton, "ghost", ["width:100%"]);
    this.settingsButton.addEventListener("click", () => this.openSettings());
    this.settingsButton.addEventListener("mouseenter", () => this.audio.uiBeep("hover"));

    const panel = document.createElement("div");
    panel.className = "gc-panel";
    panel.style.cssText = PANEL_STYLE;

    this.seedPicker = new SeedPicker(panel, this.audio, initialCircuit, (id) =>
      this.handleCircuitChange(id),
    );

    panel.append(
      this.button,
      this.modeRow,
      this.biomeRow,
      this.seedPicker.element,
      this.settingsButton,
    );

    // Read-only scene telemetry (top-right): mirrors the current selection.
    const telemetry = document.createElement("div");
    telemetry.className = "gc-telemetry";
    telemetry.style.cssText = TELEMETRY_STYLE;
    const telemetryHead = document.createElement("span");
    telemetryHead.textContent = "SCENE";
    telemetryHead.style.cssText = kickerLabel() + ";" + TELEMETRY_HEAD_STYLE;
    this.modeTelemetry = this.makeTelemetryRow(telemetry, "MODE");
    this.biomeTelemetry = this.makeTelemetryRow(telemetry, "BIOME");
    this.seedTelemetry = this.makeTelemetryRow(telemetry, "SEED");
    telemetry.prepend(telemetryHead);

    // Bottom status bar: pulsing dot + READY kicker over the controls hint.
    const statusBar = document.createElement("div");
    statusBar.className = "gc-statusbar";
    statusBar.style.cssText = STATUSBAR_STYLE;
    const statusLine = document.createElement("div");
    statusLine.style.cssText = STATUS_LINE_STYLE;
    const dot = document.createElement("span");
    dot.style.cssText = statusDot();
    const ready = document.createElement("span");
    ready.textContent = "READY";
    ready.style.cssText = kickerLabel();
    statusLine.append(dot, ready);

    this.controls = document.createElement("p");
    this.controls.className = "gc-controls";
    this.controls.style.cssText = CONTROLS_STYLE;
    this.controls.innerHTML = controlsHtml(this.selectedMode);
    statusBar.append(statusLine, this.controls);

    this.root = document.createElement("div");
    this.root.style.cssText = ROOT_STYLE;
    // Decorative layers first (behind), then telemetry, content, status bar.
    const vignette = document.createElement("div");
    vignette.style.cssText = vignetteLayer();
    const grain = document.createElement("div");
    grain.style.cssText = grainLayer();
    this.root.append(style, vignette, grain);
    for (const c of ["tl", "tr", "bl", "br"] as const) {
      const mark = document.createElement("div");
      mark.style.cssText = cornerMark(c, 28);
      this.root.append(mark);
    }
    this.root.append(telemetry, header, panel, statusBar);

    this.renderValues();

    // Enter/Space activates the FOCUSED control: SETTINGS opens settings,
    // everything else confirms START (the `started` guard makes a repeat a
    // no-op). ArrowLeft/Right cycle the focused selector row. preventDefault
    // stops native focused-button activation double-firing and page scroll.
    // The display guard skips input while the menu is hidden (e.g. while the
    // Settings overlay is open over it).
    this.onKeydown = (e: KeyboardEvent) => {
      if (this.root.style.display === "none") return;
      // While the code input is focused, let arrows/Enter edit text + commit
      // inside SeedPicker; suppress the menu-wide handlers.
      if (document.activeElement === this.seedPicker.inputElement) return;
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
        case "Space":
          e.preventDefault();
          {
            const ae = document.activeElement;
            if (ae instanceof HTMLButtonElement && ae !== this.button && this.root.contains(ae)) {
              ae.click();
            } else {
              this.confirm();
            }
          }
          break;
      }
    };
    window.addEventListener("keydown", this.onKeydown);

    container.appendChild(this.root);

    // Visible at construction: enable arrow/gamepad nav immediately.
    this.startNav();
  }

  /** Current selected mode (1P default). */
  get selectedMode(): GameMode {
    return MODE_VALUES[this.modeIndex]!;
  }

  /** Current selected biome id (temperate default). */
  get selectedBiome(): BiomeId {
    return this.biomeDefs[this.biomeIndex]!.id;
  }

  /**
   * Build a focusable selector row: label left, `< value >` right. Chevron
   * clicks cycle that direction (stopPropagation so the row's cycle-forward
   * click does not also fire); clicking the row body cycles forward.
   */
  private makeSelectorRow(
    label: string,
    className: string,
    cycle: (dir: 1 | -1) => void,
  ): SelectorRow {
    const row = document.createElement("div");
    row.className = `gc-row ${className}-row`;
    row.tabIndex = 0;
    row.style.cssText = SELECTOR_ROW_STYLE;
    row.addEventListener("click", () => cycle(1));
    row.addEventListener("mouseenter", () => this.audio.uiBeep("hover"));

    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    labelEl.style.cssText = SELECTOR_LABEL_STYLE;

    const value = document.createElement("span");
    value.className = `${className}-value`;
    value.style.cssText = SELECTOR_VALUE_STYLE;

    const chevron = (dir: 1 | -1, cls: string, text: string): HTMLButtonElement => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `gc-chevron ${cls}`;
      btn.tabIndex = -1; // the row is the focus unit; chevrons are mouse-only
      btn.textContent = text;
      btn.style.cssText = CHEVRON_STYLE;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        cycle(dir);
      });
      return btn;
    };

    row.append(
      labelEl,
      chevron(-1, `${className}-prev`, "◀"),
      value,
      chevron(1, `${className}-next`, "▶"),
    );
    return { row, value };
  }

  /** Append a read-only `KEY   value` telemetry row; return its value span. */
  private makeTelemetryRow(parent: HTMLElement, label: string): HTMLSpanElement {
    const row = document.createElement("div");
    row.className = `gc-tele-${label.toLowerCase()}`;
    row.style.cssText = telemetryRow();
    const key = document.createElement("span");
    key.textContent = label;
    key.style.cssText = telemetryKey();
    const value = document.createElement("span");
    value.className = `gc-tele-${label.toLowerCase()}-value`;
    value.style.cssText = telemetryValue();
    row.append(key, value);
    parent.append(row);
    return value;
  }

  /** Cycle 1P <-> 2P, refresh the value + controls, beep. No-op once started. */
  private cycleMode(dir: 1 | -1): void {
    if (this.started) return;
    const n = MODE_VALUES.length;
    this.modeIndex = (((this.modeIndex + dir) % n) + n) % n;
    this.controls.innerHTML = controlsHtml(this.selectedMode);
    this.renderValues();
    this.audio.uiBeep("beep");
  }

  /** Cycle the biome, beep, fire onBiomeChange (live world preview). */
  private cycleBiome(dir: 1 | -1): void {
    if (this.started) return;
    const n = this.biomeDefs.length;
    this.biomeIndex = (((this.biomeIndex + dir) % n) + n) % n;
    this.circuit = { seed: this.circuit.seed, biome: this.biomeIndex };
    this.seedPicker.setCircuit(this.circuit);
    this.renderValues();
    this.audio.uiBeep("beep");
    this.onBiomeChange?.(this.selectedBiome);
  }

  /** SeedPicker changed seed/biome: sync the biome row + forward to host. */
  private handleCircuitChange(id: CircuitId): void {
    this.circuit = id;
    this.biomeIndex = Math.max(0, Math.min(id.biome, this.biomeDefs.length - 1));
    this.renderValues();
    this.onCircuitChange?.(id);
  }

  /** ArrowLeft/Right + gamepad horizontal: cycle whichever row has focus. */
  private cycleFocused(dir: 1 | -1): void {
    const el = document.activeElement;
    if (el === this.modeRow) this.cycleMode(dir);
    else if (el === this.biomeRow) this.cycleBiome(dir);
  }

  /** Sync the selector value texts + telemetry readout to current state. */
  private renderValues(): void {
    const modeLabel = MODE_LABELS[this.modeIndex]!;
    const biomeLabel = this.biomeDefs[this.biomeIndex]!.label.toUpperCase();
    this.modeValue.textContent = modeLabel;
    this.biomeValue.textContent = biomeLabel;
    this.modeTelemetry.textContent = modeLabel;
    this.biomeTelemetry.textContent = biomeLabel;
    this.seedTelemetry.textContent = this.circuit.seed.toString(16).toUpperCase().padStart(8, "0");
  }

  /** Beep + hand off to the settings overlay (menu hides via GameFlow). */
  private openSettings(): void {
    this.audio.uiBeep("click");
    this.onSettings?.();
  }

  /** Idempotent confirm: first caller wins, later calls are no-ops. */
  private confirm(): void {
    if (this.started) return;
    this.started = true;
    this.audio.uiBeep("click");
    window.removeEventListener("keydown", this.onKeydown);
    this.onStart(this.selectedMode, this.selectedBiome);
  }

  get isStarted(): boolean {
    return this.started;
  }

  show(): void {
    this.root.style.display = "flex";
    // Re-show after a Back from race-config: clear the one-shot `started`
    // guard and re-attach the keydown listener (confirm() drops it).
    // removeEventListener first keeps this idempotent on initial show.
    this.started = false;
    window.removeEventListener("keydown", this.onKeydown);
    window.addEventListener("keydown", this.onKeydown);
    this.startNav();
  }

  hide(): void {
    this.root.style.display = "none";
    this.stopNav();
  }

  /** Detach the overlay from the DOM + drop the keydown listener. */
  remove(): void {
    this.stopNav();
    window.removeEventListener("keydown", this.onKeydown);
    this.root.remove();
  }

  private startNav(): void {
    if (this.nav) return;
    this.nav = new MenuNav({
      elements: () => [
        this.button,
        this.modeRow,
        this.biomeRow,
        this.seedPicker.inputElement,
        this.settingsButton,
      ],
      onHorizontal: (dir) => this.cycleFocused(dir),
    });
    this.nav.start();
  }

  private stopNav(): void {
    this.nav?.dispose();
    this.nav = null;
  }
}
