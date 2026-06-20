import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import RelationshipSummaryPanel from "./RelationshipSummaryPanel";
import type { SummaryEdge } from "../types";

const noop = () => {};

const edge: SummaryEdge = {
  id: "a__b", source: "a", target: "b", relationship: "SUMMARY",
  label: "Repeated relationship", state: "repeated",
  strength: {
    score: 65, level: "repeated", categories: ["formal_role", "co_mentioned"],
    source_count: 4, transaction_count: 0, role_count: 1, thread_count: 0,
    substantiated_thread_count: 0, handoff_included: false,
    relationship_types: ["OFFICER_OF"],
    reasons: ["Formal role documented", "Appears together in 4 source documents"],
  },
  evidence_refs: [],
  thread_refs: [],
  underlying_relationships: [
    { kind: "OFFICER_OF", label: "Board member", source: "person_org", source_id: "po1" },
  ],
};

describe("RelationshipSummaryPanel", () => {
  it("shows level, categories, reasons (separately), and the neutral §10 note", () => {
    const { container } = render(
      <RelationshipSummaryPanel edge={edge} subjectLabel={(id) => (id === "a" ? "Jay" : "Acme")} onClear={noop} onOpenSource={noop} onSelectThread={noop} onStartThread={noop} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Jay");
    expect(text).toContain("Acme");
    expect(text.toLowerCase()).toContain("repeated");
    expect(text).toContain("Formal role documented");
    expect(text).toContain("formal_role");
    expect(text).toContain("Board member");
    expect(text).toContain("does not imply wrongdoing");

    // Verify categories and reasons render in separate sections
    const categories = container.querySelector('[data-testid="strength-categories"]');
    const reasons = container.querySelector('[data-testid="strength-reasons"]');
    expect(categories?.textContent).toContain("formal_role");
    expect(reasons?.textContent).toContain("Formal role documented");
    // the category token must NOT leak into the reasons section
    expect(reasons?.textContent).not.toContain("formal_role");
  });

  it("invokes onClear when the close button is clicked", () => {
    const onClear = vi.fn();
    const { getByLabelText } = render(
      <RelationshipSummaryPanel edge={edge} subjectLabel={(id) => id} onClear={onClear} onOpenSource={noop} onSelectThread={noop} onStartThread={noop} />,
    );
    fireEvent.click(getByLabelText("Close relationship detail"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("renders supporting documents and threads-using sections; thread click selects it", () => {
    const onSelectThread = vi.fn();
    const richEdge: SummaryEdge = {
      id: "p1__p2", source: "p1", target: "p2", relationship: "SUMMARY",
      label: "Documented relationship", state: "documented",
      strength: { score: 30, level: "documented", categories: ["co_mentioned"], source_count: 1,
        transaction_count: 0, role_count: 0, thread_count: 1, substantiated_thread_count: 0,
        handoff_included: false, relationship_types: [], reasons: ["Appears together in 1 source document"] },
      evidence_refs: [{ kind: "source_document", document_id: "d1", label: "Form 990", category: "co_mentioned" }],
      thread_refs: [{ thread_id: "t1", title: "Insider swap", status: "NEEDS_EVIDENCE", severity: "HIGH",
        rule_id: "SR-015", signal_type: "INSIDER_SWAP", handoff_ready: false }],
      underlying_relationships: [],
    };
    const { getByText } = render(
      <RelationshipSummaryPanel edge={richEdge} subjectLabel={(id) => id} onClear={noop}
        onOpenSource={noop} onSelectThread={onSelectThread} onStartThread={noop} />,
    );
    expect(getByText("Form 990")).toBeTruthy();        // supporting doc
    fireEvent.click(getByText("Insider swap"));         // thread row
    expect(onSelectThread).toHaveBeenCalledWith("t1");
  });
});
