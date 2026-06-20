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
});
