/**
 * SubjectInspector — compact (~340 px) rail shown beside the Case Map when a subject node
 * is clicked. NOT a squeezed ProfilePanel: it gives a quick identity + context summary and
 * surfaces the three most important actions (add observation, start thread, open full profile).
 *
 * Data sources (all existing, no new endpoints):
 *   fetchEntityDetail(entityType, subjectId) → identity, source-trail docs, related findings
 *   fetchNotes(caseId)                       → filtered to target_id === subjectId
 *   caseMap (prop)                           → relationship count + top related subjects
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchEntityDetail, fetchNotes, createNote } from "../api";
import { sectionLabel } from "./inspectorChrome";
import type {
  CaseMapResponse,
  InvestigatorNote,
  NoteTargetType,
  PersonDetailResponse,
  OrgDetailResponse,
  RelatedDocument,
  RelatedFindingSummary,
} from "../types";
import type { SubjectEntityType } from "../context/CaseWorkspaceContext";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SubjectInspectorProps {
  caseId: string;
  subjectId: string;
  entityType: SubjectEntityType;
  caseMap: CaseMapResponse;
  /** Returns a display label for any subject id in the case map */
  subjectLabel: (id: string) => string;
  onSelectRelationship: (edgeId: string) => void;
  onStartThread: () => void;
  onCite: () => void;
  onOpenProfile: () => void;
  onClear: () => void;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type EntityDetail = PersonDetailResponse | OrgDetailResponse;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function levelColor(level: string): string {
  switch (level) {
    case "material":    return "var(--color-critical, #f87171)";
    case "repeated":    return "#fbbf24";
    case "documented":  return "var(--color-info, #60a5fa)";
    default:            return "var(--text-3)";
  }
}

// ---------------------------------------------------------------------------
// SubjectInspector
// ---------------------------------------------------------------------------

