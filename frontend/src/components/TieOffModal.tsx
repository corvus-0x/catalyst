/**
 * TieOffModal.tsx — Step 12 of the frontend build sequence.
 *
 * Lets an investigator finalize (tie off) an angle by choosing:
 *   - Evidence weight: Speculative / Directional / Documented / Traced
 *   - Signal rule: which fraud signal rule this angle supports
 *   - Outcome: Confirmed (send to referral package) or Exhausted (dead end, dismiss)
 *
 * Calls PATCH /api/cases/:id/findings/:id/ via updateAngle().
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
// Signal rules (hardcoded active rule list — from CLAUDE.md)
// ---------------------------------------------------------------------------

const SIGNAL_RULES = [
  { id: "MANUAL", label: "Manual (no rule)" },
  { id: "SR-003", label: "SR-003 · Valuation anomaly" },
  { id: "SR-004", label: "SR-004 · UCC burst" },
  { id: "SR-005", label: "SR-005 · Zero consideration" },
  { id: "SR-006", label: "SR-006 · Schedule L missing" },
  { id: "SR-010", label: "SR-010 · Missing 990" },
  { id: "SR-012", label: "SR-012 · No conflict-of-interest policy" },
  { id: "SR-013", label: "SR-013 · Zero officer pay" },
  { id: "SR-015", label: "SR-015 · Insider property swap" },
  { id: "SR-017", label: "SR-017 · Blanket lien" },
  { id: "SR-021", label: "SR-021 · Revenue spike" },
  { id: "SR-024", label: "SR-024 · Charity conduit" },
  { id: "SR-025", label: "SR-025 · False disclosure" },
  { id: "SR-026", label: "SR-026 · Contractor denial" },
  { id: "SR-028", label: "SR-028 · Material diversion" },
  { id: "SR-029", label: "SR-029 · Low program ratio" },
];

const RULE_IDS = new Set(SIGNAL_RULES.map((r) => r.id));

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

/** Resolve finding.rule_id to a valid SIGNAL_RULES id, defaulting to MANUAL. */
function resolveRuleId(ruleId: string): string {
  return RULE_IDS.has(ruleId) ? ruleId : "MANUAL";
}

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
  const [ruleId, setRuleId] = useState<string>(() => resolveRuleId(finding.rule_id));
  const [evidenceWeight, setEvidenceWeight] = useState<EvidenceWeight>(
    () => finding.evidence_weight,
  );
  const [outcome, setOutcome] = useState<Outcome>(
    () => (finding.status === "CONFIRMED" ? "confirmed" : "exhausted"),
  );
  const [dismissalRationale, setDismissalRationale] = useState("");
  const [rationaleError, setRationaleError] = useState(false);
  const [saving, setSaving] = useState(false);

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

    // Validate: exhausted outcome requires a rationale.
    if (outcome === "exhausted" && dismissalRationale.trim() === "") {
      setRationaleError(true);
      return;
    }

    setSaving(true);
    try {
      const body = {
        status: outcome === "confirmed" ? ("CONFIRMED" as const) : ("DISMISSED" as const),
        evidence_weight: evidenceWeight,
        investigator_note:
          outcome === "exhausted"
            ? dismissalRationale.trim()
            : `Rule: ${ruleId}`,
      };
      const updated = await updateAngle(caseId, finding.id, body);
      onTiedOff(updated);
      onClose();
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

            {/* Signal rule dropdown */}
            <section aria-label="Signal rule">
              <label className="panel-section__title" htmlFor="tieoff-rule-select">
                Signal rule
              </label>
              <div className="tieoff-select-wrapper">
                <select
                  id="tieoff-rule-select"
                  className="tieoff-select"
                  value={ruleId}
                  onChange={(e) => setRuleId(e.target.value)}
                >
                  {SIGNAL_RULES.map((rule) => (
                    <option key={rule.id} value={rule.id}>
                      {rule.label}
                    </option>
                  ))}
                </select>
              </div>
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
          </div>

          {/* Footer */}
          <div className="dialog-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={saving}
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
