/**
 * Catalyst — TypeScript Type Definitions
 * Generated from: docs/architecture/api-contract.md (v1.0, Session 38)
 *
 * VOCABULARY NOTE (from CLAUDE.md):
 *   Angle     = Finding (the narrative unit of investigation — one line of inquiry)
 *   Knot      = Person or Organization node in the graph (NOT Property)
 *   Connection = Graph edge (Relationship / PersonOrganization / PropertyTransaction)
 *   Web       = The Cytoscape graph canvas (the full investigation graph)
 *   Lead      = AI-generated Finding (source === "AI", powered by Sonnet — never show model name)
 *   Intake    = Document extraction pipeline (powered by Haiku — never show model name)
 *   Quick capture = InvestigatorNote attached to any entity, finding, or case
 *
 * MONETARY FIELD RULES:
 *   - Dashboard endpoint (/dashboard/): monetary values are STRINGS ("2340000") — Django
 *     serializes Decimal fields as strings to avoid float rounding. Parse with parseFloat().
 *   - Financials endpoint (/financials/): monetary values are INTEGERS (number type) — stored
 *     as IntegerField on the model, not Decimal. No parsing needed.
 *
 * BANNED UI STRINGS: "Haiku", "Sonnet", "Opus", "Claude", "AI assistant", "LLM", "GPT"
 * Use "Lead" for AI analysis results, "Intake" for extraction pipeline references.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** UUID — always a string (never a raw integer) */
type UUID = string;

/** ISO 8601 datetime string — e.g. "2024-01-15T12:30:00+00:00" */
type ISO8601 = string;

/** Decimal value serialized as string by Django — parse with parseFloat() when needed */
type DecimalString = string;

// ---------------------------------------------------------------------------
// Shared enums and unions
// ---------------------------------------------------------------------------

/** Case workflow status */
export type CaseStatus = "ACTIVE" | "PAUSED" | "REFERRED" | "CLOSED";

/**
 * Document type codes.
 * The doc_type field on DocumentItem uses one of these values.
 */
export type DocType =
  | "IRS_990"
  | "DEED"
  | "UCC"
  | "BANK_STATEMENT"
  | "AUDIT_REPORT"
  | "PERMIT"
  | "CONTRACT"
  | "CORRESPONDENCE"
  | "OTHER"
  | "UNKNOWN";

/** OCR processing status */
export type OcrStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "SKIPPED";

/** Entity extraction processing status */
export type ExtractionStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";

/**
 * Finding severity levels, from most to least serious.
 * Drives edge colour in the graph:
 *   CRITICAL → coral (#D85A30)
 *   HIGH     → amber (#BA7517)
 *   MEDIUM   → blue (#185FA5)
 *   LOW/INFORMATIONAL → gray
 */
export type FindingSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFORMATIONAL";

/**
 * Finding workflow status.
 * Frontend vocabulary mapping:
 *   NEEDS_EVIDENCE → "Active" angle (open, investigator is building narrative)
 *   CONFIRMED      → "Confirmed" angle (tied off, evidence cited)
 *   DISMISSED      → "Exhausted" angle (dead end)
 *   NEW            → not yet triaged
 */
export type FindingStatus = "NEW" | "NEEDS_EVIDENCE" | "DISMISSED" | "CONFIRMED";

/**
 * Confidence level of the evidence supporting a finding.
 * Controls what badge/label appears on an Angle card.
 */
export type EvidenceWeight = "SPECULATIVE" | "DIRECTIONAL" | "DOCUMENTED" | "TRACED";

/**
 * How a finding was created.
 *   AUTO   → rule engine fired (maps to "Rule" filter chip in UI)
 *   MANUAL → investigator created (maps to "Manual" filter chip)
 *   AI     → Lead analysis result (maps to "AI" filter chip)
 *             AI findings should never display model name — show "Lead" in the UI.
 */
export type FindingSource = "AUTO" | "MANUAL" | "AI";

/**
 * Entity type codes used across graph nodes, entity browser, and entity detail.
 * Only "person" and "organization" are eligible as Knots in the graph toolbar
 * and in the Angle entity picker. "property" and "financial_instrument" appear
 * in the graph for positional context only.
 */
export type EntityType = "person" | "organization" | "property" | "financial_instrument";

/**
 * Knot entity types — only Person and Organization.
 * Use this union when a UI element should restrict to valid knot targets
 * (e.g. the "+ Tie to knot" picker in the Angle form).
 */
export type KnotEntityType = "person" | "organization";

/** Async job type codes */
export type JobType =
  | "IRS_NAME_SEARCH"
  | "IRS_FETCH_XML"
  | "OHIO_AOS"
  | "COUNTY_PARCEL"
  | "AI_PATTERN_ANALYSIS"
  | "AI_ASK";

/** Async job lifecycle status */
export type JobStatus = "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED";

/** Graph edge relationship types */
export type EdgeRelationship =
  | "OFFICER_OF"
  | "CO_APPEARS_IN"
  | "PURCHASED"
  | "SOLD_BY"
  | "FAMILY"
  | "BUSINESS"
  | "SOCIAL";

/** Note target types — any model that can receive a sticky note */
export type NoteTargetType =
  | "document"
  | "finding"
  | "person"
  | "organization"
  | "property"
  | "financial_instrument"
  | "case";

/** Fuzzy match candidate resolution status */
export type FuzzyMatchStatus = "PENDING" | "MERGED" | "DISMISSED";

