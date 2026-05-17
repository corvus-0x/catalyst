# Investigation Tab — Full Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 7th "Investigation" tab to Case Detail that shows the step-by-step replay of how an investigation unfolded — question asked, source checked, what was found, which angle it triggered — with filters, a manual add-step form, and a deep link that navigates directly into an angle inside the Investigate tab.

**Architecture:** New `InvestigationStep` Django model (case FK, step_number, who_originated T/C/X, triggered_finding FK nullable) with GET+POST endpoint. Frontend `InvestigationTab.tsx` renders collapsible step cards with filter chips and an add-step modal. Deep link wired through `CaseDetailView` state: Investigation tab calls `onOpenAngle(id, title)` → CaseDetailView sets `requestedAngle` state + switches to Investigate tab → InvestigateTab's new `useEffect` pushes a nav entry for that angle.

**Tech Stack:** Django 4.2, PostgreSQL 16, React 18, TypeScript, Vite, Radix UI, lucide-react

---

## File Map

| File | Change |
|------|--------|
| `backend/investigations/models.py` | Add `InvestigationStep` model |
| `backend/investigations/migrations/0028_investigationstep.py` | Auto-generated migration |
| `backend/investigations/views.py` | Add `api_case_investigation_steps` view (GET + POST) |
| `backend/investigations/urls.py` | Add `investigation-steps/` URL pattern |
| `frontend/src/types/index.ts` | Add `InvestigationStep` + `StepFindingLink` interfaces |
| `frontend/src/api/cases.ts` | Add `getInvestigationSteps` + `createInvestigationStep` functions |
| `frontend/src/views/InvestigationTab.tsx` | New component — step cards, filters, add-step form |
| `frontend/src/views/InvestigateTab.tsx` | Add `requestedAngle` + `onAngleConsumed` props + useEffect |
| `frontend/src/views/CaseDetailView.tsx` | Add 6th tab, `requestedAngle` state, `onOpenAngle` callback |

---

## Task 1: Add InvestigationStep model

**Files:**
- Modify: `backend/investigations/models.py`

- [ ] **Find the end of the `FinancialSnapshot` class (around line 967). After it, add the new model:**

```python
class InvestigationStep(UUIDPrimaryKeyModel):
    """
    One step in the chronological investigation replay for a case.
    Records the question asked, source consulted, what was found,
    and which Finding (Angle) it triggered.
    """

    WHO_CHOICES = [
        ("T", "Tyler"),
        ("C", "Claude"),
        ("X", "External tip"),
    ]

    STATUS_CHOICES = [
        ("RESOLVED", "Resolved"),
        ("OPEN", "Open"),
        ("DEAD_END", "Dead end"),
    ]

    case = models.ForeignKey(
        Case,
        on_delete=models.CASCADE,
        related_name="investigation_steps",
    )
    step_number = models.IntegerField(
        help_text="Display order within the case (1-based, investigator-assigned)",
    )
    question = models.TextField(
        help_text="The question that triggered this investigation step",
    )
    source = models.CharField(
        max_length=200,
        blank=True,
        default="",
        help_text="Source consulted — e.g. 'IRS TEOS', 'Ohio SOS', 'County Recorder'",
    )
    what_was_found = models.TextField(
        blank=True,
        default="",
        help_text="Narrative of what was discovered at this step",
    )
    who_originated = models.CharField(
        max_length=10,
        choices=WHO_CHOICES,
        default="T",
        help_text="T = Tyler, C = Claude, X = External tip",
    )
    triggered_finding = models.ForeignKey(
        "Finding",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="investigation_steps",
        help_text="Angle (Finding) this step produced, if any",
    )
    triggered_question = models.CharField(
        max_length=500,
        blank=True,
        default="",
        help_text="The follow-on question this step opened",
    )
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="RESOLVED",
    )
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "investigation_steps"
        ordering = ["step_number"]
        indexes = [
            models.Index(fields=["case", "step_number"], name="idx_inv_step_case_num"),
        ]

    def __str__(self):
        return f"Step {self.step_number} — {self.question[:60]}"
```

- [ ] **Run ruff:**

```bash
cd C:\Users\tjcol\Catalyst\backend && ruff check investigations/models.py
```

Expected: no output.

---

## Task 2: Generate and apply migration

