# Tie-Off Gate + Credibility Counts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn "CONFIRMED" into a server-enforced, evidentiary tie-off gate and replace the workspace `score/100` with a credibility triplet (`N referral-grade · M need work · K agency leads`).

**Architecture:** One referral-grade predicate defined once and reused by readiness, the credibility counts, and the PDF export filter. The gate is enforced in `FindingUpdateSerializer` (server is the sole decision-maker and sole audit writer); the frontend `TieOffModal` is display + a non-authoritative preview. A new `Finding.overreach_reviewed` boolean is the stored 4th gate input. No grandfathering: existing confirmed angles are not auto-flipped.

**Tech Stack:** Django (Python), Django-Q2; React + Vite + TypeScript; Vitest (frontend), Django test runner (backend). PDF via ReportLab (`referral_export.py`).

**Spec:** `docs/superpowers/specs/2026-06-18-tie-off-gate-and-credibility-design.md`

## Global Constraints

- **One atomic PR.** The migration + serializer gate + `TieOffModal` change ship together and merge in one commit. `main` deploys straight to Railway — a half-merged state breaks confirms in production. Do all tasks on one branch.
- **Commits are local checkpoints; squash before merge.** Each task's `git commit` step is a *checkpoint* **Tyler runs from his local machine** (sandbox git has hook-permission issues per CLAUDE.md). The per-task commits make review/rollback easy during implementation; **squash-merge the branch into one commit** so the deploy stays atomic. The per-task `git commit` lines below are the suggested checkpoint messages — they are not a contradiction of the atomic-PR rule.
- **Line length 100 max**; double quotes; spaces; LF. `views.py` is **not** E501-exempt — break long strings with parenthesized f-strings.
- **Frontend vocabulary (user-visible strings):** Angle = Finding, Knot = Person/Org, Lead = AI finding, Intake = extraction. **Banned strings anywhere user-visible:** "Haiku", "Sonnet", "Opus", "Claude", "AI assistant", "LLM", "GPT".
- **AuditLog is append-only — never UPDATE or DELETE.** Only the server writes it, only inside `transaction.atomic()`.
- **Referral-grade predicate (verbatim):** an Angle is referral-grade iff `status == CONFIRMED` ∧ `≥1 cited document` ∧ `evidence_weight ∈ {DOCUMENTED, TRACED}` ∧ `overreach_reviewed == True`.
- **Gate trigger (verbatim):** fire only when `instance.status != CONFIRMED` **and** the payload sets `status == CONFIRMED`. Never re-fire on edits of an already-confirmed angle (condition loss is allowed).
- **Error envelope (verbatim):** `400 {"errors": {"gate": {"unmet": [...]}}}` — condition keys only (`"citation"`, `"evidence_weight"`, `"narrative"`, `"overreach"`), no record contents.
- **Backend tests don't run cleanly in the default shell (2-min timeout).** Use the native fast loop: `$env:DB_HOST="127.0.0.1"; $env:DB_PORT="5433"; .\.venv\Scripts\python.exe backend\manage.py test investigations.tests.<module> --keepdb`. Full validation happens on Docker/Railway.
- **Frontend checks:** `cd frontend && npx tsc --noEmit` and `npx vitest run <path>`.

---

## Task Order & Dependency

Backend predicate/model first (everything depends on it), then gate, then API surfacing, then frontend. T1→T7 backend, T8→T13 frontend, T14 docs.

```
T1 model+migration ─► T2 predicate ─► T3 serializer field ─► T4 gate
                                  └─► T6 readiness+credibility ─► T7 PDF filter
T5 audit emission (after T4)
T8 types ─► T9 ApiError.body ─► T10 TieOffModal ─► T11 InvestigateTab ─► T12 EvidencePanel
T13 seed_demo · T14 docs
```

---

### Task 1: Add `Finding.overreach_reviewed` field + migration

**Files:**
- Modify: `backend/investigations/models.py` (the `Finding` model, near `evidence_weight` ~line 1284)
- Create: `backend/investigations/migrations/0035_finding_overreach_reviewed.py` (generated)
- Test: `backend/investigations/tests/test_overreach_field.py`

**Interfaces:**
- Produces: `Finding.overreach_reviewed: bool` (default `False`).

- [ ] **Step 1: Write the failing test**

```python
# backend/investigations/tests/test_overreach_field.py
from django.test import TestCase
from investigations.models import Case, Finding


class OverreachFieldTests(TestCase):
    def test_defaults_to_false(self):
        case = Case.objects.create(name="T")
        finding = Finding.objects.create(case=case, rule_id="MANUAL", title="A")
        self.assertFalse(finding.overreach_reviewed)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$env:DB_HOST="127.0.0.1"; $env:DB_PORT="5433"; .\.venv\Scripts\python.exe backend\manage.py test investigations.tests.test_overreach_field --keepdb`
Expected: FAIL — `AttributeError`/`FieldError`: `overreach_reviewed` does not exist.

- [ ] **Step 3: Add the field**

In `models.py`, in the `Finding` model immediately after the `evidence_weight` field:

```python
    overreach_reviewed = models.BooleanField(
        default=False,
        help_text=(
            "Investigator acknowledged the overreach checklist at tie-off. "
            "The 4th referral-grade gate condition. Never backfilled."
        ),
    )
```

- [ ] **Step 4: Generate the migration**

Run: `.\.venv\Scripts\python.exe backend\manage.py makemigrations investigations`
Expected: creates `0035_finding_overreach_reviewed.py` adding a `BooleanField(default=False)`. Confirm the file name/number; if the next number differs, rename references accordingly.

- [ ] **Step 5: Run test to verify it passes**

Run: `$env:DB_HOST="127.0.0.1"; $env:DB_PORT="5433"; .\.venv\Scripts\python.exe backend\manage.py test investigations.tests.test_overreach_field --keepdb`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/investigations/models.py backend/investigations/migrations/0035_finding_overreach_reviewed.py backend/investigations/tests/test_overreach_field.py
git commit -m "feat(model): add Finding.overreach_reviewed (tie-off gate input)"
```

---

### Task 2: Centralized referral-grade predicate

**Files:**
- Create: `backend/investigations/referral_grade.py`
- Test: `backend/investigations/tests/test_referral_grade.py`

**Interfaces:**
- Produces:
  - `referral_grade_qs(case) -> QuerySet[Finding]` — confirmed ∧ DOCUMENTED/TRACED ∧ overreach_reviewed ∧ ≥1 citation.
  - `is_referral_grade(finding) -> bool` — same predicate for a single instance.
  - `REFERRAL_WEIGHTS: list` — `[DOCUMENTED, TRACED]`.

- [ ] **Step 1: Write the failing test**

```python
# backend/investigations/tests/test_referral_grade.py
from django.test import TestCase
from investigations.models import (
    Case, Document, Finding, FindingDocument, FindingStatus, EvidenceWeight,
)
from investigations.referral_grade import is_referral_grade, referral_grade_qs


