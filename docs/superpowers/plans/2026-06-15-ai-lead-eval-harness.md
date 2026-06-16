# AI-Lead Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a faithfulness + overreach evaluation harness that measures whether Catalyst's AI-generated Leads (`Finding`s with `source=AI` from `ai_pattern_augmentation.analyze_case`) are supported by their cited evidence and do not overreach, before that text reaches a legal referral.

**Architecture:** A thin harness wraps the existing generator (`analyze_case`) without modifying it. Hand-authored golden fixture cases are seeded via the ORM (skipping OCR/extraction). The harness runs the generator (real Claude), reads back the persisted Leads, reconstructs the exact evidence the model saw via `build_context_with_refs`, scores each Lead with deterministic guards plus a temperature-0 LLM judge, and asserts a hybrid gate (hard deterministic asserts + measured judge scores under loose floors). Pure scorers stay DB/Claude-free so they run in normal CI; the live-Claude runner is gated behind Django's `@tag("eval")`.

**Tech Stack:** Python 3.12, Django ORM + `django.test.TestCase`/`tag`, the Anthropic SDK via `ai_proxy._get_client()` (`MODEL_SONNET`, temp 0), Ruff (line length 100, double quotes).

**Spec:** `docs/superpowers/specs/2026-06-15-ai-lead-eval-harness-design.md`

**Note on commits:** Tyler commits from his local machine (sandbox git has pre-commit-hook permission issues). Commit steps are included per workflow; if running in the sandbox, stage the files and let Tyler run the commit. All backend tests run in the Docker/PG environment — pure-function tests need only the test DB; `--tag=eval` tests additionally need `ANTHROPIC_API_KEY`.

---

## File Structure

All new files live under `backend/investigations/tests/evals/`:

- `__init__.py` — marks the package.
- `lead_seeder.py` — `seed_case(fixture) -> Case`; pure ORM inserts, no pipeline.
- `lead_fixtures.py` — `GOLDEN_CASES`: the three inline-dict fixtures.
- `lead_scorers.py` — four pure functions: `citation_integrity`, `forbidden_terms_clean`, `faithfulness`, `overreach`.
- `lead_judge.py` — `judge_support`, `judge_overreach` (temp-0 Claude calls) + a thin `_judge_call` wrapper.
- `test_lead_scorers.py` — CI unit tests for the pure scorers (no DB, no Claude).
- `test_lead_seeder.py` — CI unit test for the seeder (DB, no Claude).
- `test_lead_quality.py` — `@tag("eval")` runner, parametrized over `GOLDEN_CASES`.
- `README.md` — how to run + a sample scorecard.

Modified:
- `.gitignore` — ignore `backend/investigations/tests/evals/results/`.

---

## Task 1: Package + Seeder

**Files:**
- Create: `backend/investigations/tests/evals/__init__.py`
- Create: `backend/investigations/tests/evals/lead_seeder.py`
- Test: `backend/investigations/tests/evals/test_lead_seeder.py`

- [ ] **Step 1: Create the package marker**

Create `backend/investigations/tests/evals/__init__.py` (empty file):

```python
```

- [ ] **Step 2: Write the failing seeder test**

Create `backend/investigations/tests/evals/test_lead_seeder.py`:

```python
"""CI unit test for the eval fixture seeder (DB, no Claude)."""

from django.test import TestCase

from investigations.models import Case, Document, FinancialSnapshot, Organization, Person
from investigations.tests.evals.lead_seeder import seed_case

_FIXTURE = {
    "id": "seeder_smoke",
    "case_name": "Eval — Seeder Smoke",
    "persons": [{"key": "sarah", "full_name": "Sarah Example", "role_tags": ["OFFICER"]}],
    "organizations": [
        {"key": "found", "name": "Example Foundation", "ein": "12-3456789", "org_type": "CHARITY"}
    ],
    "documents": [
        {
            "key": "doc990",
            "doc_type": "IRS_990",
            "filename": "2021_990.pdf",
            "extracted_text": "Gross receipts $1,200,000. President Sarah Example 0 0 0.",
        }
    ],
    "financial_snapshots": [
        {
            "org": "found",
            "doc": "doc990",
            "tax_year": 2021,
            "total_revenue": 1_200_000,
            "officer_compensation_total": 0,
        }
    ],
}


class SeedCaseTests(TestCase):
    def test_seeds_a_queryable_case_with_wired_fks(self):
        case = seed_case(_FIXTURE)

        self.assertIsInstance(case, Case)
        self.assertEqual(Person.objects.filter(case=case).count(), 1)
        self.assertEqual(Organization.objects.filter(case=case).count(), 1)
        self.assertEqual(Document.objects.filter(case=case).count(), 1)

        snap = FinancialSnapshot.objects.get(case=case)
        org = Organization.objects.get(case=case)
        doc = Document.objects.get(case=case)
        # Snapshot FKs must resolve to the seeded org + document.
        self.assertEqual(snap.organization_id, org.id)
        self.assertEqual(snap.document_id, doc.id)
        self.assertEqual(snap.total_revenue, 1_200_000)

    def test_distinct_documents_get_distinct_hashes(self):
        fixture = {
            **_FIXTURE,
            "documents": [
                {"key": "a", "doc_type": "DEED", "filename": "a.pdf", "extracted_text": "alpha"},
                {"key": "b", "doc_type": "DEED", "filename": "b.pdf", "extracted_text": "beta"},
            ],
            "financial_snapshots": [],
        }
        case = seed_case(fixture)
        hashes = list(Document.objects.filter(case=case).values_list("sha256_hash", flat=True))
        self.assertEqual(len(hashes), len(set(hashes)))  # unique per (case, sha256)
```

