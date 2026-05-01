# Catalyst — Build Status

**Last updated:** 2026-05-01

This project is in active development. This file is updated every time
the state of a major component changes. If something looks half-built,
that's because part of it is — see "In active refactor" below. The
current focus is a scoped 2-week rebuild pass driven by a product
reframe around a single central deliverable: the referral package.

---

## Working

These are the parts of Catalyst that are wired end-to-end and currently
running on Railway.

| Component | What it does | Notes |
|-----------|-------------|-------|
| Document upload + OCR | Multi-file upload, SHA-256 hashing, PyPDF2 → Tesseract OCR fallback | Chain of custody verified on every file |
| Entity extraction pipeline | Rule-based extraction → normalization → fuzzy resolution with Claude AI fallback | Surfaces match candidates, never silent-merges |
| IRS TEOS 990 XML connector | Fetches Form 990 XML directly from apps.irs.gov via HTTP range requests (~5KB per filing) | Replaced earlier bulk-download approach. Parses Parts I, IV, VI, VII. |
| Ohio Auditor of State connector | Scrapes audit reports, finds Findings for Recovery | ASP.NET ViewState postback |
| County Recorder connector | All 88 Ohio counties mapped to recorder portals; auto-parses uploaded deeds | URL builder + document parser |
| Ohio Secretary of State connector | Local CSV search (admin uploads CSVs from publicfiles.ohiosos.gov) | Switched from runtime download after SOS started returning 403s |
| Case detail UI | 7 tabs: Overview, Documents, Research, Financials, Pipeline, Match Review, Referrals | React + Vite, dark/light/auto themes, keyboard shortcuts |
| Entity relationship graph | D3 force-directed graph synchronized with a brushable timeline | Click a node to select; drag to reposition; brush the timeline to filter |
| Referral package PDF exporter | Deterministic, citation-bearing PDF generation with cover page, findings, financial summary, and document index with SHA-256 chain of custody | The central deliverable — what a professional investigator reads |
| Fraud signal detection engine | 15 pattern rules (cut from 29, plus the new SR-028 self-disclosed material diversion) grounded in real investigation patterns — valuation anomalies, insider swaps, false disclosures, revenue spikes | Each rule tied to a real anomaly source. `Finding.evidence_snapshot` captures the exact 990 fields / transaction ids / entity ids that fired each rule for the referral PDF citations. |
| Demo case ("Bright Future Foundation") | Pre-loaded investigation with 4 persons, 2 orgs, 2 properties, 6 years of financials, 7 documents, and 9 confirmed findings | `python manage.py seed_demo` — shows the full pipeline working |
| AI assistant panel | Claude-powered case summary, relationship analysis, free-text Q&A | Triage tool only — not part of the final deliverable |
| Document workspace | Open any document and see its text, extracted entities, linked findings, and sticky notes in one panel | Entities are clickable — navigate to entity detail |
| Sticky notes | Attach notes to any document, entity, or finding — like Post-Its on a case file | Full CRUD via existing notes API |
| Financial anomaly highlighting | YOY table flags revenue spikes, zero officer comp, low program ratio, asset/revenue mismatch | Anomaly summary strip at top of Financials tab |
| Entity → document quick-view | Entity detail page shows related documents, related findings, and sticky notes | Uses the detail API endpoint instead of list filtering |
| Audit log | Append-only log on every mutation | Never updated or deleted |
| Async research jobs (backend) | Long-running external-data searches (IRS name search, IRS XML fetch, Ohio AOS, County Parcel) run on a Django-Q2 worker backed by Postgres — no Redis. POST returns 202 with a job id; clients poll `GET /api/jobs/<id>/`. | Replaced synchronous gunicorn-blocking calls that were 502ing at 30s. |
| Async research jobs (frontend) | Research tab uses a `useAsyncJob` hook that POSTs, receives 202 + `job_id`, polls every 2 s, renders queued / running / success / error states, and reattaches to live or recently-finished jobs on mount via `GET /api/cases/<id>/jobs/`. | Paired with the Session 35 backend. |
| AI pattern augmentation | On-demand Claude analysis surfaces patterns the rule engine can't see — entity disambiguation, timeline anomalies, narrative inconsistencies. Runs as a Django-Q2 job; writes each returned pattern as a Finding with `source=AI` and `evidence_weight` capped at DIRECTIONAL. | "Run AI Analysis" button on the Pipeline tab. Source filter chips (All / Rule / Manual / AI) and an AI badge distinguish AI-flagged findings from rule-based ones. Augments — never replaces — the 15 grounded signal rules. |
| Match Review (fuzzy entity-match queue) | When the resolver finds an incoming name similar but not identical to an existing person/org, it surfaces the pair on a "Match Review" tab on Case Detail with a pending-count badge. Investigators accept (mark MERGED) or dismiss; resolution is persisted on `FuzzyMatchCandidate` rows. | Replaces silent-merge behavior that would have corrupted evidence chain-of-custody on referrals. The data plane is intentionally separate from the actual data merge — investigator decisions are recorded as input for a future merge tool. |
| Data-quality validators wired into resolution path | `data_quality.validate_ein` / `validate_person` / `validate_property` run inline during entity resolution and property creation. Issues are logged at WARNING (errors) / INFO (warnings) and the EIN normalizer auto-corrects formatting. Property warnings surface on `Document.extraction_notes` for UI visibility. | Catches OCR garbage (state-abbrev "names", form-label false positives), placeholder EINs, negative valuations, and 990 line-item math errors. |
| Backend test suite | 880+ backend tests across connectors, API endpoints, all 15 signal rules, async job pipeline, AI pattern augmentation, the four sync AI endpoints, the upload pipeline, fuzzy candidate persistence + endpoints, classification, normalization, data quality validators, form 990 parsing, extraction routing, and entity resolution core | CI runs ruff + tsc + vite on every push |

