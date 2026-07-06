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

interface MenuRig {
  container: HTMLElement;
  menu: StartMenu;
  audio: ReturnType<typeof makeAudio>;
}

// Connect the container BEFORE constructing so the constructor's startNav
// focus() runs on a connected element (jsdom ignores focus on disconnected
// subtrees for document.activeElement).
function makeMenu(
  onStart?: (mode: GameMode, biome: BiomeId) => void,
  onSettings?: () => void,
  onBiomeChange?: (biome: BiomeId) => void,
): MenuRig {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const audio = makeAudio();
  const menu = new StartMenu(container, audio, onStart ?? vi.fn(), onSettings, onBiomeChange);
  return { container, menu, audio };
}

function fireKey(code: string): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { code, cancelable: true }));
}

function q<T extends HTMLElement>(container: HTMLElement, sel: string): T {
  return container.querySelector(sel) as T;
}

/** Ordered biome definitions as the menu cycles them. */
const BIOME_DEFS = Object.values(BIOMES);

describe("StartMenu — DOM overlay (006/070)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds title, start button, selector rows, and controls list", () => {
    const { container } = makeMenu();
    expect(q(container, "h1.gc-title").textContent).toBe("GAME CART");
    expect(q(container, "button.gc-start").textContent).toBe("START RACE");
    expect(q(container, ".gc-mode-value").textContent).toBe("1 PLAYER");
    expect(q(container, ".gc-biome-value").textContent).toBe("TEMPERATE");
    expect(q(container, "button.gc-settings").textContent).toBe("SETTINGS");
    const controls = q(container, "p.gc-controls");
    expect(controls.innerHTML).toContain("WASD");
    expect(controls.innerHTML).toContain("Gamepad");
  });

  it("root has pointer-events none; interactive controls opt back in", () => {
    const { container } = makeMenu();
    const root = container.querySelector("div") as HTMLElement;
    expect(root.style.pointerEvents).toBe("none");
    expect(q(container, "button.gc-start").style.pointerEvents).toBe("auto");
    expect(q(container, ".gc-mode-row").style.pointerEvents).toBe("auto");
    expect(q(container, "button.gc-settings").style.pointerEvents).toBe("auto");
  });

  it("z-index is 10 (parity with #loading)", () => {
    const { container } = makeMenu();
    const root = container.querySelector("div") as HTMLElement;
    expect(root.style.zIndex).toBe("10");
  });

  it("START click fires onStart exactly once", () => {
    const onStart = vi.fn();
    const { container } = makeMenu(onStart);
    q<HTMLButtonElement>(container, "button.gc-start").click();
    q<HTMLButtonElement>(container, "button.gc-start").click();
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
    q<HTMLButtonElement>(container, "button.gc-start").click(); // first wins
    fireKey("Enter"); // ignored
    fireKey("Space"); // ignored
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(menu.isStarted).toBe(true);
  });

  it("show() re-arms START after a Back (mouse + keyboard)", () => {
    const onStart = vi.fn();
    const { container, menu } = makeMenu(onStart);
    // First showing: confirm() wins and drops the keydown listener.
    q<HTMLButtonElement>(container, "button.gc-start").click();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(menu.isStarted).toBe(true);
    // GameFlow hides on confirm; a race-config Back re-shows the instance.
    menu.hide();
    menu.show();
    expect(menu.isStarted).toBe(false);
    // Mouse path fires again.
    q<HTMLButtonElement>(container, "button.gc-start").click();
    expect(onStart).toHaveBeenCalledTimes(2);
    // Re-arm once more and confirm the Enter keydown listener re-attached.
    menu.show();
    fireKey("Enter");
    expect(onStart).toHaveBeenCalledTimes(3);
  });

  it("START click fires a 'click' beep", () => {
    const { container, audio } = makeMenu();
    q<HTMLButtonElement>(container, "button.gc-start").click();
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

  it("keydown while hidden is inert (no start from settings overlay)", () => {
    const onStart = vi.fn();
    const { menu } = makeMenu(onStart);
    menu.hide();
    fireKey("Enter");
    expect(onStart).not.toHaveBeenCalled();
  });
});

