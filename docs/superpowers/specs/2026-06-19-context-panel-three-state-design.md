# Context Panel Three-State + "What's Missing" — Design

**Status:** ⚠️ **PARTIALLY SUPERSEDED** (2026-06-19) by
`2026-06-19-case-map-and-thread-builder-design.md`, which is now the controlling plan.
**What survives:** the **focus reducer** (context owns Investigate-tab navigation; `navStack`
deleted) and the **"What's Missing" panel**. **What is superseded:** the **state-swap /
canvas-hidden** layout — replaced by the case-map spec's *persistent Case Map + right
inspector* (§5 there). `focusEntity` opens a **Subject Inspector beside a still-visible map**,
not a full-width swap. Build this work under the case-map program's Phase 2, not standalone.

Originally: Design (pre-build) implementing **build item 3** of
`docs/architecture/case-workspace-design.md` (§3 context panel, §5 "what's missing").
**Date:** 2026-06-19
**Audience:** Anyone building or reviewing the Investigate-tab refactor.

> Read with `case-workspace-design.md` (§3, §5, §9), `frontend-design-spec.md` (the
> shipped drill-down model this supersedes inside Investigate), and `api-contract.md`
> (the `referral-readiness` shape).

---

## 1. Goal

Realize the **three-state context panel** (§3) and the **idle "what's missing"** surface
(§5) inside the Investigate tab, and in doing so replace the tab's two half-wired
navigation mechanisms with **one context-owned focus model**.

Two decisions frame the work (made during brainstorming):

1. **Scope = full refactor.** Knot/Angle selection moves from the bespoke local
   `navStack` into shared context. `navStack` is deleted.
2. **Layout = state-swap** (not split-screen). Idle shows the Web canvas + a right rail;
   selecting an entity or Angle swaps the main area to the full-width Profile/Angle
   workspace. This honors §3's "Web-home ≠ permanent split-screen — what persists is the
   active selection + action set, not the canvas," and preserves `AngleView`'s width.

### Why this is an upgrade, not just a feature

Today navigation state lives in `InvestigateTab`'s local `navStack`, while the *active
Angle* is mirrored up to `CaseDetailView` through an `onAngleActive` callback that writes
it into context **separately**. Two sources of truth for "what is active" can drift — a
back-navigation can update `navStack` while racing the callback. Collapsing both into one
reducer makes the §9 "in unison" behavior a structural guarantee instead of a wiring
convention.

---

## 2. Current state (what exists, so we reuse not rebuild)

- **`CaseWorkspaceContext`** (`frontend/src/context/CaseWorkspaceContext.tsx`) already holds
  `activeEntityId`, `activeAngleId`, `activeAngleTitle` with `setActiveEntity` /
  `setActiveAngle`. The comment on `activeEntityId` already says "more producers in build
  item 3." This is the seam we build on.
- **`InvestigateTab`** (`frontend/src/views/InvestigateTab.tsx`, ~921 lines) owns the local
  `navStack: NavEntry[]` (`web | profile | angle | document`), the breadcrumb, the
  `webSelectedEdge` state, and the conditional rendering of each "level."
- **`CaseDetailView`** bridges `onAngleActive` → `setActiveAngle`, and renders the global
  "Active angle: … [clear]" chip.
- **`ConnectionDetailPanel`** (rail, exists), **`ProfilePanel`** (544 lines, full-width),
  **`AngleView`** (1052 lines, full-width), **`DocumentView`** (full-width) — all reused
  as-is; only their *trigger* changes from `navStack` to context.
- **Readiness data already exists end to end.** `GET /api/cases/:id/referral-readiness/`
  (`views.api_case_referral_readiness`, `build_case_readiness`) returns the full 9-item
  checklist; the frontend already has `fetchReferralReadiness`, the
  `ReferralReadinessResponse` / `ReferralReadinessItem` types, and `.ref-readiness*` CSS,
  all consumed by `ReferralsTab`'s `ReadinessPanel`. **No backend work is required.**

Each readiness item carries: `key`, `label`, `status` (`PASS | WARN | FAIL`), `summary`,
`count`, and an optional `target_tab` (`investigate | research | financials | timeline |
referrals`).

---

## 3. The focus model (core of the refactor)

`CaseWorkspaceContext` becomes the single source of truth for Investigate-tab focus, via a
`useReducer`. `navStack` is removed from `InvestigateTab`.

### 3.1 Types

```ts
type Frame =
  | { kind: "web" }                                                   // base frame
  | { kind: "entity"; id: string; entityType: EntityType; name: string }
  | { kind: "angle"; id: string; title: string }
  | { kind: "document"; id: string; name: string };

interface FocusState {
  history: Frame[];                 // always starts [{ kind: "web" }]
  selectedConnection: string | null; // edge id; transient sub-selection of the web frame
  activeEntityId: string | undefined; // maintained pointer (for feeders)
  activeAngleId: string | undefined;
  activeAngleTitle: string | undefined;
}
```

