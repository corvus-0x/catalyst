# Catalyst Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a trustworthy local run+test loop for Catalyst and produce a single audit report mapping inventory, wiring, and a prioritized health punch list — without doing the structural refactor (that is a separate, later planning cycle).

**Architecture:** Read-and-run audit. Each phase appends a section to one growing report at `docs/architecture/audit-2026-06-03.md`. Findings are *cataloged*; only trivially-safe inline fixes are applied (and each is logged). No `views.py`/`models.py` splitting.

**Tech Stack:** Django 4.2 + Django-Q2 + Postgres (`:5433` local), React 18 + Vite + TypeScript, Ruff, Vitest, pytest-style Django `manage.py test`.

---

## Conventions for this plan

- **Spec:** `docs/superpowers/specs/2026-06-03-catalyst-audit-design.md` — read it first.
- **Report artifact:** `docs/architecture/audit-2026-06-03.md` (the single output).
- **Working directory:** repo root `C:\Users\tjcol\Catalyst` unless stated.
- **The verified test invocation** (Bash tool, git-bash) — this exact form is proven to work:
  ```bash
  set -a && source .env 2>/dev/null && set +a && export DB_HOST=127.0.0.1 DB_PORT=5433 \
    && ./.venv/Scripts/python.exe backend/manage.py <command>
  ```
- **Commits:** Tyler commits from his local machine (sandbox git has a pre-commit hook
  permission issue). Each task ends at a **checkpoint**: save the report, summarize what
  landed, and pause for Tyler to review/commit. Do **not** auto-commit. If a trivially-safe
  **code** fix is made, note that Tyler should branch before committing it.
