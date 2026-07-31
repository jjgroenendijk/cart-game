import { describe, expect, it } from "vitest";
import { COMPOSER_PASSES_NO_BLOOM, COMPOSER_PASSES_WITH_BLOOM, passOrder } from "./composerSlot";

describe("composer pass order (231)", () => {
  it("includes Bloom between SMAA and Output when bloom is on", () => {
    const order = passOrder(true);
    expect(order).toEqual(COMPOSER_PASSES_WITH_BLOOM);
    expect(order[4]).toBe("SMAA");
    expect(order[5]).toBe("Bloom");
    expect(order[6]).toBe("Output");
  });
  it("omits Bloom entirely when bloom is off (low tier, byte-identical to pre-231)", () => {
    const order = passOrder(false);
    expect(order).toEqual(COMPOSER_PASSES_NO_BLOOM);
    expect(order).not.toContain("Bloom");
    // SMAA -> Output still adjacent.
    expect(order[4]).toBe("SMAA");
    expect(order[5]).toBe("Output");
  });
});
