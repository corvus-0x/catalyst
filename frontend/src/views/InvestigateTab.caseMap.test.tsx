// frontend/src/views/InvestigateTab.caseMap.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";

// Feeder mock — hoisted so onStartThread / onCite assertions can introspect calls.
const mockStartAngleFrom = vi.fn().mockResolvedValue({ id: "new-angle", title: "Jay" });
const mockCiteToAngle = vi.fn().mockResolvedValue(undefined);
vi.mock("../hooks/useFeederActions", () => ({
  useFeederActions: () => ({
    startAngleFrom: mockStartAngleFrom,
    citeToAngle: mockCiteToAngle,
    pickerOpen: false,
    closePicker: vi.fn(),
    onPickerPick: vi.fn(),
  }),
}));

// Mock CytoscapeCanvas — do NOT render real Cytoscape in jsdom (flaky, and the
// visual mapping is already unit-tested in caseMapElements.test.ts). The stub
// exposes buttons that fire onNodeClick / onEdgeClick so we can drive selection.
vi.mock("../components/CytoscapeCanvas", () => ({
  default: ({ onNodeClick, onEdgeClick }: {
    onNodeClick?: (id: string) => void;
    onEdgeClick?: (id: string) => void;
  }) => (
    <div>
      <button data-testid="cy-node" onClick={() => onNodeClick?.("a")}>node</button>
      <button data-testid="cy-edge" onClick={() => onEdgeClick?.("a__b")}>edge</button>
    </div>
  ),
}));

