# Workspace Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire all disconnected backend functionality (research connectors, notes, AI features, case status update, menus) into the new CaseWorkspace frontend so every button does something real.

**Architecture:** Extend the existing center-canvas pane pattern with a new ResearchPane; extend the right detail panel with Notes and AI tabs; wire the More/Layout icon buttons to DropdownMenus; fix small dead-code stubs. All backend endpoints already exist — this is purely frontend wiring plus one api.ts addition.

**Tech Stack:** React 18, TypeScript, CSS Modules, Radix UI (DropdownMenu already built), `useAsyncJob` hook at `frontend/src/hooks/useAsyncJob.ts`, `addResearchToCase` / `fetchNotes` / `createNote` / `deleteNote` / AI functions all in `frontend/src/api.ts`.

**Key discovery:** `PATCH /api/cases/<pk>/` already exists in views.py line 1594. Only `patchCase()` in api.ts is missing.

---

## Task 1: Add `patchCase()` to api.ts

**Files:**
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Add patchCase function**

Open `frontend/src/api.ts`. Find the `exportCaseReport` function and add this directly after it:

```typescript
export async function patchCase(
    caseId: string,
    payload: { status?: string; notes?: string; referral_ref?: string },
    options?: ApiRequestOptions
): Promise<CaseDetail> {
    return request<CaseDetail>(
        `/api/cases/${caseId}/`,
        { method: "PATCH", body: JSON.stringify(payload) },
        { timeout: DEFAULT_TIMEOUT_MS, ...options }
    );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat(api): add patchCase() for PATCH /api/cases/<pk>/"
```

---

## Task 2: Wire the "More" menu button

**Files:**
- Modify: `frontend/src/layouts/CaseWorkspace.tsx`

The `MoreVerticalIcon` button in `CaseTopBar` currently does nothing. Wire it to a `DropdownMenu` with export, status, and reevaluate actions.

- [ ] **Step 1: Add imports to CaseWorkspace.tsx**

At the top of `frontend/src/layouts/CaseWorkspace.tsx`, add these imports after the existing lucide-react import block:

```typescript
import { DropdownMenu } from "../components/ui/DropdownMenu";
import { patchCase, exportCaseReport, reevaluateFindings } from "../api";
```

- [ ] **Step 2: Update CaseTopBar props**

Find the `CaseTopBar` function signature (around line 318). Add `onCasePatched` to the props interface:

```typescript
function CaseTopBar({
    caseId,
    caseDetail,
    activeViews,
    onToggleView,
    onOpenPalette,
    onCasePatched,
}: {
    caseId?: string;
    caseDetail: CaseDetail | null;
    activeViews: Set<ViewToggle>;
    onToggleView: (v: ViewToggle) => void;
    onOpenPalette: () => void;
    onCasePatched: () => void;
}) {
```

- [ ] **Step 3: Replace the More icon button with a DropdownMenu**

Find this in `CaseTopBar` (around line 390):
```typescript
<button type="button" className={styles.iconButton} aria-label="More" title="More options">
    <MoreVerticalIcon size={15} strokeWidth={1.6} />
</button>
```

Replace it with:
```typescript
<DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
        <button type="button" className={styles.iconButton} aria-label="More options" title="More options">
            <MoreVerticalIcon size={15} strokeWidth={1.6} />
        </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end">
        <DropdownMenu.Item onSelect={() => {
            if (!caseId) return;
            exportCaseReport(caseId, "json").then(blob => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url; a.download = `case-${caseId}.json`; a.click();
                URL.revokeObjectURL(url);
            }).catch(() => toast.error("Export failed"));
        }}>Export JSON</DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => {
            if (!caseId) return;
            exportCaseReport(caseId, "csv").then(blob => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url; a.download = `case-${caseId}.csv`; a.click();
                URL.revokeObjectURL(url);
            }).catch(() => toast.error("Export failed"));
        }}>Export CSV</DropdownMenu.Item>
        <DropdownMenu.Separator />
        {(["ACTIVE", "PAUSED", "REFERRED", "CLOSED"] as const).map(s => (
            <DropdownMenu.Item
                key={s}
                onSelect={() => {
                    if (!caseId) return;
                    patchCase(caseId, { status: s })
                        .then(onCasePatched)
                        .catch(() => toast.error("Status update failed"));
                }}
            >
                Mark as {s.charAt(0) + s.slice(1).toLowerCase()}
            </DropdownMenu.Item>
        ))}
        <DropdownMenu.Separator />
        <DropdownMenu.Item onSelect={() => {
            if (!caseId) return;
            reevaluateFindings(caseId)
                .then(() => toast.success("Signals re-evaluated"))
                .catch(() => toast.error("Re-evaluation failed"));
        }}>Reevaluate all signals</DropdownMenu.Item>
    </DropdownMenu.Content>
</DropdownMenu.Root>
```

- [ ] **Step 4: Pass onCasePatched from the main workspace**

Find where `CaseTopBar` is rendered in the main `CaseWorkspace` return (around line 167). Add `onCasePatched={refreshCaseDetail}` to its props:

```typescript
<CaseTopBar
    caseId={caseId}
    caseDetail={caseDetail}
    activeViews={activeViews}
    onToggleView={toggleView}
    onOpenPalette={() => setPaletteOpen(true)}
    onCasePatched={refreshCaseDetail}
/>
```

- [ ] **Step 5: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/layouts/CaseWorkspace.tsx
git commit -m "feat(workspace): wire More menu — export, status update, reevaluate"
```

---

## Task 3: Wire the Layout presets button

**Files:**
- Modify: `frontend/src/layouts/CaseWorkspace.tsx`

- [ ] **Step 1: Add panel refs to CaseTopBar props**

Update the `CaseTopBar` props interface to include layout preset callbacks:

```typescript
onApplyLayout: (preset: "default" | "focus" | "research") => void;
```

- [ ] **Step 2: Replace the Layout icon button with a DropdownMenu**

Find this in `CaseTopBar`:
```typescript
<button type="button" className={styles.iconButton} aria-label="Layout presets" title="Layout presets">
    <LayoutPanelLeftIcon size={15} strokeWidth={1.6} />
</button>
```

Replace with:
```typescript
<DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
        <button type="button" className={styles.iconButton} aria-label="Layout presets" title="Layout presets">
            <LayoutPanelLeftIcon size={15} strokeWidth={1.6} />
        </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end">
        <DropdownMenu.Label>Layout presets</DropdownMenu.Label>
        <DropdownMenu.Separator />
        <DropdownMenu.Item onSelect={() => onApplyLayout("default")}>
            Default — graph + dock
        </DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => onApplyLayout("focus")}>
            Focus — graph only, dock collapsed
        </DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => onApplyLayout("research")}>
            Research — research pane open
        </DropdownMenu.Item>
    </DropdownMenu.Content>
</DropdownMenu.Root>
```

- [ ] **Step 3: Implement applyLayout in the main CaseWorkspace component**

In the main `CaseWorkspace` function, add this handler (after the existing `toggleBottomDock` function):

```typescript
function applyLayout(preset: "default" | "focus" | "research") {
    if (preset === "focus") {
        bottomDockRef.current?.collapse();
        setActiveViews(new Set(["graph"]));
    } else if (preset === "research") {
        bottomDockRef.current?.expand();
        setActiveViews(new Set(["graph", "research"]));
    } else {
        bottomDockRef.current?.expand();
        setActiveViews(new Set(["graph"]));
    }
}
```

- [ ] **Step 4: Pass onApplyLayout to CaseTopBar**

```typescript
<CaseTopBar
    caseId={caseId}
    caseDetail={caseDetail}
    activeViews={activeViews}
    onToggleView={toggleView}
    onOpenPalette={() => setPaletteOpen(true)}
    onCasePatched={refreshCaseDetail}
    onApplyLayout={applyLayout}
