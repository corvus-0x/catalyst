# Case Map Phase 4A — Thread Elements Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured, individually-cited evidentiary elements (Fact / Inference / Question / Claim / Note) to threads, and make the taxonomy load-bearing by strengthening the referral-grade gate into two tiers.

**Architecture:** Three new tables (`ThreadElement`, `ThreadElementCitation`, a self-M2M `supported_by`) plus a `FindingDocument.is_legacy` flag. `ThreadElementCitation` becomes the source of truth for citations; `Finding.document_links` (`FindingDocument`) is kept as a synced **compatibility citation index** so the `/case-map/` builder, credibility counts, and the current PDF keep working. Completeness predicates gate two tiers: CONFIRMED requires a complete cited Fact; referral-grade additionally requires a handoff-ready Claim backed by a complete Fact.

**Tech Stack:** Django 5 + PostgreSQL (ArrayField), hand-written serializer classes (NOT Django REST Framework), function-based views with `@require_http_methods`, `unittest`-style `TestCase`. Tests run inside the Docker stack.

## Global Constraints

- **Ruff** line length **100 chars max**; double quotes; spaces; LF. `views.py` is NOT E501-exempt — break long strings with parenthesized f-strings. Run `cd backend && ruff check . && ruff format .` before every commit (pre-commit hooks are dormant in this environment).
- **Serializers are hand-written classes** with `is_valid() -> bool`, `.errors`, `.data`, `.save()` — follow `FindingUpdateSerializer` / `FindingIntakeSerializer`. Do NOT introduce DRF.
- **Views** are function-based, decorated `@require_http_methods([...])`, case-scoped via `get_object_or_404(Case, pk=pk)`, parse bodies with `_parse_json_body(request)`, return `JsonResponse`. Mutations log via `AuditLog.log(...)`. **Never UPDATE/DELETE `AuditLog`.**
- **`ThreadElementCitation` is the source of truth for citations.** `Finding.document_links` is the denormalized/export **compatibility citation index** + legacy-preservation layer — never the place to author citations.
- **Backend test command (CI-equivalent):**
  `docker exec catalyst_backend python manage.py test investigations.tests.<module> --keepdb --noinput`
  (Full suite: `... test investigations --exclude-tag=eval --keepdb --noinput`.)
- **Gate predicate lives once** in `referral_grade.py` (`is_referral_grade` / `referral_grade_qs`) and must stay equivalent across the instance + queryset forms (parity test, Task 9).
- **Migrations:** the current latest migration is `0031_ai_traceability_fields` — new migrations depend on the latest at authoring time (run `python manage.py makemigrations` to get correct dependencies; do not hand-number).

---

### Task 1: Models — `ThreadElement`, `ThreadElementCitation`, `supported_by`, `FindingDocument.is_legacy`

**Files:**
- Modify: `backend/investigations/models.py` (add after `FindingDocument`, ~line 1385)
- Create: `backend/investigations/migrations/00XX_thread_elements.py` (via `makemigrations`)
- Test: `backend/investigations/tests/test_thread_element_model.py`

**Interfaces:**
- Produces: `ThreadElement` (`finding`, `element_type`, `text`, `position`, `handoff_ready`, `supported_by` M2M, `created_at`, `updated_at`); `ThreadElementType` TextChoices (`FACT`/`INFERENCE`/`QUESTION`/`CLAIM`/`NOTE`); `ThreadElementCitation` (`element`, `document`, `page_reference`, `context_note`); `FindingDocument.is_legacy: bool`.

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
        # Same-case guard — a thread may only cite documents from its own case.
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
            "True for citations preserved from before Phase 4 (narrative era). "
            "Legacy rows are never reaped by element-citation churn."
        ),
    )
```

Ensure `ValidationError` is imported at the top of `models.py`:

```python
from django.core.exceptions import ValidationError
```

(If already imported, skip. Check the existing import block first.)

- [ ] **Step 4: Generate the migration**

Run: `docker exec catalyst_backend python manage.py makemigrations investigations`
Expected: a new migration creating `ThreadElement`, `ThreadElementCitation`, the M2M, and adding `FindingDocument.is_legacy`.

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

### Task 2: Completeness predicates

**Files:**
- Create: `backend/investigations/thread_elements.py`
- Test: `backend/investigations/tests/test_thread_completeness.py`

**Interfaces:**
- Consumes: `ThreadElement`, `ThreadElementType` (Task 1).
- Produces: `is_complete_fact(element) -> bool`; `is_complete_claim(element) -> bool`; `finding_has_complete_fact(finding) -> bool`; `finding_has_handoff_ready_backed_claim(finding) -> bool`.

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
        self.assertFalse(is_complete_claim(claim))  # no backing yet
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
"""Completeness predicates for thread elements — used by both gate tiers.

Drafting is permissive; these predicates fire only at the gates (tie-off and
referral-grade evaluation). Keep this the single definition of "complete".
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
    """Tier-1 (CONFIRMED) ingredient: at least one complete cited FACT."""
    return any(
        is_complete_fact(e)
        for e in finding.elements.filter(element_type=ThreadElementType.FACT)
    )


def finding_has_handoff_ready_backed_claim(finding) -> bool:
    """Tier-2 (referral-grade) ingredient: a handoff_ready CLAIM backed by a complete FACT."""
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
git commit -m "feat(threads): completeness predicates for fact/claim"
```

