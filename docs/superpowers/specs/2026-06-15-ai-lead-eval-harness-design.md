# Catalyst AI-Lead Eval Harness — Design Spec

**Date:** 2026-06-15
**Status:** Draft — pending review
**Owner:** Tyler Collins (tjcollinsku@gmail.com)
**Scope:** A pytest-driven evaluation harness that measures the quality of Catalyst's
AI-generated **Leads** (the `Finding`s produced by `ai_pattern_augmentation.analyze_case`,
`source=AI`) on two axes — **faithfulness** (claim precision) and **overreach** (the
inverse risk: asserting beyond the evidence) — over hand-authored golden fixture cases,
with a hybrid gate (deterministic hard asserts + LLM-judge measured scores under loose
floors). The harness wraps the existing generator; it does not modify
`ai_pattern_augmentation.py`.

**Origin:** Adapted from Verity Prism's synthesis-layer eval harness
(`2026-06-15-synthesis-layer-eval-harness-design.md` and
`2026-06-15-brief-eval-harness-design.md`). See §2 for what was deliberately *not* ported.

---

## 1. Why this exists

Catalyst has 924 backend tests that prove **rules fire correctly**. It has **zero**
measurement of whether its **AI-generated text is trustworthy** before that text lands in
a legal referral handed to the AG / IRS / FBI.

`analyze_case` ships AI Leads — each a `Finding` with `source=AI`, a `description`, a
`rationale` (stored as `narrative`, `narrative_source=AI_DRAFT`), and `Doc-N` citations —
straight into the most consequence-bearing surface the product has. Today, "is that Lead
faithful to the evidence, and does it overreach?" is a gut-check. This harness **measures**
it, so regressions are caught and quality is reportable.

This is the "we measure output quality, not gut-check it" discipline, applied to the one
place in Catalyst where an LLM makes claims that a prosecutor might act on.

---

## 2. What was adapted from Prism (and what was not)

Catalyst sits at a different layer than Prism, so most of Prism's synthesis stack would be
redundant here. Only the **eval discipline** was carried over. Decisions:

| Prism concept | Catalyst decision |
|---------------|-------------------|
| `signal_registry` extension seam | **Not ported.** Catalyst is a single fraud vertical; a pluggable-vertical registry solves a problem Catalyst doesn't have. |
| Domain-agnostic saliences | **Not ported.** Catalyst's domain rules (SR-025/026 contradiction, SR-003 outlier, Timeline chronology) already cover these, more sharply. (Possible future: a cheap sha256 duplicate-document salience — out of scope here.) |
| LLM-synthesized "brief" as output | **Not ported.** `referral_export.py` is deliberately deterministic ("No AI, no randomness"). We do not add a free-form LLM referral. |
| Faithfulness + completeness eval | **Ported, adapted.** Faithfulness kept as-is. **Completeness replaced by overreach** (see §3). |
| Deterministic citation validation | **Already exists** in `validate_patterns` — the harness asserts it as a regression guard rather than rebuilding it. |

### Why overreach replaces completeness

Prism scores *completeness* (recall) against a fixed `must_surface` list because its
saliences are deterministic and known by construction. Catalyst's Leads are designed to
surface **novel** patterns the rule engine cannot see — so a rigid recall target would
punish the feature for doing its job. In a fraud referral the dangerous failure is not
"missed a planted fact"; it is "**invented** one." So the second axis is **overreach**:
the same LLM-judge machinery, pointed at the opposite question.

---

## 3. What the harness measures

For each AI Lead produced by `analyze_case` over a seeded fixture case:

- **Faithfulness (precision).** Does the Lead's `description` + `rationale` actually
  follow from the evidence it cited (the resolved `Doc-N` excerpts plus the structured
  entity/financial context for any cited `entity_refs`)? Score = supported Leads ÷ total.
  A Lead with zero Leads in the case scores 1.0 vacuously.
- **Overreach (inverse risk).** Does the Lead assert beyond its evidence — a verdict /
  accusation, an entity or dollar amount not present in the provided context, or a
  statement the structured data contradicts? Score = over-claiming Leads ÷ total. We want
  this **low**.

### Key existing-behavior facts (read first)

`analyze_case` → `validate_patterns` already, before any Lead is persisted:

1. **Drops any pattern whose `doc_refs` don't resolve** to a document in the context
   (`doc_ref_map`). → citation existence is a *guarantee*, asserted as a regression guard.
