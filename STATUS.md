# Catalyst — Build Status

**Last updated:** 2026-06-11 (Session 46 — full product audit; referral PDF + fresh-session CSRF fixes shipped to prod; Replay tab; deterministic health check)

This project is in active development. This file is updated every time
the state of a major component changes — and at the end of every working
session (see "Keeping this file honest" at the bottom). If something
looks half-built, that's because part of it is — see "Not yet wired" and
"In active refactor" below. The product is built around a single central
deliverable: the referral package.

**For the exact backend→frontend wiring state** (every endpoint traced to
the UI component that calls it, plus the list of dead ends), see
[docs/architecture/wiring-matrix.md](docs/architecture/wiring-matrix.md).

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
| Case detail UI | 6 tabs at `/cases/:id`: Investigate (the graph/"Web"), Research, Financials, Timeline, Referrals, Replay (investigation step-by-step story) | React + Vite, dark/light/auto themes, keyboard shortcuts. Documents open in a drawer; fuzzy "pending connections" review is folded into the Investigate tab (no standalone Documents/Match Review tabs). Replay tab renamed from "Investigation" in Session 46 (sat confusingly next to "Investigate"). |
| Entity relationship graph | Cytoscape.js graph (`react-cytoscapejs` + `cose-bilkent`) — the primary investigation canvas ("Web") | Gotham/Maltego visual style: small markers (22-54px), labels right, node size scales with finding count (hub entity visually dominant), entity-type icons (person silhouette / building), 1px border ring, directed arrowheads on confirmed edges, dot-grid canvas. D3 is used only for the Timeline brush. |
| Referral package PDF exporter | Deterministic, citation-bearing PDF generation with cover page, findings, financial summary, and document index with SHA-256 chain of custody | The central deliverable — what a professional investigator reads. Was hard-broken (500) by three invalid ORM lookups until Session 46; now fixed, regression-tested (`test_referral_pdf.py`), and verified live on Railway. |
| Fraud signal detection engine | 15 pattern rules (cut from 29, plus the new SR-028 self-disclosed material diversion) grounded in real investigation patterns — valuation anomalies, insider swaps, false disclosures, revenue spikes | Each rule tied to a real anomaly source. `Finding.evidence_snapshot` captures the exact 990 fields / transaction ids / entity ids that fired each rule for the referral PDF citations. |
| Demo case ("Bright Future Foundation") | Pre-loaded investigation with 4 persons, 2 orgs, 2 properties, 6 years of financials (incl. governance answers), 7 documents, 10 findings (8 confirmed — every one citing source documents), and a 7-step investigation replay | `python manage.py seed_demo` — shows the full pipeline working |
| AI free-text Q&A | Claude-powered ask-about-this-case, wired into ConnectKnotsModal (angle title suggestion) and AngleView Lead panel (`/ai/ask/`) | Async endpoint (202 + job_id); frontend polls transparently. The older summarize/connections/narrative endpoints were deleted in Session 43. |
| Document workspace | Open any document and see its text, extracted entities, linked findings, and sticky notes in one panel | Entities are clickable — navigate to entity detail |
| Sticky notes (quick captures) | Attach notes to any document, entity (knot), or angle — full create/edit/delete on knots (ProfilePanel) and create/delete on angles (AngleView) | Backend supports `target_type` = person/organization/finding/document. Temp-id bug fixed Session 44 — notes created in the same session now edit/delete correctly. |
| Case status change | Status pill in case header is a `<select>` — ACTIVE / PAUSED / REFERRED / CLOSED; persists via PATCH | Added Session 44. |
| Delete angle | Two-step confirm button in AngleView toolbar; refreshes graph badge counts after deletion | Added Session 44. Auto-generated (rule-fired) angles will reappear if re-run rules is triggered — use Tie Off → Exhausted to permanently suppress a rule hit. |
| Financial anomaly highlighting | YOY table flags revenue spikes, zero officer comp, low program ratio, asset/revenue mismatch | Anomaly summary strip at top of Financials tab |
| Entity → document quick-view | Entity detail page shows related documents, related findings, and sticky notes | Uses the detail API endpoint instead of list filtering |
| Audit log | Append-only log on every mutation | Never updated or deleted |
| Async research jobs (backend) | Long-running external-data searches (IRS name search, IRS XML fetch, Ohio AOS, County Parcel) run on a Django-Q2 worker backed by Postgres — no Redis. POST returns 202 with a job id; clients poll `GET /api/jobs/<id>/`. | Replaced synchronous gunicorn-blocking calls that were 502ing at 30s. |
| Async research jobs (frontend) | Research tab uses a `useAsyncJob` hook that POSTs, receives 202 + `job_id`, polls every 2 s, renders queued / running / success / error states, and reattaches to live or recently-finished jobs on mount via `GET /api/cases/<id>/jobs/`. | Paired with the Session 35 backend. |
| AI pattern augmentation ("Lead") | On-demand Claude analysis surfaces patterns the rule engine can't see. Runs as a Django-Q2 job; writes each returned pattern as a Finding with `source=AI` and `evidence_weight` capped at DIRECTIONAL. | ✦ button in InvestigateTab toolbar (wired 2026-06-04). Right panel shows "X new Leads found" on SUCCESS; graph refreshes. Augments, never replaces, the 15 grounded rules. |
| Re-run signal rules | Re-fires all 15 fraud-detection rules against the case (useful after adding new documents). | ↺ button in InvestigateTab toolbar (wired 2026-06-04). Graph + dashboard refresh on completion. |
| Match Review (fuzzy entity-match queue) | When the resolver finds an incoming name similar but not identical to an existing person/org, it surfaces the pair on a "Match Review" tab on Case Detail with a pending-count badge. Investigators accept (mark MERGED) or dismiss; resolution is persisted on `FuzzyMatchCandidate` rows. | Replaces silent-merge behavior that would have corrupted evidence chain-of-custody on referrals. The data plane is intentionally separate from the actual data merge — investigator decisions are recorded as input for a future merge tool. |
| Data-quality validators wired into resolution path | `data_quality.validate_ein` / `validate_person` / `validate_property` run inline during entity resolution and property creation. Issues are logged at WARNING (errors) / INFO (warnings) and the EIN normalizer auto-corrects formatting. Property warnings surface on `Document.extraction_notes` for UI visibility. | Catches OCR garbage (state-abbrev "names", form-label false positives), placeholder EINs, negative valuations, and 990 line-item math errors. |
| Backend test suite | 924 backend tests across connectors, API endpoints, all 15 signal rules, async job pipeline, AI pattern augmentation, upload pipeline, fuzzy candidates, entity resolution, classification, normalization, data quality, form 990 parsing, extraction routing, and the referral PDF endpoint. 0 red. | CI runs backend test suite (postgres:16-alpine service container) + ruff + tsc + vite on every push. |
| Docker dev environment | `docker compose up -d` starts all four services: postgres, Django runserver (hot reload via volume mount), Vite dev server (HMR), Django-Q2 worker. | `docker compose exec backend python manage.py seed_demo` loads the Bright Future Foundation demo. |

