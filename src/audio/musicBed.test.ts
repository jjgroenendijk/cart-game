import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { MockAudioContext, MockGain } from "./mockAudioContext";
import {
  MusicBed,
  musicStateFor,
  musicPhaseFor,
  nextArpNote,
  DEFAULT_MUSIC,
  type MusicOptions,
} from "./musicBed";

describe("musicStateFor (pure)", () => {
  it("menu/countdown are pad-only (arp 0); racing has arp; finished fades to 0", () => {
    const o = DEFAULT_MUSIC;
    expect(musicStateFor("menu").arp).toBe(0);
    expect(musicStateFor("countdown").arp).toBe(0);
    expect(musicStateFor("racing").arp).toBe(o.arpGain);
    expect(musicStateFor("racing").pad).toBe(o.padGain);
    expect(musicStateFor("finished").pad).toBe(0);
    expect(musicStateFor("finished").arp).toBe(0);
  });

  it("pad builds up menu -> countdown -> racing (monotonic)", () => {
    const m = musicStateFor("menu").pad;
    const c = musicStateFor("countdown").pad;
    const r = musicStateFor("racing").pad;
    expect(m).toBeLessThan(c);
    expect(c).toBeLessThan(r);
  });

  it("respects a custom options object", () => {
    const o: MusicOptions = {
      padGain: 0.2,
      arpGain: 0.3,
      rootHz: 220,
      scale: [0, 4, 7],
      tempo: 140,
    };
    expect(musicStateFor("racing", o).pad).toBe(0.2);
    expect(musicStateFor("racing", o).tempo).toBe(140);
  });
});

describe("musicPhaseFor (pure)", () => {
  it("maps game/race state to a music phase", () => {
    expect(musicPhaseFor("menu", "grid")).toBe("menu");
    expect(musicPhaseFor("countdown", "grid")).toBe("countdown");
    expect(musicPhaseFor("racing", "racing")).toBe("racing");
    expect(musicPhaseFor("racing", "finished")).toBe("finished");
  });

  it("defaults unknown game states to menu", () => {
    expect(musicPhaseFor("???", "grid")).toBe("menu");
  });
});

describe("nextArpNote (pure)", () => {
  it("cycles the scale and repeats after one full cycle", () => {
    const o = DEFAULT_MUSIC;
    const a = nextArpNote(0, o);
    const b = nextArpNote(o.scale.length, o);
    // Same scale degree one octave up -> double the frequency.
    expect(b.freq).toBeCloseTo(a.freq * 2, 3);
  });

  it("freq is root * 2^(semitone/12) for degree 0", () => {
    const o = { ...DEFAULT_MUSIC, rootHz: 110 };
    expect(nextArpNote(0, o).freq).toBeCloseTo(110, 3);
  });

  it("eighth-note duration = 60/tempo/2", () => {
    const o = { ...DEFAULT_MUSIC, tempo: 120 };
    expect(nextArpNote(0, o).dur).toBeCloseTo(60 / 120 / 2, 5);
  });
});

describe("MusicBed — build", () => {
  it("builds a music bus -> destination + 3 detuned pad saws + pad lowpass + arp gain", () => {
    const ctx = new MockAudioContext();
    const dest: MockGain = ctx.createGain();
    const before = ctx.oscillators.length;
    new MusicBed(ctx as unknown as AudioContext, dest as unknown as AudioNode);
    expect(ctx.oscillators.length - before).toBe(3); // 3 pads
    const pads = ctx.oscillators.slice(before);
    expect(pads.every((o) => o.type === "sawtooth")).toBe(true);
    expect(pads.map((o) => o.detune.value).sort((a, b) => a - b)).toEqual([-7, 0, 7]);
    expect(pads.every((o) => o.started)).toBe(true);
    expect(ctx.biquads.some((b) => b.type === "lowpass")).toBe(true);
    expect(ctx.gains.length).toBeGreaterThanOrEqual(4); // dest + bus + padGain + arpGain
  });

  it("pad oscs -> lowpass -> padGain -> bus -> destination", () => {
    const ctx = new MockAudioContext();
    const dest: MockGain = ctx.createGain();
    new MusicBed(ctx as unknown as AudioContext, dest as unknown as AudioNode);
    const pads = ctx.oscillators;
    const padLow = ctx.biquads.find((b) => b.type === "lowpass")!;
    const bus = ctx.gains[1]!; // [0] = caller's dest, [1] = music bus
    const padGain = ctx.gains[2]!;
    for (const o of pads) expect(o.connections).toContain(padLow);
    expect(padLow.connections).toContain(padGain);
    expect(padGain.connections).toContain(bus);
    expect(bus.connections).toContain(dest);
  });

  it("starts at the menu state (pad only, arp gain 0)", () => {
    const ctx = new MockAudioContext();
    const dest: MockGain = ctx.createGain();
    new MusicBed(ctx as unknown as AudioContext, dest as unknown as AudioNode);
    const padGain = ctx.gains[2]!;
    const arpGain = ctx.gains[3]!;
    expect(padGain.gain.targets.at(-1)?.target).toBeCloseTo(DEFAULT_MUSIC.padGain * 0.4, 5);
    expect(arpGain.gain.targets.at(-1)?.target).toBe(0);
  });
});

