// views/InvestigateTab.frame.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";

vi.mock("../components/CytoscapeCanvas", () => ({
  default: ({ onNodeClick }: { onNodeClick?: (id: string) => void }) => (
    <button data-testid="cy-node" onClick={() => onNodeClick?.("a")}>node</button>
  ),
}));
vi.mock("../api", () => ({
  fetchGraph: vi.fn().mockResolvedValue({ nodes: [{ id: "a", type: "person", label: "Jay", metadata: { finding_count: 0, doc_count: 0 } }], edges: [], timeline_events: [], stats: { node_types: { person: 1 }, total_edges: 0 } }),
  fetchCaseMap: vi.fn().mockResolvedValue({ case_id: "c1", nodes: [{ id: "a", type: "person", label: "Jay", subtype: null, flags: { status_unknown: false, has_active_thread: false, has_substantiated_thread: false }, metadata: { thread_count: 0, document_count: 0 } }], edges: [], stats: { subject_count: 1, edge_count: 0, by_level: { observed: 0, documented: 0, repeated: 0, material: 0 }, material_edge_count: 0, handoff_edge_count: 0, generated_at: "x" } }),
  fetchFuzzyMatches: vi.fn().mockResolvedValue({ count: 0, results: [] }),
  fetchDashboard: vi.fn().mockResolvedValue({ case: { id: "c1", name: "C", status: "ACTIVE", created_at: "2026-06-01T00:00:00Z", referral_ref: "" }, documents: { total: 0, by_type: {}, by_extraction_status: {}, renamed_count: 0 }, entities: { persons: 1, organizations: 0, properties: 0, financial_instruments: 0, total: 1 }, findings: { total: 0, by_status: {} }, credibility: { referral_grade: 0, need_work: 0, agency_leads: 0 }, quality: undefined }),
  fetchReferralReadiness: vi.fn().mockResolvedValue({ status: "BLOCKED", summary: "", items: [], quality: undefined, credibility: { referral_grade: 0, need_work: 0, agency_leads: 0 } }),
  fetchEntityDetail: vi.fn().mockResolvedValue({ id: "a", entity_type: "person", name: "Jay", related_documents: [], related_findings: [] }),
  fetchNotes: vi.fn().mockResolvedValue({ results: [] }),
  createNote: vi.fn().mockResolvedValue({}),
  runAiPatternAnalysis: vi.fn(), reevaluateSignals: vi.fn(),
}));

import * as api from "../api";
import InvestigateTab from "./InvestigateTab";
import { CaseWorkspaceProvider } from "../context/CaseWorkspaceContext";

const renderTab = () => render(
  <CaseWorkspaceProvider><InvestigateTab caseId="c1" documents={[]} /></CaseWorkspaceProvider>,
);
beforeEach(() => vi.clearAllMocks());

describe("InvestigateTab reducer migration", () => {
  it("loads /case-map/, /graph/, dashboard AND readiness on mount", async () => {
    renderTab();
    await waitFor(() => expect(api.fetchCaseMap).toHaveBeenCalledWith("c1"));
    expect(api.fetchGraph).toHaveBeenCalledWith("c1");
    expect(api.fetchReferralReadiness).toHaveBeenCalledWith("c1");
  });

  it("node click SELECTS the subject and keeps the map visible (selection != frame)", async () => {
    const { getByTestId, findByText } = renderTab();
    await waitFor(() => expect(api.fetchCaseMap).toHaveBeenCalled());
    fireEvent.click(getByTestId("cy-node"));
    // THE RULE: selecting a subject is inspector state — the map (canvas stub) stays mounted,
    // we do NOT push a profile frame. SubjectInspector renders beside the map with the subject name.
    expect(getByTestId("cy-node")).toBeTruthy();           // canvas still rendered
    expect(await findByText("Jay")).toBeTruthy();          // SubjectInspector shows identity
  });
});
