# Case Map Phase 2 — Right Inspector Workspace — Implementation Plan (TDD)

> **Workflow:** RED/GREEN per the `tdd-workflow` skill (writing-plans not used here). Each task:
> write failing test → run RED → minimal impl → run GREEN → commit. Steps use `- [ ]`.

**Goal:** Turn the Investigate tab into a persistent Case Map + fixed right inspector driven by a
single focus reducer, replacing `navStack` + the `onAngleActive` callback, and adding Subject /
Relationship / Thread inspectors + a "What's Missing" idle rail — deleting the retired legacy.

**Architecture:** `CaseWorkspaceContext` becomes a `useReducer` with **two tiers** — `Selection`
(transient inspector state; map stays visible) vs `Frame` history (full-width views; breadcrumb).
Inspectors compose data already fetched (`/case-map/`, `fetchEntityDetail`, `fetchNotes`,
`fetchAngle`, `referral-readiness`). Frontend only; no backend changes.

**Tech Stack:** React + TS + Vite, Vitest + @testing-library/react. `tsc --noEmit` is the gate (no ESLint).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-20-case-map-phase-2-right-inspector-design.md` (D-rules,
  §3 reducer, §4 layout + §4.1 deletion checklist, §5 inspectors, §6 What's Missing, §8a order).
  **Controlling spec:** `2026-06-19-case-map-and-thread-builder-design.md`.
- **THE RULE:** *Selection is inspector state. Frame is history.* `select*` never pushes history;
  `open*` pushes a full-width frame; `activateThread` touches neither (pointer only).
- **No parallel local state** in `InvestigateTab`: `navStack`, `webSelectedEdge`,
  `selectedSummaryEdge`, `sameEntry`, `navigate*` are deleted (live in the reducer). Local state that
  stays: fetched data, modal open/close, minimap, loading/error, entity-detail cache, Lead job.
- **No compatibility shims:** old `setActiveEntity`/`setActiveAngle` are removed, not kept.
- **Delete retired code** in the task that removes its last caller (§4.1): `ConnectionDetailPanel.tsx`
  (only caller is InvestigateTab), `WebRightPanel` idle body, `NavEntry`/`entryLabel`/etc.
- **Do NOT touch `/graph/`, the Timeline, or the tie-off gate.** Substantiation stays in full AngleView.
- **Inspectors are read-from-existing-endpoints only.** No new backend.
- **Commands:** `cd frontend && npx vitest run <path>`; `npx tsc --noEmit`. Branch: `case-map-phase-2`
  (already created). Commit after each green task. Push/PR is outward — confirm with Tyler.

## File Structure

- **Modify** `context/CaseWorkspaceContext.tsx` — `useState` → `useReducer`; `Frame`/`Selection`/
  actions; keep selector names. **Rewrite** `context/CaseWorkspaceContext.test.tsx`.
- **Modify** `hooks/useFeederActions.ts` (+ `.test.tsx`) — `setActiveAngle` → `activateThread`.
- **Modify** `views/CaseDetailView.tsx` — delete the bridge; chip → `clearActiveAngle`; deep-links → `openThread`.
- **Modify** `views/InvestigateTab.tsx` — migrate to reducer; delete legacy; readiness in load/refresh.
- **Create** `components/ContextPanel.tsx` (+ test) — the map-mode inspector switch.
- **Modify** `components/RelationshipSummaryPanel.tsx` (+ test) — extend (§5.2).
- **Create** `components/SubjectInspector.tsx` (+ test), `components/ThreadInspector.tsx` (+ test),
  `components/WhatsMissingPanel.tsx` (+ test).
- **Delete** `components/ConnectionDetailPanel.tsx` (+ its test refs) in Task 5.

---

### Task 1: Focus reducer (`CaseWorkspaceContext` → `useReducer`)

**Files:** Modify `context/CaseWorkspaceContext.tsx`; rewrite `context/CaseWorkspaceContext.test.tsx`.

**Interfaces produced:** `Frame`, `Selection`, and `useCaseWorkspace()` exposing `currentFrame`,
`history`, `selection`, `activeEntityId/activeAngleId/activeAngleTitle`, and actions
`selectSubject`, `selectRelationship`, `selectThread`, `activateThread`, `clearSelection`,
`openProfile`, `openThread`, `openDocument`, `goBack`, `goTo`, `clearActiveAngle`.

- [ ] **Step 1: Write the failing tests** (replace the whole test file)

```tsx
// context/CaseWorkspaceContext.test.tsx
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CaseWorkspaceProvider, useCaseWorkspace } from "./CaseWorkspaceContext";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <CaseWorkspaceProvider>{children}</CaseWorkspaceProvider>
);
const setup = () => renderHook(() => useCaseWorkspace(), { wrapper });

