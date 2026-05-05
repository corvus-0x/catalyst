import { ReactElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PackagePane } from "./PackagePane";
import { TooltipProvider } from "../ui/Tooltip";
import type { FindingItem } from "../../types";

vi.mock("../ui/Toaster", () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

function renderWithProviders(ui: ReactElement) {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function finding(partial: Partial<FindingItem> = {}): FindingItem {
    return {
        id: "f-1",
        rule_id: "SR-015",
        title: "Insider swap detected",
        description: "Related party on both sides of property transaction",
        narrative: "",
        severity: "CRITICAL",
        status: "CONFIRMED",
        evidence_weight: "DOCUMENTED",
        source: "AUTO",
        investigator_note: "",
        legal_refs: [],
        evidence_snapshot: {},
        trigger_doc_id: null,
        trigger_doc_filename: null,
        trigger_entity_id: null,
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z",
        entity_links: [],
        document_links: [
            { document_id: "d-1", document_filename: "deed.pdf", page_reference: "p1", context_note: "" },
        ],
        ...partial,
    };
}

function mockFindingsResponse(findings: FindingItem[]) {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
            count: findings.length,
            limit: 100,
            offset: 0,
            next_offset: null,
            previous_offset: null,
            results: findings,
        }),
        headers: new Headers({ "content-type": "application/json" }),
    });
}

function mockPdfResponse() {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: async () => new Blob(["%PDF-1.4 stub"], { type: "application/pdf" }),
        headers: new Headers({ "content-type": "application/pdf" }),
    });
}

describe("PackagePane", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
        // jsdom doesn't implement createObjectURL — stub it.
        if (!("createObjectURL" in URL)) {
            (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:stub";
        } else {
            vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:stub");
        }
        if (!("revokeObjectURL" in URL)) {
            (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
        } else {
            vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
        }
        // Stub the anchor click that triggers the file download in jsdom.
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("renders all four agency lanes", async () => {
        mockFindingsResponse([]);
        renderWithProviders(<PackagePane caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText("Ohio Attorney General")).toBeInTheDocument();
        });
        expect(screen.getByText("IRS Form 13909")).toBeInTheDocument();
        expect(screen.getByText("FBI IC3")).toBeInTheDocument();
        expect(screen.getByText("FCA OIG")).toBeInTheDocument();
    });

    it("renders the pre-flight checklist", async () => {
        mockFindingsResponse([]);
        renderWithProviders(<PackagePane caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText(/pre-flight check/i)).toBeInTheDocument();
        });
        expect(
            screen.getByText(/every confirmed finding has ≥1 source document/i),
        ).toBeInTheDocument();
        expect(screen.getByText(/graph is locked/i)).toBeInTheDocument();
    });

    it("places a finding only in the lanes that its rule_id routes to", async () => {
        // SR-029 (LOW_PROGRAM_RATIO) routes to IRS only.
        mockFindingsResponse([
            finding({ id: "f-irs-only", rule_id: "SR-029", title: "Low program ratio" }),
        ]);
        renderWithProviders(<PackagePane caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getAllByText("Low program ratio").length).toBe(1);
        });
        // Should not appear in any other lane.
        const matches = screen.getAllByText("Low program ratio");
        expect(matches).toHaveLength(1);
    });

    it("toggling a finding off in one lane only affects that lane", async () => {
        // SR-015 routes to ohio_ag, irs_13909, and fbi_ic3.
        mockFindingsResponse([finding({ id: "f-1", rule_id: "SR-015", title: "Insider swap" })]);
        renderWithProviders(<PackagePane caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getAllByText("Insider swap").length).toBe(3);
        });

        const checkboxes = screen.getAllByRole("checkbox", { name: /include insider swap/i });
        expect(checkboxes).toHaveLength(3);
        // All start checked (default routing).
        checkboxes.forEach((cb) => expect(cb).toBeChecked());

        const user = userEvent.setup();
        // Uncheck the first lane (Ohio AG).
        await user.click(checkboxes[0]);

        const recheck = screen.getAllByRole("checkbox", { name: /include insider swap/i });
        expect(recheck[0]).not.toBeChecked();
        expect(recheck[1]).toBeChecked();
        expect(recheck[2]).toBeChecked();
    });

    it("disables the Generate PDF button when no findings are selected", async () => {
        // No confirmed findings → every lane has 0 selected.
        mockFindingsResponse([]);
        renderWithProviders(<PackagePane caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getByText("Ohio Attorney General")).toBeInTheDocument();
        });
        const buttons = screen.getAllByRole("button", { name: /generate pdf/i });
        expect(buttons).toHaveLength(4);
        buttons.forEach((b) => expect(b).toBeDisabled());
    });

    it("clicking Generate PDF posts the right body to /api/cases/<id>/referral-pdf/", async () => {
        mockFindingsResponse([finding({ id: "f-1", rule_id: "SR-015" })]);
        renderWithProviders(<PackagePane caseId="case-42" />);

        await waitFor(() => {
            expect(screen.getAllByText("Insider swap detected").length).toBe(3);
        });

        mockPdfResponse();

        const buttons = screen.getAllByRole("button", { name: /generate pdf/i });
        // Ohio AG is the first lane.
        const user = userEvent.setup();
        await user.click(buttons[0]);

        await waitFor(() => {
            const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
            const pdfCall = calls.find((c) => String(c[0]).includes("/referral-pdf/"));
            expect(pdfCall).toBeDefined();
            const url = pdfCall![0] as string;
            expect(url).toContain("/api/cases/case-42/referral-pdf/");
            const init = pdfCall![1] as RequestInit;
            expect(init.method).toBe("POST");
            const body = JSON.parse(init.body as string);
            expect(body.agency).toBe("ohio_ag");
            expect(Array.isArray(body.finding_ids)).toBe(true);
            expect(body.finding_ids).toContain("f-1");
        });
    });

    it("flips the lane status to Submitted after a successful PDF download", async () => {
        mockFindingsResponse([finding({ id: "f-1", rule_id: "SR-015" })]);
        renderWithProviders(<PackagePane caseId="case-1" />);

        await waitFor(() => {
            expect(screen.getAllByText("Insider swap detected").length).toBe(3);
        });
        // Before generation: 4 Draft pills.
        expect(screen.getAllByText("Draft").length).toBe(4);

        mockPdfResponse();

        const buttons = screen.getAllByRole("button", { name: /generate pdf/i });
        const user = userEvent.setup();
        await user.click(buttons[0]);

        await waitFor(() => {
            expect(screen.getByText("Submitted")).toBeInTheDocument();
        });
        // Three lanes still Draft.
        expect(screen.getAllByText("Draft").length).toBe(3);
    });
});
