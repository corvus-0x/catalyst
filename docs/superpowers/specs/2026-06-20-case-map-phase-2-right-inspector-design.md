# Case Map Phase 2 — Right Inspector Workspace — Design

**Date:** 2026-06-20
**Status:** Ready to plan
**Depends on:** Phase 1A (`/case-map/`, PR #13) + Phase 1B (visual Case Map, PR #14) — both merged.
**Controlling spec:** `docs/superpowers/specs/2026-06-19-case-map-and-thread-builder-design.md`
(§5 persistent workspace, §5.1 focus reducer, §6 inspector system, §9 readiness, §11 Phase 2).
**Absorbs:** `docs/superpowers/specs/2026-06-19-context-panel-three-state-design.md` — its **focus
reducer** (§3) and **"What's Missing" panel** (§5) carry forward; its **state-swap / canvas-hidden
layout is dead** (replaced by persistent map + right inspector). This doc **resolves** the
controlling spec's open Q3 (Subject Inspector fields) and Q4 (Relationship Inspector fields).

---

## 1. Goal

Turn the Investigate tab into a **case workbench**: a persistent Case Map with a fixed right
**inspector** that reflects the current selection, replacing the tab's two half-wired navigation
mechanisms (`navStack` + the `onAngleActive` callback) with **one context-owned focus model**.

Frontend only. No backend changes — the inspectors compose data already fetched
(`/case-map/`, `fetchEntityDetail`, `referral-readiness`).

---

## 2. The central rule (locks the whole design)

> **Selection is inspector state. Frame is history.**

- **Selection** (`selectSubject` / `selectRelationship` / `selectThread`) only changes the **right
  inspector**; the **Case Map stays visible**. It never pushes breadcrumb history.
- **Frame** (`openProfile` / `openThread` / `openDocument`) pushes a full-width view that
  **replaces the map** and forms the breadcrumb/back history.

This distinction is what prevents Phase 2 from rebuilding the superseded full-width-swap under new
names. Selecting a subject is *not* navigation; opening its full profile *is*.

---

## 3. The focus model (reducer)

`CaseWorkspaceContext` converts from `useState` (`frontend/src/context/CaseWorkspaceContext.tsx`,
currently simple) to a `useReducer`. It becomes the single source of truth for Investigate focus.

### 3.1 Types

```ts
// Full-width frames — REPLACE the map; form breadcrumb/back history. Always starts [{kind:"web"}].
type Frame =
  | { kind: "web" }
  | { kind: "profile"; id: string; entityType: EntityType; name: string }
  | { kind: "angle"; id: string; title: string }      // full AngleView (a "Thread" in UI copy)
  | { kind: "document"; id: string; name: string };

// Transient selection WITHIN the web frame — map stays visible, only the rail changes.
type Selection =
  | { kind: "none" }                          // → WhatsMissingPanel
  | { kind: "subject"; id: string }           // → SubjectInspector
  | { kind: "relationship"; edgeId: string }  // → RelationshipSummaryPanel (1B seed)
  | { kind: "thread"; id: string };           // → ThreadInspector

interface FocusState {
  history: Frame[];          // breadcrumb; replaces navStack
  selection: Selection;      // transient; replaces webSelectedEdge/selectedSummaryEdge
  activeEntityId: string | undefined;   // maintained pointers for feeders
  activeAngleId: string | undefined;
  activeAngleTitle: string | undefined;
}
```

### 3.2 Actions

| Action | `history` | `selection` | pointers |
|--------|-----------|-------------|----------|
| `selectSubject(id)` | unchanged (stays on `web`) | `{subject,id}` | `activeEntityId = id` |
| `selectRelationship(edgeId)` | unchanged | `{relationship,edgeId}` | unchanged |
| `selectThread(id, title)` | unchanged | `{thread,id}` | `activeAngleId/Title = id/title` (so feeders target it without opening full view) |
| `clearSelection()` | unchanged | `{none}` | unchanged |
| `openProfile(e)` | push `profile` (dedup) | `{none}` | `activeEntityId = e.id` |
| `openThread(a)` | push `angle` (dedup) | `{none}` | `activeAngleId/Title = a` |
| `openDocument(d)` | push `document` (dedup) | `{none}` | unchanged (keeps active angle so a doc can cite into it) |
| `goBack()` / `goTo(i)` | pop / truncate | `{none}` | **recompute** from new top |
| `clearActiveAngle()` | unchanged | unchanged | `activeAngleId/Title = undefined` (header chip) |

`dedup` = don't push if the top frame already equals the target (preserves the double-tap guard).

### 3.3 Pointer recompute (subtle invariant, carried over verbatim from context-panel §3.3)

```
recompute(history):
  activeAngle  = nearest frame of kind "angle"  scanning top → bottom, else undefined
  activeEntity = nearest frame of kind "profile" scanning top → bottom, else undefined
```

So "open a Thread → activeAngle set → drill into a document opened from it → activeAngle still set"
holds, and feeder Cite keeps targeting the right thread. `clearActiveAngle()` is the one explicit
override (header chip); a later `goBack`/`goTo` may legitimately re-derive the pointer from history.

### 3.4 Hook surface

`useCaseWorkspace()` keeps the selector names `activeEntityId` / `activeAngleId` /
`activeAngleTitle` (feeders, DocumentView, Timeline keep working unchanged) and adds
`currentFrame`, `history`, `selection`, plus the action creators above. The old `setActiveEntity` /
`setActiveAngle` setters are removed; callers migrate (`setActiveAngle(undefined)` →
`clearActiveAngle()`; knot click → `selectSubject`).

---

## 4. Layout state map

The Investigate tab has **two render modes**, switched on `currentFrame.kind`:

**1. Map workspace mode** — `currentFrame.kind === "web"`
- left toolbar rail · persistent Case Map (center) · fixed right inspector **340px** (within the
  spec's 320–360 band; collapsible later, not resizable now).
- the inspector is chosen by `selection.kind`:

```ts
switch (selection.kind) {
  case "none":         return <WhatsMissingPanel />;
  case "subject":      return <SubjectInspector />;
  case "relationship": return <RelationshipSummaryPanel />;   // 1B component
  case "thread":       return <ThreadInspector />;
}
```
- canvas: the selected subject gets a focus ring; (Thread Path Mode highlighting is **Phase 3**,
  not here).

**2. Full frame mode** — `currentFrame.kind !== "web"` (map hidden, existing full-width views)
- `profile` → existing `ProfilePanel` (untouched) · `angle` → existing `AngleView` (untouched) ·
  `document` → existing `DocumentView` (untouched).
- breadcrumb + back come from reducer `history`; pointers recompute from history.

### Implementation rule (no parallel state)
`InvestigateTab` must **not** keep local equivalents of reducer state. `selectedSummaryEdge`,
`navStack`, `webSelectedEdge`, `sameEntry`, `navigate`, `navigateTo`, `navigateBack`, and the
`onAngleActive` callback **migrate into the reducer or are deleted**. Local state that **stays**:
fetched data (`graph`, `caseMap`, `dashboard`, `readiness`), modal open/closed, minimap
visibility, loading/error, entity-detail cache, Lead job state.

This also retires the now-dead `webSelectedEdge` → `ConnectionDetailPanel` branch flagged in the 1B
review (the Case Map edge path now goes through `selectRelationship` → `RelationshipSummaryPanel`).

---

## 5. Inspectors (resolves controlling-spec Q3/Q4)

All four selected-item surfaces share one **inspector grammar** (§6): Identity → Source trail →
Relationships → Threads → Gaps → Actions, scaled to a 340px rail (summaries + top-N + counts, not
exhaustive lists — depth lives behind "Open full …").

### 5.1 SubjectInspector (new — compact, NOT a squeezed ProfilePanel)
Composes **three existing sources** (no new endpoint): `fetchEntityDetail` (identity, source trail
docs, related findings/threads), `fetchNotes(caseId)` **filtered by `target_id === subjectId`** for
observations (the same pattern `ProfilePanel` uses — `fetchEntityDetail` returns only a `notes:
string`, not the `InvestigatorNote[]` list), and `caseMap` (relationship count + top related
subjects by edge strength). Fields:
- **Identity:** name, type, aliases / EIN / status where already available.
- **Counts:** documents, relationships (from `caseMap` edges touching this subject), developing /
  substantiated threads.
- **Top relationships:** 3–5 related subjects (by edge strength), each click → `selectRelationship`.
- **Source trail:** compact document list (top few, from `fetchEntityDetail.related_documents`).
- **Observations:** latest few `InvestigatorNote`s (from `fetchNotes` filtered by `target_id`).
- **Actions** (all backed by existing endpoints):
  - **add observation** → `createNote(caseId, { target_id, ... })`.
  - **start thread** → `useFeederActions.startAngleFrom({ title: subjectName })` (creates a real
    Angle, sets it active).
  - **cite into active thread** → `useFeederActions.citeToAngle({ label: subjectName })` —
    **narrative-only annotation** (no `documentId`); there is no subject→finding link endpoint, so
    this records context in the active thread's narrative. If no active thread, the existing angle
    picker opens (feeder behavior).
  - **Open full profile** → `openProfile` (full-width `ProfilePanel`).
- **Copy rule (§6):** must not label a person/org as suspicious — describe record presence,
  relationships, thread usage.

### 5.2 RelationshipSummaryPanel (grow the 1B seed)
Keyed by the stable `/case-map/` edge id. Already renders level + categories + reasons +
underlying relationships + the neutral disclaimer. **Add:**
- **Supporting source documents** — from the edge's `evidence_refs` (labels already present;
  resolve `document_id` → open via the documents list).
- **Threads using this relationship** — from the edge's `thread_refs` (developing / substantiated /
  handoff-included), each click → `selectThread`.
