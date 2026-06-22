# Case Map Phase 4A-additive — Thread Assertions Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured evidentiary **assertions** (with per-assertion citations) to threads — a purely **additive** backend slice that changes **no existing behavior** and is safe to merge to `main` (the public demo) on its own.

**Architecture:** Two new tables (`ThreadElement` with types `ASSERTION`/`QUESTION`/`NOTE`; `ThreadElementCitation`) plus two new fields (`Finding.gate_version`, `FindingDocument.is_legacy`). An assertion's *role* (fact/analysis/claim) is **derived from evidence** (cited / uncited / `handoff_ready`), not stored. `ThreadElementCitation` is the source of truth for citations; `Finding.document_links` stays as a synced compatibility index. Completeness helpers + sync helpers are built **and unit-tested but UNWIRED** — the tie-off gate (`FindingUpdateSerializer`) and `referral_grade.py` are **not touched** here. The softened, `gate_version`-aware gate flip ships in **4B** (a later plan) atomically with the `ThreadBuilder` UI. There is **no `supported_by` backing graph** in v1 (deferred to Phase 5).

**Tech Stack:** Django 5 + PostgreSQL, hand-written serializer classes (NOT DRF), function-based views with `@require_http_methods`, `unittest`-style `TestCase`. Tests run inside the Docker stack.

## Global Constraints

