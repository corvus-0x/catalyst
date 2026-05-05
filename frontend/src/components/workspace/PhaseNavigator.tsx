/**
 * PhaseNavigator — Zone 2 / Left rail top section per spec §7.1.
 *
 * Four collapsible phase groups (INGEST · DETECT · INVESTIGATE · DETERMINE)
 * with live counts. Clicking a sub-item fires `onSubsetSelected({phase, subset})`
 * so the parent workspace can filter the bottom dock.
 *
 * Counts are derived from three existing endpoints:
 *   /api/cases/<id>/                  → DocumentItem[] (Ingest buckets)
 *   /api/cases/<id>/findings/         → FindingItem[]  (Detect + Determine)
 *   /api/cases/<id>/jobs/?limit=50    → SearchJobSummary[] (Investigate)
 *
 * The "Package status" row under DETERMINE is intentionally rendered as a
 * disabled muted line — package routing is not yet backed by data and the
 * panel must not lie to the investigator.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { fetchCaseDetail, fetchCaseFindings, fetchCaseJobs } from "../../api";
import {
    DocumentItem,
    FindingItem,
    JobType,
    SearchJobSummary,
} from "../../types";
import { Tooltip } from "../ui/Tooltip";
import styles from "./PhaseNavigator.module.css";

export type PhaseId = "ingest" | "detect" | "investigate" | "determine";

export interface PhaseSubsetSelection {
    phase: PhaseId;
    /** Stable machine key for the sub-item (e.g. "990s", "critical", "irs_teos"). */
    subset: string;
}

interface Props {
    caseId: string;
    /** Fired when the user clicks a sub-item row. Parent uses this to filter the bottom dock. */
    onSubsetSelected?: (selection: PhaseSubsetSelection) => void;
}

interface SubItem {
    /** Stable key passed to onSubsetSelected. */
    key: string;
    /** Label shown to the user. */
    label: string;
    /** Right-aligned count or compact badge text. Null = "—" (data missing). */
    count: string | number | null;
    /** Renders the row dim + struck-through. Used for "── dismissed N". */
    dismissed?: boolean;
    /** Disables click and shows a tooltip. Used for "Package status". */
    disabled?: boolean;
    /** Tooltip content shown on hover when disabled. */
    disabledTooltip?: string;
}

interface PhaseConfig {
    id: PhaseId;
    label: string;
    /** CSS-token name without the `--` prefix, e.g. "info". */
    accentToken: "info" | "danger" | "warn" | "success";
    /** Compact summary shown to the right of the phase header. */
    summary: string;
    items: SubItem[];
}

// ──────────────────────────────────────────────────────────────────────
// Document bucketing — group DocumentType enum into the 4 spec buckets
// ──────────────────────────────────────────────────────────────────────

const DOC_BUCKETS: Record<string, "990s" | "sos" | "recorder" | "uploaded"> = {
    IRS_990: "990s",
    IRS_990T: "990s",
    SOS_FILING: "sos",
    CORP_FILING: "sos",
    DEED: "recorder",
    RECORDER_INSTRUMENT: "recorder",
    MORTGAGE: "recorder",
    LIEN: "recorder",
    UCC: "recorder",
    PARCEL_RECORD: "recorder",
};

function bucketDocs(docs: DocumentItem[]) {
    const counts = { "990s": 0, sos: 0, recorder: 0, uploaded: 0 };
    for (const d of docs) {
        const bucket = DOC_BUCKETS[d.doc_type];
        if (bucket) counts[bucket] += 1;
        else counts.uploaded += 1;
    }
    return counts;
}

// ──────────────────────────────────────────────────────────────────────
// Job-type → display label (only INVESTIGATE-relevant ones; AI excluded
// because §7.1 lists transforms — IRS / SOS / Recorder / AOS)
// ──────────────────────────────────────────────────────────────────────

const JOB_LABELS: Partial<Record<JobType, string>> = {
    IRS_NAME_SEARCH: "IRS TEOS",
    IRS_FETCH_XML: "IRS TEOS",
    OHIO_AOS: "Ohio AOS",
    COUNTY_PARCEL: "County Recorder",
    AI_PATTERN_ANALYSIS: "AI Pattern Analysis",
};

