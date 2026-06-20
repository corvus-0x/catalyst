import { Fragment, lazy, Suspense, useEffect, useRef, useState } from "react";
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
} from "../api";
import type {
  CaseMapResponse,
  CaseQuality,
  CredibilityCounts,
  DashboardResponse,
  DocumentItem,
  EntityType,
  GraphResponse,
  OrgDetailResponse,
  PersonDetailResponse,
  ReferralReadinessResponse,
} from "../types";
import CytoscapeCanvas, { type BadgeDescriptor } from "../components/CytoscapeCanvas";
import { subjectNodeToElement, summaryEdgeToElement, subjectBadges } from "./caseMapElements";
import CaseMapLegend from "../components/CaseMapLegend";
import { useAsyncJob } from "../hooks/useAsyncJob";
import { useCaseWorkspace } from "../context/CaseWorkspaceContext";

/* ─── Lazy panel + modal imports ─────────────────────────────────────────────── */
const ProfilePanel = lazy(() => import("./ProfilePanel"));
const ConnectionReviewPanel = lazy(() => import("./ConnectionReviewPanel"));
const AngleView = lazy(() => import("./AngleView"));
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
  | { kind: "profile"; id: string; entityType: EntityType; name: string }
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

/* ─── CredibilityHeader ───────────────────────────────────────────────────────── */

export function CredibilityHeader({ credibility }: { credibility?: CredibilityCounts }) {
  if (!credibility) return null;
  const { referral_grade, need_work, agency_leads } = credibility;
  return (
    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>
      <span style={{ color: "var(--color-success, #34d399)" }}>● {referral_grade} referral-grade</span>
      {"  ·  "}
      <span style={{ color: "#fbbf24" }}>◐ {need_work} need work</span>
      {"  ·  "}
      <span style={{ color: "var(--text-3)" }}>◷ {agency_leads} agency leads</span>
    </div>
  );
}

function CaseQualityPanel({ quality }: { quality?: CaseQuality }) {
  if (!quality) return null;

  const badgeStyle =
    quality.status === "READY"
      ? {
          background: "rgba(16, 185, 129, 0.16)",
          color: "var(--color-success, #34d399)",
          borderColor: "rgba(16, 185, 129, 0.32)",
        }
      : quality.status === "NEEDS_REVIEW"
        ? {
            background: "rgba(245, 158, 11, 0.16)",
            color: "#fbbf24",
            borderColor: "rgba(245, 158, 11, 0.32)",
          }
        : {
            background: "rgba(248, 113, 113, 0.14)",
            color: "var(--color-critical, #f87171)",
            borderColor: "rgba(248, 113, 113, 0.32)",
          };

  return (
    <div
      style={{
        border: "1px solid var(--border-1)",
        borderRadius: 6,
        padding: 10,
        margin: "10px 0",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "var(--text-3)",
          marginBottom: 6,
        }}
      >
        Case quality
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 8,
        }}
      >
        <span
          style={{
            ...badgeStyle,
            borderWidth: 1,
            borderStyle: "solid",
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 700,
            padding: "2px 7px",
            whiteSpace: "nowrap",
          }}
        >
          {quality.grade}
        </span>
      </div>
      {quality.top_issues.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--text-3)",
              marginBottom: 5,
            }}
          >
            Top gaps
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {quality.top_issues.slice(0, 3).map((issue) => (
              <div
                key={issue.key}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  color: "var(--text-2)",
                }}
                title={issue.summary}
              >
                <span>{issue.label}</span>
                <span style={{ color: "var(--text-3)", fontWeight: 600 }}>
                  {issue.status === "FAIL" ? "Blocker" : "Review"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Web-view right panel (default stats, shown when nothing is selected) ────── */

interface WebPanelProps {
  caseMap: CaseMapResponse | null;
  dashboard: DashboardResponse | null;
  leadStatus: "idle" | "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED";
  leadResult: { findings_created: number; patterns_dropped: number } | null;
}

function WebRightPanel({
  caseMap,
  dashboard,
  leadStatus,
  leadResult,
}: WebPanelProps) {
  const subjectCount = caseMap?.stats.subject_count ?? 0;
  const relationshipCount = caseMap?.stats.edge_count ?? 0;

  return (
    <div style={{ padding: 12, fontSize: 11, overflowY: "auto", height: "100%" }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 5 }}>
        Case Map
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", marginBottom: 2 }}>
        {caseMap?.stats ? `${subjectCount} subjects · ${relationshipCount} relationships` : "Loading…"}
      </div>

      <CredibilityHeader credibility={dashboard?.credibility} />
      <CaseQualityPanel quality={dashboard?.quality} />

      {dashboard && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, margin: "10px 0" }}>
          {[
            { label: "Substantiated threads", value: dashboard.findings.by_status.CONFIRMED ?? 0, badge: "badge-success" },
            { label: "Active threads",         value: dashboard.findings.by_status.NEEDS_EVIDENCE ?? 0, badge: "badge-info" },
            { label: "Documents",              value: dashboard.documents.total, badge: null },
          ].map(({ label, value, badge }) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "var(--text-3)" }}>{label}</span>
              <span className={badge ? `badge ${badge}` : ""} style={badge ? {} : { fontWeight: 600 }}>
                {value}
              </span>
            </div>
          ))}
        </div>
      )}

      <hr style={{ border: "none", borderTop: "0.5px solid var(--border-1)", margin: "8px 0" }} />
      <div style={{ fontSize: 10, color: "var(--text-3)" }}>
        Click a subject to open its profile. Click a relationship to see detail.
      </div>
      {(leadStatus === "QUEUED" || leadStatus === "RUNNING") && (
        <>
          <hr style={{ border: "none", borderTop: "0.5px solid var(--border-1)", margin: "8px 0" }} />
          <div style={{ fontSize: 10, color: "var(--text-3)" }}>✦ Lead analysis running…</div>
        </>
      )}
      {leadStatus === "SUCCESS" && leadResult != null && (
        <>
          <hr style={{ border: "none", borderTop: "0.5px solid var(--border-1)", margin: "8px 0" }} />
          <div style={{ fontSize: 10, color: "var(--color-success, #3fb950)", fontWeight: 600 }}>
            ✦ {leadResult.findings_created} new Lead{leadResult.findings_created !== 1 ? "s" : ""} found
          </div>
          {leadResult.patterns_dropped > 0 && (
            <div style={{ fontSize: 10, color: "var(--text-3)" }}>
              {leadResult.patterns_dropped} already captured
            </div>
          )}
        </>
      )}
      {leadStatus === "FAILED" && (
        <>
          <hr style={{ border: "none", borderTop: "0.5px solid var(--border-1)", margin: "8px 0" }} />
          <div style={{ fontSize: 10, color: "var(--color-critical, #f85149)" }}>Lead analysis failed</div>
        </>
      )}
    </div>
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
}

