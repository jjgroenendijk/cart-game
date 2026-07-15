import { describe, expect, it } from "vitest";
import { parseDevFlags } from "./devFlags";

describe("devFlags", () => {
  it("parses a full valid query string", () => {
    const q = "?biome=tundra&seed=42&weather=snow&time=dusk&kart=speed&quality=low";
    const flags = parseDevFlags(q);
    expect(flags.biome).toBe("tundra");
    expect(flags.seed).toBe(42);
    expect(flags.weather).toBe("snow");
    expect(flags.time).toBe("dusk");
    expect(flags.kart).toBe("speed");
    expect(flags.quality).toBe("low");
  });

  it("returns all-undefined/false for an empty string", () => {
    const flags = parseDevFlags("");
    expect(flags.biome).toBeUndefined();
    expect(flags.seed).toBeUndefined();
    expect(flags.weather).toBeUndefined();
    expect(flags.time).toBeUndefined();
    expect(flags.kart).toBeUndefined();
    expect(flags.quality).toBeUndefined();
    expect(flags.autostart).toBe(false);
    expect(flags.debug).toBe(false);
    expect(flags.garage).toBe(false);
    expect(flags.freefly).toBe(false);
  });

  it("resolves invalid enum values to undefined (no override, never throws)", () => {
    const q = "?biome=atlantis&weather=hurricane&time=teatime&kart=rocket&quality=ultra";
    const flags = parseDevFlags(q);
    expect(flags.biome).toBeUndefined();
    expect(flags.weather).toBeUndefined();
    expect(flags.time).toBeUndefined();
    expect(flags.kart).toBeUndefined();
    expect(flags.quality).toBeUndefined();
  });

  it("ignores unknown params entirely", () => {
    const flags = parseDevFlags("?foo=bar&nonsense=1");
    expect(flags).toEqual({
      biome: undefined,
      seed: undefined,
      weather: undefined,
      time: undefined,
      kart: undefined,
      quality: undefined,
      autostart: false,
      debug: false,
      garage: false,
      freefly: false,
    });
  });

  it("matches enum values case-insensitively", () => {
    const flags = parseDevFlags("?biome=Tundra&weather=SNOW&time=Dusk&kart=Speed&quality=LOW");
    expect(flags.biome).toBe("tundra");
    expect(flags.weather).toBe("snow");
    expect(flags.time).toBe("dusk");
    expect(flags.kart).toBe("speed");
    expect(flags.quality).toBe("low");
  });

  it("treats boolean flags as true when present, false otherwise", () => {
    const flags = parseDevFlags("?autostart&debug&garage&freefly");
    expect(flags.autostart).toBe(true);
    expect(flags.debug).toBe(true);
    expect(flags.garage).toBe(true);
    expect(flags.freefly).toBe(true);
  });

  it("treats a boolean flag with any value (even empty) as present/true", () => {
    const flags = parseDevFlags("?autostart=&debug=yes");
    expect(flags.autostart).toBe(true);
    expect(flags.debug).toBe(true);
  });

  it("accepts weather=auto (a valid choice) and biome/kart across the vocabulary", () => {
    expect(parseDevFlags("?weather=auto").weather).toBe("auto");
    expect(parseDevFlags("?biome=autumn").biome).toBe("autumn");
    expect(parseDevFlags("?kart=trail").kart).toBe("trail");
    expect(parseDevFlags("?quality=med").quality).toBe("med");
  });

  it("parses seed as a base-10 integer and drops NaN/absent", () => {
    expect(parseDevFlags("?seed=42").seed).toBe(42);
    expect(parseDevFlags("?seed=-7").seed).toBe(-7);
    expect(parseDevFlags("?seed=3.9").seed).toBe(3);
    expect(parseDevFlags("?seed=abc").seed).toBeUndefined();
    expect(parseDevFlags("?seed=").seed).toBeUndefined();
    expect(parseDevFlags("").seed).toBeUndefined();
  });

  it("works without a leading '?' (raw search body)", () => {
    expect(parseDevFlags("biome=desert&seed=1").biome).toBe("desert");
    expect(parseDevFlags("biome=desert&seed=1").seed).toBe(1);
  });
});
