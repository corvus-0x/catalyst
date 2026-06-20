# Case Map Phase 1B — Visual Foundation — Build Design

**Date:** 2026-06-19
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

**Explicitly out of scope** (later phases): right-inspector workspace / focus reducer (Phase 2),
Thread Path Mode (Phase 3), Thread Builder (Phase 4), and any change to `/graph/`.

---

## Locked decisions (this revision)

### D1 — Endpoint handling: dual-fetch, keep panels
The canvas renders from `/case-map/`. `InvestigateTab` *also* keeps fetching `/graph/` in
parallel so the existing drill-down panels (`ProfilePanel`, `ConnectionDetailPanel`) keep working
unchanged. Those panels are `/graph/`-shaped and move to inspectors in Phase 2. Subject ids are
identical across both endpoints (Person/Org UUIDs), so a click on a case-map marker resolves
against the `/graph/` dataset by id with no translation.

### D2 — Node marker system (resolves controlling-spec Q1): "Filled shape + state badge"
Shape encodes subject **type**; color is reserved for **state** only.

| Element | Treatment |
|---|---|
| Person | filled circle, quiet slate fill, thin neutral ring |
| Organization | filled rounded square, quiet slate fill, thin neutral ring |
| Unknown status (`flags.status_unknown`) | **dashed** border — neutral "status not established", **not** an accusation (spec §10). Not red. |
| Active thread (`flags.has_active_thread`) | small amber dot badge, top-right (reuses existing post-`layoutstop` badge injection) |
| Substantiated thread (`flags.has_substantiated_thread`) | green ring accent |
| Selected | bright amber focus ring |

Node size is **fixed** in 1B (no longer driven by `finding_count`). Degree/strength-based sizing
is a possible later refinement, not part of 1B.

### D3 — Edge thickness from `strength.level`
`observed` (thin) → `documented` → `repeated` → `material` (strongest). Base edges stay neutral
grey. `material` edges get subtle emphasis. **No severity coloring in 1B** — colored thread paths
are Phase 3 (Thread Path Mode). Thickness may be driven by `strength.score` via Cytoscape
`mapData`, with per-`level` overrides for the discrete steps.

### D4 — Vocabulary: new surfaces only
Use Subject / Thread / Case Map / Relationship in the **new or rebuilt** surfaces (legend,
toolbar tooltips, widgets we touch). Do **not** do the broad copy/identifier sweep in 1B (e.g.
`WebStatsBar` labels, `NavEntry "web"`, function names) — that is a dedicated later pass. This
honors CLAUDE.md's "do not partially rename" guard while keeping 1B visual-focused.

---

## Components

### Data layer
- **`frontend/src/types/index.ts`** — add `CaseMapResponse`, `SubjectNode`, `SummaryEdge`,
  `EdgeStrength` matching the §4 locked contract (fields: `level`, `score`, `categories`,
  `reasons`, `source_count`, `transaction_count`, `role_count`, `thread_count`,
  `substantiated_thread_count`, `handoff_included`, `relationship_types`; node `flags` +
  `metadata.thread_count`/`document_count`; stats `by_level`, `edge_count`, etc.).
- **`frontend/src/api/graph.ts`** — add `fetchCaseMap(caseId): Promise<CaseMapResponse>` hitting
  `/api/cases/:id/case-map/`. Leave `fetchGraph` and entity functions untouched.

### Canvas — `CytoscapeCanvas.tsx`
- Remove `PERSON_ICON` / `ORG_ICON` pictogram data-URIs.
- New stylesheet implementing D2 markers and D3 edge thickness. Keep the `cose-bilkent` layout and
  the badge-injection mechanism (now driven by `flags`, not `finding_count`).

### Wiring — `InvestigateTab.tsx`
- Add `fetchCaseMap` to the load `Promise.all`. Hold `caseMap` in state alongside `graph`.
- Build canvas `elements`/`badges` from `caseMap` nodes/edges + flags.
- Node click → resolve subject id against `graph` nodes → existing `ProfilePanel` path (unchanged).
- Edge click → existing `ConnectionDetailPanel` path via the matching `/graph/` edge (unchanged).
- Re-run-rules / Lead refresh handlers also refetch `/case-map/`.

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
- Subject markers render with the correct shape/class per `type` (person vs organization) and the
  `status_unknown` / `has_active_thread` / `has_substantiated_thread` flag treatments.
- Toolbar renders Lucide icons with accessible labels (tooltip/`aria-label` present).
- `InvestigateTab` calls `fetchCaseMap` and still issues the `/graph/` fetch the panels depend on
  (dual-fetch); does not touch the Timeline's `/graph/` usage.

Backend is unchanged, so no backend tests are added.

---

## Risks / notes

- **Dual-fetch coupling:** the canvas and the drill-down panels read different datasets during
  1B. This is intentional and temporary — Phase 2 collapses the panels onto `/case-map/`. The
  join is by subject id, which is stable across both endpoints.
- **Badge mechanism:** the post-`layoutstop` badge injection is reused; only its data source
  changes (flags instead of `finding_count`), keeping layout behavior identical.
- **No new dependency:** Lucide is already used elsewhere in the frontend.
