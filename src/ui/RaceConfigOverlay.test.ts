import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { RaceConfigOverlay } from "./RaceConfigOverlay";
import { type MenuAudio } from "./StartMenu";
import { DEFAULT_TIME_OF_DAY, SPEED_PRESETS, type TimeOfDayConfig } from "../core/timeOfDayConfig";
import {
  DEFAULT_WEATHER_MODE,
  WEATHER_MODE_VALUES,
  type WeatherChoice,
} from "../core/weatherConfig";

function makeAudio(): MenuAudio & { calls: string[] } {
  const calls: string[] = [];
  return { calls, uiBeep: (kind) => calls.push(kind) };
}

function makeOverlay(opts?: {
  initial?: TimeOfDayConfig;
  initialWeather?: WeatherChoice;
  onApply?: (c: TimeOfDayConfig) => void;
  onWeatherApply?: (m: WeatherChoice) => void;
  onConfirm?: (c: TimeOfDayConfig) => void;
  onBack?: () => void;
}): {
  container: HTMLElement;
  overlay: RaceConfigOverlay;
  audio: ReturnType<typeof makeAudio>;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const audio = makeAudio();
  const overlay = new RaceConfigOverlay(container, audio, {
    initial: opts?.initial ?? { ...DEFAULT_TIME_OF_DAY },
    onApply: opts?.onApply ?? vi.fn(),
    onConfirm: opts?.onConfirm ?? vi.fn(),
    onBack: opts?.onBack ?? vi.fn(),
    initialWeather: opts?.initialWeather ?? DEFAULT_WEATHER_MODE,
    onWeatherApply: opts?.onWeatherApply ?? vi.fn(),
  });
  return { container, overlay, audio };
}

function fireKey(code: string): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { code, cancelable: true }));
}

describe("RaceConfigOverlay — DOM build (042)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds header, 4 rows, confirm + back buttons", () => {
    const { container } = makeOverlay();
    // Editorial header (072): RACE SETUP kicker eyebrow over a serif heading.
    expect(container.querySelector(".gc-rc-kicker")?.textContent).toContain("RACE SETUP");
    expect(container.querySelector("h2")?.textContent).toBe("Conditions");
    expect(container.querySelectorAll(".gc-rc-row")).toHaveLength(4);
    expect(container.querySelector(".gc-rc-confirm")?.textContent).toBe("CONFIRM");
    expect(container.querySelector(".gc-rc-back")?.textContent).toBe("BACK");
  });

  it("root pointer-events none; buttons pointer-events auto; z-index 10", () => {
    const { container } = makeOverlay();
    const root = container.querySelector("div") as HTMLElement;
    expect(root.style.pointerEvents).toBe("none");
    expect(root.style.zIndex).toBe("10");
    expect((container.querySelector(".gc-rc-confirm") as HTMLElement).style.pointerEvents).toBe(
      "auto",
    );
    expect((container.querySelector(".gc-rc-back") as HTMLElement).style.pointerEvents).toBe(
      "auto",
    );
  });

  it("rows are focusable (tabindex 0)", () => {
    const { container } = makeOverlay();
    const rows = container.querySelectorAll<HTMLElement>(".gc-rc-row");
    expect(rows[0]!.tabIndex).toBe(0);
    expect(rows[1]!.tabIndex).toBe(0);
    expect(rows[2]!.tabIndex).toBe(0);
    expect(rows[3]!.tabIndex).toBe(0);
  });
});

describe("RaceConfigOverlay — initial config (042)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the initial mode/phase/speed values", () => {
    const { container } = makeOverlay({
      initial: { mode: "static", phase: "dusk", dayLengthSeconds: SPEED_PRESETS.fast },
    });
    expect(container.querySelector(".gc-rc-mode-value")?.textContent).toBe("STATIC");
    expect(container.querySelector(".gc-rc-time-value")?.textContent).toBe("DUSK");
    expect(container.querySelector(".gc-rc-speed-value")?.textContent).toBe("FAST");
  });

  it("falls back speed to NORMAL when dayLengthSeconds is unknown", () => {
    const { container } = makeOverlay({
      initial: { mode: "dynamic", phase: "noon", dayLengthSeconds: 999 },
    });
    expect(container.querySelector(".gc-rc-speed-value")?.textContent).toBe("NORMAL");
  });

  it("dims the SPEED row while MODE is STATIC; un-dims in DYNAMIC", () => {
    const staticO = makeOverlay({
      initial: { mode: "static", phase: "noon", dayLengthSeconds: SPEED_PRESETS.normal },
    });
    const staticSpeed = staticO.container.querySelector<HTMLElement>(".gc-rc-speed");
    expect(staticSpeed!.style.opacity).toBe("0.4");
    const dynO = makeOverlay({
      initial: { mode: "dynamic", phase: "noon", dayLengthSeconds: SPEED_PRESETS.normal },
    });
    const dynSpeed = dynO.container.querySelector<HTMLElement>(".gc-rc-speed");
    expect(dynSpeed!.style.opacity).toBe("1");
  });
});