**Files:**
- Create: `backend/investigations/migrations/0028_investigationstep.py`

- [ ] **Run makemigrations:**

```bash
cd C:\Users\tjcol\Catalyst\backend && python manage.py makemigrations investigations --name investigationstep
```

Expected output:
```
Migrations for 'investigations':
  investigations/migrations/0028_investigationstep.py
    - Create model InvestigationStep
```

- [ ] **Verify the migration file has a `CreateModel` operation with all 9 fields and the `idx_inv_step_case_num` index.**

- [ ] **Apply migration (on Railway — local Postgres not available per CLAUDE.md):**

If a local Postgres connection is available, run:
```bash
python manage.py migrate investigations
```
Otherwise note that migration will run on Railway after push.

- [ ] **Commit model + migration:**

```bash
git add backend/investigations/models.py \
        backend/investigations/migrations/0028_investigationstep.py
git commit -m "feat(investigation): add InvestigationStep model

New model records investigation steps: question, source, what_was_found,
who_originated (T/C/X), triggered_finding FK, triggered_question, status
(RESOLVED/OPEN/DEAD_END). Ordered by step_number within a case."
```

---

## Task 3: Backend view and URL

**Files:**
- Modify: `backend/investigations/views.py`
- Modify: `backend/investigations/urls.py`

- [ ] **Add `InvestigationStep` to the existing import block at the top of `views.py`. Find the line that imports `FinancialSnapshot` and add `InvestigationStep` to the same import:**

```python
from .models import (
    ...
    FinancialSnapshot,
    InvestigationStep,
    ...
)
```

- [ ] **Find `api_case_financials` in `views.py`. After its closing return statement, add the new view:**

```python
@require_http_methods(["GET", "POST"])
def api_case_investigation_steps(request, pk):
    """List or create investigation steps for a case."""

    case = get_object_or_404(Case, pk=pk)

    if request.method == "GET":
        steps = InvestigationStep.objects.filter(case=case).select_related(
            "triggered_finding"
        ).order_by("step_number")

        results = []
        for s in steps:
            tf = s.triggered_finding
            results.append({
                "id": str(s.pk),
                "step_number": s.step_number,
                "question": s.question,
                "source": s.source,
                "what_was_found": s.what_was_found,
                "who_originated": s.who_originated,
                "triggered_finding": {
                    "id": str(tf.pk),
                    "title": tf.title,
                    "severity": tf.severity,
                    "status": tf.status,
                } if tf else None,
                "triggered_question": s.triggered_question,
                "status": s.status,
                "created_at": s.created_at.isoformat(),
            })

        return JsonResponse({"count": len(results), "results": results})

    # POST — create a step
    import json as _json

    try:
        body = _json.loads(request.body)
    except (_json.JSONDecodeError, ValueError):
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    step_number = body.get("step_number")
    question = body.get("question", "").strip()
    if not question:
        return JsonResponse({"error": "question is required"}, status=400)
    if step_number is None:
        return JsonResponse({"error": "step_number is required"}, status=400)

    triggered_finding_id = body.get("triggered_finding_id")
    triggered_finding = None
    if triggered_finding_id:
        from .models import Finding
        triggered_finding = Finding.objects.filter(
            pk=triggered_finding_id, case=case
        ).first()

    step = InvestigationStep.objects.create(
        case=case,
        step_number=int(step_number),
        question=question,
        source=body.get("source", ""),
        what_was_found=body.get("what_was_found", ""),
        who_originated=body.get("who_originated", "T"),
        triggered_finding=triggered_finding,
        triggered_question=body.get("triggered_question", ""),
        status=body.get("status", "RESOLVED"),
    )

    tf = step.triggered_finding
    return JsonResponse({
        "id": str(step.pk),
        "step_number": step.step_number,
        "question": step.question,
        "source": step.source,
        "what_was_found": step.what_was_found,
        "who_originated": step.who_originated,
        "triggered_finding": {
            "id": str(tf.pk),
            "title": tf.title,
            "severity": tf.severity,
            "status": tf.status,
        } if tf else None,
        "triggered_question": step.triggered_question,
        "status": step.status,
        "created_at": step.created_at.isoformat(),
    }, status=201)
```

