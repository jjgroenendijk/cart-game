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
  positionalAudio: true,
  hrtf: false,
  effects: {
    sunHalo: true,
    godRays: true,
    lensFlare: false,
    groundMist: true,
    ambientOcclusion: true,
    bloom: true,
  },
  tilt: { enabled: true, sensitivity: 1, invert: false },
  quality: "med",
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

  it("builds header, 4 range sliders, mute/positional/hrtf checkboxes, and back button", () => {
    const { container } = makeOverlay();
    // Editorial header (072): TUNING kicker eyebrow over a serif heading.
    expect(container.querySelector(".gc-settings-kicker")?.textContent).toContain("TUNING");
    expect(container.querySelector("h1")?.textContent).toBe("Settings");
    // 3 volume sliders + the tilt SENSITIVITY slider.
    expect(container.querySelectorAll('input[type="range"]')).toHaveLength(4);
    expect(container.querySelector("input.gc-settings-master")).not.toBeNull();
    expect(container.querySelector("input.gc-settings-music")).not.toBeNull();
    expect(container.querySelector("input.gc-settings-sfx")).not.toBeNull();
    expect(container.querySelector("input.gc-settings-mute")).not.toBeNull();
    expect(container.querySelector("input.gc-settings-positional")).not.toBeNull();
    expect(container.querySelector("input.gc-settings-hrtf")).not.toBeNull();
    expect(container.querySelector("button.gc-settings-back")?.textContent).toBe("BACK");
  });

  it("sliders + checkboxes are pre-filled from the initial state", () => {
    const { container } = makeOverlay();
    const master = container.querySelector("input.gc-settings-master") as HTMLInputElement;
    const music = container.querySelector("input.gc-settings-music") as HTMLInputElement;
    const sfx = container.querySelector("input.gc-settings-sfx") as HTMLInputElement;
    const mute = container.querySelector("input.gc-settings-mute") as HTMLInputElement;
    const positional = container.querySelector("input.gc-settings-positional") as HTMLInputElement;
    const hrtf = container.querySelector("input.gc-settings-hrtf") as HTMLInputElement;
    expect(master.value).toBe("0.8");
    expect(music.value).toBe("0.6");
    expect(sfx.value).toBe("0.4");
    expect(mute.checked).toBe(false);
    expect(positional.checked).toBe(true);
    expect(hrtf.checked).toBe(false);
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

  it("toggling positional/hrtf fires onChange with the boolean", () => {
    const { container, onChange } = makeOverlay();
    const positional = container.querySelector("input.gc-settings-positional") as HTMLInputElement;
    positional.checked = false;
    positional.dispatchEvent(new Event("change"));
    expect((onChange.mock.calls.at(-1)![0] as SettingsState).positionalAudio).toBe(false);
    const hrtf = container.querySelector("input.gc-settings-hrtf") as HTMLInputElement;
    hrtf.checked = true;
    hrtf.dispatchEvent(new Event("change"));
    const last = onChange.mock.calls.at(-1)![0] as SettingsState;
    expect(last.hrtf).toBe(true);
    expect(last.positionalAudio).toBe(false);
  });

  it("show(state) refreshes the sliders + checkboxes from the passed state", () => {
    const { container, overlay } = makeOverlay();
    overlay.show({
      masterVolume: 0.1,
      musicVolume: 0.2,
      sfxVolume: 0.3,
      muted: true,
      positionalAudio: false,
      hrtf: true,
      effects: {
        sunHalo: false,
        godRays: false,
        lensFlare: true,
        groundMist: false,
        ambientOcclusion: false,
        bloom: false,
      },
      tilt: { enabled: false, sensitivity: 2, invert: true },
      quality: "low",
    });
    const master = container.querySelector("input.gc-settings-master") as HTMLInputElement;
    const music = container.querySelector("input.gc-settings-music") as HTMLInputElement;
    const sfx = container.querySelector("input.gc-settings-sfx") as HTMLInputElement;
    const mute = container.querySelector("input.gc-settings-mute") as HTMLInputElement;
    const positional = container.querySelector("input.gc-settings-positional") as HTMLInputElement;
    const hrtf = container.querySelector("input.gc-settings-hrtf") as HTMLInputElement;
    const halo = container.querySelector("input.gc-settings-halo") as HTMLInputElement;
    const rays = container.querySelector("input.gc-settings-godrays") as HTMLInputElement;
    const flare = container.querySelector("input.gc-settings-flare") as HTMLInputElement;
    const mist = container.querySelector("input.gc-settings-groundmist") as HTMLInputElement;
    expect(master.value).toBe("0.1");
    expect(music.value).toBe("0.2");
    expect(sfx.value).toBe("0.3");
    expect(mute.checked).toBe(true);
    expect(positional.checked).toBe(false);
    expect(hrtf.checked).toBe(true);
    expect(halo.checked).toBe(false);
    expect(rays.checked).toBe(false);
    expect(flare.checked).toBe(true);
    expect(mist.checked).toBe(false);
    const tiltOn = container.querySelector("input.gc-settings-tilt") as HTMLInputElement;
    const tiltSens = container.querySelector("input.gc-settings-tilt-sens") as HTMLInputElement;
    const tiltInvert = container.querySelector("input.gc-settings-tilt-invert") as HTMLInputElement;
    expect(tiltOn.checked).toBe(false);
    expect(tiltSens.value).toBe("2");
    expect(tiltInvert.checked).toBe(true);
    // 278: quality refreshes from the passed state (low -> LOW).
    const qualityValue = container.querySelector(".gc-settings-quality-value") as HTMLSpanElement;
    expect(qualityValue.textContent).toBe("LOW");
  });

  it("sections the table with MIX / SPATIAL / GRAPHICS / EFFECTS / MOTION kicker eyebrows", () => {
    const { container } = makeOverlay();
    expect(container.textContent).toContain("MIX");
    expect(container.textContent).toContain("SPATIAL");
    expect(container.textContent).toContain("GRAPHICS");
    expect(container.textContent).toContain("EFFECTS");
    expect(container.textContent).toContain("MOTION");
  });

  it("builds a MOTION section with tilt enable / sensitivity / invert", () => {
    const { container } = makeOverlay();
    const tiltOn = container.querySelector("input.gc-settings-tilt") as HTMLInputElement;
    const tiltSens = container.querySelector("input.gc-settings-tilt-sens") as HTMLInputElement;
    const tiltInvert = container.querySelector("input.gc-settings-tilt-invert") as HTMLInputElement;
    // Sensitivity slider carries the tilt bounds, not the volume 0..1 range.
    expect(tiltSens.min).toBe("0.3");
    expect(tiltSens.max).toBe("2.5");
    // Pre-filled from INITIAL (enabled on, sensitivity 1, not inverted).
    expect(tiltOn.checked).toBe(true);
    expect(tiltSens.value).toBe("1");
    expect(tiltInvert.checked).toBe(false);
  });

  it("toggling tilt / dragging sensitivity fires onChange with the tilt sub-state", () => {
    const { container, onChange } = makeOverlay();
    const tiltOn = container.querySelector("input.gc-settings-tilt") as HTMLInputElement;
    tiltOn.checked = false;
    tiltOn.dispatchEvent(new Event("change"));
    expect((onChange.mock.calls.at(-1)![0] as SettingsState).tilt.enabled).toBe(false);

    const tiltSens = container.querySelector("input.gc-settings-tilt-sens") as HTMLInputElement;
    tiltSens.value = "1.8";
    tiltSens.dispatchEvent(new Event("input"));
    const last = onChange.mock.calls.at(-1)![0] as SettingsState;
    expect(last.tilt.sensitivity).toBeCloseTo(1.8, 5);
    // Readout renders as a multiplier, not a percentage.
    const readout = tiltSens.nextElementSibling as HTMLElement;
    expect(readout.textContent).toBe("1.8x");
  });

  it("checkbox rows are <label>s: clicking the row toggles + fires onChange", () => {
    const { container, onChange } = makeOverlay();
    const mute = container.querySelector("input.gc-settings-mute") as HTMLInputElement;
    const row = mute.closest("label") as HTMLLabelElement;
    expect(row).not.toBeNull();
    row.click();
    expect(mute.checked).toBe(true);
    expect((onChange.mock.calls.at(-1)![0] as SettingsState).muted).toBe(true);
  });

  it("builds an EFFECTS section with halo/godrays/flare/groundmist checkboxes", () => {
    const { container } = makeOverlay();
    expect(container.textContent).toContain("EFFECTS");
    const halo = container.querySelector("input.gc-settings-halo") as HTMLInputElement;
    const rays = container.querySelector("input.gc-settings-godrays") as HTMLInputElement;
    const flare = container.querySelector("input.gc-settings-flare") as HTMLInputElement;
    const mist = container.querySelector("input.gc-settings-groundmist") as HTMLInputElement;
    // Pre-filled from INITIAL (halo/rays/mist on, flare off).
    expect(halo.checked).toBe(true);
    expect(rays.checked).toBe(true);
    expect(flare.checked).toBe(false);
    expect(mist.checked).toBe(true);
  });

  it("toggling an effect fires onChange with the updated effects flags", () => {
    const { container, onChange } = makeOverlay();
    const flare = container.querySelector("input.gc-settings-flare") as HTMLInputElement;
    flare.checked = true;
    flare.dispatchEvent(new Event("change"));
    const last = onChange.mock.calls.at(-1)![0] as SettingsState;
    expect(last.effects).toEqual({
      sunHalo: true,
      godRays: true,
      lensFlare: true,
      groundMist: true,
      ambientOcclusion: true,
      bloom: true,
    });
  });

  it("builds a GRAPHICS section with a BLOOM checkbox (default on)", () => {
    const { container } = makeOverlay();
    const bloom = container.querySelector("input.gc-settings-bloom") as HTMLInputElement;
    expect(bloom).not.toBeNull();
    expect(bloom.checked).toBe(true);
  });

  it("toggling BLOOM fires onChange with effects.bloom updated", () => {
    const { container, onChange } = makeOverlay();
    const bloom = container.querySelector("input.gc-settings-bloom") as HTMLInputElement;
    bloom.checked = false;
    bloom.dispatchEvent(new Event("change"));
    const last = onChange.mock.calls.at(-1)![0] as SettingsState;
    expect(last.effects.bloom).toBe(false);
  });

  // 278: GRAPHICS quality cycle row (low/med/high). Pre-filled from INITIAL
  // (quality "med" -> "MED"); row body + chevrons cycle and emit; arrow keys
  // cycle when focused (MenuNav only owns ArrowUp/Down focus).
  it("builds a GRAPHICS quality row showing the INITIAL tier (MED)", () => {
    const { container } = makeOverlay();
    expect(container.querySelector(".gc-settings-quality")).not.toBeNull();
    expect(container.textContent).toContain("Draw distance applies next race");
    const value = container.querySelector(".gc-settings-quality-value") as HTMLSpanElement;
    expect(value.textContent).toBe("MED");
  });

  it("clicking the quality row body cycles forward (med -> high) + emits quality", () => {
    const { container, onChange } = makeOverlay();
    const row = container.querySelector(".gc-settings-quality") as HTMLDivElement;
    row.click();
    expect(onChange).toHaveBeenCalledTimes(1);
    const last = onChange.mock.calls.at(-1)![0] as SettingsState;
    expect(last.quality).toBe("high");
    const value = container.querySelector(".gc-settings-quality-value") as HTMLSpanElement;
    expect(value.textContent).toBe("HIGH");
  });

  it("the ◀ chevron cycles backward (med -> low) without double-firing", () => {
    const { container, onChange } = makeOverlay();
    const prev = container.querySelector(".gc-settings-quality-prev") as HTMLButtonElement;
    prev.click();
    expect(onChange).toHaveBeenCalledTimes(1);
    const last = onChange.mock.calls.at(-1)![0] as SettingsState;
    expect(last.quality).toBe("low");
    const value = container.querySelector(".gc-settings-quality-value") as HTMLSpanElement;
    expect(value.textContent).toBe("LOW");
  });

  it("ArrowRight on the focused quality row cycles forward", () => {
    const { container, overlay, onChange } = makeOverlay();
    overlay.show();
    const row = container.querySelector(".gc-settings-quality") as HTMLDivElement;
    row.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight", cancelable: true }));
    const last = onChange.mock.calls.at(-1)![0] as SettingsState;
    expect(last.quality).toBe("high");
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

  it("ArrowDown traverses sliders -> audio -> effects -> motion -> BACK -> wraps", () => {
    const { container, overlay } = makeOverlay();
    overlay.show();
    const master = container.querySelector("input.gc-settings-master") as HTMLElement;
    const music = container.querySelector("input.gc-settings-music") as HTMLElement;
    const sfx = container.querySelector("input.gc-settings-sfx") as HTMLElement;
    const mute = container.querySelector("input.gc-settings-mute") as HTMLElement;
    const positional = container.querySelector("input.gc-settings-positional") as HTMLElement;
    const hrtf = container.querySelector("input.gc-settings-hrtf") as HTMLElement;
    const quality = container.querySelector(".gc-settings-quality") as HTMLElement;
    const bloom = container.querySelector("input.gc-settings-bloom") as HTMLElement;
    const halo = container.querySelector("input.gc-settings-halo") as HTMLElement;
    const rays = container.querySelector("input.gc-settings-godrays") as HTMLElement;
    const flare = container.querySelector("input.gc-settings-flare") as HTMLElement;
    const mist = container.querySelector("input.gc-settings-groundmist") as HTMLElement;
    const ao = container.querySelector("input.gc-settings-ao") as HTMLElement;
    const tilt = container.querySelector("input.gc-settings-tilt") as HTMLElement;
    const tiltSens = container.querySelector("input.gc-settings-tilt-sens") as HTMLElement;
    const tiltInvert = container.querySelector("input.gc-settings-tilt-invert") as HTMLElement;
    const back = container.querySelector("button.gc-settings-back") as HTMLElement;

    const order = [
      music,
      sfx,
      mute,
      positional,
      hrtf,
      quality,
      bloom,
      halo,
      rays,
      flare,
      mist,
      ao,
      tilt,
      tiltSens,
      tiltInvert,
      back,
      master,
    ];
    for (const el of order) {
      fireKey("ArrowDown");
      expect(document.activeElement).toBe(el); // last wraps back to master
    }
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
