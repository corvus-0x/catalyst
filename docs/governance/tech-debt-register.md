# Catalyst — Tech Debt Register

**Last Updated:** 2026-06-16
**Purpose:** Track all known technical debt. Prioritize during roadmap updates, not ad-hoc.

---

## How to Use This File

When you notice tech debt during a session, add it here with a severity and brief description. Do NOT fix it immediately unless it blocks the current milestone. Tech debt is addressed during planned roadmap slots, not reactively.

Severity levels:
- **CRITICAL** — Blocks compilation, deployment, or demo. Fix in current milestone.
- **HIGH** — Degrades quality noticeably. Schedule for next milestone.
- **MEDIUM** — Should be fixed but doesn't block anything. Address when convenient.
- **LOW** — Nice to have. Fix during polish phase.

---

## Active Tech Debt

| ID | Severity | Description | Location | Added |
|----|----------|-------------|----------|-------|
| TD-007 | HIGH | `TODO(SEC-010)` markers — 4 endpoints need user-scoped filtering when auth is added (was 6; 4 remain as of 2026-06-16) | backend/investigations/views.py | 2026-04-01 |
| TD-008 | HIGH | views.py is ~5,985 lines — should be split into logical modules. **Grew from ~2,600 (2026-04-01); severity raised MEDIUM→HIGH 2026-06-16** | backend/investigations/views.py | 2026-04-01 |
| TD-009 | MEDIUM | Frontend test coverage is thin — vitest is configured (`npm run test`) but only one component test exists (`TieOffModal.test.tsx`). Reframed 2026-06-16 from "no frontend tests exist" | frontend/ | 2026-04-01 |
| TD-010 | MEDIUM | Signal rules not configurable without code changes (FR-605 partial) — confirmed 2026-06-16: `RULE_REGISTRY` is a static dict and evaluators are hardcoded functions with baked-in thresholds | backend/investigations/signal_rules.py | 2026-04-01 |
| TD-011 | MEDIUM | Rate limiting is in-memory only — resets on process restart (middleware still documents an in-memory sliding window as of 2026-06-16) | backend/investigations/middleware.py | 2026-04-01 |
| TD-012 | LOW | HTML template views still exist alongside API views (legacy from Phase 1) — confirmed 2026-06-16: 4 `render()` calls to `.html` templates remain (~views.py:3945–3991) | backend/investigations/views.py, urls.py | 2026-04-01 |

---

## Resolved Tech Debt

| ID | Description | Resolved | Milestone |
|----|-------------|----------|-----------|
| TD-001 | `types.ts` truncated mid-property | 2026-06-16 | Frontend rebuilt; types restructured into `frontend/src/types/` directory (no `types.ts`) |
| TD-002 | `CaseDetailView.tsx` truncated at :461 | 2026-06-16 | Frontend rebuild — file is now 240 lines and closes cleanly |
| TD-003 | `DocumentsTab.tsx` truncated | 2026-06-16 | Component removed — no Documents tab in the shipped design |
| TD-004 | `PdfViewer.tsx` truncated | 2026-06-16 | Component removed — `PdfViewer.tsx` no longer exists |
| TD-005 | `fetchDocumentDetail()` undefined | 2026-06-16 | Removed with PdfViewer; no longer imported anywhere |
| TD-006 | Missing migration for ExtractionStatus fields | 2026-06-16 | Added by migration `0016_auditlog_file_size_auditlog_sha256_hash_and_more` |
| TD-013 | `admin.py` models on basic register | 2026-06-16 | All 12 registered models now use `@admin.register` + full `ModelAdmin`; no bare `admin.site.register()` calls remain |
| TD-014 | Session tracker has stale open tasks | 2026-06-16 | `docs/ops/session-tracker.md` removed (see note: dangling reference still in `docs/README.md`) |
