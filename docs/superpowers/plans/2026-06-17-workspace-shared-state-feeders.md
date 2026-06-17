# Workspace Shared State + Feeder Actions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the case-detail surfaces one shared selection state (`activeEntity` / `activeAngle`) and turn Financials, Timeline, and Research from dead-end tabs into feeders that can start an Angle or cite into the active Angle — creating **real `FindingDocument` citations** when a document id is available — without yanking the investigator away.

**Architecture:** Introduce a React context (`CaseWorkspaceProvider`) holding `activeEntityId` and the active Angle (`{id, title}`), replacing the prop-drilled `useState` in `CaseDetailView`. Add one reusable `AnglePickerModal` and one `useFeederActions` hook wrapping the existing `createAngle` / `fetchAngle` / `updateAngle` API functions. Cite uses `add_document_ids` (chain-of-custody) when a document id is present, and only annotates the narrative for non-document events. Re-wire the two dead-end callbacks in `CaseDetailView` and add persistent add-to-case outcome labels to `ResearchTab`. No backend changes.

**Tech Stack:** React 18 + TypeScript, Vite, Radix UI (Dialog/Popover), `sonner` toasts, Vitest + @testing-library/react (jsdom).

## Global Constraints

- **Frontend vocabulary (CLAUDE.md, banned strings):** never render "Finding", "Haiku", "Sonnet", "Opus", "Claude", "AI assistant", "LLM", "GPT" in user-visible text. Use **Angle** (= Finding), **Knot** (= Person/Organization), **Lead** (= AI result), **Intake** (= extraction). Backend model names appear only in API calls and TS types.
- **Code style:** 2-space indent, double quotes, match the surrounding TSX file.
- **Citation is chain-of-custody, not prose.** A "Cite" that should satisfy referral readiness / PDF evidence MUST create a `FindingDocument` row via `add_document_ids` (the existing `CiteDocumentPicker.tsx:173` is the reference for the mechanism — note it sends BOTH `narrative` and `add_document_ids`; this plan's feeder `applyCite` is **intentionally stricter**: `add_document_ids` ONLY, no narrative rewrite, to avoid the read-modify-write clobber in §"Document cites are atomic"). Narrative-only `[Cited: …]` text is reserved for events that have **no** document id.
- **`createAngle` requires a valid `severity`.** `FindingIntakeSerializer` (`backend/investigations/serializers.py:808`) rejects a create without one — there is no default — even though `createAngle`'s TS type marks it optional. Feeder-created Angles MUST send `severity: "MEDIUM"`.
- **Stay-in-place rule (design §9):** after any feeder action, do NOT navigate to the Web. Toast confirmation + set the Angle active for follow-on cites.
- **Cite fallback (design §9):** "Cite" with an active Angle links the item; with no active Angle, open a picker whose **top option is "+ New Angle from this."**
- **One-click cite must not be blind (review #1).** Because a set active Angle makes "Cite" skip the picker, the active Angle (title) MUST be shown by a persistent, global indicator in the `CaseDetailView` header — visible from every tab — with a one-click "clear" so the investigator always knows (and can change) the target before citing.
- **Document cites are atomic; narrative cites are not (review #3).** A document cite uses ONLY `add_document_ids` (the `FindingDocument` link is created atomically server-side) and does NOT rewrite the narrative — this avoids clobbering a concurrent narrative edit. A narrative-only cite (event with no document id) still does a client read-modify-write and carries a known last-write-wins race (documented limitation; atomic backend cite endpoint is a follow-up).
- **Explicit, surviving outcome (design §9, review #4 was #2).** Surface which thing happened — *created knot / already in case / saved note / fetched documents / started angle* — and keep it visible on the row. Triage state is a single map hoisted to `CaseDetailViewInner` so it survives tab switches (it does NOT survive navigating away from the case — durable backend-derived state is a follow-up).
- **Async correctness + retryable failures (review #4).** The picker-pick callback returns `Promise<boolean>` (true on success). The modal awaits it and closes ONLY on a non-`false` result, so a failed create/cite keeps the picker open with its pending item intact for retry.
- **Test command (from `frontend/`):** `npm test` (= `vitest run`). Single file: `npx vitest run src/path/to/file.test.tsx`. **Type check:** `npx tsc --noEmit`.
- Implements **build-sequence item 1** of `docs/architecture/case-workspace-design.md` (§9 shared action/state + the frontend half of WS-GAP-7). The **dedupe / enrich-vs-create** backend half of WS-GAP-7 is OUT OF SCOPE (deferred follow-up). `activeEntityId` is **producer-only this phase** — set from Web knot click, with **no consumer behavior yet** (nothing reads it). Research-row/Financials producers and the context-panel that reacts to it land in build item 3; do not expect full cross-tab entity context from this slice.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `frontend/src/context/CaseWorkspaceContext.tsx` | `activeEntityId` + active Angle `{id,title}`; `useCaseWorkspace()` | **Create** |
| `frontend/src/context/CaseWorkspaceContext.test.tsx` | Provider + hook tests | **Create** |
| `frontend/src/components/AnglePickerModal.tsx` | Picker: existing Angle or "+ New Angle from this" | **Create** |
| `frontend/src/components/AnglePickerModal.test.tsx` | Render + interaction tests | **Create** |
| `frontend/src/hooks/useFeederActions.ts` | `startAngleFrom()` + `citeToAngle()` (doc citation or narrative) | **Create** |
| `frontend/src/hooks/useFeederActions.test.tsx` | Behavior tests | **Create** |
| `frontend/src/views/InvestigateTab.tsx` | `onAngleActive` reports `{id,title}`; Web knot click → `setActiveEntity` | **Modify** |
| `frontend/src/views/CaseDetailView.tsx` | Provider wrap; remove dead-ends; wire feeders + picker | **Modify** |
| `frontend/src/views/ResearchTab.tsx` | Persistent add-to-case outcome labels on every triage action | **Modify** |
| `frontend/src/views/ResearchTab.test.tsx` | `outcomeLabel` tests | **Create** |
| `frontend/src/api/research.ts` | Type `addResearchToCase` → `AddToCaseResult` | **Modify** |
| `frontend/src/types/index.ts` | Add `AddToCaseResult` | **Modify** |

---

### Task 1: Shared workspace context + active-Angle title + Web entity selection

Lift active selection out of `CaseDetailView`'s `useState` into a context. Fix the active-Angle title at the source (`InvestigateTab` already knows it) instead of storing `title: ""`. Wire `activeEntityId` for the one unambiguous producer (Web knot click).

**Files:**
- Create: `frontend/src/context/CaseWorkspaceContext.tsx`, `frontend/src/context/CaseWorkspaceContext.test.tsx`
- Modify: `frontend/src/views/CaseDetailView.tsx`, `frontend/src/views/InvestigateTab.tsx`

**Interfaces:**
- Produces:
  ```ts
  interface ActiveAngle { id: string; title: string }
  interface CaseWorkspaceState {
    activeEntityId: string | undefined;
    activeAngleId: string | undefined;
    activeAngleTitle: string | undefined;
    setActiveEntity: (id: string | undefined) => void;
    setActiveAngle: (angle: ActiveAngle | undefined) => void;
  }
  function CaseWorkspaceProvider(props: { children: React.ReactNode }): JSX.Element
  function useCaseWorkspace(): CaseWorkspaceState  // throws outside provider
  ```
- `InvestigateTab` prop change: `onAngleActive?: (angle: ActiveAngle | undefined) => void` (was `(angleId: string | undefined) => void`).

- [ ] **Step 1: Write the failing context test**

`frontend/src/context/CaseWorkspaceContext.test.tsx`:
```tsx
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import {
  CaseWorkspaceProvider,
  useCaseWorkspace,
  type CaseWorkspaceState,
} from "./CaseWorkspaceContext";

function Probe({ grab }: { grab: (s: CaseWorkspaceState) => void }) {
  const ws = useCaseWorkspace();
  grab(ws);
  return (
    <div>
      <span data-testid="entity">{ws.activeEntityId ?? "none"}</span>
      <span data-testid="angle">{ws.activeAngleId ?? "none"}</span>
      <span data-testid="title">{ws.activeAngleTitle ?? "none"}</span>
    </div>
  );
}

describe("CaseWorkspaceContext", () => {
  it("defaults to undefined selection", () => {
    render(
      <CaseWorkspaceProvider>
        <Probe grab={() => {}} />
      </CaseWorkspaceProvider>
    );
    expect(screen.getByTestId("entity")).toHaveTextContent("none");
    expect(screen.getByTestId("angle")).toHaveTextContent("none");
  });

  it("setActiveAngle exposes id and title; setActiveEntity exposes id", () => {
    let api: CaseWorkspaceState | null = null;
    render(
      <CaseWorkspaceProvider>
        <Probe grab={(s) => (api = s)} />
      </CaseWorkspaceProvider>
    );
    act(() => api!.setActiveAngle({ id: "ang-1", title: "Self-dealing" }));
    expect(screen.getByTestId("angle")).toHaveTextContent("ang-1");
    expect(screen.getByTestId("title")).toHaveTextContent("Self-dealing");

    act(() => api!.setActiveEntity("ent-9"));
    expect(screen.getByTestId("entity")).toHaveTextContent("ent-9");

    act(() => api!.setActiveAngle(undefined));
    expect(screen.getByTestId("angle")).toHaveTextContent("none");
  });

  it("useCaseWorkspace throws outside a provider", () => {
    function Bad() {
      useCaseWorkspace();
      return null;
    }
    expect(() => render(<Bad />)).toThrow(/CaseWorkspaceProvider/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/context/CaseWorkspaceContext.test.tsx`
Expected: FAIL — `Cannot find module './CaseWorkspaceContext'`.

- [ ] **Step 3: Write the context**

`frontend/src/context/CaseWorkspaceContext.tsx`:
```tsx
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export interface ActiveAngle {
  id: string;
  title: string;
}

export interface CaseWorkspaceState {
  /** Currently selected knot/entity (set by Web knot click; more producers in build item 3). */
  activeEntityId: string | undefined;
  /** Currently open Angle — feeder "Cite" actions target this. */
  activeAngleId: string | undefined;
  activeAngleTitle: string | undefined;
  setActiveEntity: (id: string | undefined) => void;
  setActiveAngle: (angle: ActiveAngle | undefined) => void;
}

const CaseWorkspaceContext = createContext<CaseWorkspaceState | null>(null);

export function CaseWorkspaceProvider({ children }: { children: ReactNode }) {
  const [activeEntityId, setActiveEntity] = useState<string | undefined>();
  const [activeAngle, setActiveAngle] = useState<ActiveAngle | undefined>();

  const value = useMemo<CaseWorkspaceState>(
    () => ({
      activeEntityId,
      activeAngleId: activeAngle?.id,
      activeAngleTitle: activeAngle?.title,
      setActiveEntity,
      setActiveAngle,
    }),
    [activeEntityId, activeAngle]
  );

  return (
    <CaseWorkspaceContext.Provider value={value}>
      {children}
    </CaseWorkspaceContext.Provider>
  );
}

export function useCaseWorkspace(): CaseWorkspaceState {
  const ctx = useContext(CaseWorkspaceContext);
  if (!ctx) {
    throw new Error("useCaseWorkspace must be used within a CaseWorkspaceProvider");
  }
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/context/CaseWorkspaceContext.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Change `InvestigateTab` to report the active Angle title and set active entity**

In `frontend/src/views/InvestigateTab.tsx`:

1. Add the context import after the existing imports (around line 18):
```tsx
import { useCaseWorkspace, type ActiveAngle } from "../context/CaseWorkspaceContext";
```

2. Change the prop type (currently line 474):
```tsx
  onAngleActive?: (angle: ActiveAngle | undefined) => void;
```

3. Inside the component, add near the other hooks (after line 516, the `cyRef`):
```tsx
  const { setActiveEntity } = useCaseWorkspace();
```

4. In `navigate()` (currently lines 592–596), pass `{id,title}` instead of a bare id:
```tsx
    if (entry.kind === "angle") {
      onAngleActive?.({ id: entry.angleId, title: entry.angleTitle });
    } else {
      onAngleActive?.(undefined);
    }
```

5. In `navigateTo()` (currently lines 607–611), the same:
```tsx
    if (top.kind === "angle") {
      onAngleActive?.({ id: top.angleId, title: top.angleTitle });
    } else {
      onAngleActive?.(undefined);
    }
```

6. In `handleOpenKnotView()` (currently line 644), set the active entity when a knot opens:
```tsx
  function handleOpenKnotView(node: GraphNode) {
    setActiveEntity(node.id);
    navigate({ kind: "profile", entityId: node.id, entityType: node.type, entityName: node.label });
    // ...rest unchanged
```

- [ ] **Step 6: Wire the provider + context into `CaseDetailView`**

In `frontend/src/views/CaseDetailView.tsx`:

1. Add import after line 8:
```tsx
import { CaseWorkspaceProvider, useCaseWorkspace } from "../context/CaseWorkspaceContext";
```

2. Rename the current export. Change line 65 `export default function CaseDetailView() {` to `function CaseDetailViewInner() {`. Add at the end of the file:
```tsx
export default function CaseDetailView() {
  return (
    <CaseWorkspaceProvider>
      <CaseDetailViewInner />
    </CaseWorkspaceProvider>
  );
}
```

3. Replace lines 70–71:
```tsx
  const [activeAngleId, setActiveAngleId] = useState<string | undefined>();
  const [requestedAngle, setRequestedAngle] = useState<{ id: string; title: string } | null>(null);
```
with:
```tsx
  const { activeAngleId, activeAngleTitle, setActiveAngle } = useCaseWorkspace();
  const [requestedAngle, setRequestedAngle] = useState<{ id: string; title: string } | null>(null);
```

4. Replace `onAngleActive={setActiveAngleId}` (line 166) with — `InvestigateTab` now passes a full `{id,title}` or `undefined`:
```tsx
            onAngleActive={(angle) => setActiveAngle(angle)}
```

- [ ] **Step 7: Type check + full test run**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass (existing + 3 new).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/context/CaseWorkspaceContext.tsx frontend/src/context/CaseWorkspaceContext.test.tsx frontend/src/views/InvestigateTab.tsx frontend/src/views/CaseDetailView.tsx
git commit -m "feat(frontend): shared case workspace context (active entity + active angle with title)"
```

---

### Task 2: Reusable Angle picker modal

Radix Dialog listing existing Angles, always offering "+ New Angle from this" first. `onPick` may be async; the modal awaits it.

**Files:**
- Create: `frontend/src/components/AnglePickerModal.tsx`, `frontend/src/components/AnglePickerModal.test.tsx`

**Interfaces:**
- Consumes: `fetchAngles(caseId, params)` → `FindingsResponse` (`.results: FindingItem[]`).
- Produces:
  ```ts
  interface AnglePickerModalProps {
    caseId: string;
    open: boolean;
    onClose: () => void;
    /** angleId === null means "create a new Angle from this". May be async. */
    onPick: (angleId: string | null) => boolean | void | Promise<boolean | void>;
  }
  ```

- [ ] **Step 1: Write the failing test**

`frontend/src/components/AnglePickerModal.test.tsx`:
```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AnglePickerModal from "./AnglePickerModal";

const fetchAnglesMock = vi.fn();
vi.mock("../api", () => ({
  fetchAngles: (...args: unknown[]) => fetchAnglesMock(...args),
}));

beforeEach(() => {
  fetchAnglesMock.mockReset();
  fetchAnglesMock.mockResolvedValue({
    results: [
      { id: "ang-1", title: "Insider swap" },
      { id: "ang-2", title: "False disclosure" },
    ],
    count: 2,
  });
});

describe("AnglePickerModal", () => {
  it("renders the new-angle option first and lists existing angles", async () => {
    render(<AnglePickerModal caseId="c1" open onClose={() => {}} onPick={() => {}} />);
    expect(await screen.findByText(/\+ New Angle from this/i)).toBeInTheDocument();
    expect(screen.getByText("Insider swap")).toBeInTheDocument();
    expect(screen.getByText("False disclosure")).toBeInTheDocument();
  });

  it("calls onPick(null) for new and onPick(id) for an existing angle", async () => {
    const onPick = vi.fn();
    render(<AnglePickerModal caseId="c1" open onClose={() => {}} onPick={onPick} />);
    await userEvent.click(await screen.findByText(/\+ New Angle from this/i));
    expect(onPick).toHaveBeenCalledWith(null);
    await userEvent.click(screen.getByText("Insider swap"));
    expect(onPick).toHaveBeenCalledWith("ang-1");
  });

  it("does not fetch when closed", async () => {
    render(<AnglePickerModal caseId="c1" open={false} onClose={() => {}} onPick={() => {}} />);
    await waitFor(() => expect(fetchAnglesMock).not.toHaveBeenCalled());
  });

  it("stays open when onPick returns false (failed cite — review #4)", async () => {
    const onClose = vi.fn();
    const onPick = vi.fn().mockResolvedValue(false);
    render(<AnglePickerModal caseId="c1" open onClose={onClose} onPick={onPick} />);
    await userEvent.click(await screen.findByText("Insider swap"));
    expect(onPick).toHaveBeenCalledWith("ang-1");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when onPick resolves (default void treated as success)", async () => {
    const onClose = vi.fn();
    render(<AnglePickerModal caseId="c1" open onClose={onClose} onPick={() => {}} />);
    await userEvent.click(await screen.findByText("Insider swap"));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/AnglePickerModal.test.tsx`
Expected: FAIL — `Cannot find module './AnglePickerModal'`.

- [ ] **Step 3: Write the implementation**

`frontend/src/components/AnglePickerModal.tsx`:
```tsx
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus } from "lucide-react";
import { fetchAngles } from "../api";
import type { FindingItem } from "../types";

interface AnglePickerModalProps {
  caseId: string;
  open: boolean;
  onClose: () => void;
  /** angleId === null means "create a new Angle from this". May be async. */
  onPick: (angleId: string | null) => boolean | void | Promise<boolean | void>;
}

export default function AnglePickerModal({ caseId, open, onClose, onPick }: AnglePickerModalProps) {
  const [angles, setAngles] = useState<FindingItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchAngles(caseId, { limit: 100 })
      .then((res) => setAngles(res.results))
      .catch(() => setAngles([]))
      .finally(() => setLoading(false));
  }, [open, caseId]);

  async function handlePick(id: string | null) {
    // Close only when the pick succeeded. A false result means the cite/create
    // failed (review #4) — keep the picker open so the user can retry.
    const ok = await onPick(id);
    if (ok !== false) onClose();
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Title className="dialog-title">Cite into an angle</Dialog.Title>
          <Dialog.Description className="dialog-description">
            Choose an angle to cite this into, or start a new one.
          </Dialog.Description>
          <div className="angle-picker-list">
            <button
              type="button"
              className="angle-picker-item angle-picker-item--new"
              onClick={() => void handlePick(null)}
            >
              <Plus size={13} /> + New Angle from this
            </button>
            {loading && <div className="angle-picker-empty">Loading angles…</div>}
            {!loading && angles.length === 0 && (
              <div className="angle-picker-empty">No angles yet.</div>
            )}
            {angles.map((a) => (
              <button
                key={a.id}
                type="button"
                className="angle-picker-item"
                onClick={() => void handlePick(a.id)}
              >
                {a.title}
              </button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/AnglePickerModal.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Type check + commit**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

```bash
git add frontend/src/components/AnglePickerModal.tsx frontend/src/components/AnglePickerModal.test.tsx
git commit -m "feat(frontend): reusable AnglePickerModal for feeder cite fallback"
```

---

### Task 3: `useFeederActions` hook (real citation + narrative fallback)

`startAngleFrom()` creates an Angle (with `severity: "MEDIUM"`) and sets it active; `citeToAngle(item)` cites into the active Angle — `add_document_ids` when `item.documentId` is present (real `FindingDocument`), narrative annotation otherwise — or opens the picker when no Angle is active. `onPickerPick` is async.

**Files:**
- Create: `frontend/src/hooks/useFeederActions.ts`, `frontend/src/hooks/useFeederActions.test.tsx`

**Interfaces:**
- Consumes: `useCaseWorkspace()` (Task 1); `createAngle(caseId, { title, severity, narrative? })`, `fetchAngle(caseId, id)`, `updateAngle(caseId, id, UpdateFindingBody)` from `../api` (`UpdateFindingBody` already includes `add_document_ids?: UUID[]`, see `types/index.ts:822`); `toast` from `sonner`.
- Produces:
  ```ts
  interface CiteItem { label: string; documentId?: string }
  interface FeederActions {
    startAngleFrom: (seed: { title: string; item?: CiteItem }) => Promise<{ id: string; title: string } | null>;
    citeToAngle: (item: CiteItem) => Promise<void>;
    pickerOpen: boolean;
    closePicker: () => void;
    onPickerPick: (angleId: string | null) => Promise<boolean>;
  }
  function useFeederActions(caseId: string): FeederActions
  ```
- **Behavior contract:**
  - `startAngleFrom({title, item?})` → `createAngle(caseId, { title, severity: "MEDIUM" })`; if `item`, `applyCite(angle.id, item)`; else `setActiveAngle` + toast `Started angle "<title>"`. Returns `{id,title}` or `null` on error.
  - `applyCite(angleId, item)`: `fetchAngle` (for title + active-state). If `item.documentId` → `updateAngle({ add_document_ids: [documentId] })` ONLY — no narrative rewrite (review #3: atomic link, no clobber) — + toast `Cited document into "<title>"`. Else → `updateAngle({ narrative: old + "\n\n[Cited: <label>]" })` + toast `Cited into "<title>"`. Sets active.
  - `citeToAngle(item)`: active set → `applyCite`; none → stash item, open picker.
  - `onPickerPick(angleId)` → `Promise<boolean>`: `null` → `startAngleFrom({ title: item.label, item })` (returns `false` if that returned `null`); non-null → `applyCite(angleId, item)` then `true`; `false` on caught error. Does NOT close the picker or clear the pending item — the modal closes via `onClose` only on a non-`false` result, so failures stay open for retry.

- [ ] **Step 1: Write the failing test**

`frontend/src/hooks/useFeederActions.test.tsx`:
```tsx
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CaseWorkspaceProvider } from "../context/CaseWorkspaceContext";
import { useFeederActions, type FeederActions } from "./useFeederActions";

const createAngleMock = vi.fn();
const fetchAngleMock = vi.fn();
const updateAngleMock = vi.fn();
const toastMock = vi.fn();

vi.mock("../api", () => ({
  createAngle: (...a: unknown[]) => createAngleMock(...a),
  fetchAngle: (...a: unknown[]) => fetchAngleMock(...a),
  updateAngle: (...a: unknown[]) => updateAngleMock(...a),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(
    (...a: unknown[]) => toastMock(...a),
    { error: (...a: unknown[]) => toastMock(...a) }
  ),
}));

function Harness({ grab }: { grab: (f: FeederActions) => void }) {
  const actions = useFeederActions("c1");
  grab(actions);
  return <span data-testid="picker">{actions.pickerOpen ? "open" : "closed"}</span>;
}
function renderHarness(grab: (f: FeederActions) => void) {
  return render(
    <CaseWorkspaceProvider>
      <Harness grab={grab} />
    </CaseWorkspaceProvider>
  );
}

beforeEach(() => {
  createAngleMock.mockReset().mockResolvedValue({ id: "new-1", title: "Seed title", narrative: "" });
  fetchAngleMock.mockReset().mockResolvedValue({ id: "ang-1", title: "Existing", narrative: "old" });
  updateAngleMock.mockReset().mockResolvedValue({ id: "ang-1", title: "Existing", narrative: "updated" });
  toastMock.mockReset();
});

describe("useFeederActions", () => {
  it("startAngleFrom creates an angle WITH severity MEDIUM and returns it", async () => {
    let api: FeederActions = null as never;
    renderHarness((f) => (api = f));
    let result: unknown;
    await act(async () => { result = await api.startAngleFrom({ title: "Seed title" }); });
    expect(createAngleMock).toHaveBeenCalledWith("c1", { title: "Seed title", severity: "MEDIUM" });
    expect(result).toEqual({ id: "new-1", title: "Seed title" });
  });

  it("citeToAngle opens the picker when no angle is active", async () => {
    let api: FeederActions = null as never;
    renderHarness((f) => (api = f));
    await act(async () => { await api.citeToAngle({ label: "a fact" }); });
    expect(screen.getByTestId("picker")).toHaveTextContent("open");
    expect(updateAngleMock).not.toHaveBeenCalled();
  });

  it("picking an existing angle appends a narrative citation (no documentId)", async () => {
    let api: FeederActions = null as never;
    renderHarness((f) => (api = f));
    await act(async () => { await api.citeToAngle({ label: "a fact" }); });
    await act(async () => { await api.onPickerPick("ang-1"); });
    expect(fetchAngleMock).toHaveBeenCalledWith("c1", "ang-1");
    expect(updateAngleMock).toHaveBeenCalledWith("c1", "ang-1", { narrative: "old\n\n[Cited: a fact]" });
  });

  it("picking new creates an angle seeded from the item label", async () => {
    let api: FeederActions = null as never;
    renderHarness((f) => (api = f));
    await act(async () => { await api.citeToAngle({ label: "a fact" }); });
    await act(async () => { await api.onPickerPick(null); });
    expect(createAngleMock).toHaveBeenCalledWith("c1", { title: "a fact", severity: "MEDIUM" });
  });

  it("citing an item WITH a documentId creates a real FindingDocument citation", async () => {
    let api: FeederActions = null as never;
    renderHarness((f) => (api = f));
    // First set an active angle by picking an existing one.
    await act(async () => { await api.citeToAngle({ label: "seed" }); });
    await act(async () => { await api.onPickerPick("ang-1"); });
    updateAngleMock.mockClear();
    // Now the active angle is ang-1; cite a document into it.
    await act(async () => { await api.citeToAngle({ label: "Deed 2019", documentId: "doc-7" }); });
    // Document cite sends ONLY add_document_ids (atomic, no narrative clobber — review #3).
    expect(updateAngleMock).toHaveBeenCalledWith("c1", "ang-1", { add_document_ids: ["doc-7"] });
  });

  it("onPickerPick returns false and keeps the picker open when the API fails", async () => {
    createAngleMock.mockRejectedValueOnce(new Error("boom"));
    let api: FeederActions = null as never;
    renderHarness((f) => (api = f));
    await act(async () => { await api.citeToAngle({ label: "a fact" }); }); // no active → picker opens
    let ok: boolean | undefined;
    await act(async () => { ok = await api.onPickerPick(null); }); // create fails
    expect(ok).toBe(false);
    expect(screen.getByTestId("picker")).toHaveTextContent("open");
  });

  it("creates only ONE angle when the follow-on citation fails (review round 3 #2)", async () => {
    updateAngleMock.mockRejectedValueOnce(new Error("cite boom"));
    let api: FeederActions = null as never;
    renderHarness((f) => (api = f));
    await act(async () => { await api.citeToAngle({ label: "a fact" }); }); // no active → picker opens
    let ok: boolean | undefined;
    await act(async () => { ok = await api.onPickerPick(null); }); // create ok, cite fails
    // The pick "succeeds" (angle exists) so the picker can close; a retry will
    // cite into the now-active angle, never creating a second one.
    expect(createAngleMock).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/useFeederActions.test.tsx`
Expected: FAIL — `Cannot find module './useFeederActions'`.

- [ ] **Step 3: Write the implementation**

`frontend/src/hooks/useFeederActions.ts`:
```ts
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { createAngle, fetchAngle, updateAngle } from "../api";
import { useCaseWorkspace } from "../context/CaseWorkspaceContext";

export interface CiteItem {
  /** Human-readable label for the narrative annotation and as a new-angle title. */
  label: string;
  /** When present, a real FindingDocument citation is created via add_document_ids. */
  documentId?: string;
}

export interface FeederActions {
  startAngleFrom: (seed: { title: string; item?: CiteItem }) => Promise<{ id: string; title: string } | null>;
  citeToAngle: (item: CiteItem) => Promise<void>;
  pickerOpen: boolean;
  closePicker: () => void;
  onPickerPick: (angleId: string | null) => Promise<boolean>;
}

// Backend FindingIntakeSerializer requires a valid severity on create (no default).
const DEFAULT_SEVERITY = "MEDIUM" as const;

export function useFeederActions(caseId: string): FeederActions {
  const { activeAngleId, setActiveAngle } = useCaseWorkspace();
  const [pickerOpen, setPickerOpen] = useState(false);
  const pendingItem = useRef<CiteItem | null>(null);

  // Cite into an existing angle. A documentId produces a real FindingDocument
  // row (chain-of-custody); otherwise we only annotate the narrative.
  const applyCite = useCallback(
    async (angleId: string, item: CiteItem) => {
      const angle = await fetchAngle(caseId, angleId);
      if (item.documentId) {
        // Atomic server-side link only — do NOT rewrite the narrative (review
        // #3: avoids clobbering a concurrent narrative edit). The FindingDocument
        // row is the chain-of-custody record; the [Doc-N] text is cosmetic.
        // Backend get_or_create is idempotent; tell the user which actually happened.
        const already = (angle.document_links ?? []).some(
          (l) => l.document_id === item.documentId
        );
        await updateAngle(caseId, angleId, { add_document_ids: [item.documentId] });
        toast(already ? `Already cited in "${angle.title}".` : `Cited document into "${angle.title}".`);
      } else {
        // Narrative-only annotation (event with no document id). Client
        // read-modify-write: known last-write-wins race (see limitations).
        const narrative = `${angle.narrative ?? ""}\n\n[Cited: ${item.label}]`.trim();
        await updateAngle(caseId, angleId, { narrative });
        toast(`Cited into "${angle.title}".`);
      }
      setActiveAngle({ id: angle.id, title: angle.title });
    },
    [caseId, setActiveAngle]
  );

  const startAngleFrom = useCallback<FeederActions["startAngleFrom"]>(
    async (seed) => {
      let angle: { id: string; title: string };
      try {
        angle = await createAngle(caseId, {
          title: seed.title,
          severity: DEFAULT_SEVERITY,
        });
      } catch {
        toast.error("Failed to start angle.");
        return null;
      }
      // The Angle now exists. Make it the active target IMMEDIATELY so a failed
      // follow-on citation can never lead to a duplicate Angle on retry (review
      // round 3, #2) — the retry cites into this active Angle, not a new one.
      setActiveAngle({ id: angle.id, title: angle.title });
      if (seed.item) {
        try {
          await applyCite(angle.id, seed.item);
        } catch {
          toast.error(`Angle "${angle.title}" created, but the citation failed — retry the cite.`);
        }
      } else {
        toast(`Started angle "${angle.title}".`);
      }
      return { id: angle.id, title: angle.title };
    },
    [caseId, setActiveAngle, applyCite]
  );

  const citeToAngle = useCallback<FeederActions["citeToAngle"]>(
    async (item) => {
      if (activeAngleId) {
        try {
          await applyCite(activeAngleId, item);
        } catch {
          toast.error("Failed to cite into angle.");
        }
        return;
      }
      pendingItem.current = item;
      setPickerOpen(true);
    },
    [activeAngleId, applyCite]
  );

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    pendingItem.current = null;
  }, []);

  const onPickerPick = useCallback<FeederActions["onPickerPick"]>(
    async (angleId) => {
      const item = pendingItem.current;
      if (!item) return true;
      // Do NOT close the picker or clear pendingItem here. The modal closes via
      // onClose (= closePicker) only on a non-false result, so a failure leaves
      // the picker open with the pending item intact for retry (review #4).
      try {
        if (angleId === null) {
          const created = await startAngleFrom({ title: item.label, item });
          return created !== null;
        }
        await applyCite(angleId, item);
        return true;
      } catch {
        toast.error("Failed to cite into angle.");
        return false;
      }
    },
    [startAngleFrom, applyCite]
  );

  return { startAngleFrom, citeToAngle, pickerOpen, closePicker, onPickerPick };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/useFeederActions.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Type check + commit**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean. (If `createAngle`'s param type rejects `severity: "MEDIUM"`, that means `FindingItem["severity"]` does not include the literal — it does; no change expected.)

```bash
git add frontend/src/hooks/useFeederActions.ts frontend/src/hooks/useFeederActions.test.tsx
git commit -m "feat(frontend): useFeederActions (real doc citation, narrative fallback, severity default)"
```

---

### Task 4: Wire feeders + persistent Research outcomes

Kill the two dead-end toasts; surface a **persistent** add-to-case outcome on every Research triage action.

**Files:**
- Modify: `frontend/src/types/index.ts`, `frontend/src/api/research.ts`, `frontend/src/views/ResearchTab.tsx`, `frontend/src/views/CaseDetailView.tsx`
- Create: `frontend/src/views/ResearchTab.test.tsx`

**Interfaces:**
- Consumes: `useFeederActions` (Task 3), `AnglePickerModal` (Task 2).
- Produces: `AddToCaseResult` (types); `outcomeLabel(result: AddToCaseResult): string` (exported from `ResearchTab`).

- [ ] **Step 1: Add `AddToCaseResult` and re-type the API client**

In `frontend/src/types/index.ts` (matches `api_research_add_to_case` JSON: `{ created, entity, duplicate }`):
```ts
export interface AddToCaseResult {
  created: "organization" | "property" | "person" | "note";
  entity: Record<string, unknown>;
  duplicate: boolean;
}
```

In `frontend/src/api/research.ts`, add `AddToCaseResult` to the type import and change the return type:
```ts
export async function addResearchToCase(
  caseId: string,
  data: {
    source: "irs" | "ohio-sos" | "ohio-aos" | "parcels";
    data: Record<string, unknown>;
  }
): Promise<AddToCaseResult> {
  return fetchApi<AddToCaseResult>(`/api/cases/${caseId}/research/add-to-case/`, {
    method: "POST",
    body: data,
  });
}
```

- [ ] **Step 2: Write the failing `outcomeLabel` test**

`frontend/src/views/ResearchTab.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { outcomeLabel } from "./ResearchTab";

describe("outcomeLabel", () => {
  it("created knot", () => {
    expect(outcomeLabel({ created: "organization", entity: {}, duplicate: false }))
      .toBe("Created organization knot");
  });
  it("duplicate", () => {
    expect(outcomeLabel({ created: "property", entity: {}, duplicate: true }))
      .toBe("Already in case");
  });
  it("note", () => {
    expect(outcomeLabel({ created: "note", entity: {}, duplicate: false }))
      .toBe("Saved as note");
  });
  it("property", () => {
    expect(outcomeLabel({ created: "property", entity: {}, duplicate: false }))
      .toBe("Created property record");
  });
  it("person (default branch)", () => {
    expect(outcomeLabel({ created: "person", entity: {}, duplicate: false }))
      .toBe("Created person knot");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/views/ResearchTab.test.tsx`
Expected: FAIL — `outcomeLabel` not exported.

- [ ] **Step 4: Add `outcomeLabel`, an outcome store, and persistent rendering in `ResearchTab`**

In `frontend/src/views/ResearchTab.tsx`:

1. Add `toast` import and `AddToCaseResult` to the type import:
```tsx
import { toast } from "sonner";
import type {
  IrsSearchJobResult,
  IrsFilingResult,
  SyncResearchResponse,
  DeceasedPerson,
  AddToCaseResult,
} from "../types";
```

2. Add the exported helper after `resultLabel` (~line 84):
```tsx
export function outcomeLabel(result: AddToCaseResult): string {
  if (result.duplicate) return "Already in case";
  if (result.created === "note") return "Saved as note";
  if (result.created === "property") return "Created property record";
  return `Created ${result.created} knot`;
}
```

3. Give `TriageOption` an optional persistent outcome. Change its props + sub-label (the component around lines 86–122):
```tsx
interface TriageOptionProps {
  label: string;
  detail: string;
  done: boolean;
  outcome?: string;
  disabled?: boolean;
  onSelect: () => Promise<void>;
}

function TriageOption({ label, detail, done, outcome, disabled = false, onSelect }: TriageOptionProps) {
  const [working, setWorking] = useState(false);
  async function handleClick() {
    if (done || disabled || working) return;
    setWorking(true);
    try {
      await onSelect();
    } finally {
      setWorking(false);
    }
  }
  return (
    <button
      type="button"
      className="add-option"
      onClick={() => void handleClick()}
      disabled={done || disabled || working}
    >
      <span className="add-option__title">
        {working && <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />}
        {done && <Check size={12} />}
        {label}
      </span>
      <span className="add-option__sub">{done ? (outcome ?? "Done") : detail}</span>
    </button>
  );
}
```

4. **Hoist triage state out of `ResearchTab` (review #2 — survive tab switches).** `ResearchTab` currently owns `triagedKeys` + `markTriaged` as local `useState` (~lines 624–628), which Radix `Tabs.Content` unmounts on every tab switch — wiping triage state. Replace that local state with props owned by `CaseDetailViewInner` (step 6). Change `ResearchTabProps`:
```tsx
interface ResearchTabProps {
  caseId: string;
  /** Triage state is owned by CaseDetailViewInner so it survives tab switches.
      (Durable, backend-derived "already in case" state is a follow-up.) */
  triagedKeys: Set<string>;
  onTriaged: (key: string) => void;
  triageOutcomes: Map<string, string>;
  onTriageOutcome: (key: string, label: string) => void;
}
```
Delete the local `triagedKeys` state and `markTriaged` (~lines 624–628). In the component body, destructure the new props and use them directly (replace every `markTriaged` call with `onTriaged`).

5. Thread the four triage props into the three result tables. Add to each table's props interface:
```tsx
  triageOutcomes: Map<string, string>;
  onOutcome: (key: string, label: string) => void;
```
(they already declare `triagedKeys` + `onTriaged`.) Pass at each call site:
`<IrsResultsTable ... triagedKeys={triagedKeys} onTriaged={onTriaged} triageOutcomes={triageOutcomes} onOutcome={onTriageOutcome} />` — same for `SyncResultsTable` and `ParcelResults`.

6. Update each handler to record a persistent outcome and pass `outcome=` to its `TriageOption`s.

   **IRS table** — handlers (~lines 177–197):
   ```tsx
     async function handleFetch990s(r: IrsFilingResult) {
       await fetch990s(caseId, { ein: r.ein });
       const k = triageKey("irs", rowKey(r), "fetch-990s");
       onOutcome(k, "Fetched documents");
       toast("Fetched documents");
       onTriaged(k);
     }
     async function handleSaveNote(r: IrsFilingResult) {
       await createNote(caseId, {
         target_type: "case",
         target_id: caseId,
         content: `IRS: ${r.taxpayer_name} EIN:${r.ein} ${r.tax_year}`,
       });
       const k = triageKey("irs", rowKey(r), "save-note");
       onOutcome(k, "Saved as note");
       toast("Saved as note");
       onTriaged(k);
     }
     async function handleCreateOrg(r: IrsFilingResult) {
       const result = await addResearchToCase(caseId, {
         source: "irs",
         data: r as unknown as Record<string, unknown>,
       });
       const k = triageKey("irs", rowKey(r), "create-org");
       const label = outcomeLabel(result);
       onOutcome(k, label);
       toast(label);
       onTriaged(k);
     }
   ```
   and on each `<TriageOption>` add `outcome={triageOutcomes.get(fetchKey)}` / `…get(orgKey)` / `…get(noteKey)` respectively.

   **Sync table** — `handleCreateOrg` / `handleSaveNote` (~lines 298–314):
   ```tsx
     async function handleCreateOrg(r: Record<string, unknown>, idx: number) {
       const result = await addResearchToCase(caseId, { source, data: r });
       const k = triageKey(source, idx, source === "ohio-aos" ? "save-note" : "create-org");
       const label = outcomeLabel(result);
       onOutcome(k, label);
       toast(label);
       onTriaged(k);
     }
     async function handleSaveNote(r: Record<string, unknown>, idx: number) {
       const label = resultLabel(r, `Result ${idx + 1}`);
       await createNote(caseId, {
         target_type: "case",
         target_id: caseId,
         content: `Research result: ${label} — ${JSON.stringify(r).slice(0, 200)}`,
       });
       const k = triageKey(source, idx, "save-note");
       onOutcome(k, "Saved as note");
       toast("Saved as note");
       onTriaged(k);
     }
   ```
   and add `outcome={triageOutcomes.get(createKey)}` / `…get(noteKey)` to the matching `<TriageOption>`s.

   **Parcel results** — `handleCreateProperty` / `handleSaveNote` (~lines 529–545):
   ```tsx
     async function handleCreateProperty(row: ParcelResult, idx: number) {
       const result = await addResearchToCase(caseId, { source: "parcels", data: { ...row } });
       const k = triageKey("parcels", row.pin ?? idx, "create-property");
       const label = outcomeLabel(result);
       onOutcome(k, label);
       toast(label);
       onTriaged(k);
     }
     async function handleSaveNote(row: ParcelResult, idx: number) {
       const label = row.pin ? `Parcel ${row.pin}` : `Parcel result ${idx + 1}`;
       await createNote(caseId, {
         target_type: "case",
         target_id: caseId,
         content: `${label}: ${row.owner1 ?? "Unknown owner"} — ${JSON.stringify(row).slice(0, 220)}`,
       });
       const k = triageKey("parcels", row.pin ?? idx, "save-note");
       onOutcome(k, "Saved as note");
       toast("Saved as note");
       onTriaged(k);
     }
   ```
   and add `outcome={triageOutcomes.get(propertyKey)}` / `…get(noteKey)` to the matching `<TriageOption>`s.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/views/ResearchTab.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Kill the two dead-ends in `CaseDetailView` + render the picker**

In `frontend/src/views/CaseDetailView.tsx` (`CaseDetailViewInner`):

1. Add imports (and add `useCallback` to the existing `react` import on line 1):
```tsx
import { useFeederActions } from "../hooks/useFeederActions";
import AnglePickerModal from "../components/AnglePickerModal";
```

2. After the `useCaseWorkspace()` line, add the feeder hook and the hoisted triage state (hooks run unconditionally; feeder actions are only reachable once a case is loaded, so `id ?? ""` never fires a request):
```tsx
  const feeder = useFeederActions(id ?? "");
  const [triagedKeys, setTriagedKeys] = useState<Set<string>>(new Set());
  const [triageOutcomes, setTriageOutcomes] = useState<Map<string, string>>(new Map());
  const markTriaged = useCallback(
    (key: string) => setTriagedKeys((p) => new Set(p).add(key)),
    []
  );
  const recordTriageOutcome = useCallback(
    (key: string, label: string) => setTriageOutcomes((p) => new Map(p).set(key, label)),
    []
  );
```

2b. Pass the triage state into `ResearchTab` (currently `<ResearchTab caseId={id} />` in the research `Tabs.Content`):
```tsx
            <ResearchTab
              caseId={id}
              triagedKeys={triagedKeys}
              onTriaged={markTriaged}
              triageOutcomes={triageOutcomes}
              onTriageOutcome={recordTriageOutcome}
            />
```

2c. Add the global active-Angle indicator to the header so one-click cites are never blind (review #1). Inside `case-shell-header__right` (around lines 122–142), before the `StatusSelector`, add:
```tsx
              {activeAngleId && (
                <span className="active-angle-chip" title="Citations target this angle">
                  Active angle: {activeAngleTitle || "Untitled"}
                  <button
                    type="button"
                    className="active-angle-chip__clear"
                    aria-label="Clear active angle"
                    onClick={() => setActiveAngle(undefined)}
                  >
                    ×
                  </button>
                </span>
              )}
```
Add these styles to `frontend/src/index.css` (the project's single global stylesheet; the `var(--*)` tokens are already used across the app):
```css
.active-angle-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border: 1px solid var(--border-1);
  border-radius: 999px;
  font-size: 12px;
  color: var(--text-2);
  background: var(--bg-1);
  white-space: nowrap;
}
.active-angle-chip__clear {
  border: none;
  background: none;
  color: var(--text-3);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
}
.active-angle-chip__clear:hover {
  color: var(--text-1);
}
```

3. Replace the Financials `onStartAngle` dead-end (lines 184–187) — NO `setActiveTab` (stay-in-place):
```tsx
              onStartAngle={(prefilledName) => {
                void feeder.startAngleFrom({ title: prefilledName });
              }}
```

4. Replace the Timeline `onCiteInAngle` dead-end (lines 199–214). A `document`-layer event's `id` is the source document id, so cite it for real; other layers annotate the narrative:
```tsx
              onCiteInAngle={async (event: TimelineEvent) => {
                await feeder.citeToAngle({
                  label: `${event.label} — ${event.date}`,
                  documentId: event.layer === "document" ? event.id : undefined,
                });
              }}
```
Keep `activeAngleId={activeAngleId}` on `TimelineTab`.

5. Render the picker once, right after `</Tabs.Root>` (before the outer closing `</div>`):
```tsx
      {id && (
        <AnglePickerModal
          caseId={id}
          open={feeder.pickerOpen}
          onClose={feeder.closePicker}
          onPick={feeder.onPickerPick}
        />
      )}
```

6. Remove now-unused imports: the old inline Timeline cite used `fetchAngle` and `updateAngle` from `../api` (line 5). Search the file; if unreferenced, drop them (keep `fetchCase`, `updateCase`).

- [ ] **Step 7: Type check + full suite + diff review**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

Read the diff and confirm:
- No banned vocabulary in user-visible strings (`outcomeLabel` returns "knot"/"note"/"property record"/"organization" — all allowed; "Active angle" chip text is fine).
- Neither feeder callback calls `setActiveTab` (stay-in-place).
- The active-Angle chip reads `activeAngleTitle` from context and clears via `setActiveAngle(undefined)`.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/api/research.ts frontend/src/views/ResearchTab.tsx frontend/src/views/ResearchTab.test.tsx frontend/src/views/CaseDetailView.tsx frontend/src/index.css
git commit -m "feat(frontend): wire feeders, kill dead-ends, persistent outcomes, active-angle indicator"
```

---

## Out of scope (follow-up plans)

- **WS-GAP-7 dedupe / enrich-vs-create + provenance snapshot (backend).** `api_research_add_to_case` should fuzzy-match a result against existing case knots (reuse `FuzzyMatchCandidate`), offer "enrich existing" vs "create new", and store the source connector + raw snapshot. Own plan, grounded in the `FuzzyMatchCandidate` model + org/person creation path. When it lands, add `"enriched"` to `AddToCaseResult.created` + an `outcomeLabel` branch.
- **`activeEntityId` consumers + remaining producers.** Only Web knot click sets it here. Research-row and Financials selection producers, and the context-panel that *reads* it, are build item 3.
- **Real document citation from the Timeline.** Step 6.4 assumes a `document`-layer event's `id` is the document UUID. If runtime verification (below) shows it is not, change that caller to narrative-only and add `document_id` to the `TimelineEvent` contract as a small backend follow-up.
- **`createAngle` type/contract fix.** TS marks `severity` optional but the backend requires it. This plan sends `"MEDIUM"`; a cleaner fix is to make `severity` required in the TS type (and/or give the serializer a default) — separate change.
- **Atomic backend cite endpoint (review #3).** A narrative-only cite still does a client read-modify-write (last-write-wins vs a concurrent narrative edit). A `POST /api/cases/:id/findings/:id/cite/` that appends narrative + links documents in one server-side transaction would remove the race for all cite paths. Document cites already avoid it (atomic `add_document_ids`).
- **Durable triage state (review #2).** Hoisting to `CaseDetailViewInner` survives tab switches but not navigating away from the case. Deriving "already in case" from the backend (existing entity links) on mount would make it durable + correct across sessions.
- Build-sequence items 2–5 (tie-off gate + credibility counts; context-panel three-state; RecipientGap; replay hybrid + connectedness).

---

## Self-Review

**1. Spec + review coverage:**
- Shared `activeEntity`/`activeAngle` state → Task 1. ✅
- **Cite creates real FindingDocument rows when a doc id exists** (review #1) → Task 3 `applyCite` `add_document_ids` branch + Task 3 test #5. ✅
- **`createAngle` sends `severity: "MEDIUM"`** (review #2) → Task 3 `DEFAULT_SEVERITY` + test #1/#4. ✅
- **`activeEntityId` wired** (review #3) → Task 1 step 5.6 (Web knot click); remaining producers/consumer explicitly deferred. ✅
- **Persistent Research outcomes incl. note/990s paths** (review #4) → Task 4 `triageOutcomes` + per-handler `onOutcome`. ✅
- **Active-Angle title from source, not `""`** (review #5) → Task 1 steps 5.2–5.5 (`onAngleActive` reports `{id,title}`). ✅
- **`onPickerPick` async + awaited** (review #6) → Task 3 signature + tests `await`; modal awaits in Task 2. ✅
- Stay-in-place; picker "+ New Angle from this" first → Tasks 2 + 4. ✅
- **Global active-Angle indicator** (review round 2, #1) → Task 4 step 6.2c (header chip + clear). ✅
- **Triage outcomes survive tab switches** (round 2, #2) → Task 4 steps 4–5 + 6.2 (hoisted to `CaseDetailViewInner`; durable backend version deferred). ✅
- **No narrative clobber on document cites** (round 2, #3) → Task 3 `applyCite` doc branch sends only `add_document_ids`; narrative-cite race documented + atomic endpoint deferred. ✅
- **Failed picker cite stays open + retryable** (round 2, #4) → Task 2 `handlePick` (`ok !== false`) + Task 3 `onPickerPick: Promise<boolean>`; tests in both. ✅
- **Picker/hook return types consistent** (round 3, #1) → impl snippets now match interfaces: modal `onPick: boolean | void | Promise<boolean | void>`; hook `onPickerPick: Promise<boolean>`. ✅
- **No duplicate Angle on partial failure** (round 3, #2) → Task 3 `startAngleFrom` sets the created Angle active before citing; a failed cite returns the (existing) Angle so retry targets it. New test asserts `createAngle` called once. ✅
- **Honest duplicate-cite messaging** (round 3, #3) → Task 3 `applyCite` checks `document_links` and toasts "Already cited" vs "Cited document into". ✅
- **`activeEntityId` scope is explicit** (round 3, #4) → Global Constraints: producer-only, no consumer this phase. ✅
- **Timeline `event.id` as document id confirmed valid** (round 3, #5) by reviewer — document-layer events use the document PK; financial/transaction stay narrative-only. ✅

**2. Placeholder scan:** every code step shows complete code; the three Research tables get full handler code (not "similar to"). ✅

**3. Type consistency:** `ActiveAngle {id,title}` identical across Tasks 1/3/4; `CiteItem` defined in Task 3 before use; `add_document_ids` confirmed on `UpdateFindingBody` (`types/index.ts:822`); `createAngle`/`fetchAngle`/`updateAngle` signatures match `api/cases.ts`; `AddToCaseResult` defined before use (Task 4 step 1). ✅

> **Runtime verification (verify skill) — required after Task 4:** run the app (Docker stack or real browser against the Vite port — heed the WSL2/HMR caveat). Drive: Financials → "Start Angle" (toast, no tab switch); Timeline → "Cite" with active Angle and without (picker, "+ New Angle from this" first); **confirm a Timeline document-layer cite actually adds the document to the Angle's `document_links` / referral PDF** (validates the `event.id === documentId` assumption — if it fails, switch that caller to narrative-only); Research → create a knot twice (row shows "Created … knot" then "Already in case"), then **switch tabs and back — the labels must persist** (review #2); confirm the **active-Angle chip shows in the header from every tab** and clears on × (review #1), and that a **forced cite failure keeps the picker open** for retry (review #4); save note ("Saved as note"), fetch 990s ("Fetched documents"