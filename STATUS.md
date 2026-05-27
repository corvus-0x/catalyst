# Catalyst — Build Status

**Last updated:** 2026-05-04 (Session 41 — case workspace design spec + layout shell)

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
| Case workspace UI | Full rewrite to a graph-first, Maltego-influenced five-zone layout per [docs/architecture/frontend-design-spec.md](docs/architecture/frontend-design-spec.md). Replaces the 7-tab `CaseDetailView` with a single canvas + composable side panes (990 Viewer, Financials, Package), citation-bearing edges on the entity graph, and a multi-tab bottom dock (Audit log, Triage, Transforms, Documents, Selection). Ships at `/cases/:caseId/workspace` until feature-complete; will be promoted to the canonical case route at end of the 19-step build sequence. |
| Repo presentation | This file. `README.md`. `CLAUDE.md`. Keeping surface-level docs in sync with the rebuild as it lands. |

**Recently completed (Session 41, May 4 2026):**

Started the case workspace UI rewrite. Two pieces landed: a canonical
design spec, and the layout shell that other steps will build on top of.

- **New design spec** — [docs/architecture/frontend-design-spec.md](docs/architecture/frontend-design-spec.md).
  Living document, owner-authored, built from a research pass on Maltego,
  i2 Analyst's Notebook, Palantir Gotham, and Cytoscape.js. Core moves:
  *(1)* the graph is the primary canvas, not a tab — flags appear as
  badges on entity nodes AND as a sortable list in the bottom dock;
  *(2)* every edge carries a `[Doc-N]` citation chip (paper-trail
  assembly, not OSINT discovery); *(3)* manually drawn or AI-extracted
  edges start as SPECULATIVE and cannot be exported until upgraded with
  citations; *(4)* single-screen baseline locked at 1366×768 with
  multi-monitor popout deferred to v2; *(5)* discoverability section
  with first-time-user tour, learn-as-you-go toasts, mouse-only
  achievability of every workflow; *(6)* professional library stack
  locked. Seven open questions resolved into a decisions log inside the
  spec.
- **Professional library stack installed** (spec §16.5) — Cytoscape.js
  (graph engine, replacing D3), `react-cytoscapejs`, `cytoscape-cose-bilkent`,
  `lucide-react` (icons), Radix UI primitives (Dialog, Popover, Tooltip,
  DropdownMenu, ContextMenu, Tabs, ToggleGroup), `@tanstack/react-table`,
  `cmdk` (command palette), `react-resizable-panels@^2` (pinned — v4
  released a breaking-API rename), `tinykeys`, `sonner`, `react-pdf`,
  `date-fns`, `driver.js`. Build green at 21.4 s, 2412 modules, JS bundle
  144 → 156 KB gzipped (libraries loaded but only `react-resizable-panels`
  and `lucide-react` actively imported yet).
- **Layout shell shipped** at `/cases/:caseId/workspace` — five zones
  (top bar / left rail / center canvas / right detail / bottom dock)
  with resize-and-collapse mechanics via `react-resizable-panels`. Each
  zone renders placeholders annotated with the spec section that will
  fill it. View toggles (Graph / 990 Viewer / Financials / Package) on
  the top bar split the center horizontally — Graph is locked open, the
  other three are opt-in. AppShell extended with a `viewContentFullbleed`
  mode so the workspace can fill edge-to-edge instead of being constrained
  by the 1200 px max-width that the other views need. Existing
  `/cases/:caseId` tabbed `CaseDetailView` preserved unchanged.

Next steps (per spec §18 build sequence): step 2 — wrap Radix primitives
in token-aware UI components; step 3 — audit log on TanStack Table (the
"chain of custody made visible" panel); then graph migration to
Cytoscape.js at step 6.

---

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

**Recently completed (Session 40, May 1 2026):**

Worked through every item on the May 2026 frontend QA punch list — all
3 P0s, all 11 P1s, and 6 of 8 P2s landed across 6 commits on `main`
(`5c727ce` → `3db9b42`). The two P2s that didn't land are explicit
deferrals, not regressions (see "Deferred" below).

- ~~Documents tab row-click triggered Delete~~ → Inline two-step
  confirmation. Clicking Delete now arms a per-row "Confirm delete /
  Cancel" pair instead of immediately calling the API. Confirmation
  lives in the same row as the doc being acted on, so the misclick
  path is closed by construction.
