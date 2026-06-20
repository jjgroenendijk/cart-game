# 004 Stylized environment dressing

Status: open

## Context
After 003 the off-track area is bare: vertex-colored grass/rock/sand terrain
with height variation but zero dressing. The current sketch (`004:1-29`) is not
a plan — it is a wish list. Two things make it stale on arrival:

- `004:15` says "Reuse `makeToon` + `addOutline` + `flatGeometry`." WRONG.
  001 deletes `src/materials/toon.ts` (`001:50,103`) and ships `makeCel` +
  a render-layer system (`001:32-50`). 003 reinforces "imports 001's `makeCel`
  factory, never `makeToon`" (`003:83,162`). 004 must consume the new API.
- The proto-dressing it vaguely replaces lives in `TestArena.addTrees`/
  `addRocks` (`TestArena.ts:123-182`): 8 hardcoded trees + 5 rocks, rock
  rotation via `Math.random()` (`TestArena.ts:169`) — non-deterministic,
  trunk-only colliders. 003 commit 4 deletes TestArena (`003:106-112`).
  So 004 has no existing dressing code to extend; it rebuilds procedurally.

Cross-backlog handoffs 004 must honor:
- `001:54` — props are layer 0 (solid, inverted-hull outline).
- `001:131` — InstancedMesh for props deferred to "future backlog" -> 004.
- `002:68,129` — clouds deferred to future backlog -> 004.
- `003:66` — sand-at-valley-height is "hook for 004 water".
- `003:156` — water + dressing explicitly out of 003, owned by 004.

No RNG/noise exists in `src/` today; `src/core/math.ts` has no `smoothstep`.
Game.dispose is shallow (`Game.ts:49-56`) — no geo/mat/collider teardown
precedent. 004 sets the dispose precedent.

## Goal
Scatter toon-shaded props (trees, bushes, rocks, flowers, grass) across
off-track hills via deterministic seeded placement that samples 003's
`heightAt` so props conform to the surface. Keep the drivable corridor and
spawn point clear. Big props (trees/rocks) get Rapier colliders; decorative
props (flowers/bushes/grass) render as InstancedMesh with no colliders. Add a
drifting low-poly cloud layer overhead and a low-poly cel water plane at
valley height with vertex waves. Every surface on the correct render layer;
full dispose path.

Scope boundary (decided): dressing only — no checkpoints/laps/race UI (that is
"Track 01", per `003:156`). No LOD, no weather particles, no wildlife, no water
buoyancy (water is visual only, kart drives through).

## Architecture (new)

