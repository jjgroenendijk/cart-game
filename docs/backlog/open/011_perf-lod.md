# 011 LOD + performance budget

Status: open (refined plan)

## Context

Cross-cutting perf item. Today nothing is budgeted or instrumented, and the
biggest costs are unmanaged:

- 200 big props (trees 120 + rocks 80) are INDIVIDUAL meshes, each
  `castShadow=true` plus its own inverted-hull outline child
  (`PropField.ts:51-57,161-177`; `BIG_TYPES` `PropField.ts:27`). That is ~400
  main-pass draw calls plus 200 shadow casters — the dominant cost. Decor
  (bush/flower/grass) is already 3 `InstancedMesh`es, receive-only
  (`PropField.ts:203-222`); clouds are one instanced mesh (`Clouds.ts:49`).
- No instrumentation: `main.ts:24-25` only exposes `window.__game`. No FPS,
  draw-call, or frame-time readout. A budget needs measurement first.
- Shadow: single 2048^2 PCF map, 160x160 ortho following the kart midpoint
  (`Renderer.ts:125-138`; `Game.ts:284-285`); every caster renders each frame.
- 2P split doubles the WHOLE composer per view, including PostOutline's extra
  terrain normal+depth render plus fullscreen Sobel (`Renderer.ts:188-205`;
  `postOutline.ts:170-191`). Retina is capped at pixel-ratio 2
  (`Renderer.ts:82`).
- No LOD anywhere; 6 karts (~13 meshes + outlines each, `Kart.ts:50-136`) all
  render plus cast shadow at full detail at every distance.

Real constraints, resolved against the code:

- `Game.ts` is 600/600 (hard cap). This item adds ZERO net Game lines: StatsHud
  is self-driving (constructed in `main.ts`, 28 lines, ample) and reads
  `renderer.info`; quality tier and kart LOD live in `Renderer` (317, headroom),
  not Game. Making the renderer handle public is a modification of the existing
  `private readonly renderer` line (`Game.ts:50`) — net zero lines.
- Big-prop geometry is per-seed UNIQUE (`propFactory.ts:39-47,84-103`), so it
  cannot go into one `InstancedMesh` (needs shared geometry). Merge instead:
  `mergeGeometries` is already used (`propFactory.ts:190`). Outlines share the
  merged geometry as-is (`outline.ts:61-66`) — no shader change.
- Colliders are unchanged: PropField still spawns the 200 Rapier bodies
  (`PropField.ts:179-201`); only the VISUAL big props merge into buckets.
- Tests run under jsdom with no WebGL: export pure helpers (budget sampler,
  quality mapping, kart-LOD levels) and assert them directly (mirrors
  `posterizeChannel`, `impactTier`). `renderer.info` is WebGL-only; StatsHud's
  sampler is fed a plain snapshot type so the formatting logic is unit-tested.

Technique note (deviation): the refinement chose "add instance support to the
outline." Per-seed unique geometry makes instancing a poor fit; spatial-bucket
MERGING keeps the cel outline with no shader work and a bigger draw-call cut.
Same intent (outline preserved), simpler plus lower risk.

## Goal

- Instrumentation: a toggleable perf overlay (FPS, frame ms, draw calls, tris,
  geometries, textures) sourced from `renderer.info` plus a frame-time sampler;
  self-driving, zero net Game lines.
- Performance budget: define frame/draw-call/shadow/tri targets for 60 FPS on a
  mid integrated GPU at 1080p; a pure sampler classifies a snapshot vs targets.
- Big-prop merge: static trees/rocks -> spatial-bucket merged meshes (tree/rock
  x N) with cel + outline; ~400 draw calls -> ~16, ~200 casters -> ~8.
- Quality tier: `Renderer.setQuality(low|med|high)` knobs (pixelRatio,
  shadowMapSize, shadow distance/ortho). Default high = current look. 012 wires
  user choice later.
- Kart LOD: distance-based shadow + detail drop on karts far from any active
  camera, applied per-render by Renderer on tagged kart groups.

