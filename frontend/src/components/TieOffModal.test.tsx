// frontend/src/components/TieOffModal.test.tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TieOffModal from "./TieOffModal";
import type { FindingItem } from "../types";

vi.mock("../api", () => ({ updateAngle: vi.fn() }));
import { updateAngle } from "../api";

afterEach(() => vi.restoreAllMocks());

const baseFinding: FindingItem = {
  id: "11111111-1111-1111-1111-111111111111",
  rule_id: "SR-015", title: "Insider swap", description: "", narrative: "A narrative.",
  severity: "HIGH", status: "NEEDS_EVIDENCE", evidence_weight: "DOCUMENTED",
  overreach_reviewed: false, source: "MANUAL", investigator_note: "", legal_refs: [],
  evidence_snapshot: {}, trigger_doc_id: null, trigger_doc_filename: null,
  trigger_entity_id: null, created_at: "", updated_at: "",
  entity_links: [], document_links: [{ document_id: "d", document_filename: "d.pdf", page_reference: "", context_note: "" }],
};

function setup(overrides: Partial<FindingItem> = {}) {
  return render(
    <TieOffModal open caseId="c" finding={{ ...baseFinding, ...overrides }}
      onClose={() => {}} onTiedOff={() => {}} />,
  );
}

describe("TieOffModal gate", () => {
  it("disables Confirm until overreach is acknowledged", () => {
    setup();
    const confirm = screen.getByRole("button", { name: /confirm angle/i });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/overreach/i));
    expect(confirm).toBeEnabled();
  });

  it("shows rule read-only and never PATCHes rule_id", async () => {
    (updateAngle as any).mockResolvedValue({ ...baseFinding, status: "CONFIRMED", overreach_reviewed: true });
    setup();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText(/SR-015/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/overreach/i));
    fireEvent.click(screen.getByRole("button", { name: /confirm angle/i }));
    await waitFor(() => expect(updateAngle).toHaveBeenCalled());
    const body = (updateAngle as any).mock.calls[0][2];
    expect(body).not.toHaveProperty("rule_id");
    expect(body.overreach_reviewed).toBe(true);
  });

  it("renders the server gate reason when confirm 400s despite a valid-looking local state", async () => {
    // Locally valid (narrative + citation + DOCUMENTED + overreach ack) so the
    // button is ENABLED and the click reaches the request — but the server
    // rejects with a stale-state 400 (e.g. the doc was removed elsewhere).
    const err: any = new Error("gate"); err.status = 400;
    err.body = { errors: { gate: { unmet: ["citation"] } } };
    (updateAngle as any).mockRejectedValue(err);
    setup();  // baseFinding has narrative + a document_link + DOCUMENTED weight
    fireEvent.click(screen.getByLabelText(/overreach/i));
    const confirm = screen.getByRole("button", { name: /confirm angle/i });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(screen.getByText(/missing: citation/i)).toBeInTheDocument(),
    );
  });

  it("shows a generic error (modal stays open) on a non-gate failure", async () => {
    // A network/500 failure must not be swallowed or thrown unhandled.
    (updateAngle as any).mockRejectedValue(new Error("Network down"));
    const onClose = vi.fn();
    render(
      <TieOffModal open caseId="c" finding={baseFinding} onClose={onClose} onTiedOff={() => {}} />,
    );
    fireEvent.click(screen.getByLabelText(/overreach/i));
    fireEvent.click(screen.getByRole("button", { name: /confirm angle/i }));
    await waitFor(() => expect(screen.getByText(/network down/i)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();  // modal stays open
  });
});
