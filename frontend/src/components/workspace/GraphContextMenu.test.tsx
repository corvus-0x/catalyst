/**
 * GraphContextMenu tests — exercise the menu shape (entity-type-driven items)
 * and the callbacks. We open the menu in tests by firing a `contextmenu` event
 * directly on the rendered virtual trigger; that's also how the production
 * component opens it (we dispatch a synthetic `contextmenu` from useEffect).
 *
 * jsdom + Radix ContextMenu: Radix's contextmenu Trigger listens to the
 * React `onContextMenu` synthetic event, which `fireEvent.contextMenu` emits.
 * That gives us a stable open path that doesn't rely on PointerEvent quirks.
 */
import { ReactElement } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphContextMenu, buildCitation } from "./GraphContextMenu";
import type { GraphNode } from "../../types";

function personNode(): GraphNode {
    return {
        id: "p1",
        type: "person",
        label: "Karen Homan",
        metadata: { finding_count: 0, doc_count: 0 },
    };
}

function orgNode(): GraphNode {
    return {
        id: "o1",
        type: "organization",
        label: "Bright Future Foundation",
        metadata: { finding_count: 0, doc_count: 0, ein: "12-3456789" },
    };
}

interface HostProps {
    node: GraphNode;
    onSelectNode?: (n: GraphNode) => void;
    isPinned?: boolean;
    onTogglePin?: (n: GraphNode) => void;
    onMarkDeceased?: (n: GraphNode) => void;
    onRunTransform?: (n: GraphNode, t: "irs" | "sos" | "aos") => void;
}

function Host(props: HostProps): ReactElement {
    // We render the menu in a small host that always hands `open=false` so
    // the open-side-effect doesn't fire. We then pop it open via a real
    // contextmenu event on the virtual trigger, mirroring what the parent
    // component does at runtime.
    return (
        <GraphContextMenu
            open={false}
            onOpenChange={() => undefined}
            x={100}
            y={100}
            node={props.node}
            onSelectNode={props.onSelectNode ?? (() => undefined)}
            isPinned={props.isPinned ?? false}
            onTogglePin={props.onTogglePin ?? (() => undefined)}
            onMarkDeceased={props.onMarkDeceased}
            onRunTransform={props.onRunTransform}
        />
    );
}

function openMenu(): void {
    // The Trigger is rendered as a span with aria-hidden — find it via the
    // class hook, fall back to the only span on the page (test isolation).
    const trigger = document.querySelector("span[aria-hidden]") as HTMLElement | null;
    expect(trigger).not.toBeNull();
    act(() => {
        fireEvent.contextMenu(trigger!, { clientX: 100, clientY: 100 });
    });
}

describe("GraphContextMenu", () => {
    let writeTextMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        writeTextMock = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText: writeTextMock },
        });
    });

    afterEach(() => {
        // Clipboard mock cleanup — set it back to undefined so each test
        // starts from a clean slate.
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: undefined,
        });
    });

    it("renders person-appropriate items (Mark as deceased, no Pull 990 filings)", () => {
        render(<Host node={personNode()} onMarkDeceased={vi.fn()} onRunTransform={vi.fn()} />);
        openMenu();

        // Always present
        expect(screen.getByText("Open in detail")).toBeInTheDocument();
        expect(screen.getByText("Copy citation")).toBeInTheDocument();
        expect(screen.getByText("Pin")).toBeInTheDocument();
        // Person-only
        expect(screen.getByText("Mark as deceased")).toBeInTheDocument();
        // Run transform header is present
        expect(screen.getByText("Run transform")).toBeInTheDocument();
        // The submenu is collapsed; "Pull 990 filings" should NOT be visible until
        // the submenu opens. Either way it's gated off persons — for a closed
        // submenu we just verify it isn't rendered.
        expect(screen.queryByText("Pull 990 filings")).not.toBeInTheDocument();
    });

    it("renders organization-appropriate items (no Mark as deceased)", () => {
        render(<Host node={orgNode()} onRunTransform={vi.fn()} />);
        openMenu();

        expect(screen.getByText("Open in detail")).toBeInTheDocument();
        expect(screen.getByText("Copy citation")).toBeInTheDocument();
        expect(screen.getByText("Pin")).toBeInTheDocument();
        expect(screen.queryByText("Mark as deceased")).not.toBeInTheDocument();
        expect(screen.getByText("Run transform")).toBeInTheDocument();
    });

    it("Open in detail fires onSelectNode with the original node", () => {
        const onSelectNode = vi.fn();
        const node = personNode();
        render(<Host node={node} onSelectNode={onSelectNode} />);
        openMenu();

        act(() => {
            fireEvent.click(screen.getByText("Open in detail"));
        });

        expect(onSelectNode).toHaveBeenCalledTimes(1);
        expect(onSelectNode.mock.calls[0][0]).toBe(node);
    });

    it("Copy citation calls navigator.clipboard.writeText with the citation string", () => {
        const node = personNode();
        render(<Host node={node} />);
        openMenu();

        act(() => {
            fireEvent.click(screen.getByText("Copy citation"));
        });

        expect(writeTextMock).toHaveBeenCalledTimes(1);
        const arg = writeTextMock.mock.calls[0][0];
        expect(arg).toBe(buildCitation(node));
        expect(arg).toContain("Karen Homan");
        expect(arg).toContain("p1");
    });

    it("Pin label flips to Unpin when isPinned=true and toggle fires the callback", () => {
        const onTogglePin = vi.fn();
        const node = orgNode();
        render(<Host node={node} isPinned onTogglePin={onTogglePin} />);
        openMenu();

        const unpin = screen.getByText("Unpin");
        expect(unpin).toBeInTheDocument();
        expect(screen.queryByText("Pin")).not.toBeInTheDocument();

        act(() => {
            fireEvent.click(unpin);
        });

        expect(onTogglePin).toHaveBeenCalledTimes(1);
        expect(onTogglePin.mock.calls[0][0]).toBe(node);
    });
});
