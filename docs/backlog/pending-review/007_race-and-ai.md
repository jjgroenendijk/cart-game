# 007 Track 01 race + AI opponents

Status: implemented (pending-review)

## Context

003 ships geometry only: closed-loop spline circuit on height-varied terrain,
explicitly deferred as "Track 01" (`003:27`, `003:156`). README lists it undone
(`README:15` Track 01 circuit, `README:16` race systems, `README:18` AI
opponents). 006 ships the state machine: countdown--done-->`racing`
(`006:71-74`). Nothing turns the circuit into a race, and the grid has one kart.

Real constraints the concept sketch (`007:1-47`) ignored:

- Loop is one fixed-step pass + one render (`Game.ts:58-84`). Fixed-step block
  (`Game.ts:70-75`) steps ONE kart (`kart.fixedUpdate`, `physics.step` once).
  007 steps N karts against the SAME single physics world (`physics.step` once,
  `PhysicsWorld.ts:29-56`) -> rivals = more `Kart` instances, no extra world.
- AI needs no KartController change: `fixedUpdate(dt, KartInput)`
  (`KartController.ts:117`) takes `{throttle,steer,drift,reset}` (`Input.ts:3-8`).
  AI = a fn that produces a `KartInput`. Clean split from human `input.sample(0)`
  (`Input.ts:82`, `Game.ts:66`).
- Rivals reuse `Kart` verbatim: ctor `(physics, spawn, yaw, playerIndex,
tuning)` (`Kart.ts:32-42`), palette by `playerIndex` (`Kart.ts:12-17`). 001
  migrates `Kart` off `makeToon`/`addOutline` (`Kart.ts:5`) onto `makeCel`
  (`001:78-82`); 007 consumes `Kart` post-001, imports NO material itself.
- Progress needs arc-length. 003's `SplineTrack` wraps a closed CatmullRomCurve3
  w/ an arc-length sample table (`003:33-36`). Contract gap: 003's
  `closestPoint(x,z)` must return the arc-length param `t in [0,1)` (not just
  `dist`) -> 007 blocks until 003 exposes `t`. Hard contract below.
- 006's HUD becomes speed-only (`006:107-108`); 007 adds its OWN overlays
  (RaceHud + Minimap) and does NOT modify 006's HUD or `gameState.ts`
  (`006:70-77`). 007 runs only when `state==='racing'`; hooks the countdown-done
  transition 006 owns (`006:120-121`).
- Collider friction is 0.0 (`KartController.ts:293`) -> kart-kart contact
  slides, little pushback. Acceptable arcade; not 007's to change (touches P1).
- `respawn()` hardcodes `(0,2,0)` (`KartController.ts:267`); 003 fixes it to
  ctor spawn for P1. AI recovery needs its OWN respawn-at-spline-ahead (does
  not touch `KartController.respawn`).
- `Game.dispose` is shallow (`Game.ts:49-56`); 004 sets the Rapier
  `removeRigidBody` precedent. 007 extends dispose for rivals.
- No RNG in `src/core/` today; 004 ships `src/core/rng.ts` (mulberry32,
  `004:48-53`). 007 consumes it (per-kart personality, grid jitter,
  deterministic tests).
- Minimap render path open in concept (`007:46`). Off-screen ortho cam = extra
  scene render + render-layer interaction. Canvas 2D overlay = cached spline
  polyline + projected blips, zero scene/render-pipeline touch, pure+testable
  projection. Decision: canvas 2D.
- package.json ships only `typecheck` (`package.json:11`); 000 owns the
  vitest+eslint+prettier harness. 007 test gate = typecheck always; vitest once
  000 lands (dormant meanwhile, mirrors 003-006).
- tsconfig strict w/ noUnusedLocals/Parameters (`tsconfig.json:17-18`); DOM lib
  present (`tsconfig.json:6`) -> RaceHud/Minimap DOM+canvas fine.

## Goal

Single-player race vs 5 AI rivals (6 total) over 3 laps on the 003 circuit:

