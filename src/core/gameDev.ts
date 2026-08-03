/**
 * Dev/agent-tooling glue split out of Game to keep the orchestrator under the
 * file cap: the whole-game debug snapshot and the URL-flag runtime overrides
 * (free-fly cam, forced quality, autostart). Operates on the live Game via a
 * type-only import (no runtime cycle). See docs/knowledge/dev/index.md and
 * docs/knowledge/core/{debug-snapshot,dev-flags}.md.
 */

import { buildDebugSnapshot, perfFromFrameStats, type DebugSnapshot } from "./debugSnapshot";
import { dayCycleState } from "../environment/dayCycle";
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
    karts: [g.view.kart, ...g.rivals],
    race: g.race.snapshot(),
  });
}

/**
 * Apply the dev overrides that run after the flow + field exist: free-fly cam
 * (forced on via the same prod applyCameraMode path, self-toggles on KeyC),
 * forced quality, then an optional autostart straight into a race. Reuses
 * g.builtPicks for the kart when ?kart was set.
 */
export function applyDevRuntime(g: Game, dev: DevFlags): void {
  if (dev.freefly) g.applyCameraMode("freefly");
  if (dev.quality) g.setQuality(dev.quality);
  if (dev.autostart) g.flow.autostart(dev.kart ? { picks: g.builtPicks } : {});
}

/**
 * Per-frame render dispatch. The dev free-fly cam takes over when active
 * (hence this lives with the dev glue); otherwise the single view drives the
 * race/pause states and the orbiting menu camera drives the rest.
 */
export function renderGameFrame(
  g: Game,
  dt: number,
  racing: boolean,
  paused: boolean,
  focusX: number,
  focusZ: number,
): void {
  g.freeFly?.update(dt);
  if (g.freeFly?.active) {
    g.renderer.render(g.freeFly.camera);
    return;
  }
  // 224: the shadow box follows the rendered view's focus in every state (menu
  // focus for menu/select/countdown, human midpoint for racing/paused), else
  // its projection edge shows as a hard shadow cutoff on camera-facing terrain.
  g.renderer.setShadowTarget(focusX, focusZ);
  if (racing || paused) {
    if (racing) {
      g.view.updateCamera(dt);
    }
    g.renderer.renderView({ camera: g.view.chaseCam.camera, rect: g.view.rect });
  } else {
    g.menuCamera.update(dt);
    g.renderer.render(g.menuCamera.camera);
  }
}
