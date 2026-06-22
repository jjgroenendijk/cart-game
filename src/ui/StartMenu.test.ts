import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { StartMenu, type MenuAudio } from "./StartMenu";

function makeAudio(): MenuAudio & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    uiBeep: (kind) => calls.push(kind),
  };
}

function makeMenu(onStart?: () => void): {
  container: HTMLElement;
  menu: StartMenu;
  audio: ReturnType<typeof makeAudio>;
} {
  const container = document.createElement("div");
  const audio = makeAudio();
  const menu = new StartMenu(container, audio, onStart ?? vi.fn());
  document.body.appendChild(container);
  return { container, menu, audio };
}

function fireKey(code: string): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { code }));
}

describe("StartMenu — DOM overlay (006)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds title, start button, and controls list", () => {
    const { container } = makeMenu();
    expect(container.querySelector("h1")?.textContent).toBe("GAME CART");
    const btn = container.querySelector("button");
    expect(btn?.textContent).toBe("START");
    const controls = container.querySelector("p");
    expect(controls?.innerHTML).toContain("WASD");
    expect(controls?.innerHTML).toContain("Gamepad");
  });

  it("root has pointer-events none; button has pointer-events auto", () => {
    const { container } = makeMenu();
    const root = container.querySelector("div") as HTMLElement;
    expect(root.style.pointerEvents).toBe("none");
    const btn = container.querySelector("button") as HTMLElement;
    expect(btn.style.pointerEvents).toBe("auto");
  });

  it("z-index is 10 (parity with #loading)", () => {
    const { container } = makeMenu();
    const root = container.querySelector("div") as HTMLElement;
    expect(root.style.zIndex).toBe("10");
  });

  it("button click fires onStart exactly once", () => {
    const onStart = vi.fn();
    const { menu } = makeMenu(onStart);
    menu["button"].click();
    menu["button"].click();
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("Enter key fires onStart", () => {
    const onStart = vi.fn();
    makeMenu(onStart);
    fireKey("Enter");
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("Space key fires onStart", () => {
    const onStart = vi.fn();
    makeMenu(onStart);
    fireKey("Space");
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("second confirm is a no-op (started guard)", () => {
    const onStart = vi.fn();
    const { menu } = makeMenu(onStart);
    menu["button"].click(); // first wins
    fireKey("Enter"); // ignored
    fireKey("Space"); // ignored
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(menu.isStarted).toBe(true);
  });

  it("button click fires a 'click' beep", () => {
    const { menu, audio } = makeMenu();
    menu["button"].click();
    expect(audio.calls).toContain("click");
  });

  it("hover over the button fires a 'hover' beep", () => {
    const { menu, audio } = makeMenu();
    menu["button"].dispatchEvent(new Event("mouseenter"));
    expect(audio.calls).toContain("hover");
  });

  it("remove() detaches the DOM + stops keydown from firing onStart", () => {
    const onStart = vi.fn();
    const { menu, container } = makeMenu(onStart);
    menu.remove();
    expect(container.querySelector("h1")).toBeNull();
    fireKey("Enter");
    expect(onStart).not.toHaveBeenCalled();
  });

  it("show/hide toggle root display", () => {
    const { menu } = makeMenu();
    menu.hide();
    expect(menu["root"].style.display).toBe("none");
    menu.show();
    expect(menu["root"].style.display).toBe("flex");
  });
});
