# Catalyst Fix Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the backend test suite from 53-red to green (locally + enforced by CI), live-verify the connectors, fix the one real broken wire, and add a first real frontend test — without refactoring or building features.

**Architecture:** Module-by-module, root-cause-first, green-before-push. For each red test: classify (stale test / real bug / dead code) → fix the correct layer → re-run that module green → commit. Connectors get live-verified and their stale tests updated, but their logic is untouched. CI is wired last, once green.

**Tech Stack:** Django 4.2 `manage.py test` on native PG18 (:5433, trust auth, local), React 18 + Vitest, GitHub Actions (Postgres service container for CI).

---

## Conventions (read first)

- **Spec:** `docs/superpowers/specs/2026-06-03-catalyst-fix-pass-design.md`. **Audit (context):**
  `docs/architecture/audit-2026-06-03.md`.
- **Branch:** this pass modifies committed code. Work on a branch, not `main`:
  `git switch -c fix/audit-punch-list`. **Tyler commits** from his local machine (sandbox git
  hook issue) — each task ends at a commit checkpoint Tyler performs.
- **Run a test module (the core loop):** from repo root, Bash tool (git-bash):
  ```bash
  set -a && source .env 2>/dev/null && set +a && export DB_HOST=127.0.0.1 DB_PORT=5433 \
    && ./.venv/Scripts/python.exe backend/manage.py test investigations.tests.<module> -v 2 --keepdb
  ```
  Drop `--keepdb` after any model/migration change. Full suite: use `investigations`.
- **The classification rule (apply to EVERY red test):**
  1. Run it, read the failure.
  2. **Stale test** — asserts an outdated value against working code → **update the test** to the
     current contract.
  3. **Real bug** — the assertion is correct, the code violates it → **fix the code** if small
     (≤ a few lines); if it balloons, mark `@unittest.expectedFailure` with a `# AUDIT-DEFER:`
     reason comment + add an entry to audit §3, and move on.
  4. **Dead code** — delete it.
  - **Never edit an assertion just to make it pass.** If unsure which case applies, read the
    code under test before deciding.
- **Definition of green:** `manage.py test investigations` reports 0 failures/errors;
  only documented `skip`/`expectedFailure` remain.

---

## File structure (what this pass touches)

| File | Change |
|------|--------|
| `backend/investigations/tests/test_*.py` | Update stale assertions/fixtures/imports |
| `backend/investigations/*.py` | Only small real-bug fixes found in triage (no refactors) |
| `frontend/src/api/cases.ts` | One-line URL fix (Task E1) |
| `frontend/src/**/*.test.tsx` | New: ≥1 real frontend test (Task F2) |
| `.github/workflows/ci.yml` | New: `backend-test` job (Task F1) |
| `backend/investigations/propublica_connector.py` + test | Delete OR skip (Task B4, owner call) |
| `docs/architecture/audit-2026-06-03.md` | Update punch list with outcomes (Task G2) |

---

## PHASE A — Runtime sanity gate

### Task A1: Seed + smoke the running app

**Files:** none (verification only)

- [ ] **Step 1: Seed the local dev DB**
```bash
set -a && source .env 2>/dev/null && set +a && export DB_HOST=127.0.0.1 DB_PORT=5433 \
  && ./.venv/Scripts/python.exe backend/manage.py seed_demo 2>&1 | tail -10
```
Expected: demo "Bright Future Foundation" case created (persons/orgs/financials/findings).