## Non-goals

- Terrain chunking / skirt stitching (SPLIT to new item 019 — see Dependencies).
- Mesh-simplification tooling (manual bucket merge + feature drop only).
- Networked/server budget (local game); mobile-tier target (desktop floor).
- GPU-instancing rewrite of decor (already instanced; only big props merge).
- Physics-step-ms in the overlay (render-side stats only in v1; sim is bounded
  by the fixed step plus 5-substep cap, `Game.ts:265`).

## Architecture (new)

```text
src/core/
  stats.ts           # PURE: PerfSample type, EWMA frame-time, BudgetTargets,
                     #   classify(sample, targets) -> {ok|warn|bad} per metric.
                     #   Exported for jsdom tests (no WebGL).
src/ui/
  StatsHud.ts        # DOM overlay (ui/ owns its nodes). Self-driving rAF:
                     #   samples renderer.info + own frame ms, EWMA-smooths,
                     #   renders via classify(). F3 toggles (own keydown; F3 is
                     #   not a game key). remove() for teardown.
src/environment/
  PropField.ts       # MODIFY big props: spawnBig -> bucket. Group placed
                     #   trees/rocks into N spatial buckets, merge each bucket's
                     #   per-seed geometry (mergeGeometries), one CelMaterial
                     #   (vertexColors) + addOutline per bucket. Colliders
                     #   unchanged (createBody loop stays). dispose frees merged
                     #   geo + outlines (existing pattern).
src/core/
  quality.ts         # PURE: QualityTier -> {pixelRatio, shadowMapSize,
                     #   shadowCameraFar, shadowHalfExtent}. Exported + tested.
  Renderer.ts        # MODIFY: setQuality(tier) applies pixelRatio +
                     #   sun.shadow.mapSize/camera far+ortho (rebuilds shadow on
                     #   change). ADD per-render kart LOD: walk scene children
                     #   tagged userData.role === 'kart' once per renderViews,
                     #   min distance to any active camera -> applyLod.
src/kart/
  kartLod.ts         # PURE: kartLod(distance, opts) -> {castShadow, detail}.
                     #   Exported + tested.
  Kart.ts            # MODIFY: tag group userData.role = 'kart'; applyLod(level)
                     #   toggles castShadow + detail-mesh .visible (spokes, wing
                     #   struts). Headroom (173 -> ~195).
src/main.ts          # MODIFY: new StatsHud(app, game.renderer) after start.
src/core/Game.ts     # MODIFY one token: private readonly renderer -> readonly
                     #   renderer (net zero lines). Nothing else.
```

## Contracts with 001-010

- 001: big-prop merge keeps CelMaterial(vertexColors, flatShading) plus
  inverted-hull outline per bucket (layer 0). Outline needs no change (shared
  geo).
- 002/010: none (sky/weather untouched).
- 003: none (terrain mesh + collider untouched; chunking is 019).
- 004: PropField visual refactor only; decor InstancedMeshes, Water, Clouds
  unchanged. Dispose precedent preserved.