describe("focus reducer", () => {
  it("defaults to web frame, no selection, no pointers", () => {
    const { result } = setup();
    expect(result.current.currentFrame).toEqual({ kind: "web" });
    expect(result.current.selection).toEqual({ kind: "none" });
    expect(result.current.activeAngleId).toBeUndefined();
  });

  it("selectSubject sets selection + entity pointer but NEVER pushes history", () => {
    const { result } = setup();
    act(() => result.current.selectSubject("p1"));
    expect(result.current.selection).toEqual({ kind: "subject", id: "p1" });
    expect(result.current.activeEntityId).toBe("p1");
    expect(result.current.history).toHaveLength(1); // still [web]
  });

  it("selectRelationship sets selection only, no history, no pointer change", () => {
    const { result } = setup();
    act(() => result.current.selectThread("a1", "T")); // pointer set
    act(() => result.current.selectRelationship("p1__p2"));
    expect(result.current.selection).toEqual({ kind: "relationship", edgeId: "p1__p2" });
    expect(result.current.history).toHaveLength(1);
    expect(result.current.activeAngleId).toBe("a1"); // unchanged by selectRelationship
  });

  it("selectThread sets selection + angle pointer (map-mode cite target)", () => {
    const { result } = setup();
    act(() => result.current.selectThread("a1", "Self-dealing"));
    expect(result.current.selection).toEqual({ kind: "thread", id: "a1" });
    expect(result.current.activeAngleId).toBe("a1");
    expect(result.current.activeAngleTitle).toBe("Self-dealing");
    expect(result.current.history).toHaveLength(1);
  });

  it("activateThread sets the pointer WITHOUT mutating selection or history", () => {
    const { result } = setup();
    act(() => result.current.selectSubject("p1"));
    act(() => result.current.activateThread({ id: "a9", title: "From feeder" }));
    expect(result.current.activeAngleId).toBe("a9");
    expect(result.current.selection).toEqual({ kind: "subject", id: "p1" }); // unchanged
    expect(result.current.history).toHaveLength(1); // unchanged
  });

  it("openThread pushes an angle frame, clears selection, sets pointer", () => {
    const { result } = setup();
    act(() => result.current.selectSubject("p1"));
    act(() => result.current.openThread({ id: "a1", title: "T" }));
    expect(result.current.currentFrame).toEqual({ kind: "angle", id: "a1", title: "T" });
    expect(result.current.history).toHaveLength(2);
    expect(result.current.selection).toEqual({ kind: "none" });
    expect(result.current.activeAngleId).toBe("a1");
  });

  it("open* dedups when the top frame already matches", () => {
    const { result } = setup();
    act(() => result.current.openThread({ id: "a1", title: "T" }));
    act(() => result.current.openThread({ id: "a1", title: "T" }));
    expect(result.current.history).toHaveLength(2); // not 3
  });

  it("openDocument preserves the active thread (cite-into-thread invariant)", () => {
    const { result } = setup();
    act(() => result.current.openThread({ id: "a1", title: "T" }));
    act(() => result.current.openDocument({ id: "d1", name: "Deed" }));
    expect(result.current.currentFrame).toEqual({ kind: "document", id: "d1", name: "Deed" });
    expect(result.current.activeAngleId).toBe("a1"); // still active
  });

  it("goBack recomputes pointers: doc-opened-from-thread, go back, thread still active", () => {
    const { result } = setup();
    act(() => result.current.openThread({ id: "a1", title: "T" }));
    act(() => result.current.openDocument({ id: "d1", name: "Deed" }));
    act(() => result.current.goBack());
    expect(result.current.currentFrame).toEqual({ kind: "angle", id: "a1", title: "T" });
    expect(result.current.activeAngleId).toBe("a1");
  });

  it("goTo truncates and recomputes (back to web clears the angle pointer)", () => {
    const { result } = setup();
    act(() => result.current.openThread({ id: "a1", title: "T" }));
    act(() => result.current.goTo(0));
    expect(result.current.currentFrame).toEqual({ kind: "web" });
    expect(result.current.activeAngleId).toBeUndefined();
  });

  it("clearActiveAngle nulls the pointer without touching history", () => {
    const { result } = setup();
    act(() => result.current.openThread({ id: "a1", title: "T" }));
    act(() => result.current.clearActiveAngle());
    expect(result.current.activeAngleId).toBeUndefined();
    expect(result.current.history).toHaveLength(2); // unchanged
  });

  it("throws outside a provider", () => {
    expect(() => renderHook(() => useCaseWorkspace())).toThrow(/CaseWorkspaceProvider/);
  });
});
```

- [ ] **Step 2: Run RED** — `cd frontend && npx vitest run src/context/CaseWorkspaceContext.test.tsx`
  Expected: FAIL (new API not present; old setters gone).

- [ ] **Step 3: Implement the reducer** (replace the whole file)

```tsx
// context/CaseWorkspaceContext.tsx
import { createContext, useContext, useMemo, useReducer, type ReactNode } from "react";
import type { EntityType } from "../types";

export type Frame =
  | { kind: "web" }
  | { kind: "profile"; id: string; entityType: EntityType; name: string }
  | { kind: "angle"; id: string; title: string }
  | { kind: "document"; id: string; name: string };

export type Selection =
  | { kind: "none" }
  | { kind: "subject"; id: string }
  | { kind: "relationship"; edgeId: string }
  | { kind: "thread"; id: string };

interface FocusState {
  history: Frame[];
  selection: Selection;
  activeEntityId: string | undefined;
  activeAngleId: string | undefined;
  activeAngleTitle: string | undefined;
}

type Action =
  | { type: "selectSubject"; id: string }
  | { type: "selectRelationship"; edgeId: string }
  | { type: "selectThread"; id: string; title: string }
  | { type: "activateThread"; id: string; title: string }
  | { type: "clearSelection" }
  | { type: "openProfile"; id: string; entityType: EntityType; name: string }
  | { type: "openThread"; id: string; title: string }
  | { type: "openDocument"; id: string; name: string }
  | { type: "goBack" }
  | { type: "goTo"; index: number }
  | { type: "clearActiveAngle" };

const INITIAL: FocusState = {
  history: [{ kind: "web" }],
  selection: { kind: "none" },
  activeEntityId: undefined,
  activeAngleId: undefined,
  activeAngleTitle: undefined,
};

const NONE: Selection = { kind: "none" };

