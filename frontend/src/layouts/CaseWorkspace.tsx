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
import { useEffect, useRef, useState } from "react";
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
import { Tabs } from "../components/ui/Tabs";
import { toast } from "../components/ui/Toaster";
import { AuditLogPanel } from "../components/workspace/AuditLogPanel";
import { ColdStartCanvas } from "../components/workspace/ColdStartCanvas";
import { DocumentTablePanel } from "../components/workspace/DocumentTablePanel";
import { EntityPalette } from "../components/workspace/EntityPalette";
import { FinancialsPane } from "../components/workspace/FinancialsPane";
import { IRS990Viewer } from "../components/workspace/IRS990Viewer";
import { KeyboardHelpOverlay } from "../components/workspace/KeyboardHelpOverlay";
import { PackagePane } from "../components/workspace/PackagePane";
import { ResearchPane } from "../components/workspace/ResearchPane";
import { PhaseNavigator } from "../components/workspace/PhaseNavigator";
import { RecentlyAdded } from "../components/workspace/RecentlyAdded";
import { RightDetailPanel } from "../components/workspace/RightDetailPanel";
import { TransformsPanel } from "../components/workspace/TransformsPanel";
import { TriagePanel } from "../components/workspace/TriagePanel";
import { WorkspaceCommandPalette } from "../components/workspace/WorkspaceCommandPalette";
import { WorkspaceGraph } from "../components/workspace/WorkspaceGraph";
import { WorkspaceTour, WorkspaceTourHandle } from "../components/workspace/WorkspaceTour";
import { useWorkspaceShortcuts } from "../components/workspace/useWorkspaceShortcuts";
import { fetchCaseDetail, patchCase, exportCaseReport, reevaluateFindings, searchIRS, searchOhioAOS, searchParcels } from "../api";
import { CaseDetail, FindingItem, GraphNode } from "../types";
import { DropdownMenu } from "../components/ui/DropdownMenu";
import styles from "./CaseWorkspace.module.css";

type DockTab = "audit" | "triage" | "transforms" | "documents";

const DOCK_TAB_STORAGE_KEY = "catalyst.workspace.dockTab";

function getStoredDockTab(caseId: string | undefined): DockTab {
    if (!caseId) return "audit";
    try {
        const raw = localStorage.getItem(`${DOCK_TAB_STORAGE_KEY}:${caseId}`);
        if (raw === "audit" || raw === "triage" || raw === "transforms" || raw === "documents") {
            return raw;
        }
    } catch {
        /* localStorage unavailable */
    }
    return "audit";
}

type ViewToggle = "graph" | "990" | "financials" | "package" | "research";