- 005-009: none.
- 006/008: StatsHud hidden in menu/countdown like the HUDs; 1P/2P unaffected
  (one overlay, reads the active frame). Kart LOD uses the nearest of the
  active cameras (handles split-screen).

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(core): pure perf sampler + budget`
   - `stats.ts`: PerfSample, EWMA frame ms, BudgetTargets, classify.
   - tests: EWMA converges; classify flags warn/bad per metric; targets sane.
2. `feat(ui): toggleable StatsHud overlay`
   - `StatsHud.ts` self-driving rAF + F3 toggle; `main.ts` wires it; Game.ts
     renderer handle -> public (one-token mod, net zero lines).
   - tests: show/hide on toggle; formats a plain PerfSample; remove() detaches.
3. `perf(world): merge static big props into spatial buckets`
   - PropField: tree/rock x N buckets, merged geo + outline; colliders stay.
   - tests: big draw-call groups drop to 2\*N; collider body count unchanged;
     dispose frees merged geo + outlines, idempotent; determinism from seed.
4. `perf(render): quality tier knobs`
   - `quality.ts` pure mapping; Renderer.setQuality (pixelRatio, shadow map
     size, shadow camera far/ortho, shadow rebuild on change). Default = high.
   - tests: tier -> knobs mapping; setQuality mutates shadow config; default
     preserves current values (no render regression).
5. `perf(kart): distance-based shadow + detail LOD`
   - `kartLod.ts` pure; Kart.applyLod + group tag; Renderer per-render
     nearest-camera distance gate over tagged kart groups.
   - tests: near full / mid detail-off-shadow-on / far shadow-off; Renderer
     applies min distance across active cameras (1P + 2P).
6. `docs: refine 011 plan + split 019 + todo`
   - refine this file; create `open/019_terrain-chunking.md` concept stub
     (retired from 011); update `docs/todo.md` refinement status + Track B list
     - deps; troubleshooting verify.

## Risks

- Game.ts 600/600: zero net lines (renderer handle is a one-token modification;
  everything else routes through Renderer/main.ts/subsystems). If wiring
  crosses, extract into StatsHud/Renderer.
- Merge loses per-tree frustum culling (one bucket bbox = its cell). Mitigate
  with N spatial buckets (2x2 default) so off-screen cells cull; bucket count
  tunable. Net still a large win (fog ends at 360, world is 200 m).
- Outline on merged buckets: constant screen-space width is unchanged; verify
  no shimmer on large merged geo in review.
- Kart LOD flicker at threshold: hysteresis on the distance bands.
- Quality tier shadow rebuild (`shadow.map.dispose()` + needsUpdate) must not
  leak; gate on tier change only.
- Budget targets are estimates pre-measurement; confirm/relax at commit 2's
  baseline read, then lock. Strict TS noUnusedLocals: all pure-fn params used.

## Acceptance

- [ ] `stats.ts` pure sampler + budget; classify tested
- [ ] StatsHud overlay toggles (F3), shows FPS/frame ms/calls/tris; zero new
      Game lines
- [ ] Big props merge into buckets; ~400 draw calls -> ~16, ~200 casters -> ~8;
      collider count unchanged; dispose idempotent
- [ ] `Renderer.setQuality(low|med|high)` applies pixelRatio + shadow knobs;
      default high == current look
- [ ] Kart LOD drops shadow/detail by distance; handles 1P + 2P cameras
- [ ] `npm run typecheck && lint && test` green; pre-commit hook green
- [ ] No black screen at `npm run dev`; baseline + post-tuning numbers logged
      in `docs/troubleshooting/`

## Defaults

- budget (60 FPS, mid integrated GPU, 1080p, high tier): frame warn>14 / bad>
  16.6 ms; draw calls 1P warn>80 / bad>120, 2P x~1.8; shadow casters warn>40 /
  bad>80; tris warn>350k / bad>500k. Confirmed at the baseline read.
- big-prop buckets: 4 (2x2 spatial grid) per type -> 8 merged meshes; tunable.
- quality tiers: low {pixelRatio 1, map 1024, far 120, half 60}; med {1.5,
  2048, 200, 80}; high {min(dpr,2), 2048, 400, 80} (current).
- kart LOD: <25 m full; 25-70 m detail off, shadow on; >70 m shadow off +
  detail off (never hide — race visibility). Hysteresis ~5 m.

## Previous implementation

None. Closest patterns: decor InstancedMesh + receive-only shadow
(`PropField.ts:203-222`), `mergeGeometries` (`propFactory.ts:190`), inverted-
hull outline sharing geometry (`outline.ts:61-66`), HUD DOM + remove()
(`src/ui/`), pure helpers for jsdom (`posterizeChannel`, `impactTier`).

## Depends on

000 (harness; test gate live). 001 (cel + outline on buckets). 004 (PropField
visual). 007/008 (karts to LOD; 2P cameras). 010 (adds load; independent).
SPLITS terrain chunking into 019 (new concept stub). 012 forward-deps on the
quality tier knob landed here.
