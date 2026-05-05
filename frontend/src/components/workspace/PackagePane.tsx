/**
 * PackagePane — workspace top-bar view per spec §13.
 *
 * "Where the referral packages get assembled."
 *
 * Four agency lanes (Ohio AG / IRS 13909 / FBI IC3 / FCA OIG), stacked on
 * narrow viewports (<1440px) and side-by-side above. Each lane renders the
 * confirmed findings whose rule_id routes to that agency, lets the user
 * toggle individual findings in/out for that agency, and exposes a
 * `Generate PDF` button that hits the existing `referral-pdf` endpoint.
 *
 * A pre-flight checklist sits above the lanes — every confirmed finding
 * must have ≥1 source document, every entity in a confirmed finding must
 * be linked to ≥1 source document, the graph should be locked, and any
 * dismissed flags ought to have a documented reason.
 *
 * Status pill is in-memory only (Draft → Submitted on PDF success).
 * Persistence lives with the backend once it tracks per-agency submission.
 */
import { useEffect, useMemo, useState } from "react";
import {
    AlertTriangleIcon,
    CheckCircle2Icon,
    DownloadIcon,
    XCircleIcon,
} from "lucide-react";
import { fetchCaseFindings, generateReferralPdf } from "../../api";
import type { FindingItem } from "../../types";
import { Tooltip } from "../ui/Tooltip";
import { toast } from "../ui/Toaster";
import styles from "./PackagePane.module.css";

/* ───────────────────────────── routing table ───────────────────────────── */

export type AgencyId = "ohio_ag" | "irs_13909" | "fbi_ic3" | "fca_oig";

interface AgencyDef {
    id: AgencyId;
    name: string;
    complaintType: string;
}

export const AGENCIES: AgencyDef[] = [
    { id: "ohio_ag", name: "Ohio Attorney General", complaintType: "Charitable Trust complaint" },
    { id: "irs_13909", name: "IRS Form 13909", complaintType: "Tax-Exempt Organization Referral" },
    { id: "fbi_ic3", name: "FBI IC3", complaintType: "Internet Crime / wire fraud complaint" },
    { id: "fca_oig", name: "FCA OIG", complaintType: "Federal program OIG hotline" },
];

/**
 * Default per-rule routing — used when do_good_workflow_spec.md is absent.
 * Any rule_id missing from the table falls back to Ohio AG only.
 */
export const DEFAULT_ROUTING: Record<string, AgencyId[]> = {
    "SR-003": ["ohio_ag"],
    "SR-004": ["ohio_ag", "fca_oig"],
    "SR-005": ["ohio_ag", "irs_13909"],
    "SR-006": ["irs_13909"],
    "SR-010": ["irs_13909"],
    "SR-012": ["irs_13909"],
    "SR-013": ["irs_13909"],
    "SR-015": ["ohio_ag", "irs_13909", "fbi_ic3"],
    "SR-017": ["ohio_ag"],
    "SR-021": ["ohio_ag", "irs_13909"],
    "SR-024": ["ohio_ag", "irs_13909", "fbi_ic3"],
    "SR-025": ["ohio_ag", "irs_13909"],
    "SR-026": ["irs_13909"],
    "SR-028": ["ohio_ag", "irs_13909", "fbi_ic3"],
    "SR-029": ["irs_13909"],
};

export function defaultAgenciesForRule(ruleId: string): AgencyId[] {
    return DEFAULT_ROUTING[ruleId] ?? ["ohio_ag"];
}

/* ───────────────────────────── status types ────────────────────────────── */

type LaneStatus = "Draft" | "Ready" | "Submitted";

interface PreflightItem {
    id: string;
    severity: "ok" | "warn" | "fail";
    label: string;
    subtitle: string;
    /** When true, generation is blocked while this item is non-ok. */
    blocking: boolean;
}

interface Props {
    caseId: string;
    /**
     * Whether the entity graph snapshot is frozen. The Package pane warns
     * (non-blocking) when the graph is unlocked, since the export should be
     * taken against a stable snapshot. Optional — when omitted the preflight
     * row passes; locking lives with the graph until lifted.
     */
    graphLocked?: boolean;
}

/* ───────────────────────────── component ───────────────────────────────── */

