# 042 Time-of-day configuration (pre-race menu)

Status: pending-review (implemented on feat/042-time-of-day-config;
automated gates green — typecheck/lint/test/build/lint:repo; manual visual
verification of the live sky preview pending reviewer)

## Context

The day/night cycle is implemented (010) and fully config-driven: the pure
`computeDayCycle(elapsed, opts)` (`src/environment/dayCycle.ts:187`) maps a
clock value to sun arc + 4-phase color/intensity/fog/sky. `cycleT` fractions:
0 = dawn, 0.25 = noon, 0.5 = dusk, 0.75 = night. `DynamicSky`
(`src/environment/DynamicSky.ts:113`) owns the clock and every frame does
`elapsed = (elapsed + dt) % dayLength`. There is no user-facing control, no
static/dynamic toggle, and no time-scale knob; the cycle always advances,
even in the menu and while paused.

Two hard constraints shape the design:

- `Environment` (+ its `DynamicSky`) is built ONCE in the `Game` ctor
  (`src/core/Game.ts:92-95`) and is NOT rebuilt by the field rebuild path
  (`FieldBuilder.dispose()/build()` only owns karts/race/HUDs). So a runtime
  change needs setters on `DynamicSky`, not reconstruction.
- All day-cycle consumers read the `dayCycleState` singleton fresh each frame
  (Renderer `applyDayCycle` at `src/core/Renderer.ts:362`, SunDisc, Clouds,
  Weather). A frozen/static singleton therefore needs no consumer changes.

The pre-race flow is a pure state machine (`src/core/gameState.ts`):
`menu --openSelect--> select --confirm--> countdown`. `KartSelectOverlay`
is the existing pre-race screen; its ArrowLeft/Right cycle control
(`src/ui/KartSelectOverlay.ts:301`) is gamepad-friendly via MenuNav
`onHorizontal`. Two persistence patterns exist: live-applied settings
(audio, `src/core/settings.ts`) and per-race selection persisted to
localStorage (kart variants, `src/core/kartSelectionStorage.ts`). Neither
covers time of day.

User need: before the race, configure the time of day; choose static (sun
frozen) or dynamic (advancing cycle), pick a starting phase, and (in dynamic
mode) a cycle speed.

## Scope

Add a dedicated pre-race "Race Setup" screen with mode + phase + speed
controls, persist the choice, and apply it to the live day cycle (with a
real-time sky preview, since `env.update` runs every frame in the menu).

Not in scope:

- Track / circuit select -> 020.
- A continuous 0-1 time slider (discrete phase presets only).
- Per-phase tuning of the existing color/intensity curves (010 owns those).
- Shadow-fade at dusk/dawn -> 038 (independent; this plan composes with it).
- Weather config -> future.

## Goal

A player opens Race Setup from the menu, picks STATIC or DYNAMIC, a phase
(Dawn/Morning/Noon/Afternoon/Dusk/Night), and a speed (Slow/Normal/Fast,
dynamic only), sees the sky change live behind the screen, confirms, and the
race starts under that configuration. The choice persists across sessions.

## Non-goals

- Rebuild `Environment` at runtime; use setters instead.
- Change any day-cycle consumer (Renderer/SunDisc/Clouds/Weather).
- Alter the existing kart-select screen or its result contract.
- Add new lighting phases or retune 010's curves.

## Architecture (change)

