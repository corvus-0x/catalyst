import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type cytoscape from "cytoscape";
import { toast } from "sonner";
import { Flag, Maximize, Map as MapIcon, Sparkles, RefreshCw, Link as LinkIcon } from "lucide-react";
import {
  fetchGraph,
  fetchCaseMap,
  fetchFuzzyMatches,
  fetchEntityDetail,
  fetchDashboard,
  fetchReferralReadiness,
  runAiPatternAnalysis,
  reevaluateSignals,
  fetchAngles,
  fetchAngle,
} from "../api";
import type {
  CaseMapResponse,
  DashboardResponse,
  DocumentItem,
  FindingItem,
  GraphResponse,
  OrgDetailResponse,
  PersonDetailResponse,
  ReferralReadinessResponse,
  ReferralReadinessTargetTab,
} from "../types";
import type { SubjectEntityType } from "../context/CaseWorkspaceContext";
import WhatsMissingPanel from "../components/WhatsMissingPanel";
import CytoscapeCanvas, { type BadgeDescriptor } from "../components/CytoscapeCanvas";
import { subjectNodeToElement, summaryEdgeToElement, subjectBadges, threadPath, severityEdgeClass } from "./caseMapElements";
import CaseMapLegend from "../components/CaseMapLegend";
import SubjectInspector from "../components/SubjectInspector";
import ThreadInspector from "../components/ThreadInspector";
import { useAsyncJob } from "../hooks/useAsyncJob";
import { useCaseWorkspace } from "../context/CaseWorkspaceContext";
import { useFeederActions } from "../hooks/useFeederActions";
import AnglePickerModal from "../components/AnglePickerModal";
import ThreadDock from "../components/ThreadDock";

/* ─── Lazy panel + modal imports ─────────────────────────────────────────────── */
const ProfilePanel = lazy(() => import("./ProfilePanel"));
const ConnectionReviewPanel = lazy(() => import("./ConnectionReviewPanel"));
const AngleView = lazy(() => import("./ThreadBuilder"));
const DocumentView = lazy(() => import("./DocumentView"));
const ConnectKnotsModal = lazy(() => import("../components/ConnectKnotsModal"));
const RelationshipSummaryPanel = lazy(() => import("../components/RelationshipSummaryPanel"));

/* ─── WebStatsBar ─────────────────────────────────────────────────────────────── */

interface WebStatsBarProps {
  findings: number | null;
  documents: number | null;
  entities: number | null;
  daysOpen: number | null;
}

function WebStatsBar({ findings, documents, entities, daysOpen }: WebStatsBarProps) {
  const fmt = (n: number | null) => (n === null ? "—" : String(n));
  return (
    <div className="web-stats-bar">
      <span className="web-stats-chip">
        <span className="web-stats-chip__value">{fmt(findings)}</span>
        <span className="web-stats-chip__label">Threads</span>
      </span>
      <span className="web-stats-chip">
        <span className="web-stats-chip__value">{fmt(documents)}</span>
        <span className="web-stats-chip__label">Documents</span>
      </span>
      <span className="web-stats-chip">
        <span className="web-stats-chip__value">{fmt(entities)}</span>
        <span className="web-stats-chip__label">Subjects</span>
      </span>
      <span className="web-stats-chip">
        <span className="web-stats-chip__value">{fmt(daysOpen)}</span>
        <span className="web-stats-chip__label">Days open</span>
      </span>
    </div>
  );
}

/* ─── Toolbar ─────────────────────────────────────────────────────────────────── */

interface ToolbarProps {
  pendingCount: number;
  showMinimap: boolean;
  onAddAngle: () => void;
  onFit: () => void;
  onPendingClick: () => void;
  onToggleMinimap: () => void;
  leadStatus: "idle" | "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED";
  onRunLead: () => void;
  rerunPending: boolean;
  onRerunRules: () => void;
}

