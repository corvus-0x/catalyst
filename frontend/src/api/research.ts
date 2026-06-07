/**
 * research.ts — API functions for external data source lookups and async job polling.
 *
 * Three research sources are async (IRS, Ohio AOS, County Parcels):
 *   POST → 202 Accepted + { job_id, status_url }
 *   Then poll GET /api/jobs/:job_id/ every 2s until status is SUCCESS or FAILED.
 *
 * Two research sources are synchronous (Ohio SOS, County Recorder):
 *   POST → 200 OK + { results, count, notes }
 *
 * The `useAsyncJob` hook in the frontend wires polling for async endpoints.
 * On mount, call `fetchCaseJobs` to reattach to any in-progress jobs.
 */

import { fetchApi } from "./base";
import type {
  AsyncJobEnqueuedResponse,
  SearchJob,
  CaseJobsResponse,
  SyncResearchResponse,
} from "../types";

/** Re-export the envelope type so callers can use the same name used in JSDoc. */
export type AsyncJobEnvelope = AsyncJobEnqueuedResponse;

// ---------------------------------------------------------------------------
// Async research endpoints (return 202 + job_id)
// ---------------------------------------------------------------------------

/**
 * Search IRS TEOS for 990 filings by EIN or organization name.
 * Backend accepts { query } and auto-detects EIN vs name.
 * This is a slow endpoint (30–120s) — always async.
 * Returns an AsyncJobEnvelope; poll fetchJob() for results.
 */
export async function searchIrs(
  caseId: string,
  params: { query: string; fetch_xml?: boolean }
): Promise<AsyncJobEnqueuedResponse> {
  return fetchApi<AsyncJobEnqueuedResponse>(`/api/cases/${caseId}/research/irs/`, {
    method: "POST",
    body: params,
  });
}

/**
 * Search Ohio Auditor of State audit reports for an entity.
 * Returns an AsyncJobEnvelope; poll fetchJob() for results.
 */
export async function searchOhioAos(
  caseId: string,
  params: { query: string }
): Promise<AsyncJobEnqueuedResponse> {
  return fetchApi<AsyncJobEnqueuedResponse>(`/api/cases/${caseId}/research/ohio-aos/`, {
    method: "POST",
    body: params,
  });
}

/**
 * Search ODNR statewide parcel data by owner name or parcel ID.
 * Returns an AsyncJobEnvelope; poll fetchJob() for results.
 */
export async function searchParcels(
  caseId: string,
  params: { query: string; search_type?: "owner" | "parcel"; county?: string }
): Promise<AsyncJobEnqueuedResponse> {
  return fetchApi<AsyncJobEnqueuedResponse>(`/api/cases/${caseId}/research/parcels/`, {
    method: "POST",
    body: params,
  });
}

// ---------------------------------------------------------------------------
// Sync research endpoints (return results immediately)
// ---------------------------------------------------------------------------

/**
 * Search the locally-uploaded Ohio SOS CSV files for an entity.
 * Sync — returns results immediately (no polling needed).
 * Requires the SOS CSV files to have been uploaded via the admin endpoint.
 */
export async function searchOhioSos(
  caseId: string,
  params: { query: string; fuzzy?: boolean }
): Promise<SyncResearchResponse> {
  return fetchApi<SyncResearchResponse>(`/api/cases/${caseId}/research/ohio-sos/`, {
    method: "POST",
    body: params,
  });
}

/**
 * Build a County Recorder portal search URL for an Ohio county.
 * Sync — returns a search URL + county info immediately (no polling needed).
 */
export async function searchRecorder(
  caseId: string,
  params: { name?: string; county: string; ein?: string; entity_number?: string }
): Promise<SyncResearchResponse> {
  return fetchApi<SyncResearchResponse>(`/api/cases/${caseId}/research/recorder/`, {
    method: "POST",
    body: params,
  });
}

// ---------------------------------------------------------------------------
// Add research result to case
// ---------------------------------------------------------------------------

/**
 * Import a research result into the case as a Person, Organization, or note.
 * Called after the investigator clicks "+ Add to Case" on a research result row.
 */
export async function addResearchToCase(
  caseId: string,
  data: {
    result_type: "person" | "organization";
    data: Record<string, unknown>;
  }
): Promise<Record<string, unknown>> {
  return fetchApi<Record<string, unknown>>(`/api/cases/${caseId}/research/add-to-case/`, {
    method: "POST",
    body: data,
  });
}

// ---------------------------------------------------------------------------
// Async job polling
// ---------------------------------------------------------------------------

/**
 * Poll a single async job by ID.
 * Call every 2s until job.status is "SUCCESS" or "FAILED".
 * On SUCCESS, `job.result` contains the connector-specific payload.
 * On FAILED, `job.error_message` contains the failure reason.
 */
export async function fetchJob(jobId: string): Promise<SearchJob> {
  return fetchApi<SearchJob>(`/api/jobs/${jobId}/`);
}

/**
 * Fetch recent jobs for a case on mount (reattach-on-mount pattern).
 * Use limit=5 to get only the most recent jobs and check if any are still
 * QUEUED or RUNNING, then resume polling via the `useAsyncJob` hook.
 */
export async function fetchCaseJobs(
  caseId: string,
  limit = 5
): Promise<CaseJobsResponse> {
  const qs = new URLSearchParams({ limit: String(limit) });
  return fetchApi<CaseJobsResponse>(`/api/cases/${caseId}/jobs/?${qs}`);
}

// ---------------------------------------------------------------------------
// AI pattern analysis (async — enqueues a Lead generation job)
// ---------------------------------------------------------------------------

/**
 * Enqueue an AI pattern analysis job for a case.
 * Returns 202 Accepted + AsyncJobEnvelope.
 * Returns 409 Conflict if an AI pattern job is already in-flight for this case.
 *
 * On SUCCESS, poll result shape: { findings_created: number, patterns_dropped: number }
 * The findings appear as Angles with source="AI" in the Pipeline tab.
 *
 * UI label: "Lead" (never "AI" or "Claude" — see CLAUDE.md vocabulary).
 */
export async function runAiPatternAnalysis(
  caseId: string
): Promise<AsyncJobEnqueuedResponse> {
  return fetchApi<AsyncJobEnqueuedResponse>(`/api/cases/${caseId}/ai/analyze-patterns/`, {
    method: "POST",
  });
}

// ---------------------------------------------------------------------------
// Admin endpoints (SOS CSV management)
// ---------------------------------------------------------------------------

/**
 * Upload an Ohio SOS CSV file for local search.
 * Pass FormData with the file attached.
 * Only needed when Tyler uploads the CSVs from publicfiles.ohiosos.gov.
 */
export async function uploadSosCsv(formData: FormData): Promise<unknown> {
  const { ApiError } = await import("./base");
  const response = await fetch("/api/admin/upload-sos-csv/", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const err = await response.json();
      if (typeof err?.detail === "string") message = err.detail;
    } catch { /* non-JSON body */ }
    throw new ApiError(response.status, message);
  }
  return response.json();
}

/** Check which Ohio SOS CSV files have been uploaded. */
export async function fetchSosCsvStatus(): Promise<unknown> {
  return fetchApi<unknown>("/api/admin/sos-csv-status/");
}
