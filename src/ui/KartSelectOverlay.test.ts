import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { KartSelectOverlay, type KartSelectResult } from "./KartSelectOverlay";
import { type GameMode, type MenuAudio } from "./StartMenu";
import { KART_VARIANTS } from "../kart/kartVariants";
import { KART_COLORWAYS } from "../kart/kartColorways";
import type { KartPick } from "../core/kartSelection";

function makeAudio(): MenuAudio & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    uiBeep: (kind) => calls.push(kind),
  };
}

function makeOverlay(opts?: {
  mode?: GameMode;
  initialPicks?: KartPick[];
  onConfirm?: (r: KartSelectResult) => void;
  onBack?: () => void;
}): {
  container: HTMLElement;
  overlay: KartSelectOverlay;
  audio: ReturnType<typeof makeAudio>;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const audio = makeAudio();
  const overlay = new KartSelectOverlay(container, audio, opts?.mode ?? "1P", {
    initialPicks: opts?.initialPicks,
    onConfirm: opts?.onConfirm ?? vi.fn(),
    onBack: opts?.onBack ?? vi.fn(),
  });
  return { container, overlay, audio };
}

function fireKey(code: string): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { code, cancelable: true }));
}

const prompt = (c: HTMLElement) => c.querySelector(".gc-kart-prompt")?.textContent;
const name = (c: HTMLElement) => c.querySelector(".gc-kart-name")?.textContent;

describe("KartSelectOverlay — DOM build (024)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds kicker, prompt, name, two-tone swatch, 4 stat bars, confirm + back", () => {
    const { container } = makeOverlay();
    // Editorial header (072): CHOOSE KART kicker eyebrow; the kart name is the
    // serif display heading.
    expect(container.querySelector(".gc-kart-kicker")?.textContent).toContain("CHOOSE KART");
    expect(prompt(container)).toContain("P1");
    expect(name(container)).toBe("Balanced");
    expect(container.querySelector(".gc-kart-swatch")).toBeTruthy();
    expect(container.querySelector(".gc-kart-swatch-body")).toBeTruthy();
    expect(container.querySelector(".gc-kart-swatch-accent")).toBeTruthy();
    expect(container.querySelectorAll(".gc-kart-fill")).toHaveLength(4);
    expect(container.querySelector(".gc-kart-confirm")?.textContent).toBe("CONFIRM");
    expect(container.querySelector(".gc-kart-back")?.textContent).toBe("BACK");
  });

  it("root pointer-events none; buttons pointer-events auto; z-index 10", () => {
    const { container } = makeOverlay();
    const root = container.querySelector("div") as HTMLElement;
    expect(root.style.pointerEvents).toBe("none");
    expect(root.style.zIndex).toBe("10");
    expect((container.querySelector(".gc-kart-confirm") as HTMLElement).style.pointerEvents).toBe(
      "auto",
    );
    expect((container.querySelector(".gc-kart-back") as HTMLElement).style.pointerEvents).toBe(
      "auto",
    );
  });
});

describe("KartSelectOverlay — model cycling (024)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ArrowRight advances; ArrowLeft steps back; both wrap around", () => {
    const { container } = makeOverlay();
    expect(name(container)).toBe("Balanced");
    fireKey("ArrowRight");
    expect(name(container)).toBe("Speedster");
    fireKey("ArrowLeft");
    expect(name(container)).toBe("Balanced");
    // wrap: balanced(0) <- left -> trailblazer(5)
    fireKey("ArrowLeft");
    expect(name(container)).toBe("Trailblazer");
    // wrap: trailblazer(5) -> right -> balanced(0)
    fireKey("ArrowRight");
    expect(name(container)).toBe("Balanced");
  });

  it("cycle fires a 'beep'", () => {
    const { audio } = makeOverlay();
    fireKey("ArrowRight");
    expect(audio.calls).toContain("beep");
  });
});

describe("KartSelectOverlay — paint stage (083)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("model confirm advances to the paint prompt with the colorway heading", () => {
    const { container } = makeOverlay();
    fireKey("Enter"); // lock Balanced -> paint stage
    expect(prompt(container)).toBe("P1 choose your paint");
    expect(name(container)).toBe("Ember"); // balanced stock paint
  });

  it("ArrowRight in paint stage cycles colorways and repaints the swatch", () => {
    const { container } = makeOverlay();
    fireKey("Enter");
    fireKey("ArrowRight"); // ember(0) -> glacier(1)
    expect(name(container)).toBe(KART_COLORWAYS[1].name);
    const body = container.querySelector(".gc-kart-swatch-body") as HTMLElement;
    const accent = container.querySelector(".gc-kart-swatch-accent") as HTMLElement;
    expect(body.style.background).toBeTruthy();
    expect(accent.style.background).toBeTruthy();
  });

  it("paint stage keeps the chosen model's stat bars", () => {
    const { container } = makeOverlay();
    fireKey("ArrowRight"); // Speedster
    fireKey("Enter"); // -> paint
    const fills = container.querySelectorAll<HTMLElement>(".gc-kart-fill");
    expect(fills[0].style.width).toBe(`${KART_VARIANTS[1].statBars.speed * 100}%`);
  });

  it("Escape in paint stage returns to the model stage", () => {
    const { container } = makeOverlay();
    fireKey("Enter");
    expect(prompt(container)).toBe("P1 choose your paint");
    fireKey("Escape");
    expect(prompt(container)).toBe("P1 choose your kart");
  });
});

