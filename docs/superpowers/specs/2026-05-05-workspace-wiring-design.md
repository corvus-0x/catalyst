# Catalyst Workspace Wiring — Design Spec
**Date:** 2026-05-05  
**Status:** Approved for implementation  
**Scope:** Wire all disconnected backend functionality into the new CaseWorkspace frontend

---

## Problem Statement

The Session 41 workspace redesign (CaseWorkspace) replaced the old 6-tab CaseDetailView with a
modern panel-based layout. The visual shell is complete. However, several functional areas that
existed in the old design were deleted and not rebuilt:

- Research connectors (IRS search, Ohio SOS, AOS, Recorder, Parcels) — no frontend UI
- Notes on entities/findings — api.ts functions exist but nothing calls them
- AI features — backend endpoints exist, api.ts functions exist, no workspace UI
- Case status update — PATCH endpoint missing from backend entirely
- "More" menu button and Layout button — render but do nothing

The result: a frontend that looks complete but cannot be used for actual investigation work.

---

## Approach: Extend Existing Patterns

The workspace already has an established center-canvas pane pattern (990 Viewer, Financials,
Package) and an established right-panel tab pattern (Properties, Sources, Flags, Actions).
This design extends both patterns rather than introducing new navigation paradigms.

---

## Section 1 — ResearchPane (center canvas pane)

### Placement
Add "Research" as a 5th toggle button in `CaseTopBar` alongside Graph / 990 Viewer /
Financials / Package. Controlled by the existing `activeViews` state and `ViewToggle` type.
Rendered by `CaseCenterCanvas` like all other panes.

### Layout
```
┌──────────────────────────────────────────────────────────┐
│ [IRS Search][Fetch 990][Ohio SOS][AOS][Recorder][Parcels]│  ← connector tab strip
├──────────────────────────────────────────────────────────┤
│  Search form (fields change per connector)               │
│  [Run Search]                                            │
├──────────────────────────────────────────────────────────┤
│  Results list (scrollable)                               │
│  ▶ Result row 1                                          │
│  ▶ Result row 2  ← click = expand detail below          │
├──────────────────────────────────────────────────────────┤
│  Detail view (shown when a result is selected)           │
│  Full structured data from connector                     │
│  [Add to Case]   [Clear]                                 │
└──────────────────────────────────────────────────────────┘
```

### Connector Tab Specs

| Connector | Search Fields | api.ts fn | Async? |
|---|---|---|---|
| IRS Name Search | Org name (text) | `searchIRS()` | Yes — polls `/api/jobs/<id>/` |
| Fetch 990 | EIN (text) | `fetch990Data()` | No — synchronous |
| Ohio SOS | Entity name or number | `searchOhioSOS()` | No |
| Ohio AOS | Entity name | `searchOhioAOS()` | Yes — polls |
| County Recorder | County (dropdown) + Name | `searchRecorder()` | No |
| County Parcels | County (dropdown) + Owner/Parcel | `searchParcels()` | Yes — polls |

### Async Behavior
Connectors marked "Yes" use the existing `useAsyncJob` hook (built in Session 36).
- POST to research endpoint → receives `{ job_id, status_url }`
- Poll `/api/jobs/<job_id>/` every 2s
- Show spinner with "Searching IRS TEOS…" label
- On success: populate results list
- On failure: show error with retry button

### Results → Detail → Add to Case
- Clicking a result row expands a detail section below the list (accordion style, not a modal)
- Detail shows all structured data returned by the connector
- "Add to Case" calls `addResearchToCase(caseId, source, data)` → `POST /api/cases/<id>/research/add-to-case/`
- After adding: show a success confirmation, graph refreshes (increment a `graphVersion` counter passed to WorkspaceGraph)

### Component File
`frontend/src/components/workspace/ResearchPane.tsx` + `ResearchPane.module.css`

Sub-components (all in same file, not separate files):
- `ConnectorTabStrip` — tab selector
- `IrsNameSearchTab`, `Fetch990Tab`, `OhioSosTab`, `OhioAosTab`, `RecorderTab`, `ParcelsTab` — one per connector
- `ResultsList` + `ResultDetail` — shared result display

---

## Section 2 — Notes Tab (right detail panel)

### Placement
Add "Notes" as a 5th tab in `RightDetailPanel`, after Actions.

### Behavior
- **No entity selected:** target = `{ type: "case", id: caseId }`
- **Entity selected on graph:** target = `{ type: entity.type, id: entity.id }`
- **Finding clicked in Triage:** target = `{ type: "finding", id: finding.id }`
  (Triage already fires `onSelectFinding` — lift this to workspace state so the right panel can receive it)

### UI
```
Notes
──────────────────────────────
┌────────────────────────────┐
│ Add a note…                │
│                            │
└────────────────────────────┘
[Add Note]

May 5 · 07:30
"Officer listed on 2 orgs simultaneously"
[×]

May 4 · 22:00
"Address matches SOS filing from 2021"
[×]
```

### API Calls
- Load: `fetchNotes(caseId, targetType, targetId)` on tab open + on target change
- Create: `createNote(caseId, targetType, targetId, content)` on submit
- Delete: `deleteNote(caseId, noteId)` on × click (with confirmation)

### State lifting needed
`CaseWorkspace` currently passes `onSelectFinding` to `CaseBottomDock` but doesn't hold the
selected finding in workspace state. Add `selectedFinding: FindingItem | null` state to
`CaseWorkspace`, pass setter to dock, and pass value to `RightDetailPanel`.

