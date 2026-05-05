/**
 * IRS990Viewer — top-bar pane per spec §11.
 *
 * Renders an organization's 990 filing as a structured form (NOT a PDF), one
 * year at a time. The user picks a tax year from a selector at the top; every
 * section (Part I, IV, VI, VII, IX, schedules) updates together.
 *
 * Inline signal callouts appear directly beneath the line that triggered them
 * — GitHub-PR-comment style. Findings are matched to lines by rule id +
 * `evidence_snapshot.tax_year` so the callout only shows on the relevant year.
 *
 * Data sources:
 *   - `fetchCaseFinancials(caseId)` for Part I numerics (every year that has
 *     a `FinancialSnapshotItem`).
 *   - `fetchDocumentDetail(caseId, documentId)` for Part IV/VI/VII detail —
 *     the IRS XML pipeline writes `parsed_990` into `Document.ingestion_metadata`
 *     and the document detail endpoint surfaces it. Lazy-loaded per year so
 *     only the visible year's document is fetched.
 *   - `fetchCaseFindings(caseId)` for inline callouts. AUTO-source findings
 *     whose `evidence_snapshot.tax_year` matches the selected year are mapped
 *     to lines by rule id (see `RULE_TO_ANCHOR`).
 *
 * If the selected year has no FinancialSnapshot, the pane shows a
 * "No 990 data available" empty state — never a blank section.
 */
import { useEffect, useMemo, useState } from "react";
import {
    AlertCircleIcon,
    BuildingIcon,
    ChevronDownIcon,
    FileWarningIcon,
    UserIcon,
    XIcon,
} from "lucide-react";
import {
    fetch990Data,
    fetchCaseFindings,
    fetchCaseFinancials,
    fetchDocumentDetail,
    isAbortError,
} from "../../api";
import { Tooltip } from "../ui/Tooltip";
import type { FinancialSnapshotItem, FindingItem } from "../../types";
import styles from "./IRS990Viewer.module.css";

/* ───────────────────────────── types ───────────────────────────────────── */

interface Props {
    caseId: string;
    /** Click handler for an officer entity link in Part VII. */
    onOpenEntity?: (entityId: string) => void;
    /** Click handler for the "View flag" button in an inline callout. */
    onOpenFinding?: (findingId: string) => void;
    /** Optional close handler — wired by the parent. */
    onClose?: () => void;
}

/** Shape of `parsed_990` from `form990_parser.parse_form_990`. Only the parts
 *  rendered by this pane are described — extra fields are tolerated. */
interface Parsed990 {
    part_iv?: {
        line_25a?: string | null;
        line_25b?: string | null;
        line_26?: string | null;
        line_28a?: string | null;
        line_28b?: string | null;
        line_28c?: string | null;
        line_29?: string | null;
    };
    part_vi?: {
        section_a?: {
            line_1a?: number | null;
            line_1b?: number | null;
            line_2?: string | null;
            line_5?: string | null;
        };
        section_b?: {
            line_11?: string | null;
            line_12a?: string | null;
            line_13?: string | null;
            line_14?: string | null;
            line_15a?: string | null;
        };
    };
    part_vii?: {
        officers?: Array<{
            name?: string;
            title?: string;
            average_hours_per_week?: number | null;
            reportable_compensation_from_org?: number | null;
            reportable_compensation_from_related_orgs?: number | null;
            estimated_other_compensation?: number | null;
            /** Resolved Person id, when entity resolution has linked them. */
            person_id?: string | null;
        }>;
    };
}

interface OfficerRow {
    name: string;
    title: string;
    hours: number | null;
    compFromOrg: number | null;
    compFromRelated: number | null;
    otherComp: number | null;
    personId: string | null;
}

/* ───────────────────────────── helpers ──────────────────────────────────── */

const USD = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
});

/** Format a nullable number as USD or em-dash. */
function fmtUsd(n: number | null | undefined): string {
    if (n === null || n === undefined) return "—";
    return USD.format(n);
}

/** Format a nullable integer/float, falling back to em-dash. */
function fmtNum(n: number | null | undefined): string {
    if (n === null || n === undefined) return "—";
    return String(n);
}