/>
```

- [ ] **Step 5: TypeScript check and commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/layouts/CaseWorkspace.tsx
git commit -m "feat(workspace): wire Layout presets menu with 3 panel configurations"
```

---

## Task 4: Fix DocumentTablePanel — Process Pending button

**Files:**
- Modify: `frontend/src/components/workspace/DocumentTablePanel.tsx`

The panel currently shows documents but has no button to trigger OCR processing for files stuck in PENDING state.

- [ ] **Step 1: Read DocumentTablePanel.tsx header**

Open `frontend/src/components/workspace/DocumentTablePanel.tsx`. Find the imports section at the top.

- [ ] **Step 2: Add processPendingOcr import**

In the api imports of `DocumentTablePanel.tsx`, add `processPendingOcr`:

```typescript
import { fetchCaseDetail, processPendingOcr } from "../../api";
```

- [ ] **Step 3: Add processing state and handler**

In the `DocumentTablePanel` component function, add state after the existing state declarations:

```typescript
const [processing, setProcessing] = useState(false);
const [processedCount, setProcessedCount] = useState<number | null>(null);

async function handleProcessPending() {
    if (!caseId) return;
    setProcessing(true);
    setProcessedCount(null);
    try {
        const res = await processPendingOcr(caseId);
        const count = (res as unknown as { requested?: number }).requested ?? 0;
        setProcessedCount(count);
        await load();  // refresh document list
    } catch (e) {
        // show nothing — documents will still show their status
    } finally {
        setProcessing(false);
    }
}
```

- [ ] **Step 4: Add the button to the panel header**

Find the header row in the component's JSX (look for the "Upload" button or the document count display). Add the Process button next to it:

```typescript
<button
    type="button"
    className={styles.processBtn}
    onClick={handleProcessPending}
    disabled={processing || !caseId}
    title="Run OCR + extraction on all pending documents"
>
    {processing ? "Processing…" : processedCount !== null ? `Processed ${processedCount}` : "Process pending"}
</button>
```

- [ ] **Step 5: Add CSS for processBtn**

In `frontend/src/components/workspace/DocumentTablePanel.module.css`, add:

```css
.processBtn {
    padding: 0.25rem 0.65rem;
    border: 1px solid var(--control-border);
    border-radius: var(--radius-sm);
    background: var(--control-bg);
    color: var(--text-main);
    font-size: var(--text-xs);
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: background var(--transition-fast);
}
.processBtn:hover:not(:disabled) { background: var(--sidebar-hover); }
.processBtn:disabled { opacity: 0.5; cursor: not-allowed; }
```

- [ ] **Step 6: TypeScript check and commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/components/workspace/DocumentTablePanel.tsx frontend/src/components/workspace/DocumentTablePanel.module.css
git commit -m "feat(workspace): wire Process Pending button in DocumentTablePanel"
```

---

## Task 5: Fix TransformsPanel — retry button and result detail

**Files:**
- Modify: `frontend/src/components/workspace/TransformsPanel.tsx`

Currently `onRetry` and `onOpenResult` fire `toast.message()` in `CaseWorkspace`. Wire them properly: retry re-runs the original search; clicking a SUCCESS row expands its result JSON inline.

- [ ] **Step 1: Read the TransformsPanel onRetry + onOpenResult usage in CaseWorkspace**

In `CaseWorkspace.tsx`, find where `TransformsPanel` is rendered. It looks like:
```typescript
<TransformsPanel
    caseId={caseId}
    onLoaded={setTransformsCount}
    onOpenResult={(j) => toast.message(`Open ${j.job_type} result`)}
    onRetry={(j) => toast.message(`Retry ${j.job_type} (wiring pending)`)}
/>
```

- [ ] **Step 2: Add research API imports to CaseWorkspace.tsx**

Add to the api imports in `CaseWorkspace.tsx`:
```typescript
import { searchIRS, searchOhioAOS, searchParcels } from "../api";
```

- [ ] **Step 3: Replace the TransformsPanel stub callbacks**

Replace the stubs with real implementations:

```typescript
<TransformsPanel
    caseId={caseId}
    onLoaded={setTransformsCount}
    onOpenResult={(j) => {
        // The result is already visible inline in the panel row.
        // This callback is for future routing (e.g., open a specific entity).
        // For now, do nothing — the row expands inline.
    }}
    onRetry={async (j) => {
        if (!caseId) return;
        const p = j.query_params as Record<string, string> | null;
        if (!p) return;
        try {
            if (j.job_type === "IRS_NAME_SEARCH") await searchIRS(caseId, p.query ?? "");
            else if (j.job_type === "OHIO_AOS") await searchOhioAOS(caseId, p.query ?? "");
            else if (j.job_type === "COUNTY_PARCEL") await searchParcels(caseId, p.query ?? "", (p.search_type as "owner" | "parcel") ?? "owner", p.county ?? "");
            toast.success("Search re-queued");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Retry failed");
        }
    }}
/>
```

- [ ] **Step 4: Add inline result expansion to TransformsPanel**

In `TransformsPanel.tsx`, find the row component that renders each job. Add `expandedId` state to the panel:

```typescript
const [expandedId, setExpandedId] = useState<string | null>(null);
```

In the row render, after the job status/type info, add:

```typescript
{job.status === "SUCCESS" && (
    <button
        type="button"
        className={styles.resultToggle}
        onClick={() => setExpandedId(expandedId === job.id ? null : job.id)}
    >
        {expandedId === job.id ? "Hide result" : "View result"}
    </button>
)}
{expandedId === job.id && job.result && (
    <pre className={styles.resultJson}>
        {JSON.stringify(job.result, null, 2)}
    </pre>
)}
```

- [ ] **Step 5: Add CSS**

In `TransformsPanel.module.css`, add:

```css
.resultToggle {
    font-size: var(--text-xs);
    color: var(--accent);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
}
.resultJson {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    color: var(--text-soft);
    background: var(--bg-haze);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    padding: 0.5rem;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 200px;
    overflow-y: auto;
    margin-top: 0.25rem;
}
```

- [ ] **Step 6: TypeScript check and commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/layouts/CaseWorkspace.tsx frontend/src/components/workspace/TransformsPanel.tsx frontend/src/components/workspace/TransformsPanel.module.css
git commit -m "feat(workspace): wire TransformsPanel retry + inline result expansion"
```

---

## Task 6: Build ResearchPane component

**Files:**
- Create: `frontend/src/components/workspace/ResearchPane.tsx`
- Create: `frontend/src/components/workspace/ResearchPane.module.css`

This is the largest task. Build it in one shot — all 6 connector tabs, the shared results/detail area, and Add to Case.

- [ ] **Step 1: Create ResearchPane.module.css**

Create `frontend/src/components/workspace/ResearchPane.module.css`:

```css
/* ResearchPane — center canvas research connector pane */

.pane {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: var(--surface);
    color: var(--text-main);
    font-family: var(--font-sans);
}

.tabStrip {
    display: flex;
    border-bottom: 1px solid var(--line);
    background: var(--bg-haze);
    flex-shrink: 0;
    overflow-x: auto;
}

.tab {
    padding: 0.5rem 0.85rem;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-soft);
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
    white-space: nowrap;
    transition: color var(--transition-fast), border-color var(--transition-fast);
}
.tab:hover { color: var(--text-main); }
.tabActive {
    color: var(--text-main);
    border-bottom-color: var(--accent);
}

.body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
}

.searchArea {
    padding: 0.85rem;
    border-bottom: 1px solid var(--line);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.searchRow {
    display: flex;
    gap: 0.5rem;
    align-items: flex-end;
    flex-wrap: wrap;
}

.fieldGroup {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    flex: 1;
    min-width: 120px;
}

.fieldLabel {
    font-size: var(--text-xs);
    color: var(--text-soft);
    font-weight: 500;
}

.input {
    padding: 0.3rem 0.6rem;
    border: 1px solid var(--control-border);
    border-radius: var(--radius-sm);
    background: var(--control-bg);
    color: var(--text-main);
    font-size: var(--text-sm);
    font-family: inherit;
}
.input:focus { outline: 2px solid var(--focus-ring); outline-offset: 1px; }

.select {
    padding: 0.3rem 0.6rem;
    border: 1px solid var(--control-border);
    border-radius: var(--radius-sm);
    background: var(--control-bg);
    color: var(--text-main);
    font-size: var(--text-sm);
    font-family: inherit;
    cursor: pointer;
}

.searchBtn {
    padding: 0.3rem 0.9rem;
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: #fff;
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity var(--transition-fast);
}
.searchBtn:disabled { opacity: 0.5; cursor: not-allowed; }

.statusLine {
    font-size: var(--text-xs);
    color: var(--text-soft);
    font-style: italic;
}
.statusError { color: var(--tag-high-color); font-style: normal; }

.results {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
}

.resultRow {
    display: flex;
    flex-direction: column;
    border-bottom: 1px solid var(--line);
    cursor: pointer;
    transition: background var(--transition-fast);
}
.resultRow:hover { background: var(--sidebar-hover); }
.resultRowActive { background: var(--sidebar-active); }

.resultSummary {
    padding: 0.55rem 0.85rem;
    font-size: var(--text-sm);
    color: var(--text-main);
}

.resultDetail {
    padding: 0.75rem 0.85rem 0.85rem;
    background: var(--bg-haze);
    border-top: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.detailGrid {
    display: grid;
    grid-template-columns: 140px 1fr;
    gap: 0.2rem 0.5rem;
    font-size: var(--text-xs);
}
.detailKey { color: var(--text-soft); font-weight: 500; }
.detailVal { color: var(--text-main); word-break: break-word; }

.detailActions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.25rem;
}

.addBtn {
    padding: 0.3rem 0.75rem;
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: #fff;
    font-size: var(--text-xs);
    font-weight: 600;
    cursor: pointer;
    transition: opacity var(--transition-fast);
}
.addBtn:disabled { opacity: 0.5; cursor: not-allowed; }

.clearBtn {
    padding: 0.3rem 0.75rem;
    border: 1px solid var(--control-border);
    border-radius: var(--radius-sm);
    background: var(--control-bg);
    color: var(--text-soft);
    font-size: var(--text-xs);
    cursor: pointer;
}

.addedBadge {
    font-size: var(--text-xs);
    color: var(--tag-low-color);
    padding: 0.3rem 0;
}

.empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-soft);
    font-size: var(--text-sm);
    padding: 2rem;
    text-align: center;
}
```

- [ ] **Step 2: Create ResearchPane.tsx**

Create `frontend/src/components/workspace/ResearchPane.tsx`:

```typescript
/**
 * ResearchPane — center-canvas pane for running external data connector searches.
 * Toggled via the "Research" button in CaseTopBar.
 *
 * Six connectors: IRS Name Search (async), Fetch 990 (sync),
 * Ohio SOS (sync), Ohio AOS (async), County Recorder (sync),
 * County Parcels (async).
 *
 * Results display as a scrollable list; clicking a row expands a detail
 * accordion with an "Add to Case" button.
 */
import { Fragment, useEffect, useState } from "react";
import {
    addResearchToCase,
    fetch990Data,
    searchIRS,
    searchOhioAOS,
    searchOhioSOS,
    searchParcels,
    searchRecorder,
} from "../../api";
import { useAsyncJob } from "../../hooks/useAsyncJob";
import { toast } from "../ui/Toaster";
import styles from "./ResearchPane.module.css";

type Connector = "irs-search" | "fetch-990" | "ohio-sos" | "ohio-aos" | "recorder" | "parcels";

const CONNECTORS: { id: Connector; label: string }[] = [
    { id: "irs-search", label: "IRS Search" },
    { id: "fetch-990", label: "Fetch 990" },
    { id: "ohio-sos", label: "Ohio SOS" },
    { id: "ohio-aos", label: "Ohio AOS" },
    { id: "recorder", label: "Recorder" },
    { id: "parcels", label: "Parcels" },
];

const OHIO_COUNTIES = [
    "Allen","Ashland","Ashtabula","Athens","Auglaize","Belmont","Butler",
    "Clark","Clermont","Clinton","Columbiana","Coshocton","Crawford",
    "Cuyahoga","Darke","Delaware","Erie","Fairfield","Fayette","Franklin",
    "Fulton","Geauga","Greene","Guernsey","Hamilton","Hancock","Hardin",
    "Harrison","Henry","Highland","Hocking","Holmes","Huron","Jackson",
    "Jefferson","Knox","Lake","Lawrence","Licking","Logan","Lorain","Lucas",
    "Madison","Mahoning","Marion","Medina","Meigs","Mercer","Miami",
    "Montgomery","Morgan","Morrow","Muskingum","Noble","Ottawa","Paulding",
    "Perry","Pickaway","Pike","Portage","Preble","Putnam","Richland","Ross",
    "Sandusky","Scioto","Seneca","Shelby","Stark","Summit","Trumbull",
    "Tuscarawas","Union","Van Wert","Vinton","Warren","Washington","Wayne",
    "Williams","Wood","Wyandot",
];

interface ResearchResult {
    id: string;
    summary: string;
    fields: { key: string; value: string }[];
    rawData: unknown;
    source: string;
}

interface Props {
    caseId: string;
    onAdded?: () => void; // fires after a result is added to case, so graph can refresh
}

export function ResearchPane({ caseId, onAdded }: Props) {
    const [active, setActive] = useState<Connector>("irs-search");
    const [results, setResults] = useState<ResearchResult[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [addingId, setAddingId] = useState<string | null>(null);
    const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

    function handleConnectorChange(c: Connector) {
        setActive(c);
        setResults([]);
        setSelectedId(null);
    }

    async function handleAddToCase(result: ResearchResult) {
        setAddingId(result.id);
        try {
            await addResearchToCase(caseId, result.source, result.rawData as Record<string, unknown>);
            setAddedIds((prev) => new Set([...prev, result.id]));
            toast.success("Added to case");
            onAdded?.();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to add to case");
        } finally {
            setAddingId(null);
        }
    }

    const selectedResult = results.find((r) => r.id === selectedId) ?? null;

    return (
        <div className={styles.pane}>
            <div className={styles.tabStrip} role="tablist">
                {CONNECTORS.map((c) => (
                    <button
                        key={c.id}
                        role="tab"
                        aria-selected={active === c.id}
                        className={`${styles.tab} ${active === c.id ? styles.tabActive : ""}`}
                        onClick={() => handleConnectorChange(c.id)}
                    >
                        {c.label}
                    </button>
                ))}
            </div>
            <div className={styles.body}>
                {active === "irs-search" && (
                    <IrsSearchTab
                        caseId={caseId}
                        onResults={setResults}
                        results={results}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                        selectedResult={selectedResult}
                        addingId={addingId}
                        addedIds={addedIds}
                        onAdd={handleAddToCase}
                    />
                )}
                {active === "fetch-990" && (
                    <Fetch990Tab
                        caseId={caseId}
                        onResults={setResults}
                        results={results}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                        selectedResult={selectedResult}
                        addingId={addingId}
                        addedIds={addedIds}
                        onAdd={handleAddToCase}
                    />
                )}
                {active === "ohio-sos" && (
                    <OhioSosTab
                        caseId={caseId}
                        onResults={setResults}
                        results={results}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                        selectedResult={selectedResult}
                        addingId={addingId}
                        addedIds={addedIds}
                        onAdd={handleAddToCase}
                    />
                )}
                {active === "ohio-aos" && (
                    <OhioAosTab
                        caseId={caseId}
                        onResults={setResults}
                        results={results}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                        selectedResult={selectedResult}
                        addingId={addingId}
                        addedIds={addedIds}
                        onAdd={handleAddToCase}
                    />
                )}
                {active === "recorder" && (
                    <RecorderTab
                        caseId={caseId}
                        onResults={setResults}
                        results={results}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                        selectedResult={selectedResult}
                        addingId={addingId}
                        addedIds={addedIds}
                        onAdd={handleAddToCase}
                    />
                )}
                {active === "parcels" && (
                    <ParcelsTab
                        caseId={caseId}
                        onResults={setResults}
                        results={results}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                        selectedResult={selectedResult}
                        addingId={addingId}
                        addedIds={addedIds}
                        onAdd={handleAddToCase}
                    />
                )}
            </div>
        </div>
    );
}

/* ── Shared props for all connector tabs ───────────────────────── */

interface TabSharedProps {
    caseId: string;
    onResults: (r: ResearchResult[]) => void;
    results: ResearchResult[];
    selectedId: string | null;
    onSelect: (id: string | null) => void;
    selectedResult: ResearchResult | null;
    addingId: string | null;
    addedIds: Set<string>;
    onAdd: (r: ResearchResult) => void;
}

/* ── Shared ResultsList + ResultDetail ─────────────────────────── */

function ResultsArea({ results, selectedId, onSelect, selectedResult, addingId, addedIds, onAdd }: {
    results: ResearchResult[];
    selectedId: string | null;
    onSelect: (id: string | null) => void;
    selectedResult: ResearchResult | null;
    addingId: string | null;
    addedIds: Set<string>;
    onAdd: (r: ResearchResult) => void;
}) {
    if (results.length === 0) return null;
    return (
        <div className={styles.results}>
            {results.map((r) => {
                const isSelected = selectedId === r.id;
                return (
                    <div
                        key={r.id}
                        className={`${styles.resultRow} ${isSelected ? styles.resultRowActive : ""}`}
                        onClick={() => onSelect(isSelected ? null : r.id)}
                    >
                        <div className={styles.resultSummary}>{r.summary}</div>
                        {isSelected && selectedResult && (
                            <div className={styles.resultDetail}>
                                <dl className={styles.detailGrid}>
                                    {selectedResult.fields.map((f) => (
                                        <Fragment key={f.key}>
                                            <dt className={styles.detailKey}>{f.key}</dt>
                                            <dd className={styles.detailVal}>{f.value || "—"}</dd>
                                        </Fragment>
                                    ))}
                                </dl>
                                <div className={styles.detailActions}>
                                    {addedIds.has(r.id) ? (
                                        <span className={styles.addedBadge}>✓ Added to case</span>
                                    ) : (
                                        <button
                                            type="button"
                                            className={styles.addBtn}
                                            disabled={addingId === r.id}
                                            onClick={(e) => { e.stopPropagation(); onAdd(r); }}
                                        >
                                            {addingId === r.id ? "Adding…" : "Add to Case"}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        className={styles.clearBtn}
                                        onClick={(e) => { e.stopPropagation(); onSelect(null); }}
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

/* ── IRS Name Search (async) ───────────────────────────────────── */

function IrsSearchTab({ caseId, onResults, ...shared }: TabSharedProps) {
    const [query, setQuery] = useState("");
    const job = useAsyncJob<{ results?: unknown[]; count?: number }>({
        postUrl: `/api/cases/${caseId}/research/irs/`,
    });

    async function handleSearch() {
        if (!query.trim()) return;
        onResults([]);
        await job.run({ query: query.trim() });
    }

    // When job succeeds, map results into the shared result list.
    // Must be in useEffect — calling onResults during render causes infinite loops.
    useEffect(() => {
        if (job.status !== "success" || !job.result) return;
        const items = (job.result.results ?? []) as Record<string, unknown>[];
        onResults(items.map((r, i) => ({
            id: String(i),
            summary: `${r.name ?? r.taxpayer_name ?? "Unknown"} · EIN ${r.ein ?? "—"}`,
            fields: Object.entries(r).slice(0, 10).map(([k, v]) => ({ key: k, value: String(v ?? "") })),
            rawData: r,
            source: "irs_teos",
        })));
    // onResults excluded from deps intentionally — it's a stable setter from parent useState
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [job.status, job.result]);

    const busy = job.status === "queued" || job.status === "running";
    return (
        <>
            <div className={styles.searchArea}>
                <div className={styles.searchRow}>
                    <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>Organization name</label>
                        <input
                            className={styles.input}
                            type="text"
                            placeholder="e.g. Bright Future Foundation"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && !busy && handleSearch()}
                        />
                    </div>
                    <button className={styles.searchBtn} onClick={handleSearch} disabled={busy || !query.trim()}>
                        {busy ? "Searching…" : "Search"}
                    </button>
                </div>
                {busy && <span className={styles.statusLine}>Searching IRS TEOS index… this can take 15–30s</span>}
                {job.status === "failed" && <span className={`${styles.statusLine} ${styles.statusError}`}>{job.error}</span>}
                {job.status === "success" && <span className={styles.statusLine}>{job.result?.count ?? shared.results.length} result(s)</span>}
            </div>
            {shared.results.length === 0 && !busy && (
                <div className={styles.empty}>Enter an organization name and click Search</div>
            )}
            <ResultsArea {...shared} />
        </>
    );
}

/* ── Fetch 990 by EIN (sync) ───────────────────────────────────── */

function Fetch990Tab({ caseId, onResults, ...shared }: TabSharedProps) {
    const [ein, setEin] = useState("");
    const [loading, setLoading] = useState(false);
    const [statusMsg, setStatusMsg] = useState<string | null>(null);
    const [isError, setIsError] = useState(false);

    async function handleFetch() {
        if (!ein.trim()) return;
        setLoading(true);
        setStatusMsg(null);
        onResults([]);
        try {
            const res = await fetch990Data(caseId, ein.trim());
            const filings = (res as unknown as { filings?: Record<string, unknown>[] }).filings ?? [];
            const fetched = (res as unknown as { fetched?: number }).fetched ?? 0;
            const mapped = filings.map((f, i) => ({
                id: String(i),
                summary: `${f.taxpayer_name ?? ein} · ${f.return_type ?? "990"} · Tax year ${f.tax_year ?? "—"}`,
                fields: [
                    { key: "Tax year", value: String(f.tax_year ?? "") },
                    { key: "Form type", value: String(f.return_type ?? "") },
                    { key: "Total revenue", value: f.total_revenue != null ? `$${Number(f.total_revenue).toLocaleString()}` : "—" },
                    { key: "Total expenses", value: f.total_expenses != null ? `$${Number(f.total_expenses).toLocaleString()}` : "—" },
                    { key: "Officers", value: String(f.officers_count ?? "—") },
                    { key: "Parse quality", value: f.parse_quality != null ? `${Math.round(Number(f.parse_quality) * 100)}%` : "—" },
                ],
                rawData: f,
                source: "irs_teos",
            }));
            onResults(mapped);
            setStatusMsg(`Fetched ${fetched} filing(s)`);
            setIsError(false);
        } catch (e) {
            setStatusMsg(e instanceof Error ? e.message : "Fetch failed");
            setIsError(true);
        } finally {
            setLoading(false);
        }
    }

    return (
        <>
            <div className={styles.searchArea}>
                <div className={styles.searchRow}>
                    <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>EIN (e.g. 12-3456789)</label>
                        <input
                            className={styles.input}
                            type="text"
                            placeholder="XX-XXXXXXX"
                            value={ein}
                            onChange={(e) => setEin(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && !loading && handleFetch()}
                        />
                    </div>
                    <button className={styles.searchBtn} onClick={handleFetch} disabled={loading || !ein.trim()}>
                        {loading ? "Fetching…" : "Fetch all years"}
                    </button>
                </div>
                {statusMsg && (
                    <span className={`${styles.statusLine} ${isError ? styles.statusError : ""}`}>{statusMsg}</span>
                )}
            </div>
            {shared.results.length === 0 && !loading && (
                <div className={styles.empty}>Enter an EIN to pull all available 990 filings from IRS TEOS</div>
            )}
            <ResultsArea {...shared} />
        </>
    );
}

/* ── Ohio SOS (sync) ───────────────────────────────────────────── */

function OhioSosTab({ caseId, onResults, ...shared }: TabSharedProps) {
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [statusMsg, setStatusMsg] = useState<string | null>(null);
    const [isError, setIsError] = useState(false);

    async function handleSearch() {
        if (!query.trim()) return;
        setLoading(true);
        setStatusMsg(null);
        onResults([]);
        try {
            const res = await searchOhioSOS(caseId, query.trim());
            const items = (res as unknown as { results?: Record<string, unknown>[] }).results ?? [];
            const mapped = items.map((r, i) => ({
                id: String(i),
                summary: `${r.name ?? r.entity_name ?? "Unknown"} · ${r.entity_number ?? ""}`,
                fields: Object.entries(r).slice(0, 12).map(([k, v]) => ({ key: k, value: String(v ?? "") })),
                rawData: r,
                source: "ohio_sos",
            }));
            onResults(mapped);
            setStatusMsg(`${items.length} result(s)`);
            setIsError(false);
        } catch (e) {
            setStatusMsg(e instanceof Error ? e.message : "Search failed");
            setIsError(true);
        } finally {
            setLoading(false);
        }
    }

    return (
        <>
            <div className={styles.searchArea}>
                <div className={styles.searchRow}>
                    <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>Entity name or number</label>
                        <input
                            className={styles.input}
                            type="text"
                            placeholder="e.g. Bright Future Foundation"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && !loading && handleSearch()}
                        />
                    </div>
                    <button className={styles.searchBtn} onClick={handleSearch} disabled={loading || !query.trim()}>
                        {loading ? "Searching…" : "Search"}
                    </button>
                </div>
                {statusMsg && (
                    <span className={`${styles.statusLine} ${isError ? styles.statusError : ""}`}>{statusMsg}</span>
                )}
            </div>
            {shared.results.length === 0 && !loading && (
                <div className={styles.empty}>Search Ohio Secretary of State business registrations</div>
            )}
            <ResultsArea {...shared} />
        </>
    );
}

/* ── Ohio AOS (async) ──────────────────────────────────────────── */

function OhioAosTab({ caseId, onResults, ...shared }: TabSharedProps) {
    const [query, setQuery] = useState("");
    const job = useAsyncJob<{ results?: unknown[]; count?: number }>({
        postUrl: `/api/cases/${caseId}/research/ohio-aos/`,
    });

    async function handleSearch() {
        if (!query.trim()) return;
        onResults([]);
        await job.run({ query: query.trim() });
    }

    useEffect(() => {
        if (job.status !== "success" || !job.result) return;
        const items = (job.result.results ?? []) as Record<string, unknown>[];
        onResults(items.map((r, i) => ({
            id: String(i),
            summary: `${r.entity_name ?? r.name ?? "Unknown"} · ${r.finding_type ?? r.report_type ?? ""}`,
            fields: Object.entries(r).slice(0, 10).map(([k, v]) => ({ key: k, value: String(v ?? "") })),
            rawData: r,
            source: "ohio_aos",
        })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [job.status, job.result]);

    const busy = job.status === "queued" || job.status === "running";
    return (
        <>
            <div className={styles.searchArea}>
                <div className={styles.searchRow}>
                    <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>Entity name</label>
                        <input
                            className={styles.input}
                            type="text"
                            placeholder="e.g. Bright Future Foundation"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && !busy && handleSearch()}
                        />
                    </div>
                    <button className={styles.searchBtn} onClick={handleSearch} disabled={busy || !query.trim()}>
                        {busy ? "Searching…" : "Search"}
                    </button>
                </div>
                {busy && <span className={styles.statusLine}>Searching Ohio Auditor of State…</span>}
                {job.status === "failed" && <span className={`${styles.statusLine} ${styles.statusError}`}>{job.error}</span>}
                {job.status === "success" && <span className={styles.statusLine}>{job.result?.count ?? shared.results.length} result(s)</span>}
            </div>
            {shared.results.length === 0 && !busy && (
                <div className={styles.empty}>Search Ohio Auditor of State audit findings</div>
            )}
            <ResultsArea {...shared} />
        </>
    );
}

/* ── County Recorder (sync) ────────────────────────────────────── */

function RecorderTab({ caseId, onResults, ...shared }: TabSharedProps) {
    const [county, setCounty] = useState("Franklin");
    const [name, setName] = useState("");
    const [loading, setLoading] = useState(false);
    const [statusMsg, setStatusMsg] = useState<string | null>(null);
    const [isError, setIsError] = useState(false);

    async function handleSearch() {
        if (!name.trim()) return;
        setLoading(true);
        setStatusMsg(null);
        onResults([]);
        try {
            const res = await searchRecorder(caseId, county, name.trim());
            const items = (res as unknown as { results?: Record<string, unknown>[] }).results ?? [];
            const searchUrl = (res as unknown as { search_url?: string }).search_url;
            if (searchUrl && items.length === 0) {
                // Recorder returns a URL to open — show it as a single result
                const single: ResearchResult = {
                    id: "0",
                    summary: `${county} County Recorder — external portal`,
                    fields: [
                        { key: "County", value: county },
                        { key: "Search name", value: name },
                        { key: "Portal URL", value: searchUrl },
                    ],
                    rawData: { county, name, search_url: searchUrl },
                    source: "county_recorder",
                };
                onResults([single]);
                setStatusMsg("Portal link ready — click to view");
            } else {
                const mapped = items.map((r, i) => ({
                    id: String(i),
                    summary: `${r.grantor ?? r.grantee ?? "Record"} · ${r.instrument_type ?? ""} · ${r.recording_date ?? ""}`,
                    fields: Object.entries(r).slice(0, 10).map(([k, v]) => ({ key: k, value: String(v ?? "") })),
                    rawData: r,
                    source: "county_recorder",
                }));
                onResults(mapped);
                setStatusMsg(`${items.length} result(s)`);
            }
            setIsError(false);
        } catch (e) {
            setStatusMsg(e instanceof Error ? e.message : "Search failed");
            setIsError(true);
        } finally {
            setLoading(false);
        }
    }

    return (
        <>
            <div className={styles.searchArea}>
                <div className={styles.searchRow}>
                    <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>County</label>
                        <select className={styles.select} value={county} onChange={(e) => setCounty(e.target.value)}>
                            {OHIO_COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>Grantor / Grantee name</label>
                        <input
                            className={styles.input}
                            type="text"
                            placeholder="e.g. Smith"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && !loading && handleSearch()}
                        />
                    </div>
                    <button className={styles.searchBtn} onClick={handleSearch} disabled={loading || !name.trim()}>
                        {loading ? "Searching…" : "Search"}
                    </button>
                </div>
                {statusMsg && (
                    <span className={`${styles.statusLine} ${isError ? styles.statusError : ""}`}>{statusMsg}</span>
                )}
            </div>
            {shared.results.length === 0 && !loading && (
                <div className={styles.empty}>Search deed and instrument records by county</div>
            )}
            <ResultsArea {...shared} />
        </>
    );
}

/* ── County Parcels (async) ────────────────────────────────────── */

function ParcelsTab({ caseId, onResults, ...shared }: TabSharedProps) {
    const [county, setCounty] = useState("Franklin");
    const [query, setQuery] = useState("");
    const [searchType, setSearchType] = useState<"owner" | "parcel">("owner");
    const job = useAsyncJob<{ results?: unknown[]; count?: number }>({
        postUrl: `/api/cases/${caseId}/research/parcels/`,
    });

    async function handleSearch() {
        if (!query.trim()) return;
        onResults([]);
        await job.run({ query: query.trim(), county, search_type: searchType });
    }

    useEffect(() => {
        if (job.status !== "success" || !job.result) return;
        const items = (job.result.results ?? []) as Record<string, unknown>[];
        onResults(items.map((r, i) => ({
            id: String(i),
            summary: `${r.owner_name ?? r.address ?? "Parcel"} · ${r.parcel_number ?? ""}`,
            fields: Object.entries(r).slice(0, 10).map(([k, v]) => ({ key: k, value: String(v ?? "") })),
            rawData: r,
            source: "county_parcel",
        })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [job.status, job.result]);

    const busy = job.status === "queued" || job.status === "running";
    return (
        <>
            <div className={styles.searchArea}>
                <div className={styles.searchRow}>
                    <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>County</label>
                        <select className={styles.select} value={county} onChange={(e) => setCounty(e.target.value)}>
                            {OHIO_COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>Search by</label>
                        <select className={styles.select} value={searchType} onChange={(e) => setSearchType(e.target.value as "owner" | "parcel")}>
                            <option value="owner">Owner name</option>
                            <option value="parcel">Parcel number</option>
                        </select>
                    </div>
                    <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>Query</label>
                        <input
                            className={styles.input}
                            type="text"
                            placeholder={searchType === "owner" ? "e.g. Smith" : "e.g. 010-001234"}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && !busy && handleSearch()}
                        />
                    </div>
                    <button className={styles.searchBtn} onClick={handleSearch} disabled={busy || !query.trim()}>
                        {busy ? "Searching…" : "Search"}
                    </button>
                </div>
                {busy && <span className={styles.statusLine}>Searching ODNR parcel data…</span>}
                {job.status === "failed" && <span className={`${styles.statusLine} ${styles.statusError}`}>{job.error}</span>}
                {job.status === "success" && <span className={styles.statusLine}>{job.result?.count ?? shared.results.length} result(s)</span>}
            </div>
            {shared.results.length === 0 && !busy && (
                <div className={styles.empty}>Search county parcel records by owner or parcel number</div>
            )}
            <ResultsArea {...shared} />
        </>
    );
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors. If `useAsyncJob` import path fails, verify the file is at `frontend/src/hooks/useAsyncJob.ts`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/workspace/ResearchPane.tsx frontend/src/components/workspace/ResearchPane.module.css
git commit -m "feat(workspace): add ResearchPane with 6 connector tabs"
```

