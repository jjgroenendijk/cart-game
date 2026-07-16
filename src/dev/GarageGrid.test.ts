/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { createGarageGrid } from "./GarageGrid";

describe("createGarageGrid (agent-tooling)", () => {
  it("returns null where no WebGL context is available (jsdom)", () => {
    // jsdom canvases have no webgl context -> the factory degrades to null
    // without throwing, mirroring createGarage / createKartPreview.
    expect(createGarageGrid(document.createElement("div"))).toBeNull();
  });
});
