import { describe, expect, it } from "vitest";
import {
  buttonStyle,
  styleMenuButton,
  MENU_CSS,
  MENU_INK,
  INK,
  INK_MUTED,
  PANEL_INK,
  HAIRLINE,
  SERIF_STACK,
  PANEL_STYLE,
  SELECTOR_ROW_STYLE,
  CHEVRON_STYLE,
  kickerLabel,
  kickerRow,
  hairlineRule,
  displayHeading,
  displayAccent,
  telemetryRow,
  telemetryKey,
  telemetryValue,
  statusDot,
  cornerMark,
  vignetteLayer,
  grainLayer,
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

  it("kinds differ neutrally: primary near-white fill, others hairline-bordered", () => {
    expect(buttonStyle("primary")).toContain(`background:${INK}`);
    expect(buttonStyle("secondary")).toContain(`border:1px solid ${HAIRLINE}`);
    expect(buttonStyle("ghost")).toContain("background:transparent");
  });

  it("no arcade gradient or yellow palette survives the editorial reskin", () => {
    for (const kind of KINDS) {
      expect(buttonStyle(kind)).not.toContain("linear-gradient");
      expect(buttonStyle(kind)).not.toContain("#ffd23f");
    }
  });

  it("only the primary button carries the dark ink text color", () => {
    expect(buttonStyle("primary")).toContain(`color:${MENU_INK}`);
    expect(buttonStyle("secondary")).toContain(`color:${INK}`);
  });

  it("extra declarations land after the base so they win in cssText", () => {
    const css = buttonStyle("primary", ["font-size:22px"]);
    expect(css.lastIndexOf("font-size:22px")).toBeGreaterThan(css.indexOf("font-size:13px"));
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

  it("MENU_CSS covers hover, active, a visible focus ring, and gc-pulse", () => {
    expect(MENU_CSS).toContain(".gc-btn:hover");
    expect(MENU_CSS).toContain(".gc-btn:active");
    expect(MENU_CSS).toContain(".gc-btn:focus, .gc-row:focus");
    expect(MENU_CSS).toContain("outline: 3px solid");
    expect(MENU_CSS).toContain("@keyframes gc-pulse");
  });
});

describe("menuStyles — editorial primitives (072)", () => {
  it("neutral tokens are centralized and biome-agnostic (no warm palette)", () => {
    const tokens = [INK, INK_MUTED, PANEL_INK, HAIRLINE];
    for (const t of tokens) {
      expect(t).not.toContain("#ffd23f");
    }
    expect(PANEL_INK).toContain("rgba");
    expect(HAIRLINE).toContain("rgba");
  });

  it("kicker is a tracked uppercase muted label in an inline-flex row", () => {
    expect(kickerLabel()).toContain("text-transform:uppercase");
    expect(kickerLabel()).toContain("letter-spacing:0.4em");
    expect(kickerLabel()).toContain(`color:${INK_MUTED}`);
    expect(kickerRow()).toContain("display:inline-flex");
    expect(kickerRow()).toContain("align-items:center");
  });

  it("hairlineRule is 1px, horizontal by default, vertical on request", () => {
    expect(hairlineRule(28)).toContain("width:28px");
    expect(hairlineRule(28)).toContain("height:1px");
    expect(hairlineRule(40, true)).toContain("width:1px");
    expect(hairlineRule(40, true)).toContain("height:40px");
    expect(hairlineRule()).toContain(`background:${HAIRLINE}`);
  });

  it("display heading uses the system serif stack at a light weight", () => {
    expect(displayHeading()).toContain(`font-family:${SERIF_STACK}`);
    expect(displayHeading()).toContain("font-weight:300");
    expect(displayHeading()).toContain("clamp(");
    expect(displayAccent()).toContain("font-style:italic");
  });

  it("telemetry rows are key/value with muted key and brighter value", () => {
    expect(telemetryRow()).toContain("justify-content:space-between");
    expect(telemetryRow()).toContain(`border-top:1px solid ${HAIRLINE}`);
    expect(telemetryKey()).toContain(`color:${INK_MUTED}`);
    expect(telemetryKey()).toContain("text-transform:uppercase");
    expect(telemetryValue()).toContain(`color:${INK}`);
  });

  it("status dot is a small circle driven by the gc-pulse keyframe", () => {
    expect(statusDot()).toContain("border-radius:50%");
    expect(statusDot()).toContain("animation:gc-pulse");
  });

  it("corner marks draw an L from the two borders of their named corner", () => {
    expect(cornerMark("tl")).toContain("top:0");
    expect(cornerMark("tl")).toContain("left:0");
    expect(cornerMark("tl")).toContain("border-top:1px solid");
    expect(cornerMark("tl")).toContain("border-left:1px solid");
    expect(cornerMark("br")).toContain("bottom:0");
    expect(cornerMark("br")).toContain("right:0");
    expect(cornerMark("br")).toContain("border-bottom:1px solid");
    expect(cornerMark("br")).toContain("border-right:1px solid");
  });

  it("vignette + grain are full-inset non-interactive layers", () => {
    for (const layer of [vignetteLayer(), grainLayer()]) {
      expect(layer).toContain("position:absolute");
      expect(layer).toContain("inset:0");
      expect(layer).toContain("pointer-events:none");
    }
    expect(vignetteLayer()).toContain("radial-gradient");
    expect(grainLayer()).toContain("mix-blend-mode:overlay");
  });

  it("grain is an inline SVG data URI (no committed asset file)", () => {
    expect(grainLayer()).toContain("data:image/svg+xml,");
    expect(grainLayer()).toContain("feTurbulence");
    expect(grainLayer()).not.toContain(".png");
    expect(grainLayer()).not.toContain(".jpg");
  });
});