- **Actions** (backed by existing endpoints):
  - **start thread from relationship** → `useFeederActions.startAngleFrom({ title: "<A> ↔ <B>" })`
    (creates a real Angle). *(Optional enhancement: seed `ConnectKnotsModal` with both subjects —
    only if its prefill is extended to two entities; not required for first pass.)*
  - **add relationship context to active thread** → `citeToAngle({ label: "<A> ↔ <B>" })` —
    **narrative-only** (no relationship→finding link endpoint exists). Defer a true structured link
    to a later phase.
  - **open source** → `openDocument` for a supporting document from `evidence_refs`.
- Keep the neutral disclaimer: "Relationship strength reflects source support and investigative
  relevance. It does not imply wrongdoing by either subject."

### 5.3 ThreadInspector (new — the bridge to the Phase 4 Thread Builder, not the builder)
**Data source:** on `selectThread(id)`, fetch the full finding via the existing
`fetchAngle(caseId, threadId): FindingItem` (the same call `AngleView`/feeders use). `Selection`
only stores `{ kind:"thread"; id }`; the inspector owns the fetch + a small loading state. The
`thread_refs` chip from the selecting surface is enough to *show the selection*, but the inspector's
fields come from `fetchAngle`. First-pass fields (all on `FindingItem`):
- title / status (Substantiated / Set Aside / developing), severity.
- cited source count (`document_links.length`); related subjects / relationships where derivable.
- gaps / readiness summary for the thread (what's blocking referral-grade — e.g. uncited, weight,
  overreach-not-reviewed).
