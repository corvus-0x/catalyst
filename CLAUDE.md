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
│   │   ├── signal_rules.py      ← 17 active fraud detection rules
│   │   ├── referral_grade.py    ← Referral-grade predicate (tie-off gate) — one def, 3 call sites
│   │   ├── case_map.py          ← Case Map builder: summarized subject-pair edges + strength (Phase 1A)
│   │   ├── thread_elements.py   ← Thread assertions: completeness predicates + document_links ensure/reap sync (Phase 4A — built but UNWIRED until 4B)
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
  (SPECULATIVE/DIRECTIONAL/DOCUMENTED/TRACED) × `overreach_reviewed` (bool). Dedup key:
  `(case, rule_id, trigger_entity_id)` — `rule_id` is identity, **never** patched at tie-off.
  `evidence_snapshot` populated by every CRITICAL rule for referral PDF citations.
  **Tie-off gate (Session 48):** an Angle is "referral-grade" only when CONFIRMED ∧ ≥1 cited
  document ∧ weight ∈ {DOCUMENTED, TRACED} ∧ `overreach_reviewed`. The predicate lives once in
  `referral_grade.py` (`referral_grade_qs` / `is_referral_grade`) and is reused by readiness,
  the credibility counts, and the referral PDF filter. Enforced server-side in
  `FindingUpdateSerializer` on the transition into CONFIRMED. **Investigator-facing
  writeup of this gate + the whole detection/citation methodology:
  `docs/METHODOLOGY.md` — keep it in sync when `referral_grade.py` changes.**
  **Phase 4A (Session 52):** added `Finding.gate_version` (`LEGACY_NARRATIVE` | `ASSERTION_V1`,
  default `ASSERTION_V1`) for the 4B grandfathered gate; `serialize_finding` now embeds
  `elements[]` + `gate_version`. The old tie-off gate above is **unchanged** in 4A.
- **ThreadElement / ThreadElementCitation** (Phase 4A) — structured thread assertions.
  `ThreadElement.element_type` ∈ {ASSERTION, QUESTION, NOTE}; an ASSERTION's *role*
  (fact/analysis/claim) is **derived from evidence** (cited / uncited / `handoff_ready`), not
  stored. `ThreadElementCitation` (ASSERTION-only, same-case-guarded) is the **source of truth**
  for citations; `Finding.document_links` is a synced compatibility index (`FindingDocument.is_legacy`
  marks legacy/`add_document_ids` rows). Helpers in `thread_elements.py` are built but **UNWIRED**
  until 4B wires the softened, `gate_version`-aware gate.
- **AuditLog** — append-only. **NEVER UPDATE OR DELETE.**
- **SearchJob** — async job tracker. Fields: `job_type`, `status`, `query_params`, `result`.
  Index on `(case, -created_at)` for reattach-on-mount.

---

## SIGNAL RULES

→ Full rule table + dedup logic: **`docs/team/backend-engineer.md`**

17 active rules (SR-003 through SR-031, with gaps for retired IDs). Severities:
SR-015 INSIDER_SWAP, SR-025 FALSE_DISCLOSURE, SR-028
MATERIAL_DIVERSION are CRITICAL. All others HIGH or MEDIUM.

---

## API ENDPOINTS

→ Exact endpoint list + JSON shapes: **`docs/architecture/api-contract.md`**

Pattern: research endpoints return `202 + job_id`; frontend polls `GET /api/jobs/<uuid>/`
every 2s. AI pattern analysis also async (202). All others synchronous.

---

## FRONTEND VOCABULARY

These are NOT synonyms — use them in all component names, comments, and user-visible strings.
Backend model names appear only in API calls and TypeScript types and **do not change**.

Vocabulary moved to investigative-journalism / public-accountability language per
`docs/superpowers/specs/2026-06-19-case-map-and-thread-builder-design.md` §2.

| Frontend term | Backend model / concept | Notes |
|---------------|------------------------|-------|
| **Thread** | `Finding` | The investigation's narrative unit (was "Angle"). Use **Finding** only in formal package/export language. |
| **Subject** | `Person` or `Organization` | Only these two appear as Case Map nodes (was "Knot"). `Property` is NOT a Subject. |
| **Relationship** | Summarized `/case-map/` edge (Relationship / PersonOrganization / PropertyTransaction) | One line per Subject pair (was "Connection"). |
| **Case Map** | The Cytoscape graph canvas | Primary investigation workspace (was "Web"). |
| **Substantiated** | `Finding.status == CONFIRMED` | A Thread supported by cited sources. |
| **Set Aside** | `Finding.status == DISMISSED` | Reversible — may return if new sources/rules make it relevant. |
| **Handoff Package** | Referral package (workflow term) | **Referral Package** specifically = agency-directed export (AG/IRS/FBI). |
| **Lead** | AI pattern analysis result (`FindingSource.AI`) | NEVER show "Sonnet", "Claude", "AI", "LLM" — call it "Lead". |
| **Intake** | Document extraction pipeline | NEVER show "Haiku", "Claude", "AI" — call it "Intake". |
| **Observation** | `InvestigatorNote` | Free-text note on a Subject, Relationship, or Thread (was "Quick capture"). |
| **Pending relationships** | `FuzzyMatchCandidate` review queue | Badge on the Case Map toolbar (was "Pending connections"). |

