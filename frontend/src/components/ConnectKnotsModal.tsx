/**
 * ConnectKnotsModal — Step 14 (frontend-design-spec.md §8.2)
 *
 * Create a new Angle (Finding) by connecting two Knots.
 * Opened from:
 *   - Web toolbar "+ Angle" button
 *   - Profile view "+ New angle" button (pre-fills Knot A)
 *   - "Connect" tab within the AngleSplitModal
 *
 * Vocabulary:
 *   Angle  = Finding (backend model, frontend narrative unit)
 *   Knot   = Person or Organization node only (NOT Property)
 *   Lead   = AI-generated suggestion (never display "AI", "Claude", "Sonnet", "LLM")
 */

import { useState, useEffect, useRef, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Check, Search, Loader2, Lock } from "lucide-react";
import { createAngle, fetchEntities, aiAsk } from "../api";
import type { FindingItem, EntityBrowserItem } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectKnotsModalProps {
  open: boolean;
  caseId: string;
  /** Pre-fill Knot A when opened from the Profile view. */
  prefillEntityId?: string;
  prefillEntityName?: string;
  onClose: () => void;
  onCreated: (newAngle: FindingItem) => void;
}

interface KnotSelection {
  id: string;
  name: string;
  entity_type: "person" | "organization";
}

