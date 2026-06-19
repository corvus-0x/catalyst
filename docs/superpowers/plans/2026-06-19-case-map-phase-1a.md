# Case Map Phase 1A — Backend Contract + Relationship-Strength Builder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `GET /api/cases/:id/case-map/` returning one summarized relationship edge per subject pair, each carrying an explainable `strength` object, plus subject nodes and a stats block — the locked v1 contract from the controlling spec.

**Architecture:** A new pure-Python builder module `investigations/case_map.py` aggregates the existing relationship ingredients (shared documents, officer roles, property transactions, manual relationships, threads) into a per-subject-pair evidence accumulator, scores each pair with a deterministic point model, and serializes the locked contract. A thin Django view exposes it. `/graph/` is **not touched**.

**Tech Stack:** Django 5 / Python, function-based views + `JsonResponse`, `django.test.TestCase`. No new dependencies.

## Global Constraints

- **Controlling spec:** `docs/superpowers/specs/2026-06-19-case-map-and-thread-builder-design.md` (§4 "Locked v1 contract", §"First Scoring Formula", §11A test plan). Where this plan and the spec disagree, the spec governs.
- **Do NOT modify `/graph/`** (`api_case_graph`, views.py:3757) or its consumers. The Timeline keeps using it.
- **Subjects are `person` and `organization` only.** Property and financial-instrument records are *evidence*, never nodes.
- **Edge id is stable + order-independent:** `"{minId}__{maxId}"`, UUIDs sorted lexicographically; `source`/`target` follow the same sort.
- **`material` cap rule:** raw evidence caps at `repeated`; `material` requires `score ≥ 80` **and** `substantiated_thread_count ≥ 1`.
- **`handoff_ready` = the referral-grade predicate** `referral_grade.is_referral_grade(finding)` — never `status == CONFIRMED` alone.
- **`substantiated_thread_count` = threads with `status == CONFIRMED`** (handoff-ready is a subset).
- **`underlying_relationships[].source` enum:** `person_org · co_mention · property_transaction · manual_relationship · shared_address · financial_instrument · thread_reference`.
- **`strength.categories` / `evidence_refs[].category` enum:** `co_mentioned · formal_role · transaction · family_or_personal · business_association · shared_address · financial_link · thread_referenced`.
- **Line length 100 max** (Ruff; `views.py` is **not** E501-exempt — break long f-strings).
- **Backend tests can't run locally** (Postgres + ArrayField). Each "run test" step is authored to run on Railway/CI; locally, verify by reading. Commit after each green task.
- **Scope of THIS plan (deliberate slice):** the categories `co_mentioned`, `formal_role`, `transaction`, `family_or_personal`, `thread_referenced`. The scoring function also defines `shared_address`, `business_association`, and `financial_link`, but their **collectors are a documented fast-follow** (Task 9) purely for **Phase 1A scope control** — keeping the first slice reviewable. The `Address` and `FinancialInstrument` models exist; the collectors are deferred by choice, not because anything is unverified. Their evidence fields default empty (contribute 0) until then, so the contract shape is already final.

---

## File Structure

- **Create** `backend/investigations/case_map.py` — the builder: subject index, evidence accumulator, deterministic scorer, edge/stats serializer. One responsibility: turn a `Case` into the locked Case Map dict.
- **Modify** `backend/investigations/views.py` — add the `api_case_map` view (mirrors `api_case_referral_readiness`, views.py:2496).
- **Modify** `backend/investigations/urls.py` — register `api/cases/<uuid:pk>/case-map/`.
- **Create** `backend/investigations/tests/test_case_map.py` — all Phase 1A tests (§11A).
- **Modify** `CLAUDE.md` + `AGENTS.md` (if present) — vocabulary source-of-truth update (Task 9).

### Target module interface (what later tasks rely on)

```python
# investigations/case_map.py
def pair_edge_id(id_a, id_b) -> tuple[str, str, str]:  # (lo, hi, "lo__hi")
def score_evidence(ev: dict) -> dict:                  # → strength object
def build_case_map(case) -> dict:                      # → {case_id, nodes, edges, stats}
```

---

### Task 1: Subject index + endpoint skeleton

Returns subjects (person + org) with flags/metadata, an empty `edges` list, and a `stats` block. Wires the view + URL. No edges yet.

**Files:**
- Create: `backend/investigations/case_map.py`
- Modify: `backend/investigations/views.py` (add `api_case_map` near other case endpoints)
- Modify: `backend/investigations/urls.py:147` (after the `referral-readiness` path)
- Test: `backend/investigations/tests/test_case_map.py`

**Interfaces:**
- Produces: `build_case_map(case) -> {"case_id": str, "nodes": list, "edges": list, "stats": dict}`; `pair_edge_id(a, b) -> (lo, hi, id)`.

- [ ] **Step 1: Write the failing test**

```python
# backend/investigations/tests/test_case_map.py
from django.test import TestCase

from investigations.case_map import build_case_map, pair_edge_id
from investigations.models import Case, Person, Organization, OrganizationStatus


class CaseMapSubjectTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.p = Person.objects.create(case=self.case, full_name="Jay Example")
        self.o = Organization.objects.create(
            case=self.case, name="Example Charity", status=OrganizationStatus.UNKNOWN
        )

    def test_subjects_become_nodes_with_flags_and_no_edges(self):
        result = build_case_map(self.case)
        self.assertEqual(result["case_id"], str(self.case.id))
        ids = {n["id"]: n for n in result["nodes"]}
        self.assertIn(str(self.p.id), ids)
        self.assertEqual(ids[str(self.p.id)]["type"], "person")
        self.assertEqual(ids[str(self.p.id)]["label"], "Jay Example")
        # org with UNKNOWN registration status — neutral data-completeness flag
        self.assertTrue(ids[str(self.o.id)]["flags"]["status_unknown"])
        self.assertEqual(result["edges"], [])
        self.assertEqual(result["stats"]["subject_count"], 2)
        self.assertEqual(result["stats"]["edge_count"], 0)
        self.assertEqual(result["stats"]["by_level"],
                         {"observed": 0, "documented": 0, "repeated": 0, "material": 0})

    def test_pair_edge_id_is_order_independent(self):
        a, b = "ffff", "0000"
        self.assertEqual(pair_edge_id(a, b), pair_edge_id(b, a))
        lo, hi, eid = pair_edge_id(a, b)
        self.assertEqual((lo, hi, eid), ("0000", "ffff", "0000__ffff"))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test investigations.tests.test_case_map -v 2`
