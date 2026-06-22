/**
 * 007 race HUD overlay (DOM). Shows lap x/N, live position p/total, and the
 * race timer (m:ss.cc). Follows the 006 StartMenu/Countdown pattern: plain
 * HTMLElements + cssText, appended to the container, removed on dispose.
 * Visible only while racing (Game toggles show()/hide()).
 *
 * Takes a minimal HudState (built by Game from the RaceManager snapshot) so the
 * overlay stays decoupled from src/race and is unit-testable under jsdom.
 */

export interface HudState {
  /** Current lap (1-based, clamped to targetLaps for display). */
  lap: number;
  /** Target lap count. */
  targetLaps: number;
  /** Live 1-based position of P1 (1 = leader). */
  position: number;
  /** Total karts in the field. */
  totalKarts: number;
  /** Race timer (seconds). */
  timer: number;
}

/**
 * Viewport-relative placement for a per-player HUD. Omitted anchors fall back
 * to the default top-left (1P, pre-008 position). 008 passes viewHudAnchor +
 * offset so each view's HUD sits inside its own split-screen half.
 */
export interface HudAnchor {
  left: number;
  top: number;
}

const ROOT_STYLE = [
  "position:absolute",
  "left:14px",
  "top:58px",
  "z-index:5",
  "font-family:system-ui,sans-serif",
  "color:#fff",
  "pointer-events:none",
  "text-shadow:0 2px 6px rgba(0,0,0,0.8)",
  "line-height:1.5",
  "font-size:18px",
  "font-weight:700",
  "letter-spacing:0.5px",
].join(";");

export class RaceHud {
  private readonly root: HTMLElement;
  private readonly lap: HTMLElement;
  private readonly pos: HTMLElement;
  private readonly time: HTMLElement;
  private readonly targetLaps: number;
  private readonly totalKarts: number;

  constructor(container: HTMLElement, targetLaps: number, totalKarts: number, anchor?: HudAnchor) {
    this.targetLaps = targetLaps;
    this.totalKarts = totalKarts;

    this.lap = document.createElement("div");
    this.pos = document.createElement("div");
    this.time = document.createElement("div");

    this.root = document.createElement("div");
    this.root.className = "gc-race-hud";
    this.root.style.cssText = ROOT_STYLE;
    if (anchor) {
      this.root.style.left = `${anchor.left}px`;
      this.root.style.top = `${anchor.top}px`;
    }
    this.root.style.display = "none"; // hidden until racing
    this.root.append(this.lap, this.pos, this.time);

    this.update({ lap: 1, targetLaps, position: 1, totalKarts, timer: 0 });
    container.appendChild(this.root);
  }

  /** Update the displayed lap / position / timer. */
  update(state: HudState): void {
    const lap = Math.max(1, Math.min(state.lap, this.targetLaps));
    this.lap.textContent = `LAP ${lap}/${this.targetLaps}`;
    this.pos.textContent = `POS ${state.position}/${this.totalKarts}`;
    this.time.textContent = formatTime(state.timer);
  }

  show(): void {
    this.root.style.display = "block";
  }

  hide(): void {
    this.root.style.display = "none";
  }

  remove(): void {
    this.root.remove();
  }
}

/** Race timer formatter: m:ss.cc (centiseconds). Pure. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s * 100) % 100);
  return `${m}:${pad2(sec)}.${pad2(cs)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
