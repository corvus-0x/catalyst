/**
 * AngleSplitModal — Step 13 (frontend-design-spec.md §8.1)
 *
 * Split a parent Angle (Finding) into two child Angles.
 * Each cited document is assigned to Angle A, Angle B, or Both.
 * Each child Angle can target a different Knot pair than the parent.
 * The parent Angle is marked Exhausted (DISMISSED) after children are created.
 *
 * Vocabulary:
 *   Angle  = Finding (backend model, frontend narrative unit)
 *   Knot   = Person or Organization node (NOT Property)
 *   [Doc-N] = 1-based citation ref built from document_links index
 */

import { useState, useCallback, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Plus, Search, Loader2 } from "lucide-react";
import { createAngle, updateAngle, fetchEntities } from "../api";
import type {
  FindingItem,
  DocumentItem,
  EntityBrowserItem,
} from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AngleSplitModalProps {
  open: boolean;
  caseId: string;
  finding: FindingItem;
  documents: DocumentItem[];
  onClose: () => void;
  onCreated: () => void;
}

type DocAssignment = "A" | "B" | "Both";

interface SelectedKnot {
  id: string;
  name: string;
  entity_type: "person" | "organization";
}

interface KnotPickerState {
  query: string;
  results: EntityBrowserItem[];
  loading: boolean;
  open: boolean;
  selected: SelectedKnot | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the [Doc-N] citation string for a 0-based document_links index. */
function docRef(index: number): string {
  return `[Doc-${index + 1}]`;
}

/** Derive the short display label for a document. */
function docLabel(docLink: FindingItem["document_links"][number], docs: DocumentItem[]): string {
  const matched = docs.find((d) => d.id === docLink.document_id);
  return matched?.display_name || docLink.document_filename || docLink.document_id;
}

/** Map doc_type to CSS modifier. Falls back to OTHER. */
function docTypeToBadgeClass(
  docLink: FindingItem["document_links"][number],
  docs: DocumentItem[]
): string {
  const matched = docs.find((d) => d.id === docLink.document_id);
  const dt = matched?.doc_type ?? "OTHER";
  return `doc-badge doc-badge--${dt}`;
}

// ---------------------------------------------------------------------------
// KnotPicker — inline sub-component to avoid repetition
// ---------------------------------------------------------------------------

type KnotPickerSetState = (
  next: KnotPickerState | ((prev: KnotPickerState) => KnotPickerState)
) => void;

interface KnotPickerProps {
  id: string;
  caseId: string;
  state: KnotPickerState;
  onChange: KnotPickerSetState;
  placeholder: string;
  disabled?: boolean;
  lockLabel?: string;
}

function KnotPicker({ id, caseId, state, onChange, placeholder, disabled, lockLabel }: KnotPickerProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        onChange((prev) => ({ ...prev, results: [], open: false, loading: false }));
        return;
      }
      onChange((prev) => ({ ...prev, loading: true, open: true }));
      try {
        const res = await fetchEntities({ case_id: caseId, q, limit: 8 });
        const knots = res.results.filter(
          (e) => e.entity_type === "person" || e.entity_type === "organization"
        );
        onChange((prev) => ({ ...prev, results: knots, loading: false, open: knots.length > 0 }));
      } catch {
        onChange((prev) => ({ ...prev, results: [], loading: false, open: false }));
      }
    },
    [caseId, onChange]
  );

  function handleInputChange(value: string): void {
    onChange((prev) => ({ ...prev, query: value, selected: null }));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  }

  if (lockLabel) {
    return (
      <div className="knot-picker knot-picker--locked" id={id}>
        <span className="knot-picker__lock-label">{lockLabel}</span>
      </div>
    );
  }

  return (
    <div className="knot-picker" id={id}>
      <div className="knot-picker__input-wrap">
        <Search size={14} className="knot-picker__icon" aria-hidden="true" />
        <input
          type="text"
          className="query-input knot-picker__input"
          placeholder={placeholder}
          value={state.selected ? state.selected.name : state.query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => {
            if (state.results.length > 0) {
              onChange((prev) => ({ ...prev, open: true }));
            }
          }}
          onBlur={() => {
            setTimeout(() => onChange((prev) => ({ ...prev, open: false })), 150);
          }}
          disabled={disabled}
          autoComplete="off"
          title={placeholder}
          aria-label={placeholder}
          aria-autocomplete="list"
          aria-expanded={state.open ? "true" : "false"}
          aria-controls={`${id}-listbox`}
        />
        {state.loading && (
          <Loader2 size={14} className="knot-picker__spinner" aria-label="Searching…" />
        )}
      </div>

      {state.open && state.results.length > 0 && (
        <ul className="knot-picker__dropdown" role="listbox" id={`${id}-listbox`}>
          {state.results.map((entity) => (
            <li
              key={entity.id}
              role="option"
              aria-selected={state.selected?.id === entity.id ? "true" : "false"}
              className="knot-picker__option"
              onMouseDown={(e) => {
                e.preventDefault();
                if (entity.entity_type !== "person" && entity.entity_type !== "organization") return;
                onChange({
                  query: entity.name,
                  results: [],
                  loading: false,
                  open: false,
                  selected: {
                    id: entity.id,
                    name: entity.name,
                    entity_type: entity.entity_type,
                  },
                });
              }}
            >
              <span className="knot-picker__name">{entity.name}</span>
              <span className={`knot-picker__type knot-picker__type--${entity.entity_type}`}>
                {entity.entity_type === "person" ? "Person" : "Org"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AngleSplitModal({
  open,
  caseId,
  finding,
  documents,
  onClose,
  onCreated,
}: AngleSplitModalProps) {
  // --- Document assignments (default all to "A") ---
  const [assignments, setAssignments] = useState<Record<string, DocAssignment>>(
    () =>
      Object.fromEntries(finding.document_links.map((dl) => [dl.document_id, "A" as DocAssignment]))
  );

  // --- Angle A ---
  const [nameA, setNameA] = useState(`${finding.title} (A)`);
  const [knotA, setKnotA] = useState<KnotPickerState>({
    query: "",
    results: [],
    loading: false,
    open: false,
    selected:
      finding.entity_links.length > 0
        ? null // pre-fill from entity_links if entity type is known knot type — resolved below
        : null,
  });
  const [knotA2, setKnotA2] = useState<KnotPickerState>({
    query: "",
    results: [],
    loading: false,
    open: false,
    selected: null,
  });

  // --- Angle B ---
  const [nameB, setNameB] = useState(`${finding.title} (B)`);
  const [knotB2, setKnotB2] = useState<KnotPickerState>({
    query: "",
    results: [],
    loading: false,
    open: false,
    selected: null,
  });

  // --- Async state ---
  const [creating, setCreating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // --- Entity name from first entity_link (pre-fill label) ---
  const primaryEntityName =
    finding.entity_links.length > 0 ? `[entity ${finding.entity_links[0].entity_id.slice(0, 8)}…]` : "";

  // ---------------------------------------------------------------------------
  // Assignment toggle
  // ---------------------------------------------------------------------------

  function cycleAssignment(docId: string): void {
    setAssignments((prev) => {
      const current = prev[docId] ?? "A";
      const next: DocAssignment = current === "A" ? "B" : current === "B" ? "Both" : "A";
      return { ...prev, [docId]: next };
    });
  }

  // ---------------------------------------------------------------------------
  // Build narrative from assigned refs
  // ---------------------------------------------------------------------------

  function buildNarrative(side: "A" | "B"): string {
    const refs = finding.document_links
      .map((dl, idx) => {
        const assign = assignments[dl.document_id] ?? "A";
        return assign === side || assign === "Both" ? docRef(idx) : null;
      })
      .filter((r): r is string => r !== null);

    if (refs.length === 0) return `${finding.title} (split)`;
    return `${refs.join(" ")} — ${finding.title} (split)`;
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  async function handleCreate(): Promise<void> {
    setValidationError(null);

    if (!nameA.trim()) {
      setValidationError("Angle A needs a name.");
      return;
    }
    if (!nameB.trim()) {
      setValidationError("Angle B needs a name.");
      return;
    }

    setCreating(true);
    try {
      const narrativeA = buildNarrative("A");
      const narrativeB = buildNarrative("B");

      await createAngle(caseId, { title: nameA.trim(), narrative: narrativeA });
      await createAngle(caseId, { title: nameB.trim(), narrative: narrativeB });
      await updateAngle(caseId, finding.id, {
        status: "DISMISSED",
        investigator_note: `Split into: ${nameA.trim()} and ${nameB.trim()}`,
      });

      onCreated();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setValidationError(message);
    } finally {
      setCreating(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o && !creating) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content" aria-describedby="split-modal-desc">
          {/* Header */}
          <div className="dialog-header">
            <Dialog.Title className="dialog-title">Split angle</Dialog.Title>
            <button
              type="button"
              className="icon-btn"
              onClick={onClose}
              disabled={creating}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="dialog-body" id="split-modal-desc">
            <p className="angle-split-modal__instructions">
              Assign each document to Angle A, Angle B, or both. The parent angle will be marked
              exhausted.
            </p>

            {/* --- Document assignments --- */}
            {finding.document_links.length > 0 && (
              <section className="panel-section">
                <h3 className="panel-section__title">Document assignments</h3>
                <ul className="angle-split-modal__doc-list">
                  {finding.document_links.map((dl, idx) => {
                    const assignment = assignments[dl.document_id] ?? "A";
                    return (
                      <li key={dl.document_id} className="angle-split-modal__doc-row">
                        {/* Assignment pill group */}
                        <span className="angle-split-modal__assign-group" role="group" aria-label={`Assignment for ${docRef(idx)}`}>
                          {(["A", "B", "Both"] as DocAssignment[]).map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              className={`outcome-pill${assignment === opt ? " outcome-pill--selected" : ""}`}
                              onClick={() => cycleAssignment(dl.document_id)}
                              aria-pressed={assignment === opt}
                            >
                              {opt === "Both" ? "Both" : opt}
                            </button>
                          ))}
                        </span>

                        {/* Doc type badge */}
                        <span className={docTypeToBadgeClass(dl, documents)} aria-hidden="true">
                          {documents.find((d) => d.id === dl.document_id)?.doc_type ?? "OTHER"}
                        </span>

                        {/* Citation + filename */}
                        <span className="angle-split-modal__doc-ref">{docRef(idx)}</span>
                        <span className="angle-split-modal__doc-name">
                          {docLabel(dl, documents)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {/* --- Angle A --- */}
            <section className="panel-section">
              <h3 className="panel-section__title">Angle A</h3>

              <label className="angle-split-modal__field-label" htmlFor="angle-a-name">
                Name
              </label>
              <input
                id="angle-a-name"
                type="text"
                className="query-input angle-split-modal__name-input"
                value={nameA}
                onChange={(e) => setNameA(e.target.value)}
                placeholder="Angle A name…"
                disabled={creating}
              />

              {primaryEntityName && (
                <div className="angle-split-modal__connects-row">
                  <span className="angle-split-modal__connects-label">Connects:</span>
                  <span className="angle-split-modal__entity-chip">{primaryEntityName}</span>
                  <span className="angle-split-modal__arrow" aria-hidden="true">←→</span>
                  <KnotPicker
                    id="split-knot-a2-primary"
                    caseId={caseId}
                    state={knotA}
                    onChange={setKnotA}
                    placeholder="Search knots…"
                  />
                </div>
              )}

              {!primaryEntityName && (
                <div className="angle-split-modal__connects-row">
                  <span className="angle-split-modal__connects-label">Connects:</span>
                  <KnotPicker
                    id="split-knot-a1"
                    caseId={caseId}
                    state={knotA}
                    onChange={setKnotA}
                    placeholder="Knot 1…"
                  />
                  <span className="angle-split-modal__arrow" aria-hidden="true">←→</span>
                  <KnotPicker
                    id="split-knot-a2"
                    caseId={caseId}
                    state={knotA2}
                    onChange={setKnotA2}
                    placeholder="Knot 2…"
                  />
                </div>
              )}
            </section>

            {/* --- Angle B --- */}
            <section className="panel-section">
              <h3 className="panel-section__title">Angle B</h3>

              <label className="angle-split-modal__field-label" htmlFor="angle-b-name">
                Name
              </label>
              <input
                id="angle-b-name"
                type="text"
                className="query-input angle-split-modal__name-input"
                value={nameB}
                onChange={(e) => setNameB(e.target.value)}
                placeholder="Angle B name…"
                disabled={creating}
              />

              {primaryEntityName && (
                <div className="angle-split-modal__connects-row">
                  <span className="angle-split-modal__connects-label">Connects:</span>
                  <span className="angle-split-modal__entity-chip">{primaryEntityName}</span>
                  <span className="angle-split-modal__arrow" aria-hidden="true">←→</span>
                  <KnotPicker
                    id="split-knot-b2-primary"
                    caseId={caseId}
                    state={knotB2}
                    onChange={setKnotB2}
                    placeholder="Search knots…"
                  />
                </div>
              )}

              {!primaryEntityName && (
                <div className="angle-split-modal__connects-row">
                  <span className="angle-split-modal__connects-label">Connects:</span>
                  <KnotPicker
                    id="split-knot-b2"
                    caseId={caseId}
                    state={knotB2}
                    onChange={setKnotB2}
                    placeholder="Knot…"
                  />
                </div>
              )}
            </section>

            {/* Validation error */}
            {validationError && (
              <p className="angle-split-modal__error" role="alert">
                {validationError}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="dialog-footer">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={creating}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleCreate}
              disabled={creating}
            >
              {creating ? (
                <>
                  <Loader2 size={14} className="btn-spinner" aria-hidden="true" />
                  Creating…
                </>
              ) : (
                <>
                  <Plus size={14} aria-hidden="true" />
                  Create angles
                </>
              )}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
