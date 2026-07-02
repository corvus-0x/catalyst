# Catalyst — System Architecture

**Last Updated:** 2026-06-27 (Session 53 — Phase 4B merged)
**Status:** Living document — update at end of each session

---

## Architecture Overview

Catalyst is a Django monolith with a React SPA frontend. The decision to use a monolith (rather than
microservices) is intentional: it keeps deployment simple, avoids inter-service complexity, and is
the right choice for a single-developer project at this scale.

```
                    ┌─────────────────────────────┐
                    │      React SPA (Vite)        │
                    │      TypeScript + CSS         │
                    │      Port 5174 (dev)          │
                    └──────────┬──────────────────┘
                               │ HTTP (JSON API)
                               ▼
                    ┌─────────────────────────────┐
                    │      Django Backend           │
                    │      Port 8000                │
                    │                               │
                    │  ┌─────────┐ ┌────────────┐  │
                    │  │ Views / │ │ Middleware  │  │
                    │  │ API     │ │ (CSRF,Rate,│  │
                    │  └────┬────┘ │  Auth)     │  │
                    │       │      └────────────┘  │
                    │  ┌────┴──────────────────┐    │
                    │  │  Processing Pipeline   │   │
                    │  │  extract → classify →  │   │
                    │  │  entities → signals    │   │
                    │  └────┬──────────────────┘   │
                    │       │                       │
                    │  ┌────┴──────────────────┐    │
                    │  │  Django-Q2 Worker      │   │
                    │  │  (async research jobs) │   │
                    │  └────┬──────────────────┘   │
                    │       │                       │
                    │  ┌────┴──────────────────┐    │
                    │  │  External Connectors   │   │
                    │  │  (IRS, Ohio SOS/AOS/   │   │
                    │  │   County Rec/Auditor)  │   │
                    │  └───────────────────────┘   │
                    └──────────┬──────────────────┘
                               │
                               ▼
                    ┌─────────────────────────────┐
                    │   PostgreSQL (Docker/Railway) │
                    │   Port 5432 (Docker)          │
                    │   Port 5433 (native dev)      │
                    └─────────────────────────────┘
```

---

## Backend Structure

The entire backend lives in one Django app: `investigations`. This app contains logical tiers:

### Tier 1: Stateless Utilities (No Django dependency)

| Module | Purpose |
|--------|---------|
| `extraction.py` | PDF text extraction (PyPDF2 + Tesseract OCR fallback) |
| `classification.py` | Rule-based document type classification by keyword scoring |
| `entity_extraction.py` | Regex-based entity candidate extraction (persons, orgs, dates, amounts) |
| `entity_normalization.py` | Canonical form normalization (uninvert names, strip designators) |
| `irs_connector.py` | IRS TEOS 990 XML pipeline — full filing download + parse |
| `ohio_sos_connector.py` | Ohio Secretary of State bulk CSV (business entity filings) |
| `county_auditor_connector.py` | ODNR ArcGIS parcel API + Beacon/Schneider auditor URLs |
| `county_recorder_connector.py` | 88 Ohio county recorder portals — deed/mortgage documents |
| `ohio_aos_connector.py` | Ohio Auditor of State audit report scraper |

### Tier 2: Pipeline Integration (Needs Django ORM)

| Module | Purpose |
|--------|---------|
| `entity_resolution.py` | Exact match upsert + fuzzy candidate surfacing |
| `signal_rules.py` | 17 active fraud signal rules (SR-003 through SR-031; some gaps/retired) |
| `referral_grade.py` | Single source of truth for referral-grade predicate (dual-version since 4B) |
| `case_map.py` | Case Map builder — summarized subject-pair edges + strength scoring |
| `thread_elements.py` | Thread assertion completeness + document_links sync helpers |
| `ai_extraction.py` | Claude AI entity/financial extraction |
| `ai_proxy.py` | Claude API wrapper with caching |
| `ai_pattern_augmentation.py` | AI pattern analysis → Findings |
| `form990_parser.py` | IRS 990 text parser (Part IV/VI/VII) |
| `jobs.py` | Async task functions for Django-Q2 worker |
| `data_quality.py` | Data validation + audit logging |

### Tier 3: Django Infrastructure

| Module | Purpose |
|--------|---------|
| `models.py` | ORM models + choice enums (38+ migrations as of Phase 4B) |
| `serializers.py` | Request validation + JSON response shaping (no DRF) |
| `views.py` | API endpoints + HTML views (~6000+ lines) |
| `urls.py` | URL routing for all endpoints |
| `middleware.py` | CSRF handling + sliding-window rate limiting + auth |
| `admin.py` | Django admin with ModelAdmin classes |

