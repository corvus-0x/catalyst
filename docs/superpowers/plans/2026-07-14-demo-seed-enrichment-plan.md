# Demo Seed Enrichment (Branch 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `seed_demo` produce a demo case that is referral-grade-correct under the
ASSERTION_V1 gate, dedup-stable under signal re-evaluation, and rich enough to light up the
Case Map collectors, the Thread Builder, and Lead Suggestions.

**Architecture:** All changes live in `seed_demo.py` (data authoring) plus its test file.
The seed repairs four gaps: (1) trigger identities that don't match live rule output, so
re-evaluation duplicates findings; (2) assertions exist only on the flagship thread, so a
fresh reseed yields 0 referral-grade under the 4B gate; (3) no NOTE/QUESTION freeform for
Lead Suggestions to consume; (4) no PersonAddress/OrgAddress/FinancialInstrument rows, so
`shared_address` and `financial_link` Case Map edges never render — and the `--reset` path
must learn to delete the new RESTRICT-linked rows.

**Tech Stack:** Django 5.2 management command + Django `TestCase`. Tests run in the Docker
stack: `docker exec catalyst_backend python manage.py test investigations.tests.test_seed_demo_elements --keepdb --noinput`

## Global Constraints

- Branch: create `demo-seed-enrichment` off `main`; never commit to `main`.
- Ruff: line length 100, double quotes; run `ruff check backend/investigations/` and
  `ruff format backend/investigations/` before every commit (hooks are dormant).
- No user-visible strings containing "Haiku", "Sonnet", "Opus", "Claude", "AI assistant",
  "LLM", "GPT" (banned-strings gate).
- Assertion/note text must be non-accusatory: no "fraud", "criminal", "illegal", "guilty"
  stems (mirrors the `_FORBIDDEN_TERM_PATTERN` guard in `ai_thread_assist.py`).
- Seed must stay idempotent: plain re-run creates nothing new; `--reset` fully rebuilds.
- The spec is `docs/superpowers/specs/2026-07-14-demo-readiness-design.md`; the audit
  punch list is `docs/superpowers/plans/2026-07-14-demo-readiness-punch-list.md` (P0-1).

## Verified facts the plan relies on (do not re-derive)

- Dedup in `persist_signals` (`signal_rules.py:1882`): key is `(case, rule_id,
  trigger_entity_id)` when the trigger has an entity, else `(case, rule_id, trigger_doc)`.
  DISMISSED findings are excluded from dedup — never author a seeded row as DISMISSED and
  expect it to block re-creation.
- Live triggers: SR-003 → `trigger_entity_id=prop.pk` per deviating property
  (`signal_rules.py:384`); SR-015 → `trigger_entity_id=txn.property.pk`
  (`signal_rules.py:808`); SR-005 → document-scoped, `trigger_doc=document`, **no entity**
  (`signal_rules.py:~476-489`).
- Seed today: SR-003 trigger = `bff.id` (org), SR-005 trigger = `james.id`, SR-015 trigger
  = `sarah.id` — all mismatched; prod re-evaluation on Jul 8 created 4 duplicates
  (SR-003×2 for both properties, SR-005×1, SR-015×1) → 14 threads.
- Reevaluate endpoint: `POST /api/cases/<pk>/reevaluate-findings/` → view
  `api_case_reevaluate_signals` (`views.py:5432`), URL name
  `api_case_reevaluate_findings`.
- Referral-grade (`referral_grade.py`): CONFIRMED ∧ weight ∈ {DOCUMENTED, TRACED} ∧
  `overreach_reviewed` ∧ ≥1 document_link, PLUS for ASSERTION_V1: ≥1 cited assertion ∧ ≥1
  `handoff_ready` assertion (one element may satisfy both).
- `ThreadElement(finding, element_type, text, position, handoff_ready)` — unique
  `(finding, position)`; `ThreadElementCitation(element, document, page_reference,
  context_note)` — same-case guard.
- Overreach block (`seed_demo.py:~1065-1083`): marks first `len(confirmed)//2 + 1`
  confirmed+cited findings `overreach_reviewed=True`. 8 confirmed → 5 reviewed. Keep.
- PDF endpoint for tests: `reverse("api_case_referral_pdf", kwargs={"pk": case.pk})`,
  POST, expect 200 + body starting `%PDF`.
