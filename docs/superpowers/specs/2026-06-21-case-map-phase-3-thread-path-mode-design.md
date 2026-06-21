# Case Map Phase 3 — Thread Path Mode + Thread Dock

**Date:** 2026-06-21
**Status:** **READY TO PLAN** — design approved in brainstorm (visual companion); incorporates the
seven tightening guardrails + the `entity_links` correction.
**Scope:** Frontend only. Completes the Thread Path Mode hook Phase 2 reserved, and adds a
persistent thread dock as the map-side entry point. No backend work, no `/case-map/` contract change.

> ### Relationship to other specs
> - **Implements Phase 3** of `2026-06-19-case-map-and-thread-builder-design.md` (the controlling
>   plan), §7 "Thread Path Mode" + §11 "Phase 3". This document is the detailed design for that phase.
> - **Builds on Phase 2** (`2026-06-20-case-map-phase-2-right-inspector-design.md`): the focus
>   reducer, `selection.kind === "thread"`, and `ThreadInspector` already exist. Phase 3 adds a
>   *render* of that selection state — it does **not** add reducer fields.
> - **Pulls a deliberate slice of Phase 5 forward.** The thread dock is the permanent home for the
>   thread list. Phase 5's filters / date-range / search / command-palette **extend** this dock;
>   they do not replace it. Phase 3 intentionally ships the dock without any of them (see §11).

---

## 1. Purpose — what Phase 3 completes

Selecting a thread should make the Case Map *tell that thread's story*: emphasize the relationships
the thread relies on, give its participating subjects a neutral ring, and dim everything else — so
the map answers "where does this thread live?" without accusing every subject on the path.

Today, selecting a thread (`InvestigateTab.tsx:637`) swaps the right rail to `ThreadInspector` but
the canvas does not react. Phase 1B already **reserved** the mechanism: `CytoscapeCanvas.tsx:89`
ships `/* Dimmed (reserved for Phase 3 Thread Path Mode) */ { selector: ".dimmed", ... }`. Phase 3
completes that reserved vocabulary.

It also closes a real workflow gap: today a thread is only reachable by clicking an edge → opening
the Relationship panel → clicking a `thread_ref` row. A thread that references a subject pair the
investigator hasn't clicked is effectively hidden. Phase 3 adds a **persistent thread dock** so every
thread is reachable from the map in any selection state.

## 2. The three-surface workflow model

Phase 3 turns the Investigate workspace into a professional three-surface analyst layout:

```text
toolbar | Case Map            | Right
        |                     | Inspector
        | Thread Dock         |
```

- **Thread Dock** — *what am I reviewing?* (navigation across all threads)
- **Case Map** — *where does this thread live?* (the path)
- **Right Inspector** — *what is the detail / what's missing?* (`ThreadInspector`)

The dock spans the **map/canvas width only** — it must NOT live inside the right rail. The rail is
single-purpose detail; any list placed in it is evicted the moment a thread is selected (the
rail-contention failure we explicitly rejected). Navigation and detail stay on separate surfaces.

## 3. Decisions locked in brainstorm

| Decision | Choice | Rationale |
|---|---|---|
| Phase 3 scope | Map Path Mode **+** map-side entry | Threads were otherwise unreachable from the map. |
| Entry mechanism | **Bottom dock** (canvas-width) | Investigator workflow is a *sustained sweep* across all threads; a dock stays put while the rail/map update per selection. |
| Dock organization | **Flat, sortable; default severity desc** | Worst-first triage; superset of grouped-by-status (status becomes a sort key). The surface Phase 5 extends. |
| Row content | status · title (+rule id) · severity · readiness | Readiness reuses the referral-grade predicate (`ThreadInspector.gapSummary`). |
| Highlight mechanism | **Imperative class toggle** on the live `cy` instance | Element rebuild would re-run cose-bilkent layout → node jitter. Class toggling keeps positions stable; idiomatic Cytoscape. |
| Sort | **Client-side** over the loaded list | List loads fully (`limit: 100`); instant re-key, no refetch. |

## 4. Thread Dock (new surface)

