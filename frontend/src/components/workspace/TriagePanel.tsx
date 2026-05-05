/**
 * TriagePanel — Zone 5 / Triage tab per spec §10.2.
 *
 * "The flag table. Maltego's multi-select detail view, adapted." A flag in
 * Catalyst is a Finding with status === "NEW" — that's the default filter.
 * Users widen via the status chip group. Selecting a row fires
 * onSelectFinding so the parent can highlight the related entity on the
 * graph (Maltego sync pattern).
 *
 * Columns (sortable):
 *   Severity — color-coded chip (CRITICAL/HIGH/MEDIUM/LOW/INFORMATIONAL)
 *   Rule     — rule_id mono
 *   Title    — finding.title (truncates with ellipsis)
 *   Entity   — first entity_link's name; "—" when none
 *   Status   — chip
 *   Evidence — evidence_weight chip
 *   Source   — AUTO/MANUAL/AI; AI gets a purple badge
 *   Age      — formatDistanceToNowStrict(created_at)
 *
 * Multi-select / bulk actions are out of scope for this PR — single-row
 * click only. (Spec §10.2 mentions bulk dismiss / mark-as-needs-evidence;
 * those land in step 9b.)
 *
 * Built on TanStack Table v8 with sortable headers. Default sort:
 * severity desc → created_at desc (handled in data layer; the table just
 * preserves the order it receives unless the user sorts).
 */
