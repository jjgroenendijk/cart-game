/**
 * DOM writer for the garage dimension overlay. Given an <svg> element and an
 * OverlayScene (pure pixel primitives from garageOverlay.ts), it clears then
 * redraws the metric grid, 1 m scale bar, and labeled dimension lines as crisp
 * SVG with per-role styling and dark halos for legibility. Split out of Garage.ts
 * so the single-view viewer (Garage.ts) and the multi-angle grid (GarageGrid.ts)
 * share one renderer. DOM-only (no THREE); the grid role is skipped when the
 * caller has the ground grid toggled off.
 */

import type { OverlayLine, OverlayScene } from "./garageOverlay";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Per-role SVG stroke styling for overlay lines. */
function lineStyle(role: OverlayLine["role"]): { color: string; width: number; halo: boolean } {
  if (role === "grid") return { color: "#7f8896", width: 1, halo: false };
  if (role === "scale") return { color: "#ffffff", width: 2, halo: true };
  return { color: "#ffd23f", width: 2, halo: true }; // dim + cap
}

/** Redraw `scene` into `svg`, replacing any prior content. */
export function renderOverlayInto(svg: SVGElement, scene: OverlayScene, showGrid: boolean): void {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const node = (tag: string, attrs: Record<string, string | number>): Element => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, String(attrs[k]));
    return svg.appendChild(el);
  };
  for (const l of scene.lines) {
    if (l.role === "grid" && !showGrid) continue;
    const s = lineStyle(l.role);
    const geom = { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 };
    if (s.halo) {
      node("line", {
        ...geom,
        stroke: "#0a0a0d",
        "stroke-width": s.width + 2,
        "stroke-opacity": 0.55,
      });
    }
    const op = l.role === "grid" ? 0.28 : 1;
    node("line", { ...geom, stroke: s.color, "stroke-width": s.width, "stroke-opacity": op });
  }
  for (const t of scene.labels) {
    const text = node("text", {
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
    text.textContent = t.text;
  }
}
