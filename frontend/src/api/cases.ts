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

/** Fetch signal rule coverage audit for a case. */
export async function fetchCoverage(caseId: string): Promise<unknown> {
  return fetchApi<unknown>(`/api/cases/${caseId}/coverage/`);
}

/** Export the full case as JSON or CSV. Returns a Blob. */
export async function exportCase(
  caseId: string,
  format: "json" | "csv"
): Promise<Blob> {
  return fetchApi<Blob>(`/api/cases/${caseId}/export/`, {
    method: "POST",
    body: { format },
    blob: true,
  });
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

/**
 * Generate an AI referral memo (legacy Session 30 feature; may be removed).
 * Returns markdown text.
 */
export async function generateReferralMemo(
  caseId: string
): Promise<{ memo: string }> {
  return fetchApi<{ memo: string }>(`/api/cases/${caseId}/referral-memo/`, {
    method: "POST",
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

/** Fetch 990 XML data from IRS TEOS and create FinancialSnapshots for the case. */
export async function fetch990s(caseId: string): Promise<unknown> {
  return fetchApi<unknown>(`/api/cases/${caseId}/fetch-990s/`, {
    method: "POST",
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
  return fetchApi<unknown>(`/api/cases/${caseId}/reevaluate-signals/`, {
    method: "POST",
  });
}

// ---------------------------------------------------------------------------
// Cross-case findings (Triage Queue)
// ---------------------------------------------------------------------------

/** Fetch Angles across all cases for the triage queue. */
export async function fetchAllAngles(
  params: AngleListParams = {}
): Promise<FindingsResponse> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.severity) qs.set("severity", params.severity);
  if (params.order_by) qs.set("order_by", params.order_by);
  if (params.direction) qs.set("direction", params.direction);
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  if (params.offset !== undefined) qs.set("offset", String(params.offset));
  const query = qs.toString() ? `?${qs}` : "";
  return fetchApi<FindingsResponse>(`/api/signals/${query}`);
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

/** Request an AI case summary. */
export async function aiSummarize(caseId: string): Promise<{ summary: string }> {
  return fetchApi<{ summary: string }>(`/api/cases/${caseId}/ai/summarize/`, {
    method: "POST",
  });
}

/** Request an AI relationship analysis. */
export async function aiConnections(caseId: string): Promise<{ analysis: string }> {
  return fetchApi<{ analysis: string }>(`/api/cases/${caseId}/ai/connections/`, {
    method: "POST",
  });
}

/** Request an AI narrative draft. */
export async function aiNarrative(caseId: string): Promise<{ narrative: string }> {
  return fetchApi<{ narrative: string }>(`/api/cases/${caseId}/ai/narrative/`, {
    method: "POST",
  });
}

/** Send a free-text question to the AI for the case context. */
export async function aiAsk(
  caseId: string,
  question: string
): Promise<{ answer: string }> {
  return fetchApi<{ answer: string }>(`/api/cases/${caseId}/ai/ask/`, {
    method: "POST",
    body: { question },
  });
}
