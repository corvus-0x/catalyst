import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import TieOffModal from "./TieOffModal";

// Minimal FindingItem stub — only the fields TieOffModal actually reads at render time
const stubFinding = {
  id: "test-id",
  rule_id: "MANUAL",
  title: "Test angle",
  description: "",
  narrative: "",
  severity: "HIGH",
  status: "NEW",
  evidence_weight: "SPECULATIVE",
  source: "MANUAL",
  investigator_note: "",
  legal_refs: [],
  evidence_snapshot: {},
  trigger_doc_id: null,
  trigger_doc_filename: null,
  trigger_entity_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  entity_links: [],
  document_links: [],
} as any;

describe("TieOffModal", () => {
  it("renders without crashing", () => {
    render(
      <TieOffModal
        caseId="case-1"
        finding={stubFinding}
        open={true}
        onClose={() => {}}
        onTiedOff={() => {}}
      />
    );
    // The Radix Dialog title "Tie off this angle" should be in the DOM
    expect(screen.getByText(/tie off this angle/i)).toBeInTheDocument();
  });
});
