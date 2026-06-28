# 040 CSM + shadow cost

Status: open (concept - to be refined)

## Context

Split from 022 (perf pass), Phase 5.2. Shadow is a single non-cascaded
frustum, full re-render/frame (`core/quality.ts`, `Renderer.ts`). The plan
wanted CSM (cascaded shadow maps) + per-object cast-shadow cull.

Phase 5.2 was deferred on two findings:

- Per-object cast-shadow cull is ALREADY done by three.js:
  WebGLShadowMap.js frustum-culls every `castShadow` object against the
  shadow camera via its boundingSphere each frame. Inventory: terrain
  chunks + decor are receive-only; big-prop buckets + boundary walls +
  kart meshes cast with correct bounds; kartLod already drops castShadow at
  the minimal band. No provably-safe additional cull exists without a
  browser.
- CSM reworks the custom CelMaterial shadow path. `materials/cel.ts` notes
  USE_SHADOWMAP is undefined under the cel setup; CSM injects shadow chunks
  via setupMaterial into materials. Integrating cascaded uniforms into the
  custom shader changes the cel/outline look -> needs live visual verify.

## Goal

Cut shadow-pass cost on large worlds without changing visible shadow
quality. Likely means CSM (better resolution distribution across distance)
rather than more culling.

## Needs refinement

- CSM via three/addons/csm vs a hand-rolled multi-frustum. Decide whether
  the CelMaterial shadow sampling can host cascaded shadow maps (rewrite
  the cel shadow path) or needs a separate shadow-receive path.
- Single tight frustum that follows the action vs cascades - profile which
  wins at the current world scale (200 m).
- Needs browser profiling: a tighter box/sphere cull or CSM can only be
  validated visually (a wrong plane silently cuts visible shadows).
- Interaction with kartLod shadow drop + quality.ts shadow extents.

## Depends on

001 (CelMaterial shadow path). 011 (quality tiers + shadow extents). 022
(deferred here; landed every headless-safe win).
