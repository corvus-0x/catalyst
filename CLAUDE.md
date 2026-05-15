# CLAUDE.md — Catalyst System Map
**Last updated:** 2026-05-15
**Owner:** Tyler Collins (tjcollinsku@gmail.com)

---

## CRITICAL READING FOR FRONTEND WORK

Before writing any frontend code, read these two documents in full:

1. **`docs/architecture/frontend-design-spec.md`** — Authoritative UI spec. Covers the Cytoscape
   graph setup, 4-level drill-down interaction model, node/edge visual encoding, all tab layouts,
   async job polling pattern, AI role naming rules, and a locked 21-step build sequence.

2. **`docs/architecture/api-contract.md`** — Exact JSON shapes for every endpoint the frontend
   consumes. Covers monetary field types, optional YoY fields on financials, `finding_links` on
   graph edges, async job response format, and FuzzyMatchCandidate shape.

---

## WHAT IS CATALYST

Catalyst is referral packaging software for citizen investigators handing off to professionals
with subpoena power. An investigator opens a case, pulls data from government sources, uploads
documents, and the system extracts entities, detects fraud signals, and exports a citation-bearing
referral package for the AG/IRS/FBI. The customer of the output is the professional investigator,
not Tyler.

Tyler is learning full-stack development. He wants thorough explanations and to understand the
code, not just ship it. He does NOT want to debug alone — Claude handles that. He DOES want to
make decisions when they matter.

---

## DECISION MODEL

- **GREEN:** Claude acts autonomously (code style, file organization, refactoring)
- **YELLOW:** Claude recommends + Tyler confirms (new libraries, architecture changes, external API choices)
- **RED:** Claude presents options + Tyler decides (scope changes, data source priorities, UX direction)

---

## PROJECT STRUCTURE

```
Catalyst/
├── backend/
│   ├── investigations/          ← ALL backend logic lives here
│   │   ├── models.py            ← Django models
│   │   ├── views.py             ← API endpoints — CORE
│   │   ├── urls.py              ← URL routing
│   │   ├── serializers.py       ← JSON serialization
│   │   ├── middleware.py        ← Auth + rate limiting
│   │   │
│   │   ├── # --- PROCESSING PIPELINE ---
│   │   ├── extraction.py        ← PDF text extraction (PyPDF2 + Tesseract OCR)
│   │   ├── classification.py    ← Document type classification
│   │   ├── entity_extraction.py ← Rule-based entity extraction from text
│   │   ├── entity_resolution.py ← Fuzzy matching + dedup entities
│   │   ├── entity_normalization.py ← Name/EIN/address standardization
│   │   ├── signal_rules.py      ← 15 active fraud detection rules
│   │   ├── data_quality.py      ← Data validation + audit logging
│   │   ├── ai_extraction.py     ← Claude AI entity/financial extraction
│   │   ├── ai_proxy.py          ← Claude API wrapper with caching
│   │   ├── ai_pattern_augmentation.py ← AI pattern analysis → Findings
│   │   ├── form990_parser.py    ← IRS 990 text parser (Part IV/VI/VII)
│   │   ├── jobs.py              ← Async task functions for Django-Q2 worker
│   │   │
│   │   ├── # --- CONNECTORS ---
│   │   ├── irs_connector.py            ← IRS TEOS 990 XML pipeline [WORKING ✅]
│   │   ├── county_recorder_connector.py ← 88 OH counties [WORKING ✅]
│   │   ├── ohio_aos_connector.py       ← OH Auditor of State [WORKING ✅]
│   │   ├── ohio_sos_connector.py       ← OH Secretary of State [LOCAL CSV ✅]
│   │   ├── county_auditor_connector.py ← ODNR parcel API [BROKEN ❌]
│   │   └── propublica_connector.py     ← ProPublica [SUPERSEDED]
│   │
│   ├── backend/                 ← Django project settings
│   └── manage.py
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx              ← Router: 5 main routes
│   │   ├── api/                 ← API client functions
│   │   ├── components/          ← Reusable UI components
│   │   ├── views/               ← Page-level components
│   │   ├── types/               ← TypeScript interfaces
│   │   └── context/             ← React context providers
│   ├── package.json
│   └── vite.config.ts
│
├── docs/
│   ├── architecture/            ← frontend-design-spec.md, api-contract.md
│   ├── team/                    ← Specialist briefing books
│   └── superpowers/plans/       ← Implementation plans
│
├── tests/                       ← 555+ backend tests + API health check
├── Dockerfile
├── docker-compose.yml
├── railway.json
└── CLAUDE.md
```

