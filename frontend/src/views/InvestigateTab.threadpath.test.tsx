// frontend/src/views/InvestigateTab.threadpath.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";

vi.mock("../hooks/useFeederActions", () => ({
  useFeederActions: () => ({
    startAngleFrom: vi.fn().mockResolvedValue({ id: "x", title: "x" }),
    citeToAngle: vi.fn().mockResolvedValue(undefined),
    pickerOpen: false, closePicker: vi.fn(), onPickerPick: vi.fn(),
  }),
}));

// Cytoscape stub: never render real Cytoscape in jsdom. Expose an edge button so we can
// drive the Relationship-panel → thread_ref path. onCyInit is intentionally not called.
vi.mock("../components/CytoscapeCanvas", () => ({
  default: ({ onEdgeClick }: { onEdgeClick?: (id: string) => void }) => (
    <div>
      <button data-testid="cy-canvas">canvas</button>
      <button data-testid="cy-edge" onClick={() => onEdgeClick?.("a__b")}>edge</button>
    </div>
  ),
}));

// t1 = edge-backed (on a__b); t2 = subject-only (no edge, no entity_links → no map path)
const THREAD_PAGE = {
  count: 2, limit: 100, offset: 0, next_offset: null, previous_offset: null,
  results: [
    { id: "t1", rule_id: "SR-015", title: "Insider swap", description: "", narrative: "", severity: "HIGH", status: "NEEDS_EVIDENCE", evidence_weight: "SPECULATIVE", overreach_reviewed: false, source: "AUTO", investigator_note: "", legal_refs: [], evidence_snapshot: {}, trigger_doc_id: null, trigger_doc_filename: null, trigger_entity_id: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", entity_links: [], document_links: [] },
    { id: "t2", rule_id: "SR-029", title: "Low program ratio", description: "", narrative: "", severity: "MEDIUM", status: "NEEDS_EVIDENCE", evidence_weight: "SPECULATIVE", overreach_reviewed: false, source: "AUTO", investigator_note: "", legal_refs: [], evidence_snapshot: {}, trigger_doc_id: null, trigger_doc_filename: null, trigger_entity_id: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", entity_links: [], document_links: [] },
  ],
};

vi.mock("../api", () => ({
  fetchGraph: vi.fn().mockResolvedValue({ nodes: [{ id: "a", type: "person", label: "Jay", metadata: { finding_count: 0, doc_count: 0 } }, { id: "b", type: "organization", label: "Acme", metadata: { finding_count: 0, doc_count: 0 } }], edges: [], timeline_events: [], stats: { node_types: { person: 1, organization: 1 }, total_edges: 0 } }),
  fetchCaseMap: vi.fn().mockResolvedValue({
    case_id: "c1",
    nodes: [
      { id: "a", type: "person", label: "Jay", subtype: null, flags: { status_unknown: false, has_active_thread: true, has_substantiated_thread: false }, metadata: { thread_count: 1, document_count: 0 } },
      { id: "b", type: "organization", label: "Acme", subtype: null, flags: { status_unknown: false, has_active_thread: false, has_substantiated_thread: false }, metadata: { thread_count: 0, document_count: 0 } },
    ],
    edges: [{
      id: "a__b", source: "a", target: "b", relationship: "SUMMARY", label: "Documented relationship", state: "documented",
      strength: { score: 30, level: "documented", categories: ["formal_role"], source_count: 0, transaction_count: 0, role_count: 1, thread_count: 1, substantiated_thread_count: 0, handoff_included: false, relationship_types: ["OFFICER_OF"], reasons: ["Formal role documented"] },
      evidence_refs: [],
      thread_refs: [{ thread_id: "t1", title: "Insider swap", status: "NEEDS_EVIDENCE", severity: "HIGH", rule_id: "SR-015", signal_type: "INSIDER_SWAP", handoff_ready: false }],
      underlying_relationships: [],
    }],
    stats: { subject_count: 2, edge_count: 1, by_level: { observed: 0, documented: 1, repeated: 0, material: 0 }, material_edge_count: 0, handoff_edge_count: 0, generated_at: "2026-06-19T00:00:00Z" },
  }),
  fetchAngles: vi.fn().mockResolvedValue({
    count: 2, limit: 100, offset: 0, next_offset: null, previous_offset: null,
    results: [
      { id: "t1", rule_id: "SR-015", title: "Insider swap", description: "", narrative: "", severity: "HIGH", status: "NEEDS_EVIDENCE", evidence_weight: "SPECULATIVE", overreach_reviewed: false, source: "AUTO", investigator_note: "", legal_refs: [], evidence_snapshot: {}, trigger_doc_id: null, trigger_doc_filename: null, trigger_entity_id: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", entity_links: [], document_links: [] },
      { id: "t2", rule_id: "SR-029", title: "Low program ratio", description: "", narrative: "", severity: "MEDIUM", status: "NEEDS_EVIDENCE", evidence_weight: "SPECULATIVE", overreach_reviewed: false, source: "AUTO", investigator_note: "", legal_refs: [], evidence_snapshot: {}, trigger_doc_id: null, trigger_doc_filename: null, trigger_entity_id: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", entity_links: [], document_links: [] },
    ],
  }),
  fetchFuzzyMatches: vi.fn().mockResolvedValue({ count: 0, results: [] }),
  fetchDashboard: vi.fn().mockResolvedValue({ case: { id: "c1", name: "C", status: "ACTIVE", created_at: "2026-06-01T00:00:00Z", referral_ref: "" }, documents: { total: 0, by_type: {}, by_extraction_status: {}, renamed_count: 0 }, entities: { persons: 1, organizations: 1, properties: 0, financial_instruments: 0, total: 2 }, findings: { total: 2, by_status: {} }, credibility: { referral_grade: 0, need_work: 0, agency_leads: 0 }, quality: undefined }),
  fetchReferralReadiness: vi.fn().mockResolvedValue({ status: "BLOCKED", summary: "", items: [], quality: undefined, credibility: { referral_grade: 0, need_work: 0, agency_leads: 0 } }),
  fetchEntityDetail: vi.fn().mockResolvedValue({ id: "a", entity_type: "person", name: "Jay", related_documents: [], related_findings: [] }),
  fetchAngle: vi.fn().mockResolvedValue({ id: "t1", title: "Insider swap", status: "NEEDS_EVIDENCE", severity: "HIGH", narrative: "", evidence_weight: "SPECULATIVE", overreach_reviewed: false, document_links: [] }),
  updateAngle: vi.fn().mockResolvedValue({}),
  runAiPatternAnalysis: vi.fn(),
  reevaluateSignals: vi.fn(),
}));

import * as api from "../api";
import InvestigateTab from "./InvestigateTab";
import { CaseWorkspaceProvider } from "../context/CaseWorkspaceContext";

function renderTab() {
  return render(
    <CaseWorkspaceProvider>
      <InvestigateTab caseId="c1" documents={[]} />
    </CaseWorkspaceProvider>,
  );
}
beforeEach(() => vi.clearAllMocks());

describe("InvestigateTab Thread Path Mode", () => {
  it("dock lists threads and selecting a row opens ThreadInspector + marks the row active", async () => {
    const { findByLabelText, findByText, container } = renderTab();
    const row = await findByLabelText(/thread row Insider swap/i);
    fireEvent.click(row);
    // ThreadInspector mounts (fetchAngle resolves the detail) and the dock row is active
    await waitFor(() => expect(api.fetchAngle).toHaveBeenCalledWith("c1", "t1"));
    await findByText("Thread"); // ThreadInspector header label
    const activeRow = container.querySelector('[aria-label="thread row Insider swap"]');
    expect(activeRow?.getAttribute("data-active")).toBe("true");
  });

  it("a subject-only thread with no map presence shows the no-visible-path note", async () => {
    const { findByLabelText, findByText } = renderTab();
    // t2 has no edge and no entity_links → threadPath empty → noVisibleMapPath
    // (fetchAngle returns t1 shape, but entity_links default empty in InvestigateTab's pathSet from the t2 dock row)
    vi.mocked(api.fetchAngle).mockResolvedValueOnce({ id: "t2", title: "Low program ratio", status: "NEEDS_EVIDENCE", severity: "MEDIUM", narrative: "", evidence_weight: "SPECULATIVE", overreach_reviewed: false, document_links: [] } as never);
    fireEvent.click(await findByLabelText(/thread row Low program ratio/i));
    expect(await findByText(/no visible Case Map path yet/i)).toBeTruthy();
  });

  it("the Case Map still renders when fetchAngles rejects (fetch isolation)", async () => {
    vi.mocked(api.fetchAngles).mockRejectedValueOnce(new Error("boom"));
    const { findByTestId, findByText } = renderTab();
    expect(await findByTestId("cy-canvas")).toBeTruthy();      // map not blanked
    expect(await findByText(/load threads/i)).toBeTruthy(); // dock error
  });

  it("101st-thread fallback: a thread not in the dock page still opens via the Relationship panel", async () => {
    // dock page WITHOUT t1; the edge still references t1 via thread_ref
    vi.mocked(api.fetchAngles).mockResolvedValueOnce({ ...THREAD_PAGE, count: 101, results: THREAD_PAGE.results.filter((t) => t.id !== "t1") } as never);
    const { getByTestId, findByText } = renderTab();
    await waitFor(() => expect(api.fetchCaseMap).toHaveBeenCalled());
    fireEvent.click(getByTestId("cy-edge"));                   // open RelationshipSummaryPanel
    fireEvent.click(await findByText("Insider swap"));         // thread_ref row → selectThread("t1")
    // fallback fetchAngle("c1","t1") resolves the detail even though t1 wasn't in the dock page
    await waitFor(() => expect(api.fetchAngle).toHaveBeenCalledWith("c1", "t1"));
    expect(await findByText("Thread")).toBeTruthy();
  });
});
