# Demo Readiness — Phase 0 Cold-Click Audit Punch List

**Date:** 2026-07-14
**Auditor:** Claude (cold-click pass as first-time recruiter), per
`docs/superpowers/specs/2026-07-14-demo-readiness-design.md`
**Target:** https://catalyst-production-9566.up.railway.app/ (prod, `main`) +
README.md as the pre-click surface.
**Severities:** **P0 demo-blocker** · **P1 rough edge** · **P2 nice-to-have**

---

## P0 — Demo-blockers

### P0-1. Prod demo data is degraded: 0 referral-grade, 14 threads, PDF blocked
The Investigate readiness panel shows **"0 referral-grade · 14 need work."**
The Referrals tab shows **"Blocked"** in red with the Generate Referral
Package button disabled — the product's central deliverable cannot be
demonstrated at all. The flagship FALSE_DISCLOSURE thread shows "Overreach
not reviewed · No cited assertion · No handoff-ready claim."
**Root causes:** (a) the ASSERTION_V1 reseed regression the spec predicted;
(b) a Jul 8 `reevaluate_signals` run created live-rule findings that did NOT
dedup against the seeded ones — "INSIDER_SWAP", "Purchase Price Deviates",
and "ZERO_CONSIDERATION" each appear twice with different titles (14 = 9
seeded + 1 Lead + 4 live duplicates).
**Fix:** Phase 1 seed repair + Phase 3 reseed. **New Phase 1 requirement
discovered by this audit:** seeded findings must be dedup-compatible with
live rule output — same `(rule_id, trigger_entity_id)` identity and title
format the rules generate — so a signal re-evaluation converges instead of
duplicating.