describe("RaceConfigOverlay — cycling (042)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ArrowRight/Left cycle the focused MODE row and fire onApply with the new config", () => {
    const onApply = vi.fn();
    const { overlay, container } = makeOverlay({ onApply });
    const modeRow = container.querySelector<HTMLElement>(".gc-rc-mode");
    modeRow!.focus();
    fireKey("ArrowRight"); // dynamic -> static
    expect(container.querySelector(".gc-rc-mode-value")?.textContent).toBe("STATIC");
    expect(onApply).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: "static", phase: DEFAULT_TIME_OF_DAY.phase }),
    );
    fireKey("ArrowLeft"); // static -> dynamic (wrap)
    expect(container.querySelector(".gc-rc-mode-value")?.textContent).toBe("DYNAMIC");
    overlay.remove();
  });

  it("ArrowRight wraps TIME row across all six phases", () => {
    const { container } = makeOverlay({
      initial: { mode: "static", phase: "night", dayLengthSeconds: SPEED_PRESETS.normal },
    });
    container.querySelector<HTMLElement>(".gc-rc-time")!.focus();
    fireKey("ArrowRight"); // night -> dawn (wrap)
    expect(container.querySelector(".gc-rc-time-value")?.textContent).toBe("DAWN");
  });

  it("SPEED cycle is a no-op while MODE is STATIC (stays, no onApply)", () => {
    const onApply = vi.fn();
    const { container } = makeOverlay({
      initial: { mode: "static", phase: "noon", dayLengthSeconds: SPEED_PRESETS.normal },
      onApply,
    });
    container.querySelector<HTMLElement>(".gc-rc-speed")!.focus();
    fireKey("ArrowRight");
    expect(container.querySelector(".gc-rc-speed-value")?.textContent).toBe("NORMAL");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("SPEED cycle works + un-dims once MODE is DYNAMIC", () => {
    const onApply = vi.fn();
    const { container } = makeOverlay({
      initial: { mode: "dynamic", phase: "noon", dayLengthSeconds: SPEED_PRESETS.normal },
      onApply,
    });
    const speedRow = container.querySelector<HTMLElement>(".gc-rc-speed")!;
    expect(speedRow.style.opacity).toBe("1");
    speedRow.focus();
    fireKey("ArrowRight"); // normal -> fast
    expect(container.querySelector(".gc-rc-speed-value")?.textContent).toBe("FAST");
    expect(onApply).toHaveBeenLastCalledWith(
      expect.objectContaining({ dayLengthSeconds: SPEED_PRESETS.fast }),
    );
  });

  it("cycle fires a 'beep'", () => {
    const { container, audio } = makeOverlay({
      initial: { mode: "dynamic", phase: "noon", dayLengthSeconds: SPEED_PRESETS.normal },
    });
    container.querySelector<HTMLElement>(".gc-rc-mode")!.focus();
    fireKey("ArrowRight");
    expect(audio.calls).toContain("beep");
  });

  it("ArrowLeft/Right on a focused button is a no-op", () => {
    const onApply = vi.fn();
    const { container } = makeOverlay({ onApply });
    container.querySelector<HTMLElement>(".gc-rc-confirm")!.focus();
    fireKey("ArrowRight");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("chevron taps cycle without focus: prev backward, next forward", () => {
    const onApply = vi.fn();
    const { container } = makeOverlay({ onApply });
    container.querySelector<HTMLElement>(".gc-rc-mode-next")!.click();
    expect(container.querySelector(".gc-rc-mode-value")?.textContent).toBe("STATIC");
    expect(onApply).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "static" }));
    container.querySelector<HTMLElement>(".gc-rc-mode-prev")!.click();
    expect(container.querySelector(".gc-rc-mode-value")?.textContent).toBe("DYNAMIC");
  });

  it("clicking a row body cycles forward once (chevron clicks don't double)", () => {
    const onWeatherApply = vi.fn();
    const { container } = makeOverlay({ onWeatherApply });
    container.querySelector<HTMLElement>(".gc-rc-weather")!.click();
    expect(container.querySelector(".gc-rc-weather-value")?.textContent).toBe("CLEAR");
    expect(onWeatherApply).toHaveBeenCalledTimes(1);
  });

  it("chevrons are mouse-only (tabIndex -1) so rows stay the focus unit", () => {
    const { container } = makeOverlay();
    const prev = container.querySelector<HTMLElement>(".gc-rc-mode-prev")!;
    const next = container.querySelector<HTMLElement>(".gc-rc-mode-next")!;
    expect(prev.tabIndex).toBe(-1);
    expect(next.tabIndex).toBe(-1);
  });
});

