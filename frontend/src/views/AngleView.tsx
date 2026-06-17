/**
 * AngleView.tsx — Level 3 drill-down: narrative editor + cited documents + Lead panel
 *
 * Vocabulary (from CLAUDE.md):
 *   Angle        = Finding (one investigative line of inquiry with narrative + cited docs)
 *   Lead panel   = AI suggestion panel (never show "AI", "Claude", "Sonnet", "LLM")
 *   Intake       = extraction pipeline (used for doc excerpt chip labels on rule/manual findings)
 *   Doc-N        = citation reference like [Doc-3] embedded in narrative text
 *   Knot         = Person or Organization node in the graph
 *
 * Layout: panel-header → angle-view__body → [ angle-view__main | lead-panel (224px) ]
 * Implements Steps 6–8 of the frontend build sequence (frontend-design-spec.md).
 *
 * Styling rule: No inline style={{}} anywhere except the single outermost wrapper
 * (which must carry flex: 1 to fill the right panel area passed by InvestigateTab).
 * All other visual properties use CSS classes defined in index.css.
 */

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
const CiteDocumentPicker = lazy(() => import("../components/CiteDocumentPicker"));
const TieOffModal = lazy(() => import("../components/TieOffModal"));
const AngleSplitModal = lazy(() => import("../components/AngleSplitModal"));
import {
  ArrowLeft,
  AlertCircle,
  ChevronDown,
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { fetchAngle, updateAngle, deleteAngle, aiAsk, fetchNotes, createNote, deleteNote } from "../api";
import type {
  AiEvidenceSnapshot,
  DocumentItem,
  FindingDocumentLink,
  FindingItem,
  InvestigatorNote,
} from "../types";

// ---------------------------------------------------------------------------
// Props
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

/** Returns true if the finding's evidence_snapshot has the AiEvidenceSnapshot shape */
function isAiSnapshot(snap: unknown): snap is AiEvidenceSnapshot {
  return (
    typeof snap === "object" &&
    snap !== null &&
    "doc_refs" in snap &&
    "rationale" in snap
  );
}

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

const REFERRAL_READY_WEIGHTS = new Set(["DOCUMENTED", "TRACED"]);

function citationRefs(narrative: string): string[] {
  return Array.from(new Set(narrative.match(/\[Doc-\d+\]/g) ?? []));
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

// ---------------------------------------------------------------------------
// DocBadge — coloured pill for document type
// ---------------------------------------------------------------------------

const DOC_LABELS: Record<string, string> = {
  IRS_990: "990",
  DEED: "Deed",
  UCC: "UCC",
  BANK_STATEMENT: "Bank",
  AUDIT_REPORT: "Audit",
  PERMIT: "Permit",
  CONTRACT: "Contract",
  CORRESPONDENCE: "Letter",
  OTHER: "Doc",
  UNKNOWN: "Doc",
};

function DocBadge({ docType }: { docType: string }) {
  const normalized = docType?.toUpperCase() ?? "UNKNOWN";
  return (
    <span className={`doc-badge doc-badge--${normalized}`}>
      {DOC_LABELS[normalized] ?? "Doc"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// CitedDocCard — one cited document in the narrative citations panel
// ---------------------------------------------------------------------------

interface CitedDocCardProps {
  link: FindingDocumentLink;
  docIndex: number; // 1-based Doc-N
  docType: string;
  isAiFinding: boolean;
  onCardClick: () => void;
  onRemove: () => void;
}

function CitedDocCard({
  link,
  docIndex,
  docType,
  isAiFinding,
  onCardClick,
  onRemove,
}: CitedDocCardProps) {
  return (
    <div className="cited-doc-card">
      {/* Header row */}
      <div className="cited-doc-card__header">
        <DocBadge docType={docType} />

        <span className="doc-ref-label">[Doc-{docIndex}]</span>

        {/* Filename — triggers document drill-down */}
        <button
          type="button"
          className="cited-doc-card__filename-btn"
          onClick={onCardClick}
          title="Open document"
        >
          <FileText size={12} aria-hidden="true" />
          <span className="cited-doc-card__filename-text">
            {link.document_filename}
          </span>
        </button>

        {link.page_reference && (
          <span className="cited-doc-card__page-ref">{link.page_reference}</span>
        )}

        {/* Remove citation */}
        <button
          type="button"
          className="icon-btn"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Remove citation"
          aria-label="Remove citation"
        >
          <Trash2 size={13} aria-hidden="true" />
        </button>
      </div>

      {/* Context note / excerpt */}
      {link.context_note && (
        <div className="cited-doc-card__excerpt">{link.context_note}</div>
      )}

      {/* Fact tags — "Lead" for AI findings, "Intake" for rule/manual */}
      <div className="cited-doc-card__tags">
        {isAiFinding ? (
          <span className="fact-tag fact-tag--flag">Lead</span>
        ) : (
          <span className="fact-tag fact-tag--entity">Intake</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EvidencePanel — compact health check for this Angle's evidence
// ---------------------------------------------------------------------------

interface EvidencePanelProps {
  finding: FindingItem;
  narrative: string;
}

function EvidencePanel({ finding, narrative }: EvidencePanelProps) {
  const docRefs = citationRefs(narrative);
  const citedCount = finding.document_links.length;
  const hasNarrative = narrative.trim().length > 0;
  const hasReferralWeight = REFERRAL_READY_WEIGHTS.has(finding.evidence_weight);
  const hasKnots = finding.entity_links.some((link) =>
    link.entity_type === "person" || link.entity_type === "organization"
  );
  const isConfirmed = finding.status === "CONFIRMED";

  const gapItems = [
    citedCount === 0 ? "Cite at least one source document." : null,
    !hasNarrative ? "Write the angle narrative." : null,
    docRefs.length === 0 && citedCount > 0
      ? "Add [Doc-N] references where the narrative makes evidence claims."
      : null,
    !hasReferralWeight ? "Raise evidence weight to Documented or Traced before referral." : null,
    !hasKnots ? "Tie this angle to at least one person or organization knot." : null,
    !isConfirmed ? "Tie off this angle as confirmed when the narrative is complete." : null,
  ].filter((item): item is string => item !== null);

  const readyForReferral = gapItems.length === 0;

  return (
    <div className="angle-evidence-panel">
      <div className="angle-evidence-panel__header">
        <div>
          <p className="panel-section__title">EVIDENCE</p>
          <p className="angle-evidence-panel__summary">
            {readyForReferral
              ? "This angle has referral-ready citation support."
              : `${pluralize(gapItems.length, "gap")} before referral-ready.`}
          </p>
        </div>
        <span
          className={
            readyForReferral
              ? "angle-evidence-status angle-evidence-status--ready"
              : "angle-evidence-status angle-evidence-status--needs-work"
          }
        >
          {readyForReferral ? (
            <CheckCircle2 size={13} aria-hidden="true" />
          ) : (
            <AlertCircle size={13} aria-hidden="true" />
          )}
          {readyForReferral ? "Ready" : "Needs evidence"}
        </span>
      </div>

      <div className="angle-evidence-metrics">
        <div className="angle-evidence-metric">
          <span className="angle-evidence-metric__value">{citedCount}</span>
          <span className="angle-evidence-metric__label">cited docs</span>
        </div>
        <div className="angle-evidence-metric">
          <span className="angle-evidence-metric__value">{docRefs.length}</span>
          <span className="angle-evidence-metric__label">narrative refs</span>
        </div>
        <div className="angle-evidence-metric">
          <span className="angle-evidence-metric__value">
            {finding.entity_links.length}
          </span>
          <span className="angle-evidence-metric__label">linked records</span>
        </div>
      </div>

      {finding.trigger_doc_filename && (
        <div className="angle-evidence-source">
          <FileText size={13} aria-hidden="true" />
          <span>Trigger document: {finding.trigger_doc_filename}</span>
        </div>
      )}

      {gapItems.length > 0 && (
        <ul className="angle-evidence-gaps">
          {gapItems.map((gap) => (
            <li key={gap}>{gap}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LeadPanel — 224px right sub-panel with debounced AI suggestion refresh
// ---------------------------------------------------------------------------

interface LeadSections {
  next_step: string;
  pattern_match: string | null;
  new_angle: string | null;
}

interface LeadPanelProps {
  caseId: string;
  finding: FindingItem | null;
  /** Number of currently cited documents — triggers a refresh when it changes */
  citedDocCount: number;
}

function LeadPanel({ caseId, finding, citedDocCount }: LeadPanelProps) {
  const [sections, setSections] = useState<LeadSections | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);
  const [leadLoading, setLeadLoading] = useState(false);
  const [leadError, setLeadError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchLead = useCallback(async () => {
    if (!finding) return;
    if (citedDocCount === 0) {
      setSections(null);
      setRawText(null);
      setLeadLoading(false);
      return;
    }

    setLeadLoading(true);
    setLeadError(false);

    const question = [
      `Angle: "${finding.title}"`,
      `Evidence cited: ${citedDocCount} documents`,
      `Existing narrative: ${finding.narrative ? finding.narrative.slice(0, 400) : "(none yet)"}`,
      ``,
      `Respond with ONLY a valid JSON object — no markdown, no explanation, just the JSON:`,
      `{`,
      `  "next_step": "one concrete investigative action (1-2 sentences)",`,
      `  "pattern_match": null,`,
      `  "new_angle": null`,
      `}`,
      `For pattern_match: if the cited evidence matches one of these signal rules (SR-003, SR-004, SR-005, SR-006, SR-010, SR-012, SR-013, SR-015, SR-017, SR-021, SR-024, SR-025, SR-026, SR-028, SR-029), set it to a 1-2 sentence explanation naming the rule. Otherwise null.`,
      `For new_angle: if you see a second independent line of inquiry worth pursuing, set it to "EntityA and EntityB — brief reason (1 sentence)". Otherwise null.`,
      `Rules: Never use the words fraud, criminal, illegal, guilty. Evidence weight is at most DIRECTIONAL.`,
    ].join("\n");

    try {
      const response = await aiAsk(caseId, question);
      const text = response.answer.trim();
      // Strip markdown code fences if the model wraps in ```json ... ```
      const clean = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
      try {
        const parsed = JSON.parse(clean) as LeadSections;
        setSections(parsed);
        setRawText(null);
      } catch {
        // Couldn't parse JSON — show raw text in Suggested next only
        setRawText(text);
        setSections(null);
      }
    } catch {
      setLeadError(true);
    } finally {
      setLeadLoading(false);
    }
  }, [caseId, finding?.id, finding?.title, finding?.narrative, citedDocCount]);

  // Debounced re-fetch whenever citedDocCount changes (3 s delay spec §8)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchLead, 3000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchLead]);

  // Immediate fetch on first mount (no debounce) if docs already exist
  useEffect(() => {
    if (finding && citedDocCount > 0) fetchLead();
    // Intentionally run once on mount only — debounce handles subsequent changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="lead-panel">
      <div className="lead-panel__header">
        <Sparkles size={13} aria-hidden="true" />
        {" "}Lead
      </div>

      <div className="lead-panel__section">
        {/* No documents cited yet */}
        {citedDocCount === 0 && !leadLoading && (
          <p className="lead-panel__text lead-panel__text--muted">
            Cite a document and Lead will suggest what to look for next.
          </p>
        )}

        {/* Thinking spinner */}
        {citedDocCount > 0 && leadLoading && (
          <div className="lead-panel__thinking">
            <Loader2 size={13} className="spin" aria-hidden="true" />
            Lead is thinking…
          </div>
        )}

        {/* Error state */}
        {citedDocCount > 0 && !leadLoading && leadError && (
          <p className="lead-panel__text lead-panel__text--muted">Lead unavailable.</p>
        )}

        {/* Raw text fallback — JSON parse failed */}
        {citedDocCount > 0 && !leadLoading && !leadError && rawText && (
          <>
            <p className="lead-panel__section-title">Suggested next</p>
            <p className="lead-panel__text">{rawText}</p>
          </>
        )}

        {/* Structured 3-section response */}
        {citedDocCount > 0 && !leadLoading && !leadError && sections && (
          <>
            {sections.next_step && (
              <>
                <p className="lead-panel__section-title">Suggested next</p>
                <p className="lead-panel__text">{sections.next_step}</p>
              </>
            )}

            {sections.pattern_match && (
              <>
                <hr className="lead-panel__divider" />
                <p className="lead-panel__section-title">Pattern match</p>
                <p className="lead-panel__text">{sections.pattern_match}</p>
              </>
            )}

            {sections.new_angle && (
              <>
                <hr className="lead-panel__divider" />
                <p className="lead-panel__section-title">New angle?</p>
                <p className="lead-panel__text">{sections.new_angle}</p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AngleView (default export)
// ---------------------------------------------------------------------------

export default function AngleView({
  caseId,
  angleId,
  documents,
  onDocumentClick,
  onBack,
  onAngleTiedOff,
}: AngleViewProps) {
  const [finding, setFinding] = useState<FindingItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Narrative is kept in local state so the textarea is always controlled.
  // It diverges from finding.narrative while the investigator is typing and
  // is synced back on blur via updateAngle.
  const [narrative, setNarrative] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const [removeBanner, setRemoveBanner] = useState<string | null>(null);

  // Modal visibility state — AngleView manages its own modals
  const [showCitePicker, setShowCitePicker] = useState(false);
  const [showTieOff, setShowTieOff] = useState(false);
  const [showSplit, setShowSplit] = useState(false);

  // Delete flow: first click arms confirm, second click executes
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Quick captures (notes on this angle)
  const [notes, setNotes] = useState<InvestigatorNote[]>([]);
  const [captureText, setCaptureText] = useState("");
  const [showCapture, setShowCapture] = useState(false);
  const [savingCapture, setSavingCapture] = useState(false);

  // Snapshot of the last saved narrative — used to detect dirty state on blur
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
        setLoadError(err instanceof Error ? err.message : "Failed to load angle");
      })
      .finally(() => setLoading(false));
  }, [caseId, angleId]);

  useEffect(() => {
    fetchNotes(caseId)
      .then((resp) => setNotes(resp.results.filter((n) => n.target_id === angleId)))
      .catch(() => {});
  }, [caseId, angleId]);

  // ---------------------------------------------------------------------------
  // Narrative auto-save on blur
  // ---------------------------------------------------------------------------

  async function handleNarrativeBlur() {
    if (!finding) return;
    if (narrative === savedNarrativeRef.current) return; // nothing changed

    try {
      const updated = await updateAngle(caseId, angleId, { narrative });
      setFinding(updated);
      savedNarrativeRef.current = updated.narrative ?? "";
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch {
      // Leave local text intact — next blur will retry
    }
  }

  // ---------------------------------------------------------------------------
  // Remove citation
  // ---------------------------------------------------------------------------

  async function handleRemoveCitation(link: FindingDocumentLink, docIndex: number) {
    if (!finding) return;

    // Strip the [Doc-N] token from the narrative so citations stay consistent
    const docRef = `[Doc-${docIndex}]`;
    const updatedNarrative = narrative.split(docRef).join("").trim();

    try {
      const updated = await updateAngle(caseId, angleId, {
        narrative: updatedNarrative,
        remove_document_ids: [link.document_id],
      });
      setFinding(updated);
      setNarrative(updated.narrative ?? "");
      savedNarrativeRef.current = updated.narrative ?? "";
      setRemoveBanner(`Removed citation ${docRef} — ${link.document_filename}`);
    } catch {
      setRemoveBanner("Could not remove citation.");
    } finally {
      setTimeout(() => setRemoveBanner(null), 3000);
    }
  }

  // ---------------------------------------------------------------------------
  // Modal callbacks
  // ---------------------------------------------------------------------------

  async function handleCited(_newDocIds: string[]) {
    // Re-fetch the finding so document_links and narrative reflect the update
    try {
      const updated = await fetchAngle(caseId, angleId);
      setFinding(updated);
      setNarrative(updated.narrative ?? "");
      savedNarrativeRef.current = updated.narrative ?? "";
    } catch {
      // Document was cited — reload the angle to see updated citations
      toast("Document cited. Reload to see updated citations.");
    }
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
      toast.error("Failed to save quick capture.");
    } finally {
      setSavingCapture(false);
    }
  }

  async function handleDeleteCapture(noteId: string) {
    try {
      await deleteNote(caseId, noteId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch {
      toast.error("Failed to delete quick capture.");
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteAngle(caseId, angleId);
      onAngleTiedOff(); // refreshes graph badge counts
      onBack();
    } catch {
      toast.error("Could not delete angle. Try again.");
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

  const isAiFinding = finding?.source === "AI";
  const isTiedOff = finding?.status === "CONFIRMED" || finding?.status === "DISMISSED";
  const citedDocCount = finding?.document_links?.length ?? 0;

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      /* Spec permits this single inline style to fill the right panel area */
      <div className="angle-view" style={{ flex: 1 }}>
        <div className="panel-header">
          <button type="button" className="back-btn" onClick={onBack} aria-label="Back">
            <ArrowLeft size={14} aria-hidden="true" />
          </button>
          <span className="angle-view__skeleton-title skeleton" />
        </div>
        <div className="angle-view__loading-body">Loading angle…</div>
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
            {loadError ?? "Angle not found."}
          </span>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    /* Single permitted inline style: fills the right panel area from InvestigateTab */
    <div className="angle-view" style={{ flex: 1 }}>

      {/* ── Panel header ─────────────────────────────────────────────────── */}
      <div className="panel-header panel-header--angle">
        {/* Top row: back + title + badges */}
        <div className="panel-header__top-row">
          <button type="button" className="back-btn" onClick={onBack} aria-label="Back to web">
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

        {/* Entity pills row — only shown when entity_links exist */}
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
      </div>

      {/* ── Action toolbar ───────────────────────────────────────────────── */}
      <div className="angle-view__toolbar">
        <button type="button" className="toolbar-btn" onClick={() => setShowCitePicker(true)}>
          <Plus size={12} aria-hidden="true" />
          Cite document
        </button>

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
              : "Split this angle into two"
          }
        >
          Split angle
        </button>

        <button
          type="button"
          className="toolbar-btn"
          onClick={() => setShowTieOff(true)}
          disabled={isTiedOff}
          title={
            isTiedOff
              ? "This angle is already tied off."
              : "Tie off this angle with a final status"
          }
        >
          <ChevronDown size={12} aria-hidden="true" />
          Tie off
        </button>

        {/* Delete angle — two-step confirm to prevent accidental deletion */}
        <div className="angle-view__delete-group">
          {!confirmDelete ? (
            <button
              type="button"
              className="toolbar-btn toolbar-btn--danger"
              onClick={() => setConfirmDelete(true)}
              title="Permanently delete this angle"
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

      {/* ── Citation-removed banner ──────────────────────────────────────── */}
      {removeBanner && (
        <div
          className="angle-view__remove-banner"
          role="status"
          aria-live="polite"
        >
          {removeBanner}
        </div>
      )}

      {/* ── Body: main column + Lead panel ──────────────────────────────── */}
      <div className="angle-view__body">

        {/* Main scrollable column */}
        <div className="angle-view__main">

          <EvidencePanel finding={finding} narrative={narrative} />

          {/* Narrative editor */}
          <div className="panel-section">
            <p className="panel-section__title">NARRATIVE</p>
            <textarea
              className="narrative-editor"
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              onBlur={handleNarrativeBlur}
              placeholder="Build the narrative for this angle. Use [Doc-1], [Doc-2], … to cite documents."
              aria-label="Angle narrative"
            />
          </div>

          {/* Cited documents */}
          <div className="panel-section">
            <p className="panel-section__title">
              CITED DOCUMENTS{" "}
              {citedDocCount > 0 && (
                <span className="cited-docs-count">({citedDocCount})</span>
              )}
            </p>

            {citedDocCount === 0 ? (
              <div className="empty-state angle-view__empty-cite">
                <p className="empty-state__title">
                  No documents cited in this angle yet.
                </p>
                <p className="empty-state__body">
                  Cite a document to attach evidence to this line of inquiry.
                </p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowCitePicker(true)}
                >
                  <Plus size={13} aria-hidden="true" />
                  Cite first document
                </button>
              </div>
            ) : (
              <div className="angle-view__citation-list">
                {finding.document_links.map((link, idx) => {
                  const docType =
                    documents.find((d) => d.id === link.document_id)?.doc_type ??
                    "OTHER";
                  return (
                    <CitedDocCard
                      key={link.document_id}
                      link={link}
                      docIndex={idx + 1}
                      docType={docType}
                      isAiFinding={isAiFinding}
                      onCardClick={() =>
                        onDocumentClick(link.document_id, link.document_filename)
                      }
                      onRemove={() => handleRemoveCitation(link, idx + 1)}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick captures — short observations attached to this angle */}
          <div className="panel-section">
            <p className="panel-section__title">QUICK CAPTURES</p>
            {notes.map((n) => (
              <div key={n.id} className="quick-capture-item">
                <div className="quick-capture-item__row">
                  <span className="quick-capture-item__text">{n.content}</span>
                  <button
                    type="button"
                    className="icon-btn icon-btn--danger"
                    title="Delete quick capture"
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
                  placeholder="Note something about this angle…"
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
                + Quick capture…
              </button>
            )}
          </div>

          {/* Lead analysis snapshot — only for AI (Lead) findings */}
          {isAiFinding && isAiSnapshot(finding.evidence_snapshot) && (
            <div className="panel-section angle-view__lead-analysis-section">
              <p className="panel-section__title">LEAD ANALYSIS</p>
              {finding.evidence_snapshot.rationale && (
                <p className="angle-view__rationale">
                  {finding.evidence_snapshot.rationale}
                </p>
              )}
              {finding.evidence_snapshot.suggested_action && (
                <div className="angle-view__suggested-action">
                  <strong>Suggested action:</strong>{" "}
                  {finding.evidence_snapshot.suggested_action}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Lead panel (224px) */}
        <LeadPanel
          caseId={caseId}
          finding={finding}
          citedDocCount={citedDocCount}
        />
      </div>

      {/* ── Modals ── */}
      {finding && showCitePicker && (
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
