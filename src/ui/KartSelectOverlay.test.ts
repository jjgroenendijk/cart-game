import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { KartSelectOverlay, type KartSelectResult } from "./KartSelectOverlay";
import { type GameMode, type MenuAudio } from "./StartMenu";
import { KART_VARIANTS, type KartVariantId } from "../kart/kartVariants";

function makeAudio(): MenuAudio & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    uiBeep: (kind) => calls.push(kind),
  };
}

function makeOverlay(opts?: {
  mode?: GameMode;
  initialVariants?: KartVariantId[];
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
    initialVariants: opts?.initialVariants,
    onConfirm: opts?.onConfirm ?? vi.fn(),
    onBack: opts?.onBack ?? vi.fn(),
  });
  return { container, overlay, audio };
}

function fireKey(code: string): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { code, cancelable: true }));
}

describe("KartSelectOverlay — DOM build (024)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds prompt, name, swatch, 4 stat bars, confirm + back buttons", () => {
    const { container } = makeOverlay();
    expect(container.querySelector(".gc-kart-prompt")?.textContent).toContain("P1");
    expect(container.querySelector(".gc-kart-name")?.textContent).toBe("Balanced");
    expect(container.querySelector(".gc-kart-swatch")).toBeTruthy();
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

describe("KartSelectOverlay — cycling (024)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ArrowRight advances; ArrowLeft steps back; both wrap around", () => {
    const { container } = makeOverlay();
    const name = () => container.querySelector(".gc-kart-name")?.textContent;
    expect(name()).toBe("Balanced");
    fireKey("ArrowRight");
    expect(name()).toBe("Speedster");
    fireKey("ArrowLeft");
    expect(name()).toBe("Balanced");
    // wrap: balanced(0) <- left -> trailblazer(5)
    fireKey("ArrowLeft");
    expect(name()).toBe("Trailblazer");
    // wrap: trailblazer(5) -> right -> balanced(0)
    fireKey("ArrowRight");
    expect(name()).toBe("Balanced");
  });

  it("cycle fires a 'beep'", () => {
    const { audio } = makeOverlay();
    fireKey("ArrowRight");
    expect(audio.calls).toContain("beep");
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

describe("KartSelectOverlay — 1P confirm (024)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Enter fires onConfirm exactly once with the focused variant", () => {
    const onConfirm = vi.fn();
    makeOverlay({ mode: "1P", onConfirm });
    fireKey("ArrowRight"); // focus Speedster
    fireKey("Enter");
    fireKey("Enter"); // ignored (finished)
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({ mode: "1P", variants: ["speed", "balanced"] });
  });

  it("confirm fires a 'click' beep", () => {
    const onConfirm = vi.fn();
    const { audio } = makeOverlay({ mode: "1P", onConfirm });
    fireKey("Enter");
    expect(audio.calls).toContain("click");
  });
});

describe("KartSelectOverlay — 2P flow (024)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("P1 confirm advances to P2 prompt without firing onConfirm", () => {
    const onConfirm = vi.fn();
    const { container } = makeOverlay({ mode: "2P", onConfirm });
    const prompt = () => container.querySelector(".gc-kart-prompt")?.textContent;
    expect(prompt()).toContain("P1");
    fireKey("Enter");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(prompt()).toContain("P2");
  });

  it("P2 confirm delivers both picks; a second confirm is a no-op", () => {
    const onConfirm = vi.fn();
    makeOverlay({ mode: "2P", onConfirm });
    fireKey("Enter"); // P1 -> P2 (balanced locked for P1)
    fireKey("ArrowRight"); // P2 focuses Speedster
    fireKey("Enter"); // P2 confirm
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({ mode: "2P", variants: ["balanced", "speed"] });
    fireKey("Enter"); // ignored
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("KartSelectOverlay — back navigation (024)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("back from P1 calls onBack", () => {
    const onBack = vi.fn();
    makeOverlay({ mode: "2P", onBack });
    fireKey("Escape");
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("back from P2 returns to the P1 prompt without calling onBack", () => {
    const onBack = vi.fn();
    const { container } = makeOverlay({ mode: "2P", onBack });
    const prompt = () => container.querySelector(".gc-kart-prompt")?.textContent;
    fireKey("Enter"); // P1 -> P2
    expect(prompt()).toContain("P2");
    fireKey("Escape"); // P2 -> P1
    expect(onBack).not.toHaveBeenCalled();
    expect(prompt()).toContain("P1");
  });
});

describe("KartSelectOverlay — lifecycle (024)", () => {
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
    const name = () => container.querySelector(".gc-kart-name")?.textContent;
    fireKey("ArrowRight"); // guarded -> no cycle
    expect(name()).toBe("Balanced");
    overlay.show();
    expect(overlay["root"].style.display).toBe("flex");
    fireKey("ArrowRight");
    expect(name()).toBe("Speedster");
  });

  it("remove() detaches keydown (cycling no longer fires)", () => {
    const { overlay } = makeOverlay();
    overlay.remove();
    expect(() => fireKey("ArrowRight")).not.toThrow();
  });

  it("initialVariants honoured: focused variant is the given pick", () => {
    const { container } = makeOverlay({ initialVariants: ["speed"] });
    expect(container.querySelector(".gc-kart-name")?.textContent).toBe("Speedster");
  });
});
