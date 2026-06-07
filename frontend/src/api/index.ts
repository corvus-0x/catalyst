/**
 * api/index.ts — Barrel re-export for all Catalyst API client functions.
 *
 * Components import from here:
 *   import { fetchCases, fetchAngles, fetchGraph } from '../api';
 *   import { ApiError } from '../api';
 *
 * Function-to-module mapping:
 *   base.ts     — fetchApi wrapper, ApiError class
 *   cases.ts    — cases, documents, Angles (findings), notes, fuzzy matches, search, AI chat
 *   research.ts — external data connectors, async job polling, AI pattern analysis
 *   graph.ts    — entity-relationship graph, entity browser, entity detail (Profile)
 */

// Core fetch wrapper + error type — import ApiError for instanceof checks in catch blocks
export { fetchApi, ApiError } from "./base";
export type { FetchOptions } from "./base";

// Cases, documents, Angles (findings), notes, fuzzy matches, search, activity feed, AI
export {
  fetchCases,
  createCase,
  fetchCase,
  updateCase,
  fetchDashboard,
  uploadDocuments,
  processPendingDocuments,
  fetchDocument,
  deleteDocument,
  generateReferralPdf,
  fetchFinancials,
  fetch990s,
  fetchAngles,
  fetchAngle,
  createAngle,
  updateAngle,
  deleteAngle,
  reevaluateSignals,
  fetchSignalSummary,
  fetchNotes,
  createNote,
  updateNote,
  deleteNote,
  fetchFuzzyMatches,
  resolveFuzzyMatch,
  searchAll,
  fetchActivityFeed,
  aiAsk,
  getInvestigationSteps,
  createInvestigationStep,
  getDeceasedPersons,
  getReferralTargets,
  createReferralTarget,
  updateReferralTarget,
  deleteReferralTarget,
} from "./cases";

// Param types exported from cases.ts
export type { PaginationParams, FindingFilterParams, CaseListParams, AngleListParams } from "./cases";

// External data source connectors (IRS, Ohio SOS, Ohio AOS, Recorder, Parcels)
// Async job polling (fetchJob, fetchCaseJobs)
// AI pattern analysis / Lead generation (runAiPatternAnalysis)
// Admin CSV management (uploadSosCsv, fetchSosCsvStatus)
export {
  searchIrs,
  searchOhioAos,
  searchParcels,
  searchOhioSos,
  searchRecorder,
  addResearchToCase,
  fetchJob,
  fetchCaseJobs,
  runAiPatternAnalysis,
  uploadSosCsv,
  fetchSosCsvStatus,
} from "./research";

// AsyncJobEnvelope re-export (convenience alias matching the JSDoc in research.ts)
export type { AsyncJobEnvelope } from "./research";

// Entity-relationship graph (the "Web") + entity detail (Profile drill-down)
export { fetchGraph, fetchEntities, fetchEntityDetail } from "./graph";
export type { EntityListParams } from "./graph";
