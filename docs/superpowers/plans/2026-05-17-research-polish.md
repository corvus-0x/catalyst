# Research + Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five targeted improvements: IRS "Create Organization" action, Parcel disabled banner, SOS deceased signatory flag, KPI stats bar on Web view, and ✓ Added badge persistence across tab switches.

**Architecture:** One new backend endpoint (`/persons/deceased/`). All other changes are frontend-only, spread across `ResearchTab.tsx` (Features A, B, C, E) and `InvestigateTab.tsx` (Feature D). Feature E lifts local state to `ResearchTab` level; Feature D reads from already-loaded `dashboard` state.

**Tech Stack:** Django 4.2, React 18, TypeScript, Vite, lucide-react

---

## File Map

| File | Change |
|------|--------|
| `backend/investigations/views.py` | Add `api_case_persons_deceased` view |
| `backend/investigations/urls.py` | Add URL pattern |
| `frontend/src/types/index.ts` | Add `DeceasedPerson` interface |
| `frontend/src/api/cases.ts` | Add `getDeceasedPersons(caseId)` |
| `frontend/src/views/ResearchTab.tsx` | Features A, B, C (SOS badge), E (state lift) |
| `frontend/src/views/InvestigateTab.tsx` | Feature D (Web stats bar) |

---

## Task 1: Backend — `/persons/deceased/` endpoint

**Files:**
- Modify: `backend/investigations/views.py`
- Modify: `backend/investigations/urls.py`

- [ ] **Add import for `PersonRole` if not already present.** Find the existing model imports at the top of `views.py`. Confirm `Person` and `PersonRole` are both imported. They are already there — no change needed if present.

- [ ] **Add the view after `api_case_investigation_steps`. Find that function's closing `return JsonResponse(...)` and add immediately after:**

```python
@require_http_methods(["GET"])
def api_case_persons_deceased(request, pk):
    """Return persons in this case who are deceased (have date_of_death or DECEASED role tag)."""
    case = get_object_or_404(Case, pk=pk)
    persons = Person.objects.filter(case=case).order_by("full_name")
    results = []
    for p in persons:
        if p.date_of_death is not None or "DECEASED" in (p.role_tags or []):
            results.append({
                "full_name": p.full_name,
                "date_of_death": p.date_of_death.isoformat() if p.date_of_death else None,
            })
    return JsonResponse({"results": results})
```

- [ ] **Add URL pattern in `urls.py`. Find `investigation-steps/` pattern and add after it:**

```python
    path(
        "api/cases/<uuid:pk>/persons/deceased/",
        views.api_case_persons_deceased,
        name="api_case_persons_deceased",
    ),
```

- [ ] **Run ruff:**

```bash
cd C:\Users\tjcol\Catalyst\backend && ruff check investigations/views.py investigations/urls.py
```

Expected: no output.

- [ ] **Commit:**

```bash
git add backend/investigations/views.py backend/investigations/urls.py
git commit -m "feat(research): add GET /persons/deceased/ endpoint for SOS signatory flag"
```

---

## Task 2: Frontend types + API function

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/api/cases.ts`

- [ ] **In `types/index.ts`, find the `InvestigationStepsResponse` interface (near the end of Section 7). After it, add:**

```typescript
/** Minimal deceased person record for SOS signatory flag check */
export interface DeceasedPerson {
  full_name: string;
  date_of_death: string | null;
}

export interface DeceasedPersonsResponse {
  results: DeceasedPerson[];
}
```

- [ ] **In `cases.ts`, add to the import block from `"../types"`:**

```typescript
  DeceasedPerson,
  DeceasedPersonsResponse,
```

- [ ] **At the end of `cases.ts`, add the API function:**

```typescript
// ---------------------------------------------------------------------------
// Deceased persons (SOS signatory flag)
// ---------------------------------------------------------------------------

