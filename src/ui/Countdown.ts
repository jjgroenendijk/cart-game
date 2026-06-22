/**
 * 006 countdown DOM overlay. Big centered number that walks 3 -> 2 -> 1 -> GO!,
 * beeping once per phase change ('beep' for 3/2/1, 'go' for GO). The caller
 * (Game) drives update(dt) each frame while in the 'countdown' state and
 * transitions to 'racing' when update returns 'done'.
 *
 * Timing per 006 Defaults: 0.75s per number, 0.6s GO hold (~2.85s total).
 * update() before show() is a no-op (returns 'running') so a stray frame
 * can't start the sequence early. Audio taken as the MenuAudio interface so
 * the overlay is unit-testable with a stub.
 */

import type { MenuAudio } from "./StartMenu";

interface Phase {
  label: string;
  /** Cumulative time at which this phase begins (seconds). */
  start: number;
  beep: "beep" | "go";
}

const PHASE_INTERVAL = 0.75;
const GO_HOLD = 0.6;

// 3 -> 2 -> 1 at PHASE_INTERVAL each; GO! holds GO_HOLD before 'done'.
const PHASES: readonly Phase[] = [
  { label: "3", start: 0, beep: "beep" },
  { label: "2", start: PHASE_INTERVAL, beep: "beep" },
  { label: "1", start: 2 * PHASE_INTERVAL, beep: "beep" },
  { label: "GO!", start: 3 * PHASE_INTERVAL, beep: "go" },
];
const TOTAL = 3 * PHASE_INTERVAL + GO_HOLD;

const ROOT_STYLE = [
  "position:absolute",
  "inset:0",
  "z-index:10",
  "display:flex",
  "align-items:center",
  "justify-content:center",
  "pointer-events:none",
  "font-family:system-ui,sans-serif",
  "font-weight:800",
  "color:#fff",
  "text-shadow:0 4px 18px rgba(0,0,0,0.85)",
].join(";");

const NUMBER_STYLE = [
  "font-size:clamp(90px,22vw,240px)",
  "line-height:1",
  "letter-spacing:2px",
].join(";");

export class Countdown {
  private readonly root: HTMLElement;
  private readonly number: HTMLElement;
  private readonly audio: MenuAudio;
  private shown = false;
  private finished = false;
  private elapsed = 0;
  private index = -1;

  constructor(container: HTMLElement, audio: MenuAudio) {
    this.audio = audio;

    this.number = document.createElement("div");
    this.number.style.cssText = NUMBER_STYLE;
    this.number.textContent = "3";

    this.root = document.createElement("div");
    this.root.style.cssText = ROOT_STYLE;
    this.root.style.display = "none";
    this.root.appendChild(this.number);

    container.appendChild(this.root);
  }

  /** Begin (or restart) the sequence: reset timers, show phase 0, beep once. */
  show(): void {
    this.shown = true;
    this.finished = false;
    this.elapsed = 0;
    this.index = -1;
    this.root.style.display = "flex";
    this.advance();
  }

  hide(): void {
    this.root.style.display = "none";
  }

  /**
   * Drive the sequence. Returns 'running' while phases advance or hold, and
   * 'done' once the GO hold elapses (idempotent thereafter). A no-op (returns
   * 'running') before show() so an early frame can't start it.
   */
  update(dt: number): "running" | "done" {
    if (!this.shown || this.finished) return this.finished ? "done" : "running";
    this.elapsed += dt;
    // Land on the current phase (and beep on change) before the done check, so
    // a large dt that crosses TOTAL still shows GO! rather than stranding the
    // text on the previous phase.
    this.advance();
    if (this.elapsed >= TOTAL) {
      this.finished = true;
      return "done";
    }
    return "running";
  }

  /** Recompute the current phase from elapsed; beep + update text on change. */
  private advance(): void {
    let i = 0;
    for (let k = 0; k < PHASES.length; k++) {
      if (this.elapsed >= PHASES[k]!.start) i = k;
    }
    if (i !== this.index) {
      this.index = i;
      const phase = PHASES[i]!;
      this.number.textContent = phase.label;
      this.audio.uiBeep(phase.beep);
    }
  }

  /** Detach the overlay from the DOM. */
  remove(): void {
    this.shown = false;
    this.root.remove();
  }
}