export function WebToolbar({ pendingCount, showMinimap, onAddAngle, onFit, onPendingClick, onToggleMinimap, leadStatus, onRunLead, rerunPending, onRerunRules }: ToolbarProps) {
  return (
    <div className="web-toolbar-rail">
      <button type="button" className="web-tool-btn" title="New thread" aria-label="New thread" onClick={onAddAngle}>
        <Flag size={16} />
      </button>
      <div className="web-toolbar-rail__sep" />
      <button type="button" className="web-tool-btn" title="Fit map" aria-label="Fit map" onClick={onFit}>
        <Maximize size={16} />
      </button>
      <button
        type="button"
        className="web-tool-btn"
        title="Toggle minimap"
        aria-label="Toggle minimap"
        onClick={onToggleMinimap}
        style={{ opacity: showMinimap ? 1 : 0.5 }}
      >
        <MapIcon size={16} />
      </button>
      <div className="web-toolbar-rail__sep" />
      <button
        type="button"
        className="web-tool-btn"
        title={
          leadStatus === "QUEUED" || leadStatus === "RUNNING"
            ? "Lead analysis running…"
            : leadStatus === "SUCCESS"
            ? "Lead complete — run again"
            : "Run Lead analysis"
        }
        aria-label="Run Lead analysis"
        onClick={onRunLead}
        disabled={leadStatus === "QUEUED" || leadStatus === "RUNNING"}
        style={{
          opacity: leadStatus === "QUEUED" || leadStatus === "RUNNING" ? 0.5 : 1,
          color: leadStatus === "SUCCESS" ? "var(--color-success, #3fb950)" : undefined,
        }}
      >
        <Sparkles size={16} />
      </button>
      <button
        type="button"
        className="web-tool-btn"
        title={rerunPending ? "Re-running rules…" : "Re-run signal rules"}
        aria-label="Re-run signal rules"
        onClick={onRerunRules}
        disabled={rerunPending}
        style={{ opacity: rerunPending ? 0.5 : 1 }}
      >
        <RefreshCw size={16} />
      </button>
      <div className="web-toolbar-rail__sep" />
      <button
        type="button"
        className="web-tool-btn"
        title="Pending relationships"
        aria-label="Pending relationships"
        onClick={onPendingClick}
      >
        <LinkIcon size={16} />
        {pendingCount > 0 && (
          <span className="web-tool-btn__badge">{pendingCount}</span>
        )}
      </button>
    </div>
  );
}

/* ─── Breadcrumb ──────────────────────────────────────────────────────────────── */

type BreadcrumbFrame =
  | { kind: "web" }
  | { kind: "profile"; id: string; entityType: SubjectEntityType; name: string }
  | { kind: "angle"; id: string; title: string }
  | { kind: "document"; id: string; name: string };

function frameLabel(f: BreadcrumbFrame): string {
  switch (f.kind) {
    case "web":      return "Case Map";
    case "profile":  return f.name;
    case "angle":    return f.title || "Thread";
    case "document": return f.name;
  }
}

function Breadcrumb({ stack, onNavigateTo }: { stack: BreadcrumbFrame[]; onNavigateTo: (i: number) => void }) {
  if (stack.length <= 1) return null;
  return (
    <nav className="breadcrumb" aria-label="Investigation navigation">
      {stack.map((entry, i) => {
        const isCurrent = i === stack.length - 1;
        return (
          <Fragment key={i}>
            {i > 0 && <span className="breadcrumb__sep" aria-hidden>›</span>}
            <button
              type="button"
              className={`breadcrumb__item${isCurrent ? " breadcrumb__item--current" : ""}`}
              onClick={() => !isCurrent && onNavigateTo(i)}
              disabled={isCurrent}
            >
              {frameLabel(entry)}
            </button>
          </Fragment>
        );
      })}
    </nav>
  );
}

/* ─── Empty web state ──────────────────────────────────────────────────────────── */

