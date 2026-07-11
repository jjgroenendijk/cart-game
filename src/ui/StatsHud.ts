/**
 * 011 perf HUD overlay (DOM). Self-driving: a guarded requestAnimationFrame
 * loop samples frame time (EWMA-smoothed) plus a RenderInfoSnapshot supplied
 * by the caller, classifies each metric against DEFAULT_BUDGET_1P, and writes
 * a monospace multi-line readout. F3 toggles visibility; an optional
 * visibleWhen predicate can force-hide the overlay (e.g. outside racing).
 *
 * Mirrors the RaceHud/StartMenu DOM pattern: plain HTMLElement + cssText,
 * appended to a container, removed on remove(). info is a callback returning
 * plain numbers so this module stays decoupled from THREE/WebGL and runs under
 * jsdom unit tests (the rAF loop is guarded so it never breaks jsdom).
 */

import {
  classify,
  DEFAULT_BUDGET_1P,
  FrameMsEwma,
  type MetricStatus,
  type PerfClassification,
  type PerfSample,
} from "../core/stats";
import { HAIRLINE, INK, PANEL_INK } from "./menuStyles";

/**
 * Per-frame render totals supplied by the caller (Renderer.getFrameStats):
 * calls/triangles sum across every view + composer pass for one whole
 * game frame (not a single arbitrary sub-pass); geometries/textures are
 * live GL-resource counts. jsdom-stubbable (plain numbers, no THREE).
 */
export interface RenderInfoSnapshot {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

const ROOT_STYLE = [
  "position:absolute",
  "left:8px",
  "top:8px",
  "z-index:8",
  "pointer-events:none",
  `color:${INK}`,
  `background:${PANEL_INK}`,
  `border:1px solid ${HAIRLINE}`,
  "padding:6px 8px",
  "font-family:ui-monospace,monospace",
  "font-size:13px",
  "line-height:1.45",
  "white-space:pre",
].join(";");

function glyph(status: MetricStatus): string {
  if (status === "warn") return "~";
  if (status === "bad") return "!";
  return "";
}

/**
 * Pure formatter: returns the multi-line perf readout. Each classified line
 * (FRAME/CALLS/TRIS) is prefixed with "" / "~" / "!" from its status; FPS,
 * GEO, and TEX carry no glyph. frameMs renders to 1 decimal; tris renders in
 * thousands with a `k` suffix. Main unit-test target.
 */
export function formatStats(sample: PerfSample, cls: PerfClassification): string {
  const fps = Math.round(sample.fps);
  const frame = sample.frameMs.toFixed(1);
  const calls = sample.drawCalls;
  const tris = `${Math.round(sample.tris / 1000)}k`;
  const geo = sample.geometries;
  const tex = sample.textures;
  return [
    `FPS ${fps}`,
    `${glyph(cls.frameMs)}FRAME ${frame} ms`,
    `${glyph(cls.drawCalls)}CALLS ${calls}`,
    `${glyph(cls.tris)}TRIS ${tris}`,
    `GEO ${geo}`,
    `TEX ${tex}`,
  ].join("\n");
}

export class StatsHud {
  private readonly root: HTMLElement;
  private readonly info: () => RenderInfoSnapshot;
  private readonly visibleWhen?: () => boolean;
  private readonly ewma = new FrameMsEwma();
  private readonly onKeydown: (e: KeyboardEvent) => void;
  private readonly tick: () => void;
  private visible = false;
  private lastTs = 0;
  private rafId: number | null = null;

  constructor(container: HTMLElement, info: () => RenderInfoSnapshot, visibleWhen?: () => boolean) {
    this.info = info;
    this.visibleWhen = visibleWhen;

    this.root = document.createElement("div");
    this.root.className = "gc-stats";
    this.root.style.cssText = ROOT_STYLE;
    this.root.style.display = "none";
    container.appendChild(this.root);

    this.onKeydown = (e: KeyboardEvent) => {
      if (e.key === "F3") {
        e.preventDefault();
        this.setVisible(!this.visible);
      }
    };
    window.addEventListener("keydown", this.onKeydown);

    this.tick = () => {
      const now = performance.now();
      const dt = now - this.lastTs;
      this.lastTs = now;
      this.ewma.push(dt);
      const frameMs = this.ewma.smoothed;
      const fps = frameMs > 0 ? 1000 / frameMs : 0;
      const snap = this.info();
      const sample: PerfSample = {
        frameMs,
        fps,
        drawCalls: snap.calls,
        tris: snap.triangles,
        geometries: snap.geometries,
        textures: snap.textures,
      };
      const cls = classify(sample, DEFAULT_BUDGET_1P);
      this.root.textContent = formatStats(sample, cls);
      this.applyDisplay();
      if (typeof requestAnimationFrame === "function") {
        this.rafId = requestAnimationFrame(this.tick);
      }
    };

    if (typeof requestAnimationFrame === "function") {
      this.lastTs = performance.now();
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  private setVisible(v: boolean): void {
    this.visible = v;
    this.applyDisplay();
  }

  private applyDisplay(): void {
    if (!this.visible) {
      this.root.style.display = "none";
      return;
    }
    if (this.visibleWhen && !this.visibleWhen()) {
      this.root.style.display = "none";
      return;
    }
    this.root.style.display = "block";
  }

  /** Cancel rAF, drop the keydown listener, detach the root. Idempotent. */
  remove(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    window.removeEventListener("keydown", this.onKeydown);
    this.root.remove();
  }
}
