import { ReactElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FinancialsPane } from "./FinancialsPane";
import { TooltipProvider } from "../ui/Tooltip";
import { FinancialSnapshotItem } from "../../types";

function renderWithProviders(ui: ReactElement) {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function snap(partial: Partial<FinancialSnapshotItem> = {}): FinancialSnapshotItem {
    return {
        id: `snap-${partial.tax_year ?? 2020}`,
        document_id: "doc-1",
        document_filename: "irs_990_2020.pdf",
        organization_id: "org-1",
        organization_name: "Demo Charity",
        ein: "12-3456789",
        tax_year: 2020,
        form_type: "990",
        total_contributions: null,
        program_service_revenue: null,
        investment_income: null,
        other_revenue: null,
        total_revenue: 500_000,
        grants_paid: null,
        salaries_and_compensation: null,
        professional_fundraising: 0,
        other_expenses: null,
        total_expenses: 400_000,
        revenue_less_expenses: null,
        total_assets_boy: null,
        total_assets_eoy: null,
        total_liabilities_boy: null,
        total_liabilities_eoy: null,
        net_assets_boy: null,
        net_assets_eoy: 200_000,
        officer_compensation_total: 80_000,
        num_employees: null,
        source: "EXTRACTED",
        confidence: 0.95,
        ...partial,
    };
}

function mockFetch(results: FinancialSnapshotItem[]) {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results }),
        headers: new Headers({ "content-type": "application/json" }),
    });
}

describe("FinancialsPane", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("renders rows for revenue, expenses, net assets, program ratio when data loads", async () => {
        mockFetch([snap({ tax_year: 2020 }), snap({ tax_year: 2021, id: "snap-2021" })]);

        renderWithProviders(<FinancialsPane caseId="case-1" />);

        // Wait for the table to render. "Revenue" exists in both the legend and
        // the row label, so we wait on a row label that's unique to the table body.
        await waitFor(() => {
            expect(screen.getByText("Net Assets")).toBeInTheDocument();
        });
        // Revenue + Expenses appear twice (legend + row label) — assert ≥1.
        expect(screen.getAllByText("Revenue").length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText("Expenses").length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText("Program Ratio")).toBeInTheDocument();
        expect(screen.getByText("Officer Comp")).toBeInTheDocument();
    });

    it("shows year columns oldest → newest", async () => {
        mockFetch([
            snap({ tax_year: 2022, id: "snap-2022" }),
            snap({ tax_year: 2020, id: "snap-2020" }),
            snap({ tax_year: 2021, id: "snap-2021" }),
        ]);

        renderWithProviders(<FinancialsPane caseId="case-1" />);

        await waitFor(() => screen.getByText("Net Assets"));

        const headers = screen.getAllByRole("button", { name: /Show \d{4} 990 detail/ });
        const years = headers.map((h) => Number(h.textContent));
        expect(years).toEqual([2020, 2021, 2022]);
    });

    it("highlights revenue cell with SR-021 chip on a 1500% revenue spike", async () => {
        mockFetch([
            snap({ tax_year: 2020, total_revenue: 100_000, id: "snap-2020" }),
            snap({ tax_year: 2021, total_revenue: 1_600_000, id: "snap-2021" }),
        ]);

        renderWithProviders(<FinancialsPane caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText("SR-021")).toBeInTheDocument();
        });
    });

    it("highlights officer comp cell with SR-013 chip on $0 comp + $4M revenue", async () => {
        mockFetch([
            snap({
                tax_year: 2022,
                id: "snap-2022",
                total_revenue: 4_000_000,
                officer_compensation_total: 0,
            }),
        ]);

        renderWithProviders(<FinancialsPane caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText("SR-013")).toBeInTheDocument();
        });
    });

    it("highlights program ratio cell with SR-029 chip when program ratio = 30%", async () => {
        // Program ratio = (te − officer − fundraising) / te = (1_000_000 − 700_000 − 0) / 1_000_000 = 0.3
        mockFetch([
            snap({
                tax_year: 2023,
                id: "snap-2023",
                total_revenue: 1_500_000,
                total_expenses: 1_000_000,
                officer_compensation_total: 700_000,
                professional_fundraising: 0,
            }),
        ]);

        renderWithProviders(<FinancialsPane caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText("SR-029")).toBeInTheDocument();
        });
    });

    it("fires onSelectYear with the right tax_year when a year header is clicked", async () => {
        mockFetch([
            snap({ tax_year: 2020, id: "snap-2020" }),
            snap({ tax_year: 2021, id: "snap-2021" }),
        ]);
        const onSelectYear = vi.fn();

        renderWithProviders(<FinancialsPane caseId="case-1" onSelectYear={onSelectYear} />);

        await waitFor(() => screen.getByText("Net Assets"));

        const header2021 = screen.getByRole("button", { name: /Show 2021 990 detail/ });
        await userEvent.click(header2021);

        expect(onSelectYear).toHaveBeenCalledTimes(1);
        expect(onSelectYear).toHaveBeenCalledWith(2021);
    });

    it("renders an empty-state hint when no snapshots exist (no crash)", async () => {
        mockFetch([]);

        renderWithProviders(<FinancialsPane caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText(/no 990 financial data extracted yet/i)).toBeInTheDocument();
        });
    });
});
