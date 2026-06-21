# 002 Procedural sky + lighting pass (reimplementation)

Status: pending-review (implemented 2026-06-21 on branch feat/002-procedural-sky)

## Context

Prior impl shipped as `pending-review/002` commit 7865277. Stock three.js
Preetham `Sky` (`three/addons/objects/Sky.js`) + synced sun directional.
Typecheck clean, no console errors. But:

- Codebase-wide reimpl mandate: current code buggy across the board; 001
  already reopened for same reason.
- Physical Preetham gradient is photoreal -> clashes with cel direction 001
  sets. Target = Wind Waker / Ghibli: banded painted sky, flat sun.
- Renderer-local `SUN_ELEVATION`/`SUN_AZIMUTH` (`Renderer.ts:7-8`) -> dup
  sun vector. 001 introduces shared `lightUniforms.ts`; 002 must consume it
  or two sources of truth persist.
- Visual verify never completed (prior `002` Acceptance OWED): sun-disc +
  gradient unconfirmed. Verify script had `THREE is not defined` bug
  (verify-script bug, not game's).

## Goal

Ghibli / Wind Waker sky on top of stock Preetham:

- stock `Sky` retained (no custom sky ShaderMaterial) -> keep free
  ACESFilmic tonemap, sidestep linear-output risk 001 flags at `001:108-110`
- posterize pass scoped to sky pixels -> ~4 discrete bands zenith->horizon
- visible flat sun disc
- single shared sun direction (consume 001's `lightUniforms`)
- lighting retune (fog + hemisphere + directional) -> Ghibli palette
- sky on own render layer, excluded from 001's Sobel outline pass

## Architecture (extends 001)

001 delivers (`001:36-50`):

- `src/materials/lightUniforms.ts` — shared `sunDir`, `sunColor`, `ambient`
- `src/core/Renderer.ts` rewrite — `EffectComposer`, normal/depth RT,
  layer-aware render (layer 0 solid, layer 1 terrain)

002 extends:

- `src/materials/skyPosterize.ts` — ShaderPass: posterize(depth-masked) sky
  pixels. Reads 001's depth RT; mask = (depth >= 1.0 - eps). uSkyBands
  uniform default 4. Runs after tonemap.
- `src/core/Renderer.ts` — Sky mesh on camera.layers mask 2. Insert
  skyPosterize at end of 001's composer chain. Delete
  `SUN_ELEVATION`/`SUN_AZIMUTH` (`Renderer.ts:7-8`) -> read
  `lightUniforms.sunDir`. Sky sunPosition, DirectionalLight position,
  `setShadowTarget` all consume one vector.

Layers (extends `001:53-55`):

- 0 = solid (kart + props): inverted-hull outline
- 1 = terrain/walls: post Sobel outline
- 2 = sky: post posterize (this backlog)

Posterize mask contract with 001:

- 001's depth RT must render with sky pixels present (depth ~1.0 at far
  plane). If 001 renders depth RT with camera.layers mask excluding sky,
  fall back to dedicated layer-2 sky RT -> posterize -> composite. Decide
  at integration spike (commit 2).

Sun-disc fallback:

- Posterize smooth Preetham to 4 bands may collapse soft sun spot into one
  band -> no visible disc. If visual verify shows no disc, add additive
  unposterized sun-disc quad/sprite on layer 2 above posterize pass. Off
  by default; opt in via `Renderer({skySunDisc:true})`.

## Non-goals

- No custom sky ShaderMaterial (keep stock Preetham + post).
- No PMREM / `scene.environment` (cel ShaderMaterials from 001 won't read
  it; revisit only if 001 declares in-scope).
- No clouds (matches prior `002:19-21`; future backlog).
- No time-of-day cycle (fixed sun, matches prior).

## Commits (each atomic + green: typecheck + lint + test)

1. `feat(materials): add skyPosterize ShaderPass`
   - GLSL posterize fn, depth-masked, uSkyBands uniform (default 4)
   - tests: output snaps to ceil(uSkyBands) steps for known gradient;
     non-sky pixels (depth < 1.0) untouched
2. `feat(render): wire sky layer + posterize into composer`
   - Sky mesh on layer 2; insert pass at end of 001's composer chain
   - sky excluded from 001's Sobel outline pass
   - integration spike: confirm 001 depth RT includes sky pixels; else
     fallback to dedicated layer-2 sky RT
   - test: composer chain contains skyPosterize; Sobel pass skips layer 2
3. `refactor(render): single sunDirection via lightUniforms`
   - delete `SUN_ELEVATION`/`SUN_AZIMUTH` from `Renderer.ts:7-8`
   - read `lightUniforms.sunDir`; Sky sunPosition, DirectionalLight
     position, `setShadowTarget` all consume one vector
   - test: DirectionalLight position aligns with Sky sunPosition within eps
4. `style(render): retune fog/hemisphere/directional for Ghibli palette`
   - palette consts updated (see Defaults); visual verify in browser
   - pixel-sample horizon seam: fog matches a posterized sky band
5. `docs: update backlog 002 + todo + README for reimplementation`

## Risks

- Posterize band count (4) vs cel band count (3, `001:126`) -> visual
  rhythm clash. Tunable via uniforms. Spike at commit 2.
- Tonemap order: stock Sky -> renderer ACESFilmic -> composer posterize.
  Posterize post-tonemap sRGB is correct for Ghibli. Confirm at visual
  verify; if band edges drift, swap order (needs sky pre-tonemap RT — costly).
- Fog/horizon seam: fog color must equal a posterized horizon band or
  visible seam appears. Pixel-sample during verify, log in
  `docs/troubleshooting/`.
- Depth mask false positives: distant background geometry at depth ~1.0
  posterizes as sky. Mitigation: mask = `depth == 1.0` exact (sky at far
  plane), not `>= threshold`.
- Sun-disc collapse: posterize may kill soft Preetham sun spot. Fallback =
  additive sun-disc sprite (see Architecture).

## Acceptance

- [x] Stock `Sky` from `three/addons/objects/Sky.js` retained (grep: no
      custom sky ShaderMaterial added)
- [x] Sky renders as ~4 discrete bands zenith->horizon (Ghibli) — pixel
      sample: deep blue zenith, slate, warm gray, cream horizon
- [~] Visible flat sun disc — OWED: synthetic blend at uBandMix=0.85
      mostly obscures the natural Preetham sun spot. Sun-disc overlay
      sprite fallback (plan Architecture) deferred to a follow-up; not
      blocking main acceptance.
- [x] Single shared sun vector: SUN_ELEVATION/SUN_AZIMUTH deleted;
      `lightUniforms.uSunDirWorld` drives Sky + DirectionalLight + shadow
- [x] Sky on render layer 2; excluded from 001's Sobel outline pass
      (postOutline renders layer 1 only AND its Sobel mask is depth < 0.999)
- [x] Posterize affects sky pixels only; cel objects unaffected
- [x] Fog color matches a posterized horizon band — fog 0xb6ad9e matches
      visible band 1 [181,172,157] within 1 RGB unit; pixel-sample
      confirmed, logged in `docs/troubleshooting/2026-06-21_002-procedural-sky.md`
- [x] `npm run typecheck && lint && test` green; pre-commit hook green
      (34/34 tests)
- [x] No black screen at `npm run dev`; visual verify via Chrome DevTools
      MCP pixel-sampling

## Implementation (2026-06-21)

Commits (branch `feat/002-procedural-sky`):

- `feat(materials): add skyPosterize ShaderPass` —
  src/materials/skyPosterize.ts (SkyPosterizePass: depth-masked
  posterize ShaderPass + non-sky depth RT for layers 0+1; pure helper
  posterizeChannel mirrors cel.ts band math).
- `feat(render): wire sky layer 2 + posterize into composer` —
  src/core/Renderer.ts: sky.layers.set(2), camera.layers.enable(2),
  SkyPosterizePass appended after OutputPass in initComposer.
- `refactor(render): single sunDirection via lightUniforms` —
  src/materials/lightUniforms.ts gains uSunDirWorld + sunWorldPosition
  helper. Renderer drops local SUN_ELEVATION/SUN_AZIMUTH/sunDirection;
  reads lightUniforms.uSunDirWorld for Sky sunPosition, DirectionalLight
  position, setShadowTarget.
- `style(render): retune hemisphere + directional for Ghibli palette` —
  hemisphere sky 0x9fd0ff -> 0xb8e0ff, ground 0x6a7a4a -> 0x80905a;
  DirectionalLight 0xfff1d6 -> 0xffe8b0, intensity 2.4 -> 2.0.
- `fix(materials): pivot skyPosterize to synthetic gradient blend` —
  naive floor(color*uSkyBands)/uSkyBands collapsed the whole visible
  sky to one gray band (chase-cam pitch ~17 deg -> visible sky is a
  thin horizon slice -> ACES compresses it to ~1 color step). Replaced
  with UV.y-banded synthetic gradient mix: uSkyStart default 0.75,
  uSkyZenith 0x4a8fcf, uSkyHorizon 0xfde8c0, uBandMix 0.85.
- `style(render): retint fog to match visible horizon sky band` —
  fog 0xbcd6ea -> 0xb6ad9e (matches synthetic band 1 warm gray
  [181,172,157] within 1 RGB unit).
- `docs: update backlog 002 + todo + README for reimplementation` — this
  commit.

Exec decisions (resolved at exec):

- Mask source: 001's postOutline normalDepthRT is layer 1 only, does
  NOT include sky pixels. Per plan, fallback to dedicated RT. Inverted
  the fallback (non-sky depth RT for layers 0+1) so the composer color
  buffer passes through and only the mask is computed in the pre-pass.
  Cheaper than a sky-only RT.
- Single sun vector: uSunDirWorld stored in lightUniforms as the world-
  space source of truth. uSunDir (view-space) derived per-frame for
  cel/rim math. elev=28/azimuth=135 constants moved from Renderer to
  lightUniforms (defaultSunDirWorld) to preserve prior visual behavior.
- Synthetic gradient vs pure posterize: plan assumed posterizing stock
  Preetham gives visible bands. Empirically false in the chase-cam
  view (visible sky too narrow a slice). Deviation documented in
  `docs/troubleshooting/2026-06-21_002-procedural-sky.md`; stock Sky
  mesh + depth-mask contract preserved; only in-band color replaced
  via uBandMix.
- uSkyStart default 0.75: chase-cam sky occupies vUv.y ~[0.75, 1.0] in
  the visible region. Lower values compress the gradient (only bands
  2-3 visible); higher values spread it but band 0 dominates.
- Sun-disc visibility owed: uBandMix=0.85 mostly obscures the natural
  Preetham sun spot. Overlay sprite fallback (plan Architecture) is
  the documented remedy; deferred to a follow-up.

## Defaults

- uSkyBands: 4 (visible band count across the [uSkyStart, 1] range)
- uSkyStart: 0.75 (lower bound of the visible-sky vUv.y range; per cam)
- uSkyZenith: 0x4a8fcf (deep sky blue)
- uSkyHorizon: 0xfde8c0 (warm cream)
- uBandMix: 0.85 (mostly synthetic, 15% natural Preetham variation)
- uDepthEps: 1e-4 (depth == 1.0 tolerance for the sky mask)
- nonSkyLayersMask: 0b011 (layers 0 + 1 occlude the mask)
- sky layer: 2 (0 solid / 1 terrain / 2 sky — extends `001:53-55`)
- hemisphere: sky 0xb8e0ff / ground 0x80905a, i 1.0
- sun directional: 0xffe8b0, i 2.0
- fog: 0xb6ad9e (band 1 warm gray), 90..360
- posterize order: after tonemap, in composer
- sun-disc overlay: off by default; opt in via `Renderer({skySunDisc:true})`
  (future follow-up — not yet implemented)
- clouds, time-of-day: out of scope (future backlog)

## Previous implementation

Superseded. Originally commit 7865277 — stock `Sky` from
`three/addons/objects/Sky.js` in `src/core/Renderer.ts` with local
`SUN_ELEVATION`/`SUN_AZIMUTH` constants + hemisphere/directional/fog tuning.
File rewritten across commits 1-6 above.

## Depends on

000 (harness). 001 (Renderer.ts rewrite + lightUniforms.ts + EffectComposer +
normal/depth RT + layer system). Must land first.
