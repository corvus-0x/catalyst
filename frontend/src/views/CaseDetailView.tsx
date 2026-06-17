import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import * as Tabs from "@radix-ui/react-tabs";
import { toast } from "sonner";
import { fetchCase, updateCase } from "../api";
import { useFeederActions } from "../hooks/useFeederActions";
import AnglePickerModal from "../components/AnglePickerModal";
import type { CaseDetailResponse, TimelineEvent } from "../types";
import InvestigateTab from "./InvestigateTab";
import DocumentDrawer from "../components/DocumentDrawer";
import { CaseWorkspaceProvider, useCaseWorkspace } from "../context/CaseWorkspaceContext";

/* ─── Lazy-load heavy tabs ────────────────────────────────────────────────── */
const ResearchTab      = lazy(() => import("./ResearchTab"));
const FinancialsTab    = lazy(() => import("./FinancialsTab"));
const TimelineTab      = lazy(() => import("./TimelineTab"));
const ReferralsTab     = lazy(() => import("./ReferralsTab"));
const InvestigationTab = lazy(() => import("./InvestigationTab"));

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

const CASE_STATUSES = ["ACTIVE", "PAUSED", "REFERRED", "CLOSED"] as const;
type CaseStatus = typeof CASE_STATUSES[number];

interface StatusSelectorProps {
  caseId: string;
  status: string;
  onStatusChange: (newStatus: CaseStatus) => void;
}

