/**
 * 007 minimap overlay (canvas 2D). Caches the track polylines once (projected
 * world XZ -> canvas), then redraws the lines + per-kart blips each update.
 * North-up (world +Z maps to map-up), pointer-events:none, z 10 (006 parity).
 *
 * 060: the track is a SHAPE — one closed mainline plus zero or more open
 * branch polylines (drawn thinner/dimmer; cosmetic only, never race logic).
 * setShape re-projects for world rebuilds (biome track traits change width/
 * branches/worldSize). A bare MinimapPath still works (mainline only).
 *
 * jsdom has no 2D canvas context (no `canvas` npm dep), so every ctx call is
 * null-guarded; the cached polylines + projection stay testable without a
 * real context.
 */

import { HAIRLINE, INK_MUTED, MENU_ACCENT, PANEL_INK } from "./menuStyles";

export interface MinimapPath {
  /** Sample the loop at t in [0,1] -> world {x,z}. */
  getPoint(t: number): { x: number; z: number };
}

/** World-space track shape: closed mainline + open branch polylines (060). */
export interface MinimapShape {
  main: ReadonlyArray<{ x: number; z: number }>;
  branches: ReadonlyArray<ReadonlyArray<{ x: number; z: number }>>;
}

export interface MinimapKart {
  x: number;
  z: number;
  /** True for P1 (highlighted); false for rivals (subdued). */
  player: boolean;
}

export interface MinimapOptions {
  /** Canvas edge length (px). Default 160. */
  size?: number;
  /** World half-extent the map covers (m). Default 100. */
  halfExtent?: number;
  /** Polyline sample count for a MinimapPath source (cached once). Default 96. */
  samples?: number;
}

const DEFAULTS: Required<MinimapOptions> = {
  size: 160,
  halfExtent: 100,
  samples: 96,
};

const ROOT_STYLE = [
  "position:absolute",
  "right:14px",
  "bottom:14px",
  "z-index:10",
  "pointer-events:none",
].join(";");

/** Project a world XZ point to canvas pixels (north-up). Pure. */
export function projectXZ(
  x: number,
  z: number,
  size: number,
  halfExtent: number,
): { px: number; py: number } {
  const scale = size / 2 / halfExtent;
  return {
    px: size / 2 + x * scale,
    py: size / 2 - z * scale, // +Z -> up
  };
}

/** Sample a MinimapPath into a world-space shape (mainline only). */
function shapeFromPath(path: MinimapPath, samples: number): MinimapShape {
  const main: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < samples; i++) {
    const p = path.getPoint(i / samples);
    main.push({ x: p.x, z: p.z });
  }
  return { main, branches: [] };
}

export class Minimap {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly size: number;
  private halfExtent: number;
  /** Cached projected mainline polyline (canvas px). */
  polyline: ReadonlyArray<readonly [number, number]> = [];
  /** Cached projected branch polylines (canvas px), thinner/dimmer. */
  branchPolylines: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [];

  constructor(
    container: HTMLElement,
    source: MinimapPath | MinimapShape,
    opts: MinimapOptions = {},
  ) {
    const o = { ...DEFAULTS, ...opts };
    this.size = o.size;
    this.halfExtent = o.halfExtent;

    this.canvas = document.createElement("canvas");
    this.canvas.width = o.size;
    this.canvas.height = o.size;
    this.canvas.style.cssText = [
      "display:block",
      `width:${o.size}px`,
      `height:${o.size}px`,
      `border:1px solid ${HAIRLINE}`,
      `background:${PANEL_INK}`,
    ].join(";");

    this.root = document.createElement("div");
    this.root.className = "gc-minimap";
    this.root.style.cssText = ROOT_STYLE;
    this.root.style.display = "none";
    this.root.appendChild(this.canvas);
    container.appendChild(this.root);

    this.ctx = this.canvas.getContext("2d");

    const shape = "getPoint" in source ? shapeFromPath(source, o.samples) : source;
    this.setShape(shape, this.halfExtent);
  }

  /**
   * Re-project + redraw for a new world shape (biome rebuild: width/branch/
   * worldSize changes). `halfExtent` rescales the map coverage when given.
   */
  setShape(shape: MinimapShape, halfExtent?: number): void {
    if (halfExtent !== undefined) this.halfExtent = halfExtent;
    this.polyline = shape.main.map((p) => {
      const pr = projectXZ(p.x, p.z, this.size, this.halfExtent);
      return [pr.px, pr.py] as const;
    });
    this.branchPolylines = shape.branches.map((line) =>
      line.map((p) => {
        const pr = projectXZ(p.x, p.z, this.size, this.halfExtent);
        return [pr.px, pr.py] as const;
      }),
    );
    this.ctx?.clearRect(0, 0, this.size, this.size);
    this.drawTrack();
  }

  /** Redraw the map: cached track lines + one blip per kart. */
  update(karts: readonly MinimapKart[]): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.size, this.size);
    this.drawTrack();
    for (const k of karts) {
      const pr = projectXZ(k.x, k.z, this.size, this.halfExtent);
      ctx.beginPath();
      ctx.fillStyle = k.player ? MENU_ACCENT : INK_MUTED;
      ctx.arc(pr.px, pr.py, k.player ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
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

  private drawTrack(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.polyline.length >= 2) {
      // INK-hue alpha (not HAIRLINE) keeps the mainline legible over biomes.
      ctx.strokeStyle = INK_MUTED;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const first = this.polyline[0]!;
      ctx.moveTo(first[0], first[1]);
      for (let i = 1; i < this.polyline.length; i++) {
        const p = this.polyline[i]!;
        ctx.lineTo(p[0], p[1]);
      }
      ctx.closePath();
      ctx.stroke();
    }
    // Branches: thinner + dimmer OPEN polylines (no closePath).
    for (const line of this.branchPolylines) {
      if (line.length < 2) continue;
      ctx.strokeStyle = HAIRLINE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(line[0]![0], line[0]![1]);
      for (let i = 1; i < line.length; i++) ctx.lineTo(line[i]![0], line[i]![1]);
      ctx.stroke();
    }
  }
}
