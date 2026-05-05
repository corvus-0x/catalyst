/**
 * DocumentTablePanel — Zone 5 / Documents tab per spec §10.4.
 *
 * "The document table. SHA-256 hash, type, OCR status, page count, filename."
 * OCR status is the critical column — when a 990 is a scanned PDF, this tells
 * the investigator extraction will need OCR.
 *
 * Columns:
 *   Filename   — display_name with full filename in tooltip
 *   Type       — doc_type (uppercase chip)
 *   OCR        — color-coded status badge
 *   Size       — formatted file_size
 *   Hash       — first 8 chars of SHA-256 in monospace; click → copy full hash
 *   Uploaded   — formatted uploaded_at
 *
 * Built on TanStack Table v8 with sortable headers. Default sort: uploaded_at desc.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
    ColumnDef,
    SortingState,
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table";
import { ChevronDownIcon, ChevronUpIcon, ChevronsUpDownIcon, RefreshCwIcon, CopyIcon, UploadIcon } from "lucide-react";
import { fetchCaseDetail } from "../../api";
import { DocumentItem } from "../../types";
import { Tooltip } from "../ui/Tooltip";
import { toast } from "../ui/Toaster";
import { formatDate, formatSize } from "../../utils/format";
import styles from "./DocumentTablePanel.module.css";

interface Props {
    caseId?: string;
    /** Click row → focus document in workspace. v1: no-op stub. */
    onFocusDocument?: (doc: DocumentItem) => void;
    /** Live count callback for dock badge. */
    onLoaded?: (count: number) => void;
}

type OcrTone = "complete" | "running" | "pending" | "failed" | "neutral";

function ocrTone(status: string): OcrTone {
    const s = (status || "").toUpperCase();
    if (s === "COMPLETE" || s === "COMPLETED") return "complete";
    if (s === "RUNNING" || s === "IN_PROGRESS") return "running";
    if (s === "PENDING" || s === "QUEUED") return "pending";
    if (s === "FAILED" || s === "ERROR") return "failed";
    return "neutral";
}

