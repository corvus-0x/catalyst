/**
 * FinancialsPane — Spec §12.
 *
 * Year-over-year tabular view + dual-line revenue/expenses sparkline.
 * Drops into the workspace center canvas as one of the top-bar view-toggle panes.
 *
 * Rows: revenue, expenses, net assets, program ratio, officer comp,
 * board independence (%). Years are columns, oldest left → newest right.
 *
 * Click a year column header → fires `onSelectYear(taxYear)` so the parent
 * can drive the right detail panel with that year's full 990 line items.
 *
 * Anomaly cells (per the active rule set) get a `--tag-high-bg` highlight
 * with a tiny rule-ID chip in the corner. The cell is keyboard-focusable
 * and exposes a tooltip explaining which rule fired.
 */
import { useEffect, useMemo, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { fetchCaseFinancials } from "../../api";
import { FinancialSnapshotItem } from "../../types";
import { Tooltip } from "../ui/Tooltip";
import styles from "./FinancialsPane.module.css";

interface Props {
    caseId: string;
    /** Fired when the user clicks a year column header. */
    onSelectYear?: (taxYear: number) => void;
    /** Optional notification when data has loaded (count of snapshots). */
    onLoaded?: (count: number) => void;
}

/* ── Anomaly model ───────────────────────────────────────────── */

type RuleId = "SR-021" | "SR-013" | "SR-029";

interface AnomalyHit {
    ruleId: RuleId;
    ruleName: string;
    /** Short message used in the cell tooltip. */
    message: string;
}

const RULE_NAMES: Record<RuleId, string> = {
    "SR-021": "Revenue Spike",
    "SR-013": "Zero Officer Pay",
    "SR-029": "Low Program Ratio",
};

/* Which row the highlight should land on, per rule. */
type RowKey =
    | "total_revenue"
    | "total_expenses"
    | "net_assets_eoy"
    | "program_ratio"
    | "officer_compensation_total"
    | "board_independence_pct";

const RULE_TARGET_ROW: Record<RuleId, RowKey> = {
    "SR-021": "total_revenue",
    "SR-013": "officer_compensation_total",
    "SR-029": "program_ratio",
};

/* ── Formatting helpers (canonical per spec) ─────────────────── */

const usdFmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
});

function fmtUsd(val: number | null | undefined): string {
    if (val == null) return "—";
    return usdFmt.format(val);
}

function fmtPct(val: number | null | undefined): string {
    if (val == null) return "—";
    return `${(val * 100).toFixed(0)}%`;
}

/* ── Math (mirrors backend signal rules + FinancialsTab logic) ─ */

/**
 * Program-service ratio: (total_expenses − officer_comp − pro_fundraising) / total_expenses.
 * Returns a 0–1 fraction (or null when undefined). SR-029 fires when < 0.5.
 */
function computeProgramRatio(snap: FinancialSnapshotItem): number | null {
    const te = snap.total_expenses;
    if (te == null || te === 0) return null;
    const deductible =
        (snap.officer_compensation_total ?? 0) + (snap.professional_fundraising ?? 0);
    return (te - deductible) / te;
}

/**
 * Per-year anomaly map. Mirrors `FinancialsTab.detectAnomalies` but rule-keyed
 * so the cell highlight knows which chip to draw.
 */
function detectAnomalies(
    snap: FinancialSnapshotItem,
    prev: FinancialSnapshotItem | null,
): AnomalyHit[] {
    const hits: AnomalyHit[] = [];

    // SR-021 — Revenue spike (YoY > 100%)
    if (
        prev &&
        prev.total_revenue != null &&
        prev.total_revenue > 0 &&
        snap.total_revenue != null
    ) {
        const yoy =
            ((snap.total_revenue - prev.total_revenue) / Math.abs(prev.total_revenue)) * 100;
        if (yoy > 100) {
            hits.push({
                ruleId: "SR-021",
                ruleName: RULE_NAMES["SR-021"],
                message: `Revenue spike +${yoy.toFixed(0)}% YoY`,
            });
        }
    }

    // SR-013 — Zero officer comp at high revenue (≥ $1M)
    if (
        snap.officer_compensation_total === 0 &&
        snap.total_revenue != null &&
        snap.total_revenue >= 1_000_000
    ) {
        hits.push({
            ruleId: "SR-013",
            ruleName: RULE_NAMES["SR-013"],
            message: "Zero officer compensation at high-revenue org",
        });
    }

    // SR-029 — Program ratio < 50%
    const ratio = computeProgramRatio(snap);
    if (ratio != null && ratio < 0.5) {
        hits.push({
            ruleId: "SR-029",
            ruleName: RULE_NAMES["SR-029"],
            message: `Program ratio ${(ratio * 100).toFixed(0)}% (below 50%)`,
        });
    }

    return hits;
}

/* ── Row definitions (table body in render order) ───────────── */

interface RowDef {
    key: RowKey;
    label: string;
    /** Pulls the displayable value out of a snapshot. null = "not reported". */
    value: (snap: FinancialSnapshotItem) => number | null;
    /** "usd" → format as currency, "pct" → format as percentage of 0–1 fraction. */
    fmt: "usd" | "pct";
}

