# 077 Code-review bug sweep

Status: open (in progress; fixes A-F landed/in-flight, G-M pending)

## Context

A defensive code review across `src/` flagged 13 confirmed bugs (A-M):
lifecycle leaks, skipped state transitions, physics ordering, off-by-one
geometry, and a NaN edge case. None are crashes; all are correctness or
resource bugs that compound over a long session or under specific configs
(auto weather, 2P split, low gear counts, wide grids). Branch
`fix/code-review-bugs` carries the fixes; each is one atomic commit.

Excluded (reviewed, confirmed non-bugs): `CelMaterial.surfaceDetail`
setter (intentional no-op when identical), ChaseCamera void damp
(cosmetic), SettingsOverlay beep-on-drag (intended affordance),
RaceConfigOverlay click-to-cycle (intended), Input/StatsHud listener
leaks (owned by parent teardown).

## Goal

Land 13 atomic fixes, each green on `verify:changed`, then run full
`npm run verify`, push, and open a PR. No behavior beyond the listed
fixes; no refactors mixed in.

## Non-goals

- No new features, no API surface changes beyond the bug corrections.
- No terrain pipeline review (heightAt/collider/mesh verified clean).
- No media/binary assets (repo rule).

## Fixes

### A. Environment duplicate subsystem construction - DONE (4a1505c)

`Environment.ts` constructed terrain + sky + water twice in the ctor
(6 duplicate lines). Drops the second construction; one instance each.

### B. Audio rival voices + count-change rebuild - DONE (f43b7d3)

`audioGraph.ts` built rival voices once at graph build; `setRivalCount`
never rebuilt them, and `setHumanCount`/`setEngineActive` did not fan
out to all voices. Extracts `buildHumanVoices`/`stopHumanVoices`;
setHumanCount/setRivalCount rebuild live voices post-resume;
FieldBuilder.build calls `setRivalCount(rivals.length)`.

### C. TrackDressing geometry dispose - DONE (ba9d629)

`TrackDressing` freed materials but leaked 3 BufferGeometries (decal,
gantry, flag). Adds a `geometries[]` tracker + dispose loop.

### D. Kart.dispose - DONE (da6a132)

`Kart` had no dispose; FieldBuilder teardown freed the Rapier body but
left GPU meshes/materials/outline alive. Adds `Kart.dispose()` (detaches
outlines + disposes unique geoms/mats); FieldBuilder.dispose calls it
for views + rivals.

### E. pendingWeatherMode reset on race-config open - DONE (9bdf90f)

Opening RaceConfig mid-race left `pendingWeatherMode` stale, so the
next race could start with a weather the player never confirmed. onStart
resets `pendingWeatherMode = weatherMode`.

### F. Weather auto-mode preset swap gate - IN PROGRESS

`Environment.ts:266` gated field rebuilds on `wl.level <= 0`. A fixed
sim step rarely samples the exact zero crossing; auto-mode fronts never
swap and the old field renders under the new preset's channels. Change
to `wl.preset !== this.lastWeatherPreset`. Swaps are once-per-front
(rare), and at a handover the level is already near zero (prior fade-out
just completed), so the rebuild is seamless.

### G. Visibility-resume ignores paused state - PENDING

`AudioManager.attachVisibilityHandler` (AudioManager.ts:395) calls
`resume()` unconditionally when the page becomes visible and the user
gestured. If the game is paused, audio restarts under the pause overlay.
Guard: resume only when the game is not paused (query GameFlow state or
have GameFlow suspend audio on pause and skip the visibility resume).
Cross-cuts AudioManager + GameFlow.

### H. Velocity read before buoyancy application - PENDING

`KartController.ts` reads body linear velocity for drag/steer before
applying the buoyancy impulse (lines ~229-261). Buoyancy-correction is
not seen until next frame -> floaty lag and one-frame velocity mismatch.
Re-read velocity after the buoyancy impulse.

### I. freshProgress ignores configured sectorCount - PENDING

