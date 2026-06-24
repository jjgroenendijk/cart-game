# 2026-06-24 011 LOD + performance budget verify

011 perf instrumentation: perf sampler + budget, StatsHud overlay, big-prop
spatial bucket merge, quality tier knobs, distance kart LOD. All 5 code
commits + an AGENTS.md refresh landed. This verify records what is
code-verified vs what needs a live WebGL review pass.

## Scope

Five code commits on `feat/011-lod-perf`: stats.ts, StatsHud.ts, PropField
bucket merge, quality.ts with Renderer.setQuality, and kartLod.ts with
Kart.applyLod + a Renderer per-render LOD pass, plus a docs(agents)
refresh. Gate green: typecheck, lint, format, and the full vitest suite
(585 tests, +56 over the 529 baseline).

## Code-verified

- stats.ts: PerfSample + BudgetTargets + DEFAULT_BUDGET_1P + rate +
  classify + FrameMsEwma. Pure; 14 tests cover thresholds, classification
  (clean=ok, heavy=bad, shadowCasters undefined=ok), budget sanity, EWMA
  seed/converge/reset.
- StatsHud: F3 toggles `.gc-stats` (display none/block); self-driving rAF
  is guarded so jsdom is safe; `visibleWhen` force-hides outside racing;
  remove() detaches. Pure formatStats tested. main.ts wires it reading
  `renderer.info`; Game.renderer -> public (Game.ts stays 600/600).
- PropField merge: big props (tree/rock) bucket into a 2x2 grid per type
  (bigPropBuckets option) into one merged BufferGeometry with one
  CelMaterial and one outline per non-empty bucket (<=8 meshes vs ~200).
  Colliders unchanged (createBody still runs per prop); bodyCount ==
  bigProps. Dispose frees merged geos/mats + outlines, idempotent;
  deterministic from seed. 9 PropField tests.
- quality.ts + Renderer.setQuality: qualityKnobs(tier,dpr) pure mapping
  (low/med fixed; high clamps min(dpr,2)); DEFAULT_QUALITY="high".
  Renderer ctor calls setQuality(DEFAULT) (near/bias stay static; shadow
  map dispose guarded; no-op on unchanged tier). Default high reproduces
  pre-011 values (regression test).
- kartLod.ts: kartLod(distance,prev,opts) full/reduced/minimal with ~5 m
  hysteresis; never hides the kart. nearestCameraDistance picks min
  across active cameras (1P/2P). applyKartLodGroup walks the tagged group
  in place. Kart tags role + detail meshes (spokes, wing struts) +
  applyLod delegate. Renderer.applyKartLod runs once per renderViews. 21
  tests.
- Build green (`vite build`, 72 modules).

## Deferred to live review (needs WebGL + real GPU)

Cannot assert render-time NUMBERS headlessly. The acceptance items below
need a manual pass at `npm run dev` with the StatsHud (F3) readout:

- No black screen; menu -> countdown -> race flows (1P + 2P).
- Baseline read: press F3 mid-race, confirm FPS / frame ms / CALLS / TRIS
  vs DEFAULT_BUDGET_1P. Expected: big-prop draw calls drop from ~400 to
  <=16 (8 merged meshes) + shadow casters ~200 -> ~8; far rivals drop
  detail/shadow via kart LOD.
- setQuality("low"/"med") visually degrades cleanly (pixelRatio + shadow
  map size + ortho extent) with no shadow-map leak on rebuild.
- No outline shimmer on the large merged bucket meshes (constant screen-
  space width unchanged).

## Notes / handoffs

- 012 (pause + settings) forward-depends on Renderer.setQuality for the
  user-facing quality selector landed here; wire 012 to that entry point.
- Terrain chunking was split to 019 in the prior refinement PR (#11); the
  open/019_terrain-chunking.md stub already exists, so this item does not
  recreate it.