---

## Section 3 — AI Features (right detail panel, Actions tab)

### Placement
Expand the existing "Actions" tab in `RightDetailPanel`. Add an "AI Analysis" section below
the existing research action buttons.

### Actions by context

**No entity selected (case-level):**
- "Run AI Pattern Analysis" → `runAiPatternAnalysis(caseId)` → async job, polls status, on
  complete re-fetches findings
- "Ask AI" → inline text input → `aiAsk(caseId, question, [])` → shows response inline
- "Generate case summary" → `aiSummarize(caseId, "case", caseId)` → shows summary inline

**Org entity selected:**
- All case-level actions above, plus:
- "Analyze entity connections" → `aiConnections(caseId, entityId)` → shows inline

**Finding selected from Triage:**
- "Draft referral narrative" → `aiNarrative(caseId, [findingId], "formal")` → shows inline

### UI pattern
Each AI action button shows a spinner when in-flight. The response appears in a collapsible
text block below the button that triggered it. No modals. No new panes.

### ANTHROPIC_API_KEY guard
If the AI call returns a 500 with "ANTHROPIC_API_KEY not set", display a clear message:
"AI features require an ANTHROPIC_API_KEY environment variable set in Railway."

---

## Section 4 — Backend: PATCH /api/cases/<pk>/

### Why it's needed
There is no endpoint to update a case's `status`, `notes`, or `referral_ref`. The "More" menu
(Section 5) needs this to let the investigator mark a case as REFERRED or CLOSED.

### Spec
```
PATCH /api/cases/<uuid:pk>/
Body: { status?, notes?, referral_ref? }  (all optional)
Response: updated case detail object
Auth: session or token required
```

Allowed status values: `ACTIVE`, `PAUSED`, `REFERRED`, `CLOSED`

Add `api_case_detail_patch` view function, wire to `api_case_detail` URL pattern with `PATCH`
method, add `patchCase(caseId, payload)` to `api.ts`.

---

## Section 5 — "More" Menu Button (top bar)

### Placement
The `MoreVerticalIcon` button in `CaseTopBar` already renders. Wire it to a `DropdownMenu`
component (already exists in `frontend/src/components/ui/DropdownMenu.tsx`).

### Menu items
```
Export JSON
Export CSV
──────────────
Mark as Active
Mark as Paused
Mark as Referred
Mark as Closed
──────────────
Reevaluate all signals
```

- Export items call `exportCaseReport(caseId, "json"|"csv")` → triggers file download
- Status items call `patchCase(caseId, { status })` → updates top bar status label
- Reevaluate calls `reevaluateFindings(caseId)` → POST, then refreshes Triage panel

---

## Section 6 — Small Wiring Fixes

These are single-function wiring tasks, no design decisions needed:

| Item | What to do |
|---|---|
| DocumentTablePanel "Process" button | Wire to `processPendingOcr(caseId)`, show count of processed docs |
| TransformsPanel retry button | Wire to re-POST the original job's query params to its endpoint |
| TransformsPanel result detail | Expand inline to show `job.result` JSON formatted nicely |
| Layout button (top bar) | Wire to a `DropdownMenu` with 3 presets: Default, Focus (graph only, dock collapsed), Research (research pane open, graph small) |

---

## Files to Create

| File | Purpose |
|---|---|
| `frontend/src/components/workspace/ResearchPane.tsx` | New center-canvas pane |
| `frontend/src/components/workspace/ResearchPane.module.css` | Styles |

## Files to Modify

| File | Change |
|---|---|
| `frontend/src/layouts/CaseWorkspace.tsx` | Add Research to ViewToggle type + top bar + canvas render; add selectedFinding state; wire More + Layout menus |
| `frontend/src/components/workspace/RightDetailPanel.tsx` | Add Notes tab + AI section in Actions tab |
| `frontend/src/components/workspace/DocumentTablePanel.tsx` | Wire Process button |
| `frontend/src/components/workspace/TransformsPanel.tsx` | Wire retry + result detail |
| `frontend/src/api.ts` | Add `patchCase()` |
| `backend/investigations/views.py` | Add `api_case_detail_patch` view |
| `backend/investigations/urls.py` | Add PATCH to case detail URL |

## Files NOT touched

Everything in `frontend/src/components/ui/` — the primitives (DropdownMenu, Tabs, Dialog, etc.) are already built and used as-is.

---

## Build Sequence

1. Backend: add PATCH /api/cases/<pk>/ + add patchCase() to api.ts
2. ResearchPane: build full component with all 6 connector tabs
3. Wire Research into CaseWorkspace (ViewToggle + CaseCenterCanvas)
4. Notes tab: add to RightDetailPanel, lift selectedFinding state to workspace
5. AI section: add to RightDetailPanel Actions tab
6. More menu: wire MoreVerticalIcon → DropdownMenu
7. Layout menu: wire LayoutPanelLeftIcon → DropdownMenu with 3 presets
8. Small fixes: DocumentTablePanel, TransformsPanel

---

## Success Criteria

- Investigator can run an IRS name search, see results, click a result to view details, and add an org to the case — all without leaving the workspace
- Notes can be added to any entity, finding, or case-level
- AI pattern analysis can be triggered and results appear in the right panel
- Case status can be updated from the More menu
- All top-bar buttons do something (no dead clicks)
- No backend endpoints are left unwired from the frontend
