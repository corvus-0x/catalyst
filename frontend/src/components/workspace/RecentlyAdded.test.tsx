import { ReactElement } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecentlyAdded } from "./RecentlyAdded";
import type { ActivityEntry } from "../../types";

function entry(partial: Partial<ActivityEntry> = {}): ActivityEntry {
    return {
        id: "00000000-0000-0000-0000-000000000001",
        case_id: "case-1",
        table_name: "documents",
        record_id: "doc-1",
        action: "DOCUMENT_INGESTED",
        performed_by: "system",
        performed_at: new Date().toISOString(),
        notes: "IRS 990 2024",
        ...partial,
    };
}

function mockFetchOnce(results: ActivityEntry[]) {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results }),
        headers: new Headers({ "content-type": "application/json" }),
    });
}

function renderUI(ui: ReactElement) {
    return render(ui);
}

describe("RecentlyAdded", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("renders the 5 most recent user-facing events", async () => {
        // 6 user-facing entries — should clip to 5
        mockFetchOnce([
            entry({ id: "1", action: "DOCUMENT_INGESTED", notes: "doc one" }),
            entry({ id: "2", action: "FINDING_CREATED", table_name: "findings", notes: "finding two" }),
            entry({
                id: "3",
                action: "RECORD_CREATED",
                table_name: "persons",
                notes: "Karen Homan",
            }),
            entry({ id: "4", action: "SIGNAL_DETECTED", table_name: "findings", notes: "SR-025 fired" }),
            entry({ id: "5", action: "DOCUMENT_OCR_COMPLETED", notes: "ocr five" }),
            entry({ id: "6", action: "DOCUMENT_INGESTED", notes: "doc six" }),
        ]);

        renderUI(<RecentlyAdded caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText("doc one")).toBeInTheDocument();
        });
        expect(screen.getByText("finding two")).toBeInTheDocument();
        expect(screen.getByText("Karen Homan")).toBeInTheDocument();
        expect(screen.getByText("SR-025 fired")).toBeInTheDocument();
        expect(screen.getByText("ocr five")).toBeInTheDocument();
        // 6th item exceeds the visible cap of 5
        expect(screen.queryByText("doc six")).not.toBeInTheDocument();
    });

    it("filters out internal-admin events (RECORD_* on internal tables, hash batch)", async () => {
        mockFetchOnce([
            entry({ id: "h1", action: "HASH_VERIFICATION_BATCH", notes: "batch ran" }),
            entry({
                id: "r1",
                action: "RECORD_UPDATED",
                table_name: "audit_logs",
                notes: "internal log update",
            }),
            entry({
                id: "r2",
                action: "RECORD_CREATED",
                table_name: "system_settings",
                notes: "internal config",
            }),
            entry({
                id: "i1",
                action: "INTAKE_REJECTED_SIZE",
                notes: "intake admin event",
            }),
            entry({
                id: "ok",
                action: "DOCUMENT_INGESTED",
                notes: "real doc event",
            }),
        ]);

        renderUI(<RecentlyAdded caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText("real doc event")).toBeInTheDocument();
        });
        expect(screen.queryByText("batch ran")).not.toBeInTheDocument();
        expect(screen.queryByText("internal log update")).not.toBeInTheDocument();
        expect(screen.queryByText("internal config")).not.toBeInTheDocument();
        expect(screen.queryByText("intake admin event")).not.toBeInTheDocument();
    });

    it("invokes onItemSelected with the original entry on row click", async () => {
        const target = entry({
            id: "click-me",
            action: "DOCUMENT_INGESTED",
            notes: "click me",
        });
        mockFetchOnce([target]);
        const onItemSelected = vi.fn();

        renderUI(<RecentlyAdded caseId="case-1" onItemSelected={onItemSelected} />);

        await waitFor(() => screen.getByText("click me"));
        fireEvent.click(screen.getByText("click me"));

        expect(onItemSelected).toHaveBeenCalledTimes(1);
        expect(onItemSelected.mock.calls[0][0].id).toBe("click-me");
    });

    it("renders an empty-state message when there are no user-facing events", async () => {
        mockFetchOnce([]);
        renderUI(<RecentlyAdded caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText(/no recent activity yet/i)).toBeInTheDocument();
        });
    });

    it("shows a loading skeleton before the fetch resolves", () => {
        // Never-resolving fetch keeps us in the loading branch
        (fetch as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
            new Promise(() => {}),
        );
        renderUI(<RecentlyAdded caseId="case-1" />);
        expect(screen.getByTestId("recently-added-skeleton")).toBeInTheDocument();
    });

    it("scopes the fetch to the supplied case id", async () => {
        mockFetchOnce([]);
        renderUI(<RecentlyAdded caseId="case-42" />);

        await waitFor(() => {
            const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
            expect(calls.length).toBeGreaterThan(0);
            const url = calls[0][0] as string;
            expect(url).toContain("/api/activity-feed/");
            expect(url).toContain("case_id=case-42");
        });
    });
});
