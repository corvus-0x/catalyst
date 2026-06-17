# Citation Fix & Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the angle-evidence citation feature correctly — confirm the working-tree fix for the HTTP 500 / broken-audit bug actually works at runtime, fix the misleading DRAFT-status error, and land it as a clean commit separated from the unfinished case-quality-score work.

**Architecture:** The citation 500 fix already exists in the working tree (serializer stores JSON-safe string ids in `validated_data` and keeps Document objects on private attrs `_documents_to_add`/`_documents_to_remove`; the view wraps the mutation + `AuditLog.log` in `transaction.atomic()`). This plan *verifies* that fix at the live surface rather than rebuilding it, adds one small status-validation fix, then splits the commits. The case-quality-score feature (the `quality` block on the readiness endpoint) is committed separately as in-progress work.

**Tech Stack:** Django 5.2 + Postgres 18 (native, port 5433), Django test runner, React + Vite frontend, ECC `chrome-devtools` MCP for browser verification.

## Global Constraints

- Ruff line length: **100 chars max**; `views.py` is NOT E501-exempt — break long strings with parenthesized f-strings.
- Quote style: double quotes; indent: spaces; line endings: LF.
- **`AuditLog` is append-only — NEVER UPDATE OR DELETE.** Only `AuditLog.log(...)` (create) is allowed.
- **Tyler commits from his local machine** — all `git commit` steps are run by Tyler, not the agent (sandbox git has hook permission issues). Interactive `git add -p` is therefore available.
- Frontend user-visible strings: never show "Claude/AI/LLM/Haiku/Sonnet". Use the vocabulary map (Angle, Knot, Connection, Lead, Intake).
- Backend tests require Postgres on `127.0.0.1:5433`. Start it (non-elevated) with:
  `& "C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" -D "C:\Program Files\PostgreSQL\18\data" -w start`
- Test command form: `cd backend && DJANGO_DEBUG=False ../.venv/Scripts/python.exe manage.py test <path> --noinput`

---

## Feature → file map (commit attribution)

| File | Citation fix commit | Case-quality-score commit |
|------|--------------------|---------------------------|
| `backend/investigations/serializers.py` | ✅ all hunks (string-id storage, private attrs, **+ DRAFT fix from Task 2**) | — |
| `backend/investigations/tests/test_signals.py` | ✅ all hunks (citation view + serializer tests, **+ DRAFT test from Task 2**) | — |
| `backend/investigations/views.py` | ✅ only the `api_case_finding_detail` hunk (~line 3364: `transaction.atomic` + `after_state`) | ✅ the `READINESS_QUALITY_WEIGHTS` / `_build_case_quality` / `build_case_readiness` hunk (~line 2198) |
| `backend/investigations/tests/test_referral_readiness.py` | — | ✅ all hunks (quality block tests) |
| `frontend/src/types/index.ts` | — | ✅ all hunks (`CaseQuality*` types) |
| `frontend/src/views/InvestigateTab.tsx` | — | ✅ all hunks (quality UI) |
| `docs/architecture/api-contract.md` | ✅ citation/`add_document_ids` sections | ✅ readiness-`quality` sections |
| `docs/governance/tech-debt-register.md` | — (pre-existing edit; commit with whichever or separately) | — |

> Two small unattributed `views.py` hunks exist near `api_case_signal_collection` (~2542) and `api_case_reevaluate_signals` (~5256). During `git add -p`, attribute each by content: anything referencing readiness/quality → quality commit; anything else → citation commit. If a hunk is pure whitespace/indentation drift unrelated to either, discard it with `git checkout -p`.

---

### Task 1: Live-verify the existing citation fix (runtime, not tests)

This is the bug that returned HTTP 500. The unit tests already pass; this task confirms the **running app** now returns 200 and writes an audit row.

**Files:**
- Verify only (no edits): `backend/investigations/serializers.py`, `backend/investigations/views.py`

**Interfaces:**
- Consumes: `PATCH /api/cases/<case_id>/findings/<finding_id>/` with body `{"add_document_ids": ["<doc-uuid>"]}` / `{"remove_document_ids": [...]}`
- Produces: a confirmed-working endpoint; an `AuditLog` row with `action=FINDING_UPDATED` and `after_state["add_document_ids"] == ["<doc-uuid>"]`

