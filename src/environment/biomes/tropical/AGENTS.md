# Tropical Biome

Golden-hour palm shore: amber horizon, teal shallows, warm sand,
dusk-lazy twisty jungle trails.

Art style + vibe guide (the contract for palette, mood, and future
per-biome music/audio): `docs/knowledge/biomes/tropical.md`. Framework rules:
`../AGENTS.md`; wiki index: `@docs/knowledge/biomes/index.md`.

## Directory Map

```text
./src/environment/biomes/tropical/
├── biome.ts       # BiomeDefinition: terrain/flora/weather/sky/track data
├── flora.ts       # prop builders; registerFlora at module load
└── flora.test.ts  # jsdom suite (no WebGL)
```

## Biome Fan-Out

```mermaid
flowchart LR
  def[biome.ts data] --> world[terrain cfg + weather + sky bias + track]
  flora[flora.ts builders] --> registry[floraRegistry]
  vibe[vibe guide docs/knowledge/biomes/tropical.md] --> art[palette + mood]
  vibe --> music[future biome audio]
```

Everything unique to this biome (definition, flora, future biome-only
effects/audio) lives in this dir. Keep palette + mood changes in sync
with the vibe guide in the same commit.