- [ ] **Step 3: Run the test to verify it fails**

Run (from `backend/`): `python manage.py test investigations.tests.evals.test_lead_seeder -v 2`
Expected: FAIL with `ModuleNotFoundError: No module named 'investigations.tests.evals.lead_seeder'`.

- [ ] **Step 4: Write the seeder**

Create `backend/investigations/tests/evals/lead_seeder.py`:

```python
"""Seed a golden fixture into the DB as a real Case — pure ORM, no pipeline.

Skips OCR/extraction so the eval isolates AI-judgment quality from extraction
quality: documents are created with their text already in `extracted_text`.
"""

from __future__ import annotations

import hashlib
from typing import Any

from investigations.models import (
    Case,
    Document,
    FinancialSnapshot,
    OcrStatus,
    Organization,
    Person,
)


def _sha256(fixture_doc: dict[str, Any]) -> str:
    """Use an explicit hash if the fixture set one, else derive one from the
    document's text so distinct documents get distinct hashes (the
    UNIQUE(case, sha256_hash) constraint) and a future duplicate-document
    fixture can force a collision by reusing text or setting `sha256`.
    """
    if fixture_doc.get("sha256"):
        return fixture_doc["sha256"]
    seed = (fixture_doc.get("extracted_text") or fixture_doc["filename"]).encode("utf-8")
    return hashlib.sha256(seed).hexdigest()


def seed_case(fixture: dict[str, Any]) -> Case:
    """Insert a Case plus its persons, organizations, documents, and financial
    snapshots from a fixture dict. Returns the Case. No Claude, no OCR.
    """
    case = Case.objects.create(name=fixture["case_name"], status="ACTIVE")

    persons_by_key: dict[str, Person] = {}
    for p in fixture.get("persons", []):
        persons_by_key[p["key"]] = Person.objects.create(
            case=case,
            full_name=p["full_name"],
            role_tags=list(p.get("role_tags", [])),
        )

    orgs_by_key: dict[str, Organization] = {}
    for o in fixture.get("organizations", []):
        orgs_by_key[o["key"]] = Organization.objects.create(
            case=case,
            name=o["name"],
            ein=o.get("ein", ""),
            org_type=o.get("org_type", "OTHER"),
        )

    docs_by_key: dict[str, Document] = {}
    for d in fixture.get("documents", []):
        text = d.get("extracted_text", "")
        docs_by_key[d["key"]] = Document.objects.create(
            case=case,
            filename=d["filename"],
            file_path=f"eval/{case.id}/{d['filename']}",
            sha256_hash=_sha256(d),
            file_size=max(len(text.encode("utf-8")), 1),
            doc_type=d.get("doc_type", "OTHER"),
            ocr_status=OcrStatus.COMPLETED,
            extracted_text=text,
        )

    for s in fixture.get("financial_snapshots", []):
        FinancialSnapshot.objects.create(
            case=case,
            document=docs_by_key[s["doc"]],
            organization=orgs_by_key[s["org"]] if s.get("org") else None,
            tax_year=s["tax_year"],
            total_revenue=s.get("total_revenue"),
            total_expenses=s.get("total_expenses"),
            officer_compensation_total=s.get("officer_compensation_total"),
            related_party_disclosed=s.get("related_party_disclosed"),
            has_coi_policy=s.get("has_coi_policy"),
        )

    return case
```