def _document(case, suffix="a"):
    # Document requires file_path, sha256_hash, file_size (NOT `sha256`).
    return Document.objects.create(
        case=case,
        filename=f"evidence-{suffix}.pdf",
        file_path=f"cases/test/evidence-{suffix}.pdf",
        sha256_hash=suffix * 64,
        file_size=1024,
    )


class ReferralGradeTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")

    def _confirmed(self, **kw):
        defaults = dict(
            case=self.case, rule_id="MANUAL", title="A",
            status=FindingStatus.CONFIRMED,
            evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=True,
        )
        defaults.update(kw)
        f = Finding.objects.create(**defaults)
        return f

    def test_full_predicate_is_grade(self):
        f = self._confirmed()
        FindingDocument.objects.create(finding=f, document=_document(self.case))
        self.assertTrue(is_referral_grade(f))
        self.assertEqual(referral_grade_qs(self.case).count(), 1)

    def test_missing_citation_not_grade(self):
        f = self._confirmed()
        self.assertFalse(is_referral_grade(f))
        self.assertEqual(referral_grade_qs(self.case).count(), 0)

    def test_overreach_false_not_grade(self):
        f = self._confirmed(overreach_reviewed=False)
        FindingDocument.objects.create(finding=f, document=_document(self.case))
        self.assertFalse(is_referral_grade(f))

    def test_weak_weight_not_grade(self):
        f = self._confirmed(evidence_weight=EvidenceWeight.SPECULATIVE)
        FindingDocument.objects.create(finding=f, document=_document(self.case))
        self.assertFalse(is_referral_grade(f))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$env:DB_HOST="127.0.0.1"; $env:DB_PORT="5433"; .\.venv\Scripts\python.exe backend\manage.py test investigations.tests.test_referral_grade --keepdb`
Expected: FAIL — `ModuleNotFoundError: investigations.referral_grade`.

- [ ] **Step 3: Implement the predicate module**

```python
# backend/investigations/referral_grade.py
"""Single source of truth for the referral-grade predicate.

An Angle (Finding) is "referral-grade" iff it is CONFIRMED, has at least one
cited document, has evidence weight DOCUMENTED or TRACED, and the investigator
acknowledged the overreach checklist at tie-off. Used by readiness, the
credibility counts, and the referral PDF filter so the definition never drifts.
"""

from django.db.models import Count

from .models import EvidenceWeight, Finding, FindingStatus

REFERRAL_WEIGHTS = [EvidenceWeight.DOCUMENTED, EvidenceWeight.TRACED]


def referral_grade_qs(case):
    """Queryset of referral-grade Angles for a case (O(1) queries)."""
    return (
        Finding.objects.filter(
            case=case,
            status=FindingStatus.CONFIRMED,
            evidence_weight__in=REFERRAL_WEIGHTS,
            overreach_reviewed=True,
        )
        .annotate(_citation_count=Count("document_links"))
        .filter(_citation_count__gt=0)
    )


