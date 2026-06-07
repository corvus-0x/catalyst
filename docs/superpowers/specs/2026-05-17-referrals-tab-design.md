# Referrals Tab — Design Spec

**Date:** 2026-05-17

---

## Overview

Replace the current single-button `ReferralsPanel` with a full `ReferralsTab` that tracks referral agencies, shows a soft-warning pre-generate checklist, and keeps the PDF generate button always accessible.

---

## Backend

### ReferralTarget model

New model in `backend/investigations/models.py`:

```python
class ReferralTarget(UUIDPrimaryKeyModel):
    STATUS_CHOICES = [
        ("DRAFT", "Draft"),
        ("SENT", "Sent"),
        ("ACKNOWLEDGED", "Acknowledged"),
        ("CLOSED", "Closed"),
    ]
    case          = ForeignKey(Case, CASCADE, related_name="referral_targets")
    agency_name   = CharField(max_length=200)
    complaint_type = CharField(max_length=200, blank=True, default="")
    reference_number = CharField(max_length=100, blank=True, default="")
    contact       = CharField(max_length=200, blank=True, default="")
    status        = CharField(max_length=20, choices=STATUS_CHOICES, default="DRAFT")
    notes         = TextField(blank=True, default="")
    created_at    = DateTimeField(default=timezone.now)

    class Meta:
        db_table = "referral_targets"
        ordering = ["created_at"]
```

Migration: `0029_referraltarget`.

### API endpoints

**`GET/POST /api/cases/<uuid>/referral-targets/`**

- GET: returns `{ "count": N, "results": [...] }` — each item: id, agency_name, complaint_type, reference_number, contact, status, notes, created_at
- POST: creates a new target. Required: `agency_name`. Optional: all other fields. Returns 201 with created object.
- Validation: `status` must be one of DRAFT/SENT/ACKNOWLEDGED/CLOSED.

**`PATCH/DELETE /api/cases/<uuid>/referral-targets/<uuid>/`**

- PATCH: partial update — accepts any subset of fields. Returns updated object.
- DELETE: removes the target. Returns 204.

---

## Frontend

### New file: `frontend/src/views/ReferralsTab.tsx`

Lazy-loaded from `CaseDetailView.tsx`, replacing the current inline `ReferralsPanel`.

#### Layout (top to bottom)

1. **Header row** — "Referrals" title + agency count subtitle + "Add agency" button
2. **Checklist strip** — amber when any confirmed angles have no cited docs; green when all clear; hidden when 0 confirmed angles exist at all
3. **Agency table** — one row per `ReferralTarget`. Columns: Agency, Type, Ref #, Status, Edit button
4. **Empty state** — shown when no targets exist: prompt to add the first agency
5. **PDF section** — always-enabled "Generate Referral Package (PDF)" button + inline amber warning echoing the checklist count if uncited angles exist

#### Checklist logic

`ReferralsTab` receives `caseId`. On mount it fetches:
1. `GET /api/cases/:id/findings/` — to count confirmed angles with `linked_docs.length === 0`
2. `GET /api/cases/:id/referral-targets/` — to populate the agency table

The checklist strip computes `uncitedCount = confirmedAngles.filter(a => a.linked_docs.length === 0).length`.

- `uncitedCount > 0` → amber strip with count, amber note next to PDF button
- `uncitedCount === 0` AND confirmed angles exist → green strip "All confirmed angles have cited documents ✓"
- No confirmed angles yet → strip hidden entirely

#### Add/Edit modal

A single modal component (`ReferralTargetModal`) handles both add and edit:
- Fields: Agency name (required), Complaint type, Reference #, Contact, Status (select), Notes (textarea)
- On save: POST (add) or PATCH (edit) — updates local list optimistically
- On delete (edit mode only): DELETE — removes row

#### Status badges

| Status | Color |
|--------|-------|
| DRAFT | gray |
| SENT | indigo |
| ACKNOWLEDGED | amber |
| CLOSED | green |

---

## Data Flow

```
ReferralsTab mounts
  → fetchReferralTargets(caseId)  → populate agency table
  → fetchFindings(caseId, { status: "CONFIRMED" })  → compute uncitedCount

User clicks "Add agency"
  → ReferralTargetModal opens (add mode)
  → POST /referral-targets/ → append to list

User clicks "Edit"
  → ReferralTargetModal opens (edit mode, pre-filled)
  → PATCH /referral-targets/:id/ → update in list
  OR DELETE /referral-targets/:id/ → remove from list

User clicks "Generate PDF"
  → always fires generateReferralPdf(caseId)
  → downloads blob (existing behavior, no change)
```

---

## File Map

| File | Change |
|------|--------|
| `backend/investigations/models.py` | Add `ReferralTarget` model |
| `backend/investigations/migrations/0029_referraltarget.py` | Auto-generated |
| `backend/investigations/views.py` | Add `api_case_referral_targets` (GET/POST) + `api_case_referral_target_detail` (PATCH/DELETE) |
| `backend/investigations/urls.py` | Add two URL patterns |
| `frontend/src/types/index.ts` | Add `ReferralTarget` interface |
| `frontend/src/api/cases.ts` | Add 4 API functions |
| `frontend/src/api/index.ts` | Barrel exports |
| `frontend/src/views/ReferralsTab.tsx` | New component (table + modal + checklist + PDF) |
| `frontend/src/views/CaseDetailView.tsx` | Swap inline `ReferralsPanel` for lazy `ReferralsTab` |

---

## Acceptance Criteria

- Agency list persists to DB via `ReferralTarget` model
- Add/Edit/Delete works for all 4 Bright Future agencies (Ohio AG #123456, IRS 13909, FBI IC3, FCA OIG)
- Status changes are persisted (DRAFT → SENT → ACKNOWLEDGED → CLOSED)
- Checklist strip shows amber when confirmed angles exist with no linked docs
- Checklist strip shows green when all confirmed angles have ≥1 linked doc
- PDF button always enabled — never blocked
- Inline PDF warning echoes checklist count when uncited angles exist
- No regressions to existing PDF generation flow