> **Rename status (after Phase 1B/2, Session 50).** This table is the source of truth, and the new
> vocabulary is now **live in user-visible copy** on the Case Map workspace — the canvas is the "Case
> Map", nodes are "Subjects", the summarized edge inspector says "Relationship", and "Thread" appears
> throughout the inspectors and toolbar ("New thread", "Substantiated", "Set aside"). **Internal
> identifiers are intentionally NOT renamed** and remain the contract bridge: the focus reducer's
> `Frame.kind` still uses `"web"`/`"angle"`, component/prop names persist, and backend models
> (`Finding`, `Person`, `Organization`, `Relationship`) are unchanged. So "Angle"/"Knot"/"Web" you see
> in *code* (types, frame kinds, API calls) is correct, not stale; only *user-visible strings* moved.

**Banned strings in any user-visible text:** "Haiku", "Sonnet", "Opus", "Claude", "AI assistant", "LLM", "GPT"

---

## FRONTEND VIEWS

→ Full tab specs, node/edge encoding: **`docs/architecture/frontend-design-spec.md`**.
**Note (Session 50):** that spec's *Investigate drill-down interaction model* (4-level full-width
swaps) is **superseded** by the Case Map redesign — see
`docs/superpowers/specs/2026-06-19-case-map-and-thread-builder-design.md` (§5) and
`2026-06-20-case-map-phase-2-right-inspector-design.md`. Investigate is now a persistent Case Map +
right inspector (selection = inspector state; frame = breadcrumb history), shipped in PRs #14/#15.
**Phase 3 (PR #16, Session 51)** added **Thread Path Mode** (selecting a thread emphasizes its
relationships + dims the rest) and a canvas-width sortable **Thread Dock** under the map — see
`docs/superpowers/specs/2026-06-21-case-map-phase-3-thread-path-mode-design.md`. Frontend-only; renders
the existing `selection.kind==="thread"` (no reducer change). Phase 4 = Thread Builder (not yet built).

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

# Backend test suite — runs in the already-running Docker stack.
# Use --exclude-tag=eval to MATCH CI (ci.yml): the @tag("eval") AI suite is
# non-deterministic (hits the model) and is excluded from CI. Running it locally
# produces false reds — only include it when deliberately checking AI quality.
docker exec catalyst_backend python manage.py test investigations --exclude-tag=eval --keepdb --noinput
#   --exclude-tag=eval : skip the flaky AI evals (CI-equivalent gate)
#   --noinput          : avoid the "destroy leftover test DB?" prompt (EOFs non-interactively)
#   --keepdb           : reuse test_catalyst_db, skip the migration replay (fast loop)
#   narrow with e.g. ...test investigations.tests.test_case_map
```

---

## HOW TO WORK ON THIS PROJECT

1. **Read this file first.**
2. **Check the connector wiring table** before building anything — wire existing code first.
3. **Use the decision model** (GREEN/YELLOW/RED) for all choices.
4. **Run tests** before and after changes. API smoke test: `python tests/api_health_check.py`.
   Full backend suite (needs Postgres + ArrayField) runs in the **already-running Docker
   stack**, CI-equivalent: `docker exec catalyst_backend python manage.py test investigations
   --exclude-tag=eval --keepdb --noinput`. (Omit `--exclude-tag=eval` only to deliberately run
   the flaky AI eval suite — CI excludes it, so include it locally to match CI and avoid false reds.)
5. **Always branch for feature/non-trivial work — never commit it directly to `main`.** Claude
   creates the branch and makes the commits (pre-commit hooks are dormant in this environment,
   so run `ruff check`/`ruff format` manually before each commit). Pushing + opening the PR is
   an outward-facing step — confirm with Tyler first.
6. **Validate before `main` in three stages:** local Docker suite (fast red/green TDD) →
   Railway **PR preview deployment** (integration / live API-shape on the real endpoint) →
   merge to `main` (prod deploy gate).

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