/** nearest matching frame scanning top → bottom (the §3.3 invariant). */
function recompute(history: Frame[]) {
  let activeEntityId: string | undefined;
  let activeAngleId: string | undefined;
  let activeAngleTitle: string | undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    const f = history[i];
    if (activeAngleId === undefined && f.kind === "angle") {
      activeAngleId = f.id;
      activeAngleTitle = f.title;
    }
    if (activeEntityId === undefined && f.kind === "profile") {
      activeEntityId = f.id;
    }
  }
  return { activeEntityId, activeAngleId, activeAngleTitle };
}

function sameTop(history: Frame[], frame: Frame): boolean {
  const top = history[history.length - 1];
  if (top.kind !== frame.kind) return false;
  if (top.kind === "web" || frame.kind === "web") return top.kind === frame.kind;
  return (top as { id: string }).id === (frame as { id: string }).id;
}

function pushDedup(history: Frame[], frame: Frame): Frame[] {
  return sameTop(history, frame) ? history : [...history, frame];
}

function reducer(state: FocusState, action: Action): FocusState {
  switch (action.type) {
    case "selectSubject":
      return { ...state, selection: { kind: "subject", id: action.id }, activeEntityId: action.id };
    case "selectRelationship":
      return { ...state, selection: { kind: "relationship", edgeId: action.edgeId } };
    case "selectThread":
      return {
        ...state,
        selection: { kind: "thread", id: action.id },
        activeAngleId: action.id,
        activeAngleTitle: action.title,
      };
    case "activateThread":
      return { ...state, activeAngleId: action.id, activeAngleTitle: action.title };
    case "clearSelection":
      return { ...state, selection: NONE };
    case "openProfile": {
      const history = pushDedup(state.history, {
        kind: "profile", id: action.id, entityType: action.entityType, name: action.name,
      });
      return { ...state, history, selection: NONE, activeEntityId: action.id };
    }
    case "openThread": {
      const history = pushDedup(state.history, { kind: "angle", id: action.id, title: action.title });
      return { ...state, history, selection: NONE, activeAngleId: action.id, activeAngleTitle: action.title };
    }
    case "openDocument": {
      const history = pushDedup(state.history, { kind: "document", id: action.id, name: action.name });
      return { ...state, history, selection: NONE }; // pointers unchanged (cite-into-thread)
    }
    case "goBack": {
      if (state.history.length <= 1) return { ...state, selection: NONE };
      const history = state.history.slice(0, -1);
      return { ...state, history, selection: NONE, ...recompute(history) };
    }
    case "goTo": {
      const history = state.history.slice(0, Math.max(0, action.index) + 1);
      return { ...state, history, selection: NONE, ...recompute(history) };
    }
    case "clearActiveAngle":
      return { ...state, activeAngleId: undefined, activeAngleTitle: undefined };
    default:
      return state;
  }
}

export interface CaseWorkspaceState {
  currentFrame: Frame;
  history: Frame[];
  selection: Selection;
  activeEntityId: string | undefined;
  activeAngleId: string | undefined;
  activeAngleTitle: string | undefined;
  selectSubject: (id: string) => void;
  selectRelationship: (edgeId: string) => void;
  selectThread: (id: string, title: string) => void;
  activateThread: (a: { id: string; title: string }) => void;
  clearSelection: () => void;
  openProfile: (e: { id: string; entityType: EntityType; name: string }) => void;
  openThread: (a: { id: string; title: string }) => void;
  openDocument: (d: { id: string; name: string }) => void;
  goBack: () => void;
  goTo: (index: number) => void;
  clearActiveAngle: () => void;
}

const CaseWorkspaceContext = createContext<CaseWorkspaceState | null>(null);

export function CaseWorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const value = useMemo<CaseWorkspaceState>(
    () => ({
      currentFrame: state.history[state.history.length - 1],
      history: state.history,
      selection: state.selection,
      activeEntityId: state.activeEntityId,
      activeAngleId: state.activeAngleId,
      activeAngleTitle: state.activeAngleTitle,
      selectSubject: (id) => dispatch({ type: "selectSubject", id }),
      selectRelationship: (edgeId) => dispatch({ type: "selectRelationship", edgeId }),
      selectThread: (id, title) => dispatch({ type: "selectThread", id, title }),
      activateThread: (a) => dispatch({ type: "activateThread", id: a.id, title: a.title }),
      clearSelection: () => dispatch({ type: "clearSelection" }),
      openProfile: (e) => dispatch({ type: "openProfile", ...e }),
      openThread: (a) => dispatch({ type: "openThread", ...a }),
      openDocument: (d) => dispatch({ type: "openDocument", ...d }),
      goBack: () => dispatch({ type: "goBack" }),
      goTo: (index) => dispatch({ type: "goTo", index }),
      clearActiveAngle: () => dispatch({ type: "clearActiveAngle" }),
    }),
    [state]
  );
  return <CaseWorkspaceContext.Provider value={value}>{children}</CaseWorkspaceContext.Provider>;
}

export function useCaseWorkspace(): CaseWorkspaceState {
  const ctx = useContext(CaseWorkspaceContext);
  if (!ctx) throw new Error("useCaseWorkspace must be used within a CaseWorkspaceProvider");
  return ctx;
}
```

- [ ] **Step 4: Run GREEN** — same vitest command → PASS. Then `npx tsc --noEmit` (will show errors in
  callers that use the old setters — those are fixed in Tasks 2–4; this file itself must be clean).
  Note: tsc across the project will fail until Tasks 2–4 land. Confirm the reducer's own test file
  passes and the context file has no internal type errors before committing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/context/CaseWorkspaceContext.tsx frontend/src/context/CaseWorkspaceContext.test.tsx
git commit -m "feat(case-map): focus reducer (two-tier Selection/Frame); reducer tests"
```

---