- **Actions** (backed):
  - **cite source** → existing `CiteDocumentPicker` → `updateAngle(add_document_ids)`.
  - **Set aside** → `updateAngle(caseId, id, { status: "DISMISSED" })` (reversible, **un-gated** —
    the tie-off gate only governs transitions *into* CONFIRMED).
  - **Open full Thread** → `openThread` → full-width `AngleView`, where **substantiation/tie-off
    lives** (that gate is server-enforced on evidence weight + overreach and must not be
    reimplemented in the rail).

### 5.4 Inspector chrome
Each inspector has a header with a close (×) → `clearSelection()`. Consistent section headings and
the `data-testid` hooks established in 1B.

---

## 6. WhatsMissingPanel (the idle rail; only genuinely new non-inspector UI)

Replaces the current idle case-stats body. Consumes the **existing** `fetchReferralReadiness`
(no backend work). Held in `InvestigateTab` state next to `dashboard`. **Phase 2 extends
`refreshCaseData()`** to also call `fetchReferralReadiness(caseId)` and set it — the 1B helper
currently refetches only `/case-map/`, `/graph/`, and `dashboard`, so readiness would otherwise go
stale after a tie-off / re-run / Lead. (Add it to the mount load `Promise.all` too.)
- Keep the compact **credibility header** (`N referral-grade · M need work · K agency leads`) at top
  (existing `CredibilityHeader`).
- Below it, render **only actionable** items (`status ∈ {FAIL, WARN}`), **FAIL first**; FAIL →
  "Blocker", WARN → "Review" (reuse `.ref-readiness-item--fail/--warn`). PASS omitted — this is the
  worklist; the full audit stays in Referrals.
- Each row routes via `target_tab`: in-tab items resolve to an in-tab action where one exists
  (`pending_connections` → review drawer); cross-tab items call `onNavigateTab(tab)` (CaseDetailView
  owns tab routing).
- READY / nothing actionable → quiet empty state (no fake urgency).
- **Recipient-gap kind deferred** (item 4 / `RecipientGap` model): a single muted footer line
  ("Agency leads — added in the referral package (coming)") keeps the two-kind structure legible
  without inventing data.

---

## 7. Files touched (frontend only)

- `context/CaseWorkspaceContext.tsx` — `useState` → `useReducer`; new `Frame`/`Selection`/actions;
  keep selector names. **`context/CaseWorkspaceContext.test.tsx`** — reducer unit tests.
