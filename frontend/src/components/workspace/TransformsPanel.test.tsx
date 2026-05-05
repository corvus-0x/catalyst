import { ReactElement } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TransformsPanel } from "./TransformsPanel";
import { TooltipProvider } from "../ui/Tooltip";
import { JobStatus, JobType, SearchJobSummary } from "../../types";

function renderWithProviders(ui: ReactElement) {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function job(partial: Partial<SearchJobSummary> = {}): SearchJobSummary {
    return {
        id: "job-1",
        job_type: "IRS_NAME_SEARCH" as JobType,
        status: "SUCCESS" as JobStatus,
        query_params: { query: "Do Good In His Name" },
        result: { count: 7 },
        error_message: "",
        created_at: new Date().toISOString(),
        started_at: null,
        finished_at: null,
        ...partial,
    };
}

function mockFetchOnce(results: SearchJobSummary[]) {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results }),
        headers: new Headers({ "content-type": "application/json" }),
    });
}

function mockFetchAlways(results: SearchJobSummary[]) {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ results }),
        headers: new Headers({ "content-type": "application/json" }),
    });
}

function mockFetchFailsOnce(message = "boom") {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error(message));
}

describe("TransformsPanel", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("renders rows in reverse-chronological order (newest first)", async () => {
        const older = job({
            id: "old",
            created_at: "2026-04-30T14:00:00Z",
            query_params: { query: "older-query" },
        });
        const newer = job({
            id: "new",
            created_at: "2026-04-30T15:00:00Z",
            query_params: { query: "newer-query" },
        });

        // Server returns oldest-first; the panel should still render newest-first.
        mockFetchOnce([older, newer]);

        renderWithProviders(<TransformsPanel caseId="case-1" />);

        const items = await waitFor(() => {
            const els = screen.getAllByRole("listitem");
            expect(els.length).toBe(2);
            return els;
        });

        expect(within(items[0]).getByText("newer-query")).toBeInTheDocument();
        expect(within(items[1]).getByText("older-query")).toBeInTheDocument();
    });

    it("applies the matching status chip class for each job status", async () => {
        mockFetchOnce([
            job({ id: "s", status: "SUCCESS", query_params: { query: "ok" }, result: { count: 1 } }),
            job({
                id: "f",
                status: "FAILED",
                query_params: { query: "bad" },
                result: null,
                error_message: "no network",
            }),
            job({ id: "r", status: "RUNNING", query_params: { query: "wait" }, result: null }),
            job({ id: "q", status: "QUEUED", query_params: { query: "hold" }, result: null }),
        ]);

        renderWithProviders(<TransformsPanel caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText("SUCCESS")).toBeInTheDocument();
        });

        // Each chip carries a status-specific class. We don't hard-code the
        // exact CSS-Module class hash; we just check the chip class names
        // include something distinct per status.
        const successChip = screen.getByText("SUCCESS");
        const failedChip = screen.getByText("FAILED");
        const runningChip = screen.getByText("RUNNING");
        const queuedChip = screen.getByText("QUEUED");

        const classes = [
            successChip.className,
            failedChip.className,
            runningChip.className,
            queuedChip.className,
        ];
        expect(new Set(classes).size).toBe(4);
        expect(successChip.className).toMatch(/success/i);
        expect(failedChip.className).toMatch(/failed/i);
        expect(runningChip.className).toMatch(/running/i);
        expect(queuedChip.className).toMatch(/queued/i);
    });

    it("renders an empty-state hint when no jobs exist", async () => {
        mockFetchOnce([]);
        renderWithProviders(<TransformsPanel caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText(/no transforms yet/i)).toBeInTheDocument();
        });
    });

    it("renders an error state with a retry button when initial fetch fails", async () => {
        mockFetchFailsOnce("network down");
        renderWithProviders(<TransformsPanel caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText(/network down/i)).toBeInTheDocument();
        });
        expect(screen.getByRole("button", { name: /^retry$/i })).toBeInTheDocument();
    });

    it("marks RUNNING jobs with a running row class so the animated indicator is visible", async () => {
        mockFetchOnce([
            job({
                id: "r",
                status: "RUNNING",
                query_params: { query: "live-search" },
                result: null,
            }),
        ]);

        renderWithProviders(<TransformsPanel caseId="case-1" />);

        const item = await waitFor(() => screen.getByRole("listitem"));
        expect(item.getAttribute("data-status")).toBe("RUNNING");
        expect(item.className).toMatch(/Running/i);
    });

    it("invokes onOpenResult when a SUCCESS row is clicked", async () => {
        const target = job({
            id: "x",
            status: "SUCCESS",
            query_params: { query: "click-me" },
            result: { count: 3 },
        });
        mockFetchOnce([target]);
        const onOpenResult = vi.fn();

        renderWithProviders(
            <TransformsPanel caseId="case-1" onOpenResult={onOpenResult} />,
        );

        const item = await waitFor(() => screen.getByRole("listitem"));
        const user = userEvent.setup();
        await user.click(item);

        expect(onOpenResult).toHaveBeenCalledTimes(1);
        expect(onOpenResult.mock.calls[0][0].id).toBe("x");
    });

    it("invokes onRetry when the retry button on a FAILED row is clicked", async () => {
        const failed = job({
            id: "fail-1",
            status: "FAILED",
            query_params: { query: "bad-query" },
            result: null,
            error_message: "timed out",
        });
        // Use mockFetchAlways so the auto-poll doesn't change state mid-test.
        mockFetchAlways([failed]);
        const onRetry = vi.fn();

        renderWithProviders(<TransformsPanel caseId="case-1" onRetry={onRetry} />);

        const retryBtn = await waitFor(() =>
            screen.getByRole("button", { name: /retry transform/i }),
        );

        const user = userEvent.setup();
        await user.click(retryBtn);

        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(onRetry.mock.calls[0][0].id).toBe("fail-1");
    });
});
