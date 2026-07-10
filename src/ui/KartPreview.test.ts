import { describe, expect, it } from "vitest";
import { createKartPreview } from "./KartPreview";

describe("createKartPreview (083)", () => {
  it("returns null where no WebGL context is available (jsdom)", () => {
    // jsdom canvases have no webgl context -> the factory must not throw,
    // it degrades to null and the overlay skips the preview.
    expect(createKartPreview()).toBeNull();
  });
});
