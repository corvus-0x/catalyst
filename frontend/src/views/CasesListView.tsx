/**
 * CasesListView.tsx — Paginated cases table with status filter chips and create case dialog.
 *
 * Vocabulary: Angles = Findings, Knots = Person/Organization nodes.
 * Banned strings: "Haiku", "Sonnet", "Claude", "AI assistant", "LLM", "GPT".
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { fetchCases, createCase } from "../api";
import type { CaseListItem, CaseStatus } from "../types";

const PAGE_SIZE = 20;

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Status pill
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<CaseStatus, { bg: string; color: string }> = {
  ACTIVE: { bg: "#14532d", color: "#86efac" },
  PAUSED: { bg: "#78350f", color: "#fde68a" },
  REFERRED: { bg: "#1e3a5f", color: "#93c5fd" },
  CLOSED: { bg: "#1f1f2e", color: "#9ca3af" },
};

const STATUS_LABELS: Record<CaseStatus, string> = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  REFERRED: "Referred",
  CLOSED: "Closed",
};

function StatusPill({ status }: { status: CaseStatus }) {
  const { bg, color } = STATUS_COLORS[status];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 99,
        fontSize: 11,
        fontWeight: 600,
        background: bg,
        color,
      }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Create Case Dialog (same pattern as Dashboard)
// ---------------------------------------------------------------------------

interface CreateCaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (c: CaseListItem) => void;
}

function CreateCaseDialog({ open, onOpenChange, onCreated }: CreateCaseDialogProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createCase({ name: name.trim() });
      onCreated(created);
      setName("");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create case.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 100,
          }}
        />
        <Dialog.Content
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            background: "var(--surface-1, #1a1a2e)",
            border: "1px solid var(--border, #2d2d4a)",
            borderRadius: 8,
            padding: 24,
            width: 400,
            zIndex: 101,
          }}
        >
          <Dialog.Title style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600 }}>
            New case
          </Dialog.Title>
          <form onSubmit={handleSubmit}>
            <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
              Case name
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter a descriptive case name"
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 4,
                border: "1px solid var(--border, #2d2d4a)",
                background: "var(--surface-2, #0f0f1a)",
                color: "inherit",
                fontSize: 14,
                boxSizing: "border-box",
              }}
            />
            {error && (
              <p style={{ color: "#ef4444", fontSize: 12, margin: "8px 0 0" }}>{error}</p>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <Dialog.Close asChild>
                <button type="button" className="btn-secondary" disabled={busy}>
                  Cancel
                </button>
              </Dialog.Close>
              <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>
                {busy ? "Creating…" : "Create case"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------
// Filter chip
// ---------------------------------------------------------------------------

interface FilterChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function FilterChip({ label, active, onClick }: FilterChipProps) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "4px 12px",
        borderRadius: 99,
        border: active
          ? "1px solid var(--primary, #6366f1)"
          : "1px solid var(--border, #2d2d4a)",
        background: active ? "var(--primary, #6366f1)" : "transparent",
        color: active ? "#fff" : "var(--text-muted, #9ca3af)",
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// CasesListView
// ---------------------------------------------------------------------------

type FilterOption = "ALL" | CaseStatus;

export default function CasesListView() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterOption>("ALL");
  const [cases, setCases] = useState<CaseListItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  async function load(newFilter: FilterOption, newOffset: number, append: boolean) {
    if (newOffset === 0) setLoading(true);
    else setLoadingMore(true);

    try {
      const params = {
        limit: PAGE_SIZE,
        offset: newOffset,
        ...(newFilter !== "ALL" ? { status: newFilter as CaseStatus } : {}),
      };
      const res = await fetchCases(params);
      if (append) {
        setCases((prev) => [...prev, ...res.results]);
      } else {
        setCases(res.results);
      }
      setTotalCount(res.count);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    setOffset(0);
    void load(filter, 0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  function handleFilterChange(f: FilterOption) {
    setFilter(f);
  }

  function handleLoadMore() {
    const newOffset = offset + PAGE_SIZE;
    setOffset(newOffset);
    void load(filter, newOffset, true);
  }

  function handleCreated(newCase: CaseListItem) {
    navigate(`/cases/${newCase.id}`);
  }

  const hasMore = cases.length < totalCount;

  const FILTERS: { label: string; value: FilterOption }[] = [
    { label: "All", value: "ALL" },
    { label: "Active", value: "ACTIVE" },
    { label: "Paused", value: "PAUSED" },
    { label: "Referred", value: "REFERRED" },
    { label: "Closed", value: "CLOSED" },
  ];

  return (
    <div style={{ padding: "24px 32px", maxWidth: 900, margin: "0 auto" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Cases</h1>
        <button className="btn-primary" onClick={() => setDialogOpen(true)}>
          + New case
        </button>
      </div>

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
        {FILTERS.map((f) => (
          <FilterChip
            key={f.value}
            label={f.label}
            active={filter === f.value}
            onClick={() => handleFilterChange(f.value)}
          />
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div>
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="skeleton"
              style={{ height: 44, borderRadius: 6, marginBottom: 4 }}
            />
          ))}
        </div>
      ) : cases.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state__title">No cases found</p>
          <p className="empty-state__body">
            {filter === "ALL"
              ? "Create your first case to get started."
              : `No ${STATUS_LABELS[filter as CaseStatus].toLowerCase()} cases.`}
          </p>
        </div>
      ) : (
        <>
          <div
            style={{
              background: "var(--surface-1, #1a1a2e)",
              border: "1px solid var(--border, #2d2d4a)",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            {/* Table header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 100px 140px",
                padding: "8px 16px",
                borderBottom: "1px solid var(--border, #2d2d4a)",
                fontSize: 11,
                fontWeight: 600,
                color: "var(--text-muted, #9ca3af)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              <span>Case name</span>
              <span>Status</span>
              <span>Created</span>
            </div>

            {/* Rows */}
            {cases.map((c) => (
              <div
                key={c.id}
                onClick={() => navigate(`/cases/${c.id}`)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 100px 140px",
                  padding: "12px 16px",
                  cursor: "pointer",
                  borderTop: "1px solid var(--border, #2d2d4a)",
                  transition: "background 0.1s",
                  alignItems: "center",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLDivElement).style.background =
                    "var(--surface-2, #0f0f1a)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLDivElement).style.background = "")
                }
              >
                <div>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{c.name}</div>
                  {c.notes && (
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text-muted, #9ca3af)",
                        marginTop: 2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 400,
                      }}
                    >
                      {c.notes}
                    </div>
                  )}
                </div>
                <StatusPill status={c.status} />
                <span style={{ fontSize: 12, color: "var(--text-muted, #9ca3af)" }}>
                  {formatDate(c.created_at)}
                </span>
              </div>
            ))}
          </div>

          {/* Load more */}
          {hasMore && (
            <div style={{ marginTop: 16, textAlign: "center" }}>
              <button
                className="btn-secondary"
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading…" : `Load more (${totalCount - cases.length} remaining)`}
              </button>
            </div>
          )}
        </>
      )}

      <CreateCaseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={handleCreated}
      />
    </div>
  );
}
