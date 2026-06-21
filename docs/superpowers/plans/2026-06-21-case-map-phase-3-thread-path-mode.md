# Case Map Phase 3 — Thread Path Mode + Thread Dock Implementation Plan

> **For the implementer:** Follow this plan task-by-task using TDD — write the RED test, run it RED, implement the minimal code, run it GREEN, typecheck, commit. Steps use checkbox (`- [ ]`) syntax for tracking. (In Claude Code, `superpowers:subagent-driven-development` or `superpowers:executing-plans` can drive this loop; the steps are tool-agnostic and work without them.)

**Goal:** Selecting a thread makes the Case Map enter Thread Path Mode (emphasize the thread's relationships, neutral-ring its subjects, dim the rest), and add a persistent canvas-width Thread Dock so every thread is reachable from the map.

**Architecture:** Frontend-only. Pure helpers in `caseMapElements.ts` compute the path set and severity class; a new `ThreadDock` renders the list; `InvestigateTab` wires the dock + an imperative Cytoscape class-toggle keyed on the existing `selection.kind === "thread"` reducer state. No backend change, no reducer change — Phase 3 is a *render* of Phase 2's selection.

**Tech Stack:** React + TypeScript + Vite, Cytoscape.js (`react-cytoscapejs` + `cose-bilkent`), Vitest + `@testing-library/react`, Lucide icons.

**Spec:** `docs/superpowers/specs/2026-06-21-case-map-phase-3-thread-path-mode-design.md`

## Global Constraints

- **No backend files change.** `entity_links` (with `entity_type`) is already in the `/findings/` serializer.
- **No reducer change.** Path Mode renders existing `selection.kind === "thread"`. Do not add fields to `CaseWorkspaceContext`.
- **Banned UI strings** (enforced by CI gate): never render "Haiku", "Sonnet", "Opus", "Claude", "AI assistant", "LLM", "GPT". Use Thread / Subject / Substantiated / Set aside / Lead vocabulary.
- **Code style:** double quotes, 2-space indent, LF. Run `cd frontend && npx tsc --noEmit` clean before each commit.
- **Severity is the full enum:** `CRITICAL | HIGH | MEDIUM | LOW | INFORMATIONAL`. Sort order CRITICAL>HIGH>MEDIUM>LOW>INFORMATIONAL. Severity *color* only for CRITICAL/HIGH/MEDIUM; LOW/INFORMATIONAL are neutral.
- **Test command:** `cd frontend && npx vitest run <path>` (single file) / `npx vitest run` (all). Type check: `cd frontend && npx tsc --noEmit`.
- **Commit signature:** end every commit body with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **Branch:** `feature/case-map-phase-3-thread-path-mode` (already created).

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/views/caseMapElements.ts` (modify) | add pure `threadPath`, `severityEdgeClass`, `compareBySeverity` |
| `frontend/src/components/threadReadiness.ts` (new) | shared `threadReadiness(finding)` — the one referral-grade gap definition |
| `frontend/src/components/ThreadInspector.tsx` (modify) | consume `threadReadiness`; full-enum `severityColor`; `noVisibleMapPath` prop + line |
| `frontend/src/components/ThreadDock.tsx` (new) | the dock surface — rows, sort, collapse, states |
| `frontend/src/components/CytoscapeCanvas.tsx` (modify) | add `.thread-path-edge*` + `.thread-path-subject` styles |
| `frontend/src/views/InvestigateTab.tsx` (modify) | dock state/fetch isolation, `cyReady`, `applyThreadPathMode`, dock render, refresh extension |

Build order: Task 1 (path/severity helpers) → Task 2 (readiness helper + ThreadInspector) → Task 3 (stylesheet) → Task 4 (ThreadDock) → Task 5 (InvestigateTab wiring). Tasks 1–4 are independent leaves; Task 5 consumes all of them.

---

### Task 1: Pure path + severity helpers in `caseMapElements.ts`

**Files:**
- Modify: `frontend/src/views/caseMapElements.ts`
- Test: `frontend/src/views/caseMapElements.test.ts`

**Interfaces:**
- Consumes: `SummaryEdge`, `FindingEntityLink`, `FindingSeverity` from `../types`.
- Produces:
  - `threadPath(args: { threadId: string; edges: SummaryEdge[]; entityLinks: FindingEntityLink[] }): { pathEdgeIds: string[]; participatingSubjectIds: string[] }`
  - `severityEdgeClass(sev: FindingSeverity): "" | "critical" | "high" | "medium"`
  - `compareBySeverity(a: FindingSeverity, b: FindingSeverity): number` (negative when `a` is more severe)

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/views/caseMapElements.test.ts`:

```ts
import {
  threadPath,
  severityEdgeClass,
  compareBySeverity,
} from "./caseMapElements";
import type { FindingEntityLink, FindingSeverity } from "../types";

function edgeWithThreads(id: string, source: string, target: string, threadIds: string[]): SummaryEdge {
  const e = edge("documented");
  return {
    ...e,
    id, source, target,
    thread_refs: threadIds.map((tid) => ({
      thread_id: tid, title: "t", status: "NEEDS_EVIDENCE",
      severity: "HIGH", rule_id: "SR-015", signal_type: "INSIDER_SWAP", handoff_ready: false,
    })),
  };
}
function link(entity_id: string, entity_type: FindingEntityLink["entity_type"]): FindingEntityLink {
  return { entity_id, entity_type, context_note: "" };
}

describe("threadPath", () => {
  it("returns path edges referencing the thread and their endpoints", () => {
    const edges = [
      edgeWithThreads("a__b", "a", "b", ["T1"]),
      edgeWithThreads("b__c", "b", "c", ["T1"]),
      edgeWithThreads("c__d", "c", "d", ["T2"]),
    ];
    const r = threadPath({ threadId: "T1", edges, entityLinks: [] });
    expect(r.pathEdgeIds.sort()).toEqual(["a__b", "b__c"]);
    expect(r.participatingSubjectIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("lights a subject-only thread from entity_links when no edge matches", () => {
    const edges = [edgeWithThreads("a__b", "a", "b", ["OTHER"])];
    const r = threadPath({
      threadId: "T1", edges,
      entityLinks: [link("p1", "person"), link("o1", "organization")],
    });
    expect(r.pathEdgeIds).toEqual([]);
    expect(r.participatingSubjectIds.sort()).toEqual(["o1", "p1"]);
  });

  it("ignores non-subject entity_links (property / financial_instrument)", () => {
    // EntityType = "person" | "organization" | "property" | "financial_instrument"
    const r = threadPath({
      threadId: "T1", edges: [],
      entityLinks: [link("pr1", "property"), link("fi1", "financial_instrument"), link("p1", "person")],
    });
    expect(r.participatingSubjectIds).toEqual(["p1"]);
  });

  it("returns both empty when the thread has no map presence", () => {
    const r = threadPath({ threadId: "T1", edges: [edgeWithThreads("a__b", "a", "b", ["X"])], entityLinks: [] });
    expect(r.pathEdgeIds).toEqual([]);
    expect(r.participatingSubjectIds).toEqual([]);
  });

  it("dedups a subject that is both an edge endpoint and an entity_link", () => {
    const edges = [edgeWithThreads("a__b", "a", "b", ["T1"])];
    const r = threadPath({ threadId: "T1", edges, entityLinks: [link("a", "person")] });
    expect(r.participatingSubjectIds.sort()).toEqual(["a", "b"]);
  });
});

describe("severityEdgeClass", () => {
  it("maps CRITICAL/HIGH/MEDIUM to a suffix and LOW/INFORMATIONAL to empty", () => {
    expect(severityEdgeClass("CRITICAL")).toBe("critical");
    expect(severityEdgeClass("HIGH")).toBe("high");
    expect(severityEdgeClass("MEDIUM")).toBe("medium");
    expect(severityEdgeClass("LOW")).toBe("");
    expect(severityEdgeClass("INFORMATIONAL")).toBe("");
  });
});

describe("compareBySeverity", () => {
  it("orders CRITICAL > HIGH > MEDIUM > LOW > INFORMATIONAL", () => {
    const order: FindingSeverity[] = ["INFORMATIONAL", "CRITICAL", "MEDIUM", "LOW", "HIGH"];
    expect([...order].sort(compareBySeverity)).toEqual(
      ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL"],
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/views/caseMapElements.test.ts`
Expected: FAIL — `threadPath`, `severityEdgeClass`, `compareBySeverity` are not exported.

- [ ] **Step 3: Implement the helpers**

Append to `frontend/src/views/caseMapElements.ts` (add `FindingEntityLink`, `FindingSeverity` to the existing type import from `../types`):

```ts
import type {
  SubjectNode, SummaryEdge, EdgeStrengthLevel, FindingEntityLink, FindingSeverity,
} from "../types";

/** Compute the Case Map elements a thread relies on. Edge-backed threads come from
 *  edge.thread_refs; subject-only threads come from the finding's person/org entity_links. */
export function threadPath(args: {
  threadId: string;
  edges: SummaryEdge[];
  entityLinks: FindingEntityLink[];
}): { pathEdgeIds: string[]; participatingSubjectIds: string[] } {
  const pathEdgeIds: string[] = [];
  const subjects = new Set<string>();
  for (const e of args.edges) {
    if (e.thread_refs.some((r) => r.thread_id === args.threadId)) {
      pathEdgeIds.push(e.id);
      subjects.add(e.source);
      subjects.add(e.target);
    }
  }
  for (const l of args.entityLinks) {
    if (l.entity_type === "person" || l.entity_type === "organization") {
      subjects.add(l.entity_id);
    }
  }
  return { pathEdgeIds, participatingSubjectIds: [...subjects] };
}

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFORMATIONAL: 4,
};

/** Path-edge color suffix. Only elevated severities get color; LOW/INFORMATIONAL stay neutral. */
export function severityEdgeClass(sev: FindingSeverity): "" | "critical" | "high" | "medium" {
  switch (sev) {
    case "CRITICAL": return "critical";
    case "HIGH": return "high";
    case "MEDIUM": return "medium";
    default: return "";
  }
}

/** Sort comparator: most-severe first (CRITICAL → INFORMATIONAL). */
export function compareBySeverity(a: FindingSeverity, b: FindingSeverity): number {
  return SEVERITY_RANK[a] - SEVERITY_RANK[b];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/views/caseMapElements.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Type check + commit**

```bash
cd frontend && npx tsc --noEmit
cd .. && git add frontend/src/views/caseMapElements.ts frontend/src/views/caseMapElements.test.ts
git commit -m "feat(case-map): pure threadPath + severity helpers (Phase 3)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Shared `threadReadiness` helper + ThreadInspector updates

**Files:**
- Create: `frontend/src/components/threadReadiness.ts`
- Create: `frontend/src/components/threadReadiness.test.ts`
- Modify: `frontend/src/components/ThreadInspector.tsx`
- Modify: `frontend/src/components/ThreadInspector.test.tsx`

**Interfaces:**
- Consumes: `FindingItem`, `FindingSeverity` from `../types`.
- Produces: `threadReadiness(f: Pick<FindingItem, "status" | "evidence_weight" | "overreach_reviewed" | "document_links">): { ready: boolean; summary: string }`. `ThreadInspector` gains a `noVisibleMapPath?: boolean` prop.

The current `ThreadInspector.gapSummary()` (lines 142–152) and the referral-readiness color block (lines 257–272) duplicate the referral-grade predicate. Extract it once so the dock (Task 4) and the inspector share a single definition.

- [ ] **Step 1: Write the failing helper test**

Create `frontend/src/components/threadReadiness.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { threadReadiness } from "./threadReadiness";

const base = {
  status: "CONFIRMED" as const,
  evidence_weight: "DOCUMENTED" as const,
  overreach_reviewed: true,
  document_links: [{ document_id: "d1", document_filename: "x", page_reference: "", context_note: "" }],
};

describe("threadReadiness", () => {
  it("is ready when all referral-grade conditions are met", () => {
    expect(threadReadiness(base)).toEqual({ ready: true, summary: "All referral-grade conditions met." });
  });
  it("reports no cited sources", () => {
    expect(threadReadiness({ ...base, document_links: [] })).toMatchObject({
      ready: false, summary: expect.stringContaining("No cited sources"),
    });
  });
  it("reports weight below Documented", () => {
    expect(threadReadiness({ ...base, evidence_weight: "SPECULATIVE" })).toMatchObject({
      ready: false, summary: expect.stringContaining("Evidence weight below Documented"),
    });
  });
  it("reports overreach not reviewed", () => {
    expect(threadReadiness({ ...base, overreach_reviewed: false })).toMatchObject({
      ready: false, summary: expect.stringContaining("Overreach not reviewed"),
    });
  });
  it("reports not yet substantiated", () => {
    expect(threadReadiness({ ...base, status: "NEEDS_EVIDENCE" })).toMatchObject({
      ready: false, summary: expect.stringContaining("Not yet substantiated"),
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/components/threadReadiness.test.ts`
Expected: FAIL — module `./threadReadiness` does not exist.

- [ ] **Step 3: Implement the helper**

Create `frontend/src/components/threadReadiness.ts` (logic lifted verbatim from `ThreadInspector.gapSummary`):

```ts
import type { FindingItem } from "../types";

type ReadinessInput = Pick<
  FindingItem,
  "status" | "evidence_weight" | "overreach_reviewed" | "document_links"
>;

/** The single referral-grade gap definition shared by ThreadInspector and the Thread Dock.
 *  Mirrors referral_grade.py: CONFIRMED ∧ ≥1 cited doc ∧ weight ∈ {DOCUMENTED, TRACED} ∧ overreach_reviewed. */
export function threadReadiness(f: ReadinessInput): { ready: boolean; summary: string } {
  const gaps: string[] = [];
  if (f.document_links.length === 0) gaps.push("No cited sources");
  if (!["DOCUMENTED", "TRACED"].includes(f.evidence_weight)) gaps.push("Evidence weight below Documented");
  if (!f.overreach_reviewed) gaps.push("Overreach not reviewed");
  if (f.status !== "CONFIRMED") gaps.push("Not yet substantiated");
  if (gaps.length === 0) return { ready: true, summary: "All referral-grade conditions met." };
  return { ready: false, summary: gaps.join(" · ") };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend && npx vitest run src/components/threadReadiness.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor ThreadInspector to consume the helper + full-enum severity + no-path prop**

In `frontend/src/components/ThreadInspector.tsx`:

(a) Add the import:
```ts
import { threadReadiness } from "./threadReadiness";
```

(b) Extend `severityColor` (lines 42–49) so LOW/INFORMATIONAL are explicit (no behavior change, but removes the implicit `default`):
```ts
function severityColor(severity: FindingSeverity): string {
  switch (severity) {
    case "CRITICAL": return "var(--color-critical, #f87171)";
    case "HIGH":     return "#fbbf24";
    case "MEDIUM":   return "var(--color-info, #60a5fa)";
    case "LOW":
    case "INFORMATIONAL":
    default:         return "var(--text-3)";
  }
}
```

(c) Add `noVisibleMapPath` to the props interface (lines 30–36):
```ts
export interface ThreadInspectorProps {
  caseId: string;
  threadId: string;
  onOpenThread: () => void;
  onClear: () => void;
  onChanged: () => void;
  noVisibleMapPath?: boolean;
}
```
and destructure it in the component signature (lines 72–78): add `noVisibleMapPath = false,`.

(d) Replace the `gapSummary()` function (lines 142–152) and its two call sites with the shared helper. Delete `gapSummary`. Compute once after `const isSetAside = ...` (line 139 area):
```ts
const readiness = thread
  ? threadReadiness(thread)
  : { ready: false, summary: "" };
```
Then in the "Referral readiness" block (lines 257–272) replace the inline color condition + `{gapSummary()}` with:
```tsx
{sectionLabel("Referral readiness")}
<div style={{ fontSize: 11, color: readiness.ready ? "var(--color-success, #34d399)" : "var(--text-3)", lineHeight: 1.5 }}>
  {readiness.summary}
</div>
```

(e) Add the no-path line directly under the status+severity row (after line 248, the closing `</div>` of the status row), so it shows whenever Path Mode found nothing on the map:
```tsx
{noVisibleMapPath && (
  <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-3)", lineHeight: 1.5 }}>
    This thread has no visible Case Map path yet.
  </div>
)}
```

- [ ] **Step 6: Add ThreadInspector tests for the new behavior**

Append to `frontend/src/components/ThreadInspector.test.tsx` (the file already mocks `../api` with a `NEEDS_EVIDENCE` thread → not referral-grade):

```ts
it("shows the no-visible-path note when noVisibleMapPath is set", async () => {
  const { findByText } = render(
    <ThreadInspector caseId="c1" threadId="t1" noVisibleMapPath
      onOpenThread={() => {}} onClear={() => {}} onChanged={() => {}} />,
  );
  expect(await findByText(/no visible Case Map path yet/i)).toBeTruthy();
});

