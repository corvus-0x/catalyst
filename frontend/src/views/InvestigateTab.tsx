import { Fragment, lazy, Suspense, useEffect, useRef, useState } from "react";
import type cytoscape from "cytoscape";
import { fetchGraph, fetchFuzzyMatches, fetchEntityDetail, fetchDashboard, runAiPatternAnalysis, reevaluateSignals } from "../api";
import type {
  CaseQuality,
  DashboardResponse,
  DocumentItem,
  EdgeFindingLink,
  EntityType,
  GraphEdge,
  GraphNode,
  GraphResponse,
  OrgDetailResponse,
  PersonDetailResponse,
} from "../types";
import CytoscapeCanvas, { type BadgeDescriptor } from "../components/CytoscapeCanvas";
import ConnectionDetailPanel from "../components/ConnectionDetailPanel";
import { useAsyncJob } from "../hooks/useAsyncJob";

/* ─── Lazy panel + modal imports ─────────────────────────────────────────────── */
const ProfilePanel = lazy(() => import("./ProfilePanel"));
const ConnectionReviewPanel = lazy(() => import("./ConnectionReviewPanel"));
const AngleView = lazy(() => import("./AngleView"));
const DocumentView = lazy(() => import("./DocumentView"));
const ConnectKnotsModal = lazy(() => import("../components/ConnectKnotsModal"));

/* ─── Navigation state ───────────────────────────────────────────────────────── */

export type NavEntry =
  | { kind: "web" }
  | { kind: "profile"; entityId: string; entityType: EntityType; entityName: string }
  | { kind: "angle"; angleId: string; angleTitle: string }
  | { kind: "document"; documentId: string; docName: string };

function entryLabel(e: NavEntry): string {
  switch (e.kind) {
    case "web":      return "Investigation web";
    case "profile":  return e.entityName;
    case "angle":    return e.angleTitle || "Angle";
    case "document": return e.docName;
  }
}

/* ─── Node mapping ────────────────────────────────────────────────────────────
   API "organization" → Cytoscape type "org" (stylesheet selector).
   org_type drives the wireframe colour variant (teal, amber, purple, coral).
─────────────────────────────────────────────────────────────────────────── */

function toCyType(t: GraphNode["type"]): string {
  return t === "organization" ? "org" : t;
}

function nodeToElement(node: GraphNode): cytoscape.ElementDefinition {
  return {
    data: {
      id: node.id,
      label: node.label,
      type: toCyType(node.type),
      org_type: node.metadata.org_type ?? "",
      finding_count: node.metadata.finding_count,
      doc_count: node.metadata.doc_count,
    },
  };
}

/* ─── Edge mapping ────────────────────────────────────────────────────────────── */

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFORMATIONAL: 0,
};

function highestSeverity(links: EdgeFindingLink[]): string | undefined {
  if (!links?.length) return undefined;
  return [...links].sort(
    (a, b) => (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0)
  )[0].severity;
}

function edgeToElement(edge: GraphEdge): cytoscape.ElementDefinition {
  const meta = edge.metadata as Record<string, unknown>;
  const isProposed = edge.relationship === "CO_APPEARS_IN";
  const isManual =
    !isProposed &&
    ["FAMILY", "BUSINESS", "SOCIAL"].includes(edge.relationship) &&
    meta.source_type === "MANUAL";
  const severity = isProposed ? undefined : highestSeverity(edge.finding_links ?? []);
  return {
    data: {
      id: `${edge.source}__${edge.target}__${edge.relationship}`,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      relationship: edge.relationship,
      weight: edge.weight,
      ...(isProposed && { status: "proposed" }),
      ...(isManual && { source_type: "manual" }),
      ...(severity && { severity }),
      finding_links: edge.finding_links ?? [],
    },
  };
}

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
        <span className="web-stats-chip__label">Angles</span>
      </span>
      <span className="web-stats-chip">
        <span className="web-stats-chip__value">{fmt(documents)}</span>
        <span className="web-stats-chip__label">Documents</span>
      </span>
      <span className="web-stats-chip">
        <span className="web-stats-chip__value">{fmt(entities)}</span>
        <span className="web-stats-chip__label">Entities</span>
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

