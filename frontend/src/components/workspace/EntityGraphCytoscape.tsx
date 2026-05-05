/**
 * EntityGraphCytoscape — Cytoscape.js-powered entity-relationship graph.
 *
 * Replaces the legacy D3 force-directed graph (frontend/src/components/graph/
 * EntityGraph.tsx). Same data contract — `GraphNode[]` + `GraphEdge[]` — so
 * existing call sites (OverviewTab, CaseWorkspace center canvas) drop in.
 *
 * Per spec §8 (docs/architecture/frontend-design-spec.md):
 *   • cose-bilkent default layout
 *   • Per-entity-type node shapes + colors (§8.1)
 *   • Edge weight encodes evidence strength (§8.2 — 1px dashed → 2.5px solid)
 *   • Node "flagged" class drives a colored ring when finding_count > 0 (§8.3)
 *   • Floating layout/lock toolbar (§8.4 — bottom-left, this file)
 *
 * Deferred to later steps:
 *   • Pan/Select/Link mode selector (§8.5 → step 14)
 *   • Per-edge `[Doc-N]` chips (waiting on backend serialization update)
 *   • Top-right severity-tinted flag-count badge (waiting on per-severity counts)
 *   • Keyboard shortcuts V / S / L (§15 → step 18)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape from "cytoscape";
// @ts-expect-error — cose-bilkent has no first-party types
import coseBilkent from "cytoscape-cose-bilkent";
// @ts-expect-error — react-cytoscapejs default export has loose types in v2
import CytoscapeComponent from "react-cytoscapejs";
import {
    ChevronDownIcon,
    LockIcon,
    LockOpenIcon,
    MinusIcon,
    PlusIcon,
} from "lucide-react";
import type { GraphEdge, GraphNode } from "../../types";
import { toCytoscapeElements } from "./graphElements";
import { Tooltip } from "../ui/Tooltip";
import { DropdownMenu } from "../ui/DropdownMenu";
import { GraphContextMenu, type TransformKey } from "./GraphContextMenu";
import styles from "./EntityGraphCytoscape.module.css";

// Register cose-bilkent layout once at module load.
let registered = false;
if (!registered) {
    cytoscape.use(coseBilkent);
    registered = true;
}

interface Props {
    nodes: GraphNode[];
    edges: GraphEdge[];
    onNodeClick?: (node: GraphNode) => void;
    selectedNodeId?: string | null;
    /**
     * Optional context-menu hooks (spec §15). When omitted the right-click
     * menu still renders with stub callbacks — Mark deceased and transforms
     * just no-op.
     */
    onMarkDeceased?: (node: GraphNode) => void;
    onRunTransform?: (node: GraphNode, transform: TransformKey) => void;
}

interface ContextMenuState {
    open: boolean;
    x: number;
    y: number;
    node: GraphNode | null;
}

// ── Toolbar option types (§8.4) ──────────────────────────────

type LayoutKey = "organic" | "hierarchical" | "block" | "circular";
type ViewMode = "normal" | "flag" | "provenance" | "documents";

interface LayoutOption {
    key: LayoutKey;
    label: string;
}

const LAYOUT_OPTIONS: LayoutOption[] = [
    { key: "organic", label: "Organic" },
    { key: "hierarchical", label: "Hierarchical" },
    { key: "block", label: "Block" },
    { key: "circular", label: "Circular" },
];

interface ViewOption {
    key: ViewMode;
    label: string;
}

const VIEW_OPTIONS: ViewOption[] = [
    { key: "normal", label: "Normal" },
    { key: "flag", label: "Flag intensity" },
    { key: "provenance", label: "Provenance strength" },
    { key: "documents", label: "Document count" },
];

interface ShowToggles {
    sourceDocuments: boolean;
    flagBadges: boolean;
    findingBadges: boolean;
    pinnedOnly: boolean;
}

const DEFAULT_SHOW: ShowToggles = {
    sourceDocuments: false,
    flagBadges: true,
    findingBadges: true,
    pinnedOnly: false,
};