---

## CONNECTOR WIRING STATUS

| Connector | Backend File | Has Endpoint? | Frontend Calls It? | Works on Railway? |
|-----------|-------------|---------------|--------------------|-------------------|
| IRS TEOS XML | irs_connector.py | YES (`/research/irs/` + `/fetch-990s/`) | YES | ✅ |
| County Recorder | county_recorder_connector.py | YES (`/research/recorder/`) + auto DEED | YES | ✅ |
| Ohio AOS | ohio_aos_connector.py | YES (`/research/ohio-aos/`) | YES | ✅ |
| Ohio SOS | ohio_sos_connector.py | YES (`/research/ohio-sos/`) + admin upload | YES | ✅ (requires manual CSV upload) |
| County Auditor | county_auditor_connector.py | YES (`/research/parcels/`) | YES | ❌ ODNR ArcGIS 404 |
| ProPublica | propublica_connector.py | YES | Superseded | N/A |

**Ohio SOS:** Requires Tyler to download CSVs from publicfiles.ohiosos.gov and upload via
`POST /api/admin/upload-sos-csv/`.

---

## DATA MODELS

### Core
- **Case** — name, status (ACTIVE/PAUSED/REFERRED/CLOSED), notes, referral_ref
- **Document** — filename, sha256_hash, doc_type, ocr_status, extraction_status, is_generated
- **Finding** — Two dimensions: `status` (NEW/NEEDS_EVIDENCE/DISMISSED/CONFIRMED) and
  `evidence_weight` (SPECULATIVE/DIRECTIONAL/DOCUMENTED/TRACED). Also: rule_id, title,
  description, severity, source (AUTO/MANUAL/AI), evidence_snapshot, trigger_doc FK
- **FindingEntity** — links Finding to an entity
- **FindingDocument** — links Finding to a source document with page reference

### Entity Models
- **Person** — name, aliases[], date_of_birth, role_tags[]
- **Organization** — name, ein, entity_number, state, org_type, formation_date
- **Property** — parcel_number, address, county, assessed_value, purchase_price
- **FinancialSnapshot** — org FK, tax_year, revenue, expenses, net_assets (from 990)
- **Address** — normalized street/city/state/zip

### Relationship Models
- **PersonOrganization** — role_type (OFFICER, BOARD_MEMBER, COUNSEL, ADVISOR)
- **PropertyTransaction** — grantor/grantee with polymorphic entity link
- **Relationship** — person-to-person (FAMILY/BUSINESS/SOCIAL)
- **TransactionChain** + **TransactionChainLink** — grouped property deals

### Operational Models
- **InvestigatorNote** — polymorphic target (any entity/finding)
- **AuditLog** — append-only forensic log (NEVER UPDATE OR DELETE)
- **SearchJob** — async background job tracker. Fields: `job_type`, `status`
  (QUEUED/RUNNING/SUCCESS/FAILED), `query_params` JSON, `result` JSON. Case FK nullable.
  Index on `(case, -created_at)` for reattach-on-mount.

---

## SIGNAL RULES (15 active)

| Rule | Severity | What It Detects |
|------|----------|----------------|
| SR-003 | HIGH | VALUATION_ANOMALY — Purchase price deviates >50% from assessed value |
| SR-004 | HIGH | UCC_BURST — 3+ UCC amendments to same filing on the same calendar day |
| SR-005 | HIGH | ZERO_CONSIDERATION — Zero-consideration transfer between related parties |
| SR-006 | HIGH | SCHEDULE_L_MISSING — 990 Part IV Line 28 Yes but no Schedule L |
| SR-010 | MEDIUM | MISSING_990 — Tax-exempt org has no Form 990 on file |
| SR-012 | HIGH | NO_COI_POLICY — No conflict of interest policy despite material revenue |
| SR-013 | HIGH | ZERO_OFFICER_PAY — $0 officer compensation at high-revenue org |
| SR-015 | CRITICAL | INSIDER_SWAP — Related party on both sides of property transaction |
| SR-017 | HIGH | BLANKET_LIEN — UCC blanket lien on charity-connected entity |
| SR-021 | HIGH | REVENUE_SPIKE — Year-over-year revenue increase exceeds 100% |
| SR-024 | HIGH | CHARITY_CONDUIT — Charity buys from family, transfers to insider |
| SR-025 | CRITICAL | FALSE_DISCLOSURE — 990 denies related-party tx, evidence contradicts |
| SR-026 | HIGH | CONTRACTOR_DENIAL — 990 denies contractors, permits show otherwise |
| SR-028 | CRITICAL | MATERIAL_DIVERSION — 990 Part VI Line 5 Yes (self-disclosed misuse of assets) |
| SR-029 | HIGH | LOW_PROGRAM_RATIO — <50% of expenses go to program services |

