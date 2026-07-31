/**
 * 278 graphics quality cycle row for SettingsOverlay. Editorial selector row
 * (label left, `◀ value ▶` right) mirroring RaceConfigOverlay.makeRow: row
 * body click + keyboard arrows + gamepad left/right cycle the tier; chevrons
 * cycle their direction (stopPropagation keeps the row click single). A muted
 * hint notes draw distance swaps on the next world rebuild (stream radii re-apply
 * in buildWorld, not live). Notifies a single onChange (the parent emits the
 * full SettingsState); the parent reads the current tier via .tier and pushes
 * it back via setTier on refresh. Plain DOM + cssText + the menuStyles kit.
 */

import type { QualityTier } from "../core/quality";
import {
  INK_MUTED,
  selectorChevronStyle,
  selectorRowStyle,
  selectorValueStyle,
  telemetryKey,
} from "./menuStyles";

const QUALITY_TIERS = ["low", "med", "high"] as const satisfies readonly QualityTier[];
const QUALITY_LABELS = ["LOW", "MED", "HIGH"] as const;

const HINT_STYLE = [
  "padding:2px 6px 10px",
  "font-size:10px",
  "letter-spacing:0.08em",
  `color:${INK_MUTED}`,
  "text-align:left",
].join(";");

export class QualityRow {
  /** Focusable selector row (keyboard/gamepad focus unit). */
  readonly row: HTMLDivElement;
  /** Muted draw-distance caption appended under the row. */
  readonly hint: HTMLDivElement;
  private readonly value: HTMLSpanElement;
  private readonly onChange: () => void;
  private index: number;

  constructor(initial: QualityTier, onChange: () => void) {
    this.onChange = onChange;
    this.index = Math.max(0, QUALITY_TIERS.indexOf(initial));

    const row = document.createElement("div");
    row.className = "gc-row gc-settings-quality";
    row.tabIndex = 0;
    row.style.cssText = selectorRowStyle();
    row.addEventListener("click", () => this.cycle(1));

    const label = document.createElement("span");
    label.textContent = "QUALITY";
    label.style.cssText = telemetryKey();

    const value = document.createElement("span");
    value.className = "gc-settings-quality-value";
    value.style.cssText = selectorValueStyle();
    value.textContent = QUALITY_LABELS[this.index];

    const chevron = (dir: 1 | -1, cls: string, text: string): HTMLButtonElement => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `gc-chevron ${cls}`;
      btn.tabIndex = -1;
      btn.textContent = text;
      btn.style.cssText = selectorChevronStyle();
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.cycle(dir);
      });
      return btn;
    };

    const cluster = document.createElement("div");
    cluster.style.cssText = "display:inline-flex;align-items:center;gap:8px";
    cluster.append(
      chevron(-1, "gc-settings-quality-prev", "◀"),
      value,
      chevron(1, "gc-settings-quality-next", "▶"),
    );

    row.append(label, cluster);
    this.row = row;
    this.value = value;

    const hint = document.createElement("div");
    hint.className = "gc-settings-quality-hint";
    hint.style.cssText = HINT_STYLE;
    hint.textContent = "Draw distance applies next race";
    this.hint = hint;
  }

  /** Current tier value carried in the emitted SettingsState. */
  get tier(): QualityTier {
    return QUALITY_TIERS[this.index];
  }

  /** External-driven update (refresh): set the tier WITHOUT firing onChange. */
  setTier(t: QualityTier): void {
    this.index = Math.max(0, QUALITY_TIERS.indexOf(t));
    this.value.textContent = QUALITY_LABELS[this.index];
  }

  /** Wrap-around advance of the tier + notify the parent to emit. */
  cycle(dir: 1 | -1): void {
    const n = QUALITY_TIERS.length;
    this.index = (((this.index + dir) % n) + n) % n;
    this.value.textContent = QUALITY_LABELS[this.index];
    this.onChange();
  }

  /** Keyboard left/right cycle when the row holds focus. */
  private onKey = (e: KeyboardEvent): void => {
    if (document.activeElement !== this.row) return;
    if (e.code === "ArrowLeft") {
      e.preventDefault();
      this.cycle(-1);
    } else if (e.code === "ArrowRight") {
      e.preventDefault();
      this.cycle(1);
    }
  };

  /** Attach the keyboard cycle listener (when the overlay becomes visible). */
  attach(): void {
    window.addEventListener("keydown", this.onKey);
  }

  /** Detach the keyboard cycle listener (when the overlay is hidden/removed). */
  detach(): void {
    window.removeEventListener("keydown", this.onKey);
  }
}
