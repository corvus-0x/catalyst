/**
 * ThreadBuilder.tsx — Full-width thread detail surface (Phase 4B)
 *
 * Replaces AngleView as the `frame.kind === "angle"` renderer.
 * Keeps AngleView's exact prop contract (AngleViewProps, AngleView.tsx:48).
 *
 * Changes from AngleView:
 *   - Body: narrative textarea + flat cited-doc list → ordered ElementCard list
 *   - Header: readiness line (threadReadiness) + optional convert prompt
 *   - ASSERTION_V1 threads: assertion list with add controls
 *   - LEGACY_NARRATIVE threads: narrative shown read-only under the convert prompt
 *
 * Reused from AngleView:
 *   - Same prop contract (caseId, angleId, documents, onDocumentClick, onBack, onAngleTiedOff)
 *   - fetchAngle load effect + notes panel + delete flow + TieOffModal + AngleSplitModal
 *   - Status/weight/entity-pill header rows
 *
 * Vocabulary (CLAUDE.md):
 *   Thread = Finding  |  Subject = Person / Organization  |  Substantiated = CONFIRMED
 *   Lead = AI analysis (never show "AI"/"Claude"/"Sonnet")
 *   Intake = extraction pipeline (never show model name)
 */

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
const CiteDocumentPicker = lazy(() => import("../components/CiteDocumentPicker"));
const TieOffModal = lazy(() => import("../components/TieOffModal"));
const AngleSplitModal = lazy(() => import("../components/AngleSplitModal"));
import ElementCard from "../components/ElementCard";
import { threadReadiness } from "../components/threadReadiness";
import {
  ArrowLeft,
  ChevronDown,
  Trash2,
  Plus,
} from "lucide-react";
import {
  fetchAngle,
  deleteAngle,
  fetchNotes,
  createNote,
  deleteNote,
  createElement,
  updateElement,
  deleteElement,
  reorderElements,
  removeCitation,
} from "../api";
import type {
  DocumentItem,
  FindingItem,
  InvestigatorNote,
  ThreadElementTypeT,
} from "../types";

// ---------------------------------------------------------------------------
// Props — identical to AngleViewProps (AngleView.tsx:48)
// ---------------------------------------------------------------------------

interface AngleViewProps {
  caseId: string;
  angleId: string;
  /** All documents for the case — used to resolve doc_type per cited link */
  documents: DocumentItem[];
  onDocumentClick: (docId: string, docName: string) => void;
  onBack: () => void;
  /** Called after tie-off modal confirms (parent will refresh angles list) */
  onAngleTiedOff: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<string, string> = {
  NEW: "Untriaged",
  NEEDS_EVIDENCE: "Active",
  CONFIRMED: "Confirmed",
  DISMISSED: "Exhausted",
};

const WEIGHT_LABEL: Record<string, string> = {
  SPECULATIVE: "Speculative",
  DIRECTIONAL: "Directional",
  DOCUMENTED: "Documented",
  TRACED: "Traced",
};

// ---------------------------------------------------------------------------
// ThreadBuilder (default export)
// ---------------------------------------------------------------------------

export default function ThreadBuilder({
  caseId,
  angleId,
  documents,
  onDocumentClick: _onDocumentClick,
  onBack,
  onAngleTiedOff,
}: AngleViewProps) {
  const [finding, setFinding] = useState<FindingItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Legacy narrative local state (read-only display for LEGACY_NARRATIVE threads)
  const [narrative, setNarrative] = useState("");
  const [savedFlash] = useState(false);

  // Modal visibility
  const [showCitePicker, setShowCitePicker] = useState(false);
  const [showTieOff, setShowTieOff] = useState(false);
  const [showSplit, setShowSplit] = useState(false);

  // Active element for element-mode CiteDocumentPicker
  const [activeElementId, setActiveElementId] = useState<string | null>(null);

  // Delete flow: two-step confirm
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Quick captures (observations on this thread)
  const [notes, setNotes] = useState<InvestigatorNote[]>([]);
  const [captureText, setCaptureText] = useState("");
  const [showCapture, setShowCapture] = useState(false);
  const [savingCapture, setSavingCapture] = useState(false);

  // Narrative save state (for LEGACY_NARRATIVE threads only)
  const [narrativeSaveFailed] = useState(false);
  const savedNarrativeRef = useRef("");

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  useEffect(() => {
    setLoading(true);
    setLoadError(null);

    fetchAngle(caseId, angleId)
      .then((data) => {
        setFinding(data);
        setNarrative(data.narrative ?? "");
        savedNarrativeRef.current = data.narrative ?? "";
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : "Failed to load thread");
      })
      .finally(() => setLoading(false));
  }, [caseId, angleId]);

