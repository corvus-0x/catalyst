/**
 * TieOffModal.tsx — Step 12 of the frontend build sequence.
 *
 * Lets an investigator finalize (tie off) an angle by choosing:
 *   - Evidence weight: Speculative / Directional / Documented / Traced
 *   - Outcome: Confirmed (send to referral package) or Exhausted (dead end, dismiss)
 *   - Overreach acknowledgement (required gate condition for confirmed angles)
 *
 * Calls PATCH /api/cases/:id/findings/:id/ via updateAngle().
 * Sends overreach_reviewed when confirming; renders server gate errors on 400.
 *
 * Vocabulary:
 *   Angle    = Finding (the narrative unit of investigation)
 *   Knot     = Person or Organization node
 *   Intake   = extraction pipeline (never "AI")
 *   Lead     = AI-generated finding (never "AI", "Claude", "Sonnet")
 */

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Check } from "lucide-react";
import { updateAngle } from "../api";
import type { FindingItem, EvidenceWeight } from "../types";

// ---------------------------------------------------------------------------
// Evidence weight options (display order matches severity progression)
// ---------------------------------------------------------------------------

const EVIDENCE_WEIGHTS: { value: EvidenceWeight; label: string }[] = [
  { value: "SPECULATIVE", label: "Speculative" },
  { value: "DIRECTIONAL", label: "Directional" },
  { value: "DOCUMENTED", label: "Documented" },
  { value: "TRACED", label: "Traced" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Outcome = "confirmed" | "exhausted";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TieOffModalProps {
  open: boolean;
  caseId: string;
  finding: FindingItem;
  onClose: () => void;
  /** Called with the updated FindingItem after a successful PATCH. */
  onTiedOff: (updatedFinding: FindingItem) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TieOffModal({
  open,
  caseId,
  finding,
  onClose,
  onTiedOff,
}: TieOffModalProps) {
  // Controlled form state — pre-filled from the finding.
  // Default outcome: confirmed for active/new angles, exhausted only if already dismissed.
  const [evidenceWeight, setEvidenceWeight] = useState<EvidenceWeight>(
    () => finding.evidence_weight,
  );
  const [outcome, setOutcome] = useState<Outcome>(
    () => (finding.status === "DISMISSED" ? "exhausted" : "confirmed"),
  );
  const [dismissalRationale, setDismissalRationale] = useState("");
  const [rationaleError, setRationaleError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [overreachAck, setOverreachAck] = useState(false);
  const [serverUnmet, setServerUnmet] = useState<string[] | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Local gate preview — compute unmet conditions
  // ---------------------------------------------------------------------------

  const hasCitation = finding.document_links.length > 0;
  const hasNarrative = (finding.narrative || "").trim().length > 0;
  const hasWeight = evidenceWeight === "DOCUMENTED" || evidenceWeight === "TRACED";
  const localUnmet = [
    !hasCitation ? "citation" : null,
    !hasWeight ? "evidence_weight" : null,
    !hasNarrative ? "narrative" : null,
    !overreachAck ? "overreach" : null,
  ].filter((x): x is string => x !== null);
  const confirmBlocked = outcome === "confirmed" && localUnmet.length > 0;

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleOutcomeChange(next: Outcome) {
    setOutcome(next);
    // Reset rationale error whenever outcome changes.
    setRationaleError(false);
  }

  async function handleConfirm() {
    if (saving) return;

    // Reset server error state at start of each attempt.
    setServerUnmet(null);
    setSubmitError(null);

    // Validate: exhausted outcome requires a rationale.
    if (outcome === "exhausted" && dismissalRationale.trim() === "") {
      setRationaleError(true);
      return;
    }

    setSaving(true);
    const body = {
      status: outcome === "confirmed" ? ("CONFIRMED" as const) : ("DISMISSED" as const),
      evidence_weight: evidenceWeight,
      overreach_reviewed: outcome === "confirmed" ? true : finding.overreach_reviewed,
      investigator_note:
        outcome === "exhausted" ? dismissalRationale.trim() : finding.investigator_note,
    };
    try {
      const updated = await updateAngle(caseId, finding.id, body);
      onTiedOff(updated);
      onClose();
    } catch (e) {
      const unmet = (e as { body?: { errors?: { gate?: { unmet?: string[] } } } })
        ?.body?.errors?.gate?.unmet;
      if (Array.isArray(unmet)) {
        setServerUnmet(unmet);
      } else {
        // Non-gate failure (network, 500, CSRF, etc.) — never swallow it.
        // Keep the modal open and show a generic submit error so tie-off
        // never silently does nothing.
        setSubmitError(
          e instanceof Error && e.message ? e.message : "Tie-off failed. Please try again.",
        );
      }
    } finally {
      setSaving(false);
    }
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) onClose();
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const entitySummary =
    finding.entity_links.length > 0
      ? finding.entity_links
          .map((l) => `${l.entity_type}: ${l.entity_id}`)
          .join(" · ")
      : null;

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          {/* Header */}
          <div className="dialog-header">
            <Dialog.Title className="dialog-title">Tie off this angle</Dialog.Title>
            <button
              type="button"
              className="icon-btn"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="dialog-body">
            {/* Angle identity */}
            <section className="tieoff-identity" aria-label="Angle summary">
              <p className="tieoff-angle-title">{finding.title}</p>
              {entitySummary && (
                <p className="tieoff-entity-pairs">{entitySummary}</p>
              )}
            </section>

            {/* Narrative preview (readonly) */}
            {finding.narrative && (
              <section aria-label="Narrative preview">
                <p className="panel-section__title">Narrative preview</p>
                <textarea
                  className="narrative-editor"
                  readOnly
                  value={finding.narrative}
                  rows={6}
                  aria-label="Narrative preview"
                />
              </section>
            )}

            {/* Cited documents */}
            {finding.document_links.length > 0 && (
              <section aria-label="Cited documents">
                <p className="panel-section__title">
                  Cited documents ({finding.document_links.length})
                </p>
                <ul className="tieoff-doc-list" role="list">
                  {finding.document_links.map((link, i) => (
                    <li key={link.document_id} className="tieoff-doc-item">
                      <Check size={13} aria-hidden="true" />
                      <span className="tieoff-doc-ref">[Doc-{i + 1}]</span>
                      <span className="tieoff-doc-name">{link.document_filename}</span>
                      {link.page_reference && (
                        <span className="tieoff-doc-page">— {link.page_reference}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Signal rule (read-only — rule_id is part of the dedup identity) */}
            <section aria-label="Signal rule">
              <p className="panel-section__title">Signal rule</p>
              <p className="tieoff-rule-readonly">{finding.rule_id || "MANUAL"}</p>
            </section>

            {/* Evidence weight pills */}
            <section aria-label="Evidence weight">
              <p className="panel-section__title">Evidence weight</p>
              <div className="outcome-pill-group" role="radiogroup" aria-label="Evidence weight">
                {EVIDENCE_WEIGHTS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={evidenceWeight === value}
                    className={
                      evidenceWeight === value
                        ? "outcome-pill outcome-pill--selected"
                        : "outcome-pill"
                    }
                    onClick={() => setEvidenceWeight(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>

            {/* Overreach acknowledgement — the 4th gate condition */}
            <section aria-label="Investigator attestation">
              <p className="panel-section__title">Overreach review</p>
              <label className="tieoff-overreach">
                <input
                  type="checkbox"
                  aria-label="Overreach acknowledgement"
                  checked={overreachAck}
                  onChange={(e) => setOverreachAck(e.target.checked)}
                />
                <span>
                  I confirm the narrative states only what the cited documents establish;
                  inferences are labeled as questions, not conclusions; and identity/timing
                  matches are caveated where not proven.
                </span>
              </label>
            </section>

            {/* Outcome pills */}
            <section aria-label="Outcome">
              <p className="panel-section__title">Outcome</p>
              <div
                className="outcome-pill-group outcome-pill-group--vertical"
                role="radiogroup"
                aria-label="Outcome"
              >
                {/* Confirmed */}
                <button
                  type="button"
                  role="radio"
                  aria-checked={outcome === "confirmed"}
                  className={
                    outcome === "confirmed"
                      ? "outcome-pill outcome-pill--selected outcome-pill--confirmed"
                      : "outcome-pill outcome-pill--confirmed"
                  }
                  onClick={() => handleOutcomeChange("confirmed")}
                >
                  <Check size={14} aria-hidden="true" />
                  Confirmed — send to referral package
                </button>

                {/* Exhausted */}
                <button
                  type="button"
                  role="radio"
                  aria-checked={outcome === "exhausted"}
                  className={
                    outcome === "exhausted"
                      ? "outcome-pill outcome-pill--selected outcome-pill--exhausted"
                      : "outcome-pill outcome-pill--exhausted"
                  }
                  onClick={() => handleOutcomeChange("exhausted")}
                >
                  <X size={14} aria-hidden="true" />
                  Exhausted — dead end, dismiss
                </button>
              </div>

              {/* Dismissal rationale (only shown when outcome === exhausted) */}
              {outcome === "exhausted" && (
                <div className="tieoff-rationale">
                  <label
                    htmlFor="tieoff-rationale-input"
                    className="panel-section__title"
                  >
                    Dismissal rationale (required)
                  </label>
                  <textarea
                    id="tieoff-rationale-input"
                    className={
                      rationaleError
                        ? "narrative-editor narrative-editor--error"
                        : "narrative-editor"
                    }
                    rows={3}
                    value={dismissalRationale}
                    onChange={(e) => {
                      setDismissalRationale(e.target.value);
                      if (e.target.value.trim()) setRationaleError(false);
                    }}
                    placeholder="Why is this angle being closed without a referral?"
                    aria-required="true"
                    aria-invalid={rationaleError}
                    aria-describedby={rationaleError ? "rationale-error" : undefined}
                  />
                  {rationaleError && (
                    <p id="rationale-error" className="tieoff-error">
                      Rationale required
                    </p>
                  )}
                </div>
              )}
            </section>

            {/* Gate feedback */}
            {confirmBlocked && (
              <p className="tieoff-error" role="status">
                Needs: {localUnmet.join(", ")} before this angle is referral-grade.
              </p>
            )}
            {serverUnmet && (
              <p id="rationale-error" className="tieoff-error" role="alert">
                Server blocked tie-off — missing: {serverUnmet.join(", ")}.
              </p>
            )}
            {submitError && (
              <p className="tieoff-error" role="alert">
                {submitError}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="dialog-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={saving || confirmBlocked}
              onClick={handleConfirm}
            >
              {saving ? "Saving…" : "Confirm angle"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