const JOB_KEYS: Partial<Record<JobType, string>> = {
    IRS_NAME_SEARCH: "irs_teos",
    IRS_FETCH_XML: "irs_teos",
    OHIO_AOS: "ohio_aos",
    COUNTY_PARCEL: "county_parcel",
    AI_PATTERN_ANALYSIS: "ai_patterns",
};

// Spec §7.1 lists "Ohio SOS" under INVESTIGATE — we have no async job for SOS
// (it's a sync local-CSV connector) so we surface a static row only when the
// jobs response is non-null, with count 0. This keeps the column visible.
function bucketJobs(jobs: SearchJobSummary[]) {
    const counts = new Map<string, { label: string; count: number }>();
    for (const j of jobs) {
        const label = JOB_LABELS[j.job_type];
        const key = JOB_KEYS[j.job_type];
        if (!label || !key) continue;
        const prev = counts.get(key);
        if (prev) prev.count += 1;
        else counts.set(key, { label, count: 1 });
    }
    return counts;
}

// ──────────────────────────────────────────────────────────────────────
// Findings → DETECT and DETERMINE buckets
// ──────────────────────────────────────────────────────────────────────

interface DetectCounts {
    critical: number;
    high: number;
    medium: number;
    open: number;
    total: number;
    dismissed: number;
}

function bucketFindingsDetect(findings: FindingItem[]): DetectCounts {
    const counts: DetectCounts = {
        critical: 0,
        high: 0,
        medium: 0,
        open: 0,
        total: findings.length,
        dismissed: 0,
    };
    for (const f of findings) {
        if (f.status === "DISMISSED") {
            counts.dismissed += 1;
            continue;
        }
        if (f.status === "NEW") {
            counts.open += 1;
            if (f.severity === "CRITICAL") counts.critical += 1;
            else if (f.severity === "HIGH") counts.high += 1;
            else if (f.severity === "MEDIUM") counts.medium += 1;
        }
    }
    return counts;
}

interface DetermineCounts {
    confirmed: number;
    needsEvidence: number;
    /** Total findings excluding dismissed — denominator for "x / N confirmed". */
    actionable: number;
}

function bucketFindingsDetermine(findings: FindingItem[]): DetermineCounts {
    const counts: DetermineCounts = { confirmed: 0, needsEvidence: 0, actionable: 0 };
    for (const f of findings) {
        if (f.status === "DISMISSED") continue;
        counts.actionable += 1;
        if (f.status === "CONFIRMED") counts.confirmed += 1;
        else if (f.status === "NEEDS_EVIDENCE") counts.needsEvidence += 1;
    }
    return counts;
}

// ──────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────

type LoadState = "loading" | "ready" | "error";

interface FetchResults {
    docs: DocumentItem[] | null;
    findings: FindingItem[] | null;
    jobs: SearchJobSummary[] | null;
    /** True if all three failed — render with "—" placeholders. */
    allFailed: boolean;
}

export function PhaseNavigator({ caseId, onSubsetSelected }: Props) {
    const [state, setState] = useState<LoadState>("loading");
    const [data, setData] = useState<FetchResults>({
        docs: null,
        findings: null,
        jobs: null,
        allFailed: false,
    });
    const [collapsed, setCollapsed] = useState<Record<PhaseId, boolean>>({
        ingest: false,
        detect: false,
        investigate: false,
        determine: false,
    });

    useEffect(() => {
        let cancelled = false;
        setState("loading");

        (async () => {
            const [detailRes, findingsRes, jobsRes] = await Promise.allSettled([
                fetchCaseDetail(caseId),
                fetchCaseFindings(caseId),
                fetchCaseJobs(caseId, 50),
            ]);

            if (cancelled) return;

            const docs =
                detailRes.status === "fulfilled" ? detailRes.value.documents : null;
            const findings =
                findingsRes.status === "fulfilled" ? findingsRes.value.results : null;
            const jobs = jobsRes.status === "fulfilled" ? jobsRes.value : null;

            const allFailed =
                detailRes.status === "rejected" &&
                findingsRes.status === "rejected" &&
                jobsRes.status === "rejected";

            setData({ docs, findings, jobs, allFailed });
            setState(allFailed ? "error" : "ready");
        })();

        return () => {
            cancelled = true;
        };
    }, [caseId]);

    const phases = useMemo<PhaseConfig[]>(
        () => buildPhases(data),
        [data],
    );

    return (
        <nav className={styles.panel} aria-label="Phase navigator">
            <div className={styles.scroller}>
                {phases.map((phase) => (
                    <PhaseGroup
                        key={phase.id}
                        phase={phase}
                        collapsed={collapsed[phase.id]}
                        loading={state === "loading"}
                        onToggle={() =>
                            setCollapsed((c) => ({ ...c, [phase.id]: !c[phase.id] }))
                        }
                        onSubsetSelected={onSubsetSelected}
                    />
                ))}
            </div>
        </nav>
    );
}

