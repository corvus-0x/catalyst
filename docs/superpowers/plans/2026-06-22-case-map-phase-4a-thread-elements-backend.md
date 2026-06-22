# Case Map Phase 4A-additive — Thread Elements Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured, individually-cited evidentiary elements (Fact / Inference / Question / Claim / Note) to threads — as a purely **additive** backend slice that changes **no existing behavior** and is safe to merge to `main` (the public demo) on its own.

**Architecture:** Three new tables (`ThreadElement`, `ThreadElementCitation`, a self-M2M `supported_by`) plus a `FindingDocument.is_legacy` flag. `ThreadElementCitation` is the source of truth for citations; `Finding.document_links` (`FindingDocument`) stays as a synced **compatibility citation index**. Completeness predicate helpers and `document_links` sync helpers are built **and unit-tested but left UNWIRED** — the tie-off gate (`FindingUpdateSerializer`) and `referral_grade.py` are **not touched** in this slice. The gate flip ships in **4B** (a later plan) atomically with the `ThreadBuilder` UI that can satisfy it.

**Tech Stack:** Django 5 + PostgreSQL (ArrayField), hand-written serializer classes (NOT Django REST Framework), function-based views with `@require_http_methods`, `unittest`-style `TestCase`. Tests run inside the Docker stack.

## Global Constraints

- **Deployment-safety invariant:** this slice must change **no existing behavior**. Do NOT edit the `FindingUpdateSerializer` tie-off gate's pass/fail conditions or `referral_grade.py` predicates here. Building unwired helpers is fine; wiring them is 4B. The full existing suite must stay green untouched (Task 10).
- **Ruff** line length **100 chars max**; double quotes; spaces; LF. `views.py` is NOT E501-exempt — break long strings with parenthesized f-strings. Run `cd backend && ruff check . && ruff format .` before every commit (pre-commit hooks are dormant in this environment).
- **Serializers are hand-written classes** with `is_valid() -> bool`, `.errors`, `.data`, `.save()` — follow `FindingUpdateSerializer` / `FindingIntakeSerializer`. Do NOT introduce DRF.
- **Views** are function-based, decorated `@require_http_methods([...])`, case-scoped via `get_object_or_404(Case, pk=pk)`, parse bodies with `_parse_json_body(request)`, return `JsonResponse`. Mutations log via `AuditLog.log(...)`. **Never UPDATE/DELETE `AuditLog`.**
- **`ThreadElementCitation` is the source of truth for citations.** `Finding.document_links` is the denormalized/export **compatibility citation index** + legacy-preservation layer — never the place to author citations. Rows created via the legacy `add_document_ids` path are written `is_legacy=True`.
- **Model `clean()` is defense-in-depth only** — Django does NOT call it on `save()`, and there is no DB constraint across the citation join. The **serializer** is the authoritative enforcement path; tests cover both.
- **Citations attach to `FACT` elements only.** `supported_by` is allowed only on `CLAIM`/`INFERENCE`, targets must be same-thread `FACT`s, and self-support is rejected.
- **Latest migration at authoring time is `0036_finding_overreach_reviewed`** — new migrations depend on it (run `makemigrations`; do not hand-number).
- **Backend test command (CI-equivalent):**
  `docker exec catalyst_backend python manage.py test investigations.tests.<module> --keepdb --noinput`
  (Full suite: `... test investigations --exclude-tag=eval --keepdb --noinput`.)

---

### Task 1: Models — `ThreadElement`, `ThreadElementCitation`, `supported_by`, `FindingDocument.is_legacy`

**Files:**
- Modify: `backend/investigations/models.py` (add after `FindingDocument`, ~line 1385)
- Create: `backend/investigations/migrations/0037_thread_elements.py` (via `makemigrations`; verify dep is `0036`)
- Test: `backend/investigations/tests/test_thread_element_model.py`

**Interfaces:**
- Produces: `ThreadElement` (`finding`, `element_type`, `text`, `position`, `handoff_ready`, `supported_by` M2M, `created_at`, `updated_at`); `ThreadElementType` TextChoices (`FACT`/`INFERENCE`/`QUESTION`/`CLAIM`/`NOTE`); `ThreadElementCitation` (`element`, `document`, `page_reference`, `context_note`, `.clean()`); `FindingDocument.is_legacy: bool`.

- [ ] **Step 1: Write the failing test**

Create `backend/investigations/tests/test_thread_element_model.py`:

```python
from django.db import IntegrityError
from django.core.exceptions import ValidationError
from django.test import TestCase

from investigations.models import (
    Case, Document, Finding, FindingDocument, ThreadElement,
    ThreadElementCitation, ThreadElementType,
)


def _doc(case, suffix="a"):
    return Document.objects.create(
        case=case, filename=f"e-{suffix}.pdf", file_path=f"c/e-{suffix}.pdf",
        sha256_hash=suffix * 64, file_size=10,
    )


class ThreadElementModelTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.finding = Finding.objects.create(case=self.case, rule_id="MANUAL", title="T")

    def test_create_and_order_by_position(self):
        ThreadElement.objects.create(finding=self.finding, element_type=ThreadElementType.CLAIM, position=1)
        ThreadElement.objects.create(finding=self.finding, element_type=ThreadElementType.FACT, position=0)
        types = list(self.finding.elements.values_list("element_type", flat=True))
        self.assertEqual(types, ["FACT", "CLAIM"])

    def test_unique_position_per_finding(self):
        ThreadElement.objects.create(finding=self.finding, element_type=ThreadElementType.FACT, position=0)
        with self.assertRaises(IntegrityError):
            ThreadElement.objects.create(finding=self.finding, element_type=ThreadElementType.CLAIM, position=0)

    def test_supported_by_is_directional(self):
        fact = ThreadElement.objects.create(finding=self.finding, element_type=ThreadElementType.FACT, position=0)
        claim = ThreadElement.objects.create(finding=self.finding, element_type=ThreadElementType.CLAIM, position=1)
        claim.supported_by.add(fact)
        self.assertEqual(list(claim.supported_by.all()), [fact])
        self.assertEqual(list(fact.supports_elements.all()), [claim])

    def test_citation_same_case_clean_passes(self):
        el = ThreadElement.objects.create(finding=self.finding, element_type=ThreadElementType.FACT, position=0)
        c = ThreadElementCitation(element=el, document=_doc(self.case))
        c.full_clean()  # should not raise
        c.save()
        self.assertEqual(el.citations.count(), 1)

    def test_citation_cross_case_clean_raises(self):
        el = ThreadElement.objects.create(finding=self.finding, element_type=ThreadElementType.FACT, position=0)
        other_case = Case.objects.create(name="OTHER")
        c = ThreadElementCitation(element=el, document=_doc(other_case, "b"))
        with self.assertRaises(ValidationError):
            c.full_clean()

    def test_finding_document_is_legacy_defaults_false(self):
        fd = FindingDocument.objects.create(finding=self.finding, document=_doc(self.case, "c"))
        self.assertFalse(fd.is_legacy)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_thread_element_model --keepdb --noinput`
Expected: FAIL — `ImportError: cannot import name 'ThreadElement'`.

- [ ] **Step 3: Add the models**

In `backend/investigations/models.py`, after the `FindingDocument` class (~line 1385), add:

