# 018 Water buoyancy and life bar

Status: open (refined plan)

## Context

Split from 010 (was "water buoyancy", `004:42,185`). Water is visual-only
today (`Water.ts:16-22`): the kart drives through valleys under the surface.
This item makes water a hazard with a forgiving arcade feel: float + drag,
plus a blue life bar that drains while submerged; at empty the kart respawns
at the last checkpoint and the bar resets. Buoyancy is physics + a gameplay
state, so it is its own item separate from 010's atmosphere.

Real constraints, resolved against the code:

- `Game.ts` is 600/600 lines. This item adds ZERO Game lines: buoyancy runs
  inside `KartController.fixedUpdate` (322/600, headroom) which Game already
  calls per fixed step (`Game.ts:310,347`); the life bar reads `kart.life` in
  the existing per-frame `PlayerView.sync` (`Game.ts:276-277`).
- `waterLevel` source: `Terrain.waterLevel` getter = `cfg.sandLevel` (-3,
  `Terrain.ts:97-100`), already wired into the `Water` mesh via Environment
  (`Game.ts:90-92`). Pass it into `KartController` via existing constructor
  opts (modify the opts shape, not a new Game line).
- Force application is impulse-only (Rapier): suspension uses
  `applyImpulseAtPoint` up at the chassis (`KartController.ts:181-187`),
  engine/grip/brake use `applyImpulse` (`:213,221,226,236`), upright uses
  `applyTorqueImpulse` (`:253`). Buoyancy mirrors suspension: an upward
  impulse proportional to submerged depth + a horizontal linvel drag.
- Mass is `DEFAULT_TUNING.mass` = 260 (`KartController.ts:29`) — needed to
  size the buoyant force.
- Fixed step is `STEP = 1/60` (`Game.ts:31`); buoyancy uses `STEP`, not
  variable `dt` (AGENTS rule: no variable-dt physics).
- Fail-out reuses `KartController.respawn()` (`:268-277`, void, no args). Life
  resets on respawn. Respawn must also fire for rivals (`Game.respawnAhead`,
  `Game.ts:424-438`) — but rivals have no HUD; v1 applies buoyancy to all
  karts and auto-respawns rivals on empty (no bar for rivals).
- Countdown gating: during countdown the kart settles and may touch water
  (`Game.ts:262-272` fixed-step settle). Life drain MUST be gated to racing
  state only, else the countdown drop empties the bar. `fixedUpdate` does not
  know the phase; gate via an `active`/`drain` flag Game sets per phase (set
  on `onCountdownDone`, `Game.ts:460`) — one existing-line modification, not
  an add.
- Tests run under jsdom with no Rapier/WebGL: export the pure buoyancy force
  helper and assert it directly (mirrors `posterizeChannel`, `impactTier`).
  Rapier-needed tests use `await RAPIER.init()` + a stub (PropField pattern).

## Goal

Water becomes a forgiving hazard:

- Buoyancy: while the kart is below `waterLevel`, apply an upward impulse
  (float) proportional to submerged depth + horizontal drag (slow paddle-out).
- Life bar: a blue HUD bar appears while in water; drains while submerged,
  recovers slowly when out. At empty -> respawn at last checkpoint + reset.
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
                     #   lifeDelta(submerged, dt, opts)->dLife. Clamped depth,
                     #   float strength, drag factor, drain/recover rates.
                     #   Exported for jsdom unit tests (no Rapier).
  KartController.ts  # ADD opts.waterLevel + buoyancy tuning. fixedUpdate
                     #   (after updateSuspension, :123-151): if kart below
                     #   waterLevel -> applyBuoyancy(STEP): upward impulse via
                     #   buoyancyForce + linvel drag; track inWater; advance
                     #   life (drain when active+submerged, recover when out);
                     #   life<=0 -> this.respawn() + reset life=1. Expose
                     #   get life()/inWater(). respawn() already resets (:268).
src/ui/
  LifeBar.ts         # DOM blue bar (HUD pattern). bind(kart); update reads
                     #   kart.life + inWater -> width + visibility. remove()
                     #   for teardown (ui/ owns its nodes).
src/core/
  Game.ts            # MODIFY only (no new lines): pass waterLevel into
                     #   KartController opts; set the buoyancy `drain` flag on
                     #   onCountdownDone (:460). PlayerView binds LifeBar.
src/kart/
  Kart.ts or
  PlayerView         # PlayerView.sync (:276) reads kart.life -> LifeBar
                     #   update. 1P + 2P each get a bar (008 PlayerView parity).
