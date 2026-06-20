import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CaseMapLegend from "./CaseMapLegend";

describe("CaseMapLegend", () => {
  it("documents markers, strength levels, and the ethical copy", async () => {
    render(<CaseMapLegend />);
    const button = screen.getByRole("button", { name: /Legend/ });
    await userEvent.click(button);

    const text = screen.getByRole("button").parentElement?.textContent ?? "";
    expect(text).toContain("Person");
    expect(text).toContain("Organization");
    expect(text).toContain("Observed");
    expect(text).toContain("Material");
    expect(text).toContain("does not imply wrongdoing");
  });
});
