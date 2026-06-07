# Document View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cascadia Code font in the OCR reader, dark-style all inline styles, add Intake legend + view toggle with a real "Intake findings" tab showing angles that cite this document.

**Architecture:** Two tasks. Task 1 appends CSS. Task 2 rewrites `DocumentView.tsx`: replaces inline styles with classes, adds the toolbar with legend and toggle, and adds a `DocFindingsView` sub-component that fetches case findings and client-filters to those citing the current document.

**Tech Stack:** React 18, TypeScript. `fetchAngles` from existing API (already exported). `FindingItem`, `FindingsResponse` from existing types.

---

## File Map

| File | Change |
|------|--------|
| `frontend/src/index.css` | Append document view CSS classes |
| `frontend/src/views/DocumentView.tsx` | Font, dark styling, legend, toggle, `DocFindingsView` |

---

## Task 1: CSS for document view additions

**Files:**
- Modify: `frontend/src/index.css`

- [ ] **Step 1.1: Append to end of index.css**

```css
/* ─── Document View additions ────────────────────────────────────────────── */

/* Toolbar row: legend + view toggle */
.doc-view__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 5px 14px;
  border-bottom: 1px solid var(--border-1);
  background: var(--bg-1);
  flex-shrink: 0;
  height: 36px;
}

/* Intake legend */
.intake-legend {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: var(--text-3);
  flex: 1;
}
.intake-legend__label { font-weight: 500; margin-right: 2px; }
.intake-legend__item { display: flex; align-items: center; gap: 4px; }
.intake-legend__dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}
.intake-legend__dot--entity { background: var(--tag-entity-bg); outline: 1px solid var(--tag-entity-color); }
.intake-legend__dot--date   { background: var(--tag-date-bg);   outline: 1px solid var(--tag-date-color); }
.intake-legend__dot--amount { background: var(--tag-amount-bg); outline: 1px solid var(--tag-amount-color); }
.intake-legend__dot--flag   { background: var(--tag-flag-bg);   outline: 1px solid var(--tag-flag-color); border-bottom: 1.5px solid var(--color-critical); }

/* View toggle pill */
.doc-view-toggle {
  display: flex;
  gap: 2px;
  background: var(--bg-2);
  border-radius: 6px;
  padding: 2px;
  border: 1px solid var(--border-1);
}
.doc-view-toggle__btn {
  padding: 3px 12px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--text-3);
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}
.doc-view-toggle__btn--active {
  background: var(--bg-1);
  color: var(--text-1);
  font-weight: 500;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
}
.doc-view-toggle__btn:hover:not(.doc-view-toggle__btn--active) { color: var(--text-2); }

/* OcrChip modifier classes (replaces inline styles on the OcrChip component) */
.ocr-chip { font-size: 11px; font-weight: 600; border-radius: 9999px; padding: 1px 8px; display: inline-block; flex-shrink: 0; }
.ocr-chip--done    { background: rgba(52,211,153,0.15); color: var(--color-medium); }
.ocr-chip--pending { background: var(--high-bg); color: var(--color-high); }
.ocr-chip--failed  { background: var(--critical-bg); color: var(--color-critical); }
.ocr-chip--skipped { background: var(--bg-3); color: var(--text-3); }

/* Document header name and meta */
.doc-view__header-name {
  font-weight: 600;
  font-size: 13px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-1);
}
.doc-view__header-meta { font-size: 11px; color: var(--text-3); flex-shrink: 0; }

/* Captured / cited banner */
.doc-capture-banner {
  background: var(--medium-bg);
  color: var(--color-medium);
  font-size: 12px;
  font-weight: 600;
  padding: 6px 16px;
  flex-shrink: 0;
}

/* Jump banner (RAG result navigation) */
.doc-jump-banner {
  background: var(--accent-bg);
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
  padding: 5px 12px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(96,165,250,0.2);
}

/* RAG searching indicator */
.doc-rag-searching {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 5px;
  color: var(--text-3);
  font-size: 11px;
}

/* Intake findings view */
.doc-findings-view {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  background: var(--bg-0);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.doc-finding-card {
  background: var(--bg-1);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.doc-finding-card:hover { border-color: var(--border-2); }

.doc-finding-card__bar {
  width: 3px;
  border-radius: 2px;
  align-self: stretch;
  flex-shrink: 0;
}
.doc-finding-card__bar--CRITICAL { background: var(--color-critical); }
.doc-finding-card__bar--HIGH     { background: var(--color-high); }
.doc-finding-card__bar--MEDIUM   { background: var(--color-medium); }
.doc-finding-card__bar--LOW,
.doc-finding-card__bar--INFORMATIONAL { background: var(--border-2); }

.doc-finding-card__body { flex: 1; min-width: 0; }
.doc-finding-card__title { font-size: 12px; font-weight: 500; color: var(--text-1); margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.doc-finding-card__meta  { font-size: 10px; color: var(--text-3); }

/* Context menu — dark */
.doc-ctx-menu {
  background: var(--bg-2);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  padding: 4px 0;
  min-width: 180px;
  z-index: 200;
  font-size: 13px;
}
.doc-ctx-item {
  padding: 6px 14px;
  cursor: pointer;
  outline: none;
  color: var(--text-2);
  transition: background 0.1s, color 0.1s;
}
.doc-ctx-item:hover { background: var(--bg-3); color: var(--text-1); }
```