export function PackagePane({ caseId, graphLocked }: Props) {
    const [findings, setFindings] = useState<FindingItem[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selection, setSelection] = useState<Record<AgencyId, Set<string>>>(() => emptySelection());
    const [statuses, setStatuses] = useState<Record<AgencyId, LaneStatus>>(() => allDraft());
    const [busy, setBusy] = useState<AgencyId | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetchCaseFindings(caseId);
                if (cancelled) return;
                const confirmed = res.results.filter((f) => f.status === "CONFIRMED");
                setFindings(confirmed);
                setSelection(buildDefaultSelection(confirmed));
            } catch (e) {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : "Failed to load findings");
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [caseId]);

    const preflight = useMemo<PreflightItem[]>(
        () => buildPreflight(findings ?? [], graphLocked),
        [findings, graphLocked],
    );
    const blockingFailure = preflight.some((p) => p.blocking && p.severity !== "ok");

    function toggleFinding(agency: AgencyId, findingId: string) {
        setSelection((prev) => {
            const next: Record<AgencyId, Set<string>> = {
                ohio_ag: new Set(prev.ohio_ag),
                irs_13909: new Set(prev.irs_13909),
                fbi_ic3: new Set(prev.fbi_ic3),
                fca_oig: new Set(prev.fca_oig),
            };
            if (next[agency].has(findingId)) {
                next[agency].delete(findingId);
            } else {
                next[agency].add(findingId);
            }
            return next;
        });
    }

    async function handleGenerate(agency: AgencyId) {
        const ids = Array.from(selection[agency]);
        if (ids.length === 0 || blockingFailure) return;
        setBusy(agency);
        try {
            const blob = await generateReferralPdf(caseId, {
                agency,
                finding_ids: ids,
            } as Parameters<typeof generateReferralPdf>[1]);
            triggerDownload(blob, `referral-${agency}-${caseId}.pdf`);
            setStatuses((s) => ({ ...s, [agency]: "Submitted" }));
            const agencyName = AGENCIES.find((a) => a.id === agency)?.name ?? agency;
            toast.success(`Package downloaded for ${agencyName}`);
        } catch (e) {
            const msg = e instanceof Error ? e.message : "PDF generation failed";
            toast.error(msg);
        } finally {
            setBusy(null);
        }
    }

    if (error) {
        return (
            <div className={styles.pane}>
                <div className={styles.error}>Couldn&apos;t load findings: {error}</div>
            </div>
        );
    }

    if (findings === null) {
        return (
            <div className={styles.pane}>
                <div className={styles.loading}>Loading referral package…</div>
            </div>
        );
    }

    return (
        <div className={styles.pane}>
            <header className={styles.header}>
                <div className={styles.headerLabel}>
                    <span className={styles.headerTitle}>Package</span>
                    <span className={styles.headerSub}>
                        · {findings.length} confirmed finding{findings.length === 1 ? "" : "s"} ·
                        {" "}
                        {Object.values(statuses).filter((s) => s === "Submitted").length} / {AGENCIES.length} agencies sent
                    </span>
                </div>
            </header>

            <PreflightChecklist items={preflight} />

            <div className={styles.lanes}>
                {AGENCIES.map((agency) => {
                    const eligible = findings.filter((f) =>
                        defaultAgenciesForRule(f.rule_id).includes(agency.id),
                    );
                    const selectedIds = selection[agency.id];
                    const selectedCount = eligible.filter((f) => selectedIds.has(f.id)).length;
                    const disabledReason = !blockingFailure && selectedCount > 0
                        ? null
                        : blockingFailure
                            ? "Some confirmed findings have no source documents — fix before exporting"
                            : "No findings selected";
                    return (
                        <AgencyLane
                            key={agency.id}
                            agency={agency}
                            findings={eligible}
                            selectedIds={selectedIds}
                            status={statuses[agency.id]}
                            disabled={Boolean(disabledReason)}
                            disabledReason={disabledReason}
                            busy={busy === agency.id}
                            onToggle={(id) => toggleFinding(agency.id, id)}
                            onGenerate={() => handleGenerate(agency.id)}
                        />
                    );
                })}
            </div>
        </div>
    );
}

/* ───────────────────────────── preflight ───────────────────────────────── */

export function buildPreflight(
    findings: FindingItem[],
    graphLocked: boolean | undefined,
): PreflightItem[] {
    const findingsMissingDocs = findings.filter((f) => f.document_links.length === 0);
    const findingsWithEntityGap = findings.filter((f) =>
        f.entity_links.length > 0 && f.document_links.length === 0,
    );

    return [
        {
            id: "all-findings-have-docs",
            severity: findingsMissingDocs.length === 0 ? "ok" : "fail",
            label: "Every confirmed finding has ≥1 source document",
            subtitle:
                findingsMissingDocs.length === 0
                    ? "All confirmed findings cite at least one document."
                    : `${findingsMissingDocs.length} finding(s) have no source document attached.`,
            blocking: true,
        },
        {
            id: "all-entities-have-docs",
            severity: findingsWithEntityGap.length === 0 ? "ok" : "fail",
            label: "Every entity in a confirmed finding is linked to ≥1 source document",
            subtitle:
                findingsWithEntityGap.length === 0
                    ? "Every named entity has a documented citation."
                    : `${findingsWithEntityGap.length} entity link(s) lack a source document.`,
            blocking: true,
        },
        {
            id: "graph-locked",
            severity: graphLocked === undefined ? "ok" : graphLocked ? "ok" : "warn",
            label: "Graph is locked",
            subtitle:
                graphLocked === undefined
                    ? "Graph snapshot tracking not yet wired — lock manually before exporting."
                    : graphLocked
                        ? "Graph snapshot is frozen for export."
                        : "Lock the graph before exporting to freeze the snapshot.",
            blocking: false,
        },
    ];
}

