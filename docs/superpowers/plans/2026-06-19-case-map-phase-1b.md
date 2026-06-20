# Case Map Phase 1B — Visual Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Investigate Case Map render from the Phase 1A `/case-map/` contract with abstract markers, strength-based edge thickness, Lucide toolbar icons, a relationship-summary panel, and an ethical legend — without touching `/graph/` (Timeline keeps it).

**Architecture:** A new typed API client (`fetchCaseMap`) feeds pure element-mapping functions (`caseMapElements.ts`) that emit Cytoscape element `data`/`classes`; `CytoscapeCanvas` only *selects* on those (keeps visual logic unit-testable without rendering Cytoscape in jsdom). `InvestigateTab` dual-fetches `/case-map/` (canvas) + `/graph/` (node drill-down) + `dashboard`, routes edge clicks to a new `RelationshipSummaryPanel`, and refetches `/case-map/` after every state-changing action — with `/graph/` and `dashboard` *also* refreshed on tie-off and creation (Lead and re-run already refresh those two and now add `/case-map/`), exactly per D5.

**Tech Stack:** React + TypeScript, Vite, Cytoscape.js (`react-cytoscapejs` + `cytoscape-cose-bilkent`), `lucide-react` (already a dep), Vitest + `@testing-library/react`.

## Global Constraints

- **Controlling spec:** `docs/superpowers/specs/2026-06-19-case-map-and-thread-builder-design.md` (§4 locked contract). **Build design:** `docs/superpowers/specs/2026-06-19-case-map-phase-1b-visual-foundation-design.md` (D1–D5). Where they disagree, the controlling spec governs.
- **Do NOT modify `/graph/`, `fetchGraph`, or the Timeline.** `/graph/` stays for node drill-down + Timeline.
- **Subjects are `person` and `organization` only.** No property/financial nodes on the Case Map.
- **Shape encodes type; color is reserved for state.** Person = circle, Organization = rounded square. `status_unknown` = dashed border (neutral, NOT red, NOT an accusation). `has_substantiated_thread` = green border. `has_active_thread` = amber dot badge. Selected = amber `outline` (stacks with border).
- **Edge thickness from `strength.level`:** `observed < documented < repeated < material`. Base edges neutral grey; no severity color in 1B.
- **`strength.categories` and `strength.reasons` render as SEPARATE sections** — the contract gives two flat unlinked `string[]`s; do NOT attempt to group reasons by category.
- **Vocabulary (new + rebuilt surfaces only):** user-visible copy on widgets we rebuild moves to Subject / Thread / Case Map / Relationship. Do NOT rename internal identifiers (`NavEntry "web"`, `toCyType`, prop names) — that is a separate later pass.
- **Banned user-visible strings:** "Haiku", "Sonnet", "Opus", "Claude", "AI assistant", "LLM", "GPT".
- **Refresh coherence (D5):** every state-changing action (Lead, re-run rules, tie-off, creation) refetches `/case-map/`; tie-off and creation additionally refetch `/graph/` and `dashboard`.
- **Frontend tests run locally:** `cd frontend && npx vitest run <path>`. Type check: `cd frontend && npx tsc --noEmit`. Lint: `cd frontend && npm run lint` (if present).
- **Branch:** `case-map-phase-1b` (already created). Commit after each green task. Pushing/PR is an outward step — confirm with Tyler.

---

## File Structure

- **Modify** `frontend/src/types/index.ts` — add Case Map contract types (`CaseMapResponse`, `SubjectNode`, `SummaryEdge`, `EdgeStrength`, `CaseMapStats`, ref sub-types). Type-only.
- **Modify** `frontend/src/api/graph.ts` — add `fetchCaseMap`. Leave `fetchGraph` untouched.
- **Create** `frontend/src/views/caseMapElements.ts` — pure mapping: `edgeWidthForLevel`, `subjectNodeToElement`, `summaryEdgeToElement`, `subjectBadges`. The single home of Case Map visual-encoding logic.
- **Create** `frontend/src/views/caseMapElements.test.ts` — unit tests for the above.
- **Modify** `frontend/src/components/CytoscapeCanvas.tsx` — new stylesheet (markers/edge-width/outline) + changed `BadgeDescriptor`. Export `STYLESHEET` for a structural test.
- **Create** `frontend/src/components/RelationshipSummaryPanel.tsx` + `.test.tsx` — edge summary inspector (read-only).
- **Create** `frontend/src/components/CaseMapLegend.tsx` + `.test.tsx` — marker/strength key + §10 ethical copy.
- **Modify** `frontend/src/views/InvestigateTab.tsx` — wiring (dual-fetch, elements from caseMap, edge→summary panel, stats sources, refresh paths, Lucide toolbar, vocab copy). Export `WebToolbar`.
- **Modify** `frontend/src/views/InvestigateTab.test.tsx` — toolbar a11y + integration tests.

---

### Task 1: Case Map types + `fetchCaseMap` client

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/api/graph.ts`
- Test: `frontend/src/api/graph.caseMap.test.ts` (create)

**Interfaces:**
- Produces: types `CaseMapResponse`, `SubjectNode`, `SummaryEdge`, `EdgeStrength`, `CaseMapStats`, `EdgeStrengthLevel`, `EvidenceRef`, `ThreadRef`, `UnderlyingRelationship`; `fetchCaseMap(caseId: string): Promise<CaseMapResponse>`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/api/graph.caseMap.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchCaseMap } from "./graph";

afterEach(() => vi.restoreAllMocks());

describe("fetchCaseMap", () => {
  it("GETs the /case-map/ endpoint and returns the parsed body", async () => {
    const body = {
      case_id: "c1",
      nodes: [],
      edges: [],
      stats: {
        subject_count: 0, edge_count: 0,
        by_level: { observed: 0, documented: 0, repeated: 0, material: 0 },
        material_edge_count: 0, handoff_edge_count: 0, generated_at: "2026-06-19T00:00:00Z",
      },
    };
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const result = await fetchCaseMap("c1");
    expect(fetchSpy).toHaveBeenCalledWith("/api/cases/c1/case-map/", expect.objectContaining({ method: "GET" }));
    expect(result.case_id).toBe("c1");
    expect(result.stats.by_level.material).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/api/graph.caseMap.test.ts`
Expected: FAIL — `fetchCaseMap` is not exported.

- [ ] **Step 3: Add the types to `types/index.ts`**

Append near the existing graph types:

```ts
// ---------------------------------------------------------------------------
// Case Map (GET /api/cases/:id/case-map/) — Phase 1A locked contract
// Separate from the raw /graph/ shape: one summarized edge per subject pair.
// ---------------------------------------------------------------------------

export type EdgeStrengthLevel = "observed" | "documented" | "repeated" | "material";

export interface SubjectNode {
  id: UUID;
  type: "person" | "organization";
  label: string;
  subtype: string | null;
  flags: {
    /** Neutral data-completeness flag (org status UNKNOWN) — NOT an accusation. */
    status_unknown: boolean;
    has_active_thread: boolean;
    has_substantiated_thread: boolean;
  };
  metadata: { thread_count: number; document_count: number };
}

export interface EdgeStrength {
  score: number;
  level: EdgeStrengthLevel;
  categories: string[];
  source_count: number;
  transaction_count: number;
  role_count: number;
  thread_count: number;
  substantiated_thread_count: number;
  handoff_included: boolean;
  relationship_types: string[];
  reasons: string[];
}

export interface EvidenceRef {
  kind: string;
  document_id: UUID | null;
  label: string;
  category: string;
}

export interface ThreadRef {
  thread_id: UUID;
  title: string;
  status: FindingStatus;
  severity: FindingSeverity;
  rule_id: string;
  signal_type: string;
  handoff_ready: boolean;
}

export interface UnderlyingRelationship {
  kind: string;
  label: string;
  source: string;
  source_id: UUID;
}

export interface SummaryEdge {
  id: string; // "subjectMin__subjectMax"
  source: UUID;
  target: UUID;
  relationship: "SUMMARY";
  label: string;
  state: EdgeStrengthLevel;
  strength: EdgeStrength;
  evidence_refs: EvidenceRef[];
  thread_refs: ThreadRef[];
  underlying_relationships: UnderlyingRelationship[];
}

export interface CaseMapStats {
  subject_count: number;
  edge_count: number;
  by_level: Record<EdgeStrengthLevel, number>;
  material_edge_count: number;
  handoff_edge_count: number;
  generated_at: ISO8601;
}

export interface CaseMapResponse {
  case_id: UUID;
  nodes: SubjectNode[];
  edges: SummaryEdge[];
  stats: CaseMapStats;
}
```

(If `FindingStatus`/`FindingSeverity`/`UUID`/`ISO8601` are not already imported in scope of this file, they are existing exports in `types/index.ts` — reference them directly; do not redefine.)

- [ ] **Step 4: Add `fetchCaseMap` to `api/graph.ts`**

Add the import and function:

```ts
import type {
  GraphResponse,
  EntityBrowserResponse,
  EntityDetailResponse,
  CaseMapResponse,
} from "../types";

// ... existing fetchGraph stays unchanged ...

/**
 * Fetch the summarized Case Map for a case (Phase 1A contract).
 *
 * Returns subject nodes (person/org only) and one summarized edge per subject
 * pair, each with an explainable `strength` object. Separate from /graph/,
 * which still powers the Timeline and node drill-down.
 */
export async function fetchCaseMap(caseId: string): Promise<CaseMapResponse> {
  return fetchApi<CaseMapResponse>(`/api/cases/${caseId}/case-map/`);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/api/graph.caseMap.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Type check + commit**

```bash
cd frontend && npx tsc --noEmit
cd .. && git add frontend/src/types/index.ts frontend/src/api/graph.ts frontend/src/api/graph.caseMap.test.ts
git commit -m "feat(case-map): CaseMap contract types + fetchCaseMap client"
```

---

### Task 2: Pure element-mapping functions (`caseMapElements.ts`)

The visual-encoding core. Pure functions, no Cytoscape import, fully unit-tested.

**Files:**
- Create: `frontend/src/views/caseMapElements.ts`
- Test: `frontend/src/views/caseMapElements.test.ts`

**Interfaces:**
- Consumes: `SubjectNode`, `SummaryEdge`, `EdgeStrengthLevel` from Task 1; `BadgeDescriptor` from Task 3 (defined there; this task re-exports the active-thread descriptor shape `{ nodeId: string }[]`).
- Produces:
  - `edgeWidthForLevel(level: EdgeStrengthLevel): number`
  - `subjectNodeToElement(node: SubjectNode): { data: Record<string, unknown>; classes: string }`
  - `summaryEdgeToElement(edge: SummaryEdge): { data: Record<string, unknown>; classes: string }`
  - `subjectBadges(nodes: SubjectNode[]): { nodeId: string }[]`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/views/caseMapElements.test.ts
import { describe, it, expect } from "vitest";
import {
  edgeWidthForLevel,
  subjectNodeToElement,
  summaryEdgeToElement,
  subjectBadges,
} from "./caseMapElements";
import type { SubjectNode, SummaryEdge } from "../types";

function node(over: Partial<SubjectNode> = {}): SubjectNode {
  return {
    id: "n1", type: "person", label: "Jay", subtype: null,
    flags: { status_unknown: false, has_active_thread: false, has_substantiated_thread: false },
    metadata: { thread_count: 0, document_count: 0 },
    ...over,
  };
}
function edge(level: SummaryEdge["strength"]["level"]): SummaryEdge {
  return {
    id: "a__b", source: "a", target: "b", relationship: "SUMMARY",
    label: "x", state: level,
    strength: {
      score: 0, level, categories: [], source_count: 0, transaction_count: 0,
      role_count: 0, thread_count: 0, substantiated_thread_count: 0,
      handoff_included: false, relationship_types: [], reasons: [],
    },
    evidence_refs: [], thread_refs: [], underlying_relationships: [],
  };
}

describe("edgeWidthForLevel", () => {
  it("increases monotonically observed < documented < repeated < material", () => {
    const w = (l: SummaryEdge["strength"]["level"]) => edgeWidthForLevel(l);
    expect(w("observed")).toBeLessThan(w("documented"));
    expect(w("documented")).toBeLessThan(w("repeated"));
    expect(w("repeated")).toBeLessThan(w("material"));
  });
});

describe("subjectNodeToElement", () => {
  it("maps person to ellipse data and carries flags", () => {
    const el = subjectNodeToElement(node({ type: "person" }));
    expect(el.data.id).toBe("n1");
    expect(el.data.type).toBe("person");
    expect(el.data.status_unknown).toBe(false);
  });
  it("flags status_unknown / substantiated as data attributes", () => {
    const el = subjectNodeToElement(node({
      type: "organization",
      flags: { status_unknown: true, has_active_thread: false, has_substantiated_thread: true },
    }));
    expect(el.data.type).toBe("organization");
    expect(el.data.status_unknown).toBe(true);
    expect(el.data.has_substantiated_thread).toBe(true);
  });
});

describe("summaryEdgeToElement", () => {
  it("carries level and a numeric width matching edgeWidthForLevel", () => {
    const el = summaryEdgeToElement(edge("repeated"));
    expect(el.data.level).toBe("repeated");
    expect(el.data.width).toBe(edgeWidthForLevel("repeated"));
    expect(el.data.source).toBe("a");
    expect(el.data.target).toBe("b");
  });
  it("tags material edges with a class for emphasis", () => {
    expect(summaryEdgeToElement(edge("material")).classes).toContain("material");
    expect(summaryEdgeToElement(edge("observed")).classes).not.toContain("material");
  });
});

describe("subjectBadges", () => {
  it("returns one badge per node with an active thread, none otherwise", () => {
    const nodes = [
      node({ id: "a", flags: { status_unknown: false, has_active_thread: true, has_substantiated_thread: false } }),
      node({ id: "b" }),
    ];
    expect(subjectBadges(nodes)).toEqual([{ nodeId: "a" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/views/caseMapElements.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `caseMapElements.ts`**

```ts
// frontend/src/views/caseMapElements.ts
/**
 * Pure Case Map element mapping — the single home of Case Map visual encoding.
 *
 * These functions turn the /case-map/ contract (SubjectNode / SummaryEdge) into
 * Cytoscape element `data`/`classes`. The stylesheet in CytoscapeCanvas only
 * *selects* on the attributes set here, so the visual rules are unit-testable
 * without rendering Cytoscape. Shape = type; color = state (spec §10).
 */