describe("RaceConfigOverlay — WEATHER row (054)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the initial weather value", () => {
    const { container } = makeOverlay({ initialWeather: "snow" });
    expect(container.querySelector(".gc-rc-weather-value")?.textContent).toBe("SNOW");
  });

  it("defaults to AUTO when initialWeather is omitted", () => {
    const { container } = makeOverlay();
    expect(container.querySelector(".gc-rc-weather-value")?.textContent).toBe("AUTO");
  });

  it("ArrowRight/Left cycle the focused WEATHER row and fire onWeatherApply", () => {
    const onWeatherApply = vi.fn();
    const { container } = makeOverlay({ onWeatherApply });
    container.querySelector<HTMLElement>(".gc-rc-weather")!.focus();
    // auto -> clear
    fireKey("ArrowRight");
    expect(container.querySelector(".gc-rc-weather-value")?.textContent).toBe("CLEAR");
    expect(onWeatherApply).toHaveBeenLastCalledWith("clear");
    // clear -> rain
    fireKey("ArrowRight");
    expect(container.querySelector(".gc-rc-weather-value")?.textContent).toBe("RAIN");
    expect(onWeatherApply).toHaveBeenLastCalledWith("rain");
    // rain -> snow
    fireKey("ArrowRight");
    expect(container.querySelector(".gc-rc-weather-value")?.textContent).toBe("SNOW");
    // snow -> storm
    fireKey("ArrowRight");
    expect(container.querySelector(".gc-rc-weather-value")?.textContent).toBe("STORM");
    expect(onWeatherApply).toHaveBeenLastCalledWith("storm");
    // storm -> auto (wrap) via ArrowRight
    fireKey("ArrowRight");
    expect(container.querySelector(".gc-rc-weather-value")?.textContent).toBe("AUTO");
    expect(onWeatherApply).toHaveBeenLastCalledWith("auto");
    // auto -> storm (wrap down) via ArrowLeft
    fireKey("ArrowLeft");
    expect(container.querySelector(".gc-rc-weather-value")?.textContent).toBe("STORM");
    expect(onWeatherApply).toHaveBeenLastCalledWith("storm");
  });

  it("WEATHER cycling fires a 'beep'", () => {
    const { container, audio } = makeOverlay();
    audio.calls.length = 0;
    container.querySelector<HTMLElement>(".gc-rc-weather")!.focus();
    fireKey("ArrowRight");
    expect(audio.calls).toContain("beep");
  });

  it("WEATHER cycling cycles through all 5 modes before repeating", () => {
    const { container } = makeOverlay();
    container.querySelector<HTMLElement>(".gc-rc-weather")!.focus();
    const seen: string[] = [];
    for (let i = 0; i < WEATHER_MODE_VALUES.length; i++) {
      seen.push(container.querySelector(".gc-rc-weather-value")!.textContent!);
      fireKey("ArrowRight");
    }
    // 5 distinct labels in order; the 6th press wraps to the first.
    expect(new Set(seen).size).toBe(WEATHER_MODE_VALUES.length);
  });
});

describe("RaceConfigOverlay — confirm/back (042)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Enter fires onConfirm exactly once with the built config", () => {
    const onConfirm = vi.fn();
    makeOverlay({
      initial: { mode: "static", phase: "dusk", dayLengthSeconds: SPEED_PRESETS.slow },
      onConfirm,
    });
    fireKey("Enter");
    fireKey("Enter"); // ignored (finished)
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      mode: "static",
      phase: "dusk",
      dayLengthSeconds: SPEED_PRESETS.slow,
    });
  });

  it("Escape fires onBack exactly once; confirm then ignored", () => {
    const onBack = vi.fn();
    const onConfirm = vi.fn();
    makeOverlay({ onBack, onConfirm });
    fireKey("Escape");
    fireKey("Escape"); // ignored (finished)
    fireKey("Enter"); // ignored
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirm fires a 'click' beep", () => {
    const { audio } = makeOverlay();
    fireKey("Enter");
    expect(audio.calls).toContain("click");
  });
});

describe("RaceConfigOverlay — lifecycle (042)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hide guards keydown (cycling inert); show re-enables", () => {
    const onApply = vi.fn();
    const { container, overlay } = makeOverlay({
      initial: { mode: "dynamic", phase: "noon", dayLengthSeconds: SPEED_PRESETS.normal },
      onApply,
    });
    overlay.hide();
    expect(overlay["root"].style.display).toBe("none");
    container.querySelector<HTMLElement>(".gc-rc-mode")!.focus();
    fireKey("ArrowRight"); // guarded -> no cycle
    expect(onApply).not.toHaveBeenCalled();
    overlay.show();
    container.querySelector<HTMLElement>(".gc-rc-mode")!.focus();
    fireKey("ArrowRight");
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("remove() detaches keydown (cycling no longer fires)", () => {
    const onApply = vi.fn();
    const { overlay } = makeOverlay({ onApply });
    overlay.remove();
    expect(() => fireKey("ArrowRight")).not.toThrow();
    expect(onApply).not.toHaveBeenCalled();
  });
});