// ---------------------------------------------------------------------------
// Generic pagination wrapper
// ---------------------------------------------------------------------------

/**
 * Standard paginated response envelope used by most list endpoints.
 * next_offset and previous_offset are null when there is no next/previous page.
 */
export interface PaginatedResponse<T> {
  count: number;
  limit: number;
  offset: number;
  next_offset: number | null;
  previous_offset: number | null;
  results: T[];
}

// ---------------------------------------------------------------------------
// Section 1 — Case List View
// GET /api/cases/
// POST /api/cases/
// ---------------------------------------------------------------------------

/** A single row in the case list table or Kanban card */
export interface CaseListItem {
  id: UUID;
  name: string;
  status: CaseStatus;
  /** Free-text investigation notes. Empty string if not set, never null. */
  notes: string;
  /** External reference number (AG/IRS/FBI case number). Empty string if not set. */
  referral_ref: string;
  created_at: ISO8601;
  updated_at: ISO8601;
}

/** Response from GET /api/cases/ */
export type CaseListResponse = PaginatedResponse<CaseListItem>;

/** Body for POST /api/cases/ — name is required, others optional */
export interface CreateCaseBody {
  name: string;
  status?: CaseStatus;
  notes?: string;
  referral_ref?: string;
}

// ---------------------------------------------------------------------------
// Section 3 — Documents
// GET /api/cases/:id/ (includes document list)
// GET /api/cases/:id/documents/:doc_id/
// POST /api/cases/:id/documents/bulk/
// DELETE /api/cases/:id/documents/:doc_id/ → 204 No Content
// ---------------------------------------------------------------------------

/**
 * A single document — upload, OCR, or auto-fetched.
 * display_name is the investigator-set friendly name (empty string if not set).
 * source_url is non-null only for auto-fetched documents (e.g. IRS pipeline).
 * file_size is integer bytes.
 * sha256_hash is a 64-character hex string — the chain-of-custody fingerprint.
 */
export interface DocumentItem {
  id: UUID;
  filename: string;
  /** Investigator-set friendly name. Empty string "" if not set (never null). */
  display_name: string;
  file_path: string;
  /** 64-character SHA-256 hex digest. Guarantees chain of custody. */
  sha256_hash: string;
  /** File size in bytes (integer) */
  file_size: number;
  doc_type: DocType;
  /** True for system-generated documents (e.g. referral PDFs) */
  is_generated: boolean;
  doc_subtype: string;
  /** Non-null only for documents fetched from an external API (IRS TEOS, etc.) */
  source_url: string | null;
  ocr_status: OcrStatus;
  extraction_status: ExtractionStatus;
  extraction_notes: string;
  /**
   * Full OCR-extracted text of the document. Empty string "" if extraction has not completed.
   * Populated on the document detail endpoint (GET /api/cases/:id/documents/:doc_id/).
   */
  extracted_text?: string;
  uploaded_at: ISO8601;
  updated_at: ISO8601;
}

/**
 * Response from GET /api/cases/:id/ — full case detail including all documents.
 * Also used by the Overview/Investigate tab for initial case load.
 */
export interface CaseDetailResponse {
  id: UUID;
  name: string;
  status: CaseStatus;
  notes: string;
  referral_ref: string;
  created_at: ISO8601;
  updated_at: ISO8601;
  documents: DocumentItem[];
}

/** Response from POST /api/cases/:id/documents/bulk/ */
export interface BulkUploadResponse {
  created: DocumentItem[];
  errors: Array<{ filename: string; error: string }>;
}

// ---------------------------------------------------------------------------
// Section 2 — Case Dashboard
// GET /api/cases/:id/dashboard/
// ---------------------------------------------------------------------------

/**
 * One row of the financial timeline used by the dashboard sparkline.
 * revenue and expenses are STRINGS (Decimal) — use parseFloat() before math.
 */
export interface DashboardTimelineRow {
  year: number;
  /** Decimal string — parse with parseFloat() */
  revenue: DecimalString;
  /** Decimal string — parse with parseFloat() */
  expenses: DecimalString;
}

/** Signal rule summary row shown in the "top rules" list on the dashboard */
export interface TopRuleSummary {
  rule_id: string;
  summary: string;
  count: number;
}

/**
 * Response from GET /api/cases/:id/dashboard/.
 *
 * IMPORTANT: All monetary values in this response are STRINGS (Decimal).
 * This is different from the /financials/ endpoint where they are integers.
 * Always parse with parseFloat() before display or arithmetic.
 */
export interface DashboardResponse {
  case: {
    id: UUID;
    name: string;
    status: CaseStatus;
    created_at: ISO8601;
    referral_ref: string;
  };
  documents: {
    total: number;
    by_type: Record<string, number>;
    by_extraction_status: Record<string, number>;
    renamed_count: number;
  };
  entities: {
    persons: number;
    organizations: number;
    properties: number;
    financial_instruments: number;
    total: number;
  };
  findings: {
    total: number;
    by_severity: Partial<Record<FindingSeverity, number>>;
    by_status: Partial<Record<FindingStatus, number>>;
    top_rules: TopRuleSummary[];
  };
  financials: {
    years_covered: number;
    /** Decimal string — parse with parseFloat() */
    total_revenue: DecimalString;
    /** Decimal string — parse with parseFloat() */
    total_expenses: DecimalString;
    timeline: DashboardTimelineRow[];
  };
  pipeline: {
    extraction_success_rate: number;
    ai_enhanced_count: number;
    total_documents_processed: number;
  };
}