- **Fix boundary:** catalog everything; fix inline only obvious zero-risk items (dead import,
  one-line broken wire). Anything requiring a judgment call (e.g. "is PARCEL_RECORD or OTHER
  the correct classification?") goes to the punch list, NOT an inline fix.

---

## File structure

| File | Responsibility | Created/Modified |
|------|----------------|------------------|
| `docs/architecture/audit-2026-06-03.md` | The audit report — built section by section | Create |
| `docs/architecture/wiring-matrix.md` | Verified/refreshed in Phase 2 | Modify (if drifted) |
| `STATUS.md`, `CLAUDE.md` | Corrected only if Phase 1 finds drift | Modify (only if needed) |
| Trivially-safe inline fixes | Logged in report §Punch List | Modify (only zero-risk) |

---

# PHASE 0 — Local loop & baseline

### Task 1: Scaffold the audit report

**Files:**
- Create: `docs/architecture/audit-2026-06-03.md`

- [ ] **Step 1: Create the report skeleton with all section headers**

Write this exact content (sections get filled by later tasks):

```markdown
# Catalyst Audit — 2026-06-03

**Owner:** Tyler Collins
**Spec:** docs/superpowers/specs/2026-06-03-catalyst-audit-design.md
**Scope:** Catalyst (Django) only. Prism (FastAPI, separate repo) is out of scope.
**Method:** Read + run. Catalog everything; only trivially-safe inline fixes applied.

---

## 0. Local loop & baseline
### 0.1 Local DB reality
### 0.2 Backend test baseline
### 0.3 Frontend gates & lint
### 0.4 Three-tier startup (backend / worker / frontend)
### 0.5 Local loop recipe (for Tyler)

## 1. Inventory
### 1.1 Backend modules
### 1.2 Models & relationships
### 1.3 Frontend
### 1.4 Connectors (verified vs CLAUDE.md)
### 1.5 Test coverage map

## 2. Wiring
### 2.1 Endpoint → client fn → component trace
### 2.2 Orphaned endpoints / broken wires / dead client fns

## 3. Punch list
### 3.1 P0 — blocker
### 3.2 P1 — visible bug / wrong data
### 3.3 P2 — polish
### 3.4 Trivially-safe inline fixes applied
### 3.5 Refactor candidates (input to the SEPARATE refactor plan)

## Definition of done
```

- [ ] **Step 2: Checkpoint** — report skeleton exists; pause for Tyler.

---

### Task 2: Pin down the local DB reality (§0.1)

**Files:**
- Modify: `docs/architecture/audit-2026-06-03.md` (§0.1)

- [ ] **Step 1: Determine what serves `:5433`**

Run each and capture output:
```bash
docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}' 2>&1 | head
powershell -NoProfile -Command "Get-Process postgres -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,Path"
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5433 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess"
```
Expected: identify whether `:5433` is Docker Desktop (CLI not on PATH), a native
Postgres service, or another runtime. Record the owning process and how to start it.

- [ ] **Step 2: Confirm the DB connection + the `.env` port mismatch**

```bash
grep -nE 'DB_PORT|DB_HOST|POSTGRES_' .env
set -a && source .env 2>/dev/null && set +a && export DB_HOST=127.0.0.1 DB_PORT=5433 \
  && ./.venv/Scripts/python.exe backend/manage.py check
```
Expected: `System check identified no issues`. Note in §0.1 whether `.env`'s `DB_PORT`
matches `:5433` (the 34-day-old memory said `.env` had `5434` — confirm current value).
If `.env` points at a dead port, that is a **punch-list item** (flag, don't silently fix).

- [ ] **Step 3: Write §0.1** — what serves `:5433`, how to start it, the correct
      host/port/creds for local runs, and any `.env` mismatch found.

- [ ] **Step 4: Checkpoint** — pause for Tyler.

---

### Task 3: Backend test baseline (§0.2)

**Files:**
- Modify: `docs/architecture/audit-2026-06-03.md` (§0.2)

- [ ] **Step 1: Run the full backend suite locally**

```bash
set -a && source .env 2>/dev/null && set +a && export DB_HOST=127.0.0.1 DB_PORT=5433 \
  && ./.venv/Scripts/python.exe backend/manage.py test investigations -v 1 --keepdb 2>&1 | tail -60
```
Expected: a summary line like `Ran NNN tests` + `FAILED (failures=X, errors=Y)` or `OK`.
Network-dependent connector tests (`test_irs`, `test_county_recorder`, `test_county_auditor`,
`test_ohio_aos`, `test_ohio_sos`, `test_propublica`) may error offline — that is a finding,
not a stop. If the full run is noisy, re-run failing modules individually to capture clean
tracebacks.

- [ ] **Step 2: Catalog every failure/error**

For each failing test, record: module::test name, the assertion/error, and a one-line
hypothesis (test-wrong vs code-wrong vs env/network). Known starting point:
`investigations.tests.test_classification.ClassifyTieBreakingTests.test_text_below_min_score_returns_other`
→ `'PARCEL_RECORD' != 'OTHER'`.

- [ ] **Step 3: Write §0.2** — baseline `N pass / M fail / K error`, the failure table,
      and which failures are env/network vs real.

- [ ] **Step 4: Checkpoint** — pause for Tyler.

---

### Task 4: Frontend gates & lint (§0.3)

**Files:**
- Modify: `docs/architecture/audit-2026-06-03.md` (§0.3)

- [ ] **Step 1: Run each gate from `frontend/`**

```bash
cd frontend && npx tsc --noEmit 2>&1 | tail -40
cd frontend && npm run build 2>&1 | tail -25
cd frontend && npx vitest run 2>&1 | tail -40
```
And lint from `backend/`:
```bash
set -a && source .env 2>/dev/null && set +a && ./.venv/Scripts/python.exe -m ruff check backend 2>&1 | tail -40
```
Expected: capture pass/fail + counts for each. (If `npm` scripts differ, check
`frontend/package.json` `scripts` first and use the real names.)

- [ ] **Step 2: Write §0.3** — table of gate / result / count of issues. Record exact
      tsc errors and ruff rule codes if any.

- [ ] **Step 3: Checkpoint** — pause for Tyler.

---

### Task 5: Three-tier startup (§0.4)

**Files:**
- Modify: `docs/architecture/audit-2026-06-03.md` (§0.4)

- [ ] **Step 1: Start backend (background) and confirm it binds :8000**

```bash
set -a && source .env 2>/dev/null && set +a && export DB_HOST=127.0.0.1 DB_PORT=5433 \
  && ./.venv/Scripts/python.exe backend/manage.py runserver 0.0.0.0:8000
```
(run in background) Expected: `Starting development server at http://0.0.0.0:8000/`.
Then hit health: `curl -s http://127.0.0.1:8000/api/health/ | head` → expect 200/JSON.

- [ ] **Step 2: Start the Django-Q2 worker (background) and confirm it registers**

```bash
set -a && source .env 2>/dev/null && set +a && export DB_HOST=127.0.0.1 DB_PORT=5433 \
  && ./.venv/Scripts/python.exe backend/manage.py qcluster
```
(run in background) Expected: a `Q Cluster ... running` startup line. If it fails (e.g.
broker/DB config), capture the error — that is a finding.

- [ ] **Step 3: Start the frontend (background) and confirm Vite serves :5173**

```bash
cd frontend && npm run dev
```
(run in background) Expected: `Local: http://localhost:5173/`.

- [ ] **Step 4: Record which tiers came up cleanly and any that didn't (§0.4).**
      Stop the background processes when done.

- [ ] **Step 5: Checkpoint** — pause for Tyler.

---

### Task 6: Local loop recipe for Tyler (§0.5)

**Files:**
- Modify: `docs/architecture/audit-2026-06-03.md` (§0.5)

- [ ] **Step 1: Write the reproducible recipe in PowerShell (Tyler's shell)**

Document, using whatever the prior tasks proved correct, the exact steps:
1. Start the local DB (from §0.1).
2. Backend: `cd backend; ..\.venv\Scripts\python.exe manage.py runserver` (with the env it needs).
3. Worker: `cd backend; ..\.venv\Scripts\python.exe manage.py qcluster`.
4. Frontend: `cd frontend; npm run dev`.
5. Tests: the exact `manage.py test` command with the correct `DB_PORT`.
Include the env vars each needs. This section is the deliverable that ends "push to
Railway to find out."

- [ ] **Step 2: Checkpoint** — Phase 0 complete. Pause for Tyler to review the whole
      "Local loop & baseline" section and commit.

---

# PHASE 1 — Inventory

### Task 7: Backend module inventory (§1.1)

**Files:**
- Modify: `docs/architecture/audit-2026-06-03.md` (§1.1)

- [ ] **Step 1: Generate the size data**

```bash
cd backend/investigations && wc -l *.py | sort -rn
```

- [ ] **Step 2: For each module, capture its public surface**

```bash
cd backend/investigations && for f in *.py; do echo "### $f"; grep -nE '^(def |class )' "$f"; done
```

- [ ] **Step 3: Write §1.1 as a table** — columns: `File | Lines | One-line responsibility |
      Public surface (key fns/classes) | Smells`. Flag oversized functions (e.g.
      `views.py:_process_uploaded_file` ~480 lines) and big files (`views.py` 6451,
      `signal_rules.py` 2208, etc.) as **refactor candidates** — named, not planned.
      Use the CLAUDE.md module map as the responsibility starting point; correct any drift.

- [ ] **Step 4: Checkpoint** — pause for Tyler.

---

### Task 8: Models & relationships (§1.2)

**Files:**
- Modify: `docs/architecture/audit-2026-06-03.md` (§1.2)
- Read: `backend/investigations/models.py`

- [ ] **Step 1: List the models and enums**

```bash
grep -nE '^class ' backend/investigations/models.py
```

- [ ] **Step 2: For each real model (not TextChoices), capture FKs/M2M**

```bash
grep -nE 'ForeignKey|ManyToManyField|OneToOneField' backend/investigations/models.py
```

- [ ] **Step 3: Write §1.2** — a model list grouped by domain (Case/Document;
      Person/Org/Property; Financial; Findings; Audit; Jobs), each with its key relationships,
      plus a note on the enum/TextChoices layer (~15 classes). Confirm dedup key on `Finding`
      `(case, rule_id, trigger_entity_id)` matches CLAUDE.md.

- [ ] **Step 4: Checkpoint** — pause for Tyler.

---

### Task 9: Frontend inventory (§1.3)

**Files:**
- Modify: `docs/architecture/audit-2026-06-03.md` (§1.3)

- [ ] **Step 1: Generate frontend size data**

```bash
find frontend/src -type f \( -name '*.ts' -o -name '*.tsx' \) | xargs wc -l | sort -rn
```

- [ ] **Step 2: List the routes and views**

```bash
grep -nE 'Route|element=' frontend/src/App.tsx
ls frontend/src/views frontend/src/components frontend/src/api
```

- [ ] **Step 3: Write §1.3** — tables for views / components / api / types with line counts,
      flagging outliers (`ResearchTab.tsx` ~1137, `types/index.ts` ~1345) as refactor
      candidates. Map the 5 case-detail tabs to their view files.

- [ ] **Step 4: Checkpoint** — pause for Tyler.

---

### Task 10: Connector status verification (§1.4)

**Files:**
- Modify: `docs/architecture/audit-2026-06-03.md` (§1.4)

- [ ] **Step 1: Re-run the connector tests individually (offline-tolerant)**

```bash
set -a && source .env 2>/dev/null && set +a && export DB_HOST=127.0.0.1 DB_PORT=5433 \
  && ./.venv/Scripts/python.exe backend/manage.py test investigations.tests.test_irs \
     investigations.tests.test_county_recorder investigations.tests.test_county_auditor \
     investigations.tests.test_ohio_aos investigations.tests.test_ohio_sos -v 1 2>&1 | tail -40
```

- [ ] **Step 2: Write §1.4** — verify CLAUDE.md's connector table (IRS ✅, County Recorder ✅,
      Ohio AOS ✅, Ohio SOS ✅ manual CSV, County Auditor ❌ ODNR 404, ProPublica superseded)
      against the test results + code. Note any drift between the doc and reality.

- [ ] **Step 3: Checkpoint** — pause for Tyler.

---

### Task 11: Test coverage map (§1.5)

**Files:**
- Modify: `docs/architecture/audit-2026-06-03.md` (§1.5)

- [ ] **Step 1: Map test files to source modules**

```bash
ls backend/investigations/tests/test_*.py
find backend/investigations -maxdepth 1 -name '*.py' | sort
```

- [ ] **Step 2: Write §1.5** — a table: `Source module | Has test file? | Thin/Full | Notes`.
      Call out modules with NO test (e.g. compare the 28 test files against the ~30 source
      modules) as coverage gaps for the punch list.

- [ ] **Step 3: Checkpoint** — Phase 1 complete. Pause for Tyler to review/commit.

---

# PHASE 2 — Wiring

### Task 12: Endpoint → client → component trace (§2.1)

**Files:**
- Modify: `docs/architecture/audit-2026-06-03.md` (§2.1)
- Read: `backend/investigations/urls.py`, `frontend/src/api/*.ts`

- [ ] **Step 1: List every backend route**

```bash
grep -nE 'path\(' backend/investigations/urls.py
```

- [ ] **Step 2: List every API client function and its callers**

```bash
grep -rnE 'export (async )?function|export const' frontend/src/api/
```
Then for each client fn, find its callers:
```bash
grep -rn "<clientFnName>" frontend/src/views frontend/src/components
```

- [ ] **Step 3: Compare against the existing matrix**

Read `docs/architecture/wiring-matrix.md`. For each endpoint, confirm the
endpoint → client fn → component chain still holds. Update the matrix where drifted
(regenerate recipe is in its §5).

- [ ] **Step 4: Write §2.1** — confirm the matrix is current (or list what changed).

- [ ] **Step 5: Checkpoint** — pause for Tyler.

---

### Task 13: Dead-ends catalog (§2.2)

**Files:**
- Modify: `docs/architecture/audit-2026-06-03.md` (§2.2)

- [ ] **Step 1: Find orphaned endpoints (backend exists, no client caller)**

For each `urls.py` route, confirm whether any `frontend/src/api/` fn calls its path.
Known suspects from STATUS.md: `/ai/analyze-patterns/` (Lead), `/reevaluate-findings/`,
`/ai/{summarize,connections,narrative}/`, `/coverage/`. Verify each is truly orphaned.

- [ ] **Step 2: Find broken wires (frontend calls a path that 404s or mismatches shape)**

Cross-check each client fn's URL against `urls.py`. Flag any path the frontend references
that has no matching route, or where the response shape disagrees with `serializers.py` /
`docs/architecture/api-contract.md`.

- [ ] **Step 3: Find dead client fns (defined in `api/`, no component caller)**

From Task 12 Step 2 results, list any client fn with zero callers.

- [ ] **Step 4: Write §2.2** — three lists: orphaned endpoints, broken wires, dead client fns.

- [ ] **Step 5: Checkpoint** — Phase 2 complete. Pause for Tyler to review/commit.

---

# PHASE 3 — Punch list & finalize

### Task 14: Consolidate the prioritized punch list (§3.1–3.3, 3.5)

**Files:**
- Modify: `docs/architecture/audit-2026-06-03.md` (§3.1–3.3, 3.5)

- [ ] **Step 1: Pull every finding from §0–§2 into one place** and assign priority:
  - **P0** — demo-blocker / app won't run / data corruption risk
  - **P1** — visible bug / wrong data / broken wire a user hits
  - **P2** — polish / coverage gap / minor drift

  Each item: `ID | Priority | Area | Symptom | Evidence (file:line or test name) | Proposed action`.

- [ ] **Step 2: Write §3.5 — Refactor candidates.** List the big files / oversized functions
      found in Phase 1 as *input to the separate refactor plan*. Do NOT design the refactor here.

- [ ] **Step 3: Checkpoint** — pause for Tyler.

---

### Task 15: Apply trivially-safe inline fixes (§3.4)

**Files:**
- Modify: `docs/architecture/audit-2026-06-03.md` (§3.4)
- Modify: only the specific source files for zero-risk fixes

- [ ] **Step 1: Select ONLY trivially-safe items from the punch list**

A fix qualifies as trivially-safe ONLY if it is obvious and zero-judgment: a dead import,
an unused variable, a one-line broken wire (wrong path string), a typo in a user-visible
string. Anything requiring a domain decision (e.g. the `test_classification` failure — is
`PARCEL_RECORD` or `OTHER` correct?) is **NOT** trivially-safe → leave it on the punch list.

- [ ] **Step 2: For each selected fix, if it touches runtime code, add/confirm a regression test FIRST**

If the fix changes behavior, follow superpowers:test-driven-development: write the failing
test, run it to confirm RED, apply the fix, run to confirm GREEN:
```bash
set -a && source .env 2>/dev/null && set +a && export DB_HOST=127.0.0.1 DB_PORT=5433 \
  && ./.venv/Scripts/python.exe backend/manage.py test <module>::<test> -v 2
```
Pure-doc or pure-dead-code removals don't need a test.

- [ ] **Step 3: Re-run the affected test module(s) to confirm still green**

```bash
set -a && source .env 2>/dev/null && set +a && export DB_HOST=127.0.0.1 DB_PORT=5433 \
  && ./.venv/Scripts/python.exe backend/manage.py test <affected modules> -v 1 --keepdb
```

- [ ] **Step 4: Write §3.4** — list each inline fix: what, why zero-risk, file:line, test added.

- [ ] **Step 5: Checkpoint** — note for Tyler: **branch before committing code fixes**
      (`git switch -c audit/inline-fixes`). Pause for Tyler.

---

### Task 16: Finalize the report

**Files:**
- Modify: `docs/architecture/audit-2026-06-03.md` (Definition of done)

- [ ] **Step 1: Fill the Definition-of-done checklist** from the spec, ticking each item with
      a pointer to the section that satisfies it.

- [ ] **Step 2: Verify the report has no gaps** — every spec phase has a written section; no
      `TODO`/blank headers remain.

- [ ] **Step 3: Final checkpoint** — audit complete. Summarize for Tyler: baseline health,
      top P0/P1 items, refactor candidates. Note the two SEPARATE next efforts that flow from
      this report: (a) a fix pass on the punch list, (b) a fresh brainstorm to plan the refactor.

---

## Self-review (completed by plan author)

- **Spec coverage:** Phase 0 (loop+baseline) → Tasks 1–6; Phase 1 (inventory) → Tasks 7–11;
  Phase 2 (wiring) → Tasks 12–13; Phase 3 (punch list) → Tasks 14–16. Local DB, three-tier
  startup, full-suite baseline, frontend gates, connector verify, coverage map, wiring refresh,
  orphan/broken/dead catalog, prioritized punch list, trivially-safe fixes, refactor-candidates
  list, and the local-loop recipe are each owned by a task. ✅
- **Out-of-scope honored:** no task splits `views.py`/`models.py`; refactor candidates are
  listed only as input to a separate plan (§3.5). ✅
- **Fix boundary honored:** Task 15 Step 1 gates on "trivially-safe", explicitly routes the
  `test_classification` judgment call to the punch list. ✅
- **Commit discipline:** every task ends at a Tyler-review checkpoint; no auto-commit; branch
  note for code fixes. ✅
```