export function CaseWorkspace() {
    const { caseId } = useParams<{ caseId: string }>();
    const [activeViews, setActiveViews] = useState<Set<ViewToggle>>(new Set(["graph"]));

    const leftRailRef = useRef<ImperativePanelHandle>(null);
    const rightPanelRef = useRef<ImperativePanelHandle>(null);
    const bottomDockRef = useRef<ImperativePanelHandle>(null);

    const [leftCollapsed, setLeftCollapsed] = useState(false);
    const [rightCollapsed, setRightCollapsed] = useState(false);
    const [bottomCollapsed, setBottomCollapsed] = useState(false);

    // Case-level state — drives top bar identity (§6) and the cold-start gate (§8.6).
    // Workspace re-fetches when ColdStartCanvas reports a successful confirm.
    const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
    const [caseDetailVersion, setCaseDetailVersion] = useState(0);

    // Selection — owned at workspace level so graph (§8) and right detail panel (§9)
    // stay in sync. Will eventually feed bottom-dock Selection tab too (§10.5).
    const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

    // Graph version — increment to trigger a graph re-fetch (e.g. after Research pane
    // adds an entity to the case via the "Add to Case" flow).
    const [graphVersion, setGraphVersion] = useState(0);

    // Bottom dock active tab — lifted from CaseBottomDock so Cmd+1..4 keyboard
    // shortcuts can drive it from the workspace level.
    const [dockTab, setDockTab] = useState<"audit" | "triage" | "transforms" | "documents">(
        "audit",
    );

    // Hide the left rail entirely during cold start (no documents).
    // Derive directly from caseDetail so it's always in sync with the canvas.
    const showLeftRail = caseDetail !== null && caseDetail.documents.length > 0;

    // Command palette + keyboard help overlay open state.
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    const tourRef = useRef<WorkspaceTourHandle>(null);

    useWorkspaceShortcuts({
        onToggleBottomDock: toggleBottomDock,
        onSelectDockTab: setDockTab,
        onToggleViewPane: (v) => toggleView(v),
        onToggleLayoutLock: () => toast.message("Lock layout shortcut — wiring deferred"),
        onShowHelp: () => setHelpOpen(true),
        onEscape: () => setSelectedNode(null),
    });

    useEffect(() => {
        if (!caseId) return;
        let cancelled = false;
        (async () => {
            try {
                const detail = await fetchCaseDetail(caseId);
                if (!cancelled) setCaseDetail(detail);
            } catch {
                /* leave caseDetail null — placeholder UI handles it */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [caseId, caseDetailVersion]);

    const refreshCaseDetail = () => setCaseDetailVersion((v) => v + 1);

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

    function applyLayout(preset: "default" | "focus" | "research") {
        if (preset === "focus") {
            bottomDockRef.current?.collapse();
            setActiveViews(new Set(["graph"]));
        } else if (preset === "research") {
            bottomDockRef.current?.expand();
            setActiveViews(new Set<ViewToggle>(["graph", "research"]));
        } else {
            bottomDockRef.current?.expand();
            setActiveViews(new Set(["graph"]));
        }
    }

    return (
        <div className={styles.workspace}>
            <CaseTopBar
                caseId={caseId}
                caseDetail={caseDetail}
                activeViews={activeViews}
                onToggleView={toggleView}
                onOpenPalette={() => setPaletteOpen(true)}
                onCasePatched={refreshCaseDetail}
                onApplyLayout={applyLayout}
            />

            <PanelGroup direction="horizontal" className={styles.horizontalGroup}>
                {/* Zone 2 — Left rail (hidden during cold start: no docs yet) */}
                {showLeftRail && (
                    <>
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
                                <CaseLeftRail
                                    caseId={caseId}
                                    onCollapse={toggleLeftRail}
                                    onSubsetSelected={(_sel) => {
                                        // Bottom-dock filter integration is pending.
                                    }}
                                    onEntityCreated={refreshCaseDetail}
                                />
                            )}
                        </Panel>
                        <PanelResizeHandle className={styles.handleVertical} />
                    </>
                )}

                {/* Zones 3 + 5 — Center column (canvas + bottom dock) */}
                <Panel defaultSize={64} minSize={40}>
                    <PanelGroup direction="vertical" className={styles.verticalGroup}>
                        {/* Zone 3 — Center canvas */}
                        <Panel defaultSize={72} minSize={40}>
                            <CaseCenterCanvas
                                caseId={caseId}
                                caseDetail={caseDetail}
                                activeViews={activeViews}
                                graphVersion={graphVersion}
                                onConfirmedSubject={refreshCaseDetail}
                                selectedNode={selectedNode}
                                onSelectNode={setSelectedNode}
                                onCloseView={(v) => toggleView(v)}
                                onGraphRefresh={() => setGraphVersion((v) => v + 1)}
                            />
                        </Panel>

                        <PanelResizeHandle className={styles.handleHorizontal} />

                        {/* Zone 5 — Bottom dock */}
                        <Panel
                            ref={bottomDockRef}
                            defaultSize={28}
                            minSize={12}
                            maxSize={55}
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
                                <CaseBottomDock
                                    caseId={caseId}
                                    onCollapse={toggleBottomDock}
                                    activeTab={dockTab}
                                    onActiveTabChange={setDockTab}
                                    onSelectFinding={(f) => {
                                        // Cross-zone graph highlight needs lifted graph data
                                        // (deferred). For now, surface what was clicked.
                                        toast.message(`Selected: ${f.title}`);
                                    }}
                                />
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
                        <RightDetailPanel
                            caseDetail={caseDetail}
                            selectedNode={selectedNode}
                            onCollapse={toggleRightPanel}
                            onClearSelection={() => setSelectedNode(null)}
                        />
                    )}
                </Panel>
            </PanelGroup>

            {/* Global overlays — palette, keyboard help, first-time tour */}
            {caseId && (
                <>
                    <WorkspaceCommandPalette
                        caseId={caseId}
                        open={paletteOpen}
                        onOpenChange={setPaletteOpen}
                        onSelect={(r) => {
                            if (r.type === "entity") setSelectedNode(r.node);
                            else toast.message(`Open ${r.type}`);
                        }}
                    />
                    <WorkspaceTour caseId={caseId} ref={tourRef} />
                </>
            )}
            <KeyboardHelpOverlay open={helpOpen} onOpenChange={setHelpOpen} />
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Zone 1 — Top bar                                                    */
/* ------------------------------------------------------------------ */
function CaseTopBar({
    caseId,
    caseDetail,
    activeViews,
    onToggleView,
    onOpenPalette,
    onCasePatched,
    onApplyLayout,
}: {
    caseId?: string;
    caseDetail: CaseDetail | null;
    activeViews: Set<ViewToggle>;
    onToggleView: (v: ViewToggle) => void;
    onOpenPalette: () => void;
    onCasePatched: () => void;
    onApplyLayout: (preset: "default" | "focus" | "research") => void;
}) {
    const viewToggles: { id: ViewToggle; label: string; locked?: boolean }[] = [
        { id: "graph", label: "Graph", locked: true },
        { id: "990", label: "990 Viewer" },
        { id: "financials", label: "Financials" },
        { id: "package", label: "Package" },
        { id: "research", label: "Research" },
    ];

    return (
        <div className={styles.topBar}>
            <div className={styles.topBarLeft}>
                <span className={styles.caseLabel}>
                    {caseDetail?.name ?? "Case"}
                    {caseDetail && (
                        <>
                            <span className={styles.caseLabelDot}>·</span>
                            <span className={styles.caseLabelStatus}>{caseDetail.status}</span>
                        </>
                    )}
                    {!caseDetail && (
                        <span className={styles.caseLabelMuted}>· {caseId ?? "loading…"}</span>
                    )}
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
                            data-tour={v.id === "package" ? "package-toggle" : undefined}
                        >
                            {v.label}
                        </button>
                    );
                })}
            </div>

            <div className={styles.topBarRight}>
                <button
                    type="button"
                    className={styles.iconButton}
                    aria-label="Find within case"
                    title="Find within case (⌘K)"
                    onClick={onOpenPalette}
                >
                    <SearchIcon size={15} strokeWidth={1.6} />
                </button>
                <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                        <button type="button" className={styles.iconButton} aria-label="Layout presets" title="Layout presets">
                            <LayoutPanelLeftIcon size={15} strokeWidth={1.6} />
                        </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content align="end">
                        <DropdownMenu.Label>Layout presets</DropdownMenu.Label>
                        <DropdownMenu.Separator />
                        <DropdownMenu.Item onSelect={() => onApplyLayout("default")}>
                            Default — graph + dock
                        </DropdownMenu.Item>
                        <DropdownMenu.Item onSelect={() => onApplyLayout("focus")}>
                            Focus — graph only, dock collapsed
                        </DropdownMenu.Item>
                        <DropdownMenu.Item onSelect={() => onApplyLayout("research")}>
                            Research — research pane open
                        </DropdownMenu.Item>
                    </DropdownMenu.Content>
                </DropdownMenu.Root>
                <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                        <button type="button" className={styles.iconButton} aria-label="More options" title="More options">
                            <MoreVerticalIcon size={15} strokeWidth={1.6} />
                        </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content align="end">
                        <DropdownMenu.Item onSelect={() => {
                            if (!caseId) return;
                            exportCaseReport(caseId, "json").then(result => {
                                const a = document.createElement("a");
                                a.href = result.download_url;
                                a.download = result.filename || `case-${caseId}.json`;
                                a.click();
                            }).catch(() => toast.error("Export failed"));
                        }}>Export JSON</DropdownMenu.Item>
                        <DropdownMenu.Item onSelect={() => {
                            if (!caseId) return;
                            exportCaseReport(caseId, "csv").then(result => {
                                const a = document.createElement("a");
                                a.href = result.download_url;
                                a.download = result.filename || `case-${caseId}.csv`;
                                a.click();
                            }).catch(() => toast.error("Export failed"));
                        }}>Export CSV</DropdownMenu.Item>
                        <DropdownMenu.Separator />
                        {(["ACTIVE", "PAUSED", "REFERRED", "CLOSED"] as const).map(s => (
                            <DropdownMenu.Item
                                key={s}
                                onSelect={() => {
                                    if (!caseId) return;
                                    patchCase(caseId, { status: s })
                                        .then(onCasePatched)
                                        .catch(() => toast.error("Status update failed"));
                                }}
                            >
                                Mark as {s.charAt(0) + s.slice(1).toLowerCase()}
                            </DropdownMenu.Item>
                        ))}
                        <DropdownMenu.Separator />
                        <DropdownMenu.Item onSelect={() => {
                            if (!caseId) return;
                            reevaluateFindings(caseId)
                                .then(() => toast.success("Signals re-evaluated"))
                                .catch(() => toast.error("Re-evaluation failed"));
                        }}>Reevaluate all signals</DropdownMenu.Item>
                    </DropdownMenu.Content>
                </DropdownMenu.Root>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Zone 2 — Left rail                                                  */
