import { ReactElement, useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom doesn't ship ResizeObserver; cmdk uses it internally.
class ResizeObserverPolyfill {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === "undefined") {
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserverPolyfill }).ResizeObserver =
        ResizeObserverPolyfill;
}

import {
    WorkspaceCommandPalette,
    type CommandResult,
} from "./WorkspaceCommandPalette";
import type {
    CaseDetail,
    CaseGraphResponse,
    DocumentItem,
    FindingItem,
    PaginatedResponse,
} from "../../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeGraph(): CaseGraphResponse {
    return {
        nodes: [
            {
                id: "ent-org-1",
                type: "organization",
                label: "Bright Future Foundation",
                metadata: { finding_count: 2, doc_count: 4, ein: "82-4458479" },
            },
            {
                id: "ent-person-1",
                type: "person",
                label: "Karen Mitchell",
                metadata: { finding_count: 1, doc_count: 2 },
            },
        ],
        edges: [],
        timeline_events: [],
        stats: {
            total_nodes: 2,
            total_edges: 0,
            total_events: 0,
            node_types: {
                person: 1,
                organization: 1,
                property: 0,
                financial_instrument: 0,
            },
        },
    };
}

function makeCaseDetail(): CaseDetail {
    const doc: DocumentItem = {
        id: "doc-1",
        filename: "990_2024.pdf",
        display_name: "Form 990 (2024)",
        file_path: "/media/doc-1.pdf",
        sha256_hash: "abc123",
        file_size: 1024,
        doc_type: "IRS_990",
        is_generated: false,
        doc_subtype: "",
        source_url: null,
        ocr_status: "DONE",
        uploaded_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z",
    };
    return {
        id: "case-1",
        name: "Demo case",
        status: "ACTIVE",
        notes: "",
        referral_ref: "",
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z",
        documents: [doc],
    };
}

function makeFindings(): PaginatedResponse<FindingItem> {
    const finding: FindingItem = {
        id: "find-1",
        rule_id: "SR-015",
        title: "Insider swap on parcel 123",
        description: "",
        narrative: "",
        severity: "CRITICAL",
        status: "NEW",
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
        document_links: [],
    };
    return {
        count: 1,
        limit: 100,
        offset: 0,
        next_offset: null,
        previous_offset: null,
        results: [finding],
    };
}

// ---------------------------------------------------------------------------
// Fetch mock — route URLs to the right fixture
// ---------------------------------------------------------------------------

interface MockShapes {
    graph?: CaseGraphResponse | null;
    detail?: CaseDetail | null;
    findings?: PaginatedResponse<FindingItem> | null;
}

function installFetchMock(shapes: MockShapes) {
    const fn = vi.fn(async (url: string | URL | Request) => {
        const path = typeof url === "string" ? url : url.toString();
        let body: unknown = {};
        if (path.includes("/graph/")) body = shapes.graph ?? { nodes: [] };
        else if (path.includes("/findings/")) body = shapes.findings ?? { results: [] };
        else if (path.match(/\/api\/cases\/[^/]+\/$/)) body = shapes.detail ?? { documents: [] };

        return {
            ok: true,
            status: 200,
            json: async () => body,
            text: async () => JSON.stringify(body),
            headers: new Headers({ "content-type": "application/json" }),
        } as unknown as Response;
    });
    vi.stubGlobal("fetch", fn);
    return fn;
}

// ---------------------------------------------------------------------------
// Test harness — controlled wrapper so the parent owns `open`
// ---------------------------------------------------------------------------

interface HarnessProps {
    onSelect?: (r: CommandResult) => void;
    initialOpen?: boolean;
}