```python
class ThreadElementType(models.TextChoices):
    FACT = "FACT", "Fact"
    INFERENCE = "INFERENCE", "Inference"
    QUESTION = "QUESTION", "Unresolved question"
    CLAIM = "CLAIM", "Claim"
    NOTE = "NOTE", "Context note"  # migration/context only — never satisfies a gate


class ThreadElement(UUIDPrimaryKeyModel):
    """One typed evidentiary element within a thread (Finding).

    The four-part taxonomy (FACT/INFERENCE/QUESTION/CLAIM) is the defensible
    structure; NOTE is a subordinate context bucket used for migration.
    """

    finding = models.ForeignKey(Finding, on_delete=models.CASCADE, related_name="elements")
    element_type = models.CharField(max_length=20, choices=ThreadElementType.choices)
    text = models.TextField(blank=True, default="")
    position = models.PositiveIntegerField(default=0)
    handoff_ready = models.BooleanField(
        default=False,
        help_text="Only meaningful on CLAIM; gated so non-CLAIM cannot be true.",
    )
    supported_by = models.ManyToManyField(
        "self",
        symmetrical=False,
        related_name="supports_elements",
        blank=True,
        help_text="A CLAIM/INFERENCE points at the FACT(s) that back it.",
    )
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "thread_element"
        ordering = ["position"]
        constraints = [
            models.UniqueConstraint(
                fields=["finding", "position"], name="uniq_thread_element_position"
            ),
        ]
        indexes = [
            models.Index(fields=["finding", "position"], name="idx_thread_element_fp"),
        ]

    def __str__(self) -> str:
        return f"{self.element_type} @ {self.position}"


class ThreadElementCitation(UUIDPrimaryKeyModel):
    """Per-element evidence binding — the SOURCE OF TRUTH for citations."""

    element = models.ForeignKey(
        ThreadElement, on_delete=models.CASCADE, related_name="citations"
    )
    document = models.ForeignKey(
        "Document", on_delete=models.CASCADE, related_name="element_citations"
    )
    page_reference = models.CharField(max_length=100, blank=True, default="")
    context_note = models.TextField(blank=True, default="")

    class Meta:
        db_table = "thread_element_citation"
        constraints = [
            models.UniqueConstraint(
                fields=["element", "document", "page_reference"],
                name="uniq_thread_element_citation",
            ),
        ]

    def clean(self):
        # Defense-in-depth only (Django does NOT call clean() on save()); the
        # serializer is the authoritative same-case guard.
        if self.element.finding.case_id != self.document.case_id:
            raise ValidationError(
                "Citation document must belong to the same case as the thread."
            )

    def __str__(self) -> str:
        return f"cite {self.document_id} @ {self.element_id}"
```

Add `is_legacy` to `FindingDocument` (after `context_note`, ~line 1382):

```python
    is_legacy = models.BooleanField(
        default=False,
        help_text=(
            "True for compatibility-index rows not authored via ThreadElementCitation "
            "(pre-Phase-4 citations, or the legacy add_document_ids path). Never reaped "
            "by element-citation churn."
        ),
    )
```

Ensure `ValidationError` is imported at the top of `models.py` (`from django.core.exceptions import ValidationError`) — check the existing import block; add only if missing.

- [ ] **Step 4: Generate the migration**

Run: `docker exec catalyst_backend python manage.py makemigrations investigations`
Expected: a migration (named ~`0037_thread_elements`) creating the two tables + M2M + `FindingDocument.is_legacy`, with `dependencies = [("investigations", "0036_finding_overreach_reviewed")]`. Open the file and confirm that dependency.

- [ ] **Step 5: Run tests to verify they pass**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_thread_element_model --keepdb --noinput`
Expected: PASS (6 tests).

- [ ] **Step 6: Lint + commit**

```bash
cd backend && ruff check . && ruff format --check .
git add backend/investigations/models.py backend/investigations/migrations backend/investigations/tests/test_thread_element_model.py
git commit -m "feat(threads): ThreadElement + ThreadElementCitation models + FindingDocument.is_legacy"
```

---

### Task 2: Completeness predicate helpers (UNWIRED)

**Files:**
- Create: `backend/investigations/thread_elements.py`
- Test: `backend/investigations/tests/test_thread_completeness.py`

**Interfaces:**
- Consumes: `ThreadElement`, `ThreadElementType` (Task 1).
- Produces: `is_complete_fact(element) -> bool`; `is_complete_claim(element) -> bool`; `finding_has_complete_fact(finding) -> bool`; `finding_has_handoff_ready_backed_claim(finding) -> bool`. **Built but not called by any gate in 4A** — 4B wires them.

- [ ] **Step 1: Write the failing test**

Create `backend/investigations/tests/test_thread_completeness.py`:

```python
from django.test import TestCase

from investigations.models import Case, Document, Finding, ThreadElement, ThreadElementType
from investigations.thread_elements import (
    is_complete_fact, is_complete_claim,
    finding_has_complete_fact, finding_has_handoff_ready_backed_claim,
)


def _doc(case, s="a"):
    return Document.objects.create(
        case=case, filename=f"{s}.pdf", file_path=f"{s}.pdf", sha256_hash=s * 64, file_size=1
    )


class CompletenessTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.f = Finding.objects.create(case=self.case, rule_id="MANUAL", title="T")

    def _fact(self, pos, cited=True, text="a fact"):
        el = ThreadElement.objects.create(
            finding=self.f, element_type=ThreadElementType.FACT, position=pos, text=text
        )
        if cited:
            el.citations.create(document=_doc(self.case, str(pos)))
        return el

    def test_fact_needs_text_and_citation(self):
        self.assertTrue(is_complete_fact(self._fact(0)))
        self.assertFalse(is_complete_fact(self._fact(1, cited=False)))
        self.assertFalse(is_complete_fact(self._fact(2, text="")))

    def test_claim_needs_backing_complete_fact(self):
        fact = self._fact(0)
        claim = ThreadElement.objects.create(
            finding=self.f, element_type=ThreadElementType.CLAIM, position=1, text="claim"
        )
        self.assertFalse(is_complete_claim(claim))
        claim.supported_by.add(fact)
        self.assertTrue(is_complete_claim(claim))

    def test_claim_backed_only_by_incomplete_fact_is_incomplete(self):
        bad = self._fact(0, cited=False)
        claim = ThreadElement.objects.create(
            finding=self.f, element_type=ThreadElementType.CLAIM, position=1, text="claim"
        )
        claim.supported_by.add(bad)
        self.assertFalse(is_complete_claim(claim))

    def test_finding_helpers(self):
        self.assertFalse(finding_has_complete_fact(self.f))
        fact = self._fact(0)
        self.assertTrue(finding_has_complete_fact(self.f))
        self.assertFalse(finding_has_handoff_ready_backed_claim(self.f))
        claim = ThreadElement.objects.create(
            finding=self.f, element_type=ThreadElementType.CLAIM, position=1,
            text="claim", handoff_ready=True,
        )
        claim.supported_by.add(fact)
        self.assertTrue(finding_has_handoff_ready_backed_claim(self.f))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_thread_completeness --keepdb --noinput`
Expected: FAIL — `ModuleNotFoundError: No module named 'investigations.thread_elements'`.

- [ ] **Step 3: Write the predicates**

Create `backend/investigations/thread_elements.py`:

```python
"""Thread-element predicates + document_links sync helpers.

NOTE: the completeness predicates here are built in 4A-additive but are NOT
wired into any gate (FindingUpdateSerializer / referral_grade.py) until 4B.
Keep this the single definition of "complete".
"""

from .models import ThreadElementType


def is_complete_fact(element) -> bool:
    """A FACT is complete iff it has non-empty text and at least one citation."""
    return (
        element.element_type == ThreadElementType.FACT
        and bool((element.text or "").strip())
        and element.citations.exists()
    )


