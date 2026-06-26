import { beforeEach, describe, expect, it } from "vitest";
import { LifeBar, type LifeBarAnchor } from "./LifeBar";

describe("LifeBar", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("constructor appends the bar to the container; hidden by default", () => {
    new LifeBar(container);
    const root = container.querySelector(".gc-life-bar") as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.style.display).toBe("none");
  });

  it("update(life, true) shows the bar; width tracks life", () => {
    const lb = new LifeBar(container);
    const root = container.querySelector(".gc-life-bar") as HTMLElement;
    const fill = root.querySelector(".gc-life-bar-fill") as HTMLElement;

    lb.update(0.5, true);
    expect(root.style.display).toBe("block");
    expect(fill.style.width).toBe("50%");

    lb.update(1, true);
    expect(fill.style.width).toBe("100%");

    lb.update(0, true);
    expect(fill.style.width).toBe("0%");
  });

  it("update clamps life outside [0,1]", () => {
    const lb = new LifeBar(container);
    const root = container.querySelector(".gc-life-bar") as HTMLElement;
    const fill = root.querySelector(".gc-life-bar-fill") as HTMLElement;

    lb.update(1.5, true);
    expect(fill.style.width).toBe("100%");

    lb.update(-0.2, true);
    expect(fill.style.width).toBe("0%");
  });

  it("update(_, false) hides the bar", () => {
    const lb = new LifeBar(container);
    const root = container.querySelector(".gc-life-bar") as HTMLElement;

    lb.update(0.5, true);
    expect(root.style.display).toBe("block");

    lb.update(0.5, false);
    expect(root.style.display).toBe("none");
  });

  it("setAnchor repositions the root", () => {
    const lb = new LifeBar(container);
    const root = container.querySelector(".gc-life-bar") as HTMLElement;

    const anchor: LifeBarAnchor = { left: 200, top: 300 };
    lb.setAnchor(anchor);

    expect(root.style.left).toBe("200px");
    expect(root.style.top).toBe("300px");
  });

  it("ctor anchor sets initial position", () => {
    new LifeBar(container, { left: 50, top: 60 });
    const root = container.querySelector(".gc-life-bar") as HTMLElement;

    expect(root.style.left).toBe("50px");
    expect(root.style.top).toBe("60px");
  });

  it("remove() detaches the root from the DOM", () => {
    const lb = new LifeBar(container);
    const root = container.querySelector(".gc-life-bar") as HTMLElement;

    lb.remove();

    expect(root.parentNode).toBeNull();
    expect(container.children.length).toBe(0);
  });
});
