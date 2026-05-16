import { lazy, Suspense, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import * as Tabs from "@radix-ui/react-tabs";
import { toast } from "sonner";
import { fetchCase, generateReferralPdf, fetchAngle, updateAngle } from "../api";
import type { CaseDetailResponse, TimelineEvent } from "../types";
import InvestigateTab from "./InvestigateTab";
import DocumentDrawer from "../components/DocumentDrawer";

/* ─── Lazy-load heavy tabs ────────────────────────────────────────────────── */
const ResearchTab   = lazy(() => import("./ResearchTab"));
const FinancialsTab = lazy(() => import("./FinancialsTab"));
const TimelineTab   = lazy(() => import("./TimelineTab"));

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`status-pill status-pill--${status.toLowerCase()}`}>
      {status}
    </span>
  );
}

function ReferralsPanel({ caseId }: { caseId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
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
      setError(err instanceof Error ? err.message : "PDF generation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 32, maxWidth: 520 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 8px" }}>
        Referral Package
      </h2>
      <p style={{ margin: "0 0 20px", fontSize: 13, color: "#6b7280", lineHeight: 1.5 }}>
        Generate a deterministic, citation-bearing PDF referral package for this case.
        Confirmed angles with cited documents are included automatically. No AI generation —
        every sentence traces back to a document in the case file.
      </p>
      <button
        type="button"
        className="btn-primary"
        onClick={handleGenerate}
        disabled={loading}
      >
        {loading ? "Generating…" : "Generate Referral Package (PDF)"}
      </button>
      {error && (
        <p style={{ marginTop: 12, fontSize: 13, color: "#ef4444" }}>{error}</p>
      )}
    </div>
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

  useEffect(() => {
    if (!id) return;
    fetchCase(id)
      .then(setCaseData)
      .catch(console.error)
      .finally(() => setLoadingCase(false));
  }, [id]);

  function refetchCase() {
    if (!id) return;
    fetchCase(id).then(setCaseData).catch(console.error);
  }

  if (!id) return <div style={{ padding: 24 }}>Invalid case ID.</div>;

  const tabLabels = [
    { value: "investigate", label: "Investigate" },
    { value: "research",    label: "Research" },
    { value: "financials",  label: "Financials" },
    { value: "timeline",    label: "Timeline" },
    { value: "referrals",   label: "Referrals" },
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
              {caseData && <StatusPill status={caseData.status} />}
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
          <ReferralsPanel caseId={id} />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
