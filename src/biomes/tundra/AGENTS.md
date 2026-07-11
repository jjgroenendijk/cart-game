# Tundra Biome

The nordic register: cold mist, snow plains, low pale sun, dark pine,
iron outline. This mood belongs to tundra alone.

Art style + vibe guide (the contract for palette, mood, and future
per-biome music/audio): `docs/knowledge/biomes/tundra.md`. Framework rules:
`../AGENTS.md`; wiki index: `@docs/knowledge/biomes/index.md`.

## Directory Map

```text
./src/biomes/tundra/
├── biome.ts       # BiomeDefinition: terrain/flora/weather/sky/track data
├── flora.ts       # prop builders; registerFlora at module load
└── flora.test.ts  # jsdom suite (no WebGL)
```

## Biome Fan-Out

```mermaid
flowchart LR
  def[biome.ts data] --> world[terrain cfg + weather + sky bias + track]
  flora[flora.ts builders] --> registry[floraRegistry]
  vibe[vibe guide docs/knowledge/biomes/tundra.md] --> art[palette + mood]
  vibe --> music[future biome audio]
```

Everything unique to this biome (definition, flora, future biome-only
effects/audio) lives in this dir. Keep palette + mood changes in sync
with the vibe guide in the same commit.
