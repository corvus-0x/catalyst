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
  ChevronDown,
  FileText,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { fetchAngle, updateAngle, aiAsk } from "../api";
import type {
  AiEvidenceSnapshot,
  DocumentItem,
  FindingDocumentLink,
  FindingItem,
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
// LeadPanel — 224px right sub-panel with debounced AI suggestion refresh
// ---------------------------------------------------------------------------

interface LeadPanelProps {
  caseId: string;
  finding: FindingItem | null;
  /** Number of currently cited documents — triggers a refresh when it changes */
  citedDocCount: number;
}

function LeadPanel({ caseId, finding, citedDocCount }: LeadPanelProps) {
  const [leadContent, setLeadContent] = useState<string | null>(null);
  const [leadLoading, setLeadLoading] = useState(false);
  const [leadError, setLeadError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchLead = useCallback(async () => {
    if (!finding) return;
    if (citedDocCount === 0) {
      setLeadContent(null);
      setLeadLoading(false);
      return;
    }

    setLeadLoading(true);
    setLeadError(false);

    const question =
      `Angle: "${finding.title}". Cited docs: ${citedDocCount}. ` +
      `Suggest ONE concrete next investigative step in 1-2 sentences. ` +
      `Be specific about what to look for. ` +
      `Do NOT use words: fraud, criminal, illegal, guilty.`;

    try {
      const response = await aiAsk(caseId, question);
      setLeadContent(response.answer);
    } catch {
      setLeadError(true);
    } finally {
      setLeadLoading(false);
    }
  }, [caseId, finding, citedDocCount]);

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
          <p className="lead-panel__text lead-panel__text--muted">
            Lead unavailable.
          </p>
        )}

        {/* Suggestion */}
        {citedDocCount > 0 && !leadLoading && !leadError && leadContent && (
          <>
            <p className="lead-panel__section-title">Suggested next</p>
            <p className="lead-panel__text">{leadContent}</p>
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
      const updated = await updateAngle(caseId, angleId, { narrative: updatedNarrative });
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
      <div className="panel-header">
        <button type="button" className="back-btn" onClick={onBack} aria-label="Back to web">
          <ArrowLeft size={14} aria-hidden="true" />
        </button>

        <span className="angle-view__title">ANGLE: {finding.title}</span>

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
