// frontend/src/components/CiteDocumentPicker.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CiteDocumentPicker from "./CiteDocumentPicker";
import * as api from "../api";

vi.mock("../api", () => ({
  updateAngle: vi.fn(),
  addCitation: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(() => vi.restoreAllMocks());

const docs = [{ id: "d1", filename: "deed.pdf", display_name: "deed.pdf", doc_type: "DEED" }] as any;

// ---------------------------------------------------------------------------
// Element mode (Phase 4B — writes ThreadElementCitation via addCitation)
// ---------------------------------------------------------------------------

describe("CiteDocumentPicker element mode", () => {
  beforeEach(() => {
    (api.addCitation as any) = vi.fn(async () => ({}));
    (api.updateAngle as any) = vi.fn(async () => ({}));
  });

  it("calls addCitation (not updateAngle) when given an element context", async () => {
    const onCited = vi.fn();
    render(
      <CiteDocumentPicker
        caseId="c1"
        findingId="f1"
        documents={docs}
        element={{ id: "el1" }}
        onCited={onCited}
        onClose={vi.fn()}
      />,
    );
    // Select the document by clicking its label/checkbox
    fireEvent.click(screen.getByLabelText(/deed\.pdf/i));
    // Confirm via the cite button
    fireEvent.click(screen.getByRole("button", { name: /cite selected/i }));
    await waitFor(() =>
      expect(api.addCitation).toHaveBeenCalledWith("c1", "f1", "el1",
        expect.objectContaining({ document_id: "d1" }),
      ),
    );
    expect(api.updateAngle).not.toHaveBeenCalled();
    expect(onCited).toHaveBeenCalled();
  });

  it("on a citation failure, surfaces an error and keeps the picker open (no onCited/onClose)", async () => {
    const { toast } = await import("sonner");
    (api.addCitation as any) = vi.fn(async () => {
      throw new Error("network");
    });
    const onCited = vi.fn();
    const onClose = vi.fn();
    render(
      <CiteDocumentPicker
        caseId="c1"
        findingId="f1"
        documents={docs}
        element={{ id: "el1" }}
        onCited={onCited}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByLabelText(/deed\.pdf/i));
    fireEvent.click(screen.getByRole("button", { name: /cite selected/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onCited).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Legacy narrative mode (unchanged — existing callers like AngleView)
// ---------------------------------------------------------------------------

const baseFinding = {
  id: "f1",
  title: "Test angle",
  narrative: "Some narrative.",
  document_links: [] as any[],
  rule_id: "SR-015",
  status: "NEW",
  severity: "HIGH",
  evidence_weight: "DOCUMENTED",
  overreach_reviewed: false,
  source: "MANUAL",
  investigator_note: "",
  legal_refs: [],
  evidence_snapshot: {},
  trigger_doc_id: null,
  trigger_doc_filename: null,
  trigger_entity_id: null,
  description: "",
  created_at: "",
  updated_at: "",
  entity_links: [],
  elements: [],
  gate_version: "ASSERTION_V1",
} as any;

describe("CiteDocumentPicker legacy mode", () => {
  beforeEach(() => {
    (api.updateAngle as any) = vi.fn(async () => ({ ...baseFinding }));
    (api.addCitation as any) = vi.fn(async () => ({}));
  });

  it("calls updateAngle (not addCitation) in legacy mode with no element prop", async () => {
    const onCited = vi.fn();
    render(
      <CiteDocumentPicker
        open
        caseId="c1"
        finding={baseFinding}
        documents={docs}
        onCited={onCited}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText(/deed\.pdf/i));
    fireEvent.click(screen.getByRole("button", { name: /cite selected/i }));
    await waitFor(() => expect(api.updateAngle).toHaveBeenCalled());
    expect(api.addCitation).not.toHaveBeenCalled();
  });
});