**Dedup key:** `(case, rule_id, trigger_entity_id)` with fallback to `trigger_doc` when no
entity is present.

**Finding.evidence_snapshot** is populated by every CRITICAL rule and the XML evaluator,
capturing the exact fields/IDs that fired the rule for referral PDF citations.

---

## API ENDPOINTS

### Case Management
```
GET/POST  /api/cases/                              → List / create cases
GET       /api/cases/<uuid>/                       → Case detail + documents
GET       /api/cases/<uuid>/dashboard/             → KPI metrics
GET       /api/cases/<uuid>/graph/                 → Entity relationship graph
POST      /api/cases/<uuid>/export/                → Export JSON/CSV
```

### Documents
```
POST   /api/cases/<uuid>/documents/bulk/           → Upload files (multipart)
POST   /api/cases/<uuid>/documents/process-pending/ → Batch OCR
GET    /api/cases/<uuid>/documents/<uuid>/         → Document detail
DELETE /api/cases/<uuid>/documents/<uuid>/         → Delete document
POST   /api/cases/<uuid>/referral-pdf/             → Deterministic referral package PDF
```

### Findings
```
GET/POST  /api/cases/<uuid>/findings/              → List / create findings
PATCH     /api/cases/<uuid>/findings/<uuid>/       → Update finding
DELETE    /api/cases/<uuid>/findings/<uuid>/       → Delete finding
POST      /api/cases/<uuid>/reevaluate-signals/    → Re-run all signal rules
```

### Financials & Entities
```
GET    /api/cases/<uuid>/financials/               → 990 financial snapshots
GET    /api/entities/<type>/<uuid>/                → Entity detail
POST   /api/cases/<uuid>/fetch-990s/               → Fetch 990 XML + create FinancialSnapshots
```

### AI
```
POST   /api/cases/<uuid>/ai/summarize/             → AI case summary
POST   /api/cases/<uuid>/ai/ask/                   → Free-text AI chat
POST   /api/cases/<uuid>/ai/analyze-patterns/      → Enqueue AI pattern job [ASYNC → 202]
```

### Research (async endpoints return 202 + job_id; frontend polls every 2s)
```
POST   /api/cases/<uuid>/research/irs/             → IRS TEOS lookup [ASYNC]
POST   /api/cases/<uuid>/research/ohio-aos/        → Ohio AOS search [ASYNC]
POST   /api/cases/<uuid>/research/parcels/         → County parcel search [ASYNC]
POST   /api/cases/<uuid>/research/ohio-sos/        → Ohio SOS lookup [sync]
POST   /api/cases/<uuid>/research/recorder/        → County Recorder URL builder [sync]
POST   /api/cases/<uuid>/research/add-to-case/     → Import result as entity/note
```

### Async Jobs
```
GET    /api/jobs/<uuid>/                           → Poll a SearchJob
GET    /api/cases/<uuid>/jobs/?limit=5             → List recent jobs (reattach-on-mount)
```

### Admin / Utility
```
POST   /api/admin/upload-sos-csv/                  → Upload Ohio SOS CSV
GET    /api/admin/sos-csv-status/                  → Check which SOS CSVs exist
GET    /api/health/                                → Health check
GET    /api/search/                                → Full-text search
GET    /api/activity-feed/                         → Recent audit log
GET/POST/PATCH/DELETE  /api/cases/<uuid>/notes/    → Case notes CRUD
```