---

## Document Processing Pipeline

```
Upload PDF
    │
    ▼
Stage 0: SHA-256 hash on original bytes (chain of custody)
    │
    ▼
Stage 1: Text extraction (PyPDF2 direct → Tesseract OCR fallback if sparse)
    │
    ▼
Stage 2: Document classification (keyword scoring → doc_type)
    │
    ▼
Stage 3: Entity extraction (regex → raw candidates)
    │
    ▼
Stage 4: Entity normalization (canonical form for comparison)
    │
    ▼
Stage 5: Entity resolution (exact match → upsert; fuzzy → flag for review)
    │
    ▼
Stage 6: Signal detection (evaluate document + case against 17 active rules)
    │
    ▼
Stage 7: Financial extraction (for IRS 990 → FinancialSnapshot)
    │
    ▼
Extraction status recorded: COMPLETED / PARTIAL / FAILED / SKIPPED
```

Each stage is best-effort — a failure never blocks the upload.

---

## Data Models (key models — see `docs/team/backend-engineer.md` for full reference)

### Core Models
- **Case** — Investigation container (UUID PK, status, referral_ref)
- **Document** — Uploaded file with SHA-256 chain-of-custody, OCR + extraction status
- **Person** — Identified individual with role tags and aliases
- **Organization** — Identified entity with type, EIN, status
- **Property** — Parcel record with assessed/purchase values and computed delta
- **FinancialInstrument** — UCC filings, loans, liens with anomaly flags

### Analysis Models
- **Finding** — Investigator-curated thread (maps to "Thread" in UI vocabulary).
  Key fields: `status`, `evidence_weight`, `overreach_reviewed`, `gate_version`
  (`LEGACY_NARRATIVE` | `ASSERTION_V1`). Referral-grade predicate in `referral_grade.py`.
- **ThreadElement** — Structured assertion on a Finding (type: ASSERTION/QUESTION/NOTE).
  Role (fact/analysis/claim) is **derived from evidence**, not stored.
- **ThreadElementCitation** — Source document for an ASSERTION. Source of truth for
  citations; `Finding.document_links` (`FindingDocument`) is a synced compatibility index.
- **Signal** — Automated detection of suspicious patterns (17 active rule types)
- **FinancialSnapshot** — Extracted IRS Form 990 financial data
- **SearchJob** — Async job tracker for research connector calls

### Linking Models
- **PersonDocument**, **OrgDocument** — Entity-to-document links
- **PersonOrganization** — Person-to-org role relationships
- **PropertyTransaction** — Property transfer records
- **FindingEntity**, **FindingDocument** — Finding evidence links
  (`FindingDocument.is_legacy` marks rows written by `add_document_ids` vs citation sync)

### Operational Models
- **AuditLog** — Append-only audit trail (NEVER UPDATE OR DELETE)
- **InvestigatorNote** — Free-form observations attachable to any entity or finding

---

## Async Jobs (Django-Q2)

Research connector calls are async: the frontend POSTs to a research endpoint, receives a
`202 + job_id`, then polls `GET /api/jobs/<uuid>/` every 2 seconds. The Django-Q2 worker runs
in-container (ORM broker, no Redis). Job results are stored in `SearchJob.result`.

---

## External Connectors

| Connector | Source | Status |
|-----------|--------|--------|
| IRS TEOS XML | IRS 990 XML pipeline | ✅ Working |
| County Recorder | 88 OH counties | ✅ Working |
| Ohio AOS | OH Auditor of State | ✅ Working |
| Ohio SOS | OH Secretary of State (CSV upload) | ✅ Working (manual CSV) |
| County Auditor | ODNR parcel API | ✅ Working |

ProPublica connector was deleted (superseded by IRS TEOS XML pipeline).

---

## Frontend Structure

React SPA (Vite + TypeScript). Persistent Case Map canvas + right inspector architecture
driven by a focus reducer. Cytoscape.js for the graph (NOT D3 force simulation).
D3 is used ONLY for the Timeline brush.

### Routes

| Route | View | Status |
|-------|------|--------|
| `/` | Dashboard | ✅ Working |
| `/cases` | CasesList | ✅ Working |
| `/cases/:id` | CaseDetail (6 tabs) | ✅ Working |
| `/search` | Search | ✅ Working |
| `/settings` | Settings | ✅ Working |

