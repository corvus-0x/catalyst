/**
 * ConnectionReviewPanel.tsx — Drawer overlay for reviewing pending connections.
 *
 * Vocabulary (from CLAUDE.md / frontend-design-spec.md):
 *   Pending connections = FuzzyMatchCandidate review queue
 *   Knot               = Person or Organization node
 *   Intake             = Document extraction pipeline (never say "AI" or "Claude")
 *
 * This panel covers the Investigate tab as a modal drawer.
 * Intake found entities with similar names. The investigator decides:
 *   - "Confirm — merge with [existing]"  → resolveFuzzyMatch(caseId, id, "accept")
 *   - "Dismiss"                           → resolveFuzzyMatch(caseId, id, "dismiss")
 *
 * Navigation: index state tracks current candidate (0-based).
 * After all reviewed → empty-state message.
 * X button or overlay click → onClose.
 */

import { useEffect, useState, useCallback } from "react";
import { X, Check, AlertTriangle } from "lucide-react";
import { fetchFuzzyMatches, resolveFuzzyMatch } from "../api";
import type { FuzzyMatchCandidate } from "../types";

// ---------------------------------------------------------------------------
// Prop types
// ---------------------------------------------------------------------------

interface ConnectionReviewPanelProps {
  caseId: string;
  onClose: () => void;
  /** Called whenever the remaining pending count changes (toolbar badge update). */
  onCountChange: (newCount: number) => void;
}

// ---------------------------------------------------------------------------
// ConnectionReviewPanel
// ---------------------------------------------------------------------------

