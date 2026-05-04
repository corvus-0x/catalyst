/**
 * CaseWorkspace — five-zone case workspace per docs/architecture/frontend-design-spec.md
 *
 * Zones:
 *   1. Top bar         — case identity, view toggles, find/layout/overflow (§6)
 *   2. Left rail       — Phase navigator · Entity palette · Recently added (§7)
 *   3. Center canvas   — Graph (default), 990 Viewer / Financials / Package as side panes (§8)
 *   4. Right detail    — Properties / Sources / Flags / Actions (§9)
 *   5. Bottom dock     — Audit log · Triage · Transforms · Documents · Selection (§10)
 *
 * v1 (this commit): layout shell only. All zones are placeholders. Resize/collapse
 * mechanics work via react-resizable-panels. Tested against §5.1 baseline (1366×768).
 */
import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
    ImperativePanelHandle,
    Panel,
    PanelGroup,
    PanelResizeHandle,
} from "react-resizable-panels";
import {
    ChevronLeftIcon,
    ChevronRightIcon,
    ChevronDownIcon,
    ChevronUpIcon,
    SearchIcon,
    LayoutPanelLeftIcon,
    MoreVerticalIcon,
} from "lucide-react";
import styles from "./CaseWorkspace.module.css";

type ViewToggle = "graph" | "990" | "financials" | "package";

