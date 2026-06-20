// frontend/src/views/InvestigateTab.caseMap.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";

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
    ],
    stats: { subject_count: 2, edge_count: 1, by_level: { observed: 0, documented: 1, repeated: 0, material: 0 }, material_edge_count: 0, handoff_edge_count: 0, generated_at: "2026-06-19T00:00:00Z" },
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
  fetchEntityDetail: vi.fn().mockResolvedValue({}),
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
    // subject_count is 2; entities.total (10) must NOT be the source
    expect(text).not.toContain("10 Subjects");
  });

  it("edge click opens RelationshipSummaryPanel from the SummaryEdge", async () => {
    const { getByTestId, container, findByText } = renderTab();
    await waitFor(() => expect(api.fetchCaseMap).toHaveBeenCalled());
    fireEvent.click(getByTestId("cy-edge"));
    // panel shows the summary edge's level + reason (not ConnectionDetailPanel)
    expect(await findByText("Formal role documented")).toBeTruthy();
    expect(container.textContent ?? "").toContain("does not imply wrongdoing");
  });

  it("clears the selected relationship when navigating to a subject profile", async () => {
    const { getByTestId, queryByText, findByText } = renderTab();
    await waitFor(() => expect(api.fetchCaseMap).toHaveBeenCalled());
    fireEvent.click(getByTestId("cy-edge"));
    await findByText("Formal role documented");
    // node click navigates away (and must clear selectedSummaryEdge)
    fireEvent.click(getByTestId("cy-node"));
    await waitFor(() => expect(queryByText("Formal role documented")).toBeNull());
  });
});
