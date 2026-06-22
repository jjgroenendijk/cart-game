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
 * Audio is taken as a minimal interface (uiBeep only) so the overlay is
 * unit-testable with a stub and stays decoupled from the full AudioManager.
 */

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
button.gc-mode:hover { transform: translateY(-1px); }
button.gc-mode:active {
  transform: translateY(2px);
  box-shadow: 0 1px 0 #5a9fd6, 0 2px 8px rgba(0, 0, 0, 0.4);
}
`;

export class StartMenu {
  private readonly root: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly modeButton: HTMLButtonElement;
  private readonly controls: HTMLElement;
  private readonly audio: MenuAudio;
  private readonly onStart: (mode: GameMode) => void;
  private readonly onKeydown: (e: KeyboardEvent) => void;
  private started = false;
  private mode: GameMode = "1P";

  constructor(container: HTMLElement, audio: MenuAudio, onStart: (mode: GameMode) => void) {
    this.audio = audio;
    this.onStart = onStart;

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

    this.controls = document.createElement("p");
    this.controls.style.cssText = CONTROLS_STYLE;
    this.controls.innerHTML = controlsHtml(this.mode);

    this.root = document.createElement("div");
    this.root.style.cssText = ROOT_STYLE;
    this.root.append(style, title, this.modeButton, this.button, this.controls);

    // Enter/Space confirm from anywhere. The `started` guard makes a Space
    // press (which also synthesises a button click) fire onStart only once.
    this.onKeydown = (e: KeyboardEvent) => {
      if (e.code === "Enter" || e.code === "Space") {
        e.preventDefault();
        this.confirm();
      }
    };
    window.addEventListener("keydown", this.onKeydown);

    container.appendChild(this.root);
  }

  /** Current selected mode (1P default). */
  get selectedMode(): GameMode {
    return this.mode;
  }

  /** Cycle 1P <-> 2P, refresh the label + controls, beep. */
  private toggleMode(): void {
    if (this.started) return;
    this.mode = this.mode === "1P" ? "2P" : "1P";
    this.modeButton.textContent = this.mode === "1P" ? "1 PLAYER" : "2 PLAYERS";
    this.controls.innerHTML = controlsHtml(this.mode);
    this.audio.uiBeep("click");
  }

  /** Idempotent confirm: first caller wins, later calls are no-ops. */
  private confirm(): void {
    if (this.started) return;
    this.started = true;
    this.audio.uiBeep("click");
    window.removeEventListener("keydown", this.onKeydown);
    this.onStart(this.mode);
  }

  get isStarted(): boolean {
    return this.started;
  }

  show(): void {
    this.root.style.display = "flex";
  }

  hide(): void {
    this.root.style.display = "none";
  }

  /** Detach the overlay from the DOM + drop the keydown listener. */
  remove(): void {
    window.removeEventListener("keydown", this.onKeydown);
    this.root.remove();
  }
}