### Task 2: Feeder migration (`useFeederActions`)

`setActiveAngle({id,title})` → `activateThread({id,title})` (history-free cite target). This is the
subtle history-bug guard, done before UI churn.

**Files:** Modify `hooks/useFeederActions.ts`; create `hooks/useFeederActions.test.tsx` (if the
existing test covers feeders, extend it; otherwise create).

- [ ] **Step 1: Write the failing test**

```tsx
// hooks/useFeederActions.test.tsx
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api", () => ({
  createAngle: vi.fn().mockResolvedValue({ id: "a1", title: "New" }),
  fetchAngle: vi.fn().mockResolvedValue({ id: "a1", title: "New", narrative: "", document_links: [] }),
  updateAngle: vi.fn().mockResolvedValue({}),
}));

import * as api from "../api";
import { useFeederActions } from "./useFeederActions";
import { CaseWorkspaceProvider, useCaseWorkspace } from "../context/CaseWorkspaceContext";

beforeEach(() => vi.clearAllMocks());

function useBoth() {
  return { feeder: useFeederActions("c1"), ws: useCaseWorkspace() };
}
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <CaseWorkspaceProvider>{children}</CaseWorkspaceProvider>
);

describe("useFeederActions migration to activateThread", () => {
  it("startAngleFrom makes the new angle the active cite target WITHOUT pushing history", async () => {
    const { result } = renderHook(useBoth, { wrapper });
    await act(async () => { await result.current.feeder.startAngleFrom({ title: "T" }); });
    expect(result.current.ws.activeAngleId).toBe("a1");
    expect(result.current.ws.history).toHaveLength(1); // no frame pushed
    expect(result.current.ws.selection).toEqual({ kind: "none" });
  });
});
```

- [ ] **Step 2: Run RED** — `cd frontend && npx vitest run src/hooks/useFeederActions.test.tsx`
  Expected: FAIL (compile: `setActiveAngle` no longer exists on the context).

- [ ] **Step 3: Implement** — in `hooks/useFeederActions.ts`:
  - Change the destructure: `const { activeAngleId, activateThread } = useCaseWorkspace();`
  - Replace both `setActiveAngle({ id: angle.id, title: angle.title })` calls (lines ~53, ~73) with
    `activateThread({ id: angle.id, title: angle.title })`.
  - Update the `useCallback` dep arrays: `setActiveAngle` → `activateThread`.

- [ ] **Step 4: Run GREEN** — same command → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useFeederActions.ts frontend/src/hooks/useFeederActions.test.tsx
git commit -m "feat(case-map): feeders set active thread via activateThread (history-free)"
```

---

### Task 3: `CaseDetailView` bridge removal

Delete `requestedAngle`/`onAngleActive`/`onAngleConsumed`; chip → `clearActiveAngle`; the two
deep-link producers (FinancialsTab, InvestigationTab) dispatch `openThread` + switch to Investigate.

**Files:** Modify `views/CaseDetailView.tsx`. (Reducer covered by Task 1 tests; this is wiring —
verify via `tsc` + the existing/extended view tests.)

- [ ] **Step 1: Edits**
  - Destructure (line ~74): `const { activeAngleId, activeAngleTitle, openThread, clearActiveAngle } = useCaseWorkspace();`
  - Delete `const [requestedAngle, setRequestedAngle] = useState(...)` (line 73).
  - `handleOpenAngle` (108): replace body with
    ```ts
    function handleOpenAngle(angleId: string, angleTitle: string) {
      openThread({ id: angleId, title: angleTitle });
      setActiveTab("investigate");
    }
    ```
  - Chip clear (147): `onClick={() => clearActiveAngle()}`.
  - InvestigateTab usage (193–199): drop `onAngleActive`, `requestedAngle`, `onAngleConsumed` props —
    leave `<InvestigateTab caseId={id} documents={caseData?.documents ?? []} />`.

- [ ] **Step 2: Verify** — `cd frontend && npx tsc --noEmit` (CaseDetailView clean; InvestigateTab will
  still error until Task 4 — that's expected mid-sequence). Run the existing `CaseDetailView`-touching
  tests if any. Do NOT run the full suite green-gate until Task 4 restores InvestigateTab.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/CaseDetailView.tsx
git commit -m "feat(case-map): remove CaseDetailView angle bridge; deep-link via openThread"
```

---

### Task 4: `InvestigateTab` state migration (existing panels still render)

Replace `navStack`/selection with the reducer; keep `ProfilePanel`/`AngleView`/`DocumentView`
rendering; pass `activeAngleId` from context to `DocumentView`; add readiness to load + `refreshCaseData`.
**No new inspectors yet** (Tasks 5–8). The Case Map edge click temporarily still uses the existing
`selectedSummaryEdge`→`RelationshipSummaryPanel` path from 1B until Task 5 moves it onto the reducer.