/* §7.1 Phase navigator — live. §7.2 entity palette + §7.3 recently   */
/* added still pending (steps 14 + 19 of build sequence).              */
/* ------------------------------------------------------------------ */
function CaseLeftRail({
    caseId,
    onCollapse,
    onSubsetSelected,
    onEntityCreated,
}: {
    caseId?: string;
    onCollapse: () => void;
    onSubsetSelected: (sel: { phase: string; subset: string }) => void;
    onEntityCreated: () => void;
}) {
    return (
        <div className={styles.zoneInner}>
            <div className={styles.zoneHeader}>
                <span>Phases</span>
                <button
                    type="button"
                    className={styles.collapseButton}
                    onClick={onCollapse}
                    aria-label="Collapse left rail"
                    title="Collapse"
                >
                    <ChevronLeftIcon size={14} strokeWidth={1.8} />
                </button>
            </div>

            <div className={styles.zoneSectionFlush} data-tour="phase-navigator">
                {caseId ? (
                    <PhaseNavigator caseId={caseId} onSubsetSelected={onSubsetSelected} />
                ) : (
                    <div className={styles.placeholder}>
                        <div className={styles.placeholderTitle}>Phase navigator</div>
                        <div className={styles.placeholderRef}>§7.1 — case loading…</div>
                    </div>
                )}
            </div>

            <div className={styles.zoneSectionHeader}>Entity palette</div>
            <div className={styles.zoneSectionFlush}>
                {caseId ? (
                    <EntityPalette caseId={caseId} onCreated={onEntityCreated} />
                ) : (
                    <div className={styles.placeholder}>
                        <div className={styles.placeholderTitle}>Entity palette</div>
                        <div className={styles.placeholderRef}>§7.2 — case loading…</div>
                    </div>
                )}
            </div>

            <div className={styles.zoneSectionHeader}>Recently added</div>
            <div className={styles.zoneSectionFlush}>
                {caseId ? (
                    <RecentlyAdded
                        caseId={caseId}
                        onItemSelected={(entry) => toast.message(`Open ${entry.action}`)}
                    />
                ) : (
                    <div className={styles.placeholder}>
                        <div className={styles.placeholderTitle}>Last 5 items</div>
                        <div className={styles.placeholderRef}>§7.3 — case loading…</div>
                    </div>
                )}
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Zone 3 — Center canvas                                              */
/* §8.6 cold start fires only when graph pane is sole active pane and  */
/* the case has zero documents — confirming an entity flips it back.   */
/* ------------------------------------------------------------------ */
function CaseCenterCanvas({
    caseId,
    caseDetail,
    activeViews,
    graphVersion,
    onConfirmedSubject,
    selectedNode,
    onSelectNode,
    onCloseView,
    onGraphRefresh,
}: {
    caseId?: string;
    caseDetail: CaseDetail | null;
    activeViews: Set<ViewToggle>;
    graphVersion?: number;
    onConfirmedSubject: () => void;
    selectedNode: GraphNode | null;
    onSelectNode: (node: GraphNode | null) => void;
    onCloseView: (v: ViewToggle) => void;
    onGraphRefresh?: () => void;
}) {
    const panes: { id: ViewToggle; title: string; ref: string }[] = [];
    if (activeViews.has("graph")) panes.push({ id: "graph", title: "Graph canvas", ref: "§8 — Cytoscape.js" });
    if (activeViews.has("990")) panes.push({ id: "990", title: "990 Viewer", ref: "§11" });
    if (activeViews.has("financials")) panes.push({ id: "financials", title: "Financials", ref: "§12" });
    if (activeViews.has("package")) panes.push({ id: "package", title: "Package", ref: "§13" });
    if (activeViews.has("research")) panes.push({ id: "research", title: "Research", ref: "§14" });

    // Cold start state: graph is the only pane open AND the case has no docs yet.
    const inColdStart =
        panes.length === 1 &&
        panes[0].id === "graph" &&
        caseDetail !== null &&
        caseDetail.documents.length === 0;

    if (inColdStart && caseId) {
        return (
            <div className={styles.canvas} data-tour="cold-start">
                <ColdStartCanvas caseId={caseId} onConfirmed={onConfirmedSubject} />
            </div>
        );
    }

    function renderPane(id: ViewToggle, title: string, ref: string) {
        if (!caseId) return <CanvasPlaceholder title={title} ref_={ref} />;
        if (id === "graph") {
            return (
                <WorkspaceGraph
                    caseId={caseId}
                    selectedNodeId={selectedNode?.id ?? null}
                    onSelectNode={onSelectNode}
                    version={graphVersion}
                />
            );
        }
        if (id === "990") {
            return (
                <IRS990Viewer
                    caseId={caseId}
                    onClose={() => onCloseView("990")}
                    onOpenEntity={(personId) => toast.message(`Open entity ${personId.slice(0, 8)}…`)}
                    onOpenFinding={(findingId) => toast.message(`Open finding ${findingId.slice(0, 8)}…`)}
                />
            );
        }
        if (id === "financials") {
            return (
                <FinancialsPane
                    caseId={caseId}
                    onSelectYear={(year) => toast.message(`Year ${year} selected`)}
                />
            );
        }
        if (id === "package") {
            // graphLocked is undefined for now — graph lock state lives inside
            // EntityGraphCytoscape and isn't lifted yet. PackagePane shows the
            // "graph is locked" preflight as a passing-with-caveat row.
            return <PackagePane caseId={caseId} />;
        }
        if (id === "research") {
            return (
                <ResearchPane
                    caseId={caseId}
                    onAdded={onGraphRefresh}
                />
            );
        }
        return <CanvasPlaceholder title={title} ref_={ref} />;
    }

    if (panes.length === 1) {
        return (
            <div className={styles.canvas}>
                {renderPane(panes[0].id, panes[0].title, panes[0].ref)}
            </div>
        );
    }

    return (
        <PanelGroup direction="horizontal">
            {panes.map((p, idx) => (
                <>
                    <Panel key={p.id} defaultSize={100 / panes.length} minSize={20}>
                        <div className={styles.canvas}>
                            {renderPane(p.id, p.title, p.ref)}
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
/* ------------------------------------------------------------------ */
/* Zone 5 — Bottom dock                                                */
/* §10. Audit (live). Triage / Transforms / Documents land in steps   */
/* 9 / 15 / 4 respectively per spec §18 build sequence.                */
/* ------------------------------------------------------------------ */
function CaseBottomDock({
    caseId,
    onCollapse,
    activeTab,
    onActiveTabChange,
    onSelectFinding,
}: {
    caseId?: string;
    onCollapse: () => void;
    activeTab: DockTab;
    onActiveTabChange: (tab: DockTab) => void;
    onSelectFinding: (f: FindingItem) => void;
}) {
    const [auditCount, setAuditCount] = useState<number | null>(null);
    const [documentsCount, setDocumentsCount] = useState<number | null>(null);
    const [triageCount, setTriageCount] = useState<number | null>(null);
    const [transformsCount, setTransformsCount] = useState<number | null>(null);

    // Spec §10: tab persistence per-case in localStorage. Re-hydrates the
    // workspace-level state when caseId changes.
    useEffect(() => {
        if (caseId) onActiveTabChange(getStoredDockTab(caseId));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [caseId]);

    function selectTab(t: string) {
        const next = t as DockTab;
        onActiveTabChange(next);
        if (caseId) {
            try {
                localStorage.setItem(`${DOCK_TAB_STORAGE_KEY}:${caseId}`, next);
            } catch {
                /* localStorage unavailable */
            }
        }
    }

    return (
        <div className={styles.dockInner}>
            <Tabs.Root value={activeTab} onValueChange={selectTab} className={styles.dockTabsRoot}>
                <div className={styles.dockTabBar}>
                    <Tabs.List variant="line" aria-label="Bottom dock" className={styles.dockTabsList}>
                        <Tabs.Trigger
                            value="audit"
                            badge={auditCount ?? undefined}
                            data-tour="audit-log"
                        >
                            Audit log
                        </Tabs.Trigger>
                        <Tabs.Trigger
                            value="triage"
                            badge={triageCount ?? undefined}
                            data-tour="triage-tab"
                        >
                            Triage
                        </Tabs.Trigger>
                        <Tabs.Trigger value="transforms" badge={transformsCount ?? undefined}>
                            Transforms
                        </Tabs.Trigger>
                        <Tabs.Trigger value="documents" badge={documentsCount ?? undefined}>
                            Documents
                        </Tabs.Trigger>
                    </Tabs.List>
                    <button
                        type="button"
                        className={styles.collapseButton}
                        onClick={onCollapse}
                        aria-label="Collapse bottom dock"
                        title="Collapse"
                    >
                        <ChevronDownIcon size={14} strokeWidth={1.8} />
                    </button>
                </div>

                <Tabs.Content value="audit" className={styles.dockPaneFlush}>
                    <AuditLogPanel caseId={caseId} onLoaded={setAuditCount} />
                </Tabs.Content>
                <Tabs.Content value="triage" className={styles.dockPaneFlush}>
                    <TriagePanel
                        caseId={caseId}
                        onSelectFinding={onSelectFinding}
                        onLoaded={setTriageCount}
                    />
                </Tabs.Content>
                <Tabs.Content value="transforms" className={styles.dockPaneFlush}>
                    <TransformsPanel
                        caseId={caseId}
                        onLoaded={setTransformsCount}
                        onOpenResult={() => {}}
                        onRetry={async (j) => {
                            if (!caseId) return;
                            const p = j.query_params as Record<string, string> | null;
                            if (!p) return;
                            try {
                                if (j.job_type === "IRS_NAME_SEARCH") await searchIRS(caseId, p.query ?? "");
                                else if (j.job_type === "OHIO_AOS") await searchOhioAOS(caseId, p.query ?? "");
                                else if (j.job_type === "COUNTY_PARCEL") await searchParcels(caseId, p.query ?? "", (p.search_type as "owner" | "parcel") ?? "owner", p.county ?? "");
                                toast.success("Search re-queued");
                            } catch (e) {
                                toast.error(e instanceof Error ? e.message : "Retry failed");
                            }
                        }}
                    />
                </Tabs.Content>
                <Tabs.Content value="documents" className={styles.dockPaneFlush}>
                    <DocumentTablePanel caseId={caseId} onLoaded={setDocumentsCount} />
                </Tabs.Content>
            </Tabs.Root>
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
            type="button"
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
            type="button"
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