`raceManager.ts:278` `freshProgress(gridT)` seeds sector state from a
hardcoded default, not the configured `sectorCount`. Pass
`sectorCount` through so the lap tracker + sector index match config.

### J. Wildlife bird yaw off by +pi/2 - PENDING

`critters.ts:131` computes `yaw = angle + Math.PI / 2`. Birds fly
sideways relative to their orbit tangent. Use the tangent heading
(`-angle` per the orbit convention) so the model faces travel.

### K. signedWrapDelta half-tie asymmetry - PENDING

`checkpoints.ts:38-39` maps the `d == -0.5` tie to `+0.5` (the `< -0.5`
branch leaves -0.5 untouched) but `d == +0.5` to... also +0.5. The
(-0.5, 0.5] doc says half-open on the negative side, so the -0.5 tie
must resolve to +0.5 via `<= -0.5`. Fix the boundary condition so the
seam is consistent with the documented half-open interval.

### L. KartGrid lateral offset for columns > 2 - PENDING

`KartGrid.ts:79` uses `side = col === 0 ? -1 : 1`, a 2-column straddle.
With `columns` > 2 (or odd counts) every col >= 1 stacks at +lateral,
overlapping karts. Distribute cols evenly across [-1, 1] mapped to the
column index so N-column grids spread laterally without overlap.

### M. engineCurve NaN when gears < 2 - PENDING

`engineCurve.ts:70` `gear = Math.min(gears-1, floor(speed01*gears))`
and `local = speed01*gears - gear`. With `gears < 2` the band math can
divide by a zero-width gear range -> NaN/Inf in the curve. Guard
`gears < 2` to a single-band degenerate curve (or clamp gears >= 1 with
a no-divide path).

## Commits (each atomic + green; gate = typecheck + lint + lint:okf + test + secrets)

Each fix = one commit on `fix/code-review-bugs`. A-E committed; F staged.
Each src/ commit also touches the matching `docs/knowledge/*.md` (enforced
by the 09-knowledge-freshness hook). Commit subjects use Conventional
Commits (`fix(scope): subject`).

## Risks

- F: changing the swap gate could surface a transition that was
  previously invisible. Mitigation: swap is once-per-front and at near-
  zero level (prior fade-out just ran); test asserts rain/snow handover.
- G: AudioManager has no knowledge of game state. Prefer GameFlow-driven
  suspend (pause overlay already suspends) so the visibility handler's
  resume stays AudioManager-local; verify the resume path does not fight
  an active pause suspend.
- H: re-reading velocity adds one Rapier query/frame; negligible cost,
  but assert no double-application of drag.
- I: changing sector seed could shift AI waypoint timing; verify lap
  completion + ranking tests.
- L: changing the lateral map alters grid layout for all column counts;
  refresh any grid golden/pose test.

## Acceptance

- [ ] A-M each landed as one atomic commit, `verify:changed` green.
- [ ] F: auto weather visibly swaps field on a rain<->snow front (test).
- [ ] G: tab away while paused -> return -> audio stays suspended under
      pause overlay; tab away while racing -> return -> audio resumes.
- [ ] H: buoyancy-corrected velocity read same frame (no floaty lag).
- [ ] I: sector index + lap tracker match configured sectorCount.
- [ ] J: birds face their travel direction along the orbit.
- [ ] K: wrap seam consistent with (-0.5, 0.5] on the tie case (test).
- [ ] L: 3- and 4-column grids spread laterally without overlap (test).
- [ ] M: engineCurve returns finite values for gears in {0, 1, 2, 6}
      (test).
- [ ] Full `npm run verify` green; PR opened against main.

## Verification

- `npm run verify:changed` after each commit; `npm run verify` before push.
- Targeted vitest per fix (jsdom; spy on dispose, assert finite math,
  assert grid pose spread).
- F3 manual: 2P split auto-weather race for F/G; water crossing for H;
  wide-column grid for L.

## Depends on

Nothing hard. Reads existing subsystems (Environment, AudioManager,
KartController, RaceManager, critters, checkpoints, KartGrid,
engineCurve). Each fix is self-contained; fixes can land independently if
the branch is split.
