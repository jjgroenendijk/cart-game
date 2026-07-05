# 052 Visual verify harness: scene bookmarks + screenshot regression

Status: open (full plan; ready for execution)

## Context

The game's whole value is its look (cel bands, outlines, posterized sky,
day cycle, biome palettes), yet nothing automated can see a pixel:

- Tests run under jsdom with no WebGL (`tools/vitest.config.ts`); they
  assert shader source strings and uniform defaults, never output.
- Concept 040 (CSM) is explicitly deferred on "needs live visual verify".
  039 (composer depth share) has the same failure mode: both change how
  frames are composed while intending zero visible change.
- Every queued biome (029-036) claims "visually distinct from X" and 025
  claims "bit-identical temperate parity" - all currently verified by a
  human driving around with F3 open.
- Dependabot bumps `three` weekly with auto-merge on green CI; a rendering
  regression from an upstream change lands silently today.

A junior-only team will regress this look without noticing. The one hard
constraint: the asset policy rejects tracked binaries including `*.png`
(`tools/check-repo-rules.sh` asset list), so classic golden-image files
cannot be committed. Baselines must be text, and text files still face the
600-line / 100-char caps.

053 kart action VFX (dust, drift smoke, splash, poof, skid marks) now
contributes pixels during any drift/respawn scene; a `?scene=drift`
bookmark exercises the full particle + skid pipeline.

062 depth-aware water lands shore foam + depth tint + sun glint, so a
`?scene=shoreline` (a water body at a biome shoreline, ideally across a
042 time-of-day sweep) now exercises water pixels that were previously a
flat plane.

Determinism is already in place: seeded RNG everywhere (`core/rng.ts`),
`DynamicSky.setElapsed/setFrozen` + `Environment.setTimeOfDay` (042),
deterministic menu-cam orbit, `window.__game` exposed by `main.ts`.

## Goal

Any rendering change is exercised against a fixed scene matrix; an
unintended pixel drift fails CI with a human-viewable diff artifact. As a
by-product, any world/time/biome combination is reachable from a URL - the
"needs live visual verify" blocker on 039/040 becomes a command.

## Non-goals

- No perceptual-quality scoring or screenshot-driven tuning; this detects
  drift, humans judge beauty from the CI artifact.
- No gameplay/physics regression testing (motion, AI) - stills only.
- No committed images ever; policy stands.
- No change to `npm run verify` (stays WebGL-free and fast); visual check
  is its own gate.

## Architecture (change)

```text
src/core/
  sceneBookmark.ts    # NEW PURE: parse/serialize ?scene= params ->
                      #   { biome, tod (preset|hours), weather, cam:
                      #     menu|chase, camT (spline t), time (fixed
                      #     elapsed seconds) }. Validation + defaults;
                      #   jsdom-testable.
  sceneBookmark.test.ts
src/main.ts           # if ?scene= present: build Game, apply bookmark
                      #   (rebuildWorld(biome), setTimeOfDay frozen,
                      #   pinned cam pose from camT, weather preset),
                      #   render stills with a CONSTANT env.update time
                      #   (no dt accumulation) and skip menu/audio resume.
                      #   Sets window.__sceneReady = true after N settle
                      #   frames so the runner knows when to capture.
tools/visual/
  signature.mjs       # PURE: RGBA pixels -> 32x18 grid of per-cell mean
                      #   RGB, hex-serialized as an array of <=96-char row
                      #   strings (respects the 100-char line cap).
                      #   compare(a, b, tol) -> { maxCellDelta,
                      #   cellsOverTol, pass }. Unit-tested in vitest
                      #   (plain arrays, no GL).
  signature.test.mjs
  run.mjs             # runner: vite build + preview, launch Playwright
                      #   chromium (SwiftShader/ANGLE software GL for
                      #   cross-machine stability), for each scene in
                      #   scenes.json: goto ?scene=..., await
                      #   __sceneReady, screenshot the canvas, write PNG
                      #   to .agent/visual/ (ignored), compute signature.
                      #   Modes: check (compare vs baselines, nonzero exit
                      #   on fail) | capture (rewrite baselines).
  scenes.json         # scene matrix v1: registered biomes (temperate/
                      #   desert/alpine/tundra) x tod {noon, dusk, night}
                      #   on the menu cam, + one temperate chase-cam
                      #   still. ~13 scenes.
  baselines/<scene>.json  # one text file per scene (keeps every file far
                      #   under the 600-line cap as the matrix grows).
.github/workflows/
  visual.yml          # NEW job on PR + main: npm ci, playwright chromium
                      #   (cached), node tools/visual/run.mjs check;
                      #   uploads .agent/visual/*.png + a diff report as
                      #   artifacts. continue-on-error for a 2-week
                      #   burn-in, then flipped to required.
package.json          # visual:check / visual:capture scripts;
                      #   @playwright/test devDependency.
```

