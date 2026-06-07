# Catalyst Smoke Tests

**Purpose:** A 10–15 minute checklist to run after every meaningful change. Catches the "obvious broken" bugs that automated tests miss.

**When to run:**
- After `docker-compose up` when starting a local dev session
- After every Railway deploy
- Before opening a PR that touches >1 backend file or any frontend route

**How to use:** Work top to bottom. Check the box only when you've actually seen the green case in the UI / response — not "I assume it works." If something fails, stop, file an issue (or at least a TODO note in the relevant CLAUDE.md section), and fix before continuing.

---

## 0. Environment Up

### Local (Docker)
- [ ] `docker-compose up -d --build` returns clean (no red exit codes)
- [ ] `docker-compose ps` shows **3 services** running: `db`, `backend`, `qcluster` (all `Up`)
- [ ] `docker-compose logs backend | tail -20` shows `Starting gunicorn` with no tracebacks
- [ ] `docker-compose logs qcluster | tail -20` shows `Q Cluster ... starting` and `Process ... ready` (no Postgres connection errors)
- [ ] Open http://localhost:8000/api/health/ → returns `{"status": "ok"}` (or similar)
- [ ] Open http://localhost:5173/ → React app renders the Dashboard without a console error
- [ ] DevTools Console on the Dashboard: zero red errors (yellow warnings ok)

### Railway
- [ ] Latest commit on `main` shows green CI on GitHub
- [ ] Railway deploy log says "Deployment successful" (not still building)
- [ ] Railway dashboard shows **2 services** Up: `backend` (web) and `qcluster` (worker)
- [ ] Open the Railway-hosted URL → Dashboard renders
- [ ] DevTools Console: zero red errors

---

## 1. Pre-loaded Demo Case

The "Bright Future Foundation" demo case ships with 4 persons, 2 orgs, 2 properties, 7 documents, 6 years of financials, and 9 findings. If anything below is empty or zero, the seed didn't run.

**Local first run:** `docker-compose exec backend python manage.py seed_demo`

- [ ] Visit `/cases` → "Bright Future Foundation" appears in the list
- [ ] Click it → Case Detail loads with all 6 tabs (Overview, Documents, Research, Financials, Pipeline, Referrals)
- [ ] **Overview tab:** D3 entity graph renders nodes + edges (not a blank box)
- [ ] **Overview tab:** Timeline renders with at least 5 events
- [ ] **Documents tab:** Lists 7 documents
- [ ] **Financials tab:** Shows a year-over-year revenue/expenses table (not "No data")
- [ ] **Pipeline tab:** Shows ≥9 findings; severity chips render; status filter chips work
- [ ] **Referrals tab:** "Generate Referral Package (PDF)" button is visible

---

## 2. Case CRUD

- [ ] **Create:** From `/cases`, click "New Case", enter a name, save → redirected to the new case's detail page
- [ ] **Edit:** Change the case name in the header; refresh; new name persists
- [ ] **Delete:** Delete a throwaway case; it disappears from `/cases`
- [ ] **Notes:** Add a note from the Overview tab; refresh; note persists

---

## 3. Document Upload + OCR

- [ ] **Upload:** Documents tab → upload a small PDF (any) → file appears in the list with `ocr_status: PENDING`
- [ ] **Process pending:** Click "Process Pending" (or wait for batch) → status moves to `COMPLETED`
- [ ] **View:** Click the doc → Document Workspace opens with extracted text in the Text tab
- [ ] **Sticky note:** Add a note on a document; refresh; note persists
- [ ] **Delete:** Delete the test doc; it's removed from the list

---

## 4. Research Tab — All 5 Sources

> **The connectors most likely to break.** Test each one explicitly.

