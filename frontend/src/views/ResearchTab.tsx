/**
 * ResearchTab — External data source search panel for a case.
 *
 * Sources:
 *   IRS 990      — async (TEOS pipeline, 30–120s)
 *   Ohio SOS     — sync  (local CSV lookup)
 *   Ohio AOS     — async (web scraper)
 *   Recorder     — sync  (county portal URL builder)
 *   Parcel       — async (ODNR statewide parcel search, owner name or parcel ID)
 *
 * VOCABULARY (from CLAUDE.md):
 *   "Lead"   = AI analysis result — never show "AI" or "Claude" in UI text
 *   "Intake" = extraction pipeline — never show "Haiku" in UI text
 *   Knot     = Person or Organization node
 */

import { Fragment, useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  Search,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Plus,
  Check,
  ExternalLink,
} from "lucide-react";
import { useAsyncJob } from "../hooks/useAsyncJob";
import {
  searchIrs,
  searchOhioAos,
  searchOhioSos,
  searchRecorder,
  searchParcels,
  addResearchToCase,
  fetchCaseJobs,
  createNote,
  fetch990s,
  getDeceasedPersons,
} from "../api";
import type {
  IrsSearchJobResult,
  IrsFilingResult,
  SyncResearchResponse,
  DeceasedPerson,
} from "../types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ResearchTabProps {
  caseId: string;
}

// ---------------------------------------------------------------------------
// Source type union
// ---------------------------------------------------------------------------

type ResearchSource = "irs" | "sos" | "aos" | "recorder" | "parcel";

// ---------------------------------------------------------------------------
// Job status icon helper
// ---------------------------------------------------------------------------

function JobStatusIcon({ status }: { status: string }) {
  if (status === "QUEUED") return <Clock size={13} style={{ flexShrink: 0 }} />;
  if (status === "RUNNING")
    return (
      <Loader2
        size={13}
        style={{ flexShrink: 0, animation: "spin 1s linear infinite" }}
      />
    );
  if (status === "SUCCESS")
    return <CheckCircle2 size={13} style={{ color: "var(--color-medium)", flexShrink: 0 }} />;
  if (status === "FAILED")
    return <XCircle size={13} style={{ color: "var(--color-critical)", flexShrink: 0 }} />;
  return null;
}

// ---------------------------------------------------------------------------
// IRS results table
// ---------------------------------------------------------------------------

interface IrsResultsTableProps {
  results: IrsFilingResult[];
  caseId: string;
  addedKeys: Set<string>;
  onAdded: (key: string) => void;
}

