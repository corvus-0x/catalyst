import { ReactElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RightDetailPanel, entityPropertyRows } from "./RightDetailPanel";
import { TooltipProvider } from "../ui/Tooltip";
import type { CaseDetail, GraphNode } from "../../types";

function renderWithProviders(ui: ReactElement) {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function caseDetail(partial: Partial<CaseDetail> = {}): CaseDetail {
    return {
        id: "case-1",
        name: "Demo case",
        status: "ACTIVE",
        notes: "",
        referral_ref: "",
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z",
        documents: [],
        ...partial,
    };
}

function orgNode(partial: Partial<GraphNode> = {}): GraphNode {
    return {
        id: "11111111-2222-3333-4444-555555555555",
        type: "organization",
        label: "Acme Charity",
        metadata: {
            finding_count: 2,
            doc_count: 4,
            ein: "82-4458479",
            org_type: "501(c)(3)",
            status: "ACTIVE",
        },
        ...partial,
    };
}

function mockEntityFetch(body: Record<string, unknown>) {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => body,
        headers: new Headers({ "content-type": "application/json" }),
    });
}

/* ───── Pure helper ───── */

describe("entityPropertyRows", () => {
    it("includes per-type fields for an organization", () => {
        const rows = entityPropertyRows(orgNode());
        const labels = rows.map(([k]) => k);
        expect(labels).toContain("Type");
        expect(labels).toContain("EIN");
        expect(labels).toContain("Status");
        expect(labels).toContain("Findings");
        expect(labels).toContain("Documents");
    });

    it("includes role_tags + aliases for a person", () => {
        const rows = entityPropertyRows({
            id: "p1",
            type: "person",
            label: "Karen",
            metadata: {
                finding_count: 0,
                doc_count: 0,
                role_tags: ["officer", "founder"],
                aliases: ["K. Mitchell"],
            },
        });
        const map = new Map(rows);
        expect(map.get("Roles")).toBe("officer, founder");
        expect(map.get("Aliases")).toBe("K. Mitchell");
    });

    it("formats property values with $ prefix", () => {
        const rows = entityPropertyRows({
            id: "pr1",
            type: "property",
            label: "25 W Main St",
            metadata: {
                finding_count: 0,
                doc_count: 0,
                parcel_number: "01-23-456",
                county: "Darke",
                assessed_value: "120000",
                purchase_price: "180000",
            },
        });
        const map = new Map(rows);
        expect(map.get("Parcel #")).toBe("01-23-456");
        expect(map.get("Assessed")).toBe("$120000");
        expect(map.get("Purchase price")).toBe("$180000");
    });

    it("filters out missing/null/empty fields", () => {
        const rows = entityPropertyRows({
            id: "o1",
            type: "organization",
            label: "Bare",
            metadata: { finding_count: 0, doc_count: 0 },
        });
        // No EIN, no org_type, no status. Should still have ID + Findings + Documents.
        const labels = rows.map(([k]) => k);
        expect(labels).not.toContain("EIN");
        expect(labels).not.toContain("Type");
        expect(labels).toContain("Findings");
    });
});

/* ───── Component ───── */

describe("RightDetailPanel", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("renders the case subject card by default (no selection)", () => {
        renderWithProviders(
            <RightDetailPanel
                caseDetail={caseDetail({ name: "Bright Future Foundation" })}
                selectedNode={null}
                onCollapse={() => undefined}
                onClearSelection={() => undefined}
            />,
        );
        expect(screen.getByText(/case subject/i)).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: /bright future foundation/i }))
            .toBeInTheDocument();
    });

    it("renders entity name + Properties tab when a node is selected", async () => {
        mockEntityFetch({
            id: "x",
            entity_type: "organization",
            related_documents: [],
            related_findings: [],
        });
        renderWithProviders(
            <RightDetailPanel
                caseDetail={caseDetail()}
                selectedNode={orgNode()}
                onCollapse={() => undefined}
                onClearSelection={() => undefined}
            />,
        );
        expect(screen.getByRole("heading", { name: /acme charity/i })).toBeInTheDocument();
        // Properties tab is the default — EIN should be visible.
        expect(screen.getByText("82-4458479")).toBeInTheDocument();
    });

    it("loads related documents into the Sources tab", async () => {
        mockEntityFetch({
            id: "x",
            entity_type: "organization",
            related_documents: [
                { id: "d1", filename: "990 (2024).pdf", doc_type: "IRS_990" },
                { id: "d2", filename: "Articles.pdf", doc_type: "ARTICLES" },
            ],
            related_findings: [],
        });
        renderWithProviders(
            <RightDetailPanel
                caseDetail={caseDetail()}
                selectedNode={orgNode()}
                onCollapse={() => undefined}
                onClearSelection={() => undefined}
            />,
        );
        // Switch to Sources tab.
        await userEvent.click(screen.getByRole("tab", { name: /sources/i }));
        await waitFor(() => {
            expect(screen.getByText("990 (2024).pdf")).toBeInTheDocument();
            expect(screen.getByText("Articles.pdf")).toBeInTheDocument();
        });
    });

    it("renders related findings with severity chip on the Flags tab", async () => {
        mockEntityFetch({
            id: "x",
            entity_type: "organization",
            related_documents: [],
            related_findings: [
                { id: "f1", title: "False disclosure", severity: "CRITICAL", status: "NEW" },
            ],
        });
        renderWithProviders(
            <RightDetailPanel
                caseDetail={caseDetail()}
                selectedNode={orgNode()}
                onCollapse={() => undefined}
                onClearSelection={() => undefined}
            />,
        );
        await userEvent.click(screen.getByRole("tab", { name: /flags/i }));
        await waitFor(() => {
            expect(screen.getByText("False disclosure")).toBeInTheDocument();
        });
        expect(screen.getByText("CRITICAL")).toBeInTheDocument();
    });

    it("renders org-only Actions when an organization is selected", async () => {
        mockEntityFetch({ id: "x", related_documents: [], related_findings: [] });
        renderWithProviders(
            <RightDetailPanel
                caseDetail={caseDetail()}
                selectedNode={orgNode()}
                onCollapse={() => undefined}
                onClearSelection={() => undefined}
            />,
        );
        await userEvent.click(screen.getByRole("tab", { name: /actions/i }));
        expect(await screen.findByRole("button", { name: /pull irs 990 filings/i }))
            .toBeInTheDocument();
        expect(screen.getByRole("button", { name: /look up in ohio sos/i })).toBeInTheDocument();
    });

    it("disables 'Pull IRS 990 filings' when the org has no EIN", async () => {
        mockEntityFetch({ id: "x", related_documents: [], related_findings: [] });
        renderWithProviders(
            <RightDetailPanel
                caseDetail={caseDetail()}
                selectedNode={orgNode({ metadata: { finding_count: 0, doc_count: 0 } })}
                onCollapse={() => undefined}
                onClearSelection={() => undefined}
            />,
        );
        await userEvent.click(screen.getByRole("tab", { name: /actions/i }));
        const btn = await screen.findByRole("button", { name: /pull irs 990 filings/i });
        expect(btn).toBeDisabled();
    });

    it("invokes onClearSelection when the X button is clicked", async () => {
        mockEntityFetch({ id: "x", related_documents: [], related_findings: [] });
        const onClear = vi.fn();
        renderWithProviders(
            <RightDetailPanel
                caseDetail={caseDetail()}
                selectedNode={orgNode()}
                onCollapse={() => undefined}
                onClearSelection={onClear}
            />,
        );
        await userEvent.click(screen.getByRole("button", { name: /clear selection/i }));
        expect(onClear).toHaveBeenCalledTimes(1);
    });
});