function WebToolbar({ pendingCount, showMinimap, onAddAngle, onFit, onPendingClick, onToggleMinimap, leadStatus, onRunLead, rerunPending, onRerunRules }: ToolbarProps) {
  return (
    <div className="web-toolbar-rail">
      <button type="button" className="web-tool-btn" title="New angle" onClick={onAddAngle}>⚑</button>
      <div className="web-toolbar-rail__sep" />
      <button type="button" className="web-tool-btn" title="Fit graph" onClick={onFit}>⊞</button>
      <button
        type="button"
        className="web-tool-btn"
        title="Toggle minimap"
        onClick={onToggleMinimap}
        style={{ opacity: showMinimap ? 1 : 0.5 }}
      >
        ▣
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
        onClick={onRunLead}
        disabled={leadStatus === "QUEUED" || leadStatus === "RUNNING"}
        style={{
          opacity: leadStatus === "QUEUED" || leadStatus === "RUNNING" ? 0.5 : 1,
          color: leadStatus === "SUCCESS" ? "var(--color-success, #3fb950)" : undefined,
        }}
      >
        ✦
      </button>
      <button
        type="button"
        className="web-tool-btn"
        title={rerunPending ? "Re-running rules…" : "Re-run signal rules"}
        onClick={onRerunRules}
        disabled={rerunPending}
        style={{ opacity: rerunPending ? 0.5 : 1 }}
      >
        ↺
      </button>
      <div className="web-toolbar-rail__sep" />
      <button
        type="button"
        className="web-tool-btn"
        title="Pending connections"
        onClick={onPendingClick}
      >
        🔗
        {pendingCount > 0 && (
          <span className="web-tool-btn__badge">{pendingCount}</span>
        )}
      </button>
    </div>
  );
}

/* ─── Breadcrumb ──────────────────────────────────────────────────────────────── */

function Breadcrumb({ stack, onNavigateTo }: { stack: NavEntry[]; onNavigateTo: (i: number) => void }) {
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
              {entryLabel(entry)}
            </button>
          </Fragment>
        );
      })}
    </nav>
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
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text-1)" }}>
          {quality.score} / 100
        </span>
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
            Top issues
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

/* ─── Web-view right panel (always visible at Level 1) ────────────────────────── */

interface WebPanelProps {
  graph: GraphResponse | null;
  dashboard: DashboardResponse | null;
  documents: DocumentItem[];
  selectedEdge: GraphEdge | null;
  onOpenAngle: (angleId: string, angleTitle: string) => void;
  onOpenDocument: (docId: string, docName: string) => void;
  onClearEdge: () => void;
  leadStatus: "idle" | "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED";
  leadResult: { findings_created: number; patterns_dropped: number } | null;
}

function WebRightPanel({
  graph,
  dashboard,
  documents,
  selectedEdge,
  onOpenAngle,
  onOpenDocument,
  onClearEdge,
  leadStatus,
  leadResult,
}: WebPanelProps) {
  const knotCount = graph
    ? (graph.stats.node_types.person ?? 0) + (graph.stats.node_types.organization ?? 0)
    : 0;
  const edgeCount = graph?.stats.total_edges ?? 0;

  if (selectedEdge) {
    return (
      <ConnectionDetailPanel
        edge={selectedEdge}
        graph={graph}
        documents={documents}
        onOpenAngle={onOpenAngle}
        onOpenDocument={onOpenDocument}
        onClear={onClearEdge}
      />
    );
  }

  /* ── Default: case stats ── */
  return (
    <div style={{ padding: 12, fontSize: 11, overflowY: "auto", height: "100%" }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 5 }}>
        Case web
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", marginBottom: 2 }}>
        {graph?.stats ? `${knotCount} knots · ${edgeCount} connections` : "Loading…"}
      </div>

      <CaseQualityPanel quality={dashboard?.quality} />

      {dashboard && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, margin: "10px 0" }}>
          {[
            { label: "Confirmed angles", value: dashboard.findings.by_status.CONFIRMED ?? 0, badge: "badge-success" },
            { label: "Active angles",    value: dashboard.findings.by_status.NEEDS_EVIDENCE ?? 0, badge: "badge-info" },
            { label: "Documents",        value: dashboard.documents.total, badge: null },
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
        Click a knot to open its profile. Click a connection to see detail.
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
      <p className="empty-state__title">Your investigation web is empty.</p>
      <p className="empty-state__body">Add a person or organization to start building the web.</p>
      <button type="button" className="toolbar-btn" onClick={onAddAngle}>+ New angle</button>
    </div>
  );
}

