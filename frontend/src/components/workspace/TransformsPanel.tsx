/**
 * TransformsPanel — Zone 5 / Transforms tab per spec §10.3.
 *
 * Recent research actions. Like a console log:
 *
 *   14:25 · RUNNING      IRS TEOS · "Do Good In His Name" by name
 *   14:18 · SUCCESS      Ohio SOS · EIN 82-4458479 → 1 result, added to case
 *   14:17 · SUCCESS      IRS TEOS · 82-4458479 → 7 filings, 12 entities
 *
 * - Reverse-chronological. Newest first.
 * - Failed transforms stay visible with a retry button.
 * - SUCCESS rows are clickable (parent decides where to route).
 * - Auto-refreshes every 5s for the first 60s after mount, so RUNNING jobs
 *   flip to SUCCESS without a manual refresh.
 *
 * Data source: existing `fetchCaseJobs(caseId, limit)` API helper. The
 * SearchJobSummary fields drive the row content directly — no derived state
 * lives in the component beyond the fetched list.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckIcon, RefreshCwIcon, RotateCwIcon, XIcon } from "lucide-react";
import { fetchCaseJobs } from "../../api";
import { JobStatus, JobType, SearchJobSummary } from "../../types";
import { Tooltip } from "../ui/Tooltip";
import { formatAbsoluteTime, formatRelativeTime } from "./auditFormatting";
import styles from "./TransformsPanel.module.css";

interface Props {
    caseId?: string;
    /** Click a SUCCESS row → parent decides where to route (toast / focus on graph / open detail). */
    onOpenResult?: (job: SearchJobSummary) => void;
    /** Click retry on a FAILED row → parent re-enqueues with the original query_params. */
    onRetry?: (job: SearchJobSummary) => void;
    /** Live count callback for the dock badge. */
    onLoaded?: (count: number) => void;
    /** How many recent jobs to fetch. Default 25 — the panel virtualizes implicitly via overflow. */
    limit?: number;
}

const POLL_INTERVAL_MS = 5000;
const POLL_DURATION_MS = 60_000;

const JOB_TYPE_LABEL: Record<JobType, string> = {
    IRS_NAME_SEARCH: "IRS TEOS · name",
    IRS_FETCH_XML: "IRS TEOS · EIN",
    OHIO_AOS: "Ohio AOS",
    COUNTY_PARCEL: "County Parcel",
    AI_PATTERN_ANALYSIS: "AI Pattern Analysis",
};

// ─────────────────────────────────────────────────────────────────────
// Field readers — cope with the loosely-typed query_params/result blobs
// ─────────────────────────────────────────────────────────────────────

function readString(obj: unknown, key: string): string | null {
    if (obj && typeof obj === "object" && key in obj) {
        const v = (obj as Record<string, unknown>)[key];
        if (typeof v === "string" && v.length > 0) return v;
        if (typeof v === "number") return String(v);
    }
    return null;
}

function readNumber(obj: unknown, key: string): number | null {
    if (obj && typeof obj === "object" && key in obj) {
        const v = (obj as Record<string, unknown>)[key];
        if (typeof v === "number" && Number.isFinite(v)) return v;
    }
    return null;
}

/** Pull a sensible "what was searched" string out of query_params. */
function querySummary(job: SearchJobSummary): string {
    const params = job.query_params;
    switch (job.job_type) {
        case "IRS_NAME_SEARCH":
            return readString(params, "query") ?? "—";
        case "IRS_FETCH_XML":
            return readString(params, "ein") ?? readString(params, "query") ?? "—";
        case "OHIO_AOS":
            return readString(params, "query") ?? "—";
        case "COUNTY_PARCEL": {
            const q = readString(params, "query") ?? "—";
            const county = readString(params, "county");
            return county ? `${q} · ${county}` : q;
        }
        case "AI_PATTERN_ANALYSIS":
            return readString(params, "scope") ?? "case-wide";
        default:
            return "—";
    }
}

