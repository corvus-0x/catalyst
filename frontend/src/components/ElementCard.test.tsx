import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ElementCard from "./ElementCard";

const noopProps = {
  onEditText: vi.fn(), onToggleHandoff: vi.fn(), onAddCitation: vi.fn(),
  onRemoveCitation: vi.fn(), onChangeType: vi.fn(), onDelete: vi.fn(),
  onMoveUp: vi.fn(), onMoveDown: vi.fn(),
};

const el = {
  id: "e1", finding_id: "f1", element_type: "ASSERTION" as const, role: "fact" as const,
  text: "Insider payment", position: 0, handoff_ready: false,
  citations: [{ id: "c1", document_id: "d1", document_filename: "deed.pdf", page_reference: "p3", context_note: "" }],
};

describe("ElementCard", () => {
  it("shows the derived role badge from element.role", () => {
    render(<ElementCard element={el} onEditText={vi.fn()} onToggleHandoff={vi.fn()}
      onAddCitation={vi.fn()} onRemoveCitation={vi.fn()} onChangeType={vi.fn()}
      onDelete={vi.fn()} onMoveUp={vi.fn()} onMoveDown={vi.fn()} />);
    expect(screen.getByText(/fact/i)).toBeInTheDocument();
  });

  it("fires onToggleHandoff(true) when the handoff toggle is clicked", () => {
    const onToggle = vi.fn();
    render(<ElementCard element={el} onEditText={vi.fn()} onToggleHandoff={onToggle}
      onAddCitation={vi.fn()} onRemoveCitation={vi.fn()} onChangeType={vi.fn()}
      onDelete={vi.fn()} onMoveUp={vi.fn()} onMoveDown={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /handoff/i }));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("re-syncs the textarea when the element.text prop changes (reorder/refresh)", () => {
    const { rerender } = render(<ElementCard element={el} {...noopProps} />);
    expect(screen.getByDisplayValue("Insider payment")).toBeInTheDocument();
    // Parent replaces the element prop (same id) with updated text — e.g. after a refresh.
    rerender(<ElementCard element={{ ...el, text: "Insider payment of $500k" }} {...noopProps} />);
    expect(screen.getByDisplayValue("Insider payment of $500k")).toBeInTheDocument();
  });

  it("fires onChangeType with the selected value", () => {
    const onChangeType = vi.fn();
    render(<ElementCard element={el} {...noopProps} onChangeType={onChangeType} />);
    fireEvent.change(screen.getByLabelText(/element type/i), { target: { value: "QUESTION" } });
    expect(onChangeType).toHaveBeenCalledWith("QUESTION");
  });

  it("fires onRemoveCitation with the citation id when the chip remove is clicked", () => {
    const onRemoveCitation = vi.fn();
    render(<ElementCard element={el} {...noopProps} onRemoveCitation={onRemoveCitation} />);
    fireEvent.click(screen.getByRole("button", { name: /remove citation/i }));
    expect(onRemoveCitation).toHaveBeenCalledWith("c1");
  });

  it("disables the handoff toggle when text is empty", () => {
    const empty = { ...el, text: "", role: "analysis" as const, citations: [] };
    render(<ElementCard element={empty} {...noopProps} />);
    expect(screen.getByRole("button", { name: /handoff/i })).toBeDisabled();
  });

  it("hides citations + handoff toggle for a QUESTION (assertion-only sections)", () => {
    const q = {
      id: "q1", finding_id: "f1", element_type: "QUESTION" as const, role: "question" as const,
      text: "Who signed it?", position: 1, handoff_ready: false, citations: [],
    };
    render(<ElementCard element={q} {...noopProps} />);
    expect(screen.queryByRole("button", { name: /handoff/i })).toBeNull();
    expect(screen.queryByText(/cite source/i)).toBeNull();
  });
});
