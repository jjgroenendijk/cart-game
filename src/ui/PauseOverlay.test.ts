import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PauseOverlay, type PauseCallbacks } from "./PauseOverlay";
import type { MenuAudio } from "./StartMenu";

function makeAudio(): MenuAudio & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    uiBeep: (kind) => calls.push(kind),
  };
}

function makeOverlay(cb?: Partial<PauseCallbacks>): {
  container: HTMLElement;
  overlay: PauseOverlay;
  audio: ReturnType<typeof makeAudio>;
  callbacks: Required<PauseCallbacks>;
} {
  const container = document.createElement("div");
  const audio = makeAudio();
  const callbacks: Required<PauseCallbacks> = {
    onResume: cb?.onResume ?? vi.fn(),
    onSettings: cb?.onSettings ?? vi.fn(),
    onQuit: cb?.onQuit ?? vi.fn(),
  };
  const overlay = new PauseOverlay(container, audio, callbacks);
  document.body.appendChild(container);
  return { container, overlay, audio, callbacks };
}

describe("PauseOverlay — DOM overlay (012)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds title + RESUME / SETTINGS / QUIT buttons", () => {
    const { container } = makeOverlay();
    expect(container.querySelector("h1")?.textContent).toBe("PAUSED");
    expect(container.querySelector("button.gc-pause-resume")?.textContent).toBe("RESUME");
    expect(container.querySelector("button.gc-pause-settings")?.textContent).toBe("SETTINGS");
    expect(container.querySelector("button.gc-pause-quit")?.textContent).toBe("QUIT");
  });

  it("root has pointer-events none; buttons have pointer-events auto", () => {
    const { container } = makeOverlay();
    const root = container.querySelector("div") as HTMLElement;
    expect(root.style.pointerEvents).toBe("none");
    expect(
      (container.querySelector("button.gc-pause-resume") as HTMLElement).style.pointerEvents,
    ).toBe("auto");
    expect(
      (container.querySelector("button.gc-pause-quit") as HTMLElement).style.pointerEvents,
    ).toBe("auto");
  });

  it("z-index is 10 (parity with StartMenu/Countdown)", () => {
    const { container } = makeOverlay();
    const root = container.querySelector("div") as HTMLElement;
    expect(root.style.zIndex).toBe("10");
  });

  it("dim backdrop is rgba(0,0,0,0.55) (012 Defaults)", () => {
    const { container } = makeOverlay();
    const root = container.querySelector("div") as HTMLElement;
    // jsdom normalizes the cssText to "rgba(0, 0, 0, 0.55)" (spaces).
    expect(root.style.background).toBe("rgba(0, 0, 0, 0.55)");
  });

  it("is built hidden (display none)", () => {
    const { overlay } = makeOverlay();
    expect(overlay["root"].style.display).toBe("none");
  });

  it("RESUME click fires onResume + a 'click' beep", () => {
    const onResume = vi.fn();
    const { container, audio } = makeOverlay({ onResume });
    (container.querySelector("button.gc-pause-resume") as HTMLButtonElement).click();
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(audio.calls).toContain("click");
  });

  it("SETTINGS click fires onSettings + a 'click' beep", () => {
    const onSettings = vi.fn();
    const { container, audio } = makeOverlay({ onSettings });
    (container.querySelector("button.gc-pause-settings") as HTMLButtonElement).click();
    expect(onSettings).toHaveBeenCalledTimes(1);
    expect(audio.calls).toContain("click");
  });

  it("QUIT click fires onQuit + a 'click' beep", () => {
    const onQuit = vi.fn();
    const { container, audio } = makeOverlay({ onQuit });
    (container.querySelector("button.gc-pause-quit") as HTMLButtonElement).click();
    expect(onQuit).toHaveBeenCalledTimes(1);
    expect(audio.calls).toContain("click");
  });

  it("hover over a button fires a 'hover' beep", () => {
    const { container, audio } = makeOverlay();
    container.querySelector("button.gc-pause-resume")!.dispatchEvent(new Event("mouseenter"));
    expect(audio.calls).toContain("hover");
  });

  it("show/hide toggle root display", () => {
    const { overlay } = makeOverlay();
    overlay.show();
    expect(overlay["root"].style.display).toBe("flex");
    overlay.hide();
    expect(overlay["root"].style.display).toBe("none");
  });

  it("remove() detaches the overlay from the DOM", () => {
    const { container, overlay } = makeOverlay();
    expect(container.querySelector("h1")).not.toBeNull();
    overlay.remove();
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("button.gc-pause-resume")).toBeNull();
  });
});

describe("PauseOverlay — menu navigation (012)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function fireKey(code: string): void {
    window.dispatchEvent(new KeyboardEvent("keydown", { code, cancelable: true }));
  }

  it("is built without nav active (hidden)", () => {
    const { overlay } = makeOverlay();
    // Nav starts on show(); before show, arrow keys do nothing.
    const before = document.activeElement;
    fireKey("ArrowDown");
    expect(document.activeElement).toBe(before);
    expect(overlay["nav"]).toBeNull();
  });

  it("show() focuses RESUME (first control)", () => {
    const { container, overlay } = makeOverlay();
    overlay.show();
    const resume = container.querySelector("button.gc-pause-resume") as HTMLButtonElement;
    expect(document.activeElement).toBe(resume);
  });

  it("ArrowDown traverses RESUME -> SETTINGS -> QUIT -> wrap", () => {
    const { container, overlay } = makeOverlay();
    overlay.show();
    const resume = container.querySelector("button.gc-pause-resume") as HTMLButtonElement;
    const settings = container.querySelector("button.gc-pause-settings") as HTMLButtonElement;
    const quit = container.querySelector("button.gc-pause-quit") as HTMLButtonElement;

    fireKey("ArrowDown");
    expect(document.activeElement).toBe(settings);
    fireKey("ArrowDown");
    expect(document.activeElement).toBe(quit);
    fireKey("ArrowDown");
    expect(document.activeElement).toBe(resume); // wraps
  });

  it("hide() stops nav: ArrowDown afterwards does not throw", () => {
    const { overlay } = makeOverlay();
    overlay.show();
    overlay.hide();
    expect(() => fireKey("ArrowDown")).not.toThrow();
    expect(overlay["nav"]).toBeNull();
  });
});