Expected: FAIL — `ModuleNotFoundError: investigations.case_map`.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/investigations/case_map.py
"""Case Map builder — summarized subject-pair relationship graph.

One summarized edge per unordered subject pair, with an explainable strength
object. Separate from the raw /graph/ endpoint. See
docs/superpowers/specs/2026-06-19-case-map-and-thread-builder-design.md §4.
"""

from collections import Counter

from django.utils import timezone

from .models import (
    OrganizationStatus,
    Organization,
    OrgDocument,
    Person,
    PersonDocument,
)


def pair_edge_id(id_a, id_b):
    """Stable, order-independent edge id for a subject pair."""
    lo, hi = sorted([str(id_a), str(id_b)])
    return lo, hi, f"{lo}__{hi}"


def _subject_index(case):
    """Map of subject id -> node dict for every Person and Organization."""
    idx = {}
    for p in Person.objects.filter(case=case):
        idx[str(p.id)] = {
            "id": str(p.id),
            "type": "person",
            "label": p.full_name,
            "subtype": None,
            "flags": {
                "status_unknown": False,
                "has_active_thread": False,
                "has_substantiated_thread": False,
            },
            "metadata": {"thread_count": 0, "document_count": 0},
        }
    for o in Organization.objects.filter(case=case):
        idx[str(o.id)] = {
            "id": str(o.id),
            "type": "organization",
            "label": o.name,
            "subtype": o.org_type,
            "flags": {
                # Neutral data-completeness flag — NOT a shell accusation (spec §10).
                "status_unknown": o.status == OrganizationStatus.UNKNOWN,
                "has_active_thread": False,
                "has_substantiated_thread": False,
            },
            "metadata": {"thread_count": 0, "document_count": 0},
        }
    for pd in PersonDocument.objects.filter(person__case=case):
        sid = str(pd.person_id)
        if sid in idx:
            idx[sid]["metadata"]["document_count"] += 1
    for od in OrgDocument.objects.filter(org__case=case):
        sid = str(od.org_id)
        if sid in idx:
            idx[sid]["metadata"]["document_count"] += 1
    return idx


def _build_stats(nodes, edges):
    by_level = Counter({"observed": 0, "documented": 0, "repeated": 0, "material": 0})
    for e in edges:
        by_level[e["strength"]["level"]] += 1
    return {
        "subject_count": len(nodes),
        "edge_count": len(edges),
        "by_level": dict(by_level),
        "material_edge_count": by_level["material"],
        "handoff_edge_count": sum(1 for e in edges if e["strength"]["handoff_included"]),
        "generated_at": timezone.now().isoformat(),
    }


def build_case_map(case):
    subjects = _subject_index(case)
    edges = []
    nodes = list(subjects.values())
    return {
        "case_id": str(case.id),
        "nodes": nodes,
        "edges": edges,
        "stats": _build_stats(nodes, edges),
    }
```

Add the view to `views.py` (place beside the other `api_case_*` endpoints):

```python
@require_http_methods(["GET"])
def api_case_map(request, pk):
    """Summarized subject-pair Case Map (see case_map.build_case_map)."""
    from .case_map import build_case_map

    case = get_object_or_404(Case, pk=pk)
    return JsonResponse(build_case_map(case))
```

Register the URL in `urls.py` immediately after the `referral-readiness` path:

```python
    path(
        "api/cases/<uuid:pk>/case-map/",
        views.api_case_map,
        name="api_case_map",
    ),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python manage.py test investigations.tests.test_case_map -v 2`
Expected: PASS (2 tests).

- [ ] **Step 5: Lint + commit**

```bash
cd backend && ruff check investigations/case_map.py investigations/views.py
git add backend/investigations/case_map.py backend/investigations/views.py backend/investigations/urls.py backend/investigations/tests/test_case_map.py
git commit -m "feat(case-map): subject nodes + /case-map/ endpoint skeleton"
```

---

### Task 2: Deterministic scorer (`score_evidence`) + levels + material cap

Pure function over a fully-typed evidence dict. This is the math, isolated and unit-tested. Later tasks only populate the evidence dict.

**Files:**
- Modify: `backend/investigations/case_map.py`
- Test: `backend/investigations/tests/test_case_map.py`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `_new_evidence() -> dict` (the locked field set); `score_evidence(ev) -> strength dict` with keys `score, level, categories, source_count, transaction_count, role_count, thread_count, substantiated_thread_count, handoff_included, relationship_types, reasons`.

- [ ] **Step 1: Write the failing test**

```python
from investigations.case_map import score_evidence, _new_evidence
from investigations.models import FindingStatus


class ScoreEvidenceTests(TestCase):
    def test_co_mention_only_is_observed(self):
        ev = _new_evidence()
        ev["doc_ids"].add("d1")
        s = score_evidence(ev)
        self.assertEqual(s["score"], 10)
        self.assertEqual(s["level"], "observed")
        self.assertEqual(s["categories"], ["co_mentioned"])

    def test_single_role_is_documented(self):
        ev = _new_evidence()
        ev["role_count"] = 1
        self.assertEqual(score_evidence(ev)["level"], "documented")  # 30

    def test_doc_repetition_caps_at_20(self):
        ev = _new_evidence()
        for i in range(10):
            ev["doc_ids"].add(f"d{i}")
        # 10 + min(9*5, 20) = 30
        self.assertEqual(score_evidence(ev)["score"], 30)

    def test_transactions_cap_at_50(self):
        ev = _new_evidence()
        ev["transaction_count"] = 5
        self.assertEqual(score_evidence(ev)["score"], 50)  # min(5*25,50)
        self.assertEqual(score_evidence(ev)["level"], "repeated")

    def test_multiple_categories_reach_repeated(self):
        ev = _new_evidence()
        ev["role_count"] = 1            # 30
        ev["doc_ids"].add("d1")         # 10
        ev["transaction_count"] = 1     # 25  -> 65
        self.assertEqual(score_evidence(ev)["level"], "repeated")

    def test_high_raw_score_without_substantiated_thread_caps_at_repeated(self):
        ev = _new_evidence()
        ev["role_count"] = 1            # 30
        ev["transaction_count"] = 2     # 50 -> 80
        s = score_evidence(ev)
        self.assertGreaterEqual(s["score"], 80)
        self.assertEqual(s["level"], "repeated")  # capped: no substantiated thread

    def test_substantiated_thread_elevates_to_material(self):
        ev = _new_evidence()
        ev["role_count"] = 1            # 30
        ev["transaction_count"] = 2     # 50
        ev["thread_refs"].append(
            {"status": FindingStatus.CONFIRMED, "handoff_ready": False}
        )  # +25 -> 105, substantiated
        s = score_evidence(ev)
        self.assertEqual(s["level"], "material")
        self.assertEqual(s["substantiated_thread_count"], 1)
        self.assertFalse(s["handoff_included"])

    def test_handoff_thread_sets_handoff_included(self):
        ev = _new_evidence()
        ev["role_count"] = 1
        ev["transaction_count"] = 2
        ev["thread_refs"].append(
            {"status": FindingStatus.CONFIRMED, "handoff_ready": True}
        )  # +35
        s = score_evidence(ev)
        self.assertTrue(s["handoff_included"])
        self.assertEqual(s["level"], "material")
