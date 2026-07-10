# 2026-07-10 — 159 sun light effects (fresh reimplementation)

Subject: reimplement the cinematic sun light effects (halo, god rays, lens
flare) for GitHub issue #159 after the earlier 074 attempt was rejected.

## Why not revive 074

074 (`feat/074-bloom-sky-halo`, PR #109, closed unmerged) added an
`UnrealBloomPass` on the linear HDR buffer plus a screen-space god-ray pass,
and also removed the terrain Sobel outline pass. It "looked really bad": bloom
whited out / read neon against the flat cel palette (several "dial back bloom
to stop whiteout" fix commits on that branch never landed a good look), and
dropping the outlines violated the art-direction line law. Do NOT resurrect
that branch.

## Approach taken

No global HDR bloom. All three effects are ANALYTIC additive terms folded into
the existing final `SkyPosterizePass` fragment (post-tonemap sRGB), reusing its
`tDepth` sky/occlusion mask — no new render target, no `UnrealBloomPass`. Each
effect sits behind a gain uniform defaulting to 0, so the neutral path is
byte-identical to pre-159. See `docs/knowledge/materials/sun-effects.md`.

- Halo: gaussian sun-disc glow, sky-masked (terrain hard-cuts it).
- God rays: 32-step screen-space march of the sky mask toward the sun,
  distance-decayed; guarded so the disabled path skips the loop.
- Lens flare: procedural ghosts + streak along the sun->center axis; default
  OFF (a camera artifact the flat cel look does not always want).

Gains = `effectGain(tierStrength, userEnabled, glowIntensity(...))`. Strengths
are restrained (<= 0.5 on high) and the shared `glowIntensity` day-phase weight
fades everything to 0 at night and peaks at low sun elevation. Each effect is a
user toggle in Settings (`effects.sunHalo/godRays/lensFlare`).

## Runtime verification

Built `dist/` + drove it in headless Chrome (Playwright). `gl.getError()` = 0 at
both high-noon and static-dusk (the new fragment compiles + renders cleanly; a
shader-compile failure would have broken the whole scene). Menu screenshots:
day view clean with cel colors intact; dusk view shows a warm painted sky + a
soft horizon glow bleeding where the low sun sits — soft painted light, no
whiteout, no neon. Only console error is the browser's default favicon 404
(unrelated). Effect intensity is intentionally restrained; final tuning is left
to the per-effect Settings toggles.
