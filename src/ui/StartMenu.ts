/**
 * 006 start-menu DOM overlay, redesigned in 070, recomposed in 072 to the
 * "field journal / expedition" layout. Plain HTMLElements + cssText + one
 * injected <style> (menuStyles.MENU_CSS + local keyframes); no asset files.
 * Built visible over the live 3D bg.
 *
 * Layout (072 corner-anchored asymmetry) — the 3D world is the hero, chrome
 * hugs the edges:
 * - Top-left IDENTITY: kicker (hairline + tracked label) over a serif masthead
 *   (italic "CART" accent), a hairline rule, then a short meta line.
 * - Top-right SEED: a SEED kicker over the interactive TRACK CODE picker
 *   (058) — the one place the seed lives.
 * - Bottom-right HINTS: the drive-controls list (P2 row only in 2P).
 * - Bottom-left CONSOLE: the interactive controls in a left-aligned column — a
 *   LAUNCH kicker, START RACE (first focus), the MODE + BIOME selector rows,
 *   and SETTINGS, split by hairline dividers. No frosted card and no button
 *   fill: transparent text controls (background appears only on hover) with
 *   sharp corners, so the scene reads through.
 * Seed sits top-right and mode/biome sit bottom-left with no duplicated
 * readout between the two corners.
 * Four 1px corner brackets + a soft vignette + a film-grain layer frame the
 * whole overlay, biome-neutral (the tinted per-biome palette is 073, not here).
 *
 * MODE and BIOME are RaceConfig-style `< value >` rows: chevron clicks, row
 * clicks, ArrowLeft/Right on the focused row, and gamepad horizontal all cycle.
 * Cycling BIOME fires onBiomeChange so the menu preview world rebuilds live
 * (008 mode toggle + 025 biome buttons folded into these rows).
 *
 * Enter/Space activates the FOCUSED control: SETTINGS opens settings (012);
 * any other focus target confirms START. onStart(mode, biome) fires exactly
 * once via a `started` guard; show() re-arms it after a Back.
 *
 * Audio is taken as a minimal interface (uiBeep only) so the overlay is
 * unit-testable with a stub and stays decoupled from the full AudioManager.
 */

import { MenuNav } from "./menuNav";
import { BIOMES, type BiomeId, resolveBiome } from "../biomes/registry";
import { type CircuitId, DEFAULT_ID } from "../terrain/circuitCode";
import {
  MENU_CSS,
  cornerMark,
  displayAccent,
  displayHeading,
  grainLayer,
  hairlineRule,
  kickerLabel,
  kickerRow,
  vignetteLayer,
} from "./menuStyles";
import { SeedPicker } from "./SeedPicker";
import {
  CONSOLE_STYLE,
  CONTROLS_STYLE,
  DIVIDER_STYLE,
  HINTS_STYLE,
  IDENTITY_STYLE,
  LOCAL_CSS,
  META_LINE,
  META_STYLE,
  MODE_LABELS,
  ROOT_STYLE,
  ROW_CHEVRON_STYLE,
  ROW_CONTROLS_STYLE,
  ROW_LABEL_STYLE,
  ROW_STYLE,
  ROW_VALUE_STYLE,
  SEED_BLOCK_STYLE,
  SEED_HEAD_STYLE,
  SETTINGS_BTN_STYLE,
  START_BTN_STYLE,
  TITLE_EXTRA,
  controlsHtml,
} from "./startMenuStyles";

/** Race mode selected on the start menu. */
export type GameMode = "1P" | "2P";

export interface MenuAudio {
  uiBeep(kind: "hover" | "click" | "beep" | "go"): void;
}

const MODE_VALUES: GameMode[] = ["1P", "2P"];

/** One `LABEL  < value >` selector row: focusable div + chevrons + value. */
interface SelectorRow {
  row: HTMLDivElement;
  value: HTMLSpanElement;
}

export class StartMenu {
  private readonly root: HTMLElement;
  // Built in the corner-block helpers (buildConsole/buildSeedBlock/buildHints),
  // so not `readonly` — TS only allows readonly writes in the ctor body.
  private button!: HTMLButtonElement;
  private settingsButton!: HTMLButtonElement;
  private modeRow!: HTMLDivElement;
  private modeValue!: HTMLSpanElement;
  private biomeRow!: HTMLDivElement;
  private biomeValue!: HTMLSpanElement;
  private controls!: HTMLElement;
  private seedPicker!: SeedPicker;
  private readonly audio: MenuAudio;
  private readonly onStart: (mode: GameMode, biome: BiomeId) => void;
  private readonly onSettings?: () => void;
  private readonly onBiomeChange?: (biome: BiomeId) => void;
  private readonly onKeydown: (e: KeyboardEvent) => void;
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

    const identity = this.buildIdentity();
    const seedBlock = this.buildSeedBlock(initialCircuit);
    const hints = this.buildHints();
    const console = this.buildConsole();

    this.root = document.createElement("div");
    this.root.style.cssText = ROOT_STYLE;
    // Decorative layers first (behind), then the corner-anchored content.
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
    this.root.append(identity, seedBlock, hints, console);

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

