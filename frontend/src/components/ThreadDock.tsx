import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { FindingItem, FindingSeverity, FindingStatus } from "../types";
import { compareBySeverity } from "../views/caseMapElements";
import { threadReadiness } from "./threadReadiness";

type SortKey = "severity" | "status" | "readiness" | "recency";

export interface ThreadDockProps {
  threads: FindingItem[];
  totalCount: number;
  loading: boolean;
  error: boolean;
  selectedThreadId: string | undefined;
  onSelectThread: (id: string) => void;
  onRetry: () => void;
}

const STATUS_RANK: Record<FindingStatus, number> = {
  NEW: 0, NEEDS_EVIDENCE: 1, CONFIRMED: 2, DISMISSED: 3,
};

function statusLabel(s: FindingStatus): string {
  switch (s) {
    case "CONFIRMED": return "Substantiated";
    case "DISMISSED": return "Set aside";
    case "NEEDS_EVIDENCE":
    case "NEW": return "Developing";
    default: return "Developing";
  }
}

function statusColor(s: FindingStatus): string {
  switch (s) {
    case "CONFIRMED": return "var(--color-success, #34d399)";
    case "DISMISSED": return "var(--text-3)";
    default: return "#fbbf24";
  }
}

function severityColor(sev: FindingSeverity): string {
  switch (sev) {
    case "CRITICAL": return "var(--color-critical, #f87171)";
    case "HIGH": return "#fbbf24";
    case "MEDIUM": return "var(--color-info, #60a5fa)";
    default: return "var(--text-3)";
  }
}

function sortThreads(threads: FindingItem[], key: SortKey): FindingItem[] {
  const byTitle = (a: FindingItem, b: FindingItem) => a.title.localeCompare(b.title);
  const copy = [...threads];
  switch (key) {
    case "severity":
      return copy.sort((a, b) => compareBySeverity(a.severity, b.severity) || byTitle(a, b));
    case "status":
      return copy.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || byTitle(a, b));
    case "readiness":
      return copy.sort(
        (a, b) => Number(threadReadiness(b).ready) - Number(threadReadiness(a).ready) || byTitle(a, b),
      );
    case "recency":
      return copy.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    default:
      return copy;
  }
}

// Module-level style consts for the row grid (brief style note: hoist repeated objects).
const ROW_BASE: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "92px 1fr 70px 150px",
  gap: 10,
  alignItems: "center",
  width: "100%",
  textAlign: "left",
  padding: "6px 12px",
  border: "none",
  borderTop: "1px solid var(--bg-2)",
  cursor: "pointer",
  color: "var(--text-1)",
  fontSize: 12,
};

const ROW_ACTIVE: React.CSSProperties = {
  background: "rgba(251,191,36,0.10)",
  boxShadow: "inset 3px 0 0 #fbbf24",
};

const ROW_INACTIVE: React.CSSProperties = {
  background: "transparent",
  boxShadow: "none",
};

export default function ThreadDock({
  threads,
  totalCount,
  loading,
  error,
  selectedThreadId,
  onSelectThread,
  onRetry,
}: ThreadDockProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("severity");
  const sorted = useMemo(() => sortThreads(threads, sortKey), [threads, sortKey]);

  return (
    <div
      style={{
        borderTop: "1px solid var(--border-1)",
        background: "var(--bg-1)",
        display: "flex",
        flexDirection: "column",
        maxHeight: collapsed ? 33 : 180,
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 12px",
          borderBottom: collapsed ? "none" : "1px solid var(--border-1)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: "var(--text-3)",
          }}
        >
          Threads · {threads.length}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {!collapsed && (
            <label style={{ fontSize: 11, color: "var(--text-3)" }}>
              sort:{" "}
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                style={{
                  fontSize: 11,
                  background: "var(--bg-2)",
                  color: "var(--text-1)",
                  border: "1px solid var(--border-1)",
                  borderRadius: 4,
                }}
              >
                <option value="severity">severity</option>
                <option value="status">status</option>
                <option value="readiness">readiness</option>
                <option value="recency">recency</option>
              </select>
            </label>
          )}
          <button
            type="button"
            aria-label={collapsed ? "Expand threads" : "Collapse threads"}
            onClick={() => setCollapsed((c) => !c)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-3)",
              display: "flex",
            }}
          >
            {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div style={{ overflowY: "auto" }}>
          {loading ? (
            <div style={{ padding: 12, fontSize: 12, color: "var(--text-3)" }}>
              Loading threads…
            </div>
          ) : error ? (
            <div
              style={{ padding: 12, fontSize: 12, color: "var(--color-critical, #f87171)" }}
              role="alert"
            >
              Couldn&apos;t load threads.{" "}
              <button
                type="button"
                onClick={onRetry}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--color-info, #60a5fa)",
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                Retry
              </button>
            </div>
          ) : threads.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, color: "var(--text-3)" }}>
              No threads yet — start one from a subject or relationship.
            </div>
          ) : (
            <>
              {sorted.map((t) => {
                const active = t.id === selectedThreadId;
                const r = threadReadiness(t);
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-label={`thread row ${t.title}`}
                    data-active={active ? "true" : "false"}
                    onClick={() => onSelectThread(t.id)}
                    style={{ ...ROW_BASE, ...(active ? ROW_ACTIVE : ROW_INACTIVE) }}
                  >
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        color: statusColor(t.status),
                      }}
                    >
                      {statusLabel(t.status)}
                    </span>
                    <span
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        color: "var(--text-1)",
                        fontWeight: 500,
                      }}
                    >
                      {t.title}
                      {t.rule_id && (
                        <span
                          style={{ color: "var(--text-3)", fontSize: 10, marginLeft: 6 }}
                        >
                          {t.rule_id}
                        </span>
                      )}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        textAlign: "right",
                        color: severityColor(t.severity),
                      }}
                    >
                      {t.severity}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        textAlign: "right",
                        color: r.ready ? "var(--color-success, #34d399)" : "var(--text-3)",
                      }}
                    >
                      {r.ready ? "✓ referral-grade" : r.summary.split(" · ")[0]}
                    </span>
                  </button>
                );
              })}
              {totalCount > threads.length && (
                <div style={{ padding: "6px 12px", fontSize: 10, color: "var(--text-3)" }}>
                  Showing {threads.length} of {totalCount} threads.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