const SHOW_OPTIONS: { key: keyof ShowToggles; label: string }[] = [
    { key: "sourceDocuments", label: "Source documents" },
    { key: "flagBadges", label: "Flag badges" },
    { key: "findingBadges", label: "Finding badges" },
    { key: "pinnedOnly", label: "Pinned-only" },
];

/**
 * Read CSS custom properties from `:root` and return them as plain strings.
 * Cytoscape's canvas stylesheet can't consume `var(...)` — we resolve once at
 * mount and refresh whenever the active theme attribute on <html> changes.
 */
function resolveThemeTokens(): Record<string, string> {
    const cs = getComputedStyle(document.documentElement);
    return {
        bg: cs.getPropertyValue("--graph-bg").trim() || "#0e1318",
        person: cs.getPropertyValue("--graph-node-person").trim() || "#4589ff",
        org: cs.getPropertyValue("--graph-node-org").trim() || "#22c55e",
        property: cs.getPropertyValue("--graph-node-property").trim() || "#f59e0b",
        financial: cs.getPropertyValue("--graph-node-financial").trim() || "#a78bfa",
        edgeDefault: cs.getPropertyValue("--graph-edge-default").trim() || "rgba(145,163,182,0.3)",
        edgeHighlight: cs.getPropertyValue("--graph-edge-highlight").trim() || "#4589ff",
        label: cs.getPropertyValue("--graph-label").trim() || "#97a8ba",
        textMain: cs.getPropertyValue("--text-main").trim() || "#dce4ec",
        danger: cs.getPropertyValue("--danger").trim() || "#ef4444",
    };
}

type StyleRule = cytoscape.StylesheetStyle | cytoscape.StylesheetCSS;

function buildStylesheet(t: Record<string, string>, viewMode: ViewMode = "normal"): StyleRule[] {
    // When a non-default view mode is active we drive size from data(sizeOverride),
    // populated on each node before the stylesheet reload. mapData maps the
    // 0-100 scaledSize into a 28-80px diameter.
    const useSizeOverride = viewMode !== "normal";
    const sizeWidth: cytoscape.Css.PropertyValue<cytoscape.NodeSingular, number | string> =
        useSizeOverride
            ? ("mapData(sizeOverride, 0, 100, 28, 80)" as unknown as string)
            : 36;
    const sizeHeight = sizeWidth;

    return [
        // ── Base node ──
        {
            selector: "node",
            style: {
                label: "data(label)",
                color: t.label,
                "font-size": 11,
                "font-family": "IBM Plex Sans",
                "text-wrap": "ellipsis",
                "text-max-width": "120px",
                "text-margin-y": 6,
                "text-valign": "bottom",
                "text-halign": "center",
                "text-events": "no",
                width: sizeWidth,
                height: sizeHeight,
                "border-width": 2,
                "border-color": "#000",
                "border-opacity": 0,
                "transition-property": "border-color, border-opacity, background-color",
                "transition-duration": 150,
            },
        },

        // ── Per-type node shape + color (§8.1) ──
        // When sizeOverride drives width, leave the shape rules size-agnostic.
        {
            selector: ".entity-person",
            style: {
                "background-color": t.person,
                shape: "ellipse",
            },
        },
        {
            selector: ".entity-organization",
            style: {
                "background-color": t.org,
                shape: "round-rectangle",
                ...(useSizeOverride ? {} : { width: 42, height: 38 }),
            },
        },
        {
            selector: ".entity-property",
            style: {
                "background-color": t.property,
                shape: "diamond",
                ...(useSizeOverride ? {} : { width: 40, height: 40 }),
            },
        },
        {
            selector: ".entity-financial_instrument",
            style: {
                "background-color": t.financial,
                shape: "hexagon",
                ...(useSizeOverride ? {} : { width: 38, height: 38 }),
            },
        },

        // ── Flagged ring (§8.3) — finding_count > 0 ──
        {
            selector: "node.flagged",
            style: {
                "border-color": t.danger,
                "border-opacity": 0.85,
                "border-width": 3,
            },
        },

        // ── Selection ring ──
        {
            selector: "node.selected",
            style: {
                "border-color": t.edgeHighlight,
                "border-opacity": 1,
                "border-width": 4,
                "z-index": 10,
            },
        },

        // ── Hover state ──
        {
            selector: "node:active",
            style: {
                "overlay-color": t.edgeHighlight,
                "overlay-opacity": 0.16,
                "overlay-padding": 6,
            },
        },

        // ── Base edge ──
        {
            selector: "edge",
            style: {
                "line-color": t.edgeDefault,
                "target-arrow-color": t.edgeDefault,
                "target-arrow-shape": "triangle",
                "arrow-scale": 0.85,
                "curve-style": "bezier",
                label: "data(label)",
                "font-size": 9,
                color: t.label,
                "text-rotation": "autorotate",
                "text-margin-y": -8,
                "text-events": "no",
                "text-background-color": t.bg,
                "text-background-opacity": 0.7,
                "text-background-padding": "2px",
            },
        },

        // ── Evidence-weight strokes (§8.2) ──
        {
            selector: "edge.weight-speculative",
            style: { width: 1, "line-style": "dashed", opacity: 0.6 },
        },
        {
            selector: "edge.weight-directional",
            style: { width: 1.5, "line-style": "solid", opacity: 0.85 },
        },
        {
            selector: "edge.weight-documented",
            style: {
                width: 2,
                "line-style": "solid",
                "line-color": t.edgeHighlight,
                "target-arrow-color": t.edgeHighlight,
                opacity: 1,
            },
        },
        {
            selector: "edge.weight-traced",
            style: {
                width: 2.5,
                "line-style": "solid",
                "line-color": t.edgeHighlight,
                "target-arrow-color": t.edgeHighlight,
                opacity: 1,
            },
        },

        // ── Edge selection / highlight ──
        {
            selector: "edge.selected",
            style: {
                "line-color": t.edgeHighlight,
                "target-arrow-color": t.edgeHighlight,
                width: 3,
                "z-index": 8,
            },
        },
    ];
}

