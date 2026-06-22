import type { Kart } from "../kart/Kart";
import type { ChaseCamera } from "../kart/ChaseCamera";
import type { Rect } from "./Renderer";

export type { Rect, splitRects } from "./Renderer";

/** Which corner of a viewport rect a HUD element anchors to. */
export type HudCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** A CSS placement point (top-origin, px). */
export interface CssPoint {
  left: number;
  top: number;
}

/**
 * CSS {left,top} (top-origin) of the named corner of a WebGL bottom-origin
 * viewport `rect`, given the full screen size. Used to anchor each player's
 * HUD inside its own split-screen half: a top-half rect -> screen-top; a
 * bottom-half rect -> mid-screen. The result is clamped inside the screen so
 * an oversized rect can never push a HUD off-canvas. Pure.
 *
 * Caller adds its own pixel offset from the corner (e.g. speed HUD at
 * corner + 14px, race HUD at corner + 58px).
 */
export function viewHudAnchor(
  rect: Rect,
  corner: HudCorner,
  screenW: number,
  screenH: number,
): CssPoint {
  // WebGL y grows up; CSS y grows down. The rect's top edge in CSS is the
  // screen height minus the rect's top (y + h) in WebGL space.
  const cssTop = screenH - (rect.y + rect.h);
  const cssLeft = rect.x;
  let left: number;
  let top: number;
  switch (corner) {
    case "top-left":
      left = cssLeft;
      top = cssTop;
      break;
    case "top-right":
      left = cssLeft + rect.w;
      top = cssTop;
      break;
    case "bottom-left":
      left = cssLeft;
      top = cssTop + rect.h;
      break;
    case "bottom-right":
      left = cssLeft + rect.w;
      top = cssTop + rect.h;
      break;
  }
  // Clamp inside the screen (defensive against rects past the canvas edge).
  left = clamp(left, 0, screenW);
  top = clamp(top, 0, screenH);
  return { left, top };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 008 per-human race surface. Bundles one player's kart + chase camera +
 * viewport rect + speed HUD element so Game can drive a uniform PlayerView[]
 * (1 for 1P, 2 for 2P) instead of special-casing P1. The chase cam follows
 * the kart; sync() copies the physics transform to the mesh each frame;
 * setSpeed() updates the per-view speed readout.
 *
 * Game owns physics-body + scene-group teardown on dispose (it has the
 * PhysicsWorld + scene); PlayerView only detaches its own DOM element.
 */
export class PlayerView {
  readonly kart: Kart;
  readonly chaseCam: ChaseCamera;
  rect: Rect;
  private readonly speedEl: HTMLElement;

  constructor(kart: Kart, chaseCam: ChaseCamera, rect: Rect, speedEl: HTMLElement) {
    this.kart = kart;
    this.chaseCam = chaseCam;
    this.rect = rect;
    this.speedEl = speedEl;
  }

  /** Per-frame chase-camera follow from the kart's current transform + state. */
  updateCamera(dt: number): void {
    const pos = this.kart.group.position;
    this.chaseCam.update(
      dt,
      pos,
      this.kart.forwardDir,
      this.kart.speed,
      this.kart.controller.isDrifting,
    );
  }

  /** Copy the physics transform to the mesh (once per render frame). */
  sync(frameAlpha: number): void {
    this.kart.sync(frameAlpha);
  }

  /** Update the per-view speed readout (km/h, already rounded by caller). */
  setSpeed(kmh: number): void {
    this.speedEl.textContent = `${kmh} km/h`;
  }

  /** Detach the per-view speed element from the DOM. */
  removeHud(): void {
    this.speedEl.remove();
  }
}
