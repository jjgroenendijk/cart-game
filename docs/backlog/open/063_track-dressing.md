# 063 Track dressing: start line, gantry, edge stripes, chevrons

Status: open (full plan; ready for execution)

## Context

The circuit itself is the least-dressed thing in the game. The road is a
vertex-color band painted into the terrain (`terrain/heightmap.ts`:
corridor within `trackHalfWidth: 6`, road->grass smoothstep over
`blendWidth: 8`) — and that is ALL it is. Consequences:

- The start/finish line is invisible. The grid spawns karts (KartGrid)
  and the lap counter flips at an unmarked point on a uniform gray
  ribbon; the most-seen spot in every race has zero landmark.
- Corners have no signage. AI and humans read curvature from geometry
  alone; a cel racer wants the classic red/white chevron boards on the
  outside of bends — they are both pretty AND functional driver info.
- The road has no edge definition beyond the color smoothstep, so on
  low-contrast biomes (tundra snow, desert sand) the drivable band
  melts into the terrain at speed.
- There is nothing vertical anywhere on the circuit: no gantry over the
  start line, no flags. The world got biomes, wildlife, weather; the
  racetrack never got racetrack.

Everything needed is already public: `SplineTrack.getPoint(t)` +
`closestPoint` give centerline pos; tangents come from finite
differences of `getPoint` (the curve is arc-length sampled); terrain
`heightAt`/`normalAt` (HeightSource) conform geometry to the ground —
the exact recipe 053's SkidMarks uses for ground-conformed quad strips
on layer 1 with polygonOffset. Vertical props follow the PropField
idiom: cel-material meshes on layer 0 with inverted-hull outlines,
authored base-at-y=0, placed at raw terrain height. All of it is
field-scoped and deterministic from the circuit, so `FieldBuilder`
build/dispose is the natural owner (mirrors minimap/audio wiring).

Constraints: zero committed assets (all geometry procedural); 100%
cel/outline look; 037/057/059 make circuits procedural with variable
width incoming — every placement must read the track object + width
config, never hard-code the default loop.

## Goal

Every circuit looks like a racetrack: a checkered start/finish line
under a flagged gantry, dashed edge stripes bounding the corridor, and
red/white chevron boards on the outside of sharp corners. Deterministic
from the track, rebuilt with the field, cel-consistent, and cheap (a
handful of merged draw calls).

## Non-goals

- No gameplay change: no new colliders except the gantry posts (two
  static cylinders, PropField-style); boards are non-colliding so they
  never punish a wide line.
- No sponsor boards, grandstands, or crowd — separate concept if ever.
- No per-biome dressing variants in v1 (one neutral kit everywhere;
  biome variation is a follow-up knob in the flora-registry style).
- No minimap markers (minimap already shows the spline; unchanged).

## Architecture (change)

```text
src/race/
  dressingSites.ts   # NEW PURE (race/ stays Three-scene-free; this is
                     #   math only, Vector3-in/out): given a track +
                     #   {halfWidth}, compute placement sites:
                     #   startLine(t=0): center, tangent, width;
                     #   edgeDashes(spacing, margin): [pos, yaw][] per
                     #   side at halfWidth - margin, skipping dashes
                     #   where |curvature| is extreme (inside of
                     #   hairpins overlaps itself);
                     #   chevronSites(threshold): curvature via finite
                     #   difference of tangents over the sample table,
                     #   clustered spans -> outside-of-bend sites with
                     #   yaw facing oncoming traffic, count scaled by
                     #   span length. jsdom-tested on the default loop
                     #   (known bend count) + a synthetic hairpin.
src/environment/
  trackDecals.ts     # NEW PURE: vertex buffers for ground decals.
                     #   Checkered start line: N x 2 grid of quads with
                     #   2 vertex colors, conformed via heightAt +
                     #   normalAt lift (053 SkidMarks recipe); edge
                     #   dash strip: one merged quad list, road-white.
  TrackDressing.ts   # NEW GL owner, field-scoped:
                     #   - decal mesh: ONE BufferGeometry (start line +
                     #     all dashes merged), CelMaterial with
                     #     vertexColors, layer 1, polygonOffset.
                     #   - boards mesh: ONE merged geometry of chevron
                     #     quads-on-post (red/white vertex-color
                     #     arrows), cel + inverted-hull outline,
                     #     layer 0.
                     #   - gantry: two posts + crossbar over startLine
                     #     (cel boxes/cylinders, layer 0) + 2-3 flag
                     #     quads whose vertex shader waves them (sine
                     #     of x+time, amplitude ramps from the pole —
                     #     cloth-cheap, same trig budget as celWater).
                     #   - dispose() removes GL + the two post bodies.
src/core/
  FieldBuilder.ts    # build/dispose TrackDressing next to minimap
                     #   wiring; passes track + halfWidth + heightAt/
                     #   normalAt + physics for gantry posts. Wiring
                     #   stays thin (< 25 lines) — FieldBuilder is at
                     #   528/600; if it crowds the cap, land after
                     #   046-style extraction or host wiring in a small
                     #   fieldDressing.ts helper.
```

