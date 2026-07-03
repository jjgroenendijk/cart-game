# 057 Per-biome ambience audio

Status: open (concept - to be refined)

## Context

Ambient audio today is global (wind bed + music); there is no per-biome
ambience. A swamp should murmur (water + insects), a tundra should howl
(cold wind), a tropical world should carry birds. 055's Non-goals defer this
explicitly: the biome identity + validator exist first, ambience is the
follow-up.

## Goal

Each biome defines an ambient bed (birds/wind/water voices) selected from the
biome id, played through the existing audio graph so a world sounds like its
biome without per-biome engine code.

## Needs refinement

- Bed model: one persistent ambient voice per biome swapped on biome change,
  vs a layered mix whose weights track the active biome. Decide cost vs
  crossfade quality.
- Graph home: audio/audioGraph.ts owns voice construction ORDER (load-bearing,
  mock tests assert indices). A biome-ambience bus must slot in without
  perturbing voices -> wind -> music -> collision -> rivals order.
- Data shape: extend `BiomeDefinition` with an `ambience?: {...}` field (pure
  data, like `skyFogBias`/`wildlife`), or reuse `wildlife` kinds? Decide.
- Procedural vs sampled: repo rule is zero committed media -> ambience beds
  must be procedural (oscillator + noise voices, like the existing wind) or
  code-native; no asset files.
- Lifecycle: AudioManager must stay no-op safe before `resume()` (046 rule);
  a biome swap mid-session must crossfade without clicks.

## Depends on

055 (biome identity + validator first). 025 (biome data framework). The
audio graph (audio/audioGraph.ts) + 046 (AudioManager split: bus state +
no-op-before-resume guards). Coordinate with OPEN 017 (wildlife placement ->
a critter voice could ride the same bus).
