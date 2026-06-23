# Case Map Phase 4B — Gate Flip + Thread Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the 4A Thread-Assertion backend into a live, `gate_version`-aware referral gate **and** ship the full-width `ThreadBuilder` UI that can author cited assertions — as one atomic deploy unit.

**Architecture:** Two backend gate edits (Tier-1 tie-off serializer + Tier-2 `referral_grade.py`) flip from the dead `narrative` check to the already-built `thread_elements.py` helpers, branching on `Finding.gate_version`. The frontend replaces the freeform `AngleView` narrative editor with `ThreadBuilder` — an ordered list of assertion cards (`ElementCard`) backed by the element CRUD / citation / reorder endpoints that already exist from 4A. `LEGACY_NARRATIVE` threads keep the old gate and a non-blocking convert prompt.

**Tech Stack:** Django (custom non-DRF serializers), Postgres, React + TypeScript + Vite, Cytoscape (unchanged), Vitest, Ruff.

## Global Constraints

- **Deployment-sequencing invariant (load-bearing):** the gate flip must NOT reach `main` before the `ThreadBuilder` UI. Today's `AngleView` cannot author cited assertions; a gate flip ahead of the UI would make the live tool unable to confirm new threads. **All tasks in this plan ship in one PR / one deploy unit.** Do not split the backend tasks into their own merge.
- **Line length:** 100 chars max (Ruff). `views.py` is NOT E501-exempt — break long f-strings with parenthesized concatenation. Quote style: double quotes; indent: spaces; LF endings.
- **Banned strings in any user-visible text:** "Haiku", "Sonnet", "Opus", "Claude", "AI assistant", "LLM", "GPT". AI-derived structure is surfaced as "Lead" / "Intake" only (no 4D AI in this plan).
- **Frontend vocabulary (user-visible only):** "Thread" (not Angle/Finding), "Subject", "Relationship", "Substantiated" (CONFIRMED), "Set aside" (DISMISSED). Internal identifiers stay: `frame.kind === "angle"`, `FindingItem`, `fetchAngle`, etc. are NOT renamed.
- **Backend tests** run in the already-running Docker stack, CI-equivalent: `docker exec catalyst_backend python manage.py test investigations --exclude-tag=eval --keepdb --noinput`. **Frontend** gate: `cd frontend && npx tsc --noEmit && npx vitest run`.
- **Commits: one per task (CLAUDE.md).** Pre-commit hooks are dormant in this environment — run `ruff check` / `ruff format` (backend) manually before each commit. Each task ends with its own commit after its verification gate is green; the `git …` lines show the intended file scope + message. **Push + PR (Task 10) is the one outward-facing step — Tyler-confirmed, never automatic.**
- **`ThreadElementCitation` ↔ `document_links` sync is serializer-layer, not a model invariant.** `ensure_document_link` runs only in `ThreadElementCitationSerializer.save()` (serializers.py:1318) — `ThreadElementCitation.objects.create(...)` does NOT populate `document_links`. In tests, author cited assertions via the citation serializer/API path **or** add an explicit `FindingDocument.objects.create(...)`; never rely on the bare citation model to satisfy the gate's doc check. (Production hazard to keep in mind: any future write of a `ThreadElementCitation` outside the serializer silently desyncs `document_links`.)
- **`referral_grade.py` is the single source of truth** for the predicate. `is_referral_grade(finding)` and `referral_grade_qs(case)` MUST agree (parity test). `threadReadiness.ts` mirrors it on the frontend.
- New threads default to `gate_version = ASSERTION_V1`; `LEGACY_NARRATIVE` is only set by the 0038 backfill on pre-existing referral-grade findings — **never demoted**.

---

## File Structure

**Backend (the narrow part — helpers already exist):**
- `backend/investigations/serializers.py` — `FindingUpdateSerializer` Tier-1 gate (lines ~1010-1043): replace the `post_narrative` check with a `gate_version`-aware cited-assertion check.
- `backend/investigations/referral_grade.py` — Tier-2 dual-version predicate + queryset (rewrite both functions per spec §6).
- `backend/investigations/tests/test_tie_off_gate.py` — update fixtures (add cited assertion for ASSERTION_V1) + add legacy-path coverage.
- `backend/investigations/tests/test_referral_grade.py` — update fixtures + add dual-version + parity tests.

**Frontend (the bulk):**
- `frontend/src/types/index.ts` — add `ThreadElement`, `ThreadElementCitation`, `ElementRole`, `GateVersion`, `ThreadElementType`; add `elements` + `gate_version` to `FindingItem`.
- `frontend/src/api/cases.ts` — element CRUD + citation + reorder clients; re-export from `api/index.ts`.
- `frontend/src/components/threadReadiness.ts` — softened, `gate_version`-aware gaps.
- `frontend/src/components/threadReadiness.test.ts` — extend.
- `frontend/src/components/ElementCard.tsx` (new) — one assertion card: derived-role badge, inline text edit, citation chips, `handoff_ready` toggle.
- `frontend/src/views/ThreadBuilder.tsx` (new, replaces `AngleView` as the `frame.kind === "angle"` surface) — header (readiness + convert prompt), ordered assertion list, reorder, tie-off.
- `frontend/src/components/TieOffModal.tsx` — retarget gate language to ASSERTION_V1.
- Wherever `AngleView` is mounted (the `angle` frame renderer) — swap to `ThreadBuilder`.

**Reuse verbatim (do NOT rewrite):** the 4A element endpoints (`urls.py:164-187`), `serialize_element` / `_element_role` (serializers.py:1118-1148), `thread_elements.py` helpers.

**Must be MODIFIED, not reused (narrative-coupled today):** `CiteDocumentPicker.tsx` currently imports `updateAngle`, appends `[Doc-N]` text to the Finding `narrative`, is typed to `FindingItem`, and has no element-id prop (CiteDocumentPicker.tsx:1-36). Task 6A adds an **element-scoped mode** so it writes a `ThreadElementCitation` via `addCitation(...)` instead of mutating the narrative. It must NOT carry the `[Doc-N]` / `updateAngle` path into the `ThreadBuilder` surface. Old "Angle/narrative" wording in `CiteDocumentPicker` / `TieOffModal` comments + copy is mostly not user-visible, but do not let those narrative assumptions leak into the new element citation path.

---

## Task 1: Tier-1 tie-off gate — `gate_version`-aware (backend)

**Files:**
- Modify: `backend/investigations/serializers.py:1010-1043` (the `# --- Tie-off gate ---` block in `FindingUpdateSerializer.is_valid`)
- Test: `backend/investigations/tests/test_tie_off_gate.py`

**Interfaces:**
- Consumes: `thread_elements.finding_has_cited_assertion(finding) -> bool` (exists, thread_elements.py:20); `models.GateVersion` (exists, models.py:1224); `models.ThreadElementType`, `ThreadElement`.
- Produces: a tie-off gate where, on the transition into CONFIRMED, an `ASSERTION_V1` finding requires `finding_has_cited_assertion(self.instance)` instead of a non-empty `narrative`; a `LEGACY_NARRATIVE` finding keeps the old checks. The `unmet` error code for a missing cited assertion is `"cited_assertion"`.

