/**
 * 012 shared menu navigation: keyboard arrows + gamepad D-pad/stick edge
 * detection for StartMenu, PauseOverlay, SettingsOverlay. Each overlay owns a
 * MenuNav instance, started when visible + disposed when hidden/removed.
 *
 * Keyboard scope is intentionally narrow: ONLY ArrowUp/ArrowDown move focus
 * (preventDefault stops page scroll). ArrowLeft/Right, Enter, Escape are left
 * to the browser + existing handlers: Left/Right natively nudge a focused
 * range slider; Enter natively activates a focused button (and StartMenu maps
 * Enter/Space -> onStart); Escape is owned by Game.onKeydown (closes settings,
 * resumes from pause). This keeps MenuNav conflict-free with those handlers.
 *
 * Gamepad (polled via rAF when navigator.getGamepads exists): D-pad/stick
 * up/down move focus, left/right step the focused slider (onHorizontal),
 * A (button 0) confirms, B (button 1) sends a synthetic Escape keydown so
 * Game.onKeydown handles back uniformly.
 *
 * digestGamepad is a PURE edge-detector (no DOM) so it runs under jsdom. It
 * mirrors Input.ts AXIS_DEADZONE (0.18) + a ~250 ms repeat guard so a HELD
 * stick/D-pad does not spam: one edge on threshold crossing, then a repeat
 * only after NAV_REPEAT_MS of continuous hold.
 */

export type MenuNavEdge = "up" | "down" | "left" | "right" | "confirm" | "back";

/** Snapshot of the gamepad axes/buttons MenuNav cares about. */
export interface GamepadSnap {
  /** [x, y] of the left stick, with D-pad folded in as +/-1 deflection. */
  axes: [number, number];
  /** Pressed state per index (A=0, B=1 minimum). */
  buttons: boolean[];
  /**
   * Carry-forward per-direction lastEdgeTime (ms). Managed by digestGamepad;
   * callers building a fresh snapshot from a real gamepad omit it (undefined
   * is treated as "no prior edge"). Present so the pure repeat guard works.
   */
  nav?: NavTiming;
}

/** Per-direction last edge timestamp (ms); 0 means no edge in this gesture. */
export interface NavTiming {
  up: number;
  down: number;
  left: number;
  right: number;
}

export interface DigestResult {
  edges: MenuNavEdge[];
  next: GamepadSnap;
}

export const NAV_DEADZONE = 0.18;
export const NAV_REPEAT_MS = 250;

const EMPTY_NAV: NavTiming = { up: 0, down: 0, left: 0, right: 0 };

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Pure: given the previous + current gamepad snapshots and a timestamp (ms),
 * return the edges that fired this poll and the new snapshot to carry forward.
 * Axis edges fire on threshold crossing; a held direction repeats after
 * NAV_REPEAT_MS. Button edges (A=confirm, B=back) fire on the press transition
 * only. D-pad is represented by the caller as axis values at +/-1 (folded into
 * axes by snapFromGamepad). Never throws on malformed input (empty edges).
 */
export function digestGamepad(
  prev: GamepadSnap | null,
  cur: GamepadSnap,
  now: number,
): DigestResult {
  const edges: MenuNavEdge[] = [];
  if (!cur || typeof cur !== "object") return { edges, next: cur };

  const curAx0 = num(cur.axes?.[0]);
  const curAx1 = num(cur.axes?.[1]);
  const prevAx0 = num(prev?.axes?.[0]);
  const prevAx1 = num(prev?.axes?.[1]);
  const ns: NavTiming = prev?.nav ? { ...prev.nav } : { ...EMPTY_NAV };

  type Dir = { edge: MenuNavEdge; active: boolean; was: boolean; key: keyof NavTiming };
  const dirs: Dir[] = [
    { edge: "up", active: curAx1 < -NAV_DEADZONE, was: prevAx1 < -NAV_DEADZONE, key: "up" },
    { edge: "down", active: curAx1 > NAV_DEADZONE, was: prevAx1 > NAV_DEADZONE, key: "down" },
    { edge: "left", active: curAx0 < -NAV_DEADZONE, was: prevAx0 < -NAV_DEADZONE, key: "left" },
    { edge: "right", active: curAx0 > NAV_DEADZONE, was: prevAx0 > NAV_DEADZONE, key: "right" },
  ];

  for (const d of dirs) {
    if (!d.active) {
      ns[d.key] = 0; // released -> reset so the next gesture starts fresh
      continue;
    }
    const crossing = !d.was;
    if (crossing || now - ns[d.key] >= NAV_REPEAT_MS) {
      edges.push(d.edge);
      ns[d.key] = now;
    }
  }

  // Buttons: A (0) confirm, B (1) back; edge on false -> true only.
  const curBtn = cur.buttons ?? [];
  const prevBtn = prev?.buttons ?? [];
  if (!prevBtn[0] && curBtn[0]) edges.push("confirm");
  if (!prevBtn[1] && curBtn[1]) edges.push("back");

  return { edges, next: { ...cur, nav: ns } };
}