interface KnotPickerState {
  query: string;
  results: EntityBrowserItem[];
  loading: boolean;
  dropdownOpen: boolean;
  selected: KnotSelection | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyPicker(): KnotPickerState {
  return { query: "", results: [], loading: false, dropdownOpen: false, selected: null };
}

// ---------------------------------------------------------------------------
// KnotPicker — reusable knot search input with dropdown
// ---------------------------------------------------------------------------

interface KnotPickerProps {
  id: string;
  caseId: string;
  state: KnotPickerState;
  onChange: (next: KnotPickerState | ((prev: KnotPickerState) => KnotPickerState)) => void;
  placeholder: string;
  locked?: boolean;
  lockLabel?: string;
  disabled?: boolean;
}

function KnotPicker({
  id,
  caseId,
  state,
  onChange,
  placeholder,
  locked,
  lockLabel,
  disabled,
}: KnotPickerProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        onChange((prev) => ({ ...prev, results: [], dropdownOpen: false, loading: false }));
        return;
      }
      onChange((prev) => ({ ...prev, loading: true }));
      try {
        const res = await fetchEntities({ case_id: caseId, q, limit: 8 });
        const knots = res.results.filter(
          (e) => e.entity_type === "person" || e.entity_type === "organization"
        );
        onChange((prev) => ({
          ...prev,
          results: knots,
          loading: false,
          dropdownOpen: knots.length > 0,
        }));
      } catch {
        onChange((prev) => ({ ...prev, results: [], loading: false, dropdownOpen: false }));
      }
    },
    [caseId, onChange]
  );

  function handleChange(value: string): void {
    onChange((prev) => ({ ...prev, query: value, selected: null }));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  }

  function handleFocus(): void {
    if (state.results.length > 0) {
      onChange((prev) => ({ ...prev, dropdownOpen: true }));
    }
  }

  function handleBlur(): void {
    setTimeout(() => onChange((prev) => ({ ...prev, dropdownOpen: false })), 150);
  }

  function selectResult(entity: EntityBrowserItem): void {
    if (entity.entity_type !== "person" && entity.entity_type !== "organization") return;
    onChange({
      query: entity.name,
      results: [],
      loading: false,
      dropdownOpen: false,
      selected: { id: entity.id, name: entity.name, entity_type: entity.entity_type },
    });
  }

  // Locked knot (pre-filled from Profile view)
  if (locked && lockLabel) {
    return (
      <div className="knot-picker knot-picker--locked" id={id}>
        <Lock size={12} className="knot-picker__lock-icon" aria-hidden="true" />
        <span className="knot-picker__lock-label">{lockLabel}</span>
      </div>
    );
  }

  const displayValue = state.selected ? state.selected.name : state.query;

  return (
    <div className="knot-picker" id={id}>
      <div className="knot-picker__input-wrap">
        <Search size={14} className="knot-picker__icon" aria-hidden="true" />
        <input
          type="text"
          className="query-input knot-picker__input"
          placeholder={placeholder}
          value={displayValue}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          disabled={disabled}
          autoComplete="off"
          aria-label={placeholder}
          aria-autocomplete="list"
          aria-expanded={state.dropdownOpen ? "true" : "false"}
          aria-controls={`${id}-listbox`}
        />
        {state.loading && (
          <Loader2 size={14} className="knot-picker__spinner" aria-label="Searching…" />
        )}
        {!state.loading && state.selected && (
          <Check size={14} className="knot-picker__check" aria-hidden="true" />
        )}
      </div>

      {state.dropdownOpen && state.results.length > 0 && (
        <ul
          className="knot-picker__dropdown"
          role="listbox"
          id={`${id}-listbox`}
          aria-label="Matching knots"
        >
          {state.results.map((entity) => (
            <li
              key={entity.id}
              role="option"
              aria-selected={state.selected?.id === entity.id ? "true" : "false"}
              className="knot-picker__option"
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent blur before click registers
                selectResult(entity);
              }}
            >
              <span className="knot-picker__name">{entity.name}</span>
              <span
                className={`knot-picker__type knot-picker__type--${entity.entity_type}`}
              >
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

export default function ConnectKnotsModal({
  open,
  caseId,
  prefillEntityId,
  prefillEntityName,
  onClose,
  onCreated,
}: ConnectKnotsModalProps) {
  const isPrefilled = Boolean(prefillEntityId && prefillEntityName);

  // Knot A — locked when pre-filled from Profile
  const [knotA, setKnotA] = useState<KnotPickerState>(emptyPicker);
  // Knot B — always searchable
  const [knotB, setKnotB] = useState<KnotPickerState>(emptyPicker);

  // Angle name
  const [angleName, setAngleName] = useState("");
  const [nameSuggesting, setNameSuggesting] = useState(false);

  // Async state
  const [creating, setCreating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Suggestion fetch guard — cancel stale suggestions
  const suggestAbortRef = useRef<AbortController | null>(null);

  // ---------------------------------------------------------------------------
  // Reset when modal opens/closes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (open) {
      setKnotA(emptyPicker());
      setKnotB(emptyPicker());
      setAngleName("");
      setValidationError(null);
      setCreating(false);
      setNameSuggesting(false);
    }
  }, [open]);

  // ---------------------------------------------------------------------------
  // Derive resolved Knot A identity
  // ---------------------------------------------------------------------------

  const resolvedKnotAId = isPrefilled ? prefillEntityId! : knotA.selected?.id ?? null;
  const resolvedKnotAName = isPrefilled ? prefillEntityName! : knotA.selected?.name ?? null;
  const resolvedKnotBId = knotB.selected?.id ?? null;
  const resolvedKnotBName = knotB.selected?.name ?? null;

  // ---------------------------------------------------------------------------
  // Lead name suggestion — fires when both knots are selected
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!resolvedKnotAId || !resolvedKnotAName || !resolvedKnotBId || !resolvedKnotBName) return;

    // Abort any in-flight suggestion
    if (suggestAbortRef.current) suggestAbortRef.current.abort();
    const controller = new AbortController();
    suggestAbortRef.current = controller;

    setNameSuggesting(true);

    const prompt =
      `Suggest a 5-7 word investigative angle name connecting "${resolvedKnotAName}" and ` +
      `"${resolvedKnotBName}". Return ONLY the name, no explanation.`;

    aiAsk(caseId, prompt, controller.signal)
      .then(({ answer }) => {
        if (!controller.signal.aborted) {
          setAngleName(answer.trim());
          setNameSuggesting(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setNameSuggesting(false);
        }
      });

    return () => controller.abort();
  }, [resolvedKnotAId, resolvedKnotAName, resolvedKnotBId, resolvedKnotBName, caseId]);

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  async function handleCreate(): Promise<void> {
    setValidationError(null);

    if (!resolvedKnotAId) {
      setValidationError("Select Knot A to continue.");
      return;
    }
    if (!resolvedKnotBId) {
      setValidationError("Select Knot B to continue.");
      return;
    }
    if (!angleName.trim()) {
      setValidationError("Give this angle a name.");
      return;
    }

    setCreating(true);
    try {
      const newAngle = await createAngle(caseId, { title: angleName.trim() });
      onCreated(newAngle);
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

  const bothSelected = Boolean(resolvedKnotAId && resolvedKnotBId);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o && !creating) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog-content connect-knots-modal"
          aria-describedby="connect-knots-desc"
        >
          {/* Header */}
          <div className="dialog-header">
            <Dialog.Title className="dialog-title">
              Connect two knots with a new angle
            </Dialog.Title>
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
          <div className="dialog-body" id="connect-knots-desc">
            {/* Knot pickers row */}
            <div className="connect-knots-modal__pickers">
              {/* Knot A */}
              <div className="connect-knots-modal__picker-col">
                <label
                  className="connect-knots-modal__picker-label"
                  htmlFor="knot-picker-a"
                >
                  Knot A
                </label>
                {isPrefilled ? (
                  <KnotPicker
                    id="knot-picker-a"
                    caseId={caseId}
                    state={knotA}
                    onChange={setKnotA}
                    placeholder="Search or name…"
                    locked
                    lockLabel={prefillEntityName}
                    disabled={creating}
                  />
                ) : (
                  <KnotPicker
                    id="knot-picker-a"
                    caseId={caseId}
                    state={knotA}
                    onChange={setKnotA}
                    placeholder="Search or name…"
                    disabled={creating}
                  />
                )}
              </div>

              {/* Divider arrow */}
              <span className="connect-knots-modal__arrow" aria-hidden="true">←→</span>

              {/* Knot B */}
              <div className="connect-knots-modal__picker-col">
                <label
                  className="connect-knots-modal__picker-label"
                  htmlFor="knot-picker-b"
                >
                  Knot B
                </label>
                <KnotPicker
                  id="knot-picker-b"
                  caseId={caseId}
                  state={knotB}
                  onChange={setKnotB}
                  placeholder="Search or name…"
                  disabled={creating}
                />
              </div>
            </div>

            {/* Angle name */}
            <div className="connect-knots-modal__name-field">
              <label
                className="connect-knots-modal__name-label"
                htmlFor="connect-angle-name"
              >
                Angle name
              </label>
              <div className="connect-knots-modal__name-input-wrap">
                <input
                  id="connect-angle-name"
                  type="text"
                  className="query-input connect-knots-modal__name-input"
                  value={angleName}
                  onChange={(e) => setAngleName(e.target.value)}
                  placeholder={
                    nameSuggesting
                      ? "Lead is suggesting a name…"
                      : bothSelected
                      ? "Type a name or wait for suggestion…"
                      : "Select both knots first…"
                  }
                  disabled={creating || nameSuggesting}
                  aria-busy={nameSuggesting ? "true" : "false"}
                />
                {nameSuggesting && (
                  <Loader2
                    size={14}
                    className="connect-knots-modal__name-spinner"
                    aria-label="Lead is suggesting a name…"
                  />
                )}
              </div>
              {nameSuggesting && (
                <p className="connect-knots-modal__suggest-hint" aria-live="polite">
                  Lead is suggesting a name…
                </p>
              )}
            </div>

            {/* Validation error */}
            {validationError && (
              <p className="connect-knots-modal__error" role="alert">
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
              disabled={creating || nameSuggesting}
            >
              {creating ? (
                <>
                  <Loader2 size={14} className="btn-spinner" aria-hidden="true" />
                  Creating…
                </>
              ) : (
                "Create angle"
              )}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