- `views/InvestigateTab.tsx` — delete `navStack`/`webSelectedEdge`/`selectedSummaryEdge`/`sameEntry`/
  `navigate`/`navigateTo`/`navigateBack`; drive rendering off `currentFrame` + `selection`; extract
  the render switch into a `components/ContextPanel.tsx` (or inline — implementer's call). Remove the
  `onAngleActive` / `requestedAngle` / `onAngleConsumed` props. **Pass `activeAngleId` to
  `DocumentView` directly from `useCaseWorkspace()`** — today it's derived by scanning `navStack` for
  an `angle` entry; once `navStack` is gone, the context pointer is the source of truth (preserves
  "a document opened from a thread cites into that thread"). Extend `refreshCaseData()` + the mount
  load to include `fetchReferralReadiness` (§6).
- `views/CaseDetailView.tsx` — delete the `onAngleActive` / `requestedAngle` / `onAngleConsumed`
  bridge; active-angle chip reads `activeAngleId/Title` + `clearActiveAngle()`; cross-tab "open
  angle" (FinancialsTab deep-link) dispatches `openThread` + switches tab to `investigate`.
- `components/SubjectInspector.tsx` (+ test) — new (§5.1).
- `components/RelationshipSummaryPanel.tsx` (+ test) — extend (§5.2).
- `components/ThreadInspector.tsx` (+ test) — new (§5.3).
- `components/WhatsMissingPanel.tsx` (+ test) — new (§6).
- `index.css` — reuse `.ref-readiness*`; minor inspector variants if needed.

---

## 8. Testing (Vitest)

- **Reducer:** each action's transition; **selection never pushes history**; **open\* pushes +
  dedup**; `goBack`/`goTo` truncate + **recompute pointers** (incl. document-opened-from-thread);
  `clearActiveAngle` nulls pointer without touching history; `selectThread` sets `activeAngleId`.
- **ContextPanel:** map mode renders the right inspector per `selection.kind`; full-frame mode
  renders the existing full-width view and hides the map.
- **SubjectInspector / ThreadInspector / WhatsMissingPanel:** field rendering; actions dispatch the
  right reducer action / `onNavigateTab`; WhatsMissing renders FAIL/WARN only (FAIL first), PASS
  omitted, READY → empty state, load failure → no crash.
- **RelationshipSummaryPanel:** the new source-docs + threads-using sections; thread click →
  `selectThread`.
- **Regression:** breadcrumb back + document drill-down behave as before; feeder Cite still targets
  the active thread; FinancialsTab cross-tab "open angle" still works via `openThread`;
  **`DocumentView` receives `activeAngleId` from context** (not a `navStack` scan) so a document
  opened from a thread still cites into it; `refreshCaseData()` refetches readiness.

## 8a. Implementation sequencing (the plan must follow this order)

Keep the risky state refactor separate from the new UI surfaces:

1. **Reducer + tests** (`CaseWorkspaceContext` → `useReducer`; all transitions, dedup,
   pointer-recompute, selection-never-pushes-history) — pure unit tests, no UI.
2. **`CaseDetailView` bridge removal** (delete `onAngleActive`/`requestedAngle`/`onAngleConsumed`;
   chip reads context; cross-tab open-angle → `openThread`).
3. **`InvestigateTab` state migration** — swap `navStack`/selection for the reducer with the
   **existing panels still rendering** (no new inspectors yet); `DocumentView` gets `activeAngleId`
   from context; `refreshCaseData` + mount load gain readiness.
4. **Relationship inspector migration** — route `selectRelationship` → `RelationshipSummaryPanel`,
   extend it (§5.2). Retires the dead `webSelectedEdge`/`ConnectionDetailPanel` branch.
5. **SubjectInspector** (§5.1).
6. **WhatsMissingPanel** (§6).
7. **ThreadInspector last** (§5.3) — after its `fetchAngle` data source is wired.

---

## 9. Out of scope (explicit)

- **Thread Path Mode** (highlight a thread's relationships, dim the rest) → **Phase 3**.
- **Thread Builder** (structured claim/narrative/facts/overreach rewrite of AngleView) → **Phase 4**.
- **`RecipientGap`** model + real `agency_leads` count + recipient-gap "missing" kind → item 4.
- Reimplementing the **tie-off / substantiation gate** in the rail — stays in full AngleView.
- Resizable / persistent split panels — fixed 340px now; collapsible later.
- Deep-links from readiness rows to the specific uncited/under-weight thread — first pass routes to
  the Investigate web / best available surface.

---

## 10. Risks

- **Blast radius:** `InvestigateTab` (~921 lines) + context + `CaseDetailView`. Mitigation: the
  reducer is unit-tested first (TDD); the reused full-width panels (`ProfilePanel`/`AngleView`/
  `DocumentView`) are untouched internally — only their *trigger* changes (`navStack` → `openX`).
- **Pointer-recompute invariant** (§3.3) is the subtle part — dedicated reducer tests, including the
  document-opened-from-thread case.
- **Cross-tab deep-link** (FinancialsTab "open angle", old `requestedAngle`) must keep working via
  `openThread` + tab switch — covered by regression test.
- **Two-tier confusion**: keep selection (inspector) and frame (history) strictly separate per §2 —
  the reducer tests assert selection never mutates history.