**Files:** Modify `views/InvestigateTab.tsx`. Add `frontend/src/views/InvestigateTab.frame.test.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
// views/InvestigateTab.frame.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";

vi.mock("../components/CytoscapeCanvas", () => ({
  default: ({ onNodeClick }: { onNodeClick?: (id: string) => void }) => (
    <button data-testid="cy-node" onClick={() => onNodeClick?.("a")}>node</button>
  ),
}));
vi.mock("../api", () => ({
  fetchGraph: vi.fn().mockResolvedValue({ nodes: [{ id: "a", type: "person", label: "Jay", metadata: { finding_count: 0, doc_count: 0 } }], edges: [], timeline_events: [], stats: { node_types: { person: 1 }, total_edges: 0 } }),
  fetchCaseMap: vi.fn().mockResolvedValue({ case_id: "c1", nodes: [{ id: "a", type: "person", label: "Jay", subtype: null, flags: { status_unknown: false, has_active_thread: false, has_substantiated_thread: false }, metadata: { thread_count: 0, document_count: 0 } }], edges: [], stats: { subject_count: 1, edge_count: 0, by_level: { observed: 0, documented: 0, repeated: 0, material: 0 }, material_edge_count: 0, handoff_edge_count: 0, generated_at: "x" } }),
  fetchFuzzyMatches: vi.fn().mockResolvedValue({ count: 0, results: [] }),
  fetchDashboard: vi.fn().mockResolvedValue({ case: { id: "c1", name: "C", status: "ACTIVE", created_at: "2026-06-01T00:00:00Z", referral_ref: "" }, documents: { total: 0, by_type: {}, by_extraction_status: {}, renamed_count: 0 }, entities: { persons: 1, organizations: 0, properties: 0, financial_instruments: 0, total: 1 }, findings: { total: 0, by_status: {} }, credibility: { referral_grade: 0, need_work: 0, agency_leads: 0 }, quality: undefined }),
  fetchReferralReadiness: vi.fn().mockResolvedValue({ status: "NOT_READY", summary: "", items: [], quality: undefined, credibility: { referral_grade: 0, need_work: 0, agency_leads: 0 } }),
  fetchEntityDetail: vi.fn().mockResolvedValue({ id: "a", entity_type: "person", name: "Jay", related_documents: [], related_findings: [] }),
  runAiPatternAnalysis: vi.fn(), reevaluateSignals: vi.fn(),
}));

import * as api from "../api";
import InvestigateTab from "./InvestigateTab";
import { CaseWorkspaceProvider } from "../context/CaseWorkspaceContext";

const renderTab = () => render(
  <CaseWorkspaceProvider><InvestigateTab caseId="c1" documents={[]} /></CaseWorkspaceProvider>,
);
beforeEach(() => vi.clearAllMocks());

describe("InvestigateTab reducer migration", () => {
  it("loads /case-map/, /graph/, dashboard AND readiness on mount", async () => {
    renderTab();
    await waitFor(() => expect(api.fetchCaseMap).toHaveBeenCalledWith("c1"));
    expect(api.fetchGraph).toHaveBeenCalledWith("c1");
    expect(api.fetchReferralReadiness).toHaveBeenCalledWith("c1");
  });

  it("node click opens the profile frame (map replaced by ProfilePanel)", async () => {
    const { getByTestId, findByText } = renderTab();
    await waitFor(() => expect(api.fetchCaseMap).toHaveBeenCalled());
    fireEvent.click(getByTestId("cy-node"));
    // ProfilePanel renders; the canvas node stub is gone (full-frame mode)
    await waitFor(() => expect(api.fetchEntityDetail).toHaveBeenCalledWith("person", "a"));
  });
});
```

- [ ] **Step 2: Run RED** — `npx vitest run src/views/InvestigateTab.frame.test.tsx` → FAIL.

- [ ] **Step 3: Implement** (the large migration). In `InvestigateTab.tsx`:
  - Remove props `onAngleActive`, `requestedAngle`, `onAngleConsumed` from `InvestigateTabProps` and
    the signature.
  - Delete `NavEntry`, `entryLabel`, `sameEntry`, `navigate`, `navigateTo`, `navigateBack`,
    `navStack` state. Delete `webSelectedEdge` state (the raw-graph edge path; the case-map summary
    edge path stays for now via `selectedSummaryEdge`).
  - From `useCaseWorkspace()` pull: `currentFrame`, `selection`, `selectSubject`, `openProfile`,
    `openThread`, `openDocument`, `goBack`, `goTo`, `activeAngleId`.
  - `handleNodeClick(nodeId)`: resolve the graph node; `openProfile({ id, entityType: node.type, name: node.label })` (replaces the old `setActiveEntity` + navigate-to-profile).
  - Add `readiness` state + `fetchReferralReadiness(caseId)` to the mount `Promise.all` and to
    `refreshCaseData()` (set it alongside caseMap/graph/dashboard).
  - Render modes keyed on `currentFrame.kind`:
    - `"web"` → toolbar + canvas + right rail (rail = the existing 1B branch: `selectedSummaryEdge`
      ? `RelationshipSummaryPanel` : `WebRightPanel`; Task 5/6 replace this with `ContextPanel`).
    - `"profile"` → `<ProfilePanel ... onBack={goBack} />` (full-width; existing component).
    - `"angle"` → `<AngleView ... onBack={goBack} />`.
    - `"document"` → `<DocumentView ... onBack={goBack} activeAngleId={activeAngleId} />` (pass the
      context pointer directly — delete the old `navStack.find(...angle)` derivation).
  - Breadcrumb: rebuild from `history` + `goTo` (behavior-equivalent to the old `Breadcrumb`).
  - Cross-tab deep-link (`requestedAngle` effect) is gone — `CaseDetailView` now dispatches
    `openThread` directly (Task 3).

- [ ] **Step 4: Run GREEN** — `npx vitest run src/views/InvestigateTab.frame.test.tsx` and the existing
  `InvestigateTab.caseMap.test.tsx` (update its `CaseWorkspaceProvider` usage if selection now flows
  through context). Then `npx tsc --noEmit` clean. Then full suite green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/InvestigateTab.tsx frontend/src/views/InvestigateTab.frame.test.tsx frontend/src/views/InvestigateTab.caseMap.test.tsx