---

## FRONTEND VOCABULARY

These are NOT synonyms — use them in all component names, comments, and user-visible strings.
Backend model names appear only in API calls and TypeScript types.

| Frontend term | Backend model / concept | Notes |
|---------------|------------------------|-------|
| **Angle** | `Finding` | The investigation's narrative unit. |
| **Knot** | `Person` or `Organization` | Only these two appear as graph nodes. `Property` is NOT a knot. |
| **Connection** | Graph edge (Relationship / PersonOrganization / PropertyTransaction) | Lines between knots. |
| **Web** | The Cytoscape graph canvas | Primary investigation workspace. |
| **Lead** | AI pattern analysis result (`FindingSource.AI`) | NEVER show "Sonnet", "Claude", "AI", "LLM" — call it "Lead". |
| **Intake** | Document extraction pipeline | NEVER show "Haiku", "Claude", "AI" — call it "Intake". |
| **Quick capture** | `InvestigatorNote` | Free-text note on a knot, connection, or angle. |
| **Pending connections** | `FuzzyMatchCandidate` review queue | Badge on Web toolbar. |

**Banned strings in any user-visible text:** "Haiku", "Sonnet", "Opus", "Claude", "AI assistant", "LLM", "GPT"

---

## FRONTEND VIEWS

| Route | Component | What It Does |
|-------|-----------|-------------|
| `/` | Dashboard | KPI cards, recent cases, activity feed |
| `/cases` | CasesList | Table view, create case, filter/sort |
| `/cases/:id` | CaseDetail | **5 tabs: Investigate, Research, Financials, Timeline, Referrals** |
| `/search` | SearchView | Full-text search via Cmd+K command palette |
| `/settings` | Settings | Theme, SOS CSV upload, keyboard shortcuts |

### Case Detail Tabs

1. **Investigate** — Cytoscape.js graph canvas (the "Web"). Four drill-down levels:
   - Level 1: Web — knots/connections, toolbar (+ Knot, + Connection, + Angle, pending badge)
   - Level 2: Profile — entity portrait, linked documents, connections, angles, quick capture
   - Level 3: Angle — narrative editor, cited document cards, Lead panel (async AI suggestions)
   - Level 4: Document — OCR text with Intake highlights, RAG search panel

2. **Research** — IRS, Ohio SOS, Ohio AOS, County Recorder, County Auditor. Async polling. "+ Add to case" buttons.

3. **Financials** — Year-over-year 990 table (TanStack Table). Anomaly highlighting → "Open/Create angle".

4. **Timeline** — Brushable chronological rail (D3 brush only). "Cite in angle" picker.

5. **Referrals** — "Generate Referral Package (PDF)" → `POST /api/cases/<uuid>/referral-pdf/`.

### Graph: Cytoscape.js (NOT D3)
D3 is used ONLY for the Timeline brush. The entity graph uses `react-cytoscapejs` +
`cytoscape-cose-bilkent`. Do not use D3 force simulation for the graph.

### Node + edge visual encoding
- **Person knot:** blue fill, 2px blue border
- **Organization knot:** teal fill, 2px teal border
- **Selected knot:** white fill, 3px primary border, gold badge
- **Proposed connection:** dashed gray
- **Confirmed connection:** solid, color = highest-severity angle — CRITICAL: `#D85A30` / HIGH: `#BA7517` / MEDIUM: `#185FA5` / INFO: gray
- **Manual connection:** dotted

### What's NOT in the frontend
- No standalone Entity Browser route (entity detail = Profile drill-down)
- No Triage queue, Pipeline tab, Documents tab, or Overview tab

---

## PROCESSING PIPELINE

```
Document Upload
      │
extraction.py ─── PDF text extraction (PyPDF2 → Tesseract OCR fallback)
      │
classification.py ─── Identify doc type (990, deed, bank statement, etc.)
      │  └─ if IRS_990 → form990_parser.py (Parts IV/VI/VII → ingestion_metadata)
      │
entity_extraction.py ─── Rule-based: persons, orgs, properties
      │
ai_extraction.py ─── Claude AI fallback for messy documents
      │
entity_resolution.py ─── Fuzzy match against existing entities, dedup
      │
data_quality.py ─── Validate, log issues
      │
signal_rules.py ─── Run 15 fraud detection rules → persist as Findings
```

