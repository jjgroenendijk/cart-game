import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCENE_BOOKMARK,
  SCENE_SETTLE_FRAMES,
  parseSceneBookmark,
  readSceneQuery,
  serializeSceneBookmark,
  type SceneBookmark,
} from "./sceneBookmark";
import { PHASE_TO_CYCLE_T } from "./timeOfDayConfig";

describe("sceneBookmark — defaults (052)", () => {
  it("DEFAULT_SCENE_BOOKMARK is temperate/noon/clear/menu/0.5/1-60", () => {
    expect(DEFAULT_SCENE_BOOKMARK).toEqual({
      biome: "temperate",
      cycleT: PHASE_TO_CYCLE_T.noon,
      weather: "clear",
      cam: "menu",
      camT: 0.5,
      time: 1 / 60,
      tod: "noon",
    });
  });

  it("SCENE_SETTLE_FRAMES is 8", () => {
    expect(SCENE_SETTLE_FRAMES).toBe(8);
  });
});

describe("sceneBookmark — parseSceneBookmark (052)", () => {
  it("returns defaults for null/undefined/empty", () => {
    expect(parseSceneBookmark(null)).toEqual(DEFAULT_SCENE_BOOKMARK);
    expect(parseSceneBookmark(undefined)).toEqual(DEFAULT_SCENE_BOOKMARK);
    expect(parseSceneBookmark("")).toEqual(DEFAULT_SCENE_BOOKMARK);
  });

  it("returns a fresh object (not the DEFAULT reference)", () => {
    const a = parseSceneBookmark(null);
    const b = parseSceneBookmark(null);
    expect(a).not.toBe(DEFAULT_SCENE_BOOKMARK);
    expect(a).not.toBe(b);
  });

  it("parses all registered biome ids", () => {
    for (const id of ["temperate", "desert", "alpine", "tundra"]) {
      expect(parseSceneBookmark(`biome:${id}`).biome).toBe(id);
    }
  });

  it("unknown biome falls back to temperate", () => {
    expect(parseSceneBookmark("biome:moon").biome).toBe("temperate");
  });

  it("parses tod presets to the exact PHASE_TO_CYCLE_T fractions", () => {
    for (const [phase, t] of Object.entries(PHASE_TO_CYCLE_T)) {
      const bm = parseSceneBookmark(`tod:${phase}`);
      expect(bm.cycleT).toBe(t);
      expect(bm.tod).toBe(phase);
    }
  });

  it("parses decimal hours to cycleT via the anchor transform", () => {
    expect(parseSceneBookmark("tod:6").cycleT).toBeCloseTo(0);
    expect(parseSceneBookmark("tod:12").cycleT).toBeCloseTo(0.25);
    expect(parseSceneBookmark("tod:18").cycleT).toBeCloseTo(0.5);
    expect(parseSceneBookmark("tod:0").cycleT).toBeCloseTo(0.75);
    expect(parseSceneBookmark("tod:24").cycleT).toBeCloseTo(0.75);
    expect(parseSceneBookmark("tod:9").cycleT).toBeCloseTo(0.125);
  });

  it("round-trips decimal hours through the tod field", () => {
    expect(parseSceneBookmark("tod:9").tod).toBe("9");
    expect(parseSceneBookmark("tod:12.5").tod).toBe("12.5");
  });

  it("bad tod falls back to noon", () => {
    const bm = parseSceneBookmark("tod:???");
    expect(bm.cycleT).toBe(PHASE_TO_CYCLE_T.noon);
    expect(bm.tod).toBe("noon");
  });

  it("parses all 5 weather modes", () => {
    for (const mode of ["auto", "clear", "rain", "snow", "storm"]) {
      expect(parseSceneBookmark(`weather:${mode}`).weather).toBe(mode);
    }
  });

  it("unknown weather falls back to auto (validateWeatherMode default)", () => {
    expect(parseSceneBookmark("weather:hurricane").weather).toBe("auto");
  });

  it("parses cam menu|chase", () => {
    expect(parseSceneBookmark("cam:menu").cam).toBe("menu");
    expect(parseSceneBookmark("cam:chase").cam).toBe("chase");
  });

  it("unknown cam falls back to menu", () => {
    expect(parseSceneBookmark("cam:orbit").cam).toBe("menu");
  });

  it("clamps camT to [0,1]", () => {
    expect(parseSceneBookmark("camT:-1").camT).toBe(0);
    expect(parseSceneBookmark("camT:2").camT).toBe(1);
    expect(parseSceneBookmark("camT:0.3").camT).toBeCloseTo(0.3);
  });

  it("validates time as finite + >= 0", () => {
    expect(parseSceneBookmark("time:0.5").time).toBe(0.5);
    expect(parseSceneBookmark("time:0").time).toBe(0);
    expect(parseSceneBookmark("time:-1").time).toBe(1 / 60);
    expect(parseSceneBookmark("time:abc").time).toBe(1 / 60);
  });

  it("ignores unknown keys", () => {
    const bm = parseSceneBookmark("biome:desert,unknown:x,junk:1");
    expect(bm.biome).toBe("desert");
  });

  it("is order-independent", () => {
    const a = parseSceneBookmark("biome:desert,tod:dusk,weather:storm");
    const b = parseSceneBookmark("weather:storm,biome:desert,tod:dusk");
    expect(a).toEqual(b);
  });

  it("handles tokens with surrounding whitespace", () => {
    const bm = parseSceneBookmark(" biome:alpine , tod: night ");
    expect(bm.biome).toBe("alpine");
    expect(bm.tod).toBe("night");
  });

  it("handles values containing colons gracefully (split on first colon)", () => {
    const bm = parseSceneBookmark("time:0.016,camT:0.5");
    expect(bm.time).toBeCloseTo(0.016);
    expect(bm.camT).toBeCloseTo(0.5);
  });
});

