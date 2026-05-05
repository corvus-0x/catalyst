import { ReactElement } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ColdStartCanvas, dedupeIrsByEin } from "./ColdStartCanvas";
import { TooltipProvider } from "../ui/Tooltip";

function renderWithProviders(ui: ReactElement) {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
}

interface FetchResponse {
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
    headers: Headers;
}

function mockFetchOnce(body: unknown, status = 200): void {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: status < 400,
        status,
        json: async () => body,
        headers: new Headers({ "content-type": "application/json" }),
    } satisfies FetchResponse);
}

describe("dedupeIrsByEin", () => {
    it("collapses multiple filings per EIN, keeping the most recent tax_year", () => {
        const out = dedupeIrsByEin([
            { ein: "82-4458479", taxpayer_name: "Acme Inc", return_type: "990", tax_year: 2022 },
            { ein: "82-4458479", taxpayer_name: "Acme Inc", return_type: "990", tax_year: 2024 },
            { ein: "82-4458479", taxpayer_name: "Acme Inc", return_type: "990", tax_year: 2023 },
            { ein: "10-1010101", taxpayer_name: "Beta Foundation", return_type: "990EZ", tax_year: 2021 },
        ]);

        expect(out).toHaveLength(2);
        const acme = out.find((r) => r.ein === "82-4458479")!;
        expect(acme.tax_year).toBe(2024);
    });

    it("filters out rows missing an EIN", () => {
        const out = dedupeIrsByEin([
            // @ts-expect-error — testing runtime guard
            { ein: undefined, taxpayer_name: "Anon", return_type: "990", tax_year: 2024 },
            { ein: "10-1010101", taxpayer_name: "Beta", return_type: "990", tax_year: 2024 },
        ]);
        expect(out).toHaveLength(1);
        expect(out[0].ein).toBe("10-1010101");
    });

    it("returns sorted by taxpayer_name", () => {
        const out = dedupeIrsByEin([
            { ein: "1", taxpayer_name: "Zebra", return_type: "990", tax_year: 2024 },
            { ein: "2", taxpayer_name: "Acme", return_type: "990", tax_year: 2024 },
            { ein: "3", taxpayer_name: "Mid", return_type: "990", tax_year: 2024 },
        ]);
        expect(out.map((r) => r.taxpayer_name)).toEqual(["Acme", "Mid", "Zebra"]);
    });
});

describe("ColdStartCanvas", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("renders both IRS and SOS panels with their headings", () => {
        renderWithProviders(<ColdStartCanvas caseId="case-1" onConfirmed={() => undefined} />);
        expect(screen.getByRole("heading", { name: /irs form 990/i })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: /ohio secretary of state/i })).toBeInTheDocument();
    });

    it("disables search buttons when input is empty", () => {
        renderWithProviders(<ColdStartCanvas caseId="case-1" onConfirmed={() => undefined} />);
        expect(screen.getByRole("button", { name: /search irs/i })).toBeDisabled();
        expect(screen.getByRole("button", { name: /search sos/i })).toBeDisabled();
    });

    it("runs an SOS sync search and renders the deduped result row", async () => {
        mockFetchOnce({
            source: "ohio_sos",
            results: [
                {
                    business_name: "Do Good In His Name Inc",
                    charter_number: "4128601",
                    status: "ACTIVE",
                    county: "Darke",
                },
            ],
            count: 1,
            notes: [],
        });

        renderWithProviders(<ColdStartCanvas caseId="case-1" onConfirmed={() => undefined} />);
        const input = screen.getByPlaceholderText(/entity name or charter number/i);
        fireEvent.change(input, { target: { value: "do good" } });
        fireEvent.click(screen.getByRole("button", { name: /search sos/i }));

        await waitFor(() => {
            expect(screen.getByText("Do Good In His Name Inc")).toBeInTheDocument();
        });
        expect(screen.getByText(/#4128601/)).toBeInTheDocument();
    });

    it("calls onConfirmed and POSTs to add-to-case when an SOS result is confirmed", async () => {
        const sosRow = {
            business_name: "Acme Charity",
            charter_number: "9999",
            status: "ACTIVE",
            county: "Franklin",
        };
        mockFetchOnce({ source: "ohio_sos", results: [sosRow], count: 1, notes: [] }); // search
        mockFetchOnce({ created: "organization", entity: { name: "Acme Charity" }, duplicate: false }); // add-to-case

        const onConfirmed = vi.fn();
        renderWithProviders(<ColdStartCanvas caseId="case-1" onConfirmed={onConfirmed} />);

        fireEvent.change(
            screen.getByPlaceholderText(/entity name or charter number/i),
            { target: { value: "acme" } },
        );
        fireEvent.click(screen.getByRole("button", { name: /search sos/i }));

        const beginBtn = await screen.findByRole("button", { name: /begin investigation/i });
        fireEvent.click(beginBtn);

        await waitFor(() => expect(onConfirmed).toHaveBeenCalled());

        const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
        const addToCaseCall = calls.find(([url]) => String(url).includes("/research/add-to-case/"));
        expect(addToCaseCall).toBeDefined();
        const body = JSON.parse(addToCaseCall![1].body as string);
        expect(body.source).toBe("ohio-sos");
        expect(body.data.business_name).toBe("Acme Charity");
    });

    it("surfaces the SOS error message in an alert region", async () => {
        mockFetchOnce({ source: "ohio_sos", results: [], count: 0, notes: [], error: "CSVs not uploaded" });
        renderWithProviders(<ColdStartCanvas caseId="case-1" onConfirmed={() => undefined} />);

        fireEvent.change(
            screen.getByPlaceholderText(/entity name or charter number/i),
            { target: { value: "anything" } },
        );
        fireEvent.click(screen.getByRole("button", { name: /search sos/i }));

        await waitFor(() => {
            expect(screen.getByRole("alert")).toHaveTextContent(/csvs not uploaded/i);
        });
    });
});