/** Pull a sensible "what came back" string out of result on SUCCESS. */
function resultSummary(job: SearchJobSummary): string {
    if (job.status !== "SUCCESS" || !job.result) return "Done";

    switch (job.job_type) {
        case "IRS_NAME_SEARCH": {
            const count = readNumber(job.result, "count");
            return count !== null ? `${count} filing${count === 1 ? "" : "s"}` : "Done";
        }
        case "IRS_FETCH_XML": {
            const fetched = readNumber(job.result, "fetched");
            return fetched !== null ? `${fetched} fetched` : "Done";
        }
        case "OHIO_AOS":
        case "COUNTY_PARCEL": {
            const count = readNumber(job.result, "count");
            return count !== null ? `${count} result${count === 1 ? "" : "s"}` : "Done";
        }
        case "AI_PATTERN_ANALYSIS": {
            const created = readNumber(job.result, "findings_created");
            return created !== null ? `${created} finding${created === 1 ? "" : "s"}` : "Done";
        }
        default:
            return "Done";
    }
}

function statusChipClass(status: JobStatus): string {
    switch (status) {
        case "QUEUED":
            return styles.chip_queued;
        case "RUNNING":
            return styles.chip_running;
        case "SUCCESS":
            return styles.chip_success;
        case "FAILED":
            return styles.chip_failed;
        default:
            return styles.chip_queued;
    }
}

function rowStateClass(status: JobStatus): string | undefined {
    if (status === "RUNNING") return styles.rowRunning;
    if (status === "FAILED") return styles.rowFailed;
    return undefined;
}

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

