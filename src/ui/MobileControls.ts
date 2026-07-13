/**
 * Touch driving controls for phones (iOS Safari + Android Chrome). A DOM
 * overlay of on-screen pedals/steer/drift/reset buttons plus an accelerometer
 * (tilt) steering mode. Follows the RaceHud/Minimap overlay pattern: owns its
 * nodes, cssText set once, `pointer-events:none` root with `auto` children,
 * visible only while racing (Game toggles show()/hide()).
 *
 * It never reads input itself — every gesture writes into the shared Input via
 * setTouch* setters, on the same axes keyboard/gamepad use (player 0 only):
 *   GAS/BRAKE -> throttle (+accel / -brake, single combined axis)
 *   ◄ / ►     -> steer (+left / -right, per the steering-sign convention)
 *   DRIFT     -> drift hold
 *   RESET     -> one-shot respawn latch
 * Tilt mode replaces the ◄/► buttons: a `deviceorientation` listener maps phone
 * roll to steer via tiltSteer.ts. iOS gates DeviceOrientation behind a
 * permission prompt that must fire from a user gesture, so tilt is armed by the
 * TILT toggle tap. An INVERT toggle flips left/right for devices whose sign is
 * reversed; both prefs persist via mobileControlsStorage.
 *
 * Only the WebGL-free DOM/state lives here (jsdom-testable); the tilt math is
 * the pure tiltSteer.ts module.
 */

import type { Input } from "../core/Input";
import { isTouchDevice, readTiltAxis, tiltToSteer } from "../core/tiltSteer";
import {
  DEFAULT_PREFS,
  loadMobileControlPrefs,
  saveMobileControlPrefs,
  type MobileControlPrefs,
} from "../core/mobileControlsStorage";
import { HAIRLINE, INK, INK_MUTED, MENU_ACCENT, PANEL_INK } from "./menuStyles";

/** iOS 13+ adds a static requestPermission() to DeviceOrientationEvent. */
type PermissionState = "granted" | "denied" | "default";
interface DeviceOrientationCtor {
  requestPermission?: () => Promise<PermissionState>;
}

export interface MobileControlsOptions {
  /** Force the overlay on regardless of touch detection (tests / desktop QA). */
  forceEnabled?: boolean;
  /** Seed prefs instead of loading from storage (tests). */
  prefs?: MobileControlPrefs;
  /** Persist hook override (tests); defaults to mobileControlsStorage. */
  persist?: (prefs: MobileControlPrefs) => void;
}

const ROOT_STYLE = [
  "position:absolute",
  "inset:0",
  "z-index:6",
  "pointer-events:none",
  "touch-action:none",
  "user-select:none",
  "-webkit-user-select:none",
  "font-family:system-ui,sans-serif",
].join(";");

const CLUSTER_STYLE = [
  "position:absolute",
  "bottom:max(22px,env(safe-area-inset-bottom))",
  "display:flex",
  "align-items:flex-end",
  "gap:16px",
].join(";");

const TOPBAR_STYLE = [
  "position:absolute",
  "top:max(12px,env(safe-area-inset-top))",
  "right:max(12px,env(safe-area-inset-right))",
  "display:flex",
  "gap:10px",
  "pointer-events:none",
].join(";");

const BTN_BASE = [
  "pointer-events:auto",
  "display:flex",
  "align-items:center",
  "justify-content:center",
  "box-sizing:border-box",
  "border-radius:16px",
  `border:1px solid ${HAIRLINE}`,
  `background:${PANEL_INK}`,
  `color:${INK}`,
  "font-weight:600",
  "letter-spacing:0.06em",
  "text-transform:uppercase",
  "backdrop-filter:blur(2px)",
  "-webkit-backdrop-filter:blur(2px)",
  "touch-action:none",
  "cursor:pointer",
];

