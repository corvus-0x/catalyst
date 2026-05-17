/**
 * FinancialsTab.tsx
 *
 * Displays year-over-year Form 990 financial data for a case.
 * Anomaly highlighting: SR-021 (revenue spike), SR-029 (low program ratio),
 * SR-013 (zero officer compensation at high-revenue org).
 *
 * Vocabulary: "Intake" for AI-extracted data. Never say "Claude" or "AI".
 */

import { useCallback, useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { fetchFinancials, fetch990s } from "../api";
import type { FinancialSnapshot, FinancialsResponse } from "../types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FinancialsTabProps {
  caseId: string;
  onStartAngle?: (prefilledName: string) => void;
}

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

/** Format an integer dollar amount into a compact display string. */
function formatMoney(n: number | null): string {
  if (n === null) return "—";
  if (n < 1_000) return `$${n}`;
  if (n < 1_000_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * Returns the program-services percentage (0–100) for a snapshot.
 * null if either field is unavailable or total_expenses is zero.
 */
function programPct(s: FinancialSnapshot): number | null {
  if (s.program_service_revenue === null || !s.total_expenses) return null;
  return Math.round((s.program_service_revenue / s.total_expenses) * 100);
}

/** True when this snapshot's revenue jumped >100% YoY (SR-021). */
function isRevenueSpike(s: FinancialSnapshot): boolean {
  return s.total_revenue_yoy_pct !== undefined && s.total_revenue_yoy_pct > 100;
}

/** True when this snapshot's program ratio is below 50% (SR-029). */
function isLowProgramRatio(s: FinancialSnapshot): boolean {
  const pct = programPct(s);
  return pct !== null && pct < 50;
}

/** True when officer comp is $0 at an org earning >$100K (SR-013). */
function isZeroOfficerComp(s: FinancialSnapshot): boolean {
  return (
    s.officer_compensation_total === 0 &&
    s.total_revenue !== null &&
    s.total_revenue > 100_000
  );
}

/**
 * Native `title` tooltip text for anomaly cells.
 * Returns undefined when there is no anomaly to describe.
 */
function revenueSpikeTitle(s: FinancialSnapshot): string | undefined {
  if (!isRevenueSpike(s)) return undefined;
  const pct = s.total_revenue_yoy_pct!.toFixed(0);
  return `SR-021 · REVENUE_SPIKE — Revenue increased ${pct}% year-over-year. Threshold: >100%.`;
}

function lowProgramTitle(s: FinancialSnapshot): string | undefined {
  const pct = programPct(s);
  if (pct === null || pct >= 50) return undefined;
  return `SR-029 · LOW_PROGRAM_RATIO — Only ${pct}% of expenses go to program services. Threshold: <50%.`;
}

function zeroCompTitle(s: FinancialSnapshot): string | undefined {
  if (!isZeroOfficerComp(s)) return undefined;
  return `SR-013 · ZERO_OFFICER_PAY — $0 officer compensation at organization with >${formatMoney(s.total_revenue)} revenue.`;
}

/**
 * Returns the set of tax_years flagged SR-025 FALSE_DISCLOSURE.
 * Finds the first year where related_party_disclosed === true, then flags
 * every subsequent year where it flips to false.
 */
function detectSr025FlipYears(snapshots: FinancialSnapshot[]): Set<number> {
  const sorted = [...snapshots].sort((a, b) => a.tax_year - b.tax_year);
  const flipped = new Set<number>();
  let firstYesYear: number | null = null;
  for (const s of sorted) {
    if (s.related_party_disclosed === true && firstYesYear === null) {
      firstYesYear = s.tax_year;
    } else if (s.related_party_disclosed === false && firstYesYear !== null) {
      flipped.add(s.tax_year);
    }
  }
  return flipped;
}

/**
 * Determine the source label to display in the header.
 * Pick the most common source across all snapshots.
 */
function dominantSourceLabel(snapshots: FinancialSnapshot[]): string {
  if (snapshots.length === 0) return "";
  const counts: Record<string, number> = {};
  for (const s of snapshots) counts[s.source] = (counts[s.source] ?? 0) + 1;
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  return dominant === "IRS_TEOS_XML" ? "IRS Form 990" : "Intake-extracted";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface YoYBadgeProps {
  pct: number;
}

function YoYBadge({ pct }: YoYBadgeProps) {
  if (pct >= 0) {
    return (
      <span className="yoy-badge yoy-badge--up">
        ↑{pct.toFixed(0)}%
      </span>
    );
  }
  return (
    <span className="yoy-badge yoy-badge--down">
      ↓{Math.abs(pct).toFixed(0)}%
    </span>
  );
}

// ---------------------------------------------------------------------------
// AnomalyCell — clickable anomaly td that opens a Radix Popover
// ---------------------------------------------------------------------------

interface AnomalyCellProps {
  value: React.ReactNode;
  ruleId: string;
  ruleLabel: string;
  explanation: string;
  onStartAngle?: (prefilledName: string) => void;
}

function AnomalyCell({ value, ruleId, ruleLabel, explanation, onStartAngle }: AnomalyCellProps) {
  const [open, setOpen] = useState(false);
  const prefilledName = `${ruleLabel} — anomaly detected`;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <td
          className="cell--flag"
          style={{ cursor: "pointer" }}
          role="button"
          tabIndex={0}
          aria-label={`${ruleId} anomaly — click for details`}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOpen(true); }}
        >
          {value}
        </td>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            padding: 14,
            maxWidth: 280,
            zIndex: 200,
          }}
          sideOffset={4}
        >
          <p style={{ fontSize: 12, fontWeight: 600, color: "#111827", marginBottom: 4 }}>
            {ruleId}
          </p>
          <p style={{ fontSize: 11, color: "#6b7280", lineHeight: 1.5, marginBottom: 10 }}>
            {explanation}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {onStartAngle && (
              <button
                type="button"
                className="btn-primary"
                style={{ fontSize: 11, width: "100%" }}
                onClick={() => { setOpen(false); onStartAngle(prefilledName); }}
              >
                Start new angle
              </button>
            )}
            <Popover.Close asChild>
              <button type="button" className="btn-secondary" style={{ fontSize: 11, width: "100%" }}>
                Dismiss
              </button>
            </Popover.Close>
          </div>
          <Popover.Arrow style={{ fill: "#e5e7eb" }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ---------------------------------------------------------------------------
// GovernanceCell — boolean governance indicator (Yes / No / unknown)
// ---------------------------------------------------------------------------

function GovernanceCell({ value }: { value: boolean | null }) {
  if (value === null || value === undefined) {
    return <td style={{ color: "var(--text-3)", textAlign: "right" }}>—</td>;
  }
  if (value) {
    return <td className="cell--gov-pass" style={{ textAlign: "right" }}>Yes</td>;
  }
  return <td className="cell--gov-fail" style={{ textAlign: "right" }}>No</td>;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function FinancialsTab({ caseId, onStartAngle }: FinancialsTabProps) {
  const [response, setResponse] = useState<FinancialsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetching990, setFetching990] = useState(false);
  const [fetch990Error, setFetch990Error] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  const loadFinancials = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const data = await fetchFinancials(caseId);
      setResponse(data);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load financials.");
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void loadFinancials();
  }, [loadFinancials]);

  // -------------------------------------------------------------------------
  // "Fetch new 990s" action
  // -------------------------------------------------------------------------

  async function handleFetch990s(einOverride?: string) {
    setFetching990(true);
    setFetch990Error(null);
    // Backend requires an EIN — use override, then first snapshot's EIN
    const ein = einOverride ?? snapshots[0]?.ein ?? (response?.results?.[0]?.ein);
    if (!ein) {
      setFetch990Error("No EIN available. Search IRS 990 in Research tab first.");
      setFetching990(false);
      return;
    }
    try {
      await fetch990s(caseId, { ein });
      await loadFinancials();
    } catch (err) {
      setFetch990Error(err instanceof Error ? err.message : "Fetch failed.");
    } finally {
      setFetching990(false);
    }
  }

  // -------------------------------------------------------------------------
  // Derived data
  // -------------------------------------------------------------------------

  const snapshots: FinancialSnapshot[] = (response?.results ?? []).slice().sort(
    (a, b) => a.tax_year - b.tax_year
  );

  const years = snapshots.map((s) => s.tax_year);
  const orgName = snapshots[0]?.organization_name ?? "—";
  const sourceLabel = dominantSourceLabel(snapshots);
  const sr025FlipYears = detectSr025FlipYears(snapshots);

  // -------------------------------------------------------------------------
  // Loading skeleton
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="fin-tab" style={{ height: "100%" }}>
        <div className="fin-tab__header">
          <div>
            <div className="skeleton" style={{ width: 220, height: 20, marginBottom: 6 }} />
            <div className="skeleton" style={{ width: 160, height: 14 }} />
          </div>
        </div>
        <div className="fin-table-wrap">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="skeleton"
              style={{ height: 36, marginBottom: 4, borderRadius: 4 }}
            />
          ))}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  if (fetchError) {
    return (
      <div className="fin-tab" style={{ height: "100%" }}>
        <div className="empty-state">
          <AlertTriangle size={24} />
          <p className="empty-state__title">Could not load financials</p>
          <p className="empty-state__body">{fetchError}</p>
          <button type="button" className="btn-secondary" onClick={loadFinancials}>
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Empty state (no snapshots)
  // -------------------------------------------------------------------------

  if (snapshots.length === 0) {
    return (
      <div className="fin-tab" style={{ height: "100%" }}>
        <div className="empty-state">
          <p className="empty-state__title">No Form 990 data on file for this case.</p>
          <p className="empty-state__body">
            Fetch 990 data below, or use{" "}
            <strong>Research → IRS 990</strong> to find filings.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn-primary"
              onClick={() => handleFetch990s()}
              disabled={fetching990}
            >
              {fetching990 ? (
                <>
                  <Loader2 size={14} className="spin" /> Fetching…
                </>
              ) : (
                "Fetch 990 data"
              )}
            </button>
          </div>
          {fetch990Error && (
            <p className="empty-state__body" style={{ color: "var(--color-coral)" }}>
              {fetch990Error}
            </p>
          )}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Full table view
  // -------------------------------------------------------------------------

  return (
    <div className="fin-tab" style={{ height: "100%" }}>
      {/* Header */}
      <div className="fin-tab__header">
        <div>
          <h2 className="fin-tab__title">
            Financials{orgName !== "—" ? ` — ${orgName}` : ""}
          </h2>
          <p className="fin-tab__sub">
            {sourceLabel && (
              <>
                Source: <span className="doc-badge">{sourceLabel}</span>
                {" · "}
              </>
            )}
            {snapshots.length} year{snapshots.length !== 1 ? "s" : ""} on file
          </p>
        </div>
        <button
          type="button"
          className="toolbar-btn btn-secondary"
          onClick={() => handleFetch990s()}
          disabled={fetching990}
        >
          {fetching990 ? (
            <>
              <Loader2 size={14} className="spin" /> Fetching…
            </>
          ) : (
            <>
              <RefreshCw size={14} /> Fetch new 990s
            </>
          )}
        </button>
      </div>

      {fetch990Error && (
        <p style={{ color: "var(--color-coral)", padding: "0 0 8px 0", fontSize: "0.875rem" }}>
          <AlertTriangle size={13} style={{ verticalAlign: "middle", marginRight: 4 }} />
          {fetch990Error}
        </p>
      )}

      {/* Table */}
      <div className="fin-table-wrap">
        <table className="fin-table">
          <thead>
            <tr>
              <th>Metric</th>
              {years.map((y) => (
                <th key={y}>{y}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {/* ── Row 1: Total revenue ── */}
            <tr>
              <td>Total revenue</td>
              {snapshots.map((s) => {
                const spike = isRevenueSpike(s);
                const cellValue = (
                  <>
                    {formatMoney(s.total_revenue)}
                    {s.total_revenue_yoy_pct !== undefined && (
                      <>
                        <br />
                        <YoYBadge pct={s.total_revenue_yoy_pct} />
                      </>
                    )}
                  </>
                );
                if (spike) {
                  return (
                    <AnomalyCell
                      key={s.tax_year}
                      value={cellValue}
                      ruleId="SR-021"
                      ruleLabel="Revenue spike"
                      explanation={revenueSpikeTitle(s) ?? "Revenue increased more than 100% year-over-year."}
                      onStartAngle={onStartAngle}
                    />
                  );
                }
                return <td key={s.tax_year}>{cellValue}</td>;
              })}
            </tr>

            {/* ── Row 2: Total expenses ── */}
            <tr>
              <td>Total expenses</td>
              {snapshots.map((s) => (
                <td key={s.tax_year}>{formatMoney(s.total_expenses)}</td>
              ))}
            </tr>

            {/* ── Row 3: Program services ── */}
            <tr>
              <td>Program services</td>
              {snapshots.map((s) => {
                const pct = programPct(s);
                const flagged = isLowProgramRatio(s);
                const cellValue = (
                  <>
                    {formatMoney(s.program_service_revenue)}
                    {pct !== null && (
                      <>
                        <br />
                        <span style={{ fontSize: "0.75em", opacity: 0.75 }}>({pct}%)</span>
                      </>
                    )}
                  </>
                );
                if (flagged) {
                  return (
                    <AnomalyCell
                      key={s.tax_year}
                      value={cellValue}
                      ruleId="SR-029"
                      ruleLabel="Low program ratio"
                      explanation={lowProgramTitle(s) ?? "Less than 50% of expenses go to program services."}
                      onStartAngle={onStartAngle}
                    />
                  );
                }
                return <td key={s.tax_year}>{cellValue}</td>;
              })}
            </tr>

            {/* ── Row 4: Net assets ── */}
            <tr>
              <td>Net assets (EOY)</td>
              {snapshots.map((s) => (
                <td key={s.tax_year}>{formatMoney(s.net_assets_eoy)}</td>
              ))}
            </tr>

            {/* ── Row 5: Officer compensation ── */}
            <tr>
              <td>Officer compensation</td>
              {snapshots.map((s) => {
                const flagged = isZeroOfficerComp(s);
                const cellValue = formatMoney(s.officer_compensation_total);
                if (flagged) {
                  return (
                    <AnomalyCell
                      key={s.tax_year}
                      value={cellValue}
                      ruleId="SR-013"
                      ruleLabel="Zero officer pay"
                      explanation={zeroCompTitle(s) ?? "$0 officer compensation at a high-revenue organization."}
                      onStartAngle={onStartAngle}
                    />
                  );
                }
                return <td key={s.tax_year}>{cellValue}</td>;
              })}
            </tr>
          </tbody>

          <tbody>
            <tr className="fin-section-header">
              <td colSpan={years.length + 1}>Governance — Part VI</td>
            </tr>

            <tr>
              <td>Board members</td>
              {snapshots.map((s) => (
                <td key={s.tax_year} style={{ textAlign: "right" }}>
                  {s.num_voting_members ?? "—"}
                </td>
              ))}
            </tr>

            <tr>
              <td>Independent members</td>
              {snapshots.map((s) => {
                const val = s.num_independent_members;
                if (val === null || val === undefined) {
                  return <td key={s.tax_year} style={{ textAlign: "right", color: "var(--text-3)" }}>—</td>;
                }
                return (
                  <td
                    key={s.tax_year}
                    style={{ textAlign: "right" }}
                    className={val === 0 ? "cell--gov-fail" : "cell--gov-pass"}
                  >
                    {val}
                  </td>
                );
              })}
            </tr>

            <tr>
              <td>COI policy</td>
              {snapshots.map((s) => (
                <GovernanceCell key={s.tax_year} value={s.has_coi_policy} />
              ))}
            </tr>

            <tr>
              <td>Whistleblower policy</td>
              {snapshots.map((s) => (
                <GovernanceCell key={s.tax_year} value={s.has_whistleblower_policy} />
              ))}
            </tr>

            <tr>
              <td>Document retention</td>
              {snapshots.map((s) => (
                <GovernanceCell key={s.tax_year} value={s.has_document_retention_policy} />
              ))}
            </tr>
          </tbody>

          <tbody>
            <tr className="fin-section-header">
              <td colSpan={years.length + 1}>Part IV — Related-party disclosure</td>
            </tr>

            <tr>
              <td>Line 28 — Related-party tx disclosed?</td>
              {snapshots.map((s) => {
                const isFlip = sr025FlipYears.has(s.tax_year);
                if (isFlip) {
                  return (
                    <AnomalyCell
                      key={s.tax_year}
                      value="No"
                      ruleId="SR-025"
                      ruleLabel="FALSE_DISCLOSURE"
                      explanation={
                        `SR-025 · FALSE_DISCLOSURE — ${s.tax_year} 990 denies related-party ` +
                        `transactions (Line 28 = No), but a prior year disclosed them ` +
                        `(Line 28 = Yes). Transactions continued. This is not an accidental omission.`
                      }
                      onStartAngle={onStartAngle}
                    />
                  );
                }
                return (
                  <GovernanceCell
                    key={s.tax_year}
                    value={s.related_party_disclosed}
                  />
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
