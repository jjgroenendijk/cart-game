# 018 Water buoyancy and life bar

Status: implemented (pending-review)

## Context

Split from 010 (was "water buoyancy", `004:42,185`). Water is visual-only
today (`Water.ts:16-22`): the kart drives through valleys under the
surface. This item makes water a forgiving arcade hazard: float + drag +
a blue life bar that drains while submerged; at empty the kart respawns
spline-ahead (its last progress point) and the bar resets. Buoyancy is
physics + gameplay state, so it is its own item separate from 010's
atmosphere.

Real constraints, resolved against the current code (post-012 refactor):

- Ownership: kart construction + the fixed step + PlayerView
  construction all live in FieldBuilder (012), NOT Game. `Game.ts` is
  450/600 (headroom ~150); `KartController` 322/600, `FieldBuilder`
  394/600, `PlayerView` 115/600 — all clear of the cap. No file at risk.
- Phase gating is free: `FieldBuilder.stepWorld(step, driving, inputs,
time, state)` (`FieldBuilder.ts:194-260`) already receives `driving`
  (= racing && race.phase==="racing") and `state: GameState`. Life-drain
  gating = pass `drainLife = driving` into `kart.fixedUpdate`. NO
  onCountdownDone flag, NO Game gating edit.
- waterLevel source: FieldBuilder already holds `terrain`
  (`FieldBuilder.ts:83`); read `this.terrain.waterLevel`
  (`Terrain.ts:97-100`, = cfg.sandLevel = -3). Environment/Water already
  use the same level (`Game.ts:66-69`). No Game threading.
- Ctor chain: `FieldBuilder.build -> new Kart(physics, pos, yaw, i)`
  (`FieldBuilder.ts:125`) -> `new KartController(physics, spawn, yaw,
tuning)` (`Kart.ts:46`). KartController ctor is positional; there is NO
  opts object. Add an optional trailing `waterLevel` param (default =
  disabled) so buoyancy is inert unless configured -> backward compatible,
  existing tests/callers unaffected.
- Force application is impulse-only (Rapier): suspension uses
  applyImpulseAtPoint up at the chassis (`KartController.ts:183-187`);
  engine/grip/brake use applyImpulse (`:213,221,226,236`); upright uses
  applyTorqueImpulse (`:253`). Buoyancy mirrors suspension: an upward
  impulse proportional to submerged depth + horizontal XZ linvel drag
  (damped via setLinvel, like the `zeroHorizontalLinvel` precedent
  `FieldBuilder.ts:374`).
- Mass is `DEFAULT_TUNING.mass` = 260 (`KartController.ts:29`) — needed to
  size the buoyant force.
- Fixed step is `STEP = 1/60` (`Game.ts:24`); buoyancy uses `STEP`, not
  variable `dt` (AGENTS rule: no variable-dt physics).
- Countdown settle: during countdown XZ linvel is zeroed
  (`FieldBuilder.ts:252-256`) but Y drops, so a kart may touch water. The
  buoyancy FORCE applies whenever submerged (physically correct,
  harmless); life DRAIN is gated by `drainLife = driving` (false in
  countdown) so the bar never empties during settle.
- Fail-out: NO checkpoint pose exists — `checkpoints.ts` is parametric lap
  validity only. Reuse `FieldBuilder.respawnAhead(kart)`
  (`FieldBuilder.ts:357-372`): teleports to the nearest spline point +
  `RESPAWN_AHEAD_T`, i.e. the kart's last progress point. Same helper
  rivals + AI-stuck already use. Applies to humans AND rivals, followed by
  `KartController.resetLife()`. `KartController.respawn()` (spawn-only,
  `:270-279`) is NOT used for water fail-out.
- Rivals have no HUD: same buoyancy + auto-respawn-ahead on empty, no bar.
- Tests run under jsdom with no Rapier/WebGL: export pure buoyancy + life
  helpers and assert directly (mirrors `impactTier`, `posterizeChannel`).
  Rapier-needed tests use `beforeAll(await RAPIER.init())` + a
  `PhysicsWorld` stub (`KartController.test.ts:7-11` pattern).

## Goal

Water becomes a forgiving hazard:

- Buoyancy: while the kart chassis is below `waterLevel`, apply an upward
  impulse (float) proportional to submerged depth + horizontal drag (slow
  paddle-out).
