import { describe, it, expect } from "vitest";
import { STYLESHEET } from "./CytoscapeCanvas";

function selectors(): string[] {
  return STYLESHEET.map((r) => r.selector as string);
}

describe("Case Map stylesheet", () => {
  it("encodes subject type by shape, not pictograms", () => {
    const person = STYLESHEET.find((r) => r.selector === 'node[type="person"]');
    const org = STYLESHEET.find((r) => r.selector === 'node[type="organization"]');
    expect(person?.style?.shape).toBe("ellipse");
    expect(org?.style?.shape).toBe("round-rectangle");
    // no pictogram background-image on base markers (static shapes only)
    expect("background-image" in (person?.style || {})).toBe(false);
  });

  it("has neutral state treatments: dashed unknown, green substantiated, outline selected", () => {
    const sel = selectors();
    expect(sel).toContain('node[?status_unknown]');
    expect(sel).toContain('node[?has_substantiated_thread]');
    expect(sel).toContain('node:selected');
    const unknown = STYLESHEET.find((r) => r.selector === 'node[?status_unknown]');
    expect(unknown?.style?.["border-style"]).toBe("dashed");
  });

  it("drives edge width from data(width)", () => {
    const edge = STYLESHEET.find((r) => r.selector === "edge.summary");
    expect(edge?.style?.width).toBe("data(width)");
  });

  it("defines Phase 3 thread-path classes (edge emphasis + severity colors + subject ring)", () => {
    const sel = selectors();
    expect(sel).toContain(".thread-path-edge");
    expect(sel).toContain(".thread-path-edge--critical");
    expect(sel).toContain(".thread-path-edge--high");
    expect(sel).toContain(".thread-path-edge--medium");
    expect(sel).toContain(".thread-path-subject");
    // base path edge emphasizes (width 5) and is neutral grey; severity classes override the color
    const base = STYLESHEET.find((r) => r.selector === ".thread-path-edge");
    expect(base?.style?.["line-color"]).toBe("#94a3b8");
    expect(base?.style?.width).toBe(5);
    const crit = STYLESHEET.find((r) => r.selector === ".thread-path-edge--critical");
    expect(crit?.style?.["line-color"]).toBe("#f87171");
  });

  it("keeps .dimmed reserved at low opacity", () => {
    const dim = STYLESHEET.find((r) => r.selector === ".dimmed");
    expect(dim?.style?.opacity).toBe(0.1);
  });

  it("orders .dimmed before the path classes so the path rules win on equal specificity", () => {
    const sel = selectors();
    const dimmed = sel.indexOf(".dimmed");
    expect(dimmed).toBeGreaterThanOrEqual(0);
    expect(dimmed).toBeLessThan(sel.indexOf(".thread-path-edge"));
    expect(dimmed).toBeLessThan(sel.indexOf(".thread-path-subject"));
  });
});
