import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { StartMenu, type GameMode, type MenuAudio } from "./StartMenu";
import { BIOMES, type BiomeId } from "../terrain/biomes";

function makeAudio(): MenuAudio & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    uiBeep: (kind) => calls.push(kind),
  };
}

function makeMenu(onStart?: (mode: GameMode, biome: BiomeId) => void): {
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

  it("builds title, start button, mode toggle, and controls list", () => {
    const { container } = makeMenu();
    expect(container.querySelector("h1")?.textContent).toBe("GAME CART");
    expect(container.querySelector("button.gc-start")?.textContent).toBe("START");
    expect(container.querySelector("button.gc-mode")?.textContent).toBe("1 PLAYER");
    const controls = container.querySelector("p");
    expect(controls?.innerHTML).toContain("WASD");
    expect(controls?.innerHTML).toContain("Gamepad");
  });

  it("root has pointer-events none; buttons have pointer-events auto", () => {
    const { container } = makeMenu();
    const root = container.querySelector("div") as HTMLElement;
    expect(root.style.pointerEvents).toBe("none");
    expect((container.querySelector("button.gc-start") as HTMLElement).style.pointerEvents).toBe(
      "auto",
    );
    expect((container.querySelector("button.gc-mode") as HTMLElement).style.pointerEvents).toBe(
      "auto",
    );
  });

  it("z-index is 10 (parity with #loading)", () => {
    const { container } = makeMenu();
    const root = container.querySelector("div") as HTMLElement;
    expect(root.style.zIndex).toBe("10");
  });

  it("START click fires onStart exactly once", () => {
    const onStart = vi.fn();
    const { container } = makeMenu(onStart);
    (container.querySelector("button.gc-start") as HTMLButtonElement).click();
    (container.querySelector("button.gc-start") as HTMLButtonElement).click();
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
    const { container, menu } = makeMenu(onStart);
    (container.querySelector("button.gc-start") as HTMLButtonElement).click(); // first wins
    fireKey("Enter"); // ignored
    fireKey("Space"); // ignored
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(menu.isStarted).toBe(true);
  });

  it("show() re-arms START after a Back from kart-select (mouse + keyboard)", () => {
    const onStart = vi.fn();
    const { container, menu } = makeMenu(onStart);
    // First showing: confirm() wins and drops the keydown listener.
    (container.querySelector("button.gc-start") as HTMLButtonElement).click();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(menu.isStarted).toBe(true);
    // Game hides on confirm; a kart-select Back re-shows the same instance.
    menu.hide();
    menu.show();
    expect(menu.isStarted).toBe(false);
    // Mouse path fires again.
    (container.querySelector("button.gc-start") as HTMLButtonElement).click();
    expect(onStart).toHaveBeenCalledTimes(2);
    // Re-arm once more and confirm the Enter keydown listener was re-attached.
    menu.show();
    fireKey("Enter");
    expect(onStart).toHaveBeenCalledTimes(3);
  });

  it("START click fires a 'click' beep", () => {
    const { container, audio } = makeMenu();
    (container.querySelector("button.gc-start") as HTMLButtonElement).click();
    expect(audio.calls).toContain("click");
  });

  it("hover over a button fires a 'hover' beep", () => {
    const { container, audio } = makeMenu();
    container.querySelector("button.gc-start")!.dispatchEvent(new Event("mouseenter"));
    expect(audio.calls).toContain("hover");
  });

  it("remove() detaches the DOM + stops keydown from firing onStart", () => {
    const onStart = vi.fn();
    const { container, menu } = makeMenu(onStart);
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

describe("StartMenu — 1P/2P mode toggle (008)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to 1P", () => {
    const { menu, container } = makeMenu();
    expect(menu.selectedMode).toBe("1P");
    expect(container.querySelector("button.gc-mode")?.textContent).toBe("1 PLAYER");
  });

  it("toggle button cycles 1P -> 2P -> 1P", () => {
    const { container, menu } = makeMenu();
    const modeBtn = container.querySelector("button.gc-mode") as HTMLButtonElement;
    modeBtn.click();
    expect(menu.selectedMode).toBe("2P");
    expect(modeBtn.textContent).toBe("2 PLAYERS");
    modeBtn.click();
    expect(menu.selectedMode).toBe("1P");
    expect(modeBtn.textContent).toBe("1 PLAYER");
  });

  it("toggle fires a 'click' beep each press", () => {
    const { container, audio } = makeMenu();
    const modeBtn = container.querySelector("button.gc-mode") as HTMLButtonElement;
    modeBtn.click();
    modeBtn.click();
    const clickCount = audio.calls.filter((c) => c === "click").length;
    expect(clickCount).toBe(2);
  });

  it("controls list shows the P2 arrows row only in 2P", () => {
    const { container, menu } = makeMenu();
    const controls = () => container.querySelector("p") as HTMLElement;
    expect(controls().innerHTML).not.toContain("P2: Arrows");
    (container.querySelector("button.gc-mode") as HTMLButtonElement).click(); // -> 2P
    expect(menu.selectedMode).toBe("2P");
    expect(controls().innerHTML).toContain("P2: Arrows");
    expect(controls().innerHTML).toContain("WASD");
  });

  it("onStart carries the selected mode", () => {
    const onStart = vi.fn();
    const { container } = makeMenu(onStart);
    (container.querySelector("button.gc-mode") as HTMLButtonElement).click(); // -> 2P
    (container.querySelector("button.gc-start") as HTMLButtonElement).click();
    expect(onStart).toHaveBeenCalledWith("2P", "temperate");
  });

  it("START carries 1P when the toggle is never touched", () => {
    const onStart = vi.fn();
    const { container } = makeMenu(onStart);
    (container.querySelector("button.gc-start") as HTMLButtonElement).click();
    expect(onStart).toHaveBeenCalledWith("1P", "temperate");
  });

  it("mode toggle is locked once started", () => {
    const { container, menu } = makeMenu();
    (container.querySelector("button.gc-start") as HTMLButtonElement).click();
    (container.querySelector("button.gc-mode") as HTMLButtonElement).click(); // ignored
    expect(menu.selectedMode).toBe("1P");
  });
});

describe("StartMenu — menu navigation (012)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function fireKey(code: string): void {
    window.dispatchEvent(new KeyboardEvent("keydown", { code, cancelable: true }));
  }

  // Mirror real usage: connect the container BEFORE constructing so the
  // constructor's startNav focus() runs on a connected element (jsdom ignores
  // focus on disconnected subtrees for document.activeElement).
  function makeConnectedMenu(onStart?: (mode: GameMode, biome: BiomeId) => void): {
    container: HTMLElement;
    menu: StartMenu;
  } {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const menu = new StartMenu(container, makeAudio(), onStart ?? vi.fn());
    return { container, menu };
  }

  it("start() focuses the first control (mode toggle)", () => {
    const { container } = makeConnectedMenu();
    const modeBtn = container.querySelector("button.gc-mode") as HTMLButtonElement;
    expect(document.activeElement).toBe(modeBtn);
  });

  it("ArrowDown moves focus to the next control (START)", () => {
    const { container } = makeConnectedMenu();
    const startBtn = container.querySelector("button.gc-start") as HTMLButtonElement;
    fireKey("ArrowDown");
    expect(document.activeElement).toBe(startBtn);
  });

  it("ArrowDown again moves focus to SETTINGS", () => {
    const { container } = makeConnectedMenu();
    const settingsBtn = container.querySelector("button.gc-settings") as HTMLButtonElement;
    fireKey("ArrowDown");
    fireKey("ArrowDown");
    expect(document.activeElement).toBe(settingsBtn);
  });

  it("hide() stops nav: ArrowDown afterwards does not throw", () => {
    const { menu } = makeConnectedMenu();
    menu.hide();
    expect(() => fireKey("ArrowDown")).not.toThrow();
  });

  it("remove() stops nav: ArrowDown afterwards does not throw", () => {
    const { menu } = makeConnectedMenu();
    menu.remove();
    expect(() => fireKey("ArrowDown")).not.toThrow();
  });
});

