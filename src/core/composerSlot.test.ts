import { describe, expect, it } from "vitest";
import { COMPOSER_PASSES, passOrder } from "./composerSlot";

describe("composer pass order", () => {
  it("runs SMAA directly into Output with no scene-wide bloom", () => {
    const order = passOrder();
    expect(order).toEqual(COMPOSER_PASSES);
    expect(order[4]).toBe("SMAA");
    expect(order).not.toContain("Bloom");
    expect(order[5]).toBe("Output");
  });
});