// ---------------------------------------------------------------------------
// Section 2 — Entity Relationship Graph
// GET /api/cases/:id/graph/
// ---------------------------------------------------------------------------

/**
 * Metadata on a finding that touches an edge — used to colour the edge.
 * Dismissed findings are excluded from this array.
 * If finding_links is non-empty, render the edge with a highlighted stroke
 * using the colour of the highest-severity finding.
 * See GAP-1 (Section 16 of api-contract.md) — this field was added in Session 38.
 */
export interface EdgeFindingLink {
  finding_id: UUID;
  status: FindingStatus;
  severity: FindingSeverity;
  title: string;
}

/**
 * A node in the entity-relationship graph (the "Web").
 * Only "person" and "organization" nodes are Knots — eligible as targets in angle pickers.
 * "property" and "financial_instrument" nodes appear for positional context only.
 */
export interface GraphNode {
  id: UUID;
  type: EntityType;
  label: string;
  metadata: GraphNodeMetadata;
}

/**
 * Metadata on a graph node — varies by entity type.
 * All fields not applicable to a given type are absent (not null).
 */
export interface GraphNodeMetadata {
  finding_count: number;
  doc_count: number;
  /** Person: role tags from PersonOrganization (e.g. ["OFFICER"]) */
  role_tags?: string[];
  /** Person: known aliases */
  aliases?: string[];
  /** Person: null if alive or unknown */
  date_of_death?: string | null;
  /** Organization: org type code (LLC, NONPROFIT, etc.) */
  org_type?: string;
  /** Organization: Employer Identification Number in XX-XXXXXXX format */
  ein?: string | null;
  /** Organization: registration status */
  status?: string;
  /** Property: county auditor parcel number */
  parcel_number?: string | null;
  county?: string | null;
  /** Property: Decimal string */
  assessed_value?: DecimalString | null;
  /** Property: Decimal string */
  purchase_price?: DecimalString | null;
  /** FinancialInstrument: e.g. "UCC", "LIEN" */
  instrument_type?: string;
  filing_number?: string | null;
  filing_date?: string | null;
  /** FinancialInstrument: Decimal string */
  amount?: DecimalString | null;
}

/**
 * An edge in the entity-relationship graph.
 * metadata shape varies by relationship type — see inline comments.
 *
 * OFFICER_OF:    metadata.start_date (string), metadata.end_date (string | null)
 * CO_APPEARS_IN: metadata.document_ids (string[])
 * PURCHASED / SOLD_BY: metadata.transaction_date, metadata.price, metadata.instrument_number
 * FAMILY / BUSINESS / SOCIAL: metadata.source_type, metadata.confidence, metadata.notes
 *
 * CO_APPEARS_IN edges are computed synthetic edges — they cannot be confirmed or dismissed.
 * Proposed (dashed) edges come from ingestion_metadata on Document, not from this endpoint.
 */
export interface GraphEdge {
  source: UUID;
  target: UUID;
  relationship: EdgeRelationship;
  label: string;
  /** Number of documents supporting this connection */
  weight: number;
  /** Shape varies by relationship type — see JSDoc above */
  metadata: Record<string, unknown>;
  /**
   * Findings that touch both endpoints of this edge.
   * Empty array means no findings involve both entities.
   * Use severity of the first entry (highest) to pick edge stroke colour.
   * Added in Session 38 (GAP-1 resolved).
   */
  finding_links: EdgeFindingLink[];
}

/**
 * An event on the investigation timeline (brushable D3 rail).
 * layer determines which metadata fields are present — see inline comments.
 *
 * document:    metadata.doc_type
 * finding:     metadata.severity, metadata.rule_id
 * financial:   metadata.tax_year, metadata.total_revenue, metadata.total_expenses, metadata.entity_id
 * transaction: metadata.price, metadata.property_id, metadata.buyer_id, metadata.seller_id
 */
export interface TimelineEvent {
  id: UUID;
  layer: "document" | "finding" | "financial" | "transaction";
  date: ISO8601;
  label: string;
  /** Shape varies by layer — see JSDoc above */
  metadata: Record<string, unknown>;
}

/** Graph stats block at the bottom of the graph response */
export interface GraphStats {
  total_nodes: number;
  total_edges: number;
  total_events: number;
  node_types: Record<string, number>;
}

/** Response from GET /api/cases/:id/graph/ */
export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  timeline_events: TimelineEvent[];
  stats: GraphStats;
}

// ---------------------------------------------------------------------------
// Section 5 — Financials Tab
// GET /api/cases/:id/financials/
// ---------------------------------------------------------------------------

/**
 * One row in the year-over-year 990 financials table.
 *
 * IMPORTANT: All monetary values here are INTEGERS (number type) — stored as IntegerField.
 * This is different from the /dashboard/ endpoint where monetary values are Decimal strings.
 * null means the data was not available in the source filing.
 *
 * YoY percentage fields (*_yoy_pct) are only present on rows at index >= 1.
 * The first year (oldest) has no prior year to compare against.
 */
