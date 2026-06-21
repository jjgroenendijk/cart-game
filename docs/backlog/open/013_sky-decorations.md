# 013 Clouds + sky decorations

Status: open (concept — to be refined)

## Context

002 explicitly deferred clouds (`002:75-79` "No clouds (matches prior
`002:19-21`; future backlog)") and owed a sun-disc overlay sprite
(`002:67-71` Architecture "Sun-disc fallback"; acceptance `[~]` — the
synthetic gradient blend at uBandMix=0.7 mostly obscures the natural
Preetham sun spot). 002's smooth gradient sky (post cc82523) is a flat
backdrop — reads clean but empty. Cel direction 001 + the painted sky
demand matching stylized decor, not photoreal cloud volumes.

Kept separate from 010 (dynamic world) because clouds + sun-disc are
fixed-sky decor; 010 owns time-of-day + weather, which consume this
item's cloud field as an input (clouds tint + density become
time-of-day dependent).

## Goal

Stylized sky decor matching the 001 cel + 002 painted-sky look:

- Clouds: cel-shaded billboards or low-poly volumes (not photoreal
  volumes). Drift slowly across the sky. Tunable density + altitude.
  Rendered on the sky layer (layer 2) so they ride with the existing
  SkyPosterize mask contract.
- Sun-disc overlay sprite: additive unposterized quad on layer 2 above
  the gradient blend (002 plan "Sun-disc fallback" — owed).
- Optional: birds (distant silhouettes), sky-islands / floating terrain
  (style-dependent — open question).
- Optional: aerial particles (dust motes, drifting leaves) — needs
  scoping against 010 wildlife/particles.

## Non-goals

- Volumetric cloud rendering (photoreal; clashes with cel direction).
- Time-of-day cycle + weather (010 owns this; 013 ships fixed noon-ish
  sun + cloud field, 010 will tint/density-drive them later).
- Cloud shadows on the ground (cascade shadow work — belongs in 011
  perf/shadow budget if anywhere).
- Procedural cloud simulation (fluid advection etc.) — billboards or
  sculpted meshes only.
- Moon / stars (needs night sky; deferred to 010).

## Dependencies

001 (cel materials + render layers). 002 (sky layer 2 + SkyPosterize
mask contract + uSkyStart visible-sky range). 005 (audio — optional
wind/cloud cue, soft dep). 010 (forward dep — 010 will drive cloud
tint/density via time-of-day + weather).

No gameplay deps. Consumes the 002 sky layer; cloud decor rides the
same depth-mask contract (sky = depth == 1.0).

## Needs refinement

- Cloud representation: billboarded sprites (cheapest), sculpted
  low-poly meshes (most cel-faithful), or imposter-volumetric (middle
  ground)? Each has different cel-shading integration.
- Cel-shading clouds: do clouds use CelMaterial (001) with flatShading,
  or a custom shader? Clouds are not solid props — translucency + soft
  rim are part of the look.
- Drift model: world-space cloud plane that follows the kart (infinite
  scroll), or sky-dome-relative placement? Former reuses Sky
  transformations; latter is more flexible.
- Sky layer interaction: clouds on layer 2 means SkyPosterize's
  depth pre-pass (layers 0+1) sees them as sky -> posterize blend
  applies to cloud pixels too. Either: (a) put clouds on a new layer 3
  excluded from the mask (clean), (b) draw clouds AFTER SkyPosterize
  in the composer chain, (c) accept the blend and tune uBandMix.
- Sun-disc: pure additive sprite vs simple textured quad with rim glow.
  Size + screen-space vs world-space placement.
- Bird / wildlife silhouettes: in scope here, or fold into 010 wildlife?
- Particle budget + draw-call count: how many cloud instances before
  011's budget is blown? Needs InstancedMesh vs individual Meshes call.
- Sky-islands: Ghibli reference vs realism reference — pick a visual
  direction at refinement.

## Open questions

- Does the cloud field own its own pass / shader, or reuse CelMaterial
  with a cloud-specific setup?
- Sun-disc overlay: 2D screen-space sprite tracking the projected sun
  position, or world-space mesh parented to the Sky dome?
- Should clouds cast soft shadows on the kart/terrain? (Visually great
  but cost-heavy — likely defer to 011 shadow work.)
- Day/night handoff: how does 010 take ownership of the cloud field
  without coupling 013 to 010's weather state machine?
