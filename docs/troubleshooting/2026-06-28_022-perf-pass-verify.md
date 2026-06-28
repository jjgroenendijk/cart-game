# 022 perf pass — verify log

Date: 2026-06-28
Item: 022 (perf pass)
Status: code-verified; live visual + F3 perf verify deferred to review

## Scope

Profiling pass over renderer, physics, terrain, kart, env, audio. Targets
desktop high-FPS judder (>=120Hz) and low-end/mobile GC jitter + slow-mo
spiral. Four hotspot clusters: render-pass multiplier, per-frame GC churn,
O(N) runtime scans + unbounded physics accumulator, static-object waste.

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

### Enabler

1. `test(config): raise vitest timeouts to fix load flakiness` — pre-existing
   Rapier WASM init under --maxWorkers=2 exceeded the default 5000ms
   testTimeout, blocking the pre-commit hook. testTimeout/hookTimeout=20000.

### Phase 0 — observability

1. `perf(stats): sample renderer.info once per game frame` — StatsHud read
   renderer.info at a stray rAF instant (caught one sub-pass, not the ~7
   renders/frame). Renderer sets info.autoReset=false, resets once/frame,
   snapshots accumulated totals after renderViews; getFrameStats() reused
   snapshot. F3 now reports true per-frame CALLS/TRIS.

### Phase 1 — GC elimination

1. `perf(physics): pool raycast result + drop redundant ray.dir reset` —
   castRayDown returns a reused scratch RayHit; dropped no-op ray.dir reset.
2. `perf(kart): cache Rapier impulse scratch vectors` — 10 reused scratch
   fields replace ~12 fresh object literals/Vector3 clones per kart/step.
3. `perf(race): pool AI sampleAhead + rivalPositions buffers` — per-rival
   pre-sized AiSplinePoint[16] + AiRival[] written in place.
4. `perf(audio): pool audio-state builders + dedup camera-list builds` —
   pooled humanAudio/rivalAudio buffers + listener scratch; camera-position
   list built once per renderViews (was 2-3x).
5. `perf(race): reusable RaceManager snapshot accessor` — snapshot writes 3
   structs in place; sole caller reads once/frame.
6. `perf(env): pool computeDayCycle Color/Vector3 outs` — 6 module-level
   pooled scratch; lerpKeyColor out arg reused.

### Phase 2 — render-pass reduction

1. `perf(renderer): gate post outline/sky passes when not racing` —
   PostOutline + SkyPosterize .enabled = racing; skipped on menu/pause/
   countdown/finished. RenderPass + OutputPass still draw the full scene.

### Phase 3 — terrain + physics

1. `perf(terrain): O(1) spline t cache; route closestPoint callers via it`
   — SplineFieldCache gains a t grid (same resolution/sampling as dist/
   pathY) + queryPose (bilinear dist, wrap-aware bilinear t). 3 runtime
   callers (rival pose/AI, racePose, respawnAhead) routed via closestPose.
2. `fix(core): clamp physics accumulator to prevent slow-mo spiral` —
   MAX_STEPS=5; acc clamped after the sub-step loop. STEP=1/60 unchanged.
3. `perf(terrain): toggle pre-built trimesh bodies on LOD change` — tier
   colliders cached per chunk on one shared body; rebuild toggles
   setEnabled instead of remove/recreate -> no mid-frame BVH rebuild.
4. `perf(physics): lower solver iterations 8 -> 6` — named constant with
   documented revert path (8); needs live 6-kart verify before settled.

### Phase 4 — static-object waste + LOD

1. `perf(render): disable matrixAutoUpdate on static scene objects` — water,
   sky dome, propField group + merged buckets + outline children + decor,
   terrain chunk group + chunk meshes set matrixAutoUpdate=false +
   one-shot updateMatrix. Chunk rebuild only swaps geometry.
2. `perf(kart): skip kartLod traverse when level unchanged` — applyKartLod
   skips the ~15-mesh traverse when level === prev (child.userData.lod
   sentinel = undefined first frame).
3. `perf(env): decor bounding spheres + drop decor receiveShadow` —
   instanced.computeBoundingSphere() once; decor receiveShadow dropped
   (castShadow already false).