- arc-length progress per kart + ordered sector gates (lap validity, cut-proof)
- lap counting + lap timer + race finish (leader N laps)
- live position/rank vs rivals (by lap, arcLen)
- minimap (canvas 2D: cached track polyline + kart blips, north-up)
- AI: pure-pursuit steering on the spline, curvature-based throttle, rival
  avoidance, stuck recovery, light rubber-band, seeded personalities
- starting grid (2 columns behind spline start, on terrain)

Scope boundary (decided): race rules + AI + race UI only. Non-goals below.

## Architecture (new)

```text
src/race/
  checkpoints.ts    # PURE. From SplineTrack samples -> K sector defs.
                    #   trackProgress(prevT, currT) -> {forwardDelta, sector}.
                    #   Lap validity: a lap counts only after every sector
                    #   crossed in order (monotonic forward t). Reversing or
                    #   skipping a sector does NOT award a lap (cut-proof).
                    #   Handles t-wrap at the [0,1) seam. No deps -> testable.
  raceRanking.ts    # PURE. rank(progresses[]) -> positions[]; lexicographic on
                    #   (lap, cumArcLen). Deterministic. Testable.
  raceManager.ts    # Orchestrator + sub-state machine 'grid'|'racing'|
                    #   'finished' (does NOT touch 006's GameState). Holds
                    #   per-kart Progress {lap, sectorIdx, cumArcLen, lastT}.
                    #   startRace(spawns[]) resets + zeros timer; update(dt,
                    #   kartPoses[]) advances timer + per-kart progress via
                    #   checkpoints + recomputes rank; finish fires ONCE when
                    #   leader lap>=N -> 'finished' (freezes). Timer pure-ish;
                    #   reads kart world t from SplineTrack.closestPoint.
  AiDriver.ts       # produceInput(pose, splineAhead[], rivals[], tuning, rng)
                    #   -> KartInput. Pure-pursuit: steer toward a lookahead
                    #   point (speed-scaled distance along spline). Throttle
                    #   eases on upcoming curvature (3-pt estimate). Rival
                    #   repulsion: lateral steer away from rivals in radius.
                    #   Stuck: speed<T for Tt off-corridor -> reset=true (Game
                    #   respawns at nearest spline-ahead). drift=false (v1).
                    #   Pure (no Game/physics) -> testable.
  aiTuning.ts       # Per-kart personality {lookaheadNear,Far,aggression,
                    #   maxSpeedScale,avoidRadius,stuckSpeed,stuckTime}. rng-
                    #   seeded (base seed + kartIndex) -> deterministic field.
src/kart/
  KartGrid.ts       # PURE-ish. computeGrid(SplineTrack, heightAt, n) ->
                    #   spawn[] {pos,yaw}. 2 columns behind start line, lateral
                    #   within trackHalfWidth, longitudinal gap; Y =
                    #   heightAt(x,z)+clearance; yaw = spline tangent. Reads
                    #   terrain only -> testable w/ a fake heightAt.
src/ui/
  RaceHud.ts        # DOM overlay (follows 006 StartMenu/Countdown pattern,
                    #   `006:78-91`). lap x/N, position p/total, current+total
                    #   time. update(rankState). show()/hide()/remove().
  Minimap.ts        # 2D canvas overlay. ctor samples SplineTrack.getPoint ->
                    #   cached track polyline (project world XZ -> map, once).
                    #   update(kartWorldPoses[]) plots blips; P1 highlighted,
                    #   rivals subdued; north-up. Exports pure projectXZ() for
                    #   tests. remove(). pointer-events:none, z 10 (006).
src/core/
  Game.ts           # ctor: after kart, build rivals = Kart[1..n-1] via
                    #   KartGrid + add groups; build raceManager + RaceHud +
                    #   Minimap; hide overlays. countdown-done (006 hook,
                    #   `006:120`): raceManager.startRace(grid) + show RaceHud/
                    #   Minimap. frame racing fixed-step: for each rival ->
                    #   AiDriver.produceInput -> rival.fixedUpdate; then
                    #   physics.step() ONCE; raceManager.update(dt, poses).
                    #   per-render: rivals.sync; raceManager.frame; RaceHud.
                    #   update; Minimap.update; shadow target follows P1.
                    #   finished: zero P1 input + show results (coast to stop).
                    #   dispose: removeRigidBody per rival (004 precedent) +
                    #   group.remove + RaceHud/Minimap.remove.
```