export function TransformsPanel({
    caseId,
    onOpenResult,
    onRetry,
    onLoaded,
    limit = 25,
}: Props) {
    const [jobs, setJobs] = useState<SearchJobSummary[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!caseId) {
            setJobs([]);
            return;
        }
        setRefreshing(true);
        setError(null);
        try {
            const results = await fetchCaseJobs(caseId, limit);
            setJobs(results);
            onLoaded?.(results.length);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load transforms");
        } finally {
            setRefreshing(false);
        }
        // onLoaded intentionally excluded — referential identity changes per render
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [caseId, limit]);

    // Initial load
    useEffect(() => {
        let cancelled = false;
        if (!caseId) {
            setJobs([]);
            return;
        }
        (async () => {
            try {
                const results = await fetchCaseJobs(caseId, limit);
                if (!cancelled) {
                    setJobs(results);
                    onLoaded?.(results.length);
                }
            } catch (e) {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : "Failed to load transforms");
                }
            }
        })();
        return () => {
            cancelled = true;
        };
        // onLoaded intentionally excluded — referential identity changes per render
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [caseId, limit]);

    // Auto-refresh: poll every 5s for the first 60s after mount.
    // Single setInterval, cleared on unmount or after the timeout fires.
    useEffect(() => {
        if (!caseId) return;
        const startedAt = Date.now();
        const interval = setInterval(() => {
            if (Date.now() - startedAt >= POLL_DURATION_MS) {
                clearInterval(interval);
                return;
            }
            void load();
        }, POLL_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [caseId, load]);

    // Defensive: ensure newest-first regardless of backend ordering.
    const sortedJobs = useMemo(() => {
        if (!jobs) return null;
        return [...jobs].sort(
            (a, b) =>
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
    }, [jobs]);

    if (jobs === null && !error) {
        return (
            <div className={styles.panel}>
                <Header count={null} refreshing={refreshing} onRefresh={load} />
                <SkeletonList rows={5} />
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.panel}>
                <Header count={null} refreshing={refreshing} onRefresh={load} />
                <div className={styles.error}>
                    <span>Couldn't load transforms: {error}</span>
                    <button type="button" className={styles.retryBtn} onClick={load}>
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    const rows = sortedJobs ?? [];

    if (rows.length === 0) {
        return (
            <div className={styles.panel}>
                <Header count={0} refreshing={refreshing} onRefresh={load} />
                <div className={styles.empty}>
                    No transforms yet — research actions appear here as you run them
                    against an entity.
                </div>
            </div>
        );
    }

    return (
        <div className={styles.panel}>
            <Header count={rows.length} refreshing={refreshing} onRefresh={load} />
            <ul className={styles.list} role="list">
                {rows.map((job) => (
                    <TransformRow
                        key={job.id}
                        job={job}
                        onOpenResult={onOpenResult}
                        onRetry={onRetry}
                        expandedId={expandedId}
                        setExpandedId={setExpandedId}
                    />
                ))}
            </ul>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────
// Row
// ─────────────────────────────────────────────────────────────────────

interface RowProps {
    job: SearchJobSummary;
    onOpenResult?: (job: SearchJobSummary) => void;
    onRetry?: (job: SearchJobSummary) => void;
    expandedId: string | null;
    setExpandedId: (id: string | null) => void;
}

function TransformRow({ job, onOpenResult, onRetry, expandedId, setExpandedId }: RowProps) {
    const clickable = job.status === "SUCCESS" && Boolean(onOpenResult);
    const handleClick = clickable ? () => onOpenResult?.(job) : undefined;
    const handleRetry: React.MouseEventHandler<HTMLButtonElement> = (e) => {
        e.stopPropagation();
        onRetry?.(job);
    };

    const stateClass = rowStateClass(job.status);
    const className = [
        styles.row,
        stateClass,
        clickable ? styles.rowClickable : undefined,
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <li className={className} onClick={handleClick} data-status={job.status}>
            <Tooltip content={formatAbsoluteTime(job.created_at)} side="right">
                <span className={styles.time}>{formatRelativeTime(job.created_at)}</span>
            </Tooltip>

            <span className={`${styles.chip} ${statusChipClass(job.status)}`}>
                <StatusIcon status={job.status} />
                {job.status}
            </span>

            <span className={styles.jobType}>{JOB_TYPE_LABEL[job.job_type] ?? job.job_type}</span>

            <span className={styles.query} title={querySummary(job)}>
                {querySummary(job)}
            </span>

            {job.status === "SUCCESS" && (
                <span className={styles.resultSummary}>
                    {resultSummary(job)}
                    <button
                        type="button"
                        className={styles.resultToggle}
                        onClick={(e) => { e.stopPropagation(); setExpandedId(expandedId === job.id ? null : job.id); }}
                    >
                        {expandedId === job.id ? "Hide result" : "View result"}
                    </button>
                </span>
            )}

            {expandedId === job.id && job.result != null && (
                <pre className={styles.resultJson}>
                    {JSON.stringify(job.result, null, 2)}
                </pre>
            )}

            {job.status === "FAILED" && (
                <>
                    <span className={styles.errorMessage} title={job.error_message}>
                        {job.error_message || "Failed"}
                    </span>
                    {onRetry && (
                        <Tooltip content="Retry">
                            <button
                                type="button"
                                className={styles.retryRowBtn}
                                aria-label="Retry transform"
                                onClick={handleRetry}
                            >
                                <RotateCwIcon size={12} strokeWidth={1.8} />
                            </button>
                        </Tooltip>
                    )}
                </>
            )}
        </li>
    );
}

function StatusIcon({ status }: { status: JobStatus }) {
    if (status === "SUCCESS") {
        return <CheckIcon size={11} strokeWidth={2.2} className={styles.chipIcon} />;
    }
    if (status === "FAILED") {
        return <XIcon size={11} strokeWidth={2.2} className={styles.chipIcon} />;
    }
    if (status === "RUNNING") {
        return <span className={styles.runningDot} aria-hidden="true" />;
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────
// Header / skeleton / empty
// ─────────────────────────────────────────────────────────────────────

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
                <span className={styles.headerTitle}>Transforms</span>
                {count !== null && (
                    <span className={styles.headerCount}>{count} actions</span>
                )}
                <span className={styles.headerSub}>· research console</span>
            </div>
            <Tooltip content="Refresh">
                <button
                    type="button"
                    className={styles.refreshBtn}
                    aria-label="Refresh transforms"
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

function SkeletonList({ rows }: { rows: number }) {
    return (
        <ul className={styles.list} aria-busy="true" role="list">
            {Array.from({ length: rows }).map((_, i) => (
                <li key={i} className={styles.row}>
                    <span className={`${styles.skeleton} ${styles.skeletonShort}`} />
                    <span className={`${styles.skeleton} ${styles.skeletonChip}`} />
                    <span className={`${styles.skeleton} ${styles.skeletonShort}`} />
                    <span className={styles.skeleton} />
                </li>
            ))}
        </ul>
    );
}