function StatusSelector({ caseId, status, onStatusChange }: StatusSelectorProps) {
  const [saving, setSaving] = useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newStatus = e.target.value as CaseStatus;
    setSaving(true);
    try {
      await updateCase(caseId, { status: newStatus });
      onStatusChange(newStatus);
    } catch {
      toast.error("Failed to update case status.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <select
      className={`status-selector status-pill status-pill--${status.toLowerCase()}`}
      value={status}
      onChange={(e) => void handleChange(e)}
      disabled={saving}
      aria-label="Case status"
    >
      {CASE_STATUSES.map((s) => (
        <option key={s} value={s}>{s}</option>
      ))}
    </select>
  );
}

/* ─── CaseDetailView ──────────────────────────────────────────────────────── */

const TAB_FALLBACK = (
  <div style={{ padding: 24, color: "#9ca3af", fontSize: 14 }}>Loading…</div>
);

function CaseDetailViewInner() {
  const { id } = useParams<{ id: string }>();
  const [caseData, setCaseData] = useState<CaseDetailResponse | null>(null);
  const [loadingCase, setLoadingCase] = useState(true);
  const [activeTab, setActiveTab] = useState("investigate");
  const [requestedAngle, setRequestedAngle] = useState<{ id: string; title: string } | null>(null);
  const { activeAngleId, activeAngleTitle, setActiveAngle } = useCaseWorkspace();
  const feeder = useFeederActions(id ?? "");
  const [triagedKeys, setTriagedKeys] = useState<Set<string>>(new Set());
  const [triageOutcomes, setTriageOutcomes] = useState<Map<string, string>>(new Map());
  const markTriaged = useCallback(
    (key: string) => setTriagedKeys((p) => new Set(p).add(key)),
    []
  );
  const recordTriageOutcome = useCallback(
    (key: string, label: string) => setTriageOutcomes((p) => new Map(p).set(key, label)),
    []
  );

  useEffect(() => {
    if (!id) return;
    fetchCase(id)
      .then(setCaseData)
      .catch(console.error)
      .finally(() => setLoadingCase(false));
  }, [id]);

  function refetchCase() {
    if (!id) return;
    fetchCase(id)
      .then(setCaseData)
      .catch((err) => {
        console.error(err);
        toast.error("Failed to reload case data.");
      });
  }

  function handleOpenAngle(angleId: string, angleTitle: string) {
    setRequestedAngle({ id: angleId, title: angleTitle });
    setActiveTab("investigate");
  }

  if (!id) return <div style={{ padding: 24 }}>Invalid case ID.</div>;

  const tabLabels = [
    { value: "investigate",   label: "Investigate" },
    { value: "research",      label: "Research" },
    { value: "financials",    label: "Financials" },
    { value: "timeline",      label: "Timeline" },
    { value: "referrals",     label: "Referrals" },
    { value: "investigation", label: "Replay" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-0)" }}>
      {/* Page header */}
      <header className="case-shell-header">
        <span className="case-shell-header__wordmark">
          Cata<span>lyst</span>
        </span>
        <span className="case-shell-header__sep">›</span>
        {loadingCase ? (
          <div className="skeleton" style={{ width: 180, height: 16 }} />
        ) : (
          <>
            <h1 className="case-shell-header__title">
              {caseData?.name ?? "Unknown case"}
            </h1>
            <div className="case-shell-header__right">
              {activeAngleId && (
                <span className="active-angle-chip" title="Citations target this angle">
                  Active angle: {activeAngleTitle || "Untitled"}
                  <button
                    type="button"
                    className="active-angle-chip__clear"
                    aria-label="Clear active angle"
                    onClick={() => setActiveAngle(undefined)}
                  >
                    ×
                  </button>
                </span>
              )}
              {caseData && id && (
              <StatusSelector
                caseId={id}
                status={caseData.status}
                onStatusChange={(newStatus) =>
                  setCaseData((prev) => prev ? { ...prev, status: newStatus } : prev)
                }
              />
            )}
              {caseData && id && (
                <DocumentDrawer
                  caseId={id}
                  documents={caseData.documents}
                  onDocumentsChanged={refetchCase}
                  onViewDocument={(_docId, _docName) => {
                    setActiveTab("investigate");
                  }}
                />
              )}
            </div>
          </>
        )}
      </header>

      {/* Five-tab layout */}
      <Tabs.Root
        value={activeTab}
        onValueChange={setActiveTab}
        style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, position: "relative" }}
      >
        <Tabs.List className="tabs-list">
          {tabLabels.map(({ value, label }) => (
            <Tabs.Trigger key={value} value={value} className="tabs-trigger">
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* ── Investigate (Level 1–4 drill-down, Cytoscape graph) ── */}
        <Tabs.Content value="investigate" className="tab-panel">
          <InvestigateTab
            caseId={id}
            documents={caseData?.documents ?? []}
            onAngleActive={(angle) => setActiveAngle(angle)}
            requestedAngle={requestedAngle}
            onAngleConsumed={() => setRequestedAngle(null)}
          />
        </Tabs.Content>

        {/* ── Research (external data sources, async job polling) ── */}
        <Tabs.Content value="research" className="tab-panel">
          <Suspense fallback={TAB_FALLBACK}>
            <ResearchTab
              caseId={id}
              triagedKeys={triagedKeys}
              onTriaged={markTriaged}
              triageOutcomes={triageOutcomes}
              onTriageOutcome={recordTriageOutcome}
            />
          </Suspense>
        </Tabs.Content>

        {/* ── Financials (YoY 990 table with anomaly highlighting) ── */}
        <Tabs.Content value="financials" className="tab-panel">
          <Suspense fallback={TAB_FALLBACK}>
            <FinancialsTab
              caseId={id}
              onStartAngle={(prefilledName) => {
                void feeder.startAngleFrom({ title: prefilledName });
              }}
              onOpenAngle={handleOpenAngle}
            />
          </Suspense>
        </Tabs.Content>

        {/* ── Timeline (D3 brush + event rail) ── */}
        <Tabs.Content value="timeline" className="tab-panel">
          <Suspense fallback={TAB_FALLBACK}>
            <TimelineTab
              caseId={id}
              activeAngleId={activeAngleId}
              onCiteInAngle={async (event: TimelineEvent) => {
                await feeder.citeToAngle({
                  label: `${event.label} — ${event.date}`,
                  documentId: event.layer === "document" ? event.id : undefined,
                });
              }}
            />
          </Suspense>
        </Tabs.Content>

        {/* ── Referrals (deterministic PDF export) ── */}
        <Tabs.Content value="referrals" className="tab-panel">
          <Suspense fallback={TAB_FALLBACK}>
            {id && <ReferralsTab caseId={id} />}
          </Suspense>
        </Tabs.Content>

        {/* ── Investigation (angle replay + deep link into Investigate tab) ── */}
        <Tabs.Content value="investigation" className="tab-panel">
          <Suspense fallback={TAB_FALLBACK}>
            {id && (
              <InvestigationTab
                caseId={id}
                onOpenAngle={handleOpenAngle}
              />
            )}
          </Suspense>
        </Tabs.Content>
      </Tabs.Root>
      {id && (
        <AnglePickerModal
          caseId={id}
          open={feeder.pickerOpen}
          onClose={feeder.closePicker}
          onPick={feeder.onPickerPick}
        />
      )}
    </div>
  );
}

export default function CaseDetailView() {
  return (
    <CaseWorkspaceProvider>
      <CaseDetailViewInner />
    </CaseWorkspaceProvider>
  );
}
