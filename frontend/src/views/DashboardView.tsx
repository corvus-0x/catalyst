/**
 * DashboardView.tsx — Top-level dashboard showing KPI cards, recent cases, and activity feed.
 *
 * Vocabulary: Angles = Findings, Knots = Person/Organization nodes.
 * Banned strings: "Haiku", "Sonnet", "Claude", "AI assistant", "LLM", "GPT".
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import {
  fetchCases,
  createCase,
  fetchSignalSummary,
  fetchActivityFeed,
} from "../api";
import type { CaseListItem, ActivityFeedItem, SignalSummary } from "../types";

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

function formatAction(action: string): string {
  return action.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Create Case Dialog
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
// Stat card
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  value: number | string;
}

function StatCard({ label, value }: StatCardProps) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 140,
        background: "var(--surface-1, #1a1a2e)",
        border: "1px solid var(--border, #2d2d4a)",
        borderRadius: 8,
        padding: "16px 20px",
      }}
    >
      <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--text-muted, #9ca3af)", marginTop: 4 }}>{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DashboardView
// ---------------------------------------------------------------------------

export default function DashboardView() {
  const navigate = useNavigate();
  const [cases, setCases] = useState<CaseListItem[]>([]);
  const [signalSummary, setSignalSummary] = useState<SignalSummary | null>(null);
  const [activity, setActivity] = useState<ActivityFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [casesRes, summaryRes, feedRes] = await Promise.all([
          fetchCases({ limit: 5 }),
          fetchSignalSummary(),
          fetchActivityFeed(),
        ]);
        if (!cancelled) {
          setCases(casesRes.results);
          setSignalSummary(summaryRes);
          setActivity(feedRes.results.slice(0, 10));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  function handleCreated(newCase: CaseListItem) {
    setCases((prev) => [newCase, ...prev].slice(0, 5));
    navigate(`/cases/${newCase.id}`);
  }

  const activeCases = cases.filter((c) => c.status === "ACTIVE").length;
  const totalAngles = signalSummary?.total ?? 0;
  const totalCases = loading ? "—" : cases.length;

  return (
    <div style={{ padding: "24px 32px", maxWidth: 900, margin: "0 auto" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Catalyst</h1>
        <button className="btn-primary" onClick={() => setDialogOpen(true)}>
          + New case
        </button>
      </div>

      {/* KPI row */}
      <div style={{ display: "flex", gap: 16, marginBottom: 32 }}>
        {loading ? (
          <>
            <div className="skeleton" style={{ flex: 1, height: 72, borderRadius: 8 }} />
            <div className="skeleton" style={{ flex: 1, height: 72, borderRadius: 8 }} />
            <div className="skeleton" style={{ flex: 1, height: 72, borderRadius: 8 }} />
          </>
        ) : (
          <>
            <StatCard label="Total cases" value={totalCases} />
            <StatCard label="Active cases" value={activeCases} />
            <StatCard label="Total angles" value={totalAngles} />
          </>
        )}
      </div>

      {/* Recent cases */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px" }}>Recent cases</h2>
        {loading ? (
          <div className="skeleton" style={{ height: 160, borderRadius: 8 }} />
        ) : cases.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state__title">No cases yet</p>
            <p className="empty-state__body">Create your first case to get started.</p>
          </div>
        ) : (
          <div
            style={{
              background: "var(--surface-1, #1a1a2e)",
              border: "1px solid var(--border, #2d2d4a)",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            {cases.map((c, i) => (
              <div
                key={c.id}
                onClick={() => navigate(`/cases/${c.id}`)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 16px",
                  cursor: "pointer",
                  borderTop: i > 0 ? "1px solid var(--border, #2d2d4a)" : undefined,
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLDivElement).style.background =
                    "var(--surface-2, #0f0f1a)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLDivElement).style.background = "")
                }
              >
                <span style={{ fontWeight: 500 }}>{c.name}</span>
                <span style={{ fontSize: 12, color: "var(--text-muted, #9ca3af)" }}>
                  {formatDate(c.updated_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Activity feed */}
      <section>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px" }}>Activity</h2>
        {loading ? (
          <div className="skeleton" style={{ height: 200, borderRadius: 8 }} />
        ) : activity.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state__title">No activity yet</p>
            <p className="empty-state__body">Actions will appear here as the investigation progresses.</p>
          </div>
        ) : (
          <div
            style={{
              background: "var(--surface-1, #1a1a2e)",
              border: "1px solid var(--border, #2d2d4a)",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            {activity.map((item, i) => (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 12,
                  padding: "10px 16px",
                  borderTop: i > 0 ? "1px solid var(--border, #2d2d4a)" : undefined,
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    color: "var(--text-muted, #9ca3af)",
                    whiteSpace: "nowrap",
                    fontSize: 11,
                    minWidth: 72,
                  }}
                >
                  {formatDate(item.performed_at)}
                </span>
                <span>{formatAction(item.action)}</span>
                {item.notes && (
                  <span
                    style={{
                      color: "var(--text-muted, #9ca3af)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.notes}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <CreateCaseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={handleCreated}
      />
    </div>
  );
}