- [ ] **Step 5: Run the test to verify it passes**

Run (from `backend/`): `python manage.py test investigations.tests.evals.test_lead_seeder -v 2`
Expected: PASS (2 tests OK).

- [ ] **Step 6: Commit**

```bash
git add backend/investigations/tests/evals/__init__.py \
        backend/investigations/tests/evals/lead_seeder.py \
        backend/investigations/tests/evals/test_lead_seeder.py
git commit -m "test(evals): add golden-fixture case seeder for AI-lead eval harness

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Golden Fixtures

**Files:**
- Create: `backend/investigations/tests/evals/lead_fixtures.py`
- Test: (covered by the seeder test in Task 1 + the runner in Task 5; no separate test — these are data)

- [ ] **Step 1: Write the fixtures module**

Create `backend/investigations/tests/evals/lead_fixtures.py`:

```python
"""Hand-authored golden fixture cases for the AI-lead eval harness.

Each fixture plants facts known by construction. `expect_supported` is advisory
context for the judge (not a hard recall target). `expect_clean: True` marks a
negative control where the generator must invent nothing.
"""

GOLDEN_CASES = [
    {
        "id": "high_revenue_zero_comp",
        "case_name": "Eval — High Revenue Zero Comp",
        "persons": [
            {"key": "sarah", "full_name": "Sarah Example", "role_tags": ["OFFICER"]},
        ],
        "organizations": [
            {"key": "found", "name": "Example Foundation", "ein": "12-3456789",
             "org_type": "CHARITY"},
        ],
        "documents": [
            {"key": "doc990", "doc_type": "IRS_990", "filename": "2021_990.pdf",
             "extracted_text": (
                 "Form 990 (2021). Gross receipts $1,200,000. "
                 "Part VII Section A: President Sarah Example, 40 hrs/week, "
                 "reportable compensation 0  0  0."
             )},
        ],
        # The 990 has a linked snapshot, so analyze_case feeds Claude the
        # STRUCTURED block (revenue + officer comp), not the raw OCR text.
        "financial_snapshots": [
            {"org": "found", "doc": "doc990", "tax_year": 2021,
             "total_revenue": 1_200_000, "total_expenses": 1_100_000,
             "officer_compensation_total": 0},
        ],
        "expect_supported": [
            "a high-revenue organization reports zero officer compensation",
        ],
        "expect_clean": False,
        "thresholds": {"faithfulness": 0.70, "overreach": 0.20},
    },
    {
        "id": "nominal_deed_trap",
        "case_name": "Eval — Nominal Deed Trap",
        "persons": [
            {"key": "buyer", "full_name": "Pat Buyer", "role_tags": ["GRANTEE"]},
            {"key": "seller", "full_name": "Dana Seller", "role_tags": ["GRANTOR"]},
        ],
        "organizations": [],
        "documents": [
            {"key": "deed", "doc_type": "DEED", "filename": "deed_2020.pdf",
             "extracted_text": (
                 "Quitclaim Deed. Grantor Dana Seller conveys to Grantee Pat Buyer "
                 "for the sum of ten dollars ($10.00) and other valuable consideration. "
                 "Recorded 2020-04-02."
             )},
        ],
        "financial_snapshots": [],
        # No relationship between buyer and seller exists anywhere in context.
        # Faithful lead: "review for related-party transfer". Overreaching lead:
        # asserts self-dealing / private benefit as established fact.
        "expect_supported": [
            "a deed records only nominal consideration and warrants a related-party check",
        ],
        "expect_clean": False,
        "thresholds": {"faithfulness": 0.70, "overreach": 0.20},
    },
    {
        "id": "benign_clean_case",
        "case_name": "Eval — Benign Clean Case",
        "persons": [
            {"key": "agent", "full_name": "Chris Agent", "role_tags": ["REGISTERED_AGENT"]},
        ],
        "organizations": [
            {"key": "shop", "name": "Maple Street Hardware LLC", "org_type": "LLC"},
        ],
        "documents": [
            {"key": "filing", "doc_type": "SOS_FILING", "filename": "llc_registration.pdf",
             "extracted_text": (
                 "Articles of Organization for Maple Street Hardware LLC. "
                 "Registered agent: Chris Agent. Status: active. Filed 2019-09-01."
             )},
        ],
        "financial_snapshots": [],
        "expect_supported": [],
        "expect_clean": True,
        "thresholds": {"faithfulness": 1.0, "overreach": 0.0},
    },
]
```

- [ ] **Step 2: Verify the fixtures import and seed**

Run (from `backend/`): `python manage.py shell -c "from investigations.tests.evals.lead_fixtures import GOLDEN_CASES; from investigations.tests.evals.lead_seeder import seed_case; print(len(GOLDEN_CASES))"`
Expected: prints `3` with no import error. (This only imports; seeding inside a shell is optional.)

- [ ] **Step 3: Commit**

```bash
git add backend/investigations/tests/evals/lead_fixtures.py
git commit -m "test(evals): add three golden fixtures (supported, trap, clean control)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Pure Scorers