// ──────────────────────────────────────────────────────────────────────
// Phase config builder
// ──────────────────────────────────────────────────────────────────────

function buildPhases(data: FetchResults): PhaseConfig[] {
    const docCounts = data.docs ? bucketDocs(data.docs) : null;
    const ingestSummary =
        docCounts === null
            ? "—"
            : `${data.docs!.length} ${data.docs!.length === 1 ? "doc" : "docs"}`;

    const detectCounts = data.findings ? bucketFindingsDetect(data.findings) : null;
    const detectSummary =
        detectCounts === null
            ? "—"
            : `${detectCounts.total} flag${detectCounts.total === 1 ? "" : "s"} · ${detectCounts.open} open`;

    const jobBuckets = data.jobs ? bucketJobs(data.jobs) : null;
    const investigateTotal = jobBuckets
        ? Array.from(jobBuckets.values()).reduce((s, v) => s + v.count, 0)
        : null;
    const investigateSummary =
        investigateTotal === null ? "—" : `${investigateTotal} transforms run`;

    const determineCounts = data.findings ? bucketFindingsDetermine(data.findings) : null;
    const determineSummary =
        determineCounts === null
            ? "—"
            : `${determineCounts.confirmed} / ${determineCounts.actionable} confirmed`;

    return [
        {
            id: "ingest",
            label: "INGEST",
            accentToken: "info",
            summary: ingestSummary,
            items: [
                {
                    key: "990s",
                    label: "990s",
                    count: docCounts ? docCounts["990s"] : null,
                },
                {
                    key: "sos",
                    label: "SOS filings",
                    count: docCounts ? docCounts.sos : null,
                },
                {
                    key: "recorder",
                    label: "Recorder instruments",
                    count: docCounts ? docCounts.recorder : null,
                },
                {
                    key: "uploaded",
                    label: "Uploaded",
                    count: docCounts ? docCounts.uploaded : null,
                },
            ],
        },
        {
            id: "detect",
            label: "DETECT",
            accentToken: "danger",
            summary: detectSummary,
            items: [
                {
                    key: "critical",
                    label: "Critical",
                    count: detectCounts ? detectCounts.critical : null,
                },
                {
                    key: "high",
                    label: "High",
                    count: detectCounts ? detectCounts.high : null,
                },
                {
                    key: "medium",
                    label: "Medium",
                    count: detectCounts ? detectCounts.medium : null,
                },
                {
                    key: "dismissed",
                    label: "── dismissed",
                    count: detectCounts ? detectCounts.dismissed : null,
                    dismissed: true,
                },
            ],
        },
        {
            id: "investigate",
            label: "INVESTIGATE",
            accentToken: "warn",
            summary: investigateSummary,
            items: jobBuckets
                ? Array.from(jobBuckets.entries())
                      .filter(([, v]) => v.count >= 1)
                      .map(([key, v]) => ({ key, label: v.label, count: v.count }))
                : // Loading/error fallback — show all known transform types with "—"
                  Object.entries(JOB_KEYS)
                      .filter(([, k]) => !!k)
                      .map(([, k]) => ({
                          key: k as string,
                          label: JOB_LABELS[
                              Object.keys(JOB_KEYS).find(
                                  (jt) => JOB_KEYS[jt as JobType] === k,
                              ) as JobType
                          ]!,
                          count: null,
                      }))
                      // Dedup by key (IRS_NAME_SEARCH + IRS_FETCH_XML both → irs_teos)
                      .filter(
                          (item, idx, arr) =>
                              arr.findIndex((x) => x.key === item.key) === idx,
                      ),
        },
        {
            id: "determine",
            label: "DETERMINE",
            accentToken: "success",
            summary: determineSummary,
            items: [
                {
                    key: "confirmed",
                    label: "Confirmed findings",
                    count: determineCounts ? determineCounts.confirmed : null,
                },
                {
                    key: "needs_evidence",
                    label: "Needs evidence",
                    count: determineCounts ? determineCounts.needsEvidence : null,
                },
                {
                    key: "package_status",
                    label: "Package status",
                    count: "0 / 4 agencies sent",
                    disabled: true,
                    disabledTooltip:
                        "Package routing tracking not yet implemented",
                },
            ],
        },
    ];
}

