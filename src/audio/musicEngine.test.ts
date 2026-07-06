import { describe, expect, it } from "vitest";
import { MockAudioContext } from "./mockAudioContext";
import {
  MusicEngine,
  musicPhaseFor,
  PHASE_CONFIG,
  DEFAULT_MUSIC,
  type MusicPhase,
} from "./musicEngine";

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

describe("PHASE_CONFIG (pure)", () => {
  const phases: MusicPhase[] = ["menu", "countdown", "racing", "finished"];

  it("every phase has a non-empty chord progression", () => {
    for (const p of phases) {
      const cfg = PHASE_CONFIG[p];
      expect(cfg.chords.length).toBeGreaterThan(0);
      for (const chord of cfg.chords) expect(chord.length).toBeGreaterThan(0);
    }
  });

  it("menu is pad-only (no bass/lead/drums); finished resolves to a C major chord", () => {
    const menu = PHASE_CONFIG.menu;
    expect(menu.bass).toEqual([]);
    expect(menu.lead).toEqual([]);
    expect(menu.kick).toEqual([]);
    expect(menu.snare).toEqual([]);
    expect(menu.hat).toEqual([]);
    // finished cadence opens on C major (C E G).
    expect(PHASE_CONFIG.finished.chords[0]).toEqual(["C4", "E4", "G4"]);
  });

  it("racing has the full kit (kick + snare + hat) + bass + lead", () => {
    const r = PHASE_CONFIG.racing;
    expect(r.kick.length).toBeGreaterThan(0);
    expect(r.snare.length).toBeGreaterThan(0);
    expect(r.hat.length).toBeGreaterThan(0);
    expect(r.bass.length).toBeGreaterThan(0);
    expect(r.lead.length).toBeGreaterThan(0);
  });

  it("energy builds menu -> countdown -> racing (BPM monotonic up)", () => {
    expect(PHASE_CONFIG.menu.bpm).toBeLessThan(PHASE_CONFIG.countdown.bpm);
    expect(PHASE_CONFIG.countdown.bpm).toBeLessThan(PHASE_CONFIG.racing.bpm);
  });

  it("all voice gains are non-negative", () => {
    for (const p of phases) {
      const c = PHASE_CONFIG[p];
      for (const g of [c.pad, c.bassGain, c.leadGain, c.drumGain, c.hatGain]) {
        expect(g).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("MusicEngine — graceful degrade under the jsdom mock", () => {
  it("constructs without throwing and reports not-ok (supportsTone false)", () => {
    const ctx = new MockAudioContext();
    const dest = ctx.createGain();
    let engine: MusicEngine;
    expect(() => {
      engine = new MusicEngine(ctx as unknown as AudioContext, dest as unknown as AudioNode);
    }).not.toThrow();
    expect(engine!.isOk).toBe(false);
  });

  it("adds ZERO native nodes (no pollution of the load-bearing voice indices)", () => {
    const ctx = new MockAudioContext();
    const dest = ctx.createGain();
    const g0 = ctx.gains.length;
    const o0 = ctx.oscillators.length;
    const b0 = ctx.biquads.length;
    new MusicEngine(ctx as unknown as AudioContext, dest as unknown as AudioNode);
    expect(ctx.gains.length).toBe(g0);
    expect(ctx.oscillators.length).toBe(o0);
    expect(ctx.biquads.length).toBe(b0);
  });

  it("setPhase + dispose are no-ops on a degraded engine", () => {
    const ctx = new MockAudioContext();
    const dest = ctx.createGain();
    const engine = new MusicEngine(ctx as unknown as AudioContext, dest as unknown as AudioNode);
    expect(() => engine.setPhase("racing")).not.toThrow();
    expect(() => engine.setPhase("finished")).not.toThrow();
    expect(() => engine.dispose()).not.toThrow();
  });
});

describe("DEFAULT_MUSIC", () => {
  it("has a gain trim in [0,1]", () => {
    expect(DEFAULT_MUSIC.gain).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_MUSIC.gain).toBeLessThanOrEqual(1);
  });
});