- [ ] **Step 1: Ensure Postgres is up and start the dev server fresh**

```bash
& "C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" -D "C:\Program Files\PostgreSQL\18\data" -w start
cd backend && ../.venv/Scripts/python.exe manage.py runserver 127.0.0.1:8000 --noreload
```
> The server MUST be (re)started after the working-tree fix so it loads the fixed code — the original audit's 500 came from a stale `--noreload` process holding pre-fix code.

- [ ] **Step 2: Pick a CONFIRMED finding + a same-case document**

```bash
cd backend && ../.venv/Scripts/python.exe manage.py shell -c "from investigations.models import *; bf=Case.objects.get(name='Bright Future Foundation Investigation'); f=Finding.objects.filter(case=bf,status=FindingStatus.CONFIRMED).first(); d=Document.objects.filter(case=bf,is_generated=False).first(); print(bf.id, f.id, d.id)"
```
Expected: three UUIDs printed.

- [ ] **Step 3: Drive the citation ADD through the real endpoint (with CSRF handshake)**

```bash
J=/tmp/cj.txt; B=http://127.0.0.1:8000
curl -s -c $J $B/api/csrf/ -o /dev/null; T=$(grep csrftoken $J | awk '{print $7}')
curl -s -b $J -X PATCH "$B/api/cases/<CASE>/findings/<FIND>/" \
  -H "Content-Type: application/json" -H "X-CSRFToken: $T" -H "Referer: $B/" \
  -d '{"add_document_ids":["<DOC>"]}' -w "\nHTTP %{http_code}\n"
```
Expected: **HTTP 200** (not 500) and a JSON finding body whose `document_links` includes `<DOC>`.

- [ ] **Step 4: Confirm the append-only audit row was written**

```bash
cd backend && ../.venv/Scripts/python.exe manage.py shell -c "from investigations.models import AuditLog; a=AuditLog.objects.filter(action='FINDING_UPDATED').latest('created_at'); print(a.after_state)"
```
Expected: `after_state` is a dict containing `'add_document_ids': ['<DOC>']` (string id, JSON-serializable). This is the exact thing that crashed before.

- [ ] **Step 5: Probe remove + idempotency, then restore state**

```bash
# remove (expect 200), then a second remove (expect 200, no-op)
curl -s -b $J -X PATCH "$B/api/cases/<CASE>/findings/<FIND>/" -H "Content-Type: application/json" -H "X-CSRFToken: $T" -H "Referer: $B/" -d '{"remove_document_ids":["<DOC>"]}' -w "HTTP %{http_code}\n" -o /dev/null
cd backend && ../.venv/Scripts/python.exe manage.py shell -c "from investigations.models import Finding; print(Finding.objects.get(id='<FIND>').document_links.count())"
```
Expected: HTTP 200 on remove; final link count `0` (state restored). If all green, the citation 500 blocker is verified fixed.

---

### Task 2: Fix the misleading DRAFT-status error on documents-only PATCH

A finding whose stored `status` is outside `FindingStatus` (e.g. legacy `"DRAFT"`) cannot receive a citation: `serializers.py:911` re-validates the *existing* status on every edit and returns `"Invalid status. Expected one of: …"`. Fix: only validate `status` when the caller actually sends it.

**Files:**
- Modify: `backend/investigations/serializers.py:911-927`
- Test: `backend/investigations/tests/test_signals.py` (add to the existing `FindingUpdateSerializerTests` or `FindingCitationPatchApiTests` class)

**Interfaces:**
- Consumes: `FindingUpdateSerializer(data={"add_document_ids": [...]}, instance=finding)` where `finding.status` is not in `_VALID_FINDING_STATUSES`
- Produces: `serializer.is_valid() is True`; status passes through unchanged

- [ ] **Step 1: Write the failing test**

