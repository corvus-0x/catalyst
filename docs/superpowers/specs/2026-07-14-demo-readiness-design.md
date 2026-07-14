# Demo Readiness — Design

**Date:** 2026-07-14
**Status:** Approved (Tyler, Session 56)
**Goal:** Make the public demo — the Railway deployment, the seeded "Bright Future
Foundation" case, and the README that fronts them — presentable to two audiences:
a recruiter clicking the link cold (primary) and Tyler driving a live interview
walkthrough (secondary).

**The winning standard:** a recruiter can understand the project in 90 seconds,
then a technical reviewer can inspect the repo and see that the hard parts are
real. "Works" is the floor; "communicates why it's non-trivial" is the bar.

## Problem

The Case Map arc (Phases 1A → 4D, PRs #13–#24) shipped after the demo case was
last polished. The features render, but the seeded data barely exercises them:

- Only the flagship thread has Phase 4 structured assertions; the other nine
  (the seed authors 10 threads: 9 rule-backed findings SR-003→SR-029 plus 1 AI
  Lead finding) have none, so the Thread Builder and derived assertion roles
  (fact / analysis / claim) have almost nothing to show.
- **A fresh reseed silently breaks the referral-grade mix.** Seeded findings
  take the model default `gate_version=ASSERTION_V1`, and the 4B gate requires
  a cited assertion AND a handoff-ready assertion — which only the flagship
  has. A fresh `seed_demo --reset` today therefore yields **1** referral-grade
  thread, not the intended 5. Prod still shows 5 only because its pre-4B rows
  were grandfathered to `LEGACY_NARRATIVE` by the 4A backfill migration; the
  Phase 3 reseed would degrade the live demo without Phase 1's repair.
- Lead Suggestions (Phase 4D) is assist-only by design — proposals live in the
  job result and never persist until accepted — so it can only demo *live*. The
  current seed gives it thin freeform input, producing weak proposals.
- Seeded transactions/addresses don't all resolve to case subjects, so the 1A
  fast-follow collectors (`shared_address`, `financial_link`) render few or no
  Case Map edges, and SR-003/SR-005 log zero-subject-pair warnings on demo data.
- README screenshots predate the Replay tab rename; the demo GIF predates the
  entire Case Map redesign.
- Known deferred rough edges: raw "403 Forbidden" error copy; jobs API exposes
  raw exception strings in `error_message`.

An empty or thin panel demos worse than no panel — it reads as broken, not absent.

## Approach (chosen)

Audit-first: build an evidence-based punch list from the live demo before fixing
anything, fix in two focused branches, reseed and capture exactly once at the end.
Rejected alternatives: fixes-first with audit-as-verification (risks a second
prod reseed when late surprises surface) and one big branch (public `main`, hard
to review, against the repo's additive-first discipline).

## Phase 0 — Cold-Click Audit (no code changes)

Drive a browser through the live Railway demo as a first-time recruiter:

- Every route: `/` Dashboard, `/cases`, `/cases/:id` (all 6 tabs: Investigate ·
  Research · Financials · Timeline · Referrals · Replay), `/search`, `/settings`.
- The README as the pre-click surface (screenshots, GIF, claims vs. reality).
- Exercise Lead Suggestions live once to baseline what the current thin seed
  produces — the Phase 1 enrichment must beat it.

Every empty state, stale string, thin dataset, broken interaction, or confusing
moment goes into a punch list at `docs/superpowers/plans/` with a severity:
**demo-blocker / rough edge / nice-to-have**. The click path doubles as the
draft walkthrough script.

**Scope cap (anti-QA-month rule):** Phase 2 fixes only items that (a) block or
visibly mar the recruiter walkthrough path, or (b) expose internal/raw system
behavior (exception strings, stack traces, model names, raw HTTP codes as
user copy). Everything else is logged with severity and left for later. The
punch list bounds the effort; it does not grow it.

**Recruiter skim audit.** Alongside the click-through, score the README + live
demo on a 90-second recruiter pass: Can I tell what Catalyst is in one screen?
Can I tell what engineering problems Tyler solved? Can I find the live demo,
screenshots, tech stack, tests, and architecture without hunting? Do any
claims sound inflated compared with what the demo actually shows?

**Claim-vs-proof table.** A dedicated punch-list category for README claims
that need proof, each row: claim → proof (screenshot/GIF step + test
reference) → code path. Example: "citation-backed referral package" → GIF
step N + `test_referral_pdf.py` → source document → thread assertion →
referral PDF.

**Recruiter confusion log.** Track not only bugs but "I don't know why this
matters" moments — a working feature that doesn't communicate its value is
still a demo problem, and these feed the walkthrough script and README
Engineering Highlights.

## Phase 1 — Seed Enrichment (branch 1)

Extend `seed_demo` so the data showcases the post-Case-Map feature set:

- **Repair the referral-grade mix under the ASSERTION_V1 gate.** Each of the
  5 intended referral-grade threads gets ≥1 cited assertion AND ≥1
  handoff-ready assertion (a single cited + handoff_ready assertion satisfies
  both — see `referral_grade.py`), so a fresh reseed restores the deliberate
  **5 referral-grade / 6 need-work** mix among the 11 seeded threads (the
  dedup-parity repair adds an Elm SR-003 row). This is a correctness
  requirement, not just polish (see Problem).
- **Assertions across threads.** Referral-grade threads get cited assertions
  with a realistic fact/analysis mix; need-work threads get uncited assertions
  and open QUESTIONs. The Thread Builder shows the full derived-role spectrum,
  and the 5/5 mix becomes *visible*, not just counted.
- **Staged input for Lead Suggestions.** 2–3 threads get rich freeform
  NOTE/QUESTION elements — and, required, `FindingDocument` links to their
  evidence documents: `build_thread_context` puts `finding.document_links`
  docs first when assembling the 40k-char prompt budget
  (`ai_thread_assist.py`), so narrative name-drops alone do not get the
  evidence into context. (The seed stages the *input*; the output is
  generated live — that is the demo.)
- **Collector-visible relationship data.** Seeded addresses and transactions
  must resolve to case subjects so `shared_address` edges render, and the
  seed adds `FinancialInstrument` rows (debtor ↔ secured-party pairs, both
  resolving to case subjects) to light up `financial_link` edges. Fixes the
  seed bug behind the SR-003/SR-005 zero-subject-pair warnings.
- **`--reset` must delete every row type the seed creates.**
  `FinancialInstrument.case` is `on_delete=RESTRICT`; the current reset block
  deletes no instrument rows, so adding them without extending the reset path
  breaks every subsequent `--reset` (including Phase 3's prod reseed). Same
  rule applies to any other new RESTRICT-linked row type Phase 1 introduces.
- **One canonical walkthrough path, seeded deliberately.** The seed supports
  one clean end-to-end story: public record → subject relationship → Case Map
  edge → Thread Builder assertion → cited, handoff-ready claim → referral
  PDF. This exact path is what the README Traceability Walkthrough and the
  GIF follow — not just "more realistic data," but a designed demo spine.
- **The canonical path is asserted in tests.** Beyond "5 referral-grade," a
  seed test asserts at least one thread has: a cited assertion, a
  handoff-ready assertion, a Case Map relationship edge involving its trigger
  subject, and inclusion in the referral PDF.
- **Invariants preserved:** `--reset` idempotency; all confirmed threads keep
  cited documents; the referral PDF stays complete; the 5/5 honest mix stands
  (no all-green demo — Tyler's standing call).

## Phase 2 — Polish Fixes (branch 2)

Punch-list-driven. Definitely in scope: the two known deferred items (raw
"403 Forbidden" error copy; raw exception strings in jobs API `error_message`).
Otherwise scope-capped to punch-list items marked demo-blocker or rough edge —
nice-to-haves get logged for later, not built now.

**Job error-message contract decision:** `_mark_failed` (`jobs.py`) currently
persists `f"{type(exc).__name__}: {exc}"` into `SearchJob.error_message`, which
the jobs API returns verbatim. The fix: `error_message` becomes sanitized,
human-readable copy (no exception class names, no internal paths/details); the
raw exception stays server-side via the existing `logger.exception` call. The
field's type and presence in the API are unchanged — content only. Existing
tests that assert raw messages (`test_jobs.py`, `test_ai_thread_assist.py`)
are updated to assert the sanitized copy, and `api-contract.md` gets a note.

**Read-only demo mode — decided (Tyler, 2026-07-14, punch-list P0-6).** Prod
gets an env-flagged demo guard: anonymous mutation endpoints return 403 with
friendly copy ("This is a read-only public demo") while GET/read paths stay
open. Rationale: anonymous visitors can currently delete threads, create
cases, and re-run signals — this is how prod data drift (P0-1, P0-2) keeps
happening, and any cleanup decays without it. Constraints: `seed_demo` and
management commands are unaffected (they bypass HTTP); the API health check
currently *creates* test rows against prod (the "CSRF Test Case" source
suspect) and must be made demo-mode-aware or pointed at a mutation-exempt
self-cleaning path — the smoke test must stay green against prod.

**`query_params` stays public — decided, not overlooked.** `api_job_detail`
and `api_case_jobs` return `query_params` verbatim. Its contents are the
caller's own search inputs (query, county, fetch_xml), which the frontend
needs for reattach-on-mount labels, and the codebase already enforces the
boundary by convention: the AI ask endpoint stores transcripts in cache
specifically because job params are readable via the jobs API (`views.py`,
Session 54). Unlike `error_message`, nothing internal leaks. No change.

## Definition of Done

Branch 1 does not merge, and Phase 3 does not start, until every box checks:

- [ ] `seed_demo --reset` runs **twice in a row** cleanly, locally AND on the
      Railway PR preview (idempotency + RESTRICT-path proof).
- [ ] Post-seed: exactly 11 threads (10 rule-backed incl. the Elm SR-003 the
      dedup-parity work adds, + 1 Lead); exactly 5 in `referral_grade_qs(case)`
      chosen by an explicit rule list including both CRITICALs (SR-015 = the
      canonical spine); 6 need-work — asserted in tests, not eyeballed. (If the
      parity test forces a second SR-015 row, 12 threads — sync this line.)
- [ ] Case Map for the demo case renders `transaction`, `shared_address`, and
      `financial_link` evidence categories.
- [ ] ≥2 Lead-staged threads each have NOTE/QUESTION elements AND
      `FindingDocument` links to seeded documents.
- [ ] Referral PDF exports successfully (200 + `%PDF`) from the enriched seed.
- [ ] Public job failures show sanitized copy; raw exception appears only in
      server logs.
- [ ] README screenshots/GIF regenerated from the final live demo; stale
      assets deleted or replaced (no old-UI images left on the public surface);
      README claims spot-checked against the live deployment.
- [ ] Prod reseed preflight completed and rollback note written (below).

Recruiter-facing layer:

- [ ] README first viewport explains what Catalyst does, who it's for, and
      why it's technically non-trivial (90-second skim standard).
- [ ] README has an **Engineering Highlights** section with 5–7 concrete
      bullets.
- [ ] README has a **Traceability Walkthrough** matching the GIF path.
- [ ] README distinguishes real implemented behavior from demo-seeded data
      and deferred work.
- [ ] The GIF shows one complete engineering loop: source/evidence → Case
      Map → Thread Builder → assertion or Lead Suggestions → referral
      output/readiness.
- [ ] Walkthrough script lists exact clicks and the engineering point each
      screen proves.
- [ ] No empty prestige panels: every major panel on the walkthrough path
      either contains meaningful data or has intentional empty-state copy —
      no "thin because seed data" panels.
- [ ] Proof artifacts are discoverable: README links to `api-contract.md`,
      the frontend design spec, the test command, and the demo seed command,
      and names the specific tests/suites protecting the critical workflow.

## Phase 3 — Reseed + Capture + Leave-Behinds

1. **Prod reseed preflight (before `--reset` touches Railway):** record the
   current demo case id and finding/thread counts; save current README
   screenshot/GIF assets aside; take a DB backup (`pg_dump` via `railway ssh`
   or a Railway snapshot) and note the restore command. Only then, with
   Tyler's go-ahead, run `seed_demo --reset`. The rollback story is: restore
   the dump, or re-run the pre-branch-1 seed from the old commit — written
   down before execution, not improvised after.
2. Verify with the smoke test (target: 29/29 or better) and re-check the
   Definition of Done items against prod.
3. Fresh README screenshots from the live demo; new demo GIF covering the
   canonical path (source/evidence → Case Map → Thread Builder → assertion /
   Lead Suggestions → referral output). **Asset hygiene:** new assets land in
   the README's existing image location (`docs/` screenshots path); every
   superseded screenshot/GIF is deleted in the same commit, and the README is
   grepped for references to removed files.
4. **README restructuring — content, not just assets** (one README PR with
   both, since the Traceability Walkthrough must match the final GIF path):
   - Top summary in plain language: what Catalyst is, who it's for, why it's
     technically non-trivial — all in the first viewport.
   - **Engineering Highlights** — 5–7 concrete bullets (e.g., dual-version
     referral gate with grandfathering migration, async job contract with
     reattach-on-mount, citation chain to SHA-256 document index, rule +
     human-review pipeline, 1,100+ tests).
   - **Traceability Walkthrough** — the canonical path, step by step,
     matching the GIF.
   - **Real vs demo-seeded** — what's implemented behavior vs staged data vs
     deferred work.
   - **Tradeoffs / Next steps** and **How to verify** (run commands, test
     commands, seed command).
   - **Framing rule:** lead with traceability, async jobs, data modeling,
     graph workflow, tests, and human review. Lead Suggestions is supporting
     evidence, not the headline — same credibility-firewall logic as the
     banned-strings gate: the audience discounts AI claims, so the AI feature
     earns trust only after the engineering does.
   - **Honesty pass:** sweep for overclaims. Prefer "production-style" over
     "production-ready," "public-records investigation workflow" and
     "signals" over "fraud detection," "human-reviewed findings," "referral
     packaging." Every superlative must map to a claim-vs-proof row.
5. **Lead Suggestions demo fallback:** after enrichment, run Lead Suggestions
   once against the staged threads and capture a known-good result
   (screenshot + the proposal JSON shape). The walkthrough script presents it
   as "generated live — here's the expected shape," so an interview never
   depends on a perfect fresh model call.
6. Short **walkthrough script** doc — the interview screen-share path, derived
   from the audit route: exact clicks, the engineering point each screen
   proves, and the Lead fallback framing above.

## Testing & Safety

- **Branch-1 tests, named now:** extend `test_seed_demo_elements.py`
  (10 threads / 5 referral-grade via `referral_grade_qs` / double-`--reset`
  idempotency / staged NOTE-QUESTION + `FindingDocument` links); extend
  `test_case_map.py` or add a seed-scoped test asserting `shared_address` and
  `financial_link` categories appear after seeding; extend
  `test_referral_pdf.py` to prove the PDF exports from the ASSERTION_V1-
  repaired seed.
- Each branch follows the standing 3-stage gate: local Docker suite
  (`--exclude-tag=eval --keepdb --noinput`) → Railway PR preview (seeded via
  `railway ssh -- sh -lc "python manage.py seed_demo --reset"` and eyeballed)
  → merge. Preview must run **`--reset` at least once** on the branch-1
  preview — Phase 3's prod reseed uses `--reset`, and the reset path is
  exactly where the new RESTRICT-linked rows can break, so seeding preview
  without it tests the wrong path.
- Prod is reseeded once, in Phase 3, after both branches land.
- Banned-strings gate applies to all new user-visible copy (Lead/Intake
  vocabulary; never model or AI names).

## Out of Scope

- Phase 5 feature work (unplanned; separate brainstorm).
- Cross-case Referrals view rebuild (deferred, unchanged).
- views.py refactor (tracked separately in "What's next").