// ──────────────────────────────────────────────────────────────────────
// PhaseGroup — header + collapsible body
// ──────────────────────────────────────────────────────────────────────

function PhaseGroup({
    phase,
    collapsed,
    loading,
    onToggle,
    onSubsetSelected,
}: {
    phase: PhaseConfig;
    collapsed: boolean;
    loading: boolean;
    onToggle: () => void;
    onSubsetSelected?: (s: PhaseSubsetSelection) => void;
}) {
    const Chevron = collapsed ? ChevronRightIcon : ChevronDownIcon;
    return (
        <section
            className={`${styles.group} ${styles[`group_${phase.accentToken}`]}`}
            data-phase={phase.id}
        >
            <button
                type="button"
                className={styles.groupHeader}
                onClick={onToggle}
                aria-expanded={!collapsed}
                aria-controls={`phase-body-${phase.id}`}
            >
                <span className={styles.groupChevron}>
                    <Chevron size={11} strokeWidth={2} />
                </span>
                <span className={styles.groupLabel}>{phase.label}</span>
                <span className={styles.groupSummary}>{phase.summary}</span>
            </button>
            {!collapsed && (
                <ul
                    id={`phase-body-${phase.id}`}
                    className={styles.itemList}
                >
                    {loading
                        ? Array.from({ length: 3 }).map((_, i) => (
                              <li key={i} className={styles.skeletonRow}>
                                  <div className={styles.skeletonLabel} />
                                  <div className={styles.skeletonCount} />
                              </li>
                          ))
                        : phase.items.length === 0
                        ? (
                              <li className={styles.emptyRow}>
                                  <span>no transforms run yet</span>
                              </li>
                          )
                        : phase.items.map((item) => (
                              <PhaseItem
                                  key={item.key}
                                  phase={phase.id}
                                  item={item}
                                  onSubsetSelected={onSubsetSelected}
                              />
                          ))}
                </ul>
            )}
        </section>
    );
}

function PhaseItem({
    phase,
    item,
    onSubsetSelected,
}: {
    phase: PhaseId;
    item: SubItem;
    onSubsetSelected?: (s: PhaseSubsetSelection) => void;
}) {
    const display = item.count === null ? "—" : String(item.count);
    const cls = [
        styles.item,
        item.dismissed ? styles.itemDismissed : "",
        item.disabled ? styles.itemDisabled : "",
    ]
        .filter(Boolean)
        .join(" ");

    const row = (
        <li className={cls}>
            <button
                type="button"
                className={styles.itemButton}
                onClick={() => {
                    if (item.disabled) return;
                    onSubsetSelected?.({ phase, subset: item.key });
                }}
                disabled={item.disabled}
            >
                <span className={styles.itemLabel}>{item.label}</span>
                <span className={styles.itemCount}>{display}</span>
            </button>
        </li>
    );

    if (item.disabled && item.disabledTooltip) {
        return (
            <Tooltip content={item.disabledTooltip} side="right">
                {row}
            </Tooltip>
        );
    }
    return row;
}