### Phase 5 — polish

1. `perf(kart): physics->visual interpolation in sync` — prevPos/prevQuat
   captured before each sub-step; sync lerps/slerps prev->live by
   clamp(acc/STEP); teleport/respawn snap prev (no smear). Zero alloc in
   sync.
2. `perf(audio): silence-gate inactive voices + rival distance skip` —
   VoiceSet.update early-returns when !engineActive; rival
   PositionalVoice skips beyond SKIP_DISTANCE=120 (= panner maxDistance).
3. `fix(terrain): colorAt aliasing corrupts road/grass blend` — WeakMap
   memoizes the 4 LINEAR colors per cfg (own arrays); removes shared
   scratchRGB + per-vertex sRGB->LINEAR recompute.

### Docs

1. `docs: refresh AGENTS.md invariants for 022 perf pass` — governance
   1000-LOC reset; added accumulator-clamp + interpolation invariants.

## Deferred (browser visual/parity verify required — not safe headless)

- Phase 2.1 (share DepthTexture across composer mask passes): PostOutline
  renders layer-1 view-space NORMALS (not depth) + needs layer-1-only depth;
  SkyPosterize forces transparent objects (weather/moon) to write depth to
  protect them from the sky gradient. Sharing main-render depth breaks both
  -> not bit-identical. Needs an art call (should weather receive the sky
  gradient?) + rework of the mask passes. Rescope to a follow-on task.
- Phase 5.2 (CSM + per-object cast-shadow cull): three.js already frustum-
  culls castShadow objects against the shadow camera (verified
  WebGLShadowMap.js); every caster has correct bounds + kartLod drops
  shadows at the minimal band. CSM reworks the custom CelMaterial shadow
  path (cel.ts USE_SHADOWMAP undefined) -> needs live visual verify.
- Phase 5.4 (weather partial/dirty-range particle buffer upload): all 1500
  particles move every frame (no dirty-range win); the real fix is GPU-
  shader motion, which needs a custom shader with manual fog parity ->
  unverifiable headless. Deferred.

## Code-verified (this pass)

- F3 sampling: renderer.info.autoReset=false; reset once/frame; snapshot
  after renderViews. GEO/TEX stay cumulative; CALLS/TRIS = per-frame total.
- GC pooling: all pooled buffers sized in build()/ctor, cleared in dispose();
  callers read synchronously + never retain across frames (verified per
  commit). No alloc in Kart.sync (instance-field scratch).
- Spline t cache: cached t vs brute-force closestPoint on-corridor max
  |dt| ~0.00088, seam-straddle max ~0.0005 (tolerances have 20-100x
  headroom). heightAt/colorAt keep using query() (019 semantics intact).
- Trimesh toggle: exactly one collider enabled per chunk (no double-hits);
  verified setEnabled(false) excludes from ray queries in rapier 0.19.3;
  ray-parity + seam guard pass (0 misses, worst err < 0.3m).
- Solver 6: unit-level physics/kart suites stable (resting-contact sim,
  suspension, buoyancy). Live 6-kart profile still required.
- colorAt: output byte-identical for the non-aliasing case (same srgbToLinear
  math); existing color assertions pass to 4 decimals.

## Deferred to review (live verify)

- F3 readout before vs after per phase (draw calls / tris / frame ms); no
  black screen; 1P + 2P drive gap-free across chunk edges.
- Phase 2.2 visual tradeoff: non-racing frames lose terrain ink-outline +
  sky cel-bands (smooth gradient); re-enabled instantly on racing. Confirm
  menu/finished look acceptable.
- Solver 8->6: confirm no suspension/stacking jitter on the 6-kart field;
  revert is a one-line constant change (SOLVER_ITERATIONS=8).
- colorAt band: confirm road->grass gradient matches intended (byte-identical
  expected; the fix removed latent aliasing only).
- Kart interpolation: confirm >60Hz display shows no micro-stutter; confirm
  no one-frame smear on respawn/teleport.

## File budgets

All touched files <= 600 lines; all hand-written lines <= 100 chars. Watch
list for future edits near cap: Game.test.ts (600), AudioManager.ts (600),
Game.ts (538), FieldBuilder.ts (528).