/** Format a Yes/No/X-style checkbox value as a normalized string. */
function fmtYesNo(v: string | null | undefined): "Yes" | "No" | "—" {
    if (!v) return "—";
    const upper = v.trim().toUpperCase();
    if (upper === "YES" || upper === "X" || upper === "TRUE") return "Yes";
    if (upper === "NO" || upper === "FALSE") return "No";
    return "—";
}

/**
 * Map a signal rule id to the section + anchor key it should appear under.
 * Anchor keys are stable strings used by `Line` / `Officer` rows.
 */
const RULE_TO_ANCHOR: Record<string, string> = {
    "SR-006": "part_iv.line_28",
    "SR-025": "part_iv.line_28a",
    "SR-026": "part_iv.line_25a",
    "SR-012": "part_vi.line_12a",
    "SR-028": "part_vi.line_5",
    "SR-013": "part_vii.compensation",
    "SR-021": "part_i.revenue",
    "SR-029": "part_ix.program_ratio",
    "SR-010": "part_i.summary",
};

/** Group AUTO findings by their anchor key for the selected tax year. */
export function groupFindingsByAnchor(
    findings: FindingItem[],
    taxYear: number,
): Map<string, FindingItem[]> {
    const out = new Map<string, FindingItem[]>();
    for (const f of findings) {
        if (f.source !== "AUTO") continue;
        const snapYear = (f.evidence_snapshot as { tax_year?: unknown })?.tax_year;
        if (typeof snapYear === "number" && snapYear !== taxYear) continue;
        // If snapYear is missing entirely we still surface the finding — better
        // false-positive on a familiar rule than silently dropping evidence.
        const anchor = RULE_TO_ANCHOR[f.rule_id];
        if (!anchor) continue;
        const list = out.get(anchor) ?? [];
        list.push(f);
        out.set(anchor, list);
    }
    return out;
}

/* ───────────────────────────── component ──────────────────────────────── */