export interface FinancialSnapshot {
  id: UUID;
  document_id: UUID;
  document_filename: string | null;
  organization_id: UUID | null;
  organization_name: string | null;
  /** EIN in XX-XXXXXXX format */
  ein: string | null;
  tax_year: number;
  form_type: string | null;
  /** Integer dollars. null if not available in this filing. */
  total_contributions: number | null;
  program_service_revenue: number | null;
  investment_income: number | null;
  other_revenue: number | null;
  total_revenue: number | null;
  grants_paid: number | null;
  salaries_and_compensation: number | null;
  professional_fundraising: number | null;
  other_expenses: number | null;
  total_expenses: number | null;
  revenue_less_expenses: number | null;
  total_assets_boy: number | null;
  total_assets_eoy: number | null;
  total_liabilities_boy: number | null;
  total_liabilities_eoy: number | null;
  net_assets_boy: number | null;
  net_assets_eoy: number | null;
  officer_compensation_total: number | null;
  num_employees: number | null;
  num_voting_members: number | null;
  num_independent_members: number | null;
  /** Part IV Line 28 — org disclosed related-party transactions. null if not parsed. */
  related_party_disclosed: boolean | null;
  /** Part VI Line 12a — conflict of interest policy. null if not parsed. */
  has_coi_policy: boolean | null;
  /** Part VI Line 13 — whistleblower policy. null if not parsed. */
  has_whistleblower_policy: boolean | null;
  /** Part VI Line 14 — document retention policy. null if not parsed. */
  has_document_retention_policy: boolean | null;
  /** Backend returns "IRS_TEOS_XML" for TEOS pipeline data, "EXTRACTED" for OCR-parsed */
  source: string;
  /** Confidence score 0.0–1.0 */
  confidence: number;
  /** Only present on rows[1..n] — undefined on the first (oldest) row */
  total_revenue_yoy_pct?: number;
  total_expenses_yoy_pct?: number;
  total_assets_eoy_yoy_pct?: number;
  net_assets_eoy_yoy_pct?: number;
}

/** Response from GET /api/cases/:id/financials/ */
export interface FinancialsResponse {
  count: number;
  results: FinancialSnapshot[];
}

// ---------------------------------------------------------------------------
// Section 7 — Investigation Tab
// ---------------------------------------------------------------------------

/** Minimal finding reference embedded in an InvestigationStep */
export interface StepFindingLink {
  id: UUID;
  title: string;
  severity: FindingSeverity;
  status: FindingStatus;
}

/**
 * One step in the investigation replay.
 * who_originated: "T" = investigator, "C" = Claude, "X" = external tip
 * status: "RESOLVED" | "OPEN" | "DEAD_END"
 */
export interface InvestigationStep {
  id: UUID;
  step_number: number;
  question: string;
  source: string;
  what_was_found: string;
  who_originated: "T" | "C" | "X";
  triggered_finding: StepFindingLink | null;
  triggered_question: string;
  status: "RESOLVED" | "OPEN" | "DEAD_END";
  created_at: ISO8601;
}

export interface InvestigationStepsResponse {
  count: number;
  results: InvestigationStep[];
}

/** Minimal deceased person record for SOS signatory flag check */
export interface DeceasedPerson {
  full_name: string;
  date_of_death: string | null;
}

export interface DeceasedPersonsResponse {
  results: DeceasedPerson[];
}

// ---------------------------------------------------------------------------
// Section 8 — Referrals Tab
// ---------------------------------------------------------------------------

export type ReferralStatus = "DRAFT" | "SENT" | "ACKNOWLEDGED" | "CLOSED";

export interface ReferralTarget {
  id: UUID;
  agency_name: string;
  complaint_type: string;
  reference_number: string;
  contact: string;
  status: ReferralStatus;
  notes: string;
  created_at: ISO8601;
}

export interface ReferralTargetsResponse {
  count: number;
  results: ReferralTarget[];
}

export interface CreateReferralTargetParams {
  agency_name: string;
  complaint_type?: string;
  reference_number?: string;
  contact?: string;
  status?: ReferralStatus;
  notes?: string;
}

export interface UpdateReferralTargetParams {
  agency_name?: string;
  complaint_type?: string;
  reference_number?: string;
  contact?: string;
  status?: ReferralStatus;
  notes?: string;
}

export interface CreateInvestigationStepParams {
  step_number: number;
  question: string;
  source?: string;
  what_was_found?: string;
  who_originated?: "T" | "C" | "X";
  triggered_finding_id?: string | null;
  triggered_question?: string;
  status?: "RESOLVED" | "OPEN" | "DEAD_END";
}

// ---------------------------------------------------------------------------
// Section 6 — Pipeline Tab (Angles / Findings)
// GET  /api/cases/:id/findings/
// POST /api/cases/:id/findings/
// PATCH /api/cases/:id/findings/:finding_id/
// DELETE /api/cases/:id/findings/:finding_id/
// Also: GET /api/signals/ (cross-case, same shape)
// ---------------------------------------------------------------------------

/** A link from a Finding to one of the entities involved in it */
export interface FindingEntityLink {
  entity_id: UUID;
  entity_type: EntityType;
  context_note: string;
}

/** A link from a Finding to a source document with citation info */
export interface FindingDocumentLink {
  document_id: UUID;
  document_filename: string;
  /** Human-readable page reference, e.g. "p. 3" */
  page_reference: string;
  context_note: string;
}

/**
 * evidence_snapshot for AI-generated findings (source === "AI" / Lead results).
 * Added in Session 36 / GAP-2 resolved in Session 38.
 *
 * doc_refs:           the [Doc-N] keys cited in the narrative, e.g. ["Doc-1", "Doc-3"]
 * doc_ref_resolution: maps each [Doc-N] key to the stable document UUID at analysis time.
 *                     Use this to resolve "[Doc-3]" → filename for display.
 *                     OLDER AI findings may lack this field — handle gracefully by
 *                     falling back to displaying the raw "[Doc-N]" tag as plain text.
 * rationale:          the Lead's explanation for why this pattern is significant
 * suggested_action:   the Lead's recommended next investigative step
 */