**Files:**
- Create: `backend/investigations/tests/evals/lead_scorers.py`
- Test: `backend/investigations/tests/evals/test_lead_scorers.py`

- [ ] **Step 1: Write the failing scorer tests**

Create `backend/investigations/tests/evals/test_lead_scorers.py`:

```python
"""CI unit tests for the pure eval scorers (no DB, no Claude)."""

from types import SimpleNamespace
from unittest import TestCase

from investigations.tests.evals import lead_scorers


def _lead(title="Pattern", description="desc", narrative="why", doc_ids=("d1",)):
    """A duck-typed stand-in for a Finding the scorers can read."""
    return SimpleNamespace(
        title=title,
        description=description,
        narrative=narrative,
        evidence_snapshot={"doc_ref_resolution": {f"Doc-{i+1}": d for i, d in enumerate(doc_ids)}},
    )


class CitationIntegrityTests(TestCase):
    def test_true_when_every_cited_doc_is_valid(self):
        leads = [_lead(doc_ids=("d1", "d2"))]
        self.assertTrue(lead_scorers.citation_integrity(leads, {"d1", "d2", "d3"}))

    def test_false_when_a_cited_doc_is_missing(self):
        leads = [_lead(doc_ids=("d1", "ghost"))]
        self.assertFalse(lead_scorers.citation_integrity(leads, {"d1"}))

    def test_true_for_no_leads(self):
        self.assertTrue(lead_scorers.citation_integrity([], {"d1"}))


class ForbiddenTermsTests(TestCase):
    def test_clean_when_no_accusatory_terms(self):
        self.assertTrue(lead_scorers.forbidden_terms_clean([_lead(description="anomalous timing")]))

    def test_dirty_when_accusatory_term_present(self):
        self.assertFalse(lead_scorers.forbidden_terms_clean([_lead(narrative="this is fraud")]))

    def test_word_boundary_does_not_flag_fraternity(self):
        self.assertTrue(lead_scorers.forbidden_terms_clean([_lead(description="college fraternity")]))


class FaithfulnessTests(TestCase):
    def test_all_supported_scores_one(self):
        leads = [_lead(), _lead()]
        score, flags = lead_scorers.faithfulness(leads, [True, True])
        self.assertEqual(score, 1.0)
        self.assertEqual(flags, [True, True])

    def test_half_supported_scores_half(self):
        score, _ = lead_scorers.faithfulness([_lead(), _lead()], [True, False])
        self.assertEqual(score, 0.5)

    def test_no_leads_scores_one_vacuously(self):
        score, flags = lead_scorers.faithfulness([], [])
        self.assertEqual(score, 1.0)
        self.assertEqual(flags, [])


class OverreachTests(TestCase):
    def test_none_overreach_scores_zero(self):
        score, flags = lead_scorers.overreach([_lead(), _lead()], [False, False])
        self.assertEqual(score, 0.0)
        self.assertEqual(flags, [False, False])

    def test_one_of_two_overreaches_scores_half(self):
        score, _ = lead_scorers.overreach([_lead(), _lead()], [True, False])
        self.assertEqual(score, 0.5)

    def test_no_leads_scores_zero(self):
        score, flags = lead_scorers.overreach([], [])
        self.assertEqual(score, 0.0)
        self.assertEqual(flags, [])
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `backend/`): `python manage.py test investigations.tests.evals.test_lead_scorers -v 2`
Expected: FAIL with `ModuleNotFoundError: No module named 'investigations.tests.evals.lead_scorers'`.

- [ ] **Step 3: Write the scorers**

Create `backend/investigations/tests/evals/lead_scorers.py`:

```python
"""Pure scoring + deterministic guard functions for the AI-lead eval harness.

No DB, no Claude — every function takes plain data so it runs in normal CI.
"""

from __future__ import annotations

import re

# Mirror ai_pattern_augmentation._FORBIDDEN_TERM_PATTERN: accusatory stems on
# word boundaries so "fraternity"/"decriminalize" are NOT flagged.
_FORBIDDEN_TERM_PATTERN = re.compile(r"\b(fraud|crim|illeg|guilt)\w*\b", re.IGNORECASE)
_SCAN_ATTRS = ("title", "description", "narrative")