### P0-2. "CSRF Test Case" junk rows (×2) sit above the demo case on the dashboard
First thing a recruiter sees. They have re-accumulated since the June 8
purge (dashboard shows Jul 8 + Jun 11 rows). Something recurring creates
them in prod. **Fix:** purge rows AND find + stop the creator (suspect: a
health-check or CSRF probe path that doesn't self-clean). Phase 2.

### P0-3. `/settings` renders a completely blank page (uncaught TypeError)
`SettingsView-DzYy_dC9.js`: `TypeError: Cannot read properties of undefined
(reading 'length')` — React unmounts to a black screen, no error boundary.
Console confirms uncaught exception. **Fix:** Phase 2 (bug + consider a
route-level error boundary so no future crash ever blanks the whole app).

### P0-4. Lead Suggestions dead in prod — ROOT CAUSE FOUND: stale worker (infra)
**Update 2026-07-14 (post-audit investigation):** the prod `catalyst-worker`
service is deployed from `26c2880` — a **pre-history-rewrite commit from
early June**. Its auto-deploy has been broken since the June force-push, so
every job function added since (including Phase 4D `run_thread_assist`) is
unknown to it: thread-assist jobs enqueue (202) and hang QUEUED forever, and
the "2 research jobs still running" in readiness (P1-5) are the same rot.
The frontend button behavior observed in the audit is consistent with a
never-completing job, not a component bug (`LeadSuggestionsPanel` renders
"Working…" while QUEUED; the a11y `find` missed it because the label
changed).
**Fix (two parts):** (a) INFRA, immediate: deploy current `main` to
`catalyst-worker` (`railway up --service catalyst-worker` from a clean main
checkout) and repair the service's auto-deploy source in the Railway
dashboard — likely still pointed at a pre-rewrite SHA/branch state. (b)
Phase 2 UX hardening: `useAsyncJob` has no timeout — a job stuck QUEUED
shows "Working…" forever; add a stuck-job timeout message + surface FAILED
error copy, and purge/expire stale QUEUED SearchJobs so readiness stops
counting corpses.

### P0-5. Dashboard stat card: "Total angles: 0"
Wrong count (case has 14 findings) AND stale pre-rename vocabulary in the
most prominent stat on the landing page. **Fix:** Phase 2 (label → Threads,
count query fixed).

### P0-6. Public demo is fully writable by anonymous visitors — DECISION NEEDED (RED)
Any visitor can delete threads (red Delete button in Thread Builder), create
cases, re-run signals, edit statuses. This is *how* P0-1 and P0-2 happened
and it will keep happening after every cleanup. Options for Tyler:
(a) demo-mode read-only guard (env-flagged, mutations 403 with friendly
copy); (b) nightly scheduled reseed; (c) accept drift and reseed manually.
The audit only records that the current state guarantees recurring drift.

---

## P1 — Rough edges

### P1-1. Stale "Angle" vocabulary sweep (user-visible copy)
Observed live: case header "**Active angle:** …" · readiness panel
"Confirmed **angles**", "referral-grade **angle**", "8 confirmed **angles**
need an overreach acknowledgement" · Timeline filter chip "**Angles**" ·
"**Cite in angle**" button on every Timeline event card · `/search`
placeholder + helper text "…documents, **angles**, entities" · Replay is
clean. One sweep of user-visible strings (internal identifiers stay, per
CLAUDE.md rename policy). Phase 2.

### P1-2. Thread Builder layout does not sell the flagship feature
~80% empty dark space; the narrative NOTE renders in a ~90 px-wide textarea;
the page leads with three negative bullets ("Overreach not reviewed · No
cited assertion · No handoff-ready claim"). With Phase 1's enriched data it
will read better, but the cramped element editor and negative-first framing
are layout/copy issues, not data issues. Phase 2 (scope-capped: width/layout
fix + readiness bullets phrased as progress, not failure).

### P1-3. Activity feed exposes raw internal strings
Dashboard activity shows "Record updated", "Record deleted",
"reevaluate_signals" — internal jargon with no case context. Phase 2
(humanize copy, e.g. "Signal rules re-evaluated — Bright Future Foundation").

### P1-4. Graph canvas hijacks page scroll (zoom)
Mouse wheel over the Case Map zooms the canvas aggressively; a visitor
scrolling the page accidentally blows up the graph (happened during this
audit; recovery non-obvious — the fit control is an unlabeled icon).
Phase 2 candidates: require modifier key to zoom, and/or a labeled "Fit"
control. Cheap, high-value for cold visitors.

### P1-5. "2 research jobs still running" — stale SearchJobs
Readiness panel reports 2 running research jobs (case is 33 days old);
Research tab surfaces nothing. Stale QUEUED/RUNNING rows in prod. Phase 2:
purge in reseed; consider a staleness timeout so the readiness panel never
counts dead jobs.

### P1-6. Financials: 2021 column clips at viewport edge
Rightmost year partially cut off at 1568 px width; table doesn't scroll or
compress. Phase 2 if cheap (overflow-x on the table container).

---

## P2 — Nice-to-have (logged, not scheduled)

- Timeline colored-dot strip has no legend.
- Financials tab: content in top third, dead space below.
- Cytoscape renderer intermittently froze screenshot capture during the
  audit (CDP timeouts) — possibly tooling-only; note if prod users report
  jank.
- Dashboard is sparse for a landing page (3 stat cards + 2 lists).

---

## README — 90-second recruiter skim (feeds Phase 3)

**Scores:**
- *What is Catalyst, one screen?* **PASS** — the bolded pipeline one-liner +
  "five agency referrals filed" is strong.
- *What engineering problems did Tyler solve?* **PASS** — "Engineering
  decisions worth defending in an interview" already is the Engineering
  Highlights section (keep, retitle if desired).
- *Can I find the live demo?* **FAIL — the README never links the Railway
  demo.** Biggest single skim gap; fix is one line at the top.
- *Screenshots / stack / tests / architecture findable?* **PARTIAL** — stack
  + tests yes; screenshots stale; `api-contract.md` / design specs never
  linked.
- *Inflated claims?* **One live mismatch:** "citation-bearing referral
  package" is currently un-generatable on the live demo (P0-1). Fixed by
  reseed, but the claim-vs-proof table below must hold post-fix.

**README content findings (Phase 3 scope, already in spec):**
- "What it does" captions use dead vocabulary: "**Web**", "**knots**
  (persons + orgs)", "**connections**", "**angles**". Must become Case Map /
  Subjects / Relationships / Threads.
- Case Map redesign, Thread Builder, structured assertions, and Lead
  Suggestions are **entirely absent** — the README describes the pre-2026
  product.
- Demo GIF (`docs/catalyst-demo.gif`) and all four screenshots predate the
  Case Map redesign.
- Static test badge says **1,102**; suite is at **1,118** — pick a
  maintainable convention ("1,100+") or update at capture time.
- No "real vs demo-seeded" disclosure, no Traceability Walkthrough, no
  How-to-verify links (spec already requires all three).

**Claim-vs-proof table (verify each after Phases 1–3):**

| README claim | Proof required | Code path |
|---|---|---|
| "Citation-bearing referral package" | Live PDF generates; GIF final step | document → ThreadElementCitation → referral PDF |
| "17 fraud-detection rules fire" | Threads visible w/ SR-ids; test count in `test_signal_rules` | signal_rules.py → Finding |
| "SHA-256 chain of custody" | Document index page of exported PDF | Document.sha256 → PDF appendix |
| "Human-in-the-loop entity resolution" | Match Review UI screenshot | FuzzyMatchCandidate → accept/dismiss |
| "AI findings cap at DIRECTIONAL" | Lead thread badge in UI | ai_pattern_augmentation.py |
| "1,102 tests" (stale) | CI badge + updated count | ci.yml |

---

## Recruiter confusion log (feeds walkthrough script + README)

1. **"0 referral-grade · 14 need work" reads as product failure**, not
   work-in-progress honesty. After Phase 1 the 5/10 mix must be visibly
   *positive* framing (readiness shows green progress, not only blockers).
2. **Thread Builder doesn't explain itself** — an empty assertions panel
   with fact/analysis/claim roles derived invisibly. The walkthrough (and an
   empty-state hint in-app) must say *why* structured assertions matter:
   they're what makes the referral PDF citeable.
3. **"Lead" is unexplained** for a cold visitor — one tooltip/hint line
   ("pattern suggestions surfaced for review — never auto-confirmed") would
   carry the credibility-firewall story.
4. **Why is the PDF blocked?** The readiness blockers name conditions but
   not the philosophy (nothing exports without cited, human-reviewed
   threads). One sentence of copy turns a frustration into the product's
   best differentiator.
5. **Timeline dot strip** — meaning unclear without hovering.

---

## Walkthrough script — draft click path (validated live)

Dashboard → Bright Future Foundation → Investigate (Case Map, subjects,
edge legend) → select flagship thread (Path Mode dims to its evidence) →
Open full Thread (assertions, citations, roles) → [Lead Suggestions once
P0-4 fixed] → Financials (YoY anomaly highlighting) → Timeline (990s +
deeds) → Referrals (readiness gates → Generate PDF) → Replay (the
investigation's reasoning arc). Research shown briefly (async 202+poll
story). Settings skipped (P0-3 until fixed).
