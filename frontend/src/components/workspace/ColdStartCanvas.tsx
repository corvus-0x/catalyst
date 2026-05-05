/**
 * ColdStartCanvas — Zone 3 cold-start state per spec §8.6.
 *
 * Fires when the case has zero documents. Two side-by-side search panels:
 *   • IRS TEOS  (left)  — async via useAsyncJob (slow, polls /api/jobs/<id>/)
 *   • Ohio SOS  (right) — synchronous (local CSV search)
 *
 * Each panel shows the top results as preview cards. The investigator picks
 * one and clicks "Use this entity → begin investigation":
 *   • IRS pick   → POST /fetch-990s/  (creates documents + financial snapshots)
 *   • SOS pick   → POST /research/add-to-case/ (creates the Organization)
 *
 * On success, the parent re-fetches CaseDetail; documents.length > 0 so the
 * cold start hides and the canvas reverts to the graph view (placeholder for
 * now; real graph lands at step 6).
 */
import { FormEvent, useRef, useState } from "react";
import { Building2Icon, FileSearchIcon, Loader2Icon, SearchIcon, UploadIcon } from "lucide-react";
import { useAsyncJob } from "../../hooks/useAsyncJob";
import { addResearchToCase, fetch990Data, searchOhioSOS } from "../../api";
import { ResearchResult } from "../../types";
import { toast } from "../ui/Toaster";
import styles from "./ColdStartCanvas.module.css";

interface Props {
    caseId: string;
    /** Called after the investigator successfully confirms a subject entity. */
    onConfirmed: () => void;
}

interface IrsRow {
    ein: string;
    taxpayer_name: string;
    return_type: string;
    tax_year: number;
}

interface SosRow {
    business_name?: string;
    charter_number?: string;
    status?: string;
    filing_date?: string;
    county?: string;
}