export interface AiEvidenceSnapshot {
  doc_refs: string[];
  doc_ref_resolution: Record<string, UUID>;
  rationale: string;
  suggested_action: string;
}

/**
 * evidence_snapshot for rule-engine findings (source === "AUTO").
 * Content varies by rule — see CLAUDE.md signal rules for per-rule field docs.
 * Common keys:
 *   SR-015: property_id, buyer_entity_id, seller_entity_id, transaction_id
 *   SR-025: snapshot_id, ein, tax_year, part_iv_field, contradiction_doc_id
 *   SR-006/012/013/028/029 (XML evaluator): snapshot_id, ein, tax_year, plus rule-specific fields
 */
export type AutoEvidenceSnapshot = Record<string, unknown>;

/**
 * FindingItem is the core data model for the Pipeline tab and Triage queue.
 *
 * FRONTEND VOCABULARY:
 *   FindingItem = one "Angle" in the UI (the narrative unit of investigation)
 *   source === "AI" → this is a "Lead" (Lead analysis result — never show "AI" or "Claude")
 *
 * The evidence_snapshot shape differs by source:
 *   source === "AUTO"   → AutoEvidenceSnapshot (rule-specific fields)
 *   source === "AI"     → AiEvidenceSnapshot (doc_refs, doc_ref_resolution, rationale, suggested_action)
 *   source === "MANUAL" → usually empty object {}
 */
export interface FindingItem {
  id: UUID;
  /**
   * Signal rule ID for AUTO findings (e.g. "SR-015").
   * "MANUAL" for investigator-created findings.
   * "AI" for Lead analysis results.
   */
  rule_id: string;
  title: string;
  description: string;
  /**
   * Free-text investigative narrative with [Doc-N] citations.
   * Empty string if not yet written. Investigator fills this in the Angle view.
   */
  narrative: string;
  severity: FindingSeverity;
  /** See FindingStatus for frontend vocabulary (Active / Confirmed / Exhausted / Untriaged) */
  status: FindingStatus;
  evidence_weight: EvidenceWeight;
  /**
   * How this finding was created.
   * UI chip labels: AUTO → "Rule" | MANUAL → "Manual" | AI → "AI" (shown, but use "Lead" in tooltips)
   */
  source: FindingSource;
  /** Short rationale — required when dismissing (setting status to DISMISSED). */
  investigator_note: string;
  /** Legal code references, e.g. ["26 USC 4958", "Ohio Rev. Code 1716.15"] */
  legal_refs: string[];
  /**
   * Structured evidence data. Shape varies by source and rule.
   * AI findings include doc_ref_resolution for [Doc-N] → UUID mapping.
   */
  evidence_snapshot: AutoEvidenceSnapshot | AiEvidenceSnapshot | Record<string, never>;
  /** The document that triggered the rule. null for MANUAL findings. */
  trigger_doc_id: UUID | null;
  /** Filename of the trigger document. null if trigger_doc_id is null. */
  trigger_doc_filename: string | null;
  /** The entity that triggered the rule. null for MANUAL findings. */
  trigger_entity_id: UUID | null;
  created_at: ISO8601;
  updated_at: ISO8601;
  /** Entities involved in this finding. May be empty []. */
  entity_links: FindingEntityLink[];
  /** Source documents cited by this finding. May be empty []. */
  document_links: FindingDocumentLink[];
}

/**
 * Angle is the frontend vocabulary alias for a FindingItem.
 * Use FindingItem in type annotations; this alias is for readability in
 * component prop types and comments.
 *
 * Note: A "Lead" is an Angle with source === "AI". There is no separate type.
 * In the UI, show the "Lead" badge on AI findings — never the word "AI".
 */
export type Angle = FindingItem;

/** Response from GET /api/cases/:id/findings/ and GET /api/signals/ */
export type FindingsResponse = PaginatedResponse<FindingItem>;

/** Body for POST /api/cases/:id/findings/ (manual finding creation) */
export interface CreateFindingBody {
  title: string;
  narrative?: string;
  severity?: FindingSeverity;
  evidence_weight?: EvidenceWeight;
  legal_refs?: string[];
  investigator_note?: string;
}

/**
 * Body for PATCH /api/cases/:id/findings/:finding_id/.
 * All fields are optional — send only those being changed.
 * VALIDATION: status "DISMISSED" requires a non-empty investigator_note.
 * The server returns 400 if you dismiss without a rationale.
 */
export interface UpdateFindingBody {
  title?: string;
  narrative?: string;
  severity?: FindingSeverity;
  evidence_weight?: EvidenceWeight;
  status?: FindingStatus;
  investigator_note?: string;
  legal_refs?: string[];
}

/** Summary counts from GET /api/signal-summary/ */
export interface SignalSummary {
  total: number;
  by_severity: Partial<Record<FindingSeverity, number>>;
  by_status: Partial<Record<FindingStatus, number>>;
}

// ---------------------------------------------------------------------------
// Section 8 — Entity Browser
// GET /api/entities/
// ---------------------------------------------------------------------------

/** Base fields present on every entity browser result regardless of type */
interface EntityBrowserBase {
  id: UUID;
  entity_type: EntityType;
  name: string;
  case_id: UUID;
  case_name: string;
  notes: string;
  created_at: ISO8601;
  updated_at: ISO8601;
}