---

## Task 7: Add Research to CaseWorkspace

**Files:**
- Modify: `frontend/src/layouts/CaseWorkspace.tsx`

- [ ] **Step 1: Import ResearchPane**

Add to the imports at the top of `CaseWorkspace.tsx`:

```typescript
import { ResearchPane } from "../components/workspace/ResearchPane";
```

- [ ] **Step 2: Add "research" to ViewToggle type**

Find `type ViewToggle` in `CaseWorkspace.tsx`. It is currently:
```typescript
type ViewToggle = "graph" | "990" | "financials" | "package";
```

Change to:
```typescript
type ViewToggle = "graph" | "990" | "financials" | "package" | "research";
```

- [ ] **Step 3: Add graphVersion state for graph refresh after Add to Case**

In the main `CaseWorkspace` function, add:
```typescript
const [graphVersion, setGraphVersion] = useState(0);
```

- [ ] **Step 4: Add Research to the viewToggles array in CaseTopBar**

Find in `CaseTopBar`:
```typescript
const viewToggles: { id: ViewToggle; label: string; locked?: boolean }[] = [
    { id: "graph", label: "Graph", locked: true },
    { id: "990", label: "990 Viewer" },
    { id: "financials", label: "Financials" },
    { id: "package", label: "Package" },
];
```

