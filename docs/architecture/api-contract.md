# API Contract
**Version:** 1.0 — Session 38  
**Owner:** Tyler Collins  
**Source of truth for:** What JSON a React component actually receives when it calls the backend.

This document is the bridge between `models.py` (the database), `serializers.py` + `views.py` (the API), and the frontend TypeScript code. Before writing *any* React component, find it in the table of contents below, read the exact JSON shape, and make sure your TypeScript types match field-for-field.

---

## How to read this document

Each section covers one frontend view or major component. For each API endpoint called by that view:

1. **Request** — method, URL, query params, body
2. **Response shape** — exact JSON with real field names
3. **Status** — ✅ exists and correct | ⚠️ exists but shape has known issue | ❌ does not exist yet
4. **TypeScript implication** — what your interface fields must be named

**Legend for field types:**
- `UUID` = string (always stringified UUIDs, never raw integers)
- `ISO8601` = string like `"2024-01-15T12:30:00+00:00"`
- `Decimal` = string (Django serializes Decimal to string to avoid float rounding)
- `string | null` = nullable string
- `string[]` = string array (may be empty `[]`, never null)

---

## Table of Contents

1. [Case List View](#1-case-list-view)
2. [Case Detail — Overview Tab](#2-case-detail--overview-tab)
3. [Case Detail — Documents Tab](#3-case-detail--documents-tab)
4. [Case Detail — Research Tab](#4-case-detail--research-tab)
5. [Case Detail — Financials Tab](#5-case-detail--financials-tab)
6. [Case Detail — Pipeline Tab (Angles/Findings)](#6-case-detail--pipeline-tab)
7. [Case Detail — Referrals Tab](#7-case-detail--referrals-tab)
8. [Entity Browser](#8-entity-browser)
9. [Entity Detail / Profile View](#9-entity-detail--profile-view)
10. [Triage Queue](#10-triage-queue)
11. [Global Search](#11-global-search)
12. [Activity Feed](#12-activity-feed)
13. [Async Job Polling](#13-async-job-polling)
14. [Entity Disambiguation (Fuzzy Match)](#14-entity-disambiguation-fuzzy-match)
15. [Notes (Sticky Notes)](#15-notes-sticky-notes)
16. [Known Gaps and Gaps That Are Not Gaps](#16-known-gaps-and-gaps-that-are-not-gaps)

---

## 1. Case List View

**Route:** `/cases`  
**Purpose:** Shows all cases in a table or Kanban. Creates new cases.

### GET /api/cases/

```
Query params:
  status   — filter by status value (ACTIVE | PAUSED | REFERRED | CLOSED)
  q        — search by name (icontains)
  limit    — page size (default 25, max 100)
  offset   — pagination offset
```

**Response:** ✅

```json
{
  "count": 12,
  "limit": 25,
  "offset": 0,
  "next_offset": null,
  "previous_offset": null,
  "results": [
    {
      "id": "uuid-string",
      "name": "Bright Future Foundation",
      "status": "ACTIVE",
      "notes": "string",
      "referral_ref": "string",
      "created_at": "2024-01-15T12:30:00+00:00",
      "updated_at": "2024-01-15T12:30:00+00:00"
    }
  ]
}
```

**TypeScript implication:**
```typescript
interface CaseListItem {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "REFERRED" | "CLOSED";
  notes: string;
  referral_ref: string;
  created_at: string;
  updated_at: string;
}
interface CaseListResponse {
  count: number;
  limit: number;
  offset: number;
  next_offset: number | null;
  previous_offset: number | null;
  results: CaseListItem[];
}
```

### POST /api/cases/

**Body:**
```json
{ "name": "string", "status": "ACTIVE", "notes": "string", "referral_ref": "string" }
```

**Response:** ✅ — returns same shape as `CaseListItem`, status 201.

**Validation rules:** `name` is required. `status` must be a valid TextChoices value.

---

## 2. Case Detail — Overview Tab

**Route:** `/cases/:id`  
**Purpose:** Dashboard KPI cards, D3 entity-relationship graph, timeline.

### GET /api/cases/:id/dashboard/

**Response:** ✅

```json
{
  "case": {
    "id": "uuid",
    "name": "string",
    "status": "ACTIVE",
    "created_at": "ISO8601",
    "referral_ref": "string"
  },
  "documents": {
    "total": 7,
    "by_type": { "IRS_990": 3, "DEED": 2, "BANK_STATEMENT": 1, "OTHER": 1 },
    "by_extraction_status": { "COMPLETED": 6, "PENDING": 1 },
    "renamed_count": 4
  },
  "entities": {
    "persons": 4,
    "organizations": 2,
    "properties": 2,
    "financial_instruments": 1,
    "total": 9
  },
  "findings": {
    "total": 9,
    "by_severity": { "CRITICAL": 2, "HIGH": 5, "MEDIUM": 1, "LOW": 1 },
    "by_status": { "NEW": 4, "NEEDS_EVIDENCE": 2, "CONFIRMED": 3 },
    "top_rules": [
      { "rule_id": "SR-015", "summary": "Insider Property Swap", "count": 3 }
    ]
  },
  "financials": {
    "years_covered": 6,
    "total_revenue": "2340000",
    "total_expenses": "1980000",
    "timeline": [
      { "year": 2018, "revenue": "287000", "expenses": "241000" }
    ]
  },
  "pipeline": {
    "extraction_success_rate": 0.86,
    "ai_enhanced_count": 3,
    "total_documents_processed": 7
  }
}
```

**TypeScript implication:**
- All monetary values are **strings** (Decimal), not numbers. Parse with `parseFloat()` or a currency formatter.
- `timeline` is `Array<{year: number, revenue: string, expenses: string}>`.
- `top_rules` is `Array<{rule_id: string, summary: string, count: number}>`.

### GET /api/cases/:id/graph/

**Purpose:** Powers the D3 force-directed graph AND the brushable timeline.  
**Response:** ✅

```json
{
  "nodes": [
    {
      "id": "uuid",
      "type": "person" | "organization" | "property" | "financial_instrument",
      "label": "Sarah Example",
      "metadata": {
        "role_tags": ["OFFICER"],
        "aliases": ["K. Example"],
        "date_of_death": null,
        "finding_count": 4,
        "doc_count": 3
      }
    }
  ],
  "edges": [
    {
      "source": "uuid",
      "target": "uuid",
      "relationship": "OFFICER_OF" | "CO_APPEARS_IN" | "PURCHASED" | "SOLD_BY" | "FAMILY" | "BUSINESS" | "SOCIAL",
      "label": "Director",
      "weight": 3,
      "metadata": {
        "start_date": "2018-01-01",
        "end_date": null
      },
      "finding_links": [
        {
          "finding_id": "uuid",
          "status": "CONFIRMED",
          "severity": "CRITICAL",
          "title": "Insider Property Swap"
        }
      ]
    }
  ],
  "timeline_events": [
    {
      "id": "uuid",
      "layer": "document" | "finding" | "financial" | "transaction",
      "date": "ISO8601",
      "label": "string",
      "metadata": { ... }
    }
  ],
  "stats": {
    "total_nodes": 9,
    "total_edges": 11,
    "total_events": 24,
    "node_types": { "person": 4, "organization": 2, "property": 2, "financial_instrument": 1 }
  }
}
```

**Important edge metadata by relationship type:**
```
OFFICER_OF:     metadata.start_date, metadata.end_date
CO_APPEARS_IN:  metadata.document_ids (string[])
PURCHASED:      metadata.transaction_date, metadata.price, metadata.instrument_number
SOLD_BY:        (same as PURCHASED)
FAMILY/BUSINESS/SOCIAL: metadata.source_type, metadata.confidence, metadata.notes
```

**Important timeline_event metadata by layer:**
```
document:    metadata.doc_type
finding:     metadata.severity, metadata.rule_id
financial:   metadata.tax_year, metadata.total_revenue, metadata.total_expenses, metadata.entity_id
transaction: metadata.price, metadata.property_id, metadata.buyer_id, metadata.seller_id
```

**✅ GAP-1 RESOLVED (Session 38):**  
Every edge now includes a `finding_links` array. Dismissed findings are excluded. If the array is non-empty, the D3 renderer should visually distinguish the edge (e.g. thicker stroke, accent colour for CRITICAL/HIGH severity). Empty array = no findings touch both endpoints.

**TypeScript implication:**
```typescript
interface GraphNode {
  id: string;
  type: "person" | "organization" | "property" | "financial_instrument";
  label: string;
  metadata: {
    finding_count: number;
    doc_count: number;
    role_tags?: string[];
    aliases?: string[];
    date_of_death?: string | null;
    org_type?: string;
    ein?: string | null;
    status?: string;
    parcel_number?: string | null;
    county?: string | null;
    assessed_value?: string | null;
    purchase_price?: string | null;
    instrument_type?: string;
    filing_number?: string | null;
    filing_date?: string | null;
    amount?: string | null;
  };
}
interface GraphEdge {
  source: string;
  target: string;
  relationship: string;
  label: string;
  weight: number;
  metadata: Record<string, unknown>;
}
interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  timeline_events: TimelineEvent[];
  stats: { total_nodes: number; total_edges: number; total_events: number; node_types: Record<string, number> };
}
```

---

## 3. Case Detail — Documents Tab

**Route:** `/cases/:id` → Documents tab  
**Purpose:** Upload, list, view, OCR documents.

### GET /api/cases/:id/

Returns `CaseDetailResponse` which includes the document list.

**Response:** ✅

```json
{
  "id": "uuid",
  "name": "string",
  "status": "ACTIVE",
  "notes": "string",
  "referral_ref": "string",
  "created_at": "ISO8601",
  "updated_at": "ISO8601",
  "documents": [
    {
      "id": "uuid",
      "filename": "BrightFuture_990_2022.pdf",
      "display_name": "",
      "file_path": "/media/cases/uuid/filename.pdf",
      "sha256_hash": "64-char hex string",
      "file_size": 204800,
      "doc_type": "IRS_990",
      "is_generated": false,
      "doc_subtype": "",
      "source_url": null,
      "ocr_status": "COMPLETED",
      "extraction_status": "COMPLETED",
      "extraction_notes": "",
      "uploaded_at": "ISO8601",
      "updated_at": "ISO8601"
    }
  ]
}
```

**Key field notes:**
- `display_name` — investigator-set friendly name (empty string if not set, never null)
- `file_size` — integer bytes
- `doc_type` — one of: `IRS_990 | DEED | UCC | BANK_STATEMENT | AUDIT_REPORT | PERMIT | CONTRACT | CORRESPONDENCE | OTHER | UNKNOWN`
- `ocr_status` — one of: `PENDING | IN_PROGRESS | COMPLETED | FAILED | SKIPPED`
- `extraction_status` — one of: `PENDING | IN_PROGRESS | COMPLETED | FAILED`
- `source_url` — `string | null` (set for auto-fetched documents, null for uploads)

### POST /api/cases/:id/documents/bulk/

Multipart form upload. Multiple files accepted.  
**Response:** ✅ — returns `{ "created": [DocumentItem, ...], "errors": [...] }`

### GET /api/cases/:id/documents/:doc_id/

**Response:** ✅ — single `DocumentItem` shape (same as above, without the array wrapper).

### DELETE /api/cases/:id/documents/:doc_id/

**Response:** ✅ — `204 No Content`

**TypeScript implication:**
```typescript
interface DocumentItem {
  id: string;
  filename: string;
  display_name: string;
  file_path: string;
  sha256_hash: string;
  file_size: number;
  doc_type: string;
  is_generated: boolean;
  doc_subtype: string;
  source_url: string | null;
  ocr_status: string;
  extraction_status: string;
  extraction_notes: string;
  uploaded_at: string;
  updated_at: string;
}
```

---

## 4. Case Detail — Research Tab

**Route:** `/cases/:id` → Research tab  
**Purpose:** Search external data sources. Some are async (return 202 + job_id).

### Sync endpoints (return results immediately)

#### POST /api/cases/:id/research/ohio-sos/
#### POST /api/cases/:id/research/recorder/

**Body:** `{ "name": "string", "county": "string" }` (recorder also accepts ein, entity_number)

**Response:** ✅
```json
{
  "results": [ { ... connector-specific fields ... } ],
  "count": 3,
  "notes": []
}
```

### Async endpoints (return 202 + job_id)

#### POST /api/cases/:id/research/irs/
#### POST /api/cases/:id/research/ohio-aos/
#### POST /api/cases/:id/research/parcels/

**Body:** varies by connector (see CLAUDE.md connector details)

**Response:** ✅ `202 Accepted`
```json
{
  "job_id": "uuid",
  "status_url": "/api/jobs/uuid/"
}
```

Then poll `GET /api/jobs/:job_id/` until `status` is `"SUCCESS"` or `"FAILED"`.  
See [Section 13 — Async Job Polling](#13-async-job-polling) for the full polling shape.

**⚠️ Frontend note:** The Research tab uses a `useAsyncJob` hook (Session 36) for the 3 async sources and stays synchronous for SOS/Recorder. When mounting, it calls `GET /api/cases/:id/jobs/?limit=5` to reattach to any in-progress jobs.

### POST /api/cases/:id/research/add-to-case/

Imports a research result as an entity or note.  
**Body:** `{ "result_type": "person"|"organization", "data": { ... } }`  
**Response:** ✅ — created entity or note.

---

## 5. Case Detail — Financials Tab

**Route:** `/cases/:id` → Financials tab  
**Purpose:** Year-over-year 990 data table with anomaly highlighting.

### GET /api/cases/:id/financials/

**Response:** ✅

```json
{
  "count": 6,
  "results": [
    {
      "id": "uuid",
      "document_id": "uuid",
      "document_filename": "BrightFuture_990_2022.pdf",
      "organization_id": "uuid",
      "organization_name": "Bright Future Foundation",
      "ein": "XX-XXXXXXX",
      "tax_year": 2022,
      "form_type": "990",
      "total_contributions": 287000,
      "program_service_revenue": 0,
      "investment_income": 1200,
      "other_revenue": 0,
      "total_revenue": 288200,
      "grants_paid": 12000,
      "salaries_and_compensation": 180000,
      "professional_fundraising": 0,
      "other_expenses": 44000,
      "total_expenses": 236000,
      "revenue_less_expenses": 52200,
      "total_assets_boy": 310000,
      "total_assets_eoy": 362200,
      "total_liabilities_boy": 0,
      "total_liabilities_eoy": 0,
      "net_assets_boy": 310000,
      "net_assets_eoy": 362200,
      "officer_compensation_total": 0,
      "num_employees": 3,
      "source": "IRS_XML",
      "confidence": 0.99,

      "total_revenue_yoy_pct": 24.7,
      "total_expenses_yoy_pct": 19.2,
      "total_assets_eoy_yoy_pct": 16.8,
      "net_assets_eoy_yoy_pct": 16.8
    }
  ]
}
```

**Key field notes:**
- All monetary fields are **integers** (not strings — these are stored as IntegerField on the model)
- YoY percentage fields (`*_yoy_pct`) are floats — only present on rows index ≥ 1 (first year has no prior year to compare)
- `source` — `"IRS_TEOS_XML"` for data from the TEOS pipeline, `"EXTRACTED"` for data parsed from uploaded documents (free-form CharField; treat as `string`, not an enum)
- `confidence` — float 0.0–1.0

**TypeScript implication:**
```typescript
interface FinancialSnapshot {
  id: string;
  document_id: string;
  document_filename: string | null;
  organization_id: string | null;
  organization_name: string | null;
  ein: string | null;
  tax_year: number;
  form_type: string | null;
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
  source: string;
  confidence: number;
  // YoY fields — only present on rows[1..n]
  total_revenue_yoy_pct?: number;
  total_expenses_yoy_pct?: number;
  total_assets_eoy_yoy_pct?: number;
  net_assets_eoy_yoy_pct?: number;
}
```

---

## 6. Case Detail — Pipeline Tab

**Route:** `/cases/:id` → Pipeline tab  
**Purpose:** The Angles (Findings) workbench. List, triage, confirm, dismiss findings. Create manual findings. Run AI pattern analysis.

### GET /api/cases/:id/findings/

```
Query params:
  status       — filter: NEW | NEEDS_EVIDENCE | DISMISSED | CONFIRMED
  severity     — filter: CRITICAL | HIGH | MEDIUM | LOW | INFORMATIONAL
  source       — filter: AUTO | MANUAL | AI  (⚠️ see note below)
  order_by     — sort field (created_at default)
  direction    — asc | desc
  limit        — page size (default 25, max 100)
  offset       — pagination offset
```

**Response:** ✅

```json
{
  "count": 9,
  "limit": 25,
  "offset": 0,
  "next_offset": null,
  "previous_offset": null,
  "results": [
    {
      "id": "uuid",
      "rule_id": "SR-015",
      "title": "Insider Property Swap",
      "description": "Related party on both sides of property transaction",
      "narrative": "Sarah Example purchased the property from Example Construction LLC...",
      "severity": "CRITICAL",
      "status": "CONFIRMED",
      "evidence_weight": "DOCUMENTED",
      "source": "AUTO",
      "investigator_note": "Cross-referenced deed with 990 Part VII officer list.",
      "legal_refs": ["26 USC 4958", "Ohio Rev. Code 1716.15"],
      "evidence_snapshot": {
        "property_id": "uuid",
        "buyer_entity_id": "uuid",
        "seller_entity_id": "uuid",
        "transaction_id": "uuid"
        // AI findings also include:
        // "doc_refs": ["Doc-1", "Doc-3"],
        // "doc_ref_resolution": { "Doc-1": "uuid", "Doc-3": "uuid" },
        // "rationale": "string",
        // "suggested_action": "string"
      },
      "trigger_doc_id": "uuid",
      "trigger_doc_filename": "deed_2019.pdf",
      "trigger_entity_id": "uuid",
      "created_at": "ISO8601",
      "updated_at": "ISO8601",
      "entity_links": [
        {
          "entity_id": "uuid",
          "entity_type": "person" | "organization" | "property" | "financial_instrument",
          "context_note": "string"
        }
      ],
      "document_links": [
        {
          "document_id": "uuid",
          "document_filename": "deed_2019.pdf",
          "page_reference": "p. 3",
          "context_note": "string"
        }
      ]
    }
  ]
}
```

**Key field notes:**
- `rule_id` — `"SR-015"` for auto-detected rules; `"MANUAL"` for investigator-created; `"AI"` for AI pattern analysis results
- `source` — `"AUTO"` | `"MANUAL"` | `"AI"` — this is the filter chip selector on the Pipeline tab
- `evidence_weight` — `"SPECULATIVE"` | `"DIRECTIONAL"` | `"DOCUMENTED"` | `"TRACED"`
- `status` — `"NEW"` | `"NEEDS_EVIDENCE"` | `"DISMISSED"` | `"CONFIRMED"`
- `severity` — `"CRITICAL"` | `"HIGH"` | `"MEDIUM"` | `"LOW"` | `"INFORMATIONAL"`
- `narrative` — free text; investigator writes this on the Angle view. May be empty string.
- `narrative_source` — `"HUMAN"` | `"AI_DRAFT"` | `"AI_ASSISTED"`. Tracks whether the current narrative text was human-authored, AI-drafted, or AI-drafted then edited by the investigator. AI-pattern findings are created with `"AI_DRAFT"`. PATCH transitions: if `narrative_source` is not included, `AI_DRAFT` → `AI_ASSISTED` automatically; pass `narrative_source` explicitly to override.
- `narrative_updated_at` — ISO 8601 datetime (nullable). Stamped whenever `narrative` is written.
- `ai_run_id` — UUID string (nullable). For `source="AI"` findings, the ID of the `SearchJob` (AI_PATTERN_ANALYSIS) that created it. Links the finding to its exact job, model version, and run timestamp for chain-of-custody.
- `investigator_note` — short rationale; required when dismissing. Different from `narrative`.
- `evidence_snapshot` — arbitrary JSON dict; content varies by rule (see CLAUDE.md signal rules). AI findings also include `ai_model` and `job_id` keys.
- `trigger_doc_id` / `trigger_doc_filename` — the document that fired the rule (nullable)
- `trigger_entity_id` — the entity that fired the rule (nullable UUID string)
- `entity_links` — array of objects linking this finding to entities. May be empty.
- `document_links` — array of objects linking this finding to source documents with citation. May be empty.

**⚠️ Source filter note:** The `source` query param maps to `FindingSource` choices. Verify in models.py that `"AI"` is a valid value (it was added as `FindingSource.AI` in Session 36 migration `0023_ai_source_and_jobtype.py`).

### POST /api/cases/:id/findings/

Creates a manual finding. **Body:**
```json
{
  "title": "string (required)",
  "narrative": "string",
  "severity": "HIGH",
  "evidence_weight": "SPECULATIVE",
  "legal_refs": [],
  "investigator_note": "string"
}
```

**Response:** ✅ — single Finding object, status 201. `source` is forced to `"MANUAL"`, `status` to `"NEW"`.

### PATCH /api/cases/:id/findings/:finding_id/

Updates status, narrative, narrative_source, evidence_weight, severity, investigator_note, title, legal_refs.  
**Body:** any subset of the above fields.

**Narrative source rules:**
- Include `narrative_source` when saving an AI-drafted narrative from the proxy: `"AI_DRAFT"`.
- Omit `narrative_source` for human edits — the backend auto-transitions `AI_DRAFT` → `AI_ASSISTED`.
- Pass `narrative_source: "HUMAN"` to explicitly mark a full human rewrite of an AI draft.

**Validation rule:** setting `status: "DISMISSED"` requires a non-empty `investigator_note`.

**Response:** ✅ — full Finding object.

### DELETE /api/cases/:id/findings/:finding_id/

**Response:** ✅ — `204 No Content`

### POST /api/cases/:id/ai/ask/

Enqueues a free-form investigative question. The tool-use loop (up to 6 Claude API calls,
10–40 s) runs in a background worker — this endpoint never blocks.

**Body:**
```json
{
  "question": "string (required)",
  "conversation_history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

**Response:** `202 Accepted`
```json
{ "job_id": "uuid", "status_url": "/api/jobs/uuid/" }
```

Poll `GET /api/jobs/:id/`. On `SUCCESS`, `job.result` shape (`AiAskJobResult`):
```json
{
  "answer": "prose response (four sections: data / assessment / exculpatory / thread)",
  "sources": [{ "type": "tool_call", "id": "0", "label": "search_case_documents(...) → 3 matches" }],
  "tool_calls_made": [...],
  "tool_budget_exceeded": false,
  "_model": "claude-sonnet-4-6",
  "_usage": { "input_tokens": 4200, "output_tokens": 820 }
}
```

On `FAILED`, `job.error_message` contains the reason (rate-limit, API error, etc.).

### POST /api/cases/:id/ai/analyze-patterns/

Enqueues an AI pattern analysis job. Returns 409 if one is already in-flight.  
**Response:** ✅ `202 Accepted`
```json
{ "job_id": "uuid", "status_url": "/api/jobs/uuid/" }
```

Then poll `/api/jobs/:id/`. On SUCCESS, `job.result.findings_created` and `job.result.patterns_dropped` are available for the toast notification.

---

## 7. Case Detail — Referrals Tab

**Route:** `/cases/:id` → Referrals tab  
**Purpose:** Generate the PDF referral package.

### POST /api/cases/:id/referral-pdf/

Generates a deterministic, citation-bearing PDF using reportlab. No AI.  
**Response:** ✅ — binary PDF stream with `Content-Type: application/pdf`  
**Frontend note:** Trigger with `window.open` or a fetch → blob → URL.createObjectURL pattern.

### POST /api/cases/:id/referral-memo/

AI-generated narrative memo (Session 30 feature; may be cut per Session 32 reframe — check current views.py before using).  
**Response:** ✅ — `{ "memo": "markdown string" }`

### POST /api/cases/:id/export/

JSON/CSV export of full case data.  
**Body:** `{ "format": "json" | "csv" }`  
**Response:** ✅ — file download

---

## 8. Entity Browser

**Route:** `/entities`  
**Purpose:** Cross-case entity search.

### GET /api/entities/

```
Query params:
  type     — "person" | "organization" | "property" | "financial_instrument"
  q        — search term (icontains on name)
  case_id  — restrict to a specific case
  limit    — max 200
  offset   — pagination offset
```

**Response:** ✅

```json
{
  "count": 12,
  "results": [
    {
      "id": "uuid",
      "entity_type": "person",
      "name": "Sarah Example",
      "case_id": "uuid",
      "case_name": "Bright Future Foundation",
      "role_tags": ["OFFICER", "DIRECTOR"],
      "aliases": ["K. Example"],
      "date_of_death": null,
      "notes": "string",
      "created_at": "ISO8601",
      "updated_at": "ISO8601"
    }
  ]
}
```

**For `entity_type: "organization"` items, fields are different:**
```json
{
  "id": "uuid",
  "entity_type": "organization",
  "name": "Example Construction LLC",
  "case_id": "uuid",
  "case_name": "...",
  "org_type": "LLC",
  "ein": "XX-XXXXXXX",
  "registration_state": "OH",
  "status": "ACTIVE",
  "formation_date": "2014-03-15",
  "notes": "string",
  "created_at": "ISO8601",
  "updated_at": "ISO8601"
}
```

**TypeScript implication:** The union type — all items have `id`, `entity_type`, `name`, `case_id`, `case_name`. Type-specific fields are only present on their own type. Use a discriminated union or a base + extension pattern.

---

## 9. Entity Detail / Profile View

**Route:** `/entities/:type/:id`  
**Purpose:** Full entity profile — documents, findings, roles.

### GET /api/entities/:type/:id/

**Response (person):** ✅

```json
{
  "id": "uuid",
  "entity_type": "person",
  "name": "Sarah Example",
  "case_id": "uuid",
  "case_name": "Bright Future Foundation",
  "role_tags": ["OFFICER"],
  "aliases": [],
  "date_of_death": null,
  "notes": "string",
  "created_at": "ISO8601",
  "updated_at": "ISO8601",
  "related_documents": [
    {
      "id": "uuid",
      "filename": "deed_2019.pdf",
      "display_name": "Property Deed 2019",
      "file_path": "...",
      "sha256_hash": "...",
      "file_size": 204800,
      "doc_type": "DEED",
      "is_generated": false,
      "doc_subtype": "",
      "source_url": null,
      "ocr_status": "COMPLETED",
      "extraction_status": "COMPLETED",
      "extraction_notes": "",
      "uploaded_at": "ISO8601",
      "updated_at": "ISO8601",
      "page_reference": "p. 1",
      "context_note": "Grantor on deed"
    }
  ],
  "related_signals": [ { ...full Finding shape... } ],
  "related_findings": [
    {
      "id": "uuid",
      "title": "Insider Property Swap",
      "severity": "CRITICAL",
      "status": "CONFIRMED",
      "context_note": "Sarah Example is the buyer"
    }
  ],
  "organization_roles": [
    {
      "organization_id": "uuid",
      "organization_name": "Bright Future Foundation",
      "role": "OFFICER",
      "start_date": "2016-01-01",
      "end_date": null,
      "notes": ""
    }
  ]
}
```

**⚠️ Duplicate data note:** `related_signals` and `related_findings` are both populated from `FindingEntity` and contain overlapping data. `related_signals` returns full Finding objects; `related_findings` returns a summary shape. The frontend should choose one. Use `related_findings` for the compact list on the Profile sidebar, fetch full finding via the finding detail endpoint when expanded.

**For `entity_type: "property"`, the extra field is:**
```json
{
  "transactions": [
    {
      "id": "uuid",
      "transaction_date": "2019-07-15",
      "buyer_id": "uuid",
      "seller_id": "uuid",
      "price": "245000",
      "document_id": "uuid",
      "notes": ""
    }
  ]
}
```

---

## 10. Triage Queue

**Route:** `/triage`  
**Purpose:** Cross-case findings requiring investigator attention.

### GET /api/signals/

Cross-case Finding list. Same response shape as `/api/cases/:id/findings/` but not scoped to a case.

```
Query params:
  status, severity, order_by, direction, limit, offset  (same as case findings)
```

**Response:** ✅ — same paginated `{ count, results: [Finding...] }` shape.

### GET /api/signal-summary/

**Response:** ✅
```json
{
  "total": 47,
  "by_severity": { "CRITICAL": 8, "HIGH": 21, "MEDIUM": 12, "LOW": 6 },
  "by_status": { "NEW": 32, "NEEDS_EVIDENCE": 10, "DISMISSED": 3, "CONFIRMED": 2 }
}
```

---

## 11. Global Search

**Route:** `/search`

### GET /api/search/

```
Query params:
  q       — search term (required, min 2 chars)
  type    — filter: "case" | "document" | "signal" | "entity"
  case_id — restrict to a case
```

**Response:** ✅
```json
{
  "count": 14,
  "results": [
    {
      "type": "case",
      "id": "uuid",
      "title": "Bright Future Foundation",
      "subtitle": "Status: ACTIVE",
      "snippet": "Status: ACTIVE — Notes text...",
      "relevance": 0.7842,
      "case_id": "uuid",
      "case_name": "Bright Future Foundation",
      "route": "/cases/uuid"
    },
    {
      "type": "document",
      "id": "uuid",
      "title": "BrightFuture_990_2022.pdf",
      "subtitle": "IRS_990",
      "snippet": "...matched text excerpt...",
      "relevance": 0.6123,
      "case_id": "uuid",
      "case_name": "Bright Future Foundation",
      "route": "/cases/uuid"
    },
    {
      "type": "entity",
      "id": "uuid",
      "title": "Sarah Example",
      "subtitle": "person",
      "snippet": "...",
      "relevance": 0.5421,
      "case_id": "uuid",
      "case_name": "Bright Future Foundation",
      "route": "/entities/person/uuid"
    }
  ]
}
```

**TypeScript implication:** All result types share the same 8 fields (`type`, `id`, `title`, `subtitle`, `snippet`, `relevance`, `case_id`, `case_name`, `route`). The `route` field is a React Router path — you can use it directly with `useNavigate()(result.route)`.

---

## 12. Activity Feed

### GET /api/activity-feed/

```
Query params:
  case_id  — optional, restrict to a case
  limit    — default 50
```

**Response:** ✅
```json
{
  "count": 50,
  "results": [
    {
      "id": "uuid",
      "case_id": "uuid",
      "table_name": "findings",
      "record_id": "uuid",
      "action": "FINDING_CREATED",
      "performed_by": "API_TOKEN_VALUE",
      "performed_at": "ISO8601",
      "notes": ""
    }
  ]
}
```

**AuditLog `action` values observed in production:**
`DOCUMENT_UPLOADED`, `DOCUMENT_DELETED`, `FINDING_CREATED`, `FINDING_UPDATED`, `FINDING_DISMISSED`, `FINDING_CONFIRMED`, `CASE_CREATED`, `CASE_UPDATED`, `ENTITY_CREATED`, `NOTE_CREATED`

---

## 13. Async Job Polling

**Used by:** Research tab (IRS, AOS, Parcels), AI pattern analysis, batch OCR

### GET /api/jobs/:job_id/

**Response:** ✅
```json
{
  "id": "uuid",
  "case_id": "uuid",
  "job_type": "IRS_NAME_SEARCH" | "IRS_FETCH_XML" | "OHIO_AOS" | "COUNTY_PARCEL" | "AI_PATTERN_ANALYSIS",
  "status": "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED",
  "query_params": { ... connector-specific ... },
  "result": { ... connector-specific ... },
  "error_message": null,
  "created_at": "ISO8601",
  "started_at": "ISO8601",
  "finished_at": "ISO8601"
}
```

**`result` shape for AI_PATTERN_ANALYSIS on SUCCESS:**
```json
{
  "findings_created": 3,
  "patterns_dropped": 1
}
```

**`result` shape for IRS_NAME_SEARCH on SUCCESS:**
```json
{
  "results": [ { ... IRS filing objects ... } ],
  "count": 177
}
```

**Frontend polling pattern (`useAsyncJob` hook):**
1. POST to research endpoint → receive `{ job_id, status_url }`
2. Poll `GET /api/jobs/:job_id/` every 2 seconds
3. On `status === "SUCCESS"` → render `result`
4. On `status === "FAILED"` → render `error_message`
5. On unmount → stop polling (don't cancel the job on the server)

### GET /api/cases/:id/jobs/?limit=5

Used on mount to reattach to any in-progress jobs.  
**Response:** ✅
```json
{
  "results": [
    {
      "id": "uuid",
      "job_type": "IRS_NAME_SEARCH",
      "status": "SUCCESS",
      "query_params": { "name": "bright future" },
      "created_at": "ISO8601",
      "finished_at": "ISO8601"
    }
  ]
}
```

---

## 14. Entity Disambiguation (Fuzzy Match)

**Purpose:** When the extraction pipeline finds a near-match for an entity name, it creates a `FuzzyMatchCandidate` instead of silently merging. The investigator reviews each one.

### GET /api/cases/:id/fuzzy-candidates/

```
Query params:
  status       — "pending" (default) | "merged" | "dismissed" | "all"
  entity_type  — "person" | "organization"
```

**Response:** ✅
```json
{
  "results": [
    {
      "id": "uuid",
      "entity_type": "person",
      "incoming_raw": "K. Example",
      "incoming_normalized": "sarah example",
      "existing_entity_id": "uuid",
      "existing_raw": "Sarah Example",
      "similarity": 0.9143,
      "status": "PENDING",
      "detected_at": "ISO8601",
      "resolved_at": null,
      "detected_in_document_id": "uuid"
    }
  ],
  "count": 3
}
```

### PATCH /api/cases/:id/fuzzy-candidates/:candidate_id/

**Body:** `{ "action": "accept" | "dismiss" }`  
- `"accept"` → status becomes `MERGED` (stamps `resolved_at`). The actual FK-reassignment merge is NOT automatic — it is a deliberate human-in-the-loop decision.  
- `"dismiss"` → status becomes `DISMISSED`

**Response:** ✅ — updated candidate object.

**⚠️ Important spec clarification:** The "pending connections" panel in the spec's Connection View (Section 6) refers to this `FuzzyMatchCandidate` queue — not to `CO_APPEARS_IN` graph edges. CO_APPEARS_IN edges cannot be confirmed or dismissed; they are computed synthetic edges.

---

## 15. Notes (Sticky Notes)

### GET /api/cases/:id/notes/

```
Query params: limit, offset
```

**Response:** ✅
```json
{
  "count": 5,
  "results": [
    {
      "id": "uuid",
      "case_id": "uuid",
      "target_type": "document" | "finding" | "person" | "organization" | "property" | "financial_instrument" | "case",
      "target_id": "uuid",
      "content": "Note text here",
      "created_by": "investigator",
      "created_at": "ISO8601",
      "updated_at": "ISO8601"
    }
  ]
}
```

### POST /api/cases/:id/notes/

**Body:**
```json
{
  "target_type": "document",
  "target_id": "uuid",
  "content": "string (required, non-empty)",
  "created_by": "string (optional)"
}
```

**Response:** ✅ — single Note object, status 201.

**Validation:** `target_type` must be one of the 7 valid values. `target_id` must be a valid UUID. `content` must be non-empty.

### PATCH /api/cases/:id/notes/:note_id/

**Body:** `{ "content": "string" }` — only content and created_by are updatable.

### DELETE /api/cases/:id/notes/:note_id/

**Response:** ✅ — `204 No Content`

---

## 16. Known Gaps and Gaps That Are Not Gaps

### GAP-1: Graph edges — Finding state ✅ RESOLVED (Session 38)

**What was missing:** The graph endpoint had no information about Finding confirmation state on edges.

**Fix applied:** `api_case_graph` in `views.py` now builds a `_finding_pairs` lookup after the existing `entity_finding_counts` block. For every non-dismissed Finding with ≥2 entity_links, every pair of those entity IDs gets an entry. After all edges are built, a post-processing pass annotates each edge with `finding_links: [{finding_id, status, severity, title}]`.

**Frontend usage:** If `edge.finding_links.length > 0`, render the edge with a highlighted stroke. Severity drives colour:
- `CRITICAL` → red
- `HIGH` → orange  
- `MEDIUM` / `LOW` → yellow
- Empty array → default grey

**What `finding_links` does NOT contain:** Dismissed findings (excluded at the query level). A confirmed edge may have been dismissed by the investigator — it simply won't appear in `finding_links`.

---

### GAP-2: [Doc-N] citation references ✅ RESOLVED (Session 38)

**What was missing:** `[Doc-N]` reference numbers in AI-generated Finding narratives were assigned at analysis time and could point to different documents if new uploads changed sort order.

**Fix applied:** In `analyze_case()` in `ai_pattern_augmentation.py`, the `evidence_snapshot` dict now includes `"doc_ref_resolution"` — a map of each cited `[Doc-N]` ref to the stable document UUID at the time of analysis:

```json
"evidence_snapshot": {
  "doc_refs": ["Doc-1", "Doc-3"],
  "doc_ref_resolution": {
    "Doc-1": "uuid-of-that-document",
    "Doc-3": "uuid-of-that-document"
  },
  "rationale": "...",
  "suggested_action": "..."
}
```

**Frontend usage:** When rendering an AI finding's narrative, parse `[Doc-N]` tags and look up the UUID from `evidence_snapshot.doc_ref_resolution[ref]`. Then look that UUID up in the case's document list to get the filename. Render as a clickable badge: `[deed_2019.pdf]` instead of `[Doc-3]`.

**Note:** Only findings written after this fix have `doc_ref_resolution`. Older AI findings may still have raw `[Doc-N]` tags — handle the missing key gracefully by falling back to displaying the raw tag as plain text.

---

### GAP-3: `related_signals` vs `related_findings` duplication on Entity Detail ⚠️ LOW

**What's missing:** The `GET /api/entities/:type/:id/` endpoint populates both `related_signals` and `related_findings` from the same `FindingEntity` query. They contain the same findings in different shapes.

**Impact:** Frontend receives redundant data. Not a bug, just inefficiency.

**Fix:** Ignore `related_signals` in the frontend. Use `related_findings` (summary shape) for the compact list in the Profile sidebar. If the full Finding is needed, call `GET /api/cases/:id/findings/:finding_id/`.

---

### NOT A GAP: Property nodes in the graph

The spec (Section 2 — Connection View) says knots are Persons and Organizations only. The backend graph endpoint also includes `property` and `financial_instrument` nodes.

**Resolution:** The graph is correct as-is. Properties and FinancialInstruments appear in the web (graph) for positional context. They are not eligible as knots in the Angle entity picker. The frontend enforces this distinction in the Angle form: the "Tie to knot" picker should only show `entity_type === "person" || entity_type === "organization"`.

---

### NOT A GAP: `source` filter on findings

The spec mentions filtering angles by source (Rule / Manual / AI). The backend filter param is `source` with values `AUTO | MANUAL | AI`. Map the UI chip labels as follows:
- "Rule" chip → `?source=AUTO`
- "Manual" chip → `?source=MANUAL`
- "AI" chip → `?source=AI`

---

### NOT A GAP: Dismissal requires `investigator_note`

The spec (Section 6, Tie-off modal) shows a "dismissal rationale" field. This is enforced server-side: `PATCH` with `status: "DISMISSED"` and no `investigator_note` returns `400 {"errors": {"investigator_note": ["A dismissal rationale is required..."]}}`. The frontend form must show this field when the investigator selects "Dismissed" as the tie-off outcome.

---

## Appendix: URL pattern reference

```
GET    /api/cases/
POST   /api/cases/
GET    /api/cases/:id/
PATCH  /api/cases/:id/
GET    /api/cases/:id/dashboard/
GET    /api/cases/:id/graph/
GET    /api/cases/:id/coverage/
POST   /api/cases/:id/export/

POST   /api/cases/:id/documents/bulk/
POST   /api/cases/:id/documents/process-pending/
GET    /api/cases/:id/documents/:doc_id/
DELETE /api/cases/:id/documents/:doc_id/

GET    /api/cases/:id/findings/
POST   /api/cases/:id/findings/
GET    /api/cases/:id/findings/:finding_id/
PATCH  /api/cases/:id/findings/:finding_id/
DELETE /api/cases/:id/findings/:finding_id/

GET    /api/cases/:id/signals/
PATCH  /api/cases/:id/signals/:signal_id/
GET    /api/signals/
GET    /api/signal-summary/
POST   /api/cases/:id/reevaluate-signals/

GET    /api/cases/:id/financials/
POST   /api/cases/:id/fetch-990s/

GET    /api/cases/:id/notes/
POST   /api/cases/:id/notes/
PATCH  /api/cases/:id/notes/:note_id/
DELETE /api/cases/:id/notes/:note_id/

GET    /api/cases/:id/fuzzy-candidates/
PATCH  /api/cases/:id/fuzzy-candidates/:candidate_id/

POST   /api/cases/:id/research/parcels/       [ASYNC → 202]
POST   /api/cases/:id/research/ohio-sos/      [sync]
POST   /api/cases/:id/research/ohio-aos/      [ASYNC → 202]
POST   /api/cases/:id/research/irs/           [ASYNC → 202]
POST   /api/cases/:id/research/recorder/      [sync]
POST   /api/cases/:id/research/add-to-case/

GET    /api/jobs/:job_id/
GET    /api/cases/:id/jobs/

POST   /api/cases/:id/ai/ask/                 [ASYNC → 202]
POST   /api/cases/:id/ai/analyze-patterns/    [ASYNC → 202]

POST   /api/cases/:id/referral-pdf/
POST   /api/cases/:id/referral-memo/

GET    /api/entities/
GET    /api/entities/:type/:id/

GET    /api/search/
GET    /api/activity-feed/
GET    /api/health/
GET    /api/csrf/

POST   /api/admin/upload-sos-csv/
GET    /api/admin/sos-csv-status/
```