def citation_integrity(leads, valid_doc_ids: set[str]) -> bool:
    """True iff every document id each lead cites exists in valid_doc_ids.

    Regression guard on validate_patterns (which already drops unresolved
    doc_refs before a Lead is persisted) — this should always pass.
    """
    for lead in leads:
        resolution = (lead.evidence_snapshot or {}).get("doc_ref_resolution", {})
        for doc_id in resolution.values():
            if doc_id not in valid_doc_ids:
                return False
    return True


def forbidden_terms_clean(leads) -> bool:
    """True iff no lead's visible text contains an accusatory term.

    Regression guard on the generator's own forbidden-term scan.
    """
    for lead in leads:
        for attr in _SCAN_ATTRS:
            value = getattr(lead, attr, "") or ""
            if _FORBIDDEN_TERM_PATTERN.search(value):
                return False
    return True


def faithfulness(leads, support_flags: list[bool]) -> tuple[float, list[bool]]:
    """Precision: supported leads / total. 1.0 when there are no leads."""
    if not leads:
        return 1.0, []
    supported = sum(1 for flag in support_flags if flag)
    return supported / len(leads), list(support_flags)


def overreach(leads, overreach_flags: list[bool]) -> tuple[float, list[bool]]:
    """Inverse risk: over-claiming leads / total. 0.0 when there are no leads."""
    if not leads:
        return 0.0, []
    over = sum(1 for flag in overreach_flags if flag)
    return over / len(leads), list(overreach_flags)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `backend/`): `python manage.py test investigations.tests.evals.test_lead_scorers -v 2`
Expected: PASS (12 tests OK).

- [ ] **Step 5: Commit**

```bash
git add backend/investigations/tests/evals/lead_scorers.py \
        backend/investigations/tests/evals/test_lead_scorers.py
git commit -m "test(evals): add pure faithfulness/overreach scorers + guards

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: LLM Judge

**Files:**
- Create: `backend/investigations/tests/evals/lead_judge.py`
- Test: `backend/investigations/tests/evals/test_lead_judge.py` (CI — mocks the client)

- [ ] **Step 1: Write the failing judge test (mocked client, CI-safe)**

Create `backend/investigations/tests/evals/test_lead_judge.py`:

```python
"""CI unit test for the judge's parsing/flag mapping (Claude client mocked)."""

import json
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from investigations.tests.evals import lead_judge


def _lead(doc_refs=("Doc-1",), description="desc", narrative="why"):
    return SimpleNamespace(
        title="Pattern",
        description=description,
        narrative=narrative,
        evidence_snapshot={"doc_refs": list(doc_refs)},
    )


def _mock_client_returning(payload: dict):
    client = MagicMock()
    message = SimpleNamespace(content=[SimpleNamespace(text=json.dumps(payload))])
    client.messages.create.return_value = message
    return client


_CONTEXT = {
    "documents": [{"ref": "Doc-1", "doc_type": "IRS_990", "text_excerpt": "Gross receipts $1.2M..."}],
    "entities": {"persons": [], "organizations": [], "properties": []},
    "financial_snapshots": [],
}
_DOC_REF_MAP = {"Doc-1": "uuid-1"}


class JudgeSupportTests(TestCase):
    @patch("investigations.tests.evals.lead_judge.ai_proxy._get_client")
    def test_maps_results_to_per_lead_flags(self, mock_get_client):
        mock_get_client.return_value = _mock_client_returning(
            {"results": [{"index": 0, "supported": True}, {"index": 1, "supported": False}]}
        )
        flags = lead_judge.judge_support([_lead(), _lead()], _CONTEXT)
        self.assertEqual(flags, [True, False])

    def test_no_leads_returns_empty_without_calling_claude(self):
        # No patch needed: must short-circuit before any client call.
        self.assertEqual(lead_judge.judge_support([], _CONTEXT), [])


