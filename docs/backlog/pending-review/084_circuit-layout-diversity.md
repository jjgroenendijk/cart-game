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

Retune round (in-game feedback: first cut read MORE boring — too few
corners, too many straights, samey elevation):

- Denser corner recipes: `MainlineOpts.scatterRange` (hull corner density),
  technical scatter 14–20 + chicanes 5–6 + c8 gate, power gains a
  guaranteed hairpin; default + biome archetype weights lean technical.
- Chicane hosting loosened (min edge 56 m, kind-specific exclusion radii)
  and every recipe draws more chicanes — classic included, dropping
  pre-084 seed preservation (XZ layouts change for all seeds).
- Per-seed elevation character: amp scale 0.75–1.5 + 30% hill-bias seeds
  from an elevation sub-seed; third profile harmonic (2.6–4.2 cycles).

Deferred:

- AI bank speed bonus in `src/race/aiSpeed.ts` (unmodified AI is ~10%
  conservative on banked sweepers — safe).
- Banked branches; banked hairpins (proximity mask keeps them level).
- Branch width profiles (branches keep a single constant halfWidth).
