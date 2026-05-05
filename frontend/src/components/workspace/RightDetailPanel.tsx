/**
 * RightDetailPanel — Zone 4 of the workspace per spec §9.
 *
 * Selection-driven contextual panel with four Radix-powered tabs:
 *   Properties — entity attributes (Maltego "Property View")
 *   Sources    — every document that mentions this entity
 *   Flags      — open + recent findings on this entity
 *   Actions    — research transforms runnable on this entity
 *
 * No selection → renders the case subject card (case name, status, document
 * count) as the "you are here" anchor (spec §9 default state).
 *
 * Source / Flag content is pulled from `fetchEntityDetail` which already
 * surfaces `related_documents` and `related_findings`. Actions kick off the
 * existing research API surface; rich result rendering lives in the Transforms
 * tab once step 15 lands.
 */
import { useEffect, useState } from "react";
import {
    Building2Icon,
    ChevronRightIcon,
    CoinsIcon,
    FileTextIcon,
    HouseIcon,
    UserIcon,
    XIcon,
} from "lucide-react";
import { Tabs } from "../ui/Tabs";
import { toast } from "../ui/Toaster";
import {
    fetch990Data,
    fetchEntityDetail,
    isAbortError,
    searchOhioAOS,
    searchOhioSOS,
} from "../../api";
import type { CaseDetail, GraphNode, GraphNodeType } from "../../types";
import { formatDate } from "../../utils/format";
import styles from "./RightDetailPanel.module.css";

interface Props {
    caseDetail: CaseDetail | null;
    selectedNode: GraphNode | null;
    onCollapse: () => void;
    onClearSelection: () => void;
}

interface RelatedDocument {
    id: string;
    filename: string;
    doc_type: string;
    page_reference?: string;
    context_note?: string;
}

interface RelatedFinding {
    id: string;
    title: string;
    severity: string;
    status: string;
    context_note?: string;
}

export function RightDetailPanel({
    caseDetail,
    selectedNode,
    onCollapse,
    onClearSelection,
}: Props) {
    if (!selectedNode) {
        return (
            <CaseSubjectView caseDetail={caseDetail} onCollapse={onCollapse} />
        );
    }
    return (
        <EntityDetailView
            node={selectedNode}
            caseId={caseDetail?.id ?? ""}
            onCollapse={onCollapse}
            onClear={onClearSelection}
        />
    );
}

/* ───────────────────────────── default state ───────────────────────────── */

function CaseSubjectView({
    caseDetail,
    onCollapse,
}: {
    caseDetail: CaseDetail | null;
    onCollapse: () => void;
}) {
    return (
        <div className={styles.panel}>
            <header className={styles.header}>
                <button
                    type="button"
                    className={styles.collapseButton}
                    onClick={onCollapse}
                    aria-label="Collapse detail panel"
                    title="Collapse"
                >
                    <ChevronRightIcon size={14} strokeWidth={1.8} />
                </button>
                <span className={styles.headerTitle}>Detail</span>
            </header>

            <section className={styles.subjectCard}>
                <span className={styles.subjectEyebrow}>Case subject</span>
                <h2 className={styles.subjectName}>
                    {caseDetail?.name ?? "—"}
                </h2>
                {caseDetail && (
                    <dl className={styles.subjectMeta}>
                        <div>
                            <dt>Status</dt>
                            <dd>{caseDetail.status}</dd>
                        </div>
                        <div>
                            <dt>Created</dt>
                            <dd>{formatDate(caseDetail.created_at)}</dd>
                        </div>
                        <div>
                            <dt>Documents</dt>
                            <dd>{caseDetail.documents.length}</dd>
                        </div>
                    </dl>
                )}
            </section>

            <p className={styles.helper}>
                Click an entity on the graph to see its properties, sources, flags, and the
                research actions you can run on it.
            </p>
        </div>
    );
}