- ~~Demo case Documents had empty `extracted_text`~~ → `seed_demo`
  now populates a realistic per-doc OCR-style excerpt (Form 990 line
  items, deed grantor/grantee language, articles of incorporation,
  AOS findings) and writes `OrgDocument` and `PersonDocument` link
  rows for every entity that appears in each doc. Investigators
  clicking View on a Bright Future doc now see real text and the
  Entities tab populates correctly.
- ~~Triage page returned 404~~ → New cross-case
  `GET /api/findings/?status=NEW` endpoint (`api_finding_collection`)
  with case_id and case_name appended on every result so the Triage
  view can render and link back to the source case.
- ~~Dashboard severity counts didn't match KPI~~ → `api_signal_summary`
  now also returns `by_severity` (open finding counts per severity per
  case) and `total_count`. DashboardView aggregates `by_severity` so
  the bars sum to the "Open Findings" KPI by construction. CasesListView
  reads `total_count` and renames its column "Signals" → "Findings".
- ~~AI findings rendered "MANUAL" badge~~ → The bug was in TriageView's
  `finding.rule_id || "MANUAL"` fallback. AI findings have
  `rule_id=""`, so they all fell through to the literal "MANUAL". Fall
  back to `source` instead.
- ~~Entity graph labels overlapped, all 8 nodes piled at center~~ →
  D3 force params re-tuned: charge -300 → -800, link distance baseline
  100 → 140, collision radius widened from `NODE_RADIUS+8` to include
  half a 140-px label width buffer.
- ~~Entity detail page missing related-findings panel~~ → The frontend
  was rendering it conditionally on data presence; the demo seed
  never wrote `FindingEntity` link rows so the array was always
  empty. `seed_demo` now mirrors each finding's `trigger_entity_id`
  into a matching `FindingEntity` row, so Sarah Mitchell's detail
  page shows her 2 related findings, BFF's shows its 6, etc.
- ~~Duplicate Generate Referral PDF button~~ → Removed the legacy
  `<article>` block; `<ReferralsPanel>` is now the single canonical
  source.