- **Deployment-safety invariant:** this slice changes **no existing behavior**. Do NOT edit the `FindingUpdateSerializer` tie-off conditions or `referral_grade.py`. Build helpers; do not wire them (4B wires them). The full existing suite must stay green untouched (Task 10).
- **Ruff** 100-char lines; double quotes; spaces; LF. `views.py` is NOT E501-exempt. Run `cd backend && ruff check . && ruff format .` before every commit.
- **Serializers** are hand-written classes (`is_valid`/`errors`/`data`/`save`) — follow `FindingUpdateSerializer`. No DRF.
- **Views** function-based, `@require_http_methods`, case-scoped via `get_object_or_404(Case, pk=pk)`, bodies via `_parse_json_body(request)`, return `JsonResponse`; mutations log via `AuditLog.log(...)`. Never UPDATE/DELETE `AuditLog`.
- **`ThreadElementCitation` is the source of truth for citations.** `Finding.document_links` is the compatibility index; legacy `add_document_ids` rows are `is_legacy=True`.
- **Citations attach to `ASSERTION` only.** `handoff_ready` is meaningful only on `ASSERTION`. **No `supported_by` graph in v1.**
- **Model `clean()` is defense-in-depth only** (Django doesn't call it on `save()`; no DB constraint across the citation join). The serializer is authoritative.
- **Latest migration is `0036_finding_overreach_reviewed`** — depend on it (run `makemigrations`; don't hand-number).
- **Backend test command:** `docker exec catalyst_backend python manage.py test investigations.tests.<module> --keepdb --noinput` (full suite: `... test investigations --exclude-tag=eval --keepdb --noinput`).

---

### Task 1: Models — `ThreadElement`, `ThreadElementCitation`, `Finding.gate_version`, `FindingDocument.is_legacy`

**Files:**
- Modify: `backend/investigations/models.py` (add after `FindingDocument`, ~line 1385; add `GateVersion` + `gate_version` near `Finding`)
- Create: migration via `makemigrations` (verify dep `0036`)
- Test: `backend/investigations/tests/test_thread_element_model.py`

**Interfaces:**
- Produces: `ThreadElement` (`finding`, `element_type`, `text`, `position`, `handoff_ready`, timestamps); `ThreadElementType` (`ASSERTION`/`QUESTION`/`NOTE`); `ThreadElementCitation` (`element`, `document`, `page_reference`, `context_note`, `.clean()`); `GateVersion` (`LEGACY_NARRATIVE`/`ASSERTION_V1`); `Finding.gate_version` (default `ASSERTION_V1`); `FindingDocument.is_legacy`.

- [ ] **Step 1: Write the failing test**

Create `backend/investigations/tests/test_thread_element_model.py`:

```python
from django.db import IntegrityError
from django.core.exceptions import ValidationError
from django.test import TestCase

from investigations.models import (
    Case, Document, Finding, FindingDocument, GateVersion, ThreadElement,
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
        ThreadElement.objects.create(finding=self.finding, element_type=ThreadElementType.QUESTION, position=1)
        ThreadElement.objects.create(finding=self.finding, element_type=ThreadElementType.ASSERTION, position=0)
        types = list(self.finding.elements.values_list("element_type", flat=True))
        self.assertEqual(types, ["ASSERTION", "QUESTION"])

    def test_unique_position_per_finding(self):
        ThreadElement.objects.create(finding=self.finding, element_type=ThreadElementType.ASSERTION, position=0)
        with self.assertRaises(IntegrityError):
            ThreadElement.objects.create(finding=self.finding, element_type=ThreadElementType.QUESTION, position=0)

    def test_citation_same_case_clean_passes(self):
        el = ThreadElement.objects.create(finding=self.finding, element_type=ThreadElementType.ASSERTION, position=0)
        c = ThreadElementCitation(element=el, document=_doc(self.case))
        c.full_clean()
        c.save()
        self.assertEqual(el.citations.count(), 1)

    def test_citation_cross_case_clean_raises(self):
        el = ThreadElement.objects.create(finding=self.finding, element_type=ThreadElementType.ASSERTION, position=0)
        c = ThreadElementCitation(element=el, document=_doc(Case.objects.create(name="O"), "b"))
        with self.assertRaises(ValidationError):
            c.full_clean()

    def test_finding_gate_version_defaults_assertion_v1(self):
        self.assertEqual(self.finding.gate_version, GateVersion.ASSERTION_V1)

    def test_finding_document_is_legacy_defaults_false(self):
        fd = FindingDocument.objects.create(finding=self.finding, document=_doc(self.case, "c"))
        self.assertFalse(fd.is_legacy)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_thread_element_model --keepdb --noinput`
Expected: FAIL — `ImportError: cannot import name 'ThreadElement'`.

- [ ] **Step 3: Add the models**

In `models.py`, add a `GateVersion` choices class near `Finding` (before the `Finding` class, ~line 1225):

```python
class GateVersion(models.TextChoices):
    LEGACY_NARRATIVE = "LEGACY_NARRATIVE", "Legacy narrative"
    ASSERTION_V1 = "ASSERTION_V1", "Assertion v1"
```

Add the `gate_version` field to `Finding` (after `overreach_reviewed`, ~line 1295):

```python
    gate_version = models.CharField(
        max_length=20,
        choices=GateVersion.choices,
        default=GateVersion.ASSERTION_V1,
        help_text=(
            "Which referral-grade gate applies. LEGACY_NARRATIVE = grandfathered "
            "pre-Phase-4 threads (old predicate); ASSERTION_V1 = structured-assertion gate."
        ),
    )
```

Add `is_legacy` to `FindingDocument` (after `context_note`, ~line 1382):

```python
    is_legacy = models.BooleanField(
        default=False,
        help_text=(
            "True for compatibility-index rows not authored via ThreadElementCitation "
            "(pre-Phase-4 citations, or the legacy add_document_ids path). Never reaped."
        ),
    )
```

Add after the `FindingDocument` class (~line 1385):

```python
class ThreadElementType(models.TextChoices):
    ASSERTION = "ASSERTION", "Assertion"
    QUESTION = "QUESTION", "Unresolved question"
    NOTE = "NOTE", "Context note"  # migration/context only — never gates


class ThreadElement(UUIDPrimaryKeyModel):
    """One element of a thread. An ASSERTION's role is derived from evidence:
    cited -> fact, uncited -> analysis, handoff_ready -> claim. QUESTION = a gap;
    NOTE = subordinate context (e.g. migrated narrative)."""

    finding = models.ForeignKey(Finding, on_delete=models.CASCADE, related_name="elements")
    element_type = models.CharField(max_length=20, choices=ThreadElementType.choices)
    text = models.TextField(blank=True, default="")
    position = models.PositiveIntegerField(default=0)
    handoff_ready = models.BooleanField(
        default=False,
        help_text="The 'claim' flag — meaningful only on ASSERTION; gated so others cannot set it.",
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
    """Per-assertion evidence binding — the SOURCE OF TRUTH for citations."""

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

Ensure `from django.core.exceptions import ValidationError` is imported at the top of `models.py` (add only if missing).

- [ ] **Step 4: Generate the migration**

Run: `docker exec catalyst_backend python manage.py makemigrations investigations`
Expected: a migration (~`0037_thread_assertions`) creating both tables + `Finding.gate_version` + `FindingDocument.is_legacy`, with `dependencies = [("investigations", "0036_finding_overreach_reviewed")]`. Open it and confirm the dependency.

- [ ] **Step 5: Run tests to verify they pass**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_thread_element_model --keepdb --noinput`
Expected: PASS (6 tests).

- [ ] **Step 6: Lint + commit**

```bash
cd backend && ruff check . && ruff format --check .
git add backend/investigations/models.py backend/investigations/migrations backend/investigations/tests/test_thread_element_model.py
git commit -m "feat(threads): ThreadElement/ThreadElementCitation + Finding.gate_version + FindingDocument.is_legacy"
```

---

### Task 2: Completeness helpers (UNWIRED)

**Files:**
- Create: `backend/investigations/thread_elements.py`
- Test: `backend/investigations/tests/test_thread_completeness.py`

**Interfaces:**
- Consumes: `ThreadElement`, `ThreadElementType` (Task 1).
- Produces (built but NOT called by any gate in 4A — 4B wires them): `assertion_is_cited(element) -> bool`; `finding_has_cited_assertion(finding) -> bool`; `finding_has_handoff_ready_assertion(finding) -> bool`.

- [ ] **Step 1: Write the failing test**

Create `backend/investigations/tests/test_thread_completeness.py`:

```python
from django.test import TestCase

from investigations.models import Case, Document, Finding, ThreadElement, ThreadElementType
from investigations.thread_elements import (
    assertion_is_cited, finding_has_cited_assertion, finding_has_handoff_ready_assertion,
)


def _doc(case, s="a"):
    return Document.objects.create(
        case=case, filename=f"{s}.pdf", file_path=f"{s}.pdf", sha256_hash=s * 64, file_size=1
    )


class CompletenessTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.f = Finding.objects.create(case=self.case, rule_id="MANUAL", title="T")

    def _assertion(self, pos, cited=True, text="a", handoff=False):
        el = ThreadElement.objects.create(
            finding=self.f, element_type=ThreadElementType.ASSERTION,
            position=pos, text=text, handoff_ready=handoff,
        )
        if cited:
            el.citations.create(document=_doc(self.case, str(pos)))
        return el

    def test_assertion_is_cited(self):
        self.assertTrue(assertion_is_cited(self._assertion(0)))
        self.assertFalse(assertion_is_cited(self._assertion(1, cited=False)))
        self.assertFalse(assertion_is_cited(self._assertion(2, cited=True, text="")))

    def test_question_never_cited(self):
        q = ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.QUESTION, position=0, text="q?")
        self.assertFalse(assertion_is_cited(q))

    def test_finding_helpers(self):
        self.assertFalse(finding_has_cited_assertion(self.f))
        self.assertFalse(finding_has_handoff_ready_assertion(self.f))
        self._assertion(0)  # cited
        self._assertion(1, cited=False, handoff=True)  # handoff_ready (uncited)
        self.assertTrue(finding_has_cited_assertion(self.f))
        self.assertTrue(finding_has_handoff_ready_assertion(self.f))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_thread_completeness --keepdb --noinput`
Expected: FAIL — `ModuleNotFoundError: investigations.thread_elements`.

- [ ] **Step 3: Write the helpers**

Create `backend/investigations/thread_elements.py`:

```python
"""Thread-element predicates + document_links sync helpers.

NOTE: the predicates here are built in 4A-additive but are NOT wired into any
gate (FindingUpdateSerializer / referral_grade.py) until 4B. Single definition
of the softened gate ingredients.
"""

from .models import ThreadElementType


def assertion_is_cited(element) -> bool:
    """True iff element is an ASSERTION with text and at least one citation."""
    return (
        element.element_type == ThreadElementType.ASSERTION
        and bool((element.text or "").strip())
        and element.citations.exists()
    )


def finding_has_cited_assertion(finding) -> bool:
    """Tier-1 (CONFIRMED) ingredient — used by 4B: at least one cited assertion."""
    return any(
        assertion_is_cited(e)
        for e in finding.elements.filter(element_type=ThreadElementType.ASSERTION)
    )


def finding_has_handoff_ready_assertion(finding) -> bool:
    """Tier-2 (referral-grade) ingredient — used by 4B: a handoff_ready assertion with text."""
    return any(
        bool((e.text or "").strip())
        for e in finding.elements.filter(
            element_type=ThreadElementType.ASSERTION, handoff_ready=True
        )
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_thread_completeness --keepdb --noinput`
Expected: PASS (3 tests).

- [ ] **Step 5: Lint + commit**

```bash
cd backend && ruff check . && ruff format --check .
git add backend/investigations/thread_elements.py backend/investigations/tests/test_thread_completeness.py
git commit -m "feat(threads): assertion completeness helpers (unwired)"
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
        ensure_document_link(self.f, self.doc)
        links = FindingDocument.objects.filter(finding=self.f, document=self.doc)
        self.assertEqual(links.count(), 1)
        self.assertFalse(links.first().is_legacy)

    def test_reap_removes_when_no_element_cites(self):
        ensure_document_link(self.f, self.doc)
        reap_document_link_if_orphaned(self.f, self.doc)
        self.assertEqual(FindingDocument.objects.filter(finding=self.f, document=self.doc).count(), 0)

    def test_reap_keeps_when_another_element_still_cites(self):
        el = ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.ASSERTION, position=0)
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

### Task 4: Element + citation serializers (ASSERTION-only citations, derived role)

**Files:**
- Modify: `backend/investigations/serializers.py` (add a "Thread elements" section after the Findings section, ~line 1140)
- Test: `backend/investigations/tests/test_thread_element_serializers.py`

**Interfaces:**
- Consumes: `ThreadElement`, `ThreadElementType`, `ThreadElementCitation`, `Document` (Task 1); `ensure_document_link` (Task 3).
- Produces: `serialize_element(element) -> dict` (incl. derived `role`); `ThreadElementCreateSerializer(data, finding)`; `ThreadElementUpdateSerializer(data, instance)`; `ThreadElementCitationSerializer(data, element)`.

- [ ] **Step 1: Write the failing test**

Create `backend/investigations/tests/test_thread_element_serializers.py`:

```python
from django.test import TestCase

from investigations.models import Case, Document, Finding, ThreadElement, ThreadElementType
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

    def _assertion(self, pos=0, cited=False, handoff=False):
        el = ThreadElement.objects.create(
            finding=self.f, element_type=ThreadElementType.ASSERTION,
            position=pos, text="x", handoff_ready=handoff,
        )
        if cited:
            el.citations.create(document=_doc(self.case, str(pos)))
        return el

    def test_create_assigns_next_position(self):
        ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.ASSERTION, position=0)
        s = ThreadElementCreateSerializer(data={"element_type": "QUESTION", "text": "q"}, finding=self.f)
        self.assertTrue(s.is_valid(), s.errors)
        self.assertEqual(s.save().position, 1)

    def test_create_rejects_bad_type(self):
        s = ThreadElementCreateSerializer(data={"element_type": "FACT"}, finding=self.f)
        self.assertFalse(s.is_valid())
        self.assertIn("element_type", s.errors)

    def test_handoff_ready_rejected_on_non_assertion(self):
        q = ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.QUESTION, position=0, text="q")
        s = ThreadElementUpdateSerializer(data={"handoff_ready": True}, instance=q)
        self.assertFalse(s.is_valid())
        self.assertIn("handoff_ready", s.errors)

    def test_handoff_ready_allowed_on_assertion_with_text(self):
        a = self._assertion()
        s = ThreadElementUpdateSerializer(data={"handoff_ready": True}, instance=a)
        self.assertTrue(s.is_valid(), s.errors)
        s.save()
        a.refresh_from_db()
        self.assertTrue(a.handoff_ready)

    def test_type_change_off_assertion_blocked_while_cited(self):
        a = self._assertion(cited=True)
        s = ThreadElementUpdateSerializer(data={"element_type": "NOTE"}, instance=a)
        self.assertFalse(s.is_valid())
        self.assertIn("element_type", s.errors)

    def test_citation_rejected_on_non_assertion(self):
        q = ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.QUESTION, position=0, text="q")
        s = ThreadElementCitationSerializer(data={"document_id": str(_doc(self.case).id)}, element=q)
        self.assertFalse(s.is_valid())
        self.assertIn("element", s.errors)

    def test_citation_same_case_enforced(self):
        a = self._assertion()
        other = _doc(Case.objects.create(name="O"), "z")
        s = ThreadElementCitationSerializer(data={"document_id": str(other.id)}, element=a)
        self.assertFalse(s.is_valid())
        self.assertIn("document_id", s.errors)

    def test_serialize_role_derivation(self):
        self.assertEqual(serialize_element(self._assertion(0))["role"], "analysis")
        self.assertEqual(serialize_element(self._assertion(1, cited=True))["role"], "fact")
        self.assertEqual(serialize_element(self._assertion(2, handoff=True))["role"], "claim")
        q = ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.QUESTION, position=3, text="q")
        self.assertEqual(serialize_element(q)["role"], "question")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_thread_element_serializers --keepdb --noinput`
Expected: FAIL — `ImportError: cannot import name 'serialize_element'`.

- [ ] **Step 3: Write the serializers**

In `serializers.py`, merge into the existing model import block:

```python
from .models import ThreadElement, ThreadElementCitation, ThreadElementType, Document
from .thread_elements import ensure_document_link
```

(Add `Document` only if not already imported.) Add after the Findings serializers (~line 1140):

```python
# ---------------------------------------------------------------------------
# Thread elements (assertions)
# ---------------------------------------------------------------------------