- `FinancialInstrument(case[RESTRICT], instrument_type, filing_number, filing_date,
  signer[Person], secured_party_id[UUID], debtor_id[UUID], amount)` — the Case Map
  `financial_link` collector pairs debtor↔secured-party when BOTH resolve to case
  subjects (Person/Org ids); signer is deliberately not paired.
- `_collect_shared_addresses` (`case_map.py:383`) reads `PersonAddress` (FK person,
  address, address_role) and `OrgAddress` (FK org, address, address_role); both CASCADE
  on person/org/address delete, so `--reset` needs no new lines for them.
- Expected final thread count: **11** (9 rule-backed + 1 elm SR-003 added by Task 1 + 1
  Lead finding). If the Task 1 parity test reveals SR-015 also fires on the Elm property,
  add a second SR-015 row per the instructions in Task 1 Step 6 and the count becomes 12;
  update the count constant in the tests AND the spec DoD in Task 6 accordingly.

---

### Task 1: Signal parity — seeded findings must dedup against live rule output

**Files:**
- Modify: `backend/investigations/management/commands/seed_demo.py` (findings_data entries
  ~lines 756-975; get_or_create loop ~line 978)
- Test: `backend/investigations/tests/test_seed_demo_elements.py`

**Interfaces:**
- Produces: seed authors an additional need-work SR-003 finding for the Elm property
  (used by Task 2's count test). Post-seed `POST reevaluate-findings` creates 0 findings.

- [ ] **Step 1: Create the branch**

```bash
git checkout -b demo-seed-enrichment
```

- [ ] **Step 2: Write the failing parity test**

Append to `backend/investigations/tests/test_seed_demo_elements.py`:

```python
from django.urls import reverse

from investigations.models import Case


class SeedDemoSignalParityTests(TestCase):
    """Seeded findings must carry the same dedup identity live rules generate,
    so a public-demo 'Re-evaluate signals' click converges instead of duplicating."""

    def test_reevaluate_after_seed_creates_no_new_findings(self):
        call_command("seed_demo")
        case = Case.objects.get(name="Bright Future Foundation Investigation")
        before = Finding.objects.filter(case=case).count()
        url = reverse("api_case_reevaluate_findings", kwargs={"pk": case.pk})
        response = self.client.post(url)
        self.assertIn(response.status_code, (200, 201, 202))
        after = Finding.objects.filter(case=case).count()
        self.assertEqual(
            after,
            before,
            f"re-evaluation created {after - before} duplicate finding(s): "
            f"{list(Finding.objects.filter(case=case).values_list('rule_id', 'title'))}",
        )
```

(`TestCase`, `call_command`, `Finding` are already imported at the top of this file.)

- [ ] **Step 3: Run the test to verify it fails**

```bash
docker exec catalyst_backend python manage.py test investigations.tests.test_seed_demo_elements.SeedDemoSignalParityTests -v 2 --keepdb --noinput
```

Expected: FAIL — re-evaluation creates duplicates (SR-003, SR-005, SR-015 at minimum).
If the endpoint requires auth/CSRF in tests, check how `test_referral_pdf.py` posts to
endpoints and mirror its client setup exactly.

- [ ] **Step 4: Align the three mismatched triggers in `findings_data`**

In `seed_demo.py`:

1. SR-003 entry (~line 779): change
   `"trigger_entity_id": bff.id,` / `"trigger_entity_type": "organization",`
   to `"trigger_entity_id": prop_oak.id,` / `"trigger_entity_type": "property",`
2. SR-005 entry (~line 805): keep `"trigger_entity_id": james.id` (it feeds the
   FindingEntity panel) but ADD a doc anchor key: `"trigger_doc_filename":
   "Deed_875_Elm_Ave.pdf",` — wired in Step 5.
3. SR-015 entry (~line 875 or 901, the one on SR-015): change
   `"trigger_entity_id": sarah.id,` to `"trigger_entity_id": prop_oak.id,` /
   `"trigger_entity_type": "property",` and add a second FindingEntity link for Sarah in
   the existing SR-015 special-case block (it already adds James — extend it):

```python
            if finding_data["rule_id"] == "SR-015":
                FindingEntity.objects.get_or_create(
                    finding=finding,
                    entity_id=james.id,
                    entity_type="person",
                    defaults={"context_note": "Second insider: received property at $0"},
                )
                FindingEntity.objects.get_or_create(
                    finding=finding,
                    entity_id=sarah.id,
                    entity_type="person",
                    defaults={"context_note": "Insider on seller side (Mitchell Dev manager)"},
                )
```

- [ ] **Step 5: Wire `trigger_doc` through the creation loop**

In the `for finding_data in findings_data:` loop (~line 978), pop the new key beside the
existing pops and set it after creation:

```python
            trigger_entity_id = finding_data.pop("trigger_entity_id", None)
            trigger_entity_type = finding_data.pop("trigger_entity_type", None)
            trigger_doc_filename = finding_data.pop("trigger_doc_filename", None)
            finding, _ = Finding.objects.get_or_create(
                case=case,
                rule_id=finding_data["rule_id"],
                defaults=finding_data,
            )

            if trigger_doc_filename and docs.get(trigger_doc_filename):
                finding.trigger_doc = docs[trigger_doc_filename]
                finding.save(update_fields=["trigger_doc"])
```

- [ ] **Step 6: Add the Elm-property SR-003 finding (need-work)**

Live SR-003 fires once per deviating property; Elm ($0 purchase vs assessed) fires too.
Append a second SR-003 entry to `findings_data` (after the SR-029 entry). NOTE: the
creation loop's `get_or_create(case, rule_id=...)` would collapse two SR-003 entries into
one — so change the loop's identity to include the trigger. Replace the `get_or_create`
call from Step 5 with:

```python
            finding, _ = Finding.objects.get_or_create(
                case=case,
                rule_id=finding_data["rule_id"],
                trigger_entity_id=trigger_entity_id,
                defaults=finding_data,
            )
```

and REMOVE the now-redundant post-create `finding.trigger_entity_id = ...; finding.save()`
block (keep the FindingEntity mirror, which uses `trigger_entity_id`/`trigger_entity_type`
directly). New entry:

```python
            {
                "rule_id": "SR-003",
                "title": "Purchase Price Deviates >50% From Assessed Value",
                "description": (
                    "875 Elm Avenue assessed at $195,000 but transferred for $0. "
                    "Zero-consideration transfer produces a 100% deviation below "
                    "assessed value; overlaps the SR-005 zero-consideration thread."
                ),
                "severity": Severity.HIGH,
                "status": FindingStatus.NEW,
                "evidence_weight": EvidenceWeight.SPECULATIVE,
                "source": FindingSource.AUTO,
                "narrative": "",
                "legal_refs": [],
                "trigger_entity_id": prop_elm.id,
                "trigger_entity_type": "property",
            },
```

Use the real assessed value from the `prop_elm` creation block (~line 333) in the
description if it differs from $195,000.

- [ ] **Step 7: Run the parity test again**

```bash
docker exec catalyst_backend python manage.py test investigations.tests.test_seed_demo_elements.SeedDemoSignalParityTests -v 2 --keepdb --noinput
```

Expected: PASS. If it still fails, the failure message lists the surviving duplicate's
`rule_id` — align that seeded entry's trigger to the live rule's trigger the same way
(entity-triggered rules: match `trigger_entity_id`; document-triggered rules: match
`trigger_doc`). Known possibility: SR-015 also fires on the Elm property — if so, add a
second SR-015 entry mirroring Step 6 (title from `RULE_REGISTRY["SR-015"].title`, status
NEW/SPECULATIVE, `trigger_entity_id: prop_elm.id`), and note that the final thread count
becomes 12 (adjust Task 2's count test and the spec DoD in Task 6).

- [ ] **Step 8: Run the existing seed tests + lint, then commit**

```bash
docker exec catalyst_backend python manage.py test investigations.tests.test_seed_demo_elements -v 2 --keepdb --noinput
cd backend && ruff check investigations/ && ruff format investigations/ && cd ..
git add backend/investigations/management/commands/seed_demo.py backend/investigations/tests/test_seed_demo_elements.py
git commit -m "fix(seed): align seeded finding dedup identity with live signal rules"
```

---

### Task 2: Assertions across all threads — restore 5 referral-grade under ASSERTION_V1

**Files:**
- Modify: `backend/investigations/management/commands/seed_demo.py` (replace the
  flagship-only block at ~lines 1087-1133 — section "11b-4A")
- Test: `backend/investigations/tests/test_seed_demo_elements.py`

**Interfaces:**
- Consumes: Task 1's final thread count (11 unless Step 7 said 12).
- Produces: every rule-backed finding has ThreadElements; exactly 5 findings satisfy
  `referral_grade_qs(case)`. Task 5's canonical-path test relies on the SR-025 texts here.

- [ ] **Step 1: Write the failing counts test**

Append to `test_seed_demo_elements.py`:

```python
from investigations.referral_grade import referral_grade_qs


class SeedDemoReferralMixTests(TestCase):
    EXPECTED_THREADS = 11  # 10 rule-backed (incl. Elm SR-003) + 1 Lead finding

    def test_seed_produces_referral_mix_and_universal_elements(self):
        call_command("seed_demo")
        case = Case.objects.get(name="Bright Future Foundation Investigation")
        findings = Finding.objects.filter(case=case)
        self.assertEqual(findings.count(), self.EXPECTED_THREADS)
        self.assertEqual(referral_grade_qs(case).count(), 5)
        self.assertEqual(
            findings.count() - referral_grade_qs(case).count(),
            self.EXPECTED_THREADS - 5,
        )
        rule_backed = findings.exclude(rule_id="")
        for finding in rule_backed:
            self.assertTrue(
                finding.elements.exists(),
                f"{finding.rule_id} '{finding.title[:40]}' has no thread elements",
            )
```

- [ ] **Step 2: Run it to verify it fails**

```bash
docker exec catalyst_backend python manage.py test investigations.tests.test_seed_demo_elements.SeedDemoReferralMixTests -v 2 --keepdb --noinput
```

Expected: FAIL — `referral_grade_qs` returns 1 (flagship only), most findings have no
elements.

- [ ] **Step 3: Replace the flagship-only block with a universal elements section**

Delete the whole `flagship_finding = ...` / `if flagship_finding and not
flagship_finding.elements.exists():` block (section 11b-4A) and insert:

```python
        # ────────────────────────────────────────────────────────────────
        # 11b. THREAD ELEMENTS — every rule-backed thread gets structured
        # elements so the Thread Builder demos the full derived-role
        # spectrum.  Referral-grade threads (the overreach-reviewed set)
        # get a cited assertion + a handoff-ready assertion, which is
        # exactly what the ASSERTION_V1 gate requires; everything else
        # gets an uncited assertion + an open question (need-work).
        # Narratives and FindingDocument rows are retained for the PDF.
        # ────────────────────────────────────────────────────────────────

        from investigations.models import ThreadElement, ThreadElementType  # noqa: PLC0415

        ASSERTION_TEXTS = {
            "SR-003": (
                "1250 Oak Street was purchased for $425,000 against a $180,000 "
                "assessed value on 2021-06-28 — a 136% deviation.",
                "Above-assessed purchase from a related LLC warrants appraisal "
                "records and board-minutes review by the receiving agency.",
            ),
            "SR-005": (
                "875 Elm Avenue was transferred for $0 consideration on "
                "2021-08-14 while title moved to a board member's spouse.",
                "Zero-consideration insider transfer warrants review of the "
                "deed chain and any private-benefit analysis.",
            ),
            "SR-006": (
                "Form 990 Part IV Line 28 is answered 'Yes' but no Schedule L "
                "is attached to the 2021 filing.",
                "Missing Schedule L despite an affirmative Line 28 answer "
                "warrants a completeness inquiry on the filing.",
            ),
            "SR-012": (
                "The 2021 Form 990 Part VI reports no conflict-of-interest "
                "policy at a $4.2M-revenue organization.",
                "Absent COI policy alongside recorded insider transactions "
                "warrants governance review.",
            ),
            "SR-013": (
                "The 2021 Form 990 Part VII reports $0 total officer "
                "compensation at $4.2M annual revenue.",
                "Implausible $0 officer pay warrants payroll and related-entity "
                "compensation tracing.",
            ),
            "SR-015": (
                "County records show the same family on both sides of the Oak "
                "Street transaction: seller managed by a board member's spouse, "
                "buyer the charity itself.",
                "Related parties on both sides of a property transaction "
                "warrant arm's-length review by the receiving agency.",
            ),
            "SR-021": (
                "Reported revenue grew from $890K (2018) to $4.2M (2021), "
                "exceeding 100% year-over-year growth in the filing record.",
                "Unexplained revenue spike warrants source-of-funds review.",
            ),
            "SR-025": (
                "Form 990 Part IV Line 28 denies related-party transactions in "
                "the same year county deeds record two insider transfers.",
                "Filed disclosure contradicts recorded transactions; refer the "
                "990 and both deeds for disclosure-accuracy review.",
            ),
            "SR-029": (
                "Program expenses are 38% of total spending on the 2021 filing, "
                "with $0 reported salaries despite evident staffing.",
                "Low program ratio with unexplained cost routing warrants "
                "expense-allocation review.",
            ),
        }
        DEFAULT_QUESTION = "What corroborating records would confirm or rule this out?"

        reviewed_ids = set(
            Finding.objects.filter(case=case, overreach_reviewed=True).values_list(
                "id", flat=True
            )
        )
        for finding in Finding.objects.filter(case=case).exclude(rule_id=""):
            if finding.elements.exists():
                continue
            cited_text, handoff_text = ASSERTION_TEXTS.get(
                finding.rule_id,
                (finding.title, "Warrants review by the receiving agency."),
            )
            assertion = ThreadElement.objects.create(
                finding=finding,
                element_type=ThreadElementType.ASSERTION,
                position=0,
                text=cited_text,
            )
            first_link = finding.document_links.select_related("document").first()
            if finding.id in reviewed_ids and first_link:
                assertion.citations.create(
                    document=first_link.document,
                    page_reference=first_link.page_reference or "",
                    context_note=first_link.context_note or "",
                )
                ThreadElement.objects.create(
                    finding=finding,
                    element_type=ThreadElementType.ASSERTION,
                    position=1,
                    text=handoff_text,
                    handoff_ready=True,
                )
            else:
                ThreadElement.objects.create(
                    finding=finding,
                    element_type=ThreadElementType.QUESTION,
                    position=1,
                    text=DEFAULT_QUESTION,
                )
        self.stdout.write(
            self.style.SUCCESS("  ✓ Thread elements authored for all rule-backed threads")
        )
```

Placement: AFTER the overreach-review block (it reads `overreach_reviewed`) and BEFORE
section 11c (the AI finding). The AI finding keeps zero elements — Leads start unstructured
by design.

- [ ] **Step 4: Run the counts test and the pre-existing flagship test**

```bash
docker exec catalyst_backend python manage.py test investigations.tests.test_seed_demo_elements -v 2 --keepdb --noinput
```

Expected: ALL PASS. The old flagship test must still pass — the earliest confirmed finding
is in the reviewed set, so it still gets cited + handoff assertions.

- [ ] **Step 5: Lint and commit**

```bash
cd backend && ruff check investigations/ && ruff format investigations/ && cd ..
git add backend/investigations/management/commands/seed_demo.py backend/investigations/tests/test_seed_demo_elements.py
git commit -m "feat(seed): author assertions on every rule-backed thread — 5 referral-grade under ASSERTION_V1"
```

---

### Task 3: Lead Suggestions staging — freeform NOTE/QUESTION input on two threads

**Files:**
- Modify: `backend/investigations/management/commands/seed_demo.py` (immediately after
  Task 2's new section)
- Test: `backend/investigations/tests/test_seed_demo_elements.py`

**Interfaces:**
- Consumes: Task 2's elements section (positions 0-1 are taken on staged threads).
- Produces: SR-013 and SR-021 findings each have ≥2 NOTE + ≥1 QUESTION elements and ≥1
  FindingDocument link (the links already exist via the citation_map).

- [ ] **Step 1: Write the failing staging test**

```python
from investigations.models import ThreadElementType


class SeedDemoLeadStagingTests(TestCase):
    STAGED_RULES = ("SR-013", "SR-021")

    def test_staged_threads_have_freeform_material_and_document_links(self):
        call_command("seed_demo")
        case = Case.objects.get(name="Bright Future Foundation Investigation")
        for rule_id in self.STAGED_RULES:
            finding = Finding.objects.get(case=case, rule_id=rule_id)
            notes = finding.elements.filter(element_type=ThreadElementType.NOTE)
            questions = finding.elements.filter(element_type=ThreadElementType.QUESTION)
            self.assertGreaterEqual(notes.count(), 2, rule_id)
            self.assertGreaterEqual(questions.count(), 1, rule_id)
            self.assertTrue(
                finding.document_links.exists(),
                f"{rule_id}: staged Lead thread must link its evidence documents — "
                "build_thread_context puts document_links first in the prompt budget",
            )
```

Note: `Finding.objects.get(case=case, rule_id="SR-013")` — if Task 1 ended with two rows
for a staged rule, switch the lookup to filter + earliest `created_at`. With the planned
alignment only SR-003 is doubled, so `get` is safe for SR-013/SR-021.

- [ ] **Step 2: Run it to verify it fails**

```bash
docker exec catalyst_backend python manage.py test investigations.tests.test_seed_demo_elements.SeedDemoLeadStagingTests -v 2 --keepdb --noinput
```

Expected: FAIL — no NOTE elements exist on those threads.

- [ ] **Step 3: Add the staging section to the seed**

Insert directly after Task 2's section:

```python
        # ────────────────────────────────────────────────────────────────
        # 11b-ii. LEAD SUGGESTIONS STAGING — two threads carry realistic
        # investigator freeform (notes + open questions) so a live
        # "Suggest assertions" click has grounded material to structure.
        # Proposals are never seeded: they are generated live and only
        # persist when a human accepts them (spec §Phase 4D).
        # ────────────────────────────────────────────────────────────────

        LEAD_STAGING = {
            "SR-013": [
                (
                    ThreadElementType.NOTE,
                    "Part VII of the 2021 990 lists four officers, every one at "
                    "$0 reportable compensation. The same filing reports $1.62M "
                    "in admin and salaries. Somebody is being paid — the filing "
                    "just doesn't say who.",
                ),
                (
                    ThreadElementType.NOTE,
                    "Mitchell Development Group's formation filing lists Sarah "
                    "Mitchell as manager. If management fees flow to the LLC "
                    "instead of W-2 officer pay, that would reconcile the $0.",
                ),
                (
                    ThreadElementType.QUESTION,
                    "Does any 990 schedule or county record show payments from "
                    "the charity to Mitchell Development Group?",
                ),
            ],
            "SR-021": [
                (
                    ThreadElementType.NOTE,
                    "Revenue: $85K (2016), $156K (2017), $890K (2018), $1.6M "
                    "(2019), $2.8M (2020), $4.2M (2021). The 2018 jump is 471% "
                    "and predates both property transactions.",
                ),
                (
                    ThreadElementType.NOTE,
                    "No grants schedule or donor concentration data in the "
                    "filings on hand; the growth is unexplained in Part I.",
                ),
                (
                    ThreadElementType.QUESTION,
                    "Which revenue line (contributions, program service, other) "
                    "drives the 2018 spike?",
                ),
            ],
        }
        for rule_id, elements in LEAD_STAGING.items():
            finding = (
                Finding.objects.filter(case=case, rule_id=rule_id)
                .order_by("created_at")
                .first()
            )
            if finding is None:
                continue
            next_pos = (finding.elements.count() or 0)
            for offset, (el_type, text) in enumerate(elements):
                ThreadElement.objects.get_or_create(
                    finding=finding,
                    element_type=el_type,
                    text=text,
                    defaults={"position": next_pos + offset},
                )
        self.stdout.write(self.style.SUCCESS("  ✓ Lead staging notes on SR-013 / SR-021"))
```

- [ ] **Step 4: Run the staging test + full seed test module**

```bash
docker exec catalyst_backend python manage.py test investigations.tests.test_seed_demo_elements -v 2 --keepdb --noinput
```

Expected: ALL PASS. (The `get_or_create` on (finding, element_type, text) keeps plain
re-runs idempotent; positions only apply on first creation.)

- [ ] **Step 5: Lint and commit**

```bash
cd backend && ruff check investigations/ && ruff format investigations/ && cd ..
git add backend/investigations/management/commands/seed_demo.py backend/investigations/tests/test_seed_demo_elements.py
git commit -m "feat(seed): stage freeform NOTE/QUESTION material for live Lead Suggestions"
```

---

### Task 4: Case Map collectors — shared_address + financial_link data, reset-path safety

**Files:**
- Modify: `backend/investigations/management/commands/seed_demo.py` (imports ~line 40;
  reset block ~line 94; after the addresses section ~line 311)
- Test: `backend/investigations/tests/test_seed_demo_elements.py`

**Interfaces:**
- Produces: `build_case_map(case)` edges include categories `transaction`,
  `shared_address`, `financial_link`; `seed_demo --reset` twice in a row succeeds.

- [ ] **Step 1: Write the two failing tests**

```python
from investigations.case_map import build_case_map


class SeedDemoCaseMapTests(TestCase):
    def test_case_map_renders_all_three_evidence_categories(self):
        call_command("seed_demo")
        case = Case.objects.get(name="Bright Future Foundation Investigation")
        payload = build_case_map(case)
        categories = set()
        for edge in payload["edges"]:
            for ref in edge.get("evidence_refs", []):
                categories.add(ref.get("category"))
        for expected in ("shared_address", "financial_link"):
            self.assertIn(expected, categories, f"no {expected} edge on the demo Case Map")


class SeedDemoResetTests(TestCase):
    def test_reset_twice_rebuilds_cleanly(self):
        call_command("seed_demo")
        call_command("seed_demo", "--reset")
        call_command("seed_demo", "--reset")
        case = Case.objects.get(name="Bright Future Foundation Investigation")
        self.assertTrue(Finding.objects.filter(case=case).exists())
```

Check the exact edge payload shape against `_build_edges` in `case_map.py` before
finalizing the first test — if evidence refs live under a different key (e.g. nested in
`edge["evidence"]`), assert against that key instead; `test_case_map.py` shows the shape.

- [ ] **Step 2: Run both to verify failures**

```bash
docker exec catalyst_backend python manage.py test investigations.tests.test_seed_demo_elements.SeedDemoCaseMapTests investigations.tests.test_seed_demo_elements.SeedDemoResetTests -v 2 --keepdb --noinput
```

Expected: CaseMap test FAILS (no shared_address/financial_link categories). Reset test
PASSES today — it exists to catch the RESTRICT breakage the moment Step 3 adds
FinancialInstrument rows, and MUST stay green through this task.

- [ ] **Step 3: Add the seed data + reset line**

1. Imports (~line 40 block): add `FinancialInstrument,`, `InstrumentType,`,
   `OrgAddress,`, `PersonAddress,` to the existing `from investigations.models import (`
   list (alphabetical order; ruff will enforce).
2. Reset block (~after `Finding.objects.filter(case=case).delete()`):

```python
                FinancialInstrument.objects.filter(case=case).delete()
```

3. After the `elm_ave_addr` creation (~line 311), add:

```python
        # Shared business address: Sarah Mitchell + Mitchell Development Group
        # → shared_address Case Map edge between the two subjects.
        commerce_addr, _ = Address.objects.get_or_create(
            case=case,
            raw_text="4400 Commerce Parkway, Suite 210, Columbus, OH 43219",
            defaults={
                "street": "4400 Commerce Parkway, Suite 210",
                "city": "Columbus",
                "state": "OH",
                "zip_code": "43219",
                "county": "Franklin",
                "address_type": AddressType.MAILING,
            },
        )
        PersonAddress.objects.get_or_create(
            person=sarah,
            address=commerce_addr,
            defaults={"address_role": AddressType.MAILING},
        )
        OrgAddress.objects.get_or_create(
            org=mitchell_dev,
            address=commerce_addr,
            defaults={"address_role": AddressType.MAILING},
        )

        # UCC-style loan: Mitchell Dev (secured party) → BFF (debtor), signed
        # by Sarah → financial_link Case Map edge between the two orgs.
        FinancialInstrument.objects.get_or_create(
            case=case,
            filing_number="OH-UCC-2021-118834",
            defaults={
                "instrument_type": InstrumentType.LOAN,
                "filing_date": date(2021, 5, 12),
                "signer": sarah,
                "secured_party_id": mitchell_dev.id,
                "debtor_id": bff.id,
                "amount": Decimal("250000.00"),
            },
        )
```

Check the top of `seed_demo.py` for existing `date` / `Decimal` imports (the
FinancialSnapshot and PropertyTransaction sections almost certainly import them already);
add `from datetime import date` / `from decimal import Decimal` only if missing. Check
`AddressType` choices for the exact mailing-address member name (`MAILING` vs `OTHER`)
before using it.

- [ ] **Step 4: Run both tests again**

```bash
docker exec catalyst_backend python manage.py test investigations.tests.test_seed_demo_elements.SeedDemoCaseMapTests investigations.tests.test_seed_demo_elements.SeedDemoResetTests -v 2 --keepdb --noinput
```

Expected: BOTH PASS. If the reset test fails with a RESTRICT/ProtectedError, a new row
type is missing its delete line — read the error's model name and add
`<Model>.objects.filter(case=case).delete()` to the reset block above the `case.delete()`.

- [ ] **Step 5: Lint and commit**

```bash
cd backend && ruff check investigations/ && ruff format investigations/ && cd ..
git add backend/investigations/management/commands/seed_demo.py backend/investigations/tests/test_seed_demo_elements.py
git commit -m "feat(seed): shared_address + financial_link collector data; reset deletes FinancialInstrument"
```

---

### Task 5: Canonical walkthrough path + referral PDF regression

**Files:**
- Test: `backend/investigations/tests/test_seed_demo_elements.py`

**Interfaces:**
- Consumes: everything above. This task is test-only — it pins the demo spine the README
  Traceability Walkthrough and GIF will follow (spec: "the canonical path is asserted in
  tests").

- [ ] **Step 1: Write the canonical-path test**

```python
from django.urls import reverse

from investigations.referral_grade import is_referral_grade


class SeedDemoCanonicalPathTests(TestCase):
    """One thread must demonstrate the full chain: public record → subject
    relationship → Case Map edge → cited assertion → handoff-ready claim →
    referral PDF. This is the demo spine the README walkthrough follows."""

    def test_canonical_thread_walks_the_full_chain(self):
        call_command("seed_demo")
        case = Case.objects.get(name="Bright Future Foundation Investigation")
        flagship = (
            Finding.objects.filter(case=case, status=FindingStatus.CONFIRMED)
            .order_by("created_at")
            .first()
        )
        self.assertTrue(is_referral_grade(flagship))
        self.assertTrue(
            flagship.elements.filter(
                element_type=ThreadElementType.ASSERTION, citations__isnull=False
            ).exists()
        )
        self.assertTrue(
            flagship.elements.filter(
                element_type=ThreadElementType.ASSERTION, handoff_ready=True
            ).exists()
        )
        payload = build_case_map(case)
        thread_edge_ids = {
            ref.get("finding_id")
            for edge in payload["edges"]
            for ref in edge.get("thread_refs", [])
        }
        self.assertIn(str(flagship.id), thread_edge_ids, "flagship missing from Case Map")
        response = self.client.post(
            reverse("api_case_referral_pdf", kwargs={"pk": case.pk})
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.content.startswith(b"%PDF"))
```

Before finalizing, check the edge `thread_refs` key shape in `case_map.py`
(`_collect_threads` / `_build_edges`) — assert against the actual field carrying the
finding id, and check whether `api_case_referral_pdf` expects GET or POST in
`test_referral_pdf.py:116` and match it.

- [ ] **Step 2: Run it**

```bash
docker exec catalyst_backend python manage.py test investigations.tests.test_seed_demo_elements.SeedDemoCanonicalPathTests -v 2 --keepdb --noinput
```

Expected: PASS if Tasks 1-4 are correct. Any failure here is a real gap in the chain —
fix the seed (not the test) unless the payload-shape keys were guessed wrong in Step 1.

- [ ] **Step 3: Commit**

```bash
git add backend/investigations/tests/test_seed_demo_elements.py
git commit -m "test(seed): pin the canonical walkthrough chain — record→edge→assertion→PDF"
```

---

### Task 6: Full-suite gate, spec sync, PR

**Files:**
- Modify: `docs/superpowers/specs/2026-07-14-demo-readiness-design.md` (Definition of Done
  thread counts)

- [ ] **Step 1: Run the CI-equivalent full backend suite**

```bash
docker exec catalyst_backend python manage.py test investigations --exclude-tag=eval --keepdb --noinput
```

Expected: ALL PASS (~1,118 + the new tests). Pre-existing tests that pinned old seed
behavior (e.g. exact finding counts elsewhere) may fail — update those assertions to the
new counts, nothing else.

- [ ] **Step 2: Sync the spec's Definition of Done to the verified counts**

In the spec's DoD, change "exactly 10 threads; exactly 5 in `referral_grade_qs(case)`"
to the final verified numbers (11 threads — or 12 if Task 1 Step 7 added an Elm SR-015 —
still exactly 5 referral-grade). Also update the Phase 1 bullet "among the 10 seeded
threads" to match.

- [ ] **Step 3: Lint everything, commit, and stop for review**

```bash
cd backend && ruff check investigations/ && ruff format investigations/ && cd ..
git add -A
git commit -m "docs(spec): sync demo-readiness DoD to verified seed counts"
```

Then STOP: pushing the branch and opening the PR is outward-facing — confirm with Tyler
first (per CLAUDE.md workflow rule 5). After the PR opens, the Railway preview gate
applies: run `seed_demo --reset` on the preview at least once (spec Testing & Safety)
before merge.
