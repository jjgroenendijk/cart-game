import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from "vitest";
import { SettingsOverlay, type SettingsCallbacks } from "./SettingsOverlay";
import type { MenuAudio } from "./StartMenu";
import type { SettingsState } from "../core/settings";

function makeAudio(): MenuAudio & { calls: string[] } {
  const calls: string[] = [];
  return { calls, uiBeep: (kind) => calls.push(kind) };
}

const INITIAL: SettingsState = {
  masterVolume: 0.8,
  musicVolume: 0.6,
  sfxVolume: 0.4,
  muted: false,
};

function makeOverlay(): {
  container: HTMLElement;
  overlay: SettingsOverlay;
  audio: ReturnType<typeof makeAudio>;
  onChange: Mock;
  onBack: Mock;
} {
  const container = document.createElement("div");
  const audio = makeAudio();
  const onChange = vi.fn();
  const onBack = vi.fn();
  const cb: SettingsCallbacks = { onChange, onBack };
  const overlay = new SettingsOverlay(container, audio, INITIAL, cb);
  document.body.appendChild(container);
  return { container, overlay, audio, onChange, onBack };
}

describe("SettingsOverlay — DOM overlay (012)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds title, 3 range sliders, mute checkbox, and back button", () => {
    const { container } = makeOverlay();
    expect(container.querySelector("h1")?.textContent).toBe("SETTINGS");
    expect(container.querySelectorAll('input[type="range"]')).toHaveLength(3);
    expect(container.querySelector("input.gc-settings-master")).not.toBeNull();
    expect(container.querySelector("input.gc-settings-music")).not.toBeNull();
    expect(container.querySelector("input.gc-settings-sfx")).not.toBeNull();
    expect(container.querySelector("input.gc-settings-mute")).not.toBeNull();
    expect(container.querySelector("button.gc-settings-back")?.textContent).toBe("BACK");
  });

  it("sliders + mute are pre-filled from the initial state", () => {
    const { container } = makeOverlay();
    const master = container.querySelector("input.gc-settings-master") as HTMLInputElement;
    const music = container.querySelector("input.gc-settings-music") as HTMLInputElement;
    const sfx = container.querySelector("input.gc-settings-sfx") as HTMLInputElement;
    const mute = container.querySelector("input.gc-settings-mute") as HTMLInputElement;
    expect(master.value).toBe("0.8");
    expect(music.value).toBe("0.6");
    expect(sfx.value).toBe("0.4");
    expect(mute.checked).toBe(false);
  });

  it("z-index is 10 + root pointer-events none; controls pointer-events auto", () => {
    const { container } = makeOverlay();
    const root = container.querySelector("div") as HTMLElement;
    expect(root.style.zIndex).toBe("10");
    expect(root.style.pointerEvents).toBe("none");
    expect(
      (container.querySelector("input.gc-settings-master") as HTMLElement).style.pointerEvents,
    ).toBe("auto");
    expect(
      (container.querySelector("button.gc-settings-back") as HTMLElement).style.pointerEvents,
    ).toBe("auto");
  });

  it("an input change on a slider fires onChange with the parsed value + readout", () => {
    const { container, onChange } = makeOverlay();
    const master = container.querySelector("input.gc-settings-master") as HTMLInputElement;
    master.value = "0.3";
    master.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const state = onChange.mock.calls.at(-1)![0] as SettingsState;
    expect(state.masterVolume).toBeCloseTo(0.3);
    // Other fields are carried through unchanged from the DOM.
    expect(state.musicVolume).toBeCloseTo(0.6);
    expect(state.muted).toBe(false);
    const readout = master.nextElementSibling as HTMLElement;
    expect(readout.textContent).toBe("30%");
  });

  it("an input change fires a beep", () => {
    const { container, audio } = makeOverlay();
    const music = container.querySelector("input.gc-settings-music") as HTMLInputElement;
    music.value = "0.5";
    music.dispatchEvent(new Event("input", { bubbles: true }));
    expect(audio.calls).toContain("click");
  });

  it("toggling mute fires onChange with muted true/false", () => {
    const { container, onChange } = makeOverlay();
    const mute = container.querySelector("input.gc-settings-mute") as HTMLInputElement;
    mute.checked = true;
    mute.dispatchEvent(new Event("change"));
    expect((onChange.mock.calls.at(-1)![0] as SettingsState).muted).toBe(true);
    mute.checked = false;
    mute.dispatchEvent(new Event("change"));
    expect((onChange.mock.calls.at(-1)![0] as SettingsState).muted).toBe(false);
  });

  it("BACK click fires onBack + a click beep", () => {
    const { container, onBack, audio } = makeOverlay();
    (container.querySelector("button.gc-settings-back") as HTMLButtonElement).click();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(audio.calls).toContain("click");
  });

  it("BACK hover fires a hover beep", () => {
    const { container, audio } = makeOverlay();
    container.querySelector("button.gc-settings-back")!.dispatchEvent(new Event("mouseenter"));
    expect(audio.calls).toContain("hover");
  });

  it("show(state) refreshes the sliders + mute from the passed state", () => {
    const { container, overlay } = makeOverlay();
    overlay.show({ masterVolume: 0.1, musicVolume: 0.2, sfxVolume: 0.3, muted: true });
    const master = container.querySelector("input.gc-settings-master") as HTMLInputElement;
    const music = container.querySelector("input.gc-settings-music") as HTMLInputElement;
    const sfx = container.querySelector("input.gc-settings-sfx") as HTMLInputElement;
    const mute = container.querySelector("input.gc-settings-mute") as HTMLInputElement;
    expect(master.value).toBe("0.1");
    expect(music.value).toBe("0.2");
    expect(sfx.value).toBe("0.3");
    expect(mute.checked).toBe(true);
  });

  it("hide toggles display none; isVisible tracks display", () => {
    const { overlay } = makeOverlay();
    expect(overlay.isVisible).toBe(false); // built hidden
    overlay.show();
    expect(overlay.isVisible).toBe(true);
    overlay.hide();
    expect(overlay.isVisible).toBe(false);
  });

  it("remove() detaches the overlay from the DOM", () => {
    const { container, overlay } = makeOverlay();
    expect(container.querySelector("h1")).not.toBeNull();
    overlay.remove();
    expect(container.querySelector("h1")).toBeNull();
  });
});

