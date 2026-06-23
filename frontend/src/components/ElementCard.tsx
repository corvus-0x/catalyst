import { useEffect, useState } from "react";
import type { ThreadElement, ElementRole, ThreadElementTypeT } from "../types";

// ---------------------------------------------------------------------------
// Role label map — user-visible plain words (no model names)
// ---------------------------------------------------------------------------

const ROLE_LABEL: Record<ElementRole, string> = {
  fact: "Fact",
  analysis: "Analysis",
  claim: "Claim",
  question: "Question",
  note: "Note",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  element: ThreadElement;
  onEditText: (text: string) => void;
  onToggleHandoff: (next: boolean) => void;
  onAddCitation: () => void;
  onRemoveCitation: (citationId: string) => void;
  onChangeType: (type: ThreadElementTypeT) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

// ---------------------------------------------------------------------------
// ElementCard — one assertion / question / note card in the Thread Builder
//
// The derived `role` comes from the server (element.role); this component
// renders it directly and does NOT recompute it on the client.
// ---------------------------------------------------------------------------

export default function ElementCard({
  element: el,
  onEditText,
  onToggleHandoff,
  onAddCitation,
  onRemoveCitation,
  onChangeType,
  onDelete,
  onMoveUp,
  onMoveDown,
}: Props) {
  const [text, setText] = useState(el.text);
  // Re-sync local edit state when the parent replaces the element prop (ThreadBuilder
  // refreshes the whole thread after each mutation, reusing the same key={el.id} instance).
  // Without this, the textarea would show stale text and blur could re-fire onEditText
  // with the previous value after a reorder/refresh.
  useEffect(() => {
    setText(el.text);
  }, [el.text]);
  const isAssertion = el.element_type === "ASSERTION";

  return (
    <div className="element-card" data-role={el.role} data-type={el.element_type}>
      {/* ── Header row: role badge + type selector + reorder/delete ── */}
      <div className="element-card__head">
        <span className={`element-card__role-badge element-card__role-badge--${el.role}`}>
          {ROLE_LABEL[el.role]}
        </span>

        <select
          className="element-card__type-select"
          value={el.element_type}
          onChange={(e) => onChangeType(e.target.value as ThreadElementTypeT)}
          aria-label="Element type"
        >
          <option value="ASSERTION">Assertion</option>
          <option value="QUESTION">Question</option>
          <option value="NOTE">Note</option>
        </select>

        <div className="element-card__reorder">
          <button
            type="button"
            className="icon-btn"
            onClick={onMoveUp}
            aria-label="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onMoveDown}
            aria-label="Move down"
          >
            ↓
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onDelete}
            aria-label="Delete element"
          >
            ✕
          </button>
        </div>
      </div>

      {/* ── Inline text edit — saves on blur if changed ── */}
      <textarea
        className="element-card__text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== el.text) onEditText(text);
        }}
        aria-label="Element text"
        rows={3}
      />

      {/* ── Assertion-only: citations + handoff toggle ── */}
      {isAssertion && (
        <>
          <div className="element-card__citations">
            {el.citations.map((c) => (
              <span key={c.id} className="element-card__chip">
                <span className="element-card__chip-label">
                  {c.document_filename}
                  {c.page_reference ? ` · ${c.page_reference}` : ""}
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Remove citation"
                  onClick={() => onRemoveCitation(c.id)}
                >
                  ✕
                </button>
              </span>
            ))}
            <button
              type="button"
              className="element-card__add-cite"
              onClick={onAddCitation}
            >
              + Cite source
            </button>
          </div>

          <button
            type="button"
            className={`element-card__handoff${el.handoff_ready ? " element-card__handoff--active" : ""}`}
            aria-pressed={el.handoff_ready}
            aria-label={el.handoff_ready ? "Handoff claim (on)" : "Mark as handoff claim"}
            disabled={text.trim() === ""}
            onClick={() => onToggleHandoff(!el.handoff_ready)}
          >
            {el.handoff_ready ? "Handoff claim ✓" : "Mark as handoff claim"}
          </button>
        </>
      )}
    </div>
  );
}
