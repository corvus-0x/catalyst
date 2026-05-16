# Angle View (Level 3) — Design Spec
**Date:** 2026-05-16
**Status:** Approved by Tyler

---

## Problem

The existing `AngleView.tsx` renders as a 600px right panel alongside the graph canvas. The approved design shows it full-width (hiding the graph, like the Knot view). The header also lacks entity pills showing which knots are connected to the angle.

---

## Solution

Two targeted changes:

### 1. InvestigateTab.tsx — make Angle view full-width

Same pattern as the Knot view (Level 2). When `current.kind === "angle"`:
- Hide the graph canvas (`current.kind !== "profile" && current.kind !== "angle"`)
- Remove the `rightPanelCls` wrapper, render AngleView in a `flex: 1` div

### 2. AngleView.tsx — add entity pills to header

The header currently shows: back button, title, severity badge, status badge, toolbar buttons.

Add entity pills between the title and the toolbar — derived from `finding.entity_links`. Each entity_link has `entity_id`, `entity_type`, `context_note`. Pills styled with `.entity-pill .entity-pill--person` or `.entity-pill--org`.

---

## Layout (approved mockup)

```
[breadcrumb bar: Web › Case Name › Angle Title]
[header: severity-bar | title | entity pills | meta | status badge | Split | Tie it off]
[toolbar: + Cite document | + Manual finding | ... | ✓ Saved]
[body: angle-main (narrative + cited docs) | lead-panel (240px)]
```

The Lead panel and narrative editor are already implemented correctly. No changes to their logic.

---

## CSS additions to index.css

```css
.entity-pill { font-size: 11px; padding: 2px 8px; border-radius: 12px; font-weight: 500; }
.entity-pill--person { background: rgba(59,130,246,0.15); color: #60a5fa; }
.entity-pill--org    { background: rgba(20,184,166,0.15); color: #14b8a6; }
.entity-pill-arrow   { color: var(--text-3); font-size: 11px; }

.angle-entity-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}
```

---

## File Map

| File | Change |
|------|--------|
| `frontend/src/index.css` | Add entity pill classes |
| `frontend/src/views/InvestigateTab.tsx` | Hide canvas for angle level; render AngleView full-width |
| `frontend/src/views/AngleView.tsx` | Add entity pills to header from `finding.entity_links` |

---

## Definition of Done

- [ ] Clicking an angle card on the Knot view navigates to full-width Angle view (graph hidden)
- [ ] Angle header shows entity pills for each entity_link on the finding
- [ ] Breadcrumb: Web › Case Name › Angle Title — clicking any item navigates back
- [ ] Narrative editor, cited docs, Lead panel unchanged and working
- [ ] `npx tsc --noEmit` zero errors
- [ ] `npm run build` passes
