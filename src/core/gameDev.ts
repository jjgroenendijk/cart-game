/**
 * Dev/agent-tooling glue split out of Game to keep the orchestrator under the
 * file cap: the whole-game debug snapshot and the URL-flag runtime overrides
 * (free-fly cam, forced quality, autostart). Operates on the live Game via a
 * type-only import (no runtime cycle). See docs/knowledge/dev/index.md and
 * docs/knowledge/core/{debug-snapshot,dev-flags}.md.
 */

import { buildDebugSnapshot, perfFromFrameStats, type DebugSnapshot } from "./debugSnapshot";
import { dayCycleState } from "../environment/dayCycle";
import { FreeFlyCamera } from "../kart/FreeFlyCamera";
import type { DevFlags } from "./devFlags";
import type { Game } from "./Game";

/**
 * window.__game.debugSnapshot(): plain, JSON-serializable dump of the whole
 * live game state. The copy-heavy work lives in the pure buildDebugSnapshot
 * assembler; here we only read the live subsystems + adapt FrameStats.
 */
export function gameDebugSnapshot(g: Game): DebugSnapshot {
  return buildDebugSnapshot({
    state: g.currentState,
    time: g.time,
    seed: g.current.seed,
    biome: g.currentBiome,
    weather: g.env.weatherInfo,
    day: dayCycleState,
    quality: g.qualityTier,
    perf: perfFromFrameStats(g.renderer.getFrameStats(), g.perfEwma.smoothed),
    karts: [...g.views.map((v) => v.kart), ...g.rivals],
    race: g.race.snapshot(),
  });
}

/**
 * Apply the dev overrides that run after the flow + field exist: free-fly cam
 * (self-toggles on KeyC), forced quality, then an optional autostart straight
 * into a race. Reuses g.builtPicks for the kart when ?kart was set.
 */
export function applyDevRuntime(g: Game, dev: DevFlags): void {
  if (dev.freefly) g.freeFly = new FreeFlyCamera(g.renderer.domElement);
  if (dev.quality) g.setQuality(dev.quality);
  if (dev.autostart) g.flow.autostart(dev.kart ? { picks: g.builtPicks } : {});
}

/**
 * Per-frame render dispatch. The dev free-fly cam takes over when active
 * (hence this lives with the dev glue); otherwise split-screen views drive the
 * race/pause states and the orbiting menu camera drives the rest.
 */
export function renderGameFrame(
  g: Game,
  dt: number,
  racing: boolean,
  paused: boolean,
  midX: number,
  midZ: number,
): void {
  g.freeFly?.update(dt);
  if (g.freeFly?.active) {
    g.renderer.render(g.freeFly.camera);
    return;
  }
  if (racing || paused) {
    if (racing) {
      for (const v of g.views) v.updateCamera(dt);
      g.renderer.setShadowTarget(midX, midZ);
    }
    g.renderer.renderViews(g.viewDescriptors());
  } else {
    g.menuCamera.update(dt);
    g.renderer.render(g.menuCamera.camera);
  }
}
