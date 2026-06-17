import { describe, it, expect } from "vitest";
import { outcomeLabel } from "./ResearchTab";

describe("outcomeLabel", () => {
  it("created knot", () => {
    expect(outcomeLabel({ created: "organization", entity: {}, duplicate: false }))
      .toBe("Created organization knot");
  });
  it("duplicate", () => {
    expect(outcomeLabel({ created: "property", entity: {}, duplicate: true }))
      .toBe("Already in case");
  });
  it("note", () => {
    expect(outcomeLabel({ created: "note", entity: {}, duplicate: false }))
      .toBe("Saved as note");
  });
  it("property", () => {
    expect(outcomeLabel({ created: "property", entity: {}, duplicate: false }))
      .toBe("Created property record");
  });
  it("person (default branch)", () => {
    expect(outcomeLabel({ created: "person", entity: {}, duplicate: false }))
      .toBe("Created person knot");
  });
});
