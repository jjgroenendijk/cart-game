# 085 Biome directories + art/vibe guides

Biome identity was scattered: definitions in `src/terrain/biomes.ts`, flora
in `src/environment/flora/`, and art direction pinned for tundra only.
Restructure so each biome is one directory owning everything unique to it,
with a documented art style that doubles as a vibe guide (and later as the
register for per-biome music/audio).

Done (2 commits):

1. `src/biomes/` framework move: `definition.ts` (types), `registry.ts`
   (`BIOMES` + append-only `BIOME_ORDER` + resolve helpers), `validate.ts`;
   one dir per biome (`temperate/ desert/ alpine/ tundra/ tropical/`) with
   `biome.ts` + `flora.ts` (+ tests). Verbatim moves, no behavior change;
   BIOME_ORDER untouched so stored circuit codes resolve identically.
   Knowledge wiki: new `docs/knowledge/biomes/` bundle (framework,
   validator); terrain/environment AGENTS.md + doc links updated.
2. Art + vibe guides: `docs/knowledge/biomes/<id>.md` per biome (palette
   anchors from code, light/sky register, weather habits, track character,
   music direction for future audio). Per-biome `AGENTS.md` linking its
   guide. `art-direction.md` register table filled for all five; the warm
   default register now explicitly belongs to temperate only, nordic to
   tundra.

Invariants kept:

- Biome-unique effects (flora builders, future biome-only effects/audio)
  live in the biome dir; shared machinery (floraRegistry, propFactory,
  archetypes, weather presets) stays in `src/environment/`.
- Weather preset configs stay central: presets are a shared vocabulary
  (blizzard serves alpine + tundra; rain/snow several) with a parity-
  critical PRESET_ORDER; biome dirs own only their weight tables.

Follow-ups:

- Retune outline color per register table (sepia default, iron for tundra)
  — currently still 0x000000 defaults (noted in art-direction.md).
- Per-biome music/audio driven by each guide's music direction section.
- 029 swamp biome should follow the new dir recipe (task updated).