```
src/core/
  rng.ts            # NEW shared: mulberry32(seed)->()=>[0,1); makeRNG(seed)
                    #   -> { next, range(min,max), pick(arr), unit() };
                    #   hashSeed(str)->uint32; smoothstep(e0,e1,x);
                    #   clamp01. Deterministic. Consumed by 003's noise
                    #   (cross-backlog: 003 may swap local copy for this).

src/environment/
  propSampler.ts    # Jittered-grid sampler over world XZ (cell ~3m). For each
                    #   candidate: rng picks cell jitter; sample
                    #   terrain.heightAt(x,z) for y + terrain.normalAt for
                    #   slope; terrain.spline.closestPoint(x,z).dist for
                    #   corridor clearance. REJECT if:
                    #     - dist < trackHalfWidth + corridorMargin
                    #     - slope > maxSlope (keeps big props off cliff faces)
                    #     - within spawnExclusionRadius of spline.startPos()
                    #     - outside world half-extent - edgeMargin
                    #   Returns placed[]: {x,y,z,normal,type,seed,scale}.
  propFactory.ts    # Per-type geometry+material factories. All use
                    #   makeCel({flatShading:true}); addOutline per solid part.
                    #   tree(rng): trunk CylinderGeometry + 2-3 foliage
                    #     IcosahedronGeometry lumps (varied color/scale).
                    #   rock(rng): DodecahedronGeometry, vertex noise via rng.
                    #   bush/flower/grass: single BufferGeometry each for
                    #     InstancedMesh (no per-instance geo).
                    #   Exposes dispose per factory (geo+mat+outline).
  PropField.ts      # Orchestrator. Runs propSampler, spawns:
                    #   - big props (trees/rocks): individual THREE.Mesh +
                    #     fixed Rapier RigidBody + Collider (cylinder for tree
                    #     per TestArena.ts:151-157; ball for rock per
                    #     TestArena.ts:174-180). Layer 0; castShadow+
                    #     receiveShadow. Tracks body handles for dispose.
                    #   - decorative (bushes/flowers/grass): InstancedMesh per
                    #     type, one geo+mat, instance matrices from placed[];
                    #     layer 0; receiveShadow only (no cast — shadow fill).
                    #   Exposes `group: THREE.Group` + dispose() (traverses,
                    #     frees geo/mat, world.removeRigidBody per handle).
  Clouds.ts         # InstancedMesh of squashed IcosahedronGeometry puffs,
                    #   makeCel flatShading. Layer 0. Outline via second
                    #     InstancedMesh (BackSide, inflated) — gated on 001
                    #     outline shader supporting instance matrices (see
                    #     Risks + Contracts). Drift = group.position.x wrap in
                    #     update(dt); altitude fixed at cloudHeight.
  Water.ts          # PlaneGeometry(worldW, waterDepth) at waterLevel (valley
                    #   height, derived from 003 heightmap min / sand band).
                    #   Custom ShaderMaterial (celWater.ts), layer 1,
                    #   receiveShadow, fog:true. update(t) advances uTime.
  celWater.ts       # ShaderMaterial: vertex = sum of 2 directional sines
                    #   (amp small); fragment = 2-3 cel bands on facing ratio +
                    #   depth tint, fresnel rim, consumes lightUniforms.
                    #   dispose(). Layer 1 -> edges get 001's post Sobel.

src/core/Game.ts    # ctor: after Terrain, build Environment = {PropField,
                    #   Clouds, Water}; scene.add(env.group). frame: env
                    #   .update(dt, time) drives cloud drift + water uTime.
                    #   dispose: env.dispose() added to Game.dispose.
```

Layers (extends `001:53-55`, `002:50`):
- 0 = solid (kart + props + clouds): inverted-hull outline
- 1 = terrain + water: post Sobel outline
- 2 = sky: post posterize

## Contracts with 001/002/003 (cross-backlog)
- 001: consume `makeCel({flatShading, vertexColors?})` + fixed screen-space
  `addOutline`. Props + clouds on layer 0; water on layer 1. `lightUniforms`
  (`sunDir/sunColor/ambient`) consumed by celWater. 004 MUST NOT import
  `src/materials/toon.ts`.
- 001 open gate: inverted-hull outline shader must support InstancedMesh
  (read instance matrix attribute) for cloud + decorative-instance outlines.
  If 001's `outline.ts` lacks instancing, 004 adds an instanced variant OR
  drops outline on instanced draws (clouds read as soft cel blobs —
  acceptable). Spike at commit 6; decision logged in docs/troubleshooting/.
- 002: clouds are world geometry on layer 0, below the sky dome (layer 2).
  Fog `0xbcd6ea` 90..360 (`002:126`) applies — clouds at cloudHeight may fog
  out; mitigation in Risks. Sun-disc overlay (002 opt-in) unaffected.
- 003: consume `Terrain.heightAt/normalAt`, `Terrain.spline.closestPoint`,
  world half-extent 100, `trackHalfWidth 6`, `blendWidth 8`. waterLevel from
  003 sand-valley band (`003:66`). Palette aligned to 003
  (`grass 0x6aa84f / rock 0x7d8a96 / sand 0xc2b280`) so props read as the
  same world.
- 003 RNG: 004 ships `src/core/rng.ts` first; proposes 003 swap its local
  noise RNG for it. Non-blocking; cross-note in 003 Defaults.