import type { SubjectNode, SummaryEdge, EdgeStrengthLevel } from "../types";

/** Discrete edge widths per strength level (observed thin → material strong). */
const EDGE_WIDTH: Record<EdgeStrengthLevel, number> = {
  observed: 1,
  documented: 2,
  repeated: 3.5,
  material: 5,
};

export function edgeWidthForLevel(level: EdgeStrengthLevel): number {
  return EDGE_WIDTH[level];
}

export function subjectNodeToElement(node: SubjectNode): {
  data: Record<string, unknown>;
  classes: string;
} {
  return {
    data: {
      id: node.id,
      label: node.label,
      type: node.type, // "person" | "organization" — stylesheet selects on this
      subtype: node.subtype ?? "",
      status_unknown: node.flags.status_unknown,
      has_active_thread: node.flags.has_active_thread,
      has_substantiated_thread: node.flags.has_substantiated_thread,
      thread_count: node.metadata.thread_count,
      document_count: node.metadata.document_count,
    },
    classes: "subject",
  };
}

export function summaryEdgeToElement(edge: SummaryEdge): {
  data: Record<string, unknown>;
  classes: string;
} {
  const level = edge.strength.level;
  return {
    data: {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      level,
      width: edgeWidthForLevel(level),
      label: edge.label,
    },
    classes: level === "material" ? "summary material" : "summary",
  };
}

