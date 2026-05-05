/**
 * ResearchPane — center-canvas pane for running external data connector searches.
 * Toggled via the "Research" button in CaseTopBar (Task 7).
 *
 * Six connectors: IRS Name Search (async), Fetch 990 (sync),
 * Ohio SOS (sync), Ohio AOS (async), County Recorder (sync),
 * County Parcels (async).
 */
import { Fragment, useEffect, useState } from "react";
import {
    addResearchToCase,
    fetch990Data,
    searchOhioSOS,
    searchRecorder,
} from "../../api";
import { useAsyncJob } from "../../hooks/useAsyncJob";
import { toast } from "../ui/Toaster";
import styles from "./ResearchPane.module.css";

type Connector = "irs-search" | "fetch-990" | "ohio-sos" | "ohio-aos" | "recorder" | "parcels";

const CONNECTORS: { id: Connector; label: string }[] = [
    { id: "irs-search", label: "IRS Search" },
    { id: "fetch-990", label: "Fetch 990" },
    { id: "ohio-sos", label: "Ohio SOS" },
    { id: "ohio-aos", label: "Ohio AOS" },
    { id: "recorder", label: "Recorder" },
    { id: "parcels", label: "Parcels" },
];

const OHIO_COUNTIES = [
    "Allen", "Ashland", "Ashtabula", "Athens", "Auglaize", "Belmont", "Butler",
    "Clark", "Clermont", "Clinton", "Columbiana", "Coshocton", "Crawford",
    "Cuyahoga", "Darke", "Delaware", "Erie", "Fairfield", "Fayette", "Franklin",
    "Fulton", "Geauga", "Greene", "Guernsey", "Hamilton", "Hancock", "Hardin",
    "Harrison", "Henry", "Highland", "Hocking", "Holmes", "Huron", "Jackson",
    "Jefferson", "Knox", "Lake", "Lawrence", "Licking", "Logan", "Lorain", "Lucas",
    "Madison", "Mahoning", "Marion", "Medina", "Meigs", "Mercer", "Miami",
    "Montgomery", "Morgan", "Morrow", "Muskingum", "Noble", "Ottawa", "Paulding",
    "Perry", "Pickaway", "Pike", "Portage", "Preble", "Putnam", "Richland", "Ross",
    "Sandusky", "Scioto", "Seneca", "Shelby", "Stark", "Summit", "Trumbull",
    "Tuscarawas", "Union", "Van Wert", "Vinton", "Warren", "Washington", "Wayne",
    "Williams", "Wood", "Wyandot",
];

interface ResearchResult {
    id: string;
    summary: string;
    fields: { key: string; value: string }[];
    rawData: unknown;
    source: string;
}

interface Props {
    caseId: string;
    onAdded?: () => void;
}