/** Person entity in the browser list */
export interface PersonBrowserItem extends EntityBrowserBase {
  entity_type: "person";
  /** Role codes from PersonOrganization e.g. ["OFFICER", "DIRECTOR"] */
  role_tags: string[];
  aliases: string[];
  date_of_death: ISO8601 | null;
}

/** Organization entity in the browser list */
export interface OrgBrowserItem extends EntityBrowserBase {
  entity_type: "organization";
  org_type: string;
  /** EIN in XX-XXXXXXX format */
  ein: string | null;
  registration_state: string;
  status: string;
  formation_date: string | null;
}

/** Property entity in the browser list */
export interface PropertyBrowserItem extends EntityBrowserBase {
  entity_type: "property";
}

/** Financial instrument entity in the browser list */
export interface FinancialInstrumentBrowserItem extends EntityBrowserBase {
  entity_type: "financial_instrument";
}

/** Discriminated union of all entity browser result types */
export type EntityBrowserItem =
  | PersonBrowserItem
  | OrgBrowserItem
  | PropertyBrowserItem
  | FinancialInstrumentBrowserItem;

/** Response from GET /api/entities/ */
export type EntityBrowserResponse = PaginatedResponse<EntityBrowserItem>;

// ---------------------------------------------------------------------------
// Section 9 — Entity Detail / Profile View
// GET /api/entities/:type/:id/
// ---------------------------------------------------------------------------

/**
 * Extended DocumentItem as returned inside entity detail —
 * includes page_reference and context_note from the PersonDocument / OrgDocument link.
 */
export interface RelatedDocument extends DocumentItem {
  page_reference: string;
  context_note: string;
}

/** Compact finding summary shown in the Profile sidebar */
export interface RelatedFindingSummary {
  id: UUID;
  title: string;
  severity: FindingSeverity;
  status: FindingStatus;
  context_note: string;
}

/** Role record in a person's organization_roles list */
export interface PersonOrgRole {
  organization_id: UUID;
  organization_name: string;
  role: "OFFICER" | "BOARD_MEMBER" | "COUNSEL" | "ADVISOR";
  start_date: string | null;
  end_date: string | null;
  notes: string;
}

/**
 * Property transaction record — only present on property entity detail.
 * price is a Decimal string — parse with parseFloat() before display.
 */
export interface PropertyTransaction {
  id: UUID;
  transaction_date: string;
  buyer_id: UUID;
  seller_id: UUID;
  /** Decimal string — parse with parseFloat() */
  price: DecimalString;
  document_id: UUID;
  notes: string;
}

/** Person entity full detail response */
export interface PersonDetailResponse {
  id: UUID;
  entity_type: "person";
  name: string;
  case_id: UUID;
  case_name: string;
  role_tags: string[];
  aliases: string[];
  date_of_death: ISO8601 | null;
  notes: string;
  created_at: ISO8601;
  updated_at: ISO8601;
  related_documents: RelatedDocument[];
  /**
   * Full Finding objects. Prefer related_findings for the compact list.
   * related_signals is kept for backward compat — contains the same data.
   * See GAP-3 in api-contract.md — ignore related_signals, use related_findings.
   */
  related_signals: FindingItem[];
  /** Compact list — use this for the Profile sidebar */
  related_findings: RelatedFindingSummary[];
  organization_roles: PersonOrgRole[];
}

/** Organization entity full detail response */
export interface OrgDetailResponse {
  id: UUID;
  entity_type: "organization";
  name: string;
  case_id: UUID;
  case_name: string;
  org_type: string;
  ein: string | null;
  registration_state: string;
  status: string;
  formation_date: string | null;
  notes: string;
  created_at: ISO8601;
  updated_at: ISO8601;
  related_documents: RelatedDocument[];
  related_signals: FindingItem[];
  related_findings: RelatedFindingSummary[];
}

/** Property entity full detail response */
export interface PropertyDetailResponse {
  id: UUID;
  entity_type: "property";
  name: string;
  case_id: UUID;
  case_name: string;
  notes: string;
  created_at: ISO8601;
  updated_at: ISO8601;
  related_documents: RelatedDocument[];
  related_signals: FindingItem[];
  related_findings: RelatedFindingSummary[];
  transactions: PropertyTransaction[];
}

/** Discriminated union of all entity detail response types */
export type EntityDetailResponse =
  | PersonDetailResponse
  | OrgDetailResponse
  | PropertyDetailResponse;

/**
 * Knot is the frontend vocabulary alias for a Person or Organization graph node.
 * A Knot can be a PersonDetailResponse or OrgDetailResponse.
 * Properties are NOT knots — you cannot press charges on a property.
 */
export type Knot = PersonDetailResponse | OrgDetailResponse;

// ---------------------------------------------------------------------------
// Section 11 — Global Search
// GET /api/search/
// ---------------------------------------------------------------------------

/**
 * One result from the global search endpoint.
 * All result types share the same 9 fields — use route directly with useNavigate().
 */
export interface SearchResult {
  type: "case" | "document" | "signal" | "entity";
  id: UUID;
  title: string;
  subtitle: string;
  snippet: string;
  /** Score 0.0–1.0 */
  relevance: number;
  case_id: UUID;
  case_name: string;
  /** React Router path — usable directly with useNavigate()(result.route) */
  route: string;
}

/** Response from GET /api/search/ */
export interface SearchResponse {
  count: number;
  results: SearchResult[];
}

// ---------------------------------------------------------------------------
// Section 12 — Activity Feed
// GET /api/activity-feed/
// ---------------------------------------------------------------------------

