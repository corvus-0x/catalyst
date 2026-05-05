import { ReactElement } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditLogPanel } from "./AuditLogPanel";
import { TooltipProvider } from "../ui/Tooltip";
import { ActivityEntry } from "../../types";

function renderWithProviders(ui: ReactElement) {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function entry(partial: Partial<ActivityEntry> = {}): ActivityEntry {
    return {
        id: "00000000-0000-0000-0000-000000000001",
        case_id: "case-1",
        table_name: "documents",
        record_id: "doc-1",
        action: "DOCUMENT_INGESTED",
        performed_by: "system",
        performed_at: new Date().toISOString(),
        notes: "IRS 990 2024 — 12 entities extracted",
        ...partial,
    };
}

function mockFetch(results: ActivityEntry[]) {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results }),
        headers: new Headers({ "content-type": "application/json" }),
    });
}

function mockFetchFails(message = "boom") {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error(message));
}

describe("AuditLogPanel", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("renders rows for fetched entries", async () => {
        mockFetch([
            entry({ id: "a", notes: "first event" }),
            entry({ id: "b", notes: "second event" }),
        ]);

        renderWithProviders(<AuditLogPanel caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText("first event")).toBeInTheDocument();
            expect(screen.getByText("second event")).toBeInTheDocument();
        });
    });

    it("calls onLoaded with the row count after a successful fetch", async () => {
        mockFetch([entry({ id: "a" }), entry({ id: "b" }), entry({ id: "c" })]);
        const onLoaded = vi.fn();

        renderWithProviders(<AuditLogPanel caseId="case-1" onLoaded={onLoaded} />);

        await waitFor(() => expect(onLoaded).toHaveBeenCalledWith(3));
    });

    it("renders an empty-state hint when no entries exist", async () => {
        mockFetch([]);
        renderWithProviders(<AuditLogPanel caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText(/no audit events yet/i)).toBeInTheDocument();
        });
    });

    it("renders an error state with a retry button when fetch fails", async () => {
        mockFetchFails("network down");
        renderWithProviders(<AuditLogPanel caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText(/network down/i)).toBeInTheDocument();
        });
        expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });

    it("invokes onFocusEvent with the original row when a row is clicked", async () => {
        const target = entry({ id: "x", notes: "click me" });
        mockFetch([target]);
        const onFocusEvent = vi.fn();

        renderWithProviders(<AuditLogPanel caseId="case-1" onFocusEvent={onFocusEvent} />);

        await waitFor(() => screen.getByText("click me"));
        fireEvent.click(screen.getByText("click me"));

        expect(onFocusEvent).toHaveBeenCalledTimes(1);
        expect(onFocusEvent.mock.calls[0][0].id).toBe("x");
    });

    it("scopes the fetch URL to the supplied case id", async () => {
        mockFetch([]);
        renderWithProviders(<AuditLogPanel caseId="case-42" />);

        await waitFor(() => {
            const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
            expect(calls.length).toBeGreaterThan(0);
            const url = calls[0][0] as string;
            expect(url).toContain("/api/activity-feed/");
            expect(url).toContain("case_id=case-42");
        });
    });
});