- [ ] **Add the URL pattern in `urls.py`. Find the `financials/` pattern and add after it:**

```python
    path(
        "api/cases/<uuid:pk>/investigation-steps/",
        views.api_case_investigation_steps,
        name="api_case_investigation_steps",
    ),
```

- [ ] **Run ruff:**

```bash
cd C:\Users\tjcol\Catalyst\backend && ruff check investigations/views.py investigations/urls.py
```

Expected: no output.

- [ ] **Commit:**

```bash
git add backend/investigations/views.py backend/investigations/urls.py
git commit -m "feat(investigation): add GET+POST endpoint for investigation steps

GET /api/cases/<uuid>/investigation-steps/ returns all steps ordered by
step_number with nested triggered_finding (id, title, severity, status).
POST creates a new step with optional triggered_finding_id FK lookup."
```

---

## Task 4: TypeScript types and API functions

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/api/cases.ts`

- [ ] **In `types/index.ts`, find the `FinancialsResponse` interface and add after it:**

```typescript
// ---------------------------------------------------------------------------
// Section 7 — Investigation Tab
// ---------------------------------------------------------------------------

/** Minimal finding reference embedded in an InvestigationStep */
export interface StepFindingLink {
  id: UUID;
  title: string;
  severity: FindingSeverity;
  status: FindingStatus;
}

/**
 * One step in the investigation replay.
 * who_originated: "T" = investigator, "C" = Claude, "X" = external tip
 * status: "RESOLVED" | "OPEN" | "DEAD_END"
 */
export interface InvestigationStep {
  id: UUID;
  step_number: number;
  question: string;
  source: string;
  what_was_found: string;
  who_originated: "T" | "C" | "X";
  triggered_finding: StepFindingLink | null;
  triggered_question: string;
  status: "RESOLVED" | "OPEN" | "DEAD_END";
  created_at: ISO8601;
}

export interface InvestigationStepsResponse {
  count: number;
  results: InvestigationStep[];
}

export interface CreateInvestigationStepParams {
  step_number: number;
  question: string;
  source?: string;
  what_was_found?: string;
  who_originated?: "T" | "C" | "X";
  triggered_finding_id?: string | null;
  triggered_question?: string;
  status?: "RESOLVED" | "OPEN" | "DEAD_END";
}
```

- [ ] **In `cases.ts`, add the import for the new types at the top of the imports block:**

```typescript
import type {
  ...
  InvestigationStep,
  InvestigationStepsResponse,
  CreateInvestigationStepParams,
} from "../types";
```

- [ ] **Add the two API functions at the end of `cases.ts`:**

```typescript
// ---------------------------------------------------------------------------
// Investigation Steps
// ---------------------------------------------------------------------------

/** Fetch all investigation steps for a case, ordered by step_number. */
export async function getInvestigationSteps(
  caseId: string
): Promise<InvestigationStepsResponse> {
  return fetchApi<InvestigationStepsResponse>(
    `/api/cases/${caseId}/investigation-steps/`
  );
}