---

## Not yet wired (backend exists, no UI path)

The backend is ahead of the frontend in a few places — endpoints that work
and are tested, but that the graph-first rebuild left without a button. These
are tracked exhaustively in
[docs/architecture/wiring-matrix.md](docs/architecture/wiring-matrix.md) §4;
the demo-relevant ones:

| Capability | Endpoint | State |
|------------|----------|-------|
| **"Lead" — AI pattern analysis** | `/ai/analyze-patterns/` | ✅ **Wired (2026-06-04).** ✦ button in InvestigateTab toolbar. |
| **Re-run the rules engine** | `/reevaluate-findings/` | ✅ **Wired (2026-06-04).** ↺ button in InvestigateTab toolbar. |
| AI summarize / connections / narrative | `/ai/{summarize,connections,narrative}/` | ✅ **Deleted (Session 43).** Orphaned dead code — removed from `views.py` and client. |
| Cross-case Triage queue, rule-coverage view | `/findings/`, `/coverage/` | ✅ **Deleted (Session 43).** Dropped in the graph-first rebuild — removed. |
| Case status change, delete angle, note CRUD | various | ✅ **Wired (Session 44).** Status selector in case header; delete button in AngleView; full note edit/delete on knots + create/delete on angles. |
| Statewide parcel search | `/research/parcels/` | ✅ **Wired + verified (Session 43/44).** ODNR recovered; ResearchTab wired; confirmed live on Railway via smoke test. |

---

## In active refactor

The graph-first rebuild has **landed** — see "Recently completed (Session 42)"
below. The remaining open work is closing the "Not yet wired" gaps above, not
structural rewrites.

