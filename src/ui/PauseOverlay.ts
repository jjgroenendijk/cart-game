/**
 * 012 pause DOM overlay. Dim backdrop over the frozen chase render with
 * RESUME / SETTINGS / QUIT. Built hidden; Game shows it on the pause event
 * and hides/removes it on resume/quit/dispose. Esc toggles racing <-> paused
 * in Game; this overlay only owns its own nodes + beeps.
 *
 * Mirrors StartMenu/Countdown: plain HTMLElements + cssText, z-index 10,
 * pointer-events:none root with pointer-events:auto on buttons, a minimal
 * MenuAudio iface for stubbable beeps, show/hide/remove. Callbacks are taken
 * in the constructor so the buttons are wired once + stay decoupled from Game.
 *
 * SETTINGS is wired through onSettings; 012 commit 6 fills that body in Game.
 */

import type { MenuAudio } from "./StartMenu";
import { MenuNav } from "./menuNav";
import {
  INK,
  MENU_CSS,
  cornerMark,
  displayAccent,
  displayHeading,
  grainLayer,
  hairlineRule,
  kickerLabel,
  kickerRow,
  styleMenuButton,
  vignetteLayer,
  type ButtonKind,
} from "./menuStyles";

export interface PauseCallbacks {
  onResume: () => void;
  onSettings: () => void;
  onQuit: () => void;
}

// z-index 10 + dim backdrop per 012 Defaults (rgba(0,0,0,0.55)). overflow:hidden
// clips the full-bleed vignette/grain + corner marks (072 editorial framing).
const ROOT_STYLE = [
  "position:absolute",
  "inset:0",
  "z-index:10",
  "overflow:hidden",
  "display:flex",
  "flex-direction:column",
  "align-items:center",
  "justify-content:center",
  "gap:14px",
  "background:rgba(0,0,0,0.55)",
  "font-family:system-ui,sans-serif",
  `color:${INK}`,
  "pointer-events:none",
  "text-align:center",
  "text-shadow:0 2px 10px rgba(0,0,0,0.85)",
].join(";");

// Editorial header stack (072): kicker eyebrow over a serif display heading.
const HEADER_STYLE = [
  "display:flex",
  "flex-direction:column",
  "align-items:center",
  "gap:14px",
].join(";");

// Button visuals come from the shared menuStyles kit (070): RESUME is the
// primary confirm cue, SETTINGS/QUIT are secondary. Sizes stay per-screen.
const RESUME_EXTRA = ["font-size:clamp(18px,2.6vw,24px)", "padding:12px 32px"];
const MUTED_EXTRA = ["padding:8px 22px", "border-radius:10px"];

export class PauseOverlay {
  private readonly root: HTMLElement;
  private readonly audio: MenuAudio;
  private readonly onResume: () => void;
  private readonly onSettings: () => void;
  private readonly onQuit: () => void;
  private readonly resume: HTMLButtonElement;
  private readonly settings: HTMLButtonElement;
  private readonly quit: HTMLButtonElement;
  private nav: MenuNav | null = null;

  constructor(container: HTMLElement, audio: MenuAudio, cb: PauseCallbacks) {
    this.audio = audio;
    this.onResume = cb.onResume;
    this.onSettings = cb.onSettings;
    this.onQuit = cb.onQuit;

    const style = document.createElement("style");
    style.textContent = MENU_CSS;

    const header = this.buildHeader();

    this.resume = this.makeButton("RESUME", "gc-pause-resume", "primary", RESUME_EXTRA, () =>
      this.onResume(),
    );
    this.settings = this.makeButton("SETTINGS", "gc-pause-settings", "secondary", MUTED_EXTRA, () =>
      this.onSettings(),
    );
    this.quit = this.makeButton("QUIT", "gc-pause-quit", "secondary", MUTED_EXTRA, () =>
      this.onQuit(),
    );

    this.root = document.createElement("div");
    this.root.style.cssText = ROOT_STYLE;
    this.root.style.display = "none";
    // Decorative editorial layers first (behind), then the content stack.
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
    this.root.append(header, this.resume, this.settings, this.quit);

    container.appendChild(this.root);
  }

  /** Editorial header: PAUSED kicker over a serif "Pit Stop" heading + rule. */
  private buildHeader(): HTMLElement {
    const kicker = document.createElement("div");
    kicker.className = "gc-pause-kicker";
    kicker.style.cssText = kickerRow();
    const kickerLine = document.createElement("span");
    kickerLine.style.cssText = hairlineRule(28);
    const kickerText = document.createElement("span");
    kickerText.textContent = "PAUSED";
    kickerText.style.cssText = kickerLabel();
    kicker.append(kickerLine, kickerText);

    const title = document.createElement("h1");
    title.className = "gc-pause-title";
    title.style.cssText = displayHeading();
    title.append("Pit ");
    const accent = document.createElement("span");
    accent.className = "gc-pause-title-accent";
    accent.textContent = "Stop";
    accent.style.cssText = displayAccent();
    title.append(accent);

    const divider = document.createElement("div");
    divider.style.cssText = hairlineRule(56);

    const header = document.createElement("div");
    header.className = "gc-pause-header";
    header.style.cssText = HEADER_STYLE;
    header.append(kicker, title, divider);
    return header;
  }

  /** Build a kit-styled button: hover beep, click beep + invoke the callback. */
  private makeButton(
    label: string,
    className: string,
    kind: ButtonKind,
    extra: string[],
    action: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = className;
    btn.textContent = label;
    styleMenuButton(btn, kind, extra);
    btn.addEventListener("click", () => {
      this.audio.uiBeep("click");
      action();
    });
    btn.addEventListener("mouseenter", () => this.audio.uiBeep("hover"));
    return btn;
  }

  show(): void {
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
    this.nav = new MenuNav({ elements: () => [this.resume, this.settings, this.quit] });
    this.nav.start();
  }

  private stopNav(): void {
    this.nav?.dispose();
    this.nav = null;
  }
}
