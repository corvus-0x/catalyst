# CLAUDE.md — Catalyst System Map
**Last updated:** 2026-06-11
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
│   │   ├── county_auditor_connector.py ← ODNR parcel API [WORKING ✅]
│   │   └── (propublica_connector.py deleted — superseded)
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
├── tests/                       ← 924 backend tests + API health check (defaults to localhost)
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
| County Auditor | county_auditor_connector.py | YES (`/research/parcels/`) | YES | ✅ (ODNR recovered 2026-06-04; aud_link populated for Beacon/Schneider counties) |

**Ohio SOS:** Requires Tyler to download CSVs from publicfiles.ohiosos.gov and upload via
`POST /api/admin/upload-sos-csv/`.

---

## DATA MODELS

→ Full model reference: **`docs/team/backend-engineer.md`**

Key models for quick orientation:
- **Case** — name, status (ACTIVE/PAUSED/REFERRED/CLOSED)
- **Finding** — `status` (NEW/NEEDS_EVIDENCE/DISMISSED/CONFIRMED) × `evidence_weight`
  (SPECULATIVE/DIRECTIONAL/DOCUMENTED/TRACED). Dedup key: `(case, rule_id, trigger_entity_id)`.
  `evidence_snapshot` populated by every CRITICAL rule for referral PDF citations.
- **AuditLog** — append-only. **NEVER UPDATE OR DELETE.**
- **SearchJob** — async job tracker. Fields: `job_type`, `status`, `query_params`, `result`.
  Index on `(case, -created_at)` for reattach-on-mount.

---

## SIGNAL RULES

→ Full rule table + dedup logic: **`docs/team/backend-engineer.md`**

15 active rules. Severities: SR-015 INSIDER_SWAP, SR-025 FALSE_DISCLOSURE, SR-028
MATERIAL_DIVERSION are CRITICAL. All others HIGH or MEDIUM.

---

## API ENDPOINTS

→ Exact endpoint list + JSON shapes: **`docs/architecture/api-contract.md`**

Pattern: research endpoints return `202 + job_id`; frontend polls `GET /api/jobs/<uuid>/`
every 2s. AI pattern analysis also async (202). All others synchronous.

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

→ Full tab specs, drill-down interaction model, node/edge encoding: **`docs/architecture/frontend-design-spec.md`**

Routes: `/` Dashboard · `/cases` CasesList · `/cases/:id` CaseDetail (6 tabs: Investigate ·
Research · Financials · Timeline · Referrals · Replay) · `/search` · `/settings`

**Graph:** Cytoscape.js (`react-cytoscapejs` + `cytoscape-cose-bilkent`). D3 is used **only**
for the Timeline brush. Do NOT use D3 force simulation for the graph.

**What's NOT in the frontend:** No standalone Entity Browser route, no Triage queue, Pipeline
tab, Documents tab, or Overview tab.

---

## PROCESSING PIPELINE

→ Full pipeline detail: **`docs/team/data-engineer.md`**

`extraction.py` → `classification.py` → `entity_extraction.py` → `ai_extraction.py` →
`entity_resolution.py` → `data_quality.py` → `signal_rules.py`

---

## TECHNOLOGY STACK

→ Full stack description: **`README.md`** ("What's in the box")

**Code Style (MUST FOLLOW):**
- **Ruff** — config in `pyproject.toml`. Line length: **100 chars max**.
  - E501 ignored in: `tests/`, `irs_connector.py`, `county_auditor_connector.py`,
    `county_recorder_connector.py`, `verify_recorder_portals.py`
  - **`views.py` is NOT exempt** — break long strings with parenthesized f-strings.
- Quote style: double quotes; indent: spaces; line endings: LF
- Pre-commit hooks run ruff + ruff-format on every commit

---

## KNOWN ISSUES

→ Full known-issues list: **`STATUS.md`** ("Known issues" section)

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

→ Full quick-reference: **`README.md`** ("Quick command reference" section)

```bash
docker-compose up                          # Full stack
cd backend && python manage.py runserver   # Django only (port 8000)
cd frontend && npm run dev                 # Vite only (port 5174)
cd backend && ruff check .                 # Lint
cd frontend && npx tsc --noEmit            # Type check
python tests/api_health_check.py           # API smoke test
cd backend && python manage.py seed_demo   # Load demo case
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
