---
type: Subsystem
title: Waterfall
description: "World-fixed cel waterfall landmark (cliff, sheet, mist, pool) for the autumn biome."
tags: [environment, waterfall, landmark, shader, biome]
timestamp: 2026-07-14T00:00:00Z
---

# Schema

`Waterfall` (`src/environment/Waterfall.ts`) is a world-FIXED atmospheric
landmark. It mirrors the `Weather` module contract — `group: THREE.Group`,
`update(dt, focusX, focusZ)`, `dispose()` — so `Environment` wires it into the
same per-frame cascade. Unlike `Weather`, it does NOT follow the focus: it sits
at `opts.position` and never moves. The `focusX/focusZ` update args are accepted
for contract symmetry and ignored.

Self-contained: the cliff supplies its own vertical rock, so the landmark needs
no terrain relief. All geometry/material construction is WebGL-free (jsdom-safe);
only rendering needs a GL context, and `update()` merely advances scalar uniforms.

## Layers

| Layer | Build                           | Animation                |
| ----- | ------------------------------- | ------------------------ |
| Cliff | `makeCel` flat-facet box massif | static                   |
| Sheet | 2 planes, raw `ShaderMaterial`  | uTime scrolls noise down |
| Mist  | GPU `THREE.Points` field        | uTime wrap, rises, fades |
| Pool  | cel disc + foam-ring shader     | uTime breathes the foam  |

- Cliff: dark WET rock (`0x3a4550`), `flatShading` facets, `bands:3`, `fog` +
  `aerial` on so it recedes into the atmosphere colour. A main block (extended
  below y=0 so it never floats) plus two seed-jittered ledges break the
  silhouette. Base vertices are pinned flat by `jitter` so the massif stays
  grounded.
- Sheet: bright white-cyan (`0xd6f0f4`), value-noise quantized into `uBands`
  cel brightness bands, foam (`0xf2fbfd`) at the side edges + the splash base.
  Two planes at slightly different depth/opacity/scroll-speed give parallax.
- Mist: soft round sprites (radial `gl_PointCoord` falloff), `depthWrite:false`,
  `frustumCulled:false` — the same soft-flake approach as
  `Weather.buildField`. Upward `velocity.y` + horizontal sway; `vLife` fades
  each puff as it nears the top of its rise column.
- Pool: a cel disc (`0x6fb0be`) for the calm water body plus a `RingGeometry`-free
  foam shader (`CircleGeometry` masked by radius) that ripples the rim with a
  `uTime`-driven value-noise.

## Fog

Every animated material sets `fog:true` and declares `fogColor/fogNear/fogFar`
uniforms behind `#ifdef USE_FOG`, the proven `celWater`/`Weather` pattern:
three.js pushes scene fog into those uniforms each frame and the fragment fades
distant fragments via `smoothstep(fogNear, fogFar, -vViewPos.z)`. The cliff +
pool disc use `makeCel({ fog:true, aerial:true })` for the same haze plus aerial
perspective (art-direction Atmosphere law).

## Options

`WaterfallOptions` (all optional, sensible defaults):

| Option      | Default        | Meaning                             |
| ----------- | -------------- | ----------------------------------- |
| `position`  | `[40, 0, -40]` | world anchor of pool centre / base  |
| `height`    | `30`           | cliff + sheet height (m)            |
| `width`     | `12`           | cliff + sheet width (m)             |
| `scale`     | `1`            | uniform scale of the whole landmark |
| `mistCount` | `700`          | mist particle count                 |
| `seed`      | `0`            | cliff jitter + mist layout seed     |

`update()` accumulates a monotonic `elapsed` (exposed via the `elapsed` getter,
asserted in tests) and fans it out to every animated `ShaderMaterial.uTime`.
`dispose()` frees all geometries + materials and clears the group; idempotent.

## Environment gate

`Environment` builds the waterfall ONLY when the resolved biome id is `autumn`
(`def?.id === "autumn"`). Any other biome — or none — leaves
`Environment.waterfall` undefined, so the scene graph and update path are
bit-identical to pre-waterfall behaviour (parity). It is added LAST to
`this.group` so the existing child indices (0..6: dressing..wildlife) tests
depend on stay stable; the autumn waterfall is child index 7. `update()` and
`dispose()` null-guard it (`this.waterfall?.…`). Options flow via
`EnvironmentOptions.waterfall` and are consulted only on the autumn path.

# Cross-References

- [Weather](/environment/weather.md) — the module contract this mirrors
- [Water](/environment/water.md) — cel water shading + fog pattern
- [Cascade](/environment/cascade.md) — Environment update order
- [Art Direction](/conventions/art-direction.md) — cel bands + atmosphere law
