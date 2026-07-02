import { describe, expect, it, vi } from "vitest";
import { GameAudioDriver } from "./gameAudio";
import { makeLightningSchedule } from "../environment/lightning";

/** Minimal structural AudioManager stand-in: just the methods the driver calls. */
function makeAudio() {
  return {
    triggerImpact: vi.fn(),
    onRespawn: vi.fn(),
    setMusicPhase: vi.fn(),
    setRainLevel: vi.fn(),
    thunder: vi.fn(),
  };
}

/** Minimal structural PhysicsWorld: invokes the drain cb with a fake event. */
function makePhysics(force: number, c1 = 10, c2 = 99) {
  return {
    drainContactForceEvents: (cb: (e: FakeEvent) => void) =>
      cb({ collider1: () => c1, collider2: () => c2, totalForceMagnitude: () => force }),
  };
}

interface FakeEvent {
  collider1(): number;
  collider2(): number;
  totalForceMagnitude(): number;
}

describe("GameAudioDriver — setSources + flush (009)", () => {
  // Stable racing/racing state keeps the music phase constant across these
  // impact-focused calls so setMusicPhase fires at most once (null -> racing
  // on the first flush) and the assertions stay impact-only.
  const GS = "racing";
  const RP = "racing";

  it("flush fires triggerImpact for a qualifying mapped kart hit", () => {
    const audio = makeAudio();
    const d = new GameAudioDriver(audio as never);
    d.setSources([{ kart: { controller: { collider: { handle: 10 } } } }], [], 1);
    d.flush(makePhysics(5000) as never, 1.0, GS, RP);
    expect(audio.triggerImpact).toHaveBeenCalledTimes(1);
    expect(audio.triggerImpact).toHaveBeenCalledWith(5000);
  });

  it("flush is a no-op when no kart handle is mapped (prop-prop)", () => {
    const audio = makeAudio();
    const d = new GameAudioDriver(audio as never);
    d.setSources([{ kart: { controller: { collider: { handle: 10 } } } }], [], 1);
    d.flush(makePhysics(5000, 700, 701) as never, 1.0, GS, RP); // neither handle mapped
    expect(audio.triggerImpact).not.toHaveBeenCalled();
  });

  it("flush skips sub-threshold forces", () => {
    const audio = makeAudio();
    const d = new GameAudioDriver(audio as never);
    d.setSources([{ kart: { controller: { collider: { handle: 10 } } } }], [], 1);
    d.flush(makePhysics(50) as never, 1.0, GS, RP); // below default 300 threshold
    expect(audio.triggerImpact).not.toHaveBeenCalled();
  });

  it("cooldown suppresses a second hit within 80ms, fires again after", () => {
    const audio = makeAudio();
    const d = new GameAudioDriver(audio as never);
    d.setSources([{ kart: { controller: { collider: { handle: 10 } } } }], [], 1);
    d.flush(makePhysics(1000) as never, 1.0, GS, RP);
    d.flush(makePhysics(2000) as never, 1.04, GS, RP); // 40ms < 80ms -> suppressed
    d.flush(makePhysics(3000) as never, 1.09, GS, RP); // 90ms >= 80ms -> fires
    expect(audio.triggerImpact).toHaveBeenCalledTimes(2);
  });

  it("maps rival handles to their field index (humanCount + i)", () => {
    const audio = makeAudio();
    const d = new GameAudioDriver(audio as never);
    d.setSources(
      [],
      [{ controller: { collider: { handle: 20 } } }, { controller: { collider: { handle: 21 } } }],
      1,
    );
    // kart-kart hit: each kart qualifies -> one trigger per kart (the single
    // reused CollisionVoice retriggers, so only the last envelope sounds).
    d.flush(makePhysics(800, 20, 21) as never, 1.0, GS, RP);
    expect(audio.triggerImpact).toHaveBeenCalledTimes(2);
  });

  it("flush with no events (empty drain) does not call triggerImpact", () => {
    const audio = makeAudio();
    const d = new GameAudioDriver(audio as never);
    d.setSources([{ kart: { controller: { collider: { handle: 10 } } } }], [], 1);
    const emptyPhysics = { drainContactForceEvents: (_cb: (e: FakeEvent) => void) => {} };
    d.flush(emptyPhysics as never, 1.0, GS, RP);
    expect(audio.triggerImpact).not.toHaveBeenCalled();
  });

  it("onRespawn delegates to AudioManager.onRespawn", () => {
    const audio = makeAudio();
    const d = new GameAudioDriver(audio as never);
    d.onRespawn();
    d.onRespawn();
    expect(audio.onRespawn).toHaveBeenCalledTimes(2);
  });
});

