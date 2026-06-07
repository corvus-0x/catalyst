/**
 * cases.ts -- API functions for case management, documents, Angles (Findings), and notes.
 *
 * Vocabulary used in JSDoc comments follows the frontend spec (CLAUDE.md):
 *   Angle   = Finding (backend model)
 *   Knot    = Person or Organization node
 *
 * All monetary values in dashboard/graph responses are strings (Decimal).
 * All monetary values in financials responses are integers (IntegerField).
 */

import { fetchApi } from "./base";
import type {
  CaseListResponse,
  CaseListItem,
  CaseDetailResponse,
  DashboardResponse,
  DocumentItem,
  BulkUploadResponse,
  FinancialsResponse,
  FindingsResponse,
  FindingItem,
  NotesResponse,
  InvestigatorNote,
  FuzzyMatchResponse,
  FuzzyMatchCandidate,
  SearchResponse,
  ActivityFeedResponse,
  SignalSummary,
  FindingSeverity,
  FindingStatus,
  FindingSource,
  InvestigationStep,
  InvestigationStepsResponse,
  CreateInvestigationStepParams,
  DeceasedPersonsResponse,
  ReferralTarget,
  ReferralTargetsResponse,
  CreateReferralTargetParams,
  UpdateReferralTargetParams,
} from "../types";

// ---------------------------------------------------------------------------
// Local param shapes (not exported from types -- used only as function params)
// ---------------------------------------------------------------------------

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface FindingFilterParams {
  status?: FindingStatus;
  severity?: FindingSeverity;
  /** "Rule" chip -> AUTO, "Manual" chip -> MANUAL, "AI" chip -> AI */
  source?: FindingSource;
  order_by?: string;
  direction?: "asc" | "desc";
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

export interface CaseListParams extends PaginationParams {
  status?: "ACTIVE" | "PAUSED" | "REFERRED" | "CLOSED";
  q?: string;
}

/** Fetch the paginated list of all cases. */
export async function fetchCases(params: CaseListParams = {}): Promise<CaseListResponse> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.q) qs.set("q", params.q);
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  if (params.offset !== undefined) qs.set("offset", String(params.offset));
  const query = qs.toString() ? `?${qs}` : "";
  return fetchApi<CaseListResponse>(`/api/cases/${query}`);
}

/** Create a new case. Returns the created CaseListItem (201). */
export async function createCase(data: {
  name: string;
  status?: "ACTIVE" | "PAUSED" | "REFERRED" | "CLOSED";
  notes?: string;
  referral_ref?: string;
}): Promise<CaseListItem> {
  return fetchApi<CaseListItem>("/api/cases/", { method: "POST", body: data });
}

/** Fetch full case detail including the document list. */
export async function fetchCase(caseId: string): Promise<CaseDetailResponse> {
  return fetchApi<CaseDetailResponse>(`/api/cases/${caseId}/`);
}

/** Update top-level case fields (name, status, notes, referral_ref). */
export async function updateCase(
  caseId: string,
  data: Partial<Pick<CaseListItem, "name" | "status" | "notes" | "referral_ref">>
): Promise<CaseListItem> {
  return fetchApi<CaseListItem>(`/api/cases/${caseId}/`, {
    method: "PATCH",
    body: data,
  });
}

