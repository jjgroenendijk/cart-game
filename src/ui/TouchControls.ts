/**
 * Mobile driving overlay (DOM). Shown only on touch devices while racing; feeds
 * a `KartInput` for player 0 that Game merges over the keyboard/gamepad sample.
 *
 * Two input surfaces:
 * - On-screen pedals (GAS / BRAKE / DRIFT + a small RESET) driven by pointer
 *   events, so throttle/drift work under multi-touch (each pedal captures its
 *   own pointer id, so gas + drift held together both register).
 * - Tilt-to-steer via the `deviceorientation` sensor. iOS 13+ gates the sensor
 *   behind a user gesture, so steering is armed by an explicit "ENABLE TILT
 *   STEERING" tap that calls `DeviceOrientationEvent.requestPermission()` — the
 *   exact prompt a prior attempt (PR 186) was missing. Until granted, steer = 0.
 *
 * Follows the overlay convention: plain elements + cssText set once, built from
 * menuStyles primitives, `pointer-events:none` root with `pointer-events:auto`
 * interactive children, MENU_CSS injected once, `show()/hide()/remove()`. The
 * pure tilt math lives in src/core/deviceInput.ts (jsdom-testable).
 */

import { zeroInput, type KartInput } from "../core/Input";
import {
  DEFAULT_TILT_CONFIG,
  pickTiltAngle,
  tiltToSteer,
  type TiltConfig,
} from "../core/deviceInput";
import {
  HAIRLINE,
  INK,
  INK_MUTED,
  MENU_CSS,
  PANEL_INK,
  kickerLabel,
  styleMenuButton,
} from "./menuStyles";

/** Minimal shape of the iOS 13+ permission-gated DeviceOrientationEvent ctor. */
interface OrientationPermissionCtor {
  requestPermission?: () => Promise<"granted" | "denied">;
}

const PEDAL_BASE = [
  "position:absolute",
  "display:flex",
  "align-items:center",
  "justify-content:center",
  "box-sizing:border-box",
  `background:${PANEL_INK}`,
  `border:1px solid ${HAIRLINE}`,
  "border-radius:16px",
  `color:${INK}`,
  "font-weight:700",
  "letter-spacing:0.14em",
  "text-transform:uppercase",
  "text-shadow:0 1px 4px rgba(0,0,0,0.6)",
  "user-select:none",
  "-webkit-user-select:none",
  "touch-action:none",
  "-webkit-tap-highlight-color:transparent",
];

// Right thumb: GAS above BRAKE. Left thumb: DRIFT. RESET is a small ghost tab.
const GAS_STYLE = [
  ...PEDAL_BASE,
  "right:24px",
  "bottom:120px",
  "width:104px",
  "height:104px",
  "font-size:15px",
].join(";");
const BRAKE_STYLE = [
  ...PEDAL_BASE,
  "right:24px",
  "bottom:24px",
  "width:104px",
  "height:84px",
  "font-size:13px",
].join(";");
const DRIFT_STYLE = [
  ...PEDAL_BASE,
  "left:24px",
  "bottom:24px",
  "width:120px",
  "height:104px",
  "font-size:15px",
].join(";");
const RESET_STYLE = [
  ...PEDAL_BASE,
  "right:24px",
  "top:78px",
  "width:78px",
  "height:44px",
  "font-size:11px",
  "border-radius:10px",
  "background:transparent",
  `color:${INK_MUTED}`,
].join(";");
const RECENTER_STYLE = [
  ...PEDAL_BASE,
  "left:50%",
  "bottom:24px",
  "transform:translateX(-50%)",
  "width:120px",
  "height:40px",
  "font-size:10px",
  "border-radius:10px",
  "background:transparent",
  `color:${INK_MUTED}`,
].join(";");

const PROMPT_STYLE = [
  "position:absolute",
  "left:50%",
  "top:26%",
  "transform:translate(-50%,-50%)",
  "display:flex",
  "flex-direction:column",
  "align-items:center",
  "gap:12px",
  "padding:20px 24px",
  `background:${PANEL_INK}`,
  `border:1px solid ${HAIRLINE}`,
  "border-radius:14px",
  "max-width:min(420px,86vw)",
  "pointer-events:none",
  "text-align:center",
].join(";");

