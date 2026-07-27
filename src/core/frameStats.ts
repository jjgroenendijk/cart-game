/**
 * Frame-accumulated renderer.info sampler (split from Renderer for the
 * file-size cap; behavior unchanged). Owns the FrameStats shape + the
 * per-frame copy out of a WebGLRenderer.info. Structural info type keeps
 * this module WebGL-free + jsdom-safe (mirrors debugSnapshot.ts).
 */

/**
 * Accumulated renderer.info totals for one whole game frame, sampled once
 * after renderViews. render counters sum across every WebGLRenderer.render()
 * call (all views + every composer pass); memory counters are live totals.
 * autoReset off + one reset() at frame start so three accumulates.
 */
export interface FrameStats {
  calls: number;
  triangles: number;
  lines: number;
  points: number;
  geometries: number;
  textures: number;
  programs: number;
}

/**
 * Structural slice of THREE.WebGLRenderer.info read by snapshot(). Kept loose
 * (no three import) so this module runs under jsdom unit tests.
 */
export interface RendererInfoLike {
  render: { calls: number; triangles: number; lines: number; points: number };
  memory: { geometries: number; textures: number };
  programs: { length: number } | null;
}

/**
 * Per-frame renderer.info sampler. Renderer calls snapshot() once after
 * renderViews (info accumulates across every pass of every view because
 * autoReset is off + one reset() at frame start); callers read the retained
 * FrameStats via get(). Reused across frames (no per-frame alloc).
 */
export class FrameStatsSampler {
  private readonly _stats: FrameStats = {
    calls: 0,
    triangles: 0,
    lines: 0,
    points: 0,
    geometries: 0,
    textures: 0,
    programs: 0,
  };

  /** Copy the frame-accumulated renderer.info into the retained FrameStats. */
  snapshot(info: RendererInfoLike): void {
    const r = info.render;
    const m = info.memory;
    const s = this._stats;
    s.calls = r.calls;
    s.triangles = r.triangles;
    s.lines = r.lines;
    s.points = r.points;
    s.geometries = m.geometries;
    s.textures = m.textures;
    s.programs = info.programs?.length ?? 0;
  }

  /** Read-only snapshot of the last sampled frame (retained, not a copy). */
  get(): FrameStats {
    return this._stats;
  }
}