describe("MusicBed — setState + scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("setState('racing') ramps pad + arp gains up", () => {
    const ctx = new MockAudioContext();
    const dest: MockGain = ctx.createGain();
    const bed = new MusicBed(ctx as unknown as AudioContext, dest as unknown as AudioNode);
    bed.setState(musicStateFor("racing"));
    const padGain = ctx.gains[2]!;
    const arpGain = ctx.gains[3]!;
    expect(padGain.gain.targets.at(-1)?.target).toBeCloseTo(DEFAULT_MUSIC.padGain, 5);
    expect(arpGain.gain.targets.at(-1)?.target).toBeCloseTo(DEFAULT_MUSIC.arpGain, 5);
    bed.dispose();
  });

  it("schedules arp notes only once arp gain > 0 (racing)", () => {
    const ctx = new MockAudioContext();
    const dest: MockGain = ctx.createGain();
    const bed = new MusicBed(ctx as unknown as AudioContext, dest as unknown as AudioNode);
    const oscsAtMenu = ctx.oscillators.length;
    vi.advanceTimersByTime(40); // one scheduler tick while arp == 0 -> no notes
    expect(ctx.oscillators.length).toBe(oscsAtMenu);

    bed.setState(musicStateFor("racing"));
    vi.advanceTimersByTime(40); // tick with arp > 0 -> notes scheduled
    expect(ctx.oscillators.length).toBeGreaterThan(oscsAtMenu);
    bed.dispose();
  });

  it("setState('finished') silences pad + arp", () => {
    const ctx = new MockAudioContext();
    const dest: MockGain = ctx.createGain();
    const bed = new MusicBed(ctx as unknown as AudioContext, dest as unknown as AudioNode);
    bed.setState(musicStateFor("finished"));
    const padGain = ctx.gains[2]!;
    const arpGain = ctx.gains[3]!;
    expect(padGain.gain.targets.at(-1)?.target).toBe(0);
    expect(arpGain.gain.targets.at(-1)?.target).toBe(0);
    bed.dispose();
  });
});

describe("MusicBed — stop + dispose", () => {
  it("stop stops the pad oscillators", () => {
    const ctx = new MockAudioContext();
    const dest: MockGain = ctx.createGain();
    const bed = new MusicBed(ctx as unknown as AudioContext, dest as unknown as AudioNode);
    const pads = ctx.oscillators.slice();
    bed.stop();
    for (const o of pads) expect(o.stopped).toBe(true);
  });

  it("dispose disconnects the bus + pad + arp nodes", () => {
    const ctx = new MockAudioContext();
    const dest: MockGain = ctx.createGain();
    const bed = new MusicBed(ctx as unknown as AudioContext, dest as unknown as AudioNode);
    const bus = ctx.gains[1]!;
    const padGain = ctx.gains[2]!;
    const arpGain = ctx.gains[3]!;
    bed.dispose();
    expect(bus.disconnects).toBeGreaterThanOrEqual(1);
    expect(padGain.disconnects).toBeGreaterThanOrEqual(1);
    expect(arpGain.disconnects).toBeGreaterThanOrEqual(1);
  });
});
