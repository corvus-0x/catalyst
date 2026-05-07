/**
 * ProfilePanel.tsx — Level 2 drill-down: Knot profile in the Web.
 *
 * Vocabulary (from CLAUDE.md / frontend-design-spec.md):
 *   Knot         = Person or Organization node
 *   Angle        = Finding (investigative narrative unit)
 *   Connection   = Graph edge (Relationship / PersonOrganization)
 *   Quick capture = InvestigatorNote attached to a knot
 *   Intake       = Document extraction pipeline (never say "AI")
 *
 * Layout:
 *   Avatar + name + type pill + role tags
 *   Summary stat line
 *   DOCUMENTS section (up to 5, "View all N" if more)
 *   CONNECTIONS section (derived from graph edges)
 *   ANGLES section (non-DISMISSED only, up to 5)
 *   QUICK CAPTURES section (textarea submit)
 */

import { useState, useRef, useEffect } from "react";
import { ArrowLeft, FileText, Users, AlertTriangle, Plus, ChevronRight } from "lucide-react";
import { createNote, fetchNotes } from "../api";
import type {
  PersonDetailResponse,
  OrgDetailResponse,
  RelatedFindingSummary,
  RelatedDocument,
  PersonOrgRole,
  GraphResponse,
  GraphEdge,
  EntityType,
  InvestigatorNote,
} from "../types";

// ---------------------------------------------------------------------------
// Prop types
// ---------------------------------------------------------------------------

interface ProfilePanelProps {
  caseId: string;
  entityId: string;
  entityType: EntityType;
  entityData: PersonDetailResponse | OrgDetailResponse | null;
  graph: GraphResponse | null;
  onAngleClick: (angleId: string, angleTitle: string) => void;
  onDocumentClick: (documentId: string, docName: string) => void;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Small sub-components
// ---------------------------------------------------------------------------

/** Initials circle avatar */
function EntityAvatar({
  name,
  entityType,
}: {
  name: string;
  entityType: EntityType;
}) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

  const cls =
    entityType === "person"
      ? "entity-avatar entity-avatar--person"
      : "entity-avatar entity-avatar--org";

  return <div className={cls}>{initials || "?"}</div>;
}

/** Type pill label shown under the name */
function TypePill({ entityType }: { entityType: EntityType }) {
  const labels: Record<EntityType, string> = {
    person: "Person",
    organization: "Organization",
    property: "Property",
    financial_instrument: "Financial Instrument",
  };
  return (
    <span className="conn-state-badge conn-state-badge--confirmed">
      {labels[entityType] ?? entityType}
    </span>
  );
}

/** Doc type badge — maps DocType to CSS modifier */
function DocBadge({ docType }: { docType: string }) {
  const cls = `doc-badge doc-badge--${docType}`;
  const labels: Record<string, string> = {
    IRS_990: "990",
    DEED: "Deed",
    UCC: "UCC",
    BANK_STATEMENT: "Bank",
    AUDIT_REPORT: "Audit",
    PERMIT: "Permit",
    CONTRACT: "Contract",
    CORRESPONDENCE: "Corr",
    OTHER: "Doc",
    UNKNOWN: "Doc",
  };
  return <span className={cls}>{labels[docType] ?? docType}</span>;
}

/** Connection state badge derived from edge type */
function ConnectionStateBadge({ state }: { state: "confirmed" | "proposed" | "manual" }) {
  const labels = { confirmed: "Confirmed", proposed: "Proposed", manual: "Manual" };
  return (
    <span className={`conn-state-badge conn-state-badge--${state}`}>
      {labels[state]}
    </span>
  );
}

/** Severity badge for an angle */
function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`severity-badge severity-badge--${severity}`}>{severity}</span>
  );
}