export default function SubjectInspector({
  caseId,
  subjectId,
  entityType,
  caseMap,
  subjectLabel,
  onSelectRelationship,
  onStartThread,
  onCite,
  onOpenProfile,
  onClear,
}: SubjectInspectorProps) {
  const [detail, setDetail]       = useState<EntityDetail | null>(null);
  const [notes, setNotes]         = useState<InvestigatorNote[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [obsInput, setObsInput]   = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Fetch entity detail + notes on mount / subject change
  useEffect(() => {
    setDetail(null);
    setNotes([]);
    setLoadingDetail(true);
    setLoadError(false);

    Promise.all([
      fetchEntityDetail(entityType, subjectId),
      fetchNotes(caseId),
    ])
      .then(([d, n]) => {
        setDetail(d as EntityDetail);
        setNotes(n.results.filter((note) => note.target_id === subjectId));
      })
      .catch((err) => {
        console.error("SubjectInspector fetch error:", err);
        setLoadError(true);
        toast.error("Couldn't load subject details.");
      })
      .finally(() => setLoadingDetail(false));
  }, [caseId, subjectId, entityType]);

  // Derive relationships from caseMap edges touching this subject
  const relatedEdges = caseMap.edges
    .filter((e) => e.source === subjectId || e.target === subjectId)
    .sort((a, b) => b.strength.score - a.strength.score);

  const topEdges = relatedEdges.slice(0, 5);

  // Counts
  const docCount     = detail?.related_documents.length ?? 0;
  const relCount     = relatedEdges.length;
  const threadCount  = (detail?.related_findings ?? []).length;
  const substantiated = (detail?.related_findings ?? []).filter(
    (f: RelatedFindingSummary) => f.status === "CONFIRMED"
  ).length;

  // Add observation handler
  async function handleAddObs() {
    if (!obsInput.trim()) return;
    setSubmitting(true);
    try {
      await createNote(caseId, {
        target_type: entityType as NoteTargetType,
        target_id: subjectId,
        content: obsInput.trim(),
      });
      // Only clear the input after a successful write — a refetch failure must not
      // make it look like nothing was saved.
      setObsInput("");
    } catch (err) {
      console.error("createNote failed:", err);
      toast.error("Couldn't save observation — try again.");
      setSubmitting(false);
      return;
    }
    // Best-effort refetch — failure here does NOT undo the successful write.
    try {
      const fresh = await fetchNotes(caseId);
      setNotes(fresh.results.filter((note) => note.target_id === subjectId));
    } catch (err) {
      console.error("SubjectInspector: notes refetch failed after createNote", err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        fontSize: 12,
        color: "var(--text-1)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 10px",
          borderBottom: "1px solid var(--border-1)",
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-3)" }}>
          Subject
        </div>
        <button
          type="button"
          onClick={onClear}
          aria-label="Close inspector"
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", fontSize: 14, lineHeight: 1, padding: "0 2px" }}
        >
          ×
        </button>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 10px 12px" }}>

        {/* Identity */}
        {loadingDetail ? (
          <div style={{ padding: "12px 0", color: "var(--text-3)" }}>Loading…</div>
        ) : loadError ? (
          <div style={{ padding: "12px 0", color: "var(--color-critical, #f87171)", fontSize: 12 }}>
            Couldn't load subject.
          </div>
        ) : (
          <>
            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 8 }}>
              {detail?.name ?? subjectId}
            </div>
            {detail && "role_tags" in detail && (detail as PersonDetailResponse).role_tags.length > 0 && (
              <div style={{ color: "var(--text-3)", marginTop: 2 }}>
                {(detail as PersonDetailResponse).role_tags.join(", ")}
              </div>
            )}
            {detail && "ein" in detail && (detail as OrgDetailResponse).ein && (
              <div style={{ color: "var(--text-3)", marginTop: 2 }}>
                EIN: {(detail as OrgDetailResponse).ein}
              </div>
            )}
          </>
        )}

        {/* Counts */}
        {sectionLabel("At a glance")}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[
            { label: "Docs",           value: docCount },
            { label: "Relationships",  value: relCount },
            { label: "Threads",        value: threadCount },
            { label: "Substantiated",  value: substantiated },
          ].map(({ label, value }) => (
            <div
              key={label}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                background: "var(--bg-2, rgba(255,255,255,0.04))",
                borderRadius: 4,
                padding: "4px 8px",
                minWidth: 48,
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 13 }}>{value}</span>
              <span style={{ fontSize: 9, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
            </div>
          ))}
        </div>

        {/* Top relationships */}
        {topEdges.length > 0 && (
          <>
            {sectionLabel("Top relationships")}
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {topEdges.map((edge) => {
                const peerId = edge.source === subjectId ? edge.target : edge.source;
                return (
                  <button
                    key={edge.id}
                    type="button"
                    onClick={() => onSelectRelationship(edge.id)}
                    style={{
                      background: "none",
                      border: "1px solid var(--border-1)",
                      borderRadius: 4,
                      padding: "4px 8px",
                      textAlign: "left",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 6,
                      color: "var(--text-1)",
                      fontSize: 11,
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {subjectLabel(peerId)}
                    </span>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: levelColor(edge.strength.level),
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        flexShrink: 0,
                      }}
                    >
                      {edge.strength.level}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* Source trail */}
        {!loadingDetail && detail && detail.related_documents.length > 0 && (
          <>
            {sectionLabel("Source trail")}
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {detail.related_documents.slice(0, 5).map((doc: RelatedDocument) => (
                <div
                  key={doc.id}
                  style={{
                    fontSize: 11,
                    color: "var(--text-2)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={doc.filename}
                >
                  {doc.display_name || doc.filename}
                </div>
              ))}
              {detail.related_documents.length > 5 && (
                <div style={{ fontSize: 10, color: "var(--text-3)" }}>
                  +{detail.related_documents.length - 5} more
                </div>
              )}
            </div>
          </>
        )}

        {/* Observations */}
        {sectionLabel("Observations")}
        {notes.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>No observations yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {notes.map((note) => (
              <div
                key={note.id}
                style={{
                  fontSize: 11,
                  color: "var(--text-2)",
                  background: "var(--bg-2, rgba(255,255,255,0.04))",
                  borderRadius: 4,
                  padding: "4px 8px",
                }}
              >
                {note.content}
              </div>
            ))}
          </div>
        )}

        {/* Add observation input */}
        <div style={{ marginTop: 8 }}>
          <label
            htmlFor="subject-inspector-obs"
            style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", display: "block", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.04em" }}
          >
            New observation
          </label>
          <textarea
            id="subject-inspector-obs"
            aria-label="New observation"
            value={obsInput}
            onChange={(e) => setObsInput(e.target.value)}
            rows={2}
            style={{
              width: "100%",
              resize: "vertical",
              fontSize: 11,
              background: "var(--bg-2, rgba(255,255,255,0.06))",
              border: "1px solid var(--border-1)",
              borderRadius: 4,
              color: "var(--text-1)",
              padding: "4px 6px",
              boxSizing: "border-box",
            }}
          />
          <button
            type="button"
            onClick={handleAddObs}
            disabled={submitting || !obsInput.trim()}
            style={{
              marginTop: 4,
              fontSize: 11,
              padding: "4px 10px",
              borderRadius: 4,
              border: "1px solid var(--border-1)",
              background: "var(--bg-2, rgba(255,255,255,0.08))",
              color: "var(--text-1)",
              cursor: submitting || !obsInput.trim() ? "default" : "pointer",
              opacity: submitting || !obsInput.trim() ? 0.5 : 1,
            }}
          >
            Add observation
          </button>
        </div>
      </div>

      {/* Actions footer */}
      <div
        style={{
          flexShrink: 0,
          borderTop: "1px solid var(--border-1)",
          padding: "8px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <button
          type="button"
          onClick={onStartThread}
          style={{
            fontSize: 11,
            padding: "5px 0",
            borderRadius: 4,
            border: "1px solid var(--border-1)",
            background: "none",
            color: "var(--text-1)",
            cursor: "pointer",
            width: "100%",
          }}
        >
          Start thread
        </button>
        <button
          type="button"
          onClick={onCite}
          style={{
            fontSize: 11,
            padding: "5px 0",
            borderRadius: 4,
            border: "1px solid var(--border-1)",
            background: "none",
            color: "var(--text-1)",
            cursor: "pointer",
            width: "100%",
          }}
        >
          Cite into active thread
        </button>
        <button
          type="button"
          onClick={onOpenProfile}
          style={{
            fontSize: 11,
            padding: "5px 0",
            borderRadius: 4,
            border: "none",
            background: "var(--color-accent, rgba(99,102,241,0.2))",
            color: "var(--text-1)",
            cursor: "pointer",
            fontWeight: 600,
            width: "100%",
          }}
        >
          Open full profile
        </button>
      </div>
    </div>
  );
}
