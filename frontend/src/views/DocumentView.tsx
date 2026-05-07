/**
 * DocumentView.tsx — Level 4 drill-down: document reader + RAG search panel.
 *
 * Vocabulary (CLAUDE.md):
 *   Intake      = the extraction pipeline (never "AI", never "Claude")
 *   Quick capture = InvestigatorNote attached to a document selection
 *   Doc-N       = citation references like [Doc-3]
 *
 * Layout:
 *   ┌── doc-view ──────────────────────────────────────────────────────┐
 *   │  ┌── doc-view__main ──────────────────┐  ┌── rag-panel (260px) ─┐│
 *   │  │  header: back | badge | name | … │  │  search input         ││
 *   │  │──────────────────────────────── │  │  result list          ││
 *   │  │  content: OCR text / status msg  │  │                      ││
 *   │  └────────────────────────────────┘  └───────────────────────┘│
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Steps 9–10 of the frontend build sequence.
 */

import { useEffect, useRef, useState } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { ArrowLeft, Search, X, Loader2 } from "lucide-react";

import type { DocumentItem, SearchResult, SearchResponse } from "../types";
import { fetchDocument, searchAll, createNote, fetchAngle, updateAngle } from "../api";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DocumentViewProps {
  caseId: string;
  documentId: string;
  activeAngleId?: string;
  onBack: () => void;
  onDocumentNavigate?: (docId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function OcrChip({ status }: { status: DocumentItem["ocr_status"] }) {
  const map: Record<DocumentItem["ocr_status"], { label: string; style: React.CSSProperties }> = {
    COMPLETED: { label: "Text extracted", style: { background: "#dcfce7", color: "#14532d" } },
    PENDING: { label: "Processing…", style: { background: "#fef9c3", color: "#713f12" } },
    IN_PROGRESS: { label: "Processing…", style: { background: "#fef9c3", color: "#713f12" } },
    FAILED: { label: "Extraction failed", style: { background: "#fee2e2", color: "#991b1b" } },
    SKIPPED: { label: "Skipped", style: { background: "#f3f4f6", color: "#6b7280" } },
  };
  const { label, style } = map[status] ?? map.SKIPPED;
  return (
    <span
      style={{
        ...style,
        fontSize: 11,
        fontWeight: 600,
        borderRadius: 9999,
        padding: "1px 8px",
        display: "inline-block",
      }}
    >
      {label}
    </span>
  );
}

function buildContentText(doc: DocumentItem): string {
  if (doc.extracted_text && doc.extracted_text.trim().length > 0) {
    return doc.extracted_text;
  }

  switch (doc.ocr_status) {
    case "COMPLETED":
      return `[Document: ${doc.filename}]\n[Text extraction completed but no content returned — the document may be image-only.]\n\nSHA-256: ${doc.sha256_hash}`;
    case "PENDING":
    case "IN_PROGRESS":
      return "Intake is processing this document…";
    case "FAILED":
      return `Intake could not extract text from this document.\n\nExtraction notes:\n${doc.extraction_notes || "(none)"}`;
    case "SKIPPED":
      return "Text extraction was skipped for this document.";
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function DocumentView({ caseId, documentId, activeAngleId, onBack, onDocumentNavigate }: DocumentViewProps) {
  // --- Document state ---
  const [doc, setDoc] = useState<DocumentItem | null>(null);
  const [loading, setLoading] = useState(true);

  // --- RAG panel state ---
  const [query, setQuery] = useState("");
  const [ragResults, setRagResults] = useState<SearchResult[]>([]);
  const [ragLoading, setRagLoading] = useState(false);
  const [jumpBanner, setJumpBanner] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Context menu / quick capture state ---
  const [capturedBanner, setCapturedBanner] = useState(false);

  // --- Load document on mount ---
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchDocument(caseId, documentId)
      .then((d) => {
        if (!cancelled) {
          setDoc(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, documentId]);

  // --- Debounced RAG search ---
  function handleQueryChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.length < 2) {
      setRagResults([]);
      setRagLoading(false);
      return;
    }
    setRagLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const resp: SearchResponse = await searchAll({ q: value, case_id: caseId });
        setRagResults(resp.results.slice(0, 8));
      } catch {
        setRagResults([]);
      } finally {
        setRagLoading(false);
      }
    }, 400);
  }

  function handleResultClick(result: SearchResult) {
    if (result.type === "document" && result.id !== documentId && onDocumentNavigate) {
      onDocumentNavigate(result.id);
    } else {
      setJumpBanner(`Jump to: ${result.title}`);
      setTimeout(() => setJumpBanner(null), 2000);
    }
  }

  // --- Context menu actions ---
  function handleSearchSelection() {
    const selection = window.getSelection()?.toString().trim() ?? "";
    if (selection) handleQueryChange(selection);
  }

  async function handleCiteInAngle() {
    const selection = window.getSelection()?.toString().trim() ?? "";
    if (!selection || !activeAngleId) return;

    try {
      const current = await fetchAngle(caseId, activeAngleId);
      const passage = `\n— from ${doc?.filename ?? "document"}: "${selection}"`;
      const updated = current.narrative ? current.narrative + passage : passage.trimStart();
      await updateAngle(caseId, activeAngleId, { narrative: updated });
      setCapturedBanner(true);
      setTimeout(() => setCapturedBanner(false), 1500);
    } catch {
      // silent fail — investigator can manually paste
    }
  }

  async function handleQuickCapture() {
    const selection = window.getSelection()?.toString().trim() ?? "(no selection)";
    try {
      await createNote(caseId, {
        target_type: "document",
        target_id: documentId,
        content: selection,
      });
    } catch {
      // capture failure is silent in the banner UI
    }
    setCapturedBanner(true);
    setTimeout(() => setCapturedBanner(false), 1500);
  }

  // ---------------------------------------------------------------------------
  // Render — skeleton while loading
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="doc-view" style={{ height: "100%", display: "flex" }}>
        <div className="doc-view__main">
          <div className="doc-view__header">
            <button type="button" className="back-btn" onClick={onBack}>
              <ArrowLeft size={14} />
              Back
            </button>
            <span className="skeleton" style={{ width: 60, height: 18, borderRadius: 4 }} />
            <span className="skeleton" style={{ width: 180, height: 16, borderRadius: 4 }} />
          </div>
          <div className="doc-view__content">
            <span className="skeleton" style={{ display: "block", width: "90%", height: 14, marginBottom: 8 }} />
            <span className="skeleton" style={{ display: "block", width: "70%", height: 14, marginBottom: 8 }} />
            <span className="skeleton" style={{ display: "block", width: "80%", height: 14 }} />
          </div>
        </div>
        <div className="rag-panel">
          <div className="rag-panel__header">
            <input className="rag-input" placeholder="Search all documents…" disabled />
          </div>
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="doc-view" style={{ height: "100%", display: "flex" }}>
        <div className="doc-view__main">
          <div className="doc-view__header">
            <button type="button" className="back-btn" onClick={onBack}>
              <ArrowLeft size={14} />
              Back
            </button>
          </div>
          <div className="doc-view__content">
            <div className="empty-state">
              <p className="empty-state__title">Document not found</p>
              <p className="empty-state__body">This document could not be loaded.</p>
            </div>
          </div>
        </div>
        <div className="rag-panel">
          <div className="rag-panel__header">
            <input className="rag-input" placeholder="Search all documents…" disabled />
          </div>
        </div>
      </div>
    );
  }

  const contentText = buildContentText(doc);
  const displayName = doc.display_name || doc.filename;

  // ---------------------------------------------------------------------------
  // Render — full view
  // ---------------------------------------------------------------------------

  return (
    <div className="doc-view" style={{ height: "100%", display: "flex" }}>
      {/* ── Main column ── */}
      <div className="doc-view__main">
        {/* Header */}
        <div className="doc-view__header">
          <button type="button" className="back-btn" onClick={onBack}>
            <ArrowLeft size={14} />
            Back
          </button>

          <span className={`doc-badge doc-badge--${doc.doc_type}`}>
            {doc.doc_type.replace(/_/g, " ")}
          </span>

          <span style={{ fontWeight: 600, fontSize: 13, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {displayName}
          </span>

          <OcrChip status={doc.ocr_status} />

          <span style={{ fontSize: 11, color: "#6b7280", flexShrink: 0 }}>
            {formatBytes(doc.file_size)}
          </span>
        </div>

        {/* Captured banner */}
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

        {/* Document content — wrapped in context menu */}
        <ContextMenu.Root>
          <ContextMenu.Trigger asChild>
            <div className="doc-view__content">
              {contentText}
            </div>
          </ContextMenu.Trigger>

          <ContextMenu.Portal>
            <ContextMenu.Content
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
            >
              <ContextMenu.Item
                onSelect={handleSearchSelection}
                style={{
                  padding: "6px 14px",
                  cursor: "pointer",
                  outline: "none",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#f3f4f6")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "")}
              >
                Search docs for selection
              </ContextMenu.Item>
              {activeAngleId && (
                <ContextMenu.Item
                  onSelect={handleCiteInAngle}
                  style={{ padding: "6px 14px", cursor: "pointer", outline: "none" }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#f3f4f6")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "")}
                >
                  Cite in angle
                </ContextMenu.Item>
              )}
              <ContextMenu.Item
                onSelect={handleQuickCapture}
                style={{
                  padding: "6px 14px",
                  cursor: "pointer",
                  outline: "none",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#f3f4f6")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "")}
              >
                Quick capture this
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      </div>

      {/* ── RAG panel ── */}
      <div className="rag-panel">
        <div className="rag-panel__header">
          <p className="panel-section__title" style={{ marginBottom: 6 }}>
            SEARCH
          </p>
          <div style={{ position: "relative" }}>
            <Search
              size={12}
              style={{
                position: "absolute",
                left: 7,
                top: "50%",
                transform: "translateY(-50%)",
                color: "#9ca3af",
                pointerEvents: "none",
              }}
            />
            <input
              className="rag-input"
              placeholder="Search all documents…"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              style={{ paddingLeft: 24, paddingRight: query ? 24 : 8 }}
            />
            {query && (
              <button
                type="button"
                className="icon-btn"
                onClick={() => {
                  setQuery("");
                  setRagResults([]);
                }}
                style={{
                  position: "absolute",
                  right: 4,
                  top: "50%",
                  transform: "translateY(-50%)",
                  padding: 2,
                }}
                aria-label="Clear search"
              >
                <X size={11} />
              </button>
            )}
          </div>
          {ragLoading && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5, color: "#6b7280", fontSize: 11 }}>
              <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />
              Searching…
            </div>
          )}
        </div>

        {/* Jump banner */}
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

        <div className="rag-results">
          {/* Empty-state copy */}
          {!query && !ragLoading && (
            <p style={{ fontSize: 11, color: "#9ca3af", padding: "10px 12px", margin: 0 }}>
              Type to search across all documents in this case.
            </p>
          )}

          {/* No results */}
          {query.length >= 2 && !ragLoading && ragResults.length === 0 && (
            <p style={{ fontSize: 11, color: "#9ca3af", padding: "10px 12px", margin: 0 }}>
              No matches found.
            </p>
          )}

          {/* Results */}
          {ragResults.map((result) => (
            <div
              key={result.id}
              className="rag-result"
              role="button"
              tabIndex={0}
              onClick={() => handleResultClick(result)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") handleResultClick(result);
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
                {result.type === "document" && (
                  <span className="doc-badge doc-badge--OTHER" style={{ fontSize: 9, padding: "0 4px" }}>
                    DOC
                  </span>
                )}
                <p className="rag-result__title">{result.title}</p>
              </div>
              <p className="rag-result__snippet">
                {result.snippet.length > 100
                  ? result.snippet.slice(0, 100) + "…"
                  : result.snippet}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