/** Returns persons in the case with date_of_death set or DECEASED role tag. */
export async function getDeceasedPersons(
  caseId: string
): Promise<DeceasedPersonsResponse> {
  return fetchApi<DeceasedPersonsResponse>(
    `/api/cases/${caseId}/persons/deceased/`
  );
}
```

- [ ] **Add to barrel export in `frontend/src/api/index.ts`:**

```typescript
export { getDeceasedPersons } from "./cases";
```

- [ ] **TypeScript check:**

```bash
cd C:\Users\tjcol\Catalyst\frontend && npx tsc --noEmit 2>&1 | grep -E "types/index|cases.ts|error TS"
```

Expected: no errors.

- [ ] **Commit:**

```bash
git add frontend/src/types/index.ts frontend/src/api/cases.ts frontend/src/api/index.ts
git commit -m "feat(research): add DeceasedPerson type and getDeceasedPersons API function"
```

---

## Task 3: ResearchTab — Feature E (✓ Added badge persistence)

**Files:**
- Modify: `frontend/src/views/ResearchTab.tsx`

This task lifts the `done` sets from inside table sub-components up to `ResearchTab` so they survive tab switches. Read the file first to understand the current structure.

- [ ] **In `ResearchTab` main component state block (around line 372 where `source` state is declared), add:**

```tsx
  // Persistence of ✓ Added state across tab switches (Feature E)
  const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set());

  function markAdded(key: string) {
    setAddedKeys((prev) => new Set(prev).add(key));
  }
```

- [ ] **Update `IrsResultsTable` to accept and use the lifted state. Find `interface IrsResultsTableProps` and add two fields:**

```tsx
interface IrsResultsTableProps {
  results: IrsFilingResult[];
  caseId: string;
  addedKeys: Set<string>;
  onAdded: (key: string) => void;
}
```

- [ ] **Update `IrsResultsTable` function signature and remove the local `done` state. Find:**

```tsx
function IrsResultsTable({ results, caseId }: IrsResultsTableProps) {
  const [done, setDone] = useState<Set<string>>(new Set());

  function rowKey(r: IrsFilingResult) {
    return `${r.ein}_${r.tax_year}`;
  }
```

Replace with:

```tsx
function IrsResultsTable({ results, caseId, addedKeys, onAdded }: IrsResultsTableProps) {
  function rowKey(r: IrsFilingResult) {
    return `${r.ein}_${r.tax_year}`;
  }
```

- [ ] **Update the two action handlers in `IrsResultsTable` to use `onAdded` instead of local `setDone`:**

```tsx
  async function handleFetch990s(r: IrsFilingResult) {
    await fetch990s(caseId, { ein: r.ein });
    onAdded(rowKey(r));
  }

  async function handleSaveNote(r: IrsFilingResult) {
    await createNote(caseId, {
      target_type: "case",
      target_id: caseId,
      content: `IRS: ${r.taxpayer_name} EIN:${r.ein} ${r.tax_year}`,
    });
    onAdded(rowKey(r));
  }
```

- [ ] **Update `isDone` check in the IRS table `results.map(...)`. Change:**

```tsx
            const isDone = done.has(key);
```

To:

```tsx
            const isDone = addedKeys.has(key);
```

- [ ] **Update `SyncResultsTable` the same way. Find `interface SyncResultsTableProps` and add:**

```tsx
interface SyncResultsTableProps {
  results: Record<string, unknown>[];
  caseId: string;
  columns: string[];
  source: string;           // used to namespace keys
  addedKeys: Set<string>;
  onAdded: (key: string) => void;
}
```

- [ ] **Update `SyncResultsTable` function to remove local state and use lifted state:**

```tsx
function SyncResultsTable({ results, caseId, columns, source, addedKeys, onAdded }: SyncResultsTableProps) {
  async function handleCreateOrg(r: Record<string, unknown>, idx: number) {
    await addResearchToCase(caseId, {
      result_type: "organization",
      data: r,
    });
    onAdded(`${source}_${idx}`);
  }

  async function handleSaveNote(r: Record<string, unknown>, idx: number) {
    const label = String(r.name ?? r.entity_name ?? r.organization_name ?? `Result ${idx + 1}`);
    await createNote(caseId, {
      target_type: "case",
      target_id: caseId,
      content: `Research result: ${label} — ${JSON.stringify(r).slice(0, 200)}`,
    });
    onAdded(`${source}_${idx}`);
  }
```

- [ ] **Update `isDone` check in `SyncResultsTable`:**

Change `const isDone = done.has(idx);` to `const isDone = addedKeys.has(`${source}_${idx}`);`

- [ ] **Find every call site of `IrsResultsTable` in the JSX of `ResearchTab` and add the new props:**

```tsx
<IrsResultsTable
  results={...}
  caseId={caseId}
  addedKeys={addedKeys}
  onAdded={markAdded}
/>
```

- [ ] **Find every call site of `SyncResultsTable` (for SOS and AOS) and add new props. For SOS:**

```tsx
<SyncResultsTable
  results={...}
  caseId={caseId}
  columns={...}
  source="sos"
  addedKeys={addedKeys}
  onAdded={markAdded}
/>
```

For AOS:

```tsx
<SyncResultsTable
  results={...}
  caseId={caseId}
  columns={...}
  source="aos"
  addedKeys={addedKeys}
  onAdded={markAdded}
/>
```

- [ ] **TypeScript check:**

```bash
cd C:\Users\tjcol\Catalyst\frontend && npx tsc --noEmit 2>&1 | grep "ResearchTab"
```

Expected: no errors.

- [ ] **Commit:**

```bash
git add frontend/src/views/ResearchTab.tsx
git commit -m "feat(research): lift added-keys state to ResearchTab for persistence across tab switches"
```

---

## Task 4: ResearchTab — Feature A (IRS → "Create Organization knot")

**Files:**
- Modify: `frontend/src/views/ResearchTab.tsx`

- [ ] **Find the IRS results table popover content. It currently has two `<button>` elements: "Fetch 990s → Financials" and "Save as note". Add a third button between them:**

```tsx
                          <button
                            type="button"
                            className="add-option"
                            onClick={async () => {
                              await addResearchToCase(caseId, {
                                result_type: "organization",
                                data: r as Record<string, unknown>,
                              });
                              onAdded(rowKey(r));
                            }}
                          >
                            Create Organization knot
                            <span className="add-option__sub">
                              Add as a knot in the Web
                            </span>
                          </button>
```

- [ ] **TypeScript check:**

```bash
cd C:\Users\tjcol\Catalyst\frontend && npx tsc --noEmit 2>&1 | grep "ResearchTab"
```

Expected: no errors.

- [ ] **Commit:**

```bash
git add frontend/src/views/ResearchTab.tsx
git commit -m "feat(research): add 'Create Organization knot' action to IRS search results"
```

---

## Task 5: ResearchTab — Feature B (Parcel disabled state)

**Files:**
- Modify: `frontend/src/views/ResearchTab.tsx`

- [ ] **Find where the parcel panel renders.** Search for `source === "parcel"` or the parcel search form render. It will be inside the main ResearchTab JSX, likely a conditional block.

- [ ] **Replace the entire parcel panel content with a disabled state banner. Keep the `parcelJob` hook initialization (it must remain at the top-level to avoid React hook order violations), but replace the rendered output:**

Find the JSX block that renders when `source === "parcel"` and replace it with:

```tsx
        {source === "parcel" && (
          <div className="research-panel">
            <div style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              padding: "48px 32px",
              textAlign: "center",
            }}>
              <AlertTriangle size={32} style={{ color: "var(--color-high, #BA7517)" }} />
              <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
                County Parcel Search — Currently Unavailable
              </p>
              <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0, maxWidth: 380, lineHeight: 1.5 }}>
                The ODNR ArcGIS parcel API is returning errors from Railway.
                Use County Recorder to search property records and deeds directly.
              </p>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSource("recorder")}
              >
                Switch to County Recorder
              </button>
            </div>
          </div>
        )}