---

### Task 3: `document_links` sync helper

**Files:**
- Modify: `backend/investigations/thread_elements.py`
- Test: `backend/investigations/tests/test_document_links_sync.py`

**Interfaces:**
- Consumes: `ThreadElement`, `ThreadElementCitation`, `FindingDocument` (Task 1).
- Produces: `ensure_document_link(finding, document)`; `reap_document_link_if_orphaned(finding, document)`. Both keep `Finding.document_links` as the synced compatibility index.

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

### Task 4: Element + citation serializers

**Files:**
- Modify: `backend/investigations/serializers.py` (add a "Thread elements" section after the Findings section, ~line 1140)
- Test: `backend/investigations/tests/test_thread_element_serializers.py`

**Interfaces:**
- Consumes: `ThreadElement`, `ThreadElementType`, `ThreadElementCitation` (Task 1); `is_complete_claim` (Task 2); `ensure_document_link` (Task 3).
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
        claim = ThreadElement.objects.create(
            finding=self.f, element_type=ThreadElementType.CLAIM, position=0, text="c"
        )
        s = ThreadElementUpdateSerializer(data={"handoff_ready": True}, instance=claim)
        self.assertFalse(s.is_valid())
        self.assertIn("handoff_ready", s.errors)

    def test_handoff_ready_rejected_on_non_claim(self):
        fact = ThreadElement.objects.create(
            finding=self.f, element_type=ThreadElementType.FACT, position=0, text="x"
        )
        s = ThreadElementUpdateSerializer(data={"handoff_ready": True}, instance=fact)
        self.assertFalse(s.is_valid())

    def test_supported_by_ids_must_be_facts(self):
        fact = ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.FACT, position=0)
        fact.citations.create(document=_doc(self.case))
        claim = ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.CLAIM, position=1, text="c")
        s = ThreadElementUpdateSerializer(data={"supported_by_ids": [str(fact.id)]}, instance=claim)
        self.assertTrue(s.is_valid(), s.errors)
        s.save()
        self.assertEqual(list(claim.supported_by.all()), [fact])

    def test_citation_same_case_enforced(self):
        el = ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.FACT, position=0)
        other = _doc(Case.objects.create(name="O"), "z")
        s = ThreadElementCitationSerializer(data={"document_id": str(other.id)}, element=el)
        self.assertFalse(s.is_valid())
        self.assertIn("document_id", s.errors)

    def test_serialize_shape(self):
        el = ThreadElement.objects.create(
            finding=self.f, element_type=ThreadElementType.FACT, position=0, text="x"
        )
        el.citations.create(document=_doc(self.case))
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

In `backend/investigations/serializers.py`, add the imports near the top (with the other model imports):

```python
from .models import ThreadElement, ThreadElementCitation, ThreadElementType, Document
from .thread_elements import is_complete_fact, is_complete_claim, ensure_document_link
```

(Merge into the existing `from .models import ...` block rather than duplicating; add `Document` only if not already imported.)

Add a new section after the Findings serializers (~line 1140):

```python
# ---------------------------------------------------------------------------
# Thread elements
# ---------------------------------------------------------------------------

_VALID_ELEMENT_TYPES = {c.value for c in ThreadElementType}


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

    Conservative: handoff_ready may flip true only on a complete CLAIM; an
    element_type change that would invalidate citations/backing is rejected.
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

        # element_type change: conservative — reject if it would orphan citations/backing.
        new_type = self.instance.element_type
        if "element_type" in self.initial_data:
            new_type = (self.initial_data["element_type"] or "").strip()
            if new_type not in _VALID_ELEMENT_TYPES:
                self._errors = {"element_type": ["Invalid element_type."]}
                return False
            if new_type != ThreadElementType.FACT and self.instance.citations.exists():
                self._errors = {"element_type": ["Change a cited FACT only after removing its citations."]}
                return False
            if new_type not in (ThreadElementType.CLAIM, ThreadElementType.INFERENCE) and \
                    self.instance.supported_by.exists():
                self._errors = {"element_type": ["Remove supporting facts before changing this type."]}
                return False
            self.validated_data["element_type"] = new_type

        if "supported_by_ids" in self.initial_data:
            ids = self.initial_data["supported_by_ids"] or []
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
                # Evaluate completeness against the POST-update backing if provided.
                if new_type != ThreadElementType.CLAIM:
                    self._errors = {"handoff_ready": ["Only a CLAIM can be handoff-ready."]}
                    return False
                backing = self._supported if self._supported is not None else list(
                    self.instance.supported_by.all()
                )
                if not (self.validated_data.get("text", self.instance.text) or "").strip() or \
                        not any(is_complete_fact(f) for f in backing):
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
    """POST a citation onto an element; enforces the same-case guard + syncs document_links."""

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
Expected: PASS (7 tests).

- [ ] **Step 5: Lint + commit**

```bash
cd backend && ruff check . && ruff format --check .
git add backend/investigations/serializers.py backend/investigations/tests/test_thread_element_serializers.py
git commit -m "feat(threads): element + citation serializers (validation, same-case, handoff gate)"
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
import json
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
        fact.citations.create(document=_doc(self.case))
        FindingDocument.objects.create(finding=self.f, document=Document.objects.first())
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

