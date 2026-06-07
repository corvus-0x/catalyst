# Referrals Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current single-button Referrals panel with a full agency-tracking tab backed by a `ReferralTarget` model — including an add/edit modal, soft-warning checklist, and always-accessible PDF button.

**Architecture:** New `ReferralTarget` Django model (migration 0029) with GET/POST list endpoint and PATCH/DELETE detail endpoint. Frontend `ReferralsTab.tsx` fetches both referral targets and confirmed angles on mount; the checklist computes `uncitedCount` from `document_links.length === 0` on confirmed angles. CaseDetailView replaces its inline `ReferralsPanel` with lazy-loaded `ReferralsTab`.

**Tech Stack:** Django 4.2, PostgreSQL 16, React 18, TypeScript, Vite, lucide-react, sonner (toasts)

---

## File Map

| File | Change |
|------|--------|
| `backend/investigations/models.py` | Add `ReferralTarget` model |
| `backend/investigations/migrations/0029_referraltarget.py` | Auto-generated |
| `backend/investigations/views.py` | Add `_serialize_target`, `api_case_referral_targets`, `api_case_referral_target_detail` |
| `backend/investigations/urls.py` | Add two URL patterns |
| `frontend/src/types/index.ts` | Add `ReferralTarget`, `ReferralTargetsResponse`, `CreateReferralTargetParams`, `UpdateReferralTargetParams` |
| `frontend/src/api/cases.ts` | Add 4 API functions |
| `frontend/src/api/index.ts` | Barrel exports |
| `frontend/src/views/ReferralsTab.tsx` | New component |
| `frontend/src/views/CaseDetailView.tsx` | Replace inline `ReferralsPanel` with lazy `ReferralsTab` |

---

## Task 1: ReferralTarget model

**Files:**
- Modify: `backend/investigations/models.py`

- [ ] **Find `InvestigationStep` class (around line 995). After its closing `__str__` method, add:**

```python
class ReferralTarget(UUIDPrimaryKeyModel):
    """
    Tracks a referral submission to an investigative agency.
    One row per agency per case.
    """

    STATUS_CHOICES = [
        ("DRAFT", "Draft"),
        ("SENT", "Sent"),
        ("ACKNOWLEDGED", "Acknowledged"),
        ("CLOSED", "Closed"),
    ]

    case = models.ForeignKey(
        Case,
        on_delete=models.CASCADE,
        related_name="referral_targets",
    )
    agency_name = models.CharField(
        max_length=200,
        help_text="Name of the receiving agency (e.g. 'Ohio AG — Charitable Law Section')",
    )
    complaint_type = models.CharField(
        max_length=200,
        blank=True,
        default="",
        help_text="Type of complaint filed (e.g. 'Charitable fraud', 'Tax-exempt complaint')",
    )
    reference_number = models.CharField(
        max_length=100,
        blank=True,
        default="",
        help_text="Agency-assigned reference or complaint number",
    )
    contact = models.CharField(
        max_length=200,
        blank=True,
        default="",
        help_text="Contact name or unit at the receiving agency",
    )
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="DRAFT",
    )
    notes = models.TextField(
        blank=True,
        default="",
        help_text="Internal notes about this referral",
    )
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "referral_targets"
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.agency_name} ({self.status})"
```

- [ ] **Run ruff:**

```bash
cd C:\Users\tjcol\Catalyst\backend && ruff check investigations/models.py
```

Expected: no output.

---

## Task 2: Migration 0029

**Files:**
- Create: `backend/investigations/migrations/0029_referraltarget.py`

- [ ] **Run makemigrations:**

```bash
cd C:\Users\tjcol\Catalyst\backend && python manage.py makemigrations investigations --name referraltarget
```

Expected:
```
Migrations for 'investigations':
  investigations/migrations/0029_referraltarget.py
    - Create model ReferralTarget
```

