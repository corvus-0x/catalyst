/**
 * WorkspaceCommandPalette — global command palette per spec §6 + §15.
 *
 * Cmd/Ctrl+K opens a unified search across the case's entities, documents,
 * and findings. Built on cmdk (keyboard nav + fuzzy filter) inside a Radix
 * Dialog (overlay + portal + dismiss-on-Esc). The global open shortcut is
 * wired with tinykeys.
 *
 * The palette is fully self-contained:
 *   - Pressing Cmd/Ctrl+K toggles it open from anywhere on the page
 *   - The parent can also drive it via the controlled `open` / `onOpenChange`
 *     props — used by the top-bar Find button
 *   - Selecting a result fires `onSelect(result)` with a typed payload so the
 *     parent can route to the entity, document, or finding
 *
 * Data is fetched once on first open (and refreshed when `caseId` changes)
 * from three existing API helpers — graph, case detail, findings. Each result
 * type is capped at 50 entries; cmdk does its own filtering on top.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { tinykeys } from "tinykeys";
import {
    AlertTriangleIcon,
    Building2Icon,
    CoinsIcon,
    FileTextIcon,
    HouseIcon,
    SearchIcon,
    UserIcon,
} from "lucide-react";
import { fetchCaseDetail, fetchCaseFindings, fetchCaseGraph } from "../../api";
import type { DocumentItem, FindingItem, GraphNode, GraphNodeType } from "../../types";
import styles from "./WorkspaceCommandPalette.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommandResult =
    | { type: "entity"; node: GraphNode }
    | { type: "document"; doc: DocumentItem }
    | { type: "finding"; finding: FindingItem };

interface Props {
    caseId: string;
    open: boolean;
    onOpenChange: (next: boolean) => void;
    onSelect: (result: CommandResult) => void;
}

const RESULT_CAP = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function entityIcon(type: GraphNodeType) {
    switch (type) {
        case "person":
            return <UserIcon size={14} aria-hidden />;
        case "organization":
            return <Building2Icon size={14} aria-hidden />;
        case "property":
            return <HouseIcon size={14} aria-hidden />;
        case "financial_instrument":
            return <CoinsIcon size={14} aria-hidden />;
        default:
            return <UserIcon size={14} aria-hidden />;
    }
}

function entityTypeLabel(type: GraphNodeType): string {
    switch (type) {
        case "person":
            return "Person";
        case "organization":
            return "Org";
        case "property":
            return "Property";
        case "financial_instrument":
            return "Instrument";
        default:
            return String(type);
    }
}

function severityChipClass(severity: string): string {
    const upper = (severity || "").toUpperCase();
    if (upper === "CRITICAL") return styles.sev_critical;
    if (upper === "HIGH") return styles.sev_high;
    if (upper === "MEDIUM") return styles.sev_med;
    if (upper === "LOW") return styles.sev_low;
    return styles.sev_neutral;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WorkspaceCommandPalette({ caseId, open, onOpenChange, onSelect }: Props) {
    const [search, setSearch] = useState("");
    const [entities, setEntities] = useState<GraphNode[]>([]);
    const [documents, setDocuments] = useState<DocumentItem[]>([]);
    const [findings, setFindings] = useState<FindingItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadedCaseId, setLoadedCaseId] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    // Global Cmd/Ctrl+K shortcut — fires from anywhere on the page.
    useEffect(() => {
        const unsubscribe = tinykeys(window, {
            "$mod+KeyK": (e) => {
                e.preventDefault();
                onOpenChange(!open);
            },
        });
        return unsubscribe;
    }, [open, onOpenChange]);

    // Reset search when the palette closes so it opens fresh next time.
    useEffect(() => {
        if (!open) {
            setSearch("");
        }
    }, [open]);

    // Load the three result sets the first time the palette opens for this
    // case, and refresh when the case changes.
    useEffect(() => {
        if (!open) return;
        if (loadedCaseId === caseId) return;

        if (abortRef.current) abortRef.current.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setLoading(true);

        const opts = { signal: controller.signal };

        Promise.all([
            fetchCaseGraph(caseId, opts).catch(() => null),
            fetchCaseDetail(caseId, opts).catch(() => null),
            fetchCaseFindings(caseId, opts).catch(() => null),
        ])
            .then(([graph, detail, findingsResp]) => {
                if (controller.signal.aborted) return;
                setEntities((graph?.nodes ?? []).slice(0, RESULT_CAP));
                setDocuments((detail?.documents ?? []).slice(0, RESULT_CAP));
                setFindings((findingsResp?.results ?? []).slice(0, RESULT_CAP));
                setLoadedCaseId(caseId);
                setLoading(false);
            })
            .catch(() => {
                if (controller.signal.aborted) return;
                setLoading(false);
            });

        return () => {
            controller.abort();
        };
        // We intentionally exclude loadedCaseId from the dep array — re-running
        // when it updates would abort the in-flight fetch we just kicked off.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, caseId]);

    const handleSelect = useCallback(
        (result: CommandResult) => {
            onSelect(result);
            onOpenChange(false);
        },
        [onSelect, onOpenChange],
    );

    const totalResults = entities.length + documents.length + findings.length;

    const groupedEntities = useMemo(() => entities.slice(0, RESULT_CAP), [entities]);
    const groupedDocuments = useMemo(() => documents.slice(0, RESULT_CAP), [documents]);
    const groupedFindings = useMemo(() => findings.slice(0, RESULT_CAP), [findings]);

    return (
        <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
            <RadixDialog.Portal>
                <RadixDialog.Overlay className={styles.overlay} />
                <RadixDialog.Content
                    className={styles.content}
                    aria-label="Command palette"
                    onOpenAutoFocus={(e) => {
                        // Let cmdk's input claim focus instead of the dialog content
                        // wrapper, so typing works immediately on open.
                        e.preventDefault();
                    }}
                >
                    <RadixDialog.Title className={styles.srOnly}>
                        Search entities, documents, and findings
                    </RadixDialog.Title>
                    <RadixDialog.Description className={styles.srOnly}>
                        Type to filter across the current case. Press Esc to close.
                    </RadixDialog.Description>
                    <Command label="Catalyst command palette" className={styles.cmd}>
                        <div className={styles.inputRow}>
                            <SearchIcon size={16} className={styles.inputIcon} aria-hidden />
                            <Command.Input
                                value={search}
                                onValueChange={setSearch}
                                placeholder="Search entities, documents, findings..."
                                className={styles.input}
                                autoFocus
                            />
                        </div>
                        <Command.List className={styles.list}>
                            <Command.Empty className={styles.empty}>
                                {loading ? (
                                    <span>Loading…</span>
                                ) : (
                                    <span>No results for "{search}".</span>
                                )}
                            </Command.Empty>
                            {totalResults === 0 && !loading && (
                                <div className={styles.empty} data-testid="cmdk-empty-state">
                                    <div className={styles.emptyState}>
                                        <p>Nothing to search yet for this case.</p>
                                        <p className={styles.emptyHint}>
                                            Press{" "}
                                            <kbd className={styles.kbd}>Cmd</kbd>
                                            <kbd className={styles.kbd}>K</kbd>{" "}
                                            from anywhere to open
                                        </p>
                                    </div>
                                </div>
                            )}

                            {groupedEntities.length > 0 && (
                                <Command.Group heading="Entities" className={styles.group}>
                                    {groupedEntities.map((node) => (
                                        <Command.Item
                                            key={`entity-${node.id}`}
                                            value={`entity ${node.label} ${entityTypeLabel(node.type)}`}
                                            onSelect={() => handleSelect({ type: "entity", node })}
                                            className={styles.item}
                                        >
                                            <span className={styles.itemIcon}>
                                                {entityIcon(node.type)}
                                            </span>
                                            <span className={styles.itemBody}>
                                                <span className={styles.itemTitle}>{node.label}</span>
                                                <span className={styles.itemMeta}>
                                                    {entityTypeLabel(node.type)}
                                                </span>
                                            </span>
                                            <span className={styles.pill}>
                                                {entityTypeLabel(node.type)}
                                            </span>
                                        </Command.Item>
                                    ))}
                                </Command.Group>
                            )}

                            {groupedDocuments.length > 0 && (
                                <Command.Group heading="Documents" className={styles.group}>
                                    {groupedDocuments.map((doc) => {
                                        const name = doc.display_name || doc.filename;
                                        return (
                                            <Command.Item
                                                key={`doc-${doc.id}`}
                                                value={`document ${name} ${doc.doc_type}`}
                                                onSelect={() =>
                                                    handleSelect({ type: "document", doc })
                                                }
                                                className={styles.item}
                                            >
                                                <span className={styles.itemIcon}>
                                                    <FileTextIcon size={14} aria-hidden />
                                                </span>
                                                <span className={styles.itemBody}>
                                                    <span className={styles.itemTitle}>{name}</span>
                                                    <span className={styles.itemMeta}>
                                                        {doc.doc_type || "document"}
                                                    </span>
                                                </span>
                                                <span className={styles.pill}>Doc</span>
                                            </Command.Item>
                                        );
                                    })}
                                </Command.Group>
                            )}

                            {groupedFindings.length > 0 && (
                                <Command.Group heading="Findings" className={styles.group}>
                                    {groupedFindings.map((finding) => (
                                        <Command.Item
                                            key={`finding-${finding.id}`}
                                            value={`finding ${finding.title} ${finding.rule_id}`}
                                            onSelect={() =>
                                                handleSelect({ type: "finding", finding })
                                            }
                                            className={styles.item}
                                        >
                                            <span className={styles.itemIcon}>
                                                <AlertTriangleIcon size={14} aria-hidden />
                                            </span>
                                            <span className={styles.itemBody}>
                                                <span className={styles.itemTitle}>
                                                    {finding.title}
                                                </span>
                                                <span className={styles.itemMeta}>
                                                    <span
                                                        className={[
                                                            styles.sevChip,
                                                            severityChipClass(finding.severity),
                                                        ].join(" ")}
                                                    >
                                                        {finding.severity}
                                                    </span>
                                                    <span className={styles.ruleId}>
                                                        {finding.rule_id}
                                                    </span>
                                                </span>
                                            </span>
                                            <span className={styles.pill}>Finding</span>
                                        </Command.Item>
                                    ))}
                                </Command.Group>
                            )}
                        </Command.List>
                    </Command>
                </RadixDialog.Content>
            </RadixDialog.Portal>
        </RadixDialog.Root>
    );
}

export default WorkspaceCommandPalette;