## Contracts with 003/006/001/002/004/005 (cross-backlog)

- 003: consume `SplineTrack.getPoint(t)` (AI line + sectors + minimap polyline)
  - `closestPoint(x,z)` returning `{dist, t}` (t = arc-length fraction [0,1))
  - `startPos()`/`startYaw()` (grid anchor). HARD GATE: 003 must expose `t`
    from closestPoint, not just `dist`. Consume `Terrain.heightAt` for grid Y +
    AI respawn seat. `trackHalfWidth 6` (`003:149`) bounds grid lateral.
- 006: run only when `state==='racing'`; hook the existing countdown-done
  transition (`006:120`) to call `raceManager.startRace`. 007 does NOT modify
  `gameState.ts` (`006:70-77`) nor 006's speed HUD -> adds own overlays.
- 001: transitively. Rivals reuse `Kart` (post-001 = `makeCel`); 007 imports no
  material. Minimap is canvas 2D -> no render-layer interaction.
- 002: no interaction (minimap canvas; results DOM).
- 004: consume `src/core/rng.ts` (mulberry32, `004:48-53`) for AI personality +
  grid jitter + determinism. 004 must land first (rng owner).
- 005: audio-free. Lap/finish beeps + rival collision sound = 009. Optional
  later hook via 005 `uiBeep` is 009's call, not 007.

## Commits (each atomic + green; gate = typecheck always + vitest once 000 lands)

1. `feat(race): add checkpoint progress + lap-validity pure fns + tests`
   - `src/race/checkpoints.ts`: sectors from spline samples; `trackProgress`
     (t-wrap aware); lap validity (all sectors, in order, forward only).
   - tests: lap awarded only after all sectors in order; reversing awards
     nothing; skipping a sector (cut) invalidates; forward seam wrap counts;
     sector advance monotonic.
2. `feat(race): add ranking pure fn + tests`
   - `src/race/raceRanking.ts`: rank by (lap, cumArcLen) lexicographic.
   - tests: order across laps (lap2 last > lap1 first); mid-lap ties broken by
     arcLen; P1 mixed w/ rivals; deterministic.
3. `feat(race): add raceManager (grid/racing/finished sub-state + timer)`
   - `src/race/raceManager.ts`. startRace resets + timer=0; update(dt, poses)
     advances timer + per-kart progress + rank; finish fires once when leader
     lap>=N -> 'finished' (idempotent). Sub-state machine internal only.
   - tests: startRace zeros state; update advances timer; finish fires once +
     no double; finished freezes rank; rank reflects post-progress order.
4. `feat(kart): add KartGrid spawn computation + tests`
   - `src/kart/KartGrid.ts`: computeGrid(spline, heightAt, n) -> spawns; 2
     columns behind start, within trackHalfWidth, Y=heightAt+clearance.
   - tests: all spawns dist< trackHalfWidth; behind start line; distinct;
     within world bounds; Y matches fake heightAt.
5. `feat(race): add AiDriver (pure-pursuit + throttle + avoidance + recovery)`
   - `src/race/AiDriver.ts` + `src/race/aiTuning.ts`. produceInput(pose,
     splineAhead, rivals, tuning, rng) -> KartInput; rng-seeded personality.
   - tests: steer sign toward lookahead point; throttle eases on synthetic
     sharp curvature; rival within avoidRadius adds avoidance steer; stuck
     (speed<stuckSpeed for >stuckTime off-corridor) -> reset=true; drift=false
     always; deterministic given seed (same seed -> same input sequence).