git commit -m "feat(case-map): InvestigateTab driven by focus reducer; readiness in load/refresh; DocumentView active angle from context"
```

---

### Task 5: Relationship path on the reducer + delete `ConnectionDetailPanel`

Route edge clicks through `selectRelationship` → `RelationshipSummaryPanel`; extend the panel
(§5.2); **delete `ConnectionDetailPanel.tsx`** (now caller-less) and the `selectedSummaryEdge` local
state.

**Files:** Modify `components/RelationshipSummaryPanel.tsx` (+ test), `views/InvestigateTab.tsx`;
**delete** `components/ConnectionDetailPanel.tsx`.

- [ ] **Step 1: Write the failing test** (extend `RelationshipSummaryPanel.test.tsx`)

```tsx
it("renders supporting documents and threads-using sections; thread click selects it", () => {
  const onSelectThread = vi.fn();
  const edge: SummaryEdge = {
    id: "p1__p2", source: "p1", target: "p2", relationship: "SUMMARY",
    label: "Documented relationship", state: "documented",
    strength: { score: 30, level: "documented", categories: ["co_mentioned"], source_count: 1,
      transaction_count: 0, role_count: 0, thread_count: 1, substantiated_thread_count: 0,
      handoff_included: false, relationship_types: [], reasons: ["Appears together in 1 source document"] },
    evidence_refs: [{ kind: "source_document", document_id: "d1", label: "Form 990", category: "co_mentioned" }],
    thread_refs: [{ thread_id: "t1", title: "Insider swap", status: "NEEDS_EVIDENCE", severity: "HIGH",
      rule_id: "SR-015", signal_type: "INSIDER_SWAP", handoff_ready: false }],
    underlying_relationships: [],
  };
  const { getByText } = render(
    <RelationshipSummaryPanel edge={edge} subjectLabel={(id) => id} onClear={() => {}}
      onOpenSource={() => {}} onSelectThread={onSelectThread} onStartThread={() => {}} />,
  );
  expect(getByText("Form 990")).toBeTruthy();        // supporting doc
  fireEvent.click(getByText("Insider swap"));         // thread row
  expect(onSelectThread).toHaveBeenCalledWith("t1");
});
```

- [ ] **Step 2: Run RED** — `npx vitest run src/components/RelationshipSummaryPanel.test.tsx` → FAIL.

- [ ] **Step 3: Implement**
  - Extend `RelationshipSummaryPanel` props with `onOpenSource(documentId)`, `onSelectThread(id)`,
    `onStartThread()`. Add a **Supporting documents** section (map `edge.evidence_refs` where
    `document_id` truthy → clickable label → `onOpenSource`), a **Threads using this relationship**
    section (map `edge.thread_refs` → clickable title → `onSelectThread(t.thread_id)`), and the
    Actions row (start thread / open source). Keep the existing level/categories/reasons/underlying/
    disclaimer sections + `data-testid`s.
  - In `InvestigateTab`: edge click → `selectRelationship(edgeId)`; render
    `selection.kind === "relationship"` → `<RelationshipSummaryPanel edge={caseMap.edges.find(e=>e.id===selection.edgeId)} onClear={clearSelection} onSelectThread={(id)=>selectThread(id, <title from thread_ref>)} onStartThread={...} onOpenSource={(docId)=>openDocument({id:docId,name:...})} />`. Delete `selectedSummaryEdge` state + `handleEdgeClick`'s setter (now dispatches `selectRelationship`).
  - **Delete** `import ConnectionDetailPanel ...` and the `selectedEdge` branch in `WebRightPanel`;
    **delete the file** `components/ConnectionDetailPanel.tsx`.

- [ ] **Step 4: Run GREEN** — panel test + `InvestigateTab.caseMap.test.tsx` + `npx tsc --noEmit`
  (clean; confirms no dangling `ConnectionDetailPanel` import). Full suite green.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src
git commit -m "feat(case-map): relationship inspector on reducer; extend panel; delete ConnectionDetailPanel"
```

---

### Task 6: `SubjectInspector`

**Files:** Create `components/SubjectInspector.tsx` (+ test). Wire into `InvestigateTab` map-mode for
`selection.kind === "subject"`.

- [ ] **Step 1: Write the failing test**

```tsx
// components/SubjectInspector.test.tsx
import { render, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api", () => ({
  fetchEntityDetail: vi.fn().mockResolvedValue({ id: "p1", entity_type: "person", name: "Jay Example", role_tags: [], aliases: ["J. Example"], related_documents: [{ id: "d1", filename: "Deed.pdf" }], related_findings: [] }),
  fetchNotes: vi.fn().mockResolvedValue({ results: [
    { id: "n1", target_type: "person", target_id: "p1", content: "Saw him at the deed signing", created_by: "me", created_at: "x", updated_at: "x" },
    { id: "n2", target_type: "person", target_id: "OTHER", content: "unrelated", created_by: "me", created_at: "x", updated_at: "x" },
  ] }),
  createNote: vi.fn().mockResolvedValue({}),
}));
import * as api from "../api";
import SubjectInspector from "./SubjectInspector";

const caseMap = { edges: [{ id: "p1__o1", source: "p1", target: "o1", strength: { level: "documented", score: 30 } }], nodes: [{ id: "o1", label: "Acme" }] };
beforeEach(() => vi.clearAllMocks());

describe("SubjectInspector", () => {
  it("shows identity + observations filtered by target_id; not other subjects' notes", async () => {
    const { findByText, queryByText } = render(
      <SubjectInspector caseId="c1" subjectId="p1" entityType="person" caseMap={caseMap as any}
        subjectLabel={(id) => id} onSelectRelationship={() => {}} onStartThread={() => {}}
        onCite={() => {}} onOpenProfile={() => {}} onClear={() => {}} />,
    );
    expect(await findByText("Jay Example")).toBeTruthy();
    expect(await findByText(/deed signing/)).toBeTruthy();
    expect(queryByText("unrelated")).toBeNull();
    expect(api.fetchNotes).toHaveBeenCalledWith("c1");
  });

  it("add observation calls createNote with target_id", async () => {
    const { findByLabelText, getByText } = render(
      <SubjectInspector caseId="c1" subjectId="p1" entityType="person" caseMap={caseMap as any}
        subjectLabel={(id) => id} onSelectRelationship={() => {}} onStartThread={() => {}}
        onCite={() => {}} onOpenProfile={() => {}} onClear={() => {}} />,
    );
    const input = await findByLabelText("New observation");
    fireEvent.change(input, { target: { value: "note text" } });
    fireEvent.click(getByText("Add observation"));
    await waitFor(() => expect(api.createNote).toHaveBeenCalledWith("c1", expect.objectContaining({ target_id: "p1", content: "note text" })));
  });
});
```

