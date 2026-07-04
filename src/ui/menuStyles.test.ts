import { describe, expect, it } from "vitest";
import {
  buttonStyle,
  styleMenuButton,
  MENU_CSS,
  MENU_INK,
  PANEL_STYLE,
  SELECTOR_ROW_STYLE,
  CHEVRON_STYLE,
  type ButtonKind,
} from "./menuStyles";

const KINDS: ButtonKind[] = ["primary", "secondary", "ghost"];

describe("menuStyles — shared menu style kit (070)", () => {
  it("every button kind is clickable over a pointer-events:none root", () => {
    for (const kind of KINDS) {
      expect(buttonStyle(kind)).toContain("pointer-events:auto");
      expect(buttonStyle(kind)).toContain("cursor:pointer");
    }
  });

  it("kinds differ: primary is yellow, secondary blue, ghost bordered", () => {
    expect(buttonStyle("primary")).toContain("#ffd23f");
    expect(buttonStyle("secondary")).toContain("#9ad0ff");
    expect(buttonStyle("ghost")).toContain("border:2px solid");
  });

  it("filled kinds use the shared ink text color", () => {
    expect(buttonStyle("primary")).toContain(`color:${MENU_INK}`);
    expect(buttonStyle("secondary")).toContain(`color:${MENU_INK}`);
  });

  it("extra declarations land after the base so they win in cssText", () => {
    const css = buttonStyle("primary", ["font-size:22px"]);
    expect(css.lastIndexOf("font-size:22px")).toBeGreaterThan(css.indexOf("font-size:16px"));
  });

  it("styleMenuButton tags gc-btn + kind class and applies the cssText", () => {
    const btn = document.createElement("button");
    btn.className = "gc-start";
    styleMenuButton(btn, "primary", ["padding:14px 20px"]);
    expect(btn.classList.contains("gc-start")).toBe(true);
    expect(btn.classList.contains("gc-btn")).toBe(true);
    expect(btn.classList.contains("gc-btn-primary")).toBe(true);
    expect(btn.style.pointerEvents).toBe("auto");
    expect(btn.style.padding).toBe("14px 20px");
  });

  it("panel + selector row + chevron opt into pointer events", () => {
    expect(PANEL_STYLE).toContain("pointer-events:auto");
    expect(SELECTOR_ROW_STYLE).toContain("pointer-events:auto");
    expect(CHEVRON_STYLE).toContain("pointer-events:auto");
  });

  it("MENU_CSS covers hover, active, and a visible focus ring", () => {
    expect(MENU_CSS).toContain(".gc-btn:hover");
    expect(MENU_CSS).toContain(".gc-btn:active");
    expect(MENU_CSS).toContain(".gc-btn:focus, .gc-row:focus");
    expect(MENU_CSS).toContain("outline: 3px solid");
  });
});