Change to:
```typescript
const viewToggles: { id: ViewToggle; label: string; locked?: boolean }[] = [
    { id: "graph", label: "Graph", locked: true },
    { id: "990", label: "990 Viewer" },
    { id: "financials", label: "Financials" },
    { id: "package", label: "Package" },
    { id: "research", label: "Research" },
];
```

- [ ] **Step 5: Render ResearchPane in CaseCenterCanvas**

In `CaseCenterCanvas`, find the `renderPane` function. Add a case for `"research"`:

```typescript
if (id === "research") {
    return (
        <ResearchPane
            caseId={caseId}
            onAdded={() => setGraphVersion?.((v) => v + 1)}
        />
    );
}
```

Also add `setGraphVersion` to CaseCenterCanvas props and pass it from the parent.

CaseCenterCanvas props interface — add:
```typescript
onGraphRefresh?: () => void;
```

And in `renderPane` for "research":
```typescript
if (id === "research") {
    return <ResearchPane caseId={caseId} onAdded={onGraphRefresh} />;
}
```

Pass from CaseWorkspace main return:
```typescript
<CaseCenterCanvas
    caseId={caseId}
    caseDetail={caseDetail}
    activeViews={activeViews}
    onConfirmedSubject={refreshCaseDetail}
    selectedNode={selectedNode}
    onSelectNode={setSelectedNode}
    onCloseView={(v) => toggleView(v)}
    onGraphRefresh={() => setGraphVersion((v) => v + 1)}
/>
```

Pass graphVersion to WorkspaceGraph so it refreshes when a result is added.

In `frontend/src/components/workspace/WorkspaceGraph.tsx`, update the Props interface:
```typescript
interface Props {
    caseId: string;
    selectedNodeId?: string | null;
    onSelectNode?: (node: GraphNode | null) => void;
    version?: number;  // increment to force a graph refresh
}
```

Update the `useEffect` dependency array in WorkspaceGraph to include `version`:
```typescript
export function WorkspaceGraph({ caseId, selectedNodeId, onSelectNode, version }: Props) {
    // ... existing state ...

    useEffect(() => {
        let cancelled = false;
        setError(null);
        (async () => {
            try {
                const data = await fetchCaseGraph(caseId);
                if (!cancelled) setGraph(data);
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load graph");
            }
        })();
        return () => { cancelled = true; };
    }, [caseId, version]);  // ← add version here
    // ... rest of component unchanged ...
}
```

Then in CaseCenterCanvas, pass the prop through:
```typescript
<WorkspaceGraph
    caseId={caseId}
    selectedNodeId={selectedNode?.id ?? null}
    onSelectNode={onSelectNode}
    version={graphVersion}
/>
```

And CaseCenterCanvas needs the `graphVersion` value from its parent. Update CaseCenterCanvas props:
```typescript
interface CaseCenterCanvasProps {
    // ... existing props ...
    graphVersion: number;
    onGraphRefresh?: () => void;
}
```

Pass from main CaseWorkspace render:
```typescript
<CaseCenterCanvas
    caseId={caseId}
    caseDetail={caseDetail}
    activeViews={activeViews}
    graphVersion={graphVersion}
    onConfirmedSubject={refreshCaseDetail}
    selectedNode={selectedNode}
    onSelectNode={setSelectedNode}
    onCloseView={(v) => toggleView(v)}
    onGraphRefresh={() => setGraphVersion((v) => v + 1)}
/>
```

