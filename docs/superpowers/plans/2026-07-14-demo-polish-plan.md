# Demo Polish (Branch 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every remaining demo-blocker and in-scope rough edge from the Phase 0 punch
list: the Settings crash, the stale "angle" vocabulary, raw internal strings in user-facing
copy, the wrong dashboard stat, stuck-job UX, and a read-only demo mode that stops public
visitors from mutating (and junking up) the live demo.

**Architecture:** Frontend fixes are per-view string/contract changes plus one new route
error boundary. Backend gets two contained changes: sanitized `SearchJob.error_message`
copy in `jobs.py`, and a demo-mode gate in `middleware.py` (env-flagged; unsafe HTTP
methods require an API token; anonymous mutations get a friendly 403 JSON). No schema
changes.

**Tech Stack:** Django 5.2 middleware + React/TS (Vite, Vitest). Backend tests in Docker
(`docker exec catalyst_backend python manage.py test investigations ... --keepdb
--noinput`), frontend `docker exec catalyst_frontend npx vitest run` or local
`cd frontend && npx vitest run` + `npx tsc --noEmit`.

## Global Constraints

- Executes in Claude Code locally; Claude makes branch + commits (CLAUDE.md rule 5; hooks
  dormant — run `ruff check` / `ruff format` on backend and `npx tsc --noEmit` on frontend
  before each commit).
- Branch: `demo-polish` off current `main`. Never commit to `main`.
- Vocabulary (CLAUDE.md table): user-visible strings say **Thread** (not Angle/Finding),
  **Subject** (not Knot/entity), **Case Map** (not Web/graph). **Internal identifiers,
  component names, types, CSS classes, and code comments do NOT change** — only strings a
  user can see. `Finding` stays in formal package/export language.
- Banned in user-visible text: "Haiku", "Sonnet", "Opus", "Claude", "AI assistant", "LLM",
  "GPT". AI features are "Lead"/"Intake".
- Ruff: 100 cols, double quotes (views.py NOT exempt from E501).
- Known env quirk: a PostToolUse formatter hook can strip momentarily-unused imports
  mid-edit — re-add imports together with the code that uses them.
- Spec: `docs/superpowers/specs/2026-07-14-demo-readiness-design.md` (Phase 2 + scope cap).
  Punch list: `docs/superpowers/plans/2026-07-14-demo-readiness-punch-list.md`.

## Verified facts (do not re-derive)

- **SettingsView crash (P0-3):** `GET /api/admin/sos-csv-status/` returns
  `{"files": [{"filename", "report_type", "exists", "uploaded_at", "days_old",
  "size_bytes"}]}` (verified live). `SosCsvSection` (SettingsView.tsx:96-147) expects
  `{all_present, uploaded_files: string[], expected_files: string[]}` → `.length` on
  undefined → uncaught TypeError → React unmounts the whole app (no error boundary).
  `fetchSosCsvStatus(): Promise<unknown>` (api/research.ts:205) and the component
  blind-casts. The `SosCsvStatusResponse` type in `types/` matches the WRONG shape.
- **Dashboard stat (P0-5):** `DashboardView.tsx:202` `const totalAngles =
  signalSummary?.total ?? 0;`, label "Total angles" at :234. Prod shows 0 with 12 findings
  — diagnose where `signalSummary` comes from in the same file before fixing.