6. `feat(ui): add RaceHud (lap/pos/timer) + Minimap (canvas overlay) + tests`
   - `src/ui/RaceHud.ts` + `src/ui/Minimap.ts` (pure `projectXZ` exported).
   - tests: RaceHud builds elements + update sets text; Minimap projectXZ
     clamps in-bounds + maps corners correctly; polyline cached once (sample
     count stable); update plots N blips w/ P1 distinct.
7. `refactor(game): wire race manager + AI field + HUD/minimap + dispose`
   - Game: build rivals (Kart[1..n-1] via KartGrid) + raceManager + RaceHud +
     Minimap; countdown-done -> startRace(grid) + show overlays; racing
     fixed-step steps rivals (AiDriver->input->fixedUpdate) then a single
     physics.step; raceManager.update(dt); per-render rivals.sync + HUD/minimap;
     finished -> zero P1 input + results; dispose removeRigidBody per rival +
     groups + overlays.
   - tests: Game builds n-1 rivals; rivals stepped only when racing; startRace
     called on countdown-done; finished zeroes P1 input; dispose removes all
     rival bodies + groups + HUD/minimap DOM.
8. `docs: update backlog 007 + todo + README + troubleshooting`
   - mark 007 plan done in `docs/todo.md`; README status checkmarks (Track 01,
     race systems, AI) + project structure adds `src/race/`; troubleshooting
     case for verify (gated on 001-006; pixel-sample fallback per
     `2026-06-20_visual-verification-fallback.md`).

## Risks

- Arc-length `t` from closestPoint: 003 must expose it. If 003 returns only
  dist -> 007 blocked. Mitigation: hard contract stated; 003 built an arc-length
  table for AI reuse (`003:33-36`) so exposing t is natural. Verify at c3.
- ClosestPoint ambiguity on tight corners / infield cuts -> t jumps -> false
  sector/lap. Mitigation: ordered sectors + forward-delta window (accept t
  delta in a forward band; reject large backward jumps as cuts) in
  checkpoints.ts; monotonic-sector test.
- AI pure-pursuit oscillation (short lookahead -> wobble). Mitigation:
  speed-scaled lookahead (lerp near..far by speed01); tune Defaults; verify.
- AI stuck on 004 props / terrain lips: stuck detector -> reset -> Game
  respawns at nearest spline-ahead (heightAt+clearance). Note 004 props are
  collidable (`004:74-79`).
- Perf: 5 rivals = 6 rigidbodies + 24 suspension raycasts/step (~1440/s) + 6
  draws. Desktop-safe at 6; 011 (concept) owns LOD/budget. Mitigation: default
  6; flag risk; count tunable in Defaults.
- Kart-kart collider friction 0.0 (`KartController.ts:293`) -> rivals slide,
  weak pushback. Acceptable arcade; changing it touches P1. Note for 008/009.
- Rubber-band feel: too strong -> cheap/obvious; too weak -> blowouts.
  Mitigation: light default + tunable + toggle; modest bands in Defaults.
- Lap finish ordering race: leader crossing line same frame as another kart.
  Mitigation: compute rank AFTER progress update, by (lap,cumArcLen) ->
  deterministic single-pass order.
- t-seam wrap at start/finish: handle in trackProgress (forwardDelta across
  the 1->0 wrap). Boundary test in c1.
- AI ignores drift (drift=false v1) -> slower corners than a skilled human.
  Drift-AI = future polish; documented Non-goal.
- Rubber-band + maxSpeedScale interact w/ `DEFAULT_TUNING.maxSpeed=34`
  (`KartController.ts:32`): rubber-band scales the AI tuning's maxSpeedScale,
  not the shared DEFAULT_TUNING (per-kart tuning copy). Verify no shared-state
  leak at c5.
- Minimap canvas over WebGL: z 10 + pointer-events:none (006 parity,
  `006:265`); confirmed non-overlap w/ `#loading` (hidden by then).
- Strict TS (`tsconfig.json:17-18`): all AiDriver/raceManager params used;
  unused `_`-prefixed.
- Test harness absent until 000: typecheck-only gate (mirrors 003-006).
- Visual verify (full race) gated on 001-006 all landed; pixel-sample fallback
  meanwhile (`2026-06-20_visual-verification-fallback.md`).