/** Create a new investigation step. */
export async function createInvestigationStep(
  caseId: string,
  params: CreateInvestigationStepParams
): Promise<InvestigationStep> {
  return fetchApi<InvestigationStep>(
    `/api/cases/${caseId}/investigation-steps/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }
  );
}
```

- [ ] **Run TypeScript check:**

```bash
cd C:\Users\tjcol\Catalyst\frontend && npx tsc --noEmit 2>&1 | grep -E "types/index|cases.ts|error TS"
```

Expected: no errors in those files.

- [ ] **Commit:**

```bash
git add frontend/src/types/index.ts frontend/src/api/cases.ts
git commit -m "feat(investigation): add InvestigationStep TypeScript types and API functions"
```

---

## Task 5: InvestigationTab.tsx — new component

**Files:**
- Create: `frontend/src/views/InvestigationTab.tsx`

- [ ] **Create the file with this full content:**

```tsx
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
  CRITICAL:      "angle-severity angle-severity--critical",
  HIGH:          "angle-severity angle-severity--high",
  MEDIUM:        "angle-severity angle-severity--medium",
  LOW:           "angle-severity angle-severity--low",
  INFORMATIONAL: "angle-severity angle-severity--info",
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
```

- [ ] **Add CSS classes to `frontend/src/index.css`. Find `.fin-section-header` or another logical block and add the investigation tab styles:**

```css
/* ── Investigation Tab ─────────────────────────────────── */
.inv-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.inv-tab--loading,
.inv-tab--error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  color: var(--text-3);
  font-size: 13px;
}
.inv-tab__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 20px 24px 12px;
  border-bottom: 1px solid var(--border-1);
  flex-shrink: 0;
}
.inv-tab__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
  margin: 0 0 4px;
}
.inv-tab__sub {
  font-size: 12px;
  color: var(--text-3);
  margin: 0;
}

/* Filter bar */
.inv-filter-bar {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  padding: 10px 24px;
  border-bottom: 1px solid var(--border-1);
  flex-shrink: 0;
}
.inv-filter-group {
  display: flex;
  align-items: center;
  gap: 6px;
}
.inv-filter-label {
  font-size: 11px;
  color: var(--text-3);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.inv-filter-chip {
  padding: 3px 10px;
  border-radius: 12px;
  border: 1px solid var(--border-1);
  background: transparent;
  color: var(--text-2);
  font-size: 11px;
  cursor: pointer;
}
.inv-filter-chip:hover { border-color: var(--color-accent, #6366f1); color: var(--text-1); }
.inv-filter-chip--active {
  background: var(--color-accent, #6366f1);
  border-color: var(--color-accent, #6366f1);
  color: #fff;
}

/* Step list */
.inv-step-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Step card */
.inv-step-card {
  border: 1px solid var(--border-1);
  border-radius: 8px;
  overflow: hidden;
}
.inv-step-card--dead-end { opacity: 0.65; }
.inv-step-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--bg-1);
  cursor: pointer;
  width: 100%;
  text-align: left;
  border: none;
  flex-wrap: wrap;
}
.inv-step-card__header:hover { background: var(--bg-2); }
.inv-step-card__num {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-3);
  letter-spacing: 0.06em;
  flex-shrink: 0;
}
.inv-step-card__question-preview {
  flex: 1;
  font-size: 12px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.inv-step-card__chevron {
  color: var(--text-3);
  flex-shrink: 0;
  margin-left: auto;
}
.inv-step-card__body {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-top: 1px solid var(--border-1);
}
.inv-step-card__section {}
.inv-step-card__label {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0 0 4px;
}
.inv-step-card__text {
  font-size: 13px;
  color: var(--text-1);
  line-height: 1.55;
  margin: 0;
  white-space: pre-wrap;
}
.inv-step-card__triggered-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.inv-next-question {
  font-size: 11px;
  color: var(--text-3);
  font-style: italic;
}

/* Badges */
.inv-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}
.inv-badge--source     { background: var(--bg-2); color: var(--text-2); }
.inv-badge--origin-t   { background: rgba(59,130,246,0.15); color: #60a5fa; }
.inv-badge--origin-c   { background: rgba(139,92,246,0.15); color: #a78bfa; }
.inv-badge--origin-x   { background: rgba(249,115,22,0.15); color: #fb923c; }
.inv-badge--resolved   { background: rgba(52,211,153,0.12); color: #34d399; }
.inv-badge--open       { background: rgba(251,191,36,0.12); color: #fbbf24; }
.inv-badge--dead-end   { background: var(--bg-2); color: var(--text-3); }

/* Finding deep-link chip */
.inv-finding-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 5px;
  border: none;
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  background: var(--bg-2);
  color: var(--text-2);
}
.inv-finding-chip:hover { opacity: 0.8; }

/* Add step modal */
.inv-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 300;
}
.inv-modal {
  background: var(--bg-1);
  border: 1px solid var(--border-1);
  border-radius: 10px;
  padding: 24px;
  width: 520px;
  max-width: 95vw;
  max-height: 90vh;
  overflow-y: auto;
}
.inv-modal__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
  margin: 0 0 16px;
}
.inv-modal__form { display: flex; flex-direction: column; gap: 14px; }
.inv-form-row { display: flex; flex-direction: column; gap: 4px; }
.inv-form-row--inline { flex-direction: row; gap: 16px; }
.inv-form-row--inline > * { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.inv-form-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.inv-form-input,
.inv-form-textarea,
.inv-form-select {
  background: var(--bg-0);
  border: 1px solid var(--border-1);
  border-radius: 6px;
  color: var(--text-1);
  font-size: 13px;
  padding: 7px 10px;
}
.inv-form-input--sm { width: 80px; }
.inv-form-textarea { resize: vertical; font-family: inherit; }
.inv-form-input:focus,
.inv-form-textarea:focus,
.inv-form-select:focus { outline: none; border-color: var(--color-accent, #6366f1); }
.inv-modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-1);
}
```

- [ ] **Run TypeScript check:**

```bash
cd C:\Users\tjcol\Catalyst\frontend && npx tsc --noEmit 2>&1 | grep "InvestigationTab"
```

Expected: no errors.

- [ ] **Run build:**

```bash
cd C:\Users\tjcol\Catalyst\frontend && npm run build 2>&1 | tail -5
```

Expected: `✓ built in Xs`.

- [ ] **Commit:**

```bash
git add frontend/src/views/InvestigationTab.tsx frontend/src/index.css
git commit -m "feat(investigation): add InvestigationTab component

Step cards (collapsible, default expanded unless DEAD_END), filter bar
(origin + status chips), add-step modal, triggered-finding deep-link chips.
CSS classes for all investigation-specific UI elements."
```

---

## Task 6: Wire deep link into InvestigateTab

**Files:**
- Modify: `frontend/src/views/InvestigateTab.tsx`

The `InvestigateTab` needs two new props: `requestedAngle` (set by parent when Investigation tab clicks a finding) and `onAngleConsumed` (called after InvestigateTab processes the request, so parent can clear it).

- [ ] **Find `InvestigateTabProps` in `InvestigateTab.tsx` and extend it:**

```tsx
interface InvestigateTabProps {
  caseId: string;
  documents: DocumentItem[];
  onAngleActive?: (angleId: string | undefined) => void;
  /** Set by parent to request navigating to a specific angle from outside */
  requestedAngle?: { id: string; title: string } | null;
  /** Called after this component pushes the requested angle onto the nav stack */
  onAngleConsumed?: () => void;
}
```

- [ ] **Update the function signature to destructure the new props:**

```tsx
export default function InvestigateTab({
  caseId,
  documents,
  onAngleActive,
  requestedAngle,
  onAngleConsumed,
}: InvestigateTabProps) {
```

- [ ] **After the existing `useEffect` that loads graph+dashboard (around line 350), add a new `useEffect` for external angle navigation:**

```tsx
  /* ── External angle navigation (from Investigation tab deep link) ── */
  useEffect(() => {
    if (!requestedAngle) return;
    navigate({ kind: "angle", angleId: requestedAngle.id, angleTitle: requestedAngle.title });
    onAngleConsumed?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedAngle]);
```

Note: `navigate` and `onAngleConsumed` are intentionally excluded from deps — `navigate` is defined in the same component scope and `requestedAngle` changing is the only trigger we want.

- [ ] **Run TypeScript check:**

```bash
cd C:\Users\tjcol\Catalyst\frontend && npx tsc --noEmit 2>&1 | grep "InvestigateTab"
```

Expected: no errors.

- [ ] **Commit:**

```bash
git add frontend/src/views/InvestigateTab.tsx
git commit -m "feat(investigation): add requestedAngle prop to InvestigateTab for deep link

When requestedAngle is set by parent (CaseDetailView), pushes a nav entry
for that angle and calls onAngleConsumed to clear the request. Enables
Investigation tab → Investigate tab angle navigation."
```

---

## Task 7: Wire Investigation tab into CaseDetailView + final build

**Files:**
- Modify: `frontend/src/views/CaseDetailView.tsx`

- [ ] **Add `InvestigationTab` to the lazy imports at the top of `CaseDetailView.tsx`:**

```tsx
const InvestigationTab = lazy(() => import("./InvestigationTab"));
```

- [ ] **Add `requestedAngle` state alongside the existing `activeAngleId` state:**

```tsx
  const [requestedAngle, setRequestedAngle] = useState<{ id: string; title: string } | null>(null);
```

- [ ] **Add the `onOpenAngle` callback function after `refetchCase`:**

```tsx
  function handleOpenAngle(angleId: string, angleTitle: string) {
    setRequestedAngle({ id: angleId, title: angleTitle });
    setActiveTab("investigate");
  }
```

- [ ] **Add "Investigation" to the `tabLabels` array:**

```tsx
  const tabLabels = [
    { value: "investigate",  label: "Investigate" },
    { value: "research",     label: "Research" },
    { value: "financials",   label: "Financials" },
    { value: "timeline",     label: "Timeline" },
    { value: "referrals",    label: "Referrals" },
    { value: "investigation", label: "Investigation" },
  ];
```

- [ ] **Update the `<InvestigateTab />` render to pass the new props:**

```tsx
<InvestigateTab
  caseId={id}
  documents={caseData?.documents ?? []}
  onAngleActive={setActiveAngleId}
  requestedAngle={requestedAngle}
  onAngleConsumed={() => setRequestedAngle(null)}
/>
```

- [ ] **Find where the other tabs are rendered (the `<Tabs.Content>` blocks). Add the Investigation tab content after the Referrals tab:**

```tsx
        <Tabs.Content value="investigation" style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <Suspense fallback={TAB_FALLBACK}>
            {id && (
              <InvestigationTab
                caseId={id}
                onOpenAngle={handleOpenAngle}
              />
            )}
          </Suspense>
        </Tabs.Content>
```

- [ ] **Run TypeScript check:**

```bash
cd C:\Users\tjcol\Catalyst\frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors in files we touched.

- [ ] **Run production build:**

```bash
cd C:\Users\tjcol\Catalyst\frontend && npm run build 2>&1 | tail -8
```

Expected: `✓ built in Xs`.

- [ ] **Final commit:**

```bash
git add frontend/src/views/CaseDetailView.tsx
git commit -m "feat(investigation): add Investigation tab to CaseDetailView

Adds 6th tab 'Investigation' (lazy-loaded InvestigationTab). Wires
onOpenAngle callback: sets requestedAngle state and switches to Investigate
tab, triggering the deep link useEffect in InvestigateTab."
```

---

## Self-Review

**Spec coverage:**
- ✅ InvestigationStep model (9 fields, T/C/X choices, status choices) — Task 1
- ✅ Migration 0028 — Task 2
- ✅ GET + POST endpoint at `/api/cases/<uuid>/investigation-steps/` — Task 3
- ✅ Nested triggered_finding (id, title, severity, status) in API response — Task 3
- ✅ TypeScript `InvestigationStep` + `StepFindingLink` + response/param types — Task 4
- ✅ API functions `getInvestigationSteps` + `createInvestigationStep` — Task 4
- ✅ Step cards (collapsible, origin badge T/C/X, status chip, source chip) — Task 5
- ✅ Steps collapsed by default for DEAD_END, expanded otherwise — Task 5 (`defaultExpanded={step.status !== "DEAD_END"}`)
- ✅ Filter bar (origin + status) — Task 5
- ✅ Add step modal with all fields — Task 5
- ✅ Triggered finding deep-link chip — Task 5 (`TriggerFindingChip`)
- ✅ `requestedAngle` prop + `useEffect` in InvestigateTab — Task 6
- ✅ 6th tab wired in CaseDetailView — Task 7
- ✅ `onOpenAngle` → sets tab + requestedAngle — Task 7

**Placeholder scan:** No TBDs or incomplete sections. All CSS classes defined and used consistently.

**Type consistency:**
- `InvestigationStep.who_originated: "T" | "C" | "X"` — defined Task 4, used Task 5 ✅
- `InvestigationStep.status: "RESOLVED" | "OPEN" | "DEAD_END"` — defined Task 4, used Task 5 ✅
- `StepFindingLink` — defined Task 4, used in `InvestigationStep` type and `TriggerFindingChip` props ✅
- `requestedAngle: { id: string; title: string } | null` — shape consistent across Task 6 (`InvestigateTabProps`) and Task 7 (`CaseDetailView` state + `handleOpenAngle`) ✅
- `onAngleConsumed` defined in Task 6, wired in Task 7 ✅

**Edge cases in InvestigationTab:**
- Empty state when `steps.length === 0` — handled ✅
- Filter produces empty list — separate message ✅
- `nextStepNumber` when no steps exist — defaults to 1 ✅
- Modal closes on backdrop click — handled (`onClick={onClose}` + `stopPropagation`) ✅
