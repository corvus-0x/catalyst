# Document View (Level 4) — Design Spec
**Date:** 2026-05-16
**Status:** Approved by Tyler

---

## Problem

`DocumentView.tsx` is functionally complete but has three issues:
1. OCR text uses generic monospace — Tyler wants Cascadia Code (his VS Code font)
2. All styling uses hardcoded inline `style={{}}` with light-mode hex colors
3. No Intake legend or view toggle — Tyler wants to flip between full document and structured findings

---

## Solution

### Font
`'Cascadia Code', 'Cascadia Mono', Consolas, monospace` applied to `.doc-view__content`. Same font stack VS Code uses on Windows.

### Dark styling cleanup
Replace all inline `style={{}}` in DocumentView with CSS classes. `OcrChip` gets CSS modifier classes. Context menu and captured banner use dark tokens.

### Intake legend
A thin bar between the doc header and content showing colored dots: Entity / Date / Amount / Flag. Already defined in index.css (`--tag-entity-bg` etc). Matches the Intake highlight colors in the OCR text.

### View toggle: Full document ↔ Intake findings
A `Full document | Intake findings` pill toggle in the toolbar.

**Full document view**: OCR text with Cascadia Code. Right-click → cite or search (existing behavior).

**Intake findings view**: Angles (findings) that cite this document, fetched from `GET /api/cases/:id/findings/` and client-filtered by `document_links.some(dl => dl.document_id === documentId)`. Each finding shown as a card with severity bar, title, entity chips, and status badge. If no findings cite this document yet, show an empty state. This is real data, no backend changes needed.

---

## CSS additions to index.css

```css
/* Document view toolbar */
.doc-view__toolbar {
  display: flex; align-items: center; gap: 12px;
  padding: 5px 14px; border-bottom: 1px solid var(--border-1);
  background: var(--bg-1); flex-shrink: 0; height: 36px;
}

/* Intake legend inside toolbar */
.intake-legend { display: flex; align-items: center; gap: 10px; font-size: 11px; color: var(--text-3); flex: 1; }
.intake-legend__label { font-weight: 500; margin-right: 2px; }
.intake-legend__item { display: flex; align-items: center; gap: 4px; }
.intake-legend__dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
.intake-legend__dot--entity { background: var(--tag-entity-bg); outline: 1px solid var(--tag-entity-color); }
.intake-legend__dot--date   { background: var(--tag-date-bg);   outline: 1px solid var(--tag-date-color); }
.intake-legend__dot--amount { background: var(--tag-amount-bg); outline: 1px solid var(--tag-amount-color); }
.intake-legend__dot--flag   { background: var(--tag-flag-bg);   outline: 1px solid var(--tag-flag-color); border-bottom: 1.5px solid var(--color-critical); }

/* View toggle pill */
.doc-view-toggle { display: flex; gap: 2px; background: var(--bg-2); border-radius: 6px; padding: 2px; border: 1px solid var(--border-1); }
.doc-view-toggle__btn { padding: 3px 12px; border-radius: 4px; border: none; background: transparent; color: var(--text-3); font-size: 11px; cursor: pointer; white-space: nowrap; transition: all 0.15s; }
.doc-view-toggle__btn--active { background: var(--bg-1); color: var(--text-1); font-weight: 500; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
.doc-view-toggle__btn:hover:not(.doc-view-toggle__btn--active) { color: var(--text-2); }

/* OCR content — Cascadia Code */
/* (Replaces existing .doc-view__content font-family) */

/* Captured/cited banner */
.doc-capture-banner {
  background: var(--medium-bg);
  color: var(--color-medium);
  font-size: 12px; font-weight: 600;
  padding: 6px 16px; flex-shrink: 0;
}

/* OcrChip modifier classes */
.ocr-chip { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 9999px; flex-shrink: 0; }
.ocr-chip--done    { background: rgba(52,211,153,0.15); color: var(--color-medium); }
.ocr-chip--pending { background: var(--high-bg); color: var(--color-high); }
.ocr-chip--failed  { background: var(--critical-bg); color: var(--color-critical); }
.ocr-chip--skipped { background: var(--bg-3); color: var(--text-3); }

/* Intake findings view */
.doc-findings-view { flex: 1; overflow-y: auto; padding: 16px; background: var(--bg-0); display: flex; flex-direction: column; gap: 10px; }
.doc-finding-card { background: var(--bg-1); border: 1px solid var(--border-1); border-radius: var(--radius-md); padding: 10px 14px; display: flex; align-items: center; gap: 10px; cursor: pointer; transition: border-color 0.15s; }
.doc-finding-card:hover { border-color: var(--border-2); }
.doc-finding-card__bar { width: 3px; border-radius: 2px; align-self: stretch; flex-shrink: 0; }
.doc-finding-card__body { flex: 1; min-width: 0; }
.doc-finding-card__title { font-size: 12px; font-weight: 500; color: var(--text-1); margin-bottom: 3px; }
.doc-finding-card__meta  { font-size: 11px; color: var(--text-3); }
```

---

## File Map

| File | Change |
|------|--------|
| `frontend/src/index.css` | Append new classes above |
| `frontend/src/views/DocumentView.tsx` | Font, dark styling, Intake legend, view toggle, Intake findings view |

---

## DocumentView.tsx changes summary

1. **`OcrChip`** — replace inline style with `.ocr-chip .ocr-chip--{done|pending|failed|skipped}` classes
2. **Header** — replace `style={{ fontWeight: 600, ... }}` on filename span with CSS class `.doc-view__header-name`; replace `style={{ fontSize: 11, color: "#6b7280" }}` on file size with `.doc-view__header-meta`
3. **Captured banner** — replace inline style with `.doc-capture-banner` class
4. **Context menu** — replace `background: "#fff"` / hover `"#f3f4f6"` with dark token values `var(--bg-2)` / `var(--bg-3)`
5. **`.doc-view__content`** — update font-family to `'Cascadia Code', 'Cascadia Mono', Consolas, monospace`
6. **Add `.doc-view__toolbar`** between the header and content: Intake legend + view toggle
7. **Add Intake findings view** — new `DocFindingsView` sub-component: fetches all findings, client-filters to those citing `documentId`, renders as cards with severity bars

---

## Definition of Done

- [ ] OCR text renders in Cascadia Code
- [ ] No hardcoded light hex colors remain in DocumentView.tsx
- [ ] Intake legend bar visible below the doc header
- [ ] "Full document | Intake findings" toggle switches views
- [ ] Intake findings view shows angles citing this document (empty state if none)
- [ ] Context menu is dark-styled
- [ ] `npx tsc --noEmit` zero errors
- [ ] `npm run build` passes
