# AI Harness Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Catalyst's AI harness more reliable, auditable, and evaluable without changing the core product workflow.

**Architecture:** Add one shared Anthropic gateway for all model calls, then migrate AI modules to use it incrementally. Strengthen chain-of-custody by recording model-call metadata, improve retrieval with a small hybrid keyword search layer, and expand the Lead eval harness with more negative controls.

**Tech Stack:** Django 5.2, Postgres, Django-Q2 `SearchJob`, Anthropic Python SDK, Django test runner, Ruff, TypeScript/Vite for frontend type checks.

---

## Current Shape

The AI harness currently has four useful layers:

- `backend/investigations/ai_extraction.py` — Intake extraction from document text.
- `backend/investigations/ai_proxy.py` — case Q&A, context building, rate limiting, cache, tool-use loop.
- `backend/investigations/ai_pattern_augmentation.py` — Lead generation from case context.
- `backend/investigations/tests/evals/` — deterministic scorers plus gated live-Claude evals.

The improvement path should preserve the existing product vocabulary:

- User-visible extraction role is **Intake**.
- User-visible reasoning/pattern role is **Lead**.
- Do not expose model/vendor names in frontend text.

---

## File Map

Create:

- `backend/investigations/ai_gateway.py`  
  Shared Anthropic client, retry policy, model-call result object, safe JSON parsing, and optional audit metadata.

- `backend/investigations/tests/test_ai_gateway.py`  
  Pure/mocked tests for retry behavior, JSON parsing, usage extraction, and non-JSON handling.

- `backend/investigations/retrieval.py`  
  Case-scoped document retrieval helper used by AI tools. Starts with weighted keyword scoring; keeps the old substring behavior as one signal.

- `backend/investigations/tests/test_retrieval.py`  
  Tests for ranking, snippets, case scoping, OCR-empty filtering, and limit handling.

Modify:

- `backend/investigations/ai_proxy.py`  
  Replace direct Anthropic calls with `ai_gateway`; route `search_case_documents` through `retrieval.py`.

- `backend/investigations/ai_pattern_augmentation.py`  
  Replace direct Anthropic call wrapper with `ai_gateway`; preserve existing validation and persistence.

- `backend/investigations/ai_extraction.py`  
  Replace direct Anthropic client usage with `ai_gateway`; preserve parser outputs.

- `backend/investigations/tests/test_ai_endpoints.py`  
  Add assertions that `SearchJob.query_params` does not store conversation history and keeps only expected fields.

- `backend/investigations/tests/test_ai_pattern.py`  
  Update mocks to patch the gateway call rather than module-private client calls.

- `backend/investigations/tests/evals/lead_fixtures.py`  
  Add overreach and negative-control fixtures.

- `backend/investigations/tests/evals/test_lead_quality.py`  
  Add scorecard fields for deterministic failures by fixture.

- `docs/architecture/api-contract.md`  
  Document AI job result shape and chain-of-custody metadata fields.

---

## Task 1: Shared Anthropic Gateway

**Files:**
- Create: `backend/investigations/ai_gateway.py`
- Create: `backend/investigations/tests/test_ai_gateway.py`

- [ ] **Step 1: Write the failing gateway tests**

Create `backend/investigations/tests/test_ai_gateway.py`:

```python
import json
from unittest.mock import MagicMock, patch

import anthropic
from django.test import SimpleTestCase

from investigations import ai_gateway


class AiGatewayTests(SimpleTestCase):
    def _response(self, text='{"ok": true}', input_tokens=12, output_tokens=5):
        response = MagicMock()
        response.content = [MagicMock(text=text)]
        response.usage.input_tokens = input_tokens
        response.usage.output_tokens = output_tokens
        return response

    @patch("investigations.ai_gateway._get_client")
    def test_call_json_returns_payload_and_usage(self, mock_get_client):
        client = MagicMock()
        client.messages.create.return_value = self._response()
        mock_get_client.return_value = client

        result = ai_gateway.call_json(
            system="system",
            user_message="user",
            model="claude-sonnet-4-6",
            temperature=0,
        )

        self.assertEqual(result.payload, {"ok": True})
        self.assertEqual(result.model, "claude-sonnet-4-6")
        self.assertEqual(result.input_tokens, 12)
        self.assertEqual(result.output_tokens, 5)
        self.assertIsNone(result.error)

    @patch("investigations.ai_gateway._get_client")
    def test_call_json_strips_markdown_fences(self, mock_get_client):
        client = MagicMock()
        client.messages.create.return_value = self._response("```json\n{\"ok\": true}\n```")
        mock_get_client.return_value = client

        result = ai_gateway.call_json(
            system="system",
            user_message="user",
            model="claude-sonnet-4-6",
            temperature=0,
        )

        self.assertEqual(result.payload, {"ok": True})

    @patch("investigations.ai_gateway._get_client")
    def test_call_json_returns_error_on_unparseable_json(self, mock_get_client):
        client = MagicMock()
        client.messages.create.return_value = self._response("not json")
        mock_get_client.return_value = client

        result = ai_gateway.call_json(
            system="system",
            user_message="user",
            model="claude-sonnet-4-6",
            temperature=0,
        )

        self.assertIsNone(result.payload)
        self.assertEqual(result.error, "AI returned non-JSON response")

    @patch("investigations.ai_gateway.time.sleep")
    @patch("investigations.ai_gateway._get_client")
    def test_retries_transient_errors(self, mock_get_client, mock_sleep):
        client = MagicMock()
        client.messages.create.side_effect = [
            anthropic.APIConnectionError(request=MagicMock()),
            self._response(),
        ]
        mock_get_client.return_value = client

        result = ai_gateway.call_json(
            system="system",
            user_message="user",
            model="claude-sonnet-4-6",
            temperature=0,
        )

        self.assertEqual(result.payload, {"ok": True})
        self.assertEqual(client.messages.create.call_count, 2)
```

- [ ] **Step 2: Run the gateway tests and verify they fail**

Run:

```bash
cd backend
python manage.py test investigations.tests.test_ai_gateway
```

Expected: FAIL because `investigations.ai_gateway` does not exist.

- [ ] **Step 3: Implement the gateway**

Create `backend/investigations/ai_gateway.py`:

```python
from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any

import anthropic

logger = logging.getLogger("catalyst.ai_gateway")

MODEL_HAIKU = "claude-haiku-4-5-20251001"
MODEL_SONNET = "claude-sonnet-4-6"
DEFAULT_MAX_TOKENS = 4096
MAX_ATTEMPTS = 3
BACKOFF_BASE = 2.0

_API_KEY: str | None = None


@dataclass
class AiCallResult:
    payload: dict[str, Any] | None
    raw_text: str
    model: str
    input_tokens: int
    output_tokens: int
    error: str | None = None


def _get_api_key() -> str:
    global _API_KEY
    if _API_KEY is None:
        _API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
    if not _API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY not set.")
    return _API_KEY


def _get_client():
    return anthropic.Anthropic(api_key=_get_api_key())


def strip_json_fences(raw: str) -> str:
    cleaned = (raw or "").strip()
    if cleaned.startswith("```"):
        lines = [
            line
            for line in cleaned.splitlines()
            if not line.strip().startswith("```")
        ]
        cleaned = "\n".join(lines).strip()
    return cleaned


def _empty_error(model: str, error: str) -> AiCallResult:
    return AiCallResult(
        payload=None,
        raw_text="",
        model=model,
        input_tokens=0,
        output_tokens=0,
        error=error,
    )