---

## In active refactor

These are the parts being rebuilt right now. Calling them out openly because
the right answer when something is mid-refactor is to say so.

| Component | Why it's being refactored |
|-----------|---------------------------|
| Repo presentation | This file. `README.md`. `CLAUDE.md`. Keeping surface-level docs in sync with the rebuild as it lands. |

**Recently completed (Session 37–38, QA-audit hardening pass):**

A senior-QA audit covering the rules engine, AI integration, and data
extraction pipeline produced a punch list of 18 P0/P1 items. All
landed across two commits.

- **Rules engine** — `persist_signals` now dedups on
  `(case, rule_id, trigger_entity_id)` with doc fallback (was deduping
  on `trigger_doc`, which produced both duplicates on re-evaluation
  and false suppression on the same insider across documents). Writes
  `FindingEntity` link rows so the relational graph picks up
  rule-derived findings. `Finding.evidence_snapshot` is now populated
  for every CRITICAL rule (SR-015, SR-025, SR-028) and the entire XML
  evaluator (SR-006/012/013/028/029) — captures the literal 990 fields,
  transaction ids, and entity ids that fired the rule for the referral
  PDF and audit chain. SR-004 window math corrected from 48h
  (`abs(days) <= 1`) to actual same-calendar-day. New `SR-028 —
  Material Diversion of Assets — Self-Disclosed on 990 Part VI Line 5`
  added as a 15th grounded rule, replacing the old SR-025 impersonation
  in the XML evaluator.
- **AI integration** — `call_claude` raises a typed `AIPatternError` on
  Anthropic failures (was silently returning `""` and marking jobs
  SUCCESS with zero patterns). Runtime forbidden-word filter catches
  "fraud / crim / illeg / guilt" stems if the model regresses past the
  system prompt. Prompt size capped at 80K JSON chars with newest-first
  document ordering. 3× retry with exponential backoff on transient
  Anthropic errors. Partial unique constraint prevents two in-flight
  AI pattern jobs per case.
- **Pipeline reliability** — SHA-256 dedup at upload (re-uploading the
  same bytes returns the existing Document instead of re-running the
  pipeline and creating duplicate entities). MIME-based PDF detection
  replaces extension-based gating. `form990_parser` wired into the
  upload pipeline when `classify_document` returns IRS_990. Per-stage
  `transaction.atomic()` blocks around entity resolution / financial /
  property / signal stages so a mid-stage crash rolls back partial
  writes. `process_pending` retries FAILED, PARTIAL, and stale-PENDING
  documents.
- **`fetch-990s` was silently dark** — the IRS TEOS XML pipeline
  created FinancialSnapshots but never invoked the rules engine, so
  the most reliable data source was running with all structured-XML
  rules disabled. Wired in.
- **FuzzyMatchCandidate review surface** — replaces the previous
  behavior of computing fuzzy candidates and discarding them after a
  log line. New model + migration, persistence on every resolution
  pass, GET listing + PATCH action endpoints, full frontend "Match
  Review" tab with pending-count badge and accept/dismiss UI. Makes
  the "human-in-the-loop entity resolution" claim demonstrably true
  end-to-end.
- **Stale rule references swept** — views.py comments, ai_extraction
  docstring, form990_parser comments, county recorder comments,
  models.py field help_text, irs_connector comments, the broken
  `test_new_endpoints.py` Signal/EntitySignal references, and the
  frontend `legalCitations.ts` (rewritten with active-rule-only
  entries) and `investigationChecklists.ts` (full rewrite for the
  15-rule active set).
- **Test backbone** — ~305 new tests across 13 new test files plus
  expansions. Brings backend test count from 580+ to 880+. All 15
  active signal rules now have unit tests (was 5). All major
  pure-function modules covered (classification, normalization, data
  quality validators, form 990 parser, extraction routing, entity
  extraction non-EIN, entity resolution core). New Vitest suite for
  the MatchReviewTab component.

