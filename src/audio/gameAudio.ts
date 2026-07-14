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
import { musicPhaseFor, type MusicPhase } from "./musicEngine";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { makeLightningSchedule, type LightningFlash } from "../environment/lightning";
import type { WeatherPreset } from "../environment/weatherPresets";

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
  private lastMusic: MusicPhase | null = null;
  // Weather (054 commit 4): rain bed level + storm thunder advancement.
  private stormFlashes: LightningFlash[] | null = null;
  private nextFlashIdx = 0;

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

  /**
   * Drain this sub-step's contact-force events + fire the impact SFX, and
   * observe the game/race state to drive music phase transitions. Runs each
   * sub-step (the EventQueue is autoDrain); the music phase is derived every
   * call but setMusicPhase fires only on a transition.
   */
  flush(physics: PhysicsWorld, now: number, gameState: string, racePhase: string): void {
    physics.drainContactForceEvents((e: ContactForceEvent) =>
      this.impacts.push({
        collider1: e.collider1(),
        collider2: e.collider2(),
        force: e.totalForceMagnitude(),
      }),
    );
    if (this.impacts.length) {
      const r = routeImpacts(this.impacts, this.map, this.lastAt, now);
      this.lastAt = r.lastImpactAt;
      for (const h of r.hits) this.audio.triggerImpact(h.force);
      this.impacts.length = 0;
    }
    const phase = musicPhaseFor(gameState, racePhase);
    if (phase !== this.lastMusic) {
      this.lastMusic = phase;
      this.audio.setMusicPhase(phase);
    }
  }

  /** Fire the respawn cue (009). Delegates to AudioManager (thin funnel). */
  onRespawn(): void {
    this.audio.onRespawn();
  }

  /**
   * Drive the rain bed + weather-wind bed + storm thunder from the
   * Environment weather snapshot (054 commit 4). Rain bed on for
   * rain/warmRain/storm at the live level (warmRain is a rain variant — same
   * bed, no separate asset); weather-wind bed on for sandstorm/blizzard/storm
   * (gale-force presets) at the live level; both off otherwise. Thunder fires
   * once per FUTURE flash once its atSec passes the elapsed time (past
   * flashes are skipped on storm start so a mid-storm join does not dump a
   * thunder flurry). Non-storm resets the tracker.
   */
  updateWeather(info: {
    preset: WeatherPreset;
    level: number;
    elapsed: number;
    seed: number;
  }): void {
    const raining = info.preset === "rain" || info.preset === "warmRain" || info.preset === "storm";
    this.audio.setRainLevel(raining ? info.level : 0);
    const windy =
      info.preset === "sandstorm" || info.preset === "blizzard" || info.preset === "storm";
    this.audio.setWeatherWindLevel(windy ? info.level : 0);
    if (info.preset !== "storm") {
      this.stormFlashes = null;
      this.nextFlashIdx = 0;
      return;
    }
    if (this.stormFlashes === null) {
      this.stormFlashes = makeLightningSchedule(info.seed).flashes;
      let i = 0;
      while (i < this.stormFlashes.length && this.stormFlashes[i]!.atSec <= info.elapsed) i++;
      this.nextFlashIdx = i;
      return;
    }
    const flashes = this.stormFlashes;
    while (
      this.nextFlashIdx < flashes.length &&
      flashes[this.nextFlashIdx]!.atSec <= info.elapsed
    ) {
      const f = flashes[this.nextFlashIdx]!;
      this.audio.thunder(f.strength, f.thunderDelaySec);
      this.nextFlashIdx++;
    }
  }
}