function btnStyle(size: number, font: number, extra: string[] = []): string {
  return [
    ...BTN_BASE,
    `width:${size}px`,
    `min-height:${size}px`,
    `font-size:${font}px`,
    ...extra,
  ].join(";");
}

function pillStyle(): string {
  return [
    ...BTN_BASE,
    "min-height:38px",
    "padding:0 14px",
    "border-radius:12px",
    "font-size:11px",
  ].join(";");
}

export class MobileControls {
  private readonly root: HTMLElement;
  private readonly input: Input;
  private readonly enabled: boolean;
  private readonly persist: (prefs: MobileControlPrefs) => void;
  private prefs: MobileControlPrefs;

  // Live hold state; each change recomputes the merged axis pushed to Input.
  private gasHeld = false;
  private brakeHeld = false;
  private leftHeld = false;
  private rightHeld = false;

  // Tilt (accelerometer) steering state.
  private tiltOn = false;
  private tiltNeutral = 0;
  private tiltCalibrated = false;
  private visible = false;

  // Buttons whose appearance/visibility toggles with tilt mode.
  private readonly leftBtn: HTMLElement;
  private readonly rightBtn: HTMLElement;
  private readonly tiltBtn: HTMLElement;
  private readonly invertBtn: HTMLElement;
  private readonly hint: HTMLElement;

  constructor(container: HTMLElement, input: Input, opts: MobileControlsOptions = {}) {
    this.input = input;
    this.enabled = opts.forceEnabled ?? isTouchDevice();
    this.persist = opts.persist ?? saveMobileControlPrefs;
    this.prefs =
      opts.prefs ?? (opts.forceEnabled ? { ...DEFAULT_PREFS } : loadMobileControlPrefs());

    this.root = document.createElement("div");
    this.root.className = "gc-mobile-controls";
    this.root.style.cssText = ROOT_STYLE;
    this.root.style.display = "none";

    // Left cluster: steer buttons (hidden while tilt drives steering).
    const steerCluster = document.createElement("div");
    steerCluster.style.cssText = `${CLUSTER_STYLE};left:max(18px,env(safe-area-inset-left))`;
    this.leftBtn = this.makeHoldButton("◀", 72, 26, {
      onDown: () => this.setLeft(true),
      onUp: () => this.setLeft(false),
    });
    this.rightBtn = this.makeHoldButton("▶", 72, 26, {
      onDown: () => this.setRight(true),
      onUp: () => this.setRight(false),
    });
    steerCluster.append(this.leftBtn, this.rightBtn);

    // Right cluster: DRIFT stacked over BRAKE + GAS pedals.
    const driveCluster = document.createElement("div");
    driveCluster.style.cssText = `${CLUSTER_STYLE};right:max(18px,env(safe-area-inset-right))`;
    const driftBtn = this.makeHoldButton("Drift", 72, 13, {
      onDown: () => this.setDrift(true),
      onUp: () => this.setDrift(false),
    });
    driftBtn.style.alignSelf = "flex-start";
    const brakeBtn = this.makeHoldButton("▼", 80, 26, {
      onDown: () => this.setBrake(true),
      onUp: () => this.setBrake(false),
    });
    const gasBtn = this.makeHoldButton("▲", 96, 32, {
      onDown: () => this.setGas(true),
      onUp: () => this.setGas(false),
    });
    gasBtn.style.borderColor = MENU_ACCENT;
    driveCluster.append(driftBtn, brakeBtn, gasBtn);

    // Top bar: TILT toggle, INVERT toggle (tilt-only), RESET tap.
    const topbar = document.createElement("div");
    topbar.style.cssText = TOPBAR_STYLE;
    this.tiltBtn = this.makeTapButton("Tilt", pillStyle(), () => void this.toggleTilt());
    this.invertBtn = this.makeTapButton("Invert", pillStyle(), () => this.toggleInvert());
    this.invertBtn.style.display = "none";
    const resetBtn = this.makeTapButton("Reset", pillStyle(), () => this.input.pulseTouchReset());
    topbar.append(this.tiltBtn, this.invertBtn, resetBtn);

    // One-line status hint under the top bar (tilt permission feedback).
    this.hint = document.createElement("div");
    this.hint.style.cssText = [
      "position:absolute",
      "top:max(58px,calc(env(safe-area-inset-top) + 46px))",
      "right:max(12px,env(safe-area-inset-right))",
      `color:${INK_MUTED}`,
      "font-size:11px",
      "letter-spacing:0.04em",
      "pointer-events:none",
      "max-width:60vw",
      "text-align:right",
    ].join(";");
    this.hint.textContent = "";

    this.root.append(steerCluster, driveCluster, topbar, this.hint);
    container.appendChild(this.root);

    this.applyInvertStyle();
    window.addEventListener("orientationchange", this.onOrientationChange);
  }