export function CaseWorkspace() {
    const { caseId } = useParams<{ caseId: string }>();
    const [activeViews, setActiveViews] = useState<Set<ViewToggle>>(new Set(["graph"]));

    const leftRailRef = useRef<ImperativePanelHandle>(null);
    const rightPanelRef = useRef<ImperativePanelHandle>(null);
    const bottomDockRef = useRef<ImperativePanelHandle>(null);

    const [leftCollapsed, setLeftCollapsed] = useState(false);
    const [rightCollapsed, setRightCollapsed] = useState(false);
    const [bottomCollapsed, setBottomCollapsed] = useState(false);

    function toggleView(v: ViewToggle) {
        if (v === "graph") return; // Graph cannot be closed (§6)
        setActiveViews((prev) => {
            const next = new Set(prev);
            if (next.has(v)) next.delete(v);
            else next.add(v);
            return next;
        });
    }

    function toggleLeftRail() {
        const panel = leftRailRef.current;
        if (!panel) return;
        if (leftCollapsed) panel.expand();
        else panel.collapse();
    }
    function toggleRightPanel() {
        const panel = rightPanelRef.current;
        if (!panel) return;
        if (rightCollapsed) panel.expand();
        else panel.collapse();
    }
    function toggleBottomDock() {
        const panel = bottomDockRef.current;
        if (!panel) return;
        if (bottomCollapsed) panel.expand();
        else panel.collapse();
    }

    return (
        <div className={styles.workspace}>
            <CaseTopBar
                caseId={caseId}
                activeViews={activeViews}
                onToggleView={toggleView}
            />

            <PanelGroup direction="horizontal" className={styles.horizontalGroup}>
                {/* Zone 2 — Left rail */}
                <Panel
                    ref={leftRailRef}
                    defaultSize={16}
                    minSize={12}
                    collapsible
                    collapsedSize={3.5}
                    onCollapse={() => setLeftCollapsed(true)}
                    onExpand={() => setLeftCollapsed(false)}
                    className={`${styles.panel} ${styles.leftRail} ${
                        leftCollapsed ? styles.panelCollapsed : ""
                    }`}
                >
                    {leftCollapsed ? (
                        <CollapsedRailStub
                            side="left"
                            onClick={toggleLeftRail}
                            label="Expand left rail"
                        />
                    ) : (
                        <CaseLeftRail onCollapse={toggleLeftRail} />
                    )}
                </Panel>

                <PanelResizeHandle className={styles.handleVertical} />

                {/* Zones 3 + 5 — Center column (canvas + bottom dock) */}
                <Panel defaultSize={64} minSize={40}>
                    <PanelGroup direction="vertical" className={styles.verticalGroup}>
                        {/* Zone 3 — Center canvas */}
                        <Panel defaultSize={72} minSize={30}>
                            <CaseCenterCanvas activeViews={activeViews} />
                        </Panel>

                        <PanelResizeHandle className={styles.handleHorizontal} />

                        {/* Zone 5 — Bottom dock */}
                        <Panel
                            ref={bottomDockRef}
                            defaultSize={28}
                            minSize={12}
                            collapsible
                            collapsedSize={4}
                            onCollapse={() => setBottomCollapsed(true)}
                            onExpand={() => setBottomCollapsed(false)}
                            className={`${styles.panel} ${styles.bottomDock} ${
                                bottomCollapsed ? styles.panelCollapsed : ""
                            }`}
                        >
                            {bottomCollapsed ? (
                                <CollapsedDockStub onClick={toggleBottomDock} />
                            ) : (
                                <CaseBottomDock onCollapse={toggleBottomDock} />
                            )}
                        </Panel>
                    </PanelGroup>
                </Panel>

                <PanelResizeHandle className={styles.handleVertical} />

                {/* Zone 4 — Right detail panel */}
                <Panel
                    ref={rightPanelRef}
                    defaultSize={20}
                    minSize={15}
                    collapsible
                    collapsedSize={2.5}
                    onCollapse={() => setRightCollapsed(true)}
                    onExpand={() => setRightCollapsed(false)}
                    className={`${styles.panel} ${styles.rightPanel} ${
                        rightCollapsed ? styles.panelCollapsed : ""
                    }`}
                >
                    {rightCollapsed ? (
                        <CollapsedRailStub
                            side="right"
                            onClick={toggleRightPanel}
                            label="Expand detail panel"
                        />
                    ) : (
                        <CaseRightPanel onCollapse={toggleRightPanel} />
                    )}
                </Panel>
            </PanelGroup>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Zone 1 — Top bar                                                    */
/* ------------------------------------------------------------------ */
function CaseTopBar({
    caseId,
    activeViews,
    onToggleView,
}: {
    caseId?: string;
    activeViews: Set<ViewToggle>;
    onToggleView: (v: ViewToggle) => void;
}) {
    const viewToggles: { id: ViewToggle; label: string; locked?: boolean }[] = [
        { id: "graph", label: "Graph", locked: true },
        { id: "990", label: "990 Viewer" },
        { id: "financials", label: "Financials" },
        { id: "package", label: "Package" },
    ];

    return (
        <div className={styles.topBar}>
            <div className={styles.topBarLeft}>
                <span className={styles.caseLabel}>
                    Case <span className={styles.caseLabelMuted}>· {caseId ?? "loading…"}</span>
                </span>
            </div>

            <div className={styles.topBarCenter} role="group" aria-label="View panes">
                {viewToggles.map((v) => {
                    const isActive = activeViews.has(v.id);
                    return (
                        <button
                            key={v.id}
                            type="button"
                            className={`${styles.viewToggle} ${
                                isActive ? styles.viewToggleActive : ""
                            }`}
                            onClick={() => onToggleView(v.id)}
                            aria-pressed={isActive}
                            disabled={v.locked && isActive}
                            title={v.locked ? "Graph is the home pane and cannot be closed" : undefined}
                        >
                            {v.label}
                        </button>
                    );
                })}
            </div>

            <div className={styles.topBarRight}>
                <button className={styles.iconButton} aria-label="Find within case" title="Find within case (⌘K)">
                    <SearchIcon size={15} strokeWidth={1.6} />
                </button>
                <button className={styles.iconButton} aria-label="Layout presets" title="Layout presets">
                    <LayoutPanelLeftIcon size={15} strokeWidth={1.6} />
                </button>
                <button className={styles.iconButton} aria-label="More" title="More options">
                    <MoreVerticalIcon size={15} strokeWidth={1.6} />
                </button>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Zone 2 — Left rail (placeholder)                                    */
/* ------------------------------------------------------------------ */
function CaseLeftRail({ onCollapse }: { onCollapse: () => void }) {
    return (
        <div className={styles.zoneInner}>
            <div className={styles.zoneHeader}>
                <span>Phases</span>
                <button
                    className={styles.collapseButton}
                    onClick={onCollapse}
                    aria-label="Collapse left rail"
                    title="Collapse"
                >
                    <ChevronLeftIcon size={14} strokeWidth={1.8} />
                </button>
            </div>

            <div className={styles.zoneSection}>
                <div className={styles.placeholder}>
                    <div className={styles.placeholderTitle}>Phase navigator</div>
                    <div className={styles.placeholderRef}>§7.1</div>
                </div>
            </div>

            <div className={styles.zoneSectionHeader}>Entity palette</div>
            <div className={styles.zoneSection}>
                <div className={styles.placeholder}>
                    <div className={styles.placeholderTitle}>Drag-to-create</div>
                    <div className={styles.placeholderRef}>§7.2</div>
                </div>
            </div>

            <div className={styles.zoneSectionHeader}>Recently added</div>
            <div className={styles.zoneSection}>
                <div className={styles.placeholder}>
                    <div className={styles.placeholderTitle}>Last 5 items</div>
                    <div className={styles.placeholderRef}>§7.3</div>
                </div>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Zone 3 — Center canvas (placeholder)                                */
/* ------------------------------------------------------------------ */
function CaseCenterCanvas({ activeViews }: { activeViews: Set<ViewToggle> }) {
    const panes: { id: ViewToggle; title: string; ref: string }[] = [];
    if (activeViews.has("graph")) panes.push({ id: "graph", title: "Graph canvas", ref: "§8 — Cytoscape.js" });
    if (activeViews.has("990")) panes.push({ id: "990", title: "990 Viewer", ref: "§11" });
    if (activeViews.has("financials")) panes.push({ id: "financials", title: "Financials", ref: "§12" });
    if (activeViews.has("package")) panes.push({ id: "package", title: "Package", ref: "§13" });

    if (panes.length === 1) {
        return (
            <div className={styles.canvas}>
                <CanvasPlaceholder title={panes[0].title} ref_={panes[0].ref} />
            </div>
        );
    }

    return (
        <PanelGroup direction="horizontal">
            {panes.map((p, idx) => (
                <>
                    <Panel key={p.id} defaultSize={100 / panes.length} minSize={20}>
                        <div className={styles.canvas}>
                            <CanvasPlaceholder title={p.title} ref_={p.ref} />
                        </div>
                    </Panel>
                    {idx < panes.length - 1 && <PanelResizeHandle key={`h-${p.id}`} className={styles.handleVertical} />}
                </>
            ))}
        </PanelGroup>
    );
}

function CanvasPlaceholder({ title, ref_ }: { title: string; ref_: string }) {
    return (
        <div className={styles.canvasPlaceholder}>
            <div className={styles.canvasTitle}>{title}</div>
            <div className={styles.canvasSubtitle}>{ref_}</div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Zone 4 — Right detail (placeholder)                                 */
/* ------------------------------------------------------------------ */
function CaseRightPanel({ onCollapse }: { onCollapse: () => void }) {
    return (
        <div className={styles.zoneInner}>
            <div className={styles.zoneHeader}>
                <button
                    className={styles.collapseButton}
                    onClick={onCollapse}
                    aria-label="Collapse detail panel"
                    title="Collapse"
                >
                    <ChevronRightIcon size={14} strokeWidth={1.8} />
                </button>
                <span>Detail</span>
            </div>

            <div className={styles.zoneSection}>
                <div className={styles.placeholder}>
                    <div className={styles.placeholderTitle}>Case subject</div>
                    <div className={styles.placeholderRef}>Default state · §9</div>
                </div>
            </div>

            <div className={styles.detailTabs}>
                <button className={`${styles.detailTab} ${styles.detailTabActive}`}>Properties</button>
                <button className={styles.detailTab}>Sources</button>
                <button className={styles.detailTab}>Flags</button>
                <button className={styles.detailTab}>Actions</button>
            </div>

            <div className={styles.zoneSection}>
                <div className={styles.placeholder}>
                    <div className={styles.placeholderTitle}>Tab content</div>
                    <div className={styles.placeholderRef}>§9 tabs</div>
                </div>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Zone 5 — Bottom dock (placeholder)                                  */
/* ------------------------------------------------------------------ */
function CaseBottomDock({ onCollapse }: { onCollapse: () => void }) {
    const tabs = [
        { id: "audit", label: "Audit log", count: 0, active: true },
        { id: "triage", label: "Triage", count: 0, active: false },
        { id: "transforms", label: "Transforms", count: 0, active: false },
        { id: "documents", label: "Documents", count: 0, active: false },
    ];

    return (
        <div className={styles.dockInner}>
            <div className={styles.dockTabBar}>
                <div className={styles.dockTabs} role="tablist">
                    {tabs.map((t) => (
                        <button
                            key={t.id}
                            role="tab"
                            aria-selected={t.active}
                            className={`${styles.dockTab} ${t.active ? styles.dockTabActive : ""}`}
                        >
                            <span>{t.label}</span>
                            <span className={styles.dockTabCount}>{t.count}</span>
                        </button>
                    ))}
                </div>
                <button
                    className={styles.collapseButton}
                    onClick={onCollapse}
                    aria-label="Collapse bottom dock"
                    title="Collapse"
                >
                    <ChevronDownIcon size={14} strokeWidth={1.8} />
                </button>
            </div>

            <div className={styles.dockContent}>
                <div className={styles.placeholder}>
                    <div className={styles.placeholderTitle}>Audit log</div>
                    <div className={styles.placeholderRef}>§10.1 — chain of custody, default tab</div>
                </div>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Collapsed-state stubs                                               */
/* ------------------------------------------------------------------ */
function CollapsedRailStub({
    side,
    onClick,
    label,
}: {
    side: "left" | "right";
    onClick: () => void;
    label: string;
}) {
    return (
        <button
            className={styles.collapsedRailStub}
            onClick={onClick}
            aria-label={label}
            title={label}
        >
            {side === "left" ? (
                <ChevronRightIcon size={14} strokeWidth={1.8} />
            ) : (
                <ChevronLeftIcon size={14} strokeWidth={1.8} />
            )}
        </button>
    );
}

function CollapsedDockStub({ onClick }: { onClick: () => void }) {
    return (
        <button
            className={styles.collapsedDockStub}
            onClick={onClick}
            aria-label="Expand bottom dock"
            title="Expand"
        >
            <ChevronUpIcon size={14} strokeWidth={1.8} />
            <span>Audit log · Triage · Transforms · Documents</span>
        </button>
    );
}
