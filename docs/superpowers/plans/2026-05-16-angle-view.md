# Angle View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Angle view (Level 3) render full-width like the Knot view, and add entity pills to the angle header showing which knots are connected.

**Architecture:** Three small, targeted changes. Task 1 adds CSS. Task 2 rewires two lines in InvestigateTab so the angle view gets the full canvas area. Task 3 adds entity pills to the AngleView header — data comes from `finding.entity_links` which is already fetched.

**Tech Stack:** React 18, TypeScript. No new API calls, no new libraries. All data (`finding.entity_links`) already in the `FindingItem` type.

---

## File Map

| File | Change |
|------|--------|
| `frontend/src/index.css` | Append entity pill CSS classes |
| `frontend/src/views/InvestigateTab.tsx` | Hide canvas when angle active; render AngleView full-width |
| `frontend/src/views/AngleView.tsx` | Add entity pills to panel header |

---

## Task 1: Entity pill CSS classes

**Files:**
- Modify: `frontend/src/index.css`

- [ ] **Step 1.1: Append entity pill CSS to end of index.css**

Open `frontend/src/index.css` and append at the very end:

```css
/* ─── Entity pills (used in Angle view header) ───────────────────────────── */

.angle-entity-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.entity-pill {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 12px;
  font-weight: 500;
}

.entity-pill--person { background: rgba(59,130,246,0.15); color: #60a5fa; }
.entity-pill--org    { background: rgba(20,184,166,0.15); color: #14b8a6; }
.entity-pill--property { background: rgba(251,191,36,0.15); color: #fbbf24; }

.entity-pill-arrow { color: var(--text-3); font-size: 11px; }
```

- [ ] **Step 1.2: Verify TypeScript and commit**

```bash
cd C:/Users/tjcol/Catalyst/frontend && npx tsc --noEmit
```
Expected: zero errors.

```bash
cd C:/Users/tjcol/Catalyst && git add frontend/src/index.css && git commit -m "feat(css): add entity pill classes for angle view header"
```

---

## Task 2: InvestigateTab — Angle view full-width

**Files:**
- Modify: `frontend/src/views/InvestigateTab.tsx`

Two targeted line changes. Read the file first to confirm current line numbers, then apply.

### Change A: Hide canvas when angle is active

Find the canvas condition around line 518:
```tsx
{!showDocument && current.kind !== "profile" && (
  <div className="graph-canvas-dark" style={{ flex: 1, minWidth: 0, position: "relative" }}>
```

Change to also exclude angle:
```tsx
{!showDocument && current.kind !== "profile" && current.kind !== "angle" && (
  <div className="graph-canvas-dark" style={{ flex: 1, minWidth: 0, position: "relative" }}>
```

### Change B: Render AngleView full-width

Find the Level 3 angle view section around line 579:
```tsx
{/* Level 3 — Angle view */}
{showRightPanel && current.kind === "angle" && (
  <div className={rightPanelCls} style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
    <Suspense fallback={fallback("Loading…")}>
      <AngleView
        caseId={caseId}
        angleId={current.angleId}
        documents={documents}
        onDocumentClick={(docId, docName) => navigate({ kind: "document", documentId: docId, docName })}
        onBack={navigateBack}
        onAngleTiedOff={() => fetchGraph(caseId).then(setGraph).catch(console.error)}
      />
    </Suspense>
  </div>
)}
```

Replace with (remove `showRightPanel &&`, remove `rightPanelCls`, use `flex: 1`):
```tsx
{/* Level 3 — Angle view (full-width, canvas hidden) */}
{current.kind === "angle" && (
  <div style={{ flex: 1, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
    <Suspense fallback={fallback("Loading…")}>
      <AngleView
        caseId={caseId}
        angleId={current.angleId}
        documents={documents}
        onDocumentClick={(docId, docName) => navigate({ kind: "document", documentId: docId, docName })}
        onBack={navigateBack}
        onAngleTiedOff={() => fetchGraph(caseId).then(setGraph).catch(console.error)}
      />
    </Suspense>
  </div>
)}
```

- [ ] **Step 2.1: Apply Change A (canvas condition)**
- [ ] **Step 2.2: Apply Change B (angle full-width)**

- [ ] **Step 2.3: Verify TypeScript and commit**

```bash
cd C:/Users/tjcol/Catalyst/frontend && npx tsc --noEmit
```
Expected: zero errors.

