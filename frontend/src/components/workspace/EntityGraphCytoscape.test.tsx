/**
 * EntityGraphCytoscape — toolbar tests (§8.4).
 *
 * react-cytoscapejs and cytoscape are mocked the same way WorkspaceGraph.test.tsx
 * does — Cytoscape's canvas renderer doesn't run in jsdom and isn't what we're
 * testing here. We're verifying the React-managed floating toolbar.
 */
import { ReactElement } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-cytoscapejs", () => ({
    default: function MockCytoscape(props: { elements?: unknown[]; cy?: (cy: unknown) => void }) {
        // Hand a tiny fake cytoscape instance back to the host so the
        // toolbar's effects don't crash on null. Each method the component
        // touches has a no-op stub.
        if (props.cy) {
            props.cy({
                zoom: () => 1,
                width: () => 800,
                height: () => 600,
                nodes: () => ({
                    removeClass: () => undefined,
                    forEach: () => undefined,
                }),
                $id: () => ({ addClass: () => undefined }),
                style: () => ({ fromJson: () => ({ update: () => undefined }) }),
                elements: () => ({ lock: () => undefined, unlock: () => undefined }),
                layout: () => ({ run: () => undefined }),
                resize: () => undefined,
                fit: () => undefined,
                removeAllListeners: () => undefined,
                on: () => undefined,
            });
        }
        return (
            <div data-testid="mock-cytoscape" data-element-count={props.elements?.length ?? 0} />
        );
    },
}));

vi.mock("cytoscape", () => ({
    default: { use: vi.fn() },
}));

vi.mock("cytoscape-cose-bilkent", () => ({ default: vi.fn() }));

// requestAnimationFrame fires synchronously so bindCy's deferred resize
// doesn't break synchronous test assertions.
vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; });

import { EntityGraphCytoscape } from "./EntityGraphCytoscape";
import type { GraphEdge, GraphNode } from "../../types";
import { TooltipProvider } from "../ui/Tooltip";

const NODES: GraphNode[] = [
    {
        id: "p1",
        type: "person",
        label: "Karen",
        metadata: { finding_count: 2, doc_count: 4 },
    },
    {
        id: "o1",
        type: "organization",
        label: "Acme",
        metadata: { finding_count: 0, doc_count: 1 },
    },
];

const EDGES: GraphEdge[] = [
    {
        source: "p1",
        target: "o1",
        relationship: "OFFICER_OF",
        label: "Officer Of",
        weight: 2,
        metadata: {},
    },
];

function renderGraph(ui: ReactElement) {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("EntityGraphCytoscape — floating toolbar (§8.4)", () => {
    it("renders zoom + and zoom - buttons", () => {
        renderGraph(<EntityGraphCytoscape nodes={NODES} edges={EDGES} />);
        expect(screen.getByLabelText("Zoom in")).toBeInTheDocument();
        expect(screen.getByLabelText("Zoom out")).toBeInTheDocument();
    });

    it("renders the four layout options behind the layout dropdown", async () => {
        renderGraph(<EntityGraphCytoscape nodes={NODES} edges={EDGES} />);
        const trigger = screen.getByTestId("layout-trigger");
        // Default label is "Organic"
        expect(trigger).toHaveTextContent(/organic/i);
        act(() => {
            fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
            fireEvent.click(trigger);
        });
        expect(await screen.findByRole("menuitemradio", { name: "Organic" })).toBeInTheDocument();
        expect(
            await screen.findByRole("menuitemradio", { name: "Hierarchical" }),
        ).toBeInTheDocument();
        expect(await screen.findByRole("menuitemradio", { name: "Block" })).toBeInTheDocument();
        expect(await screen.findByRole("menuitemradio", { name: "Circular" })).toBeInTheDocument();
    });

    it("renders the four view-mode options behind the view dropdown", async () => {
        renderGraph(<EntityGraphCytoscape nodes={NODES} edges={EDGES} />);
        const trigger = screen.getByTestId("view-trigger");
        expect(trigger).toHaveTextContent(/normal/i);
        act(() => {
            fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
            fireEvent.click(trigger);
        });
        expect(await screen.findByRole("menuitemradio", { name: "Normal" })).toBeInTheDocument();
        expect(
            await screen.findByRole("menuitemradio", { name: "Flag intensity" }),
        ).toBeInTheDocument();
        expect(
            await screen.findByRole("menuitemradio", { name: "Provenance strength" }),
        ).toBeInTheDocument();
        expect(
            await screen.findByRole("menuitemradio", { name: "Document count" }),
        ).toBeInTheDocument();
    });

    it("renders the four show toggles with correct defaults", async () => {
        renderGraph(<EntityGraphCytoscape nodes={NODES} edges={EDGES} />);
        const trigger = screen.getByTestId("show-trigger");
        act(() => {
            fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
            fireEvent.click(trigger);
        });
        const sourceDocs = await screen.findByRole("menuitemcheckbox", {
            name: "Source documents",
        });
        const flagBadges = await screen.findByRole("menuitemcheckbox", { name: "Flag badges" });
        const findingBadges = await screen.findByRole("menuitemcheckbox", {
            name: "Finding badges",
        });
        const pinnedOnly = await screen.findByRole("menuitemcheckbox", { name: "Pinned-only" });

        expect(sourceDocs).toHaveAttribute("aria-checked", "false");
        expect(flagBadges).toHaveAttribute("aria-checked", "true");
        expect(findingBadges).toHaveAttribute("aria-checked", "true");
        expect(pinnedOnly).toHaveAttribute("aria-checked", "false");
    });

    it("lock button starts unlocked, toggles to locked on click", () => {
        renderGraph(<EntityGraphCytoscape nodes={NODES} edges={EDGES} />);
        const lock = screen.getByTestId("lock-toggle");
        expect(lock).toHaveAttribute("aria-pressed", "false");
        expect(lock).toHaveAttribute("data-locked", "false");
        expect(lock).toHaveAttribute("aria-label", "Lock layout");

        act(() => {
            fireEvent.click(lock);
        });

        expect(lock).toHaveAttribute("aria-pressed", "true");
        expect(lock).toHaveAttribute("data-locked", "true");
        expect(lock).toHaveAttribute("aria-label", "Unlock layout");
    });

    it("layout dropdown selection updates the trigger's selected indicator", async () => {
        renderGraph(<EntityGraphCytoscape nodes={NODES} edges={EDGES} />);
        const trigger = screen.getByTestId("layout-trigger");
        expect(trigger).toHaveTextContent(/organic/i);

        act(() => {
            fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
            fireEvent.click(trigger);
        });
        const circular = await screen.findByRole("menuitemradio", { name: "Circular" });
        act(() => {
            fireEvent.click(circular);
        });

        // After selection, Radix closes and the trigger label reflects state.
        expect(trigger).toHaveTextContent(/circular/i);
        expect(trigger).not.toHaveTextContent(/organic/i);
    });
});
