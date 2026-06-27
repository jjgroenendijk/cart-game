# 024 kart variant select — verify log

Date: 2026-06-27
Item: 024 (kart variant select)
Status: code-verified; live visual + per-archetype feel verify deferred
to review

## Scope

024 splits the kart-variant half out of 020 into its own item: six
distinct kart archetypes (balanced/speed/grip/heavy/feather/trail) with
per-variant tuning + procedural silhouette + colors, a dedicated pre-race
`select` sub-screen with P1-then-P2 independent picks (2P), rivals drawn
from the same variant pool, an AI balance fix (per-rival maxSpeed instead
of a hardcoded 34), and localStorage persistence of last picks. 020 keeps
track-select only.

## Commits (each atomic + green)

1. `00a30ec feat(kart): add KartVariant registry + six archetype tunings`
   — new pure `src/kart/kartVariants.ts` (six variants + statBarsFor +
   variantForRival) + `kartVariants.test.ts`. WebGL-free, jsdom-safe.
2. `04a877e feat(kart): per-variant colors + silhouette in Kart mesh` —
   Kart ctor gains optional colors? + silhouette?; buildMesh reads
   silhouette (chassis box, nose length, spoiler height, tire radius);
   DEFAULT_SILHOUETTE reproduces the stock mesh; new parts keep
   userData.kartDetail so kartLod still culls at distance.
3. `2fce573 feat(race): AiDriver reads per-rival maxSpeed; rivals use
pool` — aiTuning gains refMaxSpeed; AiDriver lookahead scales with
   the rival's real maxSpeed (kills the hardcoded AI_REF_MAX_SPEED=34
   desync); FieldBuilder rivals draw from the pool via variantForRival.
4. `5e5ea29 feat(field): FieldBuilder.build takes per-human variants` —
   build(humanCount, humanVariants=[]) resolves each id to a variant;
   default balanced for backward compat.
5. `8870086 feat(ui): KartSelectOverlay with per-player pick + stat
bars` — new `src/ui/KartSelectOverlay.ts` (DOM overlay, P1-then-P2
   flow, stat bars, L/R cycling via own keydown + MenuNav.onHorizontal
   gamepad, back nav P2->P1->menu).
6. `78bb656 feat(core): select game state + wire menu->select->countdown`
   — gameState adds `select` state + openSelect/confirm events
   (menu->select->countdown; select->quit->menu); old `start` event
   removed. Game.ts wires onStart->select, onSelectConfirm (field
   rebuild on mode/variant change + countdown), onSelectBack; Escape
   owned by the overlay (Game early-returns in select).
7. `4e660e1 feat(core): persist kart selection across sessions` — new
   `kartSelection.ts` + `kartSelectionStorage.ts` (settings pattern);
   loaded at boot into Game.selectedVariants + saved on confirm.

## Code-verified (this pass)

- `kartVariants.ts` (pure): six variants, each with valid KartTuning,
  sane KartSilhouette dims, KartColors; `statBarsFor` normalizes each
  knob to 0..1 across the six variants' min/max; `variantForRival(seed,
index)` deterministic (mirrors makeAiTuning seeding). Test asserts all
  six + ranges + determinism.
- Kart mesh backward-compat: omitted colors?/silhouette? reproduce the
  stock mesh (DEFAULT_SILHOUETTE); FieldBuilder human/rival construction
  forwards undefined for the unchanged paths until Phases 3/4 land.
- AiDriver lookahead scales with refMaxSpeed: a speed-39 rival uses a
  larger lookahead than a 30-max grip rival (test covers the scaling;
  hardcoded AI_REF_MAX_SPEED=34 path gone).
- FieldBuilder per-human variants: build(humanCount, humanVariants)
  resolves each id; default balanced when omitted. Test (via Game)
  asserts views[0] kart tuning matches the chosen variant.
- KartSelectOverlay: P1 cycles + confirms; in 2P P2 then cycles +
  confirms; back from P2 -> P1 -> menu; confirm payload
  { mode, variants }. L/R via own keydown + MenuNav.onHorizontal gamepad.
  jsdom test covers DOM + cycling + flow + back nav + payload.
- gameState: `select` state + openSelect/confirm/quit edges covered;
  illegal combos no-op as before (pure transition fn, tests cover new
  edges).
- Persistence: kartSelectionStorage round-trips v1 stores; corrupt /
  missing / partial stores load + default via validateSelection (never
  throws). Game loads at boot + applies on first field build; saves on
  confirm. key gamecart.kartSelection.v1.
- Gate: typecheck + eslint + markdownlint + prettier + secretlint +
  pre-commit all green. 959 tests (was 904; +55). `npm run build`
  succeeds.
- All touched files <= 600 lines (Game.ts 506/600 headroom; new files
  well under) and every line <= 100 chars.

## Deferred to review

- Live visual + per-archetype feel + no-black-screen: no browser canvas
  in this env. Reviewer should `npm run dev`, Start -> select screen,
  and confirm:
  - six variants cycle (distinct stat bars + distinct colors +
    distinct silhouettes);
  - 1P + 2P P1-then-P2 flow; back nav P2->P1->menu;
  - rivals show varied karts and stay competitive (no runaway vs a
    speed human or a grip human);
  - selection persists across reload (localStorage remembered);
  - no black screen at any transition;
  - outline crisp + LOD cull intact across all silhouettes (new detail
    parts drop at distance; rims stay crisp).
- No-black-screen proxy: build is green; the select overlay is DOM-only
  (no WebGL), and the field rebuild reuses the proven
  field.dispose() + field.build() pair from 012's quit cycle.

## Notes

- Audio non-goal: variants share the existing 34-maxSpeed engine config
  (AudioManager at the 600-line cap). A speed-39 kart saturates the
  engine curve early. Acceptable this item; documented for an audio
  follow-on.
- Game.ts sits at 506/600 (94 headroom); select wiring stays in the
  overlay, Game holds only the state glue.
- 020 stays track-select-only (kart-variant half retired into 024);
  020's plan already reflects the split.