## Acceptance

- [ ] `src/race/{checkpoints,raceRanking,raceManager,AiDriver,aiTuning}.ts` +
      `src/kart/KartGrid.ts` + `src/ui/{RaceHud,Minimap}.ts` present
- [ ] 0 material imports in `src/race/` (rivals reuse `Kart`; consume makeCel
      transitively, never `makeToon`)
- [ ] 0 edits to `src/core/gameState.ts` (006's machine untouched)
- [ ] Grid: all rival spawns within corridor (dist< trackHalfWidth), behind
      start line, Y = terrain heightAt+clearance
- [ ] Lap counts only after all sectors crossed in order; reversing/cutting
      awards nothing (tests green)
- [ ] Rank reflects (lap, cumArcLen); P1 live position shown; deterministic
- [ ] Race finishes exactly once when leader completes N laps; results shown;
      P1 input zeroed after
- [ ] AI follows the spline, eases throttle on curves, avoids rivals within
      radius, recovers when stuck; deterministic given seed
- [ ] Minimap: cached track polyline + live blips; P1 highlighted; north-up;
      blips stay in-bounds
- [ ] RaceHud: lap x/N, position, timer; visible iff racing
- [ ] `dispose()` removes all rival rigidbodies (removeRigidBody per 004) +
      meshes + RaceHud/Minimap DOM
- [ ] `npm run typecheck && lint && test` green; pre-commit hook green
- [ ] No black screen at `npm run dev`; visual verify (pixel-sample fallback
      until full stack lands), logged in `docs/troubleshooting/`

## Defaults

- laps: 3
- rivals: 5 (6 karts total); tunable; perf note -> 011
- grid: 2 columns, longitudinal gap 2.5m, lateral +/-2.0m, behind start line;
  Y = heightAt+0.5; yaw = spline tangent at start
- sectors: 6 (ordered; all must cross forward for a valid lap)
- progress: t in [0,1); cumArcLen accrues forward deltas (wrap-aware); accept
  forward-delta band; large backward jump = cut
- AI: lookahead lerp(6,14, speed01) m along spline; curvature throttle ease
  (3-pt estimate); avoidRadius 4m; stuck = speed<2 m/s for >2s off-corridor
  -> reset; drift=false (v1)
- aiTuning (rng-seeded per kart, base seed+index): aggression 0.7..1.0,
  maxSpeedScale 0.92..1.0
- rubber-band: ON, light; trailing rivals (gap>6s on leader) maxSpeedScale
  +0.08; leading rivals -0.05; tunable + toggle
- minimap: 160x160px bottom-right; scale fits world half-extent 100 (`003`);
  north-up; P1 accent dot; rivals subdued; pointer-events:none; z 10
- RaceHud: top-left under speed; visible iff racing
- audio: none in 007 (rival collision/lap/finish sound = 009)
- out of scope: multi-track (012), human 2P (008), replay/ghost, online
  leaderboards, difficulty UI (012; 007 = knobs only), AI drifting, dynamic
  minimap, rubber-band tuning UI

## Previous implementation

None. Greenfield. README lists Track 01 / race systems / AI undone
(`README:15-18`). Closest existing patterns: `Kart` ctor per-kart palette
(`Kart.ts:12-42`), DOM HUD (`Game.ts:93-119`), `src/ui/` from 006
(`006:78-91`). 007 builds `src/race/` + extends `src/ui/` from scratch.

## Depends on

000 (harness; test gate dormant until landed -> typecheck-only meanwhile).
003 (SplineTrack getPoint + closestPoint returning arc-length t + startPos/
startYaw; Terrain.heightAt; trackHalfWidth) — hard gate on the `t` exposure.
006 (GameState racing gate + countdown-done hook; does NOT modify gameState.ts).
004 (src/core/rng.ts mulberry32 — rng owner). 001 (transitive: Kart consumes
makeCel; 007 imports no material). 002 (none — minimap canvas, no interaction).
005 (none — 007 audio-free). Merge order: after 003+004+006 (and 001/002/005).