CaseDetail tabs: **Investigate · Research · Financials · Timeline · Referrals · Replay**

### Investigate Tab Architecture (Case Map — Phases 1A–4B)

The Investigate tab is a persistent **Case Map** (Cytoscape canvas) + right inspector.
Selection drives inspector state; navigation is a breadcrumb history (focus reducer).

```
┌─────────────────────────────────────────────────────────────┐
│  TOOLBAR: [+ Subject] [+ Thread] [Fit] [Pending N]          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│              CYTOSCAPE CANVAS (Case Map)                    │
│                                                             │
│   ● Sarah Mitchell ─── ● Bright Future Found.              │
│          └──────────── ● EH Construction ───┘              │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  THREAD DOCK (canvas-width, collapsible, sortable)          │
│  [Thread title · severity · readiness · status]            │
└──────────────────────────────────────┬──────────────────────┘
                                       │  RIGHT INSPECTOR
                                       │  (selection-driven)
                                       ▼
                          SubjectInspector | RelationshipSummaryPanel
                          ThreadInspector  | ThreadBuilder
```

**Frame types** (focus reducer `Frame.kind`):
- `"web"` — default canvas + toolbar
- `"subject"` — subject detail in right inspector
- `"angle"` — `ThreadBuilder` (full-width, replaces canvas — Phase 4B)
- `"relationship"` — `RelationshipSummaryPanel`

**Thread Path Mode** (Phase 3): selecting a thread emphasizes its relationships (severity-colored
edges) and dims the rest. Implemented via imperative Cytoscape class-toggle — no relayout.

**ThreadBuilder** (Phase 4B): ordered list of `ElementCard` assertion cards (derived-role badge,
inline text edit, citation chips, `handoff_ready` toggle) backed by element CRUD/citation/reorder
endpoints. Replaces the old freeform narrative `AngleView` (deleted).

### Node Visual Encoding (Case Map)

| Type | Shape | Color |
|------|-------|-------|
| Person | Circle | Blue `#3b82f6` |
| Organization | Square | Teal/amber/violet/red by subtype |
| Selected | Gold border ring | `#fbbf24` |
| Substantiated thread present | Green border | `#22c55e` |
| Active thread present | Amber dot | `#f59e0b` |
| Status unknown | Dashed border | neutral gray |

### Edge Visual Encoding (Case Map)

Edges come from `/api/cases/:id/case-map/` (one summarized edge per Subject pair).
Thickness scales with `strength.level` (observed/documented/repeated/material).
Thread Path Mode adds severity-colored classes (`.thread-path-edge--{critical,high,medium}`).

---

## Security

- SHA-256 hash on original bytes before any processing (chain of custody)
- CSRF protection (cookie + X-CSRFToken header for SPA)
- Sliding-window rate limiting (200 reads/min, 30 writes/min per IP)
- Auth middleware (`CATALYST_REQUIRE_AUTH` — on in prod via `RAILWAY_ENVIRONMENT`)
- PDF magic bytes validation before processing
- URL domain allowlists on all external connector responses
- Append-only AuditLog (NEVER UPDATE OR DELETE)
- Banned strings in user-visible text: "Haiku", "Sonnet", "Opus", "Claude", "AI assistant",
  "LLM", "GPT" — enforced by CI gate (`scripts/check-banned-strings.mjs`)

---

## Test Suite

| Suite | Count | Runner |
|-------|-------|--------|
| Backend (Docker, CI-equiv, `--exclude-tag=eval`) | **1064** | Django test runner |
| Frontend (Vitest) | **154** | Vitest |
| API smoke test | 30/30 checks | `tests/api_health_check.py` |

Run backend suite (requires running Docker stack):
```
docker exec catalyst_backend python manage.py test investigations --exclude-tag=eval --keepdb --noinput
```

Run frontend suite:
```
cd frontend && npx vitest run && npx tsc --noEmit
```

---

## Deployment

- **Platform:** Railway (monorepo — backend + frontend as one service via `railway.json`)
- **Production URL:** set in `memory/catalyst_railway_url.md`
- **PR preview environments:** enabled (base = production DB — read-safe verifies only)
- **CI:** GitHub Actions — Backend Lint, Backend Tests, Frontend Lint/Test/Build, Secret Scan,
  claude-review. All required green before merge.
- **Merge strategy:** squash merge to `main`. Branch deleted after merge.