export default function ConnectionReviewPanel({
  caseId,
  onClose,
  onCountChange,
}: ConnectionReviewPanelProps) {
  const [candidates, setCandidates] = useState<FuzzyMatchCandidate[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // ------------------------------------------------------------------
  // Fetch pending candidates on mount
  // ------------------------------------------------------------------
  useEffect(() => {
    setLoading(true);
    setLoadError(null);

    fetchFuzzyMatches(caseId, { status: "pending" })
      .then((data) => {
        setCandidates(data.results);
        onCountChange(data.count);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to load pending connections.";
        setLoadError(msg);
      })
      .finally(() => setLoading(false));
  }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------
  // Advance to next candidate after action
  // ------------------------------------------------------------------
  const advance = useCallback(
    (resolvedId: string) => {
      const remaining = candidates.filter((c) => c.id !== resolvedId);
      setCandidates(remaining);
      onCountChange(remaining.length);
      // Keep index within bounds — clamp to last item
      setCurrentIndex((prev) => Math.min(prev, Math.max(0, remaining.length - 1)));
    },
    [candidates, onCountChange]
  );

  // ------------------------------------------------------------------
  // Resolve (accept or dismiss)
  // ------------------------------------------------------------------
  async function handleResolve(
    candidate: FuzzyMatchCandidate,
    action: "accept" | "dismiss"
  ) {
    if (resolving) return;
    setResolving(true);
    setResolveError(null);

    try {
      await resolveFuzzyMatch(caseId, candidate.id, action);
      advance(candidate.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Action failed. Please try again.";
      setResolveError(msg);
    } finally {
      setResolving(false);
    }
  }

  // ------------------------------------------------------------------
  // Overlay click — close only if user clicked the backdrop itself
  // ------------------------------------------------------------------
  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  // ------------------------------------------------------------------
  // Render helpers
  // ------------------------------------------------------------------
  const total = candidates.length;
  const current: FuzzyMatchCandidate | undefined = candidates[currentIndex];
  const similarityPct =
    current != null ? (current.similarity * 100).toFixed(1) : "0.0";
  const docIdShort = current?.detected_in_document_id?.slice(0, 8) ?? "—";

  // ------------------------------------------------------------------
  // Inner drawer content
  // ------------------------------------------------------------------
  function renderDrawerContent() {
    if (loading) {
      return (
        <div style={{ padding: 24, color: "#9ca3af", fontSize: 14 }}>
          Loading…
        </div>
      );
    }

    if (loadError) {
      return (
        <div style={{ padding: 24 }}>
          <p style={{ color: "#ef4444", fontSize: 14, margin: 0 }}>{loadError}</p>
          <button
            type="button"
            className="btn-secondary"
            style={{ marginTop: 12 }}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      );
    }

    if (total === 0) {
      return (
        <div className="empty-state" style={{ padding: 32 }}>
          <Check size={32} style={{ color: "#10b981", marginBottom: 8 }} />
          <p className="empty-state__title">All connections reviewed.</p>
          <p className="empty-state__body">
            No pending connections remain. Intake will surface more when new
            documents are processed.
          </p>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      );
    }

    if (!current) {
      // Shouldn't happen, but guard defensively
      return (
        <div style={{ padding: 24, color: "#9ca3af", fontSize: 14 }}>
          No candidate selected.
        </div>
      );
    }

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 24 }}>
        {/* ── Counter ─────────────────────────────────────────────── */}
        <div style={{ fontSize: 12, color: "#9ca3af", fontVariantNumeric: "tabular-nums" }}>
          {currentIndex + 1} of {total}
        </div>

        {/* ── Main candidate card ──────────────────────────────────── */}
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <AlertTriangle size={15} style={{ color: "#f59e0b", flexShrink: 0, marginTop: 2 }} />
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>
                Lead found:{" "}
                <span style={{ color: "#185FA5" }}>{current.incoming_raw}</span>
                {" ↔ "}
                <span style={{ color: "#185FA5" }}>{current.existing_raw}</span>
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
                Similarity: {similarityPct}%
              </p>
            </div>
          </div>

          {/* Document excerpt box */}
          <div className="excerpt-box">
            Document: {docIdShort}…
          </div>

          {/* Human-readable note */}
          <p style={{ margin: 0, fontSize: 13, color: "#374151" }}>
            <strong>{current.incoming_raw}</strong> — possible match to{" "}
            <strong>{current.existing_raw}</strong>
          </p>
        </div>

        {/* ── Navigation arrows if more than one ──────────────────── */}
        {total > 1 && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn-secondary"
              disabled={currentIndex === 0}
              onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            >
              ← Prev
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={currentIndex >= total - 1}
              onClick={() => setCurrentIndex((i) => Math.min(total - 1, i + 1))}
            >
              Next →
            </button>
          </div>
        )}

        {/* ── Action buttons ───────────────────────────────────────── */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn-primary"
            disabled={resolving}
            onClick={() => void handleResolve(current, "accept")}
            title={`Confirm this match and merge with ${current.existing_raw}`}
          >
            {resolving ? "Saving…" : `Confirm — merge with ${current.existing_raw}`}
          </button>
          <button
            type="button"
            className="btn-danger"
            disabled={resolving}
            onClick={() => void handleResolve(current, "dismiss")}
            title="Dismiss this match — treat as separate entities"
          >
            Dismiss
          </button>
        </div>

        {/* ── Resolve error ────────────────────────────────────────── */}
        {resolveError && (
          <p style={{ fontSize: 12, color: "#ef4444", margin: 0 }}>{resolveError}</p>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Full render
  // ------------------------------------------------------------------
  return (
    <div
      className="conn-review-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label="Review pending connections"
    >
      <div className="conn-review-drawer">
        {/* ── Drawer header ──────────────────────────────────────── */}
        <div
          className="panel-header"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
        >
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
            Pending Connections
          </h3>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            title="Close"
            aria-label="Close pending connections review"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Subheading ─────────────────────────────────────────── */}
        <p
          style={{
            margin: 0,
            padding: "6px 24px 0",
            fontSize: 12,
            color: "#9ca3af",
          }}
        >
          Intake found entities with similar names. Confirm to merge them as the
          same knot, or dismiss to treat them as distinct.
        </p>

        {/* ── Content ────────────────────────────────────────────── */}
        {renderDrawerContent()}
      </div>
    </div>
  );
}