describe("GameAudioDriver — music phase gating (009)", () => {
  it("fires setMusicPhase only on a phase transition", () => {
    const audio = makeAudio();
    const d = new GameAudioDriver(audio as never);
    const emptyPhysics = { drainContactForceEvents: (_cb: (e: FakeEvent) => void) => {} };
    // menu -> racing -> racing (no-op) -> finished
    d.flush(emptyPhysics as never, 1.0, "menu", "grid");
    d.flush(emptyPhysics as never, 2.0, "racing", "racing");
    d.flush(emptyPhysics as never, 3.0, "racing", "racing"); // same -> no call
    d.flush(emptyPhysics as never, 4.0, "racing", "finished");
    expect(audio.setMusicPhase).toHaveBeenCalledTimes(3);
    expect(audio.setMusicPhase).toHaveBeenNthCalledWith(1, "menu");
    expect(audio.setMusicPhase).toHaveBeenNthCalledWith(2, "racing");
    expect(audio.setMusicPhase).toHaveBeenNthCalledWith(3, "finished");
  });
});

describe("GameAudioDriver — weather (054 commit 4)", () => {
  it("rain preset drives setRainLevel with the live level", () => {
    const audio = makeAudio();
    const d = new GameAudioDriver(audio as never);
    d.updateWeather({ preset: "rain", level: 0.7, elapsed: 1, seed: 0 });
    expect(audio.setRainLevel).toHaveBeenCalledWith(0.7);
    expect(audio.thunder).not.toHaveBeenCalled();
  });

  it("clear/snow presets drive setRainLevel(0) and fire no thunder", () => {
    const audio = makeAudio();
    const d = new GameAudioDriver(audio as never);
    d.updateWeather({ preset: "clear", level: 0, elapsed: 0, seed: 0 });
    d.updateWeather({ preset: "snow", level: 1, elapsed: 5, seed: 0 });
    expect(audio.setRainLevel).toHaveBeenLastCalledWith(0);
    expect(audio.thunder).not.toHaveBeenCalled();
  });

  it("storm drives setRainLevel(level) and fires thunder for future flashes", () => {
    const audio = makeAudio();
    const d = new GameAudioDriver(audio as never);
    const seed = 0;
    const flashes = makeLightningSchedule(seed).flashes;
    const f0 = flashes[0]!;
    const f1 = flashes[1]!;

    // First storm call: builds the schedule; elapsed before f0 -> no thunder.
    d.updateWeather({ preset: "storm", level: 1, elapsed: f0.atSec - 1, seed });
    expect(audio.setRainLevel).toHaveBeenCalledWith(1);
    expect(audio.thunder).not.toHaveBeenCalled();

    // Advance past f0 -> thunder for f0 only.
    d.updateWeather({ preset: "storm", level: 1, elapsed: f0.atSec + 0.01, seed });
    expect(audio.thunder).toHaveBeenCalledTimes(1);
    expect(audio.thunder).toHaveBeenCalledWith(f0.strength, f0.thunderDelaySec);

    // Advance past f1 -> thunder for f1 (total 2).
    d.updateWeather({ preset: "storm", level: 1, elapsed: f1.atSec + 0.01, seed });
    expect(audio.thunder).toHaveBeenCalledTimes(2);
    expect(audio.thunder).toHaveBeenLastCalledWith(f1.strength, f1.thunderDelaySec);
  });

  it("storm join mid-front skips already-passed flashes (no thunder flurry)", () => {
    const audio = makeAudio();
    const d = new GameAudioDriver(audio as never);
    const seed = 3;
    const flashes = makeLightningSchedule(seed).flashes;
    const f0 = flashes[0]!;
    // First storm call already past f0 -> f0 skipped, no thunder yet.
    d.updateWeather({ preset: "storm", level: 1, elapsed: f0.atSec + 0.5, seed });
    expect(audio.thunder).not.toHaveBeenCalled();
    // Next future flash fires.
    const f1 = flashes[1]!;
    d.updateWeather({ preset: "storm", level: 1, elapsed: f1.atSec + 0.01, seed });
    expect(audio.thunder).toHaveBeenCalledTimes(1);
    expect(audio.thunder).toHaveBeenCalledWith(f1.strength, f1.thunderDelaySec);
  });

  it("leaving storm resets the tracker (no further thunder)", () => {
    const audio = makeAudio();
    const d = new GameAudioDriver(audio as never);
    const seed = 0;
    const f0 = makeLightningSchedule(seed).flashes[0]!;
    d.updateWeather({ preset: "storm", level: 1, elapsed: f0.atSec - 1, seed });
    d.updateWeather({ preset: "storm", level: 1, elapsed: f0.atSec + 0.01, seed });
    expect(audio.thunder).toHaveBeenCalledTimes(1);
    // Handover to rain: tracker resets, setRainLevel follows rain.
    d.updateWeather({ preset: "rain", level: 0.9, elapsed: f0.atSec + 100, seed });
    expect(audio.setRainLevel).toHaveBeenLastCalledWith(0.9);
    // Re-entering storm rebuilds the schedule; elapsed well past old f0 is
    // skipped again, so no thunder fires on the rebuild call.
    d.updateWeather({ preset: "storm", level: 1, elapsed: f0.atSec + 100, seed });
    expect(audio.thunder).toHaveBeenCalledTimes(1);
  });
});
