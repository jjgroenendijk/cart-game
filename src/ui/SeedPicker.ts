/**
 * SeedPicker — TRACK CODE input + COPY/RANDOM + biome label (task 058).
 *
 * Self-contained DOM component that renders one {@link CircuitId} as its
 * canonical `XXXX-XXXX-XX` short code. The player can paste a friend's code
 * (Enter/blur commits), COPY the current code to the clipboard, or RANDOMize
 * (fresh uint32 seed + a derived biome). Notifies a single `onChange`
 * callback; does NOT touch GameFlow or storage directly — the host
 * (StartMenu) wires persistence via onCircuitChange -> rebuildWorld.
 *
 * Plain DOM + cssText + the shared menuStyles kit (ghost buttons, selector
 * row styling). The input is the keyboard focus unit; COPY/RANDOM are
 * mouse-only (tabIndex -1). MenuNav reaches the input between the BIOME row
 * and SETTINGS. StartMenu suppresses its global ArrowLeft/Right + Enter/Space
 * while the input is focused so arrows edit text and Enter commits here.
 */

import { encodeCircuitCode, parseCircuitCode, type CircuitId } from "../terrain/circuitCode";
import { biomeByIndex, biomeIndexOf, selectBiome } from "../terrain/biomes";
import { type MenuAudio } from "./StartMenu";
import { SELECTOR_LABEL_STYLE, SELECTOR_ROW_STYLE, styleMenuButton } from "./menuStyles";

const INPUT_STYLE = [
  "pointer-events:auto",
  "flex:1",
  "min-width:0",
  "font-family:inherit",
  "font-size:16px",
  "font-weight:800",
  "letter-spacing:2px",
  "text-align:center",
  "color:#fff",
  "background:rgba(255,255,255,0.08)",
  "border:2px solid rgba(150,200,255,0.3)",
  "border-radius:10px",
  "padding:8px",
].join(";");

const BIOME_LABEL_STYLE = [
  "text-align:center",
  "font-size:12px",
  "font-weight:700",
  "letter-spacing:1px",
  "opacity:0.7",
].join(";");

/**
 * Renders one circuit identity as an editable short code with COPY/RANDOM
 * actions and a live biome label. Appends its element into `parent`.
 */
export class SeedPicker {
  /** Top-level container appended into the host panel. */
  readonly element: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly biomeLabel: HTMLSpanElement;
  private readonly audio: MenuAudio;
  private readonly onChange: (id: CircuitId) => void;
  private id: CircuitId;

  constructor(
    parent: HTMLElement,
    audio: MenuAudio,
    initial: CircuitId,
    onChange: (id: CircuitId) => void,
  ) {
    this.audio = audio;
    this.onChange = onChange;
    this.id = { seed: initial.seed >>> 0, biome: initial.biome };

    this.element = document.createElement("div");
    this.element.className = "gc-code-picker";
    this.element.style.cssText = [
      "pointer-events:auto",
      "display:flex",
      "flex-direction:column",
      "gap:6px",
    ].join(";");

    const row = document.createElement("div");
    row.className = "gc-row gc-code-row";
    row.style.cssText = `${SELECTOR_ROW_STYLE};cursor:default`;

    const labelEl = document.createElement("span");
    labelEl.textContent = "TRACK CODE";
    labelEl.style.cssText = SELECTOR_LABEL_STYLE;

    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "gc-code-input";
    this.input.spellcheck = false;
    this.input.maxLength = 12;
    this.input.inputMode = "text";
    this.input.autocomplete = "off";
    this.input.style.cssText = INPUT_STYLE;
    this.input.setAttribute("aria-label", "Track code");
    this.input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.code === "Enter") {
        e.preventDefault();
        this.commit();
      }
    });
    this.input.addEventListener("blur", () => this.commit());
    this.input.addEventListener("change", () => this.commit());

    const copyBtn = this.makeGhostButton("COPY", "gc-code-copy", () => {
      void this.copyCode();
    });
    const randomBtn = this.makeGhostButton("RANDOM", "gc-code-random", () => {
      this.randomize();
    });

    row.append(labelEl, this.input, copyBtn, randomBtn);

    this.biomeLabel = document.createElement("span");
    this.biomeLabel.className = "gc-code-biome";
    this.biomeLabel.style.cssText = BIOME_LABEL_STYLE;

    this.element.append(row, this.biomeLabel);
    this.render();
    parent.appendChild(this.element);
  }

  /** The code input element (keyboard focus unit for MenuNav). */
  get inputElement(): HTMLInputElement {
    return this.input;
  }

  /**
   * External-driven update (e.g. the biome row changed the biome). Re-renders
   * the input + biome label WITHOUT firing onChange (avoids a feedback loop).
   */
  setCircuit(id: CircuitId): void {
    this.setId(id, false);
  }

  private makeGhostButton(text: string, cls: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = text;
    btn.tabIndex = -1;
    styleMenuButton(btn, "ghost", ["padding:8px 12px", "font-size:13px"]);
    btn.classList.add(cls);
    btn.addEventListener("click", onClick);
    return btn;
  }

  /** Parse the input; commit if valid + changed, else revert. Never throws. */
  private commit(): void {
    const parsed = parseCircuitCode(this.input.value);
    if (parsed !== null && (parsed.seed !== this.id.seed || parsed.biome !== this.id.biome)) {
      this.setId(parsed, true);
    } else {
      this.input.value = encodeCircuitCode(this.id);
    }
  }

  private randomize(): void {
    const seed = (Math.random() * 2 ** 32) >>> 0;
    const biome = biomeIndexOf(selectBiome(seed).id);
    this.setId({ seed, biome }, true);
    this.audio.uiBeep("beep");
  }

  /** Copy the canonical code to the clipboard if available; never throws. */
  private async copyCode(): Promise<void> {
    try {
      await navigator.clipboard?.writeText(encodeCircuitCode(this.id));
    } catch {
      /* clipboard unavailable (jsdom / blocked) — no-op */
    }
    this.audio.uiBeep("click");
  }

  private setId(id: CircuitId, notify: boolean): void {
    this.id = { seed: id.seed >>> 0, biome: id.biome };
    this.render();
    if (notify) this.onChange(this.id);
  }

  private render(): void {
    this.input.value = encodeCircuitCode(this.id);
    this.biomeLabel.textContent = biomeByIndex(this.id.biome).label;
  }
}