/** Build a snapshot from a live Gamepad, folding D-pad buttons into axes. */
function snapFromGamepad(gp: Gamepad): GamepadSnap {
  const axes = gp.axes ?? [];
  let x = num(axes[0]);
  let y = num(axes[1]);
  const b = gp.buttons ?? [];
  // Standard mapping: 12 up, 13 down, 14 left, 15 right.
  if (b[12]?.pressed) y = -1;
  if (b[13]?.pressed) y = 1;
  if (b[14]?.pressed) x = -1;
  if (b[15]?.pressed) x = 1;
  const buttons = b.map((btn) => !!(btn && (btn.pressed || num(btn.value) > 0.5)));
  return { axes: [x, y], buttons };
}

export interface MenuNavOptions {
  /** Ordered focusable controls (re-read each edge so shrinks are safe). */
  elements: () => HTMLElement[];
  /** Gamepad left/right on the focused control (e.g. step a slider). */
  onHorizontal?: (dir: 1 | -1, el: HTMLElement) => void;
}

export class MenuNav {
  private readonly opts: MenuNavOptions;
  private readonly onKey: (e: KeyboardEvent) => void;
  private readonly loop: () => void;
  private index = 0;
  private started = false;
  private rafId = 0;
  private prev: GamepadSnap | null = null;

  constructor(opts: MenuNavOptions) {
    this.opts = opts;
    this.onKey = (e: KeyboardEvent) => {
      if (e.code === "ArrowDown") {
        e.preventDefault();
        this.move(1);
      } else if (e.code === "ArrowUp") {
        e.preventDefault();
        this.move(-1);
      }
    };
    this.loop = () => {
      if (!this.started) return;
      this.pollGamepad();
      this.rafId = requestAnimationFrame(this.loop);
    };
  }

  /** Attach arrow keydown listener, start rAF gamepad poll, focus elements()[0]. */
  start(): void {
    if (this.started) return;
    this.started = true;
    window.addEventListener("keydown", this.onKey);
    this.index = 0;
    this.opts.elements()[0]?.focus();
    // Only spin the rAF poll when the Gamepad API exists; jsdom has none, so
    // keyboard nav still works without leaking an infinite rAF chain.
    if (typeof navigator.getGamepads === "function") {
      this.rafId = requestAnimationFrame(this.loop);
    }
  }

  /** Re-read elements, wrap delta within [0,len), focus the target. */
  move(delta: number): void {
    const els = this.opts.elements();
    const n = els.length;
    if (n === 0) return;
    this.index = (((this.index + delta) % n) + n) % n;
    els[this.index]?.focus();
  }

  private pollGamepad(): void {
    const get = navigator.getGamepads;
    if (typeof get !== "function") return;
    let pads: (Gamepad | null)[];
    try {
      pads = get.call(navigator) ?? [];
    } catch {
      return;
    }
    const gp = pads.find((g) => g) ?? null;
    if (!gp) return;
    const snap = snapFromGamepad(gp);
    const { edges, next } = digestGamepad(this.prev, snap, performance.now());
    this.prev = next;
    for (const edge of edges) this.applyEdge(edge);
  }

  private applyEdge(edge: MenuNavEdge): void {
    const focused = document.activeElement as HTMLElement | null;
    switch (edge) {
      case "up":
        this.move(-1);
        break;
      case "down":
        this.move(1);
        break;
      case "left":
        if (focused) this.opts.onHorizontal?.(-1, focused);
        break;
      case "right":
        if (focused) this.opts.onHorizontal?.(1, focused);
        break;
      case "confirm":
        focused?.click();
        break;
      case "back":
        // Reuse Game.onKeydown's Escape path (closes settings / resumes).
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
        break;
    }
  }

  /** Detach listener + cancel rAF poll. Idempotent. */
  dispose(): void {
    if (!this.started) return;
    this.started = false;
    window.removeEventListener("keydown", this.onKey);
    cancelAnimationFrame(this.rafId);
    this.prev = null;
  }
}