```

- [ ] **Verify `AlertTriangle` is already imported** (it is — check the imports at the top of ResearchTab.tsx). If not, add it to the lucide-react import line.

- [ ] **TypeScript check:**

```bash
cd C:\Users\tjcol\Catalyst\frontend && npx tsc --noEmit 2>&1 | grep "ResearchTab"
```

Expected: no errors.

- [ ] **Commit:**

```bash
git add frontend/src/views/ResearchTab.tsx
git commit -m "feat(research): replace broken parcel search form with unavailable banner"
```

---

## Task 6: ResearchTab — Feature C (SOS deceased signatory flag)

**Files:**
- Modify: `frontend/src/views/ResearchTab.tsx`

- [ ] **Add `getDeceasedPersons` to the import from `"../api"`:**

Find the line `import { ... } from "../api";` at the top of ResearchTab.tsx and add `getDeceasedPersons` to it.

- [ ] **Add `DeceasedPerson` to the type imports:**

Find the type import from `"../types"` and add `DeceasedPerson`.

- [ ] **Add deceased persons state to `ResearchTab` component body (after the `addedKeys` state):**

```tsx
  // Deceased persons cache for SOS signatory flag (Feature C)
  const [deceasedNames, setDeceasedNames] = useState<Set<string>>(new Set());

  useEffect(() => {
    getDeceasedPersons(caseId)
      .then((res) => {
        const names = new Set(
          res.results.map((p: DeceasedPerson) => p.full_name.toLowerCase().trim())
        );
        setDeceasedNames(names);
      })
      .catch(() => {
        // Non-critical — SOS flag will simply not show if this fails
      });
  }, [caseId]);