_VALID_ELEMENT_TYPES = {c.value for c in ThreadElementType}


def _element_role(element) -> str:
    """Derive the display/export role from evidence + flags (not stored)."""
    if element.element_type != ThreadElementType.ASSERTION:
        return element.element_type.lower()  # "question" / "note"
    if element.handoff_ready:
        return "claim"
    if element.citations.exists():
        return "fact"
    return "analysis"


def serialize_element(element) -> dict:
    return {
        "id": str(element.pk),
        "finding_id": str(element.finding_id),
        "element_type": element.element_type,
        "role": _element_role(element),
        "text": element.text,
        "position": element.position,
        "handoff_ready": element.handoff_ready,
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
    """POST a new element. Drafting is permissive."""

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
        self.validated_data = {"element_type": etype, "text": self.initial_data.get("text", "")}
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
    """PATCH text / element_type / handoff_ready.

    Constraints: handoff_ready true only on an ASSERTION with text; a type change
    off ASSERTION is blocked while the element has citations or handoff_ready.
    """

    allowed_fields = {"text", "element_type", "handoff_ready"}

    def __init__(self, data=None, instance=None):
        self.initial_data = data or {}
        self.instance = instance
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
            if new_type != ThreadElementType.ASSERTION:
                if self.instance.citations.exists():
                    self._errors = {"element_type": ["Remove citations before changing this assertion's type."]}
                    return False
                if self.instance.handoff_ready and "handoff_ready" not in self.initial_data:
                    self._errors = {"element_type": ["Clear handoff_ready before changing type."]}
                    return False
            self.validated_data["element_type"] = new_type

        if "handoff_ready" in self.initial_data:
            want = self.initial_data["handoff_ready"]
            if not isinstance(want, bool):
                self._errors = {"handoff_ready": ["Must be a boolean."]}
                return False
            if want:
                has_text = bool((self.validated_data.get("text", self.instance.text) or "").strip())
                if new_type != ThreadElementType.ASSERTION or not has_text:
                    self._errors = {"handoff_ready": ["Only an ASSERTION with text can be handoff-ready."]}
                    return False
            self.validated_data["handoff_ready"] = want

        return True

    def save(self) -> ThreadElement:
        for field in ("text", "element_type", "handoff_ready"):
            if field in self.validated_data:
                setattr(self.instance, field, self.validated_data[field])
        self.instance.updated_at = timezone.now()
        self.instance.save()
        return self.instance


class ThreadElementCitationSerializer:
    """POST a citation onto an ASSERTION; same-case guard + document_links sync."""

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
        if self.element.element_type != ThreadElementType.ASSERTION:
            self._errors = {"element": ["Citations may only attach to ASSERTION elements."]}
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
Expected: PASS (8 tests).

- [ ] **Step 5: Lint + commit**

```bash
cd backend && ruff check . && ruff format --check .
git add backend/investigations/serializers.py backend/investigations/tests/test_thread_element_serializers.py
git commit -m "feat(threads): element + citation serializers (ASSERTION-only cites, derived role)"
```

---

### Task 5: Element CRUD + reorder + citation endpoints

**Files:**
- Modify: `backend/investigations/views.py` (add after `api_case_finding_detail`, ~line 3496)
- Modify: `backend/investigations/urls.py` (after the findings paths, ~line 162)
- Test: `backend/investigations/tests/test_thread_element_api.py`

**Interfaces:**
- Consumes: serializers (Task 4); `reap_document_link_if_orphaned` (Task 3).
- Produces endpoints: `GET/POST …/elements/`; `PATCH/DELETE …/elements/<id>/`; `POST …/elements/reorder/`; `POST …/elements/<id>/citations/`; `DELETE …/elements/<id>/citations/<cid>/`.

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
        r = self.client.post(self.base, data={"element_type": "ASSERTION", "text": "x"},
                             content_type="application/json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(len(self.client.get(self.base).json()["results"]), 1)

    def test_reorder_atomic(self):
        a = ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.ASSERTION, position=0)
        b = ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.QUESTION, position=1)
        r = self.client.post(self.base + "reorder/",
                             data={"ordered_ids": [str(b.id), str(a.id)]},
                             content_type="application/json")
        self.assertEqual(r.status_code, 200, r.content)
        a.refresh_from_db(); b.refresh_from_db()
        self.assertEqual((b.position, a.position), (0, 1))

    def test_add_then_delete_citation_syncs_document_links(self):
        el = ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.ASSERTION, position=0)
        doc = _doc(self.case)
        r = self.client.post(f"{self.base}{el.id}/citations/",
                            data={"document_id": str(doc.id)}, content_type="application/json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertTrue(FindingDocument.objects.filter(finding=self.f, document=doc).exists())
        cite = ThreadElementCitation.objects.get(element=el, document=doc)
        r2 = self.client.delete(f"{self.base}{el.id}/citations/{cite.id}/")
        self.assertEqual(r2.status_code, 204)
        self.assertFalse(FindingDocument.objects.filter(finding=self.f, document=doc).exists())

    def test_delete_element_reaps_orphan_link(self):
        el = ThreadElement.objects.create(finding=self.f, element_type=ThreadElementType.ASSERTION, position=0)
        doc = _doc(self.case)
        el.citations.create(document=doc)
        FindingDocument.objects.create(finding=self.f, document=doc)
        r = self.client.delete(f"{self.base}{el.id}/")
        self.assertEqual(r.status_code, 204)
        self.assertFalse(FindingDocument.objects.filter(finding=self.f).exists())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_thread_element_api --keepdb --noinput`
Expected: FAIL — 404s.

- [ ] **Step 3: Add the views**

In `views.py`, add to the serializers import block (~line 56):

```python
    ThreadElementCreateSerializer,
    ThreadElementUpdateSerializer,
    ThreadElementCitationSerializer,
    serialize_element,
```

Merge into the model + helper imports:

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
        elements = finding.elements.prefetch_related("citations__document")
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
    with transaction.atomic():
        for offset, eid in enumerate(ordered_ids):
            ThreadElement.objects.filter(pk=eid).update(position=offset + 1000)
        for offset, eid in enumerate(ordered_ids):
            ThreadElement.objects.filter(pk=eid).update(position=offset)
    elements = finding.elements.prefetch_related("citations__document")
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

In `urls.py`, after the `api_case_finding_detail` path (~line 162), add (`reorder/` before the `<uuid:element_id>/` path):

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

### Task 6: Embed `elements[]` + `gate_version` in `serialize_finding`

**Files:**
- Modify: `backend/investigations/serializers.py` (`serialize_finding`, ~line 694) + finding-detail view prefetch (`views.py:3433`, `:3468`)
- Test: `backend/investigations/tests/test_finding_embeds_elements.py`

**Interfaces:**
- Consumes: `serialize_element` (Task 4); `Finding.gate_version` (Task 1).
- Produces: `serialize_finding(finding)["elements"]` (ordered) + `["gate_version"]`.

- [ ] **Step 1: Write the failing test**

Create `backend/investigations/tests/test_finding_embeds_elements.py`:

```python
from django.test import TestCase

from investigations.models import Case, Finding, GateVersion, ThreadElement, ThreadElementType
from investigations.serializers import serialize_finding


class FindingEmbedsElementsTests(TestCase):
    def test_finding_detail_includes_elements_and_gate_version(self):
        case = Case.objects.create(name="C")
        f = Finding.objects.create(case=case, rule_id="MANUAL", title="T")
        ThreadElement.objects.create(finding=f, element_type=ThreadElementType.QUESTION, position=1, text="q")
        ThreadElement.objects.create(finding=f, element_type=ThreadElementType.ASSERTION, position=0, text="a")
        out = serialize_finding(f)
        self.assertEqual([e["element_type"] for e in out["elements"]], ["ASSERTION", "QUESTION"])
        self.assertEqual(out["gate_version"], GateVersion.ASSERTION_V1)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_finding_embeds_elements --keepdb --noinput`
Expected: FAIL — `KeyError: 'elements'`.

- [ ] **Step 3: Add to `serialize_finding`**

In `serialize_finding`, after `document_links` and before the closing `}`:

```python
        "gate_version": finding.gate_version,
        "elements": [serialize_element(e) for e in finding.elements.all()],
