# 2026-06-21 — 002 procedural sky reimplementation

Tracking execution of `open/002_procedural-sky.md` (scratch branch
`feat/002-procedural-sky`).

Env notes: jsdom (vitest) has NO WebGL — Renderer/WebGLRenderer cannot
instantiate under test. Each ShaderPass under test asserts shader source +
uniforms + RT structure, not GL output. Pure math helpers (e.g.
posterizeChannel, sunWorldPosition) extracted for unit tests.

Visual verify via Chrome DevTools MCP: dev server on localhost:5173,
read pixels via 2d-context drawImage of the canvas (per the
preserveDrawingBuffer workaround documented in
2026-06-21_001-cel-shading.md).

## Commit 1 — skyPosterize.ts

- Plan says "Reads 001's depth RT; mask = (depth >= 1.0 - eps)". Spike:
  001's postOutline.normalDepthRT renders layer 1 only (terrain) -> does
  NOT include layer 0 (kart + props) or sky. Contract "001 depth RT
  includes sky pixels" fails. Fallback per plan: dedicated layer-2 sky
  RT. Inverting: dedicated non-sky RT (layers 0+1) -> mask = depth==1.0
  is sky. Cheaper than a layer-2-only RT (posterize reads main color
  buffer, only needs a depth mask).
- SkyPosterizePass renders non-sky (layers 0+1) depth via override
  depth-write material -> DepthTexture -> fragment mask
  `depth >= 1.0 - uDepthEps`. uSkyBands default 4. nonSkyLayersMask
  default 0b011.
- Initial posterize math: `floor(color * uSkyBands) / uSkyBands` matches
  cel.ts convention. Pure helper `posterizeChannel(value, bands)` mirrors
  GLSL.
- Pass order: RenderPass -> PostOutlinePass -> OutputPass ->
  SkyPosterizePass. OutputPass renders sRGB to writeBuffer;
  SkyPosterizePass reads sRGB, posterizes sky pixels, writes to screen.
  EffectComposer flips renderToScreen on the new tail automatically.

## Commit 2 — sky layer 2 + composer wiring

- Sky moved to layer 2 via `this.sky.layers.set(2)`. RenderPass needs
  camera.layers.enable(2) so the full-scene pass sees sky.
- Sobel already excludes sky: postOutline renders layer 1 only AND its
  Sobel mask is `depth < 0.999`. Sky on layer 2 -> not in normalDepthRT
  -> depth = 1.0 -> Sobel skips. No postOutline change needed.
- SkyPosterizePass appended after OutputPass in initComposer.

## Commit 3 — single sunDirection via lightUniforms

- lightUniforms gains uSunDirWorld (world space, source of truth).
  Default computed from elev=28, azimuth=135 (old Renderer constants)
  so visual behavior is unchanged.
- updateLightUniforms copies sunDirWorld into both uSunDirWorld and
  uSunDir (view-space transformed).
- Renderer: delete SUN_ELEVATION/SUN_AZIMUTH + private sunDirection
  field. Read lightUniforms.uSunDirWorld.value everywhere.
- Pure helper sunWorldPosition(dir, target, distance) =
  target.copy(dir).multiplyScalar(distance). Test covers setShadowTarget
  math without needing Renderer instantiation.

## Commit 4 — Ghibli palette

- Hemisphere sky 0x9fd0ff -> 0xb8e0ff; ground 0x6a7a4a -> 0x80905a.
- DirectionalLight 0xfff1d6 -> 0xffe8b0; intensity 2.4 -> 2.0.
- Fog unchanged (0xbcd6ea) at this point.

## Visual verify — naive posterize fails (OWED accepted)

- Pixel-sampled sky region: natural Preetham gradient after ACES is
  [227-238, 235-240, 240-242] across the whole visible sky. ~10 RGB
  units total variation -> naive floor(color\*4)/4 collapses all sky
  pixels to one band ([191,191,191] gray).
- Root cause: chase cam looks down at the kart (~17 deg pitch). Visible
  sky is a thin slice near the horizon -> Preetham gradient is narrowest
  there -> ACES compresses the narrow range to ~1 color step.
- Tuning rayleigh 1.6 -> 3.5, exposure 1.0 -> 0.85 moved the raw values
  by ~5 RGB units. Still collapsed to one posterize band. Color-only
  posterize cannot produce visible bands in this camera angle.

## Commit 5 — skyPosterize pivot to synthetic gradient blend

- Replaced naive color posterize with UV.y-banded synthetic gradient
  mix. Reason: the plan's "posterize stock Preetham -> 4 bands" assumption
  fails empirically in the chase-cam view.
- Shader: `t = clamp((vUv.y - uSkyStart) / (1 - uSkyStart), 0, 1)` ->
  `band = floor(t * uSkyBands) / (uSkyBands - 1)` ->
  `synthetic = mix(uSkyHorizon, uSkyZenith, band)` ->
  `color = mix(color, synthetic, uBandMix)`.
- uSkyStart default 0.75 (chase-cam visible sky occupies vUv.y ~[0.75,
  1.0]; spreads the 4 bands across that range).
- uSkyZenith default 0x4a8fcf (deep blue); uSkyHorizon default 0xfde8c0
  (warm cream); uBandMix default 0.85 (mostly synthetic, retains 15%
  natural Preetham variation for sun-direction tint).
- Pure color posterize helper (posterizeChannel) kept for the cel.ts
  parity test.
- Verified: pixel sample at center column shows 4 distinct visible
  bands: deep blue (zenith) -> slate blue -> warm gray -> cream
  (horizon). Matches 002 plan acceptance "~4 discrete bands".

## Commit 6 — fog retint

- Pixel sample at left-edge column (no kart blocking): visible horizon
  sky bottom is band 0 cream [248, 210, 150]; distant terrain fades to
  fog color near the horizon.
- Old fog 0xbcd6ea (pale cool blue) matched NO visible sky band.
- New fog 0xb6ad9e matches visible band 1 (warm gray [181, 172, 157])
  within 1 RGB unit. Closer to the warm haze the synthetic gradient
  produces -> less jarring horizon seam.
- Visible sky bands (chase cam, uSkyStart=0.75): zenith [49,95,171],
  band2 [115,133,164], band1 [181,172,157] == fog, band0 [248,210,150].

## OWED: sun-disc visibility

- Plan acceptance: "Visible flat sun disc (preserved through posterize
  OR overlay sprite)".
- uBandMix=0.85 synthetic blend mostly obscures the natural Preetham
  sun spot. Sun-disc visibility will need the overlay-sprite fallback
  (plan Architecture "Sun-disc fallback"). Deferred to a follow-up; not
  blocking 002 main acceptance.