/**
 * AuditLog action codes.
 * These are append-only forensic records — never updated or deleted.
 */
export type AuditAction =
  | "DOCUMENT_UPLOADED"
  | "DOCUMENT_DELETED"
  | "FINDING_CREATED"
  | "FINDING_UPDATED"
  | "FINDING_DISMISSED"
  | "FINDING_CONFIRMED"
  | "CASE_CREATED"
  | "CASE_UPDATED"
  | "ENTITY_CREATED"
  | "NOTE_CREATED";

/** One entry in the investigation audit log */
export interface ActivityFeedItem {
  id: UUID;
  case_id: UUID;
  table_name: string;
  record_id: UUID;
  action: AuditAction;
  performed_by: string;
  performed_at: ISO8601;
  notes: string;
}

/** Response from GET /api/activity-feed/ */
export interface ActivityFeedResponse {
  count: number;
  results: ActivityFeedItem[];
}

// ---------------------------------------------------------------------------
// Section 13 — Async Job Polling
// GET /api/jobs/:job_id/
// GET /api/cases/:id/jobs/
// POST /api/cases/:id/ai/analyze-patterns/ → 202
// POST /api/cases/:id/research/irs/        → 202
// POST /api/cases/:id/research/ohio-aos/   → 202
// POST /api/cases/:id/research/parcels/    → 202
// ---------------------------------------------------------------------------

/** Response body from the 202 Accepted response of any async endpoint */
export interface AsyncJobEnqueuedResponse {
  job_id: UUID;
  status_url: string;
}

/**
 * result shape for a completed AI_PATTERN_ANALYSIS job.
 * Use findings_created and patterns_dropped for the toast notification.
 */
export interface AiPatternJobResult {
  findings_created: number;
  patterns_dropped: number;
}

/**
 * result shape for a completed AI_ASK job.
 * Same fields the old synchronous endpoint returned directly.
 */
export interface AiAskJobResult {
  /** Prose answer from Claude (four-section format: data / assessment / exculpatory / thread). */
  answer: string;
  /** Documents Claude cited via the search_case_documents tool. */
  sources: Array<{ type: string; id: string; label: string }>;
  /** Raw tool call records for debugging / transparency. */
  tool_calls_made: Array<{ name: string; input: Record<string, unknown>; match_count?: number; error?: string }>;
  /** True if Claude hit the tool-use budget before finishing (up to 6 Claude API calls: 1 initial + 5 tool iterations). */
  tool_budget_exceeded: boolean;
  _model: string;
  _usage: { input_tokens: number; output_tokens: number };
}

/**
 * result shape for a completed IRS_NAME_SEARCH job.
 * The results array contains IRS filing objects (connector-specific shape).
 */
export interface IrsSearchJobResult {
  results: IrsFilingResult[];
  count: number;
}

/**
 * A single IRS filing from the TEOS index search (IRS_NAME_SEARCH job result).
 * Field names match what irs_connector.filing_to_dict() returns.
 */
export interface IrsFilingResult {
  ein: string;
  taxpayer_name: string;
  return_type: string;
  tax_year: number;
  tax_period: string | null;
  object_id: string | null;
  batch_id: string | null;
  index_year: number | null;
}

/**
 * A single async background job.
 *
 * Polling pattern (useAsyncJob hook — Session 36):
 *   1. POST to research/AI endpoint → receive { job_id, status_url }
 *   2. Poll GET /api/jobs/:job_id/ every 2 seconds
 *   3. status === "SUCCESS" → render result
 *   4. status === "FAILED"  → render error_message
 *   5. On unmount → stop polling (do NOT cancel job on server)
 *   6. On mount → call GET /api/cases/:id/jobs/?limit=5 to reattach to in-progress jobs
 *
 * query_params shape varies by job_type.
 * result shape varies by job_type — see AiPatternJobResult, IrsSearchJobResult.
 */
export interface SearchJob {
  id: UUID;
  case_id: UUID | null;
  job_type: JobType;
  status: JobStatus;
  /** Connector-specific search parameters passed when the job was created */
  query_params: Record<string, unknown>;
  /**
   * Populated when status === "SUCCESS".
   * Shape varies by job_type:
   *   AI_PATTERN_ANALYSIS → AiPatternJobResult
   *   IRS_NAME_SEARCH     → IrsSearchJobResult
   *   others              → connector-specific (use unknown)
   */
  result: AiPatternJobResult | IrsSearchJobResult | Record<string, unknown> | null;
  error_message: string | null;
  created_at: ISO8601;
  started_at: ISO8601 | null;
  finished_at: ISO8601 | null;
}

/** Response from GET /api/cases/:id/jobs/?limit=N (reattach-on-mount list) */
export interface CaseJobsResponse {
  results: SearchJob[];
}

// ---------------------------------------------------------------------------
// Section 14 — Entity Disambiguation (Fuzzy Match)
// GET  /api/cases/:id/fuzzy-candidates/
// PATCH /api/cases/:id/fuzzy-candidates/:candidate_id/
// ---------------------------------------------------------------------------

/**
 * A pending entity disambiguation decision.
 *
 * When Intake finds an entity name that is similar (but not identical) to an
 * existing knot, it creates a FuzzyMatchCandidate instead of silently merging.
 * The investigator reviews each one — "accept" or "dismiss".
 *
 * Note: accepting stamps resolved_at but does NOT auto-merge FK references.
 * The actual merge is a deliberate human-in-the-loop decision.
 *
 * The "pending connections" badge on the toolbar uses the count of PENDING candidates.
 */
