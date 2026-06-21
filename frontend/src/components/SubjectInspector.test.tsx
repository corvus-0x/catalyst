import { render, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api", () => ({
  fetchEntityDetail: vi.fn().mockResolvedValue({ id: "p1", entity_type: "person", name: "Jay Example", role_tags: [], aliases: ["J. Example"], related_documents: [{ id: "d1", filename: "Deed.pdf" }], related_findings: [] }),
  fetchNotes: vi.fn().mockResolvedValue({ results: [
    { id: "n1", case_id: "c1", target_type: "person", target_id: "p1", content: "Saw him at the deed signing", created_by: "me", created_at: "x", updated_at: "x" },
    { id: "n2", case_id: "c1", target_type: "person", target_id: "OTHER", content: "unrelated", created_by: "me", created_at: "x", updated_at: "x" },
  ] }),
  createNote: vi.fn().mockResolvedValue({}),
}));
import * as api from "../api";
import type { CaseMapResponse } from "../types";
import SubjectInspector from "./SubjectInspector";

// One boundary cast for the partial fixture — do NOT spread `any` into component code;
// SubjectInspector's prop is typed `caseMap: CaseMapResponse`.
const caseMap = {
  case_id: "c1",
  nodes: [{ id: "o1", type: "organization", label: "Acme", subtype: null, flags: { status_unknown: false, has_active_thread: false, has_substantiated_thread: false }, metadata: { thread_count: 0, document_count: 0 } }],
  edges: [{ id: "o1__p1", source: "o1", target: "p1", relationship: "SUMMARY", label: "Documented relationship", state: "documented", strength: { score: 30, level: "documented", categories: ["formal_role"], source_count: 0, transaction_count: 0, role_count: 1, thread_count: 0, substantiated_thread_count: 0, handoff_included: false, relationship_types: [], reasons: [] }, evidence_refs: [], thread_refs: [], underlying_relationships: [] }],
  stats: { subject_count: 2, edge_count: 1, by_level: { observed: 0, documented: 1, repeated: 0, material: 0 }, material_edge_count: 0, handoff_edge_count: 0, generated_at: "x" },
} as unknown as CaseMapResponse;
beforeEach(() => vi.clearAllMocks());

describe("SubjectInspector", () => {
  it("shows identity + observations filtered by target_id; not other subjects' notes", async () => {
    const { findByText, queryByText } = render(
      <SubjectInspector caseId="c1" subjectId="p1" entityType="person" caseMap={caseMap}
        subjectLabel={(id) => id} onSelectRelationship={() => {}} onStartThread={() => {}}
        onCite={() => {}} onOpenProfile={() => {}} onClear={() => {}} />,
    );
    expect(await findByText("Jay Example")).toBeTruthy();
    expect(await findByText(/deed signing/)).toBeTruthy();
    expect(queryByText("unrelated")).toBeNull();
    expect(api.fetchNotes).toHaveBeenCalledWith("c1");
  });

  it("add observation calls createNote with target_id", async () => {
    const { findByLabelText, getByText } = render(
      <SubjectInspector caseId="c1" subjectId="p1" entityType="person" caseMap={caseMap}
        subjectLabel={(id) => id} onSelectRelationship={() => {}} onStartThread={() => {}}
        onCite={() => {}} onOpenProfile={() => {}} onClear={() => {}} />,
    );
    const input = await findByLabelText("New observation");
    fireEvent.change(input, { target: { value: "note text" } });
    fireEvent.click(getByText("Add observation"));
    await waitFor(() => expect(api.createNote).toHaveBeenCalledWith("c1", expect.objectContaining({ target_id: "p1", content: "note text" })));
  });

  it("'Top relationships' row click calls onSelectRelationship with the edge id", async () => {
    // The caseMap fixture has an edge "o1__p1" where p1 is the subject (target).
    // Clicking the relationship row should call onSelectRelationship("o1__p1").
    const onSelectRelationship = vi.fn();
    const { findByText } = render(
      <SubjectInspector caseId="c1" subjectId="p1" entityType="person" caseMap={caseMap}
        subjectLabel={(id) => (id === "o1" ? "Acme" : id)}
        onSelectRelationship={onSelectRelationship}
        onStartThread={() => {}} onCite={() => {}} onOpenProfile={() => {}} onClear={() => {}} />,
    );
    // Wait for the relationship row to render (after detail load)
    const row = await findByText("Acme");
    fireEvent.click(row);
    expect(onSelectRelationship).toHaveBeenCalledWith("o1__p1");
  });
});
