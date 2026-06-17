import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { createAngle, fetchAngle, updateAngle } from "../api";
import { useCaseWorkspace } from "../context/CaseWorkspaceContext";

export interface CiteItem {
  /** Human-readable label for the narrative annotation and as a new-angle title. */
  label: string;
  /** When present, a real FindingDocument citation is created via add_document_ids. */
  documentId?: string;
}

export interface FeederActions {
  startAngleFrom: (seed: { title: string; item?: CiteItem }) => Promise<{ id: string; title: string } | null>;
  citeToAngle: (item: CiteItem) => Promise<void>;
  pickerOpen: boolean;
  closePicker: () => void;
  onPickerPick: (angleId: string | null) => Promise<boolean>;
}

// Backend FindingIntakeSerializer requires a valid severity on create (no default).
const DEFAULT_SEVERITY = "MEDIUM" as const;

export function useFeederActions(caseId: string): FeederActions {
  const { activeAngleId, setActiveAngle } = useCaseWorkspace();
  const [pickerOpen, setPickerOpen] = useState(false);
  const pendingItem = useRef<CiteItem | null>(null);

  // Cite into an existing angle. A documentId produces a real FindingDocument
  // row (chain-of-custody); otherwise we only annotate the narrative.
  const applyCite = useCallback(
    async (angleId: string, item: CiteItem) => {
      const angle = await fetchAngle(caseId, angleId);
      if (item.documentId) {
        // Atomic server-side link only — do NOT rewrite the narrative (review
        // #3: avoids clobbering a concurrent narrative edit). The FindingDocument
        // row is the chain-of-custody record; the [Doc-N] text is cosmetic.
        // Backend get_or_create is idempotent; tell the user which actually happened.
        const already = (angle.document_links ?? []).some(
          (l) => l.document_id === item.documentId
        );
        await updateAngle(caseId, angleId, { add_document_ids: [item.documentId] });
        toast(already ? `Already cited in "${angle.title}".` : `Cited document into "${angle.title}".`);
      } else {
        // Narrative-only annotation (event with no document id). Client
        // read-modify-write: known last-write-wins race (see limitations).
        const narrative = `${angle.narrative ?? ""}\n\n[Cited: ${item.label}]`.trim();
        await updateAngle(caseId, angleId, { narrative });
        toast(`Cited into "${angle.title}".`);
      }
      setActiveAngle({ id: angle.id, title: angle.title });
    },
    [caseId, setActiveAngle]
  );

  const startAngleFrom = useCallback<FeederActions["startAngleFrom"]>(
    async (seed) => {
      let angle: { id: string; title: string };
      try {
        angle = await createAngle(caseId, {
          title: seed.title,
          severity: DEFAULT_SEVERITY,
        });
      } catch {
        toast.error("Failed to start angle.");
        return null;
      }
      // The Angle now exists. Make it the active target IMMEDIATELY so a failed
      // follow-on citation can never lead to a duplicate Angle on retry (review
      // round 3, #2) — the retry cites into this active Angle, not a new one.
      setActiveAngle({ id: angle.id, title: angle.title });
      if (seed.item) {
        try {
          await applyCite(angle.id, seed.item);
        } catch {
          toast.error(`Angle "${angle.title}" created, but the citation failed — retry the cite.`);
        }
      } else {
        toast(`Started angle "${angle.title}".`);
      }
      return { id: angle.id, title: angle.title };
    },
    [caseId, setActiveAngle, applyCite]
  );

  const citeToAngle = useCallback<FeederActions["citeToAngle"]>(
    async (item) => {
      if (activeAngleId) {
        try {
          await applyCite(activeAngleId, item);
        } catch {
          toast.error("Failed to cite into angle.");
        }
        return;
      }
      pendingItem.current = item;
      setPickerOpen(true);
    },
    [activeAngleId, applyCite]
  );

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    pendingItem.current = null;
  }, []);

  const onPickerPick = useCallback<FeederActions["onPickerPick"]>(
    async (angleId) => {
      const item = pendingItem.current;
      if (!item) return true;
      // Do NOT close the picker or clear pendingItem here. The modal closes via
      // onClose (= closePicker) only on a non-false result, so a failure leaves
      // the picker open with the pending item intact for retry (review #4).
      try {
        if (angleId === null) {
          const created = await startAngleFrom({ title: item.label, item });
          return created !== null;
        }
        await applyCite(angleId, item);
        return true;
      } catch {
        toast.error("Failed to cite into angle.");
        return false;
      }
    },
    [startAngleFrom, applyCite]
  );

  return { startAngleFrom, citeToAngle, pickerOpen, closePicker, onPickerPick };
}