In `backend/investigations/views.py`, add imports to the serializers import block (~line 56):

```python
    ThreadElementCreateSerializer,
    ThreadElementUpdateSerializer,
    ThreadElementCitationSerializer,
    serialize_element,
```

And the helper import near `serialize_finding` (~line 65) / models:

```python
from .thread_elements import reap_document_link_if_orphaned
from .models import ThreadElement, ThreadElementCitation
```

(Merge into existing model import block.) Then add after `api_case_finding_detail` (~line 3496):

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
        # Cleanup order: citations cascade; clear backing refs; reap orphaned links.
        docs = list(element.citations.values_list("document_id", flat=True))
        element.supports_elements.clear()  # remove from others' supported_by
        element.delete()
        for doc_id in docs:
            reap_document_link_if_orphaned(finding, _document_by_id(doc_id))
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
    ordered_ids = payload.get("ordered_ids", [])
    existing = set(str(i) for i in finding.elements.values_list("id", flat=True))
    if set(str(i) for i in ordered_ids) != existing:
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


def _document_by_id(doc_id):
    from .models import Document
    return Document.objects.get(pk=doc_id)
```

- [ ] **Step 4: Register the URLs**

In `backend/investigations/urls.py`, after the `api_case_finding_detail` path (~line 162), add:

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

> **Ordering note:** the `reorder/` path is registered before the `<uuid:element_id>/` path so the literal segment is matched first. (UUID converters won't match `reorder`, but explicit ordering keeps intent clear.)

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

In `serialize_finding` (serializers.py, before the closing `}` of the returned dict, after `document_links`), add:

```python
        "elements": [serialize_element(e) for e in finding.elements.all()],
```

In `views.py`, extend the two prefetch sites (`:3433` and `:3468`) to avoid N+1:

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

### Task 7: Tier-1 gate — CONFIRMED requires a complete cited FACT (drop narrative)

**Files:**
- Modify: `backend/investigations/serializers.py` (`FindingUpdateSerializer` tie-off block, ~line 1061-1073)
- Modify: `backend/investigations/tests/test_tie_off_gate.py` (update narrative-based cases)
- Test: `backend/investigations/tests/test_tie_off_gate_elements.py`

**Interfaces:**
- Consumes: `finding_has_complete_fact` (Task 2).
- Produces: CONFIRMED gate `unmet` codes now `{"fact", "evidence_weight", "overreach"}` (no `"narrative"`, no bare `"citation"` — a complete FACT subsumes citation).

- [ ] **Step 1: Write the failing test**

Create `backend/investigations/tests/test_tie_off_gate_elements.py`:

```python
from django.test import TestCase

from investigations.models import (
    Case, Document, Finding, FindingStatus, EvidenceWeight,
    ThreadElement, ThreadElementType,
)
from investigations.serializers import FindingUpdateSerializer


def _doc(case, s="a"):
    return Document.objects.create(
        case=case, filename=f"{s}.pdf", file_path=f"{s}.pdf", sha256_hash=s * 64, file_size=1
    )


class TieOffGateElementTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")

    def _finding(self):
        return Finding.objects.create(case=self.case, rule_id="MANUAL", title="T",
                                      status=FindingStatus.NEW)

    def test_confirm_blocked_without_complete_fact(self):
        f = self._finding()
        s = FindingUpdateSerializer(
            data={"status": "CONFIRMED", "evidence_weight": "DOCUMENTED", "overreach_reviewed": True},
            instance=f,
        )
        self.assertFalse(s.is_valid())
        self.assertIn("fact", s.errors["gate"]["unmet"])

    def test_confirm_allowed_with_complete_fact(self):
        f = self._finding()
        fact = ThreadElement.objects.create(finding=f, element_type=ThreadElementType.FACT,
                                            position=0, text="a fact")
        fact.citations.create(document=_doc(self.case))
        s = FindingUpdateSerializer(
            data={"status": "CONFIRMED", "evidence_weight": "DOCUMENTED", "overreach_reviewed": True},
            instance=f,
        )
        self.assertTrue(s.is_valid(), s.errors)

    def test_confirm_unmet_no_longer_lists_narrative(self):
        f = self._finding()
        s = FindingUpdateSerializer(data={"status": "CONFIRMED"}, instance=f)
        self.assertFalse(s.is_valid())
        self.assertNotIn("narrative", s.errors["gate"]["unmet"])
        self.assertEqual(sorted(s.errors["gate"]["unmet"]), ["evidence_weight", "fact", "overreach"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_tie_off_gate_elements --keepdb --noinput`
Expected: FAIL — gate still emits `narrative`/`citation`, not `fact`.

- [ ] **Step 3: Rewrite the Tier-1 gate block**

In `FindingUpdateSerializer.is_valid()` (serializers.py:1061-1073), replace the `unmet` block with:

```python
            from .thread_elements import finding_has_complete_fact

            unmet = []
            if not finding_has_complete_fact(self.instance):
                unmet.append("fact")
            if post_weight not in (EvidenceWeight.DOCUMENTED, EvidenceWeight.TRACED):
                unmet.append("evidence_weight")
            if not post_overreach:
                unmet.append("overreach")

            if unmet:
                self._errors = {"gate": {"unmet": unmet}}
                return False
```

Delete the now-unused `post_docs`/`post_narrative` computations in that block (lines ~1046-1056 and the `citation`/`narrative` appends). Keep `post_weight`/`post_overreach`.

- [ ] **Step 4: Update the existing narrative-based gate tests**

In `backend/investigations/tests/test_tie_off_gate.py`:
- `test_confirm_with_nothing_lists_all_unmet`: change expected to `["evidence_weight", "fact", "overreach"]`.
- `test_confirm_with_all_conditions_in_one_payload`: replace the `narrative` + `add_document_ids` setup with a complete FACT element before the PATCH:

```python
    def test_confirm_with_all_conditions_in_one_payload(self):
        f = self._new_finding(status=FindingStatus.NEW)
        doc = _document(self.case)
        fact = f.elements.create(element_type="FACT", position=0, text="a fact")
        fact.citations.create(document=doc)
        s = FindingUpdateSerializer(
            data={"status": "CONFIRMED", "evidence_weight": "DOCUMENTED", "overreach_reviewed": True},
            instance=f,
        )
        self.assertTrue(s.is_valid(), s.errors)
```

- `test_confirm_emits_signal_confirmed_audit_row` (and any other API-level confirm): add a complete FACT before the PATCH and drop `narrative` from the payload.

- [ ] **Step 5: Run tests to verify they pass**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_tie_off_gate investigations.tests.test_tie_off_gate_elements --keepdb --noinput`
Expected: PASS.

- [ ] **Step 6: Lint + commit**

```bash
cd backend && ruff check . && ruff format --check .
git add backend/investigations/serializers.py backend/investigations/tests/test_tie_off_gate.py backend/investigations/tests/test_tie_off_gate_elements.py
git commit -m "feat(threads): Tier-1 gate requires a complete cited FACT (drops narrative check)"
```

---

### Task 8: Tier-2 gate — referral-grade requires a handoff-ready backed CLAIM

**Files:**
- Modify: `backend/investigations/referral_grade.py`
- Test: `backend/investigations/tests/test_referral_grade_elements.py`

**Interfaces:**
- Consumes: `finding_has_handoff_ready_backed_claim` (Task 2); `ThreadElement`, `ThreadElementType`.
- Produces: strengthened `is_referral_grade(finding)` + `referral_grade_qs(case)` (both add the handoff-ready-backed-claim condition).

- [ ] **Step 1: Write the failing test**

Create `backend/investigations/tests/test_referral_grade_elements.py`:

```python
from django.test import TestCase

from investigations.models import (
    Case, Document, Finding, FindingDocument, FindingStatus, EvidenceWeight,
    ThreadElement, ThreadElementType,
)
from investigations.referral_grade import is_referral_grade, referral_grade_qs


def _doc(case, s="a"):
    return Document.objects.create(
        case=case, filename=f"{s}.pdf", file_path=f"{s}.pdf", sha256_hash=s * 64, file_size=1
    )


class ReferralGradeElementTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")

    def _confirmed_base(self):
        # CONFIRMED + weight + overreach + a cited finding-level doc, but no claim yet.
        f = Finding.objects.create(
            case=self.case, rule_id="MANUAL", title="T",
            status=FindingStatus.CONFIRMED, evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=True,
        )
        doc = _doc(self.case)
        FindingDocument.objects.create(finding=f, document=doc)
        fact = f.elements.create(element_type=ThreadElementType.FACT, position=0, text="a fact")
        fact.citations.create(document=doc)
        return f, fact

    def test_confirmed_without_claim_is_not_referral_grade(self):
        f, _ = self._confirmed_base()
        self.assertFalse(is_referral_grade(f))
        self.assertNotIn(f, referral_grade_qs(self.case))

    def test_handoff_ready_backed_claim_makes_referral_grade(self):
        f, fact = self._confirmed_base()
        claim = f.elements.create(element_type=ThreadElementType.CLAIM, position=1,
                                  text="claim", handoff_ready=True)
        claim.supported_by.add(fact)
        self.assertTrue(is_referral_grade(f))
        self.assertIn(f, referral_grade_qs(self.case))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_referral_grade_elements --keepdb --noinput`
Expected: FAIL — `test_confirmed_without_claim_is_not_referral_grade` fails (old predicate returns True).

- [ ] **Step 3: Strengthen both predicate forms**

Rewrite `backend/investigations/referral_grade.py`:

```python
"""Single source of truth for the referral-grade predicate.

An Angle (Finding) is "referral-grade" iff it is CONFIRMED, has evidence weight
DOCUMENTED or TRACED, `overreach_reviewed` is True, has at least one cited
document, AND has at least one handoff_ready CLAIM element backed by a complete
cited FACT. Used by readiness, credibility counts, and the referral PDF filter
so the definition never drifts.
"""

from django.db.models import Count, Exists, OuterRef

from .models import (
    EvidenceWeight, Finding, FindingStatus, ThreadElement, ThreadElementType,
    ThreadElementCitation,
)
from .thread_elements import finding_has_handoff_ready_backed_claim

REFERRAL_WEIGHTS = [EvidenceWeight.DOCUMENTED, EvidenceWeight.TRACED]


def referral_grade_qs(case):
    """Queryset of referral-grade Angles for a case (a single SQL statement)."""
    # A complete FACT = a FACT element with >=1 citation.
    complete_fact = ThreadElement.objects.filter(
        finding=OuterRef("supported_claim__finding"),
    )
    # handoff_ready CLAIM backed by a cited FACT, scoped to the outer finding.
    cited_fact = ThreadElementCitation.objects.filter(element=OuterRef("pk"))
    backing_fact = ThreadElement.objects.filter(
        element_type=ThreadElementType.FACT,
        supports_elements=OuterRef("pk"),
    ).filter(Exists(cited_fact))
    handoff_claim = ThreadElement.objects.filter(
        finding=OuterRef("pk"),
        element_type=ThreadElementType.CLAIM,
        handoff_ready=True,
    ).filter(Exists(backing_fact))

    return (
        Finding.objects.filter(
            case=case,
            status=FindingStatus.CONFIRMED,
            evidence_weight__in=REFERRAL_WEIGHTS,
            overreach_reviewed=True,
        )
        .annotate(_citation_count=Count("document_links"))
        .filter(_citation_count__gt=0)
        .filter(Exists(handoff_claim))
    )


def is_referral_grade(finding) -> bool:
    """True iff a single Finding instance meets every referral-grade condition."""
    return bool(
        finding.status == FindingStatus.CONFIRMED
        and finding.evidence_weight in REFERRAL_WEIGHTS
        and finding.overreach_reviewed
        and finding.document_links.exists()
        and finding_has_handoff_ready_backed_claim(finding)
    )
```

> If the `OuterRef` chaining in `referral_grade_qs` proves awkward, the equivalent
> correct form is two nested `Exists()` subqueries: outer = handoff_ready CLAIM on
> the finding; inner = a FACT in `claim.supported_by` that has a citation. The
> parity test (Task 9) is the gate that proves the queryset matches `is_referral_grade`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_referral_grade_elements --keepdb --noinput`
Expected: PASS (2 tests).

- [ ] **Step 5: Lint + commit**

```bash
cd backend && ruff check . && ruff format --check .
git add backend/investigations/referral_grade.py backend/investigations/tests/test_referral_grade_elements.py
git commit -m "feat(threads): Tier-2 referral-grade requires handoff-ready backed claim"
```

---

### Task 9: Parity test (instance ⇔ queryset)

**Files:**
- Test: `backend/investigations/tests/test_referral_grade_parity.py`

**Interfaces:**
- Consumes: `is_referral_grade`, `referral_grade_qs` (Task 8).

- [ ] **Step 1: Write the parity test**

Create `backend/investigations/tests/test_referral_grade_parity.py`:

```python
from django.test import TestCase

from investigations.models import (
    Case, Document, Finding, FindingDocument, FindingStatus, EvidenceWeight,
    ThreadElementType,
)
from investigations.referral_grade import is_referral_grade, referral_grade_qs


def _doc(case, s="a"):
    return Document.objects.create(
        case=case, filename=f"{s}.pdf", file_path=f"{s}.pdf", sha256_hash=s * 64, file_size=1
    )


class ReferralGradeParityTests(TestCase):
    """The instance predicate and the queryset must agree across a fixture matrix."""

    def setUp(self):
        self.case = Case.objects.create(name="C")

    def _mk(self, *, status, weight, overreach, cite_doc, with_claim):
        f = Finding.objects.create(
            case=self.case, rule_id="MANUAL", title="T",
            status=status, evidence_weight=weight, overreach_reviewed=overreach,
        )
        if cite_doc:
            doc = _doc(self.case, str(Finding.objects.count()))
            FindingDocument.objects.create(finding=f, document=doc)
            fact = f.elements.create(element_type=ThreadElementType.FACT, position=0, text="x")
            fact.citations.create(document=doc)
            if with_claim:
                claim = f.elements.create(
                    element_type=ThreadElementType.CLAIM, position=1, text="c", handoff_ready=True
                )
                claim.supported_by.add(fact)
        return f

    def test_parity_across_matrix(self):
        combos = [
            dict(status=FindingStatus.CONFIRMED, weight=EvidenceWeight.DOCUMENTED, overreach=True, cite_doc=True, with_claim=True),
            dict(status=FindingStatus.CONFIRMED, weight=EvidenceWeight.DOCUMENTED, overreach=True, cite_doc=True, with_claim=False),
            dict(status=FindingStatus.CONFIRMED, weight=EvidenceWeight.SPECULATIVE, overreach=True, cite_doc=True, with_claim=True),
            dict(status=FindingStatus.CONFIRMED, weight=EvidenceWeight.TRACED, overreach=False, cite_doc=True, with_claim=True),
            dict(status=FindingStatus.NEW, weight=EvidenceWeight.TRACED, overreach=True, cite_doc=True, with_claim=True),
            dict(status=FindingStatus.CONFIRMED, weight=EvidenceWeight.TRACED, overreach=True, cite_doc=False, with_claim=False),
        ]
        findings = [self._mk(**c) for c in combos]
        qs_ids = set(referral_grade_qs(self.case).values_list("id", flat=True))
        for f in findings:
            self.assertEqual(
                is_referral_grade(f), f.id in qs_ids,
                msg=f"mismatch for finding {f.id}",
            )
        # exactly the first combo qualifies
        self.assertEqual(len(qs_ids), 1)
        self.assertIn(findings[0].id, qs_ids)
```

- [ ] **Step 2: Run the parity test**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_referral_grade_parity --keepdb --noinput`
Expected: PASS. If it fails, the queryset (Task 8 Step 3) diverges from the instance predicate — fix the `Exists()` subqueries until parity holds. **Do not weaken the test.**

- [ ] **Step 3: Commit**

```bash
cd backend && ruff check . && ruff format --check .
git add backend/investigations/tests/test_referral_grade_parity.py
git commit -m "test(threads): referral-grade instance/queryset parity matrix"
```

---

### Task 10: Data migration — narrative → NOTE, flag legacy docs

**Files:**
- Create: `backend/investigations/migrations/00YY_migrate_narrative_to_note.py` (via `makemigrations --empty`)
- Test: `backend/investigations/tests/test_narrative_migration.py`

**Interfaces:**
- Consumes: models from Task 1.
- Produces: every Finding with non-empty `narrative` gains one `NOTE` element at position 0; every pre-existing `FindingDocument` flagged `is_legacy=True`.

- [ ] **Step 1: Write the failing test**

Create `backend/investigations/tests/test_narrative_migration.py`. This test exercises the migration's data functions directly (importing the forwards function), so it does not depend on migration replay:

```python
from django.test import TestCase

from investigations.models import (
    Case, Document, Finding, FindingDocument, ThreadElementType,
)


def _doc(case, s="a"):
    return Document.objects.create(
        case=case, filename=f"{s}.pdf", file_path=f"{s}.pdf", sha256_hash=s * 64, file_size=1
    )


class NarrativeMigrationTests(TestCase):
    def test_forwards_converts_narrative_and_flags_docs(self):
        # Import the migration module's forwards helper.
        from investigations.migrations import _phase4_narrative_backfill as mig
        from django.apps import apps

        case = Case.objects.create(name="C")
        f = Finding.objects.create(case=case, rule_id="MANUAL", title="T", narrative="legacy text")
        FindingDocument.objects.create(finding=f, document=_doc(case))

        mig.forwards(apps, schema_editor=None)

        note = f.elements.get(element_type=ThreadElementType.NOTE)
        self.assertEqual(note.text, "legacy text")
        self.assertEqual(note.position, 0)
        self.assertTrue(FindingDocument.objects.filter(finding=f, is_legacy=True).exists())
```

> The migration delegates its forward logic to a small importable helper module
> `investigations/migrations/_phase4_narrative_backfill.py` so it is unit-testable
> without replaying migrations. The migration file just calls `forwards`.

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_narrative_migration --keepdb --noinput`
Expected: FAIL — `ModuleNotFoundError: investigations.migrations._phase4_narrative_backfill`.

- [ ] **Step 3: Write the backfill helper + the migration**

Create `backend/investigations/migrations/_phase4_narrative_backfill.py`:

```python
"""Importable forward logic for the Phase 4 narrative→NOTE data migration.

Kept separate from the migration file so it is unit-testable without a
migration replay. Uses the live ORM models (safe: this only runs forward on
fields that exist by the time it runs).
"""


def forwards(apps, schema_editor):
    Finding = apps.get_model("investigations", "Finding")
    ThreadElement = apps.get_model("investigations", "ThreadElement")
    FindingDocument = apps.get_model("investigations", "FindingDocument")

    # 1) Flag every existing citation as legacy (preserved, never reaped).
    FindingDocument.objects.update(is_legacy=True)

    # 2) Convert non-empty narrative into a single NOTE element at position 0.
    for finding in Finding.objects.exclude(narrative="").exclude(narrative__isnull=True):
        already = ThreadElement.objects.filter(finding=finding, position=0).exists()
        if already:
            continue
        ThreadElement.objects.create(
            finding=finding,
            element_type="NOTE",
            text=finding.narrative,
            position=0,
            handoff_ready=False,
        )
```

Generate an empty migration and wire it:

Run: `docker exec catalyst_backend python manage.py makemigrations investigations --empty -n migrate_narrative_to_note`

Edit the generated file to:

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
        ("investigations", "00XX_thread_elements"),  # the Task 1 migration name
    ]
    operations = [migrations.RunPython(forwards, backwards)]
```

> The test calls the helper with the live `apps` registry; the migration calls it with
> the historical registry. Both work because the helper only touches fields present
> after the Task 1 schema migration.

- [ ] **Step 4: Run tests + apply migrations**

Run: `docker exec catalyst_backend python manage.py migrate investigations --noinput`
Then: `docker exec catalyst_backend python manage.py test investigations.tests.test_narrative_migration --keepdb --noinput`
Expected: PASS.

- [ ] **Step 5: Add the "stays CONFIRMED but drops out of referral-grade" test**

Append to `backend/investigations/tests/test_narrative_migration.py`:

```python
    def test_confirmed_legacy_finding_stays_confirmed_but_not_referral_grade(self):
        from django.apps import apps
        from investigations.migrations import _phase4_narrative_backfill as mig
        from investigations.models import FindingStatus, EvidenceWeight
        from investigations.referral_grade import is_referral_grade

        case = Case.objects.create(name="C2")
        f = Finding.objects.create(
            case=case, rule_id="MANUAL", title="T", narrative="old proof",
            status=FindingStatus.CONFIRMED, evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=True,
        )
        FindingDocument.objects.create(finding=f, document=_doc(case, "x"))
        mig.forwards(apps, schema_editor=None)
        f.refresh_from_db()
        self.assertEqual(f.status, FindingStatus.CONFIRMED)   # status unchanged
        self.assertFalse(is_referral_grade(f))                # but no handoff-ready claim
```

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_narrative_migration --keepdb --noinput`
Expected: PASS (2 tests).

- [ ] **Step 6: Lint + commit**

```bash
cd backend && ruff check . && ruff format --check .
git add backend/investigations/migrations backend/investigations/tests/test_narrative_migration.py
git commit -m "feat(threads): data migration narrative->NOTE + flag legacy citations"
```

---

### Task 11: `seed_demo` builds real elements (demo stays referral-grade)

**Files:**
- Modify: `backend/investigations/management/commands/seed_demo.py`
- Test: `backend/investigations/tests/test_seed_demo_referral_grade.py`

**Interfaces:**
- Consumes: models (Task 1); `referral_grade_qs` (Task 8).
- Produces: at least one demo thread that is referral-grade under the strengthened gate (a complete FACT + a handoff_ready CLAIM backed by it).

- [ ] **Step 1: Write the failing test**

Create `backend/investigations/tests/test_seed_demo_referral_grade.py`:

```python
from django.core.management import call_command
from django.test import TestCase

from investigations.models import Case
from investigations.referral_grade import referral_grade_qs


class SeedDemoReferralGradeTests(TestCase):
    def test_seed_demo_has_a_referral_grade_thread(self):
        call_command("seed_demo")
        case = Case.objects.order_by("created_at").first()
        self.assertIsNotNone(case)
        self.assertGreaterEqual(
            referral_grade_qs(case).count(), 1,
            "seed_demo must produce at least one referral-grade thread under the Phase 4 gate",
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_seed_demo_referral_grade --keepdb --noinput`
Expected: FAIL — 0 referral-grade threads (demo confirmations have no handoff-ready claim).

- [ ] **Step 3: Add elements to the demo's strongest confirmed finding**

In `seed_demo.py`, locate where the demo's CONFIRMED finding is created (search for `CONFIRMED` / `overreach_reviewed`). After it is created and has a cited document, add real elements. Example (adapt variable names to the command's locals):

```python
        from investigations.models import ThreadElement, ThreadElementType

        # Phase 4: give the flagship confirmed thread structured, gated elements
        # so the demo case remains referral-grade under the strengthened gate.
        fact = ThreadElement.objects.create(
            finding=confirmed_finding,
            element_type=ThreadElementType.FACT,
            position=0,
            text="Org purchased 1420 Elm St for $410,000 on 2021-03-09.",
        )
        fact.citations.create(document=deed_doc, page_reference="p.2",
                              context_note="Recorded sale price.")
        claim = ThreadElement.objects.create(
            finding=confirmed_finding,
            element_type=ThreadElementType.CLAIM,
            position=1,
            text="Below-market insider transfer warranting review of board minutes.",
            handoff_ready=True,
        )
        claim.supported_by.add(fact)
```

> `confirmed_finding`, `deed_doc` are placeholders for the command's actual locals —
> use the existing confirmed finding and one of its already-cited demo documents so
> the same-case guard holds.

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_seed_demo_referral_grade --keepdb --noinput`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
cd backend && ruff check . && ruff format --check .
git add backend/investigations/management/commands/seed_demo.py backend/investigations/tests/test_seed_demo_referral_grade.py
git commit -m "feat(threads): seed_demo builds gated elements so demo stays referral-grade"
```

---

### Task 12: Full-suite regression sweep

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend suite (CI-equivalent)**

Run: `docker exec catalyst_backend python manage.py test investigations --exclude-tag=eval --keepdb --noinput`
Expected: all green. Likely fallout to fix in this task:
- `test_credibility.py` / Case Map tests asserting referral-grade counts on fixtures that lack handoff-ready claims → update those fixtures to add a complete FACT + handoff_ready CLAIM where the test intends a referral-grade thread, or assert the new (lower) count where it intends to show the gap.
- `test_referral_pdf.py` — if it asserts on `narrative`-derived output, it still reads the legacy field (4C rewrites it); only fix outright breakage (e.g. a fixture that relied on confirm-without-fact). Do **not** rewrite the PDF here — that is Phase 4C.
- Any other confirm-a-finding helper across the suite that relied on `narrative` → give it a complete FACT instead.

Fix each failure by adjusting the **test fixture** to the new gate (not by weakening production predicates).

- [ ] **Step 2: Commit the regression fixes**

```bash
cd backend && ruff check . && ruff format --check .
git add backend/investigations/tests
git commit -m "test(threads): align existing fixtures with the two-tier Phase 4 gate"
```

- [ ] **Step 3: Push + open the 4A PR (confirm with Tyler first)**

Per CLAUDE.md, pushing + opening the PR is an outward-facing step — confirm before running:

```bash
git push -u origin feature/case-map-phase-4-thread-builder
gh pr create --fill --base main
```

Then validate on the Railway PR preview (live API-shape on the new endpoints) before merge.

---

## Self-Review

**Spec coverage:**
- §3 data model → Task 1. ✅
- §3 completeness predicates → Task 2. ✅
- §3 invariants (handoff_ready rejection, element_type change, delete cleanup) → Tasks 4 (serializer) + 5 (delete view). ✅
- §3 same-case guard (serializer + clean) → Task 1 (`clean`) + Task 4 (serializer). ✅
- §4 document_links synced union + reap/legacy → Task 3, exercised in Task 5. ✅
- §5 Tier-1 gate → Task 7; Tier-2 predicate (instance + queryset) → Task 8; parity → Task 9. ✅
- §6 migration (narrative→NOTE, is_legacy, stays-CONFIRMED/drops-referral-grade) → Task 10; seed_demo → Task 11. ✅
- §7 API surface (CRUD + reorder + citations) → Task 5; finding embeds elements → Task 6. ✅
- §7 backend test plan items → distributed across Tasks 1-11; full sweep → Task 12. ✅
- Out of scope here (correct): 4B frontend, 4C PDF rewrite — separate plans.

**Placeholder scan:** No "TBD/TODO". The two intentional adaptation points (`seed_demo` locals in Task 11; the `OuterRef` fallback note in Task 8) are flagged as adapt-to-local-names with the correct target behavior and a parity test that proves correctness — not placeholders.

**Type consistency:** `serialize_element` shape (Task 4) is consumed by Task 6; `finding_has_complete_fact`/`finding_has_handoff_ready_backed_claim` (Task 2) consumed by Tasks 7/8; `ensure_document_link`/`reap_document_link_if_orphaned` (Task 3) consumed by Tasks 4/5; gate `unmet` codes (`fact`/`evidence_weight`/`overreach`) consistent between Task 7 production and tests. ✅