describe("StartMenu — editorial restyle (072)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has kicker + serif masthead; arcade ribbon/gradient-shine are gone", () => {
    const { container } = makeMenu();
    expect(q(container, ".gc-kicker").textContent).toContain("FIELD NOTES");
    const title = q(container, "h1.gc-title");
    expect(title.textContent).toBe("GAME CART");
    expect(title.style.fontFamily).toContain("Georgia");
    expect(q<HTMLSpanElement>(container, ".gc-title-accent").style.fontStyle).toBe("italic");
    // Retired arcade motifs:
    expect(container.querySelector(".gc-title-strip")).toBeNull();
    expect(container.querySelector("style")!.textContent).not.toContain("gc-title-shine");
  });

  it("frames the overlay with four corner marks + vignette + grain layers", () => {
    const { container } = makeMenu();
    const root = container.querySelector("div") as HTMLElement;
    const layers = Array.from(root.children).filter(
      (c) => c instanceof HTMLElement && c.style.position === "absolute",
    );
    // 4 corner marks + the corner blocks are position:absolute; vignette + grain too.
    expect(layers.length).toBeGreaterThanOrEqual(6);
    const styleText = Array.from(root.querySelectorAll("div"))
      .map((d) => (d as HTMLElement).style.cssText)
      .join(" ");
    expect(styleText).toContain("radial-gradient");
    expect(styleText).toContain("mix-blend-mode: overlay");
  });

  it("top-right SEED block holds the TRACK CODE picker (no duplicate readout)", () => {
    const { container } = makeMenu();
    const seed = q(container, ".gc-seed");
    // The seed lives here (interactive picker), right-aligned in its own corner.
    expect(seed.textContent).toContain("SEED");
    expect(seed.querySelector("input.gc-code-input")).not.toBeNull();
    expect(seed.style.textAlign).toBe("right");
    // The retired read-only telemetry rows are gone (no duplicated mode/biome/seed).
    expect(container.querySelector(".gc-telemetry")).toBeNull();
    expect(container.querySelector(".gc-tele-seed-value")).toBeNull();
    expect(container.querySelector(".gc-tele-mode-value")).toBeNull();
  });

  it("bottom-right hints carry the drive-controls list", () => {
    const { container } = makeMenu();
    const hints = q(container, ".gc-hints");
    const controls = hints.querySelector("p.gc-controls");
    expect(controls).not.toBeNull();
    expect(controls!.innerHTML).toContain("WASD");
  });

  it("interactive controls sit in a bottom-left console (not a centered card)", () => {
    const { container } = makeMenu();
    const panel = q(container, ".gc-console");
    expect(panel.style.pointerEvents).toBe("auto");
    expect(panel.style.position).toBe("absolute");
    // Not the retired centered strip: no horizontal-centering transform.
    expect(panel.style.transform).toBe("");
    expect(panel.style.cssText).not.toContain("backdrop-filter");
    expect(panel.querySelector("button.gc-start")).not.toBeNull();
    expect(panel.querySelector(".gc-mode-row")).not.toBeNull();
    expect(panel.querySelector(".gc-biome-row")).not.toBeNull();
    expect(panel.querySelector("button.gc-settings")).not.toBeNull();
    // The TRACK CODE picker moved to the top-right SEED block; not in the console.
    expect(panel.querySelector("input.gc-code-input")).toBeNull();
    // The old pulsing-dot status column is retired.
    expect(container.querySelector(".gc-statusbar")).toBeNull();
  });

  it("console buttons have sharp corners + hairline dividers between sections", () => {
    const { container } = makeMenu();
    // background:transparent is jsdom-dropped, so we assert the sharp corner
    // (the visible "no rounded corners" ask); the transparent fill lives in
    // START_BTN_STYLE / SETTINGS_BTN_STYLE.
    expect(q<HTMLButtonElement>(container, "button.gc-start").style.borderRadius).toBe("0px");
    expect(q<HTMLButtonElement>(container, "button.gc-settings").style.borderRadius).toBe("0px");
    // Console sections are separated by full-width 1px hairline dividers.
    const dividers = Array.from(q(container, ".gc-console").children).filter(
      (c) => (c as HTMLElement).style.height === "1px",
    );
    expect(dividers.length).toBeGreaterThanOrEqual(2);
  });
});