- [ ] **Verify the migration has `CreateModel` for `ReferralTarget` with all 8 fields.**

- [ ] **Commit:**

```bash
git add backend/investigations/models.py \
        backend/investigations/migrations/0029_referraltarget.py
git commit -m "feat(referrals): add ReferralTarget model (migration 0029)"
```

---

## Task 3: Backend views + URLs

**Files:**
- Modify: `backend/investigations/views.py`
- Modify: `backend/investigations/urls.py`

- [ ] **Add `ReferralTarget` to the model imports in `views.py`. Find the line that imports `InvestigationStep` and add `ReferralTarget` to the same import block.**

- [ ] **Find `api_case_persons_deceased` view. After its closing `return JsonResponse(...)`, add the serializer helper and two new views:**

```python
# ---------------------------------------------------------------------------
# Referral Targets
# ---------------------------------------------------------------------------


def _serialize_target(t) -> dict:
    return {
        "id": str(t.pk),
        "agency_name": t.agency_name,
        "complaint_type": t.complaint_type,
        "reference_number": t.reference_number,
        "contact": t.contact,
        "status": t.status,
        "notes": t.notes,
        "created_at": t.created_at.isoformat(),
    }


@require_http_methods(["GET", "POST"])
def api_case_referral_targets(request, pk):
    """List or create referral targets for a case."""
    case = get_object_or_404(Case, pk=pk)

    if request.method == "GET":
        targets = ReferralTarget.objects.filter(case=case).order_by("created_at")
        return JsonResponse({
            "count": targets.count(),
            "results": [_serialize_target(t) for t in targets],
        })

    # POST
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    agency_name = body.get("agency_name", "").strip()
    if not agency_name:
        return JsonResponse({"error": "agency_name is required"}, status=400)

    status_val = body.get("status", "DRAFT")
    if status_val not in {"DRAFT", "SENT", "ACKNOWLEDGED", "CLOSED"}:
        return JsonResponse(
            {"error": f"Invalid status: {status_val!r}. Must be DRAFT, SENT, ACKNOWLEDGED, or CLOSED."},
            status=400,
        )

    target = ReferralTarget.objects.create(
        case=case,
        agency_name=agency_name,
        complaint_type=body.get("complaint_type", ""),
        reference_number=body.get("reference_number", ""),
        contact=body.get("contact", ""),
        status=status_val,
        notes=body.get("notes", ""),
    )
    return JsonResponse(_serialize_target(target), status=201)


@require_http_methods(["PATCH", "DELETE"])
def api_case_referral_target_detail(request, pk, target_id):
    """Update or delete a single referral target."""
    case = get_object_or_404(Case, pk=pk)
    target = get_object_or_404(ReferralTarget, pk=target_id, case=case)

    if request.method == "DELETE":
        target.delete()
        return JsonResponse({}, status=204)

    # PATCH
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    if "status" in body and body["status"] not in {"DRAFT", "SENT", "ACKNOWLEDGED", "CLOSED"}:
        return JsonResponse({"error": f"Invalid status: {body['status']!r}"}, status=400)

    if "agency_name" in body and not body["agency_name"].strip():
        return JsonResponse({"error": "agency_name cannot be empty"}, status=400)

    for field in ["agency_name", "complaint_type", "reference_number", "contact", "status", "notes"]:
        if field in body:
            setattr(target, field, body[field])
    target.save()
    return JsonResponse(_serialize_target(target))
```

- [ ] **Add URL patterns in `urls.py`. Find `persons/deceased/` pattern and add after it:**

```python
    path(
        "api/cases/<uuid:pk>/referral-targets/",
        views.api_case_referral_targets,
        name="api_case_referral_targets",
    ),
    path(
        "api/cases/<uuid:pk>/referral-targets/<uuid:target_id>/",
        views.api_case_referral_target_detail,
        name="api_case_referral_target_detail",
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
git commit -m "feat(referrals): add GET/POST list + PATCH/DELETE detail endpoints for ReferralTarget"
```

