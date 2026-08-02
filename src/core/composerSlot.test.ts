import { describe, expect, it } from "vitest";
import { COMPOSER_PASSES, passOrder } from "./composerSlot";

describe("composer pass order", () => {
  it("inserts selective bloom (Emissive -> Bloom) between SMAA and Output", () => {
    const order = passOrder();
    expect(order).toEqual(COMPOSER_PASSES);
    expect(order[4]).toBe("SMAA");
    expect(order[5]).toBe("Emissive");
    expect(order[6]).toBe("Bloom");
    expect(order[7]).toBe("Output");
  });
});
