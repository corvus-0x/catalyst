import { ReactElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub react-cytoscapejs before importing the component — Cytoscape's canvas
// renderer isn't usable in jsdom and we don't need to test the upstream lib.
vi.mock("react-cytoscapejs", () => ({
    default: function MockCytoscape(props: { elements?: unknown[] }) {
        return (
            <div data-testid="mock-cytoscape" data-element-count={props.elements?.length ?? 0} />
        );
    },
}));

vi.mock("cytoscape", () => ({
    default: { use: vi.fn() },
}));

vi.mock("cytoscape-cose-bilkent", () => ({ default: vi.fn() }));

// requestAnimationFrame fires synchronously in tests so bindCy's deferred
// resize doesn't break async assertions.
vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; });

import { WorkspaceGraph } from "./WorkspaceGraph";
import { TooltipProvider } from "../ui/Tooltip";

function renderWithProviders(ui: ReactElement) {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function mockGraphFetch(body: unknown, status = 200) {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: status < 400,
        status,
        json: async () => body,
        headers: new Headers({ "content-type": "application/json" }),
    });
}

function mockGraphFetchFails(message = "boom") {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error(message));
}

const EMPTY_RESPONSE = {
    nodes: [],
    edges: [],
    timeline_events: [],
    stats: { total_nodes: 0, total_edges: 0, total_events: 0, node_types: {} },
};

describe("WorkspaceGraph", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("shows the loading hint before the fetch resolves", () => {
        // never resolve
        (fetch as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(new Promise(() => {}));
        renderWithProviders(<WorkspaceGraph caseId="case-1" />);
        expect(screen.getByText(/loading graph/i)).toBeInTheDocument();
    });

    it("shows the empty hint when there are no nodes", async () => {
        mockGraphFetch(EMPTY_RESPONSE);
        renderWithProviders(<WorkspaceGraph caseId="case-1" />);
        await waitFor(() => {
            expect(screen.getByText(/graph is empty/i)).toBeInTheDocument();
        });
    });

    it("renders the cytoscape mount when nodes exist", async () => {
        mockGraphFetch({
            nodes: [
                { id: "p1", type: "person", label: "Karen", metadata: { finding_count: 2, doc_count: 4 } },
                { id: "o1", type: "organization", label: "Acme", metadata: { finding_count: 0, doc_count: 1 } },
            ],
            edges: [
                {
                    source: "p1",
                    target: "o1",
                    relationship: "OFFICER_OF",
                    label: "Officer Of",
                    weight: 2,
                    metadata: {},
                },
            ],
            timeline_events: [],
            stats: {
                total_nodes: 2,
                total_edges: 1,
                total_events: 0,
                node_types: { person: 1, organization: 1, property: 0, financial_instrument: 0 },
            },
        });

        renderWithProviders(<WorkspaceGraph caseId="case-1" />);

        const cy = await screen.findByTestId("mock-cytoscape");
        // 2 nodes + 1 edge = 3 elements
        expect(cy.getAttribute("data-element-count")).toBe("3");
    });

    it("shows an error hint when the fetch fails", async () => {
        mockGraphFetchFails("network down");
        renderWithProviders(<WorkspaceGraph caseId="case-1" />);
        await waitFor(() => {
            expect(screen.getByText(/network down/i)).toBeInTheDocument();
        });
    });
});