**Context:** The current gate (serializers.py:1029-1041) appends `"narrative"` to `unmet` when `post_narrative` is empty. The spec (§6 Tier-1) calls this "the dead `post_narrative` check" — for ASSERTION_V1 it is replaced by "≥1 cited assertion." A cited assertion is authored via the 4A element endpoints *before* the confirm call, so it already exists on `self.instance` at gate time. The `citation` (doc) and `overreach`/`evidence_weight` checks stay for both versions; only the narrative→cited-assertion swap is version-gated.

- [ ] **Step 1: Write the failing tests**

Add to `test_tie_off_gate.py` (read the file first for its existing helper/factory names; create a `Document` + `ThreadElement` + `ThreadElementCitation` for the cited-assertion fixtures, following `test_referral_grade.py:9-17` for the `Document` shape):

> **Two correctness rules for these fixtures (verified against the code):**
> 1. `FindingUpdateSerializer.__init__(self, data=None, instance=None)` (serializers.py:852) — call it with **keywords**: `FindingUpdateSerializer(data={...}, instance=self.f)`. A positional `(self.f, {...})` binds the model as `data` and is silently wrong.
> 2. `ThreadElementCitation.objects.create(...)` does NOT sync `document_links` (the sync is in the citation *serializer*, serializers.py:1318). The tie-off gate's `post_docs` check reads `document_links`, so a cited-assertion fixture MUST also create the `FindingDocument` row (or go through the citation serializer). `_cited_assertion` below adds it explicitly.

```python
from investigations.models import (
    GateVersion, ThreadElement, ThreadElementType, ThreadElementCitation,
    Document, FindingDocument,
)

def _cited_assertion(finding, case):
    doc = Document.objects.create(
        case=case, filename="e.pdf", file_path="cases/t/e.pdf",
        sha256_hash="e" * 64, file_size=10,
    )
    el = ThreadElement.objects.create(
        finding=finding, element_type=ThreadElementType.ASSERTION,
        text="The charity paid $500k to an insider LLC.", position=0,
    )
    ThreadElementCitation.objects.create(element=el, document=doc, context_note="p.3")
    # The bare citation create does NOT sync document_links — add the compat row the
    # tie-off gate's post_docs check reads (mirrors ensure_document_link).
    FindingDocument.objects.create(finding=finding, document=doc)
    return el

class AssertionV1TieOffTests(TestCase):
    # build self.case + a NEW (gate_version default ASSERTION_V1), non-confirmed,
    # DOCUMENTED, overreach_reviewed=True finding called self.f, mirroring the
    # existing tie-off fixtures in this file.

    def test_assertion_v1_confirm_blocked_without_cited_assertion(self):
        ser = FindingUpdateSerializer(data={"status": "CONFIRMED"}, instance=self.f)
        self.assertFalse(ser.is_valid())
        self.assertIn("cited_assertion", ser._errors["gate"]["unmet"])

    def test_assertion_v1_confirm_allowed_with_cited_assertion(self):
        _cited_assertion(self.f, self.case)
        ser = FindingUpdateSerializer(data={"status": "CONFIRMED"}, instance=self.f)
        self.assertTrue(ser.is_valid(), ser._errors)

    def test_assertion_v1_narrative_alone_does_not_satisfy(self):
        self.f.narrative = "prose only, no assertions"
        self.f.save(update_fields=["narrative"])
        ser = FindingUpdateSerializer(data={"status": "CONFIRMED"}, instance=self.f)
        self.assertFalse(ser.is_valid())
        self.assertIn("cited_assertion", ser._errors["gate"]["unmet"])

    def test_legacy_narrative_confirm_uses_old_narrative_check(self):
        self.f.gate_version = GateVersion.LEGACY_NARRATIVE
        self.f.narrative = "legacy prose"
        self.f.save(update_fields=["gate_version", "narrative"])
        # legacy still needs a doc link; add one the way the file's other tests do
        # (FindingDocument), then confirm passes without any assertion.
        FindingDocument.objects.create(
            finding=self.f,
            document=Document.objects.create(
                case=self.case, filename="L.pdf", file_path="cases/t/L.pdf",
                sha256_hash="d" * 64, file_size=10,
            ),
        )
        ser = FindingUpdateSerializer(data={"status": "CONFIRMED"}, instance=self.f)
        self.assertTrue(ser.is_valid(), ser._errors)

    def test_no_regate_on_edit_of_confirmed(self):
        self.f.status = FindingStatus.CONFIRMED
        self.f.save(update_fields=["status"])
        ser = FindingUpdateSerializer(
            data={"status": "CONFIRMED", "title": "edited"}, instance=self.f
        )
        self.assertTrue(ser.is_valid(), ser._errors)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_tie_off_gate.AssertionV1TieOffTests --keepdb --noinput`
Expected: FAIL — the gate still checks `post_narrative`, so `test_assertion_v1_confirm_blocked_without_cited_assertion` fails (gate passes / wrong unmet code) and `test_assertion_v1_narrative_alone_does_not_satisfy` fails (narrative satisfies the old gate).

- [ ] **Step 3: Flip the gate**

In `serializers.py`, add the import near the other local imports at the top of the file:

```python
from .thread_elements import finding_has_cited_assertion
from .models import GateVersion
```

Replace the gate block (serializers.py:1029-1041) with version-aware logic:

```python
            unmet = []
            if not post_docs:
                unmet.append("citation")
            if post_weight not in (EvidenceWeight.DOCUMENTED, EvidenceWeight.TRACED):
                unmet.append("evidence_weight")
            if self.instance.gate_version == GateVersion.LEGACY_NARRATIVE:
                if not (post_narrative or "").strip():
                    unmet.append("narrative")
            else:  # ASSERTION_V1 — the dead narrative check becomes a cited-assertion check
                if not finding_has_cited_assertion(self.instance):
                    unmet.append("cited_assertion")
            if not post_overreach:
                unmet.append("overreach")

            if unmet:
                self._errors = {"gate": {"unmet": unmet}}
                return False
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_tie_off_gate.AssertionV1TieOffTests --keepdb --noinput`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the FULL tie-off file + fix any pre-existing fixtures it broke**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_tie_off_gate --keepdb --noinput`
Expected: any pre-existing test that confirmed an ASSERTION_V1 finding using only a narrative now fails. For each, either (a) add `_cited_assertion(f, case)` before the confirm call if the test means "a valid tie-off," or (b) set `f.gate_version = GateVersion.LEGACY_NARRATIVE` if the test is specifically about the legacy narrative path. Re-run until green.

- [ ] **Step 6: Lint + commit**

```bash
cd backend && ruff check investigations/serializers.py investigations/tests/test_tie_off_gate.py && ruff format investigations/serializers.py investigations/tests/test_tie_off_gate.py
git add backend/investigations/serializers.py backend/investigations/tests/test_tie_off_gate.py
git commit -m "feat(gate): Tier-1 tie-off gate is gate_version-aware (ASSERTION_V1 needs a cited assertion)"
```

---

## Task 2: Tier-2 referral-grade predicate — dual-version + parity (backend)

**Files:**
- Modify: `backend/investigations/referral_grade.py` (rewrite both functions)
- Test: `backend/investigations/tests/test_referral_grade.py`

**Interfaces:**
- Consumes: `models.GateVersion`, `models.ThreadElement`, `models.ThreadElementType`, `thread_elements.finding_has_cited_assertion`, `thread_elements.finding_has_handoff_ready_assertion`.
- Produces: `referral_grade_qs(case)` and `is_referral_grade(finding)` that branch on `gate_version`. `ASSERTION_V1` adds `Exists(cited_assertion) ∧ Exists(handoff_assertion)` to the base predicate; `LEGACY_NARRATIVE` keeps the old base predicate (CONFIRMED ∧ weight ∧ overreach ∧ ≥1 doc). Consumed by readiness, credibility counts, the referral PDF filter, and the `/case-map/` edge predicate — no contract change.

**Context:** Spec §6 gives the target queryset verbatim. The two functions must stay logically identical (parity test). The existing `test_referral_grade.py` fixtures (lines 35-54) create CONFIRMED findings with a doc but no assertions — with the new default `ASSERTION_V1` those stop being referral-grade. That is correct new behavior; update those fixtures to add a cited+handoff_ready assertion (to keep testing the "is grade" path) and add explicit legacy-path tests.

- [ ] **Step 1: Write the failing tests**

Replace the body of `test_referral_grade.py` `ReferralGradeTests` with version-explicit fixtures, and add a parity test:

```python
from investigations.models import (
    Case, Document, Finding, FindingDocument, FindingStatus, EvidenceWeight,
    GateVersion, ThreadElement, ThreadElementType, ThreadElementCitation,
)
from investigations.referral_grade import is_referral_grade, referral_grade_qs