import { useEffect, useMemo, useState } from "react";
import {
    ColumnDef,
    SortingState,
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table";
import {
    ChevronDownIcon,
    ChevronUpIcon,
    ChevronsUpDownIcon,
    RefreshCwIcon,
    SparklesIcon,
} from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { fetchCaseFindings } from "../../api";
import {
    EvidenceWeight,
    FindingItem,
    FindingSeverity,
    FindingSource,
    FindingStatus,
} from "../../types";
import { Tooltip } from "../ui/Tooltip";
import styles from "./TriagePanel.module.css";

interface Props {
    caseId?: string;
    /** Click row → highlight related entity on the graph. */
    onSelectFinding?: (finding: FindingItem) => void;
    /** Live count callback for dock badge. */
    onLoaded?: (count: number) => void;
    /** How many findings to fetch. Default 100. */
    limit?: number;
}

// ─────────────────────────────────────────────────────────────────────
// Filter state
// ─────────────────────────────────────────────────────────────────────

type StatusFilter = "ALL" | FindingStatus;
const STATUS_CHIPS: { key: StatusFilter; label: string }[] = [
    { key: "ALL", label: "All" },
    { key: "NEW", label: "New" },
    { key: "NEEDS_EVIDENCE", label: "Needs evidence" },
    { key: "CONFIRMED", label: "Confirmed" },
    { key: "DISMISSED", label: "Dismissed" },
];

const SEVERITY_CHIPS: { key: FindingSeverity; label: string }[] = [
    { key: "CRITICAL", label: "Critical" },
    { key: "HIGH", label: "High" },
    { key: "MEDIUM", label: "Medium" },
    { key: "LOW", label: "Low" },
];

const SOURCE_CHIPS: { key: FindingSource; label: string }[] = [
    { key: "AUTO", label: "Rule" },
    { key: "MANUAL", label: "Manual" },
    { key: "AI", label: "AI" },
];

// ─────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────

export function TriagePanel({ caseId, onSelectFinding, onLoaded, limit = 100 }: Props) {
    const [findings, setFindings] = useState<FindingItem[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [sorting, setSorting] = useState<SortingState>([
        { id: "created_at", desc: true },
    ]);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    // Filter state — defaults per spec: status=NEW (a "flag")
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("NEW");
    const [severityFilter, setSeverityFilter] = useState<Set<FindingSeverity>>(new Set());
    const [sourceFilter, setSourceFilter] = useState<Set<FindingSource>>(new Set());

    async function load() {
        if (!caseId) return;
        setRefreshing(true);
        setError(null);
        try {
            const res = await fetchCaseFindings(caseId);
            setFindings(res.results);
            onLoaded?.(res.results.length);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load findings");
        } finally {
            setRefreshing(false);
        }
    }

    useEffect(() => {
        if (!caseId) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetchCaseFindings(caseId);
                if (!cancelled) {
                    setFindings(res.results);
                    onLoaded?.(res.results.length);
                }
            } catch (e) {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : "Failed to load findings");
                }
            }
        })();
        return () => {
            cancelled = true;
        };
        // onLoaded intentionally excluded — referential identity changes per render
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [caseId, limit]);

    // Counts per status chip — computed against ALL findings, ignoring
    // the current status filter so the chip labels stay informative.
    const statusCounts = useMemo(() => {
        const counts: Record<StatusFilter, number> = {
            ALL: 0,
            NEW: 0,
            NEEDS_EVIDENCE: 0,
            CONFIRMED: 0,
            DISMISSED: 0,
        };
        if (!findings) return counts;
        // For severity + source chips on the count, we DO apply other filters
        // so the count reflects what flipping this chip would yield.
        const eligible = findings.filter((f) => {
            if (severityFilter.size > 0 && !severityFilter.has(f.severity)) return false;
            if (sourceFilter.size > 0 && !sourceFilter.has(f.source)) return false;
            return true;
        });
        counts.ALL = eligible.length;
        for (const f of eligible) counts[f.status] += 1;
        return counts;
    }, [findings, severityFilter, sourceFilter]);

    const filtered = useMemo<FindingItem[]>(() => {
        if (!findings) return [];
        return findings.filter((f) => {
            if (statusFilter !== "ALL" && f.status !== statusFilter) return false;
            if (severityFilter.size > 0 && !severityFilter.has(f.severity)) return false;
            if (sourceFilter.size > 0 && !sourceFilter.has(f.source)) return false;
            return true;
        });
    }, [findings, statusFilter, severityFilter, sourceFilter]);

    const columns = useMemo<ColumnDef<FindingItem>[]>(
        () => [
            {
                id: "severity",
                accessorFn: (row) => severityRank(row.severity),
                header: "Severity",
                cell: ({ row }) => <SeverityChip severity={row.original.severity} />,
            },
            {
                id: "rule_id",
                accessorKey: "rule_id",
                header: "Rule",
                cell: ({ row }) => (
                    <span className={styles.ruleId}>{row.original.rule_id || "—"}</span>
                ),
            },
            {
                id: "title",
                accessorKey: "title",
                header: "Title",
                cell: ({ row }) => (
                    <Tooltip content={row.original.title}>
                        <span className={styles.title}>{row.original.title}</span>
                    </Tooltip>
                ),
            },
            {
                id: "entity",
                accessorFn: (row) => firstEntityName(row),
                header: "Entity",
                cell: ({ row }) => {
                    const name = firstEntityName(row.original);
                    return <span className={styles.entity}>{name || "—"}</span>;
                },
            },
            {
                id: "status",
                accessorKey: "status",
                header: "Status",
                cell: ({ row }) => <StatusChip status={row.original.status} />,
            },
            {
                id: "evidence_weight",
                accessorKey: "evidence_weight",
                header: "Evidence",
                cell: ({ row }) => <WeightChip weight={row.original.evidence_weight} />,
            },
            {
                id: "source",
                accessorKey: "source",
                header: "Source",
                cell: ({ row }) => <SourceBadge source={row.original.source} />,
            },
            {
                id: "created_at",
                accessorKey: "created_at",
                header: "Age",
                cell: ({ row }) => (
                    <Tooltip content={new Date(row.original.created_at).toLocaleString()} side="left">
                        <span className={styles.age}>{formatAge(row.original.created_at)}</span>
                    </Tooltip>
                ),
            },
        ],
        [],
    );

    const table = useReactTable({
        data: filtered,
        columns,
        state: { sorting },
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
    });

    // ─── States ───────────────────────────────────────────────

    if (findings === null && !error) {
        return (
            <div className={styles.panel}>
                <Header
                    count={null}
                    refreshing={refreshing}
                    onRefresh={load}
                />
                <Filters
                    statusFilter={statusFilter}
                    setStatusFilter={setStatusFilter}
                    statusCounts={statusCounts}
                    severityFilter={severityFilter}
                    toggleSeverity={(s) => toggle(severityFilter, s, setSeverityFilter)}
                    sourceFilter={sourceFilter}
                    toggleSource={(s) => toggle(sourceFilter, s, setSourceFilter)}
                />
                <SkeletonTable rows={6} />
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.panel}>
                <Header count={null} refreshing={refreshing} onRefresh={load} />
                <div className={styles.error}>
                    <span>Couldn't load findings: {error}</span>
                    <button type="button" className={styles.retry} onClick={load}>
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    const rows = table.getRowModel().rows;

    return (
        <div className={styles.panel}>
            <Header count={rows.length} refreshing={refreshing} onRefresh={load} />
            <Filters
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
                statusCounts={statusCounts}
                severityFilter={severityFilter}
                toggleSeverity={(s) => toggle(severityFilter, s, setSeverityFilter)}
                sourceFilter={sourceFilter}
                toggleSource={(s) => toggle(sourceFilter, s, setSourceFilter)}
            />
            {rows.length === 0 ? (
                <div className={styles.empty}>
                    No flags match the current filters — try widening status or clearing
                    severity / source.
                </div>
            ) : (
                <div className={styles.scroller}>
                    <table className={styles.table}>
                        <ColGroup />
                        <thead>
                            {table.getHeaderGroups().map((hg) => (
                                <tr key={hg.id}>
                                    {hg.headers.map((h) => {
                                        const sort = h.column.getIsSorted();
                                        const sortable = h.column.getCanSort();
                                        return (
                                            <th
                                                key={h.id}
                                                onClick={
                                                    sortable
                                                        ? h.column.getToggleSortingHandler()
                                                        : undefined
                                                }
                                                className={sortable ? styles.thSortable : undefined}
                                            >
                                                <span>
                                                    {flexRender(
                                                        h.column.columnDef.header,
                                                        h.getContext(),
                                                    )}
                                                </span>
                                                {sortable && (
                                                    <span className={styles.sortIcon}>
                                                        {sort === "asc" ? (
                                                            <ChevronUpIcon size={11} />
                                                        ) : sort === "desc" ? (
                                                            <ChevronDownIcon size={11} />
                                                        ) : (
                                                            <ChevronsUpDownIcon size={11} />
                                                        )}
                                                    </span>
                                                )}
                                            </th>
                                        );
                                    })}
                                </tr>
                            ))}
                        </thead>
                        <tbody>
                            {rows.map((row) => {
                                const isSelected = selectedId === row.original.id;
                                const handleSelect = () => {
                                    setSelectedId(row.original.id);
                                    onSelectFinding?.(row.original);
                                };
                                return (
                                    <tr
                                        key={row.id}
                                        className={[
                                            onSelectFinding ? styles.rowClickable : "",
                                            isSelected ? styles.rowSelected : "",
                                        ]
                                            .filter(Boolean)
                                            .join(" ")}
                                        onClick={onSelectFinding ? handleSelect : undefined}
                                        aria-selected={isSelected ? "true" : undefined}
                                    >
                                        {row.getVisibleCells().map((cell) => (
                                            <td key={cell.id}>
                                                {flexRender(
                                                    cell.column.columnDef.cell,
                                                    cell.getContext(),
                                                )}
                                            </td>
                                        ))}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────
// Subcomponents
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
                <span className={styles.headerTitle}>Triage</span>
                {count !== null && (
                    <span className={styles.headerCount}>
                        {count} flag{count === 1 ? "" : "s"}
                    </span>
                )}
                <span className={styles.headerSub}>· click a row to highlight on graph</span>
            </div>
            <Tooltip content="Refresh">
                <button
                    type="button"
                    className={styles.refreshBtn}
                    aria-label="Refresh triage"
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

function Filters({
    statusFilter,
    setStatusFilter,
    statusCounts,
    severityFilter,
    toggleSeverity,
    sourceFilter,
    toggleSource,
}: {
    statusFilter: StatusFilter;
    setStatusFilter: (s: StatusFilter) => void;
    statusCounts: Record<StatusFilter, number>;
    severityFilter: Set<FindingSeverity>;
    toggleSeverity: (s: FindingSeverity) => void;
    sourceFilter: Set<FindingSource>;
    toggleSource: (s: FindingSource) => void;
}) {
    return (
        <div className={styles.filters}>
            <div className={styles.filterGroup} role="group" aria-label="Filter by status">
                <span className={styles.filterLabel}>Status:</span>
                {STATUS_CHIPS.map((c) => {
                    const active = statusFilter === c.key;
                    return (
                        <button
                            key={c.key}
                            type="button"
                            className={`${styles.chipBtn} ${active ? styles.chipBtnActive : ""}`}
                            onClick={() => setStatusFilter(c.key)}
                            aria-pressed={active ? "true" : "false"}
                        >
                            {c.label}
                            <span className={styles.chipCount}>{statusCounts[c.key]}</span>
                        </button>
                    );
                })}
            </div>
            <div className={styles.filterGroup} role="group" aria-label="Filter by severity">
                <span className={styles.filterLabel}>Severity:</span>
                {SEVERITY_CHIPS.map((c) => {
                    const active = severityFilter.has(c.key);
                    return (
                        <button
                            key={c.key}
                            type="button"
                            className={`${styles.chipBtn} ${active ? styles.chipBtnActive : ""}`}
                            onClick={() => toggleSeverity(c.key)}
                            aria-pressed={active ? "true" : "false"}
                        >
                            {c.label}
                        </button>
                    );
                })}
            </div>
            <div className={styles.filterGroup} role="group" aria-label="Filter by source">
                <span className={styles.filterLabel}>Source:</span>
                {SOURCE_CHIPS.map((c) => {
                    const active = sourceFilter.has(c.key);
                    return (
                        <button
                            key={c.key}
                            type="button"
                            className={`${styles.chipBtn} ${active ? styles.chipBtnActive : ""}`}
                            onClick={() => toggleSource(c.key)}
                            aria-pressed={active ? "true" : "false"}
                        >
                            {c.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function SeverityChip({ severity }: { severity: FindingSeverity }) {
    const tone = severityTone(severity);
    return <span className={`${styles.chip} ${styles[`chip_${tone}`]}`}>{severity}</span>;
}

function StatusChip({ status }: { status: FindingStatus }) {
    return (
        <span className={`${styles.chip} ${styles[`status_${status}`]}`}>
            {humanStatus(status)}
        </span>
    );
}

function WeightChip({ weight }: { weight: EvidenceWeight }) {
    return (
        <span className={`${styles.chip} ${styles[`weight_${weight}`]}`}>
            {humanWeight(weight)}
        </span>
    );
}

function SourceBadge({ source }: { source: FindingSource }) {
    if (source === "AI") {
        return (
            <span className={`${styles.chip} ${styles.source_AI}`}>
                <SparklesIcon size={10} strokeWidth={2} />
                <span style={{ marginLeft: "0.25rem" }}>AI</span>
            </span>
        );
    }
    return (
        <span className={`${styles.chip} ${styles[`source_${source}`]}`}>
            {source === "AUTO" ? "Rule" : "Manual"}
        </span>
    );
}

function SkeletonTable({ rows }: { rows: number }) {
    return (
        <div className={styles.scroller} aria-busy="true">
            <table className={styles.table}>
                <ColGroup />
                <thead>
                    <tr>
                        <th>Severity</th>
                        <th>Rule</th>
                        <th>Title</th>
                        <th>Entity</th>
                        <th>Status</th>
                        <th>Evidence</th>
                        <th>Source</th>
                        <th>Age</th>
                    </tr>
                </thead>
                <tbody>
                    {Array.from({ length: rows }).map((_, i) => (
                        <tr key={i}>
                            <td>
                                <div className={`${styles.skeleton} ${styles.skeletonChip}`} />
                            </td>
                            <td>
                                <div className={`${styles.skeleton} ${styles.skeletonShort}`} />
                            </td>
                            <td>
                                <div className={styles.skeleton} />
                            </td>
                            <td>
                                <div className={styles.skeleton} />
                            </td>
                            <td>
                                <div className={`${styles.skeleton} ${styles.skeletonChip}`} />
                            </td>
                            <td>
                                <div className={`${styles.skeleton} ${styles.skeletonChip}`} />
                            </td>
                            <td>
                                <div className={`${styles.skeleton} ${styles.skeletonChip}`} />
                            </td>
                            <td>
                                <div className={`${styles.skeleton} ${styles.skeletonShort}`} />
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function ColGroup() {
    return (
        <colgroup>
            <col className={styles.colSeverity} />
            <col className={styles.colRule} />
            <col className={styles.colTitle} />
            <col className={styles.colEntity} />
            <col className={styles.colStatus} />
            <col className={styles.colWeight} />
            <col className={styles.colSource} />
            <col className={styles.colAge} />
        </colgroup>
    );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function firstEntityName(f: FindingItem): string {
    const link = f.entity_links?.[0];
    if (!link) return "";
    // FindingEntityLink has entity_id + entity_type + context_note; we don't
    // currently have a name field on the link, so we fall back to context_note
    // or the id slice. The backend ships a denormalized name in context_note
    // for most rules ("INSIDER_SWAP — Karen Homan") but when it doesn't we
    // gracefully degrade.
    return link.context_note || link.entity_id.slice(0, 8);
}

function severityTone(severity: FindingSeverity): string {
    switch (severity) {
        case "CRITICAL":
            return "critical";
        case "HIGH":
            return "high";
        case "MEDIUM":
            return "med";
        case "LOW":
            return "low";
        case "INFORMATIONAL":
        default:
            return "neutral";
    }
}

function severityRank(severity: FindingSeverity): number {
    switch (severity) {
        case "CRITICAL":
            return 5;
        case "HIGH":
            return 4;
        case "MEDIUM":
            return 3;
        case "LOW":
            return 2;
        case "INFORMATIONAL":
        default:
            return 1;
    }
}

function humanStatus(status: FindingStatus): string {
    switch (status) {
        case "NEW":
            return "New";
        case "NEEDS_EVIDENCE":
            return "Needs evidence";
        case "CONFIRMED":
            return "Confirmed";
        case "DISMISSED":
            return "Dismissed";
        default:
            return status;
    }
}

function humanWeight(weight: EvidenceWeight): string {
    switch (weight) {
        case "SPECULATIVE":
            return "Speculative";
        case "DIRECTIONAL":
            return "Directional";
        case "DOCUMENTED":
            return "Documented";
        case "TRACED":
            return "Traced";
        default:
            return weight;
    }
}

function formatAge(iso: string): string {
    try {
        return formatDistanceToNowStrict(new Date(iso), { addSuffix: false });
    } catch {
        return "—";
    }
}

function toggle<T>(set: Set<T>, key: T, setter: (next: Set<T>) => void) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
}