def is_referral_grade(finding) -> bool:
    """True iff a single Finding instance meets every referral-grade condition."""
    return bool(
        finding.status == FindingStatus.CONFIRMED
        and finding.evidence_weight in REFERRAL_WEIGHTS
        and finding.overreach_reviewed
        and finding.document_links.exists()
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `$env:DB_HOST="127.0.0.1"; $env:DB_PORT="5433"; .\.venv\Scripts\python.exe backend\manage.py test investigations.tests.test_referral_grade --keepdb`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/investigations/referral_grade.py backend/investigations/tests/test_referral_grade.py
git commit -m "feat(backend): centralized referral-grade predicate"
```

---

### Task 3: Serializer carries `overreach_reviewed` (no gate yet)

**Files:**
- Modify: `backend/investigations/serializers.py` — `serialize_finding` (~700), `FindingUpdateSerializer.allowed_fields` (~853), `is_valid` validation (~955), `save` (~1031) + `update_fields` (~1056)
- Test: `backend/investigations/tests/test_overreach_field.py` (extend)

**Interfaces:**
- Consumes: `Finding.overreach_reviewed` (Task 1).
- Produces: `serialize_finding(f)["overreach_reviewed"]`; `UpdateFindingBody.overreach_reviewed` accepted and persisted.

- [ ] **Step 1: Write the failing test (append to test_overreach_field.py)**

```python
    def test_serializer_round_trips_overreach(self):
        from investigations.serializers import FindingUpdateSerializer, serialize_finding
        case = Case.objects.create(name="S")
        f = Finding.objects.create(case=case, rule_id="MANUAL", title="A")
        s = FindingUpdateSerializer(data={"overreach_reviewed": True}, instance=f)
        self.assertTrue(s.is_valid(), s.errors)
        s.save()
        f.refresh_from_db()
        self.assertTrue(f.overreach_reviewed)
        self.assertTrue(serialize_finding(f)["overreach_reviewed"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$env:DB_HOST="127.0.0.1"; $env:DB_PORT="5433"; .\.venv\Scripts\python.exe backend\manage.py test investigations.tests.test_overreach_field.OverreachFieldTests.test_serializer_round_trips_overreach --keepdb`
Expected: FAIL — `overreach_reviewed` rejected as an unexpected field.

- [ ] **Step 3a: Add to `serialize_finding`**

In the dict returned by `serialize_finding` (after `"evidence_weight": finding.evidence_weight,`):

```python
        "overreach_reviewed": finding.overreach_reviewed,
```

- [ ] **Step 3b: Add to `allowed_fields`**

In `FindingUpdateSerializer.allowed_fields`, add `"overreach_reviewed",`.

- [ ] **Step 3c: Validate it** (in `is_valid`, alongside the other field validations, before the final `return True`):

```python
        if "overreach_reviewed" in self.initial_data:
            val = self.initial_data["overreach_reviewed"]
            if not isinstance(val, bool):
                self._errors = {"overreach_reviewed": ["overreach_reviewed must be a boolean."]}
                return False
            self.validated_data["overreach_reviewed"] = val
```

- [ ] **Step 3d: Persist it** (in `save`, after the `evidence_weight` block ~line 1052):

```python
        if "overreach_reviewed" in self.validated_data:
            self.instance.overreach_reviewed = self.validated_data["overreach_reviewed"]
```

And in the `update_fields` list assembly (after the `evidence_weight` append ~line 1070):

```python
        if "overreach_reviewed" in self.validated_data:
            update_fields.append("overreach_reviewed")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `$env:DB_HOST="127.0.0.1"; $env:DB_PORT="5433"; .\.venv\Scripts\python.exe backend\manage.py test investigations.tests.test_overreach_field --keepdb`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/investigations/serializers.py backend/investigations/tests/test_overreach_field.py
git commit -m "feat(serializer): accept + persist + serialize overreach_reviewed"
```

---

### Task 4: The tie-off gate in `FindingUpdateSerializer`

**Files:**
- Modify: `backend/investigations/serializers.py` — `FindingUpdateSerializer.is_valid` (add the gate just before `return True`, ~line 1029)
- Test: `backend/investigations/tests/test_tie_off_gate.py`

**Interfaces:**
- Consumes: `_documents_to_add`/`_documents_to_remove` (already staged in `is_valid`), `Finding.overreach_reviewed`.
- Produces: `400 {"gate": {"unmet": [...]}}` in `serializer.errors` when a transition into CONFIRMED fails the predicate.

- [ ] **Step 1: Write the failing tests**

```python
# backend/investigations/tests/test_tie_off_gate.py
from django.test import TestCase
from investigations.models import (
    Case, Document, Finding, FindingDocument, FindingStatus, EvidenceWeight,
)
from investigations.serializers import FindingUpdateSerializer


def _document(case, suffix="a"):
    return Document.objects.create(
        case=case,
        filename=f"evidence-{suffix}.pdf",
        file_path=f"cases/test/evidence-{suffix}.pdf",
        sha256_hash=suffix * 64,
        file_size=1024,
    )


class TieOffGateTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="G")

    def _new_finding(self, **kw):
        return Finding.objects.create(case=self.case, rule_id="MANUAL", title="A", **kw)

    def test_confirm_with_nothing_lists_all_unmet(self):
        f = self._new_finding(status=FindingStatus.NEW)
        s = FindingUpdateSerializer(data={"status": "CONFIRMED"}, instance=f)
        self.assertFalse(s.is_valid())
        self.assertEqual(
            sorted(s.errors["gate"]["unmet"]),
            ["citation", "evidence_weight", "narrative", "overreach"],
        )

    def test_confirm_with_all_conditions_in_one_payload(self):
        f = self._new_finding(status=FindingStatus.NEW)
        doc = _document(self.case)
        s = FindingUpdateSerializer(
            data={
                "status": "CONFIRMED",
                "evidence_weight": "DOCUMENTED",
                "narrative": "Cited and substantiated.",
                "overreach_reviewed": True,
                "add_document_ids": [str(doc.id)],
            },
            instance=f,
        )
        self.assertTrue(s.is_valid(), s.errors)

    def test_editing_already_confirmed_angle_does_not_re_gate(self):
        # Condition loss is allowed: removing the last citation from a confirmed
        # angle succeeds (it just stops being referral-grade).
        f = self._new_finding(
            status=FindingStatus.CONFIRMED,
            evidence_weight=EvidenceWeight.DOCUMENTED,
            narrative="n",
            overreach_reviewed=True,
        )
        doc = _document(self.case)
        FindingDocument.objects.create(finding=f, document=doc)
        s = FindingUpdateSerializer(
            data={"remove_document_ids": [str(doc.id)]}, instance=f
        )
        self.assertTrue(s.is_valid(), s.errors)

    def test_idempotent_reconfirm_when_still_grade(self):
        f = self._new_finding(
            status=FindingStatus.CONFIRMED,
            evidence_weight=EvidenceWeight.TRACED,
            narrative="n",
            overreach_reviewed=True,
        )
        FindingDocument.objects.create(finding=f, document=_document(self.case))
        s = FindingUpdateSerializer(data={"status": "CONFIRMED"}, instance=f)
        self.assertTrue(s.is_valid(), s.errors)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `$env:DB_HOST="127.0.0.1"; $env:DB_PORT="5433"; .\.venv\Scripts\python.exe backend\manage.py test investigations.tests.test_tie_off_gate --keepdb`
Expected: FAIL — confirms succeed today with no gate (`is_valid` returns True).

- [ ] **Step 3: Implement the gate** (in `is_valid`, immediately before `return True`):

```python
        # --- Tie-off gate -----------------------------------------------------
        # Fire ONLY on a genuine transition into CONFIRMED. Editing an already
        # confirmed angle never re-gates (condition loss is allowed).
        if self.instance.status != FindingStatus.CONFIRMED and new_status == FindingStatus.CONFIRMED:
            existing = set(
                self.instance.document_links.values_list("document_id", flat=True)
            )
            add = {d.id for d in self._documents_to_add}
            remove = {d.id for d in self._documents_to_remove}
            post_docs = (existing | add) - remove

            post_weight = self.validated_data.get(
                "evidence_weight", self.instance.evidence_weight
            )
            post_narrative = self.validated_data.get("narrative", self.instance.narrative)
            post_overreach = self.validated_data.get(
                "overreach_reviewed", self.instance.overreach_reviewed
            )

            unmet = []
            if not post_docs:
                unmet.append("citation")
            if post_weight not in (EvidenceWeight.DOCUMENTED, EvidenceWeight.TRACED):
                unmet.append("evidence_weight")
            if not (post_narrative or "").strip():
                unmet.append("narrative")
            if not post_overreach:
                unmet.append("overreach")

            if unmet:
                self._errors = {"gate": {"unmet": unmet}}
                return False
```

Ensure `EvidenceWeight` and `FindingStatus` are imported at the top of `serializers.py` (they are already used elsewhere in this file).

- [ ] **Step 4: Run tests to verify they pass**

Run: `$env:DB_HOST="127.0.0.1"; $env:DB_PORT="5433"; .\.venv\Scripts\python.exe backend\manage.py test investigations.tests.test_tie_off_gate --keepdb`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/investigations/serializers.py backend/investigations/tests/test_tie_off_gate.py
git commit -m "feat(gate): enforce referral-grade predicate on CONFIRMED transition"
```

---

### Task 5: Emit `SIGNAL_CONFIRMED` / `SIGNAL_DISMISSED` on status transition

**Files:**
- Modify: `backend/investigations/views.py` — `api_case_finding_detail` PATCH branch, inside the `transaction.atomic()` after the `FINDING_UPDATED` audit write (~line 3407)
- Test: `backend/investigations/tests/test_tie_off_gate.py` (extend)

**Interfaces:**
- Produces: an `AuditLog` row with `action=SIGNAL_CONFIRMED` (→CONFIRMED) or `SIGNAL_DISMISSED` (→DISMISSED) per genuine status transition; provenance for the PDF.

- [ ] **Step 1: Write the failing test (append to test_tie_off_gate.py)**

```python
    def test_confirm_emits_signal_confirmed_audit_row(self):
        from investigations.models import AuditLog, AuditAction
        f = self._new_finding(status=FindingStatus.NEW)
        doc = _document(self.case)
        FindingDocument.objects.create(finding=f, document=doc)
        resp = self.client.patch(
            f"/api/cases/{self.case.pk}/findings/{f.pk}/",
            data={
                "status": "CONFIRMED",
                "evidence_weight": "DOCUMENTED",
                "narrative": "n",
                "overreach_reviewed": True,
            },
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(
            AuditLog.objects.filter(
                case_id=self.case.pk,
                record_id=f.pk,
                action=AuditAction.SIGNAL_CONFIRMED,
            ).exists()
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$env:DB_HOST="127.0.0.1"; $env:DB_PORT="5433"; .\.venv\Scripts\python.exe backend\manage.py test investigations.tests.test_tie_off_gate.TieOffGateTests.test_confirm_emits_signal_confirmed_audit_row --keepdb`
Expected: FAIL — only `FINDING_UPDATED` is written today.

- [ ] **Step 3: Emit the transition row** (in the PATCH branch, inside `with transaction.atomic():`, immediately after the existing `AuditLog.log(action=AuditAction.FINDING_UPDATED, ...)` call):

```python
        if before["status"] != updated.status:
            transition_action = {
                FindingStatus.CONFIRMED: AuditAction.SIGNAL_CONFIRMED,
                FindingStatus.DISMISSED: AuditAction.SIGNAL_DISMISSED,
            }.get(updated.status)
            if transition_action is not None:
                AuditLog.log(
                    action=transition_action,
                    table_name="findings",
                    record_id=updated.pk,
                    case_id=case.pk,
                    before_state={"status": before["status"]},
                    after_state={"status": updated.status},
                    performed_by=getattr(request, "api_token", None),
                )
```

Confirm `FindingStatus` and `AuditAction` are imported in `views.py` (both are already used there).

- [ ] **Step 4: Run test to verify it passes**

Run: `$env:DB_HOST="127.0.0.1"; $env:DB_PORT="5433"; .\.venv\Scripts\python.exe backend\manage.py test investigations.tests.test_tie_off_gate --keepdb`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/investigations/views.py backend/investigations/tests/test_tie_off_gate.py
git commit -m "feat(audit): emit SIGNAL_CONFIRMED/DISMISSED on finding status transition"
```

---

### Task 6: Readiness uses the predicate + `build_credibility` exposed

**Files:**
- Modify: `backend/investigations/views.py` — `build_case_readiness` (~2271, `confirmed_angles` item + return dict), `api_case_referral_readiness` (~2448 return), `api_case_dashboard` (~5362 return)
- Test: `backend/investigations/tests/test_credibility.py`

**Interfaces:**
- Consumes: `referral_grade_qs` (Task 2).
- Produces: `build_credibility(case) -> {"referral_grade", "need_work", "agency_leads"}`; `credibility` key on both the readiness and dashboard JSON; readiness BLOCKED when zero referral-grade.

- [ ] **Step 1: Write the failing tests**

```python
# backend/investigations/tests/test_credibility.py
from django.test import TestCase
from investigations.models import (
    Case, Document, Finding, FindingDocument, FindingStatus, EvidenceWeight,
)
from investigations.views import build_case_readiness, build_credibility


def _grade(case, **kw):
    f = Finding.objects.create(
        case=case, rule_id="MANUAL", title="A",
        status=FindingStatus.CONFIRMED, evidence_weight=EvidenceWeight.DOCUMENTED,
        overreach_reviewed=True, narrative="n", **kw,
    )
    FindingDocument.objects.create(
        finding=f,
        document=Document.objects.create(
            case=case, filename="d.pdf", file_path="cases/t/d.pdf",
            sha256_hash="z" * 64, file_size=1024,
        ),
    )
    return f


class CredibilityTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")

    def test_triplet_counts(self):
        _grade(self.case)  # referral-grade
        Finding.objects.create(case=self.case, rule_id="MANUAL", title="N", status=FindingStatus.NEW)
        # confirmed-but-unmet (overreach False) counts as need-work, not referral-grade
        Finding.objects.create(
            case=self.case, rule_id="MANUAL", title="U",
            status=FindingStatus.CONFIRMED, evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=False,
        )
        c = build_credibility(self.case)
        self.assertEqual(c["referral_grade"], 1)
        self.assertEqual(c["need_work"], 2)
        self.assertEqual(c["agency_leads"], 0)

    def test_readiness_blocked_and_names_overreach_when_only_unreviewed_confirmed(self):
        # Confirmed + cited + documented but overreach NOT reviewed: one ack away.
        f = Finding.objects.create(
            case=self.case, rule_id="MANUAL", title="U",
            status=FindingStatus.CONFIRMED, evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=False, narrative="n",
        )
        FindingDocument.objects.create(
            finding=f,
            document=Document.objects.create(
                case=self.case, filename="d.pdf", file_path="cases/t/d.pdf",
                sha256_hash="w" * 64, file_size=1024,
            ),
        )
        readiness = build_case_readiness(self.case)
        self.assertEqual(readiness["status"], "BLOCKED")
        self.assertEqual(readiness["credibility"]["referral_grade"], 0)
        # The missing condition is named, not hidden behind the generic FAIL.
        by_key = {item["key"]: item for item in readiness["items"]}
        self.assertEqual(by_key["overreach_review"]["status"], "WARN")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `$env:DB_HOST="127.0.0.1"; $env:DB_PORT="5433"; .\.venv\Scripts\python.exe backend\manage.py test investigations.tests.test_credibility --keepdb`
Expected: FAIL — `build_credibility` undefined; no `credibility` key.

- [ ] **Step 3a: Add `build_credibility`** (in `views.py`, just above `build_case_readiness` ~line 2270):

```python
def build_credibility(case):
    """Header triplet: referral-grade vs need-work Angles + agency leads.

    agency_leads is 0 until RecipientGap lands (case-workspace item 4); the slot
    exists now so the header shape is final.
    """
    from .referral_grade import referral_grade_qs

    referral_grade = referral_grade_qs(case).count()
    confirmed = Finding.objects.filter(case=case, status=FindingStatus.CONFIRMED).count()
    active = Finding.objects.filter(
        case=case, status__in=[FindingStatus.NEW, FindingStatus.NEEDS_EVIDENCE]
    ).count()
    # need-work = active states + confirmed-but-not-referral-grade (excludes DISMISSED)
    need_work = active + (confirmed - referral_grade)
    return {
        "referral_grade": referral_grade,
        "need_work": need_work,
        "agency_leads": 0,
    }
```

- [ ] **Step 3b: Drive the `confirmed_angles` readiness item off the predicate.** In `build_case_readiness`, after `confirmed_count = confirmed_qs.count()` (~line 2276) add:

```python
    from .referral_grade import referral_grade_qs

    referral_grade_count = referral_grade_qs(case).count()
```

Then change the `confirmed_angles` `_readiness_item(...)` (~line 2316) to key off `referral_grade_count`:

```python
        _readiness_item(
            "confirmed_angles",
            "Confirmed angles",
            "PASS" if referral_grade_count else "FAIL",
            (
                f"{referral_grade_count} referral-grade angle"
                f"{'' if referral_grade_count == 1 else 's'} ready for referral."
                if referral_grade_count
                else "Tie off at least one referral-grade angle before export."
            ),
            referral_grade_count,
            "investigate",
        ),
```

Also compute the **overreach-pending** count (angles one acknowledgement away from referral-grade) near the other counts:

```python
    overreach_pending = (
        confirmed_qs.filter(
            evidence_weight__in=[EvidenceWeight.DOCUMENTED, EvidenceWeight.TRACED],
            overreach_reviewed=False,
        )
        .annotate(_cc=Count("document_links"))
        .filter(_cc__gt=0)
        .count()
    )
```

And add a dedicated checklist item to the `items` list so the missing condition is **legible** (not hidden behind a generic confirmed-angles FAIL):

```python
        _readiness_item(
            "overreach_review",
            "Overreach review",
            "WARN" if overreach_pending else "PASS",
            (
                f"{overreach_pending} confirmed angle"
                f"{'' if overreach_pending == 1 else 's'} need an overreach acknowledgement "
                "to become referral-grade."
                if overreach_pending
                else "All cited, documented angles have passed overreach review."
            ),
            overreach_pending,
            "investigate",
        ),
```

> **WARN, not FAIL, on purpose:** the zero-referral-grade blocker is already carried by
> `confirmed_angles`. Making overreach a second FAIL would block a case that *does* have a
> referral-grade angle merely because a *secondary* angle is mid-tie-off. WARN surfaces the
> reason legibly without over-blocking a referable case.

- [ ] **Step 3a-2: Register the new readiness key's weight.** `_build_case_quality` looks up `READINESS_QUALITY_WEIGHTS[item["key"]]` and will `KeyError` on an unregistered key. Add `overreach_review` with weight **0** (score-neutral — legibility only, so the existing 100-point scale and prior score assertions are unchanged):

```python
READINESS_QUALITY_WEIGHTS = {
    "citation_coverage": 25,
    "evidence_weight": 20,
    "confirmed_angles": 20,
    "failed_extraction": 15,
    "referral_target": 10,
    "pending_connections": 4,
    "pending_extraction": 3,
    "active_jobs": 3,
    "overreach_review": 0,
}
```

- [ ] **Step 3c: Add `credibility` to the readiness return** (~line 2434):

```python
    return {
        "status": status,
        "summary": summary,
        "items": items,
        "quality": _build_case_quality(items),
        "credibility": build_credibility(case),
    }
```

- [ ] **Step 3d: Surface `credibility` on the two endpoints.** In `api_case_referral_readiness` return (~2448) add `"credibility": readiness["credibility"],`. In `api_case_dashboard`, the `readiness = build_case_readiness(case)` result is already available (~5360); add a `"credibility": readiness["credibility"],` key to its `JsonResponse` dict (top level, alongside `"findings"`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `$env:DB_HOST="127.0.0.1"; $env:DB_PORT="5433"; .\.venv\Scripts\python.exe backend\manage.py test investigations.tests.test_credibility --keepdb`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/investigations/views.py backend/investigations/tests/test_credibility.py
git commit -m "feat(api): credibility triplet + predicate-driven readiness"
```

---

### Task 7: Align the referral PDF filter to the predicate (+ fix existing fixtures)

**Files:**
- Modify: `backend/investigations/views.py` — `api_case_referral_pdf` `findings_qs` (~6057)
- Modify: `backend/investigations/tests/test_referral_pdf.py`, `backend/investigations/tests/test_referral_readiness.py` (existing fixtures)
- Test: `backend/investigations/tests/test_referral_pdf.py` (add one)

**Interfaces:**
- Consumes: `referral_grade_qs` (Task 2).

- [ ] **Step 1: Write the failing test (append to test_referral_pdf.py)**

```python
    def test_pdf_excludes_overreach_unreviewed_confirmed(self):
        # A confirmed, documented, cited angle that is NOT overreach-reviewed
        # must not appear in the package (and must not satisfy readiness alone).
        from investigations.models import (
            Case, Document, Finding, FindingDocument, FindingStatus, EvidenceWeight,
            ReferralTarget,
        )
        case = Case.objects.create(name="PDF excl")
        ReferralTarget.objects.create(
            case=case, agency_name="Ohio AG", complaint_type="Charitable fraud",
        )
        f = Finding.objects.create(
            case=case, rule_id="MANUAL", title="Unreviewed",
            status=FindingStatus.CONFIRMED, evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=False, narrative="n",
        )
        FindingDocument.objects.create(
            finding=f,
            document=Document.objects.create(
                case=case, filename="d.pdf", file_path="cases/t/d.pdf",
                sha256_hash="q" * 64, file_size=1024,
            ),
        )
        resp = self.client.post(f"/api/cases/{case.pk}/referral-pdf/")
        # Zero referral-grade angles ⇒ readiness BLOCKED ⇒ 400.
        self.assertEqual(resp.status_code, 400, resp.content)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$env:DB_HOST="127.0.0.1"; $env:DB_PORT="5433"; .\.venv\Scripts\python.exe backend\manage.py test investigations.tests.test_referral_pdf --keepdb`
Expected: FAIL — today the angle passes the `confirmed ∧ DOCUMENTED/TRACED` filter and readiness, so it is not excluded.

- [ ] **Step 3a: Replace the export filter** in `api_case_referral_pdf` (~6057):

```python
    from .referral_grade import referral_grade_qs

    findings_qs = (
        referral_grade_qs(case)
        .prefetch_related("entity_links", "document_links")
        .order_by("-severity", "created_at")
    )
```

- [ ] **Step 3b: Update existing fixtures.** In `test_referral_pdf.py` and `test_referral_readiness.py`, every place that creates a CONFIRMED finding intended to be referable must now also set `overreach_reviewed=True` (and already have a citation + DOCUMENTED/TRACED weight). Grep each file for `status=FindingStatus.CONFIRMED` / `"status": "CONFIRMED"` and add `overreach_reviewed=True` to those intended as referral-grade. Leave deliberately-incomplete fixtures unchanged.

- [ ] **Step 4: Run the affected suites to verify green**

Run: `$env:DB_HOST="127.0.0.1"; $env:DB_PORT="5433"; .\.venv\Scripts\python.exe backend\manage.py test investigations.tests.test_referral_pdf investigations.tests.test_referral_readiness --keepdb`
Expected: PASS (new test passes; updated fixtures keep prior assertions green).

- [ ] **Step 5: Commit**

```bash
git add backend/investigations/views.py backend/investigations/tests/test_referral_pdf.py backend/investigations/tests/test_referral_readiness.py
git commit -m "feat(pdf): align referral export filter to referral-grade predicate"
```

---

### Task 8: Frontend TypeScript types

**Files:**
- Modify: `frontend/src/types/index.ts` — `FindingItem` (~738), `UpdateFindingBody` (~814), `DashboardResponse` (~318), `AuditAction` (~1050)
- Test: typecheck only (`npx tsc --noEmit`)

**Interfaces:**
- Produces: `CredibilityCounts`; `FindingItem.overreach_reviewed`; `UpdateFindingBody.overreach_reviewed`; `DashboardResponse.credibility`; corrected `AuditAction`.

- [ ] **Step 1: Add `overreach_reviewed` to `FindingItem`** (after `evidence_weight`):

```typescript
  /** Investigator acknowledged the overreach checklist at tie-off (4th gate condition). */
  overreach_reviewed: boolean;
```

- [ ] **Step 2: Add to `UpdateFindingBody`** (optional):

```typescript
  overreach_reviewed?: boolean;
```

- [ ] **Step 3: Add `CredibilityCounts` + `DashboardResponse.credibility`.** Define above `DashboardResponse`:

```typescript
export interface CredibilityCounts {
  referral_grade: number;
  need_work: number;
  /** Open RecipientGap items. 0 until case-workspace item 4. */
  agency_leads: number;
}
```

And add to the `DashboardResponse` interface body:

```typescript
  credibility: CredibilityCounts;
```

- [ ] **Step 4: Fix the phantom `AuditAction` values.** The backend emits `SIGNAL_CONFIRMED`/`SIGNAL_DISMISSED` (never `FINDING_CONFIRMED`/`FINDING_DISMISSED`). Replace those two union members:

```typescript
  | "FINDING_UPDATED"
  | "SIGNAL_DISMISSED"
  | "SIGNAL_CONFIRMED"
```

(Remove `"FINDING_DISMISSED"` and `"FINDING_CONFIRMED"`. If any code references the removed names, update it to the `SIGNAL_*` forms.)

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (or surfaces the call sites needing the `SIGNAL_*` rename — fix them).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "feat(types): overreach_reviewed, CredibilityCounts, fix phantom AuditAction"
```

---

### Task 9: `ApiError` carries the parsed body

**Files:**
- Modify: `frontend/src/api/base.ts` — `ApiError` (~46), `fetchApi` error branch (~111)
- Test: `frontend/src/api/base.test.ts`

**Interfaces:**
- Produces: `ApiError.body: unknown` (parsed JSON error body, or `undefined`).

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/api/base.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchApi, ApiError } from "./base";

afterEach(() => vi.restoreAllMocks());

describe("fetchApi error body", () => {
  it("attaches the parsed JSON body to ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ errors: { gate: { unmet: ["narrative"] } } }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    await expect(fetchApi("/api/x/")).rejects.toMatchObject({
      status: 400,
    });
    try {
      await fetchApi("/api/x/");
    } catch (e) {
      const err = e as ApiError;
      expect((err.body as any)?.errors?.gate?.unmet).toEqual(["narrative"]);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/api/base.test.ts`
Expected: FAIL — `err.body` is undefined.

- [ ] **Step 3: Add `body` to `ApiError` and populate it**

Change the class:

```typescript
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}
```

In `fetchApi`, hoist the parsed body so it survives, and pass it to the throw:

```typescript
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    let parsedBody: unknown;
    try {
      parsedBody = await response.json();
      const errBody = parsedBody as Record<string, unknown>;
      if (typeof errBody?.detail === "string") {
        message = errBody.detail;
      } else if (typeof errBody === "object" && errBody !== null) {
        const firstField = Object.keys(errBody)[0];
        const firstMsg = (errBody as Record<string, unknown>)[firstField];
        if (Array.isArray(firstMsg) && typeof firstMsg[0] === "string") {
          message = `${firstField}: ${firstMsg[0]}`;
        }
      }
    } catch {
      // Non-JSON error body — keep the status text message
    }
    throw new ApiError(response.status, message, parsedBody);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/api/base.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/base.ts frontend/src/api/base.test.ts
git commit -m "feat(api): ApiError carries parsed error body for structured gate errors"
```

---

### Task 10: Harden `TieOffModal` (overreach checklist, send field, render gate errors, read-only rule)

**Files:**
- Modify: `frontend/src/components/TieOffModal.tsx`
- Modify: `frontend/src/index.css` (remove `.tieoff-select*` ~1762)
- Test: `frontend/src/components/TieOffModal.test.tsx` (replace render-only with behavioral)

**Interfaces:**
- Consumes: `ApiError.body` (Task 9), `UpdateFindingBody.overreach_reviewed` (Task 8), `updateAngle`.

- [ ] **Step 1: Write the failing behavioral tests** (replace the file body)

```tsx
// frontend/src/components/TieOffModal.test.tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TieOffModal from "./TieOffModal";
import type { FindingItem } from "../types";

vi.mock("../api", () => ({ updateAngle: vi.fn() }));
import { updateAngle } from "../api";

afterEach(() => vi.restoreAllMocks());

const baseFinding: FindingItem = {
  id: "11111111-1111-1111-1111-111111111111",
  rule_id: "SR-015", title: "Insider swap", description: "", narrative: "A narrative.",
  severity: "HIGH", status: "NEEDS_EVIDENCE", evidence_weight: "DOCUMENTED",
  overreach_reviewed: false, source: "MANUAL", investigator_note: "", legal_refs: [],
  evidence_snapshot: {}, trigger_doc_id: null, trigger_doc_filename: null,
  trigger_entity_id: null, created_at: "", updated_at: "",
  entity_links: [], document_links: [{ document_id: "d", document_filename: "d.pdf", page_reference: null, context_note: null }],
};

function setup(overrides: Partial<FindingItem> = {}) {
  return render(
    <TieOffModal open caseId="c" finding={{ ...baseFinding, ...overrides }}
      onClose={() => {}} onTiedOff={() => {}} />,
  );
}

describe("TieOffModal gate", () => {
  it("disables Confirm until overreach is acknowledged", () => {
    setup();
    const confirm = screen.getByRole("button", { name: /confirm angle/i });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/overreach/i));
    expect(confirm).toBeEnabled();
  });

  it("shows rule read-only and never PATCHes rule_id", async () => {
    (updateAngle as any).mockResolvedValue({ ...baseFinding, status: "CONFIRMED", overreach_reviewed: true });
    setup();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText(/SR-015/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/overreach/i));
    fireEvent.click(screen.getByRole("button", { name: /confirm angle/i }));
    await waitFor(() => expect(updateAngle).toHaveBeenCalled());
    const body = (updateAngle as any).mock.calls[0][2];
    expect(body).not.toHaveProperty("rule_id");
    expect(body.overreach_reviewed).toBe(true);
  });

  it("renders the server gate reason when confirm 400s despite a valid-looking local state", async () => {
    // Locally valid (narrative + citation + DOCUMENTED + overreach ack) so the
    // button is ENABLED and the click reaches the request — but the server
    // rejects with a stale-state 400 (e.g. the doc was removed elsewhere).
    const err: any = new Error("gate"); err.status = 400;
    err.body = { errors: { gate: { unmet: ["citation"] } } };
    (updateAngle as any).mockRejectedValue(err);
    setup();  // baseFinding has narrative + a document_link + DOCUMENTED weight
    fireEvent.click(screen.getByLabelText(/overreach/i));
    const confirm = screen.getByRole("button", { name: /confirm angle/i });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(screen.getByText(/missing: citation/i)).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/TieOffModal.test.tsx`
Expected: FAIL — no overreach control, dropdown still present, no gate-error rendering.

- [ ] **Step 3: Rewrite `TieOffModal.tsx`.** Apply these changes:

1. **Delete** `SIGNAL_RULES`, `RULE_IDS`, `resolveRuleId`, the `ruleId`/`setRuleId` state, and the rule `<select>` section. Replace the section with a read-only label:

```tsx
            {/* Signal rule (read-only — rule_id is part of the dedup identity) */}
            <section aria-label="Signal rule">
              <p className="panel-section__title">Signal rule</p>
              <p className="tieoff-rule-readonly">{finding.rule_id || "MANUAL"}</p>
            </section>
```

2. **Add overreach state + checklist.** Add `const [overreachAck, setOverreachAck] = useState(false);` and render (after the Evidence-weight section, before Outcome):

```tsx
            {/* Overreach acknowledgement — the 4th gate condition */}
            <section aria-label="Overreach review">
              <p className="panel-section__title">Overreach review</p>
              <label className="tieoff-overreach">
                <input
                  type="checkbox"
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
```

3. **Local preview + send field.** Compute unmet locally and gate the button when the outcome is "confirmed":

```tsx
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
```

4. **Server-truth fallback.** Add `const [serverUnmet, setServerUnmet] = useState<string[] | null>(null);` and in `handleConfirm`, send `overreach_reviewed` and read the gate error:

```tsx
      const body = {
        status: outcome === "confirmed" ? ("CONFIRMED" as const) : ("DISMISSED" as const),
        evidence_weight: evidenceWeight,
        overreach_reviewed: outcome === "confirmed" ? true : finding.overreach_reviewed,
        investigator_note: outcome === "exhausted" ? dismissalRationale.trim() : finding.investigator_note,
      };
      try {
        const updated = await updateAngle(caseId, finding.id, body);
        onTiedOff(updated);
        onClose();
      } catch (e) {
        const unmet = (e as { body?: { errors?: { gate?: { unmet?: string[] } } } })
          ?.body?.errors?.gate?.unmet;
        if (Array.isArray(unmet)) setServerUnmet(unmet);
        else throw e;
      } finally {
        setSaving(false);
      }
```

(Remove the now-fabricated `investigator_note: \`Rule: ${ruleId}\``.)

5. **Render unmet conditions.** Above the footer, show the preview/server gaps:

```tsx
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
```

6. **Disable Confirm:** set the primary button `disabled={saving || confirmBlocked}`.

Map the human labels for `localUnmet`/`serverUnmet` if you prefer friendlier copy (e.g. `citation → "a cited document"`); keys are acceptable for v1.

- [ ] **Step 4: Remove dead CSS.** In `index.css`, delete the `.tieoff-select` / `.tieoff-select-wrapper` rules (~1762). Add minimal styles for `.tieoff-rule-readonly` and `.tieoff-overreach` if needed (reuse existing tokens).

- [ ] **Step 5: Run tests + typecheck**

Run: `cd frontend && npx vitest run src/components/TieOffModal.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/TieOffModal.tsx frontend/src/components/TieOffModal.test.tsx frontend/src/index.css
git commit -m "feat(tieoff): overreach checklist, send gate field, server-error render, read-only rule"
```

---

### Task 11: Credibility triplet replaces score/100 in `InvestigateTab`

**Files:**
- Modify: `frontend/src/views/InvestigateTab.tsx` — `CaseQualityPanel` (~240) and its call site (~399)
- Test: `frontend/src/views/InvestigateTab.test.tsx` (add or extend)

**Interfaces:**
- Consumes: `DashboardResponse.credibility` (Task 8).

- [ ] **Step 1: Write the failing test**

```tsx
// add to frontend/src/views/InvestigateTab.test.tsx (create if absent)
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CredibilityHeader } from "./InvestigateTab";

describe("CredibilityHeader", () => {
  it("shows the triplet and never the score/100", () => {
    const { container } = render(
      <CredibilityHeader credibility={{ referral_grade: 3, need_work: 5, agency_leads: 2 }} />,
    );
    // Robust to text split across spans/nodes: assert on combined textContent.
    const text = container.textContent ?? "";
    expect(text).toContain("3 referral-grade");
    expect(text).toContain("5 need work");
    expect(text).toContain("2 agency leads");
    expect(text).not.toContain("/ 100");
  });
});
```

> This requires exporting a small `CredibilityHeader` component. If you prefer not to export, assert via the full panel render instead — but a focused exported component is cleaner to test.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/views/InvestigateTab.test.tsx`
Expected: FAIL — `CredibilityHeader` not exported.

- [ ] **Step 3: Replace the score headline.** Add an exported component and use it in `CaseQualityPanel`’s headline slot (keep the `grade` badge + top gaps if desired; remove the `{quality.score} / 100` span):

```tsx
export function CredibilityHeader({ credibility }: { credibility?: CredibilityCounts }) {
  if (!credibility) return null;
  const { referral_grade, need_work, agency_leads } = credibility;
  return (
    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>
      <span style={{ color: "var(--color-success, #34d399)" }}>● {referral_grade} referral-grade</span>
      {"  ·  "}
      <span style={{ color: "#fbbf24" }}>◐ {need_work} need work</span>
      {"  ·  "}
      <span style={{ color: "var(--text-3)" }}>◷ {agency_leads} agency leads</span>
    </div>
  );
}
```

Change the call site (~399) to pass credibility and lead with the header:

```tsx
      <CredibilityHeader credibility={dashboard?.credibility} />
      <CaseQualityPanel quality={dashboard?.quality} />
```

Remove the `{quality.score} / 100` `<span>` from `CaseQualityPanel` (keep the `grade` badge as a secondary signal, or delete the panel’s headline row entirely — do not surface `score/100` in the workspace).

Import `CredibilityCounts` from `../types`.

- [ ] **Step 4: Run test + typecheck**

Run: `cd frontend && npx vitest run src/views/InvestigateTab.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/InvestigateTab.tsx frontend/src/views/InvestigateTab.test.tsx
git commit -m "feat(investigate): lead with credibility triplet; drop score/100 from workspace"
```

---

### Task 12: Align `EvidencePanel` to the predicate (official four blocking; rest advisory)

**Files:**
- Modify: `frontend/src/views/AngleView.tsx` — `EvidencePanel` (~210)
- Test: covered by `tsc` + existing AngleView tests; add a focused assertion if an AngleView test file exists.

**Interfaces:**
- Consumes: `FindingItem.overreach_reviewed` (Task 8).

- [ ] **Step 1: Split blocking vs advisory.** Replace the `gapItems` block:

```tsx
  const blockingGaps = [
    citedCount === 0 ? "Cite at least one source document." : null,
    !hasNarrative ? "Write the angle narrative." : null,
    !hasReferralWeight ? "Raise evidence weight to Documented or Traced." : null,
    !finding.overreach_reviewed ? "Acknowledge the overreach checklist at tie-off." : null,
  ].filter((item): item is string => item !== null);

  const advisoryGaps = [
    docRefs.length === 0 && citedCount > 0
      ? "Add [Doc-N] references where the narrative makes evidence claims."
      : null,
    !hasKnots ? "Tie this angle to at least one person or organization knot." : null,
  ].filter((item): item is string => item !== null);

  const readyForReferral = blockingGaps.length === 0 && isConfirmed;
```

- [ ] **Step 2: Render advisory gaps separately** (below the blocking list) so they read as hints, not blockers. Reuse the existing list markup; label the advisory group "Suggestions" and keep the `readyForReferral` status driven by `blockingGaps` + `isConfirmed` only.

- [ ] **Step 2b: Distinguish three summary states in the copy** so an angle that meets every evidence requirement but is not yet tied off doesn't read as "0 gaps" or "Ready":

```tsx
  const summaryText = readyForReferral
    ? "This angle is referral-grade."
    : blockingGaps.length === 0 && !isConfirmed
      ? "Meets evidence requirements — tie off to make this angle referral-grade."
      : `${pluralize(blockingGaps.length, "gap")} before referral-grade.`;
```

Use `summaryText` for the panel summary, and only show the "Ready" status pill when `readyForReferral` is true; otherwise show "Needs evidence" (existing behavior).

- [ ] **Step 3: Typecheck + existing tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run src/views`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/AngleView.tsx
git commit -m "feat(angle): EvidencePanel blocking = official four; knot/doc-ref advisory"
```

---

### Task 13: `seed_demo` — a deliberate mix of referral-grade and need-work

**Files:**
- Modify: `backend/investigations/management/commands/seed_demo.py`
- Test: manual verification query (data authoring)

**Interfaces:**
- Consumes: `Finding.overreach_reviewed` (Task 1).

- [ ] **Step 1: Locate the confirmed-angle creation.** Grep `seed_demo.py` for where it sets confirmed findings (e.g. `status=FindingStatus.CONFIRMED` or a post-create update). Read that block.

- [ ] **Step 2: Set `overreach_reviewed=True` on a subset.** For the angles that already get a citation + DOCUMENTED/TRACED weight, mark roughly half referral-grade and leave the rest as need-work. Concretely, after the confirmed angles are created and cited, add a deterministic split:

```python
        # Author a realistic in-progress case: some angles fully tied off
        # (referral-grade), some still need work. No silent grandfathering —
        # the seed legitimately authors reviewed angles.
        confirmed = list(
            Finding.objects.filter(case=case, status=FindingStatus.CONFIRMED).order_by("created_at")
        )
        for finding in confirmed[: len(confirmed) // 2 + 1]:
            finding.overreach_reviewed = True
            finding.save(update_fields=["overreach_reviewed"])
```

Place this after citations and evidence weights are assigned, so the marked subset is genuinely referral-grade.

- [ ] **Step 3: Verify the mix**

Run (native DB):
```
$env:DB_HOST="127.0.0.1"; $env:DB_PORT="5433"; .\.venv\Scripts\python.exe backend\manage.py seed_demo
.\.venv\Scripts\python.exe backend\manage.py shell -c "from investigations.models import Case; from investigations.views import build_credibility; c=Case.objects.first(); print(build_credibility(c))"
```
Expected: `referral_grade` > 0 **and** `need_work` > 0 (a mix, not all-or-nothing).

- [ ] **Step 4: Commit**

```bash
git add backend/investigations/management/commands/seed_demo.py
git commit -m "feat(seed): mix of referral-grade and need-work angles for the demo"
```

---

### Task 14: Update the contract + design docs

**Files:**
- Modify: `docs/architecture/api-contract.md` (~586)
- Modify: `docs/architecture/frontend-design-spec.md` (~542)

- [ ] **Step 1: `api-contract.md`** — document: `FindingItem.overreach_reviewed: boolean`; `UpdateFindingBody.overreach_reviewed?: boolean`; `DashboardResponse.credibility: {referral_grade, need_work, agency_leads}`; readiness `confirmed_angles` now keyed on referral-grade; the gate error `400 {"errors": {"gate": {"unmet": [...]}}}`; and that tie-off shows `rule_id` read-only and never PATCHes it.

- [ ] **Step 2: `frontend-design-spec.md:542`** — correct the tie-off description: it no longer sends `rule_id=<selected>`; the rule is shown read-only and tie-off sends `overreach_reviewed`.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/api-contract.md docs/architecture/frontend-design-spec.md
git commit -m "docs: contract + design-spec updates for tie-off gate + credibility"
```

---

## Final Verification (before opening the PR)

- [ ] Backend (Docker, full suite — local times out): `docker compose up -d` then `docker compose exec backend python manage.py test investigations --keepdb`. Expected: green (≥ the prior count + new tests).
- [ ] Frontend: `cd frontend && npx tsc --noEmit && npx vitest run`. Expected: green.
- [ ] Smoke test: `/smoke-test` (or `python tests/api_health_check.py`) against the local stack.
- [ ] Confirm the branch holds the whole atomic change (migration + gate + modal). Open one PR.

## Spec Coverage Check

| Spec section | Task |
|---|---|
| §5 model `overreach_reviewed` | T1 |
| §6 gate (post-PATCH, collect-all, trigger, condition-loss) | T4 |
| §6 audit emission `SIGNAL_CONFIRMED/DISMISSED` | T5 |
| §7 one predicate, three call sites | T2 (def), T6 (readiness/counts), T7 (PDF) |
| §8 credibility counts API | T6 |
| §9 TieOffModal harden + read-only rule + transport | T9, T10 |
| §9 EvidencePanel alignment | T12 |
| §9 InvestigateTab triplet | T11 |
| §10 seed mix + tests | T13, tests across T1–T12 |
| §11 atomic PR | Global Constraints + Final Verification |
| §11.5 types / AuditAction fix / api-contract | T8, T14 |