def _document(case, suffix="a"):
    return Document.objects.create(
        case=case, filename=f"evidence-{suffix}.pdf",
        file_path=f"cases/test/evidence-{suffix}.pdf",
        sha256_hash=suffix * 64, file_size=1024,
    )


def _cited_handoff_assertion(finding, case, suffix="a"):
    """One assertion that is BOTH cited and handoff_ready (satisfies both Tier-2 legs)."""
    doc = _document(case, suffix)
    FindingDocument.objects.create(finding=finding, document=doc)  # compat index row
    el = ThreadElement.objects.create(
        finding=finding, element_type=ThreadElementType.ASSERTION,
        text="Insider payment of $500k.", position=0, handoff_ready=True,
    )
    ThreadElementCitation.objects.create(element=el, document=doc, context_note="p.3")
    return el


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
        return Finding.objects.create(**defaults)

    # --- ASSERTION_V1 (default) ---
    def test_v1_cited_handoff_assertion_is_grade(self):
        f = self._confirmed()  # gate_version defaults to ASSERTION_V1
        _cited_handoff_assertion(f, self.case)
        self.assertTrue(is_referral_grade(f))
        self.assertEqual(referral_grade_qs(self.case).count(), 1)

    def test_v1_doc_only_is_not_grade(self):
        f = self._confirmed()
        FindingDocument.objects.create(finding=f, document=_document(self.case))
        self.assertFalse(is_referral_grade(f))
        self.assertEqual(referral_grade_qs(self.case).count(), 0)

    def test_v1_cited_but_no_handoff_is_not_grade(self):
        f = self._confirmed()
        doc = _document(self.case)
        FindingDocument.objects.create(finding=f, document=doc)
        el = ThreadElement.objects.create(
            finding=f, element_type=ThreadElementType.ASSERTION,
            text="cited only", position=0,
        )
        ThreadElementCitation.objects.create(element=el, document=doc)
        self.assertFalse(is_referral_grade(f))

    # --- LEGACY_NARRATIVE (grandfathered) ---
    def test_legacy_doc_only_is_grade(self):
        f = self._confirmed(gate_version=GateVersion.LEGACY_NARRATIVE)
        FindingDocument.objects.create(finding=f, document=_document(self.case))
        self.assertTrue(is_referral_grade(f))
        self.assertEqual(referral_grade_qs(self.case).count(), 1)

    def test_legacy_overreach_false_not_grade(self):
        f = self._confirmed(
            gate_version=GateVersion.LEGACY_NARRATIVE, overreach_reviewed=False,
        )
        FindingDocument.objects.create(finding=f, document=_document(self.case))
        self.assertFalse(is_referral_grade(f))

    # --- parity: instance predicate ⇔ queryset membership ---
    def test_parity_across_versions(self):
        cases = [
            self._confirmed(),  # v1, nothing -> not grade
            self._confirmed(gate_version=GateVersion.LEGACY_NARRATIVE),  # legacy, no doc -> not grade
        ]
        g1 = self._confirmed()
        _cited_handoff_assertion(g1, self.case, suffix="b")
        g2 = self._confirmed(gate_version=GateVersion.LEGACY_NARRATIVE)
        FindingDocument.objects.create(finding=g2, document=_document(self.case, suffix="c"))
        cases += [g1, g2]
        qs_ids = set(referral_grade_qs(self.case).values_list("id", flat=True))
        for f in cases:
            self.assertEqual(is_referral_grade(f), f.id in qs_ids, f"mismatch for {f.id}")
```

- [ ] **Step 2: Run to verify failure**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_referral_grade --keepdb --noinput`
Expected: FAIL — `referral_grade.py` is still single-version, so `test_v1_doc_only_is_not_grade` fails (old predicate calls a doc-only finding grade) and `test_v1_cited_but_no_handoff_is_not_grade` fails.

- [ ] **Step 3: Rewrite the predicate (spec §6)**

Replace `referral_grade.py` in full:

```python
"""Single source of truth for the referral-grade predicate (Phase 4B: dual-version).

An Angle (Finding) is "referral-grade" when CONFIRMED, weight ∈ {DOCUMENTED, TRACED},
overreach_reviewed, and ≥1 cited document — PLUS, for ASSERTION_V1 threads, ≥1 cited
assertion AND ≥1 handoff_ready assertion (a single cited+handoff_ready assertion
satisfies both). LEGACY_NARRATIVE threads keep the pre-4B predicate (grandfathered).
is_referral_grade() and referral_grade_qs() MUST agree (parity test).
"""

from django.db.models import Count, Exists, OuterRef, Q

from .models import (
    EvidenceWeight, Finding, FindingStatus, GateVersion, ThreadElement, ThreadElementType,
)
from .thread_elements import finding_has_cited_assertion, finding_has_handoff_ready_assertion

REFERRAL_WEIGHTS = [EvidenceWeight.DOCUMENTED, EvidenceWeight.TRACED]


def referral_grade_qs(case):
    """Queryset of referral-grade Angles for a case (a single SQL statement)."""
    cited_assertion = ThreadElement.objects.filter(
        finding=OuterRef("pk"),
        element_type=ThreadElementType.ASSERTION,
        citations__isnull=False,
    )
    handoff_assertion = ThreadElement.objects.filter(
        finding=OuterRef("pk"),
        element_type=ThreadElementType.ASSERTION,
        handoff_ready=True,
    )
    base = (
        Finding.objects.filter(
            case=case,
            status=FindingStatus.CONFIRMED,
            evidence_weight__in=REFERRAL_WEIGHTS,
            overreach_reviewed=True,
        )
        .annotate(_citation_count=Count("document_links"))
        .filter(_citation_count__gt=0)
    )
    return base.filter(
        Q(gate_version=GateVersion.LEGACY_NARRATIVE)
        | (
            Q(gate_version=GateVersion.ASSERTION_V1)
            & Exists(cited_assertion)
            & Exists(handoff_assertion)
        )
    )


def is_referral_grade(finding) -> bool:
    """True iff a single Finding instance meets every referral-grade condition."""
    base = bool(
        finding.status == FindingStatus.CONFIRMED
        and finding.evidence_weight in REFERRAL_WEIGHTS
        and finding.overreach_reviewed
        and finding.document_links.exists()
    )
    if not base:
        return False
    if finding.gate_version == GateVersion.LEGACY_NARRATIVE:
        return True
    return finding_has_cited_assertion(finding) and finding_has_handoff_ready_assertion(finding)
```

