/**
 * DashboardView.tsx — Top-level dashboard showing KPI cards, recent cases, and activity feed.
 *
 * Vocabulary: Threads = Findings, Subjects = Person/Organization nodes.
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
import type { ActivityFeedItem, CaseListItem, SignalSummary } from "../types";

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

/** Title-cases an unrecognized AuditAction enum value as a last-resort fallback. */
function titleCaseAction(action: string): string {
  return action
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * table_name -> the Subject/Thread vocabulary noun for that record type.
 * Used both for specific AuditAction copy and for the generic RECORD_*
 * actions (which the audit log emits for tables without a dedicated
 * action, e.g. plain field edits).
 */
const TABLE_NOUNS: Record<string, string> = {
  cases: "Case",
  findings: "Thread",
  documents: "Document",
  investigator_notes: "Observation",
  entities: "Subject",
  people: "Subject",
  organizations: "Subject",
  search_jobs: "Research job",
};

/**
 * Fully-formed human sentences for AuditAction values that carry their own
 * meaning. Keyed to the actions the backend actually emits (see
 * backend/investigations/models.py AuditAction) — NOT the older aspirational
 * set. AI_* actions are reframed as Lead/Intake per the credibility-firewall
 * rule: the words "AI"/"Claude"/model names must never reach this feed.
 */
const ACTION_COPY: Partial<Record<string, string>> = {
  // Document lifecycle
  DOCUMENT_INGESTED: "Document added",
  DOCUMENT_SCRUBBED: "Document metadata scrubbed",
  DOCUMENT_HASHED: "Document hash computed",
  DOCUMENT_HASH_VERIFIED: "Document hash verified",
  DOCUMENT_HASH_MISMATCH: "Document hash mismatch detected",
  DOCUMENT_DELETED: "Document removed",
  DOCUMENT_OCR_COMPLETED: "Document text extracted",
  DOCUMENT_OCR_FAILED: "Document text extraction failed",

  // Signal / detection lifecycle
  SIGNAL_DETECTED: "Signal detected",
  SIGNAL_CONFIRMED: "Thread substantiated",
  SIGNAL_DISMISSED: "Thread set aside",
  SIGNAL_ESCALATED: "Signal escalated to a thread",

  // Finding (Thread) lifecycle
  FINDING_CREATED: "Thread created",
  FINDING_UPDATED: "Thread updated",
  FINDING_INCLUDED: "Thread included in referral package",

  // Referral lifecycle
  REFERRAL_CREATED: "Referral package created",
  REFERRAL_SUBMITTED: "Referral submitted",
  REFERRAL_STATUS_CHANGED: "Referral status changed",

  // Intake validation
  INTAKE_REJECTED_SIZE: "File rejected — too large",
  INTAKE_REJECTED_TYPE: "File rejected — invalid type",
  INTAKE_REJECTED_CORRUPT: "File rejected — unreadable",

  // System
  HASH_VERIFICATION_BATCH: "Batch hash verification completed",

  // AI lifecycle — reframed as Lead/Intake. "AI" never appears in
  // user-visible copy.
  AI_EXTRACTION_COMPLETED: "Intake completed on a document",
  AI_EXTRACTION_FAILED: "Intake could not read a document",
  AI_PATTERN_RUN_COMPLETED: "Lead analysis completed",
  AI_FINDING_CREATED: "New lead recorded",
  AI_FINDING_REVIEWED: "Investigator reviewed a lead",
  AI_THREAD_ASSIST_COMPLETED: "Lead suggestions ready",
};

/** Generic CRUD verbs for the RECORD_* actions the audit log emits by table. */
const RECORD_VERBS: Record<string, string> = {
  RECORD_CREATED: "created",
  RECORD_UPDATED: "updated",
  RECORD_DELETED: "removed",
};

/**
 * Internal/system note payloads that must never render verbatim — mapped to
 * an investigator-facing sentence instead. Keys are exact `notes` values.
 */
const NOTE_COPY: Record<string, string> = {
  reevaluate_signals: "Signal rules re-evaluated",
};

/**
 * Turns one raw ActivityFeedItem into an investigator-facing sentence.
 * Never renders a raw snake_case AuditAction or a raw internal `notes`
 * code (e.g. "reevaluate_signals") — those are mapped to human copy or,
 * failing that, title-cased.
 */
function humanizeActivity(item: ActivityFeedItem): string {
  const tableNoun = TABLE_NOUNS[item.table_name];
  let headline = ACTION_COPY[item.action];

  if (!headline) {
    const verb = RECORD_VERBS[item.action];
    if (verb) {
      headline = `${tableNoun ?? "Record"} ${verb}`;
    }
  }

  if (!headline) {
    // Guard against the title-case fallback ever rendering "Ai ..." for an
    // unmapped AI_* action — the credibility-firewall rule bans AI/model
    // provenance from user-visible copy even for actions we haven't
    // written specific copy for yet.
    headline = item.action.startsWith("AI_") ? "Activity recorded" : titleCaseAction(item.action);
  }

  const notes = item.notes?.trim();
  if (notes && notes in NOTE_COPY) {
    return `${headline} — ${NOTE_COPY[notes]}`;
  }
  if (notes) {
    return `${headline} — ${notes}`;
  }
  return headline;
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
  // /api/signal-summary/ returns one row per case with findings — sum
  // total_count across rows for the dashboard-wide thread count.
  const totalThreads =
    signalSummary?.results.reduce((sum, row) => sum + row.total_count, 0) ?? 0;
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
            <StatCard label="Total threads" value={totalThreads} />
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
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {humanizeActivity(item)}
                </span>
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