/* ───────────────────────────── entity selected ─────────────────────────── */

const TYPE_LABEL: Record<GraphNodeType, string> = {
    person: "Person",
    organization: "Organization",
    property: "Property",
    financial_instrument: "Financial instrument",
};

function EntityIcon({ type }: { type: GraphNodeType }) {
    const props = { size: 18, strokeWidth: 1.7 };
    switch (type) {
        case "person":
            return <UserIcon {...props} className={styles.iconPerson} />;
        case "organization":
            return <Building2Icon {...props} className={styles.iconOrg} />;
        case "property":
            return <HouseIcon {...props} className={styles.iconProperty} />;
        case "financial_instrument":
            return <CoinsIcon {...props} className={styles.iconFinancial} />;
    }
}

function EntityDetailView({
    node,
    caseId,
    onCollapse,
    onClear,
}: {
    node: GraphNode;
    caseId: string;
    onCollapse: () => void;
    onClear: () => void;
}) {
    const [related, setRelated] = useState<{
        documents: RelatedDocument[];
        findings: RelatedFinding[];
    } | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
        const ctrl = new AbortController();
        setRelated(null);
        setLoadError(null);
        (async () => {
            try {
                const data = await fetchEntityDetail(node.type, node.id, { signal: ctrl.signal });
                if (!ctrl.signal.aborted) {
                    setRelated({
                        documents: (data.related_documents as RelatedDocument[] | undefined) ?? [],
                        findings: (data.related_findings as RelatedFinding[] | undefined) ?? [],
                    });
                }
            } catch (err) {
                if (!isAbortError(err) && !ctrl.signal.aborted) {
                    setLoadError(err instanceof Error ? err.message : "Failed to load entity");
                }
            }
        })();
        return () => ctrl.abort();
    }, [node.id, node.type]);

    const docCount = node.metadata.doc_count ?? related?.documents.length ?? 0;
    const findingCount = node.metadata.finding_count ?? related?.findings.length ?? 0;

    return (
        <div className={styles.panel}>
            <header className={styles.header}>
                <button
                    type="button"
                    className={styles.collapseButton}
                    onClick={onCollapse}
                    aria-label="Collapse detail panel"
                    title="Collapse"
                >
                    <ChevronRightIcon size={14} strokeWidth={1.8} />
                </button>
                <span className={styles.headerTitle}>Detail</span>
                <button
                    type="button"
                    className={styles.clearBtn}
                    onClick={onClear}
                    aria-label="Clear selection"
                    title="Clear selection"
                >
                    <XIcon size={13} strokeWidth={1.8} />
                </button>
            </header>

            <section className={styles.entityHeader}>
                <div className={styles.entityIconWrap}>
                    <EntityIcon type={node.type} />
                </div>
                <div className={styles.entityNameWrap}>
                    <h2 className={styles.entityName}>{node.label}</h2>
                    <span className={styles.entityType}>{TYPE_LABEL[node.type]}</span>
                </div>
            </section>

            <Tabs.Root defaultValue="properties" className={styles.tabsRoot}>
                <Tabs.List variant="line">
                    <Tabs.Trigger value="properties">Properties</Tabs.Trigger>
                    <Tabs.Trigger value="sources" badge={docCount || undefined}>Sources</Tabs.Trigger>
                    <Tabs.Trigger value="flags" badge={findingCount || undefined}>Flags</Tabs.Trigger>
                    <Tabs.Trigger value="actions">Actions</Tabs.Trigger>
                </Tabs.List>

                <Tabs.Content value="properties" className={styles.tabContent}>
                    <PropertiesTab node={node} />
                </Tabs.Content>
                <Tabs.Content value="sources" className={styles.tabContent}>
                    <SourcesTab loading={related === null && !loadError} error={loadError} documents={related?.documents ?? []} />
                </Tabs.Content>
                <Tabs.Content value="flags" className={styles.tabContent}>
                    <FlagsTab loading={related === null && !loadError} error={loadError} findings={related?.findings ?? []} />
                </Tabs.Content>
                <Tabs.Content value="actions" className={styles.tabContent}>
                    <ActionsTab caseId={caseId} node={node} />
                </Tabs.Content>
            </Tabs.Root>
        </div>
    );
}

