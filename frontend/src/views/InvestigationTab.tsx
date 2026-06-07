/**
 * InvestigationTab.tsx — 7th tab on Case Detail.
 *
 * Renders the step-by-step investigation replay: each step shows the question,
 * source, what was found, who originated it, and which Angle it triggered.
 *
 * Vocabulary (CLAUDE.md):
 *   Angle = Finding (the investigative narrative unit)
 *   Lead  = AI-sourced finding — display origin as "Lead" not "Claude"
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { getInvestigationSteps, createInvestigationStep } from "../api";
import type { InvestigationStep, CreateInvestigationStepParams, StepFindingLink } from "../types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface InvestigationTabProps {
  caseId: string;
  /** Called when user clicks a triggered Angle — navigates Investigate tab */
  onOpenAngle: (angleId: string, angleTitle: string) => void;
}

// ---------------------------------------------------------------------------
// Origin badge
// ---------------------------------------------------------------------------

const ORIGIN_LABEL: Record<string, string> = { T: "Investigator", C: "Lead", X: "External" };
const ORIGIN_CLASS: Record<string, string> = {
  T: "inv-badge inv-badge--origin-t",
  C: "inv-badge inv-badge--origin-c",
  X: "inv-badge inv-badge--origin-x",
};

const STATUS_CLASS: Record<string, string> = {
  RESOLVED:  "inv-badge inv-badge--resolved",
  OPEN:      "inv-badge inv-badge--open",
  DEAD_END:  "inv-badge inv-badge--dead-end",
};
const STATUS_LABEL: Record<string, string> = {
  RESOLVED: "Resolved",
  OPEN:     "Open",
  DEAD_END: "Dead end",
};

const SEVERITY_CLASS: Record<string, string> = {
  CRITICAL:      "severity-badge severity-badge--CRITICAL",
  HIGH:          "severity-badge severity-badge--HIGH",
  MEDIUM:        "severity-badge severity-badge--MEDIUM",
  LOW:           "severity-badge severity-badge--LOW",
  INFORMATIONAL: "severity-badge severity-badge--INFORMATIONAL",
};

// ---------------------------------------------------------------------------
// StepCard — individual collapsible step
// ---------------------------------------------------------------------------

interface StepCardProps {
  step: InvestigationStep;
  defaultExpanded: boolean;
  onOpenAngle: (angleId: string, angleTitle: string) => void;
}