describe("sceneBookmark — serializeSceneBookmark (052)", () => {
  it("emits canonical comma-separated key:value in fixed order", () => {
    const bm: SceneBookmark = {
      biome: "desert",
      cycleT: 0.5,
      weather: "storm",
      cam: "menu",
      camT: 0.5,
      time: 1 / 60,
      tod: "dusk",
    };
    expect(serializeSceneBookmark(bm)).toBe(
      "biome:desert,tod:dusk,weather:storm,cam:menu,camT:0.5,time:0.016666666666666666",
    );
  });

  it("round-trips parse(serialize(bm)) to an equal bookmark (presets)", () => {
    const original = parseSceneBookmark(
      "biome:alpine,tod:dusk,weather:storm,cam:chase,camT:0.25,time:0.5",
    );
    const rt = parseSceneBookmark(serializeSceneBookmark(original));
    expect(rt).toEqual(original);
  });

  it("round-trips parse(serialize(bm)) to an equal bookmark (hours tod)", () => {
    const original = parseSceneBookmark("biome:tundra,tod:9,weather:snow,cam:menu,camT:0.75");
    const rt = parseSceneBookmark(serializeSceneBookmark(original));
    expect(rt).toEqual(original);
  });

  it("round-trips the DEFAULT_SCENE_BOOKMARK", () => {
    const rt = parseSceneBookmark(serializeSceneBookmark(DEFAULT_SCENE_BOOKMARK));
    expect(rt).toEqual(DEFAULT_SCENE_BOOKMARK);
  });
});

describe("sceneBookmark — readSceneQuery (052)", () => {
  it("returns the scene param value from a search string", () => {
    expect(readSceneQuery("?scene=biome:alpine,tod:dusk")).toBe("biome:alpine,tod:dusk");
  });

  it("returns null when scene param is absent", () => {
    expect(readSceneQuery("?foo=bar")).toBeNull();
    expect(readSceneQuery("")).toBeNull();
  });

  it("returns null for undefined/empty when location is unavailable", () => {
    expect(readSceneQuery(undefined)).toBeNull();
    expect(readSceneQuery("")).toBeNull();
  });

  it("decodes percent-encoded colons", () => {
    expect(readSceneQuery("?scene=biome%3Aalpine")).toBe("biome:alpine");
  });
});