function EmptyWeb({ onAddAngle }: { onAddAngle: () => void }) {
  return (
    <div className="empty-state">
      <svg width="64" height="64" viewBox="0 0 72 72" fill="none" aria-hidden style={{ opacity: 0.15 }}>
        <circle cx="20" cy="20" r="10" stroke="#6b7280" strokeWidth="2" />
        <circle cx="52" cy="20" r="10" stroke="#6b7280" strokeWidth="2" />
        <circle cx="36" cy="52" r="10" stroke="#6b7280" strokeWidth="2" />
        <line x1="29" y1="26" x2="43" y2="26" stroke="#6b7280" strokeWidth="1.5" />
        <line x1="24" y1="28" x2="30" y2="44" stroke="#6b7280" strokeWidth="1.5" />
        <line x1="48" y1="28" x2="42" y2="44" stroke="#6b7280" strokeWidth="1.5" />
      </svg>
      <p className="empty-state__title">Your Case Map is empty.</p>
      <p className="empty-state__body">Add a subject to start building the map.</p>
      <button type="button" className="toolbar-btn" onClick={onAddAngle}>+ New thread</button>
    </div>
  );
}

/* ─── InvestigateTab ──────────────────────────────────────────────────────────── */

interface InvestigateTabProps {
  caseId: string;
  documents: DocumentItem[];
  onNavigateTab?: (tab: ReferralReadinessTargetTab) => void;
}

