# Catalyst Audit — Design Spec

**Date:** 2026-06-03
**Owner:** Tyler Collins (tjcollinsku@gmail.com)
**Status:** Approved — ready for implementation plan
**Topic:** Full inventory + wiring + local-loop health audit of Catalyst (Django backend)

---

## Why this, why now

Catalyst has grown to ~30k lines of backend across `investigations/`, with a
6,451-line `views.py` and a 1,744-line `models.py`. The intent is to refactor
those massive files — but the work was getting pushed to Railway to find out what
broke, which is slow and error-prone. Before any refactor, we need two things:

1. **A trustworthy local loop** — run the backend, worker, frontend, and tests
   locally so broken wires and errors surface *before* a deploy, not after.
2. **An honest map** — what we have, what's wired, what's broken — so the refactor
   starts from facts instead of guesses.

This spec covers **only the audit**. The refactor is a separate, later planning
cycle. We deliberately do **not** plan the audit and the refactor together: an
audit answers *"what is true right now?"* (read-only); a refactor *changes* what's
true. Mixing them contaminates the map with intended changes.

### Scope clarification — two codebases

There are two separate projects on this machine:

- **Catalyst** (Django, `C:\Users\tjcol\Catalyst`) — fraud-detection software,
  still being built. **This is the audit target.**