- [ ] **Step 2: Confirm the three tiers are up** (start any that aren't — see audit §0.5).
Backend `:8000`, worker `qcluster`, frontend `:5173`.

- [ ] **Step 3: Run the smoke test**
```bash
./.venv/Scripts/python.exe tests/api_health_check.py 2>&1 | tail -20
```
(Or invoke the `/smoke-test` skill.) Expected: health + key endpoints 200.

- [ ] **Step 4: Load `http://localhost:5173/`** and click into the seeded case (Dashboard →
Cases → the case → Investigate/Financials/Referrals tabs). Note any runtime/console error.

- [ ] **Step 5: Record findings.** Any runtime/wiring bug → add to audit §3 punch list (and fix
here only if trivial; otherwise it's a triage item). No commit (verification task).

---

## PHASE B — Connectors: verify + green

### Task B1: Live-verify the connectors

**Files:** none (verification only)

- [ ] **Step 1: IRS TEOS XML** — run a known-good search end-to-end (audit/STATUS reference: the
"bright future" name search returns ~177 filings). Via the running app's Research tab against the
seeded case, or a shell call to the connector. Record: works / fails + detail.

- [ ] **Step 2: County Recorder** — exercise the recorder URL builder + a deed parse for a known
county. Record status.

- [ ] **Step 3: Ohio AOS** — run an audit-report search. Record status.

- [ ] **Step 4: Ohio SOS** — confirm the manual-CSV search path (upload a sample CSV via the
admin endpoint, then search). Record status.

- [ ] **Step 5: County Auditor (ODNR)** — attempt a parcel search. **Expected: fail (ODNR 404,
upstream).** Record as known-down, not a regression.

- [ ] **Step 6: Write the live-verify results table** into audit §1.4 / §3 (connector → live
status as of today). No code commit.

### Task B2: Fix `test_irs` import (module won't load)

**Files:** Modify `backend/investigations/tests/test_irs.py`

- [ ] **Step 1: See the failure**
```bash
set -a && source .env 2>/dev/null && set +a && export DB_HOST=127.0.0.1 DB_PORT=5433 \
  && ./.venv/Scripts/python.exe backend/manage.py test investigations.tests.test_irs -v 1 --keepdb 2>&1 | tail -8
```
Expected: `ImportError: cannot import name 'EoBmfRecord' from 'investigations.irs_connector'`.

- [ ] **Step 2: Find the current symbol** the connector actually exports
```bash
grep -nE '^(class |def |[A-Za-z_]+ = )' backend/investigations/irs_connector.py | grep -iE 'bmf|record|eo' 
```
Identify the renamed/replacement symbol (or confirm it was removed and the test's usage is dead).

- [ ] **Step 3: Update the import** in `test_irs.py` line ~28 to the current symbol (or delete the
specific test(s) that exercised a genuinely-removed feature — classification rule, case "stale").

- [ ] **Step 4: Run green**
```bash
... manage.py test investigations.tests.test_irs -v 1 --keepdb 2>&1 | tail -8
```
Expected: module imports; tests pass (or are correctly updated).

- [ ] **Step 5: Commit** (Tyler): `test(irs): fix stale EoBmfRecord import so test_irs loads`.

### Task B3: Fix `test_county_auditor` + `test_ohio_aos` stale assertions

**Files:** Modify `backend/investigations/tests/test_county_auditor.py`,
`backend/investigations/tests/test_ohio_aos.py`

- [ ] **Step 1: county_auditor — see failures**
```bash
... manage.py test investigations.tests.test_county_auditor -v 2 --keepdb 2>&1 | tail -25
```
Known: `test_query_url_is_odnr` asserts `odnr_landbase_v2`; code builds `odnr_landbase`.

- [ ] **Step 2: Confirm the current URL the code builds**
```bash
grep -nE 'odnr_landbase|MapServer|arcgis' backend/investigations/county_auditor_connector.py | head
```

- [ ] **Step 3: Update the test assertions** to the current URL/shape (stale test — code is
correct). Do **not** change connector code.

- [ ] **Step 4: ohio_aos — see failures**
```bash
... manage.py test investigations.tests.test_ohio_aos -v 2 --keepdb 2>&1 | tail -25
```
Known: `test_search_audit_reports_success` got `11545 != 2`; `...http_error` `AOSError not
raised` — the mock fixture/HTML the test feeds the parser has drifted from what the parser now
expects.

- [ ] **Step 5: Refresh the mock fixture** so it matches the parser's current contract (read the
parser to see the expected structure: `grep -nE 'def parse|BeautifulSoup|find_all' backend/investigations/ohio_aos_connector.py`). Stale test — connector logic untouched.

- [ ] **Step 6: Run both green**
```bash
... manage.py test investigations.tests.test_county_auditor investigations.tests.test_ohio_aos -v 1 --keepdb 2>&1 | tail -10
```

- [ ] **Step 7: Commit** (Tyler): `test(connectors): refresh stale county_auditor URL + ohio_aos fixtures`.

### Task B4: Resolve `propublica` (owner call)

**Files:** Delete `backend/investigations/propublica_connector.py` +
`backend/investigations/tests/test_propublica.py` **OR** skip the tests.

- [ ] **Step 1: Confirm propublica is unreferenced** (dead, not used by views/jobs/pipeline)
```bash
grep -rnE 'propublica' backend/investigations --include='*.py' | grep -v 'propublica_connector.py\|test_propublica.py'
```
Expected: no live callers (confirms superseded, audit §1.4/§2.2).

- [ ] **Step 2: OWNER DECISION (Tyler).** If **delete**: remove both files + any stray import.
If **leave**: add `@unittest.skip("superseded connector — see audit §1.4")` to the test class.

- [ ] **Step 3: Run green / confirm gone**
```bash
... manage.py test investigations.tests.test_propublica -v 1 --keepdb 2>&1 | tail -6   # if kept
```
(If deleted, the module no longer exists — confirm `git status` shows the removals.)

- [ ] **Step 4: Commit** (Tyler): `chore(propublica): remove superseded connector` *or*
`test(propublica): skip superseded connector tests`.

---

## PHASE C — Refactor-stale tests (non-connector)

### Task C1: `test_steps_1_through_4` — Finding serializer drift (~14 tests)

**Files:** Modify `backend/investigations/tests/test_steps_1_through_4.py`

- [ ] **Step 1: See the failures**
```bash
... manage.py test investigations.tests.test_steps_1_through_4 -v 2 --keepdb 2>&1 | tail -40
```
Known: `FindingIntakeSerializer`/`FindingUpdateSerializer` tests reference removed fields
(`detection_id`, `confidence`) and old "minimal valid" payloads → `is_valid()` False.

- [ ] **Step 2: Read the current serializer contract**
```bash
grep -nE 'class Finding.*Serializer|fields|required|=.*Field' backend/investigations/serializers.py | grep -iE 'finding|intake|update|detection|confidence|narrative|status|severity' | head -40
```
Identify the current required/allowed fields on the Finding intake/update serializers.

- [ ] **Step 3: Update the tests** to the current contract: replace `detection_id`/`confidence`
with the current fields; fix the "minimal valid" payloads; update the invalid-case assertions to
the current validation messages. (Stale tests — serializer code is the source of truth here.)

- [ ] **Step 4: Run green**
```bash
... manage.py test investigations.tests.test_steps_1_through_4 -v 1 --keepdb 2>&1 | tail -8
```
Expected: all ~14 pass.

- [ ] **Step 5: Commit** (Tyler): `test(findings): update serializer tests to post-refactor Finding contract`.

### Task C2: `test_signals` — stale serializer/endpoint tests

**Files:** Modify `backend/investigations/tests/test_signals.py` (only the stale
serializer/endpoint tests — NOT the rule-logic tests unless triage shows a real bug)

- [ ] **Step 1: See all failures + classify**
```bash
... manage.py test investigations.tests.test_signals -v 2 --keepdb 2>&1 | tail -60
```
There are ~14 here (9 fail + 5 error). Split them:
- **Serializer/endpoint shape** (`test_serialize_finding_includes_expected_keys`,
  `test_unexpected_field_is_rejected`, `test_post_not_allowed`, `test_invalid_*_filter_returns_400`,
  `test_filters_by_rule_id`, `test_delete_not_allowed`) → likely **stale** (endpoint contract
  drift). Update to current behavior.
- **Rule-firing** (`test_fires_when_990_denies_*`, `test_fetch_990s_creates_finding_from_xml_rules`,
  `test_dedup_keys_on_entity_not_document`, `test_evidence_snapshot_*`) → **could be real**.
  Apply the classification rule per test.

- [ ] **Step 2: For each, read the code under test before deciding** (serializer for shape tests;
`signal_rules.py` / the XML evaluator for rule tests). Fix the correct layer per the rule.

- [ ] **Step 3: Run green**
```bash
... manage.py test investigations.tests.test_signals -v 1 --keepdb 2>&1 | tail -10
```
Any real bug too big → `@expectedFailure` + `# AUDIT-DEFER:` + audit §3 entry.

- [ ] **Step 4: Commit** (Tyler): `test(signals): align stale serializer/endpoint tests; fix/flag rule tests`.

---

## PHASE D — Triage bucket (root-cause each)

Each task below is the **same loop** applied to one module: run → read failure → read code under
test → classify (stale/real/dead) → fix correct layer (small) or `expectedFailure`+defer (big) →
re-run green → commit. Modules are independent; do them in any order.

### Task D1: `test_upload_pipeline` (4 — SHA-256 dedup)
**Files:** Modify `backend/investigations/tests/test_upload_pipeline.py` and/or the upload path in
`backend/investigations/views.py` (`_process_uploaded_file` / dedup) **if a real bug**.
- [ ] **Step 1:** `... manage.py test investigations.tests.test_upload_pipeline -v 2 --keepdb 2>&1 | tail -40`
- [ ] **Step 2:** Read the dedup logic: `grep -nE 'sha256|sha_256|hexdigest|get_or_create|existing' backend/investigations/views.py | head`. Decide stale vs real (these assert "same bytes → one Document, different bytes → two"; if the seed/upload SHA behavior changed, classify accordingly).
- [ ] **Step 3:** Fix the correct layer per the classification rule.
- [ ] **Step 4:** Re-run green. Big real bug → defer (xfail + note).
- [ ] **Step 5: Commit** (Tyler): `test(upload): resolve dedup test failures`.

### Task D2: `test_new_endpoints` (4 — export metadata) + `test_api` (1 — case list filter)
**Files:** `backend/investigations/tests/test_new_endpoints.py`, `test_api.py`, and the export /
case-list views in `views.py` if real.
- [ ] **Step 1:** `... test investigations.tests.test_new_endpoints investigations.tests.test_api -v 2 --keepdb 2>&1 | tail -40`
- [ ] **Step 2:** For export errors (`test_*_export_returns_metadata`, `test_export_defaults_to_json`) read `api_case_export` in `views.py`; for `test_case_list_filters_by_status_and_name_query` read `api_case_collection` filter parsing. Classify + fix correct layer.
- [ ] **Step 3:** Re-run green; defer big bugs.
- [ ] **Step 4: Commit** (Tyler): `test(endpoints): resolve export + case-list filter tests`.

### Task D3: `test_ai_endpoints` (3) + `test_ai_pattern` (2)
**Files:** `backend/investigations/tests/test_ai_endpoints.py`, `test_ai_pattern.py`; `ai_proxy.py`
/ `ai_pattern_augmentation.py` / AI views if real.
- [ ] **Step 1:** `... test investigations.tests.test_ai_endpoints investigations.tests.test_ai_pattern -v 2 --keepdb 2>&1 | tail -50`
- [ ] **Step 2:** These mock the Claude call. `test_happy_path`, `test_helper_error_maps_to_500`, `test_passes_conversation_history` (ai_endpoints); `test_returns_doc_ref_map`, `test_context_respects_size_budget` (ai_pattern). Read the view/helper; most likely stale mocks/contract drift. Classify + fix.
- [ ] **Step 3:** Re-run green; defer big bugs.
- [ ] **Step 4: Commit** (Tyler): `test(ai): align AI endpoint + pattern tests with current contract`.

### Task D4: `test_fuzzy_match_candidates` (1) + `test_entity_resolution` (1) + `test_jobs` (1)
**Files:** the three test files; `entity_resolution.py` / `jobs.py` if real.
- [ ] **Step 1:** `... test investigations.tests.test_fuzzy_match_candidates investigations.tests.test_entity_resolution investigations.tests.test_jobs -v 2 --keepdb 2>&1 | tail -40`
- [ ] **Step 2:** `test_resolve_org_persists_fuzzy_candidate`, `test_ein_enriches_existing_match`, `test_ein_search_with_fetch_xml_populates_parsed` — read the resolver/job code, classify, fix correct layer.
- [ ] **Step 3:** Re-run green; defer big bugs.
- [ ] **Step 4: Commit** (Tyler): `test(resolution): resolve fuzzy/entity/jobs test failures`.

### Task D5: `test_classification` (1 — DOMAIN DECISION)
**Files:** `backend/investigations/tests/test_classification.py` and/or
`backend/investigations/classification.py`.
- [ ] **Step 1:** `... test investigations.tests.test_classification -v 2 --keepdb 2>&1 | tail -15` —
`test_text_below_min_score_returns_other`: `'PARCEL_RECORD' != 'OTHER'`.
- [ ] **Step 2:** Read `classify_document` scoring + min-score threshold in `classification.py`.
- [ ] **Step 3: BRING TO TYLER.** Which is correct: should borderline text classify as
`PARCEL_RECORD` (current code) or `OTHER` (test's expectation)? This is a domain call, not a guess.
- [ ] **Step 4:** Apply his decision to the correct layer (fix the threshold/code, or update the
test). Re-run green.
- [ ] **Step 5: Commit** (Tyler): `fix(classification): <per Tyler's decision>`.

---

## PHASE E — Broken wire

### Task E1: Fix `reevaluateSignals` URL

**Files:** Modify `frontend/src/api/cases.ts:323`

- [ ] **Step 1: Confirm the mismatch**
```bash
grep -nE 'reevaluate' frontend/src/api/cases.ts          # client: /reevaluate-signals/
grep -nE 'reevaluate' backend/investigations/urls.py     # route:  /reevaluate-findings/
```

- [ ] **Step 2: Change the client URL** in `cases.ts` line ~323 from
`/api/cases/${caseId}/reevaluate-signals/` to `/api/cases/${caseId}/reevaluate-findings/`.

- [ ] **Step 3: Typecheck**
```bash
cd frontend && npx tsc --noEmit ; echo "exit=$?"
```
Expected: exit 0. (Fn stays orphaned until the re-run button is wired — separate effort.)

- [ ] **Step 4: Commit** (Tyler): `fix(api): correct reevaluate client URL to /reevaluate-findings/`.

---

## PHASE F — Enforce in CI

### Task F1: Add a `backend-test` CI job

**Files:** Modify `.github/workflows/ci.yml`

- [ ] **Step 1: Add this job** (a Postgres service container with a real password — local trust is
NOT used in CI):
```yaml
  backend-test:
    name: Backend Tests
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: catalyst_db
          POSTGRES_USER: catalyst_user
          POSTGRES_PASSWORD: ci_test_password
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U catalyst_user -d catalyst_db"
          --health-interval 10s --health-timeout 5s --health-retries 5
    defaults:
      run:
        working-directory: backend
    env:
      DATABASE_URL: postgres://catalyst_user:ci_test_password@localhost:5432/catalyst_db
      DJANGO_SECRET_KEY: ci-not-secret
      ANTHROPIC_API_KEY: ci-dummy-key
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Install deps
        run: pip install -r requirements.txt
      - name: Migrate
        run: python manage.py migrate
      - name: Run backend tests
        run: python manage.py test investigations
```

- [ ] **Step 2: Verify the requirements path.** `ls backend/requirements*.txt` — if the file is
elsewhere (e.g. repo root), adjust the `pip install` line to the real path.

- [ ] **Step 3: Validate YAML locally**
```bash
./.venv/Scripts/python.exe -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('ci.yml valid')"
```
Expected: `ci.yml valid`.

- [ ] **Step 4: Commit** (Tyler): `ci: run the backend test suite on every push`. **The true
verification is the GitHub Actions run after push** — confirm the `Backend Tests` job goes green
on the branch PR. (Do this only after the full local suite is green — Phase G.)

### Task F2: Add ≥1 real frontend test

**Files:** Create `frontend/src/<pick a small component>.test.tsx` (e.g. a presentational
component with no network deps).

- [ ] **Step 1: Pick a pure/presentational component** (small, no API calls). Inspect:
`ls frontend/src/components` and read one simple component's props.

- [ ] **Step 2: Write a smoke test**
```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { TheComponent } from "./TheComponent";

describe("TheComponent", () => {
  it("renders without crashing", () => {
    render(<TheComponent /* minimal required props */ />);
    expect(screen.getByText(/* a stable string it renders */)).toBeInTheDocument();
  });
});
```
(Confirm `@testing-library/react` is installed: `grep testing-library frontend/package.json`;
if absent, that's a YELLOW dep add — confirm with Tyler before installing.)

- [ ] **Step 3: Run it**
```bash
cd frontend && npx vitest run 2>&1 | tail -15
```
Expected: 1 passing test (no longer "No test files found").

- [ ] **Step 4: Drop `--passWithNoTests`** from the `test` script in `frontend/package.json` (now
that a real test exists).

- [ ] **Step 5: Commit** (Tyler): `test(frontend): add first vitest smoke test; drop --passWithNoTests`.

---

## PHASE G — Verify & wrap

### Task G1: Full suite green locally

- [ ] **Step 1: Run the whole backend suite (no --keepdb for a clean run)**
```bash
set -a && source .env 2>/dev/null && set +a && export DB_HOST=127.0.0.1 DB_PORT=5433 \
  && ./.venv/Scripts/python.exe backend/manage.py test investigations -v 1 2>&1 | tail -20
```
Expected: `OK` (0 failures/errors); only documented `skip`/`expectedFailure` remain.

- [ ] **Step 2: Frontend gates**
```bash
cd frontend && npx tsc --noEmit && npx vitest run && npx vite build 2>&1 | tail -8
```
Expected: all pass.

### Task G2: Update the audit punch list

**Files:** Modify `docs/architecture/audit-2026-06-03.md` (§3)

- [ ] **Step 1: Mark resolved items** (P1-1 partial→done, P1-3, P1-4, P2-5, P2-6 per decision) and
record connector live-verify results (Task B1) + any deferred `expectedFailure` real bugs as new
punch-list entries.
- [ ] **Step 2: Commit** (Tyler): `docs(audit): record fix-pass outcomes + deferred items`.

### Task G3: Push + confirm CI green

- [ ] **Step 1:** Tyler pushes the `fix/audit-punch-list` branch and opens a PR.
- [ ] **Step 2:** Confirm the new `Backend Tests` job + existing lint/frontend jobs are green on
the PR. If the CI Postgres run surfaces an env-specific failure, fix forward (it's the first time
the suite runs in CI — small env gaps are expected).

---

## Self-review (completed by plan author)

- **Spec coverage:** Phase A (runtime gate)→A1; Phase B (connectors verify+green)→B1–B4;
  Phase C (refactor-stale)→C1–C2; Phase D (triage bucket, all 9 modules)→D1–D5;
  Phase E (broken wire)→E1; Phase F (CI + frontend test)→F1–F2; Phase G (verify/wrap)→G1–G3.
  Every spec phase + DoD item maps to a task. ✅
- **Policy fidelity:** the classification rule (stale/real/dead, never green-an-assertion) is
  stated in Conventions and referenced in every triage task; big-real-bug→xfail+defer is encoded
  in D-tasks + C2. ✅
- **Out-of-scope honored:** no refactor tasks; no Lead-button/feature wiring; connectors get
  test+verify only, no logic rewrite. ✅
- **Owner decisions surfaced:** propublica delete-vs-leave (B4), `test_classification` domain call
  (D5), testing-library dep add (F2) — each flagged for Tyler, not guessed. ✅
- **Placeholder check:** triage tasks intentionally carry a diagnose→fix loop (the fix is unknown
  until diagnosis) with exact commands + the decision rule — method, not placeholder. Deterministic
  tasks (B2/B3/E1/F1) carry concrete changes. ✅