// Mock the API module so we can assert dual-fetch and feed canvas data.
vi.mock("../api", () => ({
  fetchGraph: vi.fn().mockResolvedValue({ nodes: [{ id: "a", type: "person", label: "Jay", metadata: { finding_count: 0, doc_count: 0 } }], edges: [], timeline_events: [], stats: { node_types: { person: 1 }, total_edges: 0 } }),
  fetchCaseMap: vi.fn().mockResolvedValue({
    case_id: "c1",
    nodes: [
      { id: "a", type: "person", label: "Jay", subtype: null, flags: { status_unknown: false, has_active_thread: false, has_substantiated_thread: false }, metadata: { thread_count: 0, document_count: 0 } },
      { id: "b", type: "organization", label: "Acme", subtype: null, flags: { status_unknown: false, has_active_thread: false, has_substantiated_thread: false }, metadata: { thread_count: 0, document_count: 0 } },
    ],
    edges: [
      { id: "a__b", source: "a", target: "b", relationship: "SUMMARY", label: "Documented relationship", state: "documented",
        strength: { score: 30, level: "documented", categories: ["formal_role"], source_count: 0, transaction_count: 0, role_count: 1, thread_count: 0, substantiated_thread_count: 0, handoff_included: false, relationship_types: ["OFFICER_OF"], reasons: ["Formal role documented"] },
        evidence_refs: [], thread_refs: [], underlying_relationships: [] },
      // Second edge with a DISTINCT reason — proves handleEdgeClick resolves by id,
      // not by source/target or first-match.
      { id: "a__c", source: "a", target: "c", relationship: "SUMMARY", label: "Observed relationship", state: "observed",
        strength: { score: 15, level: "observed", categories: ["shared_address"], source_count: 0, transaction_count: 0, role_count: 0, thread_count: 0, substantiated_thread_count: 0, handoff_included: false, relationship_types: [], reasons: ["Shared address appears in records"] },
        evidence_refs: [], thread_refs: [], underlying_relationships: [] },
    ],
    stats: { subject_count: 2, edge_count: 2, by_level: { observed: 1, documented: 1, repeated: 0, material: 0 }, material_edge_count: 0, handoff_edge_count: 0, generated_at: "2026-06-19T00:00:00Z" },
  }),
  fetchFuzzyMatches: vi.fn().mockResolvedValue({ count: 0, results: [] }),
  fetchDashboard: vi.fn().mockResolvedValue({
    case: { id: "c1", name: "C", status: "ACTIVE", created_at: "2026-06-01T00:00:00Z", referral_ref: "" },
    documents: { total: 0, by_type: {}, by_extraction_status: {}, renamed_count: 0 },
    entities: { persons: 1, organizations: 1, properties: 5, financial_instruments: 3, total: 10 },
    findings: { total: 0, by_status: {} },
    credibility: { referral_grade: 0, need_work: 0, agency_leads: 0 },
    quality: undefined,
  }),
  fetchEntityDetail: vi.fn().mockResolvedValue({ id: "a", entity_type: "person", name: "Jay", related_documents: [], related_findings: [] }),
  fetchNotes: vi.fn().mockResolvedValue({ results: [] }),
  createNote: vi.fn().mockResolvedValue({}),
  fetchReferralReadiness: vi.fn().mockResolvedValue({ status: "BLOCKED", summary: "", items: [], quality: undefined, credibility: { referral_grade: 0, need_work: 0, agency_leads: 0 } }),
  runAiPatternAnalysis: vi.fn(),
  reevaluateSignals: vi.fn(),
  fetchAngle: vi.fn().mockResolvedValue({ id: "t1", title: "Insider swap", status: "NEEDS_EVIDENCE", severity: "HIGH", narrative: "", evidence_weight: "SPECULATIVE", overreach_reviewed: false, document_links: [] }),
  fetchAngles: vi.fn().mockResolvedValue({ count: 0, results: [], limit: 100, offset: 0, next_offset: null, previous_offset: null }),
  updateAngle: vi.fn().mockResolvedValue({}),
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

describe("InvestigateTab Case Map wiring", () => {
  it("dual-fetches /case-map/ and /graph/ on mount", async () => {
    renderTab();
    await waitFor(() => expect(api.fetchCaseMap).toHaveBeenCalledWith("c1"));
    expect(api.fetchGraph).toHaveBeenCalledWith("c1");
  });

  it("stats bar Subjects count comes from caseMap.stats, not entity total", async () => {
    const { container } = renderTab();
    await waitFor(() => expect(api.fetchCaseMap).toHaveBeenCalled());
    const text = container.textContent ?? "";
    expect(text).toContain("Subjects");
    expect(text).not.toContain("Entities"); // relabeled
    // subject_count is 2; entities.total (10) must NOT be the source. WebStatsBar
    // renders the value in its own span, so assert the rendered value is 2 (not 10).
    const statValues = Array.from(container.querySelectorAll(".web-stats-chip__value")).map(
      (el) => el.textContent,
    );
    expect(statValues).toContain("2");
    expect(statValues).not.toContain("10");
  });

  it("edge click opens RelationshipSummaryPanel for the edge matching the clicked id", async () => {
    const { getByTestId, container, findByText } = renderTab();
    await waitFor(() => expect(api.fetchCaseMap).toHaveBeenCalled());
    fireEvent.click(getByTestId("cy-edge")); // fires onEdgeClick("a__b")
    // panel shows a__b's reason (not ConnectionDetailPanel, not the other edge a__c)
    expect(await findByText("Formal role documented")).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).toContain("does not imply wrongdoing");
    expect(text).not.toContain("Shared address appears in records"); // a__c, not selected
  });

  it("re-run rules refetches /case-map/ and clears the open relationship (D5)", async () => {
    const { getByTestId, getByLabelText, queryByText, findByText } = renderTab();
    await waitFor(() => expect(api.fetchCaseMap).toHaveBeenCalledTimes(1));
    fireEvent.click(getByTestId("cy-edge"));
    await findByText("Formal role documented");
    fireEvent.click(getByLabelText("Re-run signal rules"));
    await waitFor(() => expect(api.reevaluateSignals).toHaveBeenCalledWith("c1"));
    // D5: the re-run refresh refetches the Case Map (2nd call) ...
    await waitFor(() => expect(api.fetchCaseMap).toHaveBeenCalledTimes(2));
    // ... and clears the now-possibly-stale relationship panel.
    await waitFor(() => expect(queryByText("Formal role documented")).toBeNull());
  });

  it("clears the selected relationship when navigating to a subject profile", async () => {
    const { getByTestId, queryByText, findByText } = renderTab();
    await waitFor(() => expect(api.fetchCaseMap).toHaveBeenCalled());
    fireEvent.click(getByTestId("cy-edge"));
    await findByText("Formal role documented");
    // node click calls clearSelection() then selectSubject() — selection.kind changes to "subject",
    // hiding the relationship panel
    fireEvent.click(getByTestId("cy-node"));
    await waitFor(() => expect(queryByText("Formal role documented")).toBeNull());
  });

  it("onStartThread invokes feeder.startAngleFrom with the subject's display name (not a no-op)", async () => {
    const { getByTestId, findByText, getByText } = renderTab();
    await waitFor(() => expect(api.fetchCaseMap).toHaveBeenCalled());
    // Select node "a" (Jay) — triggers SubjectInspector
    fireEvent.click(getByTestId("cy-node"));
    await findByText("Jay"); // SubjectInspector rendered
    // Click "Start thread" action button in SubjectInspector
    fireEvent.click(getByText("Start thread"));
    await waitFor(() =>
      expect(mockStartAngleFrom).toHaveBeenCalledWith({ title: "Jay" }),
    );
  });

  it("onCite invokes feeder.citeToAngle with the subject's label (not a no-op)", async () => {
    const { getByTestId, findByText, getByText } = renderTab();
    await waitFor(() => expect(api.fetchCaseMap).toHaveBeenCalled());
    fireEvent.click(getByTestId("cy-node")); // select Jay
    await findByText("Jay");
    fireEvent.click(getByText("Cite into active thread"));
    await waitFor(() =>
      expect(mockCiteToAngle).toHaveBeenCalledWith({ label: "Jay" }),
    );
  });

  it("background refresh (re-run rules) keeps a subject selection open", async () => {
    // Verifies the narrowed refreshCaseData: only relationship selections are cleared;
    // subject selections survive a background refresh so SubjectInspector stays open.
    const { getByTestId, getByLabelText, findByText } = renderTab();
    await waitFor(() => expect(api.fetchCaseMap).toHaveBeenCalledTimes(1));
    // Select a subject node
    fireEvent.click(getByTestId("cy-node"));
    await findByText("Jay"); // SubjectInspector shows the subject name
    // Trigger a background re-run (which calls refreshCaseData)
    fireEvent.click(getByLabelText("Re-run signal rules"));
    await waitFor(() => expect(api.reevaluateSignals).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(api.fetchCaseMap).toHaveBeenCalledTimes(2));
    // Subject inspector must still be visible — subject UUIDs are stable across refresh
    expect(await findByText("Jay")).toBeTruthy();
  });

  it("thread selection survives a background refresh", async () => {
    // Override fetchCaseMap to return an edge with a thread_ref so we can select a thread.
    vi.mocked(api.fetchCaseMap).mockResolvedValue({
      case_id: "c1",
      nodes: [
        { id: "a", type: "person", label: "Jay", subtype: null, flags: { status_unknown: false, has_active_thread: true, has_substantiated_thread: false }, metadata: { thread_count: 1, document_count: 0 } },
        { id: "b", type: "organization", label: "Acme", subtype: null, flags: { status_unknown: false, has_active_thread: false, has_substantiated_thread: false }, metadata: { thread_count: 0, document_count: 0 } },
      ],
      edges: [
        { id: "a__b", source: "a", target: "b", relationship: "SUMMARY", label: "Documented relationship", state: "documented",
          strength: { score: 30, level: "documented", categories: ["formal_role"], source_count: 0, transaction_count: 0, role_count: 1, thread_count: 1, substantiated_thread_count: 0, handoff_included: false, relationship_types: ["OFFICER_OF"], reasons: ["Formal role documented"] },
          evidence_refs: [],
          thread_refs: [{ thread_id: "t1", title: "Insider swap", status: "NEEDS_EVIDENCE", severity: "HIGH", rule_id: "SR-015", signal_type: "INSIDER_SWAP", handoff_ready: false }],
          underlying_relationships: [] },
      ],
      stats: { subject_count: 2, edge_count: 1, by_level: { observed: 0, documented: 1, repeated: 0, material: 0 }, material_edge_count: 0, handoff_edge_count: 0, generated_at: "2026-06-19T00:00:00Z" },
    } as unknown as import("../types").CaseMapResponse);

    const { getByTestId, getByLabelText, findByText } = renderTab();
    await waitFor(() => expect(api.fetchCaseMap).toHaveBeenCalledTimes(1));

    // Click edge to open RelationshipSummaryPanel
    fireEvent.click(getByTestId("cy-edge")); // edge "a__b"
    await findByText("Insider swap"); // thread_ref row in RelationshipSummaryPanel

    // Click the thread row → ThreadInspector mounts
    fireEvent.click(await findByText("Insider swap"));
    // ThreadInspector fetches the thread — wait for the title to appear
    await waitFor(() => expect(api.fetchAngle).toHaveBeenCalledWith("c1", "t1"));
    // ThreadInspector should be mounted (thread title visible from fetchAngle mock)
    await findByText("Insider swap");

    // Trigger a background re-run (which calls refreshCaseData)
    fireEvent.click(getByLabelText("Re-run signal rules"));
    await waitFor(() => expect(api.reevaluateSignals).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(api.fetchCaseMap).toHaveBeenCalledTimes(2));
    // ThreadInspector must still be mounted — thread UUID is stable across refresh
    expect(await findByText("Insider swap")).toBeTruthy();
  });

  it("profile open: fetchEntityDetail called with opened subject id (not stale data)", async () => {
    // Select subject "a" (Jay) — opens SubjectInspector in the rail.
    const { getByTestId, findByText, getByText } = renderTab();
    await waitFor(() => expect(api.fetchCaseMap).toHaveBeenCalled());
    fireEvent.click(getByTestId("cy-node")); // selectSubject("a")
    await findByText("Jay"); // SubjectInspector renders

    // Click "Open full profile" — should trigger fetchEntityDetail with subject id "a"
    // and NOT pass stale data from a prior subject.
    fireEvent.click(getByText("Open full profile"));
    await waitFor(() =>
      expect(api.fetchEntityDetail).toHaveBeenCalledWith("person", "a"),
    );
  });
});
