/**
 * ThreadInspector — compact (~320 px) rail shown beside the Case Map when a thread
 * (Finding) is selected from a RelationshipSummaryPanel thread_ref row.
 *
 * This is a BRIDGE component: it gives a quick summary of the thread and surfaces
 * the "Open full Thread" action, which takes the investigator to the full AngleView
 * (where substantiation, tie-off, and narrative editing live).
 *
 * Actions:
 *   - Cite source  → opens CiteDocumentPicker → updateAngle(add_document_ids:[docId])
 *   - Set aside    → updateAngle(status:"DISMISSED"), un-gated (tie-off gate only
 *                    governs transitions INTO CONFIRMED, not OUT via DISMISSED)
 *   - Open full Thread → onOpenThread() — parent dispatches openThread → AngleView
 *
 * Props: { caseId, threadId, onOpenThread, onClear, onChanged }
 */

import { useEffect, useState } from "react";
import { fetchAngle, updateAngle } from "../api";
import type { FindingItem, FindingSeverity, FindingStatus } from "../types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ThreadInspectorProps {
  caseId: string;
  threadId: string;
  onOpenThread: () => void;
  onClear: () => void;
  onChanged: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function severityColor(severity: FindingSeverity): string {
  switch (severity) {
    case "CRITICAL": return "var(--color-critical, #f87171)";
    case "HIGH":     return "#fbbf24";
    case "MEDIUM":   return "var(--color-info, #60a5fa)";
    default:         return "var(--text-3)";
  }
}

function statusLabel(status: FindingStatus): string {
  switch (status) {
    case "CONFIRMED":      return "Substantiated";
    case "DISMISSED":      return "Set Aside";
    case "NEEDS_EVIDENCE": return "Developing";
    default:               return "Untriaged";
  }
}

function statusColor(status: FindingStatus): string {
  switch (status) {
    case "CONFIRMED": return "var(--color-success, #34d399)";
    case "DISMISSED": return "var(--text-3)";
    default:          return "#fbbf24";
  }
}

function sectionLabel(text: string) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color: "var(--text-3)",
        marginTop: 12,
        marginBottom: 4,
      }}
    >
      {text}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ThreadInspector
// ---------------------------------------------------------------------------

export default function ThreadInspector({
  caseId,
  threadId,
  onOpenThread,
  onClear,
  onChanged,
}: ThreadInspectorProps) {
  const [thread, setThread]   = useState<FindingItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [setAside, setSetAside] = useState(false);

  // Fetch the full finding on mount / threadId change
  useEffect(() => {
    setThread(null);
    setLoading(true);
    fetchAngle(caseId, threadId)
      .then((t) => setThread(t))
      .catch((err) => console.error("ThreadInspector: fetchAngle failed", err))
      .finally(() => setLoading(false));
  }, [caseId, threadId]);

  // Set aside handler — un-gated (DISMISSED transition has no gate)
  async function handleSetAside() {
    if (!thread || setAside) return;
    setSetAside(true);
    try {
      await updateAngle(caseId, threadId, { status: "DISMISSED" });
      onChanged();
    } catch (err) {
      console.error("ThreadInspector: set-aside failed", err);
    } finally {
      setSetAside(false);
    }
  }

  const citedCount = thread?.document_links.length ?? 0;
  const isSetAside = thread?.status === "DISMISSED";

  // Readiness gap summary
  function gapSummary(): string {
    if (!thread) return "";
    const gaps: string[] = [];
    if (citedCount === 0) gaps.push("No cited sources");
    if (!["DOCUMENTED", "TRACED"].includes(thread.evidence_weight))
      gaps.push("Evidence weight below Documented");
    if (!thread.overreach_reviewed) gaps.push("Overreach not reviewed");
    if (thread.status !== "CONFIRMED") gaps.push("Not yet substantiated");
    if (gaps.length === 0) return "All referral-grade conditions met.";
    return gaps.join(" · ");
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
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: "var(--text-3)",
          }}
        >
          Thread
        </div>
        <button
          type="button"
          onClick={onClear}
          aria-label="Close inspector"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-3)",
            fontSize: 14,
            lineHeight: 1,
            padding: "0 2px",
          }}
        >
          ×
        </button>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 10px 12px" }}>
        {loading ? (
          <div style={{ padding: "12px 0", color: "var(--text-3)" }}>Loading…</div>
        ) : thread === null ? (
          <div style={{ padding: "12px 0", color: "var(--text-3)" }}>
            Thread not found.
          </div>
        ) : (
          <>
            {/* Title */}
            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 8 }}>
              {thread.title}
            </div>

            {/* Status + severity row */}
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: statusColor(thread.status),
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                {statusLabel(thread.status)}
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: severityColor(thread.severity),
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                {thread.severity}
              </span>
            </div>

            {/* Cited sources count */}
            {sectionLabel("Evidence")}
            <div style={{ color: citedCount === 0 ? "var(--text-3)" : "var(--text-1)" }}>
              {citedCount} cited source{citedCount !== 1 ? "s" : ""}
            </div>

            {/* Gaps / readiness summary */}
            {sectionLabel("Referral readiness")}
            <div
              style={{
                fontSize: 11,
                color:
                  thread.status === "CONFIRMED" &&
                  citedCount > 0 &&
                  (thread.evidence_weight === "DOCUMENTED" || thread.evidence_weight === "TRACED") &&
                  thread.overreach_reviewed
                    ? "var(--color-success, #34d399)"
                    : "var(--text-3)",
                lineHeight: 1.5,
              }}
            >
              {gapSummary()}
            </div>

            {/* Narrative preview (if any) */}
            {thread.narrative && (
              <>
                {sectionLabel("Narrative")}
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-2)",
                    lineHeight: 1.5,
                    maxHeight: 80,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 4,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {thread.narrative}
                </div>
              </>
            )}
          </>
        )}
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
          onClick={handleSetAside}
          disabled={setAside || isSetAside || loading || thread === null}
          style={{
            fontSize: 11,
            padding: "5px 0",
            borderRadius: 4,
            border: "1px solid var(--border-1)",
            background: "none",
            color: isSetAside ? "var(--text-3)" : "var(--text-1)",
            cursor: setAside || isSetAside || loading || thread === null ? "default" : "pointer",
            opacity: setAside || isSetAside ? 0.5 : 1,
            width: "100%",
          }}
        >
          {setAside ? "Setting aside…" : "Set aside"}
        </button>
        <button
          type="button"
          onClick={onOpenThread}
          disabled={loading || thread === null}
          style={{
            fontSize: 11,
            padding: "5px 0",
            borderRadius: 4,
            border: "none",
            background: "var(--color-accent, rgba(99,102,241,0.2))",
            color: "var(--text-1)",
            cursor: loading || thread === null ? "default" : "pointer",
            fontWeight: 600,
            width: "100%",
          }}
        >
          Open full Thread
        </button>
      </div>
    </div>
  );
}