it("does not show the no-visible-path note by default", async () => {
  const { findByText, queryByText } = render(
    <ThreadInspector caseId="c1" threadId="t1"
      onOpenThread={() => {}} onClear={() => {}} onChanged={() => {}} />,
  );
  await findByText("Insider swap");
  expect(queryByText(/no visible Case Map path yet/i)).toBeNull();
});

it("renders the shared readiness summary (developing thread → not referral-grade)", async () => {
  const { findByText } = render(
    <ThreadInspector caseId="c1" threadId="t1"
      onOpenThread={() => {}} onClear={() => {}} onChanged={() => {}} />,
  );
  // BASE thread is NEEDS_EVIDENCE / SPECULATIVE / overreach false → multiple gaps
  expect(await findByText(/Not yet substantiated/)).toBeTruthy();
});
```

- [ ] **Step 7: Run the inspector + helper tests**

Run: `cd frontend && npx vitest run src/components/threadReadiness.test.ts src/components/ThreadInspector.test.tsx`
Expected: PASS.

- [ ] **Step 8: Type check + commit**

```bash
cd frontend && npx tsc --noEmit
cd .. && git add frontend/src/components/threadReadiness.ts frontend/src/components/threadReadiness.test.ts frontend/src/components/ThreadInspector.tsx frontend/src/components/ThreadInspector.test.tsx
git commit -m "feat(case-map): shared threadReadiness helper + ThreadInspector no-path prop (Phase 3)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Thread Path Mode stylesheet classes