```

- [ ] **Update `SyncResultsTable` to accept an optional `deceasedNames` prop and render the flag. Add to `SyncResultsTableProps`:**

```tsx
  /** Set of lowercased deceased person names — used only for SOS results */
  deceasedNames?: Set<string>;
```

- [ ] **Add a helper function inside `SyncResultsTable` to detect deceased signatory in a result row:**

```tsx
  function hasDeceasedSignatory(row: Record<string, unknown>): boolean {
    if (!deceasedNames || deceasedNames.size === 0) return false;
    const allValues = Object.values(row)
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.toLowerCase());
    return allValues.some((val) =>
      [...deceasedNames].some((name) => val.includes(name))
    );
  }
```

- [ ] **In `SyncResultsTable`'s JSX, add the deceased signatory badge above the `<tr>` columns (inside `results.map((r, idx) => ...)`, before the `return <tr key={idx}>` line). Replace the map body with:**

```tsx
          {results.map((r, idx) => {
            const isDone = addedKeys.has(`${source}_${idx}`);
            const isDeceased = hasDeceasedSignatory(r);
            return (
              <Fragment key={idx}>
                {isDeceased && (
                  <tr>
                    <td
                      colSpan={columns.length + 1}
                      style={{
                        background: "rgba(186,117,23,0.12)",
                        color: "var(--color-high, #BA7517)",
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "4px 10px",
                      }}
                    >
                      ⚠️ DECEASED SIGNATORY — name matches a deceased person in this case
                    </td>
                  </tr>
                )}
                <tr>
                  {columns.map((col) => (
                    <td key={col}>{String(r[col] ?? "—")}</td>
                  ))}
                  <td style={{ width: 40, textAlign: "center" }}>
                    {/* ... existing add button / done check ... */}
                  </td>
                </tr>
              </Fragment>
            );
          })}
```

**Important:** The `{/* ... existing add button / done check ... */}` placeholder above means you must copy the existing add-button JSX (the `isDone ? <span>...` / `<Popover.Root>...` block) exactly as it appears in the current file. Do not leave a placeholder — paste the actual button JSX.

- [ ] **Add `Fragment` to the React import if not already present.** Check the top of ResearchTab.tsx. If the React import is `import { useEffect, useState } from "react"`, add `Fragment`:

```tsx
import { Fragment, useEffect, useState } from "react";
```

- [ ] **Pass `deceasedNames` to the SOS `SyncResultsTable` call site only (not AOS or Recorder):**

```tsx
<SyncResultsTable
  results={...}
  caseId={caseId}
  columns={...}
  source="sos"
  addedKeys={addedKeys}
  onAdded={markAdded}
  deceasedNames={deceasedNames}
/>
```

The AOS call site does NOT get `deceasedNames` — leave it as-is.

- [ ] **TypeScript check:**

```bash
cd C:\Users\tjcol\Catalyst\frontend && npx tsc --noEmit 2>&1 | grep "ResearchTab"
```

Expected: no errors.

- [ ] **Build check:**

```bash
cd C:\Users\tjcol\Catalyst\frontend && npm run build 2>&1 | tail -5
```

Expected: `✓ built in Xs`

- [ ] **Commit:**

```bash
git add frontend/src/views/ResearchTab.tsx
git commit -m "feat(research): SOS deceased signatory flag — amber banner on matching result rows"
```

---

## Task 7: InvestigateTab — Feature D (Web KPI stats bar)

**Files:**
- Modify: `frontend/src/views/InvestigateTab.tsx`

The `dashboard` state is already loaded in InvestigateTab. It has `dashboard.findings.total`, `dashboard.documents.total`, `dashboard.entities.total`, and `dashboard.case.created_at` for days-open calculation.

- [ ] **Add a `WebStatsBar` sub-component before the `WebToolbar` component definition:**

```tsx
/* ─── WebStatsBar ─────────────────────────────────────────────────────────────── */

interface WebStatsBarProps {
  findings: number | null;
  documents: number | null;
  entities: number | null;
  daysOpen: number | null;
}

