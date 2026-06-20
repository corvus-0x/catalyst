# Case Map Phase 1B — Visual Foundation — Build Design

**Date:** 2026-06-19 (rev. 2026-06-19 — incorporates design-review findings 1–5)
**Status:** Ready to plan
**Depends on:** Phase 1A (`/api/cases/:id/case-map/`, merged PR #13)
**Controlling spec:** `docs/superpowers/specs/2026-06-19-case-map-and-thread-builder-design.md`
(this doc records the concrete 1B build decisions and **resolves that spec's open Q1**, the node
marker system).

---

## Purpose

Make the visible Investigate Case Map *consume the Phase 1A contract* and look like an analytical
instrument instead of an illustrated org chart. Frontend only. No backend changes.

Phase 1B is the controlling spec's §11 "Case Map visual foundation":

1. Point the Case Map canvas at `/case-map/`; keep `/graph/` for the Timeline.
2. Replace pictogram nodes with abstract markers (shape = subject type).
3. Replace toolbar emoji glyphs with Lucide icons (32px, tooltips).
4. Edge thickness from `strength.level`; quiet neutral base, strong color reserved.
5. Map legend + ethical explanatory copy (§10).

**Explicitly out of scope** (later phases): the full right-inspector workspace / focus reducer
(Phase 2), Thread Path Mode (Phase 3), Thread Builder (Phase 4), and any change to `/graph/`.

---

## Locked decisions (this revision)

### D1 — Endpoint handling: dual-fetch; node drill-down kept, edge panel adapted
The canvas renders from `/case-map/`. `InvestigateTab` *also* keeps fetching `/graph/` in parallel
because the node drill-down (`ProfilePanel`) still consumes it. Subject ids are identical across
both endpoints (Person/Org UUIDs), so:

- **Node click → unchanged.** Resolve the subject id against the `/graph/` dataset and open
  `ProfilePanel` exactly as today. This is the clean part of the migration.
- **Edge click → CANNOT stay unchanged** (review finding 1). A `/case-map/` `SummaryEdge` has id
  `subjectMin__subjectMax` (no relationship segment) and collapses many raw relationships into one;
  the current handler parses `source__target__relationship` and rebuilds a single `GraphEdge`, and
  `ConnectionDetailPanel` is built entirely around one raw `GraphEdge`
  (`relationship`, `metadata.document_ids`, `weight`). That path is structurally incompatible.
  **1B introduces a minimal `RelationshipSummaryPanel`** in the right panel, driven by the
  `SummaryEdge` itself (`strength.level` + `strength.reasons` + `evidence_refs` +
  `underlying_relationships` + `thread_refs`). Subject A/B labels come from the case-map nodes. The
  old `ConnectionDetailPanel` is left in place (still used elsewhere / Phase 2 baseline) but the
  Case Map no longer routes edge clicks to it. This panel is deliberately a thin precursor to the
  Phase 2 Relationship Inspector, not the full inspector.

### D2 — Node marker system (resolves controlling-spec Q1): "Filled shape + state badge"
Shape encodes subject **type**; color is reserved for **state** only. State is layered so the three
treatments never collide (border vs. `outline` vs. badge):

| Element | Treatment | Cytoscape mechanism |
|---|---|---|
| Person | filled circle, quiet slate fill, thin neutral ring | `shape: ellipse` + base border |
| Organization | filled rounded square, quiet slate fill, thin neutral ring | `shape: round-rectangle` + base border |
| Unknown status (`flags.status_unknown`) | **dashed** border — neutral "status not established", **not** an accusation, **not** red (spec §10) | `border-style: dashed` |
| Substantiated thread (`flags.has_substantiated_thread`) | green border color | `border-color` (green) |
| Active thread (`flags.has_active_thread`) | small amber dot badge, top-right | injected badge node |
| Selected | bright amber focus ring, drawn *outside* the border so it stacks with the above | `outline-width` / `outline-color` |

Node size is **fixed** in 1B (no longer driven by `finding_count`). Degree/strength-based sizing is
a possible later refinement, not part of 1B.

### D3 — Edge thickness from `strength.level`
`observed` (thin) → `documented` → `repeated` → `material` (strongest). Base edges stay neutral
grey. `material` edges get subtle emphasis. **No severity coloring in 1B** — colored thread paths
are Phase 3 (Thread Path Mode). Thickness is driven by `strength.level` (discrete per-level widths
in the stylesheet); `strength.score` may additionally inform sort/emphasis.

### D4 — Vocabulary: new + rebuilt surfaces (visible copy), identifiers unchanged
Per the chosen "new surfaces only" scope. Findings 1–4 mean we are **rebuilding** the stats bar,
the Level-1 right panel, and the toolbar — so updating the *visible copy* on those rebuilt widgets
to Subject / Thread / Case Map / Relationship is in-scope and required to avoid a half-migrated
demo surface (review finding 5). Concretely, rename visible strings in:

- the toolbar tooltips/`aria-label`s,
- the legend,
- the stats bar labels (e.g. "Angles" → "Threads", "Entities" → "Subjects") — and when "Entities"
  becomes "Subjects" its **source must switch** from `dashboard.entities.total` (which counts
  Property + FinancialInstrument too) to `caseMap.stats.subject_count`, so the relabeled metric is
  truthful (review finding 3),
- the Level-1 panel headings/copy (e.g. "X knots · Y connections" → "X subjects · Y relationships",
  "Case web" → "Case Map"),
- the empty-state copy.

**Out of scope for 1B (the dedicated later pass):** internal identifiers and types
(`NavEntry "web"`, `toCyType`, component/prop names), the breadcrumb's structural labels beyond the
touched surfaces, and any component we are not otherwise rebuilding. This honors CLAUDE.md's "do not
partially rename" guard by keeping the *code-identifier* migration whole and separate, while the
visible copy on this one rebuilt surface is made consistent.

### D5 — Refresh `/case-map/` after every state-changing action (review finding 2)
The canvas data must be refetched from `/case-map/` (not just `/graph/`) after **all** flows that
can change `flags.has_active_thread`, `flags.has_substantiated_thread`, `handoff_included`, or
`strength.level`:

- Lead (AI pattern analysis) completion,
- Re-run signal rules,
- **Angle tie-off** (`onAngleTiedOff`),
- **New angle/thread creation** (`onCreated`).

Today the last two refetch `/graph/` only (`InvestigateTab.tsx:872`, `:906`); 1B adds the
`/case-map/` refetch (and the `/graph/` refetch stays for the node-drill-down dataset).

**Dashboard must refresh in the same two paths (review finding 2).** The surface reads `dashboard`
for credibility, case quality, findings-by-status, document counts, and the stats bar
(`InvestigateTab.tsx:413`, `:748`). Tie-off and creation change those values, but `onAngleTiedOff`
and `onCreated` refetch only `/graph/` today. The Lead and re-run-rules handlers already refetch
`dashboard`; 1B adds `fetchDashboard` to the tie-off and creation paths so all three datasets
(`/case-map/`, `/graph/`, `dashboard`) stay coherent after every state-changing action.

---

## Components

### Data layer
- **`frontend/src/types/index.ts`** — add `CaseMapResponse`, `SubjectNode`, `SummaryEdge`,
  `EdgeStrength`, `CaseMapStats` matching the §4 locked contract (fields: `level`, `score`,
  `categories`, `reasons`, `source_count`, `transaction_count`, `role_count`, `thread_count`,
  `substantiated_thread_count`, `handoff_included`, `relationship_types`; node `flags` +
  `metadata.thread_count`/`document_count`; stats `subject_count`, `edge_count`, `by_level`,
  `material_edge_count`, `handoff_edge_count`, `generated_at`).
- **`frontend/src/api/graph.ts`** — add `fetchCaseMap(caseId): Promise<CaseMapResponse>` hitting
  `/api/cases/:id/case-map/`. Leave `fetchGraph` and entity functions untouched.

### Canvas — `CytoscapeCanvas.tsx`
- Remove `PERSON_ICON` / `ORG_ICON` pictogram data-URIs.
- New stylesheet implementing D2 markers (border / `outline` / badge layering) and D3 edge
  thickness.
- **`BadgeDescriptor` contract changes** (review finding 3): from `{nodeId, count, active}` to a
  state descriptor for the amber active-thread dot (e.g. `{nodeId, kind: "active_thread"}`). The
  dashed-border and green-border states are **node data attributes**, not badges, so they are read
  from node `data` in the stylesheet, not injected. Keep the post-`layoutstop` injection mechanism
  and `cose-bilkent` layout; only the descriptor shape and the injected visual change.

### Wiring — `InvestigateTab.tsx`
- Add `fetchCaseMap` to the load `Promise.all`; hold `caseMap` in state alongside `graph`.
- Build canvas `elements`/`badges` from `caseMap` nodes/edges + `flags`.
- Node click → resolve subject id against `graph` nodes → existing `ProfilePanel` path (unchanged).
- Edge click → look up the `SummaryEdge` by id in `caseMap.edges` → `RelationshipSummaryPanel`.
- **Level-1 right-panel counts come from `caseMap.stats`** (review finding 4): subject_count /
  edge_count, so the panel and the visible map agree. Findings-by-status / document counts may
  continue to come from `dashboard`.
- The top stats bar (`WebStatsBar`) "Subjects" metric reads `caseMap.stats.subject_count` (not
  `dashboard.entities.total`) per D4/finding 3.
- All four refresh handlers (Lead, re-run rules, tie-off, creation) refetch `/case-map/` per D5;
  tie-off and creation additionally refetch `dashboard`.

### New component — `RelationshipSummaryPanel.tsx`
Minimal right-panel view for a selected `SummaryEdge`: subject A/B labels, `strength.level` badge,
the §10 neutral explanatory line, and the evidence. **`strength.categories` and `strength.reasons`
are rendered as two separate sections** — categories as neutral chips, reasons as a plain list —
**not** "reasons grouped by category": the locked §4 contract exposes both as flat, unlinked
`string[]`s with no reason→category mapping, so grouping is not derivable on the frontend (review
finding 1). Also lists `underlying_relationships` / `thread_refs`. Read-only in 1B (no actions yet —
those are Phase 2). (If reason↔category grouping is wanted later, it requires an additive contract
change, e.g. a `reasons_by_category` shape — out of scope for 1B.)

### Toolbar — Lucide icons
Replace emoji with Lucide (existing dep), icon-first, 32px, tooltips + `aria-label`:
New thread `Flag` · Fit `Maximize` · Minimap `Map` · Run Lead `Sparkles` · Re-run rules
`RefreshCw` · Pending relationships `Link`.

### Legend + ethical copy
Small collapsible legend on the canvas: marker key + edge-strength key + the locked §10 line:
> Case Map lines show relationships found in source records or entered observations. Line weight
> reflects documentation and repetition. A relationship line does not imply wrongdoing.

---

## Test plan (Vitest, controlling-spec §11A frontend)

- Edge element thickness/class maps correctly for each `strength.level`
  (`observed|documented|repeated|material`).
- Subject markers render with the correct shape per `type` (person vs organization) and the
  `status_unknown` (dashed) / `has_substantiated_thread` (green border) / `has_active_thread`
  (amber badge) flag treatments.
- Toolbar renders Lucide icons with accessible labels (tooltip/`aria-label` present).
- `InvestigateTab` calls `fetchCaseMap` **and** still issues the `/graph/` fetch the node
  drill-down depends on (dual-fetch); does not touch the Timeline's `/graph/` usage.
- **Edge click opens `RelationshipSummaryPanel` from the `SummaryEdge`** (not
  `ConnectionDetailPanel`); panel shows `level` + `reasons`.
- **Level-1 panel counts come from `caseMap.stats`** and match the rendered edge count.
- `RelationshipSummaryPanel` renders `level`, `categories` (as chips) and `reasons` (as a list) in
  **separate** sections, plus underlying-relationship rows, from a given `SummaryEdge`.
- Stats bar "Subjects" reflects `caseMap.stats.subject_count` (not the entity total).
- After a simulated tie-off / creation, the refresh path calls `fetchCaseMap`, `fetchGraph`, **and**
  `fetchDashboard`.

Backend is unchanged, so no backend tests are added.

---

## Risks / notes

- **Dual-fetch coupling:** the canvas reads `/case-map/` while node drill-down still reads
  `/graph/` during 1B. Intentional and temporary — Phase 2 collapses `ProfilePanel` onto
  `/case-map/`. The join is by subject id, stable across both endpoints.
- **Edge-panel divergence:** the Case Map edge panel moves to the summary shape now; the old
  `ConnectionDetailPanel` remains until Phase 2 retires it. Two relationship panels coexist briefly
  — acceptable, and the new one is the Phase 2 seed.
- **State staleness:** D5 is the guard against the canvas showing stale `flags`/`level` after
  tie-off or creation — the highest-value correctness item in 1B.
- **No new dependency:** Lucide is already used in 10+ frontend components.