  /**
   * Reveal the controls while racing. Edge-triggered: Game calls this every
   * frame, so a no-op once already visible (else the per-frame tilt recalibrate
   * would pin steer to 0). No-op on non-touch devices.
   */
  show(): void {
    if (!this.enabled || this.visible) return;
    this.visible = true;
    this.root.style.display = "block";
    // Recalibrate the tilt neutral to the current hold each time play resumes.
    this.tiltCalibrated = false;
    // Non-iOS has no permission gate: honor a persisted tilt preference on show.
    if (this.prefs.tiltEnabled && !this.tiltOn && !this.permissionRequired()) {
      void this.toggleTilt();
    }
  }

  /** Hide the controls and drop every live contribution to Input. Edge-triggered. */
  hide(): void {
    if (!this.visible) {
      this.root.style.display = "none";
      return;
    }
    this.visible = false;
    this.root.style.display = "none";
    this.gasHeld = this.brakeHeld = this.leftHeld = this.rightHeld = false;
    this.input.clearTouch();
  }

  /** Whether this device shows the overlay (touch or forced). */
  get isEnabled(): boolean {
    return this.enabled;
  }

  remove(): void {
    window.removeEventListener("orientationchange", this.onOrientationChange);
    window.removeEventListener("deviceorientation", this.onOrient);
    this.root.remove();
  }

  // --- hold-state -> Input axis pushes -------------------------------------

  private setGas(v: boolean): void {
    this.gasHeld = v;
    this.pushThrottle();
  }

  private setBrake(v: boolean): void {
    this.brakeHeld = v;
    this.pushThrottle();
  }

  private pushThrottle(): void {
    this.input.setTouchThrottle((this.gasHeld ? 1 : 0) - (this.brakeHeld ? 1 : 0));
  }

  private setLeft(v: boolean): void {
    this.leftHeld = v;
    this.pushButtonSteer();
  }

  private setRight(v: boolean): void {
    this.rightHeld = v;
    this.pushButtonSteer();
  }

  private pushButtonSteer(): void {
    if (this.tiltOn) return; // tilt owns steer while active
    // Steering-sign convention: left = +steer, right = -steer.
    this.input.setTouchSteer((this.leftHeld ? 1 : 0) - (this.rightHeld ? 1 : 0));
  }

  private setDrift(v: boolean): void {
    this.input.setTouchDrift(v);
  }

  // --- tilt (accelerometer) steering ---------------------------------------

  private onOrient = (e: DeviceOrientationEvent): void => {
    if (!this.visible || !this.tiltOn) return;
    const angle = this.orientationAngle();
    const axisVal = readTiltAxis({ beta: e.beta, gamma: e.gamma }, angle);
    if (axisVal == null || !Number.isFinite(axisVal)) return;
    if (!this.tiltCalibrated) {
      this.tiltNeutral = axisVal;
      this.tiltCalibrated = true;
    }
    const steer = tiltToSteer(
      { beta: e.beta, gamma: e.gamma },
      { angle, neutral: this.tiltNeutral, invert: this.prefs.invert },
    );
    this.input.setTouchSteer(steer);
  };

