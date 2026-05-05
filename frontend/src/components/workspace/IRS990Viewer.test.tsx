import { ReactElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IRS990Viewer, groupFindingsByAnchor } from "./IRS990Viewer";
import { TooltipProvider } from "../ui/Tooltip";
import type { FinancialSnapshotItem, FindingItem } from "../../types";

function renderWithProviders(ui: ReactElement) {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
}

/* ── Builders ───────────────────────────────────────────────────────── */

function snapshot(partial: Partial<FinancialSnapshotItem> = {}): FinancialSnapshotItem {
    return {
        id: "snap-1",
        document_id: "doc-1",
        document_filename: "Form 990 (2024).pdf",
        organization_id: "org-1",
        organization_name: "Bright Future Foundation",
        ein: "82-4458479",
        tax_year: 2024,
        form_type: "990",
        total_contributions: 1_000_000,
        program_service_revenue: 200_000,
        investment_income: 5_000,
        other_revenue: 0,
        total_revenue: 1_205_000,
        grants_paid: 800_000,
        salaries_and_compensation: 100_000,
        professional_fundraising: 0,
        other_expenses: 50_000,
        total_expenses: 950_000,
        revenue_less_expenses: 255_000,
        total_assets_boy: 0,
        total_assets_eoy: 0,
        total_liabilities_boy: 0,
        total_liabilities_eoy: 0,
        net_assets_boy: 0,
        net_assets_eoy: 255_000,
        officer_compensation_total: 75_000,
        num_employees: 4,
        source: "IRS_TEOS_XML",
        confidence: 1,
        ...partial,
    };
}

function finding(partial: Partial<FindingItem> = {}): FindingItem {
    return {
        id: "f-1",
        rule_id: "SR-025",
        title: "False disclosure",
        description: "Line 28a flipped from No (2023) to Yes (2024).",
        narrative: "",
        severity: "CRITICAL",
        status: "NEW",
        evidence_weight: "DOCUMENTED",
        source: "AUTO",
        investigator_note: "",
        legal_refs: [],
        evidence_snapshot: { tax_year: 2024 },
        trigger_doc_id: null,
        trigger_doc_filename: null,
        trigger_entity_id: null,
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z",
        entity_links: [],
        document_links: [],
        ...partial,
    };
}

/** Mock the next N fetch calls in order. Each entry is the JSON body to return. */
function queueFetchResponses(...bodies: unknown[]) {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    for (const body of bodies) {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => body,
            headers: new Headers({ "content-type": "application/json" }),
        });
    }
}

/** Used when the parsed_990 fetch should fail or return empty — defaults to a
 *  document detail with no `parsed_990`. Tests can override with their own. */
const emptyDocDetail = {
    id: "doc-1",
    filename: "Form 990 (2024).pdf",
    ingestion_metadata: {},
    persons: [],
    organizations: [],
    financial_snapshots: [],
};

/* ── Pure helper ─────────────────────────────────────────────────────── */

describe("groupFindingsByAnchor", () => {
    it("filters out non-AUTO findings", () => {
        const findings: FindingItem[] = [
            finding({ id: "a", rule_id: "SR-025", source: "AUTO" }),
            finding({ id: "b", rule_id: "SR-025", source: "MANUAL" }),
            finding({ id: "c", rule_id: "SR-025", source: "AI" }),
        ];
        const map = groupFindingsByAnchor(findings, 2024);
        const list = map.get("part_iv.line_28a");
        expect(list).toBeDefined();
        expect(list).toHaveLength(1);
        expect(list?.[0].id).toBe("a");
    });

    it("filters by tax_year when present in evidence_snapshot", () => {
        const findings: FindingItem[] = [
            finding({ id: "a", rule_id: "SR-013", evidence_snapshot: { tax_year: 2023 } }),
            finding({ id: "b", rule_id: "SR-013", evidence_snapshot: { tax_year: 2024 } }),
        ];
        const map = groupFindingsByAnchor(findings, 2024);
        const list = map.get("part_vii.compensation");
        expect(list?.map((f) => f.id)).toEqual(["b"]);
    });

    it("drops findings whose rule id has no anchor", () => {
        const map = groupFindingsByAnchor(
            [finding({ id: "a", rule_id: "SR-999-not-real" })],
            2024,
        );
        expect(map.size).toBe(0);
    });
});

/* ── Component ───────────────────────────────────────────────────────── */