| Component | Status |
|-----------|--------|
| Repo presentation | This file, `README.md`, `CLAUDE.md` — now reconciled to the shipped graph-first app. Updated at the end of each session going forward. |

**Recently completed (Session 46, June 11 2026):**

Full product audit (code + portfolio readiness) run against a live local stack,
followed by a fix sweep — 5 commits, deployed to Railway (`c5ca466`), prod
reseeded and verified end-to-end.

- **Referral PDF was hard-broken (500) — the product's central deliverable.**
  Three invalid ORM lookups in `api_case_referral_pdf`: `persondocument__`/
  `orgdocument__` (real related names are `document_links`), a
  `prefetch_related("finding_entities", ...)` (real name `entity_links`), and
  `order_by("created_at")` on Document (field is `uploaded_at`). *Why it shipped
  broken with 921 green tests:* zero tests referenced the endpoint — coverage
  breadth ≠ coverage of what matters. Added `test_referral_pdf.py` (3 regression
  tests asserting 200 + `%PDF` magic bytes) so it can't silently regress.
- **Every write action 403'd in a fresh browser session.** The backend CSRF
  endpoint (SEC-024) existed, and its docstring even said "the React SPA calls
  this once on startup" — but the SPA never did. Tyler's dev browser had a stale
  `csrftoken` cookie masking the bug; any recruiter's clean browser hit it
  immediately. *Approach chosen:* lazy memoized bootstrap inside `fetchApi`
  (fetch `/api/csrf/` once when the cookie is missing, share the in-flight
  promise) rather than an eager App-mount fetch — self-heals on any first write
  and doesn't couple app bootstrap to backend availability.
- **Health check rewritten — its "flakiness" was three determinism bugs, not
  randomness.** (1) It derived `CASE_ID` from `case_list[0]`, so reseeding
  changed which case it tested; (2) a fixed `"a"*64 sha256` tripped the
  `(case, sha256_hash)` unique constraint on every run after the first;
  (3) it tested `/ai/summarize|connections|narrative/` — endpoints deleted in
  Session 43 that 404 whenever the first-listed case had findings. Also:
  **it defaulted to production** and left "CSRF Test Case" artifacts there on
  every casual run. Now defaults to localhost (prod must be passed explicitly),
  uses a unique hash per run, tests only live endpoints, and deletes its
  artifacts (closing the test case — cases are non-deletable by design).
  Deterministic 30/30, verified twice consecutively, local and prod.