`history` replaces `navStack`. `selectedConnection` replaces `webSelectedEdge` — it is a
**sub-selection of the web frame**, not a history frame (clicking different edges must not
stack breadcrumbs; matches today's replace-not-push behavior). It is cleared on any
navigation that pushes a frame.

### 3.2 Actions (reducer)

| Action | Effect on `history` | Effect on pointers / connection |
|--------|---------------------|---------------------------------|
| `focusEntity(e)` | push `entity` (dedup if top is same entity) | `activeEntityId = e.id`; clear `selectedConnection` |
| `focusAngle(a)` | push `angle` (dedup) | `activeAngleId/Title = a`; clear `selectedConnection` |
| `focusDocument(d)` | push `document` (dedup) | pointers unchanged (keeps active angle so a document can cite into it); clear `selectedConnection` |
| `selectConnection(id)` | none (stays on web frame) | `selectedConnection = id` |
| `goBack()` | pop one frame | **recompute** pointers from new top (see 3.3); clear `selectedConnection` |
| `goTo(index)` | truncate to `index+1` | recompute pointers; clear `selectedConnection` |
| `clearActiveAngle()` | none | `activeAngleId/Title = undefined` (header-chip clear; does not navigate) |

`dedup` = if the top frame already equals the target (same kind + id), do not push a
duplicate (preserves the current double-tap guard).

### 3.3 Pointer recompute rule (the one subtle invariant)

`activeEntityId` / `activeAngleId` are **not** simply "the current frame." They are the
nearest matching frame at or below the top of `history`, so the §9 semantic holds:
"opening an Angle sets activeAngle; feeder Cite targets it" — and it persists while you
drill into a document opened from that Angle.

```
recompute(history):
  activeAngle  = nearest frame of kind "angle"  scanning from top → bottom, else undefined
  activeEntity = nearest frame of kind "entity" scanning from top → bottom, else undefined
```

`clearActiveAngle()` is the one explicit override: the header chip can null the pointer
without changing history (parity with today's `setActiveAngle(undefined)` chip button).
A subsequent `goBack`/`goTo` recompute may legitimately re-derive an angle pointer from
history — this matches today, where navigating back onto an Angle re-activates it.

### 3.4 Selectors exposed by the hook

`useCaseWorkspace()` continues to expose `activeEntityId`, `activeAngleId`,
`activeAngleTitle` (unchanged names — feeders/DocumentView/Timeline keep working), and adds
`current: Frame`, `history`, `selectedConnection`, plus the action creators above. The old
`setActiveEntity` / `setActiveAngle` setters are removed; callers migrate to the new
actions. (`setActiveAngle(undefined)` → `clearActiveAngle()`.)

---

## 4. `ContextPanel` — rendering off focus

> ⚠️ **SUPERSEDED — retained for historical context only.** The `entity`/`angle`
> **full-width swap (canvas hidden)** layout in the table below is **replaced** by the
> persistent Case Map + right inspector in
> `2026-06-19-case-map-and-thread-builder-design.md` §5 / §5.1. Do **not** implement the
> swap layout. The **focus reducer itself** (§3) is the part that carries forward; only this
> rendering/layout table is dead.

`InvestigateTab`'s scattered level conditionals are replaced by one switch on
`current` + `selectedConnection`:

| `current.kind` | `selectedConnection` | Layout | Component |
|----------------|----------------------|--------|-----------|
| `web` | `null` | canvas + right rail (215px) | **`WhatsMissingPanel`** (new) |
| `web` | set | canvas + right rail | `ConnectionDetailPanel` (existing) |
| `entity` | — | full-width swap (canvas hidden) | `ProfilePanel` (existing) |
| `angle` | — | full-width swap | `AngleView` (existing) |
| `document` | — | full-width swap | `DocumentView` (existing) |

The toolbar rail, breadcrumb, and `WebStatsBar` keep their current positions; the
breadcrumb and back button are rebuilt on `history`/`goTo` (behavior-equivalent).

The §3 "three states" (idle case-state / selected entity-or-connection / active Angle) map
onto this table: idle and connection are the two canvas-visible rail variants; entity and
angle are the swap variants; document is a drill-down of either.

---

## 5. `WhatsMissingPanel` (the only genuinely new UI)

Replaces the idle right panel's case-stats body (`WebRightPanel`'s default branch). A
compact, action-first reframing of the readiness checklist already shown in
`ReferralsTab`.

### 5.1 Data

- Fetched via the existing `fetchReferralReadiness(caseId)` on mount and refreshed after
  any mutation that already refreshes the dashboard (Lead run, rule re-run, tie-off). Hold
  it in `InvestigateTab` state next to `dashboard`.
- No new endpoint, serializer, or backend change.

### 5.2 Content & behavior

- Keep the existing compact **credibility header** (`N referral-grade · M need work ·
  K agency leads`) at the top — already built (`CredibilityHeader`).
- Below it, **"What's missing"**: render only **actionable** items
  (`status ∈ {FAIL, WARN}`), FAIL first. FAIL → "Blocker" tag, WARN → "Review" tag (reuse
  `.ref-readiness-item--fail/--warn` colors). PASS items are omitted (this panel is the
  worklist, not the full audit — the full list still lives in Referrals).
- Each row is **click-through** via `target_tab`:
  - `investigate` items resolve to an in-tab action where one exists — `pending_connections`
    opens the pending-connections review drawer; `citation_coverage` / `evidence_weight` /
    `overreach_review` / `confirmed_angles` are angle-level, so the row navigates to the
    Investigate web (no deeper target yet) — acceptable for first pass.
  - `research | financials | timeline | referrals` items call the parent tab-switch
    (`CaseDetailView` already owns tab routing; `WhatsMissingPanel` takes an
    `onNavigateTab(tab)` prop).
- **READY / nothing actionable** → a quiet empty state: "Nothing's blocking a referral —
  tie off another angle or add a recipient." (No fake urgency.)

### 5.3 Recipient-gap kind — deferred, not faked

§5's table has two kinds of "missing." The **recipient-gap** kind depends on the
`RecipientGap` model, which is **build item 4** and does not exist. The panel shows a
single muted footer line — "Agency leads — added in the referral package (coming)" — so the
two-kind structure is legible without inventing data. No `RecipientGap` work happens here.

---

## 6. Files touched

**Frontend (all changes here):**

- `context/CaseWorkspaceContext.tsx` — replace state with the focus reducer (§3); export
  new actions + `current`/`history`/`selectedConnection`; keep `activeEntityId` /
  `activeAngleId` / `activeAngleTitle` selector names.
- `context/CaseWorkspaceContext.test.tsx` — extend for the reducer (see §7).
- `views/InvestigateTab.tsx` — delete local `navStack`, `webSelectedEdge`, `sameEntry`,
  `navigate`, `navigateTo`, `navigateBack`; drive rendering from context; extract the
  rendering switch into a `ContextPanel` (can live in the same file or a sibling
  `components/ContextPanel.tsx` — implementer's call). Remove the `onAngleActive` /
  `requestedAngle` / `onAngleConsumed` props (now context-mediated).
- `views/CaseDetailView.tsx` — delete the `onAngleActive` / `requestedAngle` /
  `onAngleConsumed` bridge; the active-angle chip reads `activeAngleId/Title` and calls
  `clearActiveAngle()`; `handleOpenAngle` (the cross-tab deep-link producer, used by
  `FinancialsTab`'s "open angle") calls `focusAngle` on the context + switches the tab to
  `investigate` instead of routing through `requestedAngle`.
- `components/WhatsMissingPanel.tsx` — new (§5).
- `components/WhatsMissingPanel.test.tsx` — new (§7).
- `index.css` — minor additions if the compact panel needs variants of `.ref-readiness*`;
  reuse existing classes where possible.

**Backend:** none.

---

## 7. Testing

- **Reducer** (`CaseWorkspaceContext.test.tsx`): each action's transition —
  `focusEntity`/`focusAngle`/`focusDocument` push + dedup + pointer set;
  `selectConnection` does not push; `goBack`/`goTo` truncate and **recompute** pointers
  (incl. the "drill into document from an angle, go back, angle still active" case);
  `clearActiveAngle` nulls the pointer without touching history.
- **`ContextPanel`**: each `current`×`selectedConnection` combination renders the expected
  component; entity/angle/document are full-width (canvas not rendered); web is canvas +
  rail.
- **`WhatsMissingPanel`**: renders only FAIL/WARN items, FAIL first; PASS omitted; a
  `target_tab` row click calls `onNavigateTab` / the right in-tab action; READY data shows
  the quiet empty state; load failure renders nothing (no crash).
- **Regression**: breadcrumb back-navigation and Document drill-down behave as before;
  feeder Cite still targets the active angle after the refactor.

Frontend tests run locally (Vitest). Backend test count unchanged.

---

## 8. Out of scope (explicit)

- `RecipientGap` model and the recipient-gap "missing" kind → **item 4**.
- Dismissed-findings filter/appendix, "Leads for the agency" package section → **item 4**.
- Replay hybrid, WS-GAP-1 connectedness proposals → **item 5**.
- Deeper click-through targets for angle-level readiness items (jump to the specific
  uncited/under-weight angle) — first pass navigates to the Investigate web; a precise
  deep-link can follow once it earns its keep.
- Resizable / persistent split-screen layout — rejected during brainstorming in favor of
  state-swap.

---

## 9. Risks

- **Largest blast radius is `InvestigateTab`** (~921 lines) plus the context and
  `CaseDetailView`. Mitigation: the reducer is unit-tested first (TDD), and the reused
  panels (`ProfilePanel`/`AngleView`/`DocumentView`/`ConnectionDetailPanel`) are untouched
  internally — only their trigger changes — so visual regression surface is small.
- **Pointer-recompute invariant (§3.3)** is the subtle part; it gets dedicated reducer
  tests, including the document-opened-from-angle case.
- **Deep-link to angle** (old `requestedAngle` path, produced by `CaseDetailView.handleOpenAngle`
  for `FinancialsTab`'s cross-tab "open angle") must keep working through `focusAngle` +
  tab-switch; covered by the regression test.