```python
def test_documents_only_patch_allowed_on_finding_with_legacy_status(self):
    # A finding carrying a status value outside the FindingStatus enum
    # (e.g. legacy "DRAFT") must still accept a documents-only update.
    finding = Finding.objects.create(
        case=self.case, rule_id="SR-001", title="Legacy", status="DRAFT",
    )
    document = Document.objects.create(case=self.case, is_generated=False)
    s = FindingUpdateSerializer(
        data={"add_document_ids": [str(document.id)]}, instance=finding,
    )
    self.assertTrue(s.is_valid(), s.errors)
    self.assertEqual(s.validated_data["status"], "DRAFT")
```
> Adjust the `Finding.objects.create(...)`/`Document.objects.create(...)` kwargs to match the required fields used elsewhere in this test file (copy from a neighboring test's setup).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && DJANGO_DEBUG=False ../.venv/Scripts/python.exe manage.py test investigations.tests.test_signals -k legacy_status --noinput`
Expected: FAIL — `s.is_valid()` is False with error `{"status": ["Invalid status. Expected one of: …"]}`.

- [ ] **Step 3: Apply the minimal fix**

Replace `serializers.py:911-927` with:

```python
        if "status" in self.initial_data:
            new_status = self.initial_data["status"]
            if new_status not in _VALID_FINDING_STATUSES:
                valid_list = ", ".join(sorted(_VALID_FINDING_STATUSES))
                self._errors = {"status": [
                    f"Invalid status. Expected one of: {valid_list}."]}
                return False
        else:
            new_status = self.instance.status

        new_note = self.initial_data.get(
            "investigator_note", self.instance.investigator_note)

        # Only require a dismissal rationale when the caller is actively
        # setting status to DISMISSED — not when editing an already-dismissed
        # finding's citations.
        if (
            "status" in self.initial_data
            and new_status == FindingStatus.DISMISSED
            and not (new_note or "").strip()
        ):
            self._errors = {
                "investigator_note": [
                    "A dismissal rationale is required when setting status to DISMISSED."
                ]
            }
            return False
```

- [ ] **Step 4: Run the new test + the full finding/citation suites to verify green**

Run: `cd backend && DJANGO_DEBUG=False ../.venv/Scripts/python.exe manage.py test investigations.tests.test_signals --noinput`
Expected: PASS (new test passes; no regressions — the existing dismissal-note test must still pass because it sends `status=DISMISSED`).

- [ ] **Step 5: (Tyler) stage this fix with the citation commit — do not commit yet**

Leave staged for Task 3. The serializer + test_signals changes belong to the citation commit.

---

### Task 3: Commit 1 — the citation fix (ship-ready)

Land the citation bug fix + DRAFT fix as one focused commit, excluding all case-quality-score changes.

**Files:** see the feature→file map (Citation column).

- [ ] **Step 1: (Tyler) Stage the citation-only files and hunks**

```bash
git add backend/investigations/serializers.py backend/investigations/tests/test_signals.py
git add -p backend/investigations/views.py        # stage ONLY the api_case_finding_detail hunk (transaction.atomic + after_state)
git add -p docs/architecture/api-contract.md      # stage ONLY the add_document_ids / citation sections
```

- [ ] **Step 2: (Tyler) Confirm the staged diff contains no quality-score code**

```bash
git diff --cached | grep -iE "quality|_build_case_quality|READINESS_QUALITY|CaseQuality"
```
Expected: **no output**. If anything prints, unstage it: `git restore --staged <file>` and redo the `-p` selection.

- [ ] **Step 3: (Tyler) Commit**

```bash
git commit -m "fix(findings): store citation document ids as JSON-safe strings; allow documents-only edits

Stores str(doc.id) in validated_data so AuditLog.log no longer raises
TypeError; keeps Document objects on private attrs for the link writes.
Wraps the finding update + audit write in transaction.atomic so a
serialization failure can no longer leave the mutation un-audited.
Validates status only when supplied so citations can be added to
findings carrying a legacy/non-enum status.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 4: Verify the committed branch is green in isolation**

Run: `cd backend && DJANGO_DEBUG=False ../.venv/Scripts/python.exe manage.py test investigations.tests.test_signals --noinput`
Expected: PASS. (CI will run the full suite on push.)

---

### Task 4: Commit 2 — case-quality-score feature (in progress)

Commit the remaining working-tree changes as a separate, clearly-labelled WIP commit so the citation fix can merge independently.

**Files:** see the feature→file map (Case-quality-score column).

- [ ] **Step 1: (Tyler) Run the quality-score tests**

Run: `cd backend && DJANGO_DEBUG=False ../.venv/Scripts/python.exe manage.py test investigations.tests.test_referral_readiness --noinput`
Expected: PASS.

- [ ] **Step 2: (Tyler) Type-check the frontend quality changes**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: (Tyler) Stage the remaining quality-score files/hunks and commit**

```bash
git add backend/investigations/tests/test_referral_readiness.py frontend/src/types/index.ts frontend/src/views/InvestigateTab.tsx
git add -p backend/investigations/views.py        # the READINESS_QUALITY_WEIGHTS / _build_case_quality / build_case_readiness hunk
git add -p docs/architecture/api-contract.md      # the readiness `quality` block sections
git commit -m "feat(referral): add case-quality score to readiness checklist (WIP)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 4: (Tyler) Confirm a clean tree (except intended untracked files)**

```bash
git status --short
```
Expected: no remaining modified (`M`) backend/frontend source files. `docs/governance/tech-debt-register.md` and the untracked agent files remain — handled in Task 5.

---

### Task 5: Decide on the untracked agent-tooling files

`.agents/`, `.codex/`, and `AGENTS.md` appeared during the session (a parallel Codex agent). Decide whether they belong in the repo.

**Files:**
- Possibly modify: `.gitignore`
- Possibly add: `AGENTS.md`

- [ ] **Step 1: Inspect what they are**

```bash
ls -la .agents/ .codex/ 2>/dev/null; head -40 AGENTS.md
```

- [ ] **Step 2: Apply the decision**

Recommended: ignore the tooling state dirs, keep the doc if it's useful guidance.

```bash
printf '\n# Agent tooling state\n.agents/\n.codex/\n' >> .gitignore
git add .gitignore AGENTS.md   # add AGENTS.md only if it is intended contributor-facing docs
git commit -m "chore: ignore agent tooling state dirs

Co-Authored-By: Claude <noreply@anthropic.com>"
```
> RED decision — confirm with Tyler before committing `AGENTS.md`; it may contain machine-specific or experimental content.

---

### Task 6: Verify the two frontend commits in a browser

Commits `2fbec5c` (connection detail panel) and `ba7467e` (research result triage actions) were never driven at their real surface. Verify with the ECC `chrome-devtools` MCP.

**Files:** Verify only — `frontend/src/components/ConnectionDetailPanel.tsx`, `frontend/src/views/ResearchTab.tsx`, `frontend/src/views/InvestigateTab.tsx`

- [ ] **Step 1: Start the full stack**

```bash
& "C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" -D "C:\Program Files\PostgreSQL\18\data" -w start
cd backend && ../.venv/Scripts/python.exe manage.py runserver 127.0.0.1:8000 --noreload    # background
cd frontend && npm run dev                                                                  # background, port 5174
```

- [ ] **Step 2: Open the Bright Future case Investigate tab and verify the connection detail panel**

Use `chrome-devtools` MCP: `new_page` → navigate to `http://localhost:5174/cases/9df434c4-81fc-40d2-a567-498898bb4590` → Investigate tab → click a Connection (graph edge) → `take_snapshot`/`take_screenshot`.
Expected: the connection detail panel opens with the edge's data; no console errors (`list_console_messages`).

- [ ] **Step 3: Verify research result triage actions**

Navigate to the Research tab → run/open a research result → exercise a triage action (accept/dismiss/whatever the commit added) → `take_screenshot` and confirm the action's effect renders.
Expected: the triage action updates the result state; no console/network errors (`list_network_requests` shows no failed calls).

- [ ] **Step 4: Capture evidence**

Save the screenshots and note any friction. Report PASS/FAIL per panel. (No commit — verification only.)

---

## Self-Review

- **Spec coverage:** Citation 500 fix → Task 1 (verify) + Task 3 (commit). Audit-log gap / atomicity → verified in Task 1 Step 4, committed in Task 3. CI gap (view-level test) → committed in Task 3 (test_signals). DRAFT-status error → Task 2. Commit split → Tasks 3–4. Untracked files → Task 5. Frontend not-yet-verified → Task 6. Railway env check → intentionally out of scope per decision.
- **No placeholders:** All edits show exact code; all commands show expected output. The only `<...>` tokens are runtime UUIDs from Task 1 Step 2 and per-hunk `git add -p` selections (inherently interactive).
- **Type consistency:** `_documents_to_add`/`_documents_to_remove`, `validated_data["status"]`, `add_document_ids`/`remove_document_ids`, `after_state` used consistently with the existing working-tree code and across tasks.