- ~~AI Analysis 409 silent~~ → `useAsyncJob.run()` now reads the
  response body's `error` field on non-OK responses, so the toast
  shows the real reason ("An AI analysis job is already running for
  this case.") instead of a bare "Enqueue failed: 409". Benefits
  Research tab too.
- ~~OCR-garbage entities persisted~~ → `_validate_and_log` now returns
  `(blocked, reason)`; `resolve_person` / `resolve_org` skip the
  create when blocked, returning a result with `person`/`org=None` and
  a `blocked_reason`. `ResolutionSummary` gained `persons_blocked` and
  `orgs_blocked` counters. Org-name validation upgraded — was
  EIN-only, now runs the org name through `_NAME_JUNK_PATTERNS`
  regardless of EIN presence. Three new junk patterns catch the
  reported garbage: leading-lowercase-article fragments ("my hand",
  "an authorized"), bare entity-type words, "Limited Liability
  Company".
- ~~Search missed findings + documents on "Mitchell"~~ → Finding
  search vector extended from `title`-only to `title + description +
  narrative` (the entity name only appears in description/narrative
  for rule-template titles). Document search already covered
  `extracted_text`; that field gained real content via the seed fix.
- ~~Stale signals/detections/Government Referrals terminology~~ →
  Sweep across 11 frontend components: ReferralsView heading,
  Breadcrumb labels, AppShell aria-label, AIAssistantPanel narrative
  button, SearchView placeholders, OverviewTab timeline empty state +
  "Signal Coverage" → "Rule Coverage", PipelineTab empty state,
  PdfViewer empty state, ReferralsTab export description.
- ~~Sidebar `▓` Dashboard icon and `◆` brand icon rendered as text~~
  → Replaced with `📊` and `⚗️` (alembic, thematic for "catalyst").
- ~~AI evidence_snapshot panel rendered as raw JSON~~ → AI findings
  now render `rationale` and `suggested_action` in a styled
  purple-tinted block; non-AI findings keep the JSON `<details>`
  view.
- ~~Sticky note placeholder hardcoded "about this document"~~ →
  Now interpolates `targetType` so entity pages say "this person",
  finding panels say "this finding", etc.
- ~~Search "3 Entitys" pluralization bug~~ → Added
  `TYPE_LABELS_PLURAL` map.
- ~~Search results all showed 👤 person icon~~ → Entity result icons
  now derive from `result.route` (orgs 🏢, properties 🏠, financial
  💳, persons 👤).
- ~~Financials tab bare em-dashes looked broken~~ → Every `—` for
  missing data now has a `title` tooltip explaining what's missing
  ("Not reported on this 990 filing", "Cannot compute ratio —
  missing program services or total expenses").
- ~~Sidebar Triage count vs Triage page filter mismatch~~ → Resolved
  as a side effect of the dashboard-counts work above. Both now
  read NEW-status finding counts via the shared signal-summary
  endpoint.

**Deferred (intentional, not regressions):**
- *Cross-case Referrals view rebuild.* The placeholder now correctly
  reads "Referral Packages" and routes users to the per-case tab,
  which is the actual workflow. A real "queue of confirmed cases not
  yet exported" is a 1-day rebuild that doesn't change the demo
  story; revisit if it becomes load-bearing.
- *OCR-garbage cleanup management command.* The validator block
  protects future ingestion. Existing junk rows in the "Do Good"
  case can be deleted in admin or via a one-off command later if
  needed.

**Recently completed (Session 39, May 1 2026):**

Two operational fixes after a full frontend QA + usability walk on the
Railway deployment:

- ~~Async research endpoints + AI Analysis silently broken on Railway~~ →
  The `qcluster` worker container was defined in `docker-compose.yml`
  for local dev but had never been deployed to Railway. Every async
  job (IRS name search, IRS XML fetch, Ohio AOS, County Parcel, AI
  pattern analysis) sat in `QUEUED` forever. Fixed by adding a second
  Railway service (`catalyst-worker`) that builds the same Docker
  image with `CMD` overridden to `python manage.py qcluster` and
  reads its own config file (`railway.worker.json`) with no HTTP
  healthcheck. Verified end-to-end: IRS "do good" search returns 177
  filings in ~7s, AI Analysis writes 4 patterns to the demo case in
  ~22s, poller transitions QUEUED → RUNNING → SUCCESS as designed.
- ~~Worker deploy failing at the healthcheck stage~~ → The worker was
  initially pointed at the same `railway.json` as the web service,
  which has `healthcheckPath=/api/health/` — the worker has no HTTP
  server, so Railway timed out the healthcheck and rolled the deploy
  even though qcluster was running fine. Added a separate
  `railway.worker.json` with the same Docker build and no
  `healthcheckPath` field so the worker skips that stage entirely.
- Captured a 21-item frontend QA punch list during the same audit pass
  (see "Frontend QA punch list" section below).

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

## Frontend QA punch list (May 2026) — CLEARED

Captured during a full Playwright-driven walk of every view on the Railway
deployment, plus a follow-up soak test once the worker came up. **All 21
items have been worked through in Session 40** — see the per-item entries
under "Recently completed (Session 40)" above. The list below is preserved
for historical context; the strikethroughs and notes show how each item
landed. Two items were intentionally deferred (see the "Deferred" callout
in the Session 40 summary).

### 🔴 P0 — fix this week (demo-blockers) — ALL DONE

- [x] ~~**Demo case Documents have empty `extracted_text`.**~~ Fixed in
  `seed_demo` — each doc now has a realistic excerpt + Person/Org link
  rows. (commit `8387e69`)
- [x] ~~**Triage queue endpoint returns 404.**~~ Added cross-case
  `api_finding_collection` at `/api/findings/`. (commit `6c840fe`)
- [x] ~~**Clicking row whitespace on Documents triggers Delete.**~~
  Inline two-step Confirm/Cancel in the same row. (commit `5c727ce`)

### 🟠 P1 — visible bugs / wrong data — ALL DONE

- [x] ~~**Entity relationship graph labels overlap.**~~ D3 force params
  re-tuned; collision radius now includes a label-width buffer. (commit
  `b6067cf`)
- [x] ~~**Dashboard severity counts don't match KPI total.**~~ Backend
  exposes per-case `by_severity`; DashboardView aggregates so the bars
  sum to the KPI by construction. (commit `6c840fe`)
- [x] ~~**Cases list "SIGNALS" column.**~~ Renamed to "Findings"; reads
  `total_count` not just `open_count`. (commit `6c840fe`)
- [x] ~~**Two duplicate "Generate Referral PDF" buttons.**~~ Legacy
  `<article>` block removed. (commit `fe38416`)
- [x] ~~**AI Analysis 409 produces no UI feedback.**~~ `useAsyncJob`
  reads response body's `error` field; toast surfaces real reason.
  (commit `fe38416`)
- [x] ~~**OCR-garbage entities persisted.**~~ `_validate_and_log` now
  blocks on ERROR-severity issues; org-name validation runs regardless
  of EIN; three new junk patterns. (commit `fe38416`) Existing junk
  rows in "Do Good" not cleaned up — see Deferred above.
- [x] ~~**Entity detail page missing related-document and related-finding
  panels.**~~ Backend was returning the data; the demo seed never wrote
  `FindingEntity` link rows. Seed now mirrors trigger entities into the
  link table. (commit `8387e69`)
- [x] ~~**Note input placeholder says "this document" on entity pages.**~~
  `StickyNotes` placeholder now uses `targetType`. (commit `3db9b42`)
- [x] ~~**Stale "signals" terminology throughout.**~~ Sweep across 11
  components. (commit `3db9b42`)
- [x] ~~**AI findings render with `MANUAL` source badge.**~~ Bug was in
  TriageView's `rule_id || "MANUAL"` fallback; AI findings have
  `rule_id=""`. Fall back to `source` instead. (commit `b6067cf`)

### 🟡 P2 — usability polish — 6 OF 8 DONE, 2 DEFERRED

- [x] ~~**Sidebar `◆` (logo) and `▓` (Dashboard icon) render as text.**~~
  Replaced with `📊` and `⚗️` (alembic, thematic for "catalyst").
  (commit `3db9b42`)
- [x] ~~**Sidebar Triage count vs Triage page filter mismatch.**~~ Both
  now read NEW-status finding counts via the shared signal-summary
  endpoint. Resolved as a side effect of the Day-3 work. (commit
  `6c840fe`)
- [x] ~~**AI evidence_snapshot panel may not render.**~~ AI findings
  now render `rationale` and `suggested_action` in a styled
  purple-tinted block; non-AI findings keep the JSON `<details>` view.
  (commit `3db9b42`)
- [x] ~~**Search misses findings + documents.**~~ Finding search vector
  extended from title-only to title + description + narrative. Document
  search already covered `extracted_text`; that field gained content
  via the seed fix. (commits `8387e69` + `6c840fe`)
- [x] ~~**Search "AI Overview" typo: "3 Entitys".**~~ Added
  `TYPE_LABELS_PLURAL` map. (commit `3db9b42`)
- [x] ~~**Search results: Mitchell Development LLC shows 👤 person icon.**~~
  Entity result icons now derive from `result.route` (orgs 🏢,
  properties 🏠, financial 💳, persons 👤). (commit `3db9b42`)
- [ ] **Cross-case Referrals view rebuild — DEFERRED.** Heading renamed
  to "Referral Packages" (commit `3db9b42`); placeholder still routes
  users to the per-case tab. Building a real "queue of confirmed cases
  not yet exported" is a 1-day rebuild that doesn't move the demo
  story. Revisit if it becomes load-bearing.
- [x] ~~**Financials tab shows bare em-dashes for missing data.**~~
  Every `—` for missing data now has a hover tooltip explaining what
  isn't reported. (commit `3db9b42`)

### Also deferred (mentioned under P1)

- **OCR-garbage cleanup management command.** The validator block in
  `_validate_and_log` protects future ingestion; existing junk rows in
  the "Do Good" case can be deleted in admin or via a one-off command
  later. (commit `fe38416` covered the block.)

### Suggested fix order — fully executed in Session 40

| Day | Items | Status |
|---|---|---|
| 1 | Row-click delete bug (P0) | ✅ commit `5c727ce` |
| 2 | Demo seed text + entities (P0) | ✅ commit `8387e69` |
| 3 | Triage 404 + dashboard counts + Cases list signals column (P0/P1) | ✅ commit `6c840fe` |
| 4 | Entity graph layout + entity detail panels + AI badge mapping (P1) | ✅ commits `b6067cf` + `8387e69` |
| 5 | Duplicate PDF button + 409 toast + OCR-garbage block (P1) | ✅ commit `fe38416` |
| 6–7 | Stale terminology sweep + P2 polish | ✅ commit `3db9b42` |

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
- **form990_parser.py may be partially superseded.** It is wired into `_process_uploaded_file` for IRS_990 docs but the IRS TEOS XML pipeline also extracts Parts IV/VI/VII. Both paths are currently active; consolidation is deferred.
- **Git pre-commit hook points to a Windows Python path** and does not run in sandbox/CI environments. Tyler commits from his local machine where the hook works.

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
