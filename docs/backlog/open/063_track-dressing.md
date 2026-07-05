# 063 Track dressing: checkered start line + finish-flag gantry

Status: open (full plan; ready for execution)

## Context

The circuit itself is the least-dressed thing in the game. The road is a
vertex-color band painted into the terrain (`terrain/heightmap.ts`:
corridor within `trackHalfWidth: 6`, road->grass smoothstep over
`blendWidth: 8`) — and that is ALL it is. Consequences:

- The start/finish line is invisible. The grid spawns karts (KartGrid)
  and the lap counter flips at an unmarked point on a uniform gray
  ribbon; the most-seen spot in every race has zero landmark.
- There is nothing vertical anywhere on the circuit: no gantry, no flag.
  The world got biomes, wildlife, weather; the racetrack never got
  racetrack.

Everything needed is already public: `SplineTrack.getPoint(t)` gives the
centerline pos; the tangent comes from `curve.getTangent(t)`; terrain
`heightAt`/`normalAt` (HeightSource) conform geometry to the ground — the
exact recipe 053's SkidMarks uses for ground-conformed quad strips on
layer 1 with polygonOffset. Vertical props follow the PropField idiom:
cel-material meshes on layer 0, base-conformed to the ground. All of it
is field-scoped and deterministic from the circuit, so `FieldBuilder`
build/dispose is the natural owner (mirrors minimap/audio/skid wiring).

Constraints: zero committed assets (all geometry procedural); 100%
cel/outline look; 057/059 make circuits procedural with variable width
incoming — placement must read the track object + width config, never
hard-code the default loop.

## Goal

Every circuit shows a landmark at the start/finish: a checkered
start/finish line painted on the road under a gantry whose crossbar
flies one large waving checkered finish flag. Deterministic from the
track, rebuilt with the field, cel-consistent, and cheap (two added
draw calls).

## Non-goals

- No corner chevron boards and no edge dashes (trimmed from the original
  063 scope). The road band + the start-line landmark are enough.
- No gameplay change except two static gantry-post colliders at the road
  edge (cylinder, fixed; clear of the normal racing line).
- No sponsor boards, grandstands, or crowd.
- No per-biome dressing variants in v1 (one neutral kit everywhere).
- No minimap markers (minimap already shows the spline; unchanged).

## Architecture (change)

```text
src/environment/
  trackDecals.ts     # NEW PURE (no THREE): buildStartLine(pose, probe)
                     #   returns {positions, colors, indices} for a 2 x N
                     #   checkered quad grid across the road at t=0,
                     #   conformed via probe.heightAt + probe.normalAt
                     #   lift (053 SkidMarks recipe). jsdom-tested:
                     #   checker alternation, conform lift, determinism.
  TrackDressing.ts   # NEW GL owner, field-scoped. Owns its scene
                     #   membership (ctor adds group; dispose removes)
                     #   to keep FieldBuilder wiring under its 600-line
                     #   cap (590 today).
                     #   - decal mesh: BufferGeometry from buildStartLine,
                     #     CelMaterial vertexColors, layer 1, polygonOffset.
                     #   - gantry: two posts + crossbar (procedural cel
                     #     geometry, layer 0) + inverted-hull outline.
                     #   - flag: one large checkered quad grid hanging
                     #     from the crossbar; a custom wave ShaderMaterial
                     #     (sine of local-y + uTime, amplitude ramped 0 at
                     #     the fixed top edge -> max at the free bottom;
                     #     reads lightUniforms so it darkens at night like
                     #     celWater). Checker via vertex colors.
                     #   - posts: two fixed Rapier cylinder colliders at
                     #     road-edge + margin (PropField createBody idiom).
                     #   - update(time): advances flag uTime.
                     #   - dispose(): frees GL + outline + both post bodies.
src/core/
  FieldBuilder.ts    # build/dispose/update TrackDressing next to skid
                     #   marks; passes terrain + physics + halfWidth
                     #   (TRACK_HALF_WIDTH). Net delta ~5 lines (590/600).
```

## Look targets (cel discipline)

- Start line: 2 rows x ~12 columns of checker across the full road
  width, near-white/near-black vertex colors (LINEAR, matching terrain
  vertex colors), crisp Sobel edge from layer 1.
- Gantry: two posts + box crossbar spanning the road at the start line,
  biome-neutral dark steel; silhouette reads from the whole back
  straight.
- Flag: one large B/W checkered finish flag hanging from the crossbar
  centre, waving slowly (amplitude ramps from the fixed top edge). The
  iconic checkered motif reads unambiguously as "finish" from a
  distance.

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(env): pure checkered start-line decal builder`
   - `trackDecals.ts` + tests: checker color alternation, road-width
     coverage, conform lift along normalAt, determinism, buffer sizes.
2. `feat(env): start-line decal + checkered-flag gantry dressing`
   - `TrackDressing.ts` (decal mesh + gantry + waving flag + post
     colliders) + FieldBuilder wiring + update(time) hook. Tests: merged
     geometry counts, flag wave shader source, post body add/remove
     symmetry, dispose releases GL.
3. `docs: AGENTS refresh + backlog move`
   - `src/AGENTS.md` + `src/environment/AGENTS.md` notes; move 063 to
     pending-review.

## Risks

- Z-fighting on slopes: same exposure as 053 skid marks; same fix
  (normalAt lift + polygonOffset), verify on alpine (steepest biome).
- Variable-width circuits (059) land later: halfWidth is a parameter
  read from the track config at build; when 059 introduces per-t width,
  buildStartLine takes a width(t) fn — signature designed for it now.
- Branching circuits (060): sites derive from one closed loop today;
  start line stays defined by the race manager's t=0.
- Redundancy: the checkered flag + checkered ground line use the same
  motif adjacent. Acceptable (the flag is vertical, the line is on the
  road); if review reads it as clutter, drop the ground line to a plain
  white stop-bar so the flag owns the checker.
- Gantry collision: posts sit at road edge + margin outside halfWidth so
  a clean racing line never clips them; AI corridor (checkpoints)
  already keeps rivals inside the road band.
- Draw calls: 2 added meshes (decal, gantry+flag); the flag is its own
  material (wave shader). Well under the dressing budget.

## Acceptance

- [ ] Checkered start line at the grid, conformed to the road, crisp at
      all four 042 phases; lap flip point now visibly marked.
- [ ] Gantry spans the road at the start line with one large waving
      checkered finish flag; no kart-vs-post collision on a normal line.
- [ ] Deterministic: same circuit -> byte-identical decal + gantry.
- [ ] Field rebuild (biome/circuit change) fully disposes and rebuilds
      dressing; no GL or physics leaks (dispose symmetry test).
- [ ] <= 2 added draw calls per view; low tier fps unchanged (F3).
- [ ] All files <= 600 lines; `npm run verify` + hooks green.

## Verification

- F3 laps on temperate/desert/alpine/tundra + 2-3 procedural seeds:
  start line + gantry silhouette + flag wave readability.
- Rebuild loop: cycle biomes + circuits in the menu 10x, watch
  geometries/textures counters for leaks.
- 2P split-screen at the start grid on low tier.
- `npm run verify:changed` per commit; `npm run verify` at the end.

## Depends on

Nothing hard. Reads SplineTrack (loop + samples), HeightSource
(heightAt/normalAt), 053's ground-conform recipe. Composes with 057/059
(procedural circuits get dressing for free), 052 (start-line still), 042
(time-of-day verify).
