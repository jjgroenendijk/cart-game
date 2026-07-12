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
  MENU_CSS,
  displayAccent,
  displayHeading,
  hairlineRule,
  kickerLabel,
  kickerRow,
  mountEditorialFrame,
  overlayRootStyle,
  overlayScrollerStyle,
  styleMenuButton,
  type ButtonKind,
} from "./menuStyles";

export interface PauseCallbacks {
  onResume: () => void;
  onSettings: () => void;
  onQuit: () => void;
}

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
const MUTED_EXTRA = ["padding:10px 26px"];

// SETTINGS/QUIT side by side under the big RESUME; wraps on narrow screens.
const ACTIONS_STYLE = ["display:flex", "flex-wrap:wrap", "justify-content:center", "gap:12px"].join(
  ";",
);

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

    const actions = document.createElement("div");
    actions.style.cssText = ACTIONS_STYLE;
    actions.append(this.settings, this.quit);

    this.root = document.createElement("div");
    this.root.style.cssText = overlayRootStyle({ dim: true });
    this.root.style.display = "none";
    // Editorial frame first (behind), then the scroll-safe content column.
    this.root.append(style);
    mountEditorialFrame(this.root, { grain: true });
    const scroller = document.createElement("div");
    scroller.style.cssText = overlayScrollerStyle(14);
    scroller.append(header, this.resume, actions);
    this.root.append(scroller);

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