- [ ] **Step 6: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/layouts/CaseWorkspace.tsx frontend/src/components/workspace/WorkspaceGraph.tsx
git commit -m "feat(workspace): add Research pane to top-bar view toggles"
```

---

## Task 8: Lift selectedFinding state + add Notes tab to RightDetailPanel

**Files:**
- Modify: `frontend/src/layouts/CaseWorkspace.tsx`
- Modify: `frontend/src/components/workspace/RightDetailPanel.tsx`

- [ ] **Step 1: Add selectedFinding state to CaseWorkspace**

In the main `CaseWorkspace` function, add:
```typescript
const [selectedFinding, setSelectedFinding] = useState<import("../types").FindingItem | null>(null);
```

- [ ] **Step 2: Pass setSelectedFinding to CaseBottomDock**

Find `CaseBottomDock` in `CaseWorkspace` render. Update its props interface to include `onSelectFinding` from workspace state, and pass `setSelectedFinding`:

```typescript
<CaseBottomDock
    caseId={caseId}
    onCollapse={toggleBottomDock}
    activeTab={dockTab}
    onActiveTabChange={setDockTab}
    onSelectFinding={(f) => {
        setSelectedFinding(f);
        toast.message(`Selected: ${f.title}`);
    }}
/>
```

- [ ] **Step 3: Pass selectedFinding to RightDetailPanel**

Update `RightDetailPanel` call:
```typescript
<RightDetailPanel
    caseDetail={caseDetail}
    selectedNode={selectedNode}
    selectedFinding={selectedFinding}
    onCollapse={toggleRightPanel}
    onClearSelection={() => { setSelectedNode(null); setSelectedFinding(null); }}
/>
```

- [ ] **Step 4: Add fetchNotes, createNote, deleteNote imports to RightDetailPanel.tsx**

In `frontend/src/components/workspace/RightDetailPanel.tsx`, add to api imports:
```typescript
import {
    fetch990Data,
    fetchEntityDetail,
    fetchNotes,
    createNote,
    deleteNote,
    isAbortError,
    searchOhioAOS,
    searchOhioSOS,
} from "../../api";
```

Also add `FindingItem, InvestigatorNote` to the types import:
```typescript
import type { CaseDetail, FindingItem, GraphNode, GraphNodeType, InvestigatorNote } from "../../types";
```

- [ ] **Step 5: Add selectedFinding to RightDetailPanel props**

Update the Props interface:
```typescript
interface Props {
    caseDetail: CaseDetail | null;
    selectedNode: GraphNode | null;
    selectedFinding: FindingItem | null;
    onCollapse: () => void;
    onClearSelection: () => void;
}
```

Update the function signature:
```typescript
export function RightDetailPanel({
    caseDetail,
    selectedNode,
    selectedFinding,
    onCollapse,
    onClearSelection,
}: Props) {
```

- [ ] **Step 6: Add Notes tab to EntityDetailView**

In `RightDetailPanel.tsx`, find `EntityDetailView`. It renders `<Tabs.Root>` with tabs: Properties, Sources, Flags, Actions.

Add "notes" to the tab list:
```typescript
<Tabs.Trigger value="notes">Notes</Tabs.Trigger>
```

Add the Notes content panel after Actions:
```typescript
<Tabs.Content value="notes" className={styles.tabContent}>
    <NotesTab
        caseId={caseId}
        targetType={node.type}
        targetId={node.id}
    />
</Tabs.Content>
```

Also add a Notes tab to `CaseSubjectView` (no entity selected):
```typescript
<Tabs.Content value="notes" className={styles.tabContent}>
    <NotesTab
        caseId={caseDetail?.id ?? ""}
        targetType="case"
        targetId={caseDetail?.id ?? ""}
    />
</Tabs.Content>
```

- [ ] **Step 7: Build the NotesTab subcomponent**

Add this function to `RightDetailPanel.tsx` (before the export):

```typescript
function NotesTab({
    caseId,
    targetType,
    targetId,
}: {
    caseId: string;
    targetType: string;
    targetId: string;
}) {
    const [notes, setNotes] = useState<InvestigatorNote[]>([]);
    const [content, setContent] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!caseId || !targetId) return;
        let cancelled = false;
        fetchNotes(caseId, targetType, targetId)
            .then((res) => {
                if (!cancelled) setNotes((res as unknown as { results: InvestigatorNote[] }).results ?? []);
            })
            .catch(() => {/* silently ignore */});
        return () => { cancelled = true; };
    }, [caseId, targetType, targetId]);

    async function handleAdd() {
        if (!content.trim()) return;
        setSaving(true);
        try {
            const note = await createNote(caseId, targetType, targetId, content.trim());
            setNotes((prev) => [note as InvestigatorNote, ...prev]);
            setContent("");
        } catch {
            // do nothing
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete(noteId: string) {
        try {
            await deleteNote(caseId, noteId);
            setNotes((prev) => prev.filter((n) => n.id !== noteId));
        } catch {
            // do nothing
        }
    }

    return (
        <div className={styles.notesList}>
            <textarea
                className={styles.noteInput}
                placeholder="Add a note…"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={3}
            />
            <button
                type="button"
                className={styles.noteAddBtn}
                onClick={handleAdd}
                disabled={saving || !content.trim()}
            >
                {saving ? "Saving…" : "Add Note"}
            </button>
            {notes.map((n) => (
                <div key={n.id} className={styles.noteItem}>
                    <div className={styles.noteMeta}>
                        {new Date(n.created_at).toLocaleString()}
                    </div>
                    <div className={styles.noteContent}>{n.content}</div>
                    <button
                        type="button"
                        className={styles.noteDeleteBtn}
                        onClick={() => handleDelete(n.id)}
                        aria-label="Delete note"
                    >
                        ×
                    </button>
                </div>
            ))}
            {notes.length === 0 && (
                <div className={styles.noteEmpty}>No notes yet.</div>
            )}
        </div>
    );
}
```

- [ ] **Step 8: Add Notes CSS to RightDetailPanel.module.css**

```css
.notesList {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
}
.noteInput {
    width: 100%;
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--control-border);
    border-radius: var(--radius-sm);
    background: var(--control-bg);
    color: var(--text-main);
    font-family: inherit;
    font-size: var(--text-sm);
    resize: vertical;
    box-sizing: border-box;
}
.noteAddBtn {
    align-self: flex-start;
    padding: 0.3rem 0.75rem;
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: #fff;
    font-size: var(--text-xs);
    font-weight: 600;
    cursor: pointer;
}
.noteAddBtn:disabled { opacity: 0.5; cursor: not-allowed; }
.noteItem {
    position: relative;
    padding: 0.5rem 1.5rem 0.5rem 0.6rem;
    background: var(--bg-haze);
    border-radius: var(--radius-sm);
    border: 1px solid var(--line);
}
.noteMeta {
    font-size: var(--text-xs);
    color: var(--text-soft);
    margin-bottom: 0.2rem;
}
.noteContent {
    font-size: var(--text-sm);
    color: var(--text-main);
    white-space: pre-wrap;
    word-break: break-word;
}
.noteDeleteBtn {
    position: absolute;
    top: 0.3rem;
    right: 0.3rem;
    background: none;
    border: none;
    color: var(--text-soft);
    font-size: 1rem;
    cursor: pointer;
    line-height: 1;
    padding: 0.1rem 0.3rem;
}
.noteDeleteBtn:hover { color: var(--tag-high-color); }
.noteEmpty {
    font-size: var(--text-xs);
    color: var(--text-soft);
    text-align: center;
    padding: 0.75rem;
}
```

- [ ] **Step 9: TypeScript check and commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/layouts/CaseWorkspace.tsx frontend/src/components/workspace/RightDetailPanel.tsx frontend/src/components/workspace/RightDetailPanel.module.css
git commit -m "feat(workspace): add Notes tab to right panel + lift selectedFinding state"
```

