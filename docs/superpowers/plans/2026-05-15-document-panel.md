# Document Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a right-side document management drawer — upload, list, OCR trigger, delete — wired to the existing backend API.

**Architecture:** One new component `DocumentDrawer.tsx` handles all document management UI. `CaseDetailView.tsx` gets a small wiring change: the dead "Upload docs" button becomes the drawer trigger, and a `refetchCase` callback keeps the document list in sync after uploads/deletes. No new API functions needed — `uploadDocuments`, `processPendingDocuments`, and `deleteDocument` already exist.

**Tech Stack:** React 18, TypeScript, existing CSS dark tokens from `index.css`. No new libraries. API: `uploadDocuments`, `processPendingDocuments`, `deleteDocument` from `frontend/src/api/cases.ts`. Toast notifications via `sonner`.

---

## File Map

| File | Change |
|------|--------|
| `frontend/src/components/DocumentDrawer.tsx` | **Create** — the full drawer component |
| `frontend/src/views/CaseDetailView.tsx` | **Modify** — wire drawer into header, add refetch callback |
| `frontend/src/index.css` | **Modify** — add `.doc-drawer-*` layout classes |

---

## Task 1: CSS classes for the drawer

**Files:**
- Modify: `frontend/src/index.css`

Add the following block at the **very end** of `frontend/src/index.css` (after the last rule):

- [ ] **Step 1.1: Append drawer CSS**

Open `frontend/src/index.css` and add to the end:

```css
/* ─── Document Drawer ───────────────────────────────────────────────────────── */

.doc-drawer-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 20;
}

.doc-drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 440px;
  background: var(--bg-1);
  border-left: 1px solid var(--border-1);
  z-index: 21;
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.4);
}

.doc-drawer__header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-1);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.doc-drawer__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  flex: 1;
}

.doc-drawer__close {
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}
.doc-drawer__close:hover { background: var(--bg-3); color: var(--text-1); }

.doc-drawer__tabs {
  display: flex;
  border-bottom: 1px solid var(--border-1);
  padding: 0 16px;
  flex-shrink: 0;
}

.doc-drawer__tab {
  padding: 7px 12px;
  font-size: 11px;
  color: var(--text-3);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  white-space: nowrap;
}
.doc-drawer__tab.active { color: var(--text-1); border-bottom-color: var(--accent); }

/* Dropzone */
.doc-dropzone {
  margin: 12px 16px;
  border: 1.5px dashed var(--border-2);
  border-radius: var(--radius-lg);
  padding: 20px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  flex-shrink: 0;
}
.doc-dropzone:hover,
.doc-dropzone--drag { border-color: var(--accent); background: var(--accent-bg); }

.doc-dropzone__icon { font-size: 22px; margin-bottom: 6px; opacity: 0.6; }
.doc-dropzone__label { font-size: 12px; color: var(--text-2); margin-bottom: 3px; }
.doc-dropzone__label strong { color: var(--accent); cursor: pointer; }
.doc-dropzone__sub { font-size: 11px; color: var(--text-3); }

/* Upload progress */
.doc-upload-progress {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-1);
  background: var(--accent-bg);
  flex-shrink: 0;
}
.doc-upload-progress__label { font-size: 11px; color: var(--text-2); white-space: nowrap; }
.doc-upload-progress__bar-wrap { flex: 1; height: 3px; background: var(--bg-3); border-radius: 2px; overflow: hidden; }
.doc-upload-progress__bar { height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.3s ease; }
.doc-upload-progress__pct { font-size: 10px; color: var(--text-3); white-space: nowrap; }

/* Actions bar */
.doc-actions-bar {
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-1);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.doc-actions-bar__count { font-size: 11px; color: var(--text-3); flex: 1; }
.doc-process-btn {
  padding: 5px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-2);
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 5px;
  transition: all 0.15s;
}
.doc-process-btn:hover { background: var(--bg-3); color: var(--text-1); }
.doc-process-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.doc-process-btn__dot { width: 6px; height: 6px; border-radius: 50%; background: var(--color-high); flex-shrink: 0; }

/* Document list */
.doc-list { flex: 1; overflow-y: auto; }

.doc-list-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 16px;
  border-bottom: 1px solid var(--border-1);
  transition: background 0.1s;
  position: relative;
}
.doc-list-item:hover { background: var(--bg-2); }
.doc-list-item:last-child { border-bottom: none; }

.doc-list-item__info { flex: 1; min-width: 0; }
.doc-list-item__name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 3px;
}
.doc-list-item__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--text-3);
  flex-wrap: wrap;
}

.doc-status-chip { display: inline-flex; align-items: center; gap: 3px; }
.doc-status-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
.doc-status-dot--done     { background: var(--color-medium); }
.doc-status-dot--pending  { background: var(--color-high); }
.doc-status-dot--running  { background: var(--accent); animation: spin 1.4s linear infinite; }
.doc-status-dot--failed   { background: var(--color-critical); }

.doc-list-item__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.1s;
  flex-shrink: 0;
}
.doc-list-item:hover .doc-list-item__actions { opacity: 1; }

.doc-icon-btn {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  transition: background 0.1s, color 0.1s;
}
.doc-icon-btn:hover { background: var(--bg-3); color: var(--text-1); }
.doc-icon-btn--danger:hover { background: var(--critical-bg); color: var(--color-critical); }

/* Empty state inside drawer */
.doc-drawer-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-3);
  padding: 32px;
  text-align: center;
}
.doc-drawer-empty p { font-size: 12px; color: var(--text-3); max-width: 260px; line-height: 1.5; }

/* Trigger button in case shell header */
.doc-trigger-btn {
  padding: 5px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-2);
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s;
  white-space: nowrap;
}
.doc-trigger-btn:hover { background: var(--bg-3); color: var(--text-1); }
.doc-trigger-btn--open { background: var(--accent-bg); border-color: rgba(96,165,250,0.4); color: var(--accent); }
```