- **"Investigation" tab renamed "Replay"** (Tyler's call from three options) —
  it sat next to "Investigate" and read as a duplicate. Seeded a 7-step replay
  arc mirroring how the founding investigation actually unfolded ($0-comp
  question → SOS lookup → both deeds → 990 contradiction), deliberately covering
  every origin (Investigator/Lead/External) and status (Resolved/Open/Dead end)
  so all filter chips have content.
- **All 8 confirmed demo angles now cite source documents.** The Referrals tab
  itself was warning "6 confirmed angles have no cited documents — referral
  package will be incomplete," contradicting the core "every finding traces to
  a cited document" pitch. Seed now writes a per-rule citation map. Governance
  fields seeded too — COI policy = **No** is SR-012's evidence, Line 28 = **Yes**
  with no Schedule L is SR-006/SR-025's premise; blank dashes were hiding the
  story.
- **OQ-15 completed:** Financials anomaly tooltips now show "Open existing
  angle" (when a non-dismissed angle exists for the rule) above "Start new
  angle," deep-linking via the same `handleOpenAngle` path the Replay tab uses.
  Lookup fails open — on fetch error the button just hides.
- **Security: X-Forwarded-For trust gated** behind `TRUST_PROXY_HEADERS`
  (auto-on via Railway's built-in `RAILWAY_ENVIRONMENT`, so prod needed no
  config change). Direct traffic now keys rate limits on `REMOTE_ADDR` —
  previously a direct caller could spoof a fresh IP per request and bypass the
  per-IP buckets. AI per-case rate counter switched to atomic
  `cache.add`/`incr` (was racy get/set).
- **Prod operations:** Railway auto-deploy SUCCESS → `seed_demo --reset`
  (demo case `7a2fff17…`) → purged 3 accumulated "CSRF Test Case" rows
  (children first; `RESTRICT` FKs) → verified: referral PDF 200 + `%PDF`
  (15,210 bytes), health check 30/30 with self-cleanup, 8/8 confirmed angles
  cited, governance fields present.
- **Audit verdicts worth keeping:** git history is clean (no secrets, only
  `.env.example`; scanned all commits), AuditLog append-only holds (zero
  UPDATE/DELETE anywhere), banned-vocabulary check passes (all matches are
  code comments, none user-visible), README quickstart works from a cold
  clone, connector wiring table matches `urls.py` exactly.

**Recently completed (Session 45, June 5 2026):**

- **Demo GIF recorded and live in README.** Captured via Playwright (5 frames: Dashboard → graph → Research → Financials → Referrals). Key discovery during recording: the Vite frontend at port 5175 (auto-incremented because investigationsoftware Docker held 5173) was proxying `/api` to the wrong backend, AND the HMR WebSocket kept reconnecting to port 5173, reloading the page every 2s and wiping React state. Fixed permanently by moving Catalyst to **port 5174** across vite.config.ts, docker-compose.yml, README, CLAUDE.md. For the screenshot session, used `hmr: false` temporarily, then used React fiber tree access (`__reactFiber` key + `memoizedState.queue.dispatch`) to switch tabs programmatically — `isTrusted` check in Radix UI blocks synthetic events.

- **Graph visual rework — 6 commits toward Palantir Gotham aesthetic.** The core problem: nodes were objects competing for attention instead of data-point markers. Key realizations: (1) node-as-marker vs node-as-object philosophy — Gotham nodes are 22-28px; (2) `nodeDimensionsIncludeLabels: true` in cose-bilkent prevents label overlap when labels are outside nodes; (3) `mapData(finding_count, 0, 8, 22, 54)` creates automatic hub hierarchy; (4) filled SVG shapes render better than stroked ones at small sizes. Final state: blue circles (persons) + teal/amber/violet squares (orgs), labels right, node size scales live with finding count, ultra-minimal SVG icons, 1px lighter border ring, triangle arrowheads on confirmed edges, arrowless proposed edges, 26px dot-grid canvas texture.

- **Port migration: 5173 → 5174.** Tyler runs investigationsoftware Docker concurrently on the same machine (holds ports 5432, 8000, 5173). Catalyst moved to 5174 permanently. Both stacks can run simultaneously without conflict.

**Recently completed (Session 44, June 5 2026):**

- **CRUD completeness.** Closed the last functional gaps: delete angle (two-step confirm in AngleView toolbar, refreshes graph badge counts), case status change (status pill → `<select>` dropdown in case header, ACTIVE/PAUSED/REFERRED/CLOSED via PATCH), note edit/delete on quick captures (ProfilePanel knots), quick capture create/delete on angles (AngleView). Fixed the temp-id bug in `handleSaveCapture` — the return value from `createNote` was being discarded and a synthetic `temp-${Date.now()}` id pushed to state, making edit/delete silently 404 in the same session.
- **aiAsk async polling fix.** The `/ai/ask/` endpoint was already async (returns 202 + job_id) to handle a tool-use loop that takes 10–40s. The frontend `aiAsk()` client still expected a synchronous 200 + `{answer}` — the LeadPanel in AngleView was silently catching the error and showing "Lead unavailable" on every case. Fixed by making `aiAsk()` a transparent polling wrapper: enqueues the job, polls `GET /api/jobs/<id>/` every 2s up to 60s, returns `{answer}` when SUCCESS. All callers (LeadPanel, ConnectKnotsModal) unchanged. Added `AbortSignal` param so the ConnectKnotsModal can cancel stale polls when it closes or re-fires a suggestion.
- **Toolbar consolidated.** The "+ Knot" and "⟷ Connection" toolbar buttons both opened `ConnectKnotsModal`, which creates Angles — not standalone knots. There is no backend endpoint for creating a standalone Person or Organization outside of document extraction. Consolidated to a single "⚑ New Angle" button with an honest label. `EmptyWeb` button updated similarly.
- **Quick capture on Angles.** Notes (target_type=finding) worked on the backend but AngleView had no UI path. Added a Quick captures section to the main AngleView column — create/delete notes attached to the angle. Knots continue to support create/edit/delete via ProfilePanel.
- **Health check cleaned up.** Smoke test against Railway revealed 5 dead entries (referrals, case-referrals, coverage, referral-memo CSRF × 2 — all deleted in Session 43) plus `ai/ask` expected 200 but gets 202. Updated `tests/api_health_check.py`: removed dead entries, added `referral-targets`, fixed `ai/ask` expected status to 202.

**Recently completed (Session 43, June 4 2026):**

- ~~Backend suite 53 red, never run in CI~~ → **0 red, enforced.** Comprehensive fix pass: root-caused every failure (stale/real/dead classification rule). Key discoveries: Ohio AOS test was patching `requests.get` but connector uses `requests.Session` — it was firing live HTTP at ohioauditor.gov. `test_irs.py` was 104 tests for a removed Pub78/EO-BMF subsystem (connector was fully rewritten to 990-XML streaming). `api_case_fetch_990s` had three simultaneous bugs in the officer-wiring block (PersonResolutionResult passed as a Person FK, nonexistent `role_type` field, reserved `name` log key). CI now runs the full suite via a `postgres:16-alpine` service container.
- **Docker dev environment.** `docker compose up -d` starts all four services. Vite runs inside the container with HMR; Django uses runserver with volume-mount hot reload. Tyler develops in Docker (parity with what recruiters run).
- **Lead button (✦) + re-run rules button (↺)** wired into InvestigateTab WebToolbar. `runAiPatternAnalysis` and `reevaluateSignals` API client functions existed but had no UI callers — now triggered from the toolbar rail. Lead right panel shows job status + "X new Leads found" on SUCCESS.
- **726 lines of dead code deleted.** Orphaned AI endpoints (summarize, connections, narrative), rule-coverage view, cross-case findings endpoint, `_generate_memo_fallback`, and their client functions — all removed. Dead code in a portfolio repo signals poor codebase discipline.
- **README rewritten.** CI/test/Railway/Claude badges; 3-command Docker quickstart; 4-screenshot grid; Cytoscape.js (was D3); 921 tests (was 880+); ProPublica removed.
- **Architecture diagram updated.** ODNR WORKING (recovered 2026-06-04), 15 signal rules, 70+ endpoints, AI pattern augmentation added.
- **SEC-037 allowlist expanded.** `.schneidercorp.com` added — ODNR parcels return `aud_link` URLs on the Beacon/Schneider platform; all 100 live ODNR results now have a non-null `aud_link`.
- **990EZ/990PF parser tests added.** `test_irs.py` now 40 tests; covers 990EZ (`parse_quality=0.6`), 990PF (`parse_quality=0.5`), and the full fetch/ZIP layer (CSV streaming, `_fetch_zip_directory`, `fetch_990_xml` with real in-memory ZIP fixtures).

**Recently completed (Session 42, June 3 2026):**

Reconciled the docs to what actually shipped, and produced a full
backend→frontend wiring audit.

- **Graph-first rebuild confirmed landed.** The Maltego-influenced rewrite
  is no longer a separate `/cases/:caseId/workspace` shell — it replaced the
  old tabbed view and is the canonical `/cases/:id`. The case workspace is now
  5 tabs (Investigate / Research / Financials / Timeline / Referrals) with the
  Cytoscape graph ("Web") as the Investigate canvas, the `Angle`/`Knot`/
  `Connection` vocabulary in the components, documents in a drawer, and fuzzy
  "pending connections" review folded into Investigate. STATUS.md had still
  been describing the old 7-tab + D3 structure; corrected throughout.
- **Wiring matrix added** —
  [docs/architecture/wiring-matrix.md](docs/architecture/wiring-matrix.md).
  Every endpoint in `urls.py` traced through its API client function to the
  exact view/component that calls it, with a triaged punch list of dead ends
  (see "Not yet wired" above) and a one-loop recipe to regenerate it after any
  change.

**Recently completed (Session 41, May 4 2026):**

Started the case workspace UI rewrite. Two pieces landed: a canonical
design spec, and the layout shell that other steps built on top of.

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
  `/cases/:caseId` tabbed `CaseDetailView` preserved unchanged at the time.

  *(Superseded by Session 42: the build sequence completed in the interim —
  the Radix component layer, the Cytoscape graph migration, and the
  `Angle`/`Knot`/`Connection` vocabulary all landed, and the workspace was
  promoted to the canonical `/cases/:id` route, replacing the old tabbed
  view rather than living beside it.)*

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
  protects future ingestion. Existing junk rows in the "Bright Future"
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
  healthcheck. Verified end-to-end: IRS "bright future" search returns 177
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
- ~~Synchronous research endpoints 502ing at 30s~~ → Moved 4 slow research endpoints (IRS name search, IRS `fetch_xml`, Ohio AOS, County Parcel) to a Django-Q2 async job queue backed by Postgres. New `SearchJob` model tracks state + stores result JSON. Two new endpoints: `GET /api/jobs/<id>/` (poll) and `GET /api/cases/<id>/jobs/` (reattach). 24 tests green. Smoke-tested: "bright future" IRS search now returns 177 filings async, no 502.

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
  rows in "Bright Future" not cleaned up — see Deferred above.
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
  the "Bright Future" case can be deleted in admin or via a one-off command
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
3. **Short demo video** — README screenshots added (2026-06-04); GIF placeholder in README awaiting recording.
4. ~~**Inline notes on entities**~~ — **DONE.** Sticky notes on documents, entities, and findings.
5. ~~**Frontend consuming async job 202 + poll**~~ — **DONE (Session 36).** Research tab consumes the async contract via `useAsyncJob`; reattaches to live jobs on mount.
6. **Saved searches** — recurring queries on the entity browser.
7. ~~**Document annotation**~~ — **Partially addressed.** Document workspace with sticky notes replaces the need for in-app PDF annotation for now.
8. ~~**ODNR parcel API recovery**~~ — **RECOVERED (2026-06-04).** ODNR ArcGIS is returning parcels locally; `aud_link` now populated for Beacon/Schneider-hosted county portals (added `.schneidercorp.com` to SEC-037 allowlist). Railway status unverified — test after next deploy.

---

## Known issues

- ~~**ODNR statewide parcel API unreachable**~~ — **RECOVERED 2026-06-04.** Parcels return locally. `aud_link` now populated via Beacon/Schneider (.schneidercorp.com added to SEC-037 allowlist). Railway unverified — test on next deploy.
- **Ohio SOS connector requires manual CSV upload** via an admin endpoint — automated download was blocked by SOS returning 403s. Documented in the connector file.
- **AI pattern augmentation** is an investigator aid, not the deliverable. Every AI finding lands with `evidence_weight=DIRECTIONAL` or lower and `status=NEW`; the investigator promotes it up the pipeline manually after verification. The referral package exporter will never ship an AI finding unless the investigator has explicitly confirmed it.
- **Fuzzy match "Accept" is review-only — no automated data merge yet.** When an investigator marks a candidate MERGED, the system records the decision but does not yet reassign FK references or fold aliases. A future merge tool will operate on the queue of MERGED candidates. Documented in the PATCH endpoint.
- **form990_parser.py may be partially superseded.** It is wired into `_process_uploaded_file` for IRS_990 docs but the IRS TEOS XML pipeline also extracts Parts IV/VI/VII. Both paths are currently active; consolidation is deferred.
- **Git pre-commit hook points to a Windows Python path** and does not run in sandbox/CI environments. Tyler commits from his local machine where the hook works.
- **Vite-in-Docker misses file changes on Windows bind mounts.** After editing frontend source, the dev server can keep serving the stale cached module (inotify events don't cross the bind mount). If a change doesn't show up, `docker restart catalyst_frontend`. Bit the Session 46 verification — the CSRF fix looked unapplied until the container restarted.
- **Deferred from the Session 46 audit (LOW):** API error copy surfaces raw strings like "403 Forbidden" in the Research/Referrals panels (largely mooted by the CSRF fix, but the copy path remains); the jobs API exposes raw exception strings in `error_message` (useful for a single-user tool, would need sanitizing for multi-user).
- **Health check leaves one CLOSED case per production run by design** — labeled "Health-check artifact — safe to ignore" (cases are non-deletable to protect the audit trail; finding/note/document artifacts are deleted).

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

---

## Keeping this file honest

This file drifts from reality the moment a session ends without updating it
(it described a 7-tab D3 app for a month after the graph-first rebuild
shipped). To prevent that, at the **end of every working session**:

1. **Update "Working" / "Not yet wired"** if any capability changed state
   (newly wired, removed, or broken).
2. **Add a "Recently completed (Session N)" entry** at the top of the history
   with the date and what landed — newest first.
3. **Re-run the wiring audit** if `urls.py`, `frontend/src/api/`, or the views
   changed, and sync [docs/architecture/wiring-matrix.md](docs/architecture/wiring-matrix.md)
   (regenerate recipe in its §5).
4. **Bump the "Last updated" line** at the top.

The goal: a recruiter or maintainer can trust this file reflects the code as
it is *today*, not as it was at some past session.