```

- [ ] **Step 2: Run to verify failure**

Run: `python manage.py test investigations.tests.test_case_map.ScoreEvidenceTests -v 2`
Expected: FAIL — `cannot import name 'score_evidence'`.

- [ ] **Step 3: Implement scorer**

Add to `case_map.py`:

```python
from .models import FindingStatus  # add to existing model imports

# ── Scoring constants (spec §"First Scoring Formula") ──
CO_MENTION_FIRST = 10
CO_MENTION_EACH = 5
CO_MENTION_CAP = 20
ROLE_POINTS = 30
TRANSACTION_EACH = 25
TRANSACTION_CAP = 50
FAMILY_POINTS = 25
BUSINESS_POINTS = 25
SHARED_ADDRESS_POINTS = 15
FINANCIAL_POINTS = 25
THREAD_DEVELOPING = 10
THREAD_SUBSTANTIATED = 25
THREAD_HANDOFF = 35

LEVEL_DOCUMENTED = 20
LEVEL_REPEATED = 50
LEVEL_MATERIAL = 80


def _new_evidence():
    """The locked per-pair evidence field set. Collectors populate these."""
    return {
        "doc_ids": set(),
        "role_count": 0,
        "transaction_count": 0,
        "has_family": False,
        "has_business": False,
        "has_shared_address": False,
        "has_financial": False,
        "relationship_types": set(),
        "evidence_refs": [],
        "underlying": [],
        "thread_refs": [],  # dicts: {status, handoff_ready, ...}
    }


def _plural(n):
    return "" if n == 1 else "s"