---

## Task 4: TypeScript types + API functions

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/api/cases.ts`
- Modify: `frontend/src/api/index.ts`

- [ ] **In `types/index.ts`, find `DeceasedPersonsResponse` (added in Research+Polish). After it, add:**

```typescript
// ---------------------------------------------------------------------------
// Section 8 — Referrals Tab
// ---------------------------------------------------------------------------

export type ReferralStatus = "DRAFT" | "SENT" | "ACKNOWLEDGED" | "CLOSED";

export interface ReferralTarget {
  id: UUID;
  agency_name: string;
  complaint_type: string;
  reference_number: string;
  contact: string;
  status: ReferralStatus;
  notes: string;
  created_at: ISO8601;
}

export interface ReferralTargetsResponse {
  count: number;
  results: ReferralTarget[];
}

export interface CreateReferralTargetParams {
  agency_name: string;
  complaint_type?: string;
  reference_number?: string;
  contact?: string;
  status?: ReferralStatus;
  notes?: string;
}

export interface UpdateReferralTargetParams {
  agency_name?: string;
  complaint_type?: string;
  reference_number?: string;
  contact?: string;
  status?: ReferralStatus;
  notes?: string;
}
```

- [ ] **In `cases.ts`, add to the import block from `"../types"`:**

```typescript
  ReferralTarget,
  ReferralTargetsResponse,
  CreateReferralTargetParams,
  UpdateReferralTargetParams,
```

- [ ] **At the end of `cases.ts`, add:**

```typescript
// ---------------------------------------------------------------------------
// Referral Targets
// ---------------------------------------------------------------------------

export async function getReferralTargets(
  caseId: string
): Promise<ReferralTargetsResponse> {
  return fetchApi<ReferralTargetsResponse>(
    `/api/cases/${caseId}/referral-targets/`
  );
}

