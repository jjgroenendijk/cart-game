# 084 Circuit layout diversity

Generated circuits read too similar: near-constant width, laterally level
road, barely any elevation. Add real variety along five axes, staged as
atomic commits on one branch (lowest risk first, banking last):

1. Explicit mainline grade cap (`MAIN_GRADE_MAX = 0.14`) + stronger
   elevation (amp 3–12 m, `elevAmpScale`/`elevHillBias` knobs).
2. Curvature-aware width choreography: wide corner entry, pinch at apex,
   wide start straight; harmonics stay as texture.
3. Per-seed layout archetypes: classic / flow / technical / power via
   `MainlineOpts` bases lerping to the tamed endpoint; per-archetype
   "interesting" gates; `GeneratedCircuit.archetype`.
4. Stronger per-biome `TrackTraits`: wider width spreads, `elevationScale`,
   `hillBias`, archetype weights.
5. Banking: pure `generateBankProfile` from curvature (masked in start
   zone, junctions, XZ-near sections), kart upright retargeted to the
   averaged suspension contact normal, bank baked into the
   `SplineFieldCache` `pathY` grid (mesh == collider by construction).

Deferred:

- AI bank speed bonus in `src/race/aiSpeed.ts` (unmodified AI is ~10%
  conservative on banked sweepers — safe).
- Banked branches; banked hairpins (proximity mask keeps them level).
- Branch width profiles (branches keep a single constant halfWidth).