export function IRS990Viewer({ caseId, onOpenEntity, onOpenFinding, onClose }: Props) {
    const [snapshots, setSnapshots] = useState<FinancialSnapshotItem[] | null>(null);
    const [findings, setFindings] = useState<FindingItem[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [selectedYear, setSelectedYear] = useState<number | null>(null);
    const [parsed, setParsed] = useState<Parsed990 | null>(null);
    const [parsedLoading, setParsedLoading] = useState(false);
    const [fetchEin, setFetchEin] = useState("");
    const [fetchLoading, setFetchLoading] = useState(false);
    const [fetchMsg, setFetchMsg] = useState<{ ok: boolean; text: string } | null>(null);
    const [loadVersion, setLoadVersion] = useState(0);

    // Initial load: financials + findings in parallel. Re-runs when loadVersion
    // increments (after a successful TEOS fetch adds new snapshots).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        const ctrl = new AbortController();
        setSnapshots(null);
        setFindings(null);
        setLoadError(null);
        (async () => {
            try {
                const [fin, find] = await Promise.all([
                    fetchCaseFinancials(caseId, { signal: ctrl.signal }),
                    fetchCaseFindings(caseId, { signal: ctrl.signal }),
                ]);
                if (ctrl.signal.aborted) return;
                const sorted = [...fin.results].sort((a, b) => b.tax_year - a.tax_year);
                setSnapshots(sorted);
                setFindings(find.results);
                if (sorted.length > 0) setSelectedYear(sorted[0].tax_year);
            } catch (err) {
                if (!isAbortError(err) && !ctrl.signal.aborted) {
                    setLoadError(err instanceof Error ? err.message : "Failed to load 990 data");
                }
            }
        })();
        return () => ctrl.abort();
    }, [caseId, loadVersion]); // loadVersion bump triggers refresh after TEOS fetch

    async function handleFetchFromTeos() {
        const ein = fetchEin.trim();
        if (!ein) return;
        setFetchLoading(true);
        setFetchMsg(null);
        try {
            const res = await fetch990Data(caseId, ein);
            const fetched = (res as unknown as { fetched?: number }).fetched ?? 0;
            setFetchMsg({ ok: true, text: `Fetched ${fetched} filing${fetched === 1 ? "" : "s"} — refreshing…` });
            setLoadVersion((v) => v + 1);
        } catch (e) {
            setFetchMsg({ ok: false, text: e instanceof Error ? e.message : "Fetch failed" });
        } finally {
            setFetchLoading(false);
        }
    }

    const currentSnapshot = useMemo<FinancialSnapshotItem | null>(() => {
        if (!snapshots || selectedYear === null) return null;
        return snapshots.find((s) => s.tax_year === selectedYear) ?? null;
    }, [snapshots, selectedYear]);

    // Load Document.ingestion_metadata.parsed_990 for the selected year's snapshot.
    useEffect(() => {
        if (!currentSnapshot?.document_id) {
            setParsed(null);
            return;
        }
        const ctrl = new AbortController();
        setParsed(null);
        setParsedLoading(true);
        (async () => {
            try {
                const doc = await fetchDocumentDetail(caseId, currentSnapshot.document_id, {
                    signal: ctrl.signal,
                });
                if (ctrl.signal.aborted) return;
                // ingestion_metadata isn't on the DocumentDetail type yet — read defensively.
                const meta = (doc as unknown as { ingestion_metadata?: { parsed_990?: Parsed990 } })
                    .ingestion_metadata;
                setParsed(meta?.parsed_990 ?? null);
            } catch (err) {
                if (!isAbortError(err) && !ctrl.signal.aborted) {
                    // Non-fatal — fall back to whatever the FinancialSnapshot has.
                    setParsed(null);
                }
            } finally {
                if (!ctrl.signal.aborted) setParsedLoading(false);
            }
        })();
        return () => ctrl.abort();
    }, [caseId, currentSnapshot?.document_id]);

    const findingsByAnchor = useMemo(
        () => groupFindingsByAnchor(findings ?? [], selectedYear ?? -1),
        [findings, selectedYear],
    );

    const officerRows = useMemo<OfficerRow[]>(() => {
        const officers = parsed?.part_vii?.officers ?? [];
        return officers.map((o) => ({
            name: o.name ?? "—",
            title: o.title ?? "",
            hours: o.average_hours_per_week ?? null,
            compFromOrg: o.reportable_compensation_from_org ?? null,
            compFromRelated: o.reportable_compensation_from_related_orgs ?? null,
            otherComp: o.estimated_other_compensation ?? null,
            personId: o.person_id ?? null,
        }));
    }, [parsed]);

    // ── Render: top-level states ────────────────────────────────────────
    if (loadError) {
        return (
            <div className={styles.panel}>
                <Header onClose={onClose} years={[]} selectedYear={null} onYearChange={() => undefined} />
                <div className={styles.error}>
                    <AlertCircleIcon size={16} aria-hidden />
                    <span>Couldn&apos;t load 990 data: {loadError}</span>
                </div>
            </div>
        );
    }

    if (snapshots === null) {
        return (
            <div className={styles.panel}>
                <Header onClose={onClose} years={[]} selectedYear={null} onYearChange={() => undefined} />
                <Skeleton />
            </div>
        );
    }

    if (snapshots.length === 0) {
        return (
            <div className={styles.panel}>
                <Header onClose={onClose} years={[]} selectedYear={null} onYearChange={() => undefined} />
                <FetchTeosBar
                    ein={fetchEin}
                    onEinChange={setFetchEin}
                    onFetch={handleFetchFromTeos}
                    loading={fetchLoading}
                    message={fetchMsg}
                />
                <div className={styles.empty}>
                    <FileWarningIcon size={20} aria-hidden />
                    <div>
                        <div className={styles.emptyTitle}>No 990 filings on file</div>
                        <div className={styles.emptyHint}>
                            Enter the org&apos;s EIN above and click Fetch to pull filings from IRS TEOS.
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const years = snapshots.map((s) => s.tax_year);

    if (!currentSnapshot) {
        return (
            <div className={styles.panel}>
                <Header
                    onClose={onClose}
                    years={years}
                    selectedYear={selectedYear}
                    onYearChange={setSelectedYear}
                />
                <div className={styles.empty}>
                    <FileWarningIcon size={20} aria-hidden />
                    <div>
                        <div className={styles.emptyTitle}>
                            No 990 data available for {selectedYear}.
                        </div>
                        <div className={styles.emptyHint}>
                            Try a different year, or pull this year&apos;s filing from the Actions tab.
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.panel}>
            <Header
                onClose={onClose}
                years={years}
                selectedYear={selectedYear}
                onYearChange={setSelectedYear}
                snapshot={currentSnapshot}
            />
            <FetchTeosBar
                ein={fetchEin}
                onEinChange={setFetchEin}
                onFetch={handleFetchFromTeos}
                loading={fetchLoading}
                message={fetchMsg}
            />
            <div className={styles.scroller}>
                <PartI snapshot={currentSnapshot} findings={findingsByAnchor} onOpenFinding={onOpenFinding} />
                <PartIV
                    parsed={parsed}
                    loading={parsedLoading}
                    findings={findingsByAnchor}
                    onOpenFinding={onOpenFinding}
                />
                <PartVI
                    parsed={parsed}
                    loading={parsedLoading}
                    findings={findingsByAnchor}
                    onOpenFinding={onOpenFinding}
                />
                <PartVII
                    rows={officerRows}
                    loading={parsedLoading}
                    snapshot={currentSnapshot}
                    findings={findingsByAnchor}
                    onOpenEntity={onOpenEntity}
                    onOpenFinding={onOpenFinding}
                />
                <PartIX
                    snapshot={currentSnapshot}
                    findings={findingsByAnchor}
                    onOpenFinding={onOpenFinding}
                />
                <Schedules parsed={parsed} loading={parsedLoading} />
            </div>
        </div>
    );
}

/* ───────────────────────────── header ─────────────────────────────────── */

function FetchTeosBar({
    ein,
    onEinChange,
    onFetch,
    loading,
    message,
}: {
    ein: string;
    onEinChange: (v: string) => void;
    onFetch: () => void;
    loading: boolean;
    message: { ok: boolean; text: string } | null;
}) {
    return (
        <div className={styles.fetchBar}>
            <span className={styles.fetchBarLabel}>Fetch from IRS TEOS:</span>
            <input
                className={styles.fetchBarInput}
                type="text"
                placeholder="EIN  e.g. 82-4458479"
                value={ein}
                onChange={(e) => onEinChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !loading && onFetch()}
                aria-label="EIN for IRS TEOS fetch"
            />
            <button
                type="button"
                className={styles.fetchBarBtn}
                onClick={onFetch}
                disabled={loading || !ein.trim()}
            >
                {loading ? "Fetching…" : "Fetch all years"}
            </button>
            {message && (
                <span className={message.ok ? styles.fetchMsgOk : styles.fetchMsgErr}>
                    {message.text}
                </span>
            )}
        </div>
    );
}

function Header({
    onClose,
    years,
    selectedYear,
    onYearChange,
    snapshot,
}: {
    onClose?: () => void;
    years: number[];
    selectedYear: number | null;
    onYearChange: (year: number) => void;
    snapshot?: FinancialSnapshotItem;
}) {
    return (
        <header className={styles.header}>
            <div className={styles.headerTitleWrap}>
                <span className={styles.headerEyebrow}>IRS Form 990</span>
                <span className={styles.headerOrg}>
                    {snapshot?.organization_name ?? "Form 990 viewer"}
                </span>
                {snapshot?.ein && <span className={styles.headerEin}>EIN {snapshot.ein}</span>}
            </div>
            <div className={styles.headerControls}>
                {years.length > 0 && (
                    <label className={styles.yearSelectLabel}>
                        <span className={styles.yearSelectText}>Tax year</span>
                        <span className={styles.yearSelectWrap}>
                            <select
                                className={styles.yearSelect}
                                aria-label="Select tax year"
                                value={selectedYear ?? ""}
                                onChange={(e) => onYearChange(Number(e.target.value))}
                            >
                                {years.map((y) => (
                                    <option key={y} value={y}>
                                        {y}
                                    </option>
                                ))}
                            </select>
                            <ChevronDownIcon size={12} className={styles.yearSelectIcon} aria-hidden />
                        </span>
                    </label>
                )}
                {onClose && (
                    <Tooltip content="Close 990 viewer">
                        <button
                            type="button"
                            className={styles.closeBtn}
                            onClick={onClose}
                            aria-label="Close 990 viewer"
                        >
                            <XIcon size={14} strokeWidth={1.8} />
                        </button>
                    </Tooltip>
                )}
            </div>
        </header>
    );
}

/* ───────────────────────────── sections ───────────────────────────────── */

function Section({
    title,
    subtitle,
    children,
    defaultOpen = true,
}: {
    title: string;
    subtitle?: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <section className={styles.section}>
            <button
                type="button"
                className={styles.sectionHeader}
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open ? "true" : "false"}
            >
                <ChevronDownIcon
                    size={13}
                    className={`${styles.sectionChevron} ${open ? "" : styles.sectionChevronClosed}`}
                    aria-hidden
                />
                <span className={styles.sectionTitle}>{title}</span>
                {subtitle && <span className={styles.sectionSubtitle}>{subtitle}</span>}
            </button>
            {open && <div className={styles.sectionBody}>{children}</div>}
        </section>
    );
}