describe("StartMenu — focused-control activation (070)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Enter with SETTINGS focused opens settings, not the race", () => {
    const onStart = vi.fn();
    const onSettings = vi.fn();
    const { container } = makeMenu(onStart, onSettings);
    q<HTMLButtonElement>(container, "button.gc-settings").focus();
    fireKey("Enter");
    expect(onSettings).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("SETTINGS click fires onSettings with a 'click' beep", () => {
    const onSettings = vi.fn();
    const { container, audio } = makeMenu(undefined, onSettings);
    q<HTMLButtonElement>(container, "button.gc-settings").click();
    expect(onSettings).toHaveBeenCalledTimes(1);
    expect(audio.calls).toContain("click");
  });

  it("Enter with a selector row focused still starts the race", () => {
    const onStart = vi.fn();
    const { container } = makeMenu(onStart);
    q<HTMLDivElement>(container, ".gc-mode-row").focus();
    fireKey("Enter");
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});

describe("StartMenu — mode selector row (008/070)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to 1P", () => {
    const { menu, container } = makeMenu();
    expect(menu.selectedMode).toBe("1P");
    expect(q(container, ".gc-mode-value").textContent).toBe("1 PLAYER");
  });

  it("next chevron cycles 1P -> 2P -> 1P", () => {
    const { container, menu } = makeMenu();
    const next = q<HTMLButtonElement>(container, ".gc-mode-next");
    next.click();
    expect(menu.selectedMode).toBe("2P");
    expect(q(container, ".gc-mode-value").textContent).toBe("2 PLAYERS");
    next.click();
    expect(menu.selectedMode).toBe("1P");
  });

  it("prev chevron wraps 1P -> 2P", () => {
    const { container, menu } = makeMenu();
    q<HTMLButtonElement>(container, ".gc-mode-prev").click();
    expect(menu.selectedMode).toBe("2P");
  });

  it("ArrowRight on the focused mode row cycles the mode", () => {
    const { container, menu } = makeMenu();
    q<HTMLDivElement>(container, ".gc-mode-row").focus();
    fireKey("ArrowRight");
    expect(menu.selectedMode).toBe("2P");
    fireKey("ArrowLeft");
    expect(menu.selectedMode).toBe("1P");
  });

  it("each cycle fires a 'beep'", () => {
    const { container, audio } = makeMenu();
    const next = q<HTMLButtonElement>(container, ".gc-mode-next");
    next.click();
    next.click();
    expect(audio.calls.filter((c) => c === "beep").length).toBe(2);
  });

  it("controls list shows the P2 arrows row only in 2P", () => {
    const { container, menu } = makeMenu();
    const controls = () => q(container, "p.gc-controls");
    expect(controls().innerHTML).not.toContain("P2: Arrows");
    q<HTMLButtonElement>(container, ".gc-mode-next").click(); // -> 2P
    expect(menu.selectedMode).toBe("2P");
    expect(controls().innerHTML).toContain("P2: Arrows");
    expect(controls().innerHTML).toContain("WASD");
  });

  it("onStart carries the selected mode", () => {
    const onStart = vi.fn();
    const { container } = makeMenu(onStart);
    q<HTMLButtonElement>(container, ".gc-mode-next").click(); // -> 2P
    q<HTMLButtonElement>(container, "button.gc-start").click();
    expect(onStart).toHaveBeenCalledWith("2P", "temperate");
  });

  it("START carries 1P when the selector is never touched", () => {
    const onStart = vi.fn();
    const { container } = makeMenu(onStart);
    q<HTMLButtonElement>(container, "button.gc-start").click();
    expect(onStart).toHaveBeenCalledWith("1P", "temperate");
  });

  it("mode selector is locked once started", () => {
    const { container, menu } = makeMenu();
    q<HTMLButtonElement>(container, "button.gc-start").click();
    q<HTMLButtonElement>(container, ".gc-mode-next").click(); // ignored
    expect(menu.selectedMode).toBe("1P");
  });
});

