import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { SeedPicker } from "./SeedPicker";
import { type MenuAudio } from "./StartMenu";
import {
  DEFAULT_ID,
  encodeCircuitCode,
  parseCircuitCode,
  resolveSeed,
  type CircuitId,
} from "../terrain/circuitCode";
import { BIOME_ORDER, biomeIndexOf, selectBiome } from "../terrain/biomes";

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

  it("an arbitrary string + Enter resolves to a hashed seed (078, never rejects)", () => {
    const { input, onChange } = makePicker();
    input.value = "hello";
    input.dispatchEvent(new KeyboardEvent("keydown", { code: "Enter", cancelable: true }));
    const expected: CircuitId = {
      seed: resolveSeed("hello"),
      biome: biomeIndexOf(selectBiome(resolveSeed("hello")).id),
    };
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expected);
    expect(input.value).toBe(encodeCircuitCode(expected));
  });

  it("an arbitrary string + blur resolves to the same hashed seed", () => {
    const { input, onChange } = makePicker();
    input.value = "My Cool Track";
    input.dispatchEvent(new Event("blur"));
    const expected: CircuitId = {
      seed: resolveSeed("My Cool Track"),
      biome: biomeIndexOf(selectBiome(resolveSeed("My Cool Track")).id),
    };
    expect(onChange).toHaveBeenCalledWith(expected);
    expect(input.value).toBe(encodeCircuitCode(expected));
  });

  it("empty input is a no-op (no onChange, reverts to the current code)", () => {
    const { input, onChange } = makePicker();
    const original = input.value;
    input.value = "   ";
    input.dispatchEvent(new KeyboardEvent("keydown", { code: "Enter", cancelable: true }));
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

  it("typing a decimal seed + Enter applies it with a derived biome (078)", () => {
    const { input, onChange, audio } = makePicker();
    input.value = "12345";
    input.dispatchEvent(new KeyboardEvent("keydown", { code: "Enter", cancelable: true }));
    const expected: CircuitId = {
      seed: 12345,
      biome: biomeIndexOf(selectBiome(12345).id),
    };
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expected);
    // Field re-renders to the canonical code for the new circuit.
    expect(input.value).toBe(encodeCircuitCode(expected));
    expect(audio.calls).toContain("beep");
  });

  it("typing 0x-prefixed hex applies the parsed uint32 seed", () => {
    const { input, onChange } = makePicker();
    input.value = "0xDEADBEEF";
    input.dispatchEvent(new KeyboardEvent("keydown", { code: "Enter", cancelable: true }));
    const expected: CircuitId = {
      seed: 0xdeadbeef,
      biome: biomeIndexOf(selectBiome(0xdeadbeef).id),
    };
    expect(onChange).toHaveBeenCalledWith(expected);
    expect(input.value).toBe(encodeCircuitCode(expected));
  });

  it("re-entering the SAME numeric seed is a no-op (no onChange, no beep)", () => {
    const { picker, input, onChange, audio } = makePicker();
    picker.setCircuit({ seed: 42, biome: biomeIndexOf(selectBiome(42).id) });
    onChange.mockClear();
    input.value = "42";
    input.dispatchEvent(new KeyboardEvent("keydown", { code: "Enter", cancelable: true }));
    expect(onChange).not.toHaveBeenCalled();
    expect(audio.calls).not.toContain("beep");
  });

  it("a plain seed derives the biome deterministically (same seed -> same biome)", () => {
    const { input, onChange } = makePicker();
    input.value = "777";
    input.dispatchEvent(new KeyboardEvent("keydown", { code: "Enter", cancelable: true }));
    const first = onChange.mock.calls[0]![0] as CircuitId;
    const expectedBiome = biomeIndexOf(selectBiome(777).id);
    expect(first.biome).toBe(expectedBiome);
    expect(first.biome).toBeGreaterThanOrEqual(0);
    expect(first.biome).toBeLessThan(BIOME_ORDER.length);
  });

  it("a string seed is deterministic (same string -> same circuit)", () => {
    const { input, onChange } = makePicker();
    input.value = "deadbeef";
    input.dispatchEvent(new KeyboardEvent("keydown", { code: "Enter", cancelable: true }));
    const first = onChange.mock.calls[0]![0] as CircuitId;
    expect(first.seed).toBe(resolveSeed("deadbeef"));
    // bare hex hashes — it is NOT the number 0xdeadbeef.
    expect(first.seed).not.toBe(0xdeadbeef);
    expect(first.biome).toBeGreaterThanOrEqual(0);
    expect(first.biome).toBeLessThan(BIOME_ORDER.length);
  });

  it("re-entering the SAME string seed is a no-op (no onChange, no beep)", () => {
    const { picker, input, onChange, audio } = makePicker();
    const seed = resolveSeed("same");
    picker.setCircuit({ seed, biome: biomeIndexOf(selectBiome(seed).id) });
    onChange.mockClear();
    input.value = "same";
    input.dispatchEvent(new KeyboardEvent("keydown", { code: "Enter", cancelable: true }));
    expect(onChange).not.toHaveBeenCalled();
    expect(audio.calls).not.toContain("beep");
  });
});