function Line({
    label,
    value,
    anchor,
    findings,
    onOpenFinding,
}: {
    label: string;
    value: React.ReactNode;
    anchor?: string;
    findings?: Map<string, FindingItem[]>;
    onOpenFinding?: (id: string) => void;
}) {
    const callouts = anchor && findings ? findings.get(anchor) : undefined;
    return (
        <div className={styles.line}>
            <div className={styles.lineRow}>
                <span className={styles.lineLabel}>{label}</span>
                <span className={styles.lineValue}>{value}</span>
            </div>
            {callouts?.map((f) => (
                <InlineCallout key={f.id} finding={f} onOpenFinding={onOpenFinding} />
            ))}
        </div>
    );
}

function InlineCallout({
    finding,
    onOpenFinding,
}: {
    finding: FindingItem;
    onOpenFinding?: (id: string) => void;
}) {
    const sevClass = severityClass(finding.severity);
    return (
        <div className={`${styles.callout} ${sevClass}`} role="note">
            <div className={styles.calloutHeader}>
                <AlertCircleIcon size={13} aria-hidden />
                <span className={styles.calloutRule}>{finding.rule_id}</span>
                <span className={styles.calloutTitle}>{finding.title}</span>
            </div>
            {finding.description && (
                <p className={styles.calloutBody}>{finding.description}</p>
            )}
            <div className={styles.calloutActions}>
                <button
                    type="button"
                    className={styles.calloutBtn}
                    onClick={() => onOpenFinding?.(finding.id)}
                >
                    View flag
                </button>
                <Tooltip content="Dismiss in Pipeline tab">
                    <button
                        type="button"
                        className={styles.calloutBtn}
                        disabled
                        aria-disabled="true"
                    >
                        Dismiss
                    </button>
                </Tooltip>
            </div>
        </div>
    );
}

