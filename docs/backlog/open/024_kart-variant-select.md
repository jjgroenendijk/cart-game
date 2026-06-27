# 024 Kart variant select

Status: open (full plan — ready for execution)

## Context

Every kart today shares one `KartTuning`. `KartTuning`
(`KartController.ts:8-27`) already exposes rich knobs (mass, engineForce,
brakeForce, maxSpeed, maxSteerRate, topSpeedSteerFactor, grip, driftGrip,
driftBoost, suspension, wheelRadius, upright), but both kart construction
sites pass `DEFAULT_TUNING` literally (`FieldBuilder.ts:129` humans,
`:145` rivals). Kart color is index-derived from a fixed 4-entry `PALETTE`
(`Kart.ts:19-24`); there is no per-kart `colors` arg. `FieldBuilder.build`
takes only `humanCount` (`FieldBuilder.ts:119`). `Game.onStart`
(`Game.ts:266`) bridges menu->race carrying just `GameMode`. The mesh is
procedural in `Kart.buildMesh` (`Kart.ts:53`) so per-variant geometry is
cheap to add.

Split from concept stub 020 (track + kart select). Kart variant becomes
its own item here; 020 is trimmed to track-select-only. Track-select is
the harder half (multi-circuit plumbing) and stays in 020.

## Goal

Let each human pick one of six distinct kart archetypes before the race.
Each archetype has distinct tuning (derived from existing knobs), a
distinct procedural silhouette, and distinct colors. Rivals draw from the
same variant pool so the field is varied. Selection is a dedicated
pre-race sub-screen with independent per-player picks (2P), persisted
across sessions.

## Non-goals

- Distinct engine audio per variant. `AudioManager.ts` is at the 600-line
  cap with one shared `engine` config (`AudioManager.ts:209`); reworking
  per-voice engine curves is deferred to a follow-on. Variants share the
  existing `maxSpeed: 34` audio mapping this item.
- Live 3D kart preview on the select screen. The overlay is DOM-only
  (name + color swatch + stat bars). A spinning WebGL preview is a later
  polish item.
- Track select (stays in 020).
- New physics behaviour; tuning only recombines existing knobs.

## Archetypes

Six variants. `balanced` equals `DEFAULT_TUNING` exactly; the rest are
deltas over it. Starting values, pending playtest (see Risks).

```text
balanced  baseline == DEFAULT_TUNING (maxSpeed 34, engineForce 9000,
          mass 260, grip 9.5, maxSteerRate 2.6).
          silhouette: stock.
speed     top-end, sluggish low end. maxSpeed 39, engineForce 8200,
          grip 8.5, mass 270, maxSteerRate 2.4, topSpeedSteerFactor 0.6,
          driftBoost 1.14.
          silhouette: long nose + tall spoiler.
grip      sticky accel, low top. maxSpeed 30, engineForce 10500,
          grip 11.5, driftGrip 2.0, mass 250, maxSteerRate 2.9,
          brakeForce 12500.
          silhouette: compact, low spoiler.
heavy     stable, bump-proof. mass 340, maxSpeed 32, engineForce 9400,
          grip 10.5, driftGrip 1.9, maxSteerRate 2.3, uprightTorque 34.
          silhouette: wide body + big tires.
feather   agile, tippy, light. mass 200, maxSpeed 33, engineForce 8800,
          grip 8.8, driftGrip 1.3, maxSteerRate 3.0, driftBoost 1.18,
          uprightTorque 22.
          silhouette: slim + small tires.
trail     soft / long-travel, terrain-tolerant. mass 280, maxSpeed 33,
          engineForce 9200, grip 9.0, suspensionStiffness 30000,
          suspensionDamping 3000, suspensionTravel 0.4, wheelRadius 0.42.
          silhouette: balloon tires, raised body.
```

## Phased plan (execution order; gate = typecheck + lint + test + hook)

### Phase 1 — variant registry (pure, testable)

New `src/kart/kartVariants.ts` (WebGL-free, jsdom-safe per src/AGENTS.md):

- `KartVariantId` union of the six ids.
- `KartSilhouette` interface: body dims `[w,h,d]`, tireRadius, noseZ,
  spoilerH.
- `KartVariant` interface: id, name, colors (`KartColors`), tuning
  (`KartTuning`), silhouette, statBars.
- `KART_VARIANTS: KartVariant[]` (six entries, values above).
- `statBarsFor(tuning): { speed, accel, grip, mass }` — pure 0..1
  normalization across the six variants' min/max per knob.
- `variantForRival(seed, index): KartVariantId` — deterministic pick from
  the pool (mirrors `makeAiTuning` seeding, `aiTuning.ts:30`).