export default function InvestigateTab({
  caseId,
  documents,
  onNavigateTab,
}: InvestigateTabProps) {
  const [graph, setGraph]           = useState<GraphResponse | null>(null);
  const [caseMap, setCaseMap]       = useState<CaseMapResponse | null>(null);
  const [dashboard, setDashboard]   = useState<DashboardResponse | null>(null);
  const [readiness, setReadiness]   = useState<ReferralReadinessResponse | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  /* ── Entity cache for Profile panel ── */
  const [entityData, setEntityData] = useState<PersonDetailResponse | OrgDetailResponse | null>(null);

  /* ── Modals ── */
  const [showConnectionReview, setShowConnectionReview] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [connectPrefill, setConnectPrefill] = useState<{ entityId?: string; entityName?: string }>({});

  /* ── Minimap ── */
  const [showMinimap, setShowMinimap] = useState(false);

  /* ── Lead job (AI pattern analysis) ── */
  const leadJob = useAsyncJob<{ findings_created: number; patterns_dropped: number }>();
  const [rerunPending, setRerunPending] = useState(false);

  /* ── Thread dock state (isolated from the main mount Promise.all) ── */
  const [threads, setThreads] = useState<FindingItem[]>([]);
  const [threadsTotal, setThreadsTotal] = useState(0);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadsError, setThreadsError] = useState(false);
  const [cyReady, setCyReady] = useState(false);

  const cyRef = useRef<cytoscape.Core | null>(null);

  /* ── Reducer-driven workspace state ── */
  const {
    currentFrame,
    history,
    selection,
    selectSubject,
    selectRelationship,
    selectThread,
    clearSelection,
    openProfile,
    openThread,
    openDocument,
    goBack,
    goTo,
    activeAngleId,
    activeAngleTitle,
  } = useCaseWorkspace();

  /* ── Feeder actions for SubjectInspector start-thread / cite ── */
  const feeder = useFeederActions(caseId);

  /* ── Isolated thread-dock fetch (separate from the mount Promise.all so a thread-fetch
     failure can never blank the map or reject the main load) ── */
  const loadThreads = useCallback(() => {
    setThreadsLoading(true);
    setThreadsError(false);
    fetchAngles(caseId, { limit: 100 })
      .then((res) => { setThreads(res.results); setThreadsTotal(res.count); })
      .catch(() => { setThreads([]); setThreadsTotal(0); setThreadsError(true); })
      .finally(() => setThreadsLoading(false));
  }, [caseId]);
  useEffect(() => { loadThreads(); }, [loadThreads]);

  /* ── Load graph + case-map + dashboard + fuzzy counts + readiness ── */
  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetchGraph(caseId),
      fetchCaseMap(caseId),
      fetchFuzzyMatches(caseId, { status: "pending" }),
      fetchDashboard(caseId),
      fetchReferralReadiness(caseId),
    ])
      .then(([g, cm, fuzzy, dash, ready]) => {
        setGraph(g);
        setCaseMap(cm);
        setPendingCount(fuzzy.count);
        setDashboard(dash);
        setReadiness(ready);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load investigation data — reload to try again."),
      )
      .finally(() => setLoading(false));
  }, [caseId]);

  /* ── Unified refresh helper: refetches /case-map/, /graph/, dashboard, and readiness ──
     Every state-changing action (tie-off, creation, re-run rules, Lead) routes
     through here so the datasets stay coherent (D5).
     Only relationship selections are cleared on refresh — edge identity can change
     (restrengthen / collapse) so a stale panel must not stay pinned. Subject and thread
     selections use stable UUIDs and should survive a background refresh (e.g. Lead/rerun)
     so the SubjectInspector / RelationshipSummaryPanel stays open. */
  async function refreshCaseData() {
    if (selection.kind === "relationship") {
      clearSelection();
    }
    const [cm, g, dash, ready] = await Promise.all([
      fetchCaseMap(caseId),
      fetchGraph(caseId),
      fetchDashboard(caseId),
      fetchReferralReadiness(caseId),
    ]);
    setCaseMap(cm);
    setGraph(g);
    setDashboard(dash);
    setReadiness(ready);
    // Isolated thread-dock refresh — keep in its own try/catch so a dock failure cannot
    // reject the whole refresh or blank the map. We deliberately do NOT clear a thread
    // selection here on page-absence; the 101st-thread fallback (the selectedThreadFallback
    // effect below) re-resolves a selected thread that falls outside this 100-row page.
    try {
      const ang = await fetchAngles(caseId, { limit: 100 });
      setThreads(ang.results);
      setThreadsTotal(ang.count);
      setThreadsError(false);
    } catch {
      setThreadsError(true);
      toast.error("Couldn't refresh threads — retry from the dock.");
    }
  }

  /* ── Lead handler ── */
  async function handleRunLead() {
    await leadJob.run(() => runAiPatternAnalysis(caseId));
  }

  /* ── Re-run rules handler ── */
  async function handleRerunRules() {
    setRerunPending(true);
    try {
      await reevaluateSignals(caseId);
      await refreshCaseData();
    } catch (err) {
      console.error("Re-run rules failed:", err);
      toast.error("Signal re-run failed — try again.");
    } finally {
      setRerunPending(false);
    }
  }

  /* ── Refresh graph + case-map + dashboard after Lead job completes (D5) ── */
  useEffect(() => {
    if (leadJob.status !== "SUCCESS") return;
    refreshCaseData().catch((err) => {
      console.error(err);
      toast.error("Couldn't refresh the Case Map — reload if it looks stale.");
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadJob.status]);

  /* ── Node tap on canvas → selectSubject (THE RULE: map stays visible) ── */
  function handleNodeClick(nodeId: string) {
    if (currentFrame.kind !== "web") return;
    // Node detail resolves against /graph/ (not /case-map/); property/financial
    // instrument nodes are not subjects and are excluded from the canvas.
    // Guard BEFORE any selection mutation — a non-subject tap must not blank the rail.
    const node = graph?.nodes.find((n) => n.id === nodeId);
    if (!node || (node.type !== "person" && node.type !== "organization")) return;
    // Clear any selected relationship/thread panel — the user tapped a subject node.
    clearSelection();
    // Per THE RULE: node click is transient selection — map stays visible.
    // Full-width profile frame is reached only via SubjectInspector "Open full profile".
    selectSubject(node.id);
  }

  /* ── Edge tap on canvas → selectRelationship (reducer path) ── */
  function handleEdgeClick(edgeId: string) {
    if (currentFrame.kind !== "web") return;
    if (!caseMap) return;
    const edge = caseMap.edges.find((e) => e.id === edgeId);
    if (!edge) {
      console.warn("handleEdgeClick: no SummaryEdge for id", edgeId);
      return;
    }
    selectRelationship(edgeId);
  }

  /* ── Resolve the currently-selected SummaryEdge for the relationship panel ── */
  const selectedSummaryEdge =
    selection.kind === "relationship"
      ? (caseMap?.edges.find((e) => e.id === selection.edgeId) ?? null)
      : null;

  /* ── 101st-thread guard: prefer the dock's loaded page; fall back to a by-id fetch for a
     thread beyond the 100-row cap (e.g. selected via a Relationship-panel thread_ref). ── */
  const [selectedThreadFallback, setSelectedThreadFallback] = useState<FindingItem | null>(null);
  useEffect(() => {
    if (selection.kind !== "thread" || threads.some((t) => t.id === selection.id)) {
      setSelectedThreadFallback(null);
      return;
    }
    let cancelled = false;
    fetchAngle(caseId, selection.id)
      .then((t) => { if (!cancelled) setSelectedThreadFallback(t); })
      .catch((err) => {
        if (cancelled) return;
        // Surface the diagnosis: on failure Path Mode loses this thread's severity color
        // (falls back to neutral). ThreadInspector independently fetches + toasts, so the
        // user isn't blind — but the map-color silence must not be invisible to debugging.
        console.error("InvestigateTab: 101st-thread fallback fetch failed for", selection.id, err);
        setSelectedThreadFallback(null);
      });
    return () => { cancelled = true; };
  }, [selection, threads, caseId]);

  const selectedThread =
    selection.kind === "thread"
      ? threads.find((t) => t.id === selection.id) ?? selectedThreadFallback
      : null;

  const pathSet = useMemo(() => {
    if (selection.kind !== "thread") return { pathEdgeIds: [] as string[], participatingSubjectIds: [] as string[] };
    const raw = threadPath({
      threadId: selection.id,
      edges: caseMap?.edges ?? [],
      entityLinks: selectedThread?.entity_links ?? [],
    });
    // Keep only subjects that actually exist as Case Map nodes. An entity_link can name a
    // person/org that isn't on the map; including it would let the dim-guard pass while
    // cy.getElementById(id) finds nothing — dimming the WHOLE map with no highlighted path.
    // Filtering here keeps noVisibleMapPath (React) and applyThreadPathMode (canvas) consistent.
    const nodeIds = new Set((caseMap?.nodes ?? []).map((n) => n.id));
    return {
      pathEdgeIds: raw.pathEdgeIds,
      participatingSubjectIds: raw.participatingSubjectIds.filter((id) => nodeIds.has(id)),
    };
  }, [selection, selectedThread, caseMap]);

  // Only assert "no visible path" once the thread is RESOLVED (in the dock page or
  // via the fallback fetch). For a subject-only thread beyond the loaded 100, selectedThread
  // is briefly null while the fallback fetch is in flight — without this guard the note would
  // flash before entity_links arrive. Edge-backed threads are unaffected (pathSet is non-empty
  // from caseMap.edges regardless of selectedThread).
  const noVisibleMapPath =
    selection.kind === "thread" &&
    selectedThread != null &&
    pathSet.pathEdgeIds.length === 0 &&
    pathSet.participatingSubjectIds.length === 0;

  /* ── Resolve the subject label for a selected subject ── */
  function selectedSubjectLabel(): string {
    if (selection.kind !== "subject") return "";
    const node = graph?.nodes.find((n) => n.id === selection.id);
    return node?.label ?? selection.id.slice(0, 8) + "…";
  }

  /* ── Thread Path Mode: apply/clear path highlighting on the Cytoscape instance ── */
  const applyThreadPathMode = useCallback((cy: cytoscape.Core) => {
    cy.elements().removeClass(
      "dimmed thread-path-edge thread-path-edge--critical thread-path-edge--high thread-path-edge--medium thread-path-subject",
    );
    if (selection.kind !== "thread") return;
    if (pathSet.pathEdgeIds.length === 0 && pathSet.participatingSubjectIds.length === 0) return; // no-path: don't dim to nothing
    const suffix = severityEdgeClass(selectedThread?.severity ?? "INFORMATIONAL");
    cy.elements().addClass("dimmed");
    pathSet.pathEdgeIds.forEach((id) =>
      cy.getElementById(id).removeClass("dimmed").addClass(`thread-path-edge${suffix ? " thread-path-edge--" + suffix : ""}`));
    pathSet.participatingSubjectIds.forEach((id) =>
      cy.getElementById(id).removeClass("dimmed").addClass("thread-path-subject"));
  }, [selection, pathSet, selectedThread]);

  useEffect(() => {
    const cy = cyRef.current;
    if (cy) applyThreadPathMode(cy);
  }, [applyThreadPathMode, cyReady]);

  /* ── Build Cytoscape elements from /case-map/ (not /graph/) ──────────────────
     Canvas elements come from the Case Map contract (SubjectNode + SummaryEdge).
     Node drill-down (handleNodeClick) still resolves against /graph/ nodes.
  ─────────────────────────────────────────────────────────────────────────── */
  const elements: cytoscape.ElementDefinition[] = caseMap
    ? [
        ...caseMap.nodes.map(subjectNodeToElement),
        ...caseMap.edges.map(summaryEdgeToElement),
      ]
    : [];

  /* ── Badge descriptors — subjects with active threads get an amber dot ── */
  const badges: BadgeDescriptor[] = caseMap ? subjectBadges(caseMap.nodes) : [];

  const isEmpty = !caseMap || caseMap.nodes.length === 0;

  const daysOpen = (() => {
    if (!dashboard?.case.created_at) return null;
    const ms = Date.now() - new Date(dashboard.case.created_at).getTime();
    if (!Number.isFinite(ms) || ms < 0) return 0;
    return Math.floor(ms / 86_400_000);
  })();

  const fallback = (msg: string) => (
    <div style={{ padding: 24, color: "var(--text-3)", fontSize: 14 }}>{msg}</div>
  );

  if (loading) return (
    <div style={{ flex: 1, display: "flex", flexDirection: "row", minHeight: 0, overflow: "hidden" }}>
      <WebToolbar pendingCount={0} showMinimap={false} onFit={() => {}} onAddAngle={() => {}} onPendingClick={() => {}} onToggleMinimap={() => {}} leadStatus="idle" onRunLead={() => {}} rerunPending={false} onRerunRules={() => {}} />
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)" }}>Loading map…</div>
    </div>
  );

  if (error) return (
    <div style={{ flex: 1, display: "flex", flexDirection: "row", minHeight: 0, overflow: "hidden" }}>
      <WebToolbar pendingCount={0} showMinimap={false} onFit={() => {}} onAddAngle={() => {}} onPendingClick={() => {}} onToggleMinimap={() => {}} leadStatus="idle" onRunLead={() => {}} rerunPending={false} onRerunRules={() => {}} />
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-critical)", padding: 24, textAlign: "center" }}>{error}</div>
    </div>
  );

  /* ── Frame-keyed render ── */

  /* Level 4 — Document view (full-width) */
  if (currentFrame.kind === "document") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, position: "relative" }}>
        <Breadcrumb stack={history} onNavigateTo={goTo} />
        <Suspense fallback={fallback("Loading document…")}>
          <DocumentView
            caseId={caseId}
            documentId={currentFrame.id}
            activeAngleId={activeAngleId}
            onBack={goBack}
            onDocumentNavigate={(docId) => {
              const node = graph?.nodes.find((n) => n.id === docId);
              openDocument({
                id: docId,
                name: node?.label ?? docId.slice(0, 8) + "…",
              });
            }}
          />
        </Suspense>
      </div>
    );
  }

  /* Level 3 — Angle/Thread view (full-width) */
  if (currentFrame.kind === "angle") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, position: "relative" }}>
        <Breadcrumb stack={history} onNavigateTo={goTo} />
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <Suspense fallback={fallback("Loading…")}>
            <AngleView
              caseId={caseId}
              angleId={currentFrame.id}
              documents={documents}
              onDocumentClick={(docId, docName) => openDocument({ id: docId, name: docName })}
              onBack={goBack}
              onAngleTiedOff={() =>
                refreshCaseData().catch((err) => {
                  console.error(err);
                  toast.error("The Case Map didn't refresh — reload if it looks stale.");
                })
              }
            />
          </Suspense>
        </div>
      </div>
    );
  }

  /* Level 2 — Profile panel (full-width, reached via SubjectInspector "Open full profile") */
  if (currentFrame.kind === "profile") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, position: "relative" }}>
        <Breadcrumb stack={history} onNavigateTo={goTo} />
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <Suspense fallback={fallback("Loading…")}>
            <ProfilePanel
              caseId={caseId}
              entityId={currentFrame.id}
              entityType={currentFrame.entityType}
              entityData={entityData}
              graph={graph}
              onAngleClick={(angleId, angleTitle) => {
                if (angleId === "") {
                  setConnectPrefill({ entityId: currentFrame.id, entityName: currentFrame.name });
                  setShowConnectModal(true);
                } else {
                  openThread({ id: angleId, title: angleTitle });
                }
              }}
              onDocumentClick={(docId, docName) => openDocument({ id: docId, name: docName })}
              onBack={goBack}
            />
          </Suspense>
        </div>
      </div>
    );
  }

  /* Level 1 — Web (Case Map canvas + right rail) */
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, position: "relative" }}>
      {/* Breadcrumb */}
      <Breadcrumb stack={history} onNavigateTo={goTo} />

      {/* KPI stats bar — Web Level 1 only; Subjects count from caseMap.stats */}
      <WebStatsBar
        findings={dashboard?.findings.total ?? null}
        documents={dashboard?.documents.total ?? null}
        entities={caseMap?.stats.subject_count ?? null}
        daysOpen={daysOpen}
      />

      {/* Main row: toolbar + canvas + panels */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        <WebToolbar
          pendingCount={pendingCount}
          showMinimap={showMinimap}
          onFit={() => cyRef.current?.fit(undefined, 40)}
          onAddAngle={() => { setConnectPrefill({}); setShowConnectModal(true); }}
          onPendingClick={() => setShowConnectionReview(true)}
          onToggleMinimap={() => setShowMinimap((s) => !s)}
          leadStatus={leadJob.status}
          onRunLead={handleRunLead}
          rerunPending={rerunPending}
          onRerunRules={handleRerunRules}
        />

        {/* Canvas column: map + thread dock beneath it (spans canvas width, NOT in right rail) */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          <div className="graph-canvas-dark" style={{ flex: 1, minWidth: 0, position: "relative" }}>
            {isEmpty ? (
              <EmptyWeb onAddAngle={() => { setConnectPrefill({}); setShowConnectModal(true); }} />
            ) : (
              <>
                <CytoscapeCanvas
                  elements={elements}
                  badges={badges}
                  onCyInit={(cy) => { cyRef.current = cy; setCyReady(true); applyThreadPathMode(cy); }}
                  onNodeClick={handleNodeClick}
                  onEdgeClick={handleEdgeClick}
                />
                <CaseMapLegend />
              </>
            )}

            {/* Minimap */}
            {showMinimap && !isEmpty && (
              <div className="minimap-container" aria-hidden>
                <CytoscapeCanvas elements={elements} interactionDisabled />
              </div>
            )}
          </div>

          {/* Thread Dock — beneath the canvas, spans canvas width */}
          {!isEmpty && (
            <ThreadDock
              threads={threads}
              totalCount={threadsTotal}
              loading={threadsLoading}
              error={threadsError}
              selectedThreadId={selection.kind === "thread" ? selection.id : undefined}
              onSelectThread={(id) => {
                if (selection.kind === "thread" && selection.id === id) {
                  clearSelection();              // clicking the active row exits Path Mode
                } else {
                  const t = threads.find((x) => x.id === id);
                  selectThread(id, t?.title ?? "");
                }
              }}
              onRetry={loadThreads}
            />
          )}
        </div>

        {/* Right rail — switches on selection.kind */}
        <div style={{ width: 320, flexShrink: 0, borderLeft: "1px solid var(--border-1)", background: "var(--bg-1)", overflow: "hidden" }}>
          {selection.kind === "subject" && caseMap ? (
            <SubjectInspector
              caseId={caseId}
              subjectId={selection.id}
              entityType={(() => {
                const t = graph?.nodes.find((n) => n.id === selection.id)?.type;
                return (t === "person" || t === "organization") ? t : "person";
              })()}
              caseMap={caseMap}
              subjectLabel={(id) =>
                caseMap.nodes.find((n) => n.id === id)?.label ?? graph?.nodes.find((n) => n.id === id)?.label ?? id.slice(0, 8) + "…"
              }
              onSelectRelationship={(edgeId) => selectRelationship(edgeId)}
              onStartThread={() => {
                const name = selectedSubjectLabel();
                void feeder.startAngleFrom({ title: name });
              }}
              onCite={() => {
                const name = selectedSubjectLabel();
                void feeder.citeToAngle({ label: name });
              }}
              onOpenProfile={() => {
                const node = graph?.nodes.find((n) => n.id === selection.id);
                const entityType = (node?.type === "person" || node?.type === "organization")
                  ? node.type
                  : "person" as const;
                const name = node?.label ?? selectedSubjectLabel();
                // Clear stale data before navigating — ProfilePanel must never show
                // data from a previously-opened subject.
                setEntityData(null);
                openProfile({ id: selection.id, entityType, name });
                fetchEntityDetail(entityType, selection.id)
                  .then((d) => setEntityData(d as PersonDetailResponse | OrgDetailResponse))
                  .catch((err) => {
                    console.error(err);
                    toast.error("Couldn't load profile details.");
                  });
              }}
              onClear={clearSelection}
            />
          ) : selectedSummaryEdge ? (
            <Suspense fallback={fallback("Loading…")}>
              <RelationshipSummaryPanel
                edge={selectedSummaryEdge}
                subjectLabel={(id) => caseMap?.nodes.find((n) => n.id === id)?.label ?? id.slice(0, 8) + "…"}
                onClear={clearSelection}
                onOpenSource={(docId) => {
                  const ref = selectedSummaryEdge.evidence_refs.find((r) => r.document_id === docId);
                  openDocument({ id: docId, name: ref?.label ?? docId.slice(0, 8) + "…" });
                }}
                onSelectThread={(threadId) => {
                  const ref = selectedSummaryEdge.thread_refs.find((t) => t.thread_id === threadId);
                  selectThread(threadId, ref?.title ?? "");
                }}
                onStartThread={() => {
                  setConnectPrefill({});
                  setShowConnectModal(true);
                }}
              />
            </Suspense>
          ) : selection.kind === "thread" ? (
            <ThreadInspector
              caseId={caseId}
              threadId={selection.id}
              noVisibleMapPath={noVisibleMapPath}
              onOpenThread={() =>
                openThread({ id: selection.id, title: activeAngleTitle ?? "" })
              }
              onClear={clearSelection}
              onChanged={() => {
                refreshCaseData().catch((err) => {
                  console.error(err);
                  toast.error("Couldn't refresh the Case Map — reload if it looks stale.");
                });
              }}
            />
          ) : readiness ? (
            <WhatsMissingPanel
              readiness={readiness}
              onNavigateTab={(tab) => onNavigateTab?.(tab)}
              onOpenPending={() => setShowConnectionReview(true)}
            />
          ) : (
            <div style={{ padding: 12, fontSize: 11, color: "var(--text-3)" }}>Loading…</div>
          )}
        </div>
      </div>

      {/* Connection review drawer */}
      {showConnectionReview && (
        <Suspense fallback={null}>
          <ConnectionReviewPanel
            caseId={caseId}
            onClose={() => setShowConnectionReview(false)}
            onCountChange={setPendingCount}
          />
        </Suspense>
      )}

      {/* Connect knots modal */}
      {showConnectModal && (
        <Suspense fallback={null}>
          <ConnectKnotsModal
            open={showConnectModal}
            caseId={caseId}
            prefillEntityId={connectPrefill.entityId}
            prefillEntityName={connectPrefill.entityName}
            onClose={() => setShowConnectModal(false)}
            onCreated={(newAngle) => {
              setShowConnectModal(false);
              openThread({ id: newAngle.id, title: newAngle.title });
              refreshCaseData().catch((err) => {
                console.error(err);
                toast.error("The Case Map didn't refresh — reload if it looks stale.");
              });
            }}
          />
        </Suspense>
      )}

      {/* Angle picker — opened by feeder when no active thread on cite */}
      <AnglePickerModal
        caseId={caseId}
        open={feeder.pickerOpen}
        onClose={feeder.closePicker}
        onPick={feeder.onPickerPick}
      />
    </div>
  );
}