## Look targets (cel discipline)

- Start line: 2 rows x ~12 columns of checker across the full road
  width, near-white/near-black vertex colors (sRGB->LINEAR like
  terrain colors), crisp Sobel edge from layer 1.
- Edge stripes: short dashes (~1.5 m on, ~2.5 m off), slightly inset,
  off-white; readable at speed, not a continuous line (continuous
  reads as a wall to the eye and doubles the Sobel edge length).
- Chevrons: classic red board, white arrow pointing into the turn,
  ~1.2 m tall on a short post, 2-5 boards per bend scaled by span;
  outline pass gives them the sticker-like cel pop for free.
- Gantry: two posts + box crossbar spanning the road at the start
  line, biome-neutral dark steel color; flags in two accent colors
  waving slowly; silhouette reads from the whole back straight.

## Commits (each atomic + green; gate = typecheck + lint + vitest + hook)

1. `feat(race): pure track dressing sites (start, dashes, chevrons)`
   - `dressingSites.ts` + tests: default-loop bend detection count,
     hairpin cluster/skip rules, dash side offsets, determinism.
2. `feat(env): ground decals - checkered start line + edge dashes`
   - `trackDecals.ts` + `TrackDressing.ts` (decal half) + FieldBuilder
     wiring. Tests: buffer sizes, checker color alternation, conform
     lift along normalAt, dispose releases GL.
3. `feat(env): chevron boards + start gantry with waving flags`
   - Boards + gantry + flag shader + gantry post bodies. Tests: merged
     geometry counts from sites, flag shader source (wave expression),
     post body add/remove symmetry.
4. `docs: AGENTS refresh + backlog move`
   - `src/AGENTS.md` env/race notes; move 063 to pending-review; 052
     scene note (start-line still covers dressing pixels).

## Risks

- Z-fighting on slopes: same exposure as 053 skid marks; same fix
  (normalAt lift + polygonOffset), verify on alpine (steepest biome).
- Variable-width circuits (059) land later: halfWidth is a parameter
  read from the track config at build; when 059 introduces per-t
  width, dressingSites takes a width(t) fn — signature designed for
  it now (accept fn or constant).
- Branching circuits (060): sites derive from one closed loop today;
  API takes "a track" so a branch graph can call it per-edge later.
  Start line stays defined by the race manager's t=0.
- Sobel clutter: many small decals lengthen layer-1 edges. Mitigation:
  dashes are sparse + inset; acceptance includes a visual noise check
  at speed on low-contrast biomes.
- Draw calls: strictly 3 added meshes (decals, boards, gantry+flags);
  flags share the gantry draw via one material + merged geometry with
  the wave amplitude in a vertex attribute (0 on rigid verts).
- Gantry collision surprise: posts sit at road edge +0.5 m outside
  halfWidth so a clean racing line never clips them; AI corridor
  (checkpoints) already keeps rivals inside the road band.

## Acceptance

- [ ] Checkered start line at the grid, conformed to the road, crisp
      at all four 042 phases; lap flip point now visibly marked.
- [ ] Gantry spans the road at the start line with waving flags; no
      kart-vs-post collision on a normal racing line.
- [ ] Edge dashes trace both road edges on every registered biome and
      any 037 procedural circuit seed; spacing stable (no clumping at
      tight curvature).
- [ ] Chevron boards appear only on bends above the curvature
      threshold, outside of the bend, facing oncoming traffic; the
      default loop produces a stable, sensible board set.
- [ ] Deterministic: same circuit -> byte-identical site list (test).
- [ ] Field rebuild (biome/circuit change) fully disposes and rebuilds
      dressing; no GL or physics leaks (dispose symmetry test).
- [ ] <= 3 added draw calls per view; low tier fps unchanged (F3).
- [ ] All files <= 600 lines; `npm run verify` + hooks green.

## Verification

- F3 laps on temperate/desert/alpine/tundra + 2-3 procedural (037)
  seeds: start line, gantry silhouette, dash readability at speed,
  chevron placement sanity on the sharpest bend.
- Rebuild loop: cycle biomes + circuits in the menu 10x, watch
  geometries/textures counters for leaks.
- 2P split-screen at the start grid on low tier (worst draw-call
  moment: all karts + gantry + decals in frame).
- `npm run verify:changed` per commit; `npm run verify` at the end.

## Depends on

Nothing hard. Reads SplineTrack (loop + samples), HeightSource
(heightAt/normalAt), 053's ground-conform recipe (can land in either
order; if 053 lands first, reuse its conform helper instead of
duplicating). Composes with 037/057 (procedural circuits get dressing
for free), 052 (start-line still), 042 (time-of-day verify). Designed
for 059/060 (width fn, per-edge API) without depending on them.
