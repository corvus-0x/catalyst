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

describe("DashboardView — Activity feed copy (P1-3)", () => {
  beforeEach(() => {
    vi.mocked(api.fetchCases).mockResolvedValue(emptyCases);
    vi.mocked(api.fetchSignalSummary).mockResolvedValue({ results: [] });
  });

  it("humanizes RECORD_UPDATED on the findings table as Thread updated", async () => {
    const activity: ActivityFeedResponse = {
      count: 1,
      results: [
        {
          id: "act-1",
          case_id: "case-1",
          table_name: "findings",
          record_id: "rec-1",
          action: "RECORD_UPDATED",
          performed_by: "",
          performed_at: "2026-07-08T13:46:22.533208+00:00",
          notes: "",
        },
      ],
    };
    vi.mocked(api.fetchActivityFeed).mockResolvedValue(activity);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Thread updated")).toBeInTheDocument();
    });
    expect(screen.queryByText("RECORD_UPDATED")).not.toBeInTheDocument();
    expect(screen.queryByText("Record updated")).not.toBeInTheDocument();
  });

  it("maps the internal 'reevaluate_signals' note to human copy, never the raw note", async () => {
    const activity: ActivityFeedResponse = {
      count: 1,
      results: [
        {
          id: "act-2",
          case_id: "case-1",
          table_name: "findings",
          record_id: null,
          action: "RECORD_UPDATED",
          performed_by: "",
          performed_at: "2026-07-08T13:46:22.533208+00:00",
          notes: "reevaluate_signals",
        },
      ],
    };
    vi.mocked(api.fetchActivityFeed).mockResolvedValue(activity);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/Signal rules re-evaluated/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/reevaluate_signals/)).not.toBeInTheDocument();
  });

  it("drops an unmapped notes code entirely rather than rendering it verbatim", async () => {
    const activity: ActivityFeedResponse = {
      count: 1,
      results: [
        {
          id: "act-8",
          case_id: "case-1",
          table_name: "findings",
          record_id: "rec-8",
          action: "SIGNAL_CONFIRMED",
          performed_by: "",
          performed_at: "2026-07-08T13:46:22.533208+00:00",
          notes: "some_unmapped_internal_code",
        },
      ],
    };
    vi.mocked(api.fetchActivityFeed).mockResolvedValue(activity);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Thread substantiated")).toBeInTheDocument();
    });
    expect(screen.queryByText(/some_unmapped_internal_code/)).not.toBeInTheDocument();
  });

  it("humanizes AI_EXTRACTION_COMPLETED as Intake copy with no AI leak", async () => {
    const activity: ActivityFeedResponse = {
      count: 1,
      results: [
        {
          id: "act-4",
          case_id: "case-1",
          table_name: "documents",
          record_id: "rec-4",
          action: "AI_EXTRACTION_COMPLETED",
          performed_by: "",
          performed_at: "2026-07-08T13:46:22.533208+00:00",
          notes: "",
        },
      ],
    };
    vi.mocked(api.fetchActivityFeed).mockResolvedValue(activity);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Intake completed on a document")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Ai /i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bAI\b/)).not.toBeInTheDocument();
  });

  it("humanizes AI_FINDING_CREATED as 'New lead recorded' with no AI leak", async () => {
    const activity: ActivityFeedResponse = {
      count: 1,
      results: [
        {
          id: "act-5",
          case_id: "case-1",
          table_name: "findings",
          record_id: "rec-5",
          action: "AI_FINDING_CREATED",
          performed_by: "",
          performed_at: "2026-07-08T13:46:22.533208+00:00",
          notes: "",
        },
      ],
    };
    vi.mocked(api.fetchActivityFeed).mockResolvedValue(activity);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("New lead recorded")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Ai /i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bAI\b/)).not.toBeInTheDocument();
  });

  it("humanizes SIGNAL_CONFIRMED as 'Thread substantiated'", async () => {
    const activity: ActivityFeedResponse = {
      count: 1,
      results: [
        {
          id: "act-6",
          case_id: "case-1",
          table_name: "findings",
          record_id: "rec-6",
          action: "SIGNAL_CONFIRMED",
          performed_by: "",
          performed_at: "2026-07-08T13:46:22.533208+00:00",
          notes: "",
        },
      ],
    };
    vi.mocked(api.fetchActivityFeed).mockResolvedValue(activity);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Thread substantiated")).toBeInTheDocument();
    });
  });

  it("never renders 'Ai ...' for an unmapped AI_* action — falls back to a neutral phrase", async () => {
    const activity: ActivityFeedResponse = {
      count: 1,
      results: [
        {
          id: "act-7",
          case_id: "case-1",
          table_name: "documents",
          record_id: "rec-7",
          action: "AI_SOME_FUTURE_ACTION" as ActivityFeedResponse["results"][number]["action"],
          performed_by: "",
          performed_at: "2026-07-08T13:46:22.533208+00:00",
          notes: "",
        },
      ],
    };
    vi.mocked(api.fetchActivityFeed).mockResolvedValue(activity);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Activity recorded")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Ai /i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bAI\b/)).not.toBeInTheDocument();
  });

  it("falls back to a title-cased sentence for an unknown action, never the raw enum", async () => {
    const activity: ActivityFeedResponse = {
      count: 1,
      results: [
        {
          id: "act-3",
          case_id: "case-1",
          table_name: "widgets",
          record_id: "rec-3",
          action: "SOME_NEW_ACTION" as ActivityFeedResponse["results"][number]["action"],
          performed_by: "",
          performed_at: "2026-07-08T13:46:22.533208+00:00",
          notes: "",
        },
      ],
    };
    vi.mocked(api.fetchActivityFeed).mockResolvedValue(activity);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Some New Action")).toBeInTheDocument();
    });
    expect(screen.queryByText("SOME_NEW_ACTION")).not.toBeInTheDocument();
  });
});