export function DocumentTablePanel({ caseId, onFocusDocument, onLoaded }: Props) {
    const [docs, setDocs] = useState<DocumentItem[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [sorting, setSorting] = useState<SortingState>([
        { id: "uploaded_at", desc: true },
    ]);

    async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files ?? []);
        if (!files.length || !caseId) return;
        setUploading(true);
        try {
            const form = new FormData();
            files.forEach((f) => form.append("files", f));
            const res = await fetch(`/api/cases/${caseId}/documents/bulk/`, {
                method: "POST",
                body: form,
                headers: { "X-CSRFToken": document.cookie.match(/csrftoken=([^;]+)/)?.[1] ?? "" },
            });
            if (!res.ok) throw new Error(`Upload failed (${res.status})`);
            toast.success(`${files.length} file${files.length > 1 ? "s" : ""} uploaded — processing`);
            await load();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Upload failed");
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    }

    async function load() {
        if (!caseId) return;
        setRefreshing(true);
        setError(null);
        try {
            const detail = await fetchCaseDetail(caseId);
            setDocs(detail.documents);
            onLoaded?.(detail.documents.length);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load documents");
        } finally {
            setRefreshing(false);
        }
    }

    useEffect(() => {
        if (!caseId) return;
        let cancelled = false;
        (async () => {
            try {
                const detail = await fetchCaseDetail(caseId);
                if (!cancelled) {
                    setDocs(detail.documents);
                    onLoaded?.(detail.documents.length);
                }
            } catch (e) {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : "Failed to load documents");
                }
            }
        })();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [caseId]);

    const columns = useMemo<ColumnDef<DocumentItem>[]>(
        () => [
            {
                id: "filename",
                accessorFn: (d) => d.display_name || d.filename,
                header: "Filename",
                cell: ({ row }) => {
                    const d = row.original;
                    const display = d.display_name || d.filename;
                    return (
                        <Tooltip content={d.filename} side="top">
                            <span className={styles.filename}>{display}</span>
                        </Tooltip>
                    );
                },
            },
            {
                id: "doc_type",
                accessorKey: "doc_type",
                header: "Type",
                cell: ({ row }) => (
                    <span className={styles.typeChip}>{row.original.doc_type || "—"}</span>
                ),
            },
            {
                id: "ocr_status",
                accessorKey: "ocr_status",
                header: "OCR",
                cell: ({ row }) => {
                    const status = row.original.ocr_status || "—";
                    const tone = ocrTone(status);
                    return (
                        <span className={`${styles.ocrChip} ${styles[`ocr_${tone}`]}`}>
                            {status.toUpperCase()}
                        </span>
                    );
                },
            },
            {
                id: "file_size",
                accessorKey: "file_size",
                header: "Size",
                cell: ({ row }) => (
                    <span className={styles.size}>{formatSize(row.original.file_size)}</span>
                ),
            },
            {
                id: "sha256_hash",
                accessorKey: "sha256_hash",
                header: "Hash",
                enableSorting: false,
                cell: ({ row }) => <HashCell hash={row.original.sha256_hash} />,
            },
            {
                id: "uploaded_at",
                accessorKey: "uploaded_at",
                header: "Uploaded",
                cell: ({ row }) => (
                    <span className={styles.date}>{formatDate(row.original.uploaded_at)}</span>
                ),
            },
        ],
        [],
    );

    const table = useReactTable({
        data: docs ?? [],
        columns,
        state: { sorting },
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
    });

    if (!caseId) {
        return (
            <div className={styles.panel}>
                <div className={styles.empty}>No case selected.</div>
            </div>
        );
    }

    if (docs === null && !error) {
        return (
            <div className={styles.panel}>
                <Header count={null} refreshing={refreshing} uploading={uploading} onRefresh={load} onUploadClick={() => fileInputRef.current?.click()} />
                <SkeletonTable rows={6} />
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.panel}>
                <Header count={null} refreshing={refreshing} uploading={uploading} onRefresh={load} onUploadClick={() => fileInputRef.current?.click()} />
                <div className={styles.error}>
                    <span>Couldn't load documents: {error}</span>
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
                <Header count={0} refreshing={refreshing} uploading={uploading} onRefresh={load} onUploadClick={() => fileInputRef.current?.click()} />
                <div className={styles.empty}>
                    No documents uploaded yet — drag a file or run a transform to populate the case.
                </div>
            </div>
        );
    }

    return (
        <div className={styles.panel}>
            {/* Hidden file input — triggered by Upload button in header */}
            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.txt,.doc,.docx,.csv,.xlsx,.png,.jpg,.jpeg"
                className={styles.hiddenInput}
                onChange={handleUpload}
                aria-hidden="true"
            />
            <Header count={rows.length} refreshing={refreshing} uploading={uploading} onRefresh={load} onUploadClick={() => fileInputRef.current?.click()} />
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
                                className={onFocusDocument ? styles.rowClickable : undefined}
                                onClick={
                                    onFocusDocument ? () => onFocusDocument(row.original) : undefined
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

function HashCell({ hash }: { hash: string }) {
    if (!hash) return <span className={styles.hashEmpty}>—</span>;
    const short = hash.slice(0, 8);

    async function copy(e: React.MouseEvent) {
        e.stopPropagation(); // don't trigger row click
        try {
            await navigator.clipboard.writeText(hash);
            toast.success("SHA-256 copied to clipboard");
        } catch {
            toast.error("Couldn't copy hash");
        }
    }

    return (
        <Tooltip content={`SHA-256 · ${hash} (click to copy)`} side="top">
            <button type="button" className={styles.hashCell} onClick={copy} aria-label="Copy SHA-256 hash">
                <span className={styles.hashShort}>{short}…</span>
                <CopyIcon size={11} className={styles.copyIcon} />
            </button>
        </Tooltip>
    );
}

function Header({
    count,
    refreshing,
    uploading,
    onRefresh,
    onUploadClick,
}: {
    count: number | null;
    refreshing: boolean;
    uploading: boolean;
    onRefresh: () => void;
    onUploadClick: () => void;
}) {
    return (
        <div className={styles.header}>
            <div className={styles.headerLabel}>
                <span className={styles.headerTitle}>Documents</span>
                {count !== null && <span className={styles.headerCount}>{count} files</span>}
                <span className={styles.headerSub}>· SHA-256 chain of custody on every upload</span>
            </div>
            <div className={styles.headerActions}>
                <Tooltip content="Upload documents">
                    <button
                        type="button"
                        className={styles.uploadBtn}
                        aria-label="Upload documents"
                        onClick={onUploadClick}
                        disabled={uploading}
                    >
                        <UploadIcon size={13} strokeWidth={1.8} />
                        <span>{uploading ? "Uploading…" : "Upload"}</span>
                    </button>
                </Tooltip>
            </div>
            <Tooltip content="Refresh">
                <button
                    type="button"
                    className={styles.refreshBtn}
                    aria-label="Refresh documents"
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

function ColGroup() {
    return (
        <colgroup>
            <col className={styles.colFilename} />
            <col className={styles.colType} />
            <col className={styles.colOcr} />
            <col className={styles.colSize} />
            <col className={styles.colHash} />
            <col className={styles.colDate} />
        </colgroup>
    );
}

function SkeletonTable({ rows }: { rows: number }) {
    return (
        <div className={styles.scroller} aria-busy="true">
            <table className={styles.table}>
                <ColGroup />
                <thead>
                    <tr>
                        <th>Filename</th>
                        <th>Type</th>
                        <th>OCR</th>
                        <th>Size</th>
                        <th>Hash</th>
                        <th>Uploaded</th>
                    </tr>
                </thead>
                <tbody>
                    {Array.from({ length: rows }).map((_, i) => (
                        <tr key={i}>
                            <td><div className={styles.skeleton} /></td>
                            <td><div className={`${styles.skeleton} ${styles.skeletonChip}`} /></td>
                            <td><div className={`${styles.skeleton} ${styles.skeletonChip}`} /></td>
                            <td><div className={`${styles.skeleton} ${styles.skeletonShort}`} /></td>
                            <td><div className={`${styles.skeleton} ${styles.skeletonShort}`} /></td>
                            <td><div className={`${styles.skeleton} ${styles.skeletonShort}`} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
