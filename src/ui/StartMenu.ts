/**
 * 006 start-menu DOM overlay, redesigned in 070. Plain HTMLElements + cssText
 * + one injected <style> (menuStyles.MENU_CSS + local keyframes); no asset
 * files. Built visible over the live 3D bg.
 *
 * Layout (logical order, 070): animated title + checkered ribbon, then a
 * frosted panel with START RACE (primary, first focus) -> MODE selector row
 * -> BIOME selector row -> SETTINGS (ghost), then a controls hint. MODE and
 * BIOME are RaceConfig-style `< value >` rows: chevron clicks, row clicks,
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
import {
  CHEVRON_STYLE,
  MENU_CSS,
  PANEL_STYLE,
  SELECTOR_LABEL_STYLE,
  SELECTOR_ROW_STYLE,
  SELECTOR_VALUE_STYLE,
  styleMenuButton,
} from "./menuStyles";

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
// at the same stacking level as the (now hidden) loading veil.
const ROOT_STYLE = [
  "position:absolute",
  "inset:0",
  "z-index:10",
  "display:flex",
  "flex-direction:column",
  "align-items:center",
  "justify-content:center",
  "gap:18px",
  "font-family:system-ui,sans-serif",
  "color:#fff",
  "pointer-events:none",
  "text-align:center",
  "text-shadow:0 2px 10px rgba(0,0,0,0.85)",
].join(";");

// Gradient fill + drop shadows live in the .gc-title CSS block (pseudo-state
// free properties that need keyframes/background-clip stay in the <style>).
const TITLE_STYLE = [
  "margin:0",
  "font-size:clamp(44px,9vw,96px)",
  "font-weight:900",
  "font-style:italic",
  "letter-spacing:4px",
  "line-height:1",
  "text-shadow:none",
].join(";");

const TITLE_STRIP_STYLE = [
  "width:min(360px,62vw)",
  "height:12px",
  "margin:6px auto 0",
  "transform:skewX(-24deg)",
  "background:repeating-conic-gradient(#f4f7fb 0% 25%,#10161f 0% 50%)",
  "background-size:12px 12px",
  "border-radius:3px",
  "opacity:0.92",
  "box-shadow:0 4px 14px rgba(0,0,0,0.5)",
].join(";");

const SUBTITLE_STYLE = [
  "margin:8px 0 0",
  "font-size:12px",
  "font-weight:700",
  "letter-spacing:6px",
  "opacity:0.75",
].join(";");

const CONTROLS_STYLE = [
  "margin:0",
  "font-size:13px",
  "line-height:1.9",
  "opacity:0.92",
  "max-width:320px",
].join(";");

// Local keyframes + title/controls treatments; MENU_CSS (hover/active/focus
// for gc-btn/gc-row/gc-chevron) is prepended in the ctor. One <style> node,
// no external assets.
const LOCAL_CSS = `
@keyframes gc-title-shine {
  0% { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
}
@keyframes gc-title-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
}
@keyframes gc-start-glow {
  0%, 100% {
    box-shadow: 0 5px 0 #c9a31f, 0 8px 20px rgba(0, 0, 0, 0.45),
      0 0 0 rgba(255, 210, 63, 0);
  }
  50% {
    box-shadow: 0 5px 0 #c9a31f, 0 8px 20px rgba(0, 0, 0, 0.45),
      0 0 24px rgba(255, 210, 63, 0.5);
  }
}
h1.gc-title {
  background: linear-gradient(105deg, #ffd23f 20%, #fff3c4 38%, #ff9d2e 52%, #ffd23f 70%);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  animation: gc-title-shine 5s linear infinite, gc-title-float 3.2s ease-in-out infinite;
  filter: drop-shadow(0 3px 0 rgba(90, 50, 0, 0.6)) drop-shadow(0 8px 18px rgba(0, 0, 0, 0.6));
}
button.gc-start { animation: gc-start-glow 2.4s ease-in-out infinite; }
.gc-controls b {
  display: inline-block;
  padding: 0 6px;
  border-radius: 5px;
  background: rgba(150, 200, 255, 0.16);
  border: 1px solid rgba(150, 200, 255, 0.3);
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
  private readonly controls: HTMLElement;
  private readonly audio: MenuAudio;
  private readonly onStart: (mode: GameMode, biome: BiomeId) => void;
  private readonly onSettings?: () => void;
  private readonly onBiomeChange?: (biome: BiomeId) => void;
  private readonly onKeydown: (e: KeyboardEvent) => void;
  private readonly biomeDefs = Object.values(BIOMES);
  private started = false;
  private modeIndex = 0;
  private biomeIndex: number;
  private nav: MenuNav | null = null;

  constructor(
    container: HTMLElement,
    audio: MenuAudio,
    onStart: (mode: GameMode, biome: BiomeId) => void,
    onSettings?: () => void,
    onBiomeChange?: (biome: BiomeId) => void,
  ) {
    this.audio = audio;
    this.onStart = onStart;
    this.onSettings = onSettings;
    this.onBiomeChange = onBiomeChange;
    const defaultBiome = resolveBiome("temperate").id;
    this.biomeIndex = Math.max(
      0,
      this.biomeDefs.findIndex((d) => d.id === defaultBiome),
    );

    const style = document.createElement("style");
    style.textContent = MENU_CSS + LOCAL_CSS;

    const title = document.createElement("h1");
    title.className = "gc-title";
    title.textContent = "GAME CART";
    title.style.cssText = TITLE_STYLE;

    const strip = document.createElement("div");
    strip.className = "gc-title-strip";
    strip.style.cssText = TITLE_STRIP_STYLE;

    const subtitle = document.createElement("p");
    subtitle.textContent = "PROCEDURAL KART RACING";
    subtitle.style.cssText = SUBTITLE_STYLE;

    const header = document.createElement("div");
    header.append(title, strip, subtitle);

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "gc-start";
    this.button.textContent = "START RACE";
    styleMenuButton(this.button, "primary", [
      "font-size:clamp(20px,3vw,26px)",
      "padding:14px 24px",
      "border-radius:14px",
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
    panel.append(this.button, this.modeRow, this.biomeRow, this.settingsButton);

    this.controls = document.createElement("p");
    this.controls.className = "gc-controls";
    this.controls.style.cssText = CONTROLS_STYLE;
    this.controls.innerHTML = controlsHtml(this.selectedMode);

    this.root = document.createElement("div");
    this.root.style.cssText = ROOT_STYLE;
    this.root.append(style, header, panel, this.controls);

    this.renderValues();

    // Enter/Space activates the FOCUSED control: SETTINGS opens settings,
    // everything else confirms START (the `started` guard makes a repeat a
    // no-op). ArrowLeft/Right cycle the focused selector row. preventDefault
    // stops native focused-button activation double-firing and page scroll.
    // The display guard skips input while the menu is hidden (e.g. while the
    // Settings overlay is open over it).
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
        case "Space":
          e.preventDefault();
          if (document.activeElement === this.settingsButton) this.openSettings();
          else this.confirm();
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
    this.renderValues();
    this.audio.uiBeep("beep");
    this.onBiomeChange?.(this.selectedBiome);
  }

  /** ArrowLeft/Right + gamepad horizontal: cycle whichever row has focus. */
  private cycleFocused(dir: 1 | -1): void {
    const el = document.activeElement;
    if (el === this.modeRow) this.cycleMode(dir);
    else if (el === this.biomeRow) this.cycleBiome(dir);
  }

  /** Sync the selector value texts to the current indices. */
  private renderValues(): void {
    this.modeValue.textContent = MODE_LABELS[this.modeIndex]!;
    this.biomeValue.textContent = this.biomeDefs[this.biomeIndex]!.label.toUpperCase();
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
      elements: () => [this.button, this.modeRow, this.biomeRow, this.settingsButton],
      onHorizontal: (dir) => this.cycleFocused(dir),
    });
    this.nav.start();
  }

  private stopNav(): void {
    this.nav?.dispose();
    this.nav = null;
  }
}