**Files:**
- Modify: `frontend/src/components/CytoscapeCanvas.tsx` (the exported `STYLESHEET`)
- Test: `frontend/src/components/CytoscapeCanvas.stylesheet.test.ts`

**Interfaces:**
- Produces: stylesheet selectors `.thread-path-edge`, `.thread-path-edge--critical|--high|--medium`, `.thread-path-subject`. Task 5 applies these classes imperatively.

- [ ] **Step 1: Write the failing stylesheet test**

Append to `frontend/src/components/CytoscapeCanvas.stylesheet.test.ts`:

```ts
it("defines Phase 3 thread-path classes (edge emphasis + severity colors + subject ring)", () => {
  const sel = selectors();
  expect(sel).toContain(".thread-path-edge");
  expect(sel).toContain(".thread-path-edge--critical");
  expect(sel).toContain(".thread-path-edge--high");
  expect(sel).toContain(".thread-path-edge--medium");
  expect(sel).toContain(".thread-path-subject");
  // base path edge emphasizes but stays neutral (no line-color); severity classes set color
  const crit = STYLESHEET.find((r) => r.selector === ".thread-path-edge--critical");
  expect(crit?.style?.["line-color"]).toBe("#f87171");
});

it("keeps .dimmed reserved at low opacity", () => {
  const dim = STYLESHEET.find((r) => r.selector === ".dimmed");
  expect(dim?.style?.opacity).toBe(0.1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/components/CytoscapeCanvas.stylesheet.test.ts`