class JudgeOverreachTests(TestCase):
    @patch("investigations.tests.evals.lead_judge.ai_proxy._get_client")
    def test_maps_results_to_per_lead_flags(self, mock_get_client):
        mock_get_client.return_value = _mock_client_returning(
            {"results": [{"index": 0, "overreaches": False}]}
        )
        flags = lead_judge.judge_overreach([_lead()], _CONTEXT)
        self.assertEqual(flags, [False])

    @patch("investigations.tests.evals.lead_judge.ai_proxy._get_client")
    def test_unparseable_response_raises(self, mock_get_client):
        client = MagicMock()
        client.messages.create.return_value = SimpleNamespace(
            content=[SimpleNamespace(text="not json")]
        )
        mock_get_client.return_value = client
        with self.assertRaises(lead_judge.JudgeError):
            lead_judge.judge_overreach([_lead()], _CONTEXT)
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `backend/`): `python manage.py test investigations.tests.evals.test_lead_judge -v 2`
Expected: FAIL with `ModuleNotFoundError: No module named 'investigations.tests.evals.lead_judge'`.

- [ ] **Step 3: Write the judge**

Create `backend/investigations/tests/evals/lead_judge.py`:

```python
"""LLM-as-judge for the AI-lead eval harness.

Two temperature-0 Claude calls (one per axis). Each receives the leads and the
exact evidence the generator saw, and returns a per-lead boolean. A parse
failure raises JudgeError so a broken judge fails the eval loudly rather than
passing silently.
"""

from __future__ import annotations

import json
from typing import Any

from investigations import ai_proxy

MODEL = ai_proxy.MODEL_SONNET


class JudgeError(RuntimeError):
    """The judge returned output that could not be parsed into per-lead flags."""


_SUPPORT_SYSTEM = (
    "You are the faithfulness judge for a fraud-investigation tool. You are given "
    "LEADS (each an index, a description, and a rationale) and the EVIDENCE the tool "
    "saw (document excerpts and structured context). For EACH lead decide: do the "
    "cited excerpts and structured context actually SUPPORT the description + "
    "rationale? A lead is supported only if the evidence substantiates it; if it "
    "asserts anything not present in the evidence, it is NOT supported. Respond with "
    'JSON only: {"results": [{"index": <int>, "supported": <bool>}, ...]} with one '
    "entry per lead."
)

_OVERREACH_SYSTEM = (
    "You are the overreach judge for a fraud-investigation tool. You are given LEADS "
    "(each an index, a description, and a rationale) and the CONTEXT the tool saw. A "
    "lead OVERREACHES if it: asserts a verdict or accusation as established fact "
    "(e.g. self-dealing, private benefit, wrongdoing) rather than a pattern to "
    "review; references an entity or dollar amount not present in the context; or "
    "states something the structured context contradicts. Surfacing a pattern and "
    "recommending review is NOT overreach. Respond with JSON only: "
    '{"results": [{"index": <int>, "overreaches": <bool>}, ...]} with one entry per lead.'
)


def _lead_payload(leads) -> list[dict[str, Any]]:
    return [
        {
            "index": i,
            "description": getattr(lead, "description", "") or "",
            "rationale": getattr(lead, "narrative", "") or "",
            "doc_refs": (lead.evidence_snapshot or {}).get("doc_refs", []),
        }
        for i, lead in enumerate(leads)
    ]


def _judge_call(system: str, payload: dict[str, Any]) -> dict[str, Any]:
    """One temperature-0 structured call. Raises JudgeError on unparseable JSON."""
    client = ai_proxy._get_client()
    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        temperature=0,
        system=system,
        messages=[{"role": "user", "content": json.dumps(payload)}],
    )
    raw = (response.content[0].text or "").strip()
    if raw.startswith("```"):
        raw = "\n".join(line for line in raw.split("\n") if not line.strip().startswith("```")).strip()
    try:
        return json.loads(raw)
    except (ValueError, TypeError) as exc:
        raise JudgeError(f"Judge returned unparseable JSON: {exc}") from exc


def _flags_from(results: dict[str, Any], key: str, n: int) -> list[bool]:
    """Map a {"results": [{"index", <key>}]} payload to an ordered flag list."""
    by_index = {r.get("index"): bool(r.get(key)) for r in results.get("results", [])}
    if set(by_index) != set(range(n)):
        raise JudgeError(f"Judge results did not cover indices 0..{n - 1}: {sorted(by_index)}")
    return [by_index[i] for i in range(n)]


def judge_support(leads, context: dict[str, Any]) -> list[bool]:
    """Per-lead: is the lead supported by its cited evidence? Empty for no leads."""
    if not leads:
        return []
    payload = {
        "leads": _lead_payload(leads),
        "evidence": {
            "documents": context.get("documents", []),
            "entities": context.get("entities", {}),
            "financial_snapshots": context.get("financial_snapshots", []),
        },
    }
    return _flags_from(_judge_call(_SUPPORT_SYSTEM, payload), "supported", len(leads))


