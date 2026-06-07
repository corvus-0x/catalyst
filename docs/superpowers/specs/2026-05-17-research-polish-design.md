# Research + Polish — Design Spec

**Date:** 2026-05-17  
**Scope:** Five targeted improvements to the Research tab and Investigate tab Web view.

---

## Feature A — IRS → "Create Organization knot"

**Problem:** IRS TEOS search results offer only "Fetch 990s → Financials" and "Save as note." An investigator who finds an org via IRS search cannot add it as a knot to the Web graph in one click.

**Solution:** Add a third popover option — "Create Organization knot" — to `IrsResultsTable`. Calls `addResearchToCase(caseId, { source: "irs", data: r })`. On success, marks the row as ✓ Added (same visual as existing done state).

**Files:** `frontend/src/views/ResearchTab.tsx` only.

**Acceptance criteria:**
- Popover for each IRS row has three options: Fetch 990s, Create Organization knot, Save as note
- Clicking "Create Organization knot" calls `POST /api/cases/:id/research/add-to-case/` with `{ source: "irs", data: <row> }`
- On success, row shows ✓ Added checkmark and popover closes
- On error, `toast.error(...)` shown

---

## Feature B — County Parcel — disabled state

**Problem:** The ODNR ArcGIS parcel API returns 404 from Railway. The parcel tab currently shows a working search form that silently fails or returns an error. Investigators don't understand why it doesn't work or what to use instead.

**Solution:** Replace the parcel search form and job UI with a static informational panel:
- `AlertTriangle` icon in amber
- Title: "County Parcel Search — Currently Unavailable"  
- Body: "The ODNR ArcGIS API is returning errors from Railway. Use County Recorder to search property records and deeds directly."
- Button: "Switch to County Recorder" → sets `source = "recorder"`

**Files:** `frontend/src/views/ResearchTab.tsx` only.

**Acceptance criteria:**
- When `source === "parcel"`, the parcel panel shows the disabled state (no search form)
- "Switch to County Recorder" button changes active connector to Recorder tab
- The async `parcelJob` state is still initialized (to avoid hook order issues) but not used visually

---

## Feature C — SOS → Deceased signatory flag

**Problem:** Ohio SOS results can name persons as statutory agents, organizers, or officers. When that person is deceased (e.g. the Ronald J. Mitchell scenario in Bright Future), the investigator needs a visual warning before acting on the result.

**Solution:**

*Backend:* New endpoint `GET /api/cases/<uuid>/persons/deceased/` returns a lightweight list of persons in the case with a death date or DECEASED role tag:
```json
[
  { "full_name": "Ronald J. Mitchell", "date_of_death": "2025-09-30" }
]
```

*Frontend:* ResearchTab fetches this on mount and stores `deceasedNames: Set<string>` (all names lowercased + trimmed). `SyncResultsTable` receives `deceasedNames` as a prop. For each SOS result row, scan all string values in the row data — if any value substring-matches a name in `deceasedNames`, render an amber `⚠️ DECEASED SIGNATORY` badge on that row above the columns.

**Name matching rule:** Normalize both sides to lowercase+trimmed. Use `includes()` substring check (catches "Ronald J. Mitchell" matching inside a longer string like "Agent: Ronald J. Mitchell, Cassella OH"). False positive risk is low given the small deceased-person set per case.

**Files:**
- `backend/investigations/views.py` — new `api_case_persons_deceased` view
- `backend/investigations/urls.py` — new URL pattern
- `frontend/src/api/cases.ts` — `getDeceasedPersons(caseId)`
- `frontend/src/types/index.ts` — `DeceasedPerson` interface
- `frontend/src/views/ResearchTab.tsx` — fetch on mount, pass to SyncResultsTable, render badge

**Acceptance criteria:**
- Endpoint returns only persons with `date_of_death IS NOT NULL` or `DECEASED in role_tags`, ordered by name
- ResearchTab fetches once on mount; deceased names available before first SOS search
- Any SOS result row that contains a deceased person's name shows `⚠️ DECEASED SIGNATORY` amber badge
- Non-SOS connectors (IRS, AOS, Recorder) are unaffected — `deceasedNames` is only checked for SOS results

---

## Feature D — KPI cards on the Web (Investigate tab)

**Problem:** The spec calls for KPI cards (Findings, Documents, Entities, Days open) on the Web Level 1 view. The data is almost entirely already available in InvestigateTab — it just isn't rendered.

**Solution:** Add a compact stats bar above the Cytoscape canvas, visible only when `current.kind === "web"`. Four chips:

| Card | Data source |
|------|-------------|
| Findings | `dashboard.findings.total` |
| Documents | `documents.length` (already a prop) |
| Entities | `graph.nodes.filter(n => n.type === "person" \|\| n.type === "organization").length` |
| Days open | `Math.floor((Date.now() - new Date(caseCreatedAt).getTime()) / 86_400_000)` |

`caseCreatedAt` is the only new data needed. Add it as a new optional prop `caseCreatedAt?: string` on `InvestigateTabProps` and pass `caseData.created_at` from `CaseDetailView`.

**Files:**
- `frontend/src/views/InvestigateTab.tsx` — add `caseCreatedAt` prop, render stats bar
- `frontend/src/views/CaseDetailView.tsx` — pass `caseCreatedAt={caseData?.created_at}`

**Acceptance criteria:**
- Stats bar visible on Level 1 (Web) only — not on Profile, Angle, or Document views
- All 4 metrics show `—` when data not yet loaded
- Days open shows integer days since case creation
- Bar is visually minimal — chips, not large cards — does not crowd the graph toolbar

---

## Feature E — ✓ Added badge persistence

**Problem:** `IrsResultsTable` and `SyncResultsTable` each own local `useState<Set>` for tracking which rows have been added. React destroys this state when the component unmounts (e.g. user switches to Financials tab and back). Checkmarks disappear.

**Solution:** Lift the `addedKeys` state to `ResearchTab`. ResearchTab holds a single `addedKeys: Set<string>` and an `addKey(key: string) → void` callback. Both table components receive these as props. Keys:
- IRS rows: `${r.ein}_${r.tax_year}`  
- Sync rows (SOS, AOS): `${source}_${idx}`

`ResearchTab` persists as long as the Case Detail view is mounted (it's lazy-loaded via Suspense but not unmounted on tab switch). State survives all tab switches within the same session.

**Files:** `frontend/src/views/ResearchTab.tsx` only — internal refactor, no API changes.

**Acceptance criteria:**
- ✓ Added checkmarks survive switching away from Research tab and back
- All three table types that have "Add to case" actions participate (IRS, SyncResults for SOS/AOS, Recorder doesn't have add actions)
- No duplicate-add protection added — that's a separate concern

---

## File Map

| File | Change |
|------|--------|
| `backend/investigations/views.py` | Add `api_case_persons_deceased` view |
| `backend/investigations/urls.py` | Add `persons/deceased/` URL pattern |
| `frontend/src/types/index.ts` | Add `DeceasedPerson` interface |
| `frontend/src/api/cases.ts` | Add `getDeceasedPersons(caseId)` |
| `frontend/src/views/ResearchTab.tsx` | Features A, B, C (SOS badge), E (state lift) |
| `frontend/src/views/InvestigateTab.tsx` | Feature D (stats bar + caseCreatedAt prop) |
| `frontend/src/views/CaseDetailView.tsx` | Feature D (pass caseCreatedAt) |