**Recently completed (Session 36):**
- ~~Research tab still on the old synchronous shape~~ → Retrofit to consume the 202 + poll contract. New `useAsyncJob` hook handles enqueue, polling, status transitions, and reattach-on-mount. Four slow sources (IRS name, IRS XML, Ohio AOS, County Parcel) now show "Queued… / Searching…" progress instead of hanging.
- ~~No AI layer on top of the 14 rules~~ → Shipped **AI pattern augmentation**: single-pass Claude analysis at case level that writes candidate Findings with `source=AI`. Runs as a Django-Q2 job; enforces doc-reference citations; caps `evidence_weight` at DIRECTIONAL (AI can never claim DOCUMENTED or TRACED). Pipeline tab gets source filter chips + AI badge + "Run AI Analysis" button.

**Recently completed (Session 35):**
- ~~Synchronous research endpoints 502ing at 30s~~ → Moved 4 slow research endpoints (IRS name search, IRS `fetch_xml`, Ohio AOS, County Parcel) to a Django-Q2 async job queue backed by Postgres. New `SearchJob` model tracks state + stores result JSON. Two new endpoints: `GET /api/jobs/<id>/` (poll) and `GET /api/cases/<id>/jobs/` (reattach). 24 tests green. Smoke-tested: "do good" IRS search now returns 177 filings async, no 502.

**Recently completed (Session 33–34):**
- ~~Signal / Detection / Finding three-table pipeline~~ → Collapsed to single `Finding` model with `status` + `evidence_weight` dimensions. Frontend fully updated.
- ~~Signal rule set~~ → Cut from 29 to 14 rules, all grounded in real investigation patterns.
- ~~Referral package exporter~~ → Shipped. Deterministic PDF with citations, financial tables, and document index.
- ~~`SocialMediaConnection` model~~ → Removed. Use `Document` + `Relationship` instead.
- ~~`GovernmentReferral` model~~ → Removed. The system produces the package; tracking what happens afterward is out of scope.
- ~~Inline notes on entities~~ → Shipped. Sticky notes on documents, entities, and findings via reusable StickyNotes component.
- ~~Finding → Document linking~~ → Findings now show source document filename (not truncated UUID). Pipeline tab shows clickable document names.
- ~~Financial anomaly highlighting~~ → Financials tab flags revenue spikes, zero officer comp, low program ratios, asset/revenue mismatch.
- ~~Document workspace~~ → Document viewer now has 6 tabs: Document, Entities, Notes, Findings, Financials, Info.
- ~~Entity → Documents quick-view~~ → Entity detail page shows related documents, findings, and sticky notes.
- ~~22 stale field references in views.py~~ → Fixed `detected_summary` → `description`, `detected_at` → `created_at`, `signal__case` → `finding__case` across dashboard, graph, search, export, and AI endpoints.

---

## Planned

In rough priority order. Subject to change as the rebuild progresses.

1. ~~**Deterministic referral package exporter**~~ — **DONE.** PDF with cover page, executive summary, findings with citations, financial tables, and document index with SHA-256 hashes.
2. ~~**Pre-loaded demo case**~~ — **DONE.** "Bright Future Foundation" — fictional scenario with 9 findings across 6 signal rules, exercising the full pipeline.
3. **Short demo video + README screenshots** — paired with the demo case.
4. ~~**Inline notes on entities**~~ — **DONE.** Sticky notes on documents, entities, and findings.
5. ~~**Frontend consuming async job 202 + poll**~~ — **DONE (Session 36).** Research tab consumes the async contract via `useAsyncJob`; reattaches to live jobs on mount.
6. **Saved searches** — recurring queries on the entity browser.
7. ~~**Document annotation**~~ — **Partially addressed.** Document workspace with sticky notes replaces the need for in-app PDF annotation for now.
8. **ODNR parcel API recovery** — external API has been unreachable from Railway for weeks; monitoring for upstream fix.

---

## Known issues

- **ODNR statewide parcel API** (county auditor connector) is unreachable from Railway. Both the primary and fallback URLs return 404 / time out. External API issue, tracking upstream. Not blocking the referral-package rebuild.
- **Ohio SOS connector requires manual CSV upload** via an admin endpoint — automated download was blocked by SOS returning 403s. Documented in the connector file.
- **AI pattern augmentation** is an investigator aid, not the deliverable. Every AI finding lands with `evidence_weight=DIRECTIONAL` or lower and `status=NEW`; the investigator promotes it up the pipeline manually after verification. The referral package exporter will never ship an AI finding unless the investigator has explicitly confirmed it.
- **Fuzzy match "Accept" is review-only — no automated data merge yet.** When an investigator marks a candidate MERGED, the system records the decision but does not yet reassign FK references or fold aliases. A future merge tool will operate on the queue of MERGED candidates. Documented in the PATCH endpoint.

---

## How to read this file

If you're a recruiter or hiring manager: this file exists so you can see
the *real* state of the project in under sixty seconds, instead of
having to guess from commit history. The "In active refactor" column is
a feature, not a confession — it shows that I know my own system and
can name what needs to change and why. If the rebuild outlined here has
landed since you last checked, this file will reflect that.

If you're a contributor or future maintainer: start with
[CLAUDE.md](CLAUDE.md) for the full system map, then this file for the
current state of the refactor.
