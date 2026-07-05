import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { SeedPicker } from "./SeedPicker";
import { type MenuAudio } from "./StartMenu";
import {
  DEFAULT_ID,
  encodeCircuitCode,
  parseCircuitCode,
  type CircuitId,
} from "../terrain/circuitCode";
import { BIOME_ORDER } from "../terrain/biomes";

function makeAudio(): MenuAudio & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    uiBeep: (kind) => calls.push(kind),
  };
}

interface PickerRig {
  parent: HTMLElement;
  picker: SeedPicker;
  audio: ReturnType<typeof makeAudio>;
  onChange: ReturnType<typeof vi.fn>;
  input: HTMLInputElement;
}

function makePicker(initial: CircuitId = DEFAULT_ID): PickerRig {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const audio = makeAudio();
  const onChange = vi.fn();
  const picker = new SeedPicker(parent, audio, initial, onChange);
  return {
    parent,
    picker,
    audio,
    onChange,
    input: picker.inputElement,
  };
}

describe("SeedPicker — track code input (058)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the canonical code for DEFAULT_ID", () => {
    const { input } = makePicker();
    expect(input.value).toBe(encodeCircuitCode(DEFAULT_ID));
    expect(input.value).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{2}$/);
  });

  it("pasting a valid code + Enter fires onChange once with the parsed id", () => {
    const known: CircuitId = { seed: 999, biome: 2 };
    const code = encodeCircuitCode(known);
    const { input, onChange } = makePicker();
    input.value = code;
    input.dispatchEvent(new KeyboardEvent("keydown", { code: "Enter", cancelable: true }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ seed: 999, biome: 2 });
  });

  it("an invalid code + Enter reverts the input and does NOT fire onChange", () => {
    const { input, onChange } = makePicker();
    const original = input.value;
    input.value = "GARBAGE!!";
    input.dispatchEvent(new KeyboardEvent("keydown", { code: "Enter", cancelable: true }));
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe(original);
  });

  it("an invalid code + blur reverts the input without firing onChange", () => {
    const { input, onChange } = makePicker();
    const original = input.value;
    input.value = "GARBAGE!!";
    input.dispatchEvent(new Event("blur"));
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe(original);
  });

  it("RANDOM click fires onChange with a new seed + valid biome", () => {
    const { parent, onChange, input } = makePicker();
    const prior = parseCircuitCode(input.value)!;
    parent.querySelector<HTMLButtonElement>(".gc-code-random")!.click();
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as CircuitId;
    expect(next.seed).not.toBe(prior.seed);
    expect(next.biome).toBeGreaterThanOrEqual(0);
    expect(next.biome).toBeLessThan(BIOME_ORDER.length);
    expect(input.value).toBe(encodeCircuitCode(next));
  });

  it("COPY click does not throw when navigator.clipboard is undefined", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    const { parent, audio } = makePicker();
    expect(() => parent.querySelector<HTMLButtonElement>(".gc-code-copy")!.click()).not.toThrow();
    await Promise.resolve();
    expect(audio.calls).toContain("click");
  });

  it("COPY click writes the canonical code when clipboard is available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { parent, audio } = makePicker();
    parent.querySelector<HTMLButtonElement>(".gc-code-copy")!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(encodeCircuitCode(DEFAULT_ID));
    expect(audio.calls).toContain("click");
  });

  it("setCircuit (external update) re-renders without firing onChange", () => {
    const { picker, onChange, input } = makePicker();
    picker.setCircuit({ seed: 4242, biome: 1 });
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe(encodeCircuitCode({ seed: 4242, biome: 1 }));
  });
});