def is_complete_claim(element) -> bool:
    """A CLAIM is complete iff it has text and at least one backing complete FACT."""
    if element.element_type != ThreadElementType.CLAIM or not (element.text or "").strip():
        return False
    return any(is_complete_fact(f) for f in element.supported_by.all())


def finding_has_complete_fact(finding) -> bool:
    """Tier-1 (CONFIRMED) ingredient — used by 4B: at least one complete cited FACT."""
    return any(
        is_complete_fact(e)
        for e in finding.elements.filter(element_type=ThreadElementType.FACT)
    )


def finding_has_handoff_ready_backed_claim(finding) -> bool:
    """Tier-2 (referral-grade) ingredient — used by 4B: handoff_ready CLAIM backed by a complete FACT."""
    return any(
        is_complete_claim(e)
        for e in finding.elements.filter(
            element_type=ThreadElementType.CLAIM, handoff_ready=True
        )
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_thread_completeness --keepdb --noinput`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint + commit**

```bash
cd backend && ruff check . && ruff format --check .
git add backend/investigations/thread_elements.py backend/investigations/tests/test_thread_completeness.py
git commit -m "feat(threads): completeness predicate helpers (unwired)"
```

---

### Task 3: `document_links` sync helpers

**Files:**
- Modify: `backend/investigations/thread_elements.py`
- Test: `backend/investigations/tests/test_document_links_sync.py`

**Interfaces:**
- Consumes: `ThreadElement`, `ThreadElementCitation`, `FindingDocument` (Task 1).
- Produces: `ensure_document_link(finding, document)`; `reap_document_link_if_orphaned(finding, document)`.

- [ ] **Step 1: Write the failing test**

Create `backend/investigations/tests/test_document_links_sync.py`:

```python
from django.test import TestCase

from investigations.models import (
    Case, Document, Finding, FindingDocument, ThreadElement, ThreadElementType,
)
from investigations.thread_elements import ensure_document_link, reap_document_link_if_orphaned


def _doc(case, s="a"):
    return Document.objects.create(
        case=case, filename=f"{s}.pdf", file_path=f"{s}.pdf", sha256_hash=s * 64, file_size=1
    )


class DocumentLinkSyncTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.f = Finding.objects.create(case=self.case, rule_id="MANUAL", title="T")
        self.doc = _doc(self.case)

    def test_ensure_creates_one_non_legacy_link(self):
        ensure_document_link(self.f, self.doc)
        ensure_document_link(self.f, self.doc)  # idempotent
        links = FindingDocument.objects.filter(finding=self.f, document=self.doc)
        self.assertEqual(links.count(), 1)
        self.assertFalse(links.first().is_legacy)

    def test_reap_removes_when_no_element_cites(self):
        ensure_document_link(self.f, self.doc)
        reap_document_link_if_orphaned(self.f, self.doc)
        self.assertEqual(FindingDocument.objects.filter(finding=self.f, document=self.doc).count(), 0)

    def test_reap_keeps_when_another_element_still_cites(self):
        el = ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.FACT, position=0)
        el.citations.create(document=self.doc)
        ensure_document_link(self.f, self.doc)
        reap_document_link_if_orphaned(self.f, self.doc)
        self.assertEqual(FindingDocument.objects.filter(finding=self.f, document=self.doc).count(), 1)

    def test_reap_never_removes_legacy(self):
        FindingDocument.objects.create(finding=self.f, document=self.doc, is_legacy=True)
        reap_document_link_if_orphaned(self.f, self.doc)
        self.assertEqual(FindingDocument.objects.filter(finding=self.f, document=self.doc).count(), 1)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_document_links_sync --keepdb --noinput`
Expected: FAIL — `ImportError: cannot import name 'ensure_document_link'`.

- [ ] **Step 3: Add the sync helpers**

Append to `backend/investigations/thread_elements.py`:

```python
def ensure_document_link(finding, document):
    """Ensure a non-legacy FindingDocument compatibility row exists for (finding, document)."""
    from .models import FindingDocument

    FindingDocument.objects.get_or_create(
        finding=finding, document=document, defaults={"is_legacy": False}
    )


def reap_document_link_if_orphaned(finding, document):
    """Remove the FindingDocument row iff no element still cites it AND it is not legacy."""
    from .models import FindingDocument, ThreadElementCitation

    still_cited = ThreadElementCitation.objects.filter(
        element__finding=finding, document=document
    ).exists()
    if still_cited:
        return
    FindingDocument.objects.filter(
        finding=finding, document=document, is_legacy=False
    ).delete()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_document_links_sync --keepdb --noinput`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint + commit**

```bash
cd backend && ruff check . && ruff format --check .
git add backend/investigations/thread_elements.py backend/investigations/tests/test_document_links_sync.py
git commit -m "feat(threads): document_links sync (ensure/reap, respect legacy)"
```

---

### Task 4: Element + citation serializers (FACT-only citations, constrained backing)

**Files:**
- Modify: `backend/investigations/serializers.py` (add a "Thread elements" section after the Findings section, ~line 1140)
- Test: `backend/investigations/tests/test_thread_element_serializers.py`

**Interfaces:**
- Consumes: `ThreadElement`, `ThreadElementType`, `ThreadElementCitation`, `Document` (Task 1); `is_complete_fact` (Task 2); `ensure_document_link` (Task 3).
- Produces: `serialize_element(element) -> dict`; `ThreadElementCreateSerializer(data, finding)`; `ThreadElementUpdateSerializer(data, instance)`; `ThreadElementCitationSerializer(data, element)`.

- [ ] **Step 1: Write the failing test**

Create `backend/investigations/tests/test_thread_element_serializers.py`:

```python
from django.test import TestCase

from investigations.models import (
    Case, Document, Finding, ThreadElement, ThreadElementType,
)
from investigations.serializers import (
    ThreadElementCreateSerializer, ThreadElementUpdateSerializer,
    ThreadElementCitationSerializer, serialize_element,
)


def _doc(case, s="a"):
    return Document.objects.create(
        case=case, filename=f"{s}.pdf", file_path=f"{s}.pdf", sha256_hash=s * 64, file_size=1
    )


class ElementSerializerTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.f = Finding.objects.create(case=self.case, rule_id="MANUAL", title="T")

    def _fact(self, pos=0, cited=True):
        el = ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.FACT, position=pos, text="x")
        if cited:
            el.citations.create(document=_doc(self.case, str(pos)))
        return el

    def test_create_assigns_next_position(self):
        ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.FACT, position=0)
        s = ThreadElementCreateSerializer(data={"element_type": "CLAIM", "text": "c"}, finding=self.f)
        self.assertTrue(s.is_valid(), s.errors)
        el = s.save()
        self.assertEqual(el.position, 1)

    def test_create_rejects_bad_type(self):
        s = ThreadElementCreateSerializer(data={"element_type": "BOGUS"}, finding=self.f)
        self.assertFalse(s.is_valid())
        self.assertIn("element_type", s.errors)

    def test_handoff_ready_rejected_on_incomplete_claim(self):
        claim = ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.CLAIM, position=0, text="c")
        s = ThreadElementUpdateSerializer(data={"handoff_ready": True}, instance=claim)
        self.assertFalse(s.is_valid())
        self.assertIn("handoff_ready", s.errors)

    def test_handoff_ready_rejected_on_non_claim(self):
        fact = self._fact()
        s = ThreadElementUpdateSerializer(data={"handoff_ready": True}, instance=fact)
        self.assertFalse(s.is_valid())

    def test_supported_by_requires_claim_or_inference(self):
        fact = self._fact()
        other_fact = ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.FACT, position=1, text="y")
        # a FACT may not have supported_by
        s = ThreadElementUpdateSerializer(data={"supported_by_ids": [str(fact.id)]}, instance=other_fact)
        self.assertFalse(s.is_valid())
        self.assertIn("supported_by_ids", s.errors)

    def test_supported_by_rejects_self(self):
        claim = ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.CLAIM, position=0, text="c")
        s = ThreadElementUpdateSerializer(data={"supported_by_ids": [str(claim.id)]}, instance=claim)
        self.assertFalse(s.is_valid())

    def test_supported_by_accepts_facts_for_claim(self):
        fact = self._fact()
        claim = ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.CLAIM, position=1, text="c")
        s = ThreadElementUpdateSerializer(data={"supported_by_ids": [str(fact.id)]}, instance=claim)
        self.assertTrue(s.is_valid(), s.errors)
        s.save()
        self.assertEqual(list(claim.supported_by.all()), [fact])

    def test_citation_rejected_on_non_fact(self):
        claim = ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.CLAIM, position=0, text="c")
        s = ThreadElementCitationSerializer(data={"document_id": str(_doc(self.case).id)}, element=claim)
        self.assertFalse(s.is_valid())
        self.assertIn("element", s.errors)

    def test_citation_same_case_enforced(self):
        el = ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.FACT, position=0)
        other = _doc(Case.objects.create(name="O"), "z")
        s = ThreadElementCitationSerializer(data={"document_id": str(other.id)}, element=el)
        self.assertFalse(s.is_valid())
        self.assertIn("document_id", s.errors)

    def test_serialize_shape(self):
        el = self._fact()
        out = serialize_element(el)
        self.assertEqual(out["element_type"], "FACT")
        self.assertEqual(len(out["citations"]), 1)
        self.assertIn("supported_by_ids", out)
        self.assertIn("complete", out)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_thread_element_serializers --keepdb --noinput`
Expected: FAIL — `ImportError: cannot import name 'serialize_element'`.

- [ ] **Step 3: Write the serializers**

In `backend/investigations/serializers.py`, merge into the existing `from .models import ...` block:

```python
from .models import ThreadElement, ThreadElementCitation, ThreadElementType, Document
```

(Add `Document` only if not already imported.) And add:

```python
from .thread_elements import is_complete_fact, is_complete_claim, ensure_document_link
```

Add a new section after the Findings serializers (~line 1140):

```python
# ---------------------------------------------------------------------------
# Thread elements
# ---------------------------------------------------------------------------

_VALID_ELEMENT_TYPES = {c.value for c in ThreadElementType}
_BACKING_TYPES = {ThreadElementType.CLAIM, ThreadElementType.INFERENCE}


def serialize_element(element) -> dict:
    """Serialize a ThreadElement (with citations + backing ids) to a JSON-safe dict."""
    if element.element_type == ThreadElementType.FACT:
        complete = is_complete_fact(element)
    elif element.element_type == ThreadElementType.CLAIM:
        complete = is_complete_claim(element)
    else:
        complete = bool((element.text or "").strip())
    return {
        "id": str(element.pk),
        "finding_id": str(element.finding_id),
        "element_type": element.element_type,
        "text": element.text,
        "position": element.position,
        "handoff_ready": element.handoff_ready,
        "complete": complete,
        "supported_by_ids": [str(e.pk) for e in element.supported_by.all()],
        "citations": [
            {
                "id": str(c.pk),
                "document_id": str(c.document_id),
                "document_filename": (c.document.filename if c.document else ""),
                "page_reference": c.page_reference,
                "context_note": c.context_note,
            }
            for c in element.citations.all()
        ],
    }


class ThreadElementCreateSerializer:
    """POST a new element onto a thread. Drafting is permissive (no completeness check)."""

    def __init__(self, data=None, finding=None):
        self.initial_data = data or {}
        self.finding = finding
        self.instance = None
        self.validated_data = {}
        self._errors = {}

    @property
    def errors(self):
        return self._errors

    @property
    def data(self):
        return serialize_element(self.instance) if self.instance else {}

    def is_valid(self) -> bool:
        self._errors = {}
        etype = (self.initial_data.get("element_type") or "").strip()
        if etype not in _VALID_ELEMENT_TYPES:
            self._errors = {"element_type": ["Invalid element_type."]}
            return False
        self.validated_data = {
            "element_type": etype,
            "text": self.initial_data.get("text", ""),
        }
        return True

    def save(self) -> ThreadElement:
        if not self.validated_data:
            raise ValueError("Call is_valid() before save().")
        last = self.finding.elements.order_by("-position").first()
        next_pos = (last.position + 1) if last else 0
        self.instance = ThreadElement.objects.create(
            finding=self.finding, position=next_pos, **self.validated_data
        )
        return self.instance


class ThreadElementUpdateSerializer:
    """PATCH text / handoff_ready / supported_by_ids on an element.

    Constraints: handoff_ready true only on a complete CLAIM; supported_by only
    on CLAIM/INFERENCE, targets are same-thread FACTs, no self-support; an
    element_type change that would orphan citations/backing is rejected.
    """

    allowed_fields = {"text", "element_type", "handoff_ready", "supported_by_ids"}

    def __init__(self, data=None, instance=None):
        self.initial_data = data or {}
        self.instance = instance
        self.validated_data = {}
        self._supported = None
        self._errors = {}

    @property
    def errors(self):
        return self._errors

    @property
    def data(self):
        return serialize_element(self.instance) if self.instance else {}

    def is_valid(self) -> bool:
        self._errors = {}
        unexpected = sorted(set(self.initial_data) - self.allowed_fields)
        if unexpected:
            self._errors = {"non_field_errors": [f"Unexpected field(s): {', '.join(unexpected)}"]}
            return False

        if "text" in self.initial_data:
            self.validated_data["text"] = self.initial_data["text"]

        new_type = self.instance.element_type
        if "element_type" in self.initial_data:
            new_type = (self.initial_data["element_type"] or "").strip()
            if new_type not in _VALID_ELEMENT_TYPES:
                self._errors = {"element_type": ["Invalid element_type."]}
                return False
            if new_type != ThreadElementType.FACT and self.instance.citations.exists():
                self._errors = {"element_type": ["Remove citations before changing this FACT's type."]}
                return False
            if new_type not in _BACKING_TYPES and self.instance.supported_by.exists():
                self._errors = {"element_type": ["Remove supporting facts before changing this type."]}
                return False
            self.validated_data["element_type"] = new_type

        if "supported_by_ids" in self.initial_data:
            ids = [str(i) for i in (self.initial_data["supported_by_ids"] or [])]
            if new_type not in _BACKING_TYPES:
                self._errors = {"supported_by_ids": ["Only CLAIM/INFERENCE may have supporting facts."]}
                return False
            if str(self.instance.pk) in ids:
                self._errors = {"supported_by_ids": ["An element cannot support itself."]}
                return False
            facts = list(
                ThreadElement.objects.filter(
                    finding=self.instance.finding, id__in=ids,
                    element_type=ThreadElementType.FACT,
                )
            )
            if len(facts) != len(set(ids)):
                self._errors = {"supported_by_ids": ["All ids must be FACT elements in this thread."]}
                return False
            self._supported = facts

        if "handoff_ready" in self.initial_data:
            want = self.initial_data["handoff_ready"]
            if not isinstance(want, bool):
                self._errors = {"handoff_ready": ["Must be a boolean."]}
                return False
            if want:
                if new_type != ThreadElementType.CLAIM:
                    self._errors = {"handoff_ready": ["Only a CLAIM can be handoff-ready."]}
                    return False
                backing = self._supported if self._supported is not None else list(
                    self.instance.supported_by.all()
                )
                has_text = bool((self.validated_data.get("text", self.instance.text) or "").strip())
                if not has_text or not any(is_complete_fact(f) for f in backing):
                    self._errors = {"handoff_ready": ["Claim must have text and a backing complete FACT."]}
                    return False
            self.validated_data["handoff_ready"] = want

        return True

    def save(self) -> ThreadElement:
        for field in ("text", "element_type", "handoff_ready"):
            if field in self.validated_data:
                setattr(self.instance, field, self.validated_data[field])
        self.instance.updated_at = timezone.now()
        self.instance.save()
        if self._supported is not None:
            self.instance.supported_by.set(self._supported)
        return self.instance


