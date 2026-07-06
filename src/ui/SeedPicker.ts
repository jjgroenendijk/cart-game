/**
 * SeedPicker — TRACK CODE input + COPY/RANDOM (task 058).
 *
 * Self-contained DOM component that renders one {@link CircuitId} as its
 * canonical `XXXX-XXXX-XX` short code. The player can paste a friend's code
 * (Enter/blur commits), COPY the current code to the clipboard, or RANDOMize
 * (fresh uint32 seed + a derived biome). Notifies a single `onChange`
 * callback; does NOT touch GameFlow or storage directly — the host
 * (StartMenu) wires persistence via onCircuitChange -> rebuildWorld. The
 * biome is shown by the host's BIOME selector row, not here.
 *
 * Plain DOM + cssText + the shared menuStyles kit (ghost buttons, selector
 * row styling). The input is the keyboard focus unit; COPY/RANDOM are
 * mouse-only (tabIndex -1). MenuNav reaches the input between the BIOME row
 * and SETTINGS. StartMenu suppresses its global ArrowLeft/Right + Enter/Space
 * while the input is focused so arrows edit text and Enter commits here.
 */

import { encodeCircuitCode, parseCircuitCode, type CircuitId } from "../terrain/circuitCode";
import { biomeIndexOf, selectBiome } from "../terrain/biomes";
import { type MenuAudio } from "./StartMenu";
import { SELECTOR_LABEL_STYLE, styleMenuButton } from "./menuStyles";

// 072 editorial: sharp corners, neutral hairline border, no fill (matches the
// start-menu console's transparent text controls).
const INPUT_STYLE = [
  "pointer-events:auto",
  "width:100%",
  "box-sizing:border-box",
  "font-family:inherit",
  "font-size:15px",
  "font-weight:700",
  "letter-spacing:0.15em",
  "text-align:center",
  "color:#eef2f7",
  "background:rgba(238,242,247,0.05)",
  "border:1px solid rgba(238,242,247,0.22)",
  "border-radius:0",
  "padding:9px",
].join(";");

/**
 * Renders one circuit identity as an editable short code with COPY/RANDOM
 * actions. Appends its element into `parent`. The biome is NOT shown here —
 * the host's BIOME selector row is the single source of truth and is kept in
 * sync via setCircuit / onCircuitChange.
 */
export class SeedPicker {
  /** Top-level container appended into the host panel. */
  readonly element: HTMLDivElement;
  private readonly input: HTMLInputElement;
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

    // Header: label left, COPY/RANDOM right. The code input sits full-width
    // BELOW this row so the 11-char code reads cleanly inside the 340px panel
    // (a single row of label + input + two buttons squeezed the input to ~0).
    const header = document.createElement("div");
    header.className = "gc-code-header";
    header.style.cssText = [
      "pointer-events:auto",
      "display:flex",
      "align-items:center",
      "justify-content:space-between",
      "gap:8px",
    ].join(";");

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

    const buttonGroup = document.createElement("div");
    buttonGroup.className = "gc-code-actions";
    buttonGroup.style.cssText = "display:flex;gap:8px";
    buttonGroup.append(copyBtn, randomBtn);

    header.append(labelEl, buttonGroup);

    this.element.append(header, this.input);
    this.render();
    parent.appendChild(this.element);
  }

  /** The code input element (keyboard focus unit for MenuNav). */
  get inputElement(): HTMLInputElement {
    return this.input;
  }

  /**
   * External-driven update (e.g. the biome row changed the biome). Re-renders
   * the input WITHOUT firing onChange (avoids a feedback loop).
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
  }
}