/** Angle status badge */
function AngleStatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    NEW: "New",
    NEEDS_EVIDENCE: "Active",
    CONFIRMED: "Confirmed",
    DISMISSED: "Exhausted",
  };
  return (
    <span className={`angle-badge angle-badge--${status}`}>
      {labels[status] ?? status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Skeleton loading state
// ---------------------------------------------------------------------------

function ProfileSkeleton() {
  return (
    <div className="right-panel right-panel--profile">
      <div className="panel-header">
        <div className="skeleton" style={{ width: 64, height: 24 }} />
      </div>
      <div className="panel-scroll">
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16 }}>
          <div className="skeleton" style={{ width: 64, height: 64, borderRadius: "50%" }} />
          <div className="skeleton" style={{ width: "60%", height: 20 }} />
          <div className="skeleton" style={{ width: "40%", height: 16 }} />
          <div className="skeleton" style={{ width: "100%", height: 14 }} />
          <div className="skeleton" style={{ width: "100%", height: 80 }} />
          <div className="skeleton" style={{ width: "100%", height: 80 }} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connections section helpers
// ---------------------------------------------------------------------------

type ConnectionState = "confirmed" | "proposed" | "manual";

interface DerivedConnection {
  edgeId: string;
  otherId: string;
  otherLabel: string;
  relationship: string;
  edgeLabel: string;
  state: ConnectionState;
  supportingDocIds: string[];
}

function deriveConnectionState(edge: GraphEdge): ConnectionState {
  if (edge.relationship === "CO_APPEARS_IN") return "proposed";
  const meta = edge.metadata as Record<string, unknown>;
  if (
    (edge.relationship === "FAMILY" ||
      edge.relationship === "BUSINESS" ||
      edge.relationship === "SOCIAL") &&
    meta.source_type === "MANUAL"
  ) {
    return "manual";
  }
  return "confirmed";
}

function buildConnections(
  entityId: string,
  graph: GraphResponse | null
): DerivedConnection[] {
  if (!graph) return [];

  const nodeIndex = new Map(graph.nodes.map((n) => [n.id, n.label]));

  return graph.edges
    .filter((e) => e.source === entityId || e.target === entityId)
    .map((e) => {
      const otherId = e.source === entityId ? e.target : e.source;
      const otherLabel = nodeIndex.get(otherId) ?? otherId.slice(0, 8) + "…";
      const meta = e.metadata as Record<string, unknown>;
      const docIds: string[] = Array.isArray(meta.document_ids)
        ? (meta.document_ids as string[])
        : [];

      return {
        edgeId: `${e.source}__${e.target}__${e.relationship}`,
        otherId,
        otherLabel,
        relationship: e.relationship,
        edgeLabel: e.label,
        state: deriveConnectionState(e),
        supportingDocIds: docIds,
      };
    });
}

// ---------------------------------------------------------------------------
// Connection list item (with inline expand)
// ---------------------------------------------------------------------------

function ConnectionListItem({
  conn,
  onNavigateToKnot,
}: {
  conn: DerivedConnection;
  onNavigateToKnot?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="panel-list-item">
      <button
        type="button"
        className="icon-btn"
        onClick={() => setExpanded((v) => !v)}
        title={expanded ? "Collapse" : "Expand connection details"}
      >
        <ChevronRight
          size={14}
          style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}
        />
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            className="panel-list-item__label"
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
            onClick={() => onNavigateToKnot?.(conn.otherId)}
            title={`View profile for ${conn.otherLabel}`}
          >
            {conn.otherLabel}
          </button>
          <ConnectionStateBadge state={conn.state} />
        </div>
        <div className="panel-list-item__meta">{conn.edgeLabel}</div>

        {expanded && (
          <div style={{ marginTop: 6 }}>
            {conn.supportingDocIds.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "#6b7280" }}>
                {conn.supportingDocIds.map((docId) => (
                  <li key={docId}>{docId.slice(0, 8)}…</li>
                ))}
              </ul>
            ) : (
              <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>
                No linked documents recorded.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ProfilePanel
// ---------------------------------------------------------------------------

export default function ProfilePanel({
  caseId,
  entityId,
  entityType,
  entityData,
  graph,
  onAngleClick,
  onDocumentClick,
  onBack,
}: ProfilePanelProps) {
  const [noteContent, setNoteContent] = useState("");
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [existingNotes, setExistingNotes] = useState<InvestigatorNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ------------------------------------------------------------------
  // Fetch existing notes on mount / when entity changes
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!entityId) return;
    let cancelled = false;
    setNotesLoading(true);
    fetchNotes(caseId)
      .then((resp) => {
        if (!cancelled) {
          setExistingNotes(resp.results.filter((n) => n.target_id === entityId));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setNotesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, entityId]);

  // ------------------------------------------------------------------
  // Loading skeleton
  // ------------------------------------------------------------------
  if (!entityData) {
    return <ProfileSkeleton />;
  }

  // ------------------------------------------------------------------
  // Derived values from entityData
  // ------------------------------------------------------------------
  const isPerson = entityData.entity_type === "person";
  const isOrg = entityData.entity_type === "organization";

  const personData = isPerson ? (entityData as PersonDetailResponse) : null;
  const orgData = isOrg ? (entityData as OrgDetailResponse) : null;

  const roleTags: string[] = personData?.role_tags ?? [];
  const orgRoles: PersonOrgRole[] = personData?.organization_roles ?? [];

  // Summary stats
  const relatedDocs: RelatedDocument[] = entityData.related_documents ?? [];
  const relatedFindings: RelatedFindingSummary[] = entityData.related_findings ?? [];
  const nonDismissedFindings = relatedFindings.filter((f) => f.status !== "DISMISSED");
  const confirmedCount = relatedFindings.filter((f) => f.status === "CONFIRMED").length;

  // Connections from graph
  const connections = buildConnections(entityId, graph);

  // Note target type for API
  const noteTargetType: "person" | "organization" =
    entityType === "person" ? "person" : "organization";

  // ------------------------------------------------------------------
  // Quick capture submit
  // ------------------------------------------------------------------
  async function handleNoteSubmit() {
    const content = noteContent.trim();
    if (!content || noteSubmitting) return;

    setNoteSubmitting(true);
    setNoteError(null);

    try {
      await createNote(caseId, {
        target_type: noteTargetType,
        target_id: entityId,
        content,
      });
      setNoteContent("");
      setExistingNotes((prev) => [
        ...prev,
        {
          id: `temp-${Date.now()}`,
          case_id: caseId,
          target_type: noteTargetType,
          target_id: entityId,
          content,
          created_by: "",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as InvestigatorNote,
      ]);
      textareaRef.current?.focus();
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : "Failed to save note.");
    } finally {
      setNoteSubmitting(false);
    }
  }

  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleNoteSubmit();
    }
  }

  // ------------------------------------------------------------------
  // Document display helpers
  // ------------------------------------------------------------------
  const DOCS_VISIBLE = 5;
  const visibleDocs = relatedDocs.slice(0, DOCS_VISIBLE);
  const hiddenDocCount = relatedDocs.length - DOCS_VISIBLE;

  // ------------------------------------------------------------------
  // Angles display helpers
  // ------------------------------------------------------------------
  const ANGLES_VISIBLE = 5;
  const visibleAngles = nonDismissedFindings.slice(0, ANGLES_VISIBLE);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="right-panel right-panel--profile">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="panel-header">
        <button type="button" className="back-btn" onClick={onBack} title="Back to web">
          <ArrowLeft size={14} />
          Web
        </button>
      </div>

      <div className="panel-scroll">
        {/* ── Avatar + identity block ──────────────────────────────── */}
        <div className="panel-section" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <EntityAvatar name={entityData.name} entityType={entityType} />

          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, lineHeight: 1.3 }}>
              {entityData.name}
            </h2>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
              <TypePill entityType={entityType} />
              {orgData?.ein && (
                <span style={{ fontSize: 11, color: "#6b7280" }}>EIN {orgData.ein}</span>
              )}
            </div>
          </div>

          {/* Role tags */}
          {roleTags.length > 0 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {roleTags.map((tag) => (
                <span key={tag} className="conn-state-badge conn-state-badge--confirmed">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Date of birth / death */}
          {personData?.date_of_death && (
            <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>
              Deceased {personData.date_of_death.slice(0, 10)}
            </p>
          )}

          {/* Organization roles */}
          {orgRoles.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", fontSize: 12, color: "#6b7280" }}>
              {orgRoles.map((r) => (
                <li key={`${r.organization_id}-${r.role}`}>
                  {r.role} — {r.organization_name}
                  {r.start_date && ` (${r.start_date.slice(0, 4)}–${r.end_date?.slice(0, 4) ?? "present"})`}
                </li>
              ))}
            </ul>
          )}

          {/* Summary stat line */}
          <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>
            {nonDismissedFindings.length} active angle{nonDismissedFindings.length !== 1 ? "s" : ""}
            {" · "}
            {confirmedCount} confirmed
            {" · "}
            {relatedDocs.length} doc{relatedDocs.length !== 1 ? "s" : ""}
            {" · "}
            {connections.length} connection{connections.length !== 1 ? "s" : ""}
          </p>
        </div>

        {/* ── DOCUMENTS ─────────────────────────────────────────────── */}
        <div className="panel-section">
          <div
            className="panel-section__title"
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <FileText size={13} />
            Documents
          </div>

          {visibleDocs.length === 0 ? (
            <p className="empty-state__body" style={{ fontSize: 12 }}>
              No documents linked to this knot.
            </p>
          ) : (
            <>
              {visibleDocs.map((doc) => {
                const label = doc.display_name || doc.filename;
                return (
                  <button
                    type="button"
                    key={doc.id}
                    className="panel-list-item"
                    style={{ background: "none", border: "none", width: "100%", cursor: "pointer", textAlign: "left" }}
                    onClick={() => onDocumentClick(doc.id, label)}
                    title={`Open ${label}`}
                  >
                    <DocBadge docType={doc.doc_type} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="panel-list-item__label">{label}</div>
                      {doc.page_reference && (
                        <div className="panel-list-item__meta">{doc.page_reference}</div>
                      )}
                    </div>
                  </button>
                );
              })}

              {hiddenDocCount > 0 && (
                <p style={{ fontSize: 12, color: "#6b7280", margin: "4px 0 0" }}>
                  View all {relatedDocs.length} documents
                </p>
              )}
            </>
          )}
        </div>

        {/* ── CONNECTIONS ───────────────────────────────────────────── */}
        <div className="panel-section">
          <div
            className="panel-section__title"
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <Users size={13} />
            Connections
          </div>

          {connections.length === 0 ? (
            <p className="empty-state__body" style={{ fontSize: 12 }}>
              No connections found in the web.
            </p>
          ) : (
            connections.map((conn) => (
              <ConnectionListItem
                key={conn.edgeId}
                conn={conn}
              />
            ))
          )}
        </div>

        {/* ── ANGLES ────────────────────────────────────────────────── */}
        <div className="panel-section">
          <div
            className="panel-section__title"
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <AlertTriangle size={13} />
            Angles
          </div>

          {nonDismissedFindings.length === 0 ? (
            <p className="empty-state__body" style={{ fontSize: 12 }}>
              No active angles for this knot.
            </p>
          ) : (
            visibleAngles.map((finding) => (
              <button
                type="button"
                key={finding.id}
                className="panel-list-item"
                style={{ background: "none", border: "none", width: "100%", cursor: "pointer", textAlign: "left" }}
                onClick={() => onAngleClick(finding.id, finding.title)}
                title={`Open angle: ${finding.title}`}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className="panel-list-item__label"
                    style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
                  >
                    <AngleStatusBadge status={finding.status} />
                    <SeverityBadge severity={finding.severity} />
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {finding.title}
                    </span>
                  </div>
                  {finding.context_note && (
                    <div className="panel-list-item__meta">{finding.context_note}</div>
                  )}
                </div>
              </button>
            ))
          )}

          {/* New angle from this entity */}
          <button
            type="button"
            className="toolbar-btn"
            style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 4 }}
            onClick={() => onAngleClick("", "new")}
            title="Start a new angle involving this knot"
          >
            <Plus size={13} />
            New angle from this knot
          </button>
        </div>

        {/* ── QUICK CAPTURES ────────────────────────────────────────── */}
        <div className="panel-section">
          <div className="panel-section__title">Quick Captures</div>

          {/* Existing notes */}
          {notesLoading && (
            <div className="skeleton" style={{ height: 40, borderRadius: 4, marginBottom: 8 }} />
          )}
          {!notesLoading && existingNotes.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px", display: "flex", flexDirection: "column", gap: 6 }}>
              {existingNotes.map((note) => (
                <li
                  key={note.id}
                  style={{
                    background: "#FAEEDA",
                    border: "0.5px solid #FAC775",
                    borderRadius: 6,
                    padding: "7px 10px",
                  }}
                >
                  <p style={{ fontSize: 12, color: "#633806", lineHeight: 1.5, margin: 0 }}>
                    {note.content}
                  </p>
                  <p style={{ fontSize: 10, color: "#854F0B", marginTop: 3, margin: "3px 0 0" }}>
                    {new Date(note.created_at).toLocaleDateString()}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {/* Add new note */}
          <textarea
            ref={textareaRef}
            className="quick-capture"
            value={noteContent}
            onChange={(e) => setNoteContent(e.target.value)}
            onKeyDown={handleTextareaKeyDown}
            placeholder="Add quick capture… (Enter to save, Shift+Enter for newline)"
            rows={3}
            disabled={noteSubmitting}
          />

          {noteError && (
            <p style={{ fontSize: 12, color: "#ef4444", margin: "4px 0 0" }}>{noteError}</p>
          )}

          <button
            type="button"
            className="btn-primary"
            style={{ marginTop: 6 }}
            onClick={() => void handleNoteSubmit()}
            disabled={!noteContent.trim() || noteSubmitting}
          >
            {noteSubmitting ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
