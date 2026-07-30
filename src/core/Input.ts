import type RAPIER from "@dimforge/rapier3d-compat";

export interface KartInput {
  throttle: number;
  steer: number;
  drift: boolean;
  reset: boolean;
}

const ZERO_INPUT: KartInput = { throttle: 0, steer: 0, drift: false, reset: false };

type Bind = {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  drift: string[];
  reset: string[];
};

export const PLAYER_BINDINGS: Bind[] = [
  {
    up: ["KeyW", "ArrowUp"],
    down: ["KeyS", "ArrowDown"],
    left: ["KeyA", "ArrowLeft"],
    right: ["KeyD", "ArrowRight"],
    drift: ["Space", "ShiftLeft"],
    reset: ["KeyR"],
  },
];

const AXIS_DEADZONE = 0.18;

export class Input {
  private readonly keys = new Set<string>();
  private readonly pressedThisFrame = new Set<string>();
  private gamepads: (Gamepad | null)[] = [];

  constructor(target: EventTarget = window) {
    target.addEventListener("keydown", (e) => {
      const code = (e as KeyboardEvent).code;
      if (!this.keys.has(code)) this.pressedThisFrame.add(code);
      this.keys.add(code);
      if (code === "Space" || code.startsWith("Arrow")) (e as KeyboardEvent).preventDefault();
    });
    target.addEventListener("keyup", (e) => {
      this.keys.delete((e as KeyboardEvent).code);
    });
    target.addEventListener("blur", () => this.keys.clear());
    target.addEventListener("visibilitychange", () => {
      if (document.hidden) this.keys.clear();
    });
  }

  beginFrame(): void {
    this.gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
  }

  endFrame(): void {
    this.pressedThisFrame.clear();
  }

  private axisFromKeys(keys: string[], neg: string[], pos: string[]): number {
    let v = 0;
    for (const k of pos) if (keys.includes(k) || this.keys.has(k)) v += 1;
    for (const k of neg) if (keys.includes(k) || this.keys.has(k)) v -= 1;
    return clamp(v);
  }

  private anyKey(keys: string[]): boolean {
    return keys.some((k) => this.keys.has(k));
  }

  sample(player: number, gamepadIndex: number = player): KartInput {
    const bind = PLAYER_BINDINGS[player] ?? PLAYER_BINDINGS[0];
    const gp = this.gamepads[gamepadIndex];

    let throttle = 0;
    let steer = 0;
    let drift = false;
    let reset = false;

    if (bind) {
      throttle += this.axisFromKeys([], bind.down, bind.up);
      // Engine convention (KartController + AiDriver): positive steer = turn
      // left. So pressing left yields +1 and right yields -1.
      steer += this.axisFromKeys([], bind.right, bind.left);
      drift ||= this.anyKey(bind.drift);
      reset ||= bind.reset.some((k) => this.pressedThisFrame.has(k));
    }

    if (gp) {
      const ax0 = gp.axes[0] ?? 0;
      const ax1 = gp.axes[1] ?? 0;
      // Stick right (ax0 > 0) must steer right, i.e. negative per the convention.
      steer -= deadzone(ax0);
      throttle -= deadzone(ax1);

      const buttons = gp.buttons;
      if (buttons[0]?.pressed) drift = true; // A / cross
      if (buttons[7]?.value > 0.1) throttle += buttons[7].value; // RT
      if (buttons[6]?.value > 0.1) throttle -= buttons[6].value; // LT brake
      if (buttons[1]?.pressed) reset = true; // B / circle to reset
    }

    return {
      throttle: clamp(throttle),
      steer: clamp(steer),
      drift,
      reset,
    };
  }
}

function deadzone(v: number): number {
  if (Math.abs(v) < AXIS_DEADZONE) return 0;
  return (v - Math.sign(v) * AXIS_DEADZONE) / (1 - AXIS_DEADZONE);
}

function clamp(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

export function zeroInput(): KartInput {
  return { ...ZERO_INPUT };
}

/**
 * Merge an overlay `KartInput` (e.g. the mobile touch/tilt source) over a base
 * (keyboard/gamepad) sample: the overlay's nonzero throttle/steer axes win, and
 * the drift/reset booleans OR together. Lets touch drive P1 on a phone while a
 * paired keyboard/gamepad still works, without either source zeroing the other.
 */
export function mergeKartInput(base: KartInput, overlay: KartInput): KartInput {
  return {
    throttle: overlay.throttle !== 0 ? overlay.throttle : base.throttle,
    steer: overlay.steer !== 0 ? overlay.steer : base.steer,
    drift: base.drift || overlay.drift,
    reset: base.reset || overlay.reset,
  };
}

export type { RAPIER };
