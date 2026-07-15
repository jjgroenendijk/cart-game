/**
 * Dev-flag application helpers for Game boot. Split out of Game to keep it
 * under the file-size cap. Pure translations from DevFlags onto the world's
 * seed/biome CircuitId and the flow's persisted weather/time config. The Game
 * constructor calls these at the matching build phases. See
 * docs/knowledge/core/dev-flags.md.
 */

import { biomeIndexOf } from "../environment/biomes/registry";
import type { CircuitId } from "../terrain/circuitCode";
import type { DevFlags } from "./devFlags";
import type { GameFlow } from "./GameFlow";

/** Apply seed/biome dev overrides onto a CircuitId (unspecified fields kept). */
export function devCircuitId(dev: DevFlags, current: CircuitId): CircuitId {
  return {
    seed: dev.seed !== undefined ? dev.seed >>> 0 : current.seed,
    biome: dev.biome !== undefined ? biomeIndexOf(dev.biome) : current.biome,
  };
}

/**
 * Override the flow's persisted weather/time from dev flags (in place, before
 * the boot apply). A forced time pins a STATIC phase so the frame is
 * deterministic for screenshots; day length is preserved.
 */
export function applyDevFlowConfig(dev: DevFlags, flow: GameFlow): void {
  if (dev.weather) flow.weatherMode = dev.weather;
  if (dev.time) {
    flow.timeOfDayConfig = {
      mode: "static",
      phase: dev.time,
      dayLengthSeconds: flow.timeOfDayConfig.dayLengthSeconds,
    };
  }
}