## Commits (each atomic + green: typecheck + lint + test per 001 harness)
1. `feat(core): add seeded rng.ts (mulberry32) + smoothstep`
   - `src/core/rng.ts`; tests: same seed -> same seq (determinism);
     `range`/`pick`/`unit`; `hashSeed` stable; `smoothstep` edges (0,1,clamp).
2. `feat(environment): add propSampler (jittered grid + corridor rejection)`
   - `propSampler.ts` over `Terrain.heightAt`/`normalAt`/`spline.closestPoint`;
     tests: rejects `dist < trackHalfWidth + corridorMargin`; rejects spawn
     exclusion radius; rejects out-of-bounds; deterministic given seed.
3. `feat(environment): add propFactory (tree/rock/bush/flower/grass)`
   - `propFactory.ts`; `makeCel({flatShading:true})`; per-part `addOutline`;
     tests: returns geo+mat per type; dispose frees; grep: 0
     `MeshStandardMaterial`, 0 `toon.ts` imports.
4. `feat(environment): add PropField (big props + InstancedMesh decor)`
   - `PropField.ts`; Rapier colliders (cylinder/ball per TestArena pattern);
     InstancedMesh for bushes/flowers/grass; layer 0; shadow policy per
     Defaults; dispose traversal + body removal; tests: collider count ==
     placed big-prop count; instance count > 0 per decor type; dispose
     zeroes the group + removes bodies.
5. `feat(environment): add Water + celWater shader on layer 1`
   - `Water.ts` + `celWater.ts`; vertex wave + cel bands + fresnel; uTime;
     layer 1; tests: material is `ShaderMaterial` (not Standard); `update(t)`
     advances uTime; `dispose()` frees material+geo.
6. `feat(environment): add Clouds (instanced low-poly puffs, drift)`
   - `Clouds.ts`; InstancedMesh squashed icosahedron; layer 0; drift wrap;
     spike: instanced inverted-hull outline — if 001 outline shader lacks
     instance-matrix support, ship clouds without outline and log fallback;
     tests: instance count > 0; drift keeps puffs within wrap bounds.
7. `refactor(game): wire Environment + frame update + dispose`
   - `Game.ts`: build `Environment` after Terrain; `scene.add(env.group)`;
     `frame` calls `env.update(dt, time)`; `dispose` calls `env.dispose()`;
     tests: Game wires env; env.update advances water uTime + cloud pos.
8. `docs: update backlog 004 + todo + README for environment dressing`

## Risks
- Instanced inverted-hull outline: 001's outline shader (screen-space t/
  -mvPosition.z, view-space face normal) must read instance matrices for
  clouds + instanced decor. If not, fallback = no outline on instanced draws
  (clouds as soft cel blobs — acceptable). Spike @c6.
- Prop conformity: props seat via `heightAt` at build; 003 guarantees mesh +
  heightfield derive from one `heightAt`, so props agree with both by
  construction. Verify via `PhysicsWorld.castRayDown` (`PhysicsWorld.ts:33-56`)
  at a sample of prop bases; log to `docs/troubleshooting/`.
- Dispose ordering: Rapier bodies/colliders created in PropField must be
  removed on dispose (`world.removeRigidBody`/`removeCollider`). No precedent
  (`Game.dispose` is shallow, `Game.ts:49-56`). 004 sets it; track handles.
- InstancedMesh shadows: thousands of flower instances casting shadows blows
  the shadow map. Mitigation: castShadow=false for all instanced decor;
  receiveShadow=false on decor (fill cost). Only trees/rocks cast.
- Cloud fog-out: clouds at cloudHeight inside fog far 360 dim toward horizon.
  Mitigation: `fog:false` on cloud material, OR cloudHeight tuned so puffs
  read against sky bands. Decide at visual verify spike.
- Water vs kart: water is visual-only (no collider, no buoyancy). Kart may
  drive through valleys -> through the water plane. Acceptable arcade
  behavior; flagged in Defaults. Buoyancy out of scope.