/* ─── InvestigateTab ──────────────────────────────────────────────────────────── */

interface InvestigateTabProps {
  caseId: string;
  documents: DocumentItem[];
  onAngleActive?: (angleId: string | undefined) => void;
  /** Set by parent to request navigating to a specific angle from outside */
  requestedAngle?: { id: string; title: string } | null;
  /** Called after this component pushes the requested angle onto the nav stack */
  onAngleConsumed?: () => void;
}

export default function InvestigateTab({
  caseId,
  documents,
  onAngleActive,
  requestedAngle,
  onAngleConsumed,
}: InvestigateTabProps) {
  const [graph, setGraph]           = useState<GraphResponse | null>(null);
  const [dashboard, setDashboard]   = useState<DashboardResponse | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  /* ── Entity cache for Profile panel ── */
  const [entityData, setEntityData] = useState<PersonDetailResponse | OrgDetailResponse | null>(null);

  /* ── Selected edge on the web canvas (updates right panel) ── */
  const [webSelectedEdge, setWebSelectedEdge] = useState<GraphEdge | null>(null);

  /* ── Navigation stack ── */
  const [navStack, setNavStack] = useState<NavEntry[]>([{ kind: "web" }]);
  const current = navStack[navStack.length - 1];

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

  /* ── Load graph + dashboard + fuzzy counts ── */
  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetchGraph(caseId),
      fetchFuzzyMatches(caseId, { status: "pending" }),
      fetchDashboard(caseId),
    ])
      .then(([g, fuzzy, dash]) => {
        setGraph(g);
        setPendingCount(fuzzy.count);
        setDashboard(dash);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load graph"))
      .finally(() => setLoading(false));
  }, [caseId]);

  /* ── External angle navigation (from Investigation tab deep link) ── */
  useEffect(() => {
    if (!requestedAngle) return;
    navigate({ kind: "angle", angleId: requestedAngle.id, angleTitle: requestedAngle.title });
    onAngleConsumed?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedAngle]);

  /* ── Lead handler ── */
  async function handleRunLead() {
    await leadJob.run(() => runAiPatternAnalysis(caseId));
  }

  /* ── Re-run rules handler ── */
  async function handleRerunRules() {
    setRerunPending(true);
    try {
      await reevaluateSignals(caseId);
      const [g, dash] = await Promise.all([fetchGraph(caseId), fetchDashboard(caseId)]);
      setGraph(g);
      setDashboard(dash);
    } catch (err) {
      console.error("Re-run rules failed:", err);
    } finally {
      setRerunPending(false);
    }
  }

  /* ── Refresh graph + dashboard after Lead job completes ── */
  useEffect(() => {
    if (leadJob.status !== "SUCCESS") return;
    Promise.all([fetchGraph(caseId), fetchDashboard(caseId)])
      .then(([g, dash]) => {
        setGraph(g);
        setDashboard(dash);
      })
      .catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadJob.status]);

  /* ── Navigation ── */
  function sameEntry(a: NavEntry, b: NavEntry): boolean {
    if (a.kind !== b.kind) return false;
    switch (a.kind) {
      case "web":      return true;
      case "profile":  return a.entityId === (b as typeof a).entityId;
      case "angle":    return a.angleId === (b as typeof a).angleId;
      case "document": return a.documentId === (b as typeof a).documentId;
    }
  }

  function navigate(entry: NavEntry) {
    // Re-clicking the current level (e.g. a double-fired canvas tap) must not
    // stack a duplicate breadcrumb crumb.
    setNavStack((s) => (sameEntry(s[s.length - 1], entry) ? s : [...s, entry]));
    setWebSelectedEdge(null);
    if (entry.kind === "angle") {
      onAngleActive?.(entry.angleId);
    } else {
      onAngleActive?.(undefined);
    }
  }

  function navigateTo(index: number) {
    const newStack = navStack.slice(0, index + 1);
    setNavStack(newStack);
    const top = newStack[newStack.length - 1];
    if (top.kind === "web") {
      cyRef.current?.elements().removeClass("dimmed");
      setWebSelectedEdge(null);
    }
    if (top.kind === "angle") {
      onAngleActive?.(top.angleId);
    } else {
      onAngleActive?.(undefined);
    }
  }

  function navigateBack() { navigateTo(navStack.length - 2); }

  /* ── Node tap on canvas → navigate directly to Profile (Level 2) ─────────── */
  function handleNodeClick(nodeId: string) {
    if (current.kind !== "web") return;
    const node = graph?.nodes.find((n) => n.id === nodeId);
    if (!node || (node.type !== "person" && node.type !== "organization")) return;
    handleOpenKnotView(node);
  }

  /* ── Edge tap on canvas → show detail in right panel ── */
  function handleEdgeClick(edgeId: string) {
    if (current.kind !== "web") return;
    // edgeId format: "source__target__relationship" (see edgeToElement)
    // relationship names may contain underscores (OFFICER_OF, CO_APPEARS_IN, SOLD_BY)
    // so reconstruct relationship from everything after the second "__"
    const firstSep = edgeId.indexOf("__");
    const secondSep = edgeId.indexOf("__", firstSep + 2);
    if (firstSep === -1 || secondSep === -1) return;
    const source = edgeId.slice(0, firstSep);
    const target = edgeId.slice(firstSep + 2, secondSep);
    const relationship = edgeId.slice(secondSep + 2);
    const edge = graph?.edges.find(
      (e) => e.source === source && e.target === target && e.relationship === relationship
    );
    if (!edge) return;
    setWebSelectedEdge(edge);
  }

  /* ── Navigate to Level 2: Profile ── */
  function handleOpenKnotView(node: GraphNode) {
    navigate({ kind: "profile", entityId: node.id, entityType: node.type, entityName: node.label });
    setEntityData(null);
    if (node.type === "person" || node.type === "organization") {
      fetchEntityDetail(node.type, node.id)
        .then((d) => setEntityData(d as PersonDetailResponse | OrgDetailResponse))
        .catch(console.error);
    }
  }

  /* ── Build Cytoscape elements: knots only (person + org) + edges ──────────────
     Property and financial_instrument nodes are excluded from the graph canvas.
     The spec says only Person and Org can be knots.
  ─────────────────────────────────────────────────────────────────────────── */
  const elements: cytoscape.ElementDefinition[] = graph ? [
    ...graph.nodes
      .filter((n) => n.type === "person" || n.type === "organization")
      .map(nodeToElement),
    // Only include edges between visible knot nodes
    ...graph.edges
      .filter((e) => {
        const sourceIsKnot = graph.nodes.some(
          (n) => n.id === e.source && (n.type === "person" || n.type === "organization")
        );
        const targetIsKnot = graph.nodes.some(
          (n) => n.id === e.target && (n.type === "person" || n.type === "organization")
        );
        return sourceIsKnot && targetIsKnot;
      })
      .map(edgeToElement),
  ] : [];

  /* ── Badge descriptors — injected by CytoscapeCanvas after layoutstop ── */
  const badges: BadgeDescriptor[] = graph
    ? graph.nodes
        .filter((n) => n.metadata.finding_count > 0 && (n.type === "person" || n.type === "organization"))
        .map((n) => ({
          nodeId: n.id,
          count: n.metadata.finding_count,
          active: (dashboard?.findings.by_status.NEEDS_EVIDENCE ?? 0) > 0,
        }))
    : [];

  const isEmpty = !graph || graph.nodes.filter(n => n.type === "person" || n.type === "organization").length === 0;
  const showDocument = current.kind === "document";

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
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)" }}>Loading web…</div>
    </div>
  );

  if (error) return (
    <div style={{ flex: 1, display: "flex", flexDirection: "row", minHeight: 0, overflow: "hidden" }}>
      <WebToolbar pendingCount={0} showMinimap={false} onFit={() => {}} onAddAngle={() => {}} onPendingClick={() => {}} onToggleMinimap={() => {}} leadStatus="idle" onRunLead={() => {}} rerunPending={false} onRerunRules={() => {}} />
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-critical)", padding: 24, textAlign: "center" }}>{error}</div>
    </div>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, position: "relative" }}>
      {/* Breadcrumb */}
      <Breadcrumb stack={navStack} onNavigateTo={navigateTo} />

      {/* KPI stats bar — Web Level 1 only */}
      {current.kind === "web" && (
        <WebStatsBar
          findings={dashboard?.findings.total ?? null}
          documents={dashboard?.documents.total ?? null}
          entities={dashboard?.entities.total ?? null}
          daysOpen={daysOpen}
        />
      )}

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

        {/* Level 4 — Document view */}
        {showDocument && current.kind === "document" && (
          <Suspense fallback={fallback("Loading document…")}>
            <DocumentView
              caseId={caseId}
              documentId={current.documentId}
              activeAngleId={(() => {
                const angleEntry = navStack.find(
                  (e): e is Extract<NavEntry, { kind: "angle" }> => e.kind === "angle"
                );
                return angleEntry?.angleId;
              })()}
              onBack={navigateBack}
              onDocumentNavigate={(docId) => {
                const node = graph?.nodes.find((n) => n.id === docId);
                navigate({
                  kind: "document",
                  documentId: docId,
                  docName: node?.label ?? docId.slice(0, 8) + "…",
                });
              }}
            />
          </Suspense>
        )}

        {/* Levels 1–3 — Graph canvas */}
        {!showDocument && current.kind !== "profile" && current.kind !== "angle" && (
          <div className="graph-canvas-dark" style={{ flex: 1, minWidth: 0, position: "relative" }}>
            {isEmpty ? (
              <EmptyWeb onAddAngle={() => { setConnectPrefill({}); setShowConnectModal(true); }} />
            ) : (
              <CytoscapeCanvas
                elements={elements}
                badges={badges}
                onCyInit={(cy) => { cyRef.current = cy; }}
                onNodeClick={handleNodeClick}
                onEdgeClick={handleEdgeClick}
              />
            )}

            {/* Minimap */}
            {showMinimap && !isEmpty && (
              <div className="minimap-container" aria-hidden>
                <CytoscapeCanvas elements={elements} interactionDisabled />
              </div>
            )}
          </div>
        )}

        {/* Level 1 — Always-visible 215px web right panel (wireframe design) */}
        {current.kind === "web" && !showDocument && (
          <div style={{ width: 215, flexShrink: 0, borderLeft: "1px solid var(--border-1)", background: "var(--bg-1)", overflow: "hidden" }}>
            <WebRightPanel
              graph={graph}
              dashboard={dashboard}
              documents={documents}
              selectedEdge={webSelectedEdge}
              onOpenAngle={(angleId, angleTitle) => navigate({ kind: "angle", angleId, angleTitle })}
              onOpenDocument={(documentId, docName) => navigate({ kind: "document", documentId, docName })}
              onClearEdge={() => setWebSelectedEdge(null)}
              leadStatus={leadJob.status}
              leadResult={leadJob.result}
            />
          </div>
        )}

        {/* Level 2 — Profile panel (full-width, no canvas behind it) */}
        {current.kind === "profile" && (
          <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
            <Suspense fallback={fallback("Loading…")}>
              <ProfilePanel
                caseId={caseId}
                entityId={current.entityId}
                entityType={current.entityType}
                entityData={entityData}
                graph={graph}
                onAngleClick={(angleId, angleTitle) => {
                  if (angleId === "") {
                    setConnectPrefill({ entityId: current.entityId, entityName: current.entityName });
                    setShowConnectModal(true);
                  } else {
                    navigate({ kind: "angle", angleId, angleTitle });
                  }
                }}
                onDocumentClick={(docId, docName) => navigate({ kind: "document", documentId: docId, docName })}
                onBack={navigateBack}
              />
            </Suspense>
          </div>
        )}

        {/* Level 3 — Angle view (full-width, canvas hidden) */}
        {current.kind === "angle" && (
          <div style={{ flex: 1, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <Suspense fallback={fallback("Loading…")}>
              <AngleView
                caseId={caseId}
                angleId={current.angleId}
                documents={documents}
                onDocumentClick={(docId, docName) => navigate({ kind: "document", documentId: docId, docName })}
                onBack={navigateBack}
                onAngleTiedOff={() => fetchGraph(caseId).then(setGraph).catch(console.error)}
              />
            </Suspense>
          </div>
        )}
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
              navigate({ kind: "angle", angleId: newAngle.id, angleTitle: newAngle.title });
              fetchGraph(caseId).then(setGraph).catch(console.error);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