class ThreadElementCitationSerializer:
    """POST a citation onto a FACT element; same-case guard + document_links sync."""

    def __init__(self, data=None, element=None):
        self.initial_data = data or {}
        self.element = element
        self.instance = None
        self.validated_data = {}
        self._document = None
        self._errors = {}

    @property
    def errors(self):
        return self._errors

    @property
    def data(self):
        return serialize_element(self.element) if self.element else {}

    def is_valid(self) -> bool:
        self._errors = {}
        if self.element.element_type != ThreadElementType.FACT:
            self._errors = {"element": ["Citations may only attach to FACT elements."]}
            return False
        doc_id = self.initial_data.get("document_id")
        if not doc_id:
            self._errors = {"document_id": ["document_id is required."]}
            return False
        doc = Document.objects.filter(pk=doc_id).first()
        if doc is None:
            self._errors = {"document_id": ["Document not found."]}
            return False
        if doc.case_id != self.element.finding.case_id:
            self._errors = {"document_id": ["Document must belong to the same case."]}
            return False
        self._document = doc
        self.validated_data = {
            "page_reference": self.initial_data.get("page_reference", ""),
            "context_note": self.initial_data.get("context_note", ""),
        }
        return True

    def save(self) -> ThreadElementCitation:
        self.instance, _ = ThreadElementCitation.objects.get_or_create(
            element=self.element,
            document=self._document,
            page_reference=self.validated_data["page_reference"],
            defaults={"context_note": self.validated_data["context_note"]},
        )
        ensure_document_link(self.element.finding, self._document)
        return self.instance
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_thread_element_serializers --keepdb --noinput`
Expected: PASS (10 tests).

- [ ] **Step 5: Lint + commit**

```bash
cd backend && ruff check . && ruff format --check .
git add backend/investigations/serializers.py backend/investigations/tests/test_thread_element_serializers.py
git commit -m "feat(threads): element + citation serializers (FACT-only cites, constrained backing)"
```

---

### Task 5: Element CRUD + reorder + citation endpoints

**Files:**
- Modify: `backend/investigations/views.py` (add after `api_case_finding_detail`, ~line 3496)
- Modify: `backend/investigations/urls.py` (after the findings paths, ~line 162)
- Test: `backend/investigations/tests/test_thread_element_api.py`

**Interfaces:**
- Consumes: serializers (Task 4); `reap_document_link_if_orphaned` (Task 3).
- Produces endpoints:
  - `GET/POST  /api/cases/<pk>/findings/<finding_id>/elements/`
  - `PATCH/DELETE  /api/cases/<pk>/findings/<finding_id>/elements/<element_id>/`
  - `POST  /api/cases/<pk>/findings/<finding_id>/elements/reorder/`
  - `POST  /api/cases/<pk>/findings/<finding_id>/elements/<element_id>/citations/`
  - `DELETE  /api/cases/<pk>/findings/<finding_id>/elements/<element_id>/citations/<citation_id>/`

- [ ] **Step 1: Write the failing test**

Create `backend/investigations/tests/test_thread_element_api.py`:

```python
from django.test import TestCase

from investigations.models import (
    Case, Document, Finding, FindingDocument, ThreadElement, ThreadElementType,
    ThreadElementCitation,
)


def _doc(case, s="a"):
    return Document.objects.create(
        case=case, filename=f"{s}.pdf", file_path=f"{s}.pdf", sha256_hash=s * 64, file_size=1
    )


class ThreadElementApiTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.f = Finding.objects.create(case=self.case, rule_id="MANUAL", title="T")
        self.base = f"/api/cases/{self.case.pk}/findings/{self.f.pk}/elements/"

    def test_create_and_list(self):
        r = self.client.post(self.base, data={"element_type": "FACT", "text": "x"},
                             content_type="application/json")
        self.assertEqual(r.status_code, 201, r.content)
        r2 = self.client.get(self.base)
        self.assertEqual(len(r2.json()["results"]), 1)

    def test_reorder_atomic(self):
        a = ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.FACT, position=0)
        b = ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.CLAIM, position=1)
        r = self.client.post(
            self.base + "reorder/",
            data={"ordered_ids": [str(b.id), str(a.id)]},
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        a.refresh_from_db(); b.refresh_from_db()
        self.assertEqual((b.position, a.position), (0, 1))

    def test_add_then_delete_citation_syncs_document_links(self):
        el = ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.FACT, position=0)
        doc = _doc(self.case)
        r = self.client.post(
            f"{self.base}{el.id}/citations/",
            data={"document_id": str(doc.id)}, content_type="application/json",
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.assertTrue(FindingDocument.objects.filter(finding=self.f, document=doc).exists())
        cite = ThreadElementCitation.objects.get(element=el, document=doc)
        r2 = self.client.delete(f"{self.base}{el.id}/citations/{cite.id}/")
        self.assertEqual(r2.status_code, 204)
        self.assertFalse(FindingDocument.objects.filter(finding=self.f, document=doc).exists())

    def test_delete_element_cleans_backing_and_links(self):
        fact = ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.FACT, position=0)
        doc = _doc(self.case)
        fact.citations.create(document=doc)
        FindingDocument.objects.create(finding=self.f, document=doc)
        claim = ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.CLAIM, position=1)
        claim.supported_by.add(fact)
        r = self.client.delete(f"{self.base}{fact.id}/")
        self.assertEqual(r.status_code, 204)
        self.assertEqual(list(claim.supported_by.all()), [])
        self.assertFalse(FindingDocument.objects.filter(finding=self.f).exists())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_thread_element_api --keepdb --noinput`
Expected: FAIL — 404s (routes not registered).

- [ ] **Step 3: Add the views**

In `backend/investigations/views.py`, add to the serializers import block (~line 56):

```python
    ThreadElementCreateSerializer,
    ThreadElementUpdateSerializer,
    ThreadElementCitationSerializer,
    serialize_element,
```

Add to the model + helper imports (merge into existing blocks):

```python
from .thread_elements import reap_document_link_if_orphaned
from .models import ThreadElement, ThreadElementCitation, Document
```

Add after `api_case_finding_detail` (~line 3496):

```python
def _get_case_finding(pk, finding_id):
    case = get_object_or_404(Case, pk=pk)
    finding = get_object_or_404(Finding, pk=finding_id, case=case)
    return case, finding


