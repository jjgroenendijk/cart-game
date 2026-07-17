# Beach Biome

Bright-midday sandy coast: near-white warm dunes, dune scrub, bleached
driftwood and leaning coconut palms over a prominent deep ocean — turquoise
shallows fading to open blue. Warm, open, sunlit — the shore, not the jungle.

Art style + vibe guide (the contract for palette, mood, and future
per-biome music/audio): `docs/knowledge/biomes/beach.md`. Framework rules:
`../AGENTS.md`; wiki index: `@docs/knowledge/biomes/index.md`.

## Directory Map

```text
./src/environment/biomes/beach/
├── biome.ts       # BiomeDefinition: terrain/flora/weather/sky/water/track data
├── flora.ts       # prop builders; registerFlora at module load
└── flora.test.ts  # jsdom suite (no WebGL)
```

## Biome Fan-Out

```mermaid
flowchart LR
  def[biome.ts data] --> world[terrain cfg + weather + sky bias + water + track]
  flora[flora.ts builders] --> registry[floraRegistry]
  vibe[vibe guide docs/knowledge/biomes/beach.md] --> art[palette + mood]
  vibe --> music[future biome audio]
```

Everything unique to this biome (definition, flora, future biome-only
effects/audio) lives in this dir. Keep palette + mood changes in sync
with the vibe guide in the same commit.