## Signature + tolerance design

Exact pixel equality is wrong twice over: AA sample placement varies by
rasterizer, and local GPUs differ from CI's SwiftShader. A 32x18 mean-RGB
grid is robust to sub-pixel jitter but catches what matters at this art
style's scale: a shifted cel band boundary, a missing outline pass, fog or
palette drift, a broken posterize step. Compare per-cell RGB distance with
two thresholds: per-cell tolerance (AA noise floor, tuned during burn-in)
and a max count of cells over tolerance (localized change still fails).
Baselines are authored FROM THE CI RUN (capture mode artifact) so the
committed reference matches the enforcing environment; local check runs
use a looser documented tolerance.

## Commits (each atomic + green)

1. `feat(core): scene bookmark mode via ?scene= params`
   - `sceneBookmark.ts` + tests; `main.ts` wiring incl. `__sceneReady` +
     constant-time still rendering. Human-usable immediately
     (`npm run dev` then `/?scene=biome:alpine,tod:dusk`).
2. `build(tools): visual signature module + playwright runner`
   - `signature.mjs` (+vitest), `run.mjs`, `scenes.json`, npm scripts,
     Playwright dep. Runner skips gracefully when chromium is absent.
3. `ci: visual regression job + v1 baselines`
   - `visual.yml` (burn-in mode) + `baselines/*.json` captured from CI.
4. `docs: AGENTS.md ownership + tolerance/rebaseline runbook`
   - How to read a failure artifact, when rebaselining is legitimate
     (intended look change, three upgrade) and that a rebaseline commit
     must say WHY in its body; move 052 to pending-review.

## Risks

- Nondeterminism in a "still": clouds/water/weather animate on the time
  passed to `env.update`. Mitigation: bookmark mode passes one constant
  time every frame; determinism acceptance test below is the guard.
- SwiftShader vs real-GPU differences: baselines bind to CI's rasterizer;
  local failures with passing CI are possible. Mitigation: looser local
  tolerance + runbook says CI is the arbiter; artifact PNGs make local
  eyeballing cheap.
- Legit look changes (biome work, three bump) fail the gate by design.
  Mitigation: capture mode + paired rebaseline commit; for dependabot
  `three` PRs the failing job forces exactly the human look-check that is
  missing today (auto-merge stays safe: patch bumps only merge on green).
- Flaky first frames (shader compile, texture upload). Mitigation:
  `__sceneReady` after N settle frames; runner retries a scene once before
  reporting failure.
- Runtime cost: ~13 scenes x a few seconds; separate job, does not slow
  `npm run verify` or unit CI.

## Acceptance

- [ ] Determinism: capturing the same scene twice in one browser session
      yields byte-identical signatures (runner self-test).
- [ ] Sensitivity: disabling PostOutlinePass (1-line local hack) fails
      `visual:check` on every racing-cam scene; reverting passes.
- [ ] Parity guard: temperate scenes' signatures are unchanged by adding a
      new biome to the registry (025 invariant, now enforced on pixels).
- [ ] Policy clean: no tracked binary; every baseline line <= 100 chars,
      every file <= 600 lines; PNGs only under ignored `.agent/` + CI
      artifacts.
- [ ] `?scene=` works by hand in dev for every scenes.json entry.
- [ ] CI job uploads viewable PNG artifacts on both pass and fail.
- [ ] `npm run verify` runtime unchanged; visual job separate + required
      after burn-in.

## Verification

- Run `visual:capture` then `visual:check` locally twice (green, stable).
- Introduce a deliberate fog-color change -> check fails, artifact diff
  shows it; revert -> green.
- Open 3 bookmark URLs by hand and compare against the same scene in the
  normal game.
- `npm run verify` + hooks green.

## Depends on

042 (setTimeOfDay/setFrozen - shipped), 025 (biome registry - shipped),
010 (weather presets - shipped). Unblocks 039 + 040 (their "needs live
visual verify" becomes `visual:check` + one artifact look). Guards 029-036
biome work and weekly `three` dependabot bumps. Extends naturally to 037
circuits (add a circuit param to sceneBookmark later). Independent of 046.