```

## Contracts with 001-009

- 001: none (no material change).
- 002: none.
- 003: consumes `Terrain.waterLevel` getter (`Terrain.ts:97-100`).
- 004: consumes the `Water` plane level only (no Water class change). Buoyancy
  ignores wave uTime (static level).
- 005: none (no water audio in v1; a rain bed is 010's soft tie).
- 006: countdown gating via `onCountdownDone` (`Game.ts:460`); no
  `gameState.ts` change.
- 007: rivals auto-respawn on empty (no AI change; `respawnAhead` precedent).
- 008: 1P/2P each get a LifeBar bound to its `PlayerView` (parity with the
  speed HUD). Split-screen viewports unchanged.

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(kart): pure buoyancy + life-delta helpers`
   - `buoyancy.ts`: `buoyancyForce` (clamped depth -> up impulse + drag) +
     `lifeDelta` (drain submerged, recover out).
   - tests: force grows with depth + clamps; drag opposes linvel; drain/recover
     rates monotonic; life clamps to [0,1].
2. `feat(kart): apply buoyancy + life drain in fixedUpdate`
   - `KartController`: opts.waterLevel + tuning; `applyBuoyancy(step)` after
     suspension; inWater + life tracking; life<=0 -> respawn + reset.
   - tests (RAPIER.init + stub): below waterLevel -> body pushed up + linvel
     damped; life drains submerged, recovers out; empty -> respawn called +
     life reset; mass 260 sizing sane.
3. `feat(ui): blue life bar bound per PlayerView`
   - `LifeBar.ts`; `PlayerView.sync` reads `kart.life`/`inWater` -> bar width +
     visibility; remove() teardown.
   - tests: bar hidden when out of water; width tracks life; visible in water;
     remove() detaches DOM.
4. `feat(game): wire waterLevel + countdown-gated drain`
   - Game passes `waterLevel` in KartController opts; sets drain flag on
     `onCountdownDone` (`Game.ts:460`). PlayerView constructs LifeBar.
   - tests: drain off until countdown done; on in 1P + 2P; Game.test mocks
     updated (no render regression).
5. `docs: refine 018 plan + todo + README + troubleshooting`
   - mark 018 full plan in `docs/todo.md`; README project structure adds new
     files; troubleshooting verify case.

## Risks

- Game.ts 600/600: zero new lines. The Game edits are modifications (opts arg,
  flag set at the existing `onCountdownDone` hook, PlayerView wiring), not
  additions. If wiring crosses 600, extract into `PlayerView`/a small helper.
- Arcade feel: too-strong buoyancy = jarring bounce; too-weak = kart sinks.
  Default forgiving (float high + strong drag); tune in review. Drain slow
  enough that a quick splash never empties the bar.
- Countdown drain bug: life MUST not drain during countdown settle. Gated by
  the phase flag; test the off->on transition at `onCountdownDone`.
- Rival stuck loop: a rival repeatedly entering water + auto-respawn could
  loop. Cooldown or `respawnAhead` reuse mitigates; cap respawn frequency.
- Drain rate vs race length: a long race + a lake must not auto-fail a
  careful driver. Default drain slow; recover out of water.
- Fixed-step only: buoyancy uses `STEP` (1/60), never variable dt.
- Strict TS noUnusedLocals: all pure-fn params used; `_`-prefix unused.

## Acceptance

- [ ] `buoyancy.ts` present; `buoyancyForce`/`lifeDelta` pure + tested
- [ ] Kart floats + is damped below waterLevel; drives out when shallow
- [ ] Blue life bar shows in water, drains submerged, recovers out
- [ ] Empty bar -> respawn at last checkpoint + bar reset (human + rival)
- [ ] No drain during countdown; drain on in racing (1P + 2P)
- [ ] `Game.ts` unchanged in line count; `KartController.ts` <=600 lines
- [ ] `npm run typecheck && lint && test` green; pre-commit hook green
- [ ] No black screen at `npm run dev`; visual verify logged in
      `docs/troubleshooting/`

## Defaults

- float: upward impulse grows linearly with submerged depth, clamped at a max;
  strong enough to hold mass 260 near the surface
- drag: horizontal linvel damped while submerged (paddle-out feels slow, not
  stuck)
- life: 0..1, drain ~slow (full bar ~6-8s submerged), recover faster out of
  water; empty -> respawn + reset to 1
- waterLevel: from `Terrain.waterLevel` (-3); wave uTime ignored
- rivals: same buoyancy, auto-respawn on empty, no bar

## Previous implementation

None. Closest patterns: suspension `applyImpulseAtPoint`
(`KartController.ts:181-187`), impulse-only forces (`:213,221,226,236,253`),
`respawn()` (`:268-277`), mass 260 (`:29`), `PlayerView.sync` per-human binding
(008), HUD DOM pattern (006 `src/ui/`), pure force helper for tests
(`impactTier` in 009).

## Depends on

000 (harness; test gate live). 003 (`Terrain.waterLevel`). 004 (water plane
level source). 006 (`onCountdownDone` phase gate). 008 (per-human `PlayerView`
for 1P/2P life bars). Independent of 010/017. 011 (perf budget) cross-ref.