Expected: FAIL — the new selectors aren't present.

- [ ] **Step 3: Add the classes to STYLESHEET**

In `frontend/src/components/CytoscapeCanvas.tsx`, replace the reserved dimmed comment block (lines 89–90) with the full Phase 3 vocabulary. Order matters in Cytoscape (later rules win): place `.thread-path-edge*` and `.thread-path-subject` AFTER the `.dimmed` rule and after `edge.summary`/`edge.material` so they override dimming/width on the path:

```ts
  /* ── Phase 3 — Thread Path Mode ─────────────────────────────────────────── */
  /* Dimmed — everything not on the selected thread's path */
  { selector: ".dimmed", style: { opacity: 0.1 } },
  /* Path edge — emphasis width, neutral by default (LOW/INFORMATIONAL stay here) */
  {
    selector: ".thread-path-edge",
    style: { width: 5, opacity: 1, "line-color": "#94a3b8" },
  },
  /* Severity color on the path edge only — never on subjects */
  { selector: ".thread-path-edge--critical", style: { "line-color": "#f87171" } },
  { selector: ".thread-path-edge--high", style: { "line-color": "#fbbf24" } },
  { selector: ".thread-path-edge--medium", style: { "line-color": "#60a5fa" } },
  /* Participating subject — neutral amber ring, NOT an accusation */
  {
    selector: ".thread-path-subject",
    style: { opacity: 1, "outline-width": 3, "outline-color": "#fbbf24", "outline-offset": 2 },
  },
```

(The `edge.summary`/`edge.material` rules above are unchanged. Note these path rules must be placed *after* them in the array.)

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend && npx vitest run src/components/CytoscapeCanvas.stylesheet.test.ts`
Expected: PASS.

- [ ] **Step 5: Type check + commit**

```bash
cd frontend && npx tsc --noEmit
cd .. && git add frontend/src/components/CytoscapeCanvas.tsx frontend/src/components/CytoscapeCanvas.stylesheet.test.ts
git commit -m "feat(case-map): Thread Path Mode stylesheet classes (Phase 3)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: ThreadDock component

**Files:**
- Create: `frontend/src/components/ThreadDock.tsx`
- Create: `frontend/src/components/ThreadDock.test.tsx`