describe("KartSelectOverlay — stat bars (024)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fill width reflects statBars of the focused variant; speedster maxes speed", () => {
    const { container } = makeOverlay();
    const fills = () => container.querySelectorAll<HTMLElement>(".gc-kart-fill");
    const balanced = KART_VARIANTS[0];
    expect(fills()[0].style.width).toBe(`${balanced.statBars.speed * 100}%`);
    // cycle to Speedster (index 1) -> speed bar maxed at 100%
    fireKey("ArrowRight");
    const speedV = KART_VARIANTS[1];
    expect(speedV.statBars.speed).toBe(1);
    expect(fills()[0].style.width).toBe(`${speedV.statBars.speed * 100}%`);
    expect(fills()[0].style.width).toBe("100%");
  });
});

describe("KartSelectOverlay — 1P confirm (024/083)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("model + paint confirm fires onConfirm exactly once with the pick", () => {
    const onConfirm = vi.fn();
    makeOverlay({ mode: "1P", onConfirm });
    fireKey("ArrowRight"); // focus Speedster
    fireKey("Enter"); // lock model -> paint stage
    expect(onConfirm).not.toHaveBeenCalled();
    fireKey("ArrowRight"); // ember -> glacier... paint cursor starts at stock
    fireKey("Enter"); // lock paint -> deliver
    fireKey("Enter"); // ignored (finished)
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const result = onConfirm.mock.calls[0]![0] as KartSelectResult;
    expect(result.mode).toBe("1P");
    expect(result.picks[0]!.variant).toBe("speed");
    expect(result.picks[1]!.variant).toBe("balanced");
  });

  it("confirm fires a 'click' beep", () => {
    const onConfirm = vi.fn();
    const { audio } = makeOverlay({ mode: "1P", onConfirm });
    fireKey("Enter");
    expect(audio.calls).toContain("click");
  });
});

describe("KartSelectOverlay — 2P flow (024/083)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("P1 paint confirm advances to P2 model stage without firing onConfirm", () => {
    const onConfirm = vi.fn();
    const { container } = makeOverlay({ mode: "2P", onConfirm });
    expect(prompt(container)).toContain("P1");
    fireKey("Enter"); // P1 model -> paint
    fireKey("Enter"); // P1 paint -> P2 model
    expect(onConfirm).not.toHaveBeenCalled();
    expect(prompt(container)).toBe("P2 choose your kart");
  });

  it("P2 paint confirm delivers both picks; a second confirm is a no-op", () => {
    const onConfirm = vi.fn();
    makeOverlay({ mode: "2P", onConfirm });
    fireKey("Enter"); // P1 model (balanced)
    fireKey("Enter"); // P1 paint (ember) -> P2
    fireKey("ArrowRight"); // P2 focuses Speedster
    fireKey("Enter"); // P2 model
    fireKey("ArrowRight"); // P2 paint: glacier -> moss (stock glacier first)
    fireKey("Enter"); // P2 paint -> deliver
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const result = onConfirm.mock.calls[0]![0] as KartSelectResult;
    expect(result.mode).toBe("2P");
    expect(result.picks[0]).toEqual({ variant: "balanced", colorway: "ember" });
    expect(result.picks[1]!.variant).toBe("speed");
    fireKey("Enter"); // ignored
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("KartSelectOverlay — back navigation (024/083)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("back from P1 model calls onBack", () => {
    const onBack = vi.fn();
    makeOverlay({ mode: "2P", onBack });
    fireKey("Escape");
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("back from P2 model unwinds to the P1 paint stage without onBack", () => {
    const onBack = vi.fn();
    const { container } = makeOverlay({ mode: "2P", onBack });
    fireKey("Enter"); // P1 model -> paint
    fireKey("Enter"); // P1 paint -> P2 model
    expect(prompt(container)).toBe("P2 choose your kart");
    fireKey("Escape"); // P2 model -> P1 paint
    expect(onBack).not.toHaveBeenCalled();
    expect(prompt(container)).toBe("P1 choose your paint");
  });
});

describe("KartSelectOverlay — lifecycle (024/083)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("show/hide toggle display; a hidden overlay ignores cycling", () => {
    const { container, overlay } = makeOverlay();
    overlay.hide();
    expect(overlay["root"].style.display).toBe("none");
    fireKey("ArrowRight"); // guarded -> no cycle
    expect(name(container)).toBe("Balanced");
    overlay.show();
    expect(overlay["root"].style.display).toBe("flex");
    fireKey("ArrowRight");
    expect(name(container)).toBe("Speedster");
  });

  it("remove() detaches keydown (cycling no longer fires)", () => {
    const { overlay } = makeOverlay();
    overlay.remove();
    expect(() => fireKey("ArrowRight")).not.toThrow();
  });

  it("initialPicks honoured: focused model and paint match the given pick", () => {
    const { container } = makeOverlay({
      initialPicks: [{ variant: "speed", colorway: "pearl" }],
    });
    expect(name(container)).toBe("Speedster");
    fireKey("Enter"); // -> paint stage opens on the persisted colorway
    expect(name(container)).toBe("Pearl");
  });
});