  /** Top-left identity: kicker over the serif masthead, a hairline, meta line. */
  private buildIdentity(): HTMLElement {
    const identity = document.createElement("div");
    identity.className = "gc-identity";
    identity.style.cssText = IDENTITY_STYLE;

    const kicker = document.createElement("div");
    kicker.className = "gc-kicker";
    kicker.style.cssText = kickerRow();
    const kickerLine = document.createElement("span");
    kickerLine.style.cssText = hairlineRule(28);
    const kickerText = document.createElement("span");
    kickerText.textContent = "FIELD NOTES · SETUP";
    kickerText.style.cssText = kickerLabel();
    kicker.append(kickerLine, kickerText);

    // Serif masthead with an italic "CART" accent. textContent stays "GAME CART".
    const title = document.createElement("h1");
    title.className = "gc-title";
    title.style.cssText = displayHeading() + ";" + TITLE_EXTRA;
    title.append("GAME ");
    const accent = document.createElement("span");
    accent.className = "gc-title-accent";
    accent.textContent = "CART";
    accent.style.cssText = displayAccent();
    title.append(accent);

    const rule = document.createElement("div");
    rule.style.cssText = hairlineRule(40);

    const meta = document.createElement("p");
    meta.className = "gc-meta";
    meta.textContent = META_LINE;
    meta.style.cssText = META_STYLE;

    identity.append(kicker, title, rule, meta);
    return identity;
  }

  /** Top-right SEED block: a SEED kicker over the interactive TRACK CODE picker. */
  private buildSeedBlock(initialCircuit: CircuitId): HTMLElement {
    const seedBlock = document.createElement("div");
    seedBlock.className = "gc-seed";
    seedBlock.style.cssText = SEED_BLOCK_STYLE;
    const head = document.createElement("span");
    head.textContent = "SEED";
    head.style.cssText = kickerLabel() + ";" + SEED_HEAD_STYLE;
    seedBlock.append(head);
    // SeedPicker appends its own element into seedBlock and is the sole seed
    // control (the mode/biome selectors live in the bottom-left console).
    this.seedPicker = new SeedPicker(seedBlock, this.audio, initialCircuit, (id) =>
      this.handleCircuitChange(id),
    );
    return seedBlock;
  }

  /** Bottom-right drive-controls hint (P2 row folds in for 2P). */
  private buildHints(): HTMLElement {
    const hints = document.createElement("div");
    hints.className = "gc-hints";
    hints.style.cssText = HINTS_STYLE;
    const controls = document.createElement("p");
    controls.className = "gc-controls";
    controls.style.cssText = CONTROLS_STYLE;
    controls.innerHTML = controlsHtml(this.selectedMode);
    this.controls = controls;
    hints.append(controls);
    return hints;
  }

  /**
   * Bottom-left interactive console: a LAUNCH kicker over START, the MODE + BIOME
   * rows, and SETTINGS — all transparent text controls with sharp corners, split
   * by full-width hairline dividers. (TRACK CODE lives in the top-right SEED
   * block; this console holds the mode/biome/settings controls.)
   */
  private buildConsole(): HTMLElement {
    const console = document.createElement("div");
    console.className = "gc-console";
    console.style.cssText = CONSOLE_STYLE;

    const kicker = document.createElement("div");
    kicker.className = "gc-console-kicker";
    kicker.style.cssText = kickerRow();
    const kickerLine = document.createElement("span");
    kickerLine.style.cssText = hairlineRule(28);
    const kickerText = document.createElement("span");
    kickerText.textContent = "LAUNCH";
    kickerText.style.cssText = kickerLabel();
    kicker.append(kickerLine, kickerText);

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "gc-btn gc-start";
    this.button.textContent = "START RACE";
    this.button.style.cssText = START_BTN_STYLE;
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
    this.settingsButton.className = "gc-btn gc-settings";
    this.settingsButton.textContent = "SETTINGS";
    this.settingsButton.style.cssText = SETTINGS_BTN_STYLE;
    this.settingsButton.addEventListener("click", () => this.openSettings());
    this.settingsButton.addEventListener("mouseenter", () => this.audio.uiBeep("hover"));

    // Visual/nav order is START -> MODE -> BIOME -> SETTINGS with decorative
    // hairline rules between sections.
    console.append(
      kicker,
      this.button,
      this.divider(),
      this.modeRow,
      this.biomeRow,
      this.divider(),
      this.settingsButton,
    );
    return console;
  }

  /** A full-width 1px hairline rule used to divide console sections. */
  private divider(): HTMLElement {
    const rule = document.createElement("div");
    rule.style.cssText = DIVIDER_STYLE;
    return rule;
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
   * Build a focusable selector row: tracked label left, a `◀ value ▶` cluster
   * right. Chevron clicks cycle that direction (stopPropagation so the row's
   * cycle-forward click does not also fire); clicking the row body cycles
   * forward. Transparent + sharp; the hover fill is a LOCAL_CSS rule on
   * `gc-console-row`.
   */
  private makeSelectorRow(
    label: string,
    className: string,
    cycle: (dir: 1 | -1) => void,
  ): SelectorRow {
    const row = document.createElement("div");
    row.className = `gc-row gc-console-row ${className}-row`;
    row.tabIndex = 0;
    row.style.cssText = ROW_STYLE;
    row.addEventListener("click", () => cycle(1));
    row.addEventListener("mouseenter", () => this.audio.uiBeep("hover"));

    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    labelEl.style.cssText = ROW_LABEL_STYLE;

    const value = document.createElement("span");
    value.className = `${className}-value`;
    value.style.cssText = ROW_VALUE_STYLE;

    const chevron = (dir: 1 | -1, cls: string, text: string): HTMLButtonElement => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `gc-chevron gc-cchev ${cls}`;
      btn.tabIndex = -1; // the row is the focus unit; chevrons are mouse-only
      btn.textContent = text;
      btn.style.cssText = ROW_CHEVRON_STYLE;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        cycle(dir);
      });
      return btn;
    };

    const controls = document.createElement("div");
    controls.style.cssText = ROW_CONTROLS_STYLE;
    controls.append(
      chevron(-1, `${className}-prev`, "◀"),
      value,
      chevron(1, `${className}-next`, "▶"),
    );

    row.append(labelEl, controls);
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

  /** Sync the MODE/BIOME selector value texts to current state. */
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