Tests: `kartVariants.test.ts` asserts all six have valid tuning, sane
silhouette dims, `statBarsFor` ranges in [0,1], and `variantForRival`
determinism.

### Phase 2 — Kart mesh per variant

`Kart.ts` ctor gains optional `colors?: KartColors` and
`silhouette?: KartSilhouette` (default = balanced). `buildMesh` reads
silhouette to scale chassis box, nose length, spoiler height, and tire
radius. New detail parts keep `userData.kartDetail = true` so existing
`kartLod` (`kartLod.ts:106`) still drops them at distance. Outline
thickness unchanged; verify rims stay crisp across silhouettes.

### Phase 3 — rivals from the pool + AI balance fix

- `FieldBuilder` rival construction (`:145`) picks a variant via
  `variantForRival` and passes its tuning/colors/silhouette into `new
Kart(...)`.
- `aiTuning.ts:27` `AI_REF_MAX_SPEED = 34` is hardcoded; `AiDriver`
  (`AiDriver.ts:75`) uses it for speed->lookahead. Thread each rival's
  actual `tuning.maxSpeed` through `makeAiTuning` / `AiDriver` ctor so a
  speed-39 rival scales lookahead correctly instead of desyncing.
- `AiDriver.test.ts` gains a case asserting lookahead scales with the
  rival's real maxSpeed.

### Phase 4 — FieldBuilder takes per-human variants

`FieldBuilder.build(humanCount, humanVariants: KartVariantId[])` (default
all-balanced for backward compat). Human construction (`:129`) resolves
each id to a variant and forwards tuning/colors/silhouette. Field size,
grid, audio voice count unchanged. `FieldBuilder.test.ts` (via `Game`)
asserts `views[0]` kart tuning matches the chosen variant.

### Phase 5 — KartSelectOverlay (new `src/ui/KartSelectOverlay.ts`)

DOM overlay, plain DOM/canvas per ui/ convention. Contents: prompt
("P1 choose your kart" / "P2 ..."), kart name, color swatch, stat bars
(`statBarsFor`), left/right hints, confirm + back buttons. Reuses
`MenuNav` (`src/ui/menuNav.ts`) and its currently-unused `onHorizontal`
hook (`menuNav.ts:132`) for L/R variant cycling; A=confirm, B=back.

Flow: P1 cycles + confirms; in 2P, P2 then cycles + confirms. Back from
P1 returns to menu; back from P2 returns to P1. Callback delivers
`{ mode, variants: KartVariantId[] }`.

Tests: `KartSelectOverlay.test.ts` (jsdom) asserts DOM, L/R cycling,
P1-then-P2 flow, back navigation, and the confirm payload.

### Phase 6 — select game state + wiring

`gameState.ts`: add `select` to `GameState` and `openSelect`, `confirm`
to `GameEvent`. Transitions: `menu --openSelect--> select`,
`select --confirm--> countdown`, `select --quit--> menu`. Pure fn;
`gameState.test.ts` covers the new edges (illegal combos no-op as today).

