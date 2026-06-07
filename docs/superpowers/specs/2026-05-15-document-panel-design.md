# Document Panel — Design Spec
**Date:** 2026-05-15
**Status:** Approved by Tyler

---

## Problem

There is no way to upload documents into Catalyst. The "Upload docs" button in the case header has no `onClick` handler. Without documents, the entire pipeline (OCR → entity extraction → 990 parsing → signal rules → financials) cannot be tested or used.

---

## Solution

A right-side drawer that slides in over the graph canvas when the user clicks the "Documents (N)" button in the case shell header. Triggered from any tab. Handles upload, list, OCR trigger, and delete.

---

## Visual Design

- **Trigger:** Top nav button shows `⬆ Documents (N)` where N is the live document count. Active state: blue tint border.
- **Drawer:** 440px wide, slides in from right, dark overlay (`rgba(0,0,0,0.35)`) behind it. Click overlay to close.
- **Inside the drawer (top to bottom):**
  1. Header row: "Documents" title + ✕ close button
  2. Tab bar: "All documents" | "Pending OCR (N)"
  3. Dropzone: dashed border, "Drop files here or browse", accepts multiple PDFs
  4. Upload progress bar (visible only during upload)
  5. Actions bar: doc count label + "Run OCR on pending" button (amber dot, only shown when pending > 0)
  6. Document list (scrollable)

- **Document list row:** `[TYPE BADGE] [filename + meta row] [hover: view 👁 | delete 🗑]`
  - Meta row: status chip (colored dot + label) · file size · page count (if extracted) · date
  - Status dots: green = Extracted, amber = Pending OCR, blue pulse = OCR Running, red = Failed

---

## API Wiring

| Action | API call |
|--------|---------|
| Upload files (drop or browse) | `POST /api/cases/:id/documents/bulk/` multipart |
| List documents | Already in `GET /api/cases/:id/` → `caseData.documents` — no extra call needed |
| Run OCR on pending | `POST /api/cases/:id/documents/process-pending/` |
| Delete document | `DELETE /api/cases/:id/documents/:doc_id/` |
| View document | Navigate to Document View (Level 4) in Investigate tab |

---

## Component Plan

### New file: `frontend/src/components/DocumentDrawer.tsx`

```
Props:
  caseId: string
  documents: DocumentItem[]
  onDocumentsChanged: () => void   ← triggers parent to re-fetch case data
  onViewDocument: (docId: string, docName: string) => void

Internal state:
  open: boolean
  dragging: boolean
  uploading: boolean
  uploadProgress: number (0-100, fake progress via interval)
  processingOcr: boolean

Behavior:
  - File input (hidden) + dropzone both trigger upload
  - Upload: call uploadDocuments(caseId, files), then call onDocumentsChanged()
  - "Run OCR": call processPendingDocuments(caseId), then call onDocumentsChanged()
  - Delete: call deleteDocument(caseId, docId), then call onDocumentsChanged()
  - onViewDocument: closes drawer, calls parent navigate handler
```

### Modified: `frontend/src/views/CaseDetailView.tsx`

- Replace dead `<button className="btn-ghost">Upload docs</button>` with `<DocumentDrawer>` component
- Pass `caseData.documents` and a refetch callback
- Pass `onViewDocument` that sets the Investigate tab active and navigates to Level 4

---

## Behaviour Details

**Upload flow:**
1. User drops files or clicks "browse" → hidden `<input type="file" multiple accept=".pdf">` fires
2. Show progress bar immediately (fake progress animation — real upload has no progress events)
3. Call `uploadDocuments(caseId, fileList)` → `POST /api/cases/:id/documents/bulk/`
4. On success: call `onDocumentsChanged()` to refetch case data, hide progress bar
5. On error: show inline error message in the dropzone area, hide progress

**Pending OCR detection:**
- Derived from `documents.filter(d => d.ocr_status === "PENDING" || d.ocr_status === "IN_PROGRESS")`
- Badge count on "Pending OCR" tab updates reactively from props

**Delete flow:**
- Immediate optimistic removal from list
- API call in background
- On error: restore item, show toast error

**Document count in trigger button:**
- `documents.length` from `caseData.documents`
- Shown as `⬆ Documents (3)` — updates without page reload after uploads/deletes

---

## Definition of Done

- [ ] Clicking "Documents (N)" opens the drawer
- [ ] Files can be dragged onto the dropzone or selected via browse
- [ ] Uploaded files appear in the list immediately after upload
- [ ] "Run OCR on pending" button appears when `ocr_status === "PENDING"` docs exist
- [ ] Clicking "Run OCR" calls `processPendingDocuments` and updates status
- [ ] Delete removes the document and updates the count
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] `npm run build` passes
