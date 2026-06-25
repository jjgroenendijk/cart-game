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

export interface PauseCallbacks {
  onResume: () => void;
  onSettings: () => void;
  onQuit: () => void;
}

// z-index 10 + dim backdrop per 012 Defaults (rgba(0,0,0,0.55)).
const ROOT_STYLE = [
  "position:absolute",
  "inset:0",
  "z-index:10",
  "display:flex",
  "flex-direction:column",
  "align-items:center",
  "justify-content:center",
  "gap:14px",
  "background:rgba(0,0,0,0.55)",
  "font-family:system-ui,sans-serif",
  "color:#fff",
  "pointer-events:none",
  "text-align:center",
  "text-shadow:0 2px 10px rgba(0,0,0,0.85)",
].join(";");

// Smaller than the StartMenu title (no pulse keyframes; pause is static).
const TITLE_STYLE = [
  "margin:0",
  "font-size:clamp(28px,6vw,56px)",
  "font-weight:800",
  "letter-spacing:3px",
].join(";");

// RESUME: yellow primary, mirrors StartMenu START_STYLE cue.
const RESUME_STYLE = [
  "pointer-events:auto",
  "font-family:inherit",
  "font-size:clamp(18px,2.6vw,24px)",
  "font-weight:700",
  "letter-spacing:1px",
  "color:#0b0f14",
  "background:#ffd23f",
  "border:none",
  "border-radius:12px",
  "padding:12px 32px",
  "cursor:pointer",
  "box-shadow:0 6px 0 #c9a31f,0 10px 24px rgba(0,0,0,0.5)",
  "transition:transform 0.08s ease,box-shadow 0.08s ease",
].join(";");

// SETTINGS / QUIT: muted secondary.
const MUTED_STYLE = [
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

    const title = document.createElement("h1");
    title.textContent = "PAUSED";
    title.style.cssText = TITLE_STYLE;

    this.resume = this.makeButton("RESUME", "gc-pause-resume", RESUME_STYLE, this.onResume);
    this.settings = this.makeButton("SETTINGS", "gc-pause-settings", MUTED_STYLE, this.onSettings);
    this.quit = this.makeButton("QUIT", "gc-pause-quit", MUTED_STYLE, this.onQuit);

    this.root = document.createElement("div");
    this.root.style.cssText = ROOT_STYLE;
    this.root.style.display = "none";
    this.root.append(title, this.resume, this.settings, this.quit);

    container.appendChild(this.root);
  }

  /** Build a button: hover beep, click beep + invoke the callback. */
  private makeButton(
    label: string,
    className: string,
    style: string,
    action: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = className;
    btn.textContent = label;
    btn.style.cssText = style;
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
