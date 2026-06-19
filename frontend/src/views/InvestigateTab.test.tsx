import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { CredibilityHeader } from "./InvestigateTab";

describe("CredibilityHeader", () => {
  it("shows the triplet and never the score/100", () => {
    const { container } = render(
      <CredibilityHeader credibility={{ referral_grade: 3, need_work: 5, agency_leads: 2 }} />,
    );
    // Robust to text split across spans/nodes: assert on combined textContent.
    const text = container.textContent ?? "";
    expect(text).toContain("3 referral-grade");
    expect(text).toContain("5 need work");
    expect(text).toContain("2 agency leads");
    expect(text).not.toContain("/ 100");
  });
});
