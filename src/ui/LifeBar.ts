/**
 * 018 life bar overlay (DOM). Blue arcade bar shown per human player while in
 * water. Drains (width tracks life 0..1) while submerged; hidden when out of
 * water. Follows the 007 RaceHud pattern: plain HTMLElements + cssText,
 * appended to the container, removed on dispose.
 */

export interface LifeBarAnchor {
  left: number;
  top: number;
}

const ROOT_STYLE = [
  "position:absolute",
  "left:14px",
  "top:84px",
  "z-index:5",
  "width:140px",
  "height:10px",
  "background:rgba(0,0,0,0.45)",
  "border:1px solid rgba(255,255,255,0.5)",
  "border-radius:5px",
  "pointer-events:none",
].join(";");

const FILL_STYLE = [
  "position:absolute",
  "left:1px",
  "top:1px",
  "height:8px",
  "width:100%",
  "border-radius:4px",
  "background:linear-gradient(90deg,#29b6f6,#0288d1)",
  "box-shadow:0 0 6px rgba(2,136,209,0.8)",
].join(";");

export class LifeBar {
  private readonly root: HTMLElement;
  private readonly fill: HTMLElement;

  constructor(container: HTMLElement, anchor?: LifeBarAnchor) {
    this.fill = document.createElement("div");
    this.fill.className = "gc-life-bar-fill";
    this.fill.style.cssText = FILL_STYLE;

    this.root = document.createElement("div");
    this.root.className = "gc-life-bar";
    this.root.style.cssText = ROOT_STYLE;
    if (anchor) {
      this.root.style.left = `${anchor.left}px`;
      this.root.style.top = `${anchor.top}px`;
    }
    this.root.style.display = "none";
    this.root.appendChild(this.fill);

    container.appendChild(this.root);
  }

  /** Update the bar: `life` in [0,1] sets fill width; `inWater` toggles visibility. */
  update(life: number, inWater: boolean): void {
    const pct = Math.round(clamp(life, 0, 1) * 100);
    this.fill.style.width = `${pct}%`;
    this.root.style.display = inWater ? "block" : "none";
  }

  /** Reposition the bar (called on window resize). */
  setAnchor(anchor: LifeBarAnchor): void {
    this.root.style.left = `${anchor.left}px`;
    this.root.style.top = `${anchor.top}px`;
  }

  /** Detach the bar from the DOM. */
  remove(): void {
    this.root.remove();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi));
}