@require_http_methods(["GET", "POST"])
def api_thread_element_collection(request, pk, finding_id):
    case, finding = _get_case_finding(pk, finding_id)
    if request.method == "GET":
        elements = finding.elements.prefetch_related("citations__document", "supported_by")
        return JsonResponse({"results": [serialize_element(e) for e in elements]})

    payload, err = _parse_json_body(request)
    if err:
        return err
    serializer = ThreadElementCreateSerializer(data=payload, finding=finding)
    if not serializer.is_valid():
        return JsonResponse({"errors": serializer.errors}, status=400)
    with transaction.atomic():
        element = serializer.save()
        AuditLog.log(
            action=AuditAction.RECORD_CREATED,
            table_name="thread_element",
            record_id=element.pk,
            case_id=case.pk,
            after_state={"element_type": element.element_type},
            performed_by=getattr(request, "api_token", None),
        )
    return JsonResponse(serialize_element(element), status=201)


@require_http_methods(["PATCH", "DELETE"])
def api_thread_element_detail(request, pk, finding_id, element_id):
    case, finding = _get_case_finding(pk, finding_id)
    element = get_object_or_404(ThreadElement, pk=element_id, finding=finding)

    if request.method == "DELETE":
        doc_ids = list(element.citations.values_list("document_id", flat=True))
        element.supports_elements.clear()  # remove from other elements' supported_by
        element.delete()
        for doc_id in doc_ids:
            reap_document_link_if_orphaned(finding, Document.objects.get(pk=doc_id))
        AuditLog.log(
            action=AuditAction.RECORD_DELETED,
            table_name="thread_element",
            record_id=element_id,
            case_id=case.pk,
            performed_by=getattr(request, "api_token", None),
        )
        return HttpResponse(status=204)

    payload, err = _parse_json_body(request)
    if err:
        return err
    serializer = ThreadElementUpdateSerializer(data=payload, instance=element)
    if not serializer.is_valid():
        return JsonResponse({"errors": serializer.errors}, status=400)
    with transaction.atomic():
        serializer.save()
    return JsonResponse(serialize_element(element))


@require_http_methods(["POST"])
def api_thread_element_reorder(request, pk, finding_id):
    case, finding = _get_case_finding(pk, finding_id)
    payload, err = _parse_json_body(request)
    if err:
        return err
    ordered_ids = [str(i) for i in payload.get("ordered_ids", [])]
    existing = {str(i) for i in finding.elements.values_list("id", flat=True)}
    if set(ordered_ids) != existing or len(ordered_ids) != len(existing):
        return JsonResponse(
            {"errors": {"ordered_ids": ["Must list exactly this thread's element ids."]}},
            status=400,
        )
    # Two-phase write to dodge the unique(finding, position) constraint.
    with transaction.atomic():
        for offset, eid in enumerate(ordered_ids):
            ThreadElement.objects.filter(pk=eid).update(position=offset + 1000)
        for offset, eid in enumerate(ordered_ids):
            ThreadElement.objects.filter(pk=eid).update(position=offset)
    elements = finding.elements.prefetch_related("citations__document", "supported_by")
    return JsonResponse({"results": [serialize_element(e) for e in elements]})


@require_http_methods(["POST"])
def api_thread_element_citation_collection(request, pk, finding_id, element_id):
    case, finding = _get_case_finding(pk, finding_id)
    element = get_object_or_404(ThreadElement, pk=element_id, finding=finding)
    payload, err = _parse_json_body(request)
    if err:
        return err
    serializer = ThreadElementCitationSerializer(data=payload, element=element)
    if not serializer.is_valid():
        return JsonResponse({"errors": serializer.errors}, status=400)
    with transaction.atomic():
        serializer.save()
    return JsonResponse(serialize_element(element), status=201)


@require_http_methods(["DELETE"])
def api_thread_element_citation_detail(request, pk, finding_id, element_id, citation_id):
    case, finding = _get_case_finding(pk, finding_id)
    element = get_object_or_404(ThreadElement, pk=element_id, finding=finding)
    citation = get_object_or_404(ThreadElementCitation, pk=citation_id, element=element)
    document = citation.document
    with transaction.atomic():
        citation.delete()
        reap_document_link_if_orphaned(finding, document)
    return HttpResponse(status=204)
```

- [ ] **Step 4: Register the URLs**

In `backend/investigations/urls.py`, after the `api_case_finding_detail` path (~line 162), add (note `reorder/` before the `<uuid:element_id>/` path):

```python
    path(
        "api/cases/<uuid:pk>/findings/<uuid:finding_id>/elements/",
        views.api_thread_element_collection,
        name="api_thread_element_collection",
    ),
    path(
        "api/cases/<uuid:pk>/findings/<uuid:finding_id>/elements/reorder/",
        views.api_thread_element_reorder,
        name="api_thread_element_reorder",
    ),
    path(
        "api/cases/<uuid:pk>/findings/<uuid:finding_id>/elements/<uuid:element_id>/",
        views.api_thread_element_detail,
        name="api_thread_element_detail",
    ),
    path(
        "api/cases/<uuid:pk>/findings/<uuid:finding_id>/elements/<uuid:element_id>/citations/",
        views.api_thread_element_citation_collection,
        name="api_thread_element_citation_collection",
    ),
    path(
        "api/cases/<uuid:pk>/findings/<uuid:finding_id>/elements/"
        "<uuid:element_id>/citations/<uuid:citation_id>/",
        views.api_thread_element_citation_detail,
        name="api_thread_element_citation_detail",
    ),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_thread_element_api --keepdb --noinput`
Expected: PASS (4 tests).

- [ ] **Step 6: Lint + commit**

```bash
cd backend && ruff check . && ruff format --check .
git add backend/investigations/views.py backend/investigations/urls.py backend/investigations/tests/test_thread_element_api.py
git commit -m "feat(threads): element CRUD + reorder + citation endpoints"
```

---

### Task 6: Embed `elements[]` in `serialize_finding`

**Files:**
- Modify: `backend/investigations/serializers.py` (`serialize_finding`, ~line 694) + the finding detail view prefetch (`views.py:3433`, `:3468`)
- Test: `backend/investigations/tests/test_finding_embeds_elements.py`

**Interfaces:**
- Consumes: `serialize_element` (Task 4).
- Produces: `serialize_finding(finding)["elements"]` — list of `serialize_element` dicts ordered by position.

- [ ] **Step 1: Write the failing test**

Create `backend/investigations/tests/test_finding_embeds_elements.py`:

```python
from django.test import TestCase

from investigations.models import Case, Finding, ThreadElement, ThreadElementType
from investigations.serializers import serialize_finding