/* ───────────────────────────── tabs ────────────────────────────────────── */

function PropertiesTab({ node }: { node: GraphNode }) {
    const rows = entityPropertyRows(node);
    if (rows.length === 0) {
        return <div className={styles.empty}>No additional attributes recorded.</div>;
    }
    return (
        <dl className={styles.propGrid}>
            {rows.map(([label, value]) => (
                <div key={label} className={styles.propRow}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                </div>
            ))}
        </dl>
    );
}

/**
 * Map a GraphNode to the (label, value) rows shown in the Properties tab.
 * Exported for testing — keeps the per-type formatting deterministic.
 */
export function entityPropertyRows(node: GraphNode): Array<[string, string]> {
    const m = node.metadata;
    const rows: Array<[string, string | undefined | null]> = [];
    rows.push(["ID", node.id.slice(0, 8) + "…"]);

    switch (node.type) {
        case "person":
            if (m.role_tags && m.role_tags.length) rows.push(["Roles", m.role_tags.join(", ")]);
            if (m.aliases && m.aliases.length) rows.push(["Aliases", m.aliases.join(", ")]);
            if (m.date_of_death) rows.push(["Deceased", formatDate(m.date_of_death)]);
            break;
        case "organization":
            if (m.org_type) rows.push(["Type", m.org_type]);
            if (m.ein) rows.push(["EIN", m.ein]);
            if (m.status) rows.push(["Status", m.status]);
            break;
        case "property":
            if (m.parcel_number) rows.push(["Parcel #", m.parcel_number]);
            if (m.county) rows.push(["County", m.county]);
            if (m.assessed_value) rows.push(["Assessed", `$${m.assessed_value}`]);
            if (m.purchase_price) rows.push(["Purchase price", `$${m.purchase_price}`]);
            break;
        case "financial_instrument":
            if (m.instrument_type) rows.push(["Type", m.instrument_type]);
            if (m.filing_number) rows.push(["Filing #", m.filing_number]);
            if (m.filing_date) rows.push(["Filed", formatDate(m.filing_date)]);
            if (m.amount) rows.push(["Amount", `$${m.amount}`]);
            break;
    }

    rows.push(["Findings", String(m.finding_count ?? 0)]);
    rows.push(["Documents", String(m.doc_count ?? 0)]);
    return rows.filter(([, v]) => v !== undefined && v !== null && v !== "") as Array<
        [string, string]
    >;
}

function SourcesTab({
    loading,
    error,
    documents,
}: {
    loading: boolean;
    error: string | null;
    documents: RelatedDocument[];
}) {
    if (loading) return <div className={styles.empty}>Loading…</div>;
    if (error) return <div className={styles.error}>Couldn&apos;t load sources: {error}</div>;
    if (documents.length === 0) {
        return <div className={styles.empty}>No documents cite this entity yet.</div>;
    }
    return (
        <ul className={styles.list}>
            {documents.map((doc) => (
                <li key={doc.id} className={styles.listRow}>
                    <FileTextIcon size={14} className={styles.listIcon} aria-hidden />
                    <div className={styles.listBody}>
                        <div className={styles.listTitle}>{doc.filename}</div>
                        <div className={styles.listMeta}>
                            {[doc.doc_type, doc.page_reference, doc.context_note]
                                .filter(Boolean)
                                .join(" · ")}
                        </div>
                    </div>
                </li>
            ))}
        </ul>
    );
}