  private onOrientationChange = (): void => {
    this.tiltCalibrated = false; // re-baseline against the new screen angle
  };

  private orientationAngle(): number {
    const so = typeof screen !== "undefined" ? screen.orientation : undefined;
    if (so && typeof so.angle === "number") return so.angle;
    const legacy = (window as unknown as { orientation?: number }).orientation;
    return typeof legacy === "number" ? legacy : 0;
  }

  private permissionRequired(): boolean {
    const ctor = (globalThis as { DeviceOrientationEvent?: DeviceOrientationCtor })
      .DeviceOrientationEvent;
    return typeof ctor?.requestPermission === "function";
  }

  private async requestTiltPermission(): Promise<boolean> {
    const ctor = (globalThis as { DeviceOrientationEvent?: DeviceOrientationCtor })
      .DeviceOrientationEvent;
    if (typeof ctor === "undefined") return false;
    if (typeof ctor.requestPermission === "function") {
      try {
        return (await ctor.requestPermission()) === "granted";
      } catch {
        return false;
      }
    }
    return true; // no gated permission (Android / desktop sensors)
  }

  private async toggleTilt(): Promise<void> {
    if (this.tiltOn) {
      this.setTiltOn(false);
      this.savePrefs({ tiltEnabled: false });
      this.setHint("");
      return;
    }
    const granted = await this.requestTiltPermission();
    if (!granted) {
      this.setHint("Tilt permission denied");
      this.savePrefs({ tiltEnabled: false });
      return;
    }
    this.setTiltOn(true);
    this.savePrefs({ tiltEnabled: true });
    this.setHint("Tilt steering on");
  }

  private setTiltOn(on: boolean): void {
    this.tiltOn = on;
    this.tiltCalibrated = false;
    if (on) {
      window.addEventListener("deviceorientation", this.onOrient);
    } else {
      window.removeEventListener("deviceorientation", this.onOrient);
      this.input.setTouchSteer(0);
    }
    // Tilt replaces the on-screen steer buttons; INVERT only matters with tilt.
    this.leftBtn.style.display = on ? "none" : "flex";
    this.rightBtn.style.display = on ? "none" : "flex";
    this.invertBtn.style.display = on ? "flex" : "none";
    this.setActive(this.tiltBtn, on);
  }

  private toggleInvert(): void {
    this.savePrefs({ invert: !this.prefs.invert });
    this.applyInvertStyle();
  }

  private applyInvertStyle(): void {
    this.setActive(this.invertBtn, this.prefs.invert);
  }

  private savePrefs(patch: Partial<MobileControlPrefs>): void {
    this.prefs = { ...this.prefs, ...patch };
    this.persist(this.prefs);
  }

  private setHint(text: string): void {
    this.hint.textContent = text;
  }

  private setActive(btn: HTMLElement, active: boolean): void {
    btn.style.borderColor = active ? MENU_ACCENT : HAIRLINE;
    btn.style.color = active ? MENU_ACCENT : INK;
  }

  // --- button factories -----------------------------------------------------

  private makeHoldButton(
    label: string,
    size: number,
    font: number,
    h: { onDown: () => void; onUp: () => void },
  ): HTMLElement {
    const el = document.createElement("div");
    el.textContent = label;
    el.style.cssText = btnStyle(size, font);
    const down = (e: PointerEvent): void => {
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // jsdom / unsupported: capture is best-effort
      }
      el.style.background = "rgba(255,210,63,0.22)";
      h.onDown();
    };
    const up = (e: PointerEvent): void => {
      e.preventDefault();
      el.style.background = PANEL_INK;
      h.onUp();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return el;
  }

  private makeTapButton(label: string, style: string, onTap: () => void): HTMLElement {
    const el = document.createElement("div");
    el.textContent = label;
    el.style.cssText = style;
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      onTap();
    });
    return el;
  }
}