function severityClass(sev: string): string {
    switch ((sev || "").toUpperCase()) {
        case "CRITICAL":
            return styles.calloutCritical;
        case "HIGH":
            return styles.calloutHigh;
        case "MEDIUM":
            return styles.calloutMedium;
        case "LOW":
            return styles.calloutLow;
        default:
            return styles.calloutNeutral;
    }
}

/* ─── Part I — financials summary ─── */

function PartI({
    snapshot,
    findings,
    onOpenFinding,
}: {
    snapshot: FinancialSnapshotItem;
    findings: Map<string, FindingItem[]>;
    onOpenFinding?: (id: string) => void;
}) {
    return (
        <Section title="Part I — Summary" subtitle="Revenue, expenses, net assets">
            <Line
                label="Total contributions"
                value={fmtUsd(snapshot.total_contributions)}
                anchor="part_i.summary"
                findings={findings}
                onOpenFinding={onOpenFinding}
            />
            <Line label="Program service revenue" value={fmtUsd(snapshot.program_service_revenue)} />
            <Line label="Investment income" value={fmtUsd(snapshot.investment_income)} />
            <Line label="Other revenue" value={fmtUsd(snapshot.other_revenue)} />
            <Line
                label="Total revenue"
                value={<strong>{fmtUsd(snapshot.total_revenue)}</strong>}
                anchor="part_i.revenue"
                findings={findings}
                onOpenFinding={onOpenFinding}
            />
            <Line label="Total expenses" value={fmtUsd(snapshot.total_expenses)} />
            <Line label="Revenue less expenses" value={fmtUsd(snapshot.revenue_less_expenses)} />
            <Line label="Net assets (BOY)" value={fmtUsd(snapshot.net_assets_boy)} />
            <Line label="Net assets (EOY)" value={fmtUsd(snapshot.net_assets_eoy)} />
        </Section>
    );
}