  useEffect(() => {
    fetchNotes(caseId)
      .then((resp) => setNotes(resp.results.filter((n) => n.target_id === angleId)))
      .catch(() => {});
  }, [caseId, angleId]);

  // ---------------------------------------------------------------------------
  // Element mutation helpers
  //
  // After every element mutation: re-fetch the whole thread.
  // The server returns derived role + updated citations/document_links.
  // ---------------------------------------------------------------------------

  const refresh = useCallback(async () => {
    const updated = await fetchAngle(caseId, angleId);
    setFinding(updated);
    setNarrative(updated.narrative ?? "");
    savedNarrativeRef.current = updated.narrative ?? "";
  }, [caseId, angleId]);

  async function mutateElement(_id: string, op: () => Promise<unknown>) {
    try {
      await op();
      await refresh();
    } catch {
      toast.error("Could not update assertion.");
    }
  }

  async function addElement(type: ThreadElementTypeT) {
    try {
      await createElement(caseId, angleId, { element_type: type, text: "" });
      await refresh();
    } catch {
      toast.error("Could not add assertion.");
    }
  }

  async function reorder(from: number, to: number) {
    if (!finding) return;
    const ids = finding.elements.map((e) => e.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    try {
      await reorderElements(caseId, angleId, ids);
      await refresh();
    } catch {
      toast.error("Could not reorder assertions.");
    }
  }

  function openCitePickerFor(elementId: string) {
    setActiveElementId(elementId);
    setShowCitePicker(true);
  }

  // ---------------------------------------------------------------------------
  // Modal callbacks
  // ---------------------------------------------------------------------------

  async function handleCited() {
    try {
      await refresh();
    } catch {
      toast("Document cited. Reload to see updated citations.");
    }
    setShowCitePicker(false);
    setActiveElementId(null);
  }

  async function handleSaveCapture() {
    const content = captureText.trim();
    if (!content || savingCapture) return;
    setSavingCapture(true);
    try {
      const created = await createNote(caseId, {
        target_type: "finding",
        target_id: angleId,
        content,
      });
      setNotes((prev) => [...prev, created]);
      setCaptureText("");
      setShowCapture(false);
    } catch {
      toast.error("Failed to save observation.");
    } finally {
      setSavingCapture(false);
    }
  }

  async function handleDeleteCapture(noteId: string) {
    try {
      await deleteNote(caseId, noteId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch {
      toast.error("Failed to delete observation.");
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteAngle(caseId, angleId);
      onAngleTiedOff(); // refreshes graph badge counts
      onBack();
    } catch {
      toast.error("Could not delete thread. Try again.");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  function handleTiedOff(updated: FindingItem) {
    setFinding(updated);
    setNarrative(updated.narrative ?? "");
    savedNarrativeRef.current = updated.narrative ?? "";
    onAngleTiedOff();
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const isTiedOff = finding?.status === "CONFIRMED" || finding?.status === "DISMISSED";
  const citedDocCount = finding?.document_links?.length ?? 0;
  const isLegacy = finding?.gate_version === "LEGACY_NARRATIVE";

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="angle-view" style={{ flex: 1 }}>
        <div className="panel-header">
          <button type="button" className="back-btn" onClick={onBack} aria-label="Back">
            <ArrowLeft size={14} aria-hidden="true" />
          </button>
          <span className="angle-view__skeleton-title skeleton" />
        </div>
        <div className="angle-view__loading-body">Loading thread…</div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Error state
  // ---------------------------------------------------------------------------

  if (loadError || !finding) {
    return (
      <div className="angle-view" style={{ flex: 1 }}>
        <div className="panel-header">
          <button type="button" className="back-btn" onClick={onBack} aria-label="Back">
            <ArrowLeft size={14} aria-hidden="true" />
          </button>
          <span className="angle-view__error-text">
            {loadError ?? "Thread not found."}
          </span>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Readiness
  // ---------------------------------------------------------------------------

  const readiness = threadReadiness(finding);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="angle-view thread-builder" style={{ flex: 1 }}>

      {/* ── Panel header ─────────────────────────────────────────────────── */}
      <div className="panel-header panel-header--angle">
        {/* Top row: back + title + badges */}
        <div className="panel-header__top-row">
          <button type="button" className="back-btn" onClick={onBack} aria-label="Back to Case Map">
            <ArrowLeft size={14} aria-hidden="true" />
          </button>

          <span className="angle-view__title">{finding.title}</span>

          <span className={`angle-badge angle-badge--${finding.status}`}>
            {STATUS_LABEL[finding.status] ?? finding.status}
          </span>

          <span className={`severity-badge severity-badge--${finding.severity}`}>
            {finding.severity}
          </span>

          <span className={`weight-badge weight-badge--${finding.evidence_weight}`}>
            {WEIGHT_LABEL[finding.evidence_weight] ?? finding.evidence_weight}
          </span>

          {savedFlash && (
            <span className="angle-view__saved-flash">✓ Saved</span>
          )}
        </div>

        {/* Entity pills row */}
        {finding.entity_links && finding.entity_links.length > 0 && (
          <div className="angle-entity-row">
            {finding.entity_links.map((link, i) => (
              <span key={link.entity_id}>
                {i > 0 && <span className="entity-pill-arrow">↔</span>}
                <span
                  className={`entity-pill entity-pill--${
                    link.entity_type === "organization" ? "org" : link.entity_type
                  }`}
                >
                  {link.context_note || link.entity_id.slice(0, 8)}
                </span>
              </span>
            ))}
          </div>
        )}

        {/* Readiness line */}
        <div className="thread-builder__readiness">
          {readiness.ready
            ? <span className="thread-builder__readiness--ok">Referral-grade ✓</span>
            : (
              <>
                <span className="thread-builder__readiness--gap">Referral-grade: {readiness.gaps[0]}</span>
                {readiness.gaps.length > 1 && (
                  <ul className="thread-builder__readiness-gaps" aria-label="Referral-grade gaps">
                    {readiness.gaps.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                )}
              </>
            )
          }
        </div>
      </div>

      {/* ── Action toolbar ───────────────────────────────────────────────── */}
      <div className="angle-view__toolbar">
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => setShowSplit(true)}
          disabled={isTiedOff || citedDocCount === 0}
          title={
            isTiedOff
              ? "Already tied off."
              : citedDocCount === 0
              ? "Cite a document first."
              : "Split this thread into two"
          }
        >
          Split thread
        </button>

        <button
          type="button"
          className="toolbar-btn"
          disabled={isTiedOff}
          title={
            isTiedOff
              ? "This thread is already tied off."
              : "Tie off this thread with a final status"
          }
          onClick={() => setShowTieOff(true)}
        >
          <ChevronDown size={12} aria-hidden="true" />
          Tie off
        </button>

        {/* Delete thread — two-step confirm */}
        <div className="angle-view__delete-group">
          {!confirmDelete ? (
            <button
              type="button"
              className="toolbar-btn toolbar-btn--danger"
              onClick={() => setConfirmDelete(true)}
              title="Permanently delete this thread"
            >
              <Trash2 size={12} aria-hidden="true" />
              Delete
            </button>
          ) : (
            <>
              <span className="angle-view__confirm-text">Delete permanently?</span>
              <button
                type="button"
                className="toolbar-btn toolbar-btn--danger"
                onClick={() => void handleDelete()}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Yes, delete"}
              </button>
              <button
                type="button"
                className="toolbar-btn"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="angle-view__body">
        <div className="angle-view__main">

          {/* LEGACY convert prompt (non-blocking) */}
          {isLegacy && (
            <div className="thread-builder__convert panel-section" role="status">
              <p className="thread-builder__convert-text">
                Legacy narrative format. Convert to structured assertions when you next edit.
              </p>
            </div>
          )}

          {/* LEGACY: narrative read-only display */}
          {isLegacy && narrative && (
            <div className="panel-section">
              <p className="panel-section__title">NARRATIVE (READ-ONLY)</p>
              <div className="thread-builder__legacy-narrative">{narrative}</div>
              {narrativeSaveFailed && (
                <p className="angle-narrative-error" role="alert">
                  Couldn't save the narrative — your changes are unsaved.
                </p>
              )}
            </div>
          )}

          {/* ASSERTION_V1: element list */}
          {!isLegacy && (
            <div className="thread-builder__elements panel-section">
              <p className="panel-section__title">ASSERTIONS</p>

              {finding.elements.length === 0 && (
                <p className="thread-builder__empty">
                  No assertions yet. Add one below to build the referral-grade thread.
                </p>
              )}

              {finding.elements.map((el, i) => (
                <ElementCard
                  key={el.id}
                  element={el}
                  onEditText={(t) =>
                    mutateElement(el.id, () => updateElement(caseId, angleId, el.id, { text: t }))
                  }
                  onToggleHandoff={(next) =>
                    mutateElement(el.id, () =>
                      updateElement(caseId, angleId, el.id, { handoff_ready: next })
                    )
                  }
                  onChangeType={(ty) =>
                    mutateElement(el.id, () =>
                      updateElement(caseId, angleId, el.id, { element_type: ty })
                    )
                  }
                  onAddCitation={() => openCitePickerFor(el.id)}
                  onRemoveCitation={(cid) =>
                    mutateElement(el.id, () => removeCitation(caseId, angleId, el.id, cid))
                  }
                  onDelete={() =>
                    mutateElement(el.id, () => deleteElement(caseId, angleId, el.id))
                  }
                  onMoveUp={() => i > 0 && reorder(i, i - 1)}
                  onMoveDown={() => i < finding.elements.length - 1 && reorder(i, i + 1)}
                />
              ))}

              <div className="thread-builder__add">
                <button
                  type="button"
                  className="toolbar-btn"
                  onClick={() => addElement("ASSERTION")}
                >
                  <Plus size={12} aria-hidden="true" />
                  Assertion
                </button>
                <button
                  type="button"
                  className="toolbar-btn"
                  onClick={() => addElement("QUESTION")}
                >
                  <Plus size={12} aria-hidden="true" />
                  Question
                </button>
                <button
                  type="button"
                  className="toolbar-btn"
                  onClick={() => addElement("NOTE")}
                >
                  <Plus size={12} aria-hidden="true" />
                  Note
                </button>
              </div>
            </div>
          )}

          {/* Observations (quick captures on this thread) */}
          <div className="panel-section">
            <p className="panel-section__title">OBSERVATIONS</p>
            {notes.map((n) => (
              <div key={n.id} className="quick-capture-item">
                <div className="quick-capture-item__row">
                  <span className="quick-capture-item__text">{n.content}</span>
                  <button
                    type="button"
                    className="icon-btn icon-btn--danger"
                    title="Delete observation"
                    onClick={() => void handleDeleteCapture(n.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
            {showCapture ? (
              <>
                <textarea
                  className="quick-capture"
                  placeholder="Note something about this thread…"
                  value={captureText}
                  onChange={(e) => setCaptureText(e.target.value)}
                  rows={2}
                  autoFocus
                />
                <div className="quick-capture-item__actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ fontSize: 11, padding: "3px 8px" }}
                    onClick={() => { setShowCapture(false); setCaptureText(""); }}
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
              </>
            ) : (
              <button
                type="button"
                className="quick-cap-btn"
                onClick={() => setShowCapture(true)}
              >
                + Observation…
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Modals ── */}

      {/* CiteDocumentPicker — element mode (passes findingId + element) */}
      {finding && showCitePicker && activeElementId && (
        <Suspense fallback={null}>
          <CiteDocumentPicker
            open={showCitePicker}
            caseId={caseId}
            findingId={angleId}
            documents={documents}
            element={{ id: activeElementId }}
            onClose={() => { setShowCitePicker(false); setActiveElementId(null); }}
            onCited={handleCited}
          />
        </Suspense>
      )}

      {/* Legacy narrative CiteDocumentPicker — for LEGACY_NARRATIVE threads */}
      {finding && showCitePicker && !activeElementId && (
        <Suspense fallback={null}>
          <CiteDocumentPicker
            open={showCitePicker}
            caseId={caseId}
            finding={finding}
            documents={documents}
            onClose={() => setShowCitePicker(false)}
            onCited={handleCited}
          />
        </Suspense>
      )}

      {finding && showTieOff && (
        <Suspense fallback={null}>
          <TieOffModal
            open={showTieOff}
            caseId={caseId}
            finding={finding}
            onClose={() => setShowTieOff(false)}
            onTiedOff={handleTiedOff}
          />
        </Suspense>
      )}

      {finding && showSplit && (
        <Suspense fallback={null}>
          <AngleSplitModal
            open={showSplit}
            caseId={caseId}
            finding={finding}
            documents={documents}
            onClose={() => setShowSplit(false)}
            onCreated={() => {
              setShowSplit(false);
              onAngleTiedOff();
              onBack();
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