const PROMPT_HINT_STYLE = [
  "font-size:11px",
  "line-height:1.5",
  "letter-spacing:0.02em",
  `color:${INK_MUTED}`,
  "max-width:280px",
].join(";");

const ROOT_STYLE = [
  "position:absolute",
  "inset:0",
  "z-index:6", // above the HUD (5), below menus/pause (10)
  "pointer-events:none",
  "font-family:system-ui,sans-serif",
].join(";");

const TOUCH_CSS = `
.gc-touch-pedal:active { filter: brightness(1.35); transform: scale(0.97); }
.gc-touch-pedal.gc-touch-drift:active,
.gc-touch-pedal.gc-touch-reset:active,
.gc-touch-pedal.gc-touch-recenter:active { transform: scale(0.97); }
`;

/** One pedal element plus its live pressed flag. */
interface Pedal {
  el: HTMLElement;
  pressed: boolean;
}

export class TouchControls {
  private readonly root: HTMLElement;
  private readonly gas: Pedal;
  private readonly brake: Pedal;
  private readonly drift: Pedal;
  private readonly resetPedal: Pedal;
  private readonly prompt: HTMLElement;
  private readonly promptBtn: HTMLButtonElement;
  private readonly promptHint: HTMLElement;
  private readonly recenterBtn: HTMLButtonElement;

  private config: TiltConfig = { ...DEFAULT_TILT_CONFIG };
  private tiltActive = false;
  private baseline = 0;
  private needBaseline = true;
  private latestAngle = 0;
  private resetLatched = false;

  private readonly onOrient = (e: Event): void => {
    const evt = e as DeviceOrientationEvent;
    const angle = pickTiltAngle(this.readOrientationAngle(), evt.beta ?? 0, evt.gamma ?? 0);
    if (this.needBaseline) {
      this.baseline = angle;
      this.needBaseline = false;
    }
    this.latestAngle = angle;
  };

  constructor(container: HTMLElement) {
    const style = document.createElement("style");
    style.textContent = MENU_CSS + TOUCH_CSS;

    this.gas = this.makePedal("GAS", "gc-touch-gas", GAS_STYLE);
    this.brake = this.makePedal("BRAKE", "gc-touch-brake", BRAKE_STYLE);
    this.drift = this.makePedal("DRIFT", "gc-touch-drift", DRIFT_STYLE);
    this.resetPedal = this.makePedal("RESET", "gc-touch-reset", RESET_STYLE);

    this.prompt = document.createElement("div");
    this.prompt.className = "gc-touch-prompt";
    this.prompt.style.cssText = PROMPT_STYLE;
    const kicker = document.createElement("div");
    kicker.textContent = "TILT TO STEER";
    kicker.style.cssText = kickerLabel();
    this.promptBtn = document.createElement("button");
    this.promptBtn.type = "button";
    this.promptBtn.className = "gc-touch-enable";
    this.promptBtn.textContent = "ENABLE TILT STEERING";
    styleMenuButton(this.promptBtn, "primary", ["font-size:13px", "padding:12px 22px"]);
    this.promptBtn.addEventListener("click", () => {
      void this.armTilt();
    });
    this.promptHint = document.createElement("div");
    this.promptHint.style.cssText = PROMPT_HINT_STYLE;
    this.promptHint.textContent = "Hold the phone level, then tilt left/right to steer.";
    this.prompt.append(kicker, this.promptBtn, this.promptHint);

    this.recenterBtn = document.createElement("button");
    this.recenterBtn.type = "button";
    this.recenterBtn.className = "gc-touch-pedal gc-touch-recenter";
    this.recenterBtn.textContent = "RECENTER";
    this.recenterBtn.style.cssText = RECENTER_STYLE;
    this.recenterBtn.style.display = "none";
    this.recenterBtn.addEventListener("click", () => this.recenter());

    this.root = document.createElement("div");
    this.root.className = "gc-touch-root";
    this.root.style.cssText = ROOT_STYLE;
    this.root.style.display = "none"; // hidden until racing
    this.root.append(
      style,
      this.prompt,
      this.gas.el,
      this.brake.el,
      this.drift.el,
      this.resetPedal.el,
      this.recenterBtn,
    );
    container.appendChild(this.root);
    this.syncPromptVisibility();
  }