- [ ] **Step 1.2: Verify TypeScript still passes**

```bash
cd C:/Users/tjcol/Catalyst/frontend && npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 1.3: Commit**

```bash
cd C:/Users/tjcol/Catalyst && git add frontend/src/index.css && git commit -m "feat(css): add document drawer layout classes"
```

---

## Task 2: DocumentDrawer component

**Files:**
- Create: `frontend/src/components/DocumentDrawer.tsx`

- [ ] **Step 2.1: Create the component file**

Create `frontend/src/components/DocumentDrawer.tsx` with the following content:

```tsx
import { useRef, useState } from "react";
import { toast } from "sonner";
import { uploadDocuments, processPendingDocuments, deleteDocument } from "../api";
import type { DocumentItem } from "../types";

// ── Types ──────────────────────────────────────────────────────────────────

interface DocumentDrawerProps {
  caseId: string;
  documents: DocumentItem[];
  onDocumentsChanged: () => void;
  onViewDocument: (docId: string, docName: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type OcrStatusKey = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "SKIPPED";

const OCR_LABEL: Record<OcrStatusKey, string> = {
  PENDING:     "Pending OCR",
  IN_PROGRESS: "OCR running",
  COMPLETED:   "Extracted",
  FAILED:      "OCR failed",
  SKIPPED:     "Skipped",
};

const OCR_DOT_CLASS: Record<OcrStatusKey, string> = {
  PENDING:     "doc-status-dot--pending",
  IN_PROGRESS: "doc-status-dot--running",
  COMPLETED:   "doc-status-dot--done",
  FAILED:      "doc-status-dot--failed",
  SKIPPED:     "doc-status-dot--pending",
};

const DOC_TYPE_LABEL: Record<string, string> = {
  IRS_990: "990", DEED: "Deed", UCC: "UCC", BANK_STATEMENT: "Bank",
  AUDIT_REPORT: "Audit", PERMIT: "Permit", CONTRACT: "Contract",
  CORRESPONDENCE: "Corr", OTHER: "Doc", UNKNOWN: "Doc",
};

// ── Sub-components ─────────────────────────────────────────────────────────

function DocItem({
  doc,
  caseId,
  onDeleted,
  onView,
}: {
  doc: DocumentItem;
  caseId: string;
  onDeleted: (id: string) => void;
  onView: (id: string, name: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const status = doc.ocr_status as OcrStatusKey;
  const label = doc.display_name || doc.filename;

  async function handleDelete() {
    if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteDocument(caseId, doc.id);
      onDeleted(doc.id);
      toast.success("Document deleted.");
    } catch {
      toast.error("Failed to delete document.");
      setDeleting(false);
    }
  }

  return (
    <div className={`doc-list-item${deleting ? " spin" : ""}`} style={{ opacity: deleting ? 0.5 : 1 }}>
      <span className={`doc-badge doc-badge--${doc.doc_type}`}>
        {DOC_TYPE_LABEL[doc.doc_type] ?? "Doc"}
      </span>
      <div className="doc-list-item__info">
        <div className="doc-list-item__name" title={label}>{label}</div>
        <div className="doc-list-item__meta">
          <span className="doc-status-chip">
            <span className={`doc-status-dot ${OCR_DOT_CLASS[status]}`} />
            {OCR_LABEL[status]}
          </span>
          <span>·</span>
          <span>{formatBytes(doc.file_size)}</span>
          <span>·</span>
          <span>{formatDate(doc.uploaded_at)}</span>
        </div>
      </div>
      <div className="doc-list-item__actions">
        {doc.ocr_status === "COMPLETED" && (
          <button
            type="button"
            className="doc-icon-btn"
            title="View document"
            onClick={() => onView(doc.id, label)}
          >
            👁
          </button>
        )}
        <button
          type="button"
          className="doc-icon-btn doc-icon-btn--danger"
          title="Delete document"
          onClick={handleDelete}
          disabled={deleting}
        >
          🗑
        </button>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function DocumentDrawer({
  caseId,
  documents,
  onDocumentsChanged,
  onViewDocument,
}: DocumentDrawerProps) {
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadLabel, setUploadLabel] = useState("");
  const [processing, setProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | "pending">("all");
  const [optimisticDeleted, setOptimisticDeleted] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const visibleDocs = documents.filter((d) => !optimisticDeleted.has(d.id));
  const pendingDocs = visibleDocs.filter(
    (d) => d.ocr_status === "PENDING" || d.ocr_status === "IN_PROGRESS"
  );
  const shownDocs = activeTab === "pending" ? pendingDocs : visibleDocs;

  // Fake progress animation — real upload has no progress events
  function startFakeProgress(fileCount: number) {
    setUploadLabel(`Uploading ${fileCount} file${fileCount > 1 ? "s" : ""}…`);
    setUploadPct(0);
    setUploading(true);
    let pct = 0;
    progressRef.current = setInterval(() => {
      pct = Math.min(pct + Math.random() * 8, 85);
      setUploadPct(Math.round(pct));
    }, 200);
  }

  function stopFakeProgress() {
    if (progressRef.current) clearInterval(progressRef.current);
    setUploadPct(100);
    setTimeout(() => { setUploading(false); setUploadPct(0); }, 600);
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const formData = new FormData();
    Array.from(files).forEach((f) => formData.append("files", f));
    startFakeProgress(files.length);
    try {
      await uploadDocuments(caseId, formData);
      stopFakeProgress();
      onDocumentsChanged();
      toast.success(`${files.length} document${files.length > 1 ? "s" : ""} uploaded.`);
    } catch (err) {
      stopFakeProgress();
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    }
  }

  async function handleProcessPending() {
    setProcessing(true);
    try {
      await processPendingDocuments(caseId);
      onDocumentsChanged();
      toast.success("OCR processing started.");
    } catch {
      toast.error("Failed to start OCR processing.");
    } finally {
      setProcessing(false);
    }
  }

  function handleDeleted(docId: string) {
    setOptimisticDeleted((prev) => new Set([...prev, docId]));
    onDocumentsChanged();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  function openDrawer() {
    setOpen(true);
    setOptimisticDeleted(new Set());
  }

  const docCount = visibleDocs.length;
  const pendingCount = pendingDocs.length;

  if (!open) {
    return (
      <button type="button" className="doc-trigger-btn" onClick={openDrawer}>
        ⬆ Documents ({docCount})
      </button>
    );
  }

  return (
    <>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.PDF"
        style={{ display: "none" }}
        onChange={(e) => handleFiles(e.target.files)}
      />

      {/* Trigger button — active state */}
      <button type="button" className="doc-trigger-btn doc-trigger-btn--open" onClick={() => setOpen(false)}>
        ⬆ Documents ({docCount})
      </button>

      {/* Overlay */}
      <div className="doc-drawer-overlay" onClick={() => setOpen(false)} />

      {/* Drawer */}
      <div className="doc-drawer">
        {/* Header */}
        <div className="doc-drawer__header">
          <span className="doc-drawer__title">Documents</span>
          <button type="button" className="doc-drawer__close" onClick={() => setOpen(false)}>✕</button>
        </div>

        {/* Tabs */}
        <div className="doc-drawer__tabs">
          <button
            type="button"
            className={`doc-drawer__tab${activeTab === "all" ? " active" : ""}`}
            onClick={() => setActiveTab("all")}
          >
            All documents
          </button>
          <button
            type="button"
            className={`doc-drawer__tab${activeTab === "pending" ? " active" : ""}`}
            onClick={() => setActiveTab("pending")}
          >
            Pending OCR {pendingCount > 0 && `(${pendingCount})`}
          </button>
        </div>

        {/* Dropzone */}
        <div
          className={`doc-dropzone${dragging ? " doc-dropzone--drag" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="doc-dropzone__icon">📄</div>
          <div className="doc-dropzone__label">
            Drop files here or <strong>browse</strong>
          </div>
          <div className="doc-dropzone__sub">PDF · multiple files accepted</div>
        </div>

        {/* Upload progress */}
        {uploading && (
          <div className="doc-upload-progress">
            <span className="doc-upload-progress__label">{uploadLabel}</span>
            <div className="doc-upload-progress__bar-wrap">
              <div className="doc-upload-progress__bar" style={{ width: `${uploadPct}%` }} />
            </div>
            <span className="doc-upload-progress__pct">{uploadPct}%</span>
          </div>
        )}

        {/* Actions bar */}
        <div className="doc-actions-bar">
          <span className="doc-actions-bar__count">
            {docCount} document{docCount !== 1 ? "s" : ""}
            {pendingCount > 0 && ` · ${pendingCount} pending OCR`}
          </span>
          {pendingCount > 0 && (
            <button
              type="button"
              className="doc-process-btn"
              onClick={handleProcessPending}
              disabled={processing}
            >
              <span className="doc-process-btn__dot" />
              {processing ? "Starting…" : "Run OCR on pending"}
            </button>
          )}
        </div>

        {/* Document list */}
        <div className="doc-list">
          {shownDocs.length === 0 ? (
            <div className="doc-drawer-empty">
              <p>
                {activeTab === "pending"
                  ? "No documents pending OCR."
                  : "No documents yet. Drop files above to upload."}
              </p>
            </div>
          ) : (
            shownDocs.map((doc) => (
              <DocItem
                key={doc.id}
                doc={doc}
                caseId={caseId}
                onDeleted={handleDeleted}
                onView={(id, name) => {
                  setOpen(false);
                  onViewDocument(id, name);
                }}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2.2: Verify TypeScript compiles**

```bash
cd C:/Users/tjcol/Catalyst/frontend && npx tsc --noEmit
```
Expected: zero errors. Fix any type errors before continuing.

- [ ] **Step 2.3: Commit**

```bash
cd C:/Users/tjcol/Catalyst && git add frontend/src/components/DocumentDrawer.tsx && git commit -m "feat(docs): DocumentDrawer component — upload, list, OCR trigger, delete"
```

---

## Task 3: Wire DocumentDrawer into CaseDetailView

**Files:**
- Modify: `frontend/src/views/CaseDetailView.tsx`

The drawer needs to:
1. Be positioned relative to the tab content area (so it overlays the graph canvas, not the header)
2. Trigger a case refetch when documents change
3. Pass a `onViewDocument` handler that navigates to Document View (Level 4)

- [ ] **Step 3.1: Add DocumentDrawer import and refetch callback**

At the top of `CaseDetailView.tsx`, add the import after the existing imports:

```tsx
import DocumentDrawer from "../components/DocumentDrawer";
```

In the `CaseDetailView` function body, after the existing state declarations, add a `refetchCase` callback:

```tsx
function refetchCase() {
  if (!id) return;
  fetchCase(id).then(setCaseData).catch(console.error);
}
```

- [ ] **Step 3.2: Replace the dead "Upload docs" button with the drawer trigger**

Find the `case-shell-header__right` div (around line 119):

```tsx
<div className="case-shell-header__right">
  {caseData && <StatusPill status={caseData.status} />}
</div>
```

Replace with:

```tsx
<div className="case-shell-header__right">
  {caseData && <StatusPill status={caseData.status} />}
  {caseData && id && (
    <DocumentDrawer
      caseId={id}
      documents={caseData.documents}
      onDocumentsChanged={refetchCase}
      onViewDocument={(docId, docName) => {
        setActiveTab("investigate");
      }}
    />
  )}
</div>
```

**Note:** The `onViewDocument` handler switches to the Investigate tab. Full Level 4 navigation (opening the document in the drill-down) will be wired in the Document View task. For now, switching to Investigate tab is sufficient — the user can navigate from there.

- [ ] **Step 3.3: Add the drawer positioning wrapper**

The drawer uses `position: absolute` so its container needs `position: relative`. Find the `<Tabs.Root>` wrapper div (around line 127):

```tsx
<Tabs.Root
  value={activeTab}
  onValueChange={setActiveTab}
  style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}
>
```

Change its style to add `position: relative`:

```tsx
<Tabs.Root
  value={activeTab}
  onValueChange={setActiveTab}
  style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, position: "relative" }}
>
```

- [ ] **Step 3.4: Verify TypeScript compiles**

```bash
cd C:/Users/tjcol/Catalyst/frontend && npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3.5: Commit**

```bash
cd C:/Users/tjcol/Catalyst && git add frontend/src/views/CaseDetailView.tsx && git commit -m "feat(shell): wire DocumentDrawer into case header"
```

---

## Task 4: Verify end-to-end in the browser

- [ ] **Step 4.1: Start dev server**

```bash
cd C:/Users/tjcol/Catalyst/frontend && npm run dev
```

Open http://localhost:5173. Navigate to any case.

- [ ] **Step 4.2: Test upload**

1. Click "Documents (N)" in the top nav — drawer should slide in
2. Drop a PDF onto the dropzone (or click Browse and pick a file)
3. Progress bar should appear, then disappear
4. New document should appear in the list with status "Pending OCR"
5. "Run OCR on pending" button should appear in the actions bar

- [ ] **Step 4.3: Test Run OCR**

1. Click "Run OCR on pending"
2. Button should show "Starting…"
3. Toast: "OCR processing started."
4. Status dot should update to running/completed after a moment (may require manual refresh until real-time polling is added)

- [ ] **Step 4.4: Test delete**

1. Hover over any document row — view and delete icons appear
2. Click delete — confirm dialog appears
3. Confirm — document disappears immediately (optimistic removal)
4. Toast: "Document deleted."

- [ ] **Step 4.5: Test close**

1. Click the ✕ button — drawer closes
2. Click the overlay — drawer closes
3. Button returns to non-active state

- [ ] **Step 4.6: Build check**

```bash
cd C:/Users/tjcol/Catalyst/frontend && npm run build
```
Expected: successful build.

- [ ] **Step 4.7: Commit and push**

```bash
cd C:/Users/tjcol/Catalyst && git push origin main
```

---

## Definition of Done

- [ ] "Documents (N)" button in top nav shows correct count
- [ ] Clicking button opens the right-side drawer
- [ ] Drag-and-drop and browse both trigger upload
- [ ] Progress bar shows during upload
- [ ] Documents appear in list immediately after upload
- [ ] "Run OCR on pending" appears when pending documents exist, calls the API
- [ ] Deleting removes document optimistically and calls API
- [ ] "View document" button on extracted docs switches to Investigate tab
- [ ] Drawer closes on overlay click or ✕
- [ ] `npx tsc --noEmit` zero errors
- [ ] `npm run build` passes
