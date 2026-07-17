/**
 * DOM control panel for the dev garage viewer (src/dev/Garage.ts): the left
 * overlay with view/chassis/paint selects, the dimension readout, and the
 * bounds/grid/reference toggles. Split out of Garage.ts to hold that file under
 * the hand-written line cap. Builds nodes and wires listeners to caller-supplied
 * handlers (which own the GL/state side); returns the elements Garage still
 * mutates. Pure DOM, no THREE/WebGL, so it is jsdom-safe.
 */

import { KART_VARIANTS, type KartVariantId } from "../kart/kartVariants";
import { KART_COLORWAYS, type KartColorwayId } from "../kart/kartColorways";
import { PRESET_VIEWS, type GarageView } from "./garageViews";

const PANEL = [
  "position:absolute",
  "top:12px",
  "left:12px",
  "z-index:2",
  "display:flex",
  "flex-direction:column",
  "gap:8px",
  "padding:12px",
  "min-width:220px",
  "font:12px/1.5 ui-monospace,Menlo,monospace",
  "color:#e8e8ea",
  "background:rgba(18,18,22,0.82)",
  "border:1px solid rgba(255,255,255,0.12)",
  "border-radius:8px",
].join(";");

const FIELD = "display:flex;justify-content:space-between;align-items:center;gap:8px";

function labelRow(text: string, control: HTMLElement): HTMLElement {
  const row = document.createElement("label");
  row.style.cssText = FIELD;
  const span = document.createElement("span");
  span.textContent = text;
  row.append(span, control);
  return row;
}

function select<T extends string>(
  options: ReadonlyArray<{ id: T; name: string }>,
): HTMLSelectElement {
  const el = document.createElement("select");
  el.style.cssText = "background:#26262c;color:#e8e8ea;border:1px solid #444;border-radius:4px";
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o.id;
    opt.textContent = o.name;
    el.append(opt);
  }
  return el;
}

/** Create an <input> of `type` with the given properties assigned. */
function input(type: string, props: Partial<HTMLInputElement> = {}): HTMLInputElement {
  const el = document.createElement("input");
  el.type = type;
  Object.assign(el, props);
  return el;
}

/** Callbacks the panel invokes on user input; the caller owns GL/state. */
export interface GaragePanelHandlers {
  onView(view: GarageView): void;
  onVariant(variant: KartVariantId): void;
  onColor(colorway: KartColorwayId): void;
  onBox(on: boolean): void;
  onGrid(on: boolean): void;
  onFile(file: File): void;
  onOpacity(value: string): void;
  onMeters(value: string): void;
  onClear(): void;
}

/** Elements Garage keeps mutating after the panel is built. */
export interface GaragePanelControls {
  viewSel: HTMLSelectElement;
  variantSel: HTMLSelectElement;
  colorSel: HTMLSelectElement;
  gridToggle: HTMLInputElement;
  meters: HTMLInputElement;
  readout: HTMLPreElement;
}

/** Initial control values, seeded from URL params by Garage. */
export interface GaragePanelInit {
  view: GarageView;
  variant: KartVariantId;
  colorway: KartColorwayId;
  showGrid: boolean;
}

/**
 * Build the control panel and wire its listeners to `handlers`. Returns the root
 * `panel` element (append into `.gc-garage`) plus the `controls` Garage mutates.
 */
export function buildGaragePanel(
  init: GaragePanelInit,
  handlers: GaragePanelHandlers,
): { panel: HTMLElement; controls: GaragePanelControls } {
  const panel = document.createElement("div");
  panel.style.cssText = PANEL;
  const title = document.createElement("strong");
  title.textContent = "GARAGE";
  panel.appendChild(title);

  const viewSel = select(PRESET_VIEWS.map((v) => ({ id: v, name: v })));
  viewSel.value = init.view;
  viewSel.addEventListener("change", () => handlers.onView(viewSel.value as GarageView));
  panel.appendChild(labelRow("view", viewSel));

  const variantSel = select(KART_VARIANTS.map((v) => ({ id: v.id, name: v.name })));
  variantSel.value = init.variant;
  variantSel.addEventListener("change", () =>
    handlers.onVariant(variantSel.value as KartVariantId),
  );
  panel.appendChild(labelRow("chassis", variantSel));

  const colorSel = select(KART_COLORWAYS.map((c) => ({ id: c.id, name: c.name })));
  colorSel.value = init.colorway;
  colorSel.addEventListener("change", () => handlers.onColor(colorSel.value as KartColorwayId));
  panel.appendChild(labelRow("paint", colorSel));

  const readout = document.createElement("pre");
  readout.style.cssText = "margin:0;white-space:pre;color:#cfd2d8";
  panel.appendChild(readout);

  const boxToggle = input("checkbox");
  boxToggle.addEventListener("change", () => handlers.onBox(boxToggle.checked));
  panel.appendChild(labelRow("bounds box", boxToggle));

  const gridToggle = input("checkbox", { checked: init.showGrid });
  gridToggle.addEventListener("change", () => handlers.onGrid(gridToggle.checked));
  panel.appendChild(labelRow("ground grid", gridToggle));

  const fileInput = input("file", { accept: "image/*" });
  fileInput.style.cssText = "width:150px;color:#cfd2d8";
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (f) handlers.onFile(f);
  });
  panel.appendChild(labelRow("reference", fileInput));

  const opacity = input("range", { min: "0", max: "1", step: "0.05", value: "0.5" });
  opacity.addEventListener("input", () => handlers.onOpacity(opacity.value));
  panel.appendChild(labelRow("opacity", opacity));

  const meters = input("number", { min: "0", step: "0.1", placeholder: "ref width m" });
  meters.style.cssText = "width:80px;background:#26262c;color:#e8e8ea;border:1px solid #444";
  meters.addEventListener("input", () => handlers.onMeters(meters.value));
  panel.appendChild(labelRow("ref width (m)", meters));

  const clearBtn = document.createElement("button");
  clearBtn.textContent = "clear reference";
  clearBtn.style.cssText =
    "background:#26262c;color:#e8e8ea;border:1px solid #444;border-radius:4px";
  clearBtn.addEventListener("click", () => handlers.onClear());
  panel.appendChild(clearBtn);

  return { panel, controls: { viewSel, variantSel, colorSel, gridToggle, meters, readout } };
}