```bash
cd C:/Users/tjcol/Catalyst && git add frontend/src/views/InvestigateTab.tsx && git commit -m "feat(investigate): angle view full-width, hide canvas at level 3"
```

---

## Task 3: AngleView — entity pills in header

**Files:**
- Modify: `frontend/src/views/AngleView.tsx`

The `finding.entity_links` array is already available — it's part of `FindingItem` and is fetched by `fetchAngle`. Each entry has:
```typescript
{
  entity_id: string;
  entity_type: "person" | "organization" | "property" | "financial_instrument";
  context_note: string;
}
```

Add entity pills in the panel header, between the angle title and the status/severity badges.

### Change: Add entity pills to the panel header

Find the panel header section in the render (around line 517):

```tsx
<div className="panel-header">
  <button type="button" className="back-btn" onClick={onBack} aria-label="Back to web">
    <ArrowLeft size={14} aria-hidden="true" />
  </button>

  <span className="angle-view__title">ANGLE: {finding.title}</span>

  <span className={`angle-badge angle-badge--${finding.status}`}>
    {STATUS_LABEL[finding.status] ?? finding.status}
  </span>
  ...
</div>
```

Replace the entire panel-header div with:

```tsx
<div className="panel-header" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
  {/* Top row: back + title + badges */}
  <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
    <button type="button" className="back-btn" onClick={onBack} aria-label="Back to web">
      <ArrowLeft size={14} aria-hidden="true" />
    </button>

    <span className="angle-view__title">{finding.title}</span>

    <span className={`angle-badge angle-badge--${finding.status}`}>
      {STATUS_LABEL[finding.status] ?? finding.status}
    </span>

    <span className={`severity-badge severity-badge--${finding.severity}`}>
      {finding.severity}
    </span>

    <span className={`weight-badge weight-badge--${finding.evidence_weight}`}>
      {WEIGHT_LABEL[finding.evidence_weight] ?? finding.evidence_weight}
    </span>

    {savedFlash && (
      <span className="angle-view__saved-flash">✓ Saved</span>
    )}
  </div>

  {/* Entity pills row */}
  {finding.entity_links && finding.entity_links.length > 0 && (
    <div className="angle-entity-row">
      {finding.entity_links.map((link, i) => (
        <span key={link.entity_id}>
          {i > 0 && <span className="entity-pill-arrow">↔</span>}
          <span className={`entity-pill entity-pill--${link.entity_type === "organization" ? "org" : link.entity_type}`}>
            {link.context_note || link.entity_id.slice(0, 8)}
          </span>
        </span>
      ))}
    </div>
  )}
</div>
```

**Note on `context_note`:** The entity_links `context_note` field contains a label like "Sarah Mitchell is the buyer" or just the entity name. If it's a full sentence, trim it. To get just the entity name, look at `finding.entity_links` — the entity name comes from the context_note. If context_note is too verbose (e.g. "Sarah Mitchell is the buyer"), show just the first few words before "is" — but actually `context_note` on entity_links is usually just the entity name or a short role label (see api-contract.md Section 6). Use it as-is.

- [ ] **Step 3.1: Apply the panel-header change**

- [ ] **Step 3.2: Verify TypeScript and commit**

```bash
cd C:/Users/tjcol/Catalyst/frontend && npx tsc --noEmit
```
Expected: zero errors. If TypeScript complains about `entity_links` missing on `FindingItem`, check `frontend/src/types/index.ts` — the field is `entity_links: FindingEntityLink[]`. The type `FindingEntityLink` should already exist; if not, check the type file and add:
```typescript
export interface FindingEntityLink {
  entity_id: string;
  entity_type: EntityType;
  context_note: string;
}
```
and add `entity_links?: FindingEntityLink[];` to `FindingItem`.

```bash
cd C:/Users/tjcol/Catalyst && git add frontend/src/views/AngleView.tsx frontend/src/types/index.ts && git commit -m "feat(angle): entity pills in header, full-width layout"
```

---

## Definition of Done

- [ ] Clicking an angle in the Knot view opens it full-width (graph canvas hidden)
- [ ] Breadcrumb still works — back button returns to knot view
- [ ] Entity pills show below the angle title for angles with entity_links
- [ ] Angles with no entity_links: pills row is not rendered (no empty space)
- [ ] Narrative editor, cited docs, Lead panel all still visible and functional
- [ ] `npx tsc --noEmit` zero errors
- [ ] `npm run build` passes
