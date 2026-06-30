/**
 * 006 start-menu DOM overlay. Plain HTMLElements + cssText + a tiny injected
 * <style> for the title keyframes (no asset files, matches the HUD pattern in
 * Game.createHud). Built visible over the live 3D bg; Start (button click OR
 * window Enter/Space) fires onStart(mode) exactly once via a `started` guard
 * and removes its keydown listener. hover/click -> audio.uiBeep.
 *
 * 008 adds a 1P/2P mode toggle (default 1P). The mode is carried into
 * onStart; the controls list grows a P2 arrows row in 2P.
 *
 * 012 adds a SETTINGS button (optional onSettings callback). It hides the
 * menu + opens Game's SettingsOverlay; the keydown confirm guard ignores
 * Enter/Space while the menu is hidden so a stray confirm in settings never
 * starts the race.
 *
 * 025 adds a biome picker row (one button per registered BIOME) placed after
 * SETTINGS. The chosen biome is carried into onStart alongside the mode;
 * default is temperate. MenuNav appends the biome buttons after the three
 * primary controls so the existing nav order is unchanged.
 *
 * Audio is taken as a minimal interface (uiBeep only) so the overlay is
 * unit-testable with a stub and stays decoupled from the full AudioManager.
 */

import { MenuNav } from "./menuNav";
import { BIOMES, type BiomeId, resolveBiome } from "../terrain/biomes";

/** Race mode selected on the start menu. */
export type GameMode = "1P" | "2P";

export interface MenuAudio {
  uiBeep(kind: "hover" | "click" | "beep" | "go"): void;
}

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

const TITLE_STYLE = [
  "margin:0",
  "font-size:clamp(40px,9vw,96px)",
  "font-weight:800",
  "letter-spacing:4px",
  "animation:gc-title-pulse 1.8s ease-in-out infinite",
].join(";");