- Determinism: scrub the `Math.random()` pattern (`TestArena.ts:169`); 004
  uses `rng.next()` exclusively. Test guard: same seed -> identical placement.
- Corridor margin tuning: too small -> props clip road edge; too large ->
  bare border. Default 3m, tunable in Defaults.

## Acceptance
- [ ] `src/core/rng.ts` + `src/environment/{propSampler,propFactory,PropField,
      Water,celWater,Clouds}.ts` present
- [ ] 0 imports of `src/materials/toon.ts`; 0 `MeshStandardMaterial` (grep)
- [ ] Props conform to terrain: `castRayDown` at sample prop bases within eps
      of terrain height; logged in `docs/troubleshooting/`
- [ ] Drivable corridor clear: no placed prop with
      `dist < trackHalfWidth + corridorMargin` (sampler test green)
- [ ] Spawn point clear: no prop within `spawnExclusionRadius` of
      `spline.startPos()`
- [ ] Trees/rocks have Rapier colliders; flowers/bushes/grass have none
- [ ] Decorative props via InstancedMesh; draw-call count well below
      individual-mesh baseline (logged)
- [ ] Water plane at valley height, cel-shaded on layer 1, vertex waves
      animate via uTime
- [ ] Clouds drift overhead, wrap world bounds, cel-shaded on layer 0
- [ ] `dispose()` frees geometries/materials/textures + removes Rapier bodies
- [ ] `npm run typecheck && lint && test` green; pre-commit hook green
- [ ] No black screen at `npm run dev`; visual verify via material-count +
      pixel-sample fallback (per
      `docs/troubleshooting/2026-06-20_visual-verification-fallback.md`)

## Defaults
- seed: 1337 (deterministic)
- world half-extent: 100 (per 003); edgeMargin: 4
- sampler: jittered grid cell ~3m; max attempts/cell 4
- corridorMargin: 3 (props kept >= `trackHalfWidth + 3` from spline)
- spawnExclusionRadius: 12 around `spline.startPos()`
- maxSlope: ~35 deg (big props kept off cliff faces)
- counts (tunable): trees ~120, rocks ~80, bushes ~200, flowers ~1500,
  grass ~3000
- scale jitter: ±20% via rng
- colliders: tree -> `cylinder(halfH=1.5, r=0.6)` (`TestArena.ts:151-157`);
  rock -> `ball(r*0.85)` (`TestArena.ts:174-180`); friction 0.8,
  restitution 0.1
- waterLevel: valley height (003 sand band; derive from 003 heightmap min)
- water: 2 cel bands, fresnel rim, wave amp 0.15m, 2 sine dirs, layer 1,
  no collider, fog:true
- clouds: count ~24, cloudHeight 60, puff `IcosahedronGeometry(6,0)` squashed
  y*0.4, drift 2 m/s, wrap at half-extent+20, layer 0, outline gated (Risks)
- shadows: trees/rocks cast+receive; instanced decor receive-only no-cast;
  water receive-only; clouds no shadow
- layers: props + clouds layer 0; water layer 1
- palette aligned to 003: foliage greens around `0x6aa84f`, rock `0x7d8a96`
- out of scope: checkpoints/laps (Track 01), LOD, weather particles, wildlife,
  water buoyancy

## Previous implementation
None shipped for 004. Proto-dressing lived in `TestArena.addTrees`/`addRocks`
(`TestArena.ts:123-182`): 8 hardcoded trees + 5 rocks, non-deterministic rock
rotation (`Math.random()`, `TestArena.ts:169`), trunk-only colliders. Deleted
by 003 commit 4. 004 rebuilds procedurally on 003 terrain.

## Depends on
001 (`makeCel` + fixed `addOutline` + `lightUniforms` + layer system; deletes
`toon.ts`). 002 (sky layer 2 + fog/horizon; clouds coexist below sky dome).
003 (`Terrain.heightAt`/`normalAt`/`spline` + sand-valley hook for water +
deletes `TestArena`). Must land after all three.
