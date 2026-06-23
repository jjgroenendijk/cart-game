/**
 * 009 impact driver. Owns the colliderHandle->kartIndex map, per-kart
 * cooldown, and the drained-event buffer, keeping Game.ts under its line cap.
 * Game registers the kart field each rebuild then calls flush() per sub-step.
 *
 * Pure-ish: holds plain data + calls AudioManager methods. The only external
 * binding is a type-only PhysicsWorld reference so flush() can drain Rapier
 * right after world.step() (the EventQueue is autoDrain; events must be read
 * each sub-step or they are lost). Game stays the Rapier owner in spirit.
 */

import type { AudioManager } from "./AudioManager";
import { routeImpacts, type RawImpact } from "./impactRouting";
import type { PhysicsWorld } from "../physics/PhysicsWorld";

/** Structural: a human view whose kart exposes a collider handle. */
interface ViewHandleSource {
  kart: HandleSource;
}

/** Structural: anything whose controller collider exposes a Rapier handle. */
interface HandleSource {
  controller: { collider: { handle: number } };
}

/** Structural view of a Rapier contact-force event (decouples from the type). */
interface ContactForceEvent {
  collider1(): number;
  collider2(): number;
  totalForceMagnitude(): number;
}

export class GameAudioDriver {
  private readonly map = new Map<number, number>();
  private lastAt: number[] = [];
  private readonly impacts: RawImpact[] = [];

  constructor(private readonly audio: AudioManager) {}

  /** Register every kart collider handle + reset per-kart cooldowns. */
  setSources(
    views: readonly ViewHandleSource[],
    rivals: readonly HandleSource[],
    humanCount: number,
  ): void {
    this.map.clear();
    views.forEach((v, i) => this.map.set(v.kart.controller.collider.handle, i));
    rivals.forEach((r, i) => this.map.set(r.controller.collider.handle, humanCount + i));
    this.lastAt = new Array(views.length + rivals.length).fill(0);
  }

  /** Drain this sub-step's contact-force events + fire the impact SFX. */
  flush(physics: PhysicsWorld, now: number): void {
    physics.drainContactForceEvents((e: ContactForceEvent) =>
      this.impacts.push({
        collider1: e.collider1(),
        collider2: e.collider2(),
        force: e.totalForceMagnitude(),
      }),
    );
    if (!this.impacts.length) return;
    const r = routeImpacts(this.impacts, this.map, this.lastAt, now);
    this.lastAt = r.lastImpactAt;
    for (const h of r.hits) this.audio.triggerImpact(h.force);
    this.impacts.length = 0;
  }
}
