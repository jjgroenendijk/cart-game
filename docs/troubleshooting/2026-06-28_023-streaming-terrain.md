# 023: Streaming terrain + dressing verification

## Context

Backlog 023 replaces the bounded 200 m world (wall + fixed PropField +
bounded heightmap) with infinite streaming: signed-grid terrain chunks,
StreamingHeightSource (closestPoint fallback out-of-bounds),
DressingChunkManager (per-chunk PropField), and follow-focus
atmospheric dressing. This file logs the runtime verification plan +
any issues found during manual testing.

## Verification checklist (F3 overlay + visual)

### Terrain streaming

- [ ] Drive past 100 m in all directions (1P + 2P) — terrain extends
      infinitely, no void/black screen.
- [ ] F3: body count stable while roaming 60 s (no monotonic growth ->
      no leak). Record before/after.
- [ ] F3: frame ms stays within budget while roaming (streaming hitch
      on activate is expected; verify no sustained drops).
- [ ] Chunks activate/deactivate smoothly around camera (no pop-in
      within visible range).

### Boundary removal

- [ ] No visible wall at the old 100 m boundary.
- [ ] No Rapier wall colliders (kart drives through freely).

### Height/color seamlessness

- [ ] No visible height step or color discontinuity at the old 100 m
      boundary (StreamingHeightSource uses same formula in + out).
- [ ] Cel bands continuous across chunk seams (world-consistent normals
      from normalAt).

### Two-material cel

- [ ] Near-track chunks show HEIGHT_MAP cel normal (smooth).
- [ ] Far/streamed chunks show vertex-normal cel (slightly coarser but
      no black screen).
- [ ] Transition at the near/far boundary is not jarring.

### Dressing streaming

- [ ] Props (trees, rocks, bushes, flowers, grass) appear past 100 m
      and stream in/out as the camera moves.
- [ ] Revisiting a chunk reproduces identical prop placement
      (coordinate-stable seed).
- [ ] Prop Rapier bodies freed when chunks cull (body count bounded).

### Follow-focus atmospheric

- [ ] Clouds stay overhead while roaming (follow XZ + drift).
- [ ] Weather particles surround the camera (not left at origin).
- [ ] Water plane follows the camera (no edge visible while roaming).

## Issues found

(none yet — pending runtime verification)
