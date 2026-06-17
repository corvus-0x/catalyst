/**
 * CiteDocumentPicker.tsx — Step 11 of the frontend build sequence.
 *
 * Lets an investigator pick documents from the case and add them to an angle's
 * citations. Selecting documents appends [Doc-N] references to the angle's
 * narrative via updateAngle (PATCH /api/cases/:id/findings/:id/).
 *
 * Vocabulary:
 *   Angle  = Finding (the narrative unit of investigation)
 *   Knot   = Person or Organization node (not used here)
 *   Intake = extraction pipeline (not "AI")
 */

import { useState, useMemo } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Check, FileText } from "lucide-react";
import { updateAngle } from "../api";
import type { FindingItem, DocumentItem, DocType } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the [Doc-N] suffix to append to the narrative for newly selected docs. */
function appendDocRefs(
  narrative: string,
  selectedDocs: DocumentItem[],
  existingLinks: FindingItem["document_links"],
): string {
  if (selectedDocs.length === 0) return narrative;
  const base = existingLinks.length;
  const refs = selectedDocs
    .map((doc, i) => `[Doc-${base + i + 1}] ${doc.filename}`)
    .join("\n");
  return narrative ? `${narrative}\n${refs}` : refs;
}

/** Map a DocType to its CSS modifier class. */
function docBadgeClass(docType: DocType | string): string {
  const known: Record<string, string> = {
    IRS_990: "doc-badge--IRS_990",
    DEED: "doc-badge--DEED",
    UCC: "doc-badge--UCC",
    AUDIT_REPORT: "doc-badge--AUDIT_REPORT",
    BANK_STATEMENT: "doc-badge--BANK_STATEMENT",
    OTHER: "doc-badge--OTHER",
    UNKNOWN: "doc-badge--UNKNOWN",
  };
  return `doc-badge ${known[docType] ?? "doc-badge--UNKNOWN"}`;
}

/** Human-readable short label for a document type. */
function docTypeLabel(docType: DocType | string): string {
  const labels: Record<string, string> = {
    IRS_990: "990",
    DEED: "Deed",
    UCC: "UCC",
    AUDIT_REPORT: "Audit",
    BANK_STATEMENT: "Bank",
    PERMIT: "Permit",
    CONTRACT: "Contract",
    CORRESPONDENCE: "Letter",
    OTHER: "Other",
    UNKNOWN: "Doc",
  };
  return labels[docType] ?? "Doc";
}

/** Display name for a document: prefer display_name, fall back to filename. */
function docLabel(doc: DocumentItem): string {
  return doc.display_name || doc.filename;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CiteDocumentPickerProps {
  open: boolean;
  caseId: string;
  finding: FindingItem;
  /** All documents belonging to this case. */
  documents: DocumentItem[];
  onClose: () => void;
  /** Called with the IDs of newly cited documents after a successful PATCH. */
  onCited: (newDocIds: string[]) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CiteDocumentPicker({
  open,
  caseId,
  finding,
  documents,
  onClose,
  onCited,
}: CiteDocumentPickerProps) {
  const [filter, setFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Already-cited document IDs (from document_links on the finding).
  const alreadyCitedIds = useMemo(
    () => new Set(finding.document_links.map((l) => l.document_id)),
    [finding.document_links],
  );

  // Split documents into already-cited and available groups, applying the filter.
  const filterText = filter.toLowerCase();

  const alreadyCited = useMemo(
    () =>
      documents.filter(
        (doc) =>
          alreadyCitedIds.has(doc.id) &&
          (filterText === "" || docLabel(doc).toLowerCase().includes(filterText)),
      ),
    [documents, alreadyCitedIds, filterText],
  );

  const available = useMemo(
    () =>
      documents.filter(
        (doc) =>
          !alreadyCitedIds.has(doc.id) &&
          (filterText === "" || docLabel(doc).toLowerCase().includes(filterText)),
      ),
    [documents, alreadyCitedIds, filterText],
  );

  // Compute Doc-N index for already-cited docs (1-based, by document_links order).
  const citedIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    finding.document_links.forEach((link, i) => {
      map.set(link.document_id, i + 1);
    });
    return map;
  }, [finding.document_links]);

  // Compute starting index for available docs (after all existing links).
  const nextIndex = finding.document_links.length + 1;

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function toggleDoc(docId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  }

  async function handleCite() {
    if (selectedIds.size === 0 || saving) return;

    setSaving(true);
    try {
      const selectedDocs = available.filter((doc) => selectedIds.has(doc.id));
      const updatedNarrative = appendDocRefs(
        finding.narrative,
        selectedDocs,
        finding.document_links,
      );
      await updateAngle(caseId, finding.id, {
        narrative: updatedNarrative,
        add_document_ids: Array.from(selectedIds),
      });
      onCited(Array.from(selectedIds));
      onClose();
    } finally {
      setSaving(false);
    }
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) onClose();
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          {/* Header */}
          <div className="dialog-header">
            <Dialog.Title className="dialog-title">
              Cite a document in: {finding.title}
            </Dialog.Title>
            <button
              type="button"
              className="icon-btn"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="dialog-body">
            {/* Filter input */}
            <input
              type="text"
              className="research-input"
              placeholder="Filter documents…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter documents"
            />

            {/* Already cited section */}
            {alreadyCited.length > 0 && (
              <section aria-label="Already cited">
                <p className="panel-section__title">
                  Already cited in this angle ({alreadyCited.length})
                </p>
                <ul className="cite-list" role="list">
                  {alreadyCited.map((doc) => {
                    const docIndex = citedIndexMap.get(doc.id);
                    return (
                      <li key={doc.id} className="cite-item cite-item--already-cited">
                        <Check size={14} aria-hidden="true" />
                        <span className={docBadgeClass(doc.doc_type)}>
                          {docTypeLabel(doc.doc_type)}
                        </span>
                        <span className="cite-item__ref">
                          {docIndex !== undefined ? `[Doc-${docIndex}]` : ""}
                        </span>
                        <span className="cite-item__name">{docLabel(doc)}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {/* Available section */}
            <section aria-label="Available documents">
              <p className="panel-section__title">
                Available ({available.length})
              </p>
              {available.length === 0 ? (
                <p className="empty-state-text">
                  {filterText ? "No documents match your filter." : "All documents already cited."}
                </p>
              ) : (
                <ul className="cite-list" role="list">
                  {available.map((doc, i) => {
                    const isSelected = selectedIds.has(doc.id);
                    const docIndex = nextIndex + i;
                    return (
                      <li key={doc.id} className="cite-item">
                        <label className="cite-item__label">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleDoc(doc.id)}
                            aria-label={`Cite ${docLabel(doc)}`}
                          />
                          <span className={docBadgeClass(doc.doc_type)}>
                            {docTypeLabel(doc.doc_type)}
                          </span>
                          <span className="cite-item__ref">[Doc-{docIndex}]</span>
                          <span className="cite-item__name">
                            <FileText size={13} aria-hidden="true" />
                            {docLabel(doc)}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          {/* Footer */}
          <div className="dialog-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={selectedIds.size === 0 || saving}
              onClick={handleCite}
            >
              {saving ? "Saving…" : `Cite selected (${selectedIds.size})`}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