- [ ] **Step 2: Run RED** — `npx vitest run src/components/SubjectInspector.test.tsx` → FAIL.

- [ ] **Step 3: Implement** `SubjectInspector.tsx` per §5.1: on mount fetch `fetchEntityDetail(entityType, subjectId)` + `fetchNotes(caseId)` (filter `.results` by `target_id === subjectId`). Derive
  relationship count + top related subjects from `caseMap.edges` touching `subjectId` (sort by
  `strength.score`). Render Identity / Counts / Top relationships (click → `onSelectRelationship(edgeId)`) /
  Source trail (related_documents) / Observations / Actions (add observation → `createNote`; start
  thread → `onStartThread`; cite into active thread → `onCite`; Open full profile → `onOpenProfile`).
  Header × → `onClear`. Wire into `InvestigateTab`: `selection.kind==="subject"` →
  `<SubjectInspector ... onOpenProfile={() => openProfile({id, entityType, name})} onClear={clearSelection} />`.

- [ ] **Step 4: GREEN** — test + tsc + full suite. **Step 5: Commit** `feat(case-map): SubjectInspector`.

---

### Task 7: `WhatsMissingPanel`

**Files:** Create `components/WhatsMissingPanel.tsx` (+ test). Replace the idle `WebRightPanel` body
in `InvestigateTab` for `selection.kind==="none"` on the web frame.

- [ ] **Step 1: Write the failing test**

```tsx
// components/WhatsMissingPanel.test.tsx
import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import WhatsMissingPanel from "./WhatsMissingPanel";

const items = [
  { key: "citation_coverage", label: "Citations", status: "FAIL", summary: "2 uncited", target_tab: "investigate" },
  { key: "financials", label: "Financials", status: "WARN", summary: "stale", target_tab: "financials" },
  { key: "done", label: "Done", status: "PASS", summary: "ok", target_tab: "referrals" },
];

describe("WhatsMissingPanel", () => {
  it("renders FAIL/WARN only, FAIL first, omits PASS", () => {
    const { getByText, queryByText, container } = render(
      <WhatsMissingPanel readiness={{ status: "NOT_READY", summary: "", items, quality: undefined as any, credibility: { referral_grade: 1, need_work: 2, agency_leads: 0 } }} onNavigateTab={() => {}} onOpenPending={() => {}} />,
    );
    expect(getByText("Citations")).toBeTruthy();
    expect(getByText("Financials")).toBeTruthy();
    expect(queryByText("Done")).toBeNull();
    const labels = Array.from(container.querySelectorAll("[data-testid='wm-item']")).map((e) => e.textContent);
    expect(labels[0]).toContain("Citations"); // FAIL first
  });

  it("a cross-tab row click calls onNavigateTab", () => {
    const onNavigateTab = vi.fn();
    const { getByText } = render(
      <WhatsMissingPanel readiness={{ status: "NOT_READY", summary: "", items, quality: undefined as any, credibility: { referral_grade: 0, need_work: 0, agency_leads: 0 } }} onNavigateTab={onNavigateTab} onOpenPending={() => {}} />,
    );
    fireEvent.click(getByText("Financials"));
    expect(onNavigateTab).toHaveBeenCalledWith("financials");
  });

  it("READY / no actionable items → quiet empty state", () => {
    const { getByText } = render(
      <WhatsMissingPanel readiness={{ status: "READY", summary: "", items: [items[2]], quality: undefined as any, credibility: { referral_grade: 3, need_work: 0, agency_leads: 0 } }} onNavigateTab={() => {}} onOpenPending={() => {}} />,
    );
    expect(getByText(/Nothing's blocking/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run RED** → FAIL. **Step 3: Implement** per §6: `CredibilityHeader` at top; filter
  items to FAIL/WARN, FAIL first; row → `target_tab === "investigate"` resolves to in-tab action
  (`pending_connections` → `onOpenPending`, else no-op/select web) else `onNavigateTab(target_tab)`;
  PASS omitted; empty state when nothing actionable; muted recipient-gap footer. Each row
  `data-testid="wm-item"`. Wire into `InvestigateTab` idle rail; **remove the old `WebRightPanel`
  stats body**. **Step 4: GREEN** + tsc + full suite. **Step 5: Commit** `feat(case-map): WhatsMissingPanel idle rail`.

---

### Task 8: `ThreadInspector` (last — after data source wired)

**Files:** Create `components/ThreadInspector.tsx` (+ test). Wire into `InvestigateTab` for
`selection.kind==="thread"`.

- [ ] **Step 1: Write the failing test**

```tsx
// components/ThreadInspector.test.tsx
import { render, findByText as _f, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api", () => ({
  fetchAngle: vi.fn().mockResolvedValue({ id: "t1", title: "Insider swap", status: "NEEDS_EVIDENCE", severity: "HIGH", narrative: "", document_links: [{ document_id: "d1" }, { document_id: "d2" }] }),
  updateAngle: vi.fn().mockResolvedValue({}),
}));
import * as api from "../api";
import ThreadInspector from "./ThreadInspector";
beforeEach(() => vi.clearAllMocks());