function PreflightChecklist({ items }: { items: PreflightItem[] }) {
    return (
        <section className={styles.preflight} aria-label="Pre-flight check">
            <header className={styles.preflightHeader}>
                <span className={styles.preflightTitle}>Pre-flight check</span>
                <span className={styles.preflightSub}>
                    Conditions that must hold before any package can be generated.
                </span>
            </header>
            <ul className={styles.preflightList}>
                {items.map((item) => (
                    <li key={item.id} className={styles.preflightItem}>
                        <PreflightIcon severity={item.severity} />
                        <div className={styles.preflightBody}>
                            <div className={styles.preflightLabel}>{item.label}</div>
                            <div className={styles.preflightSubtitle}>{item.subtitle}</div>
                        </div>
                    </li>
                ))}
            </ul>
        </section>
    );
}

function PreflightIcon({ severity }: { severity: PreflightItem["severity"] }) {
    if (severity === "ok") {
        return (
            <CheckCircle2Icon
                size={16}
                strokeWidth={2}
                className={styles.iconOk}
                aria-label="Passing"
            />
        );
    }
    if (severity === "warn") {
        return (
            <AlertTriangleIcon
                size={16}
                strokeWidth={2}
                className={styles.iconWarn}
                aria-label="Warning"
            />
        );
    }
    return (
        <XCircleIcon
            size={16}
            strokeWidth={2}
            className={styles.iconFail}
            aria-label="Failing"
        />
    );
}

/* ───────────────────────────── agency lane ─────────────────────────────── */

interface AgencyLaneProps {
    agency: AgencyDef;
    findings: FindingItem[];
    selectedIds: Set<string>;
    status: LaneStatus;
    disabled: boolean;
    disabledReason: string | null;
    busy: boolean;
    onToggle: (findingId: string) => void;
    onGenerate: () => void;
}

function AgencyLane({
    agency,
    findings,
    selectedIds,
    status,
    disabled,
    disabledReason,
    busy,
    onToggle,
    onGenerate,
}: AgencyLaneProps) {
    return (
        <article className={styles.lane} aria-label={`${agency.name} package lane`}>
            <header className={styles.laneHeader}>
                <div className={styles.laneTitleWrap}>
                    <h3 className={styles.laneTitle}>{agency.name}</h3>
                    <span className={styles.laneType}>{agency.complaintType}</span>
                </div>
                <StatusPill status={status} />
            </header>

            <div className={styles.laneBody}>
                {findings.length === 0 ? (
                    <div className={styles.laneEmpty}>
                        No confirmed findings route to this agency.
                    </div>
                ) : (
                    <ul className={styles.findingList}>
                        {findings.map((f) => {
                            const checked = selectedIds.has(f.id);
                            return (
                                <li key={f.id} className={styles.findingRow}>
                                    <label className={styles.findingLabel}>
                                        <input
                                            type="checkbox"
                                            className={styles.findingCheck}
                                            checked={checked}
                                            onChange={() => onToggle(f.id)}
                                            aria-label={`Include ${f.title} in ${agency.name} package`}
                                        />
                                        <span className={styles.findingText}>
                                            <span className={styles.findingTitle}>{f.title}</span>
                                            <span className={styles.findingMeta}>
                                                {f.rule_id} · {f.severity}
                                            </span>
                                        </span>
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            <footer className={styles.laneFooter}>
                <Tooltip content={disabled ? disabledReason ?? "" : ""}>
                    <button
                        type="button"
                        className={styles.generateBtn}
                        disabled={disabled || busy}
                        onClick={onGenerate}
                    >
                        <DownloadIcon size={13} strokeWidth={1.8} />
                        <span>{busy ? "Generating…" : "Generate PDF"}</span>
                    </button>
                </Tooltip>
            </footer>
        </article>
    );
}

function StatusPill({ status }: { status: LaneStatus }) {
    const cls =
        status === "Submitted"
            ? styles.pillSubmitted
            : status === "Ready"
                ? styles.pillReady
                : styles.pillDraft;
    return <span className={`${styles.pill} ${cls}`}>{status}</span>;
}

/* ───────────────────────────── helpers ─────────────────────────────────── */

function emptySelection(): Record<AgencyId, Set<string>> {
    return {
        ohio_ag: new Set(),
        irs_13909: new Set(),
        fbi_ic3: new Set(),
        fca_oig: new Set(),
    };
}

function allDraft(): Record<AgencyId, LaneStatus> {
    return {
        ohio_ag: "Draft",
        irs_13909: "Draft",
        fbi_ic3: "Draft",
        fca_oig: "Draft",
    };
}

function buildDefaultSelection(findings: FindingItem[]): Record<AgencyId, Set<string>> {
    const sel = emptySelection();
    for (const f of findings) {
        for (const agency of defaultAgenciesForRule(f.rule_id)) {
            sel[agency].add(f.id);
        }
    }
    return sel;
}

function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