describe("StartMenu — biome picker (025)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function fireKey(code: string): void {
    window.dispatchEvent(new KeyboardEvent("keydown", { code, cancelable: true }));
  }

  // Connect BEFORE constructing so the constructor's startNav focus() runs on
  // a connected element (jsdom ignores focus on disconnected subtrees).
  function makeConnectedMenu(onStart?: (mode: GameMode, biome: BiomeId) => void): {
    container: HTMLElement;
    menu: StartMenu;
    audio: ReturnType<typeof makeAudio>;
  } {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const audio = makeAudio();
    const menu = new StartMenu(container, audio, onStart ?? vi.fn());
    return { container, menu, audio };
  }

  it("defaults to the temperate biome selected", () => {
    const { container, menu } = makeConnectedMenu();
    expect(menu.selectedBiome).toBe("temperate");
    const btn = container.querySelector("button.gc-biome") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.dataset.selected).toBe("true");
  });

  it("renders one button per registered biome", () => {
    const { container } = makeConnectedMenu();
    const count = container.querySelectorAll("button.gc-biome").length;
    expect(count).toBe(Object.keys(BIOMES).length);
  });

  it("biome buttons have pointer-events auto", () => {
    const { container } = makeConnectedMenu();
    const btn = container.querySelector("button.gc-biome") as HTMLElement;
    expect(btn.style.pointerEvents).toBe("auto");
  });

  it("clicking the biome button keeps it selected and fires a 'click' beep", () => {
    const { container, menu, audio } = makeConnectedMenu();
    const btn = container.querySelector("button.gc-biome") as HTMLButtonElement;
    const before = audio.calls.filter((c) => c === "click").length;
    btn.click();
    expect(menu.selectedBiome).toBe("temperate");
    expect(btn.dataset.selected).toBe("true");
    expect(audio.calls.filter((c) => c === "click").length).toBe(before + 1);
  });

  it("START carries the selected biome into onStart", () => {
    const onStart = vi.fn();
    const { container } = makeConnectedMenu(onStart);
    (container.querySelector("button.gc-start") as HTMLButtonElement).click();
    expect(onStart).toHaveBeenCalledWith("1P", "temperate");
  });

  it("biome select is locked once started", () => {
    const { container, menu, audio } = makeConnectedMenu();
    (container.querySelector("button.gc-start") as HTMLButtonElement).click();
    const clicksBefore = audio.calls.filter((c) => c === "click").length;
    const btn = container.querySelector("button.gc-biome") as HTMLButtonElement;
    btn.click(); // ignored
    expect(menu.selectedBiome).toBe("temperate");
    // No new 'click' beep from the ignored biome select.
    expect(audio.calls.filter((c) => c === "click").length).toBe(clicksBefore);
  });

  it("ArrowDown from SETTINGS reaches the first biome button", () => {
    const { container } = makeConnectedMenu();
    // mode(0) -> START(1) -> SETTINGS(2) -> first biome(3)
    fireKey("ArrowDown");
    fireKey("ArrowDown");
    fireKey("ArrowDown");
    const biomeBtn = container.querySelector("button.gc-biome") as HTMLButtonElement;
    expect(document.activeElement).toBe(biomeBtn);
  });

  it("selecting a biome fires onBiomeChange with that id", () => {
    const onBiomeChange = vi.fn();
    const other = Object.values(BIOMES).find((b) => b.id !== "temperate")!.id;
    const container = document.createElement("div");
    document.body.appendChild(container);
    new StartMenu(container, makeAudio(), vi.fn(), undefined, onBiomeChange);

    const btn = container.querySelector(
      `button.gc-biome[data-biome="${other}"]`,
    ) as HTMLButtonElement;
    btn.click();

    expect(onBiomeChange).toHaveBeenCalledTimes(1);
    expect(onBiomeChange).toHaveBeenCalledWith(other);
  });

  it("clicking the already-selected biome still fires onBiomeChange", () => {
    const onBiomeChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    new StartMenu(container, makeAudio(), vi.fn(), undefined, onBiomeChange);

    const btn = container.querySelector(
      'button.gc-biome[data-biome="temperate"]',
    ) as HTMLButtonElement;
    btn.click();

    expect(onBiomeChange).toHaveBeenCalledTimes(1);
    expect(onBiomeChange).toHaveBeenCalledWith("temperate");
  });

  it("onBiomeChange does not fire once started", () => {
    const onBiomeChange = vi.fn();
    const other = Object.values(BIOMES).find((b) => b.id !== "temperate")!.id;
    const container = document.createElement("div");
    document.body.appendChild(container);
    new StartMenu(container, makeAudio(), vi.fn(), undefined, onBiomeChange);

    (container.querySelector("button.gc-start") as HTMLButtonElement).click();
    const btn = container.querySelector(
      `button.gc-biome[data-biome="${other}"]`,
    ) as HTMLButtonElement;
    btn.click(); // locked

    expect(onBiomeChange).not.toHaveBeenCalled();
  });
});