// ── Layout configs (§8.4) ────────────────────────────────────
//
// `cose-bilkent` is registered. The other three use Cytoscape built-ins so
// no new packages are needed (per spec §16.5 — locked dependency list).

const ORGANIC_LAYOUT = {
    name: "cose-bilkent",
    animate: false,
    randomize: false,
    nodeRepulsion: 6500,
    idealEdgeLength: 110,
    edgeElasticity: 0.45,
    gravity: 0.25,
    numIter: 2500,
    tile: true,
    fit: true,
    padding: 30,
};

function layoutOptionsFor(key: LayoutKey): cytoscape.LayoutOptions {
    switch (key) {
        case "organic":
            return ORGANIC_LAYOUT as unknown as cytoscape.LayoutOptions;
        case "hierarchical":
            // breadthfirst is a built-in; with directed: true it produces a
            // top-down tree-ish layout that's a reasonable substitute for
            // dagre. See report — not as clean as dagre on dense graphs.
            return {
                name: "breadthfirst",
                directed: true,
                padding: 30,
                spacingFactor: 1.25,
                fit: true,
                animate: false,
            } as cytoscape.LayoutOptions;
        case "block":
            // Grid layout sorted by entity type so each type forms a row.
            // sort comparator runs against Cytoscape NodeSingular — pull
            // nodeType from data.
            return {
                name: "grid",
                fit: true,
                padding: 30,
                avoidOverlap: true,
                animate: false,
                sort: (a: cytoscape.NodeSingular, b: cytoscape.NodeSingular) => {
                    const at = String(a.data("nodeType") || "");
                    const bt = String(b.data("nodeType") || "");
                    return at.localeCompare(bt);
                },
            } as unknown as cytoscape.LayoutOptions;
        case "circular":
            return {
                name: "circle",
                fit: true,
                padding: 30,
                animate: false,
            } as cytoscape.LayoutOptions;
    }
}

