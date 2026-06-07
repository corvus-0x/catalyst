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
 * Layout: two-column — .knot-left identity sidebar + .knot-main sections
 */

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { createNote, fetchNotes, updateNote, deleteNote } from "../api";
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

/** Initials circle avatar using new knot-avatar classes */
function EntityAvatar({ name, entityType }: { name: string; entityType: EntityType }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

  return (
    <div className={`knot-avatar knot-avatar--${entityType}`}>
      {initials || "?"}
    </div>
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
    <div className="knot-view">
      <div className="knot-left">
        <div className="skeleton" style={{ width: 48, height: 48, borderRadius: "50%", marginBottom: 10 }} />
        <div className="skeleton" style={{ width: "70%", height: 18, marginBottom: 6 }} />
        <div className="skeleton" style={{ width: "40%", height: 14, marginBottom: 12 }} />
        <div className="skeleton" style={{ width: "100%", height: 80 }} />
      </div>
      <div className="knot-main">
        <div className="skeleton" style={{ width: "100%", height: 120 }} />
        <div className="skeleton" style={{ width: "100%", height: 80 }} />
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
  otherType: "person" | "organization";
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
        otherType: (graph?.nodes.find((n) => n.id === otherId)?.type === "person" ? "person" : "organization") as "person" | "organization",
        relationship: e.relationship,
        edgeLabel: e.label,
        state: deriveConnectionState(e),
        supportingDocIds: docIds,
      };
    });
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
  const [showQuickCapture, setShowQuickCapture] = useState(false);
  const [captureText, setCaptureText] = useState("");
  const [savingCapture, setSavingCapture] = useState(false);
  const [notes, setNotes] = useState<InvestigatorNote[]>([]);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  // ------------------------------------------------------------------
  // Reset quick capture UI when the entity changes
  // ------------------------------------------------------------------
  useEffect(() => {
    setShowQuickCapture(false);
    setCaptureText("");
  }, [entityId]);

  // ------------------------------------------------------------------
  // Fetch existing notes on mount / when entity changes
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!entityId) return;
    let cancelled = false;
    fetchNotes(caseId)
      .then((resp) => {
        if (!cancelled) {
          setNotes(resp.results.filter((n) => n.target_id === entityId));
        }
      })
      .catch(() => {});
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

  const orgData = isOrg ? (entityData as OrgDetailResponse) : null;

  const orgSubtype = orgData?.org_type;

  // name for display
  const name = entityData.name;

  // Related data
  const documents: RelatedDocument[] = entityData.related_documents ?? [];
  const relatedFindings: RelatedFindingSummary[] = entityData.related_findings ?? [];
  const angles = relatedFindings.filter((f) => f.status !== "DISMISSED");

  // Connections from graph
  const connections = buildConnections(entityId, graph);

  // Note target type for API
  const noteTargetType: "person" | "organization" =
    entityType === "person" ? "person" : "organization";

  // Meta rows for the left-column table
  const metaRows: { label: string; value: string }[] = [];
  if (orgData?.ein) {
    metaRows.push({ label: "EIN", value: orgData.ein });
  }
  if (orgData?.registration_state) {
    metaRows.push({ label: "State", value: orgData.registration_state });
  }
  if (orgData?.formation_date) {
    metaRows.push({ label: "Formed", value: orgData.formation_date.slice(0, 10) });
  }
  if (orgData?.status) {
    metaRows.push({ label: "Status", value: orgData.status });
  }
  const personDetail = isPerson ? (entityData as PersonDetailResponse) : null;
  if (personDetail?.date_of_death) {
    metaRows.push({ label: "Deceased", value: personDetail.date_of_death.slice(0, 10) });
  }
  const orgRoles: PersonOrgRole[] = personDetail?.organization_roles ?? [];
  orgRoles.forEach((r) => {
    metaRows.push({
      label: r.role,
      value: `${r.organization_name}${r.start_date ? ` (${r.start_date.slice(0, 4)}–${r.end_date?.slice(0, 4) ?? "present"})` : ""}`,
    });
  });

  // ------------------------------------------------------------------
  // Quick capture submit
  // ------------------------------------------------------------------
  async function handleSaveCapture() {
    const content = captureText.trim();
    if (!content || savingCapture) return;

    setSavingCapture(true);
    try {
      const created = await createNote(caseId, {
        target_type: noteTargetType,
        target_id: entityId,
        content,
      });
      setCaptureText("");
      setShowQuickCapture(false);
      setNotes((prev) => [...prev, created]);
    } catch {
      toast.error("Failed to save quick capture.");
    } finally {
      setSavingCapture(false);
    }
  }

  async function handleUpdateNote(noteId: string) {
    const content = editContent.trim();
    if (!content) return;
    try {
      const updated = await updateNote(caseId, noteId, { content });
      setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)));
      setEditingNoteId(null);
    } catch {
      toast.error("Failed to update quick capture.");
    }
  }

  async function handleDeleteNote(noteId: string) {
    try {
      await deleteNote(caseId, noteId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch {
      toast.error("Failed to delete quick capture.");
    }
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="knot-view">
      {/* ── Left column: entity identity ── */}
      <div className="knot-left">
        <button type="button" className="back-btn" onClick={onBack} style={{ marginBottom: 14 }}>
          ← Investigation web
        </button>

        <EntityAvatar name={name} entityType={entityType} />
        <div className="knot-name">{name}</div>
        <span className={`knot-type-badge knot-type-badge--${entityType}`}>
          {entityType === "person" ? "Person" : (orgSubtype ?? "Organization")}
        </span>

        {metaRows.length > 0 && (
          <table className="knot-meta-table">
            <tbody>
              {metaRows.map(({ label, value }, i) => (
                <tr key={`${label}-${i}`}>
                  <td className="knot-meta-label">{label}</td>
                  <td className="knot-meta-value">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="knot-divider" />

        <div className="knot-stat-grid">
          <div className="knot-stat">
            <div className="knot-stat__num knot-stat__num--accent">{angles.length}</div>
            <div className="knot-stat__lbl">Angles</div>
          </div>
          <div className="knot-stat">
            <div className="knot-stat__num knot-stat__num--success">
              {angles.filter((a) => a.status === "CONFIRMED").length}
            </div>
            <div className="knot-stat__lbl">Confirmed</div>
          </div>
          <div className="knot-stat">
            <div className="knot-stat__num knot-stat__num--neutral">{documents.length}</div>
            <div className="knot-stat__lbl">Docs</div>
          </div>
        </div>

        <div className="knot-divider" />

        <button type="button" className="quick-cap-btn" onClick={() => setShowQuickCapture(true)}>
          + Quick capture…
        </button>
        {showQuickCapture && (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            <textarea
              className="quick-capture"
              placeholder="Note something about this knot…"
              value={captureText}
              onChange={(e) => setCaptureText(e.target.value)}
              rows={3}
            />
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: 11, padding: "3px 8px" }}
                onClick={() => { setShowQuickCapture(false); setCaptureText(""); }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ fontSize: 11, padding: "3px 8px" }}
                disabled={!captureText.trim() || savingCapture}
                onClick={() => void handleSaveCapture()}
              >
                {savingCapture ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Right column: sections ── */}
      <div className="knot-main">

        {/* Angles */}
        <div>
          <div className="knot-section-head">
            <span className="knot-section-title">Angles</span>
          </div>
          {angles.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-3)", padding: "8px 0" }}>No angles yet.</div>
          ) : (
            angles.map((a) => (
              <div key={a.id} className="angle-card" onClick={() => onAngleClick(a.id, a.title)}>
                <div className={`angle-card__bar angle-card__bar--${a.severity}`} />
                <div className="angle-card__info">
                  <div className="angle-card__title">{a.title}</div>
                  <div className="angle-card__meta">{a.severity}</div>
                </div>
                <AngleStatusBadge status={a.status} />
              </div>
            ))
          )}
        </div>

        {/* Connections */}
        <div>
          <div className="knot-section-head">
            <span className="knot-section-title">Connections</span>
          </div>
          {connections.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-3)", padding: "8px 0" }}>No connections.</div>
          ) : (
            connections.map((c) => (
              <div key={c.edgeId} className="conn-card">
                <div className={`conn-card__dot conn-card__dot--${c.otherType}`} />
                <div>
                  <div className="conn-card__name">{c.otherLabel}</div>
                  <div className="conn-card__role">{c.edgeLabel}</div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Documents */}
        <div>
          <div className="knot-section-head">
            <span className="knot-section-title">Source documents</span>
          </div>
          {documents.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-3)", padding: "8px 0" }}>No documents linked.</div>
          ) : (
            documents.map((d) => (
              <div key={d.id} className="doc-row" onClick={() => onDocumentClick(d.id, d.filename)}>
                <DocBadge docType={d.doc_type} />
                <span className="doc-row__name">{d.display_name || d.filename}</span>
                <span className="doc-row__meta">{d.doc_type}</span>
              </div>
            ))
          )}
        </div>

        {/* Quick captures list */}
        {notes.length > 0 && (
          <div>
            <div className="knot-section-head">
              <span className="knot-section-title">Quick captures</span>
            </div>
            {notes.map((n) => (
              <div key={n.id} className="quick-capture-item">
                {editingNoteId === n.id ? (
                  <>
                    <textarea
                      className="quick-capture"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={2}
                      autoFocus
                    />
                    <div className="quick-capture-item__actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ fontSize: 11, padding: "3px 8px" }}
                        onClick={() => setEditingNoteId(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn-primary"
                        style={{ fontSize: 11, padding: "3px 8px" }}
                        disabled={!editContent.trim()}
                        onClick={() => void handleUpdateNote(n.id)}
                      >
                        Save
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="quick-capture-item__row">
                    <span className="quick-capture-item__text">{n.content}</span>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Edit quick capture"
                      onClick={() => { setEditingNoteId(n.id); setEditContent(n.content); }}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn--danger"
                      title="Delete quick capture"
                      onClick={() => void handleDeleteNote(n.id)}
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