function FlagsTab({
    loading,
    error,
    findings,
}: {
    loading: boolean;
    error: string | null;
    findings: RelatedFinding[];
}) {
    if (loading) return <div className={styles.empty}>Loading…</div>;
    if (error) return <div className={styles.error}>Couldn&apos;t load flags: {error}</div>;
    if (findings.length === 0) {
        return <div className={styles.empty}>No flags raised against this entity.</div>;
    }
    return (
        <ul className={styles.list}>
            {findings.map((f) => (
                <li key={f.id} className={styles.listRow}>
                    <span className={`${styles.severityChip} ${severityClass(f.severity)}`}>
                        {f.severity}
                    </span>
                    <div className={styles.listBody}>
                        <div className={styles.listTitle}>{f.title}</div>
                        <div className={styles.listMeta}>
                            {[f.status, f.context_note].filter(Boolean).join(" · ")}
                        </div>
                    </div>
                </li>
            ))}
        </ul>
    );
}

function severityClass(severity: string): string {
    switch ((severity || "").toUpperCase()) {
        case "CRITICAL":
            return styles.sevCritical;
        case "HIGH":
            return styles.sevHigh;
        case "MEDIUM":
            return styles.sevMedium;
        case "LOW":
            return styles.sevLow;
        default:
            return styles.sevNeutral;
    }
}

/* ───────────────────────────── actions ─────────────────────────────────── */

function ActionsTab({ caseId, node }: { caseId: string; node: GraphNode }) {
    const [busy, setBusy] = useState<string | null>(null);
    const ein = node.metadata.ein ?? null;

    async function pull990s() {
        if (!ein) return;
        setBusy("990");
        try {
            const r = await fetch990Data(caseId, ein);
            if (r.fetched > 0) {
                toast.success(`Pulled ${r.fetched} 990 filing(s) for ${node.label}`);
            } else {
                toast.error(r.errors?.[0]?.error ?? "No 990 filings found");
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to pull 990s");
        } finally {
            setBusy(null);
        }
    }

    async function lookupSOS() {
        setBusy("sos");
        try {
            const r = await searchOhioSOS(caseId, node.label);
            toast.success(`Found ${r.count} Ohio SOS match(es) — see Transforms tab`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "SOS search failed");
        } finally {
            setBusy(null);
        }
    }

    async function lookupAOS() {
        setBusy("aos");
        try {
            await searchOhioAOS(caseId, node.label);
            toast.success("Ohio AOS search queued — see Transforms tab");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "AOS search failed");
        } finally {
            setBusy(null);
        }
    }

    const actions: Array<{
        id: string;
        label: string;
        onClick: () => void;
        disabled?: boolean;
        hint?: string;
    }> = [];

    if (node.type === "organization") {
        actions.push({
            id: "990",
            label: "Pull IRS 990 filings",
            onClick: pull990s,
            disabled: !ein,
            hint: ein ? `EIN ${ein}` : "EIN unknown — add it on Properties first",
        });
        actions.push({
            id: "sos",
            label: "Look up in Ohio SOS",
            onClick: lookupSOS,
        });
        actions.push({
            id: "aos",
            label: "Search Ohio AOS audits",
            onClick: lookupAOS,
        });
    } else if (node.type === "person") {
        actions.push({
            id: "sos",
            label: "Look up in Ohio SOS",
            onClick: lookupSOS,
            hint: "Find this person as a registered agent or officer",
        });
    } else {
        return (
            <div className={styles.empty}>
                No transforms wired for {TYPE_LABEL[node.type]} entities yet.
            </div>
        );
    }

    return (
        <div className={styles.actionsList}>
            {actions.map((a) => (
                <button
                    type="button"
                    key={a.id}
                    className={styles.actionBtn}
                    onClick={a.onClick}
                    disabled={a.disabled || busy !== null}
                >
                    <span>{busy === a.id ? "Running…" : a.label}</span>
                    {a.hint && <span className={styles.actionHint}>{a.hint}</span>}
                </button>
            ))}
        </div>
    );
}