const ROWS: RowDef[] = [
    {
        key: "total_revenue",
        label: "Revenue",
        value: (s) => s.total_revenue,
        fmt: "usd",
    },
    {
        key: "total_expenses",
        label: "Expenses",
        value: (s) => s.total_expenses,
        fmt: "usd",
    },
    {
        key: "net_assets_eoy",
        label: "Net Assets",
        value: (s) => s.net_assets_eoy,
        fmt: "usd",
    },
    {
        key: "program_ratio",
        label: "Program Ratio",
        value: (s) => computeProgramRatio(s),
        fmt: "pct",
    },
    {
        key: "officer_compensation_total",
        label: "Officer Comp",
        value: (s) => s.officer_compensation_total,
        fmt: "usd",
    },
    {
        // Board independence is not currently exposed on FinancialSnapshotItem.
        // Backend model has voting_members + independent_members but the
        // serializer does not pass them through. Render as "—" until backend
        // extends the type. Surfaced in pane report.
        key: "board_independence_pct",
        label: "Board Independence",
        value: () => null,
        fmt: "pct",
    },
];

/* ── Sparkline (inline SVG, no charting lib) ─────────────────── */

interface SparkPoint {
    year: number;
    revenue: number | null;
    expenses: number | null;
}

interface SparklineProps {
    points: SparkPoint[];
    width: number;
    height: number;
}

function Sparkline({ points, width, height }: SparklineProps) {
    const padX = 6;
    const padY = 8;
    const innerW = Math.max(width - padX * 2, 1);
    const innerH = Math.max(height - padY * 2, 1);

    // Pull every numeric value to compute shared min/max.
    const vals: number[] = [];
    points.forEach((p) => {
        if (p.revenue != null) vals.push(p.revenue);
        if (p.expenses != null) vals.push(p.expenses);
    });
    const min = vals.length ? Math.min(...vals) : 0;
    const max = vals.length ? Math.max(...vals) : 1;
    const range = max - min || 1;

    const xFor = (i: number) =>
        points.length <= 1 ? padX + innerW / 2 : padX + (i / (points.length - 1)) * innerW;
    const yFor = (v: number) => padY + (1 - (v - min) / range) * innerH;

    const lineFor = (key: "revenue" | "expenses"): string =>
        points
            .map((p, i) => {
                const v = p[key];
                if (v == null) return "";
                return `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`;
            })
            .filter(Boolean)
            .join(" ");

    return (
        <svg
            className={styles.sparkSvg}
            viewBox={`0 0 ${width} ${height}`}
            width={width}
            height={height}
            role="img"
            aria-label="Revenue and expenses sparkline"
        >
            <path d={lineFor("revenue")} className={styles.sparkLineRevenue} />
            <path d={lineFor("expenses")} className={styles.sparkLineExpenses} />
            {points.map((p, i) => (
                <g key={p.year}>
                    {p.revenue != null && (
                        <Tooltip
                            content={`${p.year} · Revenue ${fmtUsd(p.revenue)}${
                                p.expenses != null ? ` · Expenses ${fmtUsd(p.expenses)}` : ""
                            }`}
                        >
                            <circle
                                cx={xFor(i)}
                                cy={yFor(p.revenue)}
                                r={2.5}
                                className={styles.sparkDotRevenue}
                            />
                        </Tooltip>
                    )}
                    {p.expenses != null && (
                        <Tooltip
                            content={`${p.year} · Expenses ${fmtUsd(p.expenses)}${
                                p.revenue != null ? ` · Revenue ${fmtUsd(p.revenue)}` : ""
                            }`}
                        >
                            <circle
                                cx={xFor(i)}
                                cy={yFor(p.expenses)}
                                r={2.5}
                                className={styles.sparkDotExpenses}
                            />
                        </Tooltip>
                    )}
                </g>
            ))}
        </svg>
    );
}

/* ── Main component ──────────────────────────────────────────── */

