/**
 * Free-fly spectator HUD overlay (DOM). Shows a center reticle (MENU_ACCENT)
 * plus a bottom-left telemetry block (POS x y z / YAW deg / PITCH deg) built
 * from the menuStyles.ts neutral tokens. Plain HTMLElements + cssText set ONCE
 * at construction; update() only mutates the readout textContent. Visible only
 * while the free-fly camera is active (Game toggles show()/hide()).
 *
 * Mirrors RaceHud/StatsHud: takes a pure {@link FreeFlyState} (no THREE) so it
 * is jsdom-testable. The pose formatter is exported pure for unit tests.
 */

import type { FreeFlyState } from "../core/freeFly";
import { HAIRLINE, INK, MENU_ACCENT, PANEL_INK } from "./menuStyles";

const ROOT_STYLE = [
  "position:absolute",
  "left:0",
  "top:0",
  "width:100%",
  "height:100%",
  "z-index:6",
  "pointer-events:none",
  "display:none",
].join(";");

const RETICLE_WRAP_STYLE = [
  "position:absolute",
  "left:50%",
  "top:50%",
  "transform:translate(-50%,-50%)",
  "width:18px",
  "height:18px",
].join(";");

const RETICLE_BAR_STYLE = [
  "position:absolute",
  "left:50%",
  "top:50%",
  `background:${MENU_ACCENT}`,
  "transform:translate(-50%,-50%)",
].join(";");

const READOUT_STYLE = [
  "position:absolute",
  "left:14px",
  "bottom:14px",
  `color:${INK}`,
  `background:${PANEL_INK}`,
  `border:1px solid ${HAIRLINE}`,
  "padding:6px 9px",
  "font-family:ui-monospace,monospace",
  "font-size:12px",
  "line-height:1.5",
  "white-space:pre",
  "text-shadow:0 1px 4px rgba(0,0,0,0.7)",
].join(";");

/**
 * Pure formatter for the pose readout. Position in world units (1 decimal),
 * yaw/pitch in degrees (1 decimal). yaw is heading: 0 looks down -Z, positive
 * turns toward -X (see src/core/freeFly.ts). Main unit-test target.
 */
export function formatFreeFlyPose(state: FreeFlyState): string {
  const { x, y, z } = state.position;
  const yawDeg = radToDeg(state.yaw);
  const pitchDeg = radToDeg(state.pitch);
  return [
    `POS  ${x.toFixed(1)} ${y.toFixed(1)} ${z.toFixed(1)}`,
    `YAW  ${yawDeg.toFixed(1)}\u00b0`,
    `PITCH ${pitchDeg.toFixed(1)}\u00b0`,
  ].join("\n");
}

export class FreeFlyHud {
  private readonly root: HTMLElement;
  private readonly readout: HTMLElement;

  constructor(container: HTMLElement) {
    // Reticle: two thin MENU_ACCENT bars forming a centered crosshair.
    const vBar = document.createElement("div");
    vBar.style.cssText = `${RETICLE_BAR_STYLE};width:1.5px;height:18px`;
    const hBar = document.createElement("div");
    hBar.style.cssText = `${RETICLE_BAR_STYLE};width:18px;height:1.5px`;
    const reticle = document.createElement("div");
    reticle.style.cssText = RETICLE_WRAP_STYLE;
    reticle.append(vBar, hBar);

    this.readout = document.createElement("div");
    this.readout.style.cssText = READOUT_STYLE;
    this.readout.textContent = "";

    this.root = document.createElement("div");
    this.root.className = "gc-freefly-hud";
    this.root.style.cssText = ROOT_STYLE;
    this.root.append(reticle, this.readout);

    container.appendChild(this.root);
  }

  /** Update the pose readout (textContent only). */
  update(state: FreeFlyState): void {
    this.readout.textContent = formatFreeFlyPose(state);
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
}

function radToDeg(r: number): number {
  return (r * 180) / Math.PI;
}
