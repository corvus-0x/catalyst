/**
 * LeadSuggestionsPanel.tsx — Phase 4D assist-only assertion proposals.
 *
 * "Lead" vocabulary (CLAUDE.md): AI output is a Lead, never labeled with a
 * model name. This panel requests suggestions for one thread, polls the async
 * job, and renders each proposal with Accept / Dismiss.
 *
 * Accepting is the ONLY path that persists anything: it calls the normal
 * createElement + addCitation endpoints, so every accepted assertion goes
 * through the same server-side validation as a hand-typed one. Dismissing is
 * purely local. Nothing in this panel can set handoff_ready or affect the
 * referral-grade gate.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Sparkles, Check, X, FileText } from "lucide-react";
import { addCitation, createElement, requestThreadAssist } from "../api";
import { useAsyncJob } from "../hooks/useAsyncJob";
import type { ThreadAssistJobResult, ThreadAssistProposal } from "../types";

interface LeadSuggestionsPanelProps {
  caseId: string;
  findingId: string;
  /** Tie-off state — suggestions are pointless on a tied-off thread. */
  disabled: boolean;
  /** Parent refresh after an accepted proposal lands as a real element. */
  onAccepted: () => Promise<void> | void;
}

export default function LeadSuggestionsPanel({
  caseId,
  findingId,
  disabled,
  onAccepted,
}: LeadSuggestionsPanelProps) {
  const job = useAsyncJob<ThreadAssistJobResult>();
  // Proposals the user has acted on (accepted or dismissed), by index.
  const [handled, setHandled] = useState<Set<number>>(new Set());
  const [acceptingIdx, setAcceptingIdx] = useState<number | null>(null);

  const running = job.status === "QUEUED" || job.status === "RUNNING";
  const proposals = job.result?.proposals ?? [];
  const pending = proposals.filter((_, i) => !handled.has(i));

  async function handleSuggest() {
    setHandled(new Set());
    await job.run(() => requestThreadAssist(caseId, findingId));
  }

  async function handleAccept(p: ThreadAssistProposal, idx: number) {
    if (acceptingIdx !== null) return;
    setAcceptingIdx(idx);
    try {
      const element = await createElement(caseId, findingId, {
        element_type: "ASSERTION",
        text: p.text,
      });
      // Citations are best-effort AFTER the assertion exists: a failed
      // citation leaves a valid uncited assertion (analysis role), which the
      // investigator can cite manually — never a lost assertion.
      let citeFailures = 0;
      for (const doc of p.documents) {
        try {
          await addCitation(caseId, findingId, element.id, {
            document_id: doc.document_id,
            page_reference: "",
            context_note: "",
          });
        } catch {
          citeFailures += 1;
        }
      }
      if (citeFailures > 0) {
        toast.error(
          `Assertion added, but ${citeFailures} suggested citation${
            citeFailures === 1 ? "" : "s"
          } could not be attached. Cite manually.`,
        );
      }
      setHandled((prev) => new Set(prev).add(idx));
      await onAccepted();
    } catch {
      toast.error("Could not add the suggested assertion.");
    } finally {
      setAcceptingIdx(null);
    }
  }

  function handleDismiss(idx: number) {
    setHandled((prev) => new Set(prev).add(idx));
  }

  return (
    <div className="lead-suggestions panel-section">
      <div className="lead-suggestions__header">
        <p className="panel-section__title">LEAD SUGGESTIONS</p>
        <button
          type="button"
          className="toolbar-btn"
          disabled={disabled || running}
          title={
            disabled
              ? "This thread is tied off."
              : "Propose assertions from this thread's notes and narrative. You confirm every one."
          }
          onClick={() => void handleSuggest()}
        >
          <Sparkles size={12} aria-hidden="true" />
          {running ? "Working…" : "Suggest assertions"}
        </button>
      </div>

      {job.status === "FAILED" && (
        <p className="lead-suggestions__error" role="alert">
          {job.error ?? "Suggestion run failed."}
        </p>
      )}

      {job.status === "SUCCESS" && proposals.length === 0 && (
        <p className="lead-suggestions__empty">
          No suggestions — the thread's notes had nothing new to structure.
        </p>
      )}

      {job.status === "SUCCESS" && proposals.length > 0 && pending.length === 0 && (
        <p className="lead-suggestions__empty">All suggestions handled.</p>
      )}

      {proposals.map((p, idx) =>
        handled.has(idx) ? null : (
          <div key={idx} className="lead-suggestion-card">
            <p className="lead-suggestion-card__text">{p.text}</p>
            {p.basis && (
              <p className="lead-suggestion-card__basis">From your notes: “{p.basis}”</p>
            )}
            {p.documents.length > 0 && (
              <div className="lead-suggestion-card__docs">
                {p.documents.map((d) => (
                  <span key={d.document_id} className="lead-suggestion-card__doc">
                    <FileText size={11} aria-hidden="true" />
                    {d.filename}
                  </span>
                ))}
              </div>
            )}
            <div className="lead-suggestion-card__actions">
              <button
                type="button"
                className="toolbar-btn"
                disabled={acceptingIdx !== null}
                onClick={() => void handleAccept(p, idx)}
              >
                <Check size={12} aria-hidden="true" />
                {acceptingIdx === idx ? "Adding…" : "Accept"}
              </button>
              <button
                type="button"
                className="toolbar-btn"
                disabled={acceptingIdx !== null}
                onClick={() => handleDismiss(idx)}
              >
                <X size={12} aria-hidden="true" />
                Dismiss
              </button>
            </div>
          </div>
        ),
      )}
    </div>
  );
}