---

## Task 9: Add AI section to RightDetailPanel Actions tab

**Files:**
- Modify: `frontend/src/components/workspace/RightDetailPanel.tsx`

- [ ] **Step 1: Add AI API imports**

Add to the api imports in `RightDetailPanel.tsx`:
```typescript
import {
    fetch990Data,
    fetchEntityDetail,
    fetchNotes,
    createNote,
    deleteNote,
    isAbortError,
    searchOhioAOS,
    searchOhioSOS,
    aiSummarize,
    aiConnections,
    aiNarrative,
    aiAsk,
    runAiPatternAnalysis,
} from "../../api";
```

- [ ] **Step 2: Add AI state to ActionsTab**

In `ActionsTab`, add state after the existing `busy` state:

```typescript
const [aiResponse, setAiResponse] = useState<{ label: string; text: string } | null>(null);
const [aiBusy, setAiBusy] = useState<string | null>(null);
const [askText, setAskText] = useState("");
```

- [ ] **Step 3: Add AI handlers to ActionsTab**

Add these handlers inside `ActionsTab`:

```typescript
async function runPatternAnalysis() {
    setAiBusy("patterns");
    setAiResponse(null);
    try {
        await runAiPatternAnalysis(caseId);
        setAiResponse({ label: "AI Pattern Analysis", text: "Job queued — check the Transforms tab for results when complete." });
    } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed";
        if (msg.includes("ANTHROPIC_API_KEY")) {
            setAiResponse({ label: "AI unavailable", text: "AI features require ANTHROPIC_API_KEY to be set in Railway environment variables." });
        } else {
            setAiResponse({ label: "Error", text: msg });
        }
    } finally {
        setAiBusy(null);
    }
}

async function runSummarize() {
    setAiBusy("summarize");
    setAiResponse(null);
    try {
        const res = await aiSummarize(caseId, "case", caseId);
        setAiResponse({ label: "Case Summary", text: (res as unknown as { summary?: string }).summary ?? JSON.stringify(res) });
    } catch (e) {
        setAiResponse({ label: "Error", text: e instanceof Error ? e.message : "Failed" });
    } finally {
        setAiBusy(null);
    }
}

async function runConnections() {
    setAiBusy("connections");
    setAiResponse(null);
    try {
        const res = await aiConnections(caseId, node.id);
        setAiResponse({ label: "Connection Analysis", text: (res as unknown as { analysis?: string }).analysis ?? JSON.stringify(res) });
    } catch (e) {
        setAiResponse({ label: "Error", text: e instanceof Error ? e.message : "Failed" });
    } finally {
        setAiBusy(null);
    }
}

async function handleAskSubmit() {
    if (!askText.trim()) return;
    setAiBusy("ask");
    setAiResponse(null);
    try {
        const res = await aiAsk(caseId, askText.trim(), []);
        setAiResponse({ label: "AI Answer", text: (res as unknown as { answer?: string; response?: string }).answer ?? (res as unknown as { response?: string }).response ?? JSON.stringify(res) });
        setAskText("");
    } catch (e) {
        setAiResponse({ label: "Error", text: e instanceof Error ? e.message : "Failed" });
    } finally {
        setAiBusy(null);
    }
}
```

- [ ] **Step 4: Add AI UI section to ActionsTab render**

In the `ActionsTab` return, after the existing `actions` buttons, add:

```typescript
<div className={styles.aiSection}>
    <div className={styles.aiSectionHeader}>AI Analysis</div>

    <button
        type="button"
        className={styles.actionBtn}
        onClick={runPatternAnalysis}
        disabled={aiBusy !== null}
    >
        {aiBusy === "patterns" ? "Queuing…" : "Run AI Pattern Analysis"}
    </button>

    <button
        type="button"
        className={styles.actionBtn}
        onClick={runSummarize}
        disabled={aiBusy !== null}
    >
        {aiBusy === "summarize" ? "Summarizing…" : "Generate case summary"}
    </button>

    {node.type === "organization" && (
        <button
            type="button"
            className={styles.actionBtn}
            onClick={runConnections}
            disabled={aiBusy !== null}
        >
            {aiBusy === "connections" ? "Analyzing…" : "Analyze entity connections"}
        </button>
    )}

    <div className={styles.askRow}>
        <input
            type="text"
            className={styles.askInput}
            placeholder="Ask AI a question…"
            value={askText}
            onChange={(e) => setAskText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !aiBusy && handleAskSubmit()}
            disabled={aiBusy !== null}
        />
        <button
            type="button"
            className={styles.askBtn}
            onClick={handleAskSubmit}
            disabled={aiBusy !== null || !askText.trim()}
        >
            {aiBusy === "ask" ? "…" : "Ask"}
        </button>
    </div>

    {aiResponse && (
        <div className={styles.aiResult}>
            <div className={styles.aiResultLabel}>{aiResponse.label}</div>
            <div className={styles.aiResultText}>{aiResponse.text}</div>
        </div>
    )}
</div>
```

- [ ] **Step 5: Add AI CSS to RightDetailPanel.module.css**

```css
.aiSection {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-top: 0.85rem;
    padding-top: 0.85rem;
    border-top: 1px solid var(--line);
}
.aiSectionHeader {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-soft);
    font-weight: 600;
    margin-bottom: 0.1rem;
}
.askRow {
    display: flex;
    gap: 0.3rem;
}
.askInput {
    flex: 1;
    padding: 0.28rem 0.5rem;
    border: 1px solid var(--control-border);
    border-radius: var(--radius-sm);
    background: var(--control-bg);
    color: var(--text-main);
    font-size: var(--text-xs);
    font-family: inherit;
}
.askBtn {
    padding: 0.28rem 0.6rem;
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: #fff;
    font-size: var(--text-xs);
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
}
.askBtn:disabled { opacity: 0.5; cursor: not-allowed; }
.aiResult {
    background: var(--bg-haze);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    padding: 0.55rem 0.65rem;
    font-size: var(--text-xs);
}
.aiResultLabel {
    color: var(--text-soft);
    font-weight: 600;
    margin-bottom: 0.3rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 0.65rem;
}
.aiResultText {
    color: var(--text-main);
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
}
```

- [ ] **Step 6: TypeScript check and commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/components/workspace/RightDetailPanel.tsx frontend/src/components/workspace/RightDetailPanel.module.css
git commit -m "feat(workspace): add AI analysis section to right panel Actions tab"
```

---

## Task 10: Final push and Railway deploy

- [ ] **Step 1: Run full TypeScript check one more time**

```bash
cd frontend && npx tsc --noEmit
```
Expected: clean, no errors.

- [ ] **Step 2: Push all commits**

```bash
git push origin main
```

- [ ] **Step 3: Verify on Railway**

After deploy completes, test the following in order:
1. Open a case → click "Research" in the top bar → pane opens
2. IRS Search tab → type an org name → "Search" → spinner appears → results appear
3. Click a result → detail expands → "Add to Case" → success toast → close Research → graph shows new node
4. Fetch 990 tab → enter EIN → "Fetch all years" → filings appear
5. Ohio SOS tab → search → results appear
6. Right panel → click "Notes" tab → type a note → "Add Note" → note appears
7. Right panel → click "Actions" tab → scroll to AI section → "Generate case summary" → response appears
8. Top bar → "More" → "Mark as Paused" → top bar status label changes to PAUSED
9. Top bar → "Layout" → "Focus" → dock collapses, only graph visible
10. Documents tab in dock → "Process pending" button → shows count
