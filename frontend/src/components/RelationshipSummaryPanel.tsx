import { X } from "lucide-react";
import type { SummaryEdge } from "../types";

interface Props {
  edge: SummaryEdge;
  subjectLabel: (id: string) => string;
  onClear: () => void;
}

const LEVEL_TEXT: Record<SummaryEdge["strength"]["level"], string> = {
  observed: "Observed relationship",
  documented: "Documented relationship",
  repeated: "Repeated relationship",
  material: "Material relationship",
};

export default function RelationshipSummaryPanel({ edge, subjectLabel, onClear }: Props) {
  const s = edge.strength;
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

      <hr style={{ border: "none", borderTop: "0.5px solid var(--border-1)", margin: "8px 0" }} />
      <div style={{ fontSize: 10, color: "var(--text-3)" }}>
        Relationship strength reflects source support and investigative relevance. It does not imply
        wrongdoing by either subject.
      </div>
    </div>
  );
}
