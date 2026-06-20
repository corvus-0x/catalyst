import { FileText, Flag, X } from "lucide-react";
import type { SummaryEdge } from "../types";

interface Props {
  edge: SummaryEdge;
  subjectLabel: (id: string) => string;
  onClear: () => void;
  onOpenSource: (documentId: string) => void;
  onSelectThread: (threadId: string) => void;
  onStartThread: () => void;
}

const LEVEL_TEXT: Record<SummaryEdge["strength"]["level"], string> = {
  observed: "Observed relationship",
  documented: "Documented relationship",
  repeated: "Repeated relationship",
  material: "Material relationship",
};

const STATUS_LABEL: Record<string, string> = {
  NEW: "New",
  NEEDS_EVIDENCE: "Active",
  CONFIRMED: "Substantiated",
  DISMISSED: "Set aside",
};

export default function RelationshipSummaryPanel({
  edge,
  subjectLabel,
  onClear,
  onOpenSource,
  onSelectThread,
  onStartThread,
}: Props) {
  const s = edge.strength;

  const supportingDocs = edge.evidence_refs.filter((r) => r.document_id != null);
  const threads = edge.thread_refs;

  return (
    <div style={{ padding: 12, fontSize: 11, overflowY: "auto", height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-3)" }}>
          Relationship
        </div>
        <button type="button" onClick={onClear} aria-label="Close relationship detail"
          style={{ background: "none", border: "none", color: "var(--text-3)", cursor: "pointer" }}>
          <X size={14} />
        </button>
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", margin: "6px 0 2px" }}>
        {subjectLabel(edge.source)} — {subjectLabel(edge.target)}
      </div>
      <div style={{ color: "var(--text-2)", marginBottom: 8 }}>{LEVEL_TEXT[s.level]}</div>

      {s.categories.length > 0 && (
        <div data-testid="strength-categories" style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", marginBottom: 4 }}>Evidence categories</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {s.categories.map((c) => (
              <span key={c} style={{ border: "1px solid var(--border-1)", borderRadius: 999, padding: "1px 7px", color: "var(--text-2)" }}>{c}</span>
            ))}
          </div>
        </div>
      )}

      {s.reasons.length > 0 && (
        <div data-testid="strength-reasons" style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", marginBottom: 4 }}>Why this line exists</div>
          <ul style={{ margin: 0, paddingLeft: 16, color: "var(--text-2)" }}>
            {s.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      )}

      {edge.underlying_relationships.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", marginBottom: 4 }}>Underlying evidence</div>
          <ul style={{ margin: 0, paddingLeft: 16, color: "var(--text-2)" }}>
            {edge.underlying_relationships.map((u) => <li key={u.source_id}>{u.label}</li>)}
          </ul>
        </div>
      )}

      {supportingDocs.length > 0 && (
        <div data-testid="supporting-documents" style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", marginBottom: 4 }}>Supporting documents</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {supportingDocs.map((ref) => (
              <button
                key={ref.document_id}
                type="button"
                onClick={() => onOpenSource(ref.document_id!)}
                style={{
                  display: "flex", alignItems: "center", gap: 5, background: "none",
                  border: "none", color: "var(--accent, #58a6ff)", cursor: "pointer",
                  fontSize: 11, padding: "2px 0", textAlign: "left",
                }}
              >
                <FileText size={12} aria-hidden />
                {ref.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {threads.length > 0 && (
        <div data-testid="threads-using" style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", marginBottom: 4 }}>Threads using this relationship</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {threads.map((t) => (
              <button
                key={t.thread_id}
                type="button"
                onClick={() => onSelectThread(t.thread_id)}
                style={{
                  display: "flex", alignItems: "center", gap: 5, background: "none",
                  border: "none", color: "var(--text-2)", cursor: "pointer",
                  fontSize: 11, padding: "2px 0", textAlign: "left",
                }}
              >
                <span
                  className={`severity-badge severity-badge--${t.severity.toLowerCase()}`}
                  style={{ flexShrink: 0 }}
                >
                  {t.severity}
                </span>
                <span style={{ flex: 1 }}>{t.title}</span>
                <span style={{ color: "var(--text-3)", fontSize: 10, flexShrink: 0 }}>
                  {STATUS_LABEL[t.status] ?? t.status}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <button
          type="button"
          onClick={onStartThread}
          style={{
            display: "flex", alignItems: "center", gap: 4, background: "none",
            border: "1px solid var(--border-1)", borderRadius: 4, color: "var(--text-2)",
            cursor: "pointer", fontSize: 10, padding: "3px 8px",
          }}
        >
          <Flag size={11} aria-hidden />
          Start thread
        </button>
      </div>

      <hr style={{ border: "none", borderTop: "0.5px solid var(--border-1)", margin: "8px 0" }} />
      <div style={{ fontSize: 10, color: "var(--text-3)" }}>
        Relationship strength reflects source support and investigative relevance. It does not imply
        wrongdoing by either subject.
      </div>
    </div>
  );
}
