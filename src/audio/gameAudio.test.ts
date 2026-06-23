import { describe, expect, it, vi } from "vitest";
import { GameAudioDriver } from "./gameAudio";

/** Minimal structural AudioManager stand-in: just the methods the driver calls. */
function makeAudio() {
  return {
    triggerImpact: vi.fn(),
    onRespawn: vi.fn(),
    setMusicPhase: vi.fn(),
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
