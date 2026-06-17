import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus } from "lucide-react";
import { fetchAngles } from "../api";
import type { FindingItem } from "../types";

interface AnglePickerModalProps {
  caseId: string;
  open: boolean;
  onClose: () => void;
  /**
   * angleId === null means "create a new Angle from this".
   * Resolves true when the cite/create succeeded (picker closes), false when it
   * failed (picker stays open so the user can retry the same pending item).
   */
  onPick: (angleId: string | null) => Promise<boolean>;
}

export default function AnglePickerModal({ caseId, open, onClose, onPick }: AnglePickerModalProps) {
  const [angles, setAngles] = useState<FindingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Bump to re-run the load effect on demand (Retry).
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setLoadError(false);
    fetchAngles(caseId, { limit: 100 })
      .then((res) => setAngles(res.results))
      // A failed load must NOT look like an empty case — surface it as an error
      // with a retry, or the user may create a duplicate Angle thinking none exist.
      .catch(() => {
        setAngles([]);
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, [open, caseId, reloadNonce]);

  async function handlePick(id: string | null) {
    // Close only when the pick succeeded; a false result (failed cite/create)
    // keeps the picker open so the user can retry the pending item.
    const ok = await onPick(id);
    if (ok) onClose();
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
            {!loading && loadError && (
              <div className="angle-picker-empty angle-picker-error" role="alert">
                Couldn’t load angles.{" "}
                <button
                  type="button"
                  className="angle-picker-retry"
                  onClick={() => setReloadNonce((n) => n + 1)}
                >
                  Retry
                </button>
              </div>
            )}
            {!loading && !loadError && angles.length === 0 && (
              <div className="angle-picker-empty">No angles yet.</div>
            )}
            {!loadError &&
              angles.map((a) => (
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