```

Extend the two `views.py` prefetch sites (`:3433`, `:3468`):

```python
Finding.objects.prefetch_related(
    "entity_links", "document_links", "elements__citations__document",
)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_finding_embeds_elements --keepdb --noinput`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
cd backend && ruff check . && ruff format --check .
git add backend/investigations/serializers.py backend/investigations/views.py backend/investigations/tests/test_finding_embeds_elements.py
git commit -m "feat(threads): embed elements[] + gate_version in finding detail"
```

---

### Task 7: Demote the legacy `add_document_ids` path to `is_legacy=True`

**Files:**
- Modify: `backend/investigations/serializers.py` (`FindingUpdateSerializer.save()` document-add loop, ~line 1127)
- Test: `backend/investigations/tests/test_add_document_ids_legacy.py`

**Interfaces:**
- Consumes: `FindingDocument.is_legacy` (Task 1).
- Produces: `add_document_ids` rows carry `is_legacy=True`. **Behavior-preserving** — gate + `referral_grade_qs` count `document_links` regardless of `is_legacy`.

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
        self.assertTrue(FindingDocument.objects.get(finding=f, document=doc).is_legacy)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_add_document_ids_legacy --keepdb --noinput`
Expected: FAIL — created row defaults `is_legacy=False`.

- [ ] **Step 3: Set `is_legacy=True` on the legacy add path**

In `FindingUpdateSerializer.save()`, the document-add loop (~line 1127):

```python
        for document in self._documents_to_add:
            FindingDocument.objects.get_or_create(
                finding=self.instance, document=document,
                defaults={"is_legacy": True},
            )