`Game.ts`: `StartMenu` START now fires `openSelect` (shows
`KartSelectOverlay`) instead of jumping to countdown. Overlay confirm
stores `selectedVariants`, rebuilds the field when mode or variants
changed (`field.dispose()` + `field.build(humanCount, variants)` — the
dispose/build pair is proven by 012's quit cycle), then transitions
`select --confirm--> countdown`. `StartMenu.test.ts` updated for the new
START target.

### Phase 7 — persistence

Persist last-used variant per player via localStorage (Settings pattern,
`settings.ts` versioned store). Defaults to balanced; old stores load +
default (no schema break). Loaded into `Game.selectedVariants` at boot
and applied on the first field build.

## Contracts with 000-023

- 020 (track + kart select concept): this item retires the kart-variant
  half of 020. 020 is trimmed to track-select-only; todo deps updated.
- 000 (harness): every commit gated by typecheck + lint + test + hook.
- 006 (start menu + state machine): reuses the overlay pattern and the
  `transition` gate; adds one state + two events.
- 008 (split-screen): per-human PlayerView/voice routing already exists;
  per-human variants slot in unchanged.
- 012 (pause + settings): reuses `menuNav`, the localStorage persistence
  pattern, and overlay conventions.
- 007 (race + AI): Phase 3 edits `AiDriver` + `aiTuning`; race/checkpoint
  logic untouched.
- 011 (LOD): Phase 2 new silhouette parts must keep `kartDetail` flags so
  `kartLod` culling still applies.

## Commits (each atomic + green)

1. `feat(kart): add KartVariant registry + six archetype tunings`
   - `src/kart/kartVariants.ts` + `kartVariants.test.ts` (pure).
2. `feat(kart): per-variant colors + silhouette in Kart mesh`
   - `Kart.ts` ctor + `buildMesh`; detail flags on new parts.
3. `feat(race): AiDriver reads per-rival maxSpeed; rivals use pool`
   - `aiTuning.ts`, `AiDriver.ts`, `FieldBuilder.ts` rival build; tests.
4. `feat(field): FieldBuilder.build takes per-human variants`
   - `FieldBuilder.ts` signature + human build; test asserts tuning.
5. `feat(ui): KartSelectOverlay with per-player pick + stat bars`
   - `src/ui/KartSelectOverlay.ts` + test; `menuNav` onHorizontal reuse.
6. `feat(core): select game state + wire menu->select->countdown`
   - `gameState.ts` + test; `Game.ts` wiring; `StartMenu` START target.
7. `feat(core): persist kart selection across sessions`
   - localStorage store (settings pattern); load + apply on first build.
8. `docs: split kart variant from 020 into 024; update todo`
   - trim 020 to track-select; this file; `docs/todo.md` deps + status;
     troubleshooting verify case stub.

## Risks

- Tuning spread (speed 39 vs grip 30 top) needs playtest. Mitigation:
  modest deltas, rubber-band (`FieldBuilder.ts:242`) tuning, verify in
  the troubleshooting case. Revert/retune per archetype if one dominates.
- Heavy mass 340 raises collider density (`makeColliderDesc` derives
  density from mass, `KartController.ts:351`); verify suspension stays
  stable (may need a stiffness bump on heavy). Make it a measured call.
- `Game.ts` is 468/600 (132 headroom). Keep select wiring inside the
  overlay; if Game grows past budget, extract state glue to a helper.
- Silhouette changes must not break outline or LOD. New parts carry
  `kartDetail`; verify rims crisp + LOD cull still trims at distance.
- 2P P1-then-P2 + back navigation has more state edges; cover in
  `KartSelectOverlay.test.ts` and `gameState.test.ts`.
- Audio non-goal: a speed-39 kart saturates the shared 34-maxSpeed engine
  curve early. Acceptable this item; documented for the audio follow-on.
- Strict TS `noUnusedLocals`: all silhouette fields must be consumed.

## Acceptance

- [ ] Six variants selectable on the select screen; each drives
      distinctly (stat bars + handling differ perceptibly).
- [ ] 2P: P1 and P2 pick independently; both applied to their karts.
- [ ] Rivals show varied karts and stay competitive (no runaway vs a
      speed human or a grip human).
- [ ] menu -> select -> countdown -> race flows in 1P and 2P; back from
      select returns to menu; no black screen.
- [ ] Selection persists across sessions (reload remembers last picks).
- [ ] `AiDriver` lookahead scales with each rival's real maxSpeed (test).
- [ ] Outline crisp + LOD cull intact across all silhouettes.
- [ ] All touched files <= 600 lines + lines <= 100 chars; every commit
      passes `typecheck && lint && test` + hook.
- [ ] Per-archotype feel + no-black-screen logged in
      `docs/troubleshooting/`.

## Defaults

- Default variant: `balanced` (P1 and P2).
- Rival assignment: deterministic via `variantForRival(AI_BASE_SEED, i)`,
  cycling the six ids.
- Stat bar normalization: min/max across the six variants per knob.
- Select preview: DOM-only (name + swatch + stat bars); no live 3D.
- Audio: unchanged (shared 34-maxSpeed engine config).

## Previous implementation

None. Closest patterns + precedents:

- `KartTuning` + `DEFAULT_TUNING` (`KartController.ts:8-48`) — the knobs.
- Index-derived `PALETTE` (`Kart.ts:19-24`) — becomes per-variant colors.
- Procedural `Kart.buildMesh` (`Kart.ts:53`) — silhouette branching site.
- `makeAiTuning` seeded jitter (`aiTuning.ts:30`) — rival variant seeding
  model.
- `MenuNav.onHorizontal` (`menuNav.ts:132`) — L/R cycling hook.
- `gameState.transition` (`gameState.ts:23`) — pure state-machine extend.
- Settings localStorage pattern (`settings.ts`) — persistence model.
- 012 quit cycle (`Game.ts`) — proven `field.dispose()` + `build()` pair.

## Depends on

000 (harness; test gate live). 006 (menu + state machine). 007 (race +
AI; Phase 3 edits AiDriver). 008 (per-human PlayerView/voice routing).
011 (kartLod; Phase 2 must keep detail flags). 012 (menuNav, persistence
pattern). Independent of 003-005/009/010/013-019/022. Splits 020
(kart-variant half moves here; 020 keeps track-select).