**Interfaces:**
- Consumes: `threadReadiness` (Task 2), `compareBySeverity` (Task 1), `FindingItem`/`FindingSeverity` from `../types`.
- Produces:
```ts
type SortKey = "severity" | "status" | "readiness" | "recency";
interface ThreadDockProps {
  threads: FindingItem[];                  // the loaded page (≤100)
  totalCount: number;                      // FindingsResponse.count — total on the server
  loading: boolean;
  error: boolean;
  selectedThreadId: string | undefined;    // from selection.kind==="thread"
  onSelectThread: (id: string) => void;    // row click; clicking the active row clears (parent decides)
  onRetry: () => void;
}
export default function ThreadDock(props: ThreadDockProps): JSX.Element
```
The dock is presentational: it owns only **collapse** + **sort** local state. Selection lives in the parent reducer (the §6 invariant). When `totalCount > threads.length` the dock shows an honest "Showing N of M threads" note — it does **not** imply client-side sorting can reveal unloaded rows (correction #2).

- [ ] **Step 1: Write the failing component tests**

Create `frontend/src/components/ThreadDock.test.tsx`:

```ts
import { render, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ThreadDock from "./ThreadDock";
import type { FindingItem } from "../types";

// Accurate FindingItem (frontend/src/types/index.ts:835-882) — no cast.
function thread(over: Partial<FindingItem>): FindingItem {
  return {
    id: "t1", rule_id: "SR-015", title: "Insider swap", description: "",
    narrative: "", severity: "HIGH", status: "NEEDS_EVIDENCE",
    evidence_weight: "SPECULATIVE", overreach_reviewed: false, source: "AUTO",
    investigator_note: "", legal_refs: [], evidence_snapshot: {},
    trigger_doc_id: null, trigger_doc_filename: null, trigger_entity_id: null,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    entity_links: [], document_links: [],
    ...over,
  };
}

const THREADS = [
  thread({ id: "med", title: "Overpayment", severity: "MEDIUM", status: "DISMISSED" }),
  thread({ id: "crit", title: "990 contradiction", severity: "CRITICAL", status: "CONFIRMED",
    evidence_weight: "DOCUMENTED", overreach_reviewed: true,
    document_links: [{ document_id: "d", document_filename: "x", page_reference: "", context_note: "" }] }),
  thread({ id: "high", title: "Insider swap", severity: "HIGH", status: "NEEDS_EVIDENCE" }),
];

describe("ThreadDock", () => {
  it("renders rows default-sorted by severity (CRITICAL first)", () => {
    const { getAllByRole } = render(
      <ThreadDock threads={THREADS} totalCount={3} loading={false} error={false}
        selectedThreadId={undefined} onSelectThread={() => {}} onRetry={() => {}} />,
    );
    const rows = getAllByRole("button", { name: /thread row/i });
    expect(within(rows[0]).getByText("990 contradiction")).toBeTruthy();
    expect(within(rows[2]).getByText("Overpayment")).toBeTruthy();
  });

  it("calls onSelectThread with the row id on click", () => {
    const onSelect = vi.fn();
    const { getByText } = render(
      <ThreadDock threads={THREADS} totalCount={3} loading={false} error={false}
        selectedThreadId={undefined} onSelectThread={onSelect} onRetry={() => {}} />,
    );
    fireEvent.click(getByText("Insider swap"));
    expect(onSelect).toHaveBeenCalledWith("high");
  });

  it("marks the active row from selectedThreadId", () => {
    const { getByText } = render(
      <ThreadDock threads={THREADS} totalCount={3} loading={false} error={false}
        selectedThreadId="high" onSelectThread={() => {}} onRetry={() => {}} />,
    );
    const row = getByText("Insider swap").closest("[data-active]");
    expect(row?.getAttribute("data-active")).toBe("true");
  });

  it("shows the readiness cell from threadReadiness", () => {
    const { getByText } = render(
      <ThreadDock threads={THREADS} totalCount={3} loading={false} error={false}
        selectedThreadId={undefined} onSelectThread={() => {}} onRetry={() => {}} />,
    );
    // the CONFIRMED+cited+documented+overreach thread is referral-grade
    expect(getByText(/referral-grade/i)).toBeTruthy();
  });

  it("shows an honest 'N of M' note when more threads exist than were loaded", () => {
    const { getByText } = render(
      <ThreadDock threads={THREADS} totalCount={137} loading={false} error={false}
        selectedThreadId={undefined} onSelectThread={() => {}} onRetry={() => {}} />);
    expect(getByText(/Showing 3 of 137 threads/i)).toBeTruthy();
  });

  it("shows no count note when all threads are loaded", () => {
    const { queryByText } = render(
      <ThreadDock threads={THREADS} totalCount={3} loading={false} error={false}
        selectedThreadId={undefined} onSelectThread={() => {}} onRetry={() => {}} />);
    expect(queryByText(/Showing .* of .* threads/i)).toBeNull();
  });

  it("renders empty / loading / error states", () => {
    const empty = render(
      <ThreadDock threads={[]} totalCount={0} loading={false} error={false}
        selectedThreadId={undefined} onSelectThread={() => {}} onRetry={() => {}} />);
    expect(empty.getByText(/No threads yet/i)).toBeTruthy();

    const loading = render(
      <ThreadDock threads={[]} totalCount={0} loading error={false}
        selectedThreadId={undefined} onSelectThread={() => {}} onRetry={() => {}} />);
    expect(loading.getByText(/Loading threads/i)).toBeTruthy();

    const onRetry = vi.fn();
    const err = render(
      <ThreadDock threads={[]} totalCount={0} loading={false} error
        selectedThreadId={undefined} onSelectThread={() => {}} onRetry={onRetry} />);
    fireEvent.click(err.getByText(/Retry/i));
    expect(onRetry).toHaveBeenCalled();
  });

  it("collapses to the header when toggled", () => {
    const { getByLabelText, queryByText } = render(
      <ThreadDock threads={THREADS} totalCount={3} loading={false} error={false}
        selectedThreadId={undefined} onSelectThread={() => {}} onRetry={() => {}} />);
    fireEvent.click(getByLabelText(/collapse threads/i));
    expect(queryByText("Insider swap")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/components/ThreadDock.test.tsx`
Expected: FAIL — `./ThreadDock` does not exist.

- [ ] **Step 3: Implement ThreadDock**

Create `frontend/src/components/ThreadDock.tsx`:

```tsx
import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { FindingItem, FindingSeverity, FindingStatus } from "../types";
import { compareBySeverity } from "../views/caseMapElements";
import { threadReadiness } from "./threadReadiness";

type SortKey = "severity" | "status" | "readiness" | "recency";

export interface ThreadDockProps {
  threads: FindingItem[];
  totalCount: number;
  loading: boolean;
  error: boolean;
  selectedThreadId: string | undefined;
  onSelectThread: (id: string) => void;
  onRetry: () => void;
}

const STATUS_RANK: Record<FindingStatus, number> = {
  NEW: 0, NEEDS_EVIDENCE: 1, CONFIRMED: 2, DISMISSED: 3,
};

function statusLabel(s: FindingStatus): string {
  switch (s) {
    case "CONFIRMED": return "Substantiated";
    case "DISMISSED": return "Set aside";
    case "NEEDS_EVIDENCE":
    case "NEW": return "Developing";
    default: return "Developing";
  }
}
function statusColor(s: FindingStatus): string {
  switch (s) {
    case "CONFIRMED": return "var(--color-success, #34d399)";
    case "DISMISSED": return "var(--text-3)";
    default: return "#fbbf24";
  }
}
function severityColor(sev: FindingSeverity): string {
  switch (sev) {
    case "CRITICAL": return "var(--color-critical, #f87171)";
    case "HIGH": return "#fbbf24";
    case "MEDIUM": return "var(--color-info, #60a5fa)";
    default: return "var(--text-3)";
  }
}

function sortThreads(threads: FindingItem[], key: SortKey): FindingItem[] {
  const byTitle = (a: FindingItem, b: FindingItem) => a.title.localeCompare(b.title);
  const copy = [...threads];
  switch (key) {
    case "severity":
      return copy.sort((a, b) => compareBySeverity(a.severity, b.severity) || byTitle(a, b));
    case "status":
      return copy.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || byTitle(a, b));
    case "readiness":
      return copy.sort((a, b) =>
        Number(threadReadiness(b).ready) - Number(threadReadiness(a).ready) || byTitle(a, b));
    case "recency":
      return copy.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    default:
      return copy;
  }
}

export default function ThreadDock({
  threads, totalCount, loading, error, selectedThreadId, onSelectThread, onRetry,
}: ThreadDockProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("severity");
  const sorted = useMemo(() => sortThreads(threads, sortKey), [threads, sortKey]);

  return (
    <div style={{ borderTop: "1px solid var(--border-1)", background: "var(--bg-1)", display: "flex", flexDirection: "column", maxHeight: collapsed ? 33 : 180, flexShrink: 0 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 12px", borderBottom: collapsed ? "none" : "1px solid var(--border-1)", flexShrink: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-3)" }}>
          Threads · {threads.length}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {!collapsed && (
            <label style={{ fontSize: 11, color: "var(--text-3)" }}>
              sort:{" "}
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}
                style={{ fontSize: 11, background: "var(--bg-2)", color: "var(--text-1)", border: "1px solid var(--border-1)", borderRadius: 4 }}>
                <option value="severity">severity</option>
                <option value="status">status</option>
                <option value="readiness">readiness</option>
                <option value="recency">recency</option>
              </select>
            </label>
          )}
          <button type="button" aria-label={collapsed ? "Expand threads" : "Collapse threads"}
            onClick={() => setCollapsed((c) => !c)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", display: "flex" }}>
            {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div style={{ overflowY: "auto" }}>
          {loading ? (
            <div style={{ padding: 12, fontSize: 12, color: "var(--text-3)" }}>Loading threads…</div>
          ) : error ? (
            <div style={{ padding: 12, fontSize: 12, color: "var(--color-critical, #f87171)" }} role="alert">
              Couldn’t load threads.{" "}
              <button type="button" onClick={onRetry} style={{ background: "none", border: "none", color: "var(--color-info, #60a5fa)", cursor: "pointer", textDecoration: "underline" }}>Retry</button>
            </div>
          ) : threads.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, color: "var(--text-3)" }}>
              No threads yet — start one from a subject or relationship.
            </div>
          ) : (
            <>
              {sorted.map((t) => {
                const active = t.id === selectedThreadId;
                const r = threadReadiness(t);
                return (
                  <button key={t.id} type="button" aria-label={`thread row ${t.title}`}
                    data-active={active ? "true" : "false"}
                    onClick={() => onSelectThread(t.id)}
                    style={{
                      display: "grid", gridTemplateColumns: "92px 1fr 70px 150px", gap: 10,
                      alignItems: "center", width: "100%", textAlign: "left",
                      padding: "6px 12px", border: "none", borderTop: "1px solid var(--bg-2)",
                      background: active ? "rgba(251,191,36,0.10)" : "transparent",
                      boxShadow: active ? "inset 3px 0 0 #fbbf24" : "none",
                      cursor: "pointer", color: "var(--text-1)", fontSize: 12,
                    }}>
                    <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: statusColor(t.status) }}>
                      {statusLabel(t.status)}
                    </span>
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-1)", fontWeight: 500 }}>
                      {t.title}
                      {t.rule_id && <span style={{ color: "var(--text-3)", fontSize: 10, marginLeft: 6 }}>{t.rule_id}</span>}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 700, textAlign: "right", color: severityColor(t.severity) }}>
                      {t.severity}
                    </span>
                    <span style={{ fontSize: 10, textAlign: "right", color: r.ready ? "var(--color-success, #34d399)" : "var(--text-3)" }}>
                      {r.ready ? "✓ referral-grade" : r.summary.split(" · ")[0]}
                    </span>
                  </button>
                );
              })}
              {totalCount > threads.length && (
                <div style={{ padding: "6px 12px", fontSize: 10, color: "var(--text-3)" }}>
                  Showing {threads.length} of {totalCount} threads.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

> **Note on the `thread(...)` test factory:** it is built to the exact `FindingItem` shape (`frontend/src/types/index.ts:835-882`) with no boundary cast, so `tsc` validates it. If the type changes upstream, update the fixture to match — never cast it to silence an error.

> **Style note:** `ThreadDock` uses inline styles to match the house pattern (`ThreadInspector`,
> `WhatsMissingPanel`, `SubjectInspector` are all inline-styled — do NOT introduce CSS Modules here).
> For readability, hoist the repeated row grid into module-level style consts at the top of the file —
> e.g. `const ROW_BASE = { display: "grid", gridTemplateColumns: "92px 1fr 70px 150px", gap: 10, ... }`
> and spread `{ ...ROW_BASE, ...(active ? ROW_ACTIVE : null) }` per row — rather than repeating the
> object literal inline.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend && npx vitest run src/components/ThreadDock.test.tsx`
Expected: PASS.

- [ ] **Step 5: Type check + commit**

```bash
cd frontend && npx tsc --noEmit
cd .. && git add frontend/src/components/ThreadDock.tsx frontend/src/components/ThreadDock.test.tsx
git commit -m "feat(case-map): ThreadDock component — sortable thread list (Phase 3)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Wire the dock + Thread Path Mode into InvestigateTab

**Files:**
- Modify: `frontend/src/views/InvestigateTab.tsx`
- Test: `frontend/src/views/InvestigateTab.threadpath.test.tsx` (new)

**Interfaces:**
- Consumes: `ThreadDock` (Task 4), `threadPath`/`severityEdgeClass` (Task 1), `fetchAngles` from `../api`, the existing focus reducer (`selection`, `selectThread`, `clearSelection`).
- Produces: no new exports — terminal integration.

This task carries the §6 reducer-binding invariant, fetch isolation, init ordering, and the no-path state.

- [ ] **Step 1: Add isolated thread state + an isolated fetch effect**

In `InvestigateTab` add imports:
```ts
import { fetchAngles } from "../api";
import ThreadDock from "../components/ThreadDock";
import { threadPath, severityEdgeClass } from "./caseMapElements";
import type { FindingItem } from "../types";
```
Add state near the other `useState` calls:
```ts
const [threads, setThreads] = useState<FindingItem[]>([]);
const [threadsTotal, setThreadsTotal] = useState(0);
const [threadsLoading, setThreadsLoading] = useState(true);
const [threadsError, setThreadsError] = useState(false);
const [cyReady, setCyReady] = useState(false);
```
Add a **separate** effect (NOT in the mount `Promise.all`, so a thread-fetch failure can't blank the map):
```ts
const loadThreads = useCallback(() => {
  setThreadsLoading(true);
  setThreadsError(false);
  fetchAngles(caseId, { limit: 100 })
    .then((res) => { setThreads(res.results); setThreadsTotal(res.count); })
    .catch(() => { setThreads([]); setThreadsTotal(0); setThreadsError(true); })
    .finally(() => setThreadsLoading(false));
}, [caseId]);
useEffect(() => { loadThreads(); }, [loadThreads]);
```
(Add `useCallback` to the React import.)

- [ ] **Step 2: Derive selectedThread (with 101st-thread fallback) + the path set**

A thread can be selected without being in the loaded 100 — the Relationship panel's `thread_refs` come
from `caseMap.edges`, which is independent of the thread fetch. If `threads.find` misses, Path Mode
would lose severity color and (for subject-only threads) `entity_links`, falsely tripping
`noVisibleMapPath`. Guard with a by-id fallback fetch that only fires when the dock page misses (no
extra fetch in the common case). Add `fetchAngle` to the `../api` import.

After the existing `selectedSummaryEdge` memo, add:
```ts
// 101st-thread guard: prefer the dock's loaded page; fall back to a by-id fetch for a thread
// beyond the 100-row cap (e.g. selected via a Relationship-panel thread_ref).
const [selectedThreadFallback, setSelectedThreadFallback] = useState<FindingItem | null>(null);
useEffect(() => {
  if (selection.kind !== "thread" || threads.some((t) => t.id === selection.id)) {
    setSelectedThreadFallback(null);
    return;
  }
  let cancelled = false;
  fetchAngle(caseId, selection.id)
    .then((t) => { if (!cancelled) setSelectedThreadFallback(t); })
    .catch(() => { if (!cancelled) setSelectedThreadFallback(null); });
  return () => { cancelled = true; };
}, [selection, threads, caseId]);

const selectedThread =
  selection.kind === "thread"
    ? threads.find((t) => t.id === selection.id) ?? selectedThreadFallback
    : null;

const pathSet = useMemo(() => {
  if (selection.kind !== "thread") return { pathEdgeIds: [] as string[], participatingSubjectIds: [] as string[] };
  return threadPath({
    threadId: selection.id,
    edges: caseMap?.edges ?? [],
    entityLinks: selectedThread?.entity_links ?? [],
  });
}, [selection, selectedThread, caseMap]);
const noVisibleMapPath =
  selection.kind === "thread" && pathSet.pathEdgeIds.length === 0 && pathSet.participatingSubjectIds.length === 0;
```

> **Perf note:** `threadPath` is O(|edges|), run in `useMemo` on selection change. The `/case-map/`
> graph is *summarized* (one edge per subject pair), so `|edges|` is small by construction. If a very
> large case ever stutters, swap the array scan for Cytoscape's optimized `cy.edges().filter(...)`
> inside `applyThreadPathMode` — not needed now (YAGNI).

- [ ] **Step 3: Implement applyThreadPathMode + call it from effect and onCyInit**

Wrap the function in `useCallback` with **honest** dependencies (no `eslint-disable` — a silenced
`exhaustive-deps` is a stale-closure timebomb). It's called from two places (the effect and
`onCyInit`), so a memoized callback is the right tool. Add `useCallback` to the React import.

```ts
const applyThreadPathMode = useCallback((cy: cytoscape.Core) => {
  cy.elements().removeClass(
    "dimmed thread-path-edge thread-path-edge--critical thread-path-edge--high thread-path-edge--medium thread-path-subject",
  );
  if (selection.kind !== "thread") return;
  if (pathSet.pathEdgeIds.length === 0 && pathSet.participatingSubjectIds.length === 0) return; // no-path: don't dim to nothing
  const suffix = severityEdgeClass(selectedThread?.severity ?? "INFORMATIONAL");
  cy.elements().addClass("dimmed");
  pathSet.pathEdgeIds.forEach((id) =>
    cy.getElementById(id).removeClass("dimmed").addClass(`thread-path-edge${suffix ? " thread-path-edge--" + suffix : ""}`));
  pathSet.participatingSubjectIds.forEach((id) =>
    cy.getElementById(id).removeClass("dimmed").addClass("thread-path-subject"));
}, [selection, pathSet, selectedThread]);

useEffect(() => {
  const cy = cyRef.current;
  if (cy) applyThreadPathMode(cy);
}, [applyThreadPathMode, cyReady]);
```
The effect's deps are now exhaustive and honest: `applyThreadPathMode` (re-created when selection/path
change) + `cyReady` (re-runs once the instance exists). Update the canvas `onCyInit` to flip `cyReady`
and paint immediately (handles selection-before-init):
```tsx
onCyInit={(cy) => { cyRef.current = cy; setCyReady(true); applyThreadPathMode(cy); }}
```

- [ ] **Step 4: Render the dock under the canvas + pass noVisibleMapPath; extend refresh**

Inside the canvas column wrapper (`graph-canvas-dark` div), render `ThreadDock` directly below `CytoscapeCanvas` so it spans the canvas width (NOT inside the right rail). After the canvas `</div>` that wraps the `CytoscapeCanvas`/legend/minimap, add:
```tsx
{!isEmpty && (
  <ThreadDock
    threads={threads}
    totalCount={threadsTotal}
    loading={threadsLoading}
    error={threadsError}
    selectedThreadId={selection.kind === "thread" ? selection.id : undefined}
    onSelectThread={(id) => {
      if (selection.kind === "thread" && selection.id === id) {
        clearSelection();              // clicking the active row exits Path Mode
      } else {
        const t = threads.find((x) => x.id === id);
        selectThread(id, t?.title ?? "");
      }
    }}
    onRetry={loadThreads}
  />
)}
```
> Layout: wrap the existing canvas `<div className="graph-canvas-dark">` and the new `<ThreadDock>` in a flex column (`display:flex; flexDirection:column; flex:1; minWidth:0`) so the map takes the remaining height and the dock sits beneath it. The right rail stays a sibling of that column.

Pass the prop to the existing `ThreadInspector` (line ~638):
```tsx
<ThreadInspector
  caseId={caseId}
  threadId={selection.id}
  noVisibleMapPath={noVisibleMapPath}
  onOpenThread={() => openThread({ id: selection.id, title: activeAngleTitle ?? "" })}
  onClear={clearSelection}
  onChanged={() => { refreshCaseData().catch(/* existing */); }}
/>
```
Extend `refreshCaseData` to refresh the dock list and clear a now-missing thread selection. **Keep the
thread fetch isolated here too (correction #3)** — a dock-refresh failure must not reject the whole
refresh and must not blank the map. After the existing `setCaseMap/setGraph/...` block, in its own
`try/catch`:
```ts
try {
  const ang = await fetchAngles(caseId, { limit: 100 });
  setThreads(ang.results);
  setThreadsTotal(ang.count);
  setThreadsError(false);
  if (selection.kind === "thread" && !ang.results.some((t) => t.id === selection.id)) {
    clearSelection();   // selected thread is gone (e.g. deleted) — don't pin Path Mode to it
  }
} catch {
  setThreadsError(true);
  toast.error("Couldn't refresh threads — retry from the dock.");
}
```

- [ ] **Step 5: Write the integration tests**

Create `frontend/src/views/InvestigateTab.threadpath.test.tsx`. Mock `../api` so `fetchAngles` returns two threads, `fetchCaseMap` returns an edge whose `thread_refs` reference one of them, and the other fetches resolve minimally. Assert the §6 invariant + fetch isolation + no-path. (Follow the mock pattern in the existing `InvestigateTab.caseMap.test.tsx`; read it first for the exact mock shape and `CaseWorkspaceProvider` wrapper.)

```ts
// Skeleton — fill mocks from InvestigateTab.caseMap.test.tsx
it("selecting a dock row enters Thread Path Mode and opens ThreadInspector", async () => {
  // render InvestigateTab inside CaseWorkspaceProvider with mocked api
  // click the dock row for the edge-backed thread
  // assert: ThreadInspector header "Thread" visible; the dock row has data-active="true"
});

it("a thread with no map presence shows the no-visible-path note and does not blank the map", async () => {
  // select the subject-only thread (no matching edge, empty entity_links)
  // assert: "no visible Case Map path yet" text; canvas still rendered
});

it("the Case Map still renders when fetchAngles rejects", async () => {
  // make fetchAngles reject; assert canvas present and dock shows Retry
});

it("paints Path Mode for a thread not in the loaded dock page (101st-thread fallback)", async () => {
  // fetchAngles returns a page WITHOUT thread "T-far"; an edge's thread_refs references "T-far".
  // select it via the Relationship panel thread_ref; fetchAngle("T-far") resolves the detail.
  // assert: ThreadInspector shows it, noVisibleMapPath is false (edge path found), severity honored.
});
```

> The integration test wiring (provider, cytoscape mock) is non-trivial — read `InvestigateTab.caseMap.test.tsx` and reuse its `vi.mock` block and any cytoscape stub verbatim. If Cytoscape class assertions are impractical in jsdom, assert the **observable** proxies instead: `data-active` on the dock row, the ThreadInspector text, and `noVisibleMapPath` behavior — the class application itself is covered by Task 1 (`threadPath`) + Task 3 (stylesheet) unit tests.

- [ ] **Step 6: Run the integration tests + full suite**

Run: `cd frontend && npx vitest run src/views/InvestigateTab.threadpath.test.tsx`
Expected: PASS.
Then full suite: `cd frontend && npx vitest run`
Expected: PASS (all prior tests green — no regressions).

- [ ] **Step 7: Type check + commit**

```bash
cd frontend && npx tsc --noEmit
cd .. && git add frontend/src/views/InvestigateTab.tsx frontend/src/views/InvestigateTab.threadpath.test.tsx
git commit -m "feat(case-map): wire Thread Dock + Thread Path Mode into InvestigateTab (Phase 3)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review (completed)

**Spec coverage:** §4 dock → Task 4 + Task 5 render; §5 Path Mode (path helper, severity suffix, imperative apply, cyReady, no-path) → Tasks 1, 3, 5; §6 reducer-binding invariant → Task 5 Step 5; §7 unified refresh (isolated, with stale-selection cleanup) → Task 5 Step 4; §8 class vocabulary → Task 3; readiness reuse (§4) → Task 2; full severity enum → Tasks 1, 2, 4; fetch isolation on mount **and** refresh → Task 5 Steps 1, 4; honest "N of M" page note via `totalCount`/`FindingsResponse.count` → Task 4; no-path prop → Tasks 2, 5; cyReady → Task 5 Step 3. All covered.

**Pre-build corrections applied:** (#1) `threadPath` test uses valid `EntityType` members (`property`/`financial_instrument`), no `"document"`; (#2) honest `totalCount` "N of M" note, never implies sort reveals unloaded rows; (#3) refresh keeps the thread fetch in its own try/catch so a dock failure can't reject the refresh or blank the map; (#4) accurate `FindingItem` fixture, no boundary cast; (#5) tool-agnostic TDD header.

**Placeholder scan:** Task 5 Step 5 intentionally leaves the integration-test *mock body* to be filled from the existing `InvestigateTab.caseMap.test.tsx` rather than inventing a divergent mock — the assertions and structure are specified; only the shared mock block is reused. All production code is complete.

**Type consistency:** `threadPath` / `severityEdgeClass` / `compareBySeverity` signatures match between Task 1 definition and Task 4/5 consumption. `threadReadiness` shape (`{ ready, summary }`) consistent across Tasks 2, 4. `ThreadDockProps` consistent between Task 4 definition and Task 5 usage. `noVisibleMapPath` prop consistent across Tasks 2, 5.

## Scope guardrails (do NOT build — Phase 5)

No filters, search, saved views, command-palette, resizable dock, or Timeline-brush integration. Sorting only.

## Deferred (tracked, not built here)

- **Investigate remount re-fetch.** `threads` joins the existing pattern where *every* Investigate
  dataset (`fetchGraph`/`fetchCaseMap`/`fetchDashboard`/`fetchReferralReadiness`, `InvestigateTab.tsx:283`)
  re-fires on tab return. Adding `threads` is consistent, not a new regression. The fix is a *holistic*
  Investigate-payload cache across all five fetches (or lifting them together) — a Phase 5 concern, not
  a piecemeal change to one dataset (and the no-reducer-change constraint forbids lifting `threads`
  alone into context). Recorded so it's tracked.

## Review dispositions (principal review, 2026-06-21)

- **#1 101st-thread bug** — FIXED (Task 5 Step 2 fallback fetch).
- **#2 `eslint-disable` exhaustive-deps** — FIXED (Task 5 Step 3 `useCallback`, honest deps).
- **#3 remount re-fetch** — DEFERRED with rationale (above) — pre-existing whole-tab pattern, out of Phase 3 scope.
- **#4 O(|E|) in render** — ACCEPTED as non-issue; documented + escape hatch noted (Task 5 Step 2).
- **#5 inline styles** — KEEP house pattern; extract row style to a const for readability (Task 4 note).
- **#6 `as FindingItem` cast** — already removed in the prior revision; fixture is a strict builder.