export function ColdStartCanvas({ caseId, onConfirmed }: Props) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);

    async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files ?? []);
        if (!files.length) return;
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
            toast.success(`${files.length} file${files.length > 1 ? "s" : ""} uploaded — processing started`);
            onConfirmed();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Upload failed");
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    }

    return (
        <div className={styles.coldStart}>
            <header className={styles.intro}>
                <h2 className={styles.title}>Begin investigation</h2>
                <p className={styles.subtitle}>
                    Search for your subject in IRS filings or Ohio SOS, or upload documents directly.
                </p>
            </header>

            <div className={styles.panels}>
                <IrsSearchPanel caseId={caseId} onConfirmed={onConfirmed} />
                <SosSearchPanel caseId={caseId} onConfirmed={onConfirmed} />
            </div>

            {/* Escape hatch — bypass search entirely and upload docs directly */}
            <div className={styles.uploadEscape}>
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.txt,.doc,.docx,.csv,.xlsx,.png,.jpg,.jpeg"
                    className={styles.hiddenInput}
                    onChange={handleUpload}
                    aria-hidden="true"
                />
                <button
                    type="button"
                    className={styles.uploadEscapeBtn}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                >
                    <UploadIcon size={15} />
                    <span>{uploading ? "Uploading…" : "Or upload documents directly"}</span>
                </button>
                <span className={styles.uploadEscapeHint}>
                    PDFs, spreadsheets, images — Catalyst extracts entities automatically
                </span>
            </div>
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────────── */
/* IRS panel — async job                                                */
/* ─────────────────────────────────────────────────────────────────── */
function IrsSearchPanel({ caseId, onConfirmed }: Props) {
    const [query, setQuery] = useState("");
    const [confirmingEin, setConfirmingEin] = useState<string | null>(null);
    const job = useAsyncJob<ResearchResult>({
        postUrl: `/api/cases/${caseId}/research/irs/`,
    });

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        const q = query.trim();
        if (!q) return;
        job.run({ query: q });
    }

    async function confirmRow(row: IrsRow) {
        setConfirmingEin(row.ein);
        try {
            const result = await fetch990Data(caseId, row.ein);
            if (result.fetched > 0) {
                toast.success(`Pulled ${result.fetched} 990 filing(s) for ${row.taxpayer_name}`);
                onConfirmed();
            } else if (result.errors?.length) {
                toast.error(`Couldn't pull 990s: ${result.errors[0].error}`);
            } else {
                toast.error("No 990 filings found for this EIN");
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to pull 990s");
        } finally {
            setConfirmingEin(null);
        }
    }

    const rawRows = (job.result?.results ?? []) as unknown as IrsRow[];
    const dedupedByEin = dedupeIrsByEin(rawRows);
    const showResults = job.status === "success" && dedupedByEin.length > 0;
    const showEmpty = job.status === "success" && dedupedByEin.length === 0;
    const isSearching = job.status === "queued" || job.status === "running";

    return (
        <section className={styles.card} aria-labelledby="cold-start-irs-title">
            <header className={styles.cardHeader}>
                <FileSearchIcon size={18} className={styles.cardIcon} aria-hidden />
                <div>
                    <h3 id="cold-start-irs-title" className={styles.cardTitle}>
                        IRS Form 990
                    </h3>
                    <p className={styles.cardSub}>
                        Tax-exempt organizations registered with the IRS
                    </p>
                </div>
            </header>

            <form className={styles.form} onSubmit={handleSubmit}>
                <label className={styles.srOnly} htmlFor="cold-start-irs-input">
                    IRS organization name
                </label>
                <input
                    id="cold-start-irs-input"
                    className={styles.input}
                    type="text"
                    placeholder="Organization name"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    disabled={isSearching}
                />
                <button
                    type="submit"
                    className={styles.searchBtn}
                    disabled={isSearching || !query.trim()}
                >
                    {isSearching ? (
                        <>
                            <Loader2Icon size={14} className={styles.spinner} />
                            <span>
                                {job.status === "queued" ? "Starting…" : "Searching IRS index…"}
                            </span>
                        </>
                    ) : (
                        <>
                            <SearchIcon size={14} />
                            <span>Search IRS</span>
                        </>
                    )}
                </button>
            </form>

            {isSearching && (
                <p className={styles.searchHint}>
                    Scanning IRS Form 990 filings across multiple years — this usually takes
                    30–60 seconds.
                </p>
            )}

            {job.status === "failed" && (
                <div className={styles.error} role="alert">
                    Search failed: {job.error ?? "Unknown error"}
                </div>
            )}

            {showEmpty && (
                <div className={styles.emptyResults}>No matches in IRS Form 990 index.</div>
            )}

            {showResults && (
                <ul className={styles.results}>
                    {dedupedByEin.slice(0, 5).map((row) => (
                        <li key={row.ein} className={styles.resultRow}>
                            <div className={styles.resultBody}>
                                <div className={styles.resultName}>{row.taxpayer_name}</div>
                                <div className={styles.resultMeta}>
                                    EIN {row.ein} · most recent {row.return_type} {row.tax_year}
                                </div>
                            </div>
                            <button
                                type="button"
                                className={styles.confirmBtn}
                                onClick={() => confirmRow(row)}
                                disabled={confirmingEin !== null}
                            >
                                {confirmingEin === row.ein ? "Pulling 990s…" : "Begin investigation"}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Ohio SOS panel — sync                                                */
/* ─────────────────────────────────────────────────────────────────── */
function SosSearchPanel({ caseId, onConfirmed }: Props) {
    const [query, setQuery] = useState("");
    const [searching, setSearching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<ResearchResult | null>(null);
    const [confirming, setConfirming] = useState<string | null>(null);

    // True when the SOS CSV data has never been uploaded to this instance.
    const noData = error !== null && (
        error.toLowerCase().includes("no ohio sos data") ||
        error.toLowerCase().includes("csv files have not been uploaded") ||
        error.toLowerCase().includes("upload csv")
    );

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        const q = query.trim();
        if (!q) return;
        setSearching(true);
        setError(null);
        setResult(null);
        try {
            const res = await searchOhioSOS(caseId, q);
            if (res.error) setError(res.error);
            else setResult(res);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Search failed");
        } finally {
            setSearching(false);
        }
    }

    async function confirmRow(row: SosRow) {
        const key = row.charter_number || row.business_name || JSON.stringify(row);
        setConfirming(key);
        try {
            const res = await addResearchToCase(caseId, "ohio-sos", row as Record<string, unknown>);
            if (res.duplicate) {
                toast.success(`${row.business_name ?? "Entity"} already on case`);
            } else {
                toast.success(`Added ${row.business_name ?? "entity"} to case`);
            }
            onConfirmed();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to add entity");
        } finally {
            setConfirming(null);
        }
    }

    const rows = (result?.results ?? []) as unknown as SosRow[];
    const showEmpty = result !== null && rows.length === 0 && !error;

    return (
        <section className={styles.card} aria-labelledby="cold-start-sos-title">
            <header className={styles.cardHeader}>
                <Building2Icon size={18} className={styles.cardIcon} aria-hidden />
                <div>
                    <h3 id="cold-start-sos-title" className={styles.cardTitle}>
                        Ohio Secretary of State
                    </h3>
                    <p className={styles.cardSub}>
                        Registered business entities, statutory agents, formation dates
                    </p>
                </div>
            </header>

            <form className={styles.form} onSubmit={handleSubmit}>
                <label className={styles.srOnly} htmlFor="cold-start-sos-input">
                    SOS entity name
                </label>
                <input
                    id="cold-start-sos-input"
                    className={styles.input}
                    type="text"
                    placeholder="Entity name or charter number"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    disabled={searching}
                />
                <button
                    type="submit"
                    className={styles.searchBtn}
                    disabled={searching || !query.trim()}
                >
                    {searching ? (
                        <>
                            <Loader2Icon size={14} className={styles.spinner} />
                            <span>Searching…</span>
                        </>
                    ) : (
                        <>
                            <SearchIcon size={14} />
                            <span>Search SOS</span>
                        </>
                    )}
                </button>
            </form>

            {error && !noData && (
                <div className={styles.error} role="alert">
                    {error}
                </div>
            )}

            {noData && (
                <div className={styles.unavailable}>
                    <strong>Ohio SOS data not loaded.</strong>
                    <span>
                        Download the bulk entity files from{" "}
                        <a
                            href="https://www.ohiosos.gov/businesses/information-businesses/bulk-filing/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.unavailableLink}
                        >
                            publicfiles.ohiosos.gov
                        </a>{" "}
                        and upload them via the admin endpoint to enable SOS search.
                        You can still search IRS 990 filings on the left.
                    </span>
                </div>
            )}

            {showEmpty && (
                <div className={styles.emptyResults}>No matches in Ohio SOS register.</div>
            )}

            {rows.length > 0 && (
                <ul className={styles.results}>
                    {rows.slice(0, 5).map((row) => {
                        const key = row.charter_number || row.business_name || JSON.stringify(row);
                        return (
                            <li key={key} className={styles.resultRow}>
                                <div className={styles.resultBody}>
                                    <div className={styles.resultName}>
                                        {row.business_name ?? "Unnamed entity"}
                                    </div>
                                    <div className={styles.resultMeta}>
                                        {[row.charter_number && `#${row.charter_number}`, row.status, row.county]
                                            .filter(Boolean)
                                            .join(" · ") || "—"}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    className={styles.confirmBtn}
                                    onClick={() => confirmRow(row)}
                                    disabled={confirming !== null}
                                >
                                    {confirming === key ? "Adding…" : "Begin investigation"}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Helpers                                                              */
/* ─────────────────────────────────────────────────────────────────── */

/**
 * IRS results contain one row per filing year per org. The investigator picks
 * an organization, not a filing — so collapse rows by EIN, keeping the most
 * recent tax year for the meta line.
 */
export function dedupeIrsByEin(rows: IrsRow[]): IrsRow[] {
    const byEin = new Map<string, IrsRow>();
    for (const row of rows) {
        if (!row?.ein) continue;
        const existing = byEin.get(row.ein);
        if (!existing || (row.tax_year ?? 0) > (existing.tax_year ?? 0)) {
            byEin.set(row.ein, row);
        }
    }
    return Array.from(byEin.values()).sort((a, b) =>
        (a.taxpayer_name || "").localeCompare(b.taxpayer_name || ""),
    );
}
