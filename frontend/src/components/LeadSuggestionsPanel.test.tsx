/**
 * LeadSuggestionsPanel tests — Phase 4D assist-only proposals.
 *
 * The invariant under test: accepting a proposal calls the NORMAL element +
 * citation endpoints (createElement/addCitation) — the panel itself persists
 * nothing and dismissing is purely local.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LeadSuggestionsPanel from "./LeadSuggestionsPanel";
import * as api from "../api";
import { useAsyncJob } from "../hooks/useAsyncJob";
import type { ThreadAssistJobResult } from "../types";

vi.mock("../api", () => ({
  requestThreadAssist: vi.fn(),
  createElement: vi.fn(),
  addCitation: vi.fn(),
}));

vi.mock("../hooks/useAsyncJob", () => ({
  useAsyncJob: vi.fn(),
}));

const proposal = {
  text: "The deed names the insider as buyer.",
  doc_refs: ["Doc-1"],
  basis: "from my March note",
  documents: [{ document_id: "d1", filename: "deed.pdf" }],
};

function mockJob(overrides: Partial<ReturnType<typeof useAsyncJob<ThreadAssistJobResult>>>) {
  const base = {
    status: "idle" as const,
    result: null,
    error: null,
    jobId: null,
    run: vi.fn(),
    reattach: vi.fn(),
    reset: vi.fn(),
  };
  vi.mocked(useAsyncJob).mockReturnValue({ ...base, ...overrides });
}

const baseProps = {
  caseId: "case1",
  findingId: "find1",
  disabled: false,
  onAccepted: vi.fn(),
};

describe("LeadSuggestionsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requests suggestions through the async job on button click", () => {
    const run = vi.fn();
    mockJob({ run });
    render(<LeadSuggestionsPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /suggest assertions/i }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("disables the button while the job runs and when the thread is tied off", () => {
    mockJob({ status: "RUNNING" });
    const { unmount } = render(<LeadSuggestionsPanel {...baseProps} />);
    expect(screen.getByRole("button", { name: /working/i })).toBeDisabled();
    unmount();

    mockJob({ status: "idle" });
    render(<LeadSuggestionsPanel {...baseProps} disabled={true} />);
    expect(screen.getByRole("button", { name: /suggest assertions/i })).toBeDisabled();
  });

  it("renders proposals with text, basis, and suggested documents", () => {
    mockJob({
      status: "SUCCESS",
      result: {
        finding_id: "find1",
        case_id: "case1",
        proposals: [proposal],
        proposals_dropped: 0,
      },
    });
    render(<LeadSuggestionsPanel {...baseProps} />);
    expect(screen.getByText(proposal.text)).toBeInTheDocument();
    expect(screen.getByText(/from my March note/)).toBeInTheDocument();
    expect(screen.getByText("deed.pdf")).toBeInTheDocument();
  });

  it("accept creates the element via the normal endpoint, then cites, then refreshes", async () => {
    mockJob({
      status: "SUCCESS",
      result: {
        finding_id: "find1",
        case_id: "case1",
        proposals: [proposal],
        proposals_dropped: 0,
      },
    });
    vi.mocked(api.createElement).mockResolvedValue({ id: "el9" } as never);
    vi.mocked(api.addCitation).mockResolvedValue({} as never);
    const onAccepted = vi.fn();

    render(<LeadSuggestionsPanel {...baseProps} onAccepted={onAccepted} />);
    fireEvent.click(screen.getByRole("button", { name: /accept/i }));

    await waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(api.createElement).toHaveBeenCalledWith("case1", "find1", {
      element_type: "ASSERTION",
      text: proposal.text,
    });
    expect(api.addCitation).toHaveBeenCalledWith("case1", "find1", "el9", {
      document_id: "d1",
      page_reference: "",
      context_note: "",
    });
    // Accepted proposal leaves the pending list
    expect(screen.queryByText(proposal.text)).not.toBeInTheDocument();
  });

  it("dismiss removes the proposal locally without any API call", () => {
    mockJob({
      status: "SUCCESS",
      result: {
        finding_id: "find1",
        case_id: "case1",
        proposals: [proposal],
        proposals_dropped: 0,
      },
    });
    render(<LeadSuggestionsPanel {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText(proposal.text)).not.toBeInTheDocument();
    expect(api.createElement).not.toHaveBeenCalled();
    expect(api.addCitation).not.toHaveBeenCalled();
  });

  it("shows the job error on failure", () => {
    mockJob({ status: "FAILED", error: "Suggestion run failed." });
    render(<LeadSuggestionsPanel {...baseProps} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Suggestion run failed.");
  });
});