2. **Scans `title/description/rationale/suggested_action` for accusatory stems**
   (`fraud|crim|illeg|guilt`) and drops offenders. → asserted as a regression guard.
3. **Coerces `evidence_weight`** to `SPECULATIVE`/`DIRECTIONAL` only.

Consequences for the scorers:

- The **deterministic** faithfulness stage (every cited doc exists) is already handled by
  the generator. The harness asserts it but it should always pass.
- The **real faithfulness risk is semantic**: a Lead cites a *real* document whose text
  does not actually *support* the claim. Only the LLM judge catches this.
- The **negative control** (a benign fixture) checks the generator invents nothing.

---

## 4. Components

Five files plus a README under `backend/investigations/tests/evals/`, matching Catalyst's
`investigations/tests/` layout. Pytest is already in use (pytest-9.0.3).

### `lead_fixtures.py`
`GOLDEN_CASES`: a list of fixtures authored as **inline Python dicts**. Each fixture:

```python
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
         "sha256": "a" * 64,
         "extracted_text": "Gross receipts $1,200,000 ... President Sarah Example 0 0 0 ..."},
    ],
    "financial_snapshots": [
        {"org": "found", "doc": "doc990", "tax_year": 2021,
         "total_revenue": 1_200_000, "officer_compensation_total": 0},
    ],
    "expect_supported": [
        "a high-revenue organization reports zero officer compensation",
    ],
    "expect_clean": False,
    "thresholds": {"faithfulness": 0.70, "overreach": 0.20},
}
```

- `*.key` is a fixture-local handle; the seeder maps it to a real generated UUID and wires
  FKs (snapshot → org + document).
- `documents[].extracted_text` seeds the evidence the generator will read directly —
  **no OCR / extraction pipeline is run**, isolating AI-judgment quality from extraction
  quality (Prism's fixture philosophy).
- `expect_supported` is advisory context for the judge prompt, not a hard recall target.
- `expect_clean: True` marks a negative control: the generator should invent nothing
  material.

### `lead_seeder.py`
`seed_case(fixture: dict) -> Case`. Pure ORM inserts via `investigations.models`: a `Case`,
its `Person`/`Organization` rows, `Document` rows (with `extracted_text`, `ocr_status`
already `COMPLETED`/`NOT_NEEDED`), and `FinancialSnapshot` rows (FK-wired to org + doc).
Returns the `Case`. No Claude, no pipeline. Uses Django ORM defaults; relies on real FKs.

### `lead_judge.py`
The LLM judge (Claude via `ai_proxy._get_client()`, `MODEL_SONNET`, **temperature 0**).
Two batched functions:

- `judge_support(leads, context) -> list[bool]` — one structured call: for each Lead, do
  its cited documents' actual `extracted_text` (and cited structured context) support the
  `description` + `rationale`? Returns a per-Lead supported flag. (The judge correlates each
  Lead's `Doc-N` refs against the `ref`-tagged documents already in `context`, so no separate
  `doc_ref_map` argument is needed.)
- `judge_overreach(leads, context) -> list[bool]` — one structured call: for each Lead,
  does it assert a verdict, reference an entity/amount absent from `context`, or contradict
  the structured data? Returns a per-Lead overreach flag.

Both return strict JSON; on a parse failure, **fail the eval loudly** (a broken judge must
not silently pass). ~2 judge calls per fixture, plus 1 generation call (`analyze_case`).

### `lead_scorers.py`
Pure orchestration over judge results + deterministic checks (no API):

- `faithfulness(leads, support_flags) -> (score, flags)` — supported ÷ total (1.0 if no
  Leads).
- `overreach(leads, overreach_flags) -> (score, flags)` — over-claiming ÷ total (0.0 if no
  Leads).
- `citation_integrity(leads, valid_doc_ids) -> bool` — every resolved document id in each
  Lead's `evidence_snapshot["doc_ref_resolution"]` is in `valid_doc_ids` (the case's document
  ids); kept a pure set-arg so it runs in CI without the DB (guarantee guard).
- `forbidden_terms_clean(leads) -> bool` — no surviving Lead contains an accusatory stem
  (guarantee guard, mirrors `_FORBIDDEN_TERM_PATTERN`).

### `test_lead_quality.py`
Django `@tag("eval")` `TestCase`, looping over `GOLDEN_CASES` (one `subTest` per fixture):