/** Fetch KPI dashboard metrics for a case. */
export async function fetchDashboard(caseId: string): Promise<DashboardResponse> {
  return fetchApi<DashboardResponse>(`/api/cases/${caseId}/dashboard/`);
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * Upload one or more files to a case.
 * Pass a FormData with the files already appended -- this endpoint uses
 * multipart/form-data, NOT JSON, so we bypass the default Content-Type header.
 */
export async function uploadDocuments(
  caseId: string,
  formData: FormData
): Promise<BulkUploadResponse> {
  const { ApiError } = await import("./base");
  const response = await fetch(`/api/cases/${caseId}/documents/bulk/`, {
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
  return response.json() as Promise<BulkUploadResponse>;
}

/**
 * Trigger batch OCR on all pending documents in a case.
 */
export async function processPendingDocuments(caseId: string): Promise<unknown> {
  return fetchApi<unknown>(`/api/cases/${caseId}/documents/process-pending/`, {
    method: "POST",
  });
}

/** Fetch a single document by ID. */
export async function fetchDocument(
  caseId: string,
  docId: string
): Promise<DocumentItem> {
  return fetchApi<DocumentItem>(`/api/cases/${caseId}/documents/${docId}/`);
}

/** Delete a document. Returns undefined (204). */
export async function deleteDocument(
  caseId: string,
  docId: string
): Promise<void> {
  return fetchApi<void>(`/api/cases/${caseId}/documents/${docId}/`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Referral package
// ---------------------------------------------------------------------------

/**
 * Generate the deterministic, citation-bearing referral PDF.
 * Returns a Blob -- callers should use URL.createObjectURL to open it.
 */
export async function generateReferralPdf(caseId: string): Promise<Blob> {
  return fetchApi<Blob>(`/api/cases/${caseId}/referral-pdf/`, {
    method: "POST",
    blob: true,
  });
}

// ---------------------------------------------------------------------------
// Financials
// ---------------------------------------------------------------------------

/** Fetch year-over-year 990 financial snapshots for a case. */
export async function fetchFinancials(
  caseId: string
): Promise<FinancialsResponse> {
  return fetchApi<FinancialsResponse>(`/api/cases/${caseId}/financials/`);
}

/** Fetch 990 XML data from IRS TEOS and create FinancialSnapshots. Pass { ein } to target a specific org. */
export async function fetch990s(caseId: string, params?: { ein?: string }): Promise<unknown> {
  return fetchApi<unknown>(`/api/cases/${caseId}/fetch-990s/`, {
    method: "POST",
    body: params ?? {},
  });
}

// ---------------------------------------------------------------------------
// Angles (Findings)
// ---------------------------------------------------------------------------

export interface AngleListParams extends PaginationParams, FindingFilterParams {}

/**
 * Fetch the paginated list of Angles (Findings) for a case.
 *
 * Use `source` filter chips in the Pipeline tab:
 *   "Rule" -> source=AUTO, "Manual" -> source=MANUAL, "AI" -> source=AI
 */
export async function fetchAngles(
  caseId: string,
  params: AngleListParams = {}
): Promise<FindingsResponse> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.severity) qs.set("severity", params.severity);
  if (params.source) qs.set("source", params.source);
  if (params.order_by) qs.set("order_by", params.order_by);
  if (params.direction) qs.set("direction", params.direction);
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  if (params.offset !== undefined) qs.set("offset", String(params.offset));
  const query = qs.toString() ? `?${qs}` : "";
  return fetchApi<FindingsResponse>(`/api/cases/${caseId}/findings/${query}`);
}

/**
 * Create a manual Angle (Finding).
 * The backend forces `source: MANUAL` and `status: NEW`.
 */
export async function createAngle(
  caseId: string,
  data: {
    title: string;
    narrative?: string;
    severity?: FindingItem["severity"];
    evidence_weight?: FindingItem["evidence_weight"];
    legal_refs?: string[];
    investigator_note?: string;
  }
): Promise<FindingItem> {
  return fetchApi<FindingItem>(`/api/cases/${caseId}/findings/`, {
    method: "POST",
    body: data,
  });
}

/**
 * Update an Angle's status, narrative, evidence weight, or investigator note.
 * Setting `status: "DISMISSED"` requires a non-empty `investigator_note`.
 */
export async function updateAngle(
  caseId: string,
  findingId: string,
  data: Partial<
    Pick<
      FindingItem,
      | "status"
      | "narrative"
      | "evidence_weight"
      | "severity"
      | "investigator_note"
      | "title"
      | "legal_refs"
    >
  >
): Promise<FindingItem> {
  return fetchApi<FindingItem>(`/api/cases/${caseId}/findings/${findingId}/`, {
    method: "PATCH",
    body: data,
  });
}

/** Delete an Angle permanently. Returns undefined (204). */
export async function deleteAngle(
  caseId: string,
  findingId: string
): Promise<void> {
  return fetchApi<void>(`/api/cases/${caseId}/findings/${findingId}/`, {
    method: "DELETE",
  });
}

/** Fetch a single Angle (Finding) by ID. */
export async function fetchAngle(caseId: string, findingId: string): Promise<FindingItem> {
  return fetchApi<FindingItem>(`/api/cases/${caseId}/findings/${findingId}/`);
}

/** Re-run all signal rules against a case, creating new Angles for new hits. */
export async function reevaluateSignals(caseId: string): Promise<unknown> {
  return fetchApi<unknown>(`/api/cases/${caseId}/reevaluate-findings/`, {
    method: "POST",
  });
}

/** Fetch global signal severity + status summary counts. */
export async function fetchSignalSummary(): Promise<SignalSummary> {
  return fetchApi<SignalSummary>("/api/signal-summary/");
}

// ---------------------------------------------------------------------------
// Notes (Quick Captures / Sticky Notes)
// ---------------------------------------------------------------------------

/** Fetch all notes for a case. */
export async function fetchNotes(
  caseId: string,
  params: PaginationParams = {}
): Promise<NotesResponse> {
  const qs = new URLSearchParams();
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  if (params.offset !== undefined) qs.set("offset", String(params.offset));
  const query = qs.toString() ? `?${qs}` : "";
  return fetchApi<NotesResponse>(`/api/cases/${caseId}/notes/${query}`);
}

/** Create a quick-capture note on any entity, finding, or document. */
export async function createNote(
  caseId: string,
  data: {
    target_type: InvestigatorNote["target_type"];
    target_id: string;
    content: string;
    created_by?: string;
  }
): Promise<InvestigatorNote> {
  return fetchApi<InvestigatorNote>(`/api/cases/${caseId}/notes/`, {
    method: "POST",
    body: data,
  });
}

/** Update note content. Only `content` and `created_by` are editable. */
export async function updateNote(
  caseId: string,
  noteId: string,
  data: { content: string; created_by?: string }
): Promise<InvestigatorNote> {
  return fetchApi<InvestigatorNote>(`/api/cases/${caseId}/notes/${noteId}/`, {
    method: "PATCH",
    body: data,
  });
}

/** Delete a note. Returns undefined (204). */
export async function deleteNote(
  caseId: string,
  noteId: string
): Promise<void> {
  return fetchApi<void>(`/api/cases/${caseId}/notes/${noteId}/`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Fuzzy match candidates (Pending Connections)
// ---------------------------------------------------------------------------

/** Fetch pending entity disambiguation candidates for a case. */
export async function fetchFuzzyMatches(
  caseId: string,
  params: {
    status?: "pending" | "merged" | "dismissed" | "all";
    entity_type?: "person" | "organization";
  } = {}
): Promise<FuzzyMatchResponse> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.entity_type) qs.set("entity_type", params.entity_type);
  const query = qs.toString() ? `?${qs}` : "";
  return fetchApi<FuzzyMatchResponse>(`/api/cases/${caseId}/fuzzy-candidates/${query}`);
}

/** Accept or dismiss a fuzzy match candidate. */
export async function resolveFuzzyMatch(
  caseId: string,
  candidateId: string,
  action: "accept" | "dismiss"
): Promise<FuzzyMatchCandidate> {
  return fetchApi<FuzzyMatchCandidate>(
    `/api/cases/${caseId}/fuzzy-candidates/${candidateId}/`,
    { method: "PATCH", body: { action } }
  );
}

// ---------------------------------------------------------------------------
// Global search + activity feed
// ---------------------------------------------------------------------------

/** Full-text search across cases, documents, entities, and Angles. */
export async function searchAll(params: {
  q: string;
  type?: "case" | "document" | "signal" | "entity";
  case_id?: string;
}): Promise<SearchResponse> {
  const qs = new URLSearchParams({ q: params.q });
  if (params.type) qs.set("type", params.type);
  if (params.case_id) qs.set("case_id", params.case_id);
  return fetchApi<SearchResponse>(`/api/search/?${qs}`);
}

/** Fetch recent audit log entries (activity feed). */
export async function fetchActivityFeed(params: {
  case_id?: string;
  limit?: number;
} = {}): Promise<ActivityFeedResponse> {
  const qs = new URLSearchParams();
  if (params.case_id) qs.set("case_id", params.case_id);
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  const query = qs.toString() ? `?${qs}` : "";
  return fetchApi<ActivityFeedResponse>(`/api/activity-feed/${query}`);
}

// ---------------------------------------------------------------------------
// AI endpoints
// ---------------------------------------------------------------------------

/**
 * Send a free-text question to the AI for the case context.
 * The backend enqueues a job (202) and this function polls until SUCCESS.
 * Callers receive the same { answer } shape as before — polling is transparent.
 */
export async function aiAsk(
  caseId: string,
  question: string,
  signal?: AbortSignal,
): Promise<{ answer: string }> {
  const enqueued = await fetchApi<{ job_id: string }>(
    `/api/cases/${caseId}/ai/ask/`,
    { method: "POST", body: { question } }
  );

  const jobId = enqueued.job_id;
  const MAX_POLLS = 30; // 30 × 2s = 60s max

  for (let i = 0; i < MAX_POLLS; i++) {
    if (signal?.aborted) throw new Error("Aborted");
    await new Promise<void>((r) => setTimeout(r, 2000));
    if (signal?.aborted) throw new Error("Aborted");
    const job = await fetchApi<{ status: string; result: unknown; error?: string }>(
      `/api/jobs/${jobId}/`
    );
    if (job.status === "SUCCESS") return job.result as { answer: string };
    if (job.status === "FAILED") throw new Error(job.error ?? "AI ask failed");
    // QUEUED / RUNNING — keep polling
  }

  throw new Error("AI ask timed out. Try again.");
}

// ---------------------------------------------------------------------------
// Investigation Steps
// ---------------------------------------------------------------------------

/** Fetch all investigation steps for a case, ordered by step_number. */
export async function getInvestigationSteps(
  caseId: string
): Promise<InvestigationStepsResponse> {
  return fetchApi<InvestigationStepsResponse>(
    `/api/cases/${caseId}/investigation-steps/`
  );
}

/** Create a new investigation step. */
export async function createInvestigationStep(
  caseId: string,
  params: CreateInvestigationStepParams
): Promise<InvestigationStep> {
  return fetchApi<InvestigationStep>(
    `/api/cases/${caseId}/investigation-steps/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }
  );
}

// ---------------------------------------------------------------------------
// Deceased persons (SOS signatory flag)
// ---------------------------------------------------------------------------

/** Returns persons in the case with date_of_death set or DECEASED role tag. */
export async function getDeceasedPersons(
  caseId: string
): Promise<DeceasedPersonsResponse> {
  return fetchApi<DeceasedPersonsResponse>(
    `/api/cases/${caseId}/persons/deceased/`
  );
}

// ---------------------------------------------------------------------------
// Referral Targets
// ---------------------------------------------------------------------------

export async function getReferralTargets(
  caseId: string
): Promise<ReferralTargetsResponse> {
  return fetchApi<ReferralTargetsResponse>(
    `/api/cases/${caseId}/referral-targets/`
  );
}

export async function createReferralTarget(
  caseId: string,
  params: CreateReferralTargetParams
): Promise<ReferralTarget> {
  return fetchApi<ReferralTarget>(`/api/cases/${caseId}/referral-targets/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

export async function updateReferralTarget(
  caseId: string,
  targetId: string,
  params: UpdateReferralTargetParams
): Promise<ReferralTarget> {
  return fetchApi<ReferralTarget>(
    `/api/cases/${caseId}/referral-targets/${targetId}/`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }
  );
}

export async function deleteReferralTarget(
  caseId: string,
  targetId: string
): Promise<void> {
  return fetchApi<void>(
    `/api/cases/${caseId}/referral-targets/${targetId}/`,
    { method: "DELETE" }
  );
}