  /** Build a pointer-driven pedal that tracks its own pressed state. */
  private makePedal(label: string, className: string, cssText: string): Pedal {
    const el = document.createElement("div");
    el.className = `gc-touch-pedal ${className}`;
    el.textContent = label;
    el.style.cssText = cssText;
    const pedal: Pedal = { el, pressed: false };
    const press = (e: Event): void => {
      const pe = e as PointerEvent;
      e.preventDefault();
      pedal.pressed = true;
      if (className === "gc-touch-reset") this.resetLatched = true;
      const target = el as HTMLElement & {
        setPointerCapture?: (id: number) => void;
      };
      if (target.setPointerCapture && typeof pe.pointerId === "number") {
        try {
          target.setPointerCapture(pe.pointerId);
        } catch {
          // Capture is best-effort; pointerup/leave fallbacks still release it.
        }
      }
    };
    const release = (): void => {
      pedal.pressed = false;
    };
    el.addEventListener("pointerdown", press);
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("pointerleave", release);
    el.addEventListener("lostpointercapture", release);
    return pedal;
  }

  /** Read the current screen orientation angle, guarded for jsdom. */
  private readOrientationAngle(): number {
    if (typeof screen !== "undefined" && screen.orientation) return screen.orientation.angle ?? 0;
    const legacy = (window as unknown as { orientation?: number }).orientation;
    return typeof legacy === "number" ? legacy : 0;
  }

  /** Request sensor permission (iOS) then start listening; the enable gesture. */
  private async armTilt(): Promise<void> {
    if (!this.config.enabled) return;
    const ctor =
      typeof window !== "undefined"
        ? (window as unknown as { DeviceOrientationEvent?: OrientationPermissionCtor })
            .DeviceOrientationEvent
        : undefined;
    if (ctor && typeof ctor.requestPermission === "function") {
      try {
        const res = await ctor.requestPermission();
        if (res !== "granted") {
          this.showDenied();
          return;
        }
      } catch {
        this.showDenied();
        return;
      }
    }
    this.startListening();
  }

  /** Attach the orientation listener + re-arm baseline capture. */
  private startListening(): void {
    if (!this.tiltActive) window.addEventListener("deviceorientation", this.onOrient);
    this.tiltActive = true;
    this.needBaseline = true;
    this.syncPromptVisibility();
  }

  /** Re-capture the neutral hold angle on the next reading. */
  recenter(): void {
    this.needBaseline = true;
  }

  private showDenied(): void {
    this.promptBtn.textContent = "RETRY";
    this.promptHint.textContent =
      "Motion access was denied. Enable it in your browser/site settings, then retry.";
  }

  /** Show the enable prompt only while tilt is enabled but not yet armed. */
  private syncPromptVisibility(): void {
    const showPrompt = this.config.enabled && !this.tiltActive;
    this.prompt.style.display = showPrompt ? "flex" : "none";
    this.recenterBtn.style.display = this.tiltActive ? "flex" : "none";
  }

  /** Apply persisted tilt settings; disabling detaches the sensor + steering. */
  setConfig(cfg: TiltConfig): void {
    this.config = { ...cfg };
    if (!cfg.enabled && this.tiltActive) {
      window.removeEventListener("deviceorientation", this.onOrient);
      this.tiltActive = false;
    }
    this.syncPromptVisibility();
  }

  /** Build the player-0 `KartInput`: pedals drive throttle/drift/reset; tilt steer. */
  sample(): KartInput {
    const out = zeroInput();
    out.throttle = (this.gas.pressed ? 1 : 0) - (this.brake.pressed ? 1 : 0);
    out.drift = this.drift.pressed;
    out.reset = this.resetLatched;
    this.resetLatched = false;
    if (this.config.enabled && this.tiltActive) {
      out.steer = tiltToSteer(this.latestAngle, this.baseline, {
        sensitivity: this.config.sensitivity,
        invert: this.config.invert,
      });
    }
    return out;
  }

  show(): void {
    this.root.style.display = "block";
  }

  hide(): void {
    this.root.style.display = "none";
  }

  /** Detach from the DOM + drop the orientation listener. */
  remove(): void {
    if (this.tiltActive) window.removeEventListener("deviceorientation", this.onOrient);
    this.root.remove();
  }
}