// Mode toggle: smaller, lighter than START, pointer-events auto.
const MODE_STYLE = [
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

const START_STYLE = [
  "pointer-events:auto",
  "font-family:inherit",
  "font-size:clamp(20px,3vw,28px)",
  "font-weight:700",
  "letter-spacing:1px",
  "color:#0b0f14",
  "background:#ffd23f",
  "border:none",
  "border-radius:12px",
  "padding:14px 38px",
  "cursor:pointer",
  "box-shadow:0 6px 0 #c9a31f,0 10px 24px rgba(0,0,0,0.5)",
  "transition:transform 0.08s ease,box-shadow 0.08s ease",
].join(";");

const CONTROLS_STYLE = [
  "margin:0",
  "font-size:14px",
  "line-height:1.7",
  "opacity:0.9",
  "max-width:300px",
].join(";");

// Biome picker row + buttons (025). Row is flex centered; buttons dim by
// default, the selected one gets the highlighted [data-selected] look.
const BIOME_ROW_STYLE = [
  "display:flex",
  "flex-wrap:wrap",
  "gap:8px",
  "justify-content:center",
  "max-width:340px",
].join(";");

const BIOME_BTN_STYLE = [
  "pointer-events:auto",
  "font-family:inherit",
  "font-size:14px",
  "font-weight:700",
  "letter-spacing:1px",
  "color:#cfe8ff",
  "background:rgba(20,30,45,0.5)",
  "border:2px solid rgba(150,200,255,0.35)",
  "border-radius:10px",
  "padding:8px 16px",
  "cursor:pointer",
  "transition:transform 0.08s ease,box-shadow 0.08s ease",
].join(";");

// Keyframes injected once via a <style> node. One block, no external assets.
const KEYFRAMES_CSS = `
@keyframes gc-title-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.06); }
}
button.gc-start:hover { transform: translateY(-2px); }
button.gc-start:active {
  transform: translateY(3px);
  box-shadow: 0 2px 0 #c9a31f, 0 4px 12px rgba(0, 0, 0, 0.5);
}
button.gc-mode:hover,
button.gc-settings:hover {
  transform: translateY(-1px);
}
button.gc-mode:active,
button.gc-settings:active {
  transform: translateY(2px);
  box-shadow: 0 1px 0 #5a9fd6, 0 2px 8px rgba(0, 0, 0, 0.4);
}
button.gc-biome[data-selected="true"] {
  color: #0b0f14;
  background: #9ad0ff;
  border-color: #cfe8ff;
  box-shadow: 0 4px 0 #5a9fd6, 0 6px 16px rgba(0, 0, 0, 0.4);
}
button.gc-biome:hover {
  transform: translateY(-1px);
}
button.gc-biome:active {
  transform: translateY(2px);
  box-shadow: 0 1px 0 #5a9fd6, 0 2px 8px rgba(0, 0, 0, 0.4);
}
`;

export class StartMenu {
  private readonly root: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly modeButton: HTMLButtonElement;
  private readonly settingsButton: HTMLButtonElement;
  private readonly biomeRow: HTMLElement;
  private readonly biomeButtons: HTMLButtonElement[];
  private readonly controls: HTMLElement;
  private readonly audio: MenuAudio;
  private readonly onStart: (mode: GameMode, biome: BiomeId) => void;
  private readonly onSettings?: () => void;
  private readonly onKeydown: (e: KeyboardEvent) => void;
  private started = false;
  private mode: GameMode = "1P";
  private biome: BiomeId = resolveBiome("temperate").id;
  private nav: MenuNav | null = null;

  constructor(
    container: HTMLElement,
    audio: MenuAudio,
    onStart: (mode: GameMode, biome: BiomeId) => void,
    onSettings?: () => void,
  ) {
    this.audio = audio;
    this.onStart = onStart;
    this.onSettings = onSettings;

    const style = document.createElement("style");
    style.textContent = KEYFRAMES_CSS;

    const title = document.createElement("h1");
    title.textContent = "GAME CART";
    title.style.cssText = TITLE_STYLE;

    this.modeButton = document.createElement("button");
    this.modeButton.type = "button";
    this.modeButton.className = "gc-mode";
    this.modeButton.textContent = "1 PLAYER";
    this.modeButton.style.cssText = MODE_STYLE;
    this.modeButton.addEventListener("click", () => this.toggleMode());
    this.modeButton.addEventListener("mouseenter", () => this.audio.uiBeep("hover"));

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "gc-start";
    this.button.textContent = "START";
    this.button.style.cssText = START_STYLE;
    this.button.addEventListener("click", () => this.confirm());
    this.button.addEventListener("mouseenter", () => this.audio.uiBeep("hover"));

    this.settingsButton = document.createElement("button");
    this.settingsButton.type = "button";
    this.settingsButton.className = "gc-settings";
    this.settingsButton.textContent = "SETTINGS";
    this.settingsButton.style.cssText = MODE_STYLE;
    this.settingsButton.addEventListener("click", () => {
      this.audio.uiBeep("click");
      this.onSettings?.();
    });
    this.settingsButton.addEventListener("mouseenter", () => this.audio.uiBeep("hover"));

    this.controls = document.createElement("p");
    this.controls.style.cssText = CONTROLS_STYLE;
    this.controls.innerHTML = controlsHtml(this.mode);

    // 025 biome picker: one button per registered biome in insertion order.
    this.biomeRow = document.createElement("div");
    this.biomeRow.style.cssText = BIOME_ROW_STYLE;
    this.biomeButtons = Object.values(BIOMES).map((def) => this.makeBiomeButton(def.id, def.label));
    this.refreshBiomeHighlight();
    this.biomeRow.append(...this.biomeButtons);

    this.root = document.createElement("div");
    this.root.style.cssText = ROOT_STYLE;
    this.root.append(
      style,
      title,
      this.modeButton,
      this.button,
      this.settingsButton,
      this.biomeRow,
      this.controls,
    );

    // Enter/Space confirm from anywhere. The `started` guard makes a Space
    // press (which also synthesises a button click) fire onStart only once.
    // The display guard skips a stray confirm while the menu is hidden (e.g.
    // while the Settings overlay is open over it).
    this.onKeydown = (e: KeyboardEvent) => {
      if (e.code === "Enter" || e.code === "Space") {
        e.preventDefault();
        if (this.root.style.display === "none") return;
        this.confirm();
      }
    };
    window.addEventListener("keydown", this.onKeydown);

    container.appendChild(this.root);

    // Visible at construction: enable arrow/gamepad nav immediately.
    this.startNav();
  }

  /** Current selected mode (1P default). */
  get selectedMode(): GameMode {
    return this.mode;
  }

  /** Current selected biome id (temperate default). */
  get selectedBiome(): BiomeId {
    return this.biome;
  }

  /** Cycle 1P <-> 2P, refresh the label + controls, beep. */
  private toggleMode(): void {
    if (this.started) return;
    this.mode = this.mode === "1P" ? "2P" : "1P";
    this.modeButton.textContent = this.mode === "1P" ? "1 PLAYER" : "2 PLAYERS";
    this.controls.innerHTML = controlsHtml(this.mode);
    this.audio.uiBeep("click");
  }

  /** Build a single biome button bound to selectBiome(id). */
  private makeBiomeButton(id: BiomeId, label: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gc-biome";
    btn.dataset.biome = id;
    btn.textContent = label;
    btn.style.cssText = BIOME_BTN_STYLE;
    btn.addEventListener("click", () => this.selectBiome(id));
    btn.addEventListener("mouseenter", () => this.audio.uiBeep("hover"));
    return btn;
  }

  /** Select a biome, refresh highlight, beep. No-op once started. */
  private selectBiome(id: BiomeId): void {
    if (this.started) return;
    this.biome = id;
    this.refreshBiomeHighlight();
    this.audio.uiBeep("click");
  }

  /** Sync [data-selected] on each biome button to the current selection. */
  private refreshBiomeHighlight(): void {
    for (const btn of this.biomeButtons) {
      btn.dataset.selected = btn.dataset.biome === this.biome ? "true" : "false";
    }
  }

  /** Idempotent confirm: first caller wins, later calls are no-ops. */
  private confirm(): void {
    if (this.started) return;
    this.started = true;
    this.audio.uiBeep("click");
    window.removeEventListener("keydown", this.onKeydown);
    this.onStart(this.mode, this.biome);
  }

  get isStarted(): boolean {
    return this.started;
  }

  show(): void {
    this.root.style.display = "flex";
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
      elements: () => [this.modeButton, this.button, this.settingsButton, ...this.biomeButtons],
    });
    this.nav.start();
  }

  private stopNav(): void {
    this.nav?.dispose();
    this.nav = null;
  }
}
