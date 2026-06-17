import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus } from "lucide-react";
import { fetchAngles } from "../api";
import type { FindingItem } from "../types";

interface AnglePickerModalProps {
  caseId: string;
  open: boolean;
  onClose: () => void;
  /** angleId === null means "create a new Angle from this". May be async. */
  onPick: (angleId: string | null) => boolean | void | Promise<boolean | void>;
}

export default function AnglePickerModal({ caseId, open, onClose, onPick }: AnglePickerModalProps) {
  const [angles, setAngles] = useState<FindingItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchAngles(caseId, { limit: 100 })
      .then((res) => setAngles(res.results))
      .catch(() => setAngles([]))
      .finally(() => setLoading(false));
  }, [open, caseId]);

  async function handlePick(id: string | null) {
    // Close only when the pick succeeded. A false result means the cite/create
    // failed (review #4) — keep the picker open so the user can retry.
    const ok = await onPick(id);
    if (ok !== false) onClose();
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Title className="dialog-title">Cite into an angle</Dialog.Title>
          <Dialog.Description className="dialog-description">
            Choose an angle to cite this into, or start a new one.
          </Dialog.Description>
          <div className="angle-picker-list">
            <button
              type="button"
              className="angle-picker-item angle-picker-item--new"
              onClick={() => void handlePick(null)}
            >
              <Plus size={13} /> + New Angle from this
            </button>
            {loading && <div className="angle-picker-empty">Loading angles…</div>}
            {!loading && angles.length === 0 && (
              <div className="angle-picker-empty">No angles yet.</div>
            )}
            {angles.map((a) => (
              <button
                key={a.id}
                type="button"
                className="angle-picker-item"
                onClick={() => void handlePick(a.id)}
              >
                {a.title}
              </button>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