// ── Node-size encoding for view modes (§8.4) ─────────────────

function computeSizeOverride(node: cytoscape.NodeSingular, mode: ViewMode): number {
    if (mode === "normal") return 0;
    if (mode === "flag") {
        const count = Number(node.data("finding_count") || 0);
        // 0-5+ findings → 0-100 scale
        return Math.min(100, count * 20);
    }
    if (mode === "documents") {
        const count = Number(node.data("doc_count") || 0);
        // 0-10+ docs → 0-100 scale
        return Math.min(100, count * 10);
    }
    if (mode === "provenance") {
        // "evidence weight of attached edges" — sum edge.weight on
        // connected edges. Stable proxy until backend exposes per-edge
        // evidence_weight strings.
        let total = 0;
        node.connectedEdges().forEach((e) => {
            total += Number(e.data("weight") || 0);
        });
        // Roughly: weight 0-20+ → 0-100
        return Math.min(100, total * 5);
    }
    return 0;
}

function applyViewMode(cy: cytoscape.Core, mode: ViewMode) {
    cy.nodes().forEach((n) => {
        n.data("sizeOverride", computeSizeOverride(n, mode));
    });
}

export function EntityGraphCytoscape({
    nodes,
    edges,
    onNodeClick,
    selectedNodeId,
    onMarkDeceased,
    onRunTransform,
}: Props) {
    const cyRef = useRef<cytoscape.Core | null>(null);
    const hostRef = useRef<HTMLDivElement>(null);
    const elements = useMemo(() => toCytoscapeElements(nodes, edges), [nodes, edges]);

    // Toolbar state. Lock state is also mirrored on Cytoscape (`elements().lock()`)
    // so it survives data refetches; React state drives the visual button only.
    const [layoutKey, setLayoutKey] = useState<LayoutKey>("organic");
    const [viewMode, setViewMode] = useState<ViewMode>("normal");
    const [show, setShow] = useState<ShowToggles>(DEFAULT_SHOW);
    const [locked, setLocked] = useState(false);

    // Per-node pin state (spec §15). Independent from the global `locked`
    // toolbar state — pinning a single node holds it in place during a relayout
    // even when the rest of the graph is free.
    const [pinnedNodeIds, setPinnedNodeIds] = useState<Set<string>>(() => new Set());

    // Right-click context menu state (spec §15). The menu is mounted once at
    // the bottom of the host and driven by `cxttap` events from cytoscape.
    const [ctxMenu, setCtxMenu] = useState<ContextMenuState>({
        open: false,
        x: 0,
        y: 0,
        node: null,
    });

    const stylesheet = useMemo(
        () => buildStylesheet(resolveThemeTokens(), viewMode),
        [viewMode],
    );

    // Sync controlled selection ↔ Cytoscape's "selected" class.
    useEffect(() => {
        const cy = cyRef.current;
        if (!cy) return;
        cy.nodes().removeClass("selected");
        if (selectedNodeId) {
            cy.$id(selectedNodeId).addClass("selected");
        }
    }, [selectedNodeId]);

    // Cytoscape doesn't auto-resize when its container changes dimensions
    // (e.g. dragging a react-resizable-panels handle). A ResizeObserver
    // notifies cy.resize() → cy.fit() so the graph always fills the canvas.
    useEffect(() => {
        const host = hostRef.current;
        // Guard for jsdom/test environments where ResizeObserver is unavailable.
        if (!host || typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver(() => {
            const cy = cyRef.current;
            if (!cy) return;
            cy.resize();
            cy.fit(undefined, 50);
        });
        ro.observe(host);
        return () => ro.disconnect();
    }, []);

    // Re-resolve tokens when the active theme changes — keeps node colors
    // matched to whatever <html data-theme="..."> currently is.
    useEffect(() => {
        const cy = cyRef.current;
        if (!cy) return;
        const observer = new MutationObserver(() => {
            cy.style().fromJson(buildStylesheet(resolveThemeTokens(), viewMode)).update();
        });
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-theme"],
        });
        return () => observer.disconnect();
    }, [viewMode]);

    // Re-apply view-mode encoding + stylesheet whenever mode changes.
    useEffect(() => {
        const cy = cyRef.current;
        if (!cy) return;
        applyViewMode(cy, viewMode);
        cy.style().fromJson(buildStylesheet(resolveThemeTokens(), viewMode)).update();
    }, [viewMode]);

    // Lock / unlock Cytoscape elements when the lock state toggles.
    useEffect(() => {
        const cy = cyRef.current;
        if (!cy) return;
        if (locked) cy.elements().lock();
        else cy.elements().unlock();
    }, [locked]);

    // Re-run the chosen layout whenever the user picks a new one.
    // Non-destructive — the existing graph is relayed out, not rebuilt.
    useEffect(() => {
        const cy = cyRef.current;
        if (!cy) return;
        // If locked, skip — locked nodes don't reflow.
        if (locked) return;
        cy.layout(layoutOptionsFor(layoutKey)).run();
    }, [layoutKey, locked]);

    // ── Toolbar handlers ──
    function zoomIn() {
        const cy = cyRef.current;
        if (!cy) return;
        cy.zoom({
            level: cy.zoom() * 1.2,
            renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
        });
    }
    function zoomOut() {
        const cy = cyRef.current;
        if (!cy) return;
        cy.zoom({
            level: cy.zoom() / 1.2,
            renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
        });
    }

    // Wire node-tap → caller's onNodeClick. We translate Cytoscape's data
    // back into the original GraphNode shape so the call site doesn't have
    // to know about Cytoscape internals.
    function bindCy(cy: cytoscape.Core) {
        cyRef.current = cy;
        cy.removeAllListeners();
        cy.on("tap", "node", (evt) => {
            if (!onNodeClick) return;
            const data = evt.target.data() as { id: string; nodeType: string };
            const original = nodes.find((n) => n.id === data.id);
            if (original) onNodeClick(original);
        });

        // Right-click on a node → open the GraphContextMenu at the pointer.
        // `cxttap` fires for both right-click on desktop and 2-finger tap on
        // touch; cytoscape suppresses the native browser menu for us.
        cy.on("cxttap", "node", (evt) => {
            const data = evt.target.data() as { id: string };
            const original = nodes.find((n) => n.id === data.id);
            if (!original) return;
            const oe = evt.originalEvent as MouseEvent | undefined;
            const x = oe?.clientX ?? 0;
            const y = oe?.clientY ?? 0;
            setCtxMenu({ open: true, x, y, node: original });
        });

        // Re-apply lock/view state after a data refetch causes a fresh mount.
        applyViewMode(cy, viewMode);
        if (locked) cy.elements().lock();
        // Re-apply per-node pins too.
        pinnedNodeIds.forEach((id) => {
            const n = cy.$id(id);
            if (n.length) n.lock();
        });

        // After every layout finishes, fit the graph to the viewport so
        // nodes are always visible regardless of container size at layout time.
        cy.on("layoutstop", () => {
            cyRef.current?.fit(undefined, 40);
        });

        // On initial bind, run the layout after one animation frame so the
        // container has its final CSS dimensions (panels finish their first
        // render before we ask Cytoscape to fit). Without this, `cy.fit()`
        // in the layout uses a stale container size and nodes are mispositioned.
        requestAnimationFrame(() => {
            if (cyRef.current) {
                cyRef.current.resize();
                cyRef.current.layout(ORGANIC_LAYOUT).run();
            }
        });
    }

    // ── Context menu handlers ──
    function handleContextMenuSelect(node: GraphNode) {
        // Close the menu and route the click through the same path tap uses,
        // so the right-detail panel opens.
        setCtxMenu((s) => ({ ...s, open: false, node: null }));
        onNodeClick?.(node);
    }

    function handleTogglePin(node: GraphNode) {
        const cy = cyRef.current;
        const cyNode = cy?.$id(node.id);
        setPinnedNodeIds((prev) => {
            const next = new Set(prev);
            if (next.has(node.id)) {
                next.delete(node.id);
                if (cyNode && cyNode.length) cyNode.unlock();
            } else {
                next.add(node.id);
                if (cyNode && cyNode.length) cyNode.lock();
            }
            return next;
        });
    }

    const currentLayoutLabel =
        LAYOUT_OPTIONS.find((o) => o.key === layoutKey)?.label ?? "Organic";
    const currentViewLabel = VIEW_OPTIONS.find((o) => o.key === viewMode)?.label ?? "Normal";

    return (
        <div className={styles.host} ref={hostRef}>
            <CytoscapeComponent
                elements={elements as object[]}
                stylesheet={stylesheet}
                layout={ORGANIC_LAYOUT}
                style={{ width: "100%", height: "100%" }}
                cy={bindCy}
                minZoom={0.15}
                maxZoom={5}
                wheelSensitivity={0.3}
            />
            <Legend />
            <Toolbar
                layoutKey={layoutKey}
                onLayoutChange={setLayoutKey}
                viewMode={viewMode}
                onViewChange={setViewMode}
                show={show}
                onShowChange={setShow}
                locked={locked}
                onLockToggle={() => setLocked((v) => !v)}
                onZoomIn={zoomIn}
                onZoomOut={zoomOut}
                currentLayoutLabel={currentLayoutLabel}
                currentViewLabel={currentViewLabel}
            />
            <GraphContextMenu
                open={ctxMenu.open}
                onOpenChange={(open) => setCtxMenu((s) => ({ ...s, open }))}
                x={ctxMenu.x}
                y={ctxMenu.y}
                node={ctxMenu.node}
                isPinned={ctxMenu.node ? pinnedNodeIds.has(ctxMenu.node.id) : false}
                onSelectNode={handleContextMenuSelect}
                onTogglePin={handleTogglePin}
                onMarkDeceased={onMarkDeceased}
                onRunTransform={onRunTransform}
            />
        </div>
    );
}