/* ─── Part IV — checklist ─── */

function PartIV({
    parsed,
    loading,
    findings,
    onOpenFinding,
}: {
    parsed: Parsed990 | null;
    loading: boolean;
    findings: Map<string, FindingItem[]>;
    onOpenFinding?: (id: string) => void;
}) {
    if (loading) {
        return (
            <Section title="Part IV — Checklist of Required Schedules">
                <div className={styles.muted}>Loading checklist…</div>
            </Section>
        );
    }
    const p = parsed?.part_iv;
    // Collect any callouts whose anchor is in Part IV — they should surface even
    // if the parsed checklist itself is missing.
    const partIvAnchors = ["part_iv.line_25a", "part_iv.line_28a", "part_iv.line_28"];
    const orphanedCallouts = partIvAnchors
        .flatMap((a) => findings.get(a) ?? [])
        // Dedup in case two anchors point at the same finding
        .filter((f, i, arr) => arr.findIndex((g) => g.id === f.id) === i);

    if (!p || Object.values(p).every((v) => v === null || v === undefined)) {
        return (
            <Section title="Part IV — Checklist of Required Schedules">
                <div className={styles.muted}>
                    No checklist data parsed from this filing yet.
                </div>
                {orphanedCallouts.map((f) => (
                    <InlineCallout key={f.id} finding={f} onOpenFinding={onOpenFinding} />
                ))}
            </Section>
        );
    }
    const lines: Array<{ label: string; key: keyof typeof p; anchor?: string }> = [
        {
            label: "25a — Excess benefit transactions with current officers?",
            key: "line_25a",
            anchor: "part_iv.line_25a",
        },
        { label: "25b — Excess benefit transactions with former officers?", key: "line_25b" },
        { label: "26  — Loans to/from officers, directors, key employees?", key: "line_26" },
        {
            label: "28a — Receivables from current officers or related parties?",
            key: "line_28a",
            anchor: "part_iv.line_28a",
        },
        { label: "28b — Loans to/from officers or related parties?", key: "line_28b" },
        { label: "28c — Grants/assistance to officers or related parties?", key: "line_28c" },
        {
            label: "29  — Business transactions with interested persons?",
            key: "line_29",
            anchor: "part_iv.line_28",
        },
    ];
    return (
        <Section title="Part IV — Checklist of Required Schedules">
            {lines.map((l) => (
                <Line
                    key={l.key as string}
                    label={l.label}
                    value={<YesNoChip value={fmtYesNo(p[l.key])} />}
                    anchor={l.anchor}
                    findings={findings}
                    onOpenFinding={onOpenFinding}
                />
            ))}
        </Section>
    );
}

function YesNoChip({ value }: { value: "Yes" | "No" | "—" }) {
    const cls =
        value === "Yes" ? styles.yesChipYes : value === "No" ? styles.yesChipNo : styles.yesChipNone;
    return <span className={`${styles.yesChip} ${cls}`}>{value}</span>;
}

/* ─── Part VI — governance + policies ─── */