/** Active-thread badge descriptors (the amber dot). Other states are borders. */
export function subjectBadges(nodes: SubjectNode[]): { nodeId: string }[] {
  return nodes
    .filter((n) => n.flags.has_active_thread)
    .map((n) => ({ nodeId: n.id }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/views/caseMapElements.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Type check + commit**

```bash
cd frontend && npx tsc --noEmit
cd .. && git add frontend/src/views/caseMapElements.ts frontend/src/views/caseMapElements.test.ts
git commit -m "feat(case-map): pure element-mapping (markers, edge width, badges)"
```

---

### Task 3: Canvas stylesheet + `BadgeDescriptor` change (`CytoscapeCanvas.tsx`)

Replace pictograms with abstract markers, drive edge width from `data(width)`, layer state via border/outline/badge. Export `STYLESHEET` for a structural test.

**Files:**
- Modify: `frontend/src/components/CytoscapeCanvas.tsx`
- Test: `frontend/src/components/CytoscapeCanvas.stylesheet.test.ts` (create)

**Interfaces:**
- Consumes: nothing from other tasks at runtime.
- Produces: exported `STYLESHEET` (array); changed `BadgeDescriptor = { nodeId: string }` (amber active-thread dot only).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/components/CytoscapeCanvas.stylesheet.test.ts
import { describe, it, expect } from "vitest";
import { STYLESHEET } from "./CytoscapeCanvas";

function selectors(): string[] {
  return STYLESHEET.map((r) => r.selector as string);
}

describe("Case Map stylesheet", () => {
  it("encodes subject type by shape, not pictograms", () => {
    const person = STYLESHEET.find((r) => r.selector === 'node[type="person"]');
    const org = STYLESHEET.find((r) => r.selector === 'node[type="organization"]');
    expect(person?.style?.shape).toBe("ellipse");
    expect(org?.style?.shape).toBe("round-rectangle");
    // no pictogram background-image on base markers
    expect(person?.style?.["background-image"]).toBeUndefined();
  });

  it("has neutral state treatments: dashed unknown, green substantiated, outline selected", () => {
    const sel = selectors();
    expect(sel).toContain('node[?status_unknown]');
    expect(sel).toContain('node[?has_substantiated_thread]');
    expect(sel).toContain('node:selected');
    const unknown = STYLESHEET.find((r) => r.selector === 'node[?status_unknown]');
    expect(unknown?.style?.["border-style"]).toBe("dashed");
  });

  it("drives edge width from data(width)", () => {
    const edge = STYLESHEET.find((r) => r.selector === "edge.summary");
    expect(edge?.style?.width).toBe("data(width)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/CytoscapeCanvas.stylesheet.test.ts`
Expected: FAIL — `STYLESHEET` not exported / old shape.

- [ ] **Step 3: Rewrite the stylesheet + BadgeDescriptor**

In `CytoscapeCanvas.tsx`: delete `PERSON_ICON` and `ORG_ICON`. Replace the `STYLESHEET` const with the export below, and change `BadgeDescriptor`.

```ts
/* ─── Stylesheet — abstract markers (shape = type, color = state) ───────────── */
export const STYLESHEET = [
  /* Person — quiet slate filled circle */
  {
    selector: 'node[type="person"]',
    style: {
      "background-color": "#475569",
      "border-width": 1.5,
      "border-color": "#64748b",
      "border-style": "solid",
      shape: "ellipse",
      width: 26,
      height: 26,
      label: "data(label)",
      "text-valign": "center",
      "text-halign": "right",
      "text-margin-x": 8,
      color: "#e2e8f0",
      "text-outline-color": "#0d1117",
      "text-outline-width": 2,
      "font-size": 9,
      "font-weight": "500",
      "text-wrap": "wrap",
      "text-max-width": 110,
    },
  },
  /* Organization — quiet slate rounded square */
  {
    selector: 'node[type="organization"]',
    style: {
      "background-color": "#475569",
      "border-width": 1.5,
      "border-color": "#64748b",
      "border-style": "solid",
      shape: "round-rectangle",
      width: 26,
      height: 26,
      label: "data(label)",
      "text-valign": "center",
      "text-halign": "right",
      "text-margin-x": 8,
      color: "#e2e8f0",
      "text-outline-color": "#0d1117",
      "text-outline-width": 2,
      "font-size": 9,
      "font-weight": "500",
      "text-wrap": "wrap",
      "text-max-width": 110,
    },
  },
  /* Substantiated thread → green border (state color) */
  {
    selector: "node[?has_substantiated_thread]",
    style: { "border-color": "#34d399", "border-width": 3 },
  },
  /* Unknown status → dashed border (neutral, NOT red, NOT an accusation) */
  {
    selector: "node[?status_unknown]",
    style: { "border-style": "dashed", "border-color": "#94a3b8" },
  },
  /* Selected → amber outline, drawn outside the border so it stacks with state */
  {
    selector: "node:selected",
    style: { "outline-width": 3, "outline-color": "#fbbf24", "outline-offset": 2 },
  },
  /* Active-thread badge — small amber dot */
  {
    selector: ".badge",
    style: {
      width: 9,
      height: 9,
      shape: "ellipse",
      "background-color": "#fbbf24",
      "border-width": 1,
      "border-color": "#0d1117",
      label: "",
      events: "no",
      "z-index": 999,
    },
  },
  /* Dimmed (reserved for Phase 3 Thread Path Mode) */
  { selector: ".dimmed", style: { opacity: 0.1 } },
  /* Summary edges — neutral grey, width from strength level */
  {
    selector: "edge.summary",
    style: {
      width: "data(width)",
      "curve-style": "bezier",
      "line-color": "#64748b",
      "target-arrow-shape": "none",
      opacity: 0.6,
    },
  },
  /* Material edges — subtle emphasis (still neutral, no severity color in 1B) */
  {
    selector: "edge.material",
    style: { "line-color": "#94a3b8", opacity: 0.85 },
  },
];
```

Change the badge descriptor and the injection block. Replace the `BadgeDescriptor` interface:

```ts
/** Active-thread badge descriptor — a small amber dot at the node's top-right. */
export interface BadgeDescriptor {
  nodeId: string;
}
```

Update the injection inside `handleCyInit` (the `layoutstop` handler) to drop the count/active logic:

```ts
      if (badges?.length) {
        badges.forEach((b) => {
          const main = cy.getElementById(b.nodeId);
          if (!main.length) return;
          const pos = main.position();
          const w = main.outerWidth();
          const h = main.outerHeight();
          cy.add({
            data: { id: `badge-${b.nodeId}`, mainNodeId: b.nodeId },
            classes: "badge",
            position: { x: pos.x + w * 0.38, y: pos.y - h * 0.38 },
          });
        });
      }
```

Pass `stylesheet={STYLESHEET}` to `<CytoscapeComponent>` (already wired — it references `STYLESHEET`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/CytoscapeCanvas.stylesheet.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Type check + commit**

```bash
cd frontend && npx tsc --noEmit
cd .. && git add frontend/src/components/CytoscapeCanvas.tsx frontend/src/components/CytoscapeCanvas.stylesheet.test.ts
git commit -m "feat(case-map): abstract-marker stylesheet + active-thread badge"
```

---

### Task 4: `RelationshipSummaryPanel` (edge inspector)

Read-only right-panel view for a selected `SummaryEdge`. Categories and reasons are SEPARATE sections (contract gives no mapping).

**Files:**
- Create: `frontend/src/components/RelationshipSummaryPanel.tsx`
- Test: `frontend/src/components/RelationshipSummaryPanel.test.tsx`

**Interfaces:**
- Consumes: `SummaryEdge` (Task 1).
- Produces: default export `RelationshipSummaryPanel({ edge, subjectLabel, onClear })`, where `subjectLabel: (id: string) => string`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/RelationshipSummaryPanel.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import RelationshipSummaryPanel from "./RelationshipSummaryPanel";
import type { SummaryEdge } from "../types";

const edge: SummaryEdge = {
  id: "a__b", source: "a", target: "b", relationship: "SUMMARY",
  label: "Repeated relationship", state: "repeated",
  strength: {
    score: 65, level: "repeated", categories: ["formal_role", "co_mentioned"],
    source_count: 4, transaction_count: 0, role_count: 1, thread_count: 0,
    substantiated_thread_count: 0, handoff_included: false,
    relationship_types: ["OFFICER_OF"],
    reasons: ["Formal role documented", "Appears together in 4 source documents"],
  },
  evidence_refs: [],
  thread_refs: [],
  underlying_relationships: [
    { kind: "OFFICER_OF", label: "Board member", source: "person_org", source_id: "po1" },
  ],
};

describe("RelationshipSummaryPanel", () => {
  it("shows level, categories, reasons (separately), and the neutral §10 note", () => {
    const { container } = render(
      <RelationshipSummaryPanel edge={edge} subjectLabel={(id) => (id === "a" ? "Jay" : "Acme")} onClear={() => {}} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Jay");
    expect(text).toContain("Acme");
    expect(text.toLowerCase()).toContain("repeated");
    expect(text).toContain("Formal role documented");
    expect(text).toContain("formal_role");
    expect(text).toContain("Board member");
    expect(text).toContain("does not imply wrongdoing");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/RelationshipSummaryPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the panel**

```tsx
// frontend/src/components/RelationshipSummaryPanel.tsx
import { X } from "lucide-react";
import type { SummaryEdge } from "../types";

interface Props {
  edge: SummaryEdge;
  subjectLabel: (id: string) => string;
  onClear: () => void;
}

const LEVEL_TEXT: Record<SummaryEdge["strength"]["level"], string> = {
  observed: "Observed relationship",
  documented: "Documented relationship",
  repeated: "Repeated relationship",
  material: "Material relationship",
};

export default function RelationshipSummaryPanel({ edge, subjectLabel, onClear }: Props) {
  const s = edge.strength;
  return (
    <div style={{ padding: 12, fontSize: 11, overflowY: "auto", height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-3)" }}>
          Relationship
        </div>
        <button type="button" onClick={onClear} aria-label="Close relationship detail"
          style={{ background: "none", border: "none", color: "var(--text-3)", cursor: "pointer" }}>
          <X size={14} />
        </button>
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", margin: "6px 0 2px" }}>
        {subjectLabel(edge.source)} — {subjectLabel(edge.target)}
      </div>
      <div style={{ color: "var(--text-2)", marginBottom: 8 }}>{LEVEL_TEXT[s.level]}</div>

      {s.categories.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", marginBottom: 4 }}>Evidence categories</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {s.categories.map((c) => (
              <span key={c} style={{ border: "1px solid var(--border-1)", borderRadius: 999, padding: "1px 7px", color: "var(--text-2)" }}>{c}</span>
            ))}
          </div>
        </div>
      )}

      {s.reasons.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", marginBottom: 4 }}>Why this line exists</div>
          <ul style={{ margin: 0, paddingLeft: 16, color: "var(--text-2)" }}>
            {s.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}

      {edge.underlying_relationships.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", marginBottom: 4 }}>Underlying evidence</div>
          <ul style={{ margin: 0, paddingLeft: 16, color: "var(--text-2)" }}>
            {edge.underlying_relationships.map((u) => <li key={u.source_id}>{u.label}</li>)}
          </ul>
        </div>
      )}

      <hr style={{ border: "none", borderTop: "0.5px solid var(--border-1)", margin: "8px 0" }} />
      <div style={{ fontSize: 10, color: "var(--text-3)" }}>
        Relationship strength reflects source support and investigative relevance. It does not imply
        wrongdoing by either subject.
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/components/RelationshipSummaryPanel.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Type check + commit**

```bash
cd frontend && npx tsc --noEmit
cd .. && git add frontend/src/components/RelationshipSummaryPanel.tsx frontend/src/components/RelationshipSummaryPanel.test.tsx
git commit -m "feat(case-map): RelationshipSummaryPanel (edge inspector, read-only)"
```

---

### Task 5: `CaseMapLegend` (marker/strength key + ethical copy)

**Files:**
- Create: `frontend/src/components/CaseMapLegend.tsx`
- Test: `frontend/src/components/CaseMapLegend.test.tsx`

**Interfaces:**
- Produces: default export `CaseMapLegend()` (no props in 1B).

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/CaseMapLegend.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import CaseMapLegend from "./CaseMapLegend";

describe("CaseMapLegend", () => {
  it("documents markers, strength levels, and the ethical copy", () => {
    const text = render(<CaseMapLegend />).container.textContent ?? "";
    expect(text).toContain("Person");
    expect(text).toContain("Organization");
    expect(text).toContain("Observed");
    expect(text).toContain("Material");
    expect(text).toContain("does not imply wrongdoing");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/CaseMapLegend.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the legend**

```tsx
// frontend/src/components/CaseMapLegend.tsx
import { useState } from "react";

const STRENGTH = ["Observed", "Documented", "Repeated", "Material"];

export default function CaseMapLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "absolute", left: 12, bottom: 12, zIndex: 5, fontSize: 10,
      background: "var(--bg-1)", border: "1px solid var(--border-1)", borderRadius: 6, padding: 8, maxWidth: 240 }}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        style={{ background: "none", border: "none", color: "var(--text-2)", cursor: "pointer", fontWeight: 700, padding: 0 }}>
        Legend {open ? "▾" : "▸"}
      </button>
      {open && (
        <div style={{ marginTop: 6, color: "var(--text-3)", lineHeight: 1.5 }}>
          <div><strong>Person</strong> — circle · <strong>Organization</strong> — square</div>
          <div>Dashed border — status not yet established</div>
          <div>Green border — substantiated thread · Amber dot — active thread</div>
          <div style={{ marginTop: 4 }}>Line weight: {STRENGTH.join(" · ")}</div>
          <div style={{ marginTop: 6 }}>
            Case Map lines show relationships found in source records or entered observations. Line
            weight reflects documentation and repetition. A relationship line does not imply wrongdoing.
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/components/CaseMapLegend.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Type check + commit**

```bash
cd frontend && npx tsc --noEmit
cd .. && git add frontend/src/components/CaseMapLegend.tsx frontend/src/components/CaseMapLegend.test.tsx
git commit -m "feat(case-map): collapsible legend with ethical copy"
```

---

### Task 6: Lucide toolbar (export `WebToolbar`, a11y labels)

**Files:**
- Modify: `frontend/src/views/InvestigateTab.tsx`
- Test: `frontend/src/views/InvestigateTab.test.tsx`

**Interfaces:**
- Produces: exported `WebToolbar` (same props as today). Buttons use Lucide icons + `aria-label`.

- [ ] **Step 1: Write the failing test** (append to existing test file)

```tsx
import { WebToolbar } from "./InvestigateTab";
// (add alongside the existing CredibilityHeader import/tests)

describe("WebToolbar", () => {
  it("renders Lucide actions with accessible labels (no emoji)", () => {
    const noop = () => {};
    const { container, getByLabelText } = render(
      <WebToolbar
        pendingCount={2} showMinimap={false}
        onAddAngle={noop} onFit={noop} onPendingClick={noop} onToggleMinimap={noop}
        leadStatus="idle" onRunLead={noop} rerunPending={false} onRerunRules={noop}
      />,
    );
    expect(getByLabelText("New thread")).toBeTruthy();
    expect(getByLabelText("Fit map")).toBeTruthy();
    expect(getByLabelText("Run Lead analysis")).toBeTruthy();
    // SVG icons present, raw emoji glyphs gone
    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(5);
    expect(container.textContent ?? "").not.toContain("⚑");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/views/InvestigateTab.test.tsx`
Expected: FAIL — `WebToolbar` not exported / labels/emoji mismatch.

- [ ] **Step 3: Convert the toolbar**

Add the import at the top of `InvestigateTab.tsx`:

```ts
import { Flag, Maximize, Map as MapIcon, Sparkles, RefreshCw, Link as LinkIcon } from "lucide-react";
```

Export `WebToolbar` (add `export`) and replace each button's emoji child with a Lucide icon + `aria-label`. Example for the first three; apply the same pattern to the rest:

```tsx
export function WebToolbar({ pendingCount, showMinimap, onAddAngle, onFit, onPendingClick, onToggleMinimap, leadStatus, onRunLead, rerunPending, onRerunRules }: ToolbarProps) {
  return (
    <div className="web-toolbar-rail">
      <button type="button" className="web-tool-btn" title="New thread" aria-label="New thread" onClick={onAddAngle}>
        <Flag size={16} />
      </button>
      <div className="web-toolbar-rail__sep" />
      <button type="button" className="web-tool-btn" title="Fit map" aria-label="Fit map" onClick={onFit}>
        <Maximize size={16} />
      </button>
      <button type="button" className="web-tool-btn" title="Toggle minimap" aria-label="Toggle minimap"
        onClick={onToggleMinimap} style={{ opacity: showMinimap ? 1 : 0.5 }}>
        <MapIcon size={16} />
      </button>
      <div className="web-toolbar-rail__sep" />
      <button type="button" className="web-tool-btn"
        title={leadStatus === "QUEUED" || leadStatus === "RUNNING" ? "Lead analysis running…" : "Run Lead analysis"}
        aria-label="Run Lead analysis" onClick={onRunLead}
        disabled={leadStatus === "QUEUED" || leadStatus === "RUNNING"}
        style={{ opacity: leadStatus === "QUEUED" || leadStatus === "RUNNING" ? 0.5 : 1,
          color: leadStatus === "SUCCESS" ? "var(--color-success, #3fb950)" : undefined }}>
        <Sparkles size={16} />
      </button>
      <button type="button" className="web-tool-btn" title={rerunPending ? "Re-running rules…" : "Re-run signal rules"}
        aria-label="Re-run signal rules" onClick={onRerunRules} disabled={rerunPending}
        style={{ opacity: rerunPending ? 0.5 : 1 }}>
        <RefreshCw size={16} />
      </button>
      <div className="web-toolbar-rail__sep" />
      <button type="button" className="web-tool-btn" title="Pending relationships" aria-label="Pending relationships" onClick={onPendingClick}>
        <LinkIcon size={16} />
        {pendingCount > 0 && <span className="web-tool-btn__badge">{pendingCount}</span>}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/views/InvestigateTab.test.tsx`
Expected: PASS (CredibilityHeader + WebToolbar).

- [ ] **Step 5: Type check + commit**

```bash
cd frontend && npx tsc --noEmit
cd .. && git add frontend/src/views/InvestigateTab.tsx frontend/src/views/InvestigateTab.test.tsx
git commit -m "feat(case-map): Lucide toolbar icons with accessible labels"
```

---

### Task 7: Wire `InvestigateTab` to `/case-map/` (dual-fetch, edge panel, stats, refresh, vocab)

The integration task. Canvas renders from `/case-map/`; node drill-down still uses `/graph/`; edge click → `RelationshipSummaryPanel`; stats from `caseMap.stats`; refresh paths fixed (D5 + dashboard); rebuilt-surface copy moves to new vocab.

**Files:**
- Modify: `frontend/src/views/InvestigateTab.tsx`
- Test: `frontend/src/views/InvestigateTab.caseMap.test.tsx` (create)

**Interfaces:**
- Consumes: `fetchCaseMap` (Task 1); `subjectNodeToElement`, `summaryEdgeToElement`, `subjectBadges` (Task 2); `RelationshipSummaryPanel` (Task 4); `CaseMapLegend` (Task 5).

- [ ] **Step 1: Write the failing integration test**

```tsx
// frontend/src/views/InvestigateTab.caseMap.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";

// Mock CytoscapeCanvas — do NOT render real Cytoscape in jsdom (flaky, and the
// visual mapping is already unit-tested in caseMapElements.test.ts). The stub
// exposes buttons that fire onNodeClick / onEdgeClick so we can drive selection.
vi.mock("../components/CytoscapeCanvas", () => ({
  default: ({ onNodeClick, onEdgeClick }: {
    onNodeClick?: (id: string) => void;
    onEdgeClick?: (id: string) => void;
  }) => (
    <div>
      <button data-testid="cy-node" onClick={() => onNodeClick?.("a")}>node</button>
      <button data-testid="cy-edge" onClick={() => onEdgeClick?.("a__b")}>edge</button>
    </div>
  ),
}));

// Mock the API module so we can assert dual-fetch and feed canvas data.
vi.mock("../api", () => ({
  fetchGraph: vi.fn().mockResolvedValue({ nodes: [], edges: [], timeline_events: [], stats: { node_types: {}, total_edges: 0 } }),
  fetchCaseMap: vi.fn().mockResolvedValue({
    case_id: "c1",
    nodes: [
      { id: "a", type: "person", label: "Jay", subtype: null, flags: { status_unknown: false, has_active_thread: false, has_substantiated_thread: false }, metadata: { thread_count: 0, document_count: 0 } },
      { id: "b", type: "organization", label: "Acme", subtype: null, flags: { status_unknown: false, has_active_thread: false, has_substantiated_thread: false }, metadata: { thread_count: 0, document_count: 0 } },
    ],
    edges: [
      { id: "a__b", source: "a", target: "b", relationship: "SUMMARY", label: "Documented relationship", state: "documented",
        strength: { score: 30, level: "documented", categories: ["formal_role"], source_count: 0, transaction_count: 0, role_count: 1, thread_count: 0, substantiated_thread_count: 0, handoff_included: false, relationship_types: ["OFFICER_OF"], reasons: ["Formal role documented"] },
        evidence_refs: [], thread_refs: [], underlying_relationships: [] },
    ],
    stats: { subject_count: 2, edge_count: 1, by_level: { observed: 0, documented: 1, repeated: 0, material: 0 }, material_edge_count: 0, handoff_edge_count: 0, generated_at: "2026-06-19T00:00:00Z" },
  }),
  fetchFuzzyMatches: vi.fn().mockResolvedValue({ count: 0, results: [] }),
  fetchDashboard: vi.fn().mockResolvedValue({
    case: { id: "c1", name: "C", status: "ACTIVE", created_at: "2026-06-01T00:00:00Z", referral_ref: "" },
    documents: { total: 0, by_type: {}, by_extraction_status: {}, renamed_count: 0 },
    entities: { persons: 1, organizations: 1, properties: 5, financial_instruments: 3, total: 10 },
    findings: { total: 0, by_status: {} },
    credibility: { referral_grade: 0, need_work: 0, agency_leads: 0 },
    quality: undefined,
  }),
  fetchEntityDetail: vi.fn().mockResolvedValue({}),
  runAiPatternAnalysis: vi.fn(),
  reevaluateSignals: vi.fn(),
}));

import * as api from "../api";
import InvestigateTab from "./InvestigateTab";
import { CaseWorkspaceProvider } from "../context/CaseWorkspaceContext";

function renderTab() {
  return render(
    <CaseWorkspaceProvider>
      <InvestigateTab caseId="c1" documents={[]} />
    </CaseWorkspaceProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("InvestigateTab Case Map wiring", () => {
  it("dual-fetches /case-map/ and /graph/ on mount", async () => {
    renderTab();
    await waitFor(() => expect(api.fetchCaseMap).toHaveBeenCalledWith("c1"));
    expect(api.fetchGraph).toHaveBeenCalledWith("c1");
  });

  it("stats bar Subjects count comes from caseMap.stats, not entity total", async () => {
    const { container } = renderTab();
    await waitFor(() => expect(api.fetchCaseMap).toHaveBeenCalled());
    const text = container.textContent ?? "";
    expect(text).toContain("Subjects");
    expect(text).not.toContain("Entities"); // relabeled
    // subject_count is 2; entities.total (10) must NOT be the source
    expect(text).not.toContain("10 Subjects");
  });

  it("edge click opens RelationshipSummaryPanel from the SummaryEdge", async () => {
    const { getByTestId, container, findByText } = renderTab();
    await waitFor(() => expect(api.fetchCaseMap).toHaveBeenCalled());
    fireEvent.click(getByTestId("cy-edge"));
    // panel shows the summary edge's level + reason (not ConnectionDetailPanel)
    expect(await findByText("Formal role documented")).toBeTruthy();
    expect(container.textContent ?? "").toContain("does not imply wrongdoing");
  });

  it("clears the selected relationship when navigating to a subject profile", async () => {
    const { getByTestId, queryByText, findByText } = renderTab();
    await waitFor(() => expect(api.fetchCaseMap).toHaveBeenCalled());
    fireEvent.click(getByTestId("cy-edge"));
    await findByText("Formal role documented");
    // node click navigates away (and must clear selectedSummaryEdge)
    fireEvent.click(getByTestId("cy-node"));
    await waitFor(() => expect(queryByText("Formal role documented")).toBeNull());
  });
});
```

(`CaseWorkspaceProvider` is exported from `context/CaseWorkspaceContext.tsx` and takes only `children` — confirmed.)

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/views/InvestigateTab.caseMap.test.tsx`
Expected: FAIL — `fetchCaseMap` not called / "Subjects" label absent.

- [ ] **Step 3: Wire the data load**

In `InvestigateTab.tsx`:

(a) Import the new pieces:

```ts
import { fetchGraph, fetchCaseMap, fetchFuzzyMatches, fetchEntityDetail, fetchDashboard, runAiPatternAnalysis, reevaluateSignals } from "../api";
import type { CaseMapResponse, SummaryEdge } from "../types";
import { subjectNodeToElement, summaryEdgeToElement, subjectBadges } from "./caseMapElements";
const RelationshipSummaryPanel = lazy(() => import("../components/RelationshipSummaryPanel"));
import CaseMapLegend from "../components/CaseMapLegend";
```

(b) Add state and include `fetchCaseMap` in the load:

```ts
  const [caseMap, setCaseMap] = useState<CaseMapResponse | null>(null);
  const [selectedSummaryEdge, setSelectedSummaryEdge] = useState<SummaryEdge | null>(null);
```

```ts
    Promise.all([
      fetchGraph(caseId),
      fetchCaseMap(caseId),
      fetchFuzzyMatches(caseId, { status: "pending" }),
      fetchDashboard(caseId),
    ])
      .then(([g, cm, fuzzy, dash]) => {
        setGraph(g);
        setCaseMap(cm);
        setPendingCount(fuzzy.count);
        setDashboard(dash);
      })
```

(c) Build canvas elements + badges from `caseMap` (replace the `/graph/`-based `elements`/`badges`):

```ts
  const elements: cytoscape.ElementDefinition[] = caseMap
    ? [
        ...caseMap.nodes.map(subjectNodeToElement),
        ...caseMap.edges.map(summaryEdgeToElement),
      ]
    : [];

  const badges: BadgeDescriptor[] = caseMap ? subjectBadges(caseMap.nodes) : [];

  const isEmpty = !caseMap || caseMap.nodes.length === 0;
```

(d) Edge click → select the summary edge:

```ts
  function handleEdgeClick(edgeId: string) {
    if (current.kind !== "web") return;
    const edge = caseMap?.edges.find((e) => e.id === edgeId) ?? null;
    setSelectedSummaryEdge(edge);
    setWebSelectedEdge(null);
  }
```

(e) Node click stays via `/graph/` for `ProfilePanel`. Keep `handleNodeClick` using `graph?.nodes`; it already resolves by id.

(f) **Clear `selectedSummaryEdge` on every navigation/reset path** (review finding 2 — otherwise the relationship panel stays pinned to a stale edge after the user moves on). Add `setSelectedSummaryEdge(null)` alongside the existing `setWebSelectedEdge(null)` calls in `navigate()` (InvestigateTab.tsx:613) and in `navigateTo()`'s return-to-web branch (InvestigateTab.tsx:627). Example for `navigate()`:

```ts
  function navigate(entry: NavEntry) {
    setNavStack((s) => (sameEntry(s[s.length - 1], entry) ? s : [...s, entry]));
    setWebSelectedEdge(null);
    setSelectedSummaryEdge(null);
    if (entry.kind === "angle") {
      onAngleActive?.({ id: entry.angleId, title: entry.angleTitle });
    } else {
      onAngleActive?.(undefined);
    }
  }
```

And in `navigateTo()`'s `if (top.kind === "web")` branch, add `setSelectedSummaryEdge(null);` next to the existing `setWebSelectedEdge(null);`.

- [ ] **Step 4: Render the summary panel, legend, and stats from caseMap**

(a) In the Level-1 right panel block, render `RelationshipSummaryPanel` when a summary edge is selected (ahead of `WebRightPanel`):

```tsx
        {current.kind === "web" && !showDocument && (
          <div style={{ width: 320, flexShrink: 0, borderLeft: "1px solid var(--border-1)", background: "var(--bg-1)", overflow: "hidden" }}>
            {selectedSummaryEdge ? (
              <Suspense fallback={fallback("Loading…")}>
                <RelationshipSummaryPanel
                  edge={selectedSummaryEdge}
                  subjectLabel={(id) => caseMap?.nodes.find((n) => n.id === id)?.label ?? id.slice(0, 8) + "…"}
                  onClear={() => setSelectedSummaryEdge(null)}
                />
              </Suspense>
            ) : (
              <WebRightPanel
                graph={graph}
                dashboard={dashboard}
                documents={documents}
                selectedEdge={webSelectedEdge}
                onOpenAngle={(angleId, angleTitle) => navigate({ kind: "angle", angleId, angleTitle })}
                onOpenDocument={(documentId, docName) => navigate({ kind: "document", documentId, docName })}
                onClearEdge={() => setWebSelectedEdge(null)}
                leadStatus={leadJob.status}
                leadResult={leadJob.result}
              />
            )}
          </div>
        )}
```

(b) Add `<CaseMapLegend />` inside the canvas container (the `graph-canvas-dark` div), after `<CytoscapeCanvas>`.

(c) Stats bar — switch the Subjects metric to caseMap and relabel. In `WebStatsBar` rename the `Angles`→`Threads` and `Entities`→`Subjects` labels; pass `entities={caseMap?.stats.subject_count ?? null}` from the render site:

```tsx
        <WebStatsBar
          findings={dashboard?.findings.total ?? null}
          documents={dashboard?.documents.total ?? null}
          entities={caseMap?.stats.subject_count ?? null}
          daysOpen={daysOpen}
        />
```

In `WebStatsBar`, change the two `<span className="web-stats-chip__label">` texts: `Angles` → `Threads`, `Entities` → `Subjects`.

(d) Level-1 panel headline — in `WebRightPanel`, source counts from caseMap and use new vocab. Replace the `knotCount`/`edgeCount` derivation and the headline:

```tsx
  const subjectCount = graph ? /* keep prop */ 0 : 0; // replaced below
```

Simpler: pass `caseMap` into `WebRightPanel` and compute:

```tsx
// add `caseMap` to WebPanelProps and the call site, then:
  const subjectCount = caseMap?.stats.subject_count ?? 0;
  const relationshipCount = caseMap?.stats.edge_count ?? 0;
```

and the headline:

```tsx
      <div style={{ fontSize: 10, ...}}>Case Map</div>
      <div style={{ ... }}>
        {caseMap?.stats ? `${subjectCount} subjects · ${relationshipCount} relationships` : "Loading…"}
      </div>
```

Update the help line copy: `Click a knot to open its profile. Click a connection to see detail.` → `Click a subject to open its profile. Click a relationship to see detail.` and the "Confirmed angles"/"Active angles" labels → "Substantiated threads"/"Active threads".

(e) Empty state (`EmptyWeb`): copy → `Your Case Map is empty.` / `Add a subject to start building the map.` / button `+ New thread`.

- [ ] **Step 5: Fix the refresh paths (D5 + dashboard)**

Create one refresh helper and use it in tie-off and creation:

```ts
  async function refreshCaseData() {
    const [cm, g, dash] = await Promise.all([
      fetchCaseMap(caseId), fetchGraph(caseId), fetchDashboard(caseId),
    ]);
    setCaseMap(cm); setGraph(g); setDashboard(dash);
    // The selected relationship may no longer exist after a refresh — clear it
    // rather than leaving the panel pinned to a stale edge (review finding 2).
    setSelectedSummaryEdge(null);
  }
```

- `onAngleTiedOff={() => refreshCaseData().catch((err) => { console.error(err); toast.error("The Case Map didn't refresh — reload if it looks stale."); })}`
- `onCreated`: after `setShowConnectModal(false)` and `navigate(...)`, call `refreshCaseData().catch(...)` (replace the existing `fetchGraph(caseId).then(setGraph)`).
- `handleRerunRules`: add `fetchCaseMap` to its `Promise.all` and `setCaseMap`.
- Lead refresh effect: add `fetchCaseMap` + `setCaseMap`.

- [ ] **Step 6: Run integration tests + full frontend suite**

Run: `cd frontend && npx vitest run src/views/InvestigateTab.caseMap.test.tsx`
Expected: PASS.
Then: `cd frontend && npx vitest run`
Expected: all green (no regression).

- [ ] **Step 7: Type check + commit**

```bash
cd frontend && npx tsc --noEmit
cd .. && git add frontend/src/views/InvestigateTab.tsx frontend/src/views/InvestigateTab.caseMap.test.tsx
git commit -m "feat(case-map): wire Investigate map to /case-map/ (dual-fetch, edge panel, stats, refresh, vocab)"
```

---

### Task 8: Final verification + integration gate

**Files:** none (verification only).

- [ ] **Step 1: Full type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Full test suite**

Run: `cd frontend && npx vitest run`
Expected: all green.

- [ ] **Step 3: Lint**

Run: `cd frontend && npm run lint`
Expected: clean (fix any new warnings in touched files).

- [ ] **Step 4: Manual smoke (local)**

Start the stack (`docker-compose up` or `cd frontend && npm run dev` against the running backend) and confirm on the Investigate tab: abstract markers render (no pictograms); edges thicken by strength; clicking an edge opens the Relationship panel; clicking a node still opens the profile; the Timeline tab still works (proves `/graph/` untouched); the legend toggles; toolbar shows Lucide icons.

- [ ] **Step 5: Stage 2 — Railway PR preview**

Push the branch and open the PR (confirm with Tyler first — outward-facing). Validate the Case Map on the Railway PR preview deployment against a seeded case before merge.

---

## Self-Review

**Spec coverage (build design D1–D5 + controlling §11 1B):**
- D1 dual-fetch + node drill-down kept — Task 7 (load + handleNodeClick intact) ✓
- D1 edge click → `RelationshipSummaryPanel` (not ConnectionDetailPanel) — Tasks 4, 7 ✓
- D2 marker system (shape=type; dashed unknown; green substantiated; amber badge; outline selected) — Tasks 2, 3 ✓
- D3 edge thickness from level, neutral, no severity color — Tasks 2, 3 ✓
- D4 vocab on rebuilt surfaces (stats bar, panel, toolbar, legend, empty state); identifiers untouched — Tasks 6, 7 ✓
- D4 stats-bar "Subjects" sourced from `caseMap.stats.subject_count` (finding 3) — Task 7 ✓
- D5 refresh `/case-map/` on Lead/re-run/tie-off/creation; +dashboard on tie-off/creation (finding 2) — Task 7 ✓
- categories/reasons rendered separately (finding 1) — Task 4 ✓
- Lucide toolbar w/ a11y labels — Task 6 ✓
- legend + §10 ethical copy — Task 5 ✓
- `/graph/` + Timeline untouched — no task modifies `fetchGraph`/Timeline ✓
- `fetchCaseMap` typed client + contract types — Task 1 ✓
- Tests per §11A frontend plan — Tasks 1–7 ✓
- `selectedSummaryEdge` cleared on navigate/navigateTo/refresh (plan-review finding 2) — Task 7 Step 3(f), Step 5 ✓
- InvestigateTab integration test mocks `CytoscapeCanvas` (no real Cytoscape in jsdom; plan-review finding 3) — Task 7 Step 1 ✓
- Architecture paragraph matches D5's asymmetric refresh exactly (plan-review finding 1) — header ✓

**Placeholder scan:** none — every step has runnable code/commands. Two verification notes are flagged (CaseWorkspace provider export name in Task 7 Step 1; `npm run lint` existence in Task 8) — these are "confirm the exact local name," not deferred work.

**Type consistency:** `CaseMapResponse`/`SubjectNode`/`SummaryEdge`/`EdgeStrength` defined in Task 1 and used unchanged in Tasks 2, 4, 7. `BadgeDescriptor = { nodeId }` defined in Task 3, produced by `subjectBadges` (Task 2), consumed in Task 7. `edgeWidthForLevel`/`subjectNodeToElement`/`summaryEdgeToElement`/`subjectBadges` names consistent across Tasks 2, 3 (test), 7. `RelationshipSummaryPanel` props (`edge`, `subjectLabel`, `onClear`) consistent across Tasks 4, 7.