- **Prism** (FastAPI + SQLAlchemy + Alembic, `OneDrive\Projects\Investigation
  software\`) — intelligent document processing with multiple verticals (fraud,
  insurance, law). Separate repo, already modular. **Out of scope** — noted here
  as one line so the inventory is complete; otherwise untouched.

### Keystone finding (already verified)

The belief that "backend tests can't run locally (Postgres + ArrayField)" is
**stale**. `catalyst/settings.py` always uses Postgres (Railway `DATABASE_URL`,
or local fallback to `127.0.0.1:5433`); there is no SQLite test config. Django's
test runner creates `test_catalyst_db` on the same Postgres, which fully supports
ArrayField. Verified live: `manage.py check` passes and
`manage.py test investigations.tests.test_classification` ran 13 tests in 0.005s
against the local DB — and surfaced **one already-failing test**
(`test_text_below_min_score_returns_other`: `'PARCEL_RECORD' != 'OTHER'`). The
suite is therefore **not currently green on main** — establishing a known baseline
is step zero.

---

## Goal & non-goals

**Goal:** Produce (a) a documented, repeatable local run + test loop with all three
tiers running, and (b) a single audit report mapping inventory, wiring, and a
prioritized health punch list.

**Non-goals (explicitly out of scope):**
- Splitting `views.py` / `models.py` or any structural refactor.
- Fixing anything non-trivial (see Fix Boundary).
- Touching the Prism codebase.
- Re-documenting what existing docs already cover correctly — they get *verified*,
  not rewritten.

---

## Fix boundary

**Catalog everything; fix only trivially-safe things inline.**

- The audit's primary output is the **map + prioritized punch list**.
- Inline fixes are allowed *only* for obvious, zero-risk items: the already-failing
  test (if the fix is trivial), a dead import, a one-line broken wire. Each inline
  fix is listed in the report.
- Anything bigger — logic bugs, shape mismatches, missing endpoints, structural
  smells — is **flagged in the punch list** for a separate, approved fix pass. Local
  may stay partly red at the end of the audit; that's expected and honest.

---

## Phases

### Phase 0 — Stand up the local loop & baseline

The deliverable that ends "push to Railway to find out."

- **Pin down the local DB reality.** Postgres answers on `:5433` but the `docker`
  CLI did not respond to the probe. Determine what's actually serving it (Docker
  Desktop not on PATH? native Postgres? a container under another runtime?) and
  document the reproducible setup.
- **Run all three tiers locally:**
  - Django `runserver` (backend, :8000)
  - Django-Q2 `qcluster` (async worker)
  - Vite `npm run dev` (frontend, :5173)
  - Anything that won't start is itself a finding to catalog.
- **Run the full backend test suite locally** → record `N pass / M fail` and
  catalog every failure (starting with the known `test_classification` failure).
- **Frontend gates:** `tsc --noEmit`, `vite build`, vitest.
- **Lint:** `ruff check .`.
- **Deliverable:** a "run + test Catalyst locally" recipe (commands, env, DB) +
  a baseline health snapshot.

### Phase 1 — Inventory ("what do we have")

- **Backend modules:** every file in `investigations/` — size, one-line
  responsibility, public surface, notable smells (e.g. `_process_uploaded_file`
  at ~480 lines). Big files are flagged as *refactor candidates* — named, not
  planned.
- **Models:** the ~25 models + relationships + the enum/TextChoices layer.
- **Frontend:** views / components / api / types; outliers (`ResearchTab.tsx`
  ~1,137 lines, `types/index.ts` ~1,345 lines).
- **Connectors:** verify the status table in CLAUDE.md against reality (IRS, County
  Recorder, Ohio AOS, Ohio SOS, County Auditor, ProPublica).
- **Tests:** coverage map — which modules are well-tested, which are thin or missing.

### Phase 2 — Wiring verification ("is it connected")

- Trace every `urls.py` endpoint → API client fn (`frontend/src/api/`) → component
  that calls it.
- Verify/refresh `docs/architecture/wiring-matrix.md` (one day old).
- Catalog:
  - **Orphaned endpoints** — backend exists, no caller (e.g. Lead AI
    `/ai/analyze-patterns/`, `/reevaluate-findings/`, `/ai/{summarize,connections,
    narrative}/`, `/coverage/`).
  - **Broken wires** — frontend calls something that 404s or mismatches shape.
  - **Dead client fns** — API functions with no component caller.

### Phase 3 — Health findings & punch list ("what's broken")

- Consolidate everything from Phases 0–2 into one prioritized list
  (P0 demo-blocker / P1 visible bug / P2 polish), matching the existing STATUS.md
  punch-list style.
- Apply + list the trivially-safe inline fixes.
- **Deliverable:** the punch list — the input to the *next two* separate efforts
  (a fix pass, then refactor planning).

---

## Output artifact

A single report: **`docs/architecture/audit-2026-06-03.md`**, with sections
mirroring the phases (Local Loop & Baseline, Inventory, Wiring, Punch List).

Existing docs (`STATUS.md`, `wiring-matrix.md`, `CLAUDE.md`) are verified and, where
drifted, corrected — not rewritten from scratch.

---

## Definition of done

- [ ] All three tiers (backend, worker, frontend) confirmed running locally, with a
      documented recipe.
- [ ] Full backend suite run locally; baseline `N pass / M fail` recorded with each
      failure cataloged.
- [ ] Frontend `tsc` / `build` / vitest and `ruff check` results recorded.
- [ ] Inventory complete: every backend module, model, frontend area, connector, and
      test coverage mapped.
- [ ] Wiring matrix verified/refreshed; orphaned endpoints, broken wires, and dead
      client fns cataloged.
- [ ] Single prioritized punch list produced (P0/P1/P2).
- [ ] Trivially-safe inline fixes applied and listed; everything bigger flagged, not
      fixed.
- [ ] `docs/architecture/audit-2026-06-03.md` written.

---

## Risks & open items

- **Local DB provenance unknown.** `:5433` is up but `docker` CLI didn't respond;
  Phase 0 must resolve what's actually serving it before the recipe can be trusted.
- **Worker / frontend may not start cleanly.** That's a finding, not a blocker —
  catalog and continue.
- **Scope creep into fixing.** The fix boundary is the guardrail: catalog, don't fix,
  except trivially-safe items.
- **Commits.** Tyler commits from his local machine (sandbox git has hook permission
  issues). This spec and the audit report are written to disk for Tyler to commit.
