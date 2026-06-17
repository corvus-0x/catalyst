/**
 * ReferralsTab.tsx — Referral agency tracking + PDF generation.
 *
 * Shows a list of referral targets (agencies), an add/edit modal,
 * a soft-warning checklist (confirmed angles without cited docs),
 * and the "Generate Referral Package (PDF)" button.
 *
 * Vocabulary (CLAUDE.md):
 *   Angle = Finding (the investigative narrative unit)
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FileDown,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  getReferralTargets,
  createReferralTarget,
  updateReferralTarget,
  deleteReferralTarget,
  fetchReferralReadiness,
  generateReferralPdf,
} from "../api";
import type {
  ReferralTarget,
  ReferralStatus,
  ReferralReadinessItem,
  ReferralReadinessResponse,
  CreateReferralTargetParams,
  UpdateReferralTargetParams,
} from "../types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ReferralsTabProps {
  caseId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<ReferralStatus, string> = {
  DRAFT:        "Draft",
  SENT:         "Sent",
  ACKNOWLEDGED: "Acknowledged",
  CLOSED:       "Closed",
};

const STATUS_CLASS: Record<ReferralStatus, string> = {
  DRAFT:        "ref-badge ref-badge--draft",
  SENT:         "ref-badge ref-badge--sent",
  ACKNOWLEDGED: "ref-badge ref-badge--ack",
  CLOSED:       "ref-badge ref-badge--closed",
};

// ---------------------------------------------------------------------------
// ReferralTargetModal — add / edit form
// ---------------------------------------------------------------------------

interface ModalProps {
  caseId: string;
  target: ReferralTarget | null;  // null = add mode
  onSaved: (t: ReferralTarget, wasEdit: boolean) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}

function ReferralTargetModal({ caseId, target, onSaved, onDeleted, onClose }: ModalProps) {
  const isEdit = target !== null;
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState<CreateReferralTargetParams>({
    agency_name:      target?.agency_name ?? "",
    complaint_type:   target?.complaint_type ?? "",
    reference_number: target?.reference_number ?? "",
    contact:          target?.contact ?? "",
    status:           target?.status ?? "DRAFT",
    notes:            target?.notes ?? "",
  });

  function set<K extends keyof CreateReferralTargetParams>(
    key: K,
    value: CreateReferralTargetParams[K]
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.agency_name?.trim()) return;
    setSaving(true);
    try {
      let saved: ReferralTarget;
      if (isEdit) {
        saved = await updateReferralTarget(caseId, target.id, form as UpdateReferralTargetParams);
      } else {
        saved = await createReferralTarget(caseId, form as CreateReferralTargetParams);
      }
      onSaved(saved, isEdit);
      onClose();
    } catch {
      toast.error(isEdit ? "Failed to update agency." : "Failed to add agency.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!isEdit) return;
    if (!window.confirm(`Remove ${target.agency_name} from this case?`)) return;
    setDeleting(true);
    try {
      await deleteReferralTarget(caseId, target.id);
      onDeleted(target.id);
      onClose();
    } catch {
      toast.error("Failed to remove agency.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="ref-modal-backdrop" onClick={onClose}>
      <div className="ref-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="ref-modal__title">
          {isEdit ? "Edit agency" : "Add referral agency"}
        </h3>
        <form onSubmit={handleSubmit} className="ref-modal__form">
          <div className="ref-form-row">
            <label className="ref-form-label">Agency name *</label>
            <input
              type="text"
              className="ref-form-input"
              required
              placeholder="e.g. Ohio AG — Charitable Law Section"
              value={form.agency_name ?? ""}
              onChange={(e) => set("agency_name", e.target.value)}
            />
          </div>
          <div className="ref-form-row">
            <label className="ref-form-label">Complaint type</label>
            <input
              type="text"
              className="ref-form-input"
              placeholder="e.g. Charitable fraud, Tax-exempt complaint"
              value={form.complaint_type ?? ""}
              onChange={(e) => set("complaint_type", e.target.value)}
            />
          </div>
          <div className="ref-form-row ref-form-row--inline">
            <div>
              <label className="ref-form-label">Reference #</label>
              <input
                type="text"
                className="ref-form-input"
                placeholder="Agency reference or complaint #"
                value={form.reference_number ?? ""}
                onChange={(e) => set("reference_number", e.target.value)}
              />
            </div>
            <div>
              <label className="ref-form-label">Status</label>
              <select
                className="ref-form-select"
                value={form.status ?? "DRAFT"}
                onChange={(e) => set("status", e.target.value as ReferralStatus)}
              >
                {(["DRAFT", "SENT", "ACKNOWLEDGED", "CLOSED"] as ReferralStatus[]).map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="ref-form-row">
            <label className="ref-form-label">Contact</label>
            <input
              type="text"
              className="ref-form-input"
              placeholder="Contact name or unit"
              value={form.contact ?? ""}
              onChange={(e) => set("contact", e.target.value)}
            />
          </div>
          <div className="ref-form-row">
            <label className="ref-form-label">Notes</label>
            <textarea
              className="ref-form-textarea"
              rows={3}
              placeholder="Internal notes about this referral…"
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>

          <div className="ref-modal__actions">
            {isEdit && (
              <button
                type="button"
                className="btn-danger"
                onClick={handleDelete}
                disabled={deleting}
                style={{ marginRight: "auto" }}
              >
                {deleting ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
                {deleting ? "Removing…" : "Remove"}
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <><Loader2 size={13} className="spin" /> Saving…</> : (isEdit ? "Save changes" : "Add agency")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReadinessPanel
// ---------------------------------------------------------------------------

const READINESS_LABEL: Record<ReferralReadinessResponse["status"], string> = {
  READY: "Ready",
  NEEDS_REVIEW: "Needs review",
  BLOCKED: "Blocked",
};

function readinessIcon(item: ReferralReadinessItem) {
  if (item.status === "PASS") return <CheckCircle2 size={14} />;
  if (item.status === "WARN") return <AlertTriangle size={14} />;
  return <AlertCircle size={14} />;
}

function ReadinessPanel({ readiness }: { readiness: ReferralReadinessResponse }) {
  return (
    <div className={`ref-readiness ref-readiness--${readiness.status.toLowerCase()}`}>
      <div className="ref-readiness__summary">
        <div>
          <p className="ref-readiness__eyebrow">Referral readiness</p>
          <h3 className="ref-readiness__status">
            {READINESS_LABEL[readiness.status]}
          </h3>
        </div>
        <p className="ref-readiness__text">{readiness.summary}</p>
      </div>
      <div className="ref-readiness__items">
        {readiness.items.map((item) => (
          <div
            key={item.key}
            className={`ref-readiness-item ref-readiness-item--${item.status.toLowerCase()}`}
          >
            {readinessIcon(item)}
            <div>
              <p className="ref-readiness-item__label">{item.label}</p>
              <p className="ref-readiness-item__summary">{item.summary}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ReferralsTab({ caseId }: ReferralsTabProps) {
  const [targets, setTargets]                 = useState<ReferralTarget[]>([]);
  const [readiness, setReadiness]             = useState<ReferralReadinessResponse | null>(null);
  const [loading, setLoading]                 = useState(true);
  const [showModal, setShowModal]             = useState(false);
  const [editTarget, setEditTarget]           = useState<ReferralTarget | null>(null);
  const [pdfLoading, setPdfLoading]           = useState(false);
  const [pdfError, setPdfError]               = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getReferralTargets(caseId),
      fetchReferralReadiness(caseId),
    ])
      .then(([targetsRes, readinessRes]) => {
        setTargets(targetsRes.results);
        setReadiness(readinessRes);
      })
      .catch(() => toast.error("Failed to load referrals data."))
      .finally(() => setLoading(false));
  }, [caseId]);

  async function refreshReadiness() {
    try {
      const next = await fetchReferralReadiness(caseId);
      setReadiness(next);
    } catch {
      toast.error("Failed to refresh referral readiness.");
    }
  }

  function handleSaved(saved: ReferralTarget, wasEdit: boolean) {
    setTargets((prev) => {
      const idx = prev.findIndex((t) => t.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
    toast.success(wasEdit ? "Agency updated." : "Agency added.");
    void refreshReadiness();
  }

  function handleDeleted(id: string) {
    setTargets((prev) => prev.filter((t) => t.id !== id));
    toast.success("Agency removed.");
    void refreshReadiness();
  }

  async function handleGeneratePdf() {
    setPdfLoading(true);
    setPdfError(null);
    try {
      const blob = await generateReferralPdf(caseId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `catalyst-referral-${caseId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : "PDF generation failed.");
    } finally {
      setPdfLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="ref-tab ref-tab--loading">
        <Loader2 size={20} className="spin" />
        <span>Loading referrals…</span>
      </div>
    );
  }

  return (
    <div className="ref-tab">
      {/* Header */}
      <div className="ref-tab__header">
        <div>
          <h2 className="ref-tab__title">Referrals</h2>
          <p className="ref-tab__sub">
            {targets.length} agenc{targets.length !== 1 ? "ies" : "y"}
            {targets.filter((t) => t.status === "ACKNOWLEDGED").length > 0 &&
              ` · ${targets.filter((t) => t.status === "ACKNOWLEDGED").length} acknowledged`}
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => { setEditTarget(null); setShowModal(true); }}
        >
          <Plus size={14} /> Add agency
        </button>
      </div>

      {/* Checklist strip */}
      {readiness && <ReadinessPanel readiness={readiness} />}

      {/* Agency table */}
      {targets.length === 0 ? (
        <div className="empty-state" style={{ flex: 1 }}>
          <p className="empty-state__title">No referral agencies yet.</p>
          <p className="empty-state__body">
            Add the agencies you have submitted or plan to submit this case to.
          </p>
        </div>
      ) : (
        <div className="ref-table-wrap">
          <table className="ref-table">
            <thead>
              <tr>
                <th>Agency</th>
                <th>Type</th>
                <th>Ref #</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => (
                <tr key={t.id}>
                  <td className="ref-table__agency">{t.agency_name}</td>
                  <td className="ref-table__type">{t.complaint_type || "—"}</td>
                  <td className="ref-table__ref">
                    {t.reference_number ? (
                      <span style={{ fontFamily: "monospace", fontSize: 11 }}>
                        {t.reference_number}
                      </span>
                    ) : "—"}
                  </td>
                  <td>
                    <span className={STATUS_CLASS[t.status]}>
                      {STATUS_LABEL[t.status]}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ref-edit-btn"
                      onClick={() => { setEditTarget(t); setShowModal(true); }}
                      aria-label={`Edit ${t.agency_name}`}
                    >
                      <Pencil size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* PDF section */}
      <div className="ref-pdf-section">
        <button
          type="button"
          className="btn-secondary ref-pdf-btn"
          onClick={handleGeneratePdf}
          disabled={pdfLoading || readiness?.status === "BLOCKED"}
        >
          {pdfLoading ? (
            <><Loader2 size={14} className="spin" /> Generating…</>
          ) : (
            <><FileDown size={14} /> Generate Referral Package (PDF)</>
          )}
        </button>
        {readiness?.status === "BLOCKED" && !pdfLoading && (
          <p className="ref-pdf-warn">
            <AlertTriangle size={12} />
            Resolve readiness blockers before generating the referral package.
          </p>
        )}
        {readiness?.status === "NEEDS_REVIEW" && !pdfLoading && (
          <p className="ref-pdf-warn">
            <AlertTriangle size={12} />
            Review the checklist before export; the package can still be generated.
          </p>
        )}
        {pdfError && (
          <p className="ref-pdf-error">{pdfError}</p>
        )}
        <p className="ref-pdf-note">
          Deterministic PDF — every finding traces to a cited document. No generated text.
        </p>
      </div>

      {/* Modal */}
      {showModal && (
        <ReferralTargetModal
          caseId={caseId}
          target={editTarget}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onClose={() => { setShowModal(false); setEditTarget(null); }}
        />
      )}
    </div>
  );
}
