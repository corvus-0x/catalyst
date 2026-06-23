import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ElementCard from "./ElementCard";

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
});