class FindingEmbedsElementsTests(TestCase):
    def test_finding_detail_includes_elements_in_order(self):
        case = Case.objects.create(name="C")
        f = Finding.objects.create(case=case, rule_id="MANUAL", title="T")
        ThreadElement.objects.create(finding=f, element_type=ThreadElementType.CLAIM, position=1, text="c")
        ThreadElement.objects.create(finding=f, element_type=ThreadElementType.FACT, position=0, text="a")
        out = serialize_finding(f)
        self.assertEqual([e["element_type"] for e in out["elements"]], ["FACT", "CLAIM"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_finding_embeds_elements --keepdb --noinput`
Expected: FAIL — `KeyError: 'elements'`.

- [ ] **Step 3: Add `elements` to `serialize_finding`**

In `serialize_finding` (serializers.py), after the `document_links` entry and before the closing `}`, add:

```python
        "elements": [serialize_element(e) for e in finding.elements.all()],
```

In `views.py`, extend the two prefetch sites (`:3433` and `:3468`):

```python
Finding.objects.prefetch_related(
    "entity_links", "document_links",
    "elements__citations__document", "elements__supported_by",
)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_finding_embeds_elements --keepdb --noinput`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
cd backend && ruff check . && ruff format --check .
git add backend/investigations/serializers.py backend/investigations/views.py backend/investigations/tests/test_finding_embeds_elements.py
git commit -m "feat(threads): embed elements[] in finding detail"
```

---

### Task 7: Demote the legacy `add_document_ids` path to `is_legacy=True`

**Files:**
- Modify: `backend/investigations/serializers.py` (`FindingUpdateSerializer.save()`, the `FindingDocument` create, ~line 1127-1128)
- Test: `backend/investigations/tests/test_add_document_ids_legacy.py`

**Interfaces:**
- Consumes: `FindingDocument.is_legacy` (Task 1).
- Produces: rows created via `add_document_ids` carry `is_legacy=True`. **Behavior-preserving** — the tie-off gate and `referral_grade_qs` count `document_links` regardless of `is_legacy`, so this changes no gate outcome.

- [ ] **Step 1: Write the failing test**

Create `backend/investigations/tests/test_add_document_ids_legacy.py`:

```python
from django.test import TestCase

from investigations.models import Case, Document, Finding, FindingDocument, FindingStatus
from investigations.serializers import FindingUpdateSerializer


class AddDocumentIdsLegacyTests(TestCase):
    def test_add_document_ids_creates_legacy_rows(self):
        case = Case.objects.create(name="C")
        f = Finding.objects.create(case=case, rule_id="MANUAL", title="T", status=FindingStatus.NEW)
        doc = Document.objects.create(
            case=case, filename="d.pdf", file_path="d.pdf", sha256_hash="d" * 64, file_size=1
        )
        s = FindingUpdateSerializer(data={"add_document_ids": [str(doc.id)]}, instance=f)
        self.assertTrue(s.is_valid(), s.errors)
        s.save()
        link = FindingDocument.objects.get(finding=f, document=doc)
        self.assertTrue(link.is_legacy)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_add_document_ids_legacy --keepdb --noinput`
Expected: FAIL — `is_legacy` defaults False on the created row.

- [ ] **Step 3: Set `is_legacy=True` on the legacy create path**

In `FindingUpdateSerializer.save()`, the document-add loop (~line 1127):

```python
        for document in self._documents_to_add:
            FindingDocument.objects.get_or_create(
                finding=self.instance, document=document,
                defaults={"is_legacy": True},
            )
```

(If the existing call is `FindingDocument.objects.get_or_create(finding=..., document=document)` without defaults, add the `defaults={"is_legacy": True}`. Do not change the gate logic above it.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_add_document_ids_legacy investigations.tests.test_tie_off_gate --keepdb --noinput`
Expected: PASS — including the existing `test_tie_off_gate` suite unchanged (proves behavior preserved).

- [ ] **Step 5: Lint + commit**

```bash
cd backend && ruff check . && ruff format --check .
git add backend/investigations/serializers.py backend/investigations/tests/test_add_document_ids_legacy.py
git commit -m "feat(threads): legacy add_document_ids path writes is_legacy=True"
```

---

### Task 8: Data migration — narrative → NOTE (idempotent), flag legacy docs

**Files:**
- Create: `backend/investigations/migrations/_phase4_narrative_backfill.py` (importable helper)
- Create: `backend/investigations/migrations/0038_migrate_narrative_to_note.py` (via `makemigrations --empty`)
- Test: `backend/investigations/tests/test_narrative_migration.py`

**Interfaces:**
- Consumes: models from Task 1.
- Produces: every Finding with non-empty `narrative` gains one `NOTE` element at the **next free position** (idempotent; original narrative retained); every pre-existing `FindingDocument` flagged `is_legacy=True`.

- [ ] **Step 1: Write the failing test**

Create `backend/investigations/tests/test_narrative_migration.py`:

```python
from django.apps import apps
from django.test import TestCase

from investigations.models import (
    Case, Document, Finding, FindingDocument, ThreadElement, ThreadElementType,
)


def _doc(case, s="a"):
    return Document.objects.create(
        case=case, filename=f"{s}.pdf", file_path=f"{s}.pdf", sha256_hash=s * 64, file_size=1
    )


class NarrativeMigrationTests(TestCase):
    def test_forwards_converts_narrative_and_flags_docs(self):
        from investigations.migrations import _phase4_narrative_backfill as mig

        case = Case.objects.create(name="C")
        f = Finding.objects.create(case=case, rule_id="MANUAL", title="T", narrative="legacy text")
        FindingDocument.objects.create(finding=f, document=_doc(case))

        mig.forwards(apps, schema_editor=None)

        note = f.elements.get(element_type=ThreadElementType.NOTE)
        self.assertEqual(note.text, "legacy text")
        self.assertEqual(f.narrative, "legacy text")  # original retained
        self.assertTrue(FindingDocument.objects.filter(finding=f, is_legacy=True).exists())

    def test_forwards_is_idempotent_and_collision_safe(self):
        from investigations.migrations import _phase4_narrative_backfill as mig

        case = Case.objects.create(name="C2")
        f = Finding.objects.create(case=case, rule_id="MANUAL", title="T", narrative="n")
        # Pre-existing element already occupies position 0.
        ThreadElement.objects.create(finding=f, element_type=ThreadElementType.FACT, position=0, text="x")

        mig.forwards(apps, schema_editor=None)
        mig.forwards(apps, schema_editor=None)  # rerun must not duplicate or collide

        notes = f.elements.filter(element_type=ThreadElementType.NOTE)
        self.assertEqual(notes.count(), 1)
        self.assertNotEqual(notes.first().position, 0)  # appended after the existing element
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_narrative_migration --keepdb --noinput`
Expected: FAIL — `ModuleNotFoundError: investigations.migrations._phase4_narrative_backfill`.

- [ ] **Step 3: Write the backfill helper + the migration**

Create `backend/investigations/migrations/_phase4_narrative_backfill.py`:

```python
"""Importable forward logic for the Phase 4 narrative->NOTE data migration.

Separate from the migration file so it is unit-testable without a migration
replay. Idempotent + collision-safe: appends the NOTE at the next free position
and skips when an equivalent NOTE already exists. Leaves Finding.narrative in
place (the legacy PDF still reads it until 4C).
"""

from django.db.models import Max


def forwards(apps, schema_editor):
    Finding = apps.get_model("investigations", "Finding")
    ThreadElement = apps.get_model("investigations", "ThreadElement")
    FindingDocument = apps.get_model("investigations", "FindingDocument")

    # 1) Flag every existing citation as legacy (preserved, never reaped).
    FindingDocument.objects.update(is_legacy=True)

    # 2) Convert non-empty narrative into a single NOTE element.
    for finding in Finding.objects.exclude(narrative="").exclude(narrative__isnull=True):
        existing_note = ThreadElement.objects.filter(
            finding=finding, element_type="NOTE", text=finding.narrative
        ).exists()
        if existing_note:
            continue
        max_pos = ThreadElement.objects.filter(finding=finding).aggregate(m=Max("position"))["m"]
        next_pos = 0 if max_pos is None else max_pos + 1
        ThreadElement.objects.create(
            finding=finding,
            element_type="NOTE",
            text=finding.narrative,
            position=next_pos,
            handoff_ready=False,
        )
```

Generate the migration:

Run: `docker exec catalyst_backend python manage.py makemigrations investigations --empty -n migrate_narrative_to_note`

Edit the generated file:

```python
from django.db import migrations

from investigations.migrations import _phase4_narrative_backfill


def forwards(apps, schema_editor):
    _phase4_narrative_backfill.forwards(apps, schema_editor)


def backwards(apps, schema_editor):
    # Non-reversible data migration; NOTE elements are harmless to keep.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("investigations", "0037_thread_elements"),  # the Task 1 migration name
    ]
    operations = [migrations.RunPython(forwards, backwards)]
```

- [ ] **Step 4: Apply migrations + run tests**

Run: `docker exec catalyst_backend python manage.py migrate investigations --noinput`
Then: `docker exec catalyst_backend python manage.py test investigations.tests.test_narrative_migration --keepdb --noinput`
Expected: PASS (2 tests).

- [ ] **Step 5: Lint + commit**

```bash
cd backend && ruff check . && ruff format --check .
git add backend/investigations/migrations backend/investigations/tests/test_narrative_migration.py
git commit -m "feat(threads): idempotent data migration narrative->NOTE + flag legacy citations"
```

---

### Task 9: `seed_demo` builds real elements AND retains legacy narrative

**Files:**
- Modify: `backend/investigations/management/commands/seed_demo.py`
- Test: `backend/investigations/tests/test_seed_demo_elements.py`

**Interfaces:**
- Consumes: models (Task 1).
- Produces: the demo's flagship confirmed thread has a complete FACT + a `handoff_ready` CLAIM backed by it (so it is referral-grade-shaped once 4B flips the gate), **and** retains its `narrative` text + a legacy `FindingDocument` row (so the current PDF/UI keep working pre-4C).

> This task does **not** assert referral-grade (that predicate isn't strengthened until 4B). It asserts the demo has the *element shape* the future gate needs, plus retained legacy narrative.

- [ ] **Step 1: Write the failing test**

Create `backend/investigations/tests/test_seed_demo_elements.py`:

```python
from django.core.management import call_command
from django.test import TestCase

from investigations.models import Case, Finding, FindingStatus, ThreadElementType
from investigations.thread_elements import finding_has_handoff_ready_backed_claim


class SeedDemoElementsTests(TestCase):
    def test_seed_demo_flagship_thread_has_backed_claim_and_keeps_narrative(self):
        call_command("seed_demo")
        confirmed = Finding.objects.filter(status=FindingStatus.CONFIRMED).order_by("created_at").first()
        self.assertIsNotNone(confirmed, "seed_demo should create a CONFIRMED thread")
        self.assertTrue(
            finding_has_handoff_ready_backed_claim(confirmed),
            "flagship confirmed thread must have a handoff_ready CLAIM backed by a complete FACT",
        )
        self.assertTrue(confirmed.narrative.strip(), "legacy narrative must be retained for pre-4C PDF")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_seed_demo_elements --keepdb --noinput`
Expected: FAIL — the confirmed demo thread has no backed handoff-ready claim.

- [ ] **Step 3: Add elements to the demo's confirmed thread (keep its narrative)**

In `seed_demo.py`, find where the demo's CONFIRMED finding is created (search `CONFIRMED` / `overreach_reviewed`). Confirm it still sets a non-empty `narrative` (leave that line in place). After it exists and has a cited document, add:

```python
        from investigations.models import ThreadElement, ThreadElementType

        # Phase 4: structured elements so the flagship thread is referral-grade-shaped
        # under the future (4B) gate. The narrative + legacy FindingDocument rows are
        # intentionally retained so the pre-4C PDF/UI still render.
        fact = ThreadElement.objects.create(
            finding=confirmed_finding,
            element_type=ThreadElementType.FACT,
            position=0,
            text="Org purchased 1420 Elm St for $410,000 on 2021-03-09.",
        )
        fact.citations.create(
            document=deed_doc, page_reference="p.2", context_note="Recorded sale price.",
        )
        claim = ThreadElement.objects.create(
            finding=confirmed_finding,
            element_type=ThreadElementType.CLAIM,
            position=1,
            text="Below-market insider transfer warranting review of board minutes.",
            handoff_ready=True,
        )
        claim.supported_by.add(fact)
```

> `confirmed_finding` and `deed_doc` are placeholders for the command's actual locals — use the existing confirmed finding and one of its already-cited demo documents (same case, so the citation guard holds). Do **not** delete the finding's `narrative` assignment.

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_seed_demo_elements --keepdb --noinput`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
cd backend && ruff check . && ruff format --check .
git add backend/investigations/management/commands/seed_demo.py backend/investigations/tests/test_seed_demo_elements.py
git commit -m "feat(threads): seed_demo builds backed claim elements, retains legacy narrative"
```

---

### Task 10: Full-suite regression sweep (prove nothing changed) + PR

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend suite (CI-equivalent)**

Run: `docker exec catalyst_backend python manage.py test investigations --exclude-tag=eval --keepdb --noinput`
Expected: **all green, with no edits to existing tests.** Because 4A-additive does not touch the tie-off gate or `referral_grade.py`, `test_tie_off_gate`, `test_credibility`, `test_referral_pdf`, and the Case Map tests should pass unchanged. If any existing test fails, that means this slice accidentally changed behavior — **find and remove that behavior change** (do not edit the existing test; the whole point of 4A-additive is that those tests keep passing as-is).

- [ ] **Step 2: Confirm migrations are clean**

Run: `docker exec catalyst_backend python manage.py makemigrations --check --dry-run`
Expected: "No changes detected" (the models match the committed migrations).

- [ ] **Step 3: Push + open the 4A-additive PR (confirm with Tyler first)**

Per CLAUDE.md, pushing + opening the PR is an outward-facing step — confirm before running:

```bash
git push -u origin feature/case-map-phase-4-thread-builder
gh pr create --fill --base main
```

PR description must state: **this slice is additive and changes no existing behavior; the gate flip + UI ship in 4B.** Validate on the Railway PR preview (exercise the new `/elements/` endpoints + confirm the existing tie-off UI still works) before merge.

---

## Self-Review

**Spec coverage (4A-additive scope):**
- §3 models (`ThreadElement`, `ThreadElementCitation`, `supported_by`, `is_legacy`) → Task 1. ✅
- §3 completeness helpers (unwired) → Task 2. ✅
- §3 invariants: handoff_ready rejection + element_type change + citation-FACT-only + supported_by CLAIM/INFERENCE + no self-support → Task 4; delete cleanup → Task 5. ✅
- §3 same-case guard (serializer authoritative + `clean()` defense) → Task 1 (`clean`) + Task 4 (serializer). ✅
- §4 document_links sync (ensure/reap/legacy) → Task 3, exercised in Task 5; `add_document_ids`→legacy → Task 7. ✅
- §6 migration (idempotent narrative→NOTE, flag legacy, retain narrative) → Task 8; seed (elements + retained narrative) → Task 9. ✅
- §7 API (CRUD + reorder + citations) → Task 5; elements embed → Task 6. ✅
- §7 "regression sweep proving no existing behavior changed" → Task 10. ✅
- **Deliberately NOT here (4B):** Tier-1/Tier-2 gate wiring, parity test, gate/credibility fixture rework — they ship with the `ThreadBuilder` UI. The helpers they need exist + are tested (Task 2). ✅

**Placeholder scan:** No "TBD/TODO". The two adapt-to-local-names points (`seed_demo` locals in Task 9; the `add_document_ids` get_or_create shape in Task 7) are flagged with the exact target behavior and a test that proves it — not placeholders.

**Type consistency:** `serialize_element` shape (Task 4) consumed by Task 6; `is_complete_fact` (Task 2) consumed by Task 4's `handoff_ready` validation; `ensure_document_link`/`reap_document_link_if_orphaned` (Task 3) consumed by Tasks 4/5; `_phase4_narrative_backfill.forwards(apps, schema_editor)` signature consistent between the helper (Task 8 Step 3), the migration call, and the test (Task 8 Step 1). `FindingDocument.is_legacy` (Task 1) consumed by Tasks 3/7/8. ✅
