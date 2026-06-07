# Wiring Matrix — Backend → Frontend

**Last updated:** 2026-06-05
**Purpose:** Make the question *"is every backend endpoint actually reachable from the UI?"*
answerable at a glance. Each backend endpoint is traced through its API client function to the
exact view/component that calls it. Anything with no caller is a **dead end** — either a feature to
wire up or a deliberate deferral.

This is a **living document.** Regenerate it after any change to `urls.py`, `frontend/src/api/`, or
the views — see [§4 How to regenerate](#4-how-to-regenerate).

---

## 1. The seam

The wiring risk in Catalyst is not the middleware (that's just auth + rate limiting). It's this
three-hop chain:

```
backend endpoint (urls.py)  →  API client fn (frontend/src/api/*)  →  UI caller (view/component)
```

- **Hop 1 → 2 is complete.** Almost every endpoint has a client function.
- **Hop 2 → 3 is where the gaps are.** Several client functions exist but no UI calls them.

---

## 2. Routes → views

`App.tsx` mounts 5 routes:

| Route | View | Notes |
|-------|------|-------|
| `/` | `DashboardView` | KPIs, severity bars, activity feed, case list |
| `/cases` | `CasesListView` | All cases + create |
| `/cases/:id` | `CaseDetailView` | 5 tabs (below) — the workspace |
| `/search` | `SearchView` | Cross-case search |
| `/settings` | `SettingsView` | SOS CSV upload/status |

`CaseDetailView` tabs: **Investigate** (the graph / "Web" — `CytoscapeCanvas`, `AngleView`,
`ConnectKnotsModal`, `TieOffModal`, `ConnectionReviewPanel`) · **Research** · **Financials** ·
**Timeline** · **Referrals**.

> **Note:** The `/cases/:caseId/workspace` shell and the old 7-tab structure described in earlier
> STATUS.md revisions no longer exist. The graph-first rebuild landed and was folded into
> `/cases/:id`. This matrix reflects the code as it actually is on `main`.

---

## 3. Endpoint → client → UI

✅ = reachable from UI · ⚠️ = dead end, candidate to wire · 🟦 = dead end, deferred on purpose

### Cases / dashboard

| Endpoint | Client fn | UI caller | |
|----------|-----------|-----------|---|
| `GET/POST /api/cases/` | `fetchCases` / `createCase` | CasesListView, DashboardView | ✅ |
| `GET /api/cases/<id>/` | `fetchCase` | CaseDetailView | ✅ |
| `PATCH /api/cases/<id>/` | `updateCase` | CaseDetailView (status selector) | ✅ status change wired (2026-06-05) |
| `GET /api/cases/<id>/dashboard/` | `fetchDashboard` | InvestigateTab | ✅ |
| `GET /api/signal-summary/` | `fetchSignalSummary` | DashboardView | ✅ |
| `GET /api/activity-feed/` | `fetchActivityFeed` | DashboardView | ✅ |
| ~~`GET /api/cases/<id>/coverage/`~~ | ~~`fetchCoverage`~~ | — | ✅ **endpoint + client deleted Session 43** |

### Findings ("Angles")

| Endpoint | Client fn | UI caller | |
|----------|-----------|-----------|---|
| `GET/POST /api/cases/<id>/findings/` | `fetchAngles` / `createAngle` | DocumentView, ReferralsTab / ConnectKnotsModal, AngleSplitModal | ✅ |
| `GET/PATCH /api/cases/<id>/findings/<fid>/` | `fetchAngle` / `updateAngle` | AngleView, CaseDetailView, TieOffModal, CiteDocumentPicker, … | ✅ |
| `DELETE …/findings/<fid>/` | `deleteAngle` | AngleView toolbar | ✅ wired (2026-06-05) |
| ~~`GET /api/findings/` (cross-case)~~ | ~~`fetchAllAngles`~~ | — | ✅ **endpoint + client deleted Session 43** |
| `POST /api/cases/<id>/reevaluate-findings/` | `reevaluateSignals` | InvestigateTab WebToolbar | ✅ ↺ button (2026-06-04) |

### Documents

| Endpoint | Client fn | UI caller | |
|----------|-----------|-----------|---|
| `POST …/documents/bulk/` | `uploadDocuments` | DocumentDrawer | ✅ |
| `POST …/documents/process-pending/` | `processPendingDocuments` | DocumentDrawer | ✅ |
| `GET …/documents/<id>/` | `fetchDocument` | DocumentView | ✅ |
| `DELETE …/documents/<id>/` | `deleteDocument` | DocumentDrawer | ✅ |

### Financials / IRS 990

| Endpoint | Client fn | UI caller | |
|----------|-----------|-----------|---|
| `GET …/financials/` | `fetchFinancials` | FinancialsTab | ✅ |
| `POST …/fetch-990s/` | `fetch990s` | ResearchTab, FinancialsTab | ✅ |

### Referral package (the deliverable)

| Endpoint | Client fn | UI caller | |
|----------|-----------|-----------|---|
| `POST …/referral-pdf/` | `generateReferralPdf` | ReferralsTab | ✅ |
| `POST …/export/` | `exportCase` | — | ⚠️ superseded by referral-pdf? confirm + delete |
| (referral-pdf w/ memo flag) | `generateReferralMemo` | — | ⚠️ memo variant never surfaced |
| `GET/POST/PATCH/DELETE …/referral-targets/` | `getReferralTargets` + CRUD | ReferralsTab | ✅ |

### Research connectors (async 202 + poll)

| Endpoint | Client fn | UI caller | |
|----------|-----------|-----------|---|
| `POST …/research/irs/` | `searchIrs` | ResearchTab, useAsyncJob | ✅ |
| `POST …/research/ohio-aos/` | `searchOhioAos` | ResearchTab | ✅ |
| `POST …/research/ohio-sos/` | `searchOhioSos` | ResearchTab | ✅ |
| `POST …/research/recorder/` | `searchRecorder` | ResearchTab | ✅ |
| `POST …/research/parcels/` | `searchParcels` | ResearchTab | ✅ ODNR recovered + wired (2026-06-04/05) |
| `POST …/research/add-to-case/` | `addResearchToCase` | ResearchTab | ✅ |
| `GET /api/jobs/<id>/` | `fetchJob` | useAsyncJob | ✅ |
| `GET …/jobs/` | `fetchCaseJobs` | useAsyncJob, ResearchTab | ✅ |

### Entities / graph ("Web" + "Knots")

| Endpoint | Client fn | UI caller | |
|----------|-----------|-----------|---|
| `GET …/graph/` | `fetchGraph` | InvestigateTab, TimelineTab | ✅ |
| `GET /api/entities/` | `fetchEntities` | ConnectKnotsModal, AngleSplitModal | ✅ |
| `GET /api/entities/<type>/<id>/` | `fetchEntityDetail` | InvestigateTab | ✅ |
| `GET …/persons/deceased/` | `getDeceasedPersons` | ResearchTab | ✅ |

### Fuzzy match review ("Pending connections")

| Endpoint | Client fn | UI caller | |
|----------|-----------|-----------|---|
| `GET …/fuzzy-candidates/` | `fetchFuzzyMatches` | ConnectionReviewPanel, InvestigateTab | ✅ |
| `PATCH …/fuzzy-candidates/<id>/` | `resolveFuzzyMatch` | ConnectionReviewPanel | ✅ |

### Notes ("Quick capture") / investigation steps

| Endpoint | Client fn | UI caller | |
|----------|-----------|-----------|---|
| `GET/POST …/notes/` | `fetchNotes` / `createNote` | ProfilePanel, AngleView, DocumentView, ResearchTab | ✅ |
| `PATCH …/notes/<id>/` | `updateNote` | ProfilePanel (knot notes) | ✅ wired (2026-06-05) |
| `DELETE …/notes/<id>/` | `deleteNote` | ProfilePanel, AngleView | ✅ wired (2026-06-05) |
| `GET/POST …/investigation-steps/` | `getInvestigationSteps` / `createInvestigationStep` | InvestigationTab | ✅ |

### AI surface

| Endpoint | Client fn | UI caller | |
|----------|-----------|-----------|---|
| `POST …/ai/ask/` | `aiAsk` | ConnectKnotsModal, AngleView | ✅ |
| ~~`POST …/ai/summarize/`~~ | ~~`aiSummarize`~~ | — | ✅ **endpoint + client deleted Session 43** |
| ~~`POST …/ai/connections/`~~ | ~~`aiConnections`~~ | — | ✅ **endpoint + client deleted Session 43** |
| ~~`POST …/ai/narrative/`~~ | ~~`aiNarrative`~~ | — | ✅ **endpoint + client deleted Session 43** |
| `POST …/ai/analyze-patterns/` | `runAiPatternAnalysis` | InvestigateTab WebToolbar | ✅ ✦ Lead button (2026-06-04) |

### Search / admin

| Endpoint | Client fn | UI caller | |
|----------|-----------|-----------|---|
| `GET /api/search/` | `searchAll` | SearchView, DocumentView | ✅ |
| `POST /api/admin/upload-sos-csv/` | `uploadSosCsv` | SettingsView | ✅ |
| `GET /api/admin/sos-csv-status/` | `fetchSosCsvStatus` | SettingsView | ✅ |

---

## 4. Dead-end triage

Pulled out of the tables above so there's a single punch list.

### Wire up (real value sitting dark)

~~1. **`runAiPatternAnalysis`** — wired 2026-06-04 (✦ button in InvestigateTab toolbar)~~
~~2. **`reevaluateSignals`** — wired 2026-06-04 (↺ button in InvestigateTab toolbar)~~
~~3. **`aiSummarize` / `aiConnections` / `aiNarrative`** — deleted Session 43~~
~~4. **`updateCase`, `deleteAngle`, `updateNote`, `deleteNote`** — wired Session 44~~
~~5. **`searchParcels`** — ODNR recovered; wired Session 43/44; confirmed live on Railway~~

**No remaining dead ends as of 2026-06-05.** All client functions have at least one UI caller (verified by wiring audit).

### Decide & possibly delete (avoid dead code in a portfolio repo)

- **`exportCase` (`/export/`)** vs `generateReferralPdf` — confirm export is superseded, then
  remove the endpoint + client fn. (Low priority — not visible in demo path.)

### Deferred on purpose (leave as-is)

_None remaining._

---

## 5. How to regenerate

From `frontend/src`, list every client function exported in `api/index.ts` and grep for callers
outside the `api/` dir. Zero hits = dead end:

```bash
cd frontend/src
for fn in $(grep -oE '^\s+[a-zA-Z0-9]+,' ../src/api/index.ts | tr -d ' ,'); do
  files=$(grep -rl --include="*.tsx" --include="*.ts" --exclude-dir=api "\b$fn\b" . | sed 's|^\./||' | tr '\n' ',' )
  printf "%-26s | %s\n" "$fn" "${files:-NONE}"
done
```

Cross-check the other direction — endpoints in `backend/investigations/urls.py` that have **no**
client function — by scanning `urls.py` paths against the exports in `api/index.ts`.

Update §3 and the §4 punch list whenever a dead end is wired or removed.
