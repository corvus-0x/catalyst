# Catalyst Fix Pass — Design Spec

**Date:** 2026-06-03
**Owner:** Tyler Collins (tjcollinsku@gmail.com)
**Status:** Approved — ready for implementation plan
**Topic:** Health-and-correctness fix pass on the punch list from the 2026-06-03 audit
**Input:** `docs/architecture/audit-2026-06-03.md` (§3 punch list)

---

## Why this

The audit established a trustworthy local loop and found that the test story is hollow: the
backend suite is **53 red / 873 green** and **run by no CI**, the frontend has **zero tests**,
there's **one real broken wire**, and some **dead code** (propublica). This pass makes the
repo's test claims *true* — a green suite enforced by CI — and live-verifies the connectors. It
is deliberately **not** a refactor (that's a separate, later cycle) and **not** a feature pass
(wiring the dark "Lead" button is deferred).

Because local tests now work (audit §0), every step is **green-before-push** — no more
Railway-roulette.

---

## Scope

**In scope (health & correctness):**
- Triage the 53 red backend tests to green (root-cause each; fix the right layer).
- Live-verify the connectors against real sources + update their stale tests.
- Fix the one real broken wire (`reevaluateSignals` URL).
- Enforce: add a backend-test CI job; add ≥1 real frontend test.

**Out of scope (deferred to separate efforts):**
- Wiring the dark "Lead" AI button (P1-5) and rehoming/deleting orphaned AI endpoints (P2-7) —
  feature work.
- Doc reconciliation (P2-1/2/3), bundle code-splitting (P2-4), broad coverage-gap backfill
  (P2-8 beyond the one frontend smoke test).
- Any structural refactor of `views.py`, `referral_export.py`, etc. (§3.5 — its own cycle).
- Rewriting connector **logic** (connectors work; only their tests/verification are in scope).

---

## Governing policies

1. **Root-cause before touching.** For every red test, first classify: **stale test** (asserts
   outdated values against working code → update the test), **real bug** (code violates correct
   behavior → fix the code), or **dead code** (→ delete). **Never change an assertion just to make
   it green** — that certifies a bug. (Follows systematic-debugging + TDD.)
2. **Real bug, big vs small:** small real-bug fixes (a few lines) land in this pass; a real bug
   that balloons gets root-caused, the test marked `@expectedFailure`/`skip` with a reason +
   a new audit punch-list entry, and we move on. Keeps the pass tight (first 70% is 100%).
3. **Connectors:** don't rewrite connector logic. DO update their stale tests and live-verify
   them. `propublica` is superseded (not a working connector) — delete-vs-leave is an owner call
   during execution.
4. **Green-before-push, module-by-module.** Fix one test module → re-run it green locally →
   commit. CI is wired **last**, once the full suite is green. Tyler commits from his local
   machine; each module is an independent, bisectable commit.
5. **CI auth:** the local `trust` hack is **local-only**. The CI backend-test job uses a
   Postgres **service container** with a real `POSTGRES_PASSWORD` via `DATABASE_URL` — no trust.

---

## Phases

### Phase A — Runtime sanity gate
`manage.py seed_demo` → load `http://localhost:5173/` → run the `/smoke-test` skill (or
`tests/api_health_check.py`). Confirms the app **works with data**, not just **starts**. Catalog
any runtime/wiring bug surfaced. Closes the audit's "runs vs works" gap (audit §0.4).

### Phase B — Connectors: verify + green
- **Live-verify** each connector against real sources and record real-world status:
  IRS TEOS XML (e.g. the "bright future" name search), County Recorder, Ohio AOS, Ohio SOS
  (manual-CSV path). County Auditor is expected to fail (ODNR ArcGIS 404 — upstream, not fixable).
- **Update stale connector tests** to match current working code — no connector-logic changes:
  - `test_irs`: fix the import (`EoBmfRecord` → current symbol) so the module loads.
    **[Escalated 2026-06-04 — owner decision]** Investigation found `test_irs.py` is not a
    stale import but **104 dead tests** for the removed Pub78/EO-BMF subsystem; the connector was
    rewritten to a 990-XML design. Tyler chose to **rewrite** `test_irs.py` against the XML
    connector rather than patch an import. See the deep sub-plan:
    `docs/superpowers/plans/2026-06-04-catalyst-phase-b-connectors.md` (Task B2). This widens the
    original "fix the import" scope for `test_irs` only.
  - `test_county_auditor`: update asserted URL (`odnr_landbase_v2` → `odnr_landbase`).
  - `test_ohio_aos`: refresh the drifted mock fixture (`11545 != 2`).
- **`propublica`:** superseded. Owner call during execution — delete `propublica_connector.py`
  + `test_propublica.py` (clears 2 reds, shrinks surface) **or** leave with a skip note.

### Phase C — Refactor-stale tests (non-connector)
- `test_steps_1_through_4` (~14): `FindingIntake/UpdateSerializer` tests assert removed fields
  (`detection_id`, `confidence`) and old "minimal valid" payloads. Update to the current
  `Finding` model/serializer contract.
- Stale serializer/endpoint tests in `test_signals` (the non-rule ones): align with current
  serializer keys + endpoint behavior.

### Phase D — Triage bucket (root-cause each)
`test_upload_pipeline` (4 — SHA-256 dedup), `test_ai_endpoints` (3), `test_ai_pattern` (2),
`test_new_endpoints` (4 — export metadata), `test_fuzzy_match_candidates` (1),
`test_entity_resolution` (1 — `test_ein_enriches_existing_match`), `test_jobs` (1),
`test_api` (1 — case list filter), `test_classification` (1). For each: classify stale vs real,
fix per policy 1–2. **`test_classification`** (`'PARCEL_RECORD' != 'OTHER'`) is a **domain
decision** — bring the tie-break-threshold question to Tyler before changing test or code.

### Phase E — Broken wire
Fix `frontend/src/api/cases.ts:323`: `/api/cases/${caseId}/reevaluate-signals/` →
`/api/cases/${caseId}/reevaluate-findings/` (matches the backend route + alias). One-line fix;
note it stays orphaned until the re-run-rules button is wired (separate feature effort).

### Phase F — Enforce in CI
- Add a **`backend-test`** job to `.github/workflows/ci.yml`: a `postgres` service container
  (real password), install deps, `migrate`, `manage.py test investigations`. Green required.
- Add **≥1 real frontend vitest test** (e.g. a smoke render of a small component) so
  `--passWithNoTests` can be dropped. (Full frontend coverage is out of scope.)

### Phase G — Verify & wrap
- Full `manage.py test investigations` green locally (0 unexpected failures; documented
  skips/xfails only).
- CI config validated (the new job runs + passes).
- Update `docs/architecture/audit-2026-06-03.md` §3 punch list: mark fixed items done; add
  entries for any deferred (xfail) real bugs and the connector live-verify results.

---

## Definition of done

- [ ] Phase A: app verified working with seeded data (not just starting).
- [ ] Connectors live-verified; status recorded (ODNR known-down); stale connector tests green.
- [ ] All non-connector stale tests updated; triage bucket root-caused and resolved (fixed or
      documented xfail).
- [ ] Broken wire (`reevaluateSignals` URL) fixed.
- [ ] `manage.py test investigations` green locally — 0 unexpected failures.
- [ ] CI runs + passes the backend suite (new `backend-test` job); ≥1 real frontend test exists.
- [ ] Audit punch list updated with outcomes + any deferred items.

---

## Risks & open items

- **Live-verify is network-dependent.** Connectors needing live external calls may be slow or
  rate-limited; record status, don't block the pass on upstream availability (ODNR will fail).
- **Triage bucket may hide a real bug bigger than expected** — policy 2 (xfail + flag) caps the
  blast radius so one gnarly bug can't balloon the pass.
- **`test_classification` is a domain decision** — needs Tyler's call; don't guess.
- **Commits:** Tyler commits from his local machine (sandbox git hook issue). Each module is a
  separate green commit; the agent reaches checkpoints, Tyler commits.
- **CI Postgres parity:** the service container must match the app's PG major version closely
  enough for ArrayField/migrations (Postgres 16 in compose; PG18 locally — both fine for these).