def judge_overreach(leads, context: dict[str, Any]) -> list[bool]:
    """Per-lead: does the lead assert beyond the context? Empty for no leads."""
    if not leads:
        return []
    payload = {
        "leads": _lead_payload(leads),
        "context": {
            "documents": context.get("documents", []),
            "entities": context.get("entities", {}),
            "financial_snapshots": context.get("financial_snapshots", []),
        },
    }
    return _flags_from(_judge_call(_OVERREACH_SYSTEM, payload), "overreaches", len(leads))
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `backend/`): `python manage.py test investigations.tests.evals.test_lead_judge -v 2`
Expected: PASS (4 tests OK).

- [ ] **Step 5: Commit**

```bash
git add backend/investigations/tests/evals/lead_judge.py \
        backend/investigations/tests/evals/test_lead_judge.py
git commit -m "test(evals): add temp-0 LLM judge for support + overreach

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Eval Runner + Results + Docs

**Files:**
- Create: `backend/investigations/tests/evals/test_lead_quality.py`
- Create: `backend/investigations/tests/evals/README.md`
- Modify: `.gitignore` (repo root)

- [ ] **Step 1: Add the results dir to .gitignore**

Append to the repo-root `.gitignore`:

```gitignore

# Eval harness run artifacts (regenerated per run)
backend/investigations/tests/evals/results/
```

- [ ] **Step 2: Write the eval runner**

Create `backend/investigations/tests/evals/test_lead_quality.py`. This is a live-Claude test gated behind `@tag("eval")`; it is excluded from the default suite. It seeds each fixture, runs the real generator, reads the persisted Leads back, reconstructs the evidence, scores, prints a scorecard, and asserts the hybrid gate.

```python
"""Live-Claude eval: faithfulness + overreach of AI Leads over golden fixtures.

Gated behind @tag("eval") — excluded from CI. Run explicitly with a real key:

    python manage.py test investigations.tests.evals.test_lead_quality --tag=eval

Needs ANTHROPIC_API_KEY. Writes results/lead_eval.json (gitignored).
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from django.test import TestCase, tag

from investigations.ai_pattern_augmentation import analyze_case, build_context_with_refs
from investigations.models import Finding, FindingSource
from investigations.tests.evals import lead_judge, lead_scorers
from investigations.tests.evals.lead_fixtures import GOLDEN_CASES
from investigations.tests.evals.lead_seeder import seed_case

_RESULTS_DIR = Path(__file__).parent / "results"


@tag("eval")
class LeadQualityEval(TestCase):
    """One real generation + two judge calls per fixture."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.scorecard: list[dict] = []

    @classmethod
    def tearDownClass(cls):
        _RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        (_RESULTS_DIR / "lead_eval.json").write_text(json.dumps(cls.scorecard, indent=2))
        super().tearDownClass()

    def test_fixtures(self):
        self.assertTrue(os.environ.get("ANTHROPIC_API_KEY"), "ANTHROPIC_API_KEY required")

        for fixture in GOLDEN_CASES:
            with self.subTest(fixture=fixture["id"]):
                case = seed_case(fixture)
                analyze_case(case.id)  # real Claude; persists Finding rows
                leads = list(Finding.objects.filter(case=case, source=FindingSource.AI))
                context, doc_ref_map, _ = build_context_with_refs(case)
                valid_doc_ids = {str(d.id) for d in case.documents.all()}

                # --- Hard deterministic gate ---
                self.assertTrue(
                    lead_scorers.citation_integrity(leads, valid_doc_ids),
                    f"[{fixture['id']}] a lead cites a document not in the case",
                )
                self.assertTrue(
                    lead_scorers.forbidden_terms_clean(leads),
                    f"[{fixture['id']}] a lead contains accusatory language",
                )
                if fixture["expect_clean"]:
                    self.assertEqual(
                        len(leads), 0,
                        f"[{fixture['id']}] negative control produced {len(leads)} leads",
                    )

                # --- Measured judge gate ---
                support = lead_judge.judge_support(leads, context)
                over = lead_judge.judge_overreach(leads, context)
                faith, faith_flags = lead_scorers.faithfulness(leads, support)
                orr, over_flags = lead_scorers.overreach(leads, over)

                self._print_scorecard(fixture, leads, faith_flags, over_flags, faith, orr)
                type(self).scorecard.append({
                    "fixture": fixture["id"], "n_leads": len(leads),
                    "faithfulness": faith, "overreach": orr,
                })

                thr = fixture["thresholds"]
                self.assertGreaterEqual(
                    faith, thr["faithfulness"],
                    f"[{fixture['id']}] faithfulness {faith:.2f} < {thr['faithfulness']}",
                )
                self.assertLessEqual(
                    orr, thr["overreach"],
                    f"[{fixture['id']}] overreach {orr:.2f} > {thr['overreach']}",
                )

    def _print_scorecard(self, fixture, leads, faith_flags, over_flags, faith, orr):
        print(f"\n=== {fixture['id']} — {len(leads)} lead(s) ===")
        for i, lead in enumerate(leads):
            faith_mark = "✓" if faith_flags[i] else "✗"
            over_mark = "⚠" if over_flags[i] else "·"
            print(f"  [{faith_mark} support][{over_mark} overreach] {lead.title[:70]}")
        print(f"  faithfulness={faith:.2f}  overreach={orr:.2f}")
