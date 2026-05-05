/**
 * AuditLogPanel — Zone 5 / Audit log tab per spec §10.1.
 *
 * "The chain of custody made visible" — reverse-chronological event stream
 * for the case. Each row clickable to focus the relevant entity / document /
 * finding in the workspace (focus handler is wired by the parent; in v1 it
 * stubs to a no-op until the graph and right-detail panel land).
 *
 * Columns:
 *   Time       — HH:MM (relative day-prefix when not today; full datetime in tooltip)
 *   Event      — Colored chip derived from the AuditAction enum + table_name
 *   Description— `notes` field; falls back to a synthesized line when empty
 *   Source     — `performed_by` (system / username)
 *
 * Built on TanStack Table v8 with sortable headers. Default sort: performed_at desc.
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
import { ChevronDownIcon, ChevronUpIcon, ChevronsUpDownIcon, RefreshCwIcon } from "lucide-react";
import { fetchActivityFeed } from "../../api";
import { ActivityEntry } from "../../types";
import { Tooltip } from "../ui/Tooltip";
import {
    AuditEventCategory,
    auditEventLabel,
    formatRelativeTime,
    formatAbsoluteTime,
} from "./auditFormatting";
import styles from "./AuditLogPanel.module.css";

interface Props {
    caseId?: string;
    /** Called when the user clicks a row. v1: no-op. v2: focus event in workspace. */
    onFocusEvent?: (entry: ActivityEntry) => void;
    /** Called when the entry count changes — lets the bottom dock badge stay live. */
    onLoaded?: (count: number) => void;
    /** How many entries to fetch. Default 100 — bottom dock virtualizes if it grows. */
    limit?: number;
}

export function AuditLogPanel({ caseId, onFocusEvent, onLoaded, limit = 100 }: Props) {
    const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [sorting, setSorting] = useState<SortingState>([
        { id: "performed_at", desc: true },
    ]);

    async function load() {
        setRefreshing(true);
        setError(null);
        try {
            const res = await fetchActivityFeed(limit, caseId);
            setEntries(res.results);
            onLoaded?.(res.results.length);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load audit log");
        } finally {
            setRefreshing(false);
        }
    }

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetchActivityFeed(limit, caseId);
                if (!cancelled) {
                    setEntries(res.results);
                    onLoaded?.(res.results.length);
                }
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load audit log");
            }
        })();
        return () => {
            cancelled = true;
        };
        // onLoaded intentionally excluded from deps — referential identity changes per render
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [caseId, limit]);

    const columns = useMemo<ColumnDef<ActivityEntry>[]>(
        () => [
            {
                id: "performed_at",
                accessorKey: "performed_at",
                header: "Time",
                cell: ({ row }) => {
                    const v = row.original.performed_at;
                    return (
                        <Tooltip content={formatAbsoluteTime(v)} side="right">
                            <span className={styles.time}>{formatRelativeTime(v)}</span>
                        </Tooltip>
                    );
                },
            },
            {
                id: "event",
                header: "Event",
                cell: ({ row }) => {
                    const { label, category } = auditEventLabel(
                        row.original.action,
                        row.original.table_name,
                    );
                    return <EventChip label={label} category={category} />;
                },
            },
            {
                id: "description",
                accessorKey: "notes",
                header: "Description",
                cell: ({ row }) => (
                    <span className={styles.description}>
                        {row.original.notes || synthesizeDescription(row.original)}
                    </span>
                ),
            },
            {
                id: "performed_by",
                accessorKey: "performed_by",
                header: "Source",
                cell: ({ row }) => (
                    <span className={styles.source}>{row.original.performed_by || "system"}</span>
                ),
            },
        ],
        [],
    );

    const table = useReactTable({
        data: entries ?? [],
        columns,
        state: { sorting },
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
    });

    // Loading state — skeleton rows, never a spinner (per spec §15.5)
    if (entries === null && !error) {
        return (
            <div className={styles.panel}>
                <Header
                    count={null}
                    refreshing={refreshing}
                    onRefresh={load}
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
                    <span>Couldn't load audit log: {error}</span>
                    <button type="button" className={styles.retry} onClick={load}>
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    const rows = table.getRowModel().rows;

    if (rows.length === 0) {
        return (
            <div className={styles.panel}>
                <Header count={0} refreshing={refreshing} onRefresh={load} />
                <div className={styles.empty}>
                    No audit events yet — they appear here as you ingest documents and review flags.
                </div>
            </div>
        );
    }

    return (
        <div className={styles.panel}>
            <Header count={rows.length} refreshing={refreshing} onRefresh={load} />
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
                                                {flexRender(h.column.columnDef.header, h.getContext())}
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
                        {rows.map((row) => (
                            <tr
                                key={row.id}
                                className={onFocusEvent ? styles.rowClickable : undefined}
                                onClick={
                                    onFocusEvent ? () => onFocusEvent(row.original) : undefined
                                }
                            >
                                {row.getVisibleCells().map((cell) => (
                                    <td key={cell.id}>
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

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
                <span className={styles.headerTitle}>Audit log</span>
                {count !== null && <span className={styles.headerCount}>{count} events</span>}
                <span className={styles.headerSub}>· chain of custody, append-only</span>
            </div>
            <Tooltip content="Refresh">
                <button
                    type="button"
                    className={styles.refreshBtn}
                    aria-label="Refresh audit log"
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

function EventChip({ label, category }: { label: string; category: AuditEventCategory }) {
    return (
        <span className={`${styles.chip} ${styles[`chip_${category}`]}`}>
            {label}
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
                        <th>Time</th>
                        <th>Event</th>
                        <th>Description</th>
                        <th>Source</th>
                    </tr>
                </thead>
                <tbody>
                    {Array.from({ length: rows }).map((_, i) => (
                        <tr key={i}>
                            <td>
                                <div className={`${styles.skeleton} ${styles.skeletonShort}`} />
                            </td>
                            <td>
                                <div className={`${styles.skeleton} ${styles.skeletonChip}`} />
                            </td>
                            <td>
                                <div className={styles.skeleton} />
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
            <col className={styles.colTime} />
            <col className={styles.colEvent} />
            <col className={styles.colDescription} />
            <col className={styles.colSource} />
        </colgroup>
    );
}

function synthesizeDescription(entry: ActivityEntry): string {
    const subject = entry.table_name.replace(/_/g, " ");
    if (entry.record_id) return `${subject} · ${entry.record_id.slice(0, 8)}`;
    return subject;
}