function IrsResultsTable({ results, caseId, addedKeys, onAdded }: IrsResultsTableProps) {
  function rowKey(r: IrsFilingResult) {
    return `${r.ein}_${r.tax_year}`;
  }

  async function handleFetch990s(r: IrsFilingResult) {
    await fetch990s(caseId, { ein: r.ein });
    onAdded(rowKey(r));
  }

  async function handleSaveNote(r: IrsFilingResult) {
    await createNote(caseId, {
      target_type: "case",
      target_id: caseId,
      content: `IRS: ${r.taxpayer_name} EIN:${r.ein} ${r.tax_year}`,
    });
    onAdded(rowKey(r));
  }

  if (results.length === 0) {
    return (
      <div className="empty-state" style={{ marginTop: 40 }}>
        <p className="empty-state__body">No filings matched that search.</p>
      </div>
    );
  }

  return (
    <div className="results-area">
      <table className="results-table">
        <thead>
          <tr>
            <th>EIN</th>
            <th>Organization</th>
            <th>Year</th>
            <th>Form</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const key = rowKey(r);
            const isDone = addedKeys.has(key);
            return (
              <tr key={key}>
                <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.ein}</td>
                <td>{r.taxpayer_name}</td>
                <td>{r.tax_year}</td>
                <td>
                  <span className="doc-badge doc-badge--IRS_990">
                    {r.return_type ?? "990"}
                  </span>
                </td>
                <td style={{ width: 40, textAlign: "center" }}>
                  {isDone ? (
                    <span className="add-trigger add-trigger--done">
                      <Check size={13} />
                    </span>
                  ) : (
                    <Popover.Root>
                      <Popover.Trigger asChild>
                        <button type="button" className="add-trigger" aria-label="Add to case">
                          <Plus size={13} />
                        </button>
                      </Popover.Trigger>
                      <Popover.Portal>
                        <Popover.Content className="add-popover" sideOffset={4}>
                          <button
                            type="button"
                            className="add-option"
                            onClick={() => handleFetch990s(r)}
                          >
                            Fetch 990s → Financials
                            <span className="add-option__sub">
                              Pull XML from IRS TEOS, populate the Financials tab
                            </span>
                          </button>
                          <button
                            type="button"
                            className="add-option"
                            onClick={async () => {
                              await addResearchToCase(caseId, {
                                result_type: "organization",
                                data: r as unknown as Record<string, unknown>,
                              });
                              onAdded(rowKey(r));
                            }}
                          >
                            Create Organization knot
                            <span className="add-option__sub">
                              Add as a knot in the Web
                            </span>
                          </button>
                          <button
                            type="button"
                            className="add-option"
                            onClick={() => handleSaveNote(r)}
                          >
                            Save as note
                            <span className="add-option__sub">
                              Attach a quick capture to this case
                            </span>
                          </button>
                        </Popover.Content>
                      </Popover.Portal>
                    </Popover.Root>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic sync results table (SOS, AOS)
// ---------------------------------------------------------------------------

interface SyncResultsTableProps {
  results: Record<string, unknown>[];
  caseId: string;
  columns: string[];
  source: string;           // used to namespace keys
  addedKeys: Set<string>;
  onAdded: (key: string) => void;
  /** Set of lowercased deceased person names — checked for SOS results only */
  deceasedNames?: Set<string>;
}

function SyncResultsTable({ results, caseId, columns, source, addedKeys, onAdded, deceasedNames }: SyncResultsTableProps) {
  async function handleCreateOrg(r: Record<string, unknown>, idx: number) {
    await addResearchToCase(caseId, {
      result_type: "organization",
      data: r,
    });
    onAdded(`${source}_${idx}`);
  }

  async function handleSaveNote(r: Record<string, unknown>, idx: number) {
    const label = String(r.name ?? r.entity_name ?? r.organization_name ?? `Result ${idx + 1}`);
    await createNote(caseId, {
      target_type: "case",
      target_id: caseId,
      content: `Research result: ${label} — ${JSON.stringify(r).slice(0, 200)}`,
    });
    onAdded(`${source}_${idx}`);
  }

  function hasDeceasedSignatory(row: Record<string, unknown>): boolean {
    if (!deceasedNames || deceasedNames.size === 0) return false;
    // Prefer signatory-relevant fields; fall back to all strings if none found
    const SIGNATORY_KEYS = ["agent_name", "statutory_agent", "incorporator", "registered_agent", "organizer", "officer"];
    const entries = Object.entries(row);
    const signatoryValues = entries
      .filter(([k]) => SIGNATORY_KEYS.some((sk) => k.toLowerCase().includes(sk)))
      .map(([, v]) => (typeof v === "string" ? v.toLowerCase() : ""))
      .filter(Boolean);
    const valuesToCheck = signatoryValues.length > 0
      ? signatoryValues
      : entries.filter(([, v]) => typeof v === "string").map(([, v]) => (v as string).toLowerCase());
    return valuesToCheck.some((val) =>
      [...deceasedNames].some((name) => {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`\\b${escaped}\\b`).test(val);
      })
    );
  }

  if (results.length === 0) {
    return (
      <div className="empty-state" style={{ marginTop: 40 }}>
        <p className="empty-state__body">No records matched that search.</p>
      </div>
    );
  }

  return (
    <div className="results-area">
      <table className="results-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col}>{col.replace(/_/g, " ")}</th>
            ))}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, idx) => {
            const isDone = addedKeys.has(`${source}_${idx}`);
            const isDeceased = hasDeceasedSignatory(r);
            return (
              <Fragment key={idx}>
                {isDeceased && (
                  <tr>
                    <td
                      colSpan={columns.length + 1}
                      style={{
                        background: "rgba(186,117,23,0.12)",
                        color: "var(--color-high, #BA7517)",
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "4px 10px",
                      }}
                    >
                      ⚠️ DECEASED SIGNATORY — name matches a deceased person in this case
                    </td>
                  </tr>
                )}
                <tr>
                  {columns.map((col) => (
                    <td key={col}>{String(r[col] ?? "—")}</td>
                  ))}
                  <td style={{ width: 40, textAlign: "center" }}>
                    {isDone ? (
                      <span className="add-trigger add-trigger--done">
                        <Check size={13} />
                      </span>
                    ) : (
                      <Popover.Root>
                        <Popover.Trigger asChild>
                          <button type="button" className="add-trigger" aria-label="Add to case">
                            <Plus size={13} />
                          </button>
                        </Popover.Trigger>
                        <Popover.Portal>
                          <Popover.Content className="add-popover" sideOffset={4}>
                            <button
                              type="button"
                              className="add-option"
                              onClick={() => handleCreateOrg(r, idx)}
                            >
                              Create Organization knot
                              <span className="add-option__sub">
                                Add as a knot in the Web
                              </span>
                            </button>
                            <button
                              type="button"
                              className="add-option"
                              onClick={() => handleSaveNote(r, idx)}
                            >
                              Save as note
                              <span className="add-option__sub">
                                Attach a quick capture to this case
                              </span>
                            </button>
                          </Popover.Content>
                        </Popover.Portal>
                      </Popover.Root>
                    )}
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recorder results (URL list)
// ---------------------------------------------------------------------------

interface RecorderResultsProps {
  results: Record<string, unknown>[];
}

function RecorderResults({ results }: RecorderResultsProps) {
  if (results.length === 0) {
    return (
      <div className="empty-state" style={{ marginTop: 40 }}>
        <p className="empty-state__body">No recorder portals found for that county.</p>
      </div>
    );
  }

  return (
    <div className="results-area">
      <table className="results-table">
        <thead>
          <tr>
            <th>County</th>
            <th>Entity</th>
            <th>Portal</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, idx) => {
            const url =
              String(r.search_url ?? r.url ?? "");
            const county = String(r.county ?? r.county_name ?? "—");
            const name = String(r.name ?? r.entity_name ?? "—");
            return (
              <tr key={idx}>
                <td>{county}</td>
                <td>{name}</td>
                <td>
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-secondary"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 12,
                        padding: "4px 10px",
                        textDecoration: "none",
                      }}
                    >
                      Open portal
                      <ExternalLink size={11} />
                    </a>
                  ) : (
                    <span style={{ color: "var(--text-3)", fontSize: 12 }}>No URL</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ResearchTab({ caseId }: ResearchTabProps) {
  // Source selection
  const [source, setSource] = useState<ResearchSource>("irs");

  // Persistence of ✓ Added state across tab switches (Feature E)
  const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set());

  function markAdded(key: string) {
    setAddedKeys((prev) => new Set(prev).add(key));
  }

  // Deceased persons cache for SOS signatory flag (Feature C)
  const [deceasedNames, setDeceasedNames] = useState<Set<string>>(new Set());

  useEffect(() => {
    getDeceasedPersons(caseId)
      .then((res) => {
        const names = new Set(
          res.results.map((p: DeceasedPerson) => p.full_name.toLowerCase().trim())
        );
        setDeceasedNames(names);
      })
      .catch(() => {
        // Non-critical — SOS flag simply won't show if this fails
      });
  }, [caseId]);

  // IRS query state
  const [irsMode, setIrsMode] = useState<"ein" | "name">("name");
  const [irsEin, setIrsEin] = useState("");
  const [irsName, setIrsName] = useState("");
  // Direct fetch state — used when search returns 0 results
  const [directFetching, setDirectFetching] = useState(false);
  const [directFetchMsg, setDirectFetchMsg] = useState<string | null>(null);

  // Ohio SOS query state
  const [sosQuery, setSosQuery] = useState("");
  const [sosResults, setSosResults] = useState<SyncResearchResponse | null>(null);
  const [sosLoading, setSosLoading] = useState(false);

  // Ohio AOS query state
  const [aosName, setAosName] = useState("");

  // Recorder query state
  const [recorderName, setRecorderName] = useState("");
  const [recorderCounty, setRecorderCounty] = useState("");
  const [recorderResults, setRecorderResults] = useState<SyncResearchResponse | null>(null);
  const [recorderLoading, setRecorderLoading] = useState(false);

  // Parcel query state
  const [parcelQuery, setParcelQuery] = useState("");
  const [parcelSearchType, setParcelSearchType] = useState<"owner" | "parcel">("owner");

  // Three async job hooks — one per async source
  const irsJob = useAsyncJob<IrsSearchJobResult>();
  const aosJob = useAsyncJob<unknown>();
  const parcelJob = useAsyncJob<{
    source: string;
    results: Array<{
      pin: string | null;
      owner1: string | null;
      owner2: string | null;
      county: string | null;
      acres_calc: number | null;
      aud_link: string | null;
    }>;
    count: number;
    notes: string[];
  }>();

  // Reattach-on-mount: resume any in-progress jobs from a previous session
  useEffect(() => {
    fetchCaseJobs(caseId, 5)
      .then(({ results }) => {
        results.forEach((job) => {
          if (
            job.job_type === "IRS_NAME_SEARCH" ||
            job.job_type === "IRS_FETCH_XML"
          ) {
            if (job.status === "QUEUED" || job.status === "RUNNING") {
              irsJob.reattach(job);
            }
          }
          if (job.job_type === "OHIO_AOS") {
            if (job.status === "QUEUED" || job.status === "RUNNING") {
              aosJob.reattach(job);
            }
          }
          if (job.job_type === "COUNTY_PARCEL") {
            if (job.status === "QUEUED" || job.status === "RUNNING") {
              parcelJob.reattach(job);
            }
          }
        });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  // ---------------------------------------------------------------------------
  // Search handlers
  // ---------------------------------------------------------------------------

  function handleIrsSearch() {
    const query = irsMode === "ein" ? irsEin.trim() : irsName.trim();
    if (!query) return;
    setDirectFetchMsg(null);
    // EIN mode: fetch full XML and create FinancialSnapshots automatically (async job)
    // Name mode: search the index for matching orgs
    void irsJob.run(() => searchIrs(caseId, { query, fetch_xml: irsMode === "ein" }));
  }

  function handleParcelSearch() {
    if (!parcelQuery.trim()) return;
    void parcelJob.run(() =>
      searchParcels(caseId, { query: parcelQuery.trim(), search_type: parcelSearchType })
    );
  }

  async function handleDirectFetch990s() {
    const ein = irsEin.trim();
    if (!ein) return;
    setDirectFetching(true);
    setDirectFetchMsg(null);
    try {
      const result = await fetch990s(caseId, { ein });
      const fetched = (result as { fetched?: number })?.fetched ?? 0;
      setDirectFetchMsg(
        fetched > 0
          ? `Fetched ${fetched} year${fetched !== 1 ? "s" : ""} → check the Financials tab.`
          : "No new filings found in IRS XML index for that EIN."
      );
    } catch {
      setDirectFetchMsg("Fetch failed. Check that the EIN is correct.");
    } finally {
      setDirectFetching(false);
    }
  }

  async function handleSosSearch() {
    if (!sosQuery.trim()) return;
    setSosLoading(true);
    try {
      const res = await searchOhioSos(caseId, { query: sosQuery.trim() });
      setSosResults(res);
    } catch {
      setSosResults({ results: [], count: 0, notes: ["Search failed."] });
    } finally {
      setSosLoading(false);
    }
  }

  function handleAosSearch() {
    if (!aosName.trim()) return;
    void aosJob.run(() => searchOhioAos(caseId, { query: aosName.trim() }));
  }

  async function handleRecorderSearch() {
    if (!recorderCounty.trim()) return;
    setRecorderLoading(true);
    try {
      const res = await searchRecorder(caseId, {
        name: recorderName.trim() || undefined,
        county: recorderCounty.trim(),
      });
      setRecorderResults(res);
    } catch {
      setRecorderResults({ results: [], count: 0, notes: ["Search failed."] });
    } finally {
      setRecorderLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Job rail visibility
  // ---------------------------------------------------------------------------

  const hasAnyJob =
    irsJob.status !== "idle" ||
    aosJob.status !== "idle" ||
    parcelJob.status !== "idle";

  function jobRailLabel(
    jobState: ReturnType<typeof useAsyncJob>,
    sourceName: string,
    queryLabel: string
  ) {
    const { status, result, error } = jobState;
    if (status === "idle") return null;

    let statusText = "";
    if (status === "QUEUED") statusText = "Queued…";
    else if (status === "RUNNING") statusText = "Running…";
    else if (status === "SUCCESS") {
      const count =
        sourceName === "IRS"
          ? ((result as IrsSearchJobResult | null)?.count ?? 0)
          : "—";
      statusText = `${count} results`;
    } else if (status === "FAILED") {
      statusText = error ?? "Failed";
    }

    return (
      <div className="job-item" key={sourceName}>
        <JobStatusIcon status={status} />
        <span className="job-item__label">
          <strong>{sourceName}</strong>
          {queryLabel ? ` · "${queryLabel}"` : ""} · {statusText}
        </span>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Results area per source
  // ---------------------------------------------------------------------------

  function renderResults() {
    if (source === "irs") {
      if (irsJob.status === "idle") {
        return (
          <div className="empty-state" style={{ marginTop: 48 }}>
            <p className="empty-state__body" style={{ textAlign: "center" }}>
              Select a source above and run your first search.
            </p>
          </div>
        );
      }
      if (irsJob.status === "QUEUED" || irsJob.status === "RUNNING") {
        return (
          <div className="empty-state" style={{ marginTop: 48 }}>
            <Loader2
              size={28}
              style={{ animation: "spin 1s linear infinite", color: "var(--text-3)" }}
            />
            <p className="empty-state__body" style={{ marginTop: 12 }}>
              Searching IRS TEOS — this can take up to 60 seconds…
            </p>
          </div>
        );
      }
      if (irsJob.status === "FAILED") {
        return (
          <div className="empty-state" style={{ marginTop: 48 }}>
            <XCircle size={28} style={{ color: "var(--color-critical)" }} />
            <p className="empty-state__body" style={{ marginTop: 12 }}>
              {irsJob.error ?? "Search failed."}
            </p>
            <button
              type="button"
              className="btn-secondary"
              style={{ marginTop: 12 }}
              onClick={() => irsJob.reset()}
            >
              Clear
            </button>
          </div>
        );
      }
      if (irsJob.status === "SUCCESS" && irsJob.result) {
        // When search returns 0 results in EIN mode, offer a direct XML fetch
        if (irsJob.result.count === 0 && irsMode === "ein" && irsEin.trim()) {
          return (
            <div className="empty-state" style={{ marginTop: 48 }}>
              <p className="empty-state__body" style={{ textAlign: "center" }}>
                IRS search returned no results for that EIN.
              </p>
              <p className="empty-state__body" style={{ textAlign: "center", marginTop: 6, fontSize: 12 }}>
                Try fetching directly from the IRS XML filing index:
              </p>
              <button
                type="button"
                className="btn-primary"
                style={{ marginTop: 14 }}
                onClick={handleDirectFetch990s}
                disabled={directFetching}
              >
                {directFetching ? (
                  <><Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Fetching…</>
                ) : (
                  "Fetch 990s → Financials"
                )}
              </button>
              {directFetchMsg && (
                <p className="empty-state__body" style={{ marginTop: 10, color: directFetchMsg.startsWith("Fetched") ? "var(--color-medium, #34d399)" : "var(--color-high, #fbbf24)" }}>
                  {directFetchMsg}
                </p>
              )}
            </div>
          );
        }
        return (
          <IrsResultsTable
            results={irsJob.result.results}
            caseId={caseId}
            addedKeys={addedKeys}
            onAdded={markAdded}
          />
        );
      }
      return null;
    }

    if (source === "sos") {
      if (!sosResults && !sosLoading) {
        return (
          <div className="empty-state" style={{ marginTop: 48 }}>
            <p className="empty-state__body" style={{ textAlign: "center" }}>
              Select a source above and run your first search.
            </p>
          </div>
        );
      }
      if (sosLoading) {
        return (
          <div className="empty-state" style={{ marginTop: 48 }}>
            <Loader2
              size={28}
              style={{ animation: "spin 1s linear infinite", color: "var(--text-3)" }}
            />
          </div>
        );
      }
      if (sosResults) {
        const cols =
          sosResults.results.length > 0
            ? Object.keys(sosResults.results[0]).slice(0, 5)
            : ["name", "ein", "state", "type"];
        return (
          <>
            {sosResults.notes?.map((n, i) => (
              <div
                key={i}
                style={{
                  padding: "6px 16px",
                  fontSize: 12,
                  color: "var(--text-3)",
                  borderBottom: "1px solid var(--bg-2)",
                }}
              >
                {n}
              </div>
            ))}
            <SyncResultsTable
              results={sosResults.results}
              caseId={caseId}
              columns={cols}
              source="sos"
              addedKeys={addedKeys}
              onAdded={markAdded}
              deceasedNames={deceasedNames}
            />
          </>
        );
      }
      return null;
    }

    if (source === "aos") {
      if (aosJob.status === "idle") {
        return (
          <div className="empty-state" style={{ marginTop: 48 }}>
            <p className="empty-state__body" style={{ textAlign: "center" }}>
              Select a source above and run your first search.
            </p>
          </div>
        );
      }
      if (aosJob.status === "QUEUED" || aosJob.status === "RUNNING") {
        return (
          <div className="empty-state" style={{ marginTop: 48 }}>
            <Loader2
              size={28}
              style={{ animation: "spin 1s linear infinite", color: "var(--text-3)" }}
            />
            <p className="empty-state__body" style={{ marginTop: 12 }}>
              Searching Ohio Auditor of State…
            </p>
          </div>
        );
      }
      if (aosJob.status === "FAILED") {
        return (
          <div className="empty-state" style={{ marginTop: 48 }}>
            <XCircle size={28} style={{ color: "var(--color-critical)" }} />
            <p className="empty-state__body" style={{ marginTop: 12 }}>
              {aosJob.error ?? "Search failed."}
            </p>
            <button
              type="button"
              className="btn-secondary"
              style={{ marginTop: 12 }}
              onClick={() => aosJob.reset()}
            >
              Clear
            </button>
          </div>
        );
      }
      if (aosJob.status === "SUCCESS" && aosJob.result) {
        const raw = aosJob.result as Record<string, unknown>;
        const rows = Array.isArray(raw.results)
          ? (raw.results as Record<string, unknown>[])
          : [];
        const cols =
          rows.length > 0
            ? Object.keys(rows[0]).slice(0, 5)
            : ["name", "entity", "finding", "year", "amount"];
        return (
          <SyncResultsTable
            results={rows}
            caseId={caseId}
            columns={cols}
            source="aos"
            addedKeys={addedKeys}
            onAdded={markAdded}
          />
        );
      }
      return null;
    }

    if (source === "recorder") {
      if (!recorderResults && !recorderLoading) {
        return (
          <div className="empty-state" style={{ marginTop: 48 }}>
            <p className="empty-state__body" style={{ textAlign: "center" }}>
              Select a source above and run your first search.
            </p>
          </div>
        );
      }
      if (recorderLoading) {
        return (
          <div className="empty-state" style={{ marginTop: 48 }}>
            <Loader2
              size={28}
              style={{ animation: "spin 1s linear infinite", color: "var(--text-3)" }}
            />
          </div>
        );
      }
      if (recorderResults) {
        return <RecorderResults results={recorderResults.results} />;
      }
      return null;
    }

    if (source === "parcel") {
      if (parcelJob.status === "QUEUED" || parcelJob.status === "RUNNING") {
        return (
          <div className="research-panel" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: "var(--text-3)", fontSize: 13 }}>
            <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
            Searching ODNR statewide parcels…
          </div>
        );
      }
      if (parcelJob.status === "FAILED") {
        return (
          <div className="research-panel" style={{ padding: "32px 24px", textAlign: "center" }}>
            <p style={{ color: "var(--color-critical)", fontSize: 13, margin: 0 }}>
              {parcelJob.error ?? "Parcel search failed."}
            </p>
          </div>
        );
      }
      if (parcelJob.status === "SUCCESS" && parcelJob.result) {
        const { results, count, notes } = parcelJob.result;
        return (
          <div className="research-panel">
            <div style={{ fontSize: 11, color: "var(--text-3)", padding: "8px 12px", borderBottom: "1px solid var(--border-1)" }}>
              {count} parcel{count !== 1 ? "s" : ""} found
              {notes[0] && <span> · {notes[0].split(".")[0]}.</span>}
            </div>
            {results.map((r, i) => (
              <div key={i} style={{ borderBottom: "1px solid var(--border-1)", padding: "10px 12px", fontSize: 12 }}>
                <div style={{ fontWeight: 600, color: "var(--text-1)", marginBottom: 2 }}>
                  {r.owner1 ?? "Unknown owner"}
                  {r.owner2 && <span style={{ color: "var(--text-3)", fontWeight: 400 }}> / {r.owner2}</span>}
                </div>
                <div style={{ color: "var(--text-3)", marginBottom: 2 }}>
                  {r.county && <span>{r.county} County</span>}
                  {r.pin && <span> · PIN: {r.pin}</span>}
                  {r.acres_calc != null && <span> · {r.acres_calc.toFixed(2)} ac</span>}
                </div>
                {r.aud_link && (
                  <a
                    href={r.aud_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 11, color: "var(--color-info, #58a6ff)", display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    <ExternalLink size={11} /> County Auditor
                  </a>
                )}
              </div>
            ))}
            {count === 0 && (
              <div style={{ padding: "32px 24px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                No parcels found for "{parcelQuery}".
              </div>
            )}
          </div>
        );
      }
      return null;
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Query form per source
  // ---------------------------------------------------------------------------

  function renderQueryForm() {
    if (source === "irs") {
      return (
        <div className="query-form" style={{ flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
              <input
                type="radio"
                name="irs-mode"
                value="name"
                checked={irsMode === "name"}
                onChange={() => setIrsMode("name")}
              />
              Name
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
              <input
                type="radio"
                name="irs-mode"
                value="ein"
                checked={irsMode === "ein"}
                onChange={() => setIrsMode("ein")}
              />
              EIN
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, width: "100%" }}>
            {irsMode === "ein" ? (
              <input
                className="query-input"
                type="text"
                placeholder="31-1234567"
                value={irsEin}
                onChange={(e) => setIrsEin(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleIrsSearch()}
                aria-label="EIN"
              />
            ) : (
              <input
                className="query-input"
                type="text"
                placeholder="Organization name"
                value={irsName}
                onChange={(e) => setIrsName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleIrsSearch()}
                aria-label="Organization name"
              />
            )}
            <button
              type="button"
              className="btn-primary"
              onClick={handleIrsSearch}
              disabled={
                irsJob.status === "QUEUED" || irsJob.status === "RUNNING"
              }
              style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
            >
              {irsJob.status === "QUEUED" || irsJob.status === "RUNNING" ? (
                <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
              ) : (
                <Search size={14} />
              )}
              Search
            </button>
          </div>
        </div>
      );
    }

    if (source === "sos") {
      return (
        <div className="query-form">
          <input
            className="query-input"
            type="text"
            placeholder="Entity name, EIN, or entity number"
            value={sosQuery}
            onChange={(e) => setSosQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleSosSearch()}
            aria-label="Ohio SOS search query"
          />
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleSosSearch()}
            disabled={sosLoading}
            style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
          >
            {sosLoading ? (
              <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
            ) : (
              <Search size={14} />
            )}
            Search
          </button>
        </div>
      );
    }

    if (source === "aos") {
      return (
        <div className="query-form">
          <input
            className="query-input"
            type="text"
            placeholder="Entity name"
            value={aosName}
            onChange={(e) => setAosName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAosSearch()}
            aria-label="Ohio AOS entity name"
          />
          <button
            type="button"
            className="btn-primary"
            onClick={handleAosSearch}
            disabled={
              aosJob.status === "QUEUED" || aosJob.status === "RUNNING"
            }
            style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
          >
            {aosJob.status === "QUEUED" || aosJob.status === "RUNNING" ? (
              <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
            ) : (
              <Search size={14} />
            )}
            Search
          </button>
        </div>
      );
    }

    if (source === "recorder") {
      return (
        <div className="query-form">
          <input
            className="query-input"
            type="text"
            placeholder="Entity name (optional)"
            value={recorderName}
            onChange={(e) => setRecorderName(e.target.value)}
            aria-label="Entity name"
          />
          <input
            className="query-input"
            type="text"
            placeholder="Ohio county (required)"
            value={recorderCounty}
            onChange={(e) => setRecorderCounty(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleRecorderSearch()}
            aria-label="Ohio county"
            style={{ flex: "0 0 180px" }}
          />
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleRecorderSearch()}
            disabled={recorderLoading}
            style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
          >
            {recorderLoading ? (
              <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
            ) : (
              <Search size={14} />
            )}
            Search
          </button>
        </div>
      );
    }

    if (source === "parcel") {
      return (
        <div className="query-form" style={{ flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
              <input
                type="radio"
                name="parcel-mode"
                value="owner"
                checked={parcelSearchType === "owner"}
                onChange={() => setParcelSearchType("owner")}
              />
              Owner name
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
              <input
                type="radio"
                name="parcel-mode"
                value="parcel"
                checked={parcelSearchType === "parcel"}
                onChange={() => setParcelSearchType("parcel")}
              />
              Parcel ID
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, width: "100%" }}>
            <input
              className="query-input"
              type="text"
              placeholder={parcelSearchType === "owner" ? "Owner last name (e.g. SMITH)" : "Parcel ID or PIN"}
              value={parcelQuery}
              onChange={(e) => setParcelQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleParcelSearch()}
              aria-label={parcelSearchType === "owner" ? "Owner name" : "Parcel ID"}
            />
            <button
              type="button"
              className="btn-primary"
              onClick={handleParcelSearch}
              disabled={parcelJob.status === "QUEUED" || parcelJob.status === "RUNNING"}
              style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
            >
              {parcelJob.status === "QUEUED" || parcelJob.status === "RUNNING" ? (
                <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
              ) : (
                <Search size={14} />
              )}
              Search
            </button>
          </div>
        </div>
      );
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const irsQueryLabel =
    irsMode === "ein" ? irsEin.trim() : irsName.trim();
  const aosQueryLabel = aosName.trim();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Source bar */}
      <div className="source-bar">
        <button
          type="button"
          className={`source-btn${source === "irs" ? " source-btn--active" : ""}`}
          onClick={() => setSource("irs")}
        >
          IRS 990
        </button>
        <button
          type="button"
          className={`source-btn${source === "sos" ? " source-btn--active" : ""}`}
          onClick={() => setSource("sos")}
        >
          Ohio SOS
        </button>
        <button
          type="button"
          className={`source-btn${source === "aos" ? " source-btn--active" : ""}`}
          onClick={() => setSource("aos")}
        >
          Ohio AOS
        </button>
        <button
          type="button"
          className={`source-btn${source === "recorder" ? " source-btn--active" : ""}`}
          onClick={() => setSource("recorder")}
        >
          Recorder
        </button>
        <button
          type="button"
          className={`source-btn${source === "parcel" ? " source-btn--active" : ""}`}
          onClick={() => setSource("parcel")}
        >
          Parcel
        </button>
      </div>

      {/* Query form */}
      {renderQueryForm()}

      {/* Job rail — shown only when at least one async job is active */}
      {hasAnyJob && (
        <div className="job-rail">
          <div
            className="panel-section__title"
            style={{ marginBottom: 4 }}
          >
            Recent searches
          </div>
          {jobRailLabel(irsJob, "IRS", irsQueryLabel)}
          {jobRailLabel(aosJob, "Ohio AOS", aosQueryLabel)}
          {jobRailLabel(parcelJob, "ODNR Parcel", parcelQuery)}
        </div>
      )}

      {/* Results area */}
      {renderResults()}
    </div>
  );
}
