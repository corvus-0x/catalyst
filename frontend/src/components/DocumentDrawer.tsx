import { useEffect, useRef, useState } from "react";
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

// ── DocItem sub-component ──────────────────────────────────────────────────

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
    <div className="doc-list-item" style={{ opacity: deleting ? 0.5 : 1 }}>
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
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (progressRef.current) clearInterval(progressRef.current);
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    };
  }, []);

  const visibleDocs = documents.filter((d) => !optimisticDeleted.has(d.id));
  const pendingDocs = visibleDocs.filter(
    (d) => d.ocr_status === "PENDING" || d.ocr_status === "IN_PROGRESS"
  );
  const shownDocs = activeTab === "pending" ? pendingDocs : visibleDocs;

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
    stopTimerRef.current = setTimeout(() => { setUploading(false); setUploadPct(0); }, 600);
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (uploading) return;
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
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.PDF"
        style={{ display: "none" }}
        onChange={(e) => { handleFiles(e.target.files); e.currentTarget.value = ""; }}
      />

      <button type="button" className="doc-trigger-btn doc-trigger-btn--open" onClick={() => setOpen(false)}>
        ⬆ Documents ({docCount})
      </button>

      <div className="doc-drawer-overlay" onClick={() => setOpen(false)} />

      <div className="doc-drawer">
        <div className="doc-drawer__header">
          <span className="doc-drawer__title">Documents</span>
          <button type="button" className="doc-drawer__close" onClick={() => setOpen(false)}>✕</button>
        </div>

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

        <div
          className={`doc-dropzone${dragging ? " doc-dropzone--drag" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setDragging(false);
            }
          }}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="doc-dropzone__icon">📄</div>
          <div className="doc-dropzone__label">
            Drop files here or <strong>browse</strong>
          </div>
          <div className="doc-dropzone__sub">PDF · multiple files accepted</div>
        </div>

        {uploading && (
          <div className="doc-upload-progress">
            <span className="doc-upload-progress__label">{uploadLabel}</span>
            <div className="doc-upload-progress__bar-wrap">
              <div className="doc-upload-progress__bar" style={{ width: `${uploadPct}%` }} />
            </div>
            <span className="doc-upload-progress__pct">{uploadPct}%</span>
          </div>
        )}

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