function StepCard({ step, defaultExpanded, onOpenAngle }: StepCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className={`inv-step-card inv-step-card--${step.status.toLowerCase().replace("_", "-")}`}>
      {/* ── Card header (always visible) ── */}
      <button
        type="button"
        className="inv-step-card__header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="inv-step-card__num">STEP {step.step_number}</span>
        {step.source && (
          <span className="inv-badge inv-badge--source">{step.source}</span>
        )}
        <span className={ORIGIN_CLASS[step.who_originated] ?? "inv-badge"}>
          {ORIGIN_LABEL[step.who_originated] ?? step.who_originated}
        </span>
        <span className={STATUS_CLASS[step.status] ?? "inv-badge"}>
          {STATUS_LABEL[step.status] ?? step.status}
        </span>
        <span className="inv-step-card__question-preview">
          {step.question}
        </span>
        <span className="inv-step-card__chevron">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      {/* ── Expanded body ── */}
      {expanded && (
        <div className="inv-step-card__body">
          <div className="inv-step-card__section">
            <p className="inv-step-card__label">Question</p>
            <p className="inv-step-card__text">{step.question}</p>
          </div>

          {step.what_was_found && (
            <div className="inv-step-card__section">
              <p className="inv-step-card__label">What was found</p>
              <p className="inv-step-card__text">{step.what_was_found}</p>
            </div>
          )}

          <div className="inv-step-card__triggered-row">
            {step.triggered_finding && (
              <TriggerFindingChip
                finding={step.triggered_finding}
                onOpenAngle={onOpenAngle}
              />
            )}
            {step.triggered_question && (
              <span className="inv-next-question">
                ↪ {step.triggered_question}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TriggerFindingChip — clickable chip that deep-links to the angle
// ---------------------------------------------------------------------------

function TriggerFindingChip({
  finding,
  onOpenAngle,
}: {
  finding: StepFindingLink;
  onOpenAngle: (id: string, title: string) => void;
}) {
  return (
    <button
      type="button"
      className={`inv-finding-chip ${SEVERITY_CLASS[finding.severity] ?? ""}`}
      onClick={() => onOpenAngle(finding.id, finding.title)}
      title="Open this angle in the Investigate tab"
    >
      <ExternalLink size={11} />
      {finding.title.length > 60 ? finding.title.slice(0, 60) + "…" : finding.title}
    </button>
  );
}

// ---------------------------------------------------------------------------
// AddStepModal — inline form for creating a new step
// ---------------------------------------------------------------------------

interface AddStepModalProps {
  caseId: string;
  nextStepNumber: number;
  onCreated: (step: InvestigationStep) => void;
  onClose: () => void;
}

function AddStepModal({ caseId, nextStepNumber, onCreated, onClose }: AddStepModalProps) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CreateInvestigationStepParams>({
    step_number: nextStepNumber,
    question: "",
    source: "",
    what_was_found: "",
    who_originated: "T",
    triggered_question: "",
    status: "RESOLVED",
  });

  function set<K extends keyof CreateInvestigationStepParams>(
    key: K,
    value: CreateInvestigationStepParams[K]
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.question.trim()) return;
    setSaving(true);
    try {
      const step = await createInvestigationStep(caseId, form);
      onCreated(step);
      onClose();
    } catch {
      toast.error("Failed to save investigation step.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="inv-modal-backdrop" onClick={onClose}>
      <div className="inv-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal__title">Add investigation step</h3>
        <form onSubmit={handleSubmit} className="inv-modal__form">
          <div className="inv-form-row">
            <label className="inv-form-label">Step #</label>
            <input
              type="number"
              className="inv-form-input inv-form-input--sm"
              value={form.step_number}
              min={1}
              onChange={(e) => set("step_number", parseInt(e.target.value, 10))}
            />
          </div>

          <div className="inv-form-row">
            <label className="inv-form-label">Question *</label>
            <textarea
              className="inv-form-textarea"
              required
              rows={2}
              placeholder="What question did this step answer?"
              value={form.question}
              onChange={(e) => set("question", e.target.value)}
            />
          </div>

          <div className="inv-form-row">
            <label className="inv-form-label">Source</label>
            <input
              type="text"
              className="inv-form-input"
              placeholder="e.g. IRS TEOS, Ohio SOS, County Recorder"
              value={form.source ?? ""}
              onChange={(e) => set("source", e.target.value)}
            />
          </div>

          <div className="inv-form-row">
            <label className="inv-form-label">What was found</label>
            <textarea
              className="inv-form-textarea"
              rows={4}
              placeholder="Describe what was discovered…"
              value={form.what_was_found ?? ""}
              onChange={(e) => set("what_was_found", e.target.value)}
            />
          </div>

          <div className="inv-form-row inv-form-row--inline">
            <div>
              <label className="inv-form-label">Originated by</label>
              <select
                className="inv-form-select"
                value={form.who_originated}
                onChange={(e) => set("who_originated", e.target.value as "T" | "C" | "X")}
              >
                <option value="T">Investigator</option>
                <option value="C">Lead (AI)</option>
                <option value="X">External tip</option>
              </select>
            </div>
            <div>
              <label className="inv-form-label">Status</label>
              <select
                className="inv-form-select"
                value={form.status}
                onChange={(e) =>
                  set("status", e.target.value as "RESOLVED" | "OPEN" | "DEAD_END")
                }
              >
                <option value="RESOLVED">Resolved</option>
                <option value="OPEN">Open</option>
                <option value="DEAD_END">Dead end</option>
              </select>
            </div>
          </div>

          <div className="inv-form-row">
            <label className="inv-form-label">Follow-on question</label>
            <input
              type="text"
              className="inv-form-input"
              placeholder="What question did this step open?"
              value={form.triggered_question ?? ""}
              onChange={(e) => set("triggered_question", e.target.value)}
            />
          </div>

          <div className="inv-modal__actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <><Loader2 size={13} className="spin" /> Saving…</> : "Save step"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

type OriginFilter = "ALL" | "T" | "C" | "X";
type StatusFilter = "ALL" | "RESOLVED" | "OPEN" | "DEAD_END";

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function InvestigationTab({ caseId, onOpenAngle }: InvestigationTabProps) {
  const [steps, setSteps] = useState<InvestigationStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const [originFilter, setOriginFilter] = useState<OriginFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");

  useEffect(() => {
    setLoading(true);
    setError(null);
    getInvestigationSteps(caseId)
      .then((res) => setSteps(res.results))
      .catch(() => setError("Failed to load investigation steps."))
      .finally(() => setLoading(false));
  }, [caseId]);

  function handleStepCreated(step: InvestigationStep) {
    setSteps((prev) =>
      [...prev, step].sort((a, b) => a.step_number - b.step_number)
    );
    toast.success(`Step ${step.step_number} added.`);
  }

  const filtered = steps.filter((s) => {
    if (originFilter !== "ALL" && s.who_originated !== originFilter) return false;
    if (statusFilter !== "ALL" && s.status !== statusFilter) return false;
    return true;
  });

  const nextStepNumber = steps.length > 0
    ? Math.max(...steps.map((s) => s.step_number)) + 1
    : 1;

  if (loading) {
    return (
      <div className="inv-tab inv-tab--loading">
        <Loader2 size={20} className="spin" />
        <span>Loading investigation steps…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="inv-tab inv-tab--error">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="inv-tab">
      {/* Header */}
      <div className="inv-tab__header">
        <div>
          <h2 className="inv-tab__title">Investigation replay</h2>
          <p className="inv-tab__sub">
            {steps.length} step{steps.length !== 1 ? "s" : ""} documented
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => setShowAddModal(true)}
        >
          <Plus size={14} /> Add step
        </button>
      </div>

      {/* Filter bar */}
      <div className="inv-filter-bar">
        <div className="inv-filter-group">
          <span className="inv-filter-label">Origin:</span>
          {(["ALL", "T", "C", "X"] as OriginFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`inv-filter-chip ${originFilter === f ? "inv-filter-chip--active" : ""}`}
              onClick={() => setOriginFilter(f)}
            >
              {f === "ALL" ? "All" : ORIGIN_LABEL[f]}
            </button>
          ))}
        </div>
        <div className="inv-filter-group">
          <span className="inv-filter-label">Status:</span>
          {(["ALL", "RESOLVED", "OPEN", "DEAD_END"] as StatusFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`inv-filter-chip ${statusFilter === f ? "inv-filter-chip--active" : ""}`}
              onClick={() => setStatusFilter(f)}
            >
              {f === "ALL" ? "All" : STATUS_LABEL[f] ?? f}
            </button>
          ))}
        </div>
      </div>

      {/* Step list */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state__title">
            {steps.length === 0
              ? "No investigation steps yet."
              : "No steps match the current filters."}
          </p>
          {steps.length === 0 && (
            <p className="empty-state__body">
              Add steps to record the investigation replay as you work through the case.
            </p>
          )}
        </div>
      ) : (
        <div className="inv-step-list">
          {filtered.map((step) => (
            <StepCard
              key={step.id}
              step={step}
              defaultExpanded={step.status !== "DEAD_END"}
              onOpenAngle={onOpenAngle}
            />
          ))}
        </div>
      )}

      {/* Add step modal */}
      {showAddModal && (
        <AddStepModal
          caseId={caseId}
          nextStepNumber={nextStepNumber}
          onCreated={handleStepCreated}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}