### Layout
- New zone below the canvas+rail row, spanning the **canvas width** (toolbar left, right rail right).
- **Collapsible from day one:** expanded ≈ 180px; collapsed = header bar only. The investigator must
  be able to reclaim canvas height when just exploring the map. Persist collapsed state in component
  state (no need to persist across reloads in v1).
- **Not resizable.** Consistent with Phase 2's "no resizable panels in first pass."

### Data
- `fetchAngles(caseId, { limit: 100 })` → `FindingsResponse` (`{ results: FindingItem[] }`).
  Existing endpoint `/api/cases/:id/findings/`. No new endpoint.
- **v1 thread cap (correction #3):** the dock loads **up to 100 threads**, matching the existing
  `AnglePickerModal` behavior. "Every thread is reachable from the map" is therefore true *up to that
  cap*; fetch-all/pagination is a Phase 5 concern. If a case exceeds 100 threads in v1, the dock shows
  a muted "showing first 100 — sort to surface the rest" note rather than silently truncating.
- **Dock fetch is isolated from the map load (correction #1).** The thread list does **not** share the
  Phase-1 `Promise.all` with `fetchGraph`/`fetchCaseMap` — a `fetchAngles` failure must not blank the
  Case Map. The dock owns its own `threads: FindingItem[]` + `threadsLoading` + `threadsError` state
  in `InvestigateTab`, loaded by a **separate** effect (or, if kept in one batch, via
  `Promise.allSettled` so the map still renders when only threads fail). Refreshed per §7.

### Rows
Four columns: `status pill · title (+ rule id) · severity · readiness`.

- **status pill** — Developing (amber, `NEEDS_EVIDENCE`/`NEW`) · Substantiated (green, `CONFIRMED`) ·
  Set aside (grey, `DISMISSED`). Same `statusLabel`/`statusColor` mapping as `ThreadInspector`.
- **title** — `finding.title`, ellipsized; rule id (`finding.rule_id`) as a muted suffix when present.
- **severity** — full enum (correction #2): CRITICAL `#f87171` / HIGH `#fbbf24` / MEDIUM `#60a5fa` /
  **LOW** `var(--text-3)` / **INFORMATIONAL** `var(--text-3)`. Matches `ThreadInspector.severityColor`,
  which must be extended to cover LOW/INFORMATIONAL (it currently `default`s them — fine, but make it
  explicit).
- **readiness** — reuse the exact gap logic from `ThreadInspector.gapSummary()`: "✓ referral-grade"
  when all conditions met, else the first unmet gap ("needs cited source", "needs overreach review",
  "not yet substantiated", "evidence below Documented"). This is the `referral_grade.py` predicate,
  so the dock cannot drift from the credibility header or the PDF filter. **Extract `gapSummary` into
  a shared pure helper** (e.g. `threadReadiness(finding): { ready: boolean; summary: string }`) so
  the dock and `ThreadInspector` share one definition rather than copying it.

### Sort
- Flat list, **client-side**, default **severity desc**. Full severity order (correction #2):
  **CRITICAL > HIGH > MEDIUM > LOW > INFORMATIONAL**, tie-broken by title for stable ordering. A small
  sort control re-keys by: severity · status · readiness · recency (`updated_at`).
- No grouping headers (status is a column/pill, not a section).

### States
- **Loading** — "Loading threads…"
- **Error** — surfaced (toast + inline), with retry; a failed load must not look like an empty case.
- **Empty** — "No threads yet — start one from a subject or relationship."

### Active row
The row whose `id === selection.id` (when `selection.kind === "thread"`) gets the amber left-bar.
The dock is a **view of the reducer** — it derives the active row from `selection`, never stores its
own "active thread." See §6.

## 5. Thread Path Mode (the map reaction)

### Trigger
`selection.kind === "thread"` on the web frame — set by a dock row click **or** the existing
Relationship-panel `thread_ref` path (`onSelectThread` → `selectThread`). Both routes converge on the
same reducer selection, so Path Mode behaves identically regardless of entry.

### Selected-thread lookup (correction #1)
The reducer selection stores only `{ kind: "thread"; id }`. Path Mode needs the full thread record
(severity for edge color, `entity_links` for single-subject threads, status/readiness for the
inspector). `InvestigateTab` derives it from the dock's loaded list:

```ts
const selectedThread =
  selection.kind === "thread"
    ? threads.find((t) => t.id === selection.id) ?? null
    : null;
```

If a thread is selected from the Relationship panel before/while the dock list is still loading, the
lookup resolves once `threads` arrives (the derive re-runs on every render). Until it resolves,
Path Mode falls back to a neutral (non-severity) emphasis so the path still shows.

### Path computation (pure + testable, correction #3)
A new pure function in `caseMapElements.ts`:

```ts
threadPath(args: {
  threadId: string;
  edges: SummaryEdge[];
  entityLinks: FindingEntityLink[];   // selectedThread.entity_links ?? []
}): { pathEdgeIds: string[]; participatingSubjectIds: string[] }
```

- **pathEdgeIds** = edges whose `thread_refs` include `threadId`.
- **participatingSubjectIds** = the union of:
  - endpoints (`source`/`target`) of those path edges, **and**
  - `entityLinks` filtered to `entity_type ∈ {person, organization}` (their `entity_id`).

This makes **single-subject threads real, not aspirational**: a thread that references one subject and
no relationship edge still lights that subject. Edge-backed and subject-only threads share one helper.

### Severity → path-edge class suffix (correction #2)
A pure helper maps the full enum to an optional severity suffix:

```ts
severityEdgeClass(sev: FindingSeverity): "" | "critical" | "high" | "medium"
// CRITICAL→"critical", HIGH→"high", MEDIUM→"medium", LOW→"", INFORMATIONAL→"" (neutral path)
```

LOW / INFORMATIONAL / unknown severity get **no** severity class — the path edges still emphasize
(via `.thread-path-edge` width) but stay neutral-colored. Strong color is reserved for genuinely
elevated severity.

### Imperative application (corrections #4, #5)
The work lives in an `applyThreadPathMode(cy)` function called from **two** places so it is robust to
Cytoscape init ordering (correction #5 — `cyRef.current` is not reactive, so an effect keyed on
selection won't re-run just because the instance became available):

1. a `useEffect` keyed on `[selection, selectedThread, caseMap, cyReady]`, and
2. directly inside `onCyInit` after the ref is set (so a selection that already exists at mount paints).

`cyReady` is a `useState(false)` flag flipped to `true` in `onCyInit`; including it in the effect deps
guarantees the effect re-runs once the instance exists. The function:

```ts
function applyThreadPathMode(cy: cytoscape.Core) {
  cy.elements().removeClass(
    "dimmed thread-path-edge thread-path-edge--critical thread-path-edge--high " +
    "thread-path-edge--medium thread-path-subject"
  );
  if (selection.kind !== "thread") return;          // exited Path Mode → baseline
  const { pathEdgeIds, participatingSubjectIds } = threadPath({
    threadId: selection.id,
    edges: caseMap?.edges ?? [],
    entityLinks: selectedThread?.entity_links ?? [],
  });
  if (pathEdgeIds.length === 0 && participatingSubjectIds.length === 0) return; // §5 no-path: don't dim to nothing
  const suffix = severityEdgeClass(selectedThread?.severity ?? "INFORMATIONAL");
  cy.elements().addClass("dimmed");
  pathEdgeIds.forEach((id) => cy.getElementById(id)
    .removeClass("dimmed")
    .addClass(`thread-path-edge${suffix ? " thread-path-edge--" + suffix : ""}`));
  participatingSubjectIds.forEach((id) => cy.getElementById(id)
    .removeClass("dimmed").addClass("thread-path-subject"));
}
```

Contract: remove all Phase-3 classes first, then (only if a path exists) dim-all + emphasize-path.
Cleanup on exit removes every Phase-3 class and `dimmed` so the map returns to its Phase-1B baseline.

### No-visible-path state (correction #4 / guardrail #4)
If `pathEdgeIds` **and** `participatingSubjectIds` are both empty, do **not** silently dim the whole
map to nothing. Skip the dim (handled by the early-return in `applyThreadPathMode`), and surface an
explicit, neutral message in `ThreadInspector`:

> This thread has no visible Case Map path yet.

**Concrete prop path (correction #4):** `InvestigateTab` passes the boolean down —

```tsx
<ThreadInspector
  noVisibleMapPath={pathEdgeIds.length === 0 && participatingSubjectIds.length === 0}
  ... />
```

`InvestigateTab` already computes `threadPath` for the effect; it reuses that result for the prop
(compute once per render via a `useMemo` on `[selection, selectedThread, caseMap]`, feeding both the
effect and the prop so they cannot disagree). This is useful information (the thread's subjects aren't
on the current map / didn't resolve to a subject pair), not an error — a real case: STATUS notes
SR-003/SR-005 demo threads whose transactions don't resolve to case subjects.

### Exit
Path Mode ends when `selection.kind !== "thread"`: clearing selection, Esc, clicking the active dock
row again (toggles to `clearSelection`), or selecting a subject/relationship. The cleanup branch of
the same `useEffect` removes all Phase-3 classes.

## 6. The reducer-binding invariant (guardrail #7)

The single behavior Phase 3 must protect:

> **dock active row === `selection.kind === "thread"` (id) === `ThreadInspector` thread === map path**

All four are views of one reducer selection. None stores its own copy of "the active thread." The map
styling is secondary; this binding is the primary invariant and gets a dedicated integration test (§10).

## 7. Unified refresh story (correction #5 / guardrail #5)

The dock's `threads` list must never go stale while the rail looks fresh. Extend the Phase-2
`refreshCaseData()` to also `fetchAngles` and update `threads`, so a single refresh keeps map +
dashboard + readiness + **thread list** coherent. It must run after anything that changes threads:

- thread created (ConnectKnotsModal `onCreated`)
- thread set aside (`ThreadInspector` `onChanged`)
- thread tied off (`AngleView` `onAngleTiedOff`)
- Lead analysis completes (`leadJob` success effect)
- signal re-run (`handleRerunRules`)
- citation/source changes that affect the readiness column

Mirror the existing relationship-selection rule: `refreshCaseData` already clears a stale
*relationship* selection (edge identity can change). A **thread** selection uses a stable finding
UUID and should survive refresh — but if the selected thread is **gone** from the refreshed list
(e.g. deleted), clear the selection so Path Mode doesn't pin to a missing thread.

## 8. Class / CSS vocabulary (guardrail #5)

Phase 1B reserved `.dimmed`. Phase 3 completes the vocabulary. Add to the `STYLESHEET` in
`CytoscapeCanvas.tsx`:

| Class | Applies to | Style intent |
|---|---|---|
| `.dimmed` | non-path nodes + edges | opacity 0.1 (already shipped) |
| `.thread-path-edge` | path edges | emphasis width; **base neutral** — applied alone for LOW / INFORMATIONAL / unknown severity |
| `.thread-path-edge--critical` | path edges, CRITICAL thread | line-color `#f87171` |
| `.thread-path-edge--high` | path edges, HIGH thread | line-color `#fbbf24` |
| `.thread-path-edge--medium` | path edges, MEDIUM thread | line-color `#60a5fa` |
| `.thread-path-subject` | participating subjects | neutral amber focus ring (generalize the existing `node:selected` outline) |

Severity color lives on the **path edges only**, and **only for CRITICAL/HIGH/MEDIUM** — LOW and
INFORMATIONAL threads emphasize the path width without color (correction #2). Subject rings stay
neutral regardless — *color the path, not the people* (§10 of the controlling plan).

## 9. What does NOT change

- **No backend work.** `entity_links` (with `entity_type`) is already in the `/findings/` list
  serializer and `FindingItem` type. `/case-map/` contract unchanged.
- **`ThreadInspector` stays** as the right-rail detail (already shows cited sources + gaps). Additions:
  a `noVisibleMapPath` prop driving the "no visible Case Map path yet" line (§5); consuming the shared
  `threadReadiness` helper extracted from its `gapSummary`; and an explicit LOW/INFORMATIONAL case in
  `severityColor` (correction #2).
- **The focus reducer is unchanged.** Path Mode is a render of existing `selection.kind === "thread"`.

## 10. Test plan (TDD)

**Pure unit (Vitest, no Cytoscape render):**
- `threadPath` — multi-edge thread returns all path edges + their endpoints.
- `threadPath` — subject-only thread (no matching edge) returns the `entity_links` person/org ids,
  empty `pathEdgeIds`.
- `threadPath` — thread with no map presence returns both empty (drives the §5 no-path state).
- `threadPath` — `entity_links` filtered to person/organization (ignores document/property links).
- `severityEdgeClass` — full enum: CRITICAL/HIGH/MEDIUM → suffix; **LOW/INFORMATIONAL → `""`** (neutral).
- severity **sort comparator** — CRITICAL > HIGH > MEDIUM > LOW > INFORMATIONAL, title tie-break.
- `threadReadiness` — referral-grade vs each unmet-gap string (parity with old `gapSummary`).

**Dock component (Vitest):**
- renders rows from `FindingItem[]` with all four columns.
- sort control re-keys order (severity default; status/readiness/recency).
- readiness cell matches `threadReadiness`.
- row click dispatches `selectThread`; clicking the active row clears selection.
- active row reflects `selection`.
- loading / error+retry / empty states.
- collapse toggle hides the body, keeps the header.

**Integration (`InvestigateTab`) — the §6 invariant:**
- selecting a dock row → `selection.kind === "thread"` → `ThreadInspector` opens → Path Mode classes
  computed (assert `threadPath` result wired to `cy`) → active row highlighted.
- clearing / selecting elsewhere → all Phase-3 classes removed, dock row de-highlighted.
- refresh after a thread-changing action updates the dock list (no stale rows); selection of a
  now-deleted thread is cleared.
- **fetch isolation (correction #1):** when `fetchAngles` rejects but the map fetches succeed, the
  Case Map still renders and the dock shows its own error+retry — the map is not blanked.
- **init ordering (correction #5):** a thread selection that exists *before* `onCyInit` fires still
  paints Path Mode once the instance is ready (the `cyReady`/`onCyInit` path).
- **no-path:** a thread with empty `threadPath` leaves the map un-dimmed and passes
  `noVisibleMapPath` to `ThreadInspector`.

Frontend tests run locally (Vitest); no backend suite impact.

## 11. Scope guardrails — what Phase 3 does NOT ship (guardrail #6)

Explicitly deferred to Phase 5 so the dock does not become a second project:

- ❌ filters (category / strength / status / source / date range)
- ❌ search
- ❌ saved views
- ❌ command-palette integration
- ❌ resizable dock
- ❌ Timeline-brush integration

Phase 3 ships: the dock (fixed height, collapsible, client-side sort only), Thread Path Mode, the
shared readiness helper, and the class vocabulary. Nothing more.

## 12. File-level change map

| File | Change |
|---|---|
| `frontend/src/views/caseMapElements.ts` | add pure `threadPath(...)`, `severityEdgeClass(...)`, severity sort comparator |
| `frontend/src/components/threadReadiness.ts` (new) | extract `gapSummary` → shared `threadReadiness(finding)` |
| `frontend/src/components/ThreadInspector.tsx` | consume `threadReadiness`; add `noVisibleMapPath` prop + line; extend `severityColor` for LOW/INFORMATIONAL |
| `frontend/src/components/ThreadDock.tsx` (new) | the dock surface (rows, full-enum sort, collapse, loading/error/empty/100-cap states) |
| `frontend/src/components/CytoscapeCanvas.tsx` | add `.thread-path-edge*` + `.thread-path-subject` styles (`onCyInit` already exists) |
| `frontend/src/views/InvestigateTab.tsx` | isolated `threads`/`threadsLoading`/`threadsError` state (separate effect or `allSettled`); `cyReady` state set in `onCyInit`; dock render + layout; `selectedThread` derive; `threadPath` `useMemo` feeding both the Path Mode effect and `noVisibleMapPath`; `applyThreadPathMode` called from effect + `onCyInit`; extend `refreshCaseData` with `fetchAngles` + stale-selection cleanup |
| `*.test.ts(x)` | per §10 |

No backend files change.