```

Do not touch the gate logic above it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_add_document_ids_legacy investigations.tests.test_tie_off_gate --keepdb --noinput`
Expected: PASS — including the existing `test_tie_off_gate` suite **unchanged** (proves behavior preserved).

- [ ] **Step 5: Lint + commit**

```bash
cd backend && ruff check . && ruff format --check .
git add backend/investigations/serializers.py backend/investigations/tests/test_add_document_ids_legacy.py
git commit -m "feat(threads): legacy add_document_ids path writes is_legacy=True"
```

---

### Task 8: Data migration — narrative → NOTE, flag legacy docs, stamp `gate_version`

**Files:**
- Create: `backend/investigations/migrations/_phase4_narrative_backfill.py`
- Create: migration `00YY_phase4_backfill.py` (via `makemigrations --empty`)
- Test: `backend/investigations/tests/test_narrative_migration.py`

**Interfaces:**
- Consumes: models from Task 1.
- Produces: per Finding with narrative → one `NOTE` (next free position, idempotent, narrative retained); all `FindingDocument` → `is_legacy=True`; findings referral-grade under the **frozen OLD predicate** → `gate_version = LEGACY_NARRATIVE` (others stay `ASSERTION_V1`).

> **Hermetic predicate:** the migration uses a **frozen inline copy** of the OLD referral-grade rule (CONFIRMED ∧ weight ∈ {DOCUMENTED,TRACED} ∧ overreach_reviewed ∧ ≥1 document_link). It must NOT import `referral_grade.is_referral_grade`, because 4B rewrites that function — a future `migrate` would otherwise grandfather the wrong rows.

