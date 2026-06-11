import { lazy, Suspense, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import * as Tabs from "@radix-ui/react-tabs";
import { toast } from "sonner";
import { fetchCase, fetchAngle, updateAngle, updateCase } from "../api";
import type { CaseDetailResponse, TimelineEvent } from "../types";
import InvestigateTab from "./InvestigateTab";
import DocumentDrawer from "../components/DocumentDrawer";

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

export default function CaseDetailView() {
  const { id } = useParams<{ id: string }>();
  const [caseData, setCaseData] = useState<CaseDetailResponse | null>(null);
  const [loadingCase, setLoadingCase] = useState(true);
  const [activeTab, setActiveTab] = useState("investigate");
  const [activeAngleId, setActiveAngleId] = useState<string | undefined>();
  const [requestedAngle, setRequestedAngle] = useState<{ id: string; title: string } | null>(null);

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
            onAngleActive={setActiveAngleId}
            requestedAngle={requestedAngle}
            onAngleConsumed={() => setRequestedAngle(null)}
          />
        </Tabs.Content>

        {/* ── Research (external data sources, async job polling) ── */}
        <Tabs.Content value="research" className="tab-panel">
          <Suspense fallback={TAB_FALLBACK}>
            <ResearchTab caseId={id} />
          </Suspense>
        </Tabs.Content>

        {/* ── Financials (YoY 990 table with anomaly highlighting) ── */}
        <Tabs.Content value="financials" className="tab-panel">
          <Suspense fallback={TAB_FALLBACK}>
            <FinancialsTab
              caseId={id}
              onStartAngle={(prefilledName) => {
                setActiveTab("investigate");
                toast(`Switch to "+ Angle" in the toolbar to create: ${prefilledName}`);
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
                if (!activeAngleId) {
                  toast("Open an angle first — navigate to one in the Investigate tab.");
                  return;
                }
                try {
                  const angle = await fetchAngle(id, activeAngleId);
                  const citation = `\n\n[Cited from timeline: ${event.label} — ${event.date}]`;
                  await updateAngle(id, activeAngleId, {
                    narrative: (angle.narrative ?? "") + citation,
                  });
                  toast("Cited in angle.");
                } catch {
                  toast("Failed to cite event in angle.");
                }
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
    </div>
  );
}