- [ ] **Step 1.2: Update `.doc-view__content` font-family**

Find the existing `.doc-view__content` rule in index.css (it will have `font-family: ui-monospace, monospace`). Change the font-family line to:

```css
font-family: 'Cascadia Code', 'Cascadia Mono', Consolas, monospace;
```

- [ ] **Step 1.3: Verify and commit**

```bash
cd C:/Users/tjcol/Catalyst/frontend && npx tsc --noEmit
```

```bash
cd C:/Users/tjcol/Catalyst && git add frontend/src/index.css && git commit -m "feat(css): document view Cascadia Code font and layout classes"
```

---

## Task 2: DocumentView.tsx refactor

**Files:**
- Modify: `frontend/src/views/DocumentView.tsx`

Read the full file before making changes. The file has ~440 lines.

### Step 2.1: Add fetchAngles import

At the top of the file, the current import from `"../api"` is:
```tsx
import { fetchDocument, searchAll, createNote, fetchAngle, updateAngle } from "../api";
```

Add `fetchAngles`:
```tsx
import { fetchDocument, searchAll, createNote, fetchAngle, updateAngle, fetchAngles } from "../api";
```

Also add `FindingItem` to the type imports:
```tsx
import type { DocumentItem, SearchResult, SearchResponse, FindingItem } from "../types";
```

### Step 2.2: Replace OcrChip with CSS class version

Find the entire `OcrChip` function (lines ~51-74). Replace with:

```tsx
function OcrChip({ status }: { status: DocumentItem["ocr_status"] }) {
  const map: Record<DocumentItem["ocr_status"], { label: string; cls: string }> = {
    COMPLETED:   { label: "Text extracted", cls: "ocr-chip--done" },
    PENDING:     { label: "Processing…",    cls: "ocr-chip--pending" },
    IN_PROGRESS: { label: "Processing…",    cls: "ocr-chip--pending" },
    FAILED:      { label: "Extraction failed", cls: "ocr-chip--failed" },
    SKIPPED:     { label: "Skipped",        cls: "ocr-chip--skipped" },
  };
  const { label, cls } = map[status] ?? map.SKIPPED;
  return <span className={`ocr-chip ${cls}`}>{label}</span>;
}
```

### Step 2.3: Add DocFindingsView sub-component

After `OcrChip`, add this new sub-component:

```tsx
function DocFindingsView({ caseId, documentId }: { caseId: string; documentId: string }) {
  const [findings, setFindings] = useState<FindingItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAngles(caseId, { limit: 100 })
      .then((resp) => {
        const citing = resp.results.filter((f) =>
          f.document_links?.some((dl) => dl.document_id === documentId)
        );
        setFindings(citing);
      })
      .catch(() => setFindings([]))
      .finally(() => setLoading(false));
  }, [caseId, documentId]);

  if (loading) {
    return (
      <div className="doc-findings-view">
        <div className="skeleton" style={{ width: "100%", height: 60, borderRadius: 6 }} />
        <div className="skeleton" style={{ width: "100%", height: 60, borderRadius: 6 }} />
      </div>
    );
  }

  if (findings.length === 0) {
    return (
      <div className="doc-findings-view">
        <div className="empty-state">
          <p className="empty-state__title">No angles cite this document yet</p>
          <p className="empty-state__body">
            Navigate to an angle and use "+ Cite document" to link this document as evidence.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="doc-findings-view">
      {findings.map((f) => (
        <div key={f.id} className="doc-finding-card">
          <div className={`doc-finding-card__bar doc-finding-card__bar--${f.severity}`} />
          <div className="doc-finding-card__body">
            <div className="doc-finding-card__title">{f.title}</div>
            <div className="doc-finding-card__meta">
              {f.rule_id && `${f.rule_id} · `}{f.status}
            </div>
          </div>
          <span className={`severity-badge severity-badge--${f.severity}`}>{f.severity}</span>
        </div>
      ))}
    </div>
  );
}
```

### Step 2.4: Add view toggle state to DocumentView

Inside `DocumentView`, after the existing state declarations, add:

```tsx
const [docView, setDocView] = useState<"full" | "findings">("full");
```

### Step 2.5: Replace inline styles in document header (full render)

In the main render, find the doc header section (around line 270):

```tsx
<span style={{ fontWeight: 600, fontSize: 13, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
  {displayName}
</span>

<OcrChip status={doc.ocr_status} />

<span style={{ fontSize: 11, color: "#6b7280", flexShrink: 0 }}>
  {formatBytes(doc.file_size)}
</span>
```

Replace with:

```tsx
<span className="doc-view__header-name">{displayName}</span>
<OcrChip status={doc.ocr_status} />
<span className="doc-view__header-meta">{formatBytes(doc.file_size)}</span>
```

### Step 2.6: Replace captured banner inline style

Find:
```tsx
{capturedBanner && (
  <div
    role="status"
    style={{
      background: "#d1fae5",
      color: "#065f46",
      fontSize: 12,
      fontWeight: 600,
      padding: "6px 16px",
      flexShrink: 0,
    }}
  >
    {activeAngleId ? "Added to angle." : "Captured!"}
  </div>
)}
```

Replace with:
```tsx
{capturedBanner && (
  <div role="status" className="doc-capture-banner">
    {activeAngleId ? "Added to angle." : "Captured!"}
  </div>
)}
```

### Step 2.7: Add toolbar (legend + toggle) between header and content

After the captured banner and before the `<ContextMenu.Root>`, insert:

```tsx
{/* Intake legend + view toggle */}
<div className="doc-view__toolbar">
  <div className="intake-legend">
    <span className="intake-legend__label">Intake:</span>
    <span className="intake-legend__item">
      <span className="intake-legend__dot intake-legend__dot--entity" />
      Entity
    </span>
    <span className="intake-legend__item">
      <span className="intake-legend__dot intake-legend__dot--date" />
      Date
    </span>
    <span className="intake-legend__item">
      <span className="intake-legend__dot intake-legend__dot--amount" />
      Amount
    </span>
    <span className="intake-legend__item">
      <span className="intake-legend__dot intake-legend__dot--flag" />
      Flag
    </span>
  </div>
  <div className="doc-view-toggle">
    <button
      type="button"
      className={`doc-view-toggle__btn${docView === "full" ? " doc-view-toggle__btn--active" : ""}`}
      onClick={() => setDocView("full")}
    >
      Full document
    </button>
    <button
      type="button"
      className={`doc-view-toggle__btn${docView === "findings" ? " doc-view-toggle__btn--active" : ""}`}
      onClick={() => setDocView("findings")}
    >
      Intake findings
    </button>
  </div>
</div>
```

### Step 2.8: Wrap existing ContextMenu content and add findings view

The `<ContextMenu.Root>` block currently wraps the `doc-view__content` and shows the full OCR text. Make it only show when `docView === "full"`, and show `DocFindingsView` when `docView === "findings"`.

Find the ContextMenu.Root block (it starts with `<ContextMenu.Root>` and ends with `</ContextMenu.Root>`). Wrap it:

```tsx
{docView === "full" ? (
  <ContextMenu.Root>
    ...existing ContextMenu content unchanged...
  </ContextMenu.Root>
) : (
  <DocFindingsView caseId={caseId} documentId={documentId} />
)}
```

### Step 2.9: Fix context menu dark styling

Inside the `<ContextMenu.Content>` component, find the inline style object:

```tsx
style={{
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
  padding: "4px 0",
  minWidth: 180,
  zIndex: 200,
  fontSize: 13,
}}
```

Replace with:
```tsx
className="doc-ctx-menu"
style={{ zIndex: 200 }}
```

For each `<ContextMenu.Item>`, replace the inline style with `className="doc-ctx-item"` and remove the `onMouseEnter`/`onMouseLeave` handlers (CSS handles hover now):

```tsx
<ContextMenu.Item
  onSelect={handleSearchSelection}
  className="doc-ctx-item"
>
  Search docs for selection
</ContextMenu.Item>
{activeAngleId && (
  <ContextMenu.Item
    onSelect={handleCiteInAngle}
    className="doc-ctx-item"
  >
    Cite in angle
  </ContextMenu.Item>
)}
<ContextMenu.Item
  onSelect={handleQuickCapture}
  className="doc-ctx-item"
>
  Quick capture this
</ContextMenu.Item>
```

### Step 2.10: Fix RAG panel inline styles

In the RAG panel section, fix the remaining inline styles:

**SEARCH label** — find:
```tsx
<p className="panel-section__title" style={{ marginBottom: 6 }}>
  SEARCH
</p>
```
Replace with (just remove the inline style, `panel-section__title` already has margin):
```tsx
<p className="panel-section__title">Search</p>
```

**Search icon** — the `<Search>` icon has `style={{ position: "absolute", left: 7, top: "50%", ... color: "#9ca3af" }}`. Keep position styles but change color:
```tsx
style={{
  position: "absolute",
  left: 7,
  top: "50%",
  transform: "translateY(-50%)",
  color: "var(--text-3)",
  pointerEvents: "none",
}}
```

**RAG loading indicator** — find:
```tsx
<div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5, color: "#6b7280", fontSize: 11 }}>
  <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />
  Searching…
</div>
```
Replace with:
```tsx
<div className="doc-rag-searching">
  <Loader2 size={11} className="spin" />
  Searching…
</div>
```

**Jump banner** — find:
```tsx
{jumpBanner && (
  <div
    role="status"
    style={{
      background: "#eff6ff",
      color: "#1d4ed8",
      fontSize: 11,
      fontWeight: 600,
      padding: "5px 12px",
      flexShrink: 0,
      borderBottom: "1px solid #dbeafe",
    }}
  >
    {jumpBanner}
  </div>
)}
```
Replace with:
```tsx
{jumpBanner && (
  <div role="status" className="doc-jump-banner">{jumpBanner}</div>
)}
```

### Step 2.11: Verify TypeScript and commit

```bash
cd C:/Users/tjcol/Catalyst/frontend && npx tsc --noEmit
```
Expected: zero errors. If TypeScript complains about `FindingItem` missing `rule_id`, check `frontend/src/types/index.ts` — it should be there. If `document_links` is typed as optional (`document_links?: FindingDocumentLink[]`), use optional chaining: `f.document_links?.some(...)`.

```bash
cd C:/Users/tjcol/Catalyst && git add frontend/src/views/DocumentView.tsx && git commit -m "feat(docs): Cascadia Code font, dark styling, intake legend, view toggle, findings tab"
```

---

## Definition of Done

- [ ] OCR text renders in Cascadia Code font
- [ ] OcrChip uses CSS modifier classes (no inline styles)
- [ ] Header filename and file size use CSS classes (no inline styles)
- [ ] Captured banner uses `.doc-capture-banner` class
- [ ] Context menu is dark: dark background, dark hover, no `onMouseEnter`/`onMouseLeave` JS
- [ ] Intake legend bar shows below doc header with four colored dots
- [ ] View toggle switches between "Full document" and "Intake findings"
- [ ] "Intake findings" tab: loads findings citing this document, shows cards with severity bars, shows empty state if none
- [ ] `npx tsc --noEmit` zero errors
- [ ] `npm run build` passes