export default function InvestigateTab({
  caseId,
  documents,
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
    openThread,
    openDocument,
    goBack,
    goTo,
    activeAngleId,
  } = useCaseWorkspace();

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
     through here so the datasets stay coherent (D5). The selected
     relationship is cleared up front — a state change can remove or restrengthen
     the edge, so the panel must not stay pinned to a stale snapshot even if the
     refetch then fails. */
  async function refreshCaseData() {
    clearSelection();
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
    // Clear any selected relationship panel immediately — the user clicked away.
    clearSelection();
    // Node detail resolves against /graph/ (not /case-map/); property/financial
    // instrument nodes are not subjects and are excluded from the canvas.
    const node = graph?.nodes.find((n) => n.id === nodeId);
    if (!node || (node.type !== "person" && node.type !== "organization")) return;
    // Per THE RULE: node click is transient selection — map stays visible.
    // Full-width profile frame is reached only via "Open full profile" (Task 6).
    selectSubject(node.id);
    // Prefetch entity data for the subject rail placeholder (Task 6 will use it).
    setEntityData(null);
    if (node.type === "person" || node.type === "organization") {
      fetchEntityDetail(node.type, node.id)
        .then((d) => setEntityData(d as PersonDetailResponse | OrgDetailResponse))
        .catch((err) => {
          console.error(err);
          toast.error("Couldn't load profile details.");
        });
    }
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

  /* ── Resolve the subject label for a selected subject ── */
  function selectedSubjectLabel(): string {
    if (selection.kind !== "subject") return "";
    const node = graph?.nodes.find((n) => n.id === selection.id);
    return node?.label ?? selection.id.slice(0, 8) + "…";
  }

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

  // Suppress unused variable warning — readiness is stored and passed to refreshCaseData,
  // but not yet rendered in Task 4 (renders in Tasks 5+). The reference below satisfies tsc.
  void readiness;

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

  /* Level 2 — Profile panel (full-width, reached via "Open full profile" in Task 6) */
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

        {/* Canvas */}
        <div className="graph-canvas-dark" style={{ flex: 1, minWidth: 0, position: "relative" }}>
          {isEmpty ? (
            <EmptyWeb onAddAngle={() => { setConnectPrefill({}); setShowConnectModal(true); }} />
          ) : (
            <>
              <CytoscapeCanvas
                elements={elements}
                badges={badges}
                onCyInit={(cy) => { cyRef.current = cy; }}
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

        {/* Right rail — switches on selection.kind */}
        <div style={{ width: 320, flexShrink: 0, borderLeft: "1px solid var(--border-1)", background: "var(--bg-1)", overflow: "hidden" }}>
          {selection.kind === "subject" ? (
            /* Temporary subject rail — Task 6 replaces with SubjectInspector */
            <div data-testid="subject-rail" style={{ padding: 12, fontSize: 11 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 5 }}>
                Subject
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", marginBottom: 8 }}>
                {selectedSubjectLabel()}
              </div>
              <div style={{ color: "var(--text-3)", fontSize: 11 }}>Inspector loading…</div>
            </div>
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
          ) : (
            <WebRightPanel
              caseMap={caseMap}
              dashboard={dashboard}
              leadStatus={leadJob.status}
              leadResult={leadJob.result}
            />
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
    </div>
  );
}