- **Vocab sweep (P1-1) — string inventory (user-visible only):**
  - `TimelineTab.tsx:52` filter chip `finding: "Angles"` → `"Threads"`; five "Cite in
    angle" buttons (:144, :179, :210, :248, :276) → "Cite in thread".
  - `SearchView.tsx` — placeholder + helper text contain "angles" → "threads" (grep the
    file; its header comment vocabulary note is a comment, leave it).
  - Case header "Active angle: …" chip and the Investigate readiness panel strings
    ("Confirmed angles", "referral-grade angle", "N confirmed angles need an overreach
    acknowledgement") — grep `frontend/src` for user-visible `angle` case-insensitively
    (`grep -rn "ngle" frontend/src --include=*.tsx | grep -v "^\s*//" | grep -iv
    "triangle"`) and fix ONLY string literals rendered to the user (JSX text, `label=`,
    `title=`, `aria-label`, toast copy). ReferralsTab readiness checklist has several.
  - Backend `views.py` readiness payload may carry these strings server-side (e.g.
    "Tie off at least one referral-grade angle before export") — grep
    `backend/investigations/views.py` for `angle` in string literals and fix
    user-rendered ones there too.
- **Jobs error copy (deferred item):** `_mark_failed` (`jobs.py:54`) persists
  `f"{type(exc).__name__}: {exc}"`. Decision (spec): `error_message` becomes sanitized
  human copy; raw exception stays in the existing `logger.exception`. Tests asserting raw
  strings: `test_jobs.py:50`, `test_ai_thread_assist.py:247` (and any greppable others).
  `api-contract.md` gets a one-line note.
- **Read-only demo mode (P0-6, Tyler-decided):** mechanism = `middleware.py` gate.
  Env flag `CATALYST_DEMO_READ_ONLY` (default off). When on: requests with method NOT in
  {GET, HEAD, OPTIONS} require a valid API token (the middleware already implements token
  auth for `CATALYST_REQUIRE_AUTH` — reuse its token check, not a new one); anonymous
  mutations get `403 {"error": "This is a read-only public demo. Changes are disabled."}`.
  Exempt: `/api/csrf/` is GET anyway; nothing else needs exemption. The health check
  (`tests/api_health_check.py`) must send its token when the target has demo mode on —
  it already supports authenticated runs for REQUIRE_AUTH environments; verify and reuse.
  This also permanently stops anonymous "CSRF Test Case" creation (P0-2's creator).
- **Stuck-job UX (P0-4b / P1-5):** `useAsyncJob.ts` polls every 2s forever; no timeout.
  Stale QUEUED/RUNNING `SearchJob` rows in prod made readiness say "2 research jobs still
  running" for 33 days. Two halves: (a) frontend — after N polls (~3 min) without a
  terminal state, stop polling and set a "still queued — the worker may be busy; check
  back" error state; (b) backend — readiness's active-research check ignores SearchJobs
  older than 24h (find the readiness builder in views.py: `build_case_readiness`).
- **Activity feed copy (P1-3):** dashboard Activity list renders raw audit strings
  ("Record updated", "reevaluate_signals"). Find the renderer in `DashboardView.tsx`;
  map `AuditAction` values to human copy with case context where available; unknown
  actions fall back to a cleaned title-case string, never the raw enum.

---

### Task 1: SettingsView contract fix + route error boundary (P0-3)

**Files:**
- Modify: `frontend/src/views/SettingsView.tsx`, `frontend/src/types/` (the file holding
  `SosCsvStatusResponse`), `frontend/src/api/research.ts:205`
- Create: `frontend/src/components/RouteErrorBoundary.tsx`
- Modify: `frontend/src/App.tsx` (wrap routed views)
- Test: `frontend/src/views/SettingsView.test.tsx` (create), extend an existing App/router
  test only if one exists

**Interfaces:**
- Produces: `SosCsvStatusResponse = { files: SosCsvFileStatus[] }` with
  `SosCsvFileStatus = { filename: string; report_type: string; exists: boolean;
  uploaded_at: string | null; days_old: number | null; size_bytes: number | null }`.
  `RouteErrorBoundary` — class component, props `{ children }`, renders fallback
  `<div role="alert">Something went wrong loading this page.</div>` + a "Reload" button.

- [ ] **Step 1: Create branch**

```bash
git checkout -b demo-polish
```

- [ ] **Step 2: Write the failing component test (real API shape)**

`frontend/src/views/SettingsView.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SettingsView from "./SettingsView";

vi.mock("../api", () => ({
  fetchSosCsvStatus: vi.fn().mockResolvedValue({
    files: [
      { filename: "WI0070R.TXT", report_type: "NONPROFIT_CORP", exists: true,
        uploaded_at: "2026-07-01T00:00:00Z", days_old: 13, size_bytes: 1024 },
      { filename: "WI0100R.TXT", report_type: "DOMESTIC_LLC", exists: false,
        uploaded_at: null, days_old: null, size_bytes: null },
    ],
  }),
  uploadSosCsv: vi.fn(),
}));

describe("SettingsView", () => {
  it("renders the real /api/admin/sos-csv-status/ shape without crashing", async () => {
    render(<SettingsView />);
    await waitFor(() => expect(screen.getByText("WI0070R.TXT")).toBeInTheDocument());
    expect(screen.getByText(/1 of 2 expected files uploaded/i)).toBeInTheDocument();
    expect(screen.getByText("WI0100R.TXT")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it — must fail with the TypeError the prod crash showed**

Run: `cd frontend && npx vitest run src/views/SettingsView.test.tsx`
Expected: FAIL — `Cannot read properties of undefined (reading 'length')`.

- [ ] **Step 4: Fix the type, the api return type, and the component**

Types file: replace `SosCsvStatusResponse` with the shape in Interfaces.
`api/research.ts`: `fetchSosCsvStatus(): Promise<SosCsvStatusResponse>` (import the type).
`SettingsView.tsx` `SosCsvSection`: derive from `status.files` —

```tsx
const files = status.files ?? [];
const uploadedCount = files.filter((f) => f.exists).length;
const allPresent = files.length > 0 && uploadedCount === files.length;
```

Header line: `allPresent ? "All expected files are present." :
`${uploadedCount} of ${files.length} expected files uploaded.``. The per-file list maps
`files` directly (`f.filename`, `f.exists` for ✓/○). Keep the SOS help copy unchanged.

- [ ] **Step 5: Test green**

Run: `npx vitest run src/views/SettingsView.test.tsx` — PASS.

- [ ] **Step 6: Add RouteErrorBoundary and wrap routes**

`frontend/src/components/RouteErrorBoundary.tsx`:

```tsx
import { Component, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { hasError: boolean }

/** Route-level guard: one crashing view must never blank the whole app. */
export default class RouteErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" style={{ padding: "48px 32px", textAlign: "center" }}>
          <h2>Something went wrong loading this page.</h2>
          <button className="btn-secondary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

In `App.tsx`, wrap the route outlet/element tree once (around the `<Routes>` children or
the layout's content slot — match the file's existing structure) so every routed view is
covered. Add a boundary test to `SettingsView.test.tsx`:

```tsx
it("error boundary catches a crashing child", () => {
  const Boom = () => { throw new Error("boom"); };
  render(<RouteErrorBoundary><Boom /></RouteErrorBoundary>);
  expect(screen.getByRole("alert")).toBeInTheDocument();
});
```

(import `RouteErrorBoundary`; silence the expected console.error with
`vi.spyOn(console, "error").mockImplementation(() => {})` in that test.)

- [ ] **Step 7: Full frontend gate + commit**

```bash
cd frontend && npx tsc --noEmit && npx vitest run
git add frontend/src
git commit -m "fix(settings): match real sos-csv-status contract; add route error boundary"
```

(co-author trailer on every commit: `Co-Authored-By: Claude <noreply@anthropic.com>`)

---

### Task 2: Dashboard stat — correct count, correct vocabulary (P0-5)

**Files:**
- Modify: `frontend/src/views/DashboardView.tsx` (:202, :234)
- Test: `frontend/src/views/DashboardView.test.tsx` (create or extend if exists)

- [ ] **Step 1: Diagnose why `signalSummary?.total` is 0 in prod**

Read `DashboardView.tsx` around the `signalSummary` fetch: find which endpoint feeds it
and hit that endpoint on prod (read-only GET) to see the real payload. Two likely cases:
(a) the payload's field is named differently (e.g. `total_findings`) → fix the accessor;
(b) the endpoint genuinely returns 0 (backend bug) → fix the queryset in views.py.
Record which case it was in your report.

- [ ] **Step 2: Failing test pinning both count and label**

```tsx
// mock the dashboard API calls; signal summary returns { total: 12 } (or the real shape
// found in Step 1); assert:
expect(screen.getByText("Total threads")).toBeInTheDocument();
expect(screen.getByText("12")).toBeInTheDocument();
```

Write it against the real mocked shapes from Step 1 — a test that mocks the wrong shape
is worthless. Run → FAIL on the label at minimum.

- [ ] **Step 3: Fix label ("Total threads") + accessor; test green; commit**

```bash
git commit -m "fix(dashboard): thread count stat — correct source field + Thread vocabulary"
```

---

### Task 3: Vocabulary sweep — user-visible "angle" strings (P1-1)

**Files:**
- Modify: `frontend/src/views/TimelineTab.tsx`, `frontend/src/views/SearchView.tsx`,
  `frontend/src/views/InvestigateTab.tsx` (+ header chip source — grep for "Active
  angle"), `frontend/src/views/ReferralsTab.tsx`, `backend/investigations/views.py`
  (readiness payload strings)
- Test: extend the nearest existing test file per view (they exist for ReferralsTab,
  InvestigateTab, TimelineTab has none — add assertions where a test file already renders
  the strings; do NOT build new harnesses for untested views, just change the strings)

- [ ] **Step 1: Build the authoritative string inventory**

```bash
grep -rn "ngle" frontend/src --include=*.tsx | grep -viE "triangle|AnglePicker|AngleSplit|angleId|activeAngle|angle:|Angle}" | grep -E '"|>'
grep -n "angle" backend/investigations/views.py | grep -iE '"[^"]*angle[^"]*"'
```

Classify each hit: USER-VISIBLE (JSX text, label/title/aria/toast/placeholder, backend
readiness `label`/`detail` strings) vs INTERNAL (identifiers, comments, CSS classes,
frame kinds, API field names). Only USER-VISIBLE changes. Keep the inventory in your
report.

- [ ] **Step 2: Apply replacements**

Known set (verified): TimelineTab chip `"Angles"` → `"Threads"`; 5× "Cite in angle" →
"Cite in thread"; SearchView placeholder/helper "angles" → "threads"; "Active angle:" →
"Active thread:"; readiness strings "Confirmed angles" → "Confirmed threads",
"referral-grade angle" → "referral-grade thread", "N confirmed angles need an overreach
acknowledgement" → "…threads…". Backend: same treatment for any user-rendered readiness
copy in views.py. Plus whatever else Step 1's inventory surfaced.

- [ ] **Step 3: Update tests that asserted the old strings**

```bash
cd frontend && npx vitest run 2>&1 | tail -20
```

Any failure asserting "angle" copy gets updated to the new string (that is the point of
the change). Backend: run the readiness/referral test modules if views.py strings changed:
`docker exec catalyst_backend python manage.py test investigations.tests.test_referral_readiness --keepdb --noinput` (adjust to actual module names via `ls backend/investigations/tests/`).

- [ ] **Step 4: Gates + commit**

```bash
cd frontend && npx tsc --noEmit && npx vitest run
cd ../backend && ruff check investigations/ && ruff format investigations/
git commit -m "fix(vocab): user-visible angle->thread sweep (Timeline, Search, readiness, header chip)"
```

---

### Task 4: Sanitized job error copy (deferred audit item)

**Files:**
- Modify: `backend/investigations/jobs.py` (`_mark_failed`, :54)
- Test: `backend/investigations/tests/test_jobs.py:50`,
  `backend/investigations/tests/test_ai_thread_assist.py:247` (+ grep for other raw-message
  assertions)
- Modify: `docs/architecture/api-contract.md` (one-line note)

- [ ] **Step 1: Failing test first**

In `test_jobs.py`, change the raw-message assertion to the sanitized contract and add a
leak-check:

```python
        self.assertNotIn("Exception", job.error_message)
        self.assertNotIn(":", job.error_message.split()[0])  # no "TypeError:" prefix
        self.assertIn("could not be completed", job.error_message)
```

Run → FAIL (current copy is `"RuntimeError: ..."`-style).

- [ ] **Step 2: Implement**

```python
def _mark_failed(job: SearchJob, exc: BaseException) -> None:
    job.status = JobStatus.FAILED
    # Public copy only — the raw exception goes to server logs below, never to the API.
    job.error_message = (
        "This job could not be completed. The data source may be unavailable — "
        "try again, and check the server logs if it persists."
    )
    job.finished_at = timezone.now()
    job.save(update_fields=["status", "error_message", "finished_at"])
    logger.exception("SearchJob %s failed: %s", job.id, exc)
```

- [ ] **Step 3: Fix the other asserting tests; run the jobs + thread-assist modules; note in api-contract.md ("`error_message`: sanitized human-readable copy; raw exception in server logs only"); ruff; commit**

```bash
git commit -m "fix(jobs): sanitize public error_message; raw exception stays in logs"
```

---

### Task 5: Read-only demo mode (P0-6 — Tyler-decided)

**Files:**
- Modify: `backend/investigations/middleware.py`, `backend/backend/settings.py` (env flag)
- Test: `backend/investigations/tests/test_middleware.py` (extend; check actual filename
  via `ls backend/investigations/tests/ | grep -i middle`)
- Modify: `tests/api_health_check.py` (send token when configured)

- [ ] **Step 1: Read middleware.py's existing token-auth path first**

The REQUIRE_AUTH token check already exists — your gate must REUSE its token validation
(same header, same comparison). Note the exact header name and check-function in your
report.

- [ ] **Step 2: Failing tests**

```python
@override_settings(CATALYST_DEMO_READ_ONLY=True)
class DemoReadOnlyModeTests(TestCase):
    def test_anonymous_get_allowed(self):
        resp = self.client.get("/api/cases/")
        self.assertEqual(resp.status_code, 200)

    def test_anonymous_mutation_blocked_with_friendly_copy(self):
        resp = self.client.post(
            "/api/cases/", data="{}", content_type="application/json"
        )
        self.assertEqual(resp.status_code, 403)
        body = resp.json()
        self.assertIn("read-only public demo", body["error"])

    def test_token_bearer_can_mutate(self):
        # use the same token fixture pattern the existing REQUIRE_AUTH tests use
        ...
```

Copy the token fixture/header pattern from the existing middleware auth tests verbatim
for the third test. Adjust `@override_settings` key to whatever settings.py exposes
(Step 3). Run → FAIL (mode doesn't exist).

- [ ] **Step 3: Implement**

settings.py: `CATALYST_DEMO_READ_ONLY = os.environ.get("CATALYST_DEMO_READ_ONLY", "False") == "True"`
(match the file's existing env-flag idiom — copy how `CATALYST_REQUIRE_AUTH` is parsed).
middleware.py: in the same middleware class that does auth (before view dispatch): if the
flag is on, method not in `("GET", "HEAD", "OPTIONS")`, and the request does NOT carry a
valid API token (reuse the existing check), return
`JsonResponse({"error": "This is a read-only public demo. Changes are disabled — clone the repo to run your own instance."}, status=403)`.
CSRF endpoint is GET — no exemption list needed.

- [ ] **Step 4: Health check compatibility**

`tests/api_health_check.py` already has auth support for REQUIRE_AUTH targets — verify it
sends the token on mutations; if it only sends on some, make it send on all when a token
is configured. Its mutation checks must pass against a demo-mode prod (token present) and
its "CSRF Test Case" creation is thereby impossible for anonymous visitors (P0-2 creator
fixed by construction).

- [ ] **Step 5: Tests green (middleware module + full suite later); ruff; commit**

```bash
git commit -m "feat(security): read-only demo mode — anonymous mutations 403 with friendly copy"
```

NOTE for the controller: turning the flag ON in Railway prod is a deploy-time env change,
done in Phase 3 alongside the final reseed — not in this branch.

---

### Task 6: Stuck-job UX + stale-job readiness (P0-4b, P1-5)

**Files:**
- Modify: `frontend/src/hooks/useAsyncJob.ts`
- Modify: `backend/investigations/views.py` (readiness active-research check inside
  `build_case_readiness`)
- Test: `frontend/src/hooks/useAsyncJob.test.ts` (extend if exists, else create with fake
  timers), readiness test module for the 24h cutoff

- [ ] **Step 1: Frontend — poll cap**

Failing test with `vi.useFakeTimers()`: after `run()` resolves 202 and `fetchJob` keeps
returning `QUEUED`, advancing time past 3 minutes (90 polls × 2s) leaves
`status === "FAILED"` and
`error === "Still queued after several minutes — the worker may be busy. Check back shortly."`.
Implement: poll counter in `startPolling`; on cap, `stopPolling()`, set that status+error.

- [ ] **Step 2: Backend — readiness ignores dead jobs**

Failing test: a SearchJob QUEUED with `created_at` 25h ago does NOT count toward the
readiness "Active research" item; a fresh one does. Implement in the readiness builder:
filter `created_at__gte=timezone.now() - timedelta(hours=24)` on the running-jobs count.

- [ ] **Step 3: Gates + commit**

```bash
git commit -m "fix(jobs): stuck-job poll cap in useAsyncJob; readiness ignores jobs older than 24h"
```

---

### Task 7: Dashboard activity feed copy (P1-3)

**Files:**
- Modify: `frontend/src/views/DashboardView.tsx` (activity list renderer)
- Test: extend `DashboardView.test.tsx` from Task 2

- [ ] **Step 1: Find the renderer and the data**

Locate where activity rows render ("Record updated" etc.) and what fields the audit
payload carries (action, table_name, notes, case name?). The raw `notes` value
("reevaluate_signals") must never render as-is.

- [ ] **Step 2: Failing test → mapping → green → commit**

Map known actions to sentences ("Record updated" + table_name "findings" → "Thread
updated"; "reevaluate_signals" note → "Signal rules re-evaluated"; DOCUMENT_DELETED →
"Document removed"). Fallback: title-case the action enum, drop underscores — never show
snake_case. Keep it a small `humanizeActivity(entry): string` function in the same file.

```bash
git commit -m "fix(dashboard): humanize activity feed copy (no raw enums or internal notes)"
```

---

### Task 8: Full gates, PR

- [ ] **Step 1: CI-equivalent suites**

```bash
docker exec catalyst_backend python manage.py test investigations --exclude-tag=eval --keepdb --noinput
cd frontend && npx tsc --noEmit && npx vitest run
cd ../backend && ruff check investigations/ && ruff format investigations/
```

All green; fix only regressions your branch caused.

- [ ] **Step 2: Update punch list checkboxes** (mark P0-2/3/4/5/6, P1-1/3/5 states) and
  commit docs.

- [ ] **Step 3: STOP — push + PR is Tyler-confirmed.** After PR: Railway preview gate =
  eyeball Settings page, dashboard stats/activity, Timeline/Search vocab, and one
  demo-mode probe (anonymous POST → friendly 403) on the preview env (set
  `CATALYST_DEMO_READ_ONLY=True` on the preview to exercise it there first).