```text
src/core/
  gameState.ts          # add "raceConfig" state:
                        #   menu --openSelect--> raceConfig --confirm--> select
                        #   raceConfig --quit--> menu. Update doc + tests.
  gameState.test.ts     # raceConfig transitions + guards.
  timeOfDayConfig.ts    # NEW pure module:
                        #   TimeOfDayConfig { mode, phase, dayLengthSeconds }
                        #   TimeOfDayPhase = dawn|morning|noon|afternoon|dusk|night
                        #   phaseToCycleT map; phaseToStartSeconds(phase,dayLength)
                        #   SPEED_PRESETS {slow:240, normal:120, fast:60}
                        #   DEFAULTS { dynamic, morning, 120 }; validateTimeOfDayConfig.
  timeOfDayConfig.test.ts # pure: phase fractions, start-seconds, validate clamps.
  timeOfDayStorage.ts   # NEW localStorage key gamecart.timeOfDay.v1,
                        #   mirrors kartSelectionStorage (try/catch, DEFAULTS
                        #   fallback, never throws).
  timeOfDayStorage.test.ts # jsdom load/save/fallback.
  Game.ts               # onStart opens RaceConfigOverlay (not kart-select).
                        #   onRaceConfigConfirm: persist + applyTimeOfDay, then
                        #   open KartSelectOverlay (existing path unchanged).
                        #   onRaceConfigBack: return to menu. applyTimeOfDay ->
                        #   env.setTimeOfDay. Loaded config applied at boot (ctor)
                        #   so the menu preview is correct on first load.
src/environment/
  DynamicSky.ts         # setElapsed(s), setDayLength(s) (updates this.dayLength
                        #   + opts, keeps elapsed proportional so the sun does
                        #   not jump), setFrozen(b) (gate the elapsed += dt line
                        #   in update). Each re-evals computeDayCycle + writeState.
  Environment.ts        # setTimeOfDay(config): forward to dynamicSky.
src/ui/
  RaceConfigOverlay.ts  # NEW. Mirrors KartSelectOverlay structure: plain DOM +
                        #   cssText, CONFIRM/BACK buttons, own MenuNav with
                        #   onHorizontal cycling the focused control. Three
                        #   cycle rows: MODE, TIME, SPEED (speed dimmed while
                        #   static). onApply(config) per change (live preview);
                        #   onConfirm(config) -> next; onBack() -> menu.
```

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(dayCycle): add DynamicSky time-of-day setters`
   - DynamicSky setElapsed/setDayLength/setFrozen (proportional elapsed on
     day-length change); Environment.setTimeOfDay forwarder. Unit-test freeze
     - setElapsed snap.
2. `feat(core): time-of-day config + storage`
   - timeOfDayConfig (pure) + timeOfDayStorage (localStorage) + tests.
3. `feat(core): wire raceConfig state + Game apply path`
   - gameState raceConfig transitions + tests; Game ctor load + boot apply;
     applyTimeOfDay.
4. `feat(ui): Race Setup overlay with live sky preview`
   - RaceConfigOverlay; Game onStart/onConfirm/onBack wiring. Closes the
     feature.

## Risks

- `dayLengthSeconds` change mid-dynamic could teleport the sun. Mitigated:
  setDayLength keeps `elapsed` proportional (elapsed/dayLength ratio
  preserved) so the phase is continuous. Assert in tests.
- Live preview runs `env.update` in the menu (already the case); applying
  setters per keystroke is cheap (one computeDayCycle). No debounce needed.
- Static freeze stops the clock but `env.update` still runs (clouds/weather
  animate on their own clocks) -> intended; only the sun/sky hold.
- Adding a `raceConfig` state shifts the open-select contract. Mitigated:
  `transition` guards keep illegal combos inert; the menu START button is
  the only openSelect emitter.
- localStorage schema must version independently (own key) to avoid
  colliding with kart-selection/audio stores.

## Acceptance

- [x] Menu -> START opens Race Setup; CONFIRM -> kart-select; BACK -> menu.
- [x] MODE cycles Static/Dynamic; TIME cycles 6 phases; SPEED cycles 3
      presets (dimmed while static).
- [ ] Live preview: the sky/sun/fog behind the screen update as options
      change (visible on the menu cam). (impl done via onApply->applyTimeOfDay;
      manual visual check pending)
- [ ] Static mode freezes the sun at the chosen phase for the whole race.
      (impl done via setFrozen; manual check pending)
- [ ] Dynamic mode advances the cycle from the chosen phase at the chosen
      speed; switching speed does not jump the sun. (impl done; ratio-preserving
      setDayLength unit-tested; manual check pending)
- [x] Choice persists across reloads (gamecart.timeOfDay.v1).
- [x] Existing kart-select, race start, pause, and day-cycle visuals are
      unchanged when config is at DEFAULTS. (parity; existing suite green)
- [x] All touched files <= 600 lines; typecheck + lint + test + hook green.

## Defaults

- mode: dynamic (matches current always-advancing behaviour).
- phase: morning (lit start; reuses 010's `daytimeStartSeconds` 0.12
  fraction).
- dayLengthSeconds: 120 (010's default).
- SPEED_PRESETS: slow 240, normal 120, fast 60.
- phaseToCycleT: dawn 0, morning 0.12, noon 0.25, afternoon 0.38, dusk 0.5,
  night 0.75.

## Verification

- Cycle MODE/TIME/SPEED on the Race Setup screen; confirm the live sky
  matches (dawn = low east sun + warm horizon; night = stars + moon + dim).
- Start a race in static noon -> sun holds position for the full race.
- Start in dynamic dusk / fast -> visible sun descent over the race.
- Reload after picking night static -> menu preview is night on first load.
- `npm run verify:changed` then `npm run verify`.

## Depends on

010 (dayCycle). 024 (kart-select overlay pattern + MenuNav). The
Environment/DynamicSky construction in `src/core/Game.ts:92-95`. Independent
of 038 (shadow-fade) and 020 (track select); composes with both.