- [ ] **Step 1: Write the failing test**

Create `backend/investigations/tests/test_narrative_migration.py`:

```python
from django.apps import apps
from django.test import TestCase

from investigations.models import (
    Case, Document, Finding, FindingDocument, FindingStatus, EvidenceWeight,
    GateVersion, ThreadElement, ThreadElementType,
)


def _doc(case, s="a"):
    return Document.objects.create(
        case=case, filename=f"{s}.pdf", file_path=f"{s}.pdf", sha256_hash=s * 64, file_size=1
    )


class NarrativeMigrationTests(TestCase):
    def test_forwards_converts_narrative_flags_docs_retains_narrative(self):
        from investigations.migrations import _phase4_narrative_backfill as mig
        case = Case.objects.create(name="C")
        f = Finding.objects.create(case=case, rule_id="MANUAL", title="T", narrative="legacy text")
        FindingDocument.objects.create(finding=f, document=_doc(case))

        mig.forwards(apps, schema_editor=None)

        note = f.elements.get(element_type=ThreadElementType.NOTE)
        self.assertEqual(note.text, "legacy text")
        self.assertEqual(f.narrative, "legacy text")  # retained
        self.assertTrue(FindingDocument.objects.filter(finding=f, is_legacy=True).exists())

    def test_idempotent_and_collision_safe(self):
        from investigations.migrations import _phase4_narrative_backfill as mig
        case = Case.objects.create(name="C2")
        f = Finding.objects.create(case=case, rule_id="MANUAL", title="T", narrative="n")
        ThreadElement.objects.create(finding=f, element_type=ThreadElementType.ASSERTION, position=0, text="x")

        mig.forwards(apps, schema_editor=None)
        mig.forwards(apps, schema_editor=None)

        notes = f.elements.filter(element_type=ThreadElementType.NOTE)
        self.assertEqual(notes.count(), 1)
        self.assertNotEqual(notes.first().position, 0)

    def test_grandfathers_old_referral_grade_to_legacy(self):
        from investigations.migrations import _phase4_narrative_backfill as mig
        case = Case.objects.create(name="C3")
        # referral-grade under the OLD predicate: CONFIRMED + DOCUMENTED + overreach + a doc
        grade = Finding.objects.create(
            case=case, rule_id="MANUAL", title="grade", narrative="n",
            status=FindingStatus.CONFIRMED, evidence_weight=EvidenceWeight.DOCUMENTED,
            overreach_reviewed=True,
        )
        FindingDocument.objects.create(finding=grade, document=_doc(case, "g"))
        # not referral-grade (NEW)
        plain = Finding.objects.create(case=case, rule_id="MANUAL", title="plain", narrative="n")

        mig.forwards(apps, schema_editor=None)
        grade.refresh_from_db(); plain.refresh_from_db()
        self.assertEqual(grade.gate_version, GateVersion.LEGACY_NARRATIVE)
        self.assertEqual(plain.gate_version, GateVersion.ASSERTION_V1)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_narrative_migration --keepdb --noinput`