> Note: `citations__isnull=False` on the `ThreadElement` filter can produce duplicate rows via the join, but `Exists()` only cares about presence, so no `.distinct()` is needed.

- [ ] **Step 4: Run to verify pass**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_referral_grade --keepdb --noinput`
Expected: PASS (all tests incl. parity).

- [ ] **Step 5: Run the readiness + PDF + case-map suites (downstream consumers)**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_referral_readiness investigations.tests.test_referral_pdf investigations.tests.test_case_map --keepdb --noinput`
Expected: any fixture that built a doc-only CONFIRMED finding and expected it to be referral-grade now fails under the default ASSERTION_V1. Update each such fixture: add `_cited_handoff_assertion`-style elements if the test means "referral-grade," or stamp `gate_version=LEGACY_NARRATIVE` if it represents grandfathered work. Re-run until green.

- [ ] **Step 6: Lint + commit**

```bash
cd backend && ruff check investigations/referral_grade.py investigations/tests/ && ruff format investigations/referral_grade.py investigations/tests/test_referral_grade.py
git add backend/investigations/referral_grade.py backend/investigations/tests/
git commit -m "feat(gate): dual-version referral-grade predicate (ASSERTION_V1 vs LEGACY_NARRATIVE) + parity test"
```

---

## Task 3: Full backend regression sweep (backend)

**Files:** none (verification gate). Fix only fixtures broken by the gate flip.

- [ ] **Step 1: Run the whole suite (CI-equivalent)**

Run: `docker exec catalyst_backend python manage.py test investigations --exclude-tag=eval --keepdb --noinput`
Expected: green. The only expected breakages are fixtures that pre-create a doc-only CONFIRMED ASSERTION_V1 finding and assume it is referral-grade / confirmable — fix each per Task 1 Step 5 / Task 2 Step 5 (add assertions or stamp legacy). Do NOT relax the gate to make a test pass.

- [ ] **Step 2: Commit any fixture fixes**

```bash
cd backend && ruff format investigations/tests/
git add backend/investigations/tests/
git commit -m "test: update tie-off/referral fixtures for the gate_version-aware gate"
```

---

## Task 4: Frontend types + API clients (frontend)

**Files:**
- Modify: `frontend/src/types/index.ts` (add element types; extend `FindingItem`)
- Modify: `frontend/src/api/cases.ts` (element CRUD + citation + reorder clients)
- Modify: `frontend/src/api/index.ts` (re-export the new clients)
- Test: `frontend/src/api/cases.test.ts` (create if absent — follow `api/base.test.ts` for the fetch-mock pattern)

**Interfaces:**
- Consumes: backend `serialize_element` shape (serializers.py:1129-1148) and the 4A endpoints (urls.py:164-187). `fetchApi<T>` (api/base.ts:76).
- Produces TS: `ThreadElement`, `ThreadElementCitation`, `ElementRole`, `ThreadElementType`, `GateVersion`; `FindingItem.elements: ThreadElement[]` + `FindingItem.gate_version: GateVersion`; clients `createElement`, `updateElement`, `deleteElement`, `reorderElements`, `addCitation`, `removeCitation`.

- [ ] **Step 1: Add the types**

In `frontend/src/types/index.ts`, add near the other Finding types:

```typescript
export type ThreadElementTypeT = "ASSERTION" | "QUESTION" | "NOTE";
export type ElementRole = "fact" | "analysis" | "claim" | "question" | "note";
export type GateVersion = "LEGACY_NARRATIVE" | "ASSERTION_V1";

export interface ThreadElementCitation {
  id: UUID;
  document_id: UUID;
  document_filename: string;
  page_reference: string;
  context_note: string;
}

export interface ThreadElement {
  id: UUID;
  finding_id: UUID;
  element_type: ThreadElementTypeT;
  /** Derived server-side from evidence + handoff_ready; never sent on write. */
  role: ElementRole;
  text: string;
  position: number;
  handoff_ready: boolean;
  citations: ThreadElementCitation[];
}
```

Add two fields to `FindingItem` (types/index.ts:835, after `document_links`):

```typescript
  /** Ordered structured assertions (Phase 4). Empty [] for un-built threads. */
  elements: ThreadElement[];
  /** Which referral gate applies. New threads default ASSERTION_V1. */
  gate_version: GateVersion;
```

- [ ] **Step 2: Write the failing client test**

In `frontend/src/api/cases.test.ts` (read `api/base.test.ts` first for the `vi.fn()` fetch-mock harness used in this repo):

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, reorderElements, addCitation } from "./cases";