export interface FuzzyMatchCandidate {
  id: UUID;
  entity_type: KnotEntityType;
  /** Raw text from the document that triggered the fuzzy match */
  incoming_raw: string;
  /** Normalized form of incoming_raw used for comparison */
  incoming_normalized: string;
  /** The existing knot this incoming name was matched against */
  existing_entity_id: UUID;
  /** The raw name on the existing knot */
  existing_raw: string;
  /** Similarity score 0.0–1.0 (e.g. 0.9143) */
  similarity: number;
  status: FuzzyMatchStatus;
  detected_at: ISO8601;
  resolved_at: ISO8601 | null;
  detected_in_document_id: UUID;
}

/** Response from GET /api/cases/:id/fuzzy-candidates/ */
export interface FuzzyMatchResponse {
  results: FuzzyMatchCandidate[];
  count: number;
}

/** Body for PATCH /api/cases/:id/fuzzy-candidates/:candidate_id/ */
export interface ResolveFuzzyMatchBody {
  action: "accept" | "dismiss";
}

// ---------------------------------------------------------------------------
// Section 15 — Notes (Sticky Notes / Quick Captures)
// GET    /api/cases/:id/notes/
// POST   /api/cases/:id/notes/
// PATCH  /api/cases/:id/notes/:note_id/
// DELETE /api/cases/:id/notes/:note_id/ → 204 No Content
// ---------------------------------------------------------------------------

/**
 * An InvestigatorNote — a "quick capture" attached to any entity, finding, or case.
 * Frontend vocabulary: notes attached to knots are "quick captures" in the Profile view.
 */
export interface InvestigatorNote {
  id: UUID;
  case_id: UUID;
  /** What model/entity type this note is attached to */
  target_type: NoteTargetType;
  /** UUID of the specific entity/finding/document/case being annotated */
  target_id: UUID;
  content: string;
  created_by: string;
  created_at: ISO8601;
  updated_at: ISO8601;
}

/** Response from GET /api/cases/:id/notes/ */
export type NotesResponse = PaginatedResponse<InvestigatorNote>;

/** Body for POST /api/cases/:id/notes/ */
export interface CreateNoteBody {
  target_type: NoteTargetType;
  target_id: UUID;
  /** Required, must be non-empty */
  content: string;
  created_by?: string;
}

/** Body for PATCH /api/cases/:id/notes/:note_id/ */
export interface UpdateNoteBody {
  content?: string;
  created_by?: string;
}

// ---------------------------------------------------------------------------
// Section 4 — Research Tab (connector results)
// POST /api/cases/:id/research/ohio-sos/   [sync]
// POST /api/cases/:id/research/recorder/   [sync]
// POST /api/cases/:id/research/irs/        [async → 202]
// POST /api/cases/:id/research/ohio-aos/   [async → 202]
// POST /api/cases/:id/research/parcels/    [async → 202]
// POST /api/cases/:id/research/add-to-case/
// ---------------------------------------------------------------------------

/**
 * Synchronous connector result envelope — used by Ohio SOS and Recorder endpoints.
 * The shape of individual result items is connector-specific (unknown is intentional).
 * notes is always an array (may be empty []).
 */
export interface SyncResearchResponse {
  results: Record<string, unknown>[];
  count: number;
  notes: string[];
}

/**
 * Body for POST /api/cases/:id/research/add-to-case/.
 * Imports a research result (from any connector) as an entity or note on the case.
 */
export interface AddToCaseBody {
  result_type: "person" | "organization";
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Section 7 — Referrals Tab
// POST /api/cases/:id/referral-pdf/    → binary PDF stream
// POST /api/cases/:id/referral-memo/   → { "memo": string }
// POST /api/cases/:id/export/          → file download
// ---------------------------------------------------------------------------

/**
 * Response from POST /api/cases/:id/referral-memo/ (AI-generated narrative).
 * NOTE: This feature may be cut per Session 32 reframe — verify in views.py.
 * If still present, the memo field is a Markdown string.
 */
export interface ReferralMemoResponse {
  memo: string;
}

/**
 * Body for POST /api/cases/:id/export/.
 * Response is a file download, not JSON — handle with fetch → blob → URL.createObjectURL.
 */
export interface ExportBody {
  format: "json" | "csv";
}

// ---------------------------------------------------------------------------
// Utility / AI endpoints
// POST /api/cases/:id/ai/ask/
// (summarize / connections / narrative were cut in the Session 32 reframe —
//  the only live AI endpoints are ai/ask/ and ai/analyze-patterns/)
// ---------------------------------------------------------------------------

/** Body and response from POST /api/cases/:id/ai/ask/ */
export interface AiAskBody {
  question: string;
}

export interface AiAskResponse {
  answer: string;
}

// ---------------------------------------------------------------------------
// Coverage audit
// GET /api/cases/:id/coverage/
// ---------------------------------------------------------------------------

/** Response from GET /api/cases/:id/coverage/ — signal rule coverage audit */
export interface CoverageResponse {
  case_id: UUID;
  rules_triggered: string[];
  rules_not_triggered: string[];
  coverage_pct: number;
}

// ---------------------------------------------------------------------------
// Admin endpoints
// POST /api/admin/upload-sos-csv/
// GET  /api/admin/sos-csv-status/
// ---------------------------------------------------------------------------

/** Response from GET /api/admin/sos-csv-status/ */
export interface SosCsvStatusResponse {
  uploaded_files: string[];
  expected_files: string[];
  all_present: boolean;
}