// ── Floating toolbar (§8.4) ──────────────────────────────────

interface ToolbarProps {
    layoutKey: LayoutKey;
    onLayoutChange: (k: LayoutKey) => void;
    viewMode: ViewMode;
    onViewChange: (m: ViewMode) => void;
    show: ShowToggles;
    onShowChange: (s: ShowToggles) => void;
    locked: boolean;
    onLockToggle: () => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    currentLayoutLabel: string;
    currentViewLabel: string;
}

function Toolbar({
    layoutKey,
    onLayoutChange,
    viewMode,
    onViewChange,
    show,
    onShowChange,
    locked,
    onLockToggle,
    onZoomIn,
    onZoomOut,
    currentLayoutLabel,
    currentViewLabel,
}: ToolbarProps) {
    return (
        <div
            className={styles.toolbar}
            role="toolbar"
            aria-label="Graph controls"
            data-testid="graph-toolbar"
        >
            <div className={styles.zoomGroup}>
                <Tooltip content="Zoom in">
                    <button
                        type="button"
                        className={styles.iconButton}
                        onClick={onZoomIn}
                        aria-label="Zoom in"
                    >
                        <PlusIcon size={14} />
                    </button>
                </Tooltip>
                <Tooltip content="Zoom out">
                    <button
                        type="button"
                        className={styles.iconButton}
                        onClick={onZoomOut}
                        aria-label="Zoom out"
                    >
                        <MinusIcon size={14} />
                    </button>
                </Tooltip>
            </div>

            <DropdownMenu.Root>
                <Tooltip content="Layout">
                    <DropdownMenu.Trigger asChild>
                        <button
                            type="button"
                            className={styles.menuButton}
                            aria-label="Layout"
                            data-testid="layout-trigger"
                        >
                            <span className={styles.menuButtonLabel}>{currentLayoutLabel}</span>
                            <ChevronDownIcon size={12} />
                        </button>
                    </DropdownMenu.Trigger>
                </Tooltip>
                <DropdownMenu.Content side="top" align="start">
                    <DropdownMenu.RadioGroup
                        value={layoutKey}
                        onValueChange={(v) => onLayoutChange(v as LayoutKey)}
                    >
                        {LAYOUT_OPTIONS.map((opt) => (
                            <DropdownMenu.RadioItem key={opt.key} value={opt.key}>
                                {opt.label}
                            </DropdownMenu.RadioItem>
                        ))}
                    </DropdownMenu.RadioGroup>
                </DropdownMenu.Content>
            </DropdownMenu.Root>

            <DropdownMenu.Root>
                <Tooltip content="View — node-size encoding">
                    <DropdownMenu.Trigger asChild>
                        <button
                            type="button"
                            className={styles.menuButton}
                            aria-label="View"
                            data-testid="view-trigger"
                        >
                            <span className={styles.menuButtonLabel}>{currentViewLabel}</span>
                            <ChevronDownIcon size={12} />
                        </button>
                    </DropdownMenu.Trigger>
                </Tooltip>
                <DropdownMenu.Content side="top" align="start">
                    <DropdownMenu.RadioGroup
                        value={viewMode}
                        onValueChange={(v) => onViewChange(v as ViewMode)}
                    >
                        {VIEW_OPTIONS.map((opt) => (
                            <DropdownMenu.RadioItem key={opt.key} value={opt.key}>
                                {opt.label}
                            </DropdownMenu.RadioItem>
                        ))}
                    </DropdownMenu.RadioGroup>
                </DropdownMenu.Content>
            </DropdownMenu.Root>

            <DropdownMenu.Root>
                <Tooltip content="Show / hide elements">
                    <DropdownMenu.Trigger asChild>
                        <button
                            type="button"
                            className={styles.menuButton}
                            aria-label="Show"
                            data-testid="show-trigger"
                        >
                            <span className={styles.menuButtonLabel}>Show</span>
                            <ChevronDownIcon size={12} />
                        </button>
                    </DropdownMenu.Trigger>
                </Tooltip>
                <DropdownMenu.Content side="top" align="start">
                    {SHOW_OPTIONS.map((opt) => (
                        <DropdownMenu.CheckboxItem
                            key={opt.key}
                            checked={show[opt.key]}
                            onCheckedChange={(checked) =>
                                onShowChange({ ...show, [opt.key]: !!checked })
                            }
                            // Radix closes on select by default; for a multi-toggle
                            // menu we want to keep it open while the user toggles
                            // several boxes.
                            onSelect={(e) => e.preventDefault()}
                        >
                            {opt.label}
                        </DropdownMenu.CheckboxItem>
                    ))}
                </DropdownMenu.Content>
            </DropdownMenu.Root>

            <Tooltip content={locked ? "Unlock layout" : "Lock layout"}>
                <button
                    type="button"
                    className={`${styles.iconButton} ${locked ? styles.locked : ""}`}
                    onClick={onLockToggle}
                    aria-label={locked ? "Unlock layout" : "Lock layout"}
                    aria-pressed={locked ? "true" : "false"}
                    data-testid="lock-toggle"
                    data-locked={locked ? "true" : "false"}
                >
                    {locked ? <LockIcon size={14} /> : <LockOpenIcon size={14} />}
                </button>
            </Tooltip>
        </div>
    );
}

function Legend() {
    return (
        <div className={styles.legend} aria-label="Graph legend">
            <LegendItem cls={styles.legendPerson} label="Person" />
            <LegendItem cls={styles.legendOrg} label="Org" />
            <LegendItem cls={styles.legendProperty} label="Property" />
            <LegendItem cls={styles.legendFinancial} label="Financial" />
        </div>
    );
}

function LegendItem({ cls, label }: { cls: string; label: string }) {
    return (
        <span className={styles.legendItem}>
            <span className={`${styles.legendDot} ${cls}`} aria-hidden />
            {label}
        </span>
    );
}