describe("thread element clients", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ id: "1", element_type: "ASSERTION" }), { status: 200 }),
    ));
  });

  it("createElement POSTs to the finding's elements collection", async () => {
    await createElement("case1", "find1", { element_type: "ASSERTION", text: "x" });
    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/api/cases/case1/findings/find1/elements/");
    expect(opts.method).toBe("POST");
  });

  it("reorderElements POSTs ordered_ids to the reorder endpoint", async () => {
    await reorderElements("case1", "find1", ["b", "a"]);
    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/elements/reorder/");
    expect(JSON.parse(opts.body as string)).toEqual({ ordered_ids: ["b", "a"] });
  });

  it("addCitation POSTs to the element's citations collection", async () => {
    await addCitation("case1", "find1", "el1", { document_id: "d1", page_reference: "p3", context_note: "" });
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/elements/el1/citations/");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd frontend && npx vitest run src/api/cases.test.ts`
Expected: FAIL — `createElement` / `reorderElements` / `addCitation` are not exported.

- [ ] **Step 4: Add the clients**

In `frontend/src/api/cases.ts`, after `fetchAngle` (line ~280):

```typescript
import type { ThreadElement, ThreadElementTypeT } from "../types";

const elBase = (caseId: string, findingId: string) =>
  `/api/cases/${caseId}/findings/${findingId}/elements`;

export async function createElement(
  caseId: string, findingId: string,
  body: { element_type: ThreadElementTypeT; text: string },
): Promise<ThreadElement> {
  return fetchApi<ThreadElement>(`${elBase(caseId, findingId)}/`, {
    method: "POST", body: JSON.stringify(body),
  });
}

export async function updateElement(
  caseId: string, findingId: string, elementId: string,
  body: Partial<{ text: string; element_type: ThreadElementTypeT; handoff_ready: boolean }>,
): Promise<ThreadElement> {
  return fetchApi<ThreadElement>(`${elBase(caseId, findingId)}/${elementId}/`, {
    method: "PATCH", body: JSON.stringify(body),
  });
}

export async function deleteElement(
  caseId: string, findingId: string, elementId: string,
): Promise<void> {
  return fetchApi<void>(`${elBase(caseId, findingId)}/${elementId}/`, { method: "DELETE" });
}

export async function reorderElements(
  caseId: string, findingId: string, orderedIds: string[],
): Promise<ThreadElement[]> {
  return fetchApi<ThreadElement[]>(`${elBase(caseId, findingId)}/reorder/`, {
    method: "POST", body: JSON.stringify({ ordered_ids: orderedIds }),
  });
}

export async function addCitation(
  caseId: string, findingId: string, elementId: string,
  body: { document_id: string; page_reference: string; context_note: string },
): Promise<ThreadElement> {
  return fetchApi<ThreadElement>(`${elBase(caseId, findingId)}/${elementId}/citations/`, {
    method: "POST", body: JSON.stringify(body),
  });
}

export async function removeCitation(
  caseId: string, findingId: string, elementId: string, citationId: string,
): Promise<void> {
  return fetchApi<void>(
    `${elBase(caseId, findingId)}/${elementId}/citations/${citationId}/`,
    { method: "DELETE" },
  );
}
```

Re-export them in `frontend/src/api/index.ts` (add to the existing `cases` export block alongside `fetchAngle`).

- [ ] **Step 5: Run to verify pass + typecheck**

Run: `cd frontend && npx vitest run src/api/cases.test.ts && npx tsc --noEmit`
Expected: PASS + no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/api/cases.ts frontend/src/api/index.ts frontend/src/api/cases.test.ts
git commit -m "feat(fe): thread-element types + CRUD/citation/reorder API clients"
```

---

## Task 5: `threadReadiness.ts` — softened, `gate_version`-aware (frontend)

**Files:**
- Modify: `frontend/src/components/threadReadiness.ts`
- Test: `frontend/src/components/threadReadiness.test.ts`

**Interfaces:**
- Consumes: `FindingItem.elements`, `FindingItem.gate_version` (Task 4).
- Produces: `threadReadiness(f)` returns `{ ready, gaps, summary }` where, for `ASSERTION_V1`, the gaps mirror the dual-version predicate (cited assertion + handoff_ready assertion replace the bare narrative/doc gaps); `LEGACY_NARRATIVE` keeps the old gaps. The Thread Dock (reads `gaps[0]`) and `ThreadInspector` (reads `summary`) consume this unchanged.

**Context:** This helper is shared by the Phase-3 Thread Dock and `ThreadInspector` — keep the `{ ready, gaps, summary }` shape exactly. Mirror `referral_grade.py` so the frontend never disagrees with the server gate.

- [ ] **Step 1: Extend the test**

Add to `threadReadiness.test.ts`:

```typescript
const base = {
  status: "CONFIRMED" as const,
  evidence_weight: "DOCUMENTED" as const,
  overreach_reviewed: true,
  document_links: [{}] as any,
};
const assertion = (over: Partial<any> = {}) => ({
  element_type: "ASSERTION", text: "x", handoff_ready: false, citations: [], ...over,
});

it("ASSERTION_V1: cited + handoff_ready assertion is ready", () => {
  const r = threadReadiness({
    ...base, gate_version: "ASSERTION_V1",
    elements: [assertion({ handoff_ready: true, citations: [{}] })],
  } as any);
  expect(r.ready).toBe(true);
});

it("ASSERTION_V1: cited but no handoff_ready leaves a gap", () => {
  const r = threadReadiness({
    ...base, gate_version: "ASSERTION_V1",
    elements: [assertion({ citations: [{}] })],
  } as any);
  expect(r.ready).toBe(false);
  expect(r.gaps).toContain("No handoff-ready claim");
});

it("LEGACY_NARRATIVE: doc-only is ready (grandfathered)", () => {
  const r = threadReadiness({ ...base, gate_version: "LEGACY_NARRATIVE", elements: [] } as any);
  expect(r.ready).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/threadReadiness.test.ts`
Expected: FAIL — current helper ignores `gate_version`/`elements`.

- [ ] **Step 3: Rewrite the helper**

```typescript
import type { FindingItem } from "../types";

type ReadinessInput = Pick<
  FindingItem,
  "status" | "evidence_weight" | "overreach_reviewed" | "document_links" | "gate_version" | "elements"
>;

/** Single referral-grade gap definition shared by ThreadInspector + Thread Dock.
 *  Mirrors referral_grade.py (Phase 4B dual-version). gaps[0] = headline gap. */
export function threadReadiness(
  f: ReadinessInput,
): { ready: boolean; gaps: string[]; summary: string } {
  const gaps: string[] = [];
  if (f.document_links.length === 0) gaps.push("No cited sources");
  if (!["DOCUMENTED", "TRACED"].includes(f.evidence_weight)) {
    gaps.push("Evidence weight below Documented");
  }
  if (!f.overreach_reviewed) gaps.push("Overreach not reviewed");
  if (f.status !== "CONFIRMED") gaps.push("Not yet substantiated");

  if (f.gate_version === "ASSERTION_V1") {
    const elements = f.elements ?? [];
    const hasCited = elements.some(
      (e) => e.element_type === "ASSERTION" && e.text.trim() !== "" && e.citations.length > 0,
    );
    const hasHandoff = elements.some(
      (e) => e.element_type === "ASSERTION" && e.handoff_ready && e.text.trim() !== "",
    );
    if (!hasCited) gaps.push("No cited assertion");
    if (!hasHandoff) gaps.push("No handoff-ready claim");
  }

  if (gaps.length === 0) return { ready: true, gaps: [], summary: "All referral-grade conditions met." };
  return { ready: false, gaps, summary: gaps.join(" · ") };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/components/threadReadiness.test.ts && npx tsc --noEmit`
Expected: PASS + clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/threadReadiness.ts frontend/src/components/threadReadiness.test.ts
git commit -m "feat(fe): softened gate_version-aware threadReadiness (cited + handoff-ready gaps)"
```

---

## Task 6: `ElementCard.tsx` — one assertion card (frontend)

**Files:**
- Create: `frontend/src/components/ElementCard.tsx`
- Create: `frontend/src/components/ElementCard.test.tsx`

**Interfaces:**
- Consumes: `ThreadElement` (Task 4); `CiteDocumentPicker` (made element-scoped in Task 7); callbacks from `ThreadBuilder` (Task 8).
- Produces: `ElementCard` default export with props
  `{ element: ThreadElement; onEditText(text): void; onToggleHandoff(next): void; onAddCitation(): void; onRemoveCitation(citationId): void; onChangeType(type): void; onDelete(): void; onMoveUp(): void; onMoveDown(): void; }`. Renders the derived-role badge (from `element.role`), inline text edit (textarea, save on blur), citation chips with remove, and a `handoff_ready` toggle (enabled on any non-empty assertion).

**Context:** The derived `role` comes from the server (`element.role`) — the card does NOT recompute it; it renders the badge from that value. The `handoff_ready` toggle is enabled for any non-empty assertion; the *readiness line in the header* (Task 8), not the toggle, tells the user what referral-grade still needs (spec §9).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ElementCard from "./ElementCard";

const el = {
  id: "e1", finding_id: "f1", element_type: "ASSERTION" as const, role: "fact" as const,
  text: "Insider payment", position: 0, handoff_ready: false,
  citations: [{ id: "c1", document_id: "d1", document_filename: "deed.pdf", page_reference: "p3", context_note: "" }],
};

describe("ElementCard", () => {
  it("shows the derived role badge from element.role", () => {
    render(<ElementCard element={el} onEditText={vi.fn()} onToggleHandoff={vi.fn()}
      onAddCitation={vi.fn()} onRemoveCitation={vi.fn()} onChangeType={vi.fn()}
      onDelete={vi.fn()} onMoveUp={vi.fn()} onMoveDown={vi.fn()} />);
    expect(screen.getByText(/fact/i)).toBeInTheDocument();
  });

  it("fires onToggleHandoff(true) when the handoff toggle is clicked", () => {
    const onToggle = vi.fn();
    render(<ElementCard element={el} onEditText={vi.fn()} onToggleHandoff={onToggle}
      onAddCitation={vi.fn()} onRemoveCitation={vi.fn()} onChangeType={vi.fn()}
      onDelete={vi.fn()} onMoveUp={vi.fn()} onMoveDown={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /handoff/i }));
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/ElementCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the card**

Create `frontend/src/components/ElementCard.tsx`. Match the surrounding component style (read `CitedDocCard` inside `AngleView.tsx:127` for the repo's card/badge conventions and class names). Minimum viable implementation:

```tsx
import { useState } from "react";
import type { ThreadElement, ElementRole, ThreadElementTypeT } from "../types";

const ROLE_LABEL: Record<ElementRole, string> = {
  fact: "Fact", analysis: "Analysis", claim: "Claim", question: "Question", note: "Note",
};

interface Props {
  element: ThreadElement;
  onEditText: (text: string) => void;
  onToggleHandoff: (next: boolean) => void;
  onAddCitation: () => void;
  onRemoveCitation: (citationId: string) => void;
  onChangeType: (type: ThreadElementTypeT) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export default function ElementCard(props: Props) {
  const { element: el } = props;
  const [text, setText] = useState(el.text);
  const isAssertion = el.element_type === "ASSERTION";

  return (
    <div className="element-card" data-role={el.role}>
      <div className="element-card__head">
        <span className="element-card__role-badge">{ROLE_LABEL[el.role]}</span>
        <div className="element-card__reorder">
          <button onClick={props.onMoveUp} aria-label="Move up">↑</button>
          <button onClick={props.onMoveDown} aria-label="Move down">↓</button>
          <button onClick={props.onDelete} aria-label="Delete element">✕</button>
        </div>
      </div>

      <textarea
        className="element-card__text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== el.text && props.onEditText(text)}
      />

      {isAssertion && (
        <>
          <div className="element-card__citations">
            {el.citations.map((c) => (
              <span key={c.id} className="element-card__chip">
                {c.document_filename}{c.page_reference ? ` · ${c.page_reference}` : ""}
                <button aria-label="Remove citation" onClick={() => props.onRemoveCitation(c.id)}>✕</button>
              </span>
            ))}
            <button className="element-card__add-cite" onClick={props.onAddCitation}>+ Cite source</button>
          </div>

          <button
            className="element-card__handoff"
            aria-pressed={el.handoff_ready}
            disabled={text.trim() === ""}
            onClick={() => props.onToggleHandoff(!el.handoff_ready)}
          >
            {el.handoff_ready ? "Handoff claim ✓" : "Mark as handoff claim"}
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/components/ElementCard.test.tsx && npx tsc --noEmit`
Expected: PASS + clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ElementCard.tsx frontend/src/components/ElementCard.test.tsx
git commit -m "feat(fe): ElementCard assertion card (derived-role badge, citations, handoff toggle)"
```

---

## Task 7: Element-scoped citation mode for `CiteDocumentPicker` (frontend)

**Files:**
- Modify: `frontend/src/components/CiteDocumentPicker.tsx`
- Test: `frontend/src/components/CiteDocumentPicker.test.tsx` (extend; create if absent)

**Interfaces:**
- Consumes: `addCitation` (Task 4); `DocumentItem` (existing).
- Produces: an **optional element-scoped mode**. When passed an `element` context, confirming a selection calls `addCitation(caseId, findingId, elementId, {document_id, page_reference, context_note})` and invokes `onCited()` — instead of the legacy narrative path. The legacy `FindingItem`-scoped mode (`updateAngle` + `[Doc-N]`) stays for any non-4B caller but is NOT used by `ThreadBuilder`.

**Context:** Today the picker is narrative-coupled (`updateAngle`, `appendDocRefs` → `[Doc-N]`, typed to `FindingItem`; CiteDocumentPicker.tsx:1-36). 4B does not rip that out (other surfaces may still call it); it adds a parallel element mode so `ThreadBuilder` never touches the narrative. Do not route the new mode through `appendDocRefs`/`updateAngle`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CiteDocumentPicker from "./CiteDocumentPicker";
import * as api from "../api";

vi.mock("../api");

const docs = [{ id: "d1", filename: "deed.pdf", doc_type: "DEED" }] as any;

describe("CiteDocumentPicker element mode", () => {
  beforeEach(() => { (api.addCitation as any) = vi.fn(async () => ({})); });

  it("calls addCitation (not updateAngle) when given an element context", async () => {
    const onCited = vi.fn();
    render(
      <CiteDocumentPicker
        caseId="c1" findingId="f1" documents={docs}
        element={{ id: "el1" }} onCited={onCited} onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText(/deed\.pdf/i));
    fireEvent.click(screen.getByRole("button", { name: /cite|confirm|add/i }));
    await waitFor(() => expect(api.addCitation).toHaveBeenCalledWith(
      "c1", "f1", "el1", expect.objectContaining({ document_id: "d1" }),
    ));
    expect(onCited).toHaveBeenCalled();
  });
});
```

Adjust selector text to the picker's real confirm-button label after reading the component.

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/CiteDocumentPicker.test.tsx`
Expected: FAIL — no `element`/`onCited` props; confirm still calls `updateAngle`.

- [ ] **Step 3: Add the element mode**

Add optional props `element?: { id: string }`, `onCited?: () => void`, and `caseId`/`findingId` if not already separate. In the confirm handler, branch:

```tsx
import { addCitation } from "../api";

async function handleConfirm() {
  if (element) {
    for (const doc of selectedDocs) {
      await addCitation(caseId, findingId, element.id, {
        document_id: doc.id, page_reference: "", context_note: "",
      });
    }
    onCited?.();
    onClose();
    return;
  }
  // ...existing legacy narrative path (updateAngle + appendDocRefs) unchanged...
}
```

Leave `appendDocRefs` and the legacy branch intact for non-element callers.

- [ ] **Step 4: Run to verify pass + typecheck**

Run: `cd frontend && npx vitest run src/components/CiteDocumentPicker.test.tsx && npx tsc --noEmit`
Expected: PASS + clean typecheck.

- [ ] **Step 5: Checkpoint (Tyler commits)**

Intended commit scope: `frontend/src/components/CiteDocumentPicker.tsx` + its test —
`feat(fe): element-scoped citation mode for CiteDocumentPicker (writes ThreadElementCitation)`.

---

## Task 8: `ThreadBuilder.tsx` — replace `AngleView` as the `angle` frame (frontend)

**Files:**
- Create: `frontend/src/views/ThreadBuilder.tsx`
- Modify: the `angle`-frame renderer (find it: `grep -rn "AngleView" frontend/src` — replace the mount with `ThreadBuilder`, keep the same props)
- Test: `frontend/src/views/ThreadBuilder.test.tsx`

**Interfaces:**
- Consumes: `fetchAngle`, `createElement`, `updateElement`, `deleteElement`, `reorderElements`, `addCitation`, `removeCitation`, `updateAngle` (Task 4 + existing); `threadReadiness` (Task 5); `ElementCard` (Task 6); `CiteDocumentPicker` in element mode (Task 7); `TieOffModal` (existing). Same props as `AngleView` (`AngleViewProps`, AngleView.tsx:48).
- Produces: the full-width thread detail surface mounted at `frame.kind === "angle"`. Header shows the two-tier readiness line + (for `LEGACY_NARRATIVE`) the non-blocking convert prompt. Body is the ordered `ElementCard` list with an "Add assertion / question / note" control. Tie-off opens `TieOffModal`.

**Context:** Read `AngleView.tsx` (474-end) first — `ThreadBuilder` **reuses its data-fetch, save-on-blur, delete, notes, and TieOffModal wiring**; the only structural change is replacing the single `narrative` textarea + flat cited-doc list with the assertion list. Keep `frame.kind === "angle"` and `openThread` routing untouched (spec §9). The legacy `narrative` field stays in the model; `ThreadBuilder` does NOT show the narrative editor for `ASSERTION_V1` threads — for `LEGACY_NARRATIVE` it shows the narrative read-only under the convert prompt.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import ThreadBuilder from "./ThreadBuilder";
import * as api from "../api";

vi.mock("../api");

const thread = {
  id: "f1", rule_id: "MANUAL", title: "Insider deal", status: "ACTIVE",
  evidence_weight: "DOCUMENTED", overreach_reviewed: false, gate_version: "ASSERTION_V1",
  document_links: [], entity_links: [], elements: [
    { id: "e1", finding_id: "f1", element_type: "ASSERTION", role: "analysis",
      text: "Payment to LLC", position: 0, handoff_ready: false, citations: [] },
  ],
} as any;

describe("ThreadBuilder", () => {
  beforeEach(() => {
    (api.fetchAngle as any) = vi.fn(async () => thread);
    (api.fetchNotes as any) = vi.fn(async () => []);
  });

  // ThreadBuilder keeps AngleView's exact prop contract (AngleView.tsx:48):
  // caseId, angleId, documents, onDocumentClick, onBack, onAngleTiedOff.
  const props = {
    caseId: "c1", angleId: "f1", documents: [],
    onDocumentClick: vi.fn(), onBack: vi.fn(), onAngleTiedOff: vi.fn(),
  };

  it("renders an ElementCard per element and the readiness gaps", async () => {
    render(<ThreadBuilder {...props} />);
    await waitFor(() => expect(screen.getByText("Payment to LLC")).toBeInTheDocument());
    // ASSERTION_V1 with no cited/handoff assertion → readiness shows the new gaps
    expect(screen.getByText(/handoff-ready claim/i)).toBeInTheDocument();
  });

  it("shows the convert prompt for LEGACY_NARRATIVE threads", async () => {
    (api.fetchAngle as any) = vi.fn(async () => ({ ...thread, gate_version: "LEGACY_NARRATIVE" }));
    render(<ThreadBuilder {...props} />);
    await waitFor(() => expect(screen.getByText(/convert to structured assertions/i)).toBeInTheDocument());
  });
});
```

The `ThreadBuilder` signature is identical to `AngleViewProps` — copy it verbatim from AngleView.tsx:48 (do not invent an `onClose`).

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/views/ThreadBuilder.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ThreadBuilder`**

Build by copying `AngleView.tsx` to `ThreadBuilder.tsx` and swapping the body. Keep: the same prop interface, the `fetchAngle` load effect, the notes panel, the delete flow, and the `TieOffModal` mount. Replace the narrative textarea + cited-doc list with:

```tsx
// after the header, inside the loaded-state render:
const readiness = threadReadiness(finding);

// Header readiness line (two-tier):
<div className="thread-builder__readiness">
  {readiness.ready
    ? <span className="ok">Referral-grade ✓</span>
    : <span className="gap">Referral-grade: {readiness.gaps[0]}</span>}
</div>

// LEGACY convert prompt (non-blocking):
{finding.gate_version === "LEGACY_NARRATIVE" && (
  <div className="thread-builder__convert" role="status">
    Legacy narrative format. Convert to structured assertions when you next edit.
  </div>
)}

// Assertion list:
<div className="thread-builder__elements">
  {finding.elements.map((el, i) => (
    <ElementCard
      key={el.id}
      element={el}
      onEditText={(t) => mutateElement(el.id, () => updateElement(caseId, angleId, el.id, { text: t }))}
      onToggleHandoff={(next) => mutateElement(el.id, () => updateElement(caseId, angleId, el.id, { handoff_ready: next }))}
      onChangeType={(ty) => mutateElement(el.id, () => updateElement(caseId, angleId, el.id, { element_type: ty }))}
      onAddCitation={() => openCitePickerFor(el.id)}
      onRemoveCitation={(cid) => mutateElement(el.id, () => removeCitation(caseId, angleId, el.id, cid))}
      onDelete={() => mutateElement(el.id, () => deleteElement(caseId, angleId, el.id))}
      onMoveUp={() => i > 0 && reorder(i, i - 1)}
      onMoveDown={() => i < finding.elements.length - 1 && reorder(i, i + 1)}
    />
  ))}
  <div className="thread-builder__add">
    <button onClick={() => addElement("ASSERTION")}>+ Assertion</button>
    <button onClick={() => addElement("QUESTION")}>+ Question</button>
    <button onClick={() => addElement("NOTE")}>+ Note</button>
  </div>
</div>
```

Where the local helpers (define them in the component) are:

```tsx
// Re-fetch the whole thread after any element mutation — simplest correct sync;
// the server returns derived role + updated citations/document_links.
async function refresh() {
  const updated = await fetchAngle(caseId, angleId);
  setFinding(updated);
}
async function mutateElement(_id: string, op: () => Promise<unknown>) {
  try { await op(); await refresh(); }
  catch { toast.error("Could not update assertion."); }
}
async function addElement(type: ThreadElementTypeT) {
  await createElement(caseId, angleId, { element_type: type, text: "" });
  await refresh();
}
async function reorder(from: number, to: number) {
  const ids = finding.elements.map((e) => e.id);
  const [moved] = ids.splice(from, 1);
  ids.splice(to, 0, moved);
  await reorderElements(caseId, angleId, ids);
  await refresh();
}
```

Mount `CiteDocumentPicker` in its **element mode** (Task 7): `openCitePickerFor(elementId)` sets `activeElementId`; render `<CiteDocumentPicker caseId={caseId} findingId={angleId} documents={documents} element={{ id: activeElementId }} onCited={refresh} onClose={...} />`. Do NOT use the legacy narrative path — the element mode writes the `ThreadElementCitation` and `refresh()` re-pulls the derived role + synced `document_links`.

- [ ] **Step 4: Swap the mount**

Run `grep -rn "AngleView" frontend/src` and replace the `angle`-frame mount with `<ThreadBuilder .../>` (same props). Leave the `AngleView.tsx` file in place until Task 9 confirms nothing else imports it, then delete it.

- [ ] **Step 5: Run to verify pass + full frontend gate**

Run: `cd frontend && npx vitest run src/views/ThreadBuilder.test.tsx && npx tsc --noEmit`
Expected: PASS + clean typecheck.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/ThreadBuilder.tsx frontend/src/views/ThreadBuilder.test.tsx <the-frame-renderer-file>
git commit -m "feat(fe): ThreadBuilder replaces AngleView as the angle frame (assertion list + readiness + convert prompt)"
```

---

## Task 9: TieOffModal language + retire AngleView + full gate (frontend)

**Files:**
- Modify: `frontend/src/components/TieOffModal.tsx` (+ `.test.tsx`)
- Delete: `frontend/src/views/AngleView.tsx` (only once nothing imports it)

**Interfaces:**
- Consumes: `threadReadiness` (Task 5) for the gap copy. Same modal props as today.
- Produces: tie-off copy that names the ASSERTION_V1 requirements ("Add a cited assertion and a handoff-ready claim before substantiating") for ASSERTION_V1 threads; legacy copy preserved for LEGACY_NARRATIVE.

- [ ] **Step 1: Update the modal copy + its test**

Read `TieOffModal.tsx` + `TieOffModal.test.tsx`. Change the unmet-condition copy so an `ASSERTION_V1` thread shows the cited-assertion / handoff-claim gaps (derive from `threadReadiness` or the `gate.unmet` codes `cited_assertion` / `citation` / `evidence_weight` / `overreach`). Update the test assertions to the new strings. Keep the banned-strings rule (no model names).

- [ ] **Step 2: Run the modal test**

Run: `cd frontend && npx vitest run src/components/TieOffModal.test.tsx`
Expected: PASS.

- [ ] **Step 3: Confirm AngleView is unreferenced, then delete it**

Run: `grep -rn "AngleView" frontend/src`
Expected: no remaining imports (only the deleted file itself). Delete `AngleView.tsx` and its test if present. If anything still imports it, fix that first.

- [ ] **Step 4: Full frontend gate**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: all green. Fix any test that imported `AngleView` directly.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/TieOffModal.tsx frontend/src/components/TieOffModal.test.tsx
git rm frontend/src/views/AngleView.tsx
git commit -m "feat(fe): tie-off copy targets the ASSERTION_V1 gate; retire AngleView"
```

---

## Task 10: Seed demo + final full-stack verification (both)

**Files:**
- Verify (and adjust only if red): `backend/investigations/management/commands/seed_demo.py` (4A already builds assertions; confirm a demo thread is referral-grade under ASSERTION_V1 end-to-end).

- [ ] **Step 1: Reseed + eyeball the gate end-to-end**

```bash
docker exec catalyst_backend python manage.py seed_demo
```
Then load the demo case in the running frontend, open a thread → `ThreadBuilder` renders the assertion list; a thread with a cited + handoff-ready assertion shows "Referral-grade ✓"; a `LEGACY_NARRATIVE` thread shows the convert prompt and is still referral-grade.

- [ ] **Step 2: Full backend + frontend gates (CI-equivalent)**

```bash
docker exec catalyst_backend python manage.py test investigations --exclude-tag=eval --keepdb --noinput
cd frontend && npx tsc --noEmit && npx vitest run
```
Expected: both green.

- [ ] **Step 3: Smoke test**

Run: `python tests/api_health_check.py`
Expected: pass against the local stack.

- [ ] **Step 4: Final commit + open PR (confirm with Tyler before pushing)**

```bash
git add -A && git commit -m "chore(4b): seed_demo + full-stack verification for the gate flip + ThreadBuilder"
```
Then — **outward-facing step, confirm with Tyler first** — push the branch, open the PR, and validate on the Railway PR preview before any merge to `main` (3-stage chain: local Docker → Railway preview → main).

---

## Self-Review

**Spec coverage (against `2026-06-22-case-map-phase-4-thread-builder-design.md`):**
- §6 Tier-1 gate flip → Task 1. §6 Tier-2 dual-version + parity → Task 2. ✓
- §6 "flows through `/case-map/`" → no contract change; covered by Task 2 Step 5 (case-map suite stays green). ✓
- §9 ThreadBuilder (header readiness, convert prompt, assertion cards, reorder, tie-off retarget, shared readiness, types/api) → Tasks 4-9. ✓
- §9 per-assertion citation picker ("reuse `CiteDocumentPicker`, element-scoped") → Task 7 makes it element-scoped (it is narrative-coupled today; cannot be reused verbatim). ✓
- §13 file-change map: `serializers.py` gate (T1), `referral_grade.py` (T2), `ThreadBuilder.tsx` (T8), `ElementCard.tsx` (T6), `threadReadiness.ts` (T5), `types.ts`/`api.ts` (T4). ✓
- §7 convert prompt copy ("Convert to structured assertions when you next edit") → Task 8 Step 3. ✓
- §11 deployment-sequencing invariant (one deploy unit, backend never merges ahead of UI) → Global Constraints + Task 10 single PR. ✓

**Out of scope (correctly absent):** 4C PDF render, 4D AI-assist, `supported_by` backing graph, drag-to-reorder polish — none appear as tasks. ✓

**Placeholder scan:** no "TBD"/"handle edge cases"/"similar to Task N" — each step carries its code/command. The two "read the file first" notes (AngleView prop names, TieOffModal copy) point at exact files/lines, not vague instructions. ✓

**Type consistency:** `finding_has_cited_assertion` / `finding_has_handoff_ready_assertion` (thread_elements.py) used identically in T1/T2/T5. `ThreadElement.role` consumed (never recomputed) in T6/T8. Client names `createElement`/`updateElement`/`deleteElement`/`reorderElements`/`addCitation`/`removeCitation` defined in T4 and used unchanged in T7/T8. `gate_version` values `ASSERTION_V1` / `LEGACY_NARRATIVE` consistent across backend + frontend. ✓

**Review-pass corrections folded in (Tyler, 2026-06-22):** (1) all `FindingUpdateSerializer` test calls use `data=`/`instance=` keywords — verified against serializers.py:852. (2) cited-assertion fixtures add an explicit `FindingDocument` because the bare citation model does not sync `document_links` (serializers.py:1318). (3) `CiteDocumentPicker` is narrative-coupled today → Task 6A adds an element mode rather than "reusing verbatim." (4) `ThreadBuilder` test uses the real `AngleViewProps` (no `onClose`). (5) every "Commit" step is a Tyler checkpoint, not an executed `git commit` (sandbox git/hooks). ✓
