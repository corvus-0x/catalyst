/**
 * DashboardView.test.tsx
 *
 * Pins the "Total threads" KPI stat: the dashboard must sum `total_count`
 * across every row of the real `/api/signal-summary/` payload — a per-case
 * array (`{ results: [{ case_id, highest_severity, open_count, total_count,
 * by_severity }] }`) — rather than reading a top-level `total` field that
 * the endpoint never returns. Also pins the "Total threads" label
 * (vocabulary rule: Angle -> Thread).
 *
 * Mocking strategy: vi.mock("../api") — same pattern as ReferralsTab.test.tsx.
 * DashboardView calls fetchCases, createCase, fetchSignalSummary, and
 * fetchActivityFeed; all four are mocked so nothing hits the network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DashboardView from "./DashboardView";

vi.mock("../api", () => ({
  fetchCases: vi.fn(),
  createCase: vi.fn(),
  fetchSignalSummary: vi.fn(),
  fetchActivityFeed: vi.fn(),
}));

import * as api from "../api";

import type { CaseListResponse, ActivityFeedResponse, SignalSummary } from "../types";

const emptyCases: CaseListResponse = {
  count: 0,
  limit: 5,
  offset: 0,
  next_offset: null,
  previous_offset: null,
  results: [],
};
const emptyActivity: ActivityFeedResponse = { count: 0, results: [] };

// Real shape observed from prod GET /api/signal-summary/: a per-case array,
// each row carrying `total_count` — there is no top-level `total` field.
const realSignalSummary: SignalSummary = {
  results: [
    {
      case_id: "a037100b-88ea-4119-96e8-f3c1918eb556",
      highest_severity: "CRITICAL",
      open_count: 3,
      total_count: 12,
      by_severity: { CRITICAL: 1, HIGH: 1, MEDIUM: 0, LOW: 0 },
    },
  ],
};

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DashboardView />
    </MemoryRouter>
  );
}

describe("DashboardView — Total threads stat", () => {
  beforeEach(() => {
    vi.mocked(api.fetchCases).mockResolvedValue(emptyCases);
    vi.mocked(api.fetchActivityFeed).mockResolvedValue(emptyActivity);
  });

  it("sums total_count across signal-summary rows and uses Thread vocabulary", async () => {
    vi.mocked(api.fetchSignalSummary).mockResolvedValue(realSignalSummary);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Total threads")).toBeInTheDocument();
    });
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.queryByText("Total angles")).not.toBeInTheDocument();
  });

  it("sums multiple case rows rather than reading a nonexistent top-level total", async () => {
    const twoCaseSummary: SignalSummary = {
      results: [
        { ...realSignalSummary.results[0], case_id: "case-1", total_count: 12 },
        { ...realSignalSummary.results[0], case_id: "case-2", total_count: 5 },
      ],
    };
    vi.mocked(api.fetchSignalSummary).mockResolvedValue(twoCaseSummary);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("17")).toBeInTheDocument();
    });
  });

  it("renders 0 when no case has any findings (empty results array)", async () => {
    vi.mocked(api.fetchSignalSummary).mockResolvedValue({ results: [] });

    renderDashboard();

    let label: HTMLElement;
    await waitFor(() => {
      label = screen.getByText("Total threads");
      expect(label).toBeInTheDocument();
    });
    // Total cases and Active cases are also 0 with an empty case list, so
    // scope to the value rendered inside the same stat card as the label.
    expect(label!.parentElement?.textContent).toContain("0");
    expect(label!.previousElementSibling?.textContent).toBe("0");
  });
});