```

- [ ] **Step 3: Run the pure suite to confirm nothing regressed and the runner is excluded by default**

Run (from `backend/`): `python manage.py test investigations.tests.evals --exclude-tag=eval -v 2`
Expected: PASS — runs the seeder + scorer + judge unit tests (18 tests) and SKIPS `LeadQualityEval` (no Claude call, no key needed).

- [ ] **Step 4: Run the eval once against live Claude to confirm it executes end-to-end**

Run (from `backend/`, with a real key in the environment):
`python manage.py test investigations.tests.evals.test_lead_quality --tag=eval -v 2`
Expected: prints a per-fixture scorecard; the three fixtures meet their thresholds; `results/lead_eval.json` is written. (If a threshold legitimately fails, that is a real signal about generator quality — record it, do not loosen the floor reflexively.)

- [ ] **Step 5: Write the README**

Create `backend/investigations/tests/evals/README.md`:

```markdown
# AI-Lead Eval Harness

Measures whether Catalyst's AI Leads (`Finding`s with `source=AI` from
`analyze_case`) are **faithful** to their cited evidence and do not **overreach**
before that text reaches a referral.

## Run it

Pure unit tests (no Claude — run in CI):

    python manage.py test investigations.tests.evals --exclude-tag=eval

Full eval (live Claude — needs ANTHROPIC_API_KEY, excluded from CI):

    python manage.py test investigations.tests.evals.test_lead_quality --tag=eval

## What it asserts

- **Hard (deterministic):** every cited `Doc-N` resolves to a case document;
  no accusatory language survives; negative-control fixtures produce zero leads.
- **Measured (temp-0 LLM judge):** faithfulness ≥ 0.70, overreach ≤ 0.20
  (per-fixture thresholds in `lead_fixtures.py`).

## Sample scorecard

    === high_revenue_zero_comp — 1 lead(s) ===
      [✓ support][· overreach] High-revenue organization reports zero officer pay
      faithfulness=1.00  overreach=0.00
    === nominal_deed_trap — 1 lead(s) ===
      [✓ support][· overreach] Nominal-consideration deed warrants related-party review
      faithfulness=1.00  overreach=0.00
    === benign_clean_case — 0 lead(s) ===
      faithfulness=1.00  overreach=0.00

Results are written to `results/lead_eval.json` (gitignored).

## CI note

CI must run the suite with `--exclude-tag=eval` so the live-Claude test never
runs without a key. The pure tests (seeder, scorers, judge parsing) run normally.
```

- [ ] **Step 6: Commit**

```bash
git add backend/investigations/tests/evals/test_lead_quality.py \
        backend/investigations/tests/evals/README.md \
        .gitignore
git commit -m "test(evals): add gated live-Claude lead-quality runner + docs

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** §4 components → Tasks 1–5; §4 hybrid gate → Task 5 runner; §5 fixtures → Task 2; §7 harness tests → Tasks 1,3,4 unit tests. The one deliberate deviation from the spec: the spec wrote `@pytest.mark.eval` / `pytest -m eval`; Catalyst has no pytest config and runs Django's test runner, so the plan uses `@tag("eval")` + `--tag`/`--exclude-tag`. Same intent.
- **CI exclusion:** the eval is only safe because CI runs `--exclude-tag=eval`. Confirm Catalyst's CI invocation adds that flag (README documents it); if CI runs a bare `manage.py test`, add the flag there in a follow-up.
- **990 evidence path:** `high_revenue_zero_comp` attaches a `FinancialSnapshot` to its 990, so `analyze_case` feeds Claude the structured block (revenue + officer comp), not the raw OCR excerpt — the judge sees the same structured context via `build_context_with_refs`, so the support check is apples-to-apples.
```
