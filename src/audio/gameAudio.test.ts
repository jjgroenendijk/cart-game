import { describe, expect, it, vi } from "vitest";
import { GameAudioDriver } from "./gameAudio";

/** Minimal structural AudioManager stand-in: just the methods the driver calls. */
function makeAudio() {
  return {
    triggerImpact: vi.fn(),
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
  it("flush fires triggerImpact for a qualifying mapped kart hit", () => {
    const audio = makeAudio();
    const d = new GameAudioDriver(audio as never);
    d.setSources([{ kart: { controller: { collider: { handle: 10 } } } }], [], 1);
    d.flush(makePhysics(5000) as never, 1.0);
    expect(audio.triggerImpact).toHaveBeenCalledTimes(1);
    expect(audio.triggerImpact).toHaveBeenCalledWith(5000);
  });

  it("flush is a no-op when no kart handle is mapped (prop-prop)", () => {
    const audio = makeAudio();
    const d = new GameAudioDriver(audio as never);
    d.setSources([{ kart: { controller: { collider: { handle: 10 } } } }], [], 1);
    d.flush(makePhysics(5000, 700, 701) as never, 1.0); // neither handle mapped
    expect(audio.triggerImpact).not.toHaveBeenCalled();
  });

  it("flush skips sub-threshold forces", () => {
    const audio = makeAudio();
    const d = new GameAudioDriver(audio as never);
    d.setSources([{ kart: { controller: { collider: { handle: 10 } } } }], [], 1);
    d.flush(makePhysics(50) as never, 1.0); // below default 300 threshold
    expect(audio.triggerImpact).not.toHaveBeenCalled();
  });

  it("cooldown suppresses a second hit within 80ms, fires again after", () => {
    const audio = makeAudio();
    const d = new GameAudioDriver(audio as never);
    d.setSources([{ kart: { controller: { collider: { handle: 10 } } } }], [], 1);
    d.flush(makePhysics(1000) as never, 1.0);
    d.flush(makePhysics(2000) as never, 1.04); // 40ms < 80ms -> suppressed
    d.flush(makePhysics(3000) as never, 1.09); // 90ms >= 80ms -> fires
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
    d.flush(makePhysics(800, 20, 21) as never, 1.0);
    expect(audio.triggerImpact).toHaveBeenCalledTimes(2);
  });

  it("flush with no events (empty drain) does not call triggerImpact", () => {
    const audio = makeAudio();
    const d = new GameAudioDriver(audio as never);
    d.setSources([{ kart: { controller: { collider: { handle: 10 } } } }], [], 1);
    const emptyPhysics = { drainContactForceEvents: (_cb: (e: FakeEvent) => void) => {} };
    d.flush(emptyPhysics as never, 1.0);
    expect(audio.triggerImpact).not.toHaveBeenCalled();
  });
});