describe("IRS990Viewer", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("renders Part I header and total revenue once data loads", async () => {
        queueFetchResponses(
            { results: [snapshot()] },
            { results: [] },
            emptyDocDetail,
        );
        renderWithProviders(<IRS990Viewer caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText(/Part I — Summary/i)).toBeInTheDocument();
        });
        // Total revenue formatted as USD with no fractional digits.
        expect(screen.getByText("$1,205,000")).toBeInTheDocument();
    });

    it("renders the year selector with all available tax_year values, defaulting to most recent", async () => {
        queueFetchResponses(
            {
                results: [
                    snapshot({ id: "s1", tax_year: 2022 }),
                    snapshot({ id: "s2", tax_year: 2024 }),
                    snapshot({ id: "s3", tax_year: 2023 }),
                ],
            },
            { results: [] },
            emptyDocDetail,
        );
        renderWithProviders(<IRS990Viewer caseId="case-1" />);

        const select = (await screen.findByLabelText(/select tax year/i)) as HTMLSelectElement;
        // Most recent is the default
        expect(select.value).toBe("2024");
        // All three years present
        const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);
        expect(options).toEqual(["2024", "2023", "2022"]);
    });

    it("re-renders Part I numbers when the user picks a different year", async () => {
        queueFetchResponses(
            {
                results: [
                    snapshot({
                        id: "s1",
                        tax_year: 2024,
                        document_id: "d1",
                        total_revenue: 1_205_000,
                    }),
                    snapshot({
                        id: "s2",
                        tax_year: 2023,
                        document_id: "d2",
                        total_revenue: 750_000,
                    }),
                ],
            },
            { results: [] },
            emptyDocDetail, // doc detail for 2024
        );
        renderWithProviders(<IRS990Viewer caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText("$1,205,000")).toBeInTheDocument();
        });

        // Switch to 2023 — viewer fetches that doc detail.
        queueFetchResponses(emptyDocDetail);

        const select = screen.getByLabelText(/select tax year/i);
        await userEvent.selectOptions(select, "2023");

        await waitFor(() => {
            expect(screen.getByText("$750,000")).toBeInTheDocument();
        });
        expect(screen.queryByText("$1,205,000")).not.toBeInTheDocument();
    });

    it("renders an inline callout under the line that triggered it", async () => {
        queueFetchResponses(
            { results: [snapshot()] },
            { results: [finding({ rule_id: "SR-025", title: "False disclosure" })] },
            emptyDocDetail,
        );
        renderWithProviders(<IRS990Viewer caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText("SR-025")).toBeInTheDocument();
        });
        expect(screen.getByText(/false disclosure/i)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /view flag/i })).toBeInTheDocument();
    });

    it("fires onOpenEntity with the officer's id when an officer link is clicked", async () => {
        const docWithOfficers = {
            ...emptyDocDetail,
            ingestion_metadata: {
                parsed_990: {
                    part_vii: {
                        officers: [
                            {
                                name: "Karen Homan",
                                title: "Executive Director",
                                average_hours_per_week: 40,
                                reportable_compensation_from_org: 0,
                                person_id: "person-karen",
                            },
                        ],
                    },
                },
            },
        };
        queueFetchResponses(
            { results: [snapshot()] },
            { results: [] },
            docWithOfficers,
        );
        const onOpenEntity = vi.fn();
        renderWithProviders(<IRS990Viewer caseId="case-1" onOpenEntity={onOpenEntity} />);

        const officerBtn = await screen.findByRole("button", { name: /karen homan/i });
        await userEvent.click(officerBtn);

        expect(onOpenEntity).toHaveBeenCalledWith("person-karen");
    });

    it("shows a 'No 990 data available' empty state when there are no snapshots", async () => {
        queueFetchResponses({ results: [] }, { results: [] });
        renderWithProviders(<IRS990Viewer caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText(/no 990 filings ingested/i)).toBeInTheDocument();
        });
        // No year selector when there are no years.
        expect(screen.queryByLabelText(/select tax year/i)).not.toBeInTheDocument();
    });

    it("renders skeleton on initial load and surfaces an error when the fetch fails", async () => {
        // First render: skeleton (no fetch resolved yet).
        const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
        let rejectFn: (e: Error) => void = () => undefined;
        fetchMock.mockImplementationOnce(
            () =>
                new Promise((_resolve, reject) => {
                    rejectFn = reject;
                }),
        );
        // The findings fetch also gets queued — make it never resolve either.
        fetchMock.mockImplementationOnce(() => new Promise(() => undefined));

        const { container } = renderWithProviders(<IRS990Viewer caseId="case-1" />);

        // Skeleton present.
        expect(container.querySelector("[aria-busy='true']")).toBeTruthy();

        // Now reject the financials call → component flips to error state.
        rejectFn(new Error("network down"));

        await waitFor(() => {
            expect(screen.getByText(/couldn't load 990 data/i)).toBeInTheDocument();
        });
        expect(screen.getByText(/network down/i)).toBeInTheDocument();
    });
});