function PartVI({
    parsed,
    loading,
    findings,
    onOpenFinding,
}: {
    parsed: Parsed990 | null;
    loading: boolean;
    findings: Map<string, FindingItem[]>;
    onOpenFinding?: (id: string) => void;
}) {
    if (loading) {
        return (
            <Section title="Part VI — Governance &amp; Policies">
                <div className={styles.muted}>Loading governance data…</div>
            </Section>
        );
    }
    const a = parsed?.part_vi?.section_a;
    const b = parsed?.part_vi?.section_b;
    if (!a && !b) {
        return (
            <Section title="Part VI — Governance &amp; Policies">
                <div className={styles.muted}>
                    No governance data parsed from this filing yet.
                </div>
            </Section>
        );
    }
    return (
        <Section title="Part VI — Governance &amp; Policies">
            <h4 className={styles.sectionSubhead}>Section A — Governing body</h4>
            <Line label="1a — Voting members of the governing body" value={fmtNum(a?.line_1a)} />
            <Line label="1b — Independent voting members" value={fmtNum(a?.line_1b)} />
            <Line
                label="2  — Family or business relationships among officers?"
                value={<YesNoChip value={fmtYesNo(a?.line_2)} />}
            />
            <Line
                label="5  — Significant diversion of assets?"
                value={<YesNoChip value={fmtYesNo(a?.line_5)} />}
                anchor="part_vi.line_5"
                findings={findings}
                onOpenFinding={onOpenFinding}
            />
            <h4 className={styles.sectionSubhead}>Section B — Policies</h4>
            <Line
                label="11 — Form 990 provided to all board members before filing?"
                value={<YesNoChip value={fmtYesNo(b?.line_11)} />}
            />
            <Line
                label="12a — Written conflict of interest policy?"
                value={<YesNoChip value={fmtYesNo(b?.line_12a)} />}
                anchor="part_vi.line_12a"
                findings={findings}
                onOpenFinding={onOpenFinding}
            />
            <Line
                label="13 — Written whistleblower policy?"
                value={<YesNoChip value={fmtYesNo(b?.line_13)} />}
            />
            <Line
                label="14 — Written document retention policy?"
                value={<YesNoChip value={fmtYesNo(b?.line_14)} />}
            />
            <Line
                label="15a — Process for determining CEO compensation?"
                value={<YesNoChip value={fmtYesNo(b?.line_15a)} />}
            />
        </Section>
    );
}

/* ─── Part VII — officers + compensation ─── */

