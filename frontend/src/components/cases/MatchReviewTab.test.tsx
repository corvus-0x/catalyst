import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

import * as api from "../../api";
import type { CaseDetailContext } from "../../views/CaseDetailView";
import { MatchReviewTab } from "./MatchReviewTab";

const CASE_ID = "case-uuid-1";

const STUB_CONTEXT: CaseDetailContext = {
    caseId: CASE_ID,
    // Only `caseId` is read by MatchReviewTab; rest of context is never
    // touched, so the unused fields are stubbed minimally and cast to silence
    // TS without overengineering the mock.
} as unknown as CaseDetailContext;

function renderWithContext() {
    return render(
        <MemoryRouter initialEntries={[`/cases/${CASE_ID}/match-review`]}>
            <Routes>
                <Route
                    path="/cases/:caseId/*"
                    element={<Outlet context={STUB_CONTEXT} />}
                >
                    <Route path="match-review" element={<MatchReviewTab />} />
                </Route>
            </Routes>
        </MemoryRouter>
    );
}

const PERSON_CANDIDATE = {
    id: "cand-1",
    entity_type: "person" as const,
    incoming_raw: "Jon Smith",
    incoming_normalized: "jon smith",
    existing_entity_id: "person-1",
    existing_raw: "John Smith",
    similarity: 0.82,
    status: "PENDING" as const,
    detected_at: "2026-05-01T10:00:00Z",
    resolved_at: null,
    detected_in_document_id: "doc-1",
};

const ORG_CANDIDATE = {
    id: "cand-2",
    entity_type: "organization" as const,
    incoming_raw: "Acme Holdings Inc",
    incoming_normalized: "acme holdings",
    existing_entity_id: "org-1",
    existing_raw: "Acme Holdings, LLC",
    similarity: 0.95,
    status: "PENDING" as const,
    detected_at: "2026-05-01T10:00:00Z",
    resolved_at: null,
    detected_in_document_id: null,
};

describe("MatchReviewTab", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    test("loads and renders pending candidates", async () => {
        vi.spyOn(api, "fetchFuzzyCandidates").mockResolvedValue({
            results: [PERSON_CANDIDATE, ORG_CANDIDATE],
            count: 2,
        });

        renderWithContext();

        // Both candidate names appear after the fetch resolves.
        expect(await screen.findByText("Jon Smith")).toBeInTheDocument();
        expect(screen.getByText("John Smith")).toBeInTheDocument();
        expect(screen.getByText("Acme Holdings Inc")).toBeInTheDocument();
        expect(screen.getByText("Acme Holdings, LLC")).toBeInTheDocument();

        // Similarity percentages render.
        expect(screen.getByText("82% match")).toBeInTheDocument();
        expect(screen.getByText("95% match")).toBeInTheDocument();
    });

    test("renders empty state when no pending candidates", async () => {
        vi.spyOn(api, "fetchFuzzyCandidates").mockResolvedValue({
            results: [],
            count: 0,
        });

        renderWithContext();

        expect(
            await screen.findByText("No pending matches to review")
        ).toBeInTheDocument();
    });

    test("renders error state when fetch fails", async () => {
        vi.spyOn(api, "fetchFuzzyCandidates").mockRejectedValue(
            new Error("Network down")
        );

        renderWithContext();

        expect(
            await screen.findByText("Couldn't load candidates")
        ).toBeInTheDocument();
        expect(screen.getByText("Network down")).toBeInTheDocument();
    });

    test("clicking accept calls resolveFuzzyCandidate with action=accept", async () => {
        vi.spyOn(api, "fetchFuzzyCandidates").mockResolvedValue({
            results: [PERSON_CANDIDATE],
            count: 1,
        });
        const resolveSpy = vi.spyOn(api, "resolveFuzzyCandidate").mockResolvedValue({
            id: PERSON_CANDIDATE.id,
            status: "MERGED",
            resolved_at: "2026-05-01T11:00:00Z",
        });

        renderWithContext();
        // Exact "Accept" — distinct from any filter-button text.
        const acceptBtn = await screen.findByRole("button", { name: "Accept" });
        fireEvent.click(acceptBtn);

        await waitFor(() =>
            expect(resolveSpy).toHaveBeenCalledWith(CASE_ID, PERSON_CANDIDATE.id, "accept")
        );
    });

    test("clicking dismiss calls resolveFuzzyCandidate with action=dismiss", async () => {
        vi.spyOn(api, "fetchFuzzyCandidates").mockResolvedValue({
            results: [PERSON_CANDIDATE],
            count: 1,
        });
        const resolveSpy = vi.spyOn(api, "resolveFuzzyCandidate").mockResolvedValue({
            id: PERSON_CANDIDATE.id,
            status: "DISMISSED",
            resolved_at: "2026-05-01T11:00:00Z",
        });

        renderWithContext();
        // Exact "Dismiss" — the status filter chip is "Dismissed", different.
        const dismissBtn = await screen.findByRole("button", { name: "Dismiss" });
        fireEvent.click(dismissBtn);

        await waitFor(() =>
            expect(resolveSpy).toHaveBeenCalledWith(CASE_ID, PERSON_CANDIDATE.id, "dismiss")
        );
    });

    test("status filter buttons re-fetch with the new filter", async () => {
        const fetchSpy = vi
            .spyOn(api, "fetchFuzzyCandidates")
            .mockResolvedValue({ results: [], count: 0 });

        renderWithContext();

        // Initial fetch with status=pending.
        await waitFor(() =>
            expect(fetchSpy).toHaveBeenCalledWith(
                CASE_ID,
                expect.objectContaining({ status: "pending" })
            )
        );

        // Click "Merged" filter.
        fireEvent.click(screen.getByRole("button", { name: "Merged" }));

        await waitFor(() =>
            expect(fetchSpy).toHaveBeenCalledWith(
                CASE_ID,
                expect.objectContaining({ status: "merged" })
            )
        );
    });

    test("resolved candidates show their status badge instead of buttons", async () => {
        const merged = { ...PERSON_CANDIDATE, status: "MERGED" as const };
        vi.spyOn(api, "fetchFuzzyCandidates").mockResolvedValue({
            results: [merged],
            count: 1,
        });

        renderWithContext();

        // Switch to "All" so the merged candidate is visible.
        await screen.findByText("Status:");
        fireEvent.click(screen.getByRole("button", { name: "All" }));

        // The MERGED status badge appears in the candidate row.
        expect(await screen.findByText("MERGED")).toBeInTheDocument();
        // No action buttons rendered (filter buttons "Pending"/"Merged"/etc.
        // are still present, hence the exact-name match — those have
        // different labels than the action buttons "Accept"/"Dismiss").
        expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
    });
});