Expected: FAIL — `ModuleNotFoundError: investigations.migrations._phase4_narrative_backfill`.

- [ ] **Step 3: Write the backfill helper + migration**

Create `backend/investigations/migrations/_phase4_narrative_backfill.py`:

```python
"""Importable forward logic for the Phase 4 backfill data migration.

Unit-testable without a migration replay. Idempotent + collision-safe. Uses a
FROZEN inline copy of the OLD referral-grade predicate so it stays correct after
4B rewrites referral_grade.py.
"""

from django.db.models import Max

# Frozen copy of the OLD referral-grade weights (do not import from referral_grade.py).
_OLD_REFERRAL_WEIGHTS = {"DOCUMENTED", "TRACED"}


def _was_referral_grade_old(finding, FindingDocument) -> bool:
    return (
        finding.status == "CONFIRMED"
        and finding.evidence_weight in _OLD_REFERRAL_WEIGHTS
        and finding.overreach_reviewed
        and FindingDocument.objects.filter(finding=finding).exists()
    )


def forwards(apps, schema_editor):
    Finding = apps.get_model("investigations", "Finding")
    ThreadElement = apps.get_model("investigations", "ThreadElement")
    FindingDocument = apps.get_model("investigations", "FindingDocument")

    # 1) Flag all existing citations legacy (preserved, never reaped).
    FindingDocument.objects.update(is_legacy=True)

    for finding in Finding.objects.all():
        # 2) Grandfather: old-referral-grade -> LEGACY_NARRATIVE (others keep ASSERTION_V1 default).
        if _was_referral_grade_old(finding, FindingDocument):
            if finding.gate_version != "LEGACY_NARRATIVE":
                finding.gate_version = "LEGACY_NARRATIVE"
                finding.save(update_fields=["gate_version"])

        # 3) narrative -> NOTE (idempotent; next free position; narrative retained).
        if (finding.narrative or "").strip():
            exists = ThreadElement.objects.filter(
                finding=finding, element_type="NOTE", text=finding.narrative
            ).exists()
            if not exists:
                max_pos = ThreadElement.objects.filter(finding=finding).aggregate(m=Max("position"))["m"]
                next_pos = 0 if max_pos is None else max_pos + 1
                ThreadElement.objects.create(
                    finding=finding, element_type="NOTE", text=finding.narrative,
                    position=next_pos, handoff_ready=False,
                )
```

Generate the migration:

Run: `docker exec catalyst_backend python manage.py makemigrations investigations --empty -n phase4_backfill`

Edit the generated file:

```python
from django.db import migrations

from investigations.migrations import _phase4_narrative_backfill


def forwards(apps, schema_editor):
    _phase4_narrative_backfill.forwards(apps, schema_editor)


def backwards(apps, schema_editor):
    pass  # non-reversible data migration; NOTE elements are harmless to keep


class Migration(migrations.Migration):
    dependencies = [
        ("investigations", "0037_thread_assertions"),  # the Task 1 migration name
    ]
    operations = [migrations.RunPython(forwards, backwards)]
```

- [ ] **Step 4: Apply migrations + run tests**

Run: `docker exec catalyst_backend python manage.py migrate investigations --noinput`
Then: `docker exec catalyst_backend python manage.py test investigations.tests.test_narrative_migration --keepdb --noinput`
Expected: PASS (3 tests).

- [ ] **Step 5: Lint + commit**

```bash
cd backend && ruff check . && ruff format --check .
git add backend/investigations/migrations backend/investigations/tests/test_narrative_migration.py
git commit -m "feat(threads): backfill migration narrative->NOTE + flag legacy + grandfather gate_version"
```

---

### Task 9: `seed_demo` builds assertions AND retains legacy narrative

**Files:**
- Modify: `backend/investigations/management/commands/seed_demo.py`
- Test: `backend/investigations/tests/test_seed_demo_elements.py`

**Interfaces:**
- Consumes: models (Task 1); helpers (Task 2).
- Produces: the demo's flagship confirmed thread has a **cited assertion** + a **handoff_ready assertion** (referral-grade-shaped under `ASSERTION_V1`), **and** retains its `narrative` + a legacy `FindingDocument` row (pre-4C PDF still renders).

- [ ] **Step 1: Write the failing test**

Create `backend/investigations/tests/test_seed_demo_elements.py`:

```python
from django.core.management import call_command
from django.test import TestCase

from investigations.models import Finding, FindingStatus
from investigations.thread_elements import (
    finding_has_cited_assertion, finding_has_handoff_ready_assertion,
)


class SeedDemoElementsTests(TestCase):
    def test_flagship_thread_has_cited_and_handoff_assertions_and_keeps_narrative(self):
        call_command("seed_demo")
        confirmed = Finding.objects.filter(status=FindingStatus.CONFIRMED).order_by("created_at").first()
        self.assertIsNotNone(confirmed)
        self.assertTrue(finding_has_cited_assertion(confirmed))
        self.assertTrue(finding_has_handoff_ready_assertion(confirmed))
        self.assertTrue(confirmed.narrative.strip(), "legacy narrative retained for pre-4C PDF")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_seed_demo_elements --keepdb --noinput`