### IRS TEOS (async, ~20-90s)
- [ ] Search "Bright Future Foundation" → spinner shows "Searching IRS filings…"
- [ ] After completion, results render with EIN, tax year, revenue
- [ ] Click "Fetch 990 Data" on a result → expandable panel shows Part I financials
- [ ] **Reattach test:** Start a search, switch to a different tab, switch back → spinner reappears (don't lose work)

### Ohio AOS (async, ~10-30s)
- [ ] Search a known Ohio nonprofit name → results render with audit report rows
- [ ] No 502 in DevTools Network panel (the bug from Session 35)

### County Parcel — Owner Mode (async, currently broken on Railway per CLAUDE.md)
- [ ] Search "Smith" with county "Franklin" → either parcel results OR a clear "ODNR API unavailable" error
- [ ] Failure is surfaced to the user, not silent

### County Parcel — PIN Mode (async, fixed in PR #4)
- [ ] Search a parcel-format string like `1234-5678-9012` → backend job's `query_params.search_type == "parcel"` (check via `/api/cases/<id>/jobs/`)
- [ ] Results return parcel-mode (not silently fall through to owner mode)

### Ohio SOS (sync, requires CSV upload)
- [ ] If CSVs not uploaded yet: `POST /api/admin/upload-sos-csv/` with each of the 4 CSVs from publicfiles.ohiosos.gov
- [ ] `GET /api/admin/sos-csv-status/` shows all 4 files present
- [ ] Search "Bright Future" → at least one entity row returns

### County Recorder (sync — URL builder + parser)
- [ ] Pick a county (e.g. "Franklin"), enter a name → "Open Recorder Portal" link is generated
- [ ] Link opens the right county's portal in a new tab

### Add to Case
- [ ] Click "Add to Case" on any research result row → success toast
- [ ] Verify it landed: corresponding entity appears on the Overview tab's graph

---

## 5. Pipeline Tab (Findings)

- [ ] **List:** All seeded findings render; severity colors are right
- [ ] **Filter:** Click "Manual" / "Rule" / "AI" chips → list filters correctly
- [ ] **Detail:** Click a finding → side panel opens with description, narrative, doc citations
- [ ] **Re-evaluate:** Click "Re-evaluate Signals" → no errors; finding count is sane
- [ ] **Manual finding:** Create a manual finding; it appears with source=MANUAL

---

## 6. AI Pattern Analysis (async, costs Claude tokens)

> Skip this section in routine smoke runs to save money. Run it only when you've changed `ai_pattern_augmentation.py` or related code.

- [ ] Pipeline tab → "Run AI Analysis" button → spinner appears
- [ ] On success, toast shows `{N} findings created · {M} dropped`
- [ ] New findings appear with the 🤖 AI badge (purple)
- [ ] Each AI finding has at least one Doc-N citation in its detail panel
- [ ] **409 guard:** Click "Run AI Analysis" again *while one is running* → 409 toast (not a duplicate enqueue)
- [ ] No finding contains the words "fraud", "crime", "illegal", or "guilty" in the rendered title or description

---

## 7. Referral Package PDF Export

- [ ] Referrals tab → click "Generate Referral Package (PDF)"
- [ ] Browser downloads `referral-package-<case-id>.pdf`
- [ ] Open the PDF: cover page renders, findings section has [Doc-N] citations, document index lists SHA-256 hashes
- [ ] No "lorem ipsum" or placeholder text

---

## 8. Cross-Case Views

- [ ] `/triage` → renders findings across cases; severity counts add up
- [ ] `/entities` → renders persons / orgs / properties from the demo case
- [ ] `/search` → search "Bright" finds the demo case + entities
- [ ] `/dashboard` → KPI cards show non-zero counts

---

## 9. Settings & Theming

- [ ] Settings → toggle dark mode → all pages re-render in dark theme without broken contrast
- [ ] Toggle back to light → reverts cleanly

---

## 10. Negative-Path Spot Checks

> Quick "does it fail gracefully" probes.

- [ ] `POST /api/cases/<bad-uuid>/research/irs/` with a malformed UUID → 404, not 500
- [ ] Upload a 0-byte file → either rejected with a clear error, or accepted with `ocr_status: FAILED`
- [ ] Disable network in DevTools, click any search button → user sees an error toast (not a silent hang)

---

## After-the-Run Checklist

- [ ] Backend log (`docker-compose logs backend` or Railway log) — zero new tracebacks during the smoke run
- [ ] Worker log (`docker-compose logs qcluster` or Railway worker) — zero "Failed" job records that weren't expected
- [ ] DevTools console on every page visited — zero red errors
- [ ] If any item failed: write down which one, the URL, and the error — paste into next session's prompt

---

## Known-Broken Items (Don't Treat As Failures)

These are tracked in CLAUDE.md and are not regressions:

- **County Parcel (ODNR) returns 0 results from Railway** — external ODNR ArcGIS API is down. Verify the failure surfaces cleanly, then move on.
- **Backend tests don't run locally without Postgres** — use Docker Compose (`docker-compose exec backend python manage.py test`) or wait for CI on Railway.

---

## When This Doc Is Wrong

If a smoke step is consistently confusing or doesn't match the UI anymore, fix the doc here in the same PR. A stale checklist is worse than no checklist.