def call_json(
    *,
    system: str,
    user_message: str,
    model: str,
    temperature: float,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> AiCallResult:
    client = _get_client()
    last_exc: Exception | None = None

    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            response = client.messages.create(
                model=model,
                max_tokens=max_tokens,
                temperature=temperature,
                system=system,
                messages=[{"role": "user", "content": user_message}],
            )
            raw = response.content[0].text or ""
            try:
                payload = json.loads(strip_json_fences(raw))
            except (ValueError, TypeError):
                logger.warning("AI returned non-JSON response: %s", raw[:200])
                return AiCallResult(
                    payload=None,
                    raw_text=raw,
                    model=model,
                    input_tokens=response.usage.input_tokens,
                    output_tokens=response.usage.output_tokens,
                    error="AI returned non-JSON response",
                )
            return AiCallResult(
                payload=payload,
                raw_text=raw,
                model=model,
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
            )
        except (
            anthropic.RateLimitError,
            anthropic.APIConnectionError,
            anthropic.APITimeoutError,
            anthropic.InternalServerError,
        ) as exc:
            last_exc = exc
            if attempt < MAX_ATTEMPTS:
                time.sleep(BACKOFF_BASE**attempt)
                continue
        except Exception as exc:
            logger.exception("AI call failed: %s", exc)
            return _empty_error(model, str(exc))

    logger.error("AI call failed after %d attempts: %s", MAX_ATTEMPTS, last_exc)
    return _empty_error(model, f"Claude API unavailable after {MAX_ATTEMPTS} attempts")
```

- [ ] **Step 4: Run the gateway tests**

Run:

```bash
cd backend
python manage.py test investigations.tests.test_ai_gateway
```

Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add backend/investigations/ai_gateway.py backend/investigations/tests/test_ai_gateway.py
git commit -m "feat(ai): add shared Anthropic gateway"
```

---

## Task 2: Migrate Pattern Analysis To Gateway

**Files:**
- Modify: `backend/investigations/ai_pattern_augmentation.py`
- Modify: `backend/investigations/tests/test_ai_pattern.py`

- [ ] **Step 1: Update the pattern tests to patch `ai_gateway.call_json`**

In `backend/investigations/tests/test_ai_pattern.py`, change the API-error tests to patch:

```python
@patch("investigations.ai_pattern_augmentation.ai_gateway.call_json")
def test_call_claude_raises_on_api_error(self, mock_call_json):
    mock_call_json.return_value.error = "Claude API exploded"
    mock_call_json.return_value.payload = None
    mock_call_json.return_value.raw_text = ""

    with self.assertRaises(ai_pattern_augmentation.AIPatternError):
        ai_pattern_augmentation.call_claude(
            {"case": {"name": "x"}, "documents": [], "entities": {}}
        )
```

Keep existing tests for `parse_response`, `validate_patterns`, context size, doc refs, and finding writes unchanged.

- [ ] **Step 2: Run the pattern tests and verify failure**

Run:

```bash
cd backend
python manage.py test investigations.tests.test_ai_pattern --keepdb
```

Expected: FAIL until `ai_pattern_augmentation` imports and uses `ai_gateway`.

- [ ] **Step 3: Replace direct Claude call with gateway**

In `backend/investigations/ai_pattern_augmentation.py`:

```python
from investigations import ai_gateway, ai_proxy
```

Replace the body of `call_claude(context)` with:

```python
def call_claude(context: dict[str, Any]) -> str:
    user_message = (
        "Here is the case. Return patterns as strict JSON per the schema in "
        "the system prompt.\n\n<case>\n" + json.dumps(context) + "\n</case>"
    )
    result = ai_gateway.call_json(
        system=SYSTEM_PROMPT,
        user_message=user_message,
        model=ai_proxy.MODEL_SONNET,
        temperature=0.2,
        max_tokens=4096,
    )
    if result.error or result.payload is None:
        raise AIPatternError(result.error or "Claude API call failed")
    return json.dumps(result.payload)
```

Leave `parse_response()` unchanged so downstream behavior is stable.

- [ ] **Step 4: Run pattern tests**

Run:

```bash
cd backend
python manage.py test investigations.tests.test_ai_pattern --keepdb
```

Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add backend/investigations/ai_pattern_augmentation.py backend/investigations/tests/test_ai_pattern.py
git commit -m "refactor(ai): route Lead pattern calls through shared gateway"
```

---

## Task 3: Add Case-Scoped Retrieval Helper

**Files:**
- Create: `backend/investigations/retrieval.py`
- Create: `backend/investigations/tests/test_retrieval.py`
- Modify: `backend/investigations/ai_proxy.py`

- [ ] **Step 1: Write retrieval tests**

Create `backend/investigations/tests/test_retrieval.py`:

```python
from django.test import TestCase

from investigations.models import Case, Document
from investigations.retrieval import search_case_documents


class RetrievalTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(name="Retrieval Case")
        self.other_case = Case.objects.create(name="Other Case")

    def _doc(self, case, filename, text):
        return Document.objects.create(
            case=case,
            filename=filename,
            file_path=f"cases/test/{filename}",
            sha256_hash=(filename.replace(".", "")[:1] or "x") * 64,
            file_size=1024,
            doc_type="DEED",
            extracted_text=text,
        )

    def test_returns_case_scoped_matches(self):
        self._doc(self.case, "match.pdf", "Sarah Mitchell signed the warranty deed.")
        self._doc(self.other_case, "other.pdf", "Sarah Mitchell appears elsewhere.")

        result = search_case_documents(self.case, "Sarah Mitchell")

        self.assertEqual(result["match_count"], 1)
        self.assertEqual(result["results"][0]["display_name"], "match.pdf")

    def test_ranks_more_term_hits_first(self):
        self._doc(self.case, "weak.pdf", "Sarah signed a document.")
        self._doc(self.case, "strong.pdf", "Sarah Mitchell signed. Mitchell appears again.")

        result = search_case_documents(self.case, "Sarah Mitchell")

        self.assertEqual(result["results"][0]["display_name"], "strong.pdf")

    def test_excludes_empty_ocr_text(self):
        self._doc(self.case, "empty.pdf", "")

        result = search_case_documents(self.case, "anything")

        self.assertEqual(result["match_count"], 0)
        self.assertEqual(result["results"], [])
```

- [ ] **Step 2: Run retrieval tests and verify failure**

Run:

```bash
cd backend
python manage.py test investigations.tests.test_retrieval --keepdb
```

Expected: FAIL because `investigations.retrieval` does not exist.

- [ ] **Step 3: Implement retrieval helper**

Create `backend/investigations/retrieval.py`:

```python
from __future__ import annotations

import re

from investigations.models import Document


def _terms(query: str) -> list[str]:
    return [term.lower() for term in re.findall(r"[A-Za-z0-9][A-Za-z0-9-]+", query)]


def _snippet(text: str, query: str, terms: list[str], width: int = 220) -> tuple[str, int]:
    lower = text.lower()
    q = query.lower().strip()
    idx = lower.find(q) if q else -1
    if idx < 0:
        positions = [lower.find(term) for term in terms if lower.find(term) >= 0]
        idx = min(positions) if positions else 0
    start = max(0, idx - width)
    end = min(len(text), idx + len(query) + width)
    return text[start:end], idx


def _score(text: str, query: str, terms: list[str]) -> int:
    lower = text.lower()
    score = 0
    if query.lower().strip() in lower:
        score += 25
    for term in terms:
        score += lower.count(term) * 5
    return score


def search_case_documents(case, query: str, limit: int = 10) -> dict:
    if not query or not query.strip():
        return {"query": query, "match_count": 0, "results": []}

    terms = _terms(query)
    if not terms:
        return {"query": query, "match_count": 0, "results": []}

    candidates = (
        Document.objects.filter(case=case)
        .exclude(extracted_text__isnull=True)
        .exclude(extracted_text__exact="")
    )

    ranked = []
    for doc in candidates:
        text = doc.extracted_text or ""
        score = _score(text, query, terms)
        if score <= 0:
            continue
        snippet, match_position = _snippet(text, query, terms)
        ranked.append((score, doc.uploaded_at, doc, snippet, match_position))

    ranked.sort(key=lambda item: (item[0], item[1]), reverse=True)
    results = [
        {
            "document_id": str(doc.pk),
            "display_name": doc.display_name or doc.filename,
            "doc_type": doc.doc_type,
            "sha256": doc.sha256_hash,
            "snippet": snippet,
            "match_position": match_position,
            "score": score,
        }
        for score, _uploaded_at, doc, snippet, match_position in ranked[:limit]
    ]
    return {"query": query, "match_count": len(results), "results": results}
```

- [ ] **Step 4: Route AI tool search through retrieval helper**

In `backend/investigations/ai_proxy.py`, replace `_tool_search_case_documents()` with:

```python
def _tool_search_case_documents(case, query: str, limit: int = 10) -> dict:
    from .retrieval import search_case_documents

    return search_case_documents(case, query=query, limit=limit)
```

- [ ] **Step 5: Run retrieval and AI endpoint tests**

Run:

```bash
cd backend
python manage.py test investigations.tests.test_retrieval investigations.tests.test_ai_endpoints --keepdb
```

Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add backend/investigations/retrieval.py backend/investigations/tests/test_retrieval.py backend/investigations/ai_proxy.py
git commit -m "feat(ai): add case-scoped retrieval helper"
```

---

## Task 4: Migrate `ai_proxy._call_ai` To Gateway

**Files:**
- Modify: `backend/investigations/ai_proxy.py`
- Modify: `backend/investigations/tests/test_ai_endpoints.py`

- [ ] **Step 1: Add endpoint privacy regression test**

In `backend/investigations/tests/test_ai_endpoints.py`, add:

```python
def test_query_params_do_not_store_full_conversation_history(self):
    history = [
        {"role": "user", "content": "sensitive prior note"},
        {"role": "assistant", "content": "sensitive prior answer"},
    ]
    response = self.client.post(
        self.url,
        data=json.dumps({"question": "follow-up", "conversation_history": history}),
        content_type="application/json",
    )

    self.assertEqual(response.status_code, 202)
    job = SearchJob.objects.get(pk=response.json()["job_id"])
    self.assertEqual(sorted(job.query_params.keys()), ["case_id", "history_ref", "question"])
    self.assertNotIn("sensitive prior note", json.dumps(job.query_params))
```

- [ ] **Step 2: Refactor `_call_ai` to use gateway**

In `backend/investigations/ai_proxy.py`, import:

```python
from investigations import ai_gateway
```

Replace `_call_ai()` with:

```python
def _call_ai(
    system_prompt: str,
    user_message: str,
    model: str = MODEL_SONNET,
    temperature: float = 0.2,
    max_tokens: int = MAX_TOKENS,
) -> dict:
    result = ai_gateway.call_json(
        system=system_prompt,
        user_message=user_message,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    if result.error or result.payload is None:
        return {"error": result.error or "AI call failed"}
    payload = dict(result.payload)
    payload["_model"] = result.model
    payload["_usage"] = {
        "input_tokens": result.input_tokens,
        "output_tokens": result.output_tokens,
    }
    return payload
```

Do not change `ai_ask()` tool loop in this task. It needs raw tool-use responses and should stay separate until a later, more careful migration.

- [ ] **Step 3: Run tests**

Run:

```bash
cd backend
python manage.py test investigations.tests.test_ai_gateway investigations.tests.test_ai_endpoints --keepdb
ruff check investigations\ai_gateway.py investigations\ai_proxy.py investigations\tests\test_ai_gateway.py investigations\tests\test_ai_endpoints.py
```

Expected: OK and Ruff clean.

- [ ] **Step 4: Commit**

```bash
git add backend/investigations/ai_proxy.py backend/investigations/tests/test_ai_endpoints.py
git commit -m "refactor(ai): use shared gateway for JSON proxy calls"
```

---

## Task 5: Expand Lead Eval Fixtures

**Files:**
- Modify: `backend/investigations/tests/evals/lead_fixtures.py`
- Modify: `backend/investigations/tests/evals/test_lead_scorers.py`
- Modify: `backend/investigations/tests/evals/README.md`

- [ ] **Step 1: Add pure scorer tests for fixture expectations**

In `backend/investigations/tests/evals/test_lead_scorers.py`, add:

```python
from investigations.tests.evals.lead_fixtures import GOLDEN_CASES


def test_fixture_ids_are_unique():
    ids = [fixture["id"] for fixture in GOLDEN_CASES]
    assert len(ids) == len(set(ids))


def test_each_fixture_declares_thresholds():
    for fixture in GOLDEN_CASES:
        assert "expect_clean" in fixture
        assert "thresholds" in fixture
        assert "faithfulness" in fixture["thresholds"]
        assert "overreach" in fixture["thresholds"]
```

- [ ] **Step 2: Add two negative-control fixtures**

In `backend/investigations/tests/evals/lead_fixtures.py`, append fixtures with these IDs:

```python
{
    "id": "same_name_no_relationship",
    "expect_clean": True,
    "thresholds": {"faithfulness": 1.0, "overreach": 0.0},
    "case": {"name": "Same Name Negative Control"},
    "documents": [
        {
            "filename": "deed_a.pdf",
            "doc_type": "DEED",
            "extracted_text": "Sarah Mitchell signs as grantor for Parcel A.",
        },
        {
            "filename": "minutes.pdf",
            "doc_type": "OTHER",
            "extracted_text": "Sarah Mitchell is listed as a guest at a public meeting.",
        },
    ],
    "persons": [{"full_name": "Sarah Mitchell"}],
    "organizations": [],
    "financial_snapshots": [],
}
```

```python
{
    "id": "high_revenue_with_documented_pay",
    "expect_clean": True,
    "thresholds": {"faithfulness": 1.0, "overreach": 0.0},
    "case": {"name": "Officer Pay Negative Control"},
    "documents": [
        {
            "filename": "2022_990.xml",
            "doc_type": "IRS_990",
            "extracted_text": "Form 990 shows total revenue 900000 and officer compensation 95000.",
        }
    ],
    "persons": [{"full_name": "Jordan Example", "role_tags": ["OFFICER"]}],
    "organizations": [{"name": "Clean Foundation", "ein": "12-3456789", "org_type": "NONPROFIT"}],
    "financial_snapshots": [
        {
            "ein": "12-3456789",
            "tax_year": 2022,
            "total_revenue": 900000,
            "total_expenses": 700000,
            "officer_compensation_total": 95000,
        }
    ],
}
```

If the fixture schema uses different key names, adapt only the field names needed by `lead_seeder.py`; keep the IDs and intent unchanged.

- [ ] **Step 3: Update eval README**

In `backend/investigations/tests/evals/README.md`, add:

```markdown
## Fixture philosophy

Each positive fixture should contain a pattern the generator may surface as a Lead.
Each negative fixture should be tempting but benign: similar names, high revenue with
documented compensation, ordinary transfers, or missing data that should produce no Lead.

Negative fixtures are as important as positive fixtures because Catalyst must avoid
creating referral-ready-sounding narratives from weak public-record coincidences.
```

- [ ] **Step 4: Run pure eval tests**

Run:

```bash
cd backend
python manage.py test investigations.tests.evals --exclude-tag=eval --keepdb
```

Expected: OK. This does not call Claude.

- [ ] **Step 5: Commit**

```bash
git add backend/investigations/tests/evals/lead_fixtures.py backend/investigations/tests/evals/test_lead_scorers.py backend/investigations/tests/evals/README.md
git commit -m "test(evals): add negative-control Lead fixtures"
```

---

## Task 6: Document AI Chain Of Custody

**Files:**
- Modify: `docs/architecture/api-contract.md`
- Modify: `backend/investigations/tests/evals/README.md`

- [ ] **Step 1: Update API contract AI job notes**

In `docs/architecture/api-contract.md`, in the AI job / findings section, add:

```markdown
### AI Chain-of-Custody Fields

Lead-generated findings (`source: "AI"`) must preserve:

- `ai_run_id` — the `SearchJob` UUID that produced the Lead, when available.
- `evidence_snapshot.ai_model` — model identifier used for generation.
- `evidence_snapshot.job_id` — string copy of the job id.
- `evidence_snapshot.doc_refs` — model-facing `Doc-N` references.
- `evidence_snapshot.doc_ref_resolution` — map from each `Doc-N` reference to a stable document UUID.
- `document_links` — persisted citation rows created from resolved `doc_refs`.

The frontend should display these as Lead provenance only when needed for debugging or audit review.
User-facing investigation copy must use "Lead", not model/vendor names.
```

- [ ] **Step 2: Add eval runbook note**

In `backend/investigations/tests/evals/README.md`, add:

```markdown
## When to run live evals

Run the live eval before changing:

- Lead system prompts
- context construction
- doc-ref resolution
- forbidden-term validation
- model names
- retrieval behavior used by Lead generation

The default test suite should continue to run with `--exclude-tag=eval`.
```

- [ ] **Step 3: Run docs-adjacent tests**

Run:

```bash
cd backend
python manage.py test investigations.tests.evals --exclude-tag=eval --keepdb
```

Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/api-contract.md backend/investigations/tests/evals/README.md
git commit -m "docs(ai): document Lead chain of custody"
```

---

## Verification Matrix

Run after all tasks:

```bash
cd backend
python manage.py test investigations.tests.test_ai_gateway --keepdb
python manage.py test investigations.tests.test_retrieval --keepdb
python manage.py test investigations.tests.test_ai_endpoints --keepdb
python manage.py test investigations.tests.test_ai_pattern --keepdb
python manage.py test investigations.tests.evals --exclude-tag=eval --keepdb
ruff check investigations\ai_gateway.py investigations\retrieval.py investigations\ai_proxy.py investigations\ai_pattern_augmentation.py investigations\ai_extraction.py investigations\tests\test_ai_gateway.py investigations\tests\test_retrieval.py investigations\tests\test_ai_endpoints.py investigations\tests\test_ai_pattern.py investigations\tests\evals
python manage.py check
cd ..\frontend
npx tsc --noEmit
```

Optional live eval:

```bash
cd backend
python manage.py test investigations.tests.evals.test_lead_quality --tag=eval --keepdb
```

Expected:

- Pure tests pass without `ANTHROPIC_API_KEY`.
- Live eval skips without key, runs only with `--tag=eval`.
- No frontend user-visible text introduces model/vendor names.

---

## Deliberate Deferrals

These are useful but not part of this plan:

- Vector embeddings / semantic retrieval. Start with weighted keyword retrieval because it adds no new infrastructure.
- New database table for model-call logs. The first pass can standardize usage metadata in returned payloads and `SearchJob.result`.
- Full migration of the `ai_ask()` tool-use loop into `ai_gateway`. It needs raw response objects and should be handled after the JSON-call path is stable.
- Frontend UI for AI provenance. Keep provenance backend-visible until there is a concrete audit UI need.

---

## Self-Review

Spec coverage:

- Shared client policy: Tasks 1, 2, 4.
- Usage/audit metadata consistency: Tasks 1, 2, 6.
- Retrieval improvement: Task 3.
- Eval fixture expansion: Task 5.
- Documentation: Task 6.

Placeholder scan:

- No `TBD`, `TODO`, or unspecified implementation steps remain.
- Each code-changing task includes file paths, code snippets, commands, and expected outcomes.

Type consistency:

- Gateway result type is `AiCallResult`.
- Retrieval function is `search_case_documents(case, query, limit=10)`.
- Lead provenance fields match existing `evidence_snapshot` keys.