function PartVII({
    rows,
    loading,
    snapshot,
    findings,
    onOpenEntity,
    onOpenFinding,
}: {
    rows: OfficerRow[];
    loading: boolean;
    snapshot: FinancialSnapshotItem;
    findings: Map<string, FindingItem[]>;
    onOpenEntity?: (entityId: string) => void;
    onOpenFinding?: (id: string) => void;
}) {
    const callouts = findings.get("part_vii.compensation");
    if (loading) {
        return (
            <Section title="Part VII — Officers &amp; Compensation">
                <div className={styles.muted}>Loading officers…</div>
            </Section>
        );
    }
    if (rows.length === 0) {
        // Fall back to the FinancialSnapshot officer total when the parsed
        // detail isn't available — better than a blank section.
        return (
            <Section title="Part VII — Officers &amp; Compensation">
                <Line
                    label="Total officer compensation"
                    value={fmtUsd(snapshot.officer_compensation_total)}
                />
                <div className={styles.muted}>
                    Per-officer detail not parsed for this filing.
                </div>
                {callouts?.map((f) => (
                    <InlineCallout key={f.id} finding={f} onOpenFinding={onOpenFinding} />
                ))}
            </Section>
        );
    }
    return (
        <Section title="Part VII — Officers &amp; Compensation">
            <table className={styles.officerTable}>
                <thead>
                    <tr>
                        <th>Name &amp; title</th>
                        <th className={styles.colNum}>Hrs/wk</th>
                        <th className={styles.colMoney}>From org</th>
                        <th className={styles.colMoney}>From related</th>
                        <th className={styles.colMoney}>Other</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r, i) => (
                        <tr key={`${r.name}-${i}`}>
                            <td>
                                {r.personId ? (
                                    <button
                                        type="button"
                                        className={styles.officerLink}
                                        onClick={() => onOpenEntity?.(r.personId as string)}
                                    >
                                        <UserIcon size={11} aria-hidden />
                                        <span>{r.name}</span>
                                    </button>
                                ) : (
                                    <span className={styles.officerName}>
                                        <UserIcon size={11} aria-hidden />
                                        <span>{r.name}</span>
                                    </span>
                                )}
                                {r.title && <div className={styles.officerTitle}>{r.title}</div>}
                            </td>
                            <td className={styles.colNum}>{fmtNum(r.hours)}</td>
                            <td className={styles.colMoney}>{fmtUsd(r.compFromOrg)}</td>
                            <td className={styles.colMoney}>{fmtUsd(r.compFromRelated)}</td>
                            <td className={styles.colMoney}>{fmtUsd(r.otherComp)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {callouts?.map((f) => (
                <InlineCallout key={f.id} finding={f} onOpenFinding={onOpenFinding} />
            ))}
        </Section>
    );
}

/* ─── Part IX — expense breakdown ─── */

function PartIX({
    snapshot,
    findings,
    onOpenFinding,
}: {
    snapshot: FinancialSnapshotItem;
    findings: Map<string, FindingItem[]>;
    onOpenFinding?: (id: string) => void;
}) {
    const total = snapshot.total_expenses ?? 0;
    const programRatio =
        total > 0 && snapshot.grants_paid !== null && snapshot.grants_paid !== undefined
            ? Math.round((snapshot.grants_paid / total) * 100)
            : null;
    return (
        <Section title="Part IX — Expense breakdown">
            <Line label="Grants paid" value={fmtUsd(snapshot.grants_paid)} />
            <Line label="Salaries &amp; compensation" value={fmtUsd(snapshot.salaries_and_compensation)} />
            <Line label="Professional fundraising" value={fmtUsd(snapshot.professional_fundraising)} />
            <Line label="Other expenses" value={fmtUsd(snapshot.other_expenses)} />
            <Line label="Total expenses" value={<strong>{fmtUsd(snapshot.total_expenses)}</strong>} />
            <Line
                label="Program ratio (grants ÷ total expenses)"
                value={programRatio === null ? "—" : `${programRatio}%`}
                anchor="part_ix.program_ratio"
                findings={findings}
                onOpenFinding={onOpenFinding}
            />
        </Section>
    );
}

/* ─── Schedules ─── */

function Schedules({ parsed, loading }: { parsed: Parsed990 | null; loading: boolean }) {
    if (loading) {
        return (
            <Section title="Schedules" defaultOpen={false}>
                <div className={styles.muted}>Loading schedule status…</div>
            </Section>
        );
    }
    // Schedule L is required when any Part IV Line 25–29 is "Yes".
    const partIv = parsed?.part_iv ?? {};
    const scheduleLRequired = ["line_25a", "line_25b", "line_26", "line_28a", "line_28b", "line_28c", "line_29"]
        .map((k) => fmtYesNo((partIv as Record<string, string | null | undefined>)[k]))
        .some((v) => v === "Yes");
    return (
        <Section title="Schedules" defaultOpen={false}>
            <Line
                label="Schedule B — Schedule of Contributors"
                value={<span className={styles.muted}>(filed when contributions ≥ $5K from any one donor)</span>}
            />
            <Line
                label="Schedule L — Transactions With Interested Persons"
                value={
                    scheduleLRequired ? (
                        <span className={`${styles.yesChip} ${styles.yesChipYes}`}>Required</span>
                    ) : (
                        <span className={`${styles.yesChip} ${styles.yesChipNone}`}>Not flagged</span>
                    )
                }
            />
            <Line
                label="Schedule O — Supplemental Information"
                value={
                    <span className={styles.muted}>
                        <BuildingIcon size={11} aria-hidden /> Filed alongside every 990
                    </span>
                }
            />
        </Section>
    );
}

/* ───────────────────────────── skeleton ───────────────────────────────── */

function Skeleton() {
    return (
        <div className={styles.scroller} aria-busy="true">
            {[1, 2, 3].map((i) => (
                <div key={i} className={styles.skeletonSection}>
                    <div className={`${styles.skeletonBar} ${styles.skeletonBarHeader}`} />
                    {[1, 2, 3, 4].map((j) => (
                        <div key={j} className={styles.skeletonBar} />
                    ))}
                </div>
            ))}
        </div>
    );
}
