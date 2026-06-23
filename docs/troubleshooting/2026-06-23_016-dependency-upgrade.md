# 016 dependency upgrade

## Scope

Backlog 016 dependency upgrade from Node 20-era toolchain to Node 24-era deps.
Commits before this note already covered CI/dependabot, patch deps, ESLint 10,
TypeScript 6, Vite 8, Vitest 4/jsdom 29, and Three r184.

## Rapier 0.19.3 heightfield probe

Re-ran the 003 flat-heightfield downward ray probe after bumping
`@dimforge/rapier3d-compat` to 0.19.3.

- Test grid: 19x19 downward rays over a flat y=5 heightfield.
- Result without flags: 144 hits, 217 misses, worst hit height error 0.
- Result with `HeightFieldFlags.FIX_INTERNAL_EDGES`: 144 hits, 217 misses,
  worst hit height error 0.

Decision: keep the terrain collider as a trimesh. The old 0.14 heightfield ray
bug still reproduces on 0.19.3, and the kart suspension relies on downward
raycasts.

## Audit residue

After Vite/Vitest upgrades, `npm audit --audit-level=moderate` reports only
`markdownlint-cli2` transitive `js-yaml` and `markdown-it` advisories. npm's
suggested fix downgrades `markdownlint-cli2` to 0.12.1, so this was not folded
into 016.

## Verify notes

Headless gates passed per dependency tier. Browser/gameplay QA still needed for
the high-risk runtime bumps:

- Three r184: shader, outline, sky posterize, split-screen render.
- Rapier 0.19.3: kart suspension, prop collisions, terrain collider, walls.