describe("StartMenu — biome selector row (025/070)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to the temperate biome", () => {
    const { container, menu } = makeMenu();
    expect(menu.selectedBiome).toBe("temperate");
    expect(q(container, ".gc-biome-value").textContent).toBe("TEMPERATE");
  });

  it("next chevron cycles to the next registered biome + fires onBiomeChange", () => {
    const onBiomeChange = vi.fn();
    const { container, menu } = makeMenu(undefined, undefined, onBiomeChange);
    q<HTMLButtonElement>(container, ".gc-biome-next").click();
    const expected = BIOME_DEFS[1]!.id;
    expect(menu.selectedBiome).toBe(expected);
    expect(q(container, ".gc-biome-value").textContent).toBe(BIOME_DEFS[1]!.label.toUpperCase());
    expect(onBiomeChange).toHaveBeenCalledTimes(1);
    expect(onBiomeChange).toHaveBeenCalledWith(expected);
  });

  it("prev chevron wraps to the last registered biome", () => {
    const { container, menu } = makeMenu();
    q<HTMLButtonElement>(container, ".gc-biome-prev").click();
    expect(menu.selectedBiome).toBe(BIOME_DEFS[BIOME_DEFS.length - 1]!.id);
  });

  it("cycling through all biomes returns to temperate", () => {
    const { container, menu } = makeMenu();
    const next = q<HTMLButtonElement>(container, ".gc-biome-next");
    for (let i = 0; i < BIOME_DEFS.length; i++) next.click();
    expect(menu.selectedBiome).toBe("temperate");
  });

  it("ArrowRight on the focused biome row cycles + fires onBiomeChange", () => {
    const onBiomeChange = vi.fn();
    const { container, menu } = makeMenu(undefined, undefined, onBiomeChange);
    q<HTMLDivElement>(container, ".gc-biome-row").focus();
    fireKey("ArrowRight");
    expect(menu.selectedBiome).toBe(BIOME_DEFS[1]!.id);
    expect(onBiomeChange).toHaveBeenCalledWith(BIOME_DEFS[1]!.id);
  });

  it("START carries the selected biome into onStart", () => {
    const onStart = vi.fn();
    const { container } = makeMenu(onStart);
    q<HTMLButtonElement>(container, ".gc-biome-next").click();
    q<HTMLButtonElement>(container, "button.gc-start").click();
    expect(onStart).toHaveBeenCalledWith("1P", BIOME_DEFS[1]!.id);
  });

  it("biome selector is locked once started (no onBiomeChange)", () => {
    const onBiomeChange = vi.fn();
    const { container, menu } = makeMenu(undefined, undefined, onBiomeChange);
    q<HTMLButtonElement>(container, "button.gc-start").click();
    q<HTMLButtonElement>(container, ".gc-biome-next").click(); // locked
    expect(menu.selectedBiome).toBe("temperate");
    expect(onBiomeChange).not.toHaveBeenCalled();
  });
});

describe("StartMenu — menu navigation (012/070)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("start() focuses the primary action (START RACE) first", () => {
    const { container } = makeMenu();
    expect(document.activeElement).toBe(q(container, "button.gc-start"));
  });

  it("ArrowDown walks START -> MODE -> BIOME -> TRACK CODE input -> SETTINGS", () => {
    const { container } = makeMenu();
    fireKey("ArrowDown");
    expect(document.activeElement).toBe(q(container, ".gc-mode-row"));
    fireKey("ArrowDown");
    expect(document.activeElement).toBe(q(container, ".gc-biome-row"));
    fireKey("ArrowDown");
    expect(document.activeElement).toBe(q(container, "input.gc-code-input"));
    fireKey("ArrowDown");
    expect(document.activeElement).toBe(q(container, "button.gc-settings"));
  });

  it("hide() stops nav: ArrowDown afterwards does not throw", () => {
    const { menu } = makeMenu();
    menu.hide();
    expect(() => fireKey("ArrowDown")).not.toThrow();
  });

  it("remove() stops nav: ArrowDown afterwards does not throw", () => {
    const { menu } = makeMenu();
    menu.remove();
    expect(() => fireKey("ArrowDown")).not.toThrow();
  });
});