export async function createReferralTarget(
  caseId: string,
  params: CreateReferralTargetParams
): Promise<ReferralTarget> {
  return fetchApi<ReferralTarget>(`/api/cases/${caseId}/referral-targets/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

export async function updateReferralTarget(
  caseId: string,
  targetId: string,
  params: UpdateReferralTargetParams
): Promise<ReferralTarget> {
  return fetchApi<ReferralTarget>(
    `/api/cases/${caseId}/referral-targets/${targetId}/`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }
  );
}

export async function deleteReferralTarget(
  caseId: string,
  targetId: string
): Promise<void> {
  return fetchApi<void>(
    `/api/cases/${caseId}/referral-targets/${targetId}/`,
    { method: "DELETE" }
  );
}
```

- [ ] **In `api/index.ts`, add barrel exports:**

```typescript
export {
  getReferralTargets,
  createReferralTarget,
  updateReferralTarget,
  deleteReferralTarget,
} from "./cases";
```

- [ ] **TypeScript check:**

```bash
cd C:\Users\tjcol\Catalyst\frontend && npx tsc --noEmit 2>&1 | grep -E "types/index|cases.ts|error TS"
```

Expected: no errors.

- [ ] **Commit:**

```bash
git add frontend/src/types/index.ts frontend/src/api/cases.ts frontend/src/api/index.ts
git commit -m "feat(referrals): add ReferralTarget TypeScript types and API functions"
```

---

## Task 5: ReferralsTab.tsx

**Files:**
- Create: `frontend/src/views/ReferralsTab.tsx`

- [ ] **Create the file with this full content:**

```tsx
/**
 * ReferralsTab.tsx — Referral agency tracking + PDF generation.
 *
 * Shows a list of referral targets (agencies), an add/edit modal,
 * a soft-warning checklist (confirmed angles without cited docs),
 * and the "Generate Referral Package (PDF)" button.
 *
 * Vocabulary (CLAUDE.md):
 *   Angle = Finding (the investigative narrative unit)
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2, FileDown, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  getReferralTargets,
  createReferralTarget,
  updateReferralTarget,
  deleteReferralTarget,
  fetchAngles,
  generateReferralPdf,
} from "../api";
import type {
  ReferralTarget,
  ReferralStatus,
  CreateReferralTargetParams,
  UpdateReferralTargetParams,
  FindingItem,
} from "../types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ReferralsTabProps {
  caseId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<ReferralStatus, string> = {
  DRAFT:        "Draft",
  SENT:         "Sent",
  ACKNOWLEDGED: "Acknowledged",
  CLOSED:       "Closed",
};

const STATUS_CLASS: Record<ReferralStatus, string> = {
  DRAFT:        "ref-badge ref-badge--draft",
  SENT:         "ref-badge ref-badge--sent",
  ACKNOWLEDGED: "ref-badge ref-badge--ack",
  CLOSED:       "ref-badge ref-badge--closed",
};

// ---------------------------------------------------------------------------
// ReferralTargetModal — add / edit form
// ---------------------------------------------------------------------------

interface ModalProps {
  caseId: string;
  target: ReferralTarget | null;  // null = add mode
  onSaved: (t: ReferralTarget) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}

function ReferralTargetModal({ caseId, target, onSaved, onDeleted, onClose }: ModalProps) {
  const isEdit = target !== null;
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState<CreateReferralTargetParams>({
    agency_name:      target?.agency_name ?? "",
    complaint_type:   target?.complaint_type ?? "",
    reference_number: target?.reference_number ?? "",
    contact:          target?.contact ?? "",
    status:           target?.status ?? "DRAFT",
    notes:            target?.notes ?? "",
  });

  function set<K extends keyof CreateReferralTargetParams>(
    key: K,
    value: CreateReferralTargetParams[K]
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.agency_name?.trim()) return;
    setSaving(true);
    try {
      let saved: ReferralTarget;
      if (isEdit) {
        saved = await updateReferralTarget(caseId, target.id, form as UpdateReferralTargetParams);
      } else {
        saved = await createReferralTarget(caseId, form as CreateReferralTargetParams);
      }
      onSaved(saved);
      onClose();
    } catch {
      toast.error(isEdit ? "Failed to update agency." : "Failed to add agency.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!isEdit) return;
    if (!window.confirm(`Remove ${target.agency_name} from this case?`)) return;
    setDeleting(true);
    try {
      await deleteReferralTarget(caseId, target.id);
      onDeleted(target.id);
      onClose();
    } catch {
      toast.error("Failed to remove agency.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="ref-modal-backdrop" onClick={onClose}>
      <div className="ref-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="ref-modal__title">
          {isEdit ? "Edit agency" : "Add referral agency"}
        </h3>
        <form onSubmit={handleSubmit} className="ref-modal__form">
          <div className="ref-form-row">
            <label className="ref-form-label">Agency name *</label>
            <input
              type="text"
              className="ref-form-input"
              required
              placeholder="e.g. Ohio AG — Charitable Law Section"
              value={form.agency_name ?? ""}
              onChange={(e) => set("agency_name", e.target.value)}
            />
          </div>
          <div className="ref-form-row">
            <label className="ref-form-label">Complaint type</label>
            <input
              type="text"
              className="ref-form-input"
              placeholder="e.g. Charitable fraud, Tax-exempt complaint"
              value={form.complaint_type ?? ""}
              onChange={(e) => set("complaint_type", e.target.value)}
            />
          </div>
          <div className="ref-form-row ref-form-row--inline">
            <div>
              <label className="ref-form-label">Reference #</label>
              <input
                type="text"
                className="ref-form-input"
                placeholder="Agency reference or complaint #"
                value={form.reference_number ?? ""}
                onChange={(e) => set("reference_number", e.target.value)}
              />
            </div>
            <div>
              <label className="ref-form-label">Status</label>
              <select
                className="ref-form-select"
                value={form.status ?? "DRAFT"}
                onChange={(e) => set("status", e.target.value as ReferralStatus)}
              >
                {(["DRAFT", "SENT", "ACKNOWLEDGED", "CLOSED"] as ReferralStatus[]).map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="ref-form-row">
            <label className="ref-form-label">Contact</label>
            <input
              type="text"
              className="ref-form-input"
              placeholder="Contact name or unit"
              value={form.contact ?? ""}
              onChange={(e) => set("contact", e.target.value)}
            />
          </div>
          <div className="ref-form-row">
            <label className="ref-form-label">Notes</label>
            <textarea
              className="ref-form-textarea"
              rows={3}
              placeholder="Internal notes about this referral…"
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>

          <div className="ref-modal__actions">
            {isEdit && (
              <button
                type="button"
                className="btn-danger"
                onClick={handleDelete}
                disabled={deleting}
                style={{ marginRight: "auto" }}
              >
                {deleting ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
                {deleting ? "Removing…" : "Remove"}
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <><Loader2 size={13} className="spin" /> Saving…</> : (isEdit ? "Save changes" : "Add agency")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChecklistStrip
// ---------------------------------------------------------------------------

function ChecklistStrip({ confirmedCount, uncitedCount }: { confirmedCount: number; uncitedCount: number }) {
  if (confirmedCount === 0) return null;

  if (uncitedCount === 0) {
    return (
      <div className="ref-checklist ref-checklist--ok">
        <CheckCircle2 size={14} />
        <span>All {confirmedCount} confirmed angle{confirmedCount !== 1 ? "s" : ""} have cited documents ✓</span>
      </div>
    );
  }

  return (
    <div className="ref-checklist ref-checklist--warn">
      <AlertTriangle size={14} />
      <span>
        {uncitedCount} confirmed angle{uncitedCount !== 1 ? "s" : ""} {uncitedCount !== 1 ? "have" : "has"} no
        cited documents — referral package will be incomplete.
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ReferralsTab({ caseId }: ReferralsTabProps) {
  const [targets, setTargets]           = useState<ReferralTarget[]>([]);
  const [confirmedAngles, setConfirmedAngles] = useState<FindingItem[]>([]);
  const [loading, setLoading]           = useState(true);
  const [showModal, setShowModal]       = useState(false);
  const [editTarget, setEditTarget]     = useState<ReferralTarget | null>(null);
  const [pdfLoading, setPdfLoading]     = useState(false);
  const [pdfError, setPdfError]         = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getReferralTargets(caseId),
      fetchAngles(caseId, { status: "CONFIRMED", limit: 200 }),
    ])
      .then(([targetsRes, anglesRes]) => {
        setTargets(targetsRes.results);
        setConfirmedAngles(anglesRes.results);
      })
      .catch(() => toast.error("Failed to load referrals data."))
      .finally(() => setLoading(false));
  }, [caseId]);

  const uncitedCount = confirmedAngles.filter((a) => a.document_links.length === 0).length;

  function handleSaved(saved: ReferralTarget) {
    setTargets((prev) => {
      const idx = prev.findIndex((t) => t.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
    toast.success(editTarget ? "Agency updated." : "Agency added.");
  }

  function handleDeleted(id: string) {
    setTargets((prev) => prev.filter((t) => t.id !== id));
    toast.success("Agency removed.");
  }

  async function handleGeneratePdf() {
    setPdfLoading(true);
    setPdfError(null);
    try {
      const blob = await generateReferralPdf(caseId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `catalyst-referral-${caseId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : "PDF generation failed.");
    } finally {
      setPdfLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="ref-tab ref-tab--loading">
        <Loader2 size={20} className="spin" />
        <span>Loading referrals…</span>
      </div>
    );
  }

  return (
    <div className="ref-tab">
      {/* Header */}
      <div className="ref-tab__header">
        <div>
          <h2 className="ref-tab__title">Referrals</h2>
          <p className="ref-tab__sub">
            {targets.length} agenc{targets.length !== 1 ? "ies" : "y"}
            {targets.filter((t) => t.status === "ACKNOWLEDGED").length > 0 &&
              ` · ${targets.filter((t) => t.status === "ACKNOWLEDGED").length} acknowledged`}
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => { setEditTarget(null); setShowModal(true); }}
        >
          <Plus size={14} /> Add agency
        </button>
      </div>

      {/* Checklist strip */}
      <ChecklistStrip confirmedCount={confirmedAngles.length} uncitedCount={uncitedCount} />

      {/* Agency table */}
      {targets.length === 0 ? (
        <div className="empty-state" style={{ flex: 1 }}>
          <p className="empty-state__title">No referral agencies yet.</p>
          <p className="empty-state__body">
            Add the agencies you have submitted or plan to submit this case to.
          </p>
        </div>
      ) : (
        <div className="ref-table-wrap">
          <table className="ref-table">
            <thead>
              <tr>
                <th>Agency</th>
                <th>Type</th>
                <th>Ref #</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => (
                <tr key={t.id}>
                  <td className="ref-table__agency">{t.agency_name}</td>
                  <td className="ref-table__type">{t.complaint_type || "—"}</td>
                  <td className="ref-table__ref">
                    {t.reference_number ? (
                      <span style={{ fontFamily: "monospace", fontSize: 11 }}>
                        {t.reference_number}
                      </span>
                    ) : "—"}
                  </td>
                  <td>
                    <span className={STATUS_CLASS[t.status]}>
                      {STATUS_LABEL[t.status]}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ref-edit-btn"
                      onClick={() => { setEditTarget(t); setShowModal(true); }}
                      aria-label={`Edit ${t.agency_name}`}
                    >
                      <Pencil size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* PDF section */}
      <div className="ref-pdf-section">
        <button
          type="button"
          className="btn-secondary ref-pdf-btn"
          onClick={handleGeneratePdf}
          disabled={pdfLoading}
        >
          {pdfLoading ? (
            <><Loader2 size={14} className="spin" /> Generating…</>
          ) : (
            <><FileDown size={14} /> Generate Referral Package (PDF)</>
          )}
        </button>
        {uncitedCount > 0 && !pdfLoading && (
          <p className="ref-pdf-warn">
            <AlertTriangle size={12} />
            {uncitedCount} angle{uncitedCount !== 1 ? "s" : ""} uncited — PDF may be incomplete.
          </p>
        )}
        {pdfError && (
          <p className="ref-pdf-error">{pdfError}</p>
        )}
        <p className="ref-pdf-note">
          Deterministic PDF — every finding traces to a cited document. No generated text.
        </p>
      </div>

      {/* Modal */}
      {showModal && (
        <ReferralTargetModal
          caseId={caseId}
          target={editTarget}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onClose={() => { setShowModal(false); setEditTarget(null); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Add CSS to `frontend/src/index.css`. Find `.web-stats-chip__label` block. After it, add:**

```css
/* ── Referrals Tab ─────────────────────────────────────── */
.ref-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.ref-tab--loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  color: var(--text-3);
  font-size: 13px;
}
.ref-tab__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 20px 24px 12px;
  border-bottom: 1px solid var(--border-1);
  flex-shrink: 0;
}
.ref-tab__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
  margin: 0 0 4px;
}
.ref-tab__sub { font-size: 12px; color: var(--text-3); margin: 0; }

/* Checklist strip */
.ref-checklist {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 24px;
  font-size: 12px;
  font-weight: 500;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-1);
}
.ref-checklist--ok   { background: rgba(52,211,153,0.06); color: #34d399; }
.ref-checklist--warn { background: rgba(186,117,23,0.08); color: #fbbf24; }

/* Table */
.ref-table-wrap { flex: 1; overflow-y: auto; }
.ref-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.ref-table th {
  text-align: left; padding: 8px 16px 6px;
  font-size: 10px; font-weight: 700; color: #6b7280;
  text-transform: uppercase; letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border-1);
}
.ref-table td { padding: 10px 16px; border-bottom: 1px solid #111827; vertical-align: middle; }
.ref-table tr:last-child td { border-bottom: none; }
.ref-table tr:hover td { background: var(--bg-1); }
.ref-table__agency { font-weight: 500; color: var(--text-1); }
.ref-table__type   { color: var(--text-3); }
.ref-table__ref    { color: var(--text-3); }
.ref-edit-btn {
  background: transparent; border: 1px solid var(--border-1);
  color: var(--text-3); padding: 4px 8px; border-radius: 4px;
  cursor: pointer; display: inline-flex; align-items: center;
}
.ref-edit-btn:hover { border-color: var(--text-2); color: var(--text-1); }

/* Status badges */
.ref-badge {
  display: inline-block; padding: 2px 8px; border-radius: 4px;
  font-size: 10px; font-weight: 600;
}
.ref-badge--draft  { background: rgba(107,114,128,0.2); color: #9ca3af; }
.ref-badge--sent   { background: rgba(99,102,241,0.15); color: #a5b4fc; }
.ref-badge--ack    { background: rgba(251,191,36,0.12); color: #fbbf24; }
.ref-badge--closed { background: rgba(52,211,153,0.12); color: #34d399; }

/* PDF section */
.ref-pdf-section {
  padding: 14px 24px;
  border-top: 1px solid var(--border-1);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  background: var(--bg-0);
  flex-shrink: 0;
}
.ref-pdf-btn { display: inline-flex; align-items: center; gap: 6px; }
.ref-pdf-warn {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; color: #fbbf24; margin: 0;
}
.ref-pdf-error { font-size: 12px; color: var(--color-critical, #f87171); margin: 0; width: 100%; }
.ref-pdf-note  { font-size: 11px; color: var(--text-3); margin: 0; width: 100%; }

/* Modal */
.ref-modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.55);
  display: flex; align-items: center; justify-content: center; z-index: 300;
}
.ref-modal {
  background: var(--bg-1); border: 1px solid var(--border-1);
  border-radius: 10px; padding: 24px;
  width: 500px; max-width: 95vw; max-height: 90vh; overflow-y: auto;
}
.ref-modal__title { font-size: 15px; font-weight: 600; color: var(--text-1); margin: 0 0 16px; }
.ref-modal__form  { display: flex; flex-direction: column; gap: 14px; }
.ref-form-row     { display: flex; flex-direction: column; gap: 4px; }
.ref-form-row--inline { flex-direction: row; gap: 14px; }
.ref-form-row--inline > * { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.ref-form-label {
  font-size: 11px; font-weight: 600; color: var(--text-3);
  text-transform: uppercase; letter-spacing: 0.05em;
}
.ref-form-input,
.ref-form-select,
.ref-form-textarea {
  background: var(--bg-0); border: 1px solid var(--border-1);
  border-radius: 6px; color: var(--text-1); font-size: 13px; padding: 7px 10px;
}
.ref-form-textarea { resize: vertical; font-family: inherit; }
.ref-form-input:focus,
.ref-form-select:focus,
.ref-form-textarea:focus { outline: none; border-color: var(--color-accent, #6366f1); }
.ref-modal__actions {
  display: flex; justify-content: flex-end; gap: 8px;
  padding-top: 8px; border-top: 1px solid var(--border-1);
}
.btn-danger {
  background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3);
  color: #f87171; padding: 6px 12px; border-radius: 6px;
  font-size: 12px; font-weight: 600; cursor: pointer;
  display: inline-flex; align-items: center; gap: 5px;
}
.btn-danger:hover { background: rgba(239,68,68,0.18); }
```

- [ ] **TypeScript check:**

```bash
cd C:\Users\tjcol\Catalyst\frontend && npx tsc --noEmit 2>&1 | grep "ReferralsTab"
```

Expected: no errors.

- [ ] **Build check:**

```bash
cd C:\Users\tjcol\Catalyst\frontend && npm run build 2>&1 | tail -5
```

Expected: `✓ built in Xs`

- [ ] **Commit:**

```bash
git add frontend/src/views/ReferralsTab.tsx frontend/src/index.css
git commit -m "feat(referrals): add ReferralsTab component — agency table, modal, checklist, PDF"
```

---

## Task 6: Wire into CaseDetailView

**Files:**
- Modify: `frontend/src/views/CaseDetailView.tsx`

- [ ] **Add lazy import for `ReferralsTab`. Find the existing lazy imports block and add:**

```tsx
const ReferralsTab = lazy(() => import("./ReferralsTab"));
```

- [ ] **Remove the existing inline `ReferralsPanel` component** (the function definition from `function ReferralsPanel` through its closing `}`, approximately lines 26–73). It is being replaced by the new `ReferralsTab` file.

- [ ] **Find the Referrals `<Tabs.Content value="referrals" ...>` block. It currently contains `<ReferralsPanel caseId={id} />` (or similar). Replace the entire content with:**

```tsx
        <Tabs.Content value="referrals" style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <Suspense fallback={TAB_FALLBACK}>
            {id && <ReferralsTab caseId={id} />}
          </Suspense>
        </Tabs.Content>
```

- [ ] **TypeScript check:**

```bash
cd C:\Users\tjcol\Catalyst\frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors in files we touched.

- [ ] **Build check:**

```bash
cd C:\Users\tjcol\Catalyst\frontend && npm run build 2>&1 | tail -5
```

Expected: `✓ built in Xs`

- [ ] **Commit:**

```bash
git add frontend/src/views/CaseDetailView.tsx
git commit -m "feat(referrals): replace inline ReferralsPanel with lazy ReferralsTab"
```

---

## Self-Review

**Spec coverage:**
- ✅ `ReferralTarget` model with all 7 fields + STATUS_CHOICES — Task 1
- ✅ Migration 0029 — Task 2
- ✅ GET/POST `/referral-targets/` endpoint — Task 3
- ✅ PATCH/DELETE `/referral-targets/<uuid>/` endpoint — Task 3
- ✅ Input validation: `agency_name` required, `status` enum — Task 3
- ✅ TypeScript types: `ReferralTarget`, `ReferralStatus`, request param types — Task 4
- ✅ 4 API functions: get, create, update, delete — Task 4
- ✅ Agency table with status badges — Task 5
- ✅ Add/Edit/Delete modal (`ReferralTargetModal`) — Task 5
- ✅ Checklist strip: hidden when 0 confirmed angles, green when all cited, amber when uncited — Task 5
- ✅ PDF button always enabled, amber warning echoes uncited count — Task 5
- ✅ `CaseDetailView` swaps inline panel for lazy `ReferralsTab` — Task 6

**Placeholder scan:** No TBDs. All code blocks are complete. The delete confirmation uses `window.confirm` — simple and consistent with existing patterns in the codebase.

**Type consistency:**
- `ReferralTarget.status: ReferralStatus` — defined Task 4, used throughout Task 5 ✅
- `STATUS_LABEL[t.status]` and `STATUS_CLASS[t.status]` — both keyed by `ReferralStatus` ✅
- `fetchAngles(caseId, { status: "CONFIRMED", limit: 200 })` — `fetchAngles` already exported from `"../api"`, `status: "CONFIRMED"` matches `FindingStatus` type ✅
- `document_links.length` — `FindingItem.document_links: FindingDocumentLink[]` — confirmed from `types/index.ts` line 701 ✅
- `generateReferralPdf` — already exported from `"../api"` in existing `CaseDetailView` code ✅