def score_evidence(ev):
    score = 0
    categories = []
    reasons = []

    n_docs = len(ev["doc_ids"])
    if n_docs:
        score += CO_MENTION_FIRST + min((n_docs - 1) * CO_MENTION_EACH, CO_MENTION_CAP)
        categories.append("co_mentioned")
        reasons.append(f"Appears together in {n_docs} source document{_plural(n_docs)}")
    if ev["role_count"]:
        score += ROLE_POINTS
        categories.append("formal_role")
        reasons.append("Formal role documented")
    if ev["transaction_count"]:
        n = ev["transaction_count"]
        score += min(n * TRANSACTION_EACH, TRANSACTION_CAP)
        categories.append("transaction")
        reasons.append(f"{n} property transaction{_plural(n)} connect these subjects")
    if ev["has_family"]:
        score += FAMILY_POINTS
        categories.append("family_or_personal")
        reasons.append("Family or personal relationship recorded")
    if ev["has_business"]:
        score += BUSINESS_POINTS
        categories.append("business_association")
        reasons.append("Business association recorded")
    if ev["has_shared_address"]:
        score += SHARED_ADDRESS_POINTS
        categories.append("shared_address")
        reasons.append("Shared address appears in records")
    if ev["has_financial"]:
        score += FINANCIAL_POINTS
        categories.append("financial_link")
        reasons.append("Financial link connects these subjects")

    substantiated = 0
    handoff = False
    developing = 0
    for t in ev["thread_refs"]:
        if t.get("handoff_ready"):
            score += THREAD_HANDOFF
            handoff = True
            substantiated += 1
        elif t.get("status") == FindingStatus.CONFIRMED:
            score += THREAD_SUBSTANTIATED
            substantiated += 1
        else:
            score += THREAD_DEVELOPING
            developing += 1
    if ev["thread_refs"]:
        categories.append("thread_referenced")
        if substantiated:
            reasons.append(
                f"Referenced by {substantiated} substantiated thread{_plural(substantiated)}"
            )
        if developing:
            reasons.append(
                f"Referenced by {developing} developing thread{_plural(developing)}"
            )

    if score >= LEVEL_MATERIAL and substantiated >= 1:
        level = "material"
    elif score >= LEVEL_REPEATED:
        level = "repeated"
    elif score >= LEVEL_DOCUMENTED:
        level = "documented"
    else:
        level = "observed"

    return {
        "score": score,
        "level": level,
        "categories": categories,
        "source_count": n_docs,
        "transaction_count": ev["transaction_count"],
        "role_count": ev["role_count"],
        "thread_count": len(ev["thread_refs"]),
        "substantiated_thread_count": substantiated,
        "handoff_included": handoff,
        "relationship_types": sorted(ev["relationship_types"]),
        "reasons": reasons,
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `python manage.py test investigations.tests.test_case_map.ScoreEvidenceTests -v 2`
Expected: PASS (8 tests).

- [ ] **Step 5: Lint + commit**

```bash
cd backend && ruff check investigations/case_map.py
git add backend/investigations/case_map.py backend/investigations/tests/test_case_map.py
git commit -m "feat(case-map): deterministic strength scorer + material cap rule"
```

---

### Task 3: Co-mention collector + edge assembly

Mirror the existing `/graph/` shared-document logic (views.py:3923-3992) into the accumulator, and build `SummaryEdge`s from scored evidence. After this task the endpoint emits real edges.

**Files:**
- Modify: `backend/investigations/case_map.py`
- Test: `backend/investigations/tests/test_case_map.py`

**Interfaces:**
- Consumes: `_subject_index`, `_new_evidence`, `score_evidence`, `pair_edge_id`.
- Produces: `_collect_co_mentions(case, subjects, evidence)`; `_build_edges(evidence, subjects) -> list`; `build_case_map` now populates edges.

- [ ] **Step 1: Write the failing test**

```python
from investigations.models import Document, PersonDocument


def _doc(case, h):
    return Document.objects.create(
        case=case, filename="d.pdf", file_path="cases/t/d.pdf",
        sha256_hash=h * 64, file_size=1024,
    )


class CoMentionEdgeTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.a = Person.objects.create(case=self.case, full_name="A")
        self.b = Person.objects.create(case=self.case, full_name="B")

    def test_single_shared_doc_makes_one_observed_edge(self):
        d = _doc(self.case, "a")
        PersonDocument.objects.create(person=self.a, document=d)
        PersonDocument.objects.create(person=self.b, document=d)
        result = build_case_map(self.case)
        self.assertEqual(len(result["edges"]), 1)
        edge = result["edges"][0]
        lo, hi, eid = pair_edge_id(self.a.id, self.b.id)
        self.assertEqual(edge["id"], eid)
        self.assertEqual(edge["source"], lo)
        self.assertEqual(edge["target"], hi)
        self.assertEqual(edge["relationship"], "SUMMARY")
        self.assertEqual(edge["strength"]["level"], "observed")
        self.assertIn("co_mentioned", edge["strength"]["categories"])
        self.assertEqual(edge["strength"]["source_count"], 1)
        self.assertEqual(result["stats"]["by_level"]["observed"], 1)
```

(`Document` create args copy the `tests/test_credibility.py` helper exactly.)

- [ ] **Step 2: Run to verify failure**

Run: `python manage.py test investigations.tests.test_case_map.CoMentionEdgeTests -v 2`
Expected: FAIL — `edges` is empty (length 0 != 1).

- [ ] **Step 3: Implement collector + edge builder**

Add to `case_map.py` (imports: extend the model import with nothing new — `PersonDocument`, `OrgDocument` already imported):

```python
_LEVEL_LABEL = {
    "observed": "Observed relationship",
    "documented": "Documented relationship",
    "repeated": "Repeated relationship",
    "material": "Material relationship",
}


def _collect_co_mentions(case, subjects, evidence):
    """Shared-document co-mentions → co_mentioned evidence (mirrors /graph/)."""
    doc_subjects = {}
    for pd in PersonDocument.objects.filter(person__case=case):
        doc_subjects.setdefault(str(pd.document_id), []).append(str(pd.person_id))
    for od in OrgDocument.objects.filter(org__case=case):
        doc_subjects.setdefault(str(od.document_id), []).append(str(od.org_id))

    for doc_id, members in doc_subjects.items():
        present = [m for m in members if m in subjects]
        for i, a in enumerate(present):
            for b in present[i + 1:]:
                lo, hi, _ = pair_edge_id(a, b)
                ev = evidence.setdefault((lo, hi), _new_evidence())
                if doc_id not in ev["doc_ids"]:
                    ev["doc_ids"].add(doc_id)
                    ev["relationship_types"].add("CO_APPEARS_IN")
                    ev["evidence_refs"].append({
                        "kind": "source_document",
                        "document_id": doc_id,
                        "label": "Shared source document",
                        "category": "co_mentioned",
                    })
                    ev["underlying"].append({
                        "kind": "CO_APPEARS_IN",
                        "label": "Co-appears in document",
                        "source": "co_mention",
                        "source_id": doc_id,
                    })


def _build_edges(evidence, subjects):
    edges = []
    for (lo, hi), ev in evidence.items():
        strength = score_evidence(ev)
        edges.append({
            "id": f"{lo}__{hi}",
            "source": lo,
            "target": hi,
            "relationship": "SUMMARY",
            "label": _LEVEL_LABEL[strength["level"]],
            "state": strength["level"],
            "strength": strength,
            "evidence_refs": ev["evidence_refs"],
            "thread_refs": ev["thread_refs"],
            "underlying_relationships": ev["underlying"],
        })
    return edges
```

Update `build_case_map` to use a plain dict accumulator + collectors:

```python
def build_case_map(case):
    subjects = _subject_index(case)
    evidence = {}
    _collect_co_mentions(case, subjects, evidence)
    edges = _build_edges(evidence, subjects)
    nodes = list(subjects.values())
    return {
        "case_id": str(case.id),
        "nodes": nodes,
        "edges": edges,
        "stats": _build_stats(nodes, edges),
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `python manage.py test investigations.tests.test_case_map -v 2`
Expected: PASS (all tests so far).

- [ ] **Step 5: Lint + commit**

```bash
cd backend && ruff check investigations/case_map.py
git add backend/investigations/case_map.py backend/investigations/tests/test_case_map.py
git commit -m "feat(case-map): co-mention collector + summarized edge assembly"
```

---

### Task 4: Formal-role collector (PersonOrganization)

**Files:**
- Modify: `backend/investigations/case_map.py`
- Test: `backend/investigations/tests/test_case_map.py`

**Interfaces:**
- Produces: `_collect_roles(case, subjects, evidence)`; `build_case_map` calls it.

- [ ] **Step 1: Write the failing test**

```python
from investigations.models import PersonOrganization


class FormalRoleTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.p = Person.objects.create(case=self.case, full_name="Officer")
        self.o = Organization.objects.create(case=self.case, name="Org")

    def test_single_role_is_documented_edge(self):
        PersonOrganization.objects.create(person=self.p, org=self.o, role="Board member")
        result = build_case_map(self.case)
        self.assertEqual(len(result["edges"]), 1)
        s = result["edges"][0]["strength"]
        self.assertEqual(s["level"], "documented")
        self.assertEqual(s["role_count"], 1)
        self.assertIn("formal_role", s["categories"])
        self.assertEqual(result["edges"][0]["underlying_relationships"][0]["source"],
                         "person_org")
```

- [ ] **Step 2: Run to verify failure**

Run: `python manage.py test investigations.tests.test_case_map.FormalRoleTests -v 2`
Expected: FAIL — 0 edges.

- [ ] **Step 3: Implement**

Add `PersonOrganization` to the model imports, then:

```python
def _collect_roles(case, subjects, evidence):
    """PersonOrganization officer/board/employee roles → formal_role evidence."""
    qs = PersonOrganization.objects.filter(person__case=case).select_related("person", "org")
    for po in qs:
        a, b = str(po.person_id), str(po.org_id)
        if a not in subjects or b not in subjects:
            continue
        lo, hi, _ = pair_edge_id(a, b)
        ev = evidence.setdefault((lo, hi), _new_evidence())
        ev["role_count"] += 1
        ev["relationship_types"].add("OFFICER_OF")
        ev["underlying"].append({
            "kind": "OFFICER_OF",
            "label": po.role or "Member",
            "source": "person_org",
            "source_id": str(po.id),
        })
```

Call it in `build_case_map` after `_collect_co_mentions`.

- [ ] **Step 4: Run to verify pass**

Run: `python manage.py test investigations.tests.test_case_map -v 2`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
cd backend && ruff check investigations/case_map.py
git add backend/investigations/case_map.py backend/investigations/tests/test_case_map.py
git commit -m "feat(case-map): formal-role (PersonOrganization) collector"
```

---

### Task 5: Property-transaction summarization (the core builder challenge)

Resolve buyer/seller subjects from `PropertyTransaction.buyer_id`/`seller_id`; attribute the transaction to the **subject-pair** edge. One-sided transactions create **no edge**.

**Files:**
- Modify: `backend/investigations/case_map.py`
- Test: `backend/investigations/tests/test_case_map.py`

**Interfaces:**
- Produces: `_collect_transactions(case, subjects, evidence)`.

- [ ] **Step 1: Write the failing test**

```python
import uuid

from investigations.models import Property, PropertyTransaction


class PropertyTransactionTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.buyer = Organization.objects.create(case=self.case, name="Charity")
        self.seller = Person.objects.create(case=self.case, full_name="Insider")
        self.prop = Property.objects.create(case=self.case, address="123 Main St")

    def _tx(self, buyer_id, seller_id):
        return PropertyTransaction.objects.create(
            property=self.prop,
            buyer_id=buyer_id, buyer_type="ORGANIZATION", buyer_name="Charity",
            seller_id=seller_id, seller_type="PERSON", seller_name="Insider",
        )

    def test_two_sided_transaction_makes_subject_pair_edge(self):
        self._tx(self.buyer.id, self.seller.id)
        result = build_case_map(self.case)
        self.assertEqual(len(result["edges"]), 1)
        edge = result["edges"][0]
        lo, hi, eid = pair_edge_id(self.buyer.id, self.seller.id)
        self.assertEqual(edge["id"], eid)
        self.assertEqual(edge["strength"]["transaction_count"], 1)
        self.assertIn("transaction", edge["strength"]["categories"])
        kinds = [u["source"] for u in edge["underlying_relationships"]]
        self.assertIn("property_transaction", kinds)

    def test_one_sided_transaction_makes_no_edge(self):
        # seller id does not resolve to any case subject
        self._tx(self.buyer.id, uuid.uuid4())
        result = build_case_map(self.case)
        self.assertEqual(result["edges"], [])
```

- [ ] **Step 2: Run to verify failure**

Run: `python manage.py test investigations.tests.test_case_map.PropertyTransactionTests -v 2`
Expected: FAIL — first test sees 0 edges.

- [ ] **Step 3: Implement**

Add `PropertyTransaction` to imports, then:

```python
def _collect_transactions(case, subjects, evidence):
    """Summarize buyer<->seller property transactions into subject-pair edges.

    Properties are NOT nodes; the transaction is attributed to the buyer/seller
    subject pair. A transaction with only one side resolving to a case subject
    contributes no edge (spec §"Property transaction summarization").
    """
    for tx in PropertyTransaction.objects.filter(property__case=case).select_related("property"):
        buyer = str(tx.buyer_id) if tx.buyer_id else None
        seller = str(tx.seller_id) if tx.seller_id else None
        if not buyer or not seller:
            continue
        if buyer not in subjects or seller not in subjects:
            continue
        lo, hi, _ = pair_edge_id(buyer, seller)
        ev = evidence.setdefault((lo, hi), _new_evidence())
        ev["transaction_count"] += 1
        ev["relationship_types"].add("PURCHASED")
        prop_label = tx.property.address or tx.property.parcel_number or "property"
        ev["evidence_refs"].append({
            "kind": "property_transaction",
            "document_id": str(tx.document_id) if tx.document_id else None,
            "label": f"Transaction — {prop_label}",
            "category": "transaction",
        })
        ev["underlying"].append({
            "kind": "PURCHASED",
            "label": f"{tx.buyer_name or 'Buyer'} ← {tx.seller_name or 'Seller'}",
            "source": "property_transaction",
            "source_id": str(tx.id),
        })
```

Call it in `build_case_map` after `_collect_roles`.

- [ ] **Step 4: Run to verify pass**

Run: `python manage.py test investigations.tests.test_case_map -v 2`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
cd backend && ruff check investigations/case_map.py
git add backend/investigations/case_map.py backend/investigations/tests/test_case_map.py
git commit -m "feat(case-map): property-transaction subject-pair summarization"
```

---

### Task 6: Manual relationship collector (family/personal)

Each `Relationship` row contributes `family_or_personal` evidence. (The family-vs-business split and `shared_address`/`financial_link` collectors are the Task 9 fast-follow.)

**Files:**
- Modify: `backend/investigations/case_map.py`
- Test: `backend/investigations/tests/test_case_map.py`

**Interfaces:**
- Produces: `_collect_relationships(case, subjects, evidence)`.

- [ ] **Step 1: Write the failing test**

```python
from investigations.models import Relationship


class ManualRelationshipTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.a = Person.objects.create(case=self.case, full_name="A")
        self.b = Person.objects.create(case=self.case, full_name="B")

    def test_manual_relationship_adds_family_evidence(self):
        Relationship.objects.create(
            case=self.case, person_a=self.a, person_b=self.b,
            relationship_type="SPOUSE",
        )
        result = build_case_map(self.case)
        self.assertEqual(len(result["edges"]), 1)
        s = result["edges"][0]["strength"]
        self.assertIn("family_or_personal", s["categories"])
        self.assertEqual(result["edges"][0]["underlying_relationships"][0]["source"],
                         "manual_relationship")
```

(If `relationship_type="SPOUSE"` is rejected by choices, substitute any valid `RelationshipType` value — the assertion is on the category, not the type.)

- [ ] **Step 2: Run to verify failure**

Run: `python manage.py test investigations.tests.test_case_map.ManualRelationshipTests -v 2`
Expected: FAIL — 0 edges.

- [ ] **Step 3: Implement**

Add `Relationship` to imports, then:

```python
def _collect_relationships(case, subjects, evidence):
    """Manual/person Relationship rows → family_or_personal evidence."""
    for rel in Relationship.objects.filter(case=case).select_related("person_a", "person_b"):
        a, b = str(rel.person_a_id), str(rel.person_b_id)
        if a not in subjects or b not in subjects:
            continue
        lo, hi, _ = pair_edge_id(a, b)
        ev = evidence.setdefault((lo, hi), _new_evidence())
        ev["has_family"] = True
        ev["relationship_types"].add(rel.relationship_type)
        ev["underlying"].append({
            "kind": rel.relationship_type,
            "label": rel.get_relationship_type_display(),
            "source": "manual_relationship",
            "source_id": str(rel.id),
        })
```

Call it after `_collect_transactions`.

- [ ] **Step 4: Run to verify pass**

Run: `python manage.py test investigations.tests.test_case_map -v 2`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
cd backend && ruff check investigations/case_map.py
git add backend/investigations/case_map.py backend/investigations/tests/test_case_map.py
git commit -m "feat(case-map): manual relationship (family/personal) collector"
```

---

### Task 7: Thread attachment (multi-source subject inference) + node flags + material via threads

Attach `thread_ref`s to the subject pair(s) a Finding implicates. The subject set is inferred from **three sources, unioned** — because the real signal rules rarely link two subjects directly:

1. **`FindingEntity`** links of type person/organization (manual + rules that link subjects).
2. **`evidence_snapshot` subject-id keys** — `buyer_id`, `seller_id`, `matched_entity_id`. **SR-015** stores its subjects here (its `FindingEntity`/`trigger_entity_id` is the *property*).
3. **Underlying transaction records** — `evidence_snapshot["transaction_id"]` and `evidence_snapshot["transaction_examples"][].transaction_id` resolved to a `PropertyTransaction`'s buyer/seller subjects. **SR-025 (contradiction mode)** has no trigger entity at all and only references transactions by id — this path is the only way to recover its subject pair.

This is the spec's "consult `evidence_snapshot` and underlying records, not only `trigger_entity_id`" requirement (§4, §11A). `signal_type` is derived from `signal_rules._RULE_TO_SIGNAL_TYPE` (SR-015 does **not** write it into evidence).

**Files:**
- Modify: `backend/investigations/case_map.py`
- Test: `backend/investigations/tests/test_case_map.py`

**Interfaces:**
- Consumes: `referral_grade.is_referral_grade`; `signal_rules._RULE_TO_SIGNAL_TYPE`.
- Produces: `_txn_subject_pairs(case) -> {txn_id: set[str]}`; `_subject_ids_from_finding(finding, subjects, txn_pairs) -> set[str]`; `_collect_threads(case, subjects, evidence)`.

- [ ] **Step 1: Write the failing test**

```python
from investigations.models import (
    Finding, FindingEntity, FindingDocument, FindingStatus, EvidenceWeight,
    PersonOrganization, PropertyTransaction, Property,
)


class ThreadAttachmentTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.insider = Person.objects.create(case=self.case, full_name="Insider")
        self.org = Organization.objects.create(case=self.case, name="Charity")

    def _link(self, finding, subject, etype):
        FindingEntity.objects.create(
            finding=finding, entity_id=subject.id, entity_type=etype
        )

    def test_thread_via_finding_entity_subject_links(self):
        # Simplest path: a Finding that DOES link both subjects directly.
        f = Finding.objects.create(
            case=self.case, rule_id="MANUAL", title="Manual thread",
            status=FindingStatus.NEEDS_EVIDENCE, severity="MEDIUM",
        )
        self._link(f, self.insider, "person")
        self._link(f, self.org, "organization")
        edge = build_case_map(self.case)["edges"][0]
        self.assertEqual(edge["thread_refs"][0]["thread_id"], str(f.id))
        node = {n["id"]: n for n in build_case_map(self.case)["nodes"]}[str(self.insider.id)]
        self.assertTrue(node["flags"]["has_active_thread"])

    def test_sr015_pair_inferred_from_evidence_buyer_seller(self):
        # SR-015's FindingEntity / trigger is the PROPERTY. The subject pair lives
        # in evidence_snapshot buyer_id/seller_id and must be inferred from there.
        prop = Property.objects.create(case=self.case, address="1 Main")
        tx = PropertyTransaction.objects.create(property=prop)
        f = Finding.objects.create(
            case=self.case, rule_id="SR-015", title="Insider swap",
            status=FindingStatus.NEEDS_EVIDENCE, severity="HIGH",
            trigger_entity_id=tx.property_id,
            evidence_snapshot={
                "buyer_id": str(self.org.id),
                "seller_id": str(self.insider.id),
            },
        )
        self._link(f, prop, "property")  # only the property is a FindingEntity
        result = build_case_map(self.case)
        edges = result["edges"]
        self.assertEqual(len(edges), 1)
        lo, hi, eid = pair_edge_id(self.org.id, self.insider.id)
        self.assertEqual(edges[0]["id"], eid)
        ref = edges[0]["thread_refs"][0]
        self.assertEqual(ref["rule_id"], "SR-015")
        # signal_type comes from the rule registry, not from evidence_snapshot
        self.assertEqual(ref["signal_type"], "INSIDER_SWAP")

    def test_sr025_pair_inferred_from_underlying_transaction(self):
        # SR-025 (contradiction mode) has NO trigger entity and references the
        # transaction only by id. The subject pair must be recovered by resolving
        # transaction_examples -> PropertyTransaction -> buyer/seller subjects.
        prop = Property.objects.create(case=self.case, address="2 Oak")
        tx = PropertyTransaction.objects.create(
            property=prop,
            buyer_id=self.org.id, buyer_type="ORGANIZATION",
            seller_id=self.insider.id, seller_type="PERSON",
        )
        f = Finding.objects.create(
            case=self.case, rule_id="SR-025", title="990 denies related party",
            status=FindingStatus.NEEDS_EVIDENCE, severity="CRITICAL",
            evidence_snapshot={
                "denial_doc_id": "doc-uuid",
                "transaction_examples": [{"transaction_id": str(tx.id)}],
            },
        )
        # No subject FindingEntity links at all (trigger is the 990 document).
        result = build_case_map(self.case)
        lo, hi, eid = pair_edge_id(self.org.id, self.insider.id)
        edge = {e["id"]: e for e in result["edges"]}[eid]
        rule_ids = [t["rule_id"] for t in edge["thread_refs"]]
        self.assertIn("SR-025", rule_ids)
        self.assertEqual(edge["thread_refs"][0]["signal_type"], "RELATED_PARTY_TX")

    def test_substantiated_thread_plus_evidence_reaches_material(self):
        # role (30) + 2 tx (50) = 80 raw -> capped repeated; +substantiated thread -> material
        PersonOrganization.objects.create(person=self.insider, org=self.org, role="Board")
        prop = Property.objects.create(case=self.case, address="1 Main")
        for _ in range(2):
            PropertyTransaction.objects.create(
                property=prop,
                buyer_id=self.org.id, buyer_type="ORGANIZATION",
                seller_id=self.insider.id, seller_type="PERSON",
            )
        f = Finding.objects.create(
            case=self.case, rule_id="SR-015", title="Insider swap",
            status=FindingStatus.CONFIRMED, severity="HIGH",
            evidence_weight=EvidenceWeight.DOCUMENTED, overreach_reviewed=True,
        )
        FindingDocument.objects.create(
            finding=f,
            document=Document.objects.create(
                case=self.case, filename="d.pdf", file_path="cases/t/d.pdf",
                sha256_hash="q" * 64, file_size=1024,
            ),
        )  # makes is_referral_grade True -> handoff_ready
        self._link(f, self.insider, "person")
        self._link(f, self.org, "organization")
        edge = build_case_map(self.case)["edges"][0]
        self.assertEqual(edge["strength"]["level"], "material")
        self.assertTrue(edge["strength"]["handoff_included"])
        self.assertEqual(edge["strength"]["substantiated_thread_count"], 1)

    def test_dismissed_thread_is_ignored(self):
        f = Finding.objects.create(
            case=self.case, rule_id="SR-015", title="x",
            status=FindingStatus.DISMISSED,
        )
        self._link(f, self.insider, "person")
        self._link(f, self.org, "organization")
        # no other evidence -> no thread ref, and pair has no other evidence -> no edge
        self.assertEqual(build_case_map(self.case)["edges"], [])
```

- [ ] **Step 2: Run to verify failure**

Run: `python manage.py test investigations.tests.test_case_map.ThreadAttachmentTests -v 2`
Expected: FAIL — no `thread_refs` populated.

- [ ] **Step 3: Implement**

Add imports `Finding, FindingStatus` (extend the model import) and `from .referral_grade import is_referral_grade`, then:

```python
def _txn_subject_pairs(case):
    """Map transaction id -> set of its buyer/seller subject ids (as strings).

    Lets thread inference recover a subject pair from a Finding that references a
    transaction only by id (e.g. SR-025's evidence_snapshot.transaction_examples).
    """
    pairs = {}
    for tx in PropertyTransaction.objects.filter(property__case=case):
        ids = set()
        if tx.buyer_id:
            ids.add(str(tx.buyer_id))
        if tx.seller_id:
            ids.add(str(tx.seller_id))
        pairs[str(tx.id)] = ids
    return pairs


def _subject_ids_from_finding(finding, subjects, txn_pairs):
    """Infer the case-subject ids a Finding implicates, from three sources.

    1. FindingEntity links (person/organization).
    2. evidence_snapshot subject-id keys: buyer_id, seller_id, matched_entity_id.
    3. evidence_snapshot transaction references resolved to buyer/seller subjects.

    Only ids that resolve to an actual case subject are returned.
    """
    ids = set()
    for el in finding.entity_links.all():
        sid = str(el.entity_id)
        if sid in subjects:
            ids.add(sid)

    snap = finding.evidence_snapshot or {}
    for key in ("buyer_id", "seller_id", "matched_entity_id"):
        val = snap.get(key)
        if val and str(val) in subjects:
            ids.add(str(val))

    txn_ids = []
    if snap.get("transaction_id"):
        txn_ids.append(str(snap["transaction_id"]))
    for ex in snap.get("transaction_examples") or []:
        if isinstance(ex, dict) and ex.get("transaction_id"):
            txn_ids.append(str(ex["transaction_id"]))
    for tid in txn_ids:
        for sid in txn_pairs.get(tid, ()):
            if sid in subjects:
                ids.add(sid)
    return ids


def _collect_threads(case, subjects, evidence):
    """Attach non-dismissed Findings to every subject pair they implicate.

    Subjects are inferred via _subject_ids_from_finding (FindingEntity +
    evidence_snapshot + underlying transactions), because real rules often
    trigger on a property/document, not on the subjects themselves.
    """
    from .signal_rules import _RULE_TO_SIGNAL_TYPE

    txn_pairs = _txn_subject_pairs(case)
    findings = (
        Finding.objects.filter(case=case)
        .exclude(status=FindingStatus.DISMISSED)
        .prefetch_related("entity_links")
    )
    for f in findings:
        subj_ids = sorted(_subject_ids_from_finding(f, subjects, txn_pairs))
        handoff = is_referral_grade(f)
        for sid in subj_ids:
            node = subjects[sid]
            node["flags"]["has_active_thread"] = True
            node["metadata"]["thread_count"] += 1
            if f.status == FindingStatus.CONFIRMED:
                node["flags"]["has_substantiated_thread"] = True
        snap = f.evidence_snapshot or {}
        ref = {
            "thread_id": str(f.id),
            "title": f.title,
            "status": f.status,
            "severity": f.severity,
            "rule_id": f.rule_id,
            "signal_type": snap.get("signal_type") or _RULE_TO_SIGNAL_TYPE.get(f.rule_id, ""),
            "handoff_ready": handoff,
        }
        for i, a in enumerate(subj_ids):
            for b in subj_ids[i + 1:]:
                lo, hi, _ = pair_edge_id(a, b)
                evidence.setdefault((lo, hi), _new_evidence())["thread_refs"].append(ref)
```

Call it last in `build_case_map` (after `_collect_relationships`, before `_build_edges`).

- [ ] **Step 4: Run to verify pass**

Run: `python manage.py test investigations.tests.test_case_map -v 2`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
cd backend && ruff check investigations/case_map.py
git add backend/investigations/case_map.py backend/investigations/tests/test_case_map.py
git commit -m "feat(case-map): thread attachment, node flags, material-via-thread"
```

---

### Task 8: Full-contract validation + endpoint integration test

One end-to-end test that hits the HTTP endpoint and asserts the locked contract invariants (stats coherence, edge-id stability over a built case).

**Files:**
- Test: `backend/investigations/tests/test_case_map.py`

**Interfaces:**
- Consumes: the `api_case_map` URL name.

- [ ] **Step 1: Write the failing test**

```python
import json
from django.urls import reverse


class CaseMapEndpointContractTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="C")
        self.p = Person.objects.create(case=self.case, full_name="A")
        self.o = Organization.objects.create(case=self.case, name="B")
        PersonOrganization.objects.create(person=self.p, org=self.o, role="Board")

    def test_endpoint_returns_locked_contract(self):
        url = reverse("api_case_map", args=[self.case.id])
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200)
        body = json.loads(resp.content)
        self.assertEqual(body["case_id"], str(self.case.id))
        # stats coherence: by_level sums to edge_count
        self.assertEqual(sum(body["stats"]["by_level"].values()),
                         body["stats"]["edge_count"])
        # every edge id is "{min}__{max}" with sorted endpoints
        for e in body["edges"]:
            self.assertEqual(e["id"], f'{e["source"]}__{e["target"]}')
            self.assertLess(e["source"], e["target"])
            for key in ("score", "level", "categories", "reasons",
                        "substantiated_thread_count", "handoff_included"):
                self.assertIn(key, e["strength"])
