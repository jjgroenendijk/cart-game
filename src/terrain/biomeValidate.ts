import { type BiomeDefinition, biomeTerrain, MAX_BIG_PROPS_PER_CHUNK } from "./biomes";

/** Severity of a validation finding. Errors block; warns are advisory. */
export type ValidationLevel = "error" | "warn";

/**
 * One problem found by {@link validateBiome}. `code` is a stable short id so a
 * runbook/failure message can name it without parsing prose.
 */
export interface ValidationFinding {
  level: ValidationLevel;
  code: string;
  msg: string;
}

/**
 * Injected dependencies for {@link validateBiome}. terrain/ is lower-level than
 * environment/, so the flora registry + weather preset keys are passed in here
 * rather than imported (keeps the layer dependency pointing one way). The
 * dynamic checks (drivability, water floor) need a real heightAt + corridor;
 * when either is absent those checks SKIP.
 */
export interface ValidateCtx {
  /** Registered flora kind names (from floraRegistry.registeredFloraKinds()). */
  registeredKinds: ReadonlySet<string>;
  /** Whether a kind is a big prop (from floraRegistry.floraFor(kind).big). */
  isBigKind: (kind: string) => boolean;
  /** Known weather preset keys (WeatherPreset union, from weatherPresets). */
  knownWeatherKeys: ReadonlySet<string>;
  /**
   * Max big props allowed per chunk. Defaults to MAX_BIG_PROPS_PER_CHUNK when
   * omitted; tests inject a smaller value to trip FLORA_COUNT on a fixture.
   */
  bigPerChunkCap?: number;
  /**
   * Optional world height fn (the real heightAt). When absent, water +
   * drivability checks SKIP.
   */
  heightAt?: (x: number, z: number) => number;
  /**
   * Optional corridor sample points [x,z] along the track centerline. When
   * absent, drivability SKIPS.
   */
  corridor?: ReadonlyArray<readonly [number, number]>;
}

// --- threshold constants (each names its source) ---------------------------

/**
 * Kart suspension travel (DEFAULT_TUNING.suspensionTravel in KartController).
 * Hardcoded (not imported) so terrain/ stays free of a kart/ dep. A single
 * corridor step the suspension cannot absorb reads as a wall.
 */
const KART_SUSPENSION_TRAVEL = 0.25;

/**
 * Max tolerable single-step |dy| along the corridor. Source: 4x kart
 * suspension travel (0.25) = 1.0. The shipped spline peaks at ~0.80m per
 * sample (~5.9m spacing), so it passes with ~0.20 headroom; a cliff over one
 * sample is a wall the suspension cannot absorb.
 */
const STEP_DELTA_CAP = KART_SUSPENSION_TRAVEL * 4;

/**
 * Max tolerable grade (|dy| / horizontal step) along the corridor. Source:
 * arcade drivability cap (tan ~14 deg). The shipped spline peaks at ~0.129,
 * so it passes well under 0.25. Guards the shared track against a future
 * spline that turns into a near-vertical wall.
 */
const GRADE_CAP = 0.25;

/**
 * LINEAR-rgb Euclidean contrast floor for adjacent cel bands. Source: shipped
 * cel bands - the tightest shipped pair is alpine road-vs-grass at ~0.118;
 * 0.10 sits just below it so all four shipped biomes read. Warn (not error):
 * palette is a soft heuristic, never a hard block.
 */
const PALETTE_CONTRAST_FLOOR = 0.1;

// --- sRGB -> LINEAR (private copy of heightmap.ts srgbToLinear) ------------
// Copied rather than imported so this module stays decoupled from heightmap's
// internals; the formula matches three.js ColorManagement exactly.

function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function hexToLinear(hex: number): [number, number, number] {
  return [
    srgbToLinear(((hex >> 16) & 0xff) / 255),
    srgbToLinear(((hex >> 8) & 0xff) / 255),
    srgbToLinear((hex & 0xff) / 255),
  ];
}

