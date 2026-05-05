/**
 * GraphContextMenu — right-click menu on graph nodes (spec §15).
 *
 * Per spec the menu surfaces:
 *   • Open in detail            (focus + open right detail panel)
 *   • Copy citation             (clipboard write)
 *   • Pin / Unpin               (toggles cytoscape lock() on the single node)
 *   • Mark as deceased          (persons only — stub callback for now)
 *   • Run transform > submenu   (IRS / SOS / AOS, gated by entity type)
 *
 * Edge and flag-row context menus are deferred to a later batch.
 *
 * Wiring model:
 *   • EntityGraphCytoscape owns the {open, x, y, node} state and listens to
 *     cytoscape `cxttap` events.
 *   • This component is *controlled*: it only renders a positioned virtual
 *     trigger and the Radix ContextMenu.Content. When `open` flips true we
 *     dispatch a synthetic `contextmenu` event at the trigger to make the
 *     project's ContextMenu wrapper open at the requested coordinates.
 *
 * The menu items shell out to caller-provided callbacks so the parent
 * (graph component) keeps ownership of cytoscape mutations and side-effects.
 */
import { useEffect, useRef } from "react";
import {
    CopyIcon,
    FileTextIcon,
    PinIcon,
    PinOffIcon,
    SkullIcon,
    WrenchIcon,
} from "lucide-react";
import { ContextMenu } from "../ui/ContextMenu";
import type { GraphNode } from "../../types";
import styles from "./GraphContextMenu.module.css";

export interface GraphContextMenuProps {
    /** Whether the menu is currently open. */
    open: boolean;
    /** Called by Radix when the menu opens or closes (e.g. ESC, outside-click). */
    onOpenChange: (open: boolean) => void;
    /** Viewport pixel coordinates of the right-click anchor. */
    x: number;
    y: number;
    /** The cytoscape node the user right-clicked, or null when the menu is closed. */
    node: GraphNode | null;
    /** Open the right-detail panel for `node`. */
    onSelectNode: (node: GraphNode) => void;
    /** True when this node is currently locked (pinned) in cytoscape. */
    isPinned: boolean;
    /** Lock / unlock the node in cytoscape. */
    onTogglePin: (node: GraphNode) => void;
    /** Persons only: backend wiring is deferred — for now, just a stub callback. */
    onMarkDeceased?: (node: GraphNode) => void;
    /** Run an external transform on this entity. */
    onRunTransform?: (node: GraphNode, transform: TransformKey) => void;
}

export type TransformKey = "irs" | "sos" | "aos";

/**
 * Build a "[Entity name (type, id)]" citation string. Cheap and stable —
 * the real referral-package citations live in the PDF exporter; this is
 * just an investigator copy/paste helper.
 */
export function buildCitation(node: GraphNode): string {
    const type = node.type.replace(/_/g, " ");
    return `[${node.label} — ${type} · ${node.id}]`;
}

export function GraphContextMenu({
    open,
    onOpenChange,
    x,
    y,
    node,
    onSelectNode,
    isPinned,
    onTogglePin,
    onMarkDeceased,
    onRunTransform,
}: GraphContextMenuProps) {
    const triggerRef = useRef<HTMLSpanElement | null>(null);

    // When the parent flips `open` to true, dispatch a contextmenu event on
    // the virtual trigger so Radix opens the menu at our (x, y) anchor.
    useEffect(() => {
        if (!open) return;
        const el = triggerRef.current;
        if (!el) return;
        const evt = new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            button: 2,
        });
        el.dispatchEvent(evt);
    }, [open, x, y]);

    if (!node) {
        // No node = nothing to anchor to. Render nothing — the menu is closed.
        return null;
    }

    async function handleCopyCitation() {
        if (!node) return;
        const citation = buildCitation(node);
        try {
            await navigator.clipboard.writeText(citation);
        } catch {
            // Clipboard can fail in non-secure contexts. Failing silently is
            // fine — the user will notice the missing toast and retry. We
            // intentionally don't pop a toast here so the menu stays
            // dependency-light.
        }
    }

    const isPerson = node.type === "person";
    const isOrg = node.type === "organization";

    return (
        <ContextMenu.Root onOpenChange={onOpenChange}>
            <ContextMenu.Trigger asChild>
                <span
                    ref={triggerRef}
                    className={styles.virtualTrigger}
                    style={{ left: x, top: y }}
                    aria-hidden
                />
            </ContextMenu.Trigger>
            <ContextMenu.Content>
                <ContextMenu.Label>{node.label}</ContextMenu.Label>
                <ContextMenu.Item onSelect={() => onSelectNode(node)}>
                    <FileTextIcon size={14} />
                    Open in detail
                </ContextMenu.Item>
                <ContextMenu.Item onSelect={handleCopyCitation}>
                    <CopyIcon size={14} />
                    Copy citation
                </ContextMenu.Item>
                <ContextMenu.Item onSelect={() => onTogglePin(node)}>
                    {isPinned ? <PinOffIcon size={14} /> : <PinIcon size={14} />}
                    {isPinned ? "Unpin" : "Pin"}
                </ContextMenu.Item>
                {isPerson && (
                    <ContextMenu.Item
                        onSelect={() => onMarkDeceased?.(node)}
                        disabled={!onMarkDeceased}
                    >
                        <SkullIcon size={14} />
                        Mark as deceased
                    </ContextMenu.Item>
                )}
                <ContextMenu.Separator />
                <ContextMenu.Sub>
                    <ContextMenu.SubTrigger>
                        <WrenchIcon size={14} />
                        Run transform
                    </ContextMenu.SubTrigger>
                    <ContextMenu.SubContent>
                        {isOrg && (
                            <ContextMenu.Item
                                onSelect={() => onRunTransform?.(node, "irs")}
                                disabled={!onRunTransform}
                            >
                                Pull 990 filings
                            </ContextMenu.Item>
                        )}
                        <ContextMenu.Item
                            onSelect={() => onRunTransform?.(node, "sos")}
                            disabled={!onRunTransform}
                        >
                            Look up in Ohio SOS
                        </ContextMenu.Item>
                        {isOrg && (
                            <ContextMenu.Item
                                onSelect={() => onRunTransform?.(node, "aos")}
                                disabled={!onRunTransform}
                            >
                                Search Ohio AOS audits
                            </ContextMenu.Item>
                        )}
                    </ContextMenu.SubContent>
                </ContextMenu.Sub>
            </ContextMenu.Content>
        </ContextMenu.Root>
    );
}