---

## TECHNOLOGY STACK

### Backend
- Python 3.11, Django 4.2, PostgreSQL 16 (Railway managed)
- Gunicorn (2 workers), Django-Q2 (async jobs, Postgres ORM broker, 2-worker qcluster)
- PyPDF2 + Tesseract OCR
- Anthropic Claude API (Haiku for extraction, Sonnet for analysis)

### Frontend
- React 18, TypeScript, Vite
- **Cytoscape.js** (`react-cytoscapejs` + `cytoscape-cose-bilkent`) — the Web graph
- D3.js — Timeline brush only
- Radix UI, TanStack Table 8, sonner, cmdk, lucide-react, React Router DOM 6

### Infrastructure
- Docker (multi-stage: node:20-alpine + python:3.11-slim)
- Railway (auto-deploy from GitHub main)
- GitHub Actions CI (ruff + tsc + vite build)

### Code Style (MUST FOLLOW)
- **Ruff** with config in `pyproject.toml`
- **Line length: 100 chars max** for all Python except connectors and tests
  - E501 ignored in: `tests/`, `irs_connector.py`, `county_auditor_connector.py`,
    `county_recorder_connector.py`, `propublica_connector.py`, `verify_recorder_portals.py`
  - **views.py is NOT exempt** — break long strings with parenthesized f-strings
- Quote style: double quotes; indent: spaces; line endings: LF
- Pre-commit hooks run ruff + ruff-format on every commit

---

## KNOWN ISSUES (active)

- **ODNR ArcGIS parcel API** returning 404 from Railway — both primary and fallback URLs down
- **Ohio SOS** requires manual CSV download from publicfiles.ohiosos.gov and admin upload
- **form990_parser.py** is wired into `_process_uploaded_file` for IRS_990 docs but may be
  partially superseded by the IRS TEOS XML parser (which also extracts Parts IV/VI/VII)
- **Git pre-commit hook** points to Windows Python path — doesn't work in sandbox environments

---

## SPECIALIST BRIEFING BOOKS

Located in `docs/team/`:
- **PLAYBOOK.md** — Session workflow, decision model, definition of done
- **qa-engineer.md** — Testing philosophy, known bug patterns, performance baselines
- **backend-engineer.md** — Data model relationships, API patterns, signal rules, extraction pipeline
- **irs-domain-expert.md** — Complete Form 990 structure, IRS e-file XML, parsing strategies
- **data-engineer.md** — Extraction pipeline, entity resolution, financial data, data quality

---

## COMMANDS

### Development
```bash
cd backend && python manage.py runserver   # Django dev server (port 8000)
cd frontend && npm run dev                 # Vite dev server (port 5173)
docker-compose up                          # Full stack (web + worker + db)
```

### Build & Verify
```bash
cd frontend && npm run build               # Production build
cd frontend && npx tsc --noEmit            # Type check only
cd backend && ruff check .                 # Lint
cd backend && python manage.py migrate     # Apply migrations
```

### Testing
```bash
python tests/api_health_check.py           # API smoke test (needs running server)
```

### Demo data
```bash
cd backend && python manage.py seed_demo   # Load Bright Future Foundation demo case
```

---

## HOW TO WORK ON THIS PROJECT

1. **Read this file first.**
2. **Check the connector wiring table** before building anything — wire existing code first.
3. **Use the decision model** (GREEN/YELLOW/RED) for all choices.
4. **Run tests** before and after changes: `python tests/api_health_check.py`
5. **Tyler commits from his local machine** (sandbox git has permission issues with hooks).
6. **Backend tests can't run locally** (Postgres + ArrayField) — validate on Railway after push.

---

## DIRECTIVES

**Prime:** Make Catalyst useful for actual investigation work, not just a file cabinet.

**Learning:** Tyler must be able to explain every file in the project. Thorough explanations
over speed. Walk him through the code, don't just write it.

**Reframe:** Catalyst is referral packaging software for citizen investigators handing off to
professionals with subpoena power. The customer of the output is the investigator with the badge.
Every design decision flows from that. First 70% is 100% — don't over-engineer.

**Portfolio:** Catalyst needs to get Tyler hired. The repo must look presentable to recruiters
at all times.