export function FinancialsPane({ caseId, onSelectYear, onLoaded }: Props) {
    const [data, setData] = useState<FinancialSnapshotItem[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    async function load() {
        setRefreshing(true);
        setError(null);
        try {
            const res = await fetchCaseFinancials(caseId);
            setData(res.results);
            onLoaded?.(res.results.length);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load financials");
        } finally {
            setRefreshing(false);
        }
    }

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetchCaseFinancials(caseId);
                if (!cancelled) {
                    setData(res.results);
                    onLoaded?.(res.results.length);
                }
            } catch (e) {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : "Failed to load financials");
                }
            }
        })();
        return () => {
            cancelled = true;
        };
        // onLoaded intentionally excluded — referential identity changes per render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [caseId]);

    /** Sorted oldest → newest for the table; identical order used by the sparkline. */
    const sorted = useMemo<FinancialSnapshotItem[]>(
        () => (data ? [...data].sort((a, b) => a.tax_year - b.tax_year) : []),
        [data],
    );

    /** Anomalies indexed by `${tax_year}-${RowKey}` so cells can look themselves up. */
    const anomalyByCell = useMemo<Map<string, AnomalyHit>>(() => {
        const m = new Map<string, AnomalyHit>();
        sorted.forEach((snap, i) => {
            const prev = i > 0 ? sorted[i - 1] : null;
            const hits = detectAnomalies(snap, prev);
            hits.forEach((hit) => {
                const row = RULE_TARGET_ROW[hit.ruleId];
                m.set(`${snap.tax_year}-${row}`, hit);
            });
        });
        return m;
    }, [sorted]);

    /* Loading state — no data yet, no error */
    if (data === null && !error) {
        return (
            <div className={styles.panel}>
                <Header count={null} refreshing={refreshing} onRefresh={load} />
                <div className={styles.loading} aria-busy="true">
                    Loading financial data…
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.panel}>
                <Header count={null} refreshing={refreshing} onRefresh={load} />
                <div className={styles.error}>
                    <span>Couldn't load financials: {error}</span>
                    <button type="button" className={styles.retry} onClick={load}>
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    if (sorted.length === 0) {
        return (
            <div className={styles.panel}>
                <Header count={0} refreshing={refreshing} onRefresh={load} />
                <div className={styles.empty}>
                    No 990 financial data extracted yet — upload an IRS 990 PDF or fetch one from
                    the Research tab.
                </div>
            </div>
        );
    }

    const sparkPoints: SparkPoint[] = sorted.map((s) => ({
        year: s.tax_year,
        revenue: s.total_revenue,
        expenses: s.total_expenses,
    }));

    return (
        <div className={styles.panel}>
            <Header count={sorted.length} refreshing={refreshing} onRefresh={load} />

            <div className={styles.scroller}>
                {/* Sparkline */}
                <div className={styles.sparkBlock}>
                    <Sparkline points={sparkPoints} width={520} height={60} />
                    <div className={styles.legend}>
                        <span className={styles.legendItem}>
                            <span className={`${styles.swatch} ${styles.swatchRevenue}`} />
                            Revenue
                        </span>
                        <span className={styles.legendItem}>
                            <span className={`${styles.swatch} ${styles.swatchExpenses}`} />
                            Expenses
                        </span>
                    </div>
                </div>

                {/* Year-over-year table */}
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th className={styles.rowLabelCol}>Metric</th>
                            {sorted.map((s) => (
                                <th
                                    key={s.tax_year}
                                    className={styles.yearTh}
                                    onClick={() => onSelectYear?.(s.tax_year)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            onSelectYear?.(s.tax_year);
                                        }
                                    }}
                                    tabIndex={0}
                                    role="button"
                                    aria-label={`Show ${s.tax_year} 990 detail`}
                                >
                                    {s.tax_year}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {ROWS.map((row) => (
                            <tr key={row.key}>
                                <td className={styles.rowLabel}>{row.label}</td>
                                {sorted.map((snap) => {
                                    const v = row.value(snap);
                                    const text = row.fmt === "usd" ? fmtUsd(v) : fmtPct(v);
                                    const anom = anomalyByCell.get(`${snap.tax_year}-${row.key}`);
                                    const cellClass = `${styles.cell}${
                                        anom ? ` ${styles.cellAnomaly}` : ""
                                    }`;
                                    const tipText = anom
                                        ? `${text} in ${snap.tax_year} — possible ${anom.ruleName}`
                                        : null;
                                    const cellInner = (
                                        <>
                                            <span className={styles.cellValue}>{text}</span>
                                            {anom && (
                                                <span
                                                    className={styles.ruleChip}
                                                    aria-label={`Rule ${anom.ruleId}`}
                                                >
                                                    {anom.ruleId}
                                                </span>
                                            )}
                                        </>
                                    );
                                    return (
                                        <td
                                            key={snap.tax_year}
                                            className={cellClass}
                                            tabIndex={anom ? 0 : -1}
                                            data-rule-id={anom?.ruleId}
                                        >
                                            {tipText ? (
                                                <Tooltip content={tipText}>
                                                    <span className={styles.cellInner}>
                                                        {cellInner}
                                                    </span>
                                                </Tooltip>
                                            ) : (
                                                <span className={styles.cellInner}>
                                                    {cellInner}
                                                </span>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/* ── Header (mirrors AuditLogPanel chrome) ───────────────────── */

function Header({
    count,
    refreshing,
    onRefresh,
}: {
    count: number | null;
    refreshing: boolean;
    onRefresh: () => void;
}) {
    return (
        <div className={styles.header}>
            <div className={styles.headerLabel}>
                <span className={styles.headerTitle}>Financials</span>
                {count !== null && (
                    <span className={styles.headerCount}>
                        {count} year{count === 1 ? "" : "s"}
                    </span>
                )}
                <span className={styles.headerSub}>· year-over-year 990 data</span>
            </div>
            <Tooltip content="Refresh">
                <button
                    type="button"
                    className={styles.refreshBtn}
                    aria-label="Refresh financials"
                    onClick={onRefresh}
                    disabled={refreshing}
                >
                    <RefreshCwIcon
                        size={13}
                        className={refreshing ? styles.spinning : undefined}
                        strokeWidth={1.8}
                    />
                </button>
            </Tooltip>
        </div>
    );
}