function makeRafStub(): { fire: () => void } {
  let cb: FrameRequestCallback | null = null;
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    cb = fn;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    cb = null;
  });
  return { fire: () => cb?.(0) };
}

function makeGamepad(axes: [number, number]): Gamepad {
  return {
    axes,
    buttons: [
      { pressed: false, value: 0 },
      { pressed: false, value: 0 },
    ],
    id: "",
    index: 0,
    connected: true,
    timestamp: 0,
    mapping: "standard",
    hapticActuators: [],
  } as unknown as Gamepad;
}

function stubGamepads(gp: Gamepad): void {
  Object.defineProperty(navigator, "getGamepads", {
    value: () => [gp],
    configurable: true,
  });
}

describe("SettingsOverlay — menu navigation (012)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    try {
      delete (navigator as unknown as { getGamepads?: unknown }).getGamepads;
    } catch {
      // ignore
    }
    vi.restoreAllMocks();
  });

  function fireKey(code: string): void {
    window.dispatchEvent(new KeyboardEvent("keydown", { code, cancelable: true }));
  }

  it("show() focuses the MASTER slider (first control)", () => {
    const { container, overlay } = makeOverlay();
    overlay.show();
    const master = container.querySelector("input.gc-settings-master") as HTMLInputElement;
    expect(document.activeElement).toBe(master);
  });

  it("ArrowDown traverses MASTER -> MUSIC -> SFX -> MUTE -> BACK", () => {
    const { container, overlay } = makeOverlay();
    overlay.show();
    const master = container.querySelector("input.gc-settings-master") as HTMLElement;
    const music = container.querySelector("input.gc-settings-music") as HTMLElement;
    const sfx = container.querySelector("input.gc-settings-sfx") as HTMLElement;
    const mute = container.querySelector("input.gc-settings-mute") as HTMLElement;
    const back = container.querySelector("button.gc-settings-back") as HTMLElement;

    fireKey("ArrowDown");
    expect(document.activeElement).toBe(music);
    fireKey("ArrowDown");
    expect(document.activeElement).toBe(sfx);
    fireKey("ArrowDown");
    expect(document.activeElement).toBe(mute);
    fireKey("ArrowDown");
    expect(document.activeElement).toBe(back);
    fireKey("ArrowDown");
    expect(document.activeElement).toBe(master); // wraps
  });

  it("hide() stops nav: ArrowDown afterwards does not throw", () => {
    const { overlay } = makeOverlay();
    overlay.show();
    overlay.hide();
    expect(() => fireKey("ArrowDown")).not.toThrow();
    expect(overlay["nav"]).toBeNull();
  });

  // onHorizontal (gamepad left/right) is driven by a captured rAF callback +
  // a stubbed navigator.getGamepads, asserting the overlay's real closure
  // steps the focused slider + fires onChange. Crossing fires on the first
  // poll (prev=null), so performance.now() need not be controlled.
  it("gamepad right steps the focused slider by 0.1 + fires onChange", () => {
    const { fire } = makeRafStub();
    stubGamepads(makeGamepad([0.9, 0]));

    const { overlay, onChange } = makeOverlay();
    overlay.show(); // focuses MASTER (0.8)

    fire(); // one poll: crossing right -> stepSlider(master, +1)

    expect(onChange).toHaveBeenCalled();
    const st = onChange.mock.calls.at(-1)![0] as SettingsState;
    expect(st.masterVolume).toBeCloseTo(0.9, 5);
  });

  it("gamepad left on SFX steps it down by 0.1 (clamped at 0)", () => {
    const { fire } = makeRafStub();
    stubGamepads(makeGamepad([-0.9, 0]));

    const { overlay, onChange } = makeOverlay();
    overlay.show();
    // Move focus to SFX (index 2): two ArrowDowns.
    fireKey("ArrowDown"); // -> music
    fireKey("ArrowDown"); // -> sfx
    expect(document.activeElement).toBe(overlay["sfx"] as unknown as HTMLElement);

    fire(); // crossing left -> stepSlider(sfx, -1); sfx was 0.4 -> 0.3

    const st = onChange.mock.calls.at(-1)![0] as SettingsState;
    expect(st.sfxVolume).toBeCloseTo(0.3, 5);
  });
});