Expected: FAIL — confirmed demo thread has no assertions.

- [ ] **Step 3: Add assertions to the demo's confirmed thread (keep its narrative)**

In `seed_demo.py`, find where the demo's CONFIRMED finding is created (search `CONFIRMED` / `overreach_reviewed`). Confirm it still assigns a non-empty `narrative` (leave it). After it exists with a cited document, add:

```python
        from investigations.models import ThreadElement, ThreadElementType

        # Phase 4: structured assertions so the flagship thread is referral-grade-shaped
        # under ASSERTION_V1. Narrative + legacy FindingDocument rows are intentionally
        # retained so the pre-4C PDF/UI still render.
        cited = ThreadElement.objects.create(
            finding=confirmed_finding,
            element_type=ThreadElementType.ASSERTION,
            position=0,
            text="Org purchased 1420 Elm St for $410,000 on 2021-03-09.",
        )
        cited.citations.create(
            document=deed_doc, page_reference="p.2", context_note="Recorded sale price.",
        )
        ThreadElement.objects.create(
            finding=confirmed_finding,
            element_type=ThreadElementType.ASSERTION,
            position=1,
            text="Below-market insider transfer warranting review of board minutes.",
            handoff_ready=True,
        )
```

> `confirmed_finding` / `deed_doc` are placeholders for the command's actual locals — use the existing confirmed finding and one of its already-cited demo documents (same case). Do NOT remove the finding's `narrative` assignment.

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker exec catalyst_backend python manage.py test investigations.tests.test_seed_demo_elements --keepdb --noinput`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
cd backend && ruff check . && ruff format --check .
git add backend/investigations/management/commands/seed_demo.py backend/investigations/tests/test_seed_demo_elements.py
git commit -m "feat(threads): seed_demo builds cited + handoff assertions, retains narrative"
```

---

### Task 10: Full-suite regression sweep (prove nothing changed) + PR

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend suite (CI-equivalent)**

Run: `docker exec catalyst_backend python manage.py test investigations --exclude-tag=eval --keepdb --noinput`
Expected: **all green, with no edits to existing tests.** 4A-additive touches no gate, so `test_tie_off_gate`, `test_credibility`, `test_referral_pdf`, and Case Map tests pass unchanged. If any existing test fails, this slice leaked a behavior change — **find and remove it** (do not edit the existing test).

- [ ] **Step 2: Confirm migrations are clean**

Run: `docker exec catalyst_backend python manage.py makemigrations --check --dry-run`
Expected: "No changes detected".

- [ ] **Step 3: Push + open the 4A-additive PR (confirm with Tyler first)**

Pushing + opening the PR is outward-facing — confirm before running:

```bash
git push -u origin feature/case-map-phase-4-thread-builder
gh pr create --fill --base main
```

PR description must state: **additive only; no existing behavior changed; gate flip + UI ship in 4B.** Validate on the Railway PR preview (exercise `/elements/` endpoints + confirm the current tie-off UI still works) before merge.

---

## Self-Review

**Spec coverage (4A-additive scope):**
- §4 models (`ThreadElement` 3-type, `ThreadElementCitation`, `gate_version`, `is_legacy`) → Task 1. ✅
- §4 completeness helpers (unwired) → Task 2. ✅
- §4 invariants: handoff_ready (ASSERTION+text) + citation-ASSERTION-only + type-change guard + delete cleanup → Tasks 4/5. ✅
- §4 same-case guard (serializer authoritative + `clean()` defense) → Task 1 + Task 4. ✅
- §5 document_links sync + `add_document_ids`→legacy → Tasks 3/5/7. ✅
- §7 migration (idempotent narrative→NOTE, flag legacy, **grandfather gate_version via frozen old predicate**) → Task 8; seed (assertions + retained narrative) → Task 9. ✅
- §8 API (CRUD + reorder + citations) → Task 5; elements[] + gate_version embed + derived role → Tasks 4/6. ✅
- §8 "regression sweep proving no existing behavior changed" → Task 10. ✅
- **Deliberately NOT here (4B/4C/4D/Phase 5):** gate flip + parity test + fixture rework (4B); PDF (4C); AI-assist (4D); `supported_by` backing graph (Phase 5). The helpers 4B needs exist + are tested. ✅

**Placeholder scan:** No "TBD/TODO". Adapt-to-local-names points (`seed_demo` locals, Task 9; `add_document_ids` get_or_create shape, Task 7) carry exact target behavior + a proving test.

**Type consistency:** `serialize_element` shape incl. `role` (Task 4) consumed by Task 6; `assertion_is_cited`/`finding_has_*` (Task 2) used by Task 9's test; `ensure_document_link`/`reap_document_link_if_orphaned` (Task 3) used by Tasks 4/5; `GateVersion` + `Finding.gate_version` (Task 1) used by Tasks 6/8; `_phase4_narrative_backfill.forwards(apps, schema_editor)` signature consistent across helper, migration, and test (Task 8); `FindingDocument.is_legacy` (Task 1) used by Tasks 3/7/8. No `supported_by` anywhere (dropped from v1). ✅