export function ResearchPane({ caseId, onAdded }: Props) {
    const [active, setActive] = useState<Connector>("irs-search");
    const [results, setResults] = useState<ResearchResult[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [addingId, setAddingId] = useState<string | null>(null);
    const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

    function handleConnectorChange(c: Connector) {
        setActive(c);
        setResults([]);
        setSelectedId(null);
    }

    async function handleAddToCase(result: ResearchResult) {
        setAddingId(result.id);
        try {
            await addResearchToCase(caseId, result.source, result.rawData as Record<string, unknown>);
            setAddedIds((prev) => new Set([...prev, result.id]));
            toast.success("Added to case");
            onAdded?.();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to add to case");
        } finally {
            setAddingId(null);
        }
    }

    const selectedResult = results.find((r) => r.id === selectedId) ?? null;

    const sharedProps = {
        caseId,
        results,
        onResults: setResults,
        selectedId,
        onSelect: setSelectedId,
        selectedResult,
        addingId,
        addedIds,
        onAdd: handleAddToCase,
    };

    return (
        <div className={styles.pane}>
            <div className={styles.tabStrip} role="tablist">
                {CONNECTORS.map((c) => (
                    <button
                        key={c.id}
                        role="tab"
                        aria-selected={active === c.id}
                        className={`${styles.tab} ${active === c.id ? styles.tabActive : ""}`}
                        onClick={() => handleConnectorChange(c.id)}
                    >
                        {c.label}
                    </button>
                ))}
            </div>
            <div className={styles.body}>
                {active === "irs-search" && <IrsSearchTab {...sharedProps} />}
                {active === "fetch-990" && <Fetch990Tab {...sharedProps} />}
                {active === "ohio-sos" && <OhioSosTab {...sharedProps} />}
                {active === "ohio-aos" && <OhioAosTab {...sharedProps} />}
                {active === "recorder" && <RecorderTab {...sharedProps} />}
                {active === "parcels" && <ParcelsTab {...sharedProps} />}
            </div>
        </div>
    );
}

/* ── Shared props ──────────────────────────────────────────────── */

interface TabSharedProps {
    caseId: string;
    onResults: (r: ResearchResult[]) => void;
    results: ResearchResult[];
    selectedId: string | null;
    onSelect: (id: string | null) => void;
    selectedResult: ResearchResult | null;
    addingId: string | null;
    addedIds: Set<string>;
    onAdd: (r: ResearchResult) => void;
}

/* ── Shared ResultsArea ────────────────────────────────────────── */

function ResultsArea({
    results, selectedId, onSelect, selectedResult, addingId, addedIds, onAdd,
}: Omit<TabSharedProps, "caseId" | "onResults">) {
    if (results.length === 0) return null;
    return (
        <div className={styles.results}>
            {results.map((r) => {
                const isSelected = selectedId === r.id;
                return (
                    <div
                        key={r.id}
                        className={`${styles.resultRow} ${isSelected ? styles.resultRowActive : ""}`}
                        onClick={() => onSelect(isSelected ? null : r.id)}
                    >
                        <div className={styles.resultSummary}>{r.summary}</div>
                        {isSelected && selectedResult && (
                            <div className={styles.resultDetail}>
                                <dl className={styles.detailGrid}>
                                    {selectedResult.fields.map((f) => (
                                        <Fragment key={f.key}>
                                            <dt className={styles.detailKey}>{f.key}</dt>
                                            <dd className={styles.detailVal}>{f.value || "—"}</dd>
                                        </Fragment>
                                    ))}
                                </dl>
                                <div className={styles.detailActions}>
                                    {addedIds.has(r.id) ? (
                                        <span className={styles.addedBadge}>Added to case</span>
                                    ) : (
                                        <button
                                            type="button"
                                            className={styles.addBtn}
                                            disabled={addingId === r.id}
                                            onClick={(e) => { e.stopPropagation(); onAdd(r); }}
                                        >
                                            {addingId === r.id ? "Adding…" : "Add to Case"}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        className={styles.clearBtn}
                                        onClick={(e) => { e.stopPropagation(); onSelect(null); }}
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

/* ── IRS Name Search (async) ───────────────────────────────────── */

function IrsSearchTab({ caseId, onResults, ...shared }: TabSharedProps) {
    const [query, setQuery] = useState("");
    const job = useAsyncJob<{ results?: unknown[]; count?: number }>({
        postUrl: `/api/cases/${caseId}/research/irs/`,
    });

    useEffect(() => {
        if (job.status !== "success" || !job.result) return;
        const items = (job.result.results ?? []) as Record<string, unknown>[];
        onResults(
            items.map((r, i) => ({
                id: String(i),
                summary: `${String(r.name ?? r.taxpayer_name ?? "Unknown")} · EIN ${String(r.ein ?? "—")}`,
                fields: Object.entries(r)
                    .slice(0, 10)
                    .map(([k, v]) => ({ key: k, value: String(v ?? "") })),
                rawData: r,
                source: "irs_teos",
            })),
        );
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [job.status, job.result]);

    async function handleSearch() {
        if (!query.trim()) return;
        onResults([]);
        await job.run({ query: query.trim() });
    }

    const busy = job.status === "queued" || job.status === "running";
    return (
        <>
            <div className={styles.searchArea}>
                <div className={styles.searchRow}>
                    <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>Organization name</label>
                        <input
                            className={styles.input}
                            type="text"
                            placeholder="e.g. Do Good in His Name"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && !busy && void handleSearch()}
                        />
                    </div>
                    <button
                        className={styles.searchBtn}
                        onClick={() => void handleSearch()}
                        disabled={busy || !query.trim()}
                    >
                        {busy ? "Searching…" : "Search"}
                    </button>
                </div>
                {busy && (
                    <span className={styles.statusLine}>
                        Searching IRS TEOS index… this can take 15–30s
                    </span>
                )}
                {job.status === "failed" && (
                    <span className={`${styles.statusLine} ${styles.statusError}`}>{job.error}</span>
                )}
                {job.status === "success" && (
                    <span className={styles.statusLine}>{shared.results.length} result(s)</span>
                )}
            </div>
            {shared.results.length === 0 && !busy && (
                <div className={styles.empty}>Enter an organization name and click Search</div>
            )}
            <ResultsArea {...shared} />
        </>
    );
}

/* ── Fetch 990 by EIN (sync) ───────────────────────────────────── */

function Fetch990Tab({ caseId, onResults, ...shared }: TabSharedProps) {
    const [ein, setEin] = useState("");
    const [loading, setLoading] = useState(false);
    const [statusMsg, setStatusMsg] = useState<string | null>(null);
    const [isError, setIsError] = useState(false);

    async function handleFetch() {
        if (!ein.trim()) return;
        setLoading(true);
        setStatusMsg(null);
        onResults([]);
        try {
            const res = await fetch990Data(caseId, ein.trim());
            const filings = res.filings ?? [];
            const mapped = filings.map((f, i) => ({
                id: String(i),
                summary: `${f.taxpayer_name ?? ein} · ${f.return_type ?? "990"} · Tax year ${f.tax_year ?? "—"}`,
                fields: [
                    { key: "Tax year", value: String(f.tax_year ?? "") },
                    { key: "Form type", value: String(f.return_type ?? "") },
                    {
                        key: "Total revenue",
                        value: f.total_revenue != null
                            ? `$${Number(f.total_revenue).toLocaleString()}`
                            : "—",
                    },
                    {
                        key: "Total expenses",
                        value: f.total_expenses != null
                            ? `$${Number(f.total_expenses).toLocaleString()}`
                            : "—",
                    },
                    { key: "Officers", value: String(f.officers_count ?? "—") },
                    {
                        key: "Parse quality",
                        value: f.parse_quality != null
                            ? `${Math.round(Number(f.parse_quality) * 100)}%`
                            : "—",
                    },
                ],
                rawData: f as unknown as Record<string, unknown>,
                source: "irs_teos",
            }));
            onResults(mapped);
            setStatusMsg(`Fetched ${res.fetched} filing(s)`);
            setIsError(false);
        } catch (e) {
            setStatusMsg(e instanceof Error ? e.message : "Fetch failed");
            setIsError(true);
        } finally {
            setLoading(false);
        }
    }

    return (
        <>
            <div className={styles.searchArea}>
                <div className={styles.searchRow}>
                    <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>EIN (e.g. 82-4458479)</label>
                        <input
                            className={styles.input}
                            type="text"
                            placeholder="XX-XXXXXXX"
                            value={ein}
                            onChange={(e) => setEin(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && !loading && void handleFetch()}
                        />
                    </div>
                    <button
                        className={styles.searchBtn}
                        onClick={() => void handleFetch()}
                        disabled={loading || !ein.trim()}
                    >
                        {loading ? "Fetching…" : "Fetch all years"}
                    </button>
                </div>
                {statusMsg && (
                    <span className={`${styles.statusLine} ${isError ? styles.statusError : ""}`}>
                        {statusMsg}
                    </span>
                )}
            </div>
            {shared.results.length === 0 && !loading && (
                <div className={styles.empty}>
                    Enter an EIN to pull all available 990 filings from IRS TEOS
                </div>
            )}
            <ResultsArea {...shared} />
        </>
    );
}

/* ── Ohio SOS (sync) ───────────────────────────────────────────── */

function OhioSosTab({ caseId, onResults, ...shared }: TabSharedProps) {
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [statusMsg, setStatusMsg] = useState<string | null>(null);
    const [isError, setIsError] = useState(false);

    async function handleSearch() {
        if (!query.trim()) return;
        setLoading(true);
        setStatusMsg(null);
        onResults([]);
        try {
            const res = await searchOhioSOS(caseId, query.trim());
            const items = (res as unknown as { results?: Record<string, unknown>[] }).results ?? [];
            const mapped = items.map((r, i) => ({
                id: String(i),
                summary: `${String(r.name ?? r.entity_name ?? "Unknown")} · ${String(r.entity_number ?? "")}`,
                fields: Object.entries(r)
                    .slice(0, 12)
                    .map(([k, v]) => ({ key: k, value: String(v ?? "") })),
                rawData: r,
                source: "ohio_sos",
            }));
            onResults(mapped);
            setStatusMsg(`${items.length} result(s)`);
            setIsError(false);
        } catch (e) {
            setStatusMsg(e instanceof Error ? e.message : "Search failed");
            setIsError(true);
        } finally {
            setLoading(false);
        }
    }

    return (
        <>
            <div className={styles.searchArea}>
                <div className={styles.searchRow}>
                    <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>Entity name or number</label>
                        <input
                            className={styles.input}
                            type="text"
                            placeholder="e.g. Do Good in His Name"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && !loading && void handleSearch()}
                        />
                    </div>
                    <button
                        className={styles.searchBtn}
                        onClick={() => void handleSearch()}
                        disabled={loading || !query.trim()}
                    >
                        {loading ? "Searching…" : "Search"}
                    </button>
                </div>
                {statusMsg && (
                    <span className={`${styles.statusLine} ${isError ? styles.statusError : ""}`}>
                        {statusMsg}
                    </span>
                )}
            </div>
            {shared.results.length === 0 && !loading && (
                <div className={styles.empty}>Search Ohio Secretary of State business registrations</div>
            )}
            <ResultsArea {...shared} />
        </>
    );
}

/* ── Ohio AOS (async) ──────────────────────────────────────────── */

function OhioAosTab({ caseId, onResults, ...shared }: TabSharedProps) {
    const [query, setQuery] = useState("");
    const job = useAsyncJob<{ results?: unknown[]; count?: number }>({
        postUrl: `/api/cases/${caseId}/research/ohio-aos/`,
    });

    useEffect(() => {
        if (job.status !== "success" || !job.result) return;
        const items = (job.result.results ?? []) as Record<string, unknown>[];
        onResults(
            items.map((r, i) => ({
                id: String(i),
                summary: `${String(r.entity_name ?? r.name ?? "Unknown")} · ${String(r.finding_type ?? r.report_type ?? "")}`,
                fields: Object.entries(r)
                    .slice(0, 10)
                    .map(([k, v]) => ({ key: k, value: String(v ?? "") })),
                rawData: r,
                source: "ohio_aos",
            })),
        );
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [job.status, job.result]);

    async function handleSearch() {
        if (!query.trim()) return;
        onResults([]);
        await job.run({ query: query.trim() });
    }

    const busy = job.status === "queued" || job.status === "running";
    return (
        <>
            <div className={styles.searchArea}>
                <div className={styles.searchRow}>
                    <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>Entity name</label>
                        <input
                            className={styles.input}
                            type="text"
                            placeholder="e.g. Do Good in His Name"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && !busy && void handleSearch()}
                        />
                    </div>
                    <button
                        className={styles.searchBtn}
                        onClick={() => void handleSearch()}
                        disabled={busy || !query.trim()}
                    >
                        {busy ? "Searching…" : "Search"}
                    </button>
                </div>
                {busy && (
                    <span className={styles.statusLine}>Searching Ohio Auditor of State…</span>
                )}
                {job.status === "failed" && (
                    <span className={`${styles.statusLine} ${styles.statusError}`}>{job.error}</span>
                )}
                {job.status === "success" && (
                    <span className={styles.statusLine}>{shared.results.length} result(s)</span>
                )}
            </div>
            {shared.results.length === 0 && !busy && (
                <div className={styles.empty}>Search Ohio Auditor of State audit findings</div>
            )}
            <ResultsArea {...shared} />
        </>
    );
}

/* ── County Recorder (sync) ────────────────────────────────────── */

function RecorderTab({ caseId, onResults, ...shared }: TabSharedProps) {
    const [county, setCounty] = useState("Franklin");
    const [name, setName] = useState("");
    const [loading, setLoading] = useState(false);
    const [statusMsg, setStatusMsg] = useState<string | null>(null);
    const [isError, setIsError] = useState(false);

    async function handleSearch() {
        if (!name.trim()) return;
        setLoading(true);
        setStatusMsg(null);
        onResults([]);
        try {
            const res = await searchRecorder(caseId, county, name.trim());
            const items = (res as unknown as { results?: Record<string, unknown>[] }).results ?? [];
            const searchUrl = (res as unknown as { search_url?: string }).search_url;
            if (searchUrl && items.length === 0) {
                onResults([
                    {
                        id: "0",
                        summary: `${county} County Recorder — external portal`,
                        fields: [
                            { key: "County", value: county },
                            { key: "Search name", value: name },
                            { key: "Portal URL", value: searchUrl },
                        ],
                        rawData: { county, name, search_url: searchUrl },
                        source: "county_recorder",
                    },
                ]);
                setStatusMsg("Portal link ready — click to view");
            } else {
                onResults(
                    items.map((r, i) => ({
                        id: String(i),
                        summary: `${String(r.grantor ?? r.grantee ?? "Record")} · ${String(r.instrument_type ?? "")} · ${String(r.recording_date ?? "")}`,
                        fields: Object.entries(r)
                            .slice(0, 10)
                            .map(([k, v]) => ({ key: k, value: String(v ?? "") })),
                        rawData: r,
                        source: "county_recorder",
                    })),
                );
                setStatusMsg(`${items.length} result(s)`);
            }
            setIsError(false);
        } catch (e) {
            setStatusMsg(e instanceof Error ? e.message : "Search failed");
            setIsError(true);
        } finally {
            setLoading(false);
        }
    }

    return (
        <>
            <div className={styles.searchArea}>
                <div className={styles.searchRow}>
                    <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>County</label>
                        <select
                            className={styles.select}
                            value={county}
                            onChange={(e) => setCounty(e.target.value)}
                        >
                            {OHIO_COUNTIES.map((c) => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                    </div>
                    <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>Grantor / Grantee name</label>
                        <input
                            className={styles.input}
                            type="text"
                            placeholder="e.g. Smith"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && !loading && void handleSearch()}
                        />
                    </div>
                    <button
                        className={styles.searchBtn}
                        onClick={() => void handleSearch()}
                        disabled={loading || !name.trim()}
                    >
                        {loading ? "Searching…" : "Search"}
                    </button>
                </div>
                {statusMsg && (
                    <span className={`${styles.statusLine} ${isError ? styles.statusError : ""}`}>
                        {statusMsg}
                    </span>
                )}
            </div>
            {shared.results.length === 0 && !loading && (
                <div className={styles.empty}>Search deed and instrument records by county</div>
            )}
            <ResultsArea {...shared} />
        </>
    );
}

/* ── County Parcels (async) ────────────────────────────────────── */

function ParcelsTab({ caseId, onResults, ...shared }: TabSharedProps) {
    const [county, setCounty] = useState("Franklin");
    const [query, setQuery] = useState("");
    const [searchType, setSearchType] = useState<"owner" | "parcel">("owner");
    const job = useAsyncJob<{ results?: unknown[]; count?: number }>({
        postUrl: `/api/cases/${caseId}/research/parcels/`,
    });

    useEffect(() => {
        if (job.status !== "success" || !job.result) return;
        const items = (job.result.results ?? []) as Record<string, unknown>[];
        onResults(
            items.map((r, i) => ({
                id: String(i),
                summary: `${String(r.owner_name ?? r.address ?? "Parcel")} · ${String(r.parcel_number ?? "")}`,
                fields: Object.entries(r)
                    .slice(0, 10)
                    .map(([k, v]) => ({ key: k, value: String(v ?? "") })),
                rawData: r,
                source: "county_parcel",
            })),
        );
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [job.status, job.result]);

    async function handleSearch() {
        if (!query.trim()) return;
        onResults([]);
        await job.run({ query: query.trim(), county, search_type: searchType });
    }

    const busy = job.status === "queued" || job.status === "running";
    return (
        <>
            <div className={styles.searchArea}>
                <div className={styles.searchRow}>
                    <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>County</label>
                        <select
                            className={styles.select}
                            value={county}
                            onChange={(e) => setCounty(e.target.value)}
                        >
                            {OHIO_COUNTIES.map((c) => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                    </div>
                    <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>Search by</label>
                        <select
                            className={styles.select}
                            value={searchType}
                            onChange={(e) => setSearchType(e.target.value as "owner" | "parcel")}
                        >
                            <option value="owner">Owner name</option>
                            <option value="parcel">Parcel number</option>
                        </select>
                    </div>
                    <div className={styles.fieldGroup}>
                        <label className={styles.fieldLabel}>Query</label>
                        <input
                            className={styles.input}
                            type="text"
                            placeholder={searchType === "owner" ? "e.g. Smith" : "e.g. 010-001234"}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && !busy && void handleSearch()}
                        />
                    </div>
                    <button
                        className={styles.searchBtn}
                        onClick={() => void handleSearch()}
                        disabled={busy || !query.trim()}
                    >
                        {busy ? "Searching…" : "Search"}
                    </button>
                </div>
                {busy && (
                    <span className={styles.statusLine}>Searching ODNR parcel data…</span>
                )}
                {job.status === "failed" && (
                    <span className={`${styles.statusLine} ${styles.statusError}`}>{job.error}</span>
                )}
                {job.status === "success" && (
                    <span className={styles.statusLine}>{shared.results.length} result(s)</span>
                )}
            </div>
            {shared.results.length === 0 && !busy && (
                <div className={styles.empty}>
                    Search county parcel records by owner or parcel number
                </div>
            )}
            <ResultsArea {...shared} />
        </>
    );
}