function linearDist(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Validate a BiomeDefinition against injected context. Pure (no module side
 * effects, no registration). Returns findings; empty = clean. Static checks
 * always run; dynamic checks (DRIVE_GRADE, WATER_FLORA_SUNK) run only when
 * ctx.heightAt + ctx.corridor are provided.
 *
 * NOTE on biome-independence of the corridor: heightAt on the track centerline
 * == pathY (the spline y; terrain noise weight w=0 on-track), so the corridor
 * profile is BIOME-INDEPENDENT by construction. DRIVE_GRADE is therefore a
 * SPLINE-drivability guard (validates the shared track is drivable), not a
 * biome-specific check. The biome-specific relief (noise) lives off-corridor
 * and is what WATER_FLORA_SUNK's floor sampling touches.
 */
export function validateBiome(def: BiomeDefinition, ctx: ValidateCtx): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const cap = ctx.bigPerChunkCap ?? MAX_BIG_PROPS_PER_CHUNK;

  // --- FLORA_NEG (error): a negative count is malformed data. ---
  for (const f of def.flora) {
    if (f.count < 0) {
      findings.push({
        level: "error",
        code: "FLORA_NEG",
        msg: `flora kind "${f.kind}" has negative count ${f.count}`,
      });
    }
  }

  // --- FLORA_UNKNOWN (error): a kind not in the registry is a typo that
  //     would make PropField throw at placement time. ---
  for (const f of def.flora) {
    if (!ctx.registeredKinds.has(f.kind)) {
      findings.push({
        level: "error",
        code: "FLORA_UNKNOWN",
        msg: `flora kind "${f.kind}" is not registered`,
      });
    }
  }

  // --- FLORA_COUNT (error): per-chunk big-prop streaming budget. Big props
  //     merge into spatial buckets; too many starves the bucket/LOD budget. ---
  let bigSum = 0;
  for (const f of def.flora) {
    if (ctx.isBigKind(f.kind)) bigSum += f.count;
  }
  if (bigSum > cap) {
    findings.push({
      level: "error",
      code: "FLORA_COUNT",
      msg: `big-prop sum ${bigSum} exceeds per-chunk cap ${cap}`,
    });
  }

  // --- WEATHER_NEG (error): a negative weight corrupts the cumulative pick. ---
  for (const [key, w] of Object.entries(def.weather)) {
    if (w < 0) {
      findings.push({
        level: "error",
        code: "WEATHER_NEG",
        msg: `weather key "${key}" has negative weight ${w}`,
      });
    }
  }

  // --- WEATHER_UNKNOWN (error): selectWeatherPreset SILENTLY filters unknown
  //     keys, so a typo means the weight never applies. ---
  for (const key of Object.keys(def.weather)) {
    if (!ctx.knownWeatherKeys.has(key)) {
      findings.push({
        level: "error",
        code: "WEATHER_UNKNOWN",
        msg: `weather key "${key}" is not a known preset`,
      });
    }
  }

  // --- WEATHER_SUM (error): sum <= 0 -> selectWeatherPreset returns "clear",
  //     so the biome silently always-clears regardless of authored weights. ---
  let weatherSum = 0;
  for (const w of Object.values(def.weather)) weatherSum += w;
  if (weatherSum <= 0) {
    findings.push({
      level: "error",
      code: "WEATHER_SUM",
      msg: `weather weight sum ${weatherSum} <= 0 (biome always-clears)`,
    });
  }

  // --- PALETTE_READABILITY (warn): LINEAR-space contrast floor between
  //     road-vs-grass AND grass-vs-rock. Cel bands must read; the floor is
  //     derived from the four shipped biomes (all pass). Soft heuristic. ---
  const cfg = biomeTerrain(def);
  const road = hexToLinear(cfg.colorRoad);
  const grass = hexToLinear(cfg.colorGrass);
  const rock = hexToLinear(cfg.colorRock);
  const rg = linearDist(road, grass);
  const gr = linearDist(grass, rock);
  if (rg < PALETTE_CONTRAST_FLOOR || gr < PALETTE_CONTRAST_FLOOR) {
    findings.push({
      level: "warn",
      code: "PALETTE_READABILITY",
      msg:
        `cel-band contrast low: road-grass ${rg.toFixed(3)},` +
        ` grass-rock ${gr.toFixed(3)} (floor ${PALETTE_CONTRAST_FLOOR})`,
    });
  }

  // --- dynamic checks: need a real heightAt + corridor. ---
  if (ctx.heightAt && ctx.corridor && ctx.corridor.length >= 2) {
    const h = ctx.heightAt;
    const corr = ctx.corridor;

    // --- DRIVE_GRADE (error): walk the corridor; a step or grade beyond the
    //     suspension-derived caps is an undrivable wall. See corridor note
    //     above (this guards the shared spline, not biome relief). ---
    let maxStep = 0;
    let maxGrade = 0;
    for (let i = 0; i < corr.length; i++) {
      const a = corr[i]!;
      const b = corr[(i + 1) % corr.length]!;
      const ya = h(a[0], a[1]);
      const yb = h(b[0], b[1]);
      const dy = Math.abs(yb - ya);
      const horiz = Math.hypot(b[0] - a[0], b[1] - a[1]);
      maxStep = Math.max(maxStep, dy);
      if (horiz > 1e-9) maxGrade = Math.max(maxGrade, dy / horiz);
    }
    if (maxStep > STEP_DELTA_CAP) {
      findings.push({
        level: "error",
        code: "DRIVE_GRADE",
        msg: `corridor max step ${maxStep.toFixed(3)} exceeds cap ${STEP_DELTA_CAP}`,
      });
    }
    if (maxGrade > GRADE_CAP) {
      findings.push({
        level: "error",
        code: "DRIVE_GRADE",
        msg: `corridor max grade ${maxGrade.toFixed(3)} exceeds cap ${GRADE_CAP}`,
      });
    }

    // --- WATER_FLORA_SUNK (warn): if the sampled terrain floor is below
    //     waterLevel, flora bases sit underwater (backlog 043 data case). ---
    if (def.waterLevel !== undefined) {
      let floor = Infinity;
      for (const [x, z] of corr) floor = Math.min(floor, h(x, z));
      if (floor < def.waterLevel) {
        findings.push({
          level: "warn",
          code: "WATER_FLORA_SUNK",
          msg:
            `terrain floor ${floor.toFixed(2)} below waterLevel ` +
            `${def.waterLevel} (flora sunk; 043)`,
        });
      }
    }
  }

  return findings;
}
