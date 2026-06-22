/**
 * 007 minimap overlay (canvas 2D). Caches the track polyline once (projected
 * world XZ -> canvas), then redraws the line + per-kart blips each update.
 * North-up (world +Z maps to map-up), pointer-events:none, z 10 (006 parity).
 *
 * Uses a path sampler interface so it stays decoupled from terrain/, and
 * exports a pure projectXZ() for unit tests. jsdom has no 2D canvas context
 * (no `canvas` npm dep), so every ctx call is null-guarded; the cached polyline
 * + projection stay testable without a real context.
 */

export interface MinimapPath {
  /** Sample the loop at t in [0,1] -> world {x,z}. */
  getPoint(t: number): { x: number; z: number };
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
  /** Polyline sample count (cached once). Default 96. */
  samples?: number;
}

const DEFAULTS: Required<MinimapOptions> = {
  size: 160,
  halfExtent: 100,
  samples: 96,
};

const PLAYER_COLOR = "#ffd23f";
const RIVAL_COLOR = "#cfd8dc";
const TRACK_COLOR = "rgba(255,255,255,0.55)";

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

export class Minimap {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly size: number;
  private readonly halfExtent: number;
  /** Cached projected track polyline (canvas px). */
  readonly polyline: ReadonlyArray<readonly [number, number]>;

  constructor(container: HTMLElement, path: MinimapPath, opts: MinimapOptions = {}) {
    const o = { ...DEFAULTS, ...opts };
    this.size = o.size;
    this.halfExtent = o.halfExtent;

    this.canvas = document.createElement("canvas");
    this.canvas.width = o.size;
    this.canvas.height = o.size;
    this.canvas.style.cssText = "display:block;width:" + o.size + "px;height:" + o.size + "px";

    this.root = document.createElement("div");
    this.root.className = "gc-minimap";
    this.root.style.cssText = ROOT_STYLE;
    this.root.style.display = "none";
    this.root.appendChild(this.canvas);
    container.appendChild(this.root);

    this.ctx = this.canvas.getContext("2d");

    // Cache the polyline once from the path sampler.
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < o.samples; i++) {
      const p = path.getPoint(i / o.samples);
      const pr = projectXZ(p.x, p.z, o.size, o.halfExtent);
      pts.push([pr.px, pr.py]);
    }
    this.polyline = pts;
    this.drawTrack();
  }

  /** Redraw the map: cached track line + one blip per kart. */
  update(karts: readonly MinimapKart[]): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.size, this.size);
    this.drawTrack();
    for (const k of karts) {
      const pr = projectXZ(k.x, k.z, this.size, this.halfExtent);
      ctx.beginPath();
      ctx.fillStyle = k.player ? PLAYER_COLOR : RIVAL_COLOR;
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

  /**
   * Position the minimap at an explicit CSS {left,top}, clearing the default
   * bottom-right anchor. 008 calls this to center the shared minimap on the
   * horizontal seam in 2P; 1P leaves the default bottom-right (no call).
   */
  place(pos: { left: number; top: number }): void {
    this.root.style.right = "auto";
    this.root.style.bottom = "auto";
    this.root.style.left = `${pos.left}px`;
    this.root.style.top = `${pos.top}px`;
  }

  remove(): void {
    this.root.remove();
  }

  private drawTrack(): void {
    const ctx = this.ctx;
    if (!ctx || this.polyline.length < 2) return;
    ctx.strokeStyle = TRACK_COLOR;
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
}