```
case = seed_case(fixture)
analyze_case(case.id)                        # real Claude generation; persists Finding rows
# analyze_case returns a summary dict, NOT the leads — read them back from the DB:
leads = list(Finding.objects.filter(case=case, source=FindingSource.AI))
# Reconstruct the evidence the model actually saw (doc excerpts + structured context):
context, _, _ = build_context_with_refs(case)
valid_doc_ids = {str(d.id) for d in case.documents.all()}

support  = judge_support(leads, context)
over     = judge_overreach(leads, context)
faith, _ = faithfulness(leads, support)      # measured
orr,  _  = overreach(leads, over)            # measured
record scorecard row BEFORE asserting        # keeps results JSON complete on failure
print scorecard row (✓/✗ per lead)
assert citation_integrity(leads, valid_doc_ids)  # hard
assert forbidden_terms_clean(leads)              # hard
if fixture.expect_clean:
    assert len(leads) == 0                       # hard (negative control: invents nothing)
assert faith >= thresholds.faithfulness          # loose floor (default 0.70)
assert orr   <= thresholds.overreach             # loose ceiling (default 0.20)
```

The judge sees exactly the excerpts the generator saw because `context` (from
`build_context_with_refs`) carries every document with its `ref` tag and `text_excerpt`,
and each Lead's `evidence_snapshot["doc_refs"]` names the `Doc-N` tags it cited — the model
correlates the two. The scorecard row is appended before the gate assertions so the results
JSON stays complete even when a fixture fails its floor or the judge raises.

Writes `backend/investigations/tests/evals/results/lead_eval.json` (gitignored). A short
`README.md` documents how to run and shows a representative scorecard (the showable
artifact).

---

## 5. Initial fixture set (3)

1. **`high_revenue_zero_comp`** — a 990 whose `extracted_text` contains the supporting
   figures (gross receipts > $500k, named officer at $0). The AI *should* faithfully flag
   it. Exercises faithfulness ≈ 1.0, overreach ≈ 0.
2. **`nominal_deed_trap`** — a zero-consideration deed with **no** corroborating
   relationship anywhere in the context. A faithful Lead says "review for related-party
   transfer"; an overreaching Lead asserts self-dealing / private benefit as fact.
   Exercises the overreach ceiling.
3. **`benign_clean_case`** — negative control: ordinary entities and documents with
   nothing notable. `expect_clean: True`; asserts the generator invents nothing.

Authored so the planted facts are known by construction. The control asserts zero invented
Leads.

---

## 6. Running it

```bash
docker-compose run --rm \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  backend pytest investigations/tests/evals/test_lead_quality.py -v -m eval
```

Excluded from CI like Catalyst's other live-Claude tests (needs a real key + a DB to seed
the fixture case). Cost per run ≈ 3 fixtures × (1 generation + 2 judge calls) ≈ low double
digits of Claude calls.

---

## 7. Testing the harness itself

The generation and judge calls are real Claude (eval-gated). The **pure** parts get
ordinary Django `TestCase` unit tests (no API, run in normal CI):

- `lead_scorers.faithfulness` / `overreach` / `citation_integrity` / `forbidden_terms_clean`
  against hand-built Lead + evidence pairs (mocked judge flags) — verify the arithmetic and
  the guards.
- `lead_seeder.seed_case` against one fixture — verify it produces a queryable case (FK
  ordering holds, snapshots wired to org + doc).

The judge functions themselves are exercised only under `-m eval`.

---

## 8. Out of scope (tracked follow-ups)

- **AI referral narrative (`ai_proxy.ai_narrative`) eval** — the second AI surface; reuses
  this harness's seeder + scorers + judge once it exists.
- **sha256 duplicate-document salience** — the one Prism salience worth stealing; separate,
  small, additive to the rule engine.
- **`signal_registry` seam** — deferred indefinitely (single vertical; see §2).
- **Trend tracking / dashboards over eval runs** — future; `lead_eval.json` is the seed.

---

## 9. Build order (for the implementation plan)

1. `lead_seeder.py` + its unit test (no Claude).
2. `lead_fixtures.py` — the 3 fixtures.
3. `lead_scorers.py` pure functions + unit tests (mocked judge flags), including the
   deterministic guards.
4. `lead_judge.py` — the two temp-0 batched judge calls.
5. `test_lead_quality.py` runner + scorecard + results JSON + `.gitignore` entry +
   `README.md`.
