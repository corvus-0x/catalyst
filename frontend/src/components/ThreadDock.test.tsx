import { render, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ThreadDock from "./ThreadDock";
import type { FindingItem } from "../types";

// Accurate FindingItem (frontend/src/types/index.ts:835-882) — no cast.
function thread(over: Partial<FindingItem>): FindingItem {
  return {
    id: "t1", rule_id: "SR-015", title: "Insider swap", description: "",
    narrative: "", severity: "HIGH", status: "NEEDS_EVIDENCE",
    evidence_weight: "SPECULATIVE", overreach_reviewed: false, source: "AUTO",
    investigator_note: "", legal_refs: [], evidence_snapshot: {},
    trigger_doc_id: null, trigger_doc_filename: null, trigger_entity_id: null,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    entity_links: [], document_links: [], elements: [], gate_version: "ASSERTION_V1",
    ...over,
  };
}

const THREADS = [
  thread({ id: "med", title: "Overpayment", severity: "MEDIUM", status: "DISMISSED" }),
  thread({ id: "crit", title: "990 contradiction", severity: "CRITICAL", status: "CONFIRMED",
    evidence_weight: "DOCUMENTED", overreach_reviewed: true,
    document_links: [{ document_id: "d", document_filename: "x", page_reference: "", context_note: "" }] }),
  thread({ id: "high", title: "Insider swap", severity: "HIGH", status: "NEEDS_EVIDENCE" }),
];

describe("ThreadDock", () => {
  it("renders rows default-sorted by severity (CRITICAL first)", () => {
    const { getAllByRole } = render(
      <ThreadDock threads={THREADS} totalCount={3} loading={false} error={false}
        selectedThreadId={undefined} onSelectThread={() => {}} onRetry={() => {}} />,
    );
    const rows = getAllByRole("button", { name: /thread row/i });
    expect(within(rows[0]).getByText("990 contradiction")).toBeTruthy();
    expect(within(rows[2]).getByText("Overpayment")).toBeTruthy();
  });

  it("re-sorts by status when the sort key changes (NEEDS_EVIDENCE < CONFIRMED < DISMISSED)", () => {
    const { getByRole, getAllByRole } = render(
      <ThreadDock threads={THREADS} totalCount={3} loading={false} error={false}
        selectedThreadId={undefined} onSelectThread={() => {}} onRetry={() => {}} />,
    );
    fireEvent.change(getByRole("combobox"), { target: { value: "status" } });
    const rows = getAllByRole("button", { name: /thread row/i });
    expect(within(rows[0]).getByText("Insider swap")).toBeTruthy();      // NEEDS_EVIDENCE (rank 1)
    expect(within(rows[1]).getByText("990 contradiction")).toBeTruthy(); // CONFIRMED (rank 2)
    expect(within(rows[2]).getByText("Overpayment")).toBeTruthy();       // DISMISSED (rank 3)
  });

  it("calls onSelectThread with the row id on click", () => {
    const onSelect = vi.fn();
    const { getByText } = render(
      <ThreadDock threads={THREADS} totalCount={3} loading={false} error={false}
        selectedThreadId={undefined} onSelectThread={onSelect} onRetry={() => {}} />,
    );
    fireEvent.click(getByText("Insider swap"));
    expect(onSelect).toHaveBeenCalledWith("high");
  });

  it("marks the active row from selectedThreadId", () => {
    const { getByText } = render(
      <ThreadDock threads={THREADS} totalCount={3} loading={false} error={false}
        selectedThreadId="high" onSelectThread={() => {}} onRetry={() => {}} />,
    );
    const row = getByText("Insider swap").closest("[data-active]");
    expect(row?.getAttribute("data-active")).toBe("true");
  });

  it("shows the readiness cell from threadReadiness", () => {
    const { getByText } = render(
      <ThreadDock threads={THREADS} totalCount={3} loading={false} error={false}
        selectedThreadId={undefined} onSelectThread={() => {}} onRetry={() => {}} />,
    );
    // the CONFIRMED+cited+documented+overreach thread is referral-grade
    expect(getByText(/referral-grade/i)).toBeTruthy();
  });

  it("shows an honest 'N of M' note when more threads exist than were loaded", () => {
    const { getByText } = render(
      <ThreadDock threads={THREADS} totalCount={137} loading={false} error={false}
        selectedThreadId={undefined} onSelectThread={() => {}} onRetry={() => {}} />);
    expect(getByText(/Showing 3 of 137 threads/i)).toBeTruthy();
  });

  it("shows no count note when all threads are loaded", () => {
    const { queryByText } = render(
      <ThreadDock threads={THREADS} totalCount={3} loading={false} error={false}
        selectedThreadId={undefined} onSelectThread={() => {}} onRetry={() => {}} />);
    expect(queryByText(/Showing .* of .* threads/i)).toBeNull();
  });

  it("renders empty / loading / error states", () => {
    const empty = render(
      <ThreadDock threads={[]} totalCount={0} loading={false} error={false}
        selectedThreadId={undefined} onSelectThread={() => {}} onRetry={() => {}} />);
    expect(empty.getByText(/No threads yet/i)).toBeTruthy();

    const loading = render(
      <ThreadDock threads={[]} totalCount={0} loading error={false}
        selectedThreadId={undefined} onSelectThread={() => {}} onRetry={() => {}} />);
    expect(loading.getByText(/Loading threads/i)).toBeTruthy();

    const onRetry = vi.fn();
    const err = render(
      <ThreadDock threads={[]} totalCount={0} loading={false} error
        selectedThreadId={undefined} onSelectThread={() => {}} onRetry={onRetry} />);
    fireEvent.click(err.getByText(/Retry/i));
    expect(onRetry).toHaveBeenCalled();
  });

  it("collapses to the header when toggled", () => {
    const { getByLabelText, queryByText } = render(
      <ThreadDock threads={THREADS} totalCount={3} loading={false} error={false}
        selectedThreadId={undefined} onSelectThread={() => {}} onRetry={() => {}} />);
    fireEvent.click(getByLabelText(/collapse threads/i));
    expect(queryByText("Insider swap")).toBeNull();
  });
});
