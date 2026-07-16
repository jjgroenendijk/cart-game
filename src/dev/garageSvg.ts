/**
 * SVG overlay rendering for the dev garage viewer (src/dev/Garage.ts). Given an
 * <svg> element and an OverlayScene (from garageOverlay.ts), draws the metric
 * grid, 1 m scale bar, and labeled dimension lines with dark halos. Split out of
 * Garage.ts to hold that file under the hand-written line cap; touches only the
 * passed SVG node — no THREE, no WebGL — so it is jsdom-safe.
 */

import type { OverlayLine, OverlayScene } from "./garageOverlay";

export const SVG_NS = "http://www.w3.org/2000/svg";

/** Per-role SVG stroke styling for overlay lines. */
export function lineStyle(role: OverlayLine["role"]): {
  color: string;
  width: number;
  halo: boolean;
} {
  if (role === "grid") return { color: "#7f8896", width: 1, halo: false };
  if (role === "scale") return { color: "#ffffff", width: 2, halo: true };
  return { color: "#ffd23f", width: 2, halo: true }; // dim + cap
}

function svgNode(svg: SVGElement, tag: string, attrs: Record<string, string | number>): Element {
  const node = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) node.setAttribute(k, String(attrs[k]));
  return svg.appendChild(node);
}

/**
 * Redraw `scene` into `svg`, clearing prior children first. Grid lines are
 * skipped when `showGrid` is false (dimension/scale lines always draw).
 */
export function renderOverlayInto(svg: SVGElement, scene: OverlayScene, showGrid: boolean): void {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  for (const l of scene.lines) {
    if (l.role === "grid" && !showGrid) continue;
    const s = lineStyle(l.role);
    const geom = { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 };
    if (s.halo) {
      svgNode(svg, "line", {
        ...geom,
        stroke: "#0a0a0d",
        "stroke-width": s.width + 2,
        "stroke-opacity": 0.55,
      });
    }
    const op = l.role === "grid" ? 0.28 : 1;
    svgNode(svg, "line", {
      ...geom,
      stroke: s.color,
      "stroke-width": s.width,
      "stroke-opacity": op,
    });
  }
  for (const t of scene.labels) {
    const node = svgNode(svg, "text", {
      x: t.x,
      y: t.y,
      "text-anchor": t.anchor,
      "dominant-baseline": "middle",
      fill: "#ffffff",
      stroke: "#0a0a0d",
      "stroke-width": 3.5,
      "paint-order": "stroke",
      "font-family": "ui-monospace,Menlo,monospace",
      "font-size": 12,
    });
    node.textContent = t.text;
  }
}
