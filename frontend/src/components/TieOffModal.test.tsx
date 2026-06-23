// frontend/src/components/TieOffModal.test.tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TieOffModal from "./TieOffModal";
import type { FindingItem } from "../types";

vi.mock("../api", () => ({ updateAngle: vi.fn() }));
import { updateAngle } from "../api";

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A minimal cited + handoff-ready assertion element — satisfies both
// ASSERTION_V1 gaps (cited_assertion + handoff_ready_claim).
const citedHandoffElement: FindingItem["elements"][0] = {
  id: "e1",
  finding_id: "11111111-1111-1111-1111-111111111111",
  element_type: "ASSERTION",
  role: "fact",
  text: "The transfer occurred on 2024-01-01.",
  position: 0,
  handoff_ready: true,
  citations: [
    {
      id: "c1",
      document_id: "d",
      document_filename: "d.pdf",
      page_reference: "p.1",
      context_note: "",
    },
  ],
};

// Base ASSERTION_V1 finding — NO assertion elements.  Used for tests that
// focus on the server-error path (confirm button reached via locally-enabled state).
const baseFinding: FindingItem = {
  id: "11111111-1111-1111-1111-111111111111",
  rule_id: "SR-015", title: "Insider swap", description: "", narrative: "A narrative.",
  severity: "HIGH", status: "NEEDS_EVIDENCE", evidence_weight: "DOCUMENTED",
  overreach_reviewed: false, source: "MANUAL", investigator_note: "", legal_refs: [],
  evidence_snapshot: {}, trigger_doc_id: null, trigger_doc_filename: null,
  trigger_entity_id: null, created_at: "", updated_at: "",
  entity_links: [], document_links: [{ document_id: "d", document_filename: "d.pdf", page_reference: "", context_note: "" }],
  elements: [], gate_version: "ASSERTION_V1",
};

// Gate-complete ASSERTION_V1 finding — has the cited + handoff-ready assertion
// so the only remaining local gate condition is overreach acknowledgement.
const v1ReadyFinding: FindingItem = {
  ...baseFinding,
  elements: [citedHandoffElement],
};

// Gate-complete LEGACY_NARRATIVE finding — no assertion elements needed.
const legacyReadyFinding: FindingItem = {
  ...baseFinding,
  gate_version: "LEGACY_NARRATIVE",
};

function setup(finding: FindingItem = v1ReadyFinding) {
  return render(
    <TieOffModal open caseId="c" finding={finding}
      onClose={() => {}} onTiedOff={() => {}} />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TieOffModal gate", () => {
  it("disables Confirm until overreach is acknowledged (ASSERTION_V1 gate-complete thread)", () => {
    // v1ReadyFinding has a cited + handoff-ready assertion — only the overreach
    // gate condition remains unmet when the user picks "Confirmed".
    setup(v1ReadyFinding);
    fireEvent.click(screen.getByRole("radio", { name: /confirmed — send to referral package/i }));
    const confirm = screen.getByRole("button", { name: /confirm thread/i });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/overreach/i));
    expect(confirm).toBeEnabled();
  });

  it("disables Confirm until overreach is acknowledged (LEGACY_NARRATIVE thread)", () => {
    // LEGACY_NARRATIVE threads don't need assertion elements — the base gate
    // (citation + weight + overreach) is the full gate.
    setup(legacyReadyFinding);
    fireEvent.click(screen.getByRole("radio", { name: /confirmed — send to referral package/i }));
    const confirm = screen.getByRole("button", { name: /confirm thread/i });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/overreach/i));
    expect(confirm).toBeEnabled();
  });

  it("shows ASSERTION_V1 gap copy when cited assertion is missing", () => {
    // baseFinding has elements: [] so both ASSERTION_V1 gaps fire.
    setup(baseFinding);
    fireEvent.click(screen.getByRole("radio", { name: /confirmed — send to referral package/i }));
    // The readiness summary names the assertion gaps (and overreach).
    expect(screen.getByRole("status")).toHaveTextContent(/No cited assertion/i);
    expect(screen.getByRole("status")).toHaveTextContent(/No handoff-ready claim/i);
    // Overreach alone is NOT enough to unblock an ASSERTION_V1 thread missing elements.
    fireEvent.click(screen.getByLabelText(/overreach/i));
    expect(screen.getByRole("button", { name: /confirm thread/i })).toBeDisabled();
  });

  it("shows rule read-only and never PATCHes rule_id", async () => {
    (updateAngle as any).mockResolvedValue({
      ...v1ReadyFinding, status: "CONFIRMED", overreach_reviewed: true,
    });
    setup(v1ReadyFinding);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText(/SR-015/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /confirmed — send to referral package/i }));
    fireEvent.click(screen.getByLabelText(/overreach/i));
    fireEvent.click(screen.getByRole("button", { name: /confirm thread/i }));
    await waitFor(() => expect(updateAngle).toHaveBeenCalled());
    const body = (updateAngle as any).mock.calls[0][2];
    expect(body).not.toHaveProperty("rule_id");
    expect(body.overreach_reviewed).toBe(true);
  });

  it("renders the server gate reason when confirm 400s despite a valid-looking local state", async () => {
    // Locally valid ASSERTION_V1 thread (cited + handoff-ready assertion + citation +
    // DOCUMENTED weight + overreach ack) — button ENABLED — but server rejects with
    // a stale-state 400 (e.g. the doc was removed elsewhere).
    const err: any = new Error("gate"); err.status = 400;
    err.body = { errors: { gate: { unmet: ["citation"] } } };
    (updateAngle as any).mockRejectedValue(err);
    setup(v1ReadyFinding);
    fireEvent.click(screen.getByRole("radio", { name: /confirmed — send to referral package/i }));
    fireEvent.click(screen.getByLabelText(/overreach/i));
    const confirm = screen.getByRole("button", { name: /confirm thread/i });
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
      <TieOffModal open caseId="c" finding={v1ReadyFinding} onClose={onClose} onTiedOff={() => {}} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /confirmed — send to referral package/i }));
    fireEvent.click(screen.getByLabelText(/overreach/i));
    fireEvent.click(screen.getByRole("button", { name: /confirm thread/i }));
    await waitFor(() => expect(screen.getByText(/network down/i)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();  // modal stays open
  });
});