function Harness({ onSelect, initialOpen = false }: HarnessProps): ReactElement {
    const [open, setOpen] = useState(initialOpen);
    return (
        <WorkspaceCommandPalette
            caseId="case-1"
            open={open}
            onOpenChange={setOpen}
            onSelect={onSelect ?? (() => undefined)}
        />
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkspaceCommandPalette", () => {
    beforeEach(() => {
        installFetchMock({
            graph: makeGraph(),
            detail: makeCaseDetail(),
            findings: makeFindings(),
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("renders nothing visible when closed", () => {
        render(<Harness initialOpen={false} />);
        expect(
            screen.queryByPlaceholderText(/search entities, documents, findings/i),
        ).not.toBeInTheDocument();
    });

    it("opens when Cmd-K is pressed", async () => {
        render(<Harness initialOpen={false} />);
        // tinykeys reads navigator.platform on module load to map "$mod".
        // jsdom's empty platform makes "$mod" resolve to Control, so we
        // dispatch a real KeyboardEvent with code:"KeyK" + ctrlKey:true.
        // Mirrors the pattern used in useWorkspaceShortcuts.test.ts.
        window.dispatchEvent(
            new KeyboardEvent("keydown", {
                code: "KeyK",
                key: "k",
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
        await waitFor(() => {
            expect(
                screen.getByPlaceholderText(/search entities, documents, findings/i),
            ).toBeInTheDocument();
        });
    });

    it("closes when Escape is pressed", async () => {
        render(<Harness initialOpen={true} />);
        const input = await screen.findByPlaceholderText(/search entities/i);
        expect(input).toBeInTheDocument();
        await userEvent.keyboard("{Escape}");
        await waitFor(() => {
            expect(screen.queryByPlaceholderText(/search entities/i)).not.toBeInTheDocument();
        });
    });

    it("filters results across all three groups when typing", async () => {
        render(<Harness initialOpen={true} />);
        const input = await screen.findByPlaceholderText(/search entities/i);
        // Wait for fetch to settle.
        await waitFor(() => {
            expect(screen.getByText("Bright Future Foundation")).toBeInTheDocument();
            expect(screen.getByText("Form 990 (2024)")).toBeInTheDocument();
            expect(screen.getByText("Insider swap on parcel 123")).toBeInTheDocument();
        });

        await userEvent.type(input, "karen");

        // Karen matches the person entity. The doc + finding should be filtered out.
        await waitFor(() => {
            expect(screen.getByText("Karen Mitchell")).toBeInTheDocument();
            expect(screen.queryByText("Form 990 (2024)")).not.toBeInTheDocument();
            expect(screen.queryByText("Insider swap on parcel 123")).not.toBeInTheDocument();
        });
    });

    it("fires onSelect with the typed payload when a result is clicked", async () => {
        const onSelect = vi.fn();
        render(<Harness initialOpen={true} onSelect={onSelect} />);
        await waitFor(() => {
            expect(screen.getByText("Insider swap on parcel 123")).toBeInTheDocument();
        });
        await userEvent.click(screen.getByText("Insider swap on parcel 123"));
        expect(onSelect).toHaveBeenCalledTimes(1);
        const arg = onSelect.mock.calls[0][0] as CommandResult;
        expect(arg.type).toBe("finding");
        if (arg.type === "finding") {
            expect(arg.finding.id).toBe("find-1");
            expect(arg.finding.rule_id).toBe("SR-015");
        }
    });

    it("shows the Cmd-K empty-state hint when there are no results", async () => {
        // Re-stub fetch to return empty data sets.
        vi.unstubAllGlobals();
        installFetchMock({
            graph: { nodes: [], edges: [], timeline_events: [], stats: {
                total_nodes: 0, total_edges: 0, total_events: 0,
                node_types: { person: 0, organization: 0, property: 0, financial_instrument: 0 },
            } },
            detail: { ...makeCaseDetail(), documents: [] },
            findings: { count: 0, limit: 100, offset: 0, next_offset: null, previous_offset: null, results: [] },
        });

        render(<Harness initialOpen={true} />);
        // Use findByTestId so we wait for the empty-state to render after
        // the initial fetch resolves (default 1000ms is enough for the
        // microtask queue to settle).
        const emptyEl = await screen.findByTestId(
            "cmdk-empty-state",
            {},
            { timeout: 2000 },
        );
        expect(emptyEl).toBeInTheDocument();
        expect(screen.getByText(/nothing to search yet/i)).toBeInTheDocument();
        expect(screen.getByText(/from anywhere to open/i)).toBeInTheDocument();
    });
});