- Life bar: a blue HUD bar per human, visible in water; drains while
  submerged, recovers when out. At empty -> respawn spline-ahead + reset.
- Applies to all karts; humans show the bar, rivals auto-respawn on empty.

## Non-goals

- Fluid simulation (simplified forces, not SPH).
- Waves affecting buoyancy (use the static `waterLevel`, ignore wave uTime).
- A hard game-over/elimination state (respawn + reset only).
- Per-kart headlights or visual water splash (018 is feel + HUD).
- Storm/current gameplay effects.

## Architecture (new)

```text
src/kart/
  buoyancy.ts        # PURE buoyancyForce(depth, mass, opts)->{up,drag} +
                     #   lifeDelta(submerged, dt, opts)->dLife. Clamped
                     #   depth, float strength, drag factor, drain/recover
                     #   rates. DEFAULT_BUOYANCY constants. Exported for
                     #   jsdom unit tests (no Rapier).
  KartController.ts  # ADD optional ctor param waterLevel (default =
                     #   disabled). fixedUpdate(dt, input, drainLife=false):
                     #   after updateSuspension (:134) call applyBuoyancy
                     #   (always, if waterLevel set + submerged) -> upward
                     #   impulse + XZ drag; track inWater + life (drain when
                     #   drainLife + submerged, recover when out). Expose
                     #   get life()/inWater(); resetLife() sets life=1. NO
                     #   self-respawn (FieldBuilder owns fail-out).
  Kart.ts            # ADD optional waterLevel param, forward to the
                     #   KartController ctor.
src/ui/
  LifeBar.ts         # DOM blue bar (RaceHud pattern: plain elements +
                     #   cssText, appended to container, remove() teardown).
                     #   update(life, inWater) -> width + visibility.
src/core/
  FieldBuilder.ts    # build: pass this.terrain.waterLevel into new
                     #   Kart(...); construct a LifeBar per human, hand it to
                     #   PlayerView. stepWorld: kart.fixedUpdate(step, inp,
                     #   driving) for humans + rivals; after each, if
                     #   controller.life<=0 -> respawnAhead(kart) +
                     #   controller.resetLife(). dispose: LifeBar remove.
  PlayerView.ts      # ADD lifeBar + setLife(life, inWater) (mirrors
                     #   setSpeed); removeHud() also removes lifeBar.
  Game.ts            # frame racing block: v.setLife(v.kart.controller.life,
                     #   v.kart.controller.inWater) near updateSpeedHuds;
                     #   onResize repositions lifeBar like speedEl
                     #   (Game.ts:354-361). ~6-10 Game lines total.
```

## Contracts with 001-015/017

- 001: none (no material change).
- 002: none.
- 003: consumes `Terrain.waterLevel` getter (`Terrain.ts:97-100`).
- 004: consumes the `Water` plane level only (no Water class change).
  Buoyancy ignores wave uTime (static level).