describe("ThreadInspector", () => {
  it("fetches the thread and shows status/severity + cited source count", async () => {
    const { findByText } = render(
      <ThreadInspector caseId="c1" threadId="t1" onOpenThread={() => {}} onClear={() => {}} onChanged={() => {}} />,
    );
    expect(await findByText("Insider swap")).toBeTruthy();
    expect(await findByText(/2 cited sources/)).toBeTruthy();
    expect(api.fetchAngle).toHaveBeenCalledWith("c1", "t1");
  });

  it("Set aside calls updateAngle status DISMISSED (un-gated)", async () => {
    const onChanged = vi.fn();
    const { findByText, getByText } = render(
      <ThreadInspector caseId="c1" threadId="t1" onOpenThread={() => {}} onClear={() => {}} onChanged={onChanged} />,
    );
    await findByText("Insider swap");
    fireEvent.click(getByText("Set aside"));
    await waitFor(() => expect(api.updateAngle).toHaveBeenCalledWith("c1", "t1", { status: "DISMISSED" }));
  });

  it("Open full Thread calls onOpenThread", async () => {
    const onOpenThread = vi.fn();
    const { findByText, getByText } = render(
      <ThreadInspector caseId="c1" threadId="t1" onOpenThread={onOpenThread} onClear={() => {}} onChanged={() => {}} />,
    );
    await findByText("Insider swap");
    fireEvent.click(getByText("Open full Thread"));
    expect(onOpenThread).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run RED** → FAIL. **Step 3: Implement** per §5.3: on mount `fetchAngle(caseId, threadId)`
  with loading state; show title/status/severity, `document_links.length` cited sources, gaps summary;
  actions: cite source (existing `CiteDocumentPicker`), **Set aside** →
  `updateAngle(caseId, threadId, { status: "DISMISSED" })` then `onChanged()`, **Open full Thread** →
  `onOpenThread()`. Wire into `InvestigateTab`: `selection.kind==="thread"` →
  `<ThreadInspector ... onOpenThread={() => openThread({ id, title })} onChanged={refreshCaseData} onClear={clearSelection} />`. **Step 4: GREEN** + tsc + full suite. **Step 5: Commit** `feat(case-map): ThreadInspector bridge`.

---

### Task 9: Dead-code sweep + final gate

**Files:** none (verification + any stray deletions).

- [ ] **Step 1: Grep for retired names** — none should remain (except deliberate history/changelog):
```bash
cd frontend && rg -n "ConnectionDetailPanel|WebRightPanel|navStack|NavEntry|webSelectedEdge|selectedSummaryEdge|onAngleActive|onAngleConsumed|requestedAngle|setActiveAngle|setActiveEntity|entryLabel|sameEntry" src || echo "clean"
```
  Any hit in non-test source = remove it (or justify). `ConnectionDetailPanel.tsx` file must be gone.
- [ ] **Step 2: Type check** — `npx tsc --noEmit` → clean (no unused/unreachable).
- [ ] **Step 3: Full suite** — `npx vitest run` → all green.
- [ ] **Step 4: Manual smoke (local)** — Investigate tab: select subject/relationship/thread → rail
  inspector swaps, map stays; Open full profile/thread → full-width + breadcrumb back; document opened
  from a thread cites into it; idle rail shows What's Missing; Timeline tab still works (`/graph/`
  untouched).
- [ ] **Step 5: Commit** (if sweep removed anything) `chore(case-map): Phase 2 dead-code sweep`.
- [ ] **Step 6: Stage 2 — Railway PR preview** — push + open PR (confirm with Tyler first); seed the
  PR env (`railway ssh -e <pr-env> -s catalyst python manage.py seed_demo`) and verify the workspace
  before merge.

---

## Self-Review

**Spec coverage:** reducer two-tier + actions + recompute (T1) ✓ · activateThread history-free (T1,T2)
✓ · feeder migration (T2) ✓ · bridge removal + deep-link via openThread (T3) ✓ · InvestigateTab
reducer-driven + DocumentView active angle from context + readiness in load/refresh (T4) ✓ ·
relationship path + panel extend + **delete ConnectionDetailPanel** (T5) ✓ · SubjectInspector with
fetchNotes-by-target_id (T6) ✓ · WhatsMissingPanel FAIL/WARN-only (T7) ✓ · ThreadInspector via
fetchAngle + Set aside + Open full Thread (T8) ✓ · dead-code sweep + no shims (T9, §4.1) ✓ ·
`/graph/`+Timeline+tie-off untouched ✓.

**Placeholder scan:** none — all test fixtures and code blocks are concrete literals (the Task 5
`SummaryEdge` fixture is spelled out). Task 4's implementation step is edit-level prose (not a single
code block) because it's a large in-file migration of an existing 900-line component — each edit
names the exact symbol to add/delete.

**Type consistency:** `Frame`/`Selection`/action names defined in T1 used unchanged in T2–T8;
`activateThread`/`selectThread`/`openThread` distinct per the §2 rule; inspector props
(`onClear`/`onSelectThread`/`onOpenProfile`/`onOpenThread`/`onChanged`) consistent across tasks.

**Sequencing:** matches spec §8a — reducer → feeder → bridge → tab migration → relationship+delete →
Subject → WhatsMissing → Thread → sweep. Risky state refactor (T1–T4) precedes all new UI.