function WebStatsBar({ findings, documents, entities, daysOpen }: WebStatsBarProps) {
  const fmt = (n: number | null) => (n === null ? "—" : String(n));
  return (
    <div className="web-stats-bar">
      <span className="web-stats-chip">
        <span className="web-stats-chip__value">{fmt(findings)}</span>
        <span className="web-stats-chip__label">Angles</span>
      </span>
      <span className="web-stats-chip">
        <span className="web-stats-chip__value">{fmt(documents)}</span>
        <span className="web-stats-chip__label">Documents</span>
      </span>
      <span className="web-stats-chip">
        <span className="web-stats-chip__value">{fmt(entities)}</span>
        <span className="web-stats-chip__label">Entities</span>
      </span>
      <span className="web-stats-chip">
        <span className="web-stats-chip__value">{fmt(daysOpen)}</span>
        <span className="web-stats-chip__label">Days open</span>
      </span>
    </div>
  );
}
```

- [ ] **Add CSS classes to `frontend/src/index.css`. Find the `.inv-modal__actions` block and add after it:**

```css
/* ── Web KPI stats bar ─────────────────────────────────── */
.web-stats-bar {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 0 16px;
  height: 36px;
  border-bottom: 1px solid var(--border-1);
  flex-shrink: 0;
  background: var(--bg-0);
}
.web-stats-chip {
  display: flex;
  align-items: baseline;
  gap: 4px;
  padding: 0 14px;
  border-right: 1px solid var(--border-1);
}
.web-stats-chip:last-child { border-right: none; }
.web-stats-chip__value {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-1);
}
.web-stats-chip__label {
  font-size: 10px;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
```

- [ ] **Add a computed `daysOpen` value in the InvestigateTab component body, after the `isEmpty` constant:**

```tsx
  const daysOpen = dashboard?.case.created_at
    ? Math.floor(
        (Date.now() - new Date(dashboard.case.created_at).getTime()) / 86_400_000
      )
    : null;
```

- [ ] **Find the main return block. After the `<Breadcrumb>` component and before the `{/* Main row: toolbar + canvas + panels */}` div, add the stats bar (only when `current.kind === "web"`):**

```tsx
      {/* KPI stats bar — Web Level 1 only */}
      {current.kind === "web" && (
        <WebStatsBar
          findings={dashboard?.findings.total ?? null}
          documents={dashboard?.documents.total ?? null}
          entities={dashboard?.entities.total ?? null}
          daysOpen={daysOpen}
        />
      )}
```

- [ ] **TypeScript check:**

```bash
cd C:\Users\tjcol\Catalyst\frontend && npx tsc --noEmit 2>&1 | grep "InvestigateTab"
```

Expected: no errors.

- [ ] **Build check:**

```bash
cd C:\Users\tjcol\Catalyst\frontend && npm run build 2>&1 | tail -5
```

Expected: `✓ built in Xs`

- [ ] **Commit:**

```bash
git add frontend/src/views/InvestigateTab.tsx frontend/src/index.css
git commit -m "feat(investigate): add KPI stats bar on Web Level 1 view

Shows Angles / Documents / Entities / Days open using already-loaded
dashboard data. Visible only on the Web (Level 1) canvas view."
```

---

## Self-Review

**Spec coverage:**
- ✅ Feature A: IRS "Create Organization knot" popover action — Task 4
- ✅ Feature B: Parcel disabled state with "Switch to Recorder" CTA — Task 5
- ✅ Feature C: Backend endpoint + frontend deceased name check + SOS badge — Tasks 1, 2, 6
- ✅ Feature D: WebStatsBar with 4 KPI chips from dashboard state — Task 7
- ✅ Feature E: `addedKeys` state lifted to ResearchTab, passed as props — Task 3

**Placeholder scan:**
- Task 6 Step about "copy existing add-button JSX" is marked with a note (not a TBD) — the implementer must read the actual file. This is intentional: the button JSX is ~20 lines and varies by the current file state; copying it verbatim is the correct instruction.

**Type consistency:**
- `DeceasedPerson` defined Task 2, used Task 6 ✅
- `DeceasedPersonsResponse` defined Task 2, used in `getDeceasedPersons` return type ✅
- `addedKeys: Set<string>` + `onAdded: (key: string) => void` defined Task 3, used in Tasks 4 and 6 ✅
- `source: string` prop added to `SyncResultsTableProps` Task 3, used for key namespacing Tasks 3+6 ✅
- `WebStatsBar` component defined Task 7, used Task 7 ✅
- `daysOpen` computed Task 7, passed to `WebStatsBar` Task 7 ✅

**Edge cases:**
- `getDeceasedPersons` failure is silently caught in Task 6 — SOS badge simply won't appear, no crash ✅
- `deceasedNames` empty Set means `hasDeceasedSignatory` returns false immediately ✅
- `dashboard` null before load — `daysOpen` returns null, `WebStatsBar` shows "—" ✅
- Parcel `parcelJob` hook still initialized but unused visually — no hook order violation ✅