- 005: none (no water audio in v1; a rain bed is 010's soft tie).
- 006: phase gating via the `state` param of `FieldBuilder.stepWorld`
  (drainLife = driving); no `gameState.ts` change, no onCountdownDone hook.
- 007: rivals auto-respawn-ahead on empty (no AI change; `respawnAhead`
  precedent + AI-stuck reset reuse).
- 008: 1P/2P each get a LifeBar bound to its `PlayerView` (parity with the
  speed HUD). Split-screen viewports unchanged.
- 010/011/014/015/017: independent (011 perf budget cross-ref only).

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(kart): pure buoyancy + life-delta helpers`
   - `buoyancy.ts`: `buoyancyForce` (clamped depth -> up impulse + drag) +
     `lifeDelta` (drain submerged, recover out); `DEFAULT_BUOYANCY`.
   - tests: force grows with depth + clamps; drag factor sane; drain/
     recover monotonic; life clamps to [0,1].
2. `feat(kart): apply buoyancy + gated life drain in fixedUpdate`
   - KartController + Kart: optional `waterLevel` param (disabled
     default); `applyBuoyancy` after suspension; inWater/life tracking;
     `resetLife`; `fixedUpdate(dt, input, drainLife=false)`.
   - tests (RAPIER.init + PhysicsWorld stub): below waterLevel -> body
     pushed up + XZ damped; life drains only when drainLife, recovers
     out; empty -> life clamps 0 (NO self-respawn); disabled waterLevel
     -> no-op (backward compat); mass 260 sizing sane.
3. `feat(ui): blue life bar bound per view`
   - `LifeBar.ts`; `update(life, inWater)` -> width + visibility; remove().
   - tests: hidden when out of water; width tracks life; visible in water;
     remove() detaches DOM.
4. `feat(core): wire buoyancy + life into FieldBuilder/PlayerView/Game`
   - FieldBuilder: `waterLevel` into Kart; LifeBar per human into
     PlayerView; `fixedUpdate(..., driving)`; life<=0 -> respawnAhead +
     resetLife for humans + rivals; dispose removes LifeBar.
   - PlayerView: `lifeBar` + `setLife` + `removeHud`.
   - Game: `setLife` in the racing frame block; onResize reposition lifeBar.
   - tests: drain off until driving; on in 1P + 2P; respawn-ahead fires on
     empty; Game.test mocks updated (no render regression).
5. `docs: refine 018 plan + todo + README + troubleshooting`
   - mark 018 full plan in `docs/todo.md`; README project structure adds
     new files; troubleshooting verify case.

## Risks

- Arcade feel: too-strong buoyancy = jarring bounce; too-weak = kart
  sinks. Default forgiving (float high + strong drag); tune in review.
  Drain slow enough that a quick splash never empties the bar.
- Countdown drain: solved by `drainLife = driving` (false in countdown);
  test the off->on transition implicitly via `FieldBuilder.stepWorld`.
- Rival stuck loop: `respawnAhead` places the kart on-track (above water)
  so immediate re-entry is unlikely; add a respawn cooldown in review
  only if observed.
- Drain rate vs race length: a long race + a lake must not auto-fail a
  careful driver. Default drain slow; recover out of water.
- Fixed-step only: buoyancy uses `STEP` (1/60), never variable dt.
- Strict TS noUnusedLocals: all pure-fn params used; `_`-prefix unused.

## Acceptance

- [ ] `buoyancy.ts` present; `buoyancyForce`/`lifeDelta` pure + tested
- [ ] Kart floats + is XZ-damped below waterLevel; disabled waterLevel =
      no-op
- [ ] Blue life bar per human: shows in water, drains submerged, recovers
      out
- [ ] Empty bar -> respawnAhead (spline-ahead) + life reset (human + rival)
- [ ] No drain during countdown; drain on while racing (1P + 2P)
- [ ] `Game.ts` / `FieldBuilder.ts` / `KartController.ts` / `PlayerView.ts`
      all <= 600 lines
- [ ] `npm run typecheck && lint && test` green; pre-commit hook green
- [ ] No black screen at `npm run dev`; visual verify logged in
      `docs/troubleshooting/`

## Defaults

- float: upward impulse grows linearly with submerged depth, clamped at a
  max; strong enough to hold mass 260 near the surface
- drag: horizontal XZ linvel damped while submerged (paddle-out feels
  slow, not stuck)
- life: 0..1, drain ~slow (full bar ~6-8s submerged), recover faster out
  of water; empty -> respawnAhead + resetLife to 1
- waterLevel: from `Terrain.waterLevel` (-3); wave uTime ignored
- rivals: same buoyancy, auto-respawnAhead on empty, no bar

## Previous implementation

None. Closest patterns: suspension `applyImpulseAtPoint`
(`KartController.ts:183-187`), impulse-only forces (`:213,221,226,236,253`),
`respawnAhead` (`FieldBuilder.ts:357-372`), mass 260 (`:29`), PlayerView
`setSpeed` per-human binding (`PlayerView.ts:107`), RaceHud DOM pattern
(`src/ui/RaceHud.ts`), pure force helper for tests (`impactTier` in 009),
RAPIER.init test stub (`KartController.test.ts:7-11`).

## Depends on

000 (harness; test gate live). 003 (`Terrain.waterLevel`). 004 (water
plane level source). 006 (phase via the `state` param of
`FieldBuilder.stepWorld`; no `gameState.ts` change). 008 (per-human
`PlayerView` for 1P/2P life bars). Independent of 010/017. 011 (perf
budget) cross-ref.
