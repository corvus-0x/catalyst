# Demo Readiness — Design

**Date:** 2026-07-14
**Status:** Approved (Tyler, Session 56)
**Goal:** Make the public demo — the Railway deployment, the seeded "Bright Future
Foundation" case, and the README that fronts them — presentable to two audiences:
a recruiter clicking the link cold (primary) and Tyler driving a live interview
walkthrough (secondary).

## Problem

The Case Map arc (Phases 1A → 4D, PRs #13–#24) shipped after the demo case was
last polished. The features render, but the seeded data barely exercises them:

- Only the flagship thread has Phase 4 structured assertions; the other nine are
  legacy narrative, so the Thread Builder and derived assertion roles
  (fact / analysis / claim) have almost nothing to show.
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
**demo-blocker / rough edge / nice-to-have**. The punch list is the definition
of done for the whole effort. The click path doubles as the draft walkthrough
script.

## Phase 1 — Seed Enrichment (branch 1)

Extend `seed_demo` so the data showcases the post-Case-Map feature set:

- **Assertions across threads.** Referral-grade threads get cited assertions
  with a realistic fact/analysis mix; need-work threads get uncited assertions
  and open QUESTIONs. The Thread Builder shows the full derived-role spectrum,
  and the deliberate 5 referral-grade / 5 need-work mix becomes *visible*, not
  just counted.
- **Staged input for Lead Suggestions.** 2–3 threads get rich freeform
  NOTE/QUESTION elements and narrative that reference seeded documents, so a
  live "Suggest" click yields grounded proposals. (The seed stages the *input*;
  the output is generated live — that is the demo.)
- **Collector-visible relationship data.** Seeded addresses and transactions
  must resolve to case subjects so `shared_address` and `financial_link` edges
  render on the Case Map. Fixes the seed bug behind the SR-003/SR-005
  zero-subject-pair warnings.
- **Invariants preserved:** `--reset` idempotency; all confirmed threads keep
  cited documents; the referral PDF stays complete; the 5/5 honest mix stands
  (no all-green demo — Tyler's standing call).

## Phase 2 — Polish Fixes (branch 2)

Punch-list-driven. Definitely in scope: the two known deferred items (raw
"403 Forbidden" error copy; raw exception strings in jobs API `error_message`).
Otherwise scope-capped to punch-list items marked demo-blocker or rough edge —
nice-to-haves get logged for later, not built now.

## Phase 3 — Reseed + Capture + Leave-Behinds

1. Reseed Railway prod (`seed_demo --reset`) — outward-facing; confirm with
   Tyler before touching prod. Verify with the smoke test.
2. Fresh README screenshots from the live demo.
3. New demo GIF: Case Map → Thread Builder → Lead Suggestions arc.
4. Short **walkthrough script** doc — the interview screen-share path, derived
   from the audit route.

## Testing & Safety

- Each branch follows the standing 3-stage gate: local Docker suite
  (`--exclude-tag=eval --keepdb --noinput`) → Railway PR preview (seeded via
  `railway ssh -- sh -lc "python manage.py seed_demo"` and eyeballed) → merge.
- Prod is reseeded once, in Phase 3, after both branches land.
- Banned-strings gate applies to all new user-visible copy (Lead/Intake
  vocabulary; never model or AI names).

## Out of Scope

- Phase 5 feature work (unplanned; separate brainstorm).
- Cross-case Referrals view rebuild (deferred, unchanged).
- views.py refactor (tracked separately in "What's next").