```

- [ ] **Step 2: Run to verify failure (then pass — no code change expected)**

Run: `python manage.py test investigations.tests.test_case_map.CaseMapEndpointContractTests -v 2`
Expected: PASS if Tasks 1-7 are correct. If it FAILS, fix the contract drift it exposes (do not weaken the test).

- [ ] **Step 3: Run the whole module + the full backend suite**

Run: `python manage.py test investigations.tests.test_case_map -v 2`
Then: `python manage.py test investigations -v 1`
Expected: all green; no regression in existing graph/readiness tests.

- [ ] **Step 4: Commit**

```bash
git add backend/investigations/tests/test_case_map.py
git commit -m "test(case-map): full /case-map/ contract + endpoint integration"
```

---

### Task 9: Vocabulary source-of-truth update + fast-follow note

Locks the new product vocabulary in the source-of-truth docs *before* any frontend rename (Phase 1B/2), and records the deferred collectors so they aren't lost.

**Files:**
- Modify: `CLAUDE.md` (FRONTEND VOCABULARY table)
- Modify: `AGENTS.md` (only if it exists and pins vocabulary)
- Modify: `docs/superpowers/specs/2026-06-19-case-map-and-thread-builder-design.md` (append a "1A fast-follow" note)

- [ ] **Step 1: Update the CLAUDE.md vocabulary table**

Replace the FRONTEND VOCABULARY rows so the new terms are authoritative, keeping the backend-model mapping column:

| Frontend term | Backend model / concept |
|---|---|
| **Case Map** | The Cytoscape graph canvas (was "Web") |
| **Subject** | `Person` or `Organization` (was "Knot") |
| **Thread** | `Finding` (was "Angle") |
| **Relationship** | Summarized `/case-map/` edge (was "Connection") |
| **Observation** | `InvestigatorNote` (was "Quick capture") |
| **Substantiated** | `Finding.status == CONFIRMED` |
| **Set Aside** | `Finding.status == DISMISSED` |
| **Handoff Package** | workflow term; **Referral Package** = agency export |

Add a line: "Banned strings unchanged. Backend model names (`Finding`, `Person`, `Organization`, `Relationship`) are unchanged — only user-facing copy moves."

- [ ] **Step 2: Append the fast-follow note to the spec**

Under §11 Phase 1A, add: "**1A fast-follow (separate small PR):** `shared_address` collector (normalized `Address` links) and `financial_link` collector (`FinancialInstrument` UCC/debtor/secured-party) and the `business_association` split of `Relationship`. The scorer already supports these fields; they default to zero until the collectors land."

- [ ] **Step 3: Commit**

Stage `CLAUDE.md` and the spec always; stage `AGENTS.md` only if it exists and was edited in Step 1.

PowerShell (this workspace's default shell):

```powershell
git add CLAUDE.md docs/superpowers/specs/2026-06-19-case-map-and-thread-builder-design.md
if (Test-Path AGENTS.md) { git add AGENTS.md }
git commit -m "docs(case-map): adopt Subject/Thread/Case Map vocabulary; note 1A fast-follow"
```

Git Bash equivalent (if the executor is using the Bash tool):

```bash
git add CLAUDE.md docs/superpowers/specs/2026-06-19-case-map-and-thread-builder-design.md
[ -f AGENTS.md ] && git add AGENTS.md
git commit -m "docs(case-map): adopt Subject/Thread/Case Map vocabulary; note 1A fast-follow"
```

---

## Self-Review

**Spec coverage (§4 locked contract + §11A test plan):**
- Subject nodes (person/org only) — Task 1 ✓
- Edge-id stability `{min}__{max}` — Tasks 1, 3, 8 ✓
- One edge per subject pair — accumulator keyed by sorted pair, Tasks 3-7 ✓
- strength object (score/level/categories/reasons/counts/handoff) — Task 2 ✓
- `material` cap (≥80 w/o substantiated thread = repeated) — Task 2, Task 7 ✓
- `handoff_ready = is_referral_grade` — Task 7 ✓
- `substantiated_thread_count = CONFIRMED` — Task 2/7 ✓
- co-mention only ⇒ observed — Task 3 ✓
- formal role ⇒ documented — Task 4 ✓
- transaction ⇒ documented + property summarization + one-sided no-edge — Task 5 ✓
- repeated via multiple categories — Task 2 ✓
- substantiated thread ⇒ material — Task 7 ✓
- **SR-015** path attachment — subject pair inferred from `evidence_snapshot` buyer/seller (not trigger-only) — Task 7 ✓ (required test)
- **SR-025** path attachment — subject pair inferred from underlying `PropertyTransaction` via `transaction_examples` (a *different* path than SR-015) — Task 7 ✓ (required test)
- stats `by_level` sums to `edge_count` — Task 8 ✓
- `underlying_relationships.source` enum — Tasks 3-6 emit `co_mention/person_org/property_transaction/manual_relationship` ✓
- `/graph/` untouched — no task modifies `api_case_graph` ✓
- Vocabulary source-of-truth — Task 9 ✓
- **Deferred (documented, by scope choice):** `shared_address` / `financial_link` collectors and the `business_association` split → Task 9 fast-follow note. (Models exist; deferred for Phase 1A scope control, not because anything is unverified.)

**Placeholder scan:** none — every step has runnable code/commands.

**Type consistency:** `build_case_map`, `score_evidence`, `_new_evidence`, `pair_edge_id`, `_collect_*`, `_txn_subject_pairs`, `_subject_ids_from_finding` names are consistent across tasks; evidence dict keys (`doc_ids`, `role_count`, `transaction_count`, `has_family`, `relationship_types`, `evidence_refs`, `underlying`, `thread_refs`) are defined once in Task 2 and used unchanged by Tasks 3-7. Node flag `status_unknown` matches the spec's renamed §4 field.

**Grounding note:** SR-015 stores subjects in `evidence_snapshot.buyer_id/seller_id` (trigger = property); SR-025 contradiction mode references transactions only via `evidence_snapshot.transaction_examples[].transaction_id` (no trigger entity). Both verified against `signal_rules.py` (evaluate_sr015_insider_swap ~L798, evaluate_sr025_990_denies_related_party ~L1116). `signal_type` is read from `signal_rules._RULE_TO_SIGNAL_TYPE` (~L1862), since SR-015 does not write it into evidence.
