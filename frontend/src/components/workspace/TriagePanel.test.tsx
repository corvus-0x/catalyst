import { ReactElement } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TriagePanel } from "./TriagePanel";
import { TooltipProvider } from "../ui/Tooltip";
import {
    EvidenceWeight,
    FindingItem,
    FindingSeverity,
    FindingSource,
    FindingStatus,
} from "../../types";

function renderWithProviders(ui: ReactElement) {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function finding(partial: Partial<FindingItem> = {}): FindingItem {
    return {
        id: "f-1",
        rule_id: "SR-015",
        title: "INSIDER_SWAP — Both sides controlled",
        description: "",
        narrative: "",
        severity: "CRITICAL" as FindingSeverity,
        status: "NEW" as FindingStatus,
        evidence_weight: "DIRECTIONAL" as EvidenceWeight,
        source: "AUTO" as FindingSource,
        investigator_note: "",
        legal_refs: [],
        evidence_snapshot: {},
        trigger_doc_id: null,
        trigger_doc_filename: null,
        trigger_entity_id: null,
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hr ago
        updated_at: new Date().toISOString(),
        entity_links: [
            {
                entity_id: "e-1",
                entity_type: "person",
                context_note: "Karen Homan",
            },
        ],
        document_links: [],
        ...partial,
    };
}

function mockFindingsFetch(results: FindingItem[]) {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
            count: results.length,
            limit: 100,
            offset: 0,
            next_offset: null,
            previous_offset: null,
            results,
        }),
        headers: new Headers({ "content-type": "application/json" }),
    });
}

function mockFindingsFails(message = "boom") {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error(message));
}

describe("TriagePanel", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("renders rows for fetched findings", async () => {
        mockFindingsFetch([
            finding({ id: "a", rule_id: "SR-015", title: "first finding" }),
            finding({ id: "b", rule_id: "SR-021", title: "second finding" }),
        ]);

        renderWithProviders(<TriagePanel caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText("first finding")).toBeInTheDocument();
            expect(screen.getByText("second finding")).toBeInTheDocument();
        });
    });

    it("default filter shows only NEW-status findings", async () => {
        mockFindingsFetch([
            finding({ id: "a", title: "is new", status: "NEW" }),
            finding({ id: "b", title: "is dismissed", status: "DISMISSED" }),
            finding({ id: "c", title: "is confirmed", status: "CONFIRMED" }),
        ]);

        renderWithProviders(<TriagePanel caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText("is new")).toBeInTheDocument();
        });
        expect(screen.queryByText("is dismissed")).not.toBeInTheDocument();
        expect(screen.queryByText("is confirmed")).not.toBeInTheDocument();
    });

    it("toggling the All status chip widens the filter", async () => {
        mockFindingsFetch([
            finding({ id: "a", title: "is new", status: "NEW" }),
            finding({ id: "b", title: "is dismissed", status: "DISMISSED" }),
        ]);

        renderWithProviders(<TriagePanel caseId="case-1" />);

        await waitFor(() => screen.getByText("is new"));
        // Confirm "is dismissed" is initially hidden under the NEW default
        expect(screen.queryByText("is dismissed")).not.toBeInTheDocument();

        const allChip = screen.getByRole("button", { name: /^all/i });
        await userEvent.click(allChip);

        await waitFor(() => {
            expect(screen.getByText("is dismissed")).toBeInTheDocument();
            expect(screen.getByText("is new")).toBeInTheDocument();
        });
    });

    it("severity chip multi-select narrows correctly", async () => {
        mockFindingsFetch([
            finding({ id: "a", title: "critical row", severity: "CRITICAL" }),
            finding({ id: "b", title: "high row", severity: "HIGH" }),
            finding({ id: "c", title: "medium row", severity: "MEDIUM" }),
        ]);

        renderWithProviders(<TriagePanel caseId="case-1" />);

        // Wait for full render
        await waitFor(() => screen.getByText("critical row"));
        expect(screen.getByText("high row")).toBeInTheDocument();
        expect(screen.getByText("medium row")).toBeInTheDocument();

        // Activate CRITICAL chip — only critical should remain
        const criticalChip = screen.getByRole("button", { name: /^critical/i });
        await userEvent.click(criticalChip);

        await waitFor(() => {
            expect(screen.getByText("critical row")).toBeInTheDocument();
        });
        expect(screen.queryByText("high row")).not.toBeInTheDocument();
        expect(screen.queryByText("medium row")).not.toBeInTheDocument();

        // Add HIGH — both critical and high should be visible
        const highChip = screen.getByRole("button", { name: /^high/i });
        await userEvent.click(highChip);

        await waitFor(() => {
            expect(screen.getByText("high row")).toBeInTheDocument();
        });
        expect(screen.getByText("critical row")).toBeInTheDocument();
        expect(screen.queryByText("medium row")).not.toBeInTheDocument();
    });

    it("source AI chip filters to AI findings", async () => {
        mockFindingsFetch([
            finding({ id: "a", title: "rule row", source: "AUTO" }),
            finding({ id: "b", title: "ai row", source: "AI", evidence_weight: "DIRECTIONAL" }),
            finding({ id: "c", title: "manual row", source: "MANUAL" }),
        ]);

        renderWithProviders(<TriagePanel caseId="case-1" />);

        await waitFor(() => screen.getByText("rule row"));

        // Click the AI chip in the filter group (NOT the AI badge inside a row)
        const aiChip = screen
            .getByRole("group", { name: /filter by source/i })
            .querySelector('button[aria-pressed]:nth-of-type(3)');
        // Fallback: find by text within the filter group
        const filterGroup = screen.getByRole("group", { name: /filter by source/i });
        const aiBtn =
            (aiChip as HTMLElement | null) ||
            Array.from(filterGroup.querySelectorAll("button")).find(
                (b) => b.textContent?.trim() === "AI",
            );
        expect(aiBtn).toBeTruthy();
        await userEvent.click(aiBtn as HTMLElement);

        await waitFor(() => {
            expect(screen.getByText("ai row")).toBeInTheDocument();
        });
        expect(screen.queryByText("rule row")).not.toBeInTheDocument();
        expect(screen.queryByText("manual row")).not.toBeInTheDocument();
    });

    it("invokes onSelectFinding with the original row when a row is clicked", async () => {
        const target = finding({ id: "x", title: "click target" });
        mockFindingsFetch([target]);
        const onSelectFinding = vi.fn();

        renderWithProviders(
            <TriagePanel caseId="case-1" onSelectFinding={onSelectFinding} />,
        );

        await waitFor(() => screen.getByText("click target"));
        fireEvent.click(screen.getByText("click target"));

        expect(onSelectFinding).toHaveBeenCalledTimes(1);
        expect(onSelectFinding.mock.calls[0][0].id).toBe("x");
    });

    it("renders an empty-state hint when no findings match the filter", async () => {
        mockFindingsFetch([]);
        renderWithProviders(<TriagePanel caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText(/no flags match/i)).toBeInTheDocument();
        });
    });

    it("renders an error state with retry when fetch fails", async () => {
        mockFindingsFails("network down");
        renderWithProviders(<TriagePanel caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText(/network down/i)).toBeInTheDocument();
        });
        expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });
});
