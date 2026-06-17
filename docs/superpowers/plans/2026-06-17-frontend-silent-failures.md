# Frontend Silent-Failure Remediation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the frontend's swallowed errors visible — every silent `.catch(console.error)` / `.catch(() => {})` on a user-triggered or session-restoring action now surfaces a `toast.error`, so a failure never looks like "nothing happened" — and rename one misleading handler so the code reads honestly.

**Architecture:** Pure remediation of existing code in three view files. No new components, hooks, libraries, or backend changes. Each silent catch is brought in line with the pattern `CaseDetailView.refetchCase` already uses: keep `console.error(err)` for diagnostics AND add a `toast.error(...)` for the user. The one non-error item (the AOS "Save audit note" handler name) is a rename only — its runtime behavior is already correct.

**Tech Stack:** React 18 + TypeScript, Vite, `sonner` toasts. (No test framework work — see Global Constraints on verification.)

## Global Constraints

- **Frontend vocabulary (CLAUDE.md, banned strings):** never render "Finding", "Haiku", "Sonnet", "Opus", "Claude", "AI assistant", "LLM", "GPT" in user-visible text. Use **Angle** (= Finding), **Knot** (= Person/Organization), **Web** (= the graph canvas), **Lead** (= AI result), **Intake** (= extraction). Toast copy in this plan already complies ("knot", "Web", "angle", "searches", "dashboard").
- **Match the existing precedent, do not invent a helper.** `CaseDetailView.refetchCase` (CaseDetailView.tsx, the `.catch((err) => { console.error(err); toast.error("Failed to reload case data."); })` block) is the established pattern. Every fix in this plan is an inline `console.error` + `toast.error` at the catch site. Do NOT introduce a `notifyError`/`lib/` utility — the codebase has no `utils`/`lib` directory and surfaces errors inline everywhere; a new abstraction would be scope creep ("first 70% is 100% — don't over-engineer").
- **Keep `console.error` for diagnostics.** Do not replace it with the toast — add the toast alongside it. (The toast is for the user; the console line is for the developer.)
- **`toast` import:** `CaseDetailView.tsx` and `ResearchTab.tsx` already `import { toast } from "sonner"`. **`InvestigateTab.tsx` does NOT** — Task 2 adds it. (Note: `InvestigationTab.tsx` — the Replay tab — is a different file and already imports it; do not confuse the two.)
- **No behavior change in Task 4.** The AOS add-to-case already creates an `InvestigatorNote` server-side (`backend/investigations/views.py` docstring: `ohio-aos → InvestigatorNote (audit results aren't entities)`, returns `created: "note"`), so the button labeled "Save audit note" already saves a note and `outcomeLabel` already prints "Saved as note". Task 4 only renames the misleadingly-named `handleCreateOrg` (which is actually a generic add-to-case routed by `source`) so the code reads honestly. No label, key, endpoint, or outcome changes.
- **Verification = the `verify` skill, not unit tests.** These three views have **no** unit-test coverage in the codebase (jsdom + Cytoscape make them impractical to render), and these changes are one-line error-surfacing additions matching an existing pattern. Adding brittle full-view render tests (or a helper invented solely to have something to unit-test) would violate the "follow established patterns / don't over-engineer" rule. Each task is gated by `npx tsc --noEmit` and, after all tasks, a runtime `verify`-skill pass that forces each failure and confirms the toast appears. State this explicitly; do not silently skip a "write the test" step.
- **Type check (from `frontend/`):** `npx tsc --noEmit`. **Full suite (regression only):** `npm test` (must stay green — these edits should not touch any tested unit).
- **Branch:** `fix/frontend-silent-failures` (already created off `origin/main`, base `3541150`). Commit per task. Tyler may commit from his machine; if the agent commits, use the short co-author signature.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `frontend/src/views/CaseDetailView.tsx` | Surface the initial case-load failure (match `refetchCase`) | **Modify** |
| `frontend/src/views/InvestigateTab.tsx` | Surface 5 silent `.catch(console.error)` sites; add `toast` import | **Modify** |
| `frontend/src/views/ResearchTab.tsx` | Surface the `fetchCaseJobs` reattach failure; rename the AOS handler | **Modify** |

No files created or deleted.

---

### Task 1: Surface the initial case-load failure (CaseDetailView)

The initial `fetchCase` on mount swallows errors to `console.error`, so a failed load leaves the header blank with no message — while its twin `refetchCase` already toasts. Make them consistent.

**Files:**
- Modify: `frontend/src/views/CaseDetailView.tsx`

**Interfaces:** none changed (internal error handling only).

- [ ] **Step 1: Locate the initial-load effect**

Find (near the top of the component, the mount effect; line numbers approximate — anchor on the code):
```tsx
  useEffect(() => {
    if (!id) return;
    fetchCase(id)
      .then(setCaseData)
      .catch(console.error)
      .finally(() => setLoadingCase(false));
  }, [id]);
```

- [ ] **Step 2: Add the user-facing toast (match `refetchCase`)**

Replace the `.catch(console.error)` line so it mirrors the existing `refetchCase` block:
```tsx
  useEffect(() => {
    if (!id) return;
    fetchCase(id)
      .then(setCaseData)
      .catch((err) => {
        console.error(err);
        toast.error("Failed to load case data.");
      })
      .finally(() => setLoadingCase(false));
  }, [id]);
```
(`toast` is already imported at the top of this file — no import change.)

- [ ] **Step 3: Type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/CaseDetailView.tsx
git commit -m "fix(frontend): surface initial case-load failure with a toast

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Surface the silent catches in InvestigateTab

Five user-relevant async actions swallow errors to `console.error` with no user feedback. Add a `toast.error` at each, and add the missing `toast` import.

**Files:**
- Modify: `frontend/src/views/InvestigateTab.tsx`

**Interfaces:** none changed.

- [ ] **Step 1: Add the `toast` import**

`InvestigateTab.tsx` does not import `toast`. Add it next to the other imports (top of file, after the existing `react`/api imports):
```tsx
import { toast } from "sonner";
```

- [ ] **Step 2: `handleRerunRules` — toast on failure**

Find:
```tsx
    } catch (err) {
      console.error("Re-run rules failed:", err);
    } finally {
      setRerunPending(false);
```
Replace the `catch` body:
```tsx
    } catch (err) {
      console.error("Re-run rules failed:", err);
      toast.error("Signal re-run failed — try again.");
    } finally {
      setRerunPending(false);
```

- [ ] **Step 3: post-Lead dashboard refresh — toast on failure**

Find (the effect that refreshes the dashboard after a Lead completes):
```tsx
        setDashboard(dash);
      })
      .catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadJob.status]);
```
Replace the `.catch`:
```tsx
        setDashboard(dash);
      })
      .catch((err) => {
        console.error(err);
        toast.error("Couldn't refresh the dashboard — reload if counts look stale.");
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadJob.status]);
```

- [ ] **Step 4: `fetchEntityDetail` (knot click) — toast on failure**

Find:
```tsx
      fetchEntityDetail(node.type, node.id)
        .then((d) => setEntityData(d as PersonDetailResponse | OrgDetailResponse))
        .catch(console.error);
```
Replace the `.catch`:
```tsx
      fetchEntityDetail(node.type, node.id)
        .then((d) => setEntityData(d as PersonDetailResponse | OrgDetailResponse))
        .catch((err) => {
          console.error(err);
          toast.error("Couldn't load knot details.");
        });
```

- [ ] **Step 5: `onAngleTiedOff` Web refresh — toast on failure**

Find:
```tsx
                onAngleTiedOff={() => fetchGraph(caseId).then(setGraph).catch(console.error)}
```
Replace:
```tsx
                onAngleTiedOff={() =>
                  fetchGraph(caseId)
                    .then(setGraph)
                    .catch((err) => {
                      console.error(err);
                      toast.error("The Web didn't refresh — reload if the graph looks stale.");
                    })
                }
```

- [ ] **Step 6: post-connect Web refresh — toast on failure**

Find (in the connect-modal create/`onConnected` handler):
```tsx
              fetchGraph(caseId).then(setGraph).catch(console.error);
```
Replace:
```tsx
              fetchGraph(caseId)
                .then(setGraph)
                .catch((err) => {
                  console.error(err);
                  toast.error("The Web didn't refresh — reload if the graph looks stale.");
                });
```

- [ ] **Step 7: Type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean (and the new `toast` import is now used, so no unused-import error).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/views/InvestigateTab.tsx
git commit -m "fix(frontend): surface InvestigateTab async failures with toasts

Re-run rules, post-Lead dashboard refresh, knot-detail load, and the two
Web-graph refreshes now toast on error instead of only console.error.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Surface the reattach-on-mount failure (ResearchTab)

The mount effect that resumes in-progress search jobs swallows fetch failures entirely (`.catch(() => {})`), so if the jobs endpoint is down at mount, a QUEUED/RUNNING search from a previous session is abandoned with no notice and the user may launch a duplicate.

**Files:**
- Modify: `frontend/src/views/ResearchTab.tsx`

**Interfaces:** none changed.

- [ ] **Step 1: Locate the reattach effect's catch**

Find (end of the reattach-on-mount `useEffect`):
```tsx
        });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);
```

- [ ] **Step 2: Surface the failure**

Replace the `.catch`:
```tsx
        });
      })
      .catch((err) => {
        console.error(err);
        toast.error("Couldn't restore in-progress searches — re-run if a search is missing.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);
```
(`toast` is already imported in this file.)

- [ ] **Step 3: Type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/ResearchTab.tsx
git commit -m "fix(frontend): surface reattach-on-mount failure for in-progress searches

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Rename the misleading AOS add-to-case handler (ResearchTab)

In `SyncResultsTable`, the AOS "Save audit note" option calls `handleCreateOrg`. That function is not org-specific — it calls `addResearchToCase(caseId, { source, data })`, and the backend routes by `source` (`ohio-aos → InvestigatorNote`, returning `created: "note"`). So the button **already** saves a note correctly; only the function name is misleading. Rename it to read honestly. **No behavior, label, key, endpoint, or outcome change.**

**Files:**
- Modify: `frontend/src/views/ResearchTab.tsx`

**Interfaces:** none changed (component-internal rename).

- [ ] **Step 1: Confirm the function is generic (read before renaming)**

In `SyncResultsTable`, confirm the body is source-routed, not org-specific:
```tsx
  async function handleCreateOrg(r: Record<string, unknown>, idx: number) {
    const result = await addResearchToCase(caseId, { source, data: r });
    const k = triageKey(source, idx, source === "ohio-aos" ? "save-note" : "create-org");
    ...
  }
```
Note it already uses `source` for both the call and the triage key — generic.

- [ ] **Step 2: Rename within `SyncResultsTable` only**

Rename `handleCreateOrg` → `handleAddToCase` at its declaration AND both call sites inside `SyncResultsTable` (the `source !== "ohio-aos"` "Create organization" option's `onSelect={() => handleCreateOrg(r, idx)}` and the `source === "ohio-aos"` "Save audit note" option's `onSelect={() => handleCreateOrg(r, idx)}`).

**Scope guard:** `IrsResultsTable` and `ParcelResults` have their OWN `handleCreateOrg`/`handleCreateProperty` — do NOT touch those. Rename only the three occurrences inside `SyncResultsTable`. After editing, grep to confirm the remaining `handleCreateOrg` hits are all inside `IrsResultsTable`:
```bash
# from repo root
grep -n "handleCreateOrg\|handleAddToCase" frontend/src/views/ResearchTab.tsx
```

- [ ] **Step 3: Type check + regression suite**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: tsc clean; suite green (the rename touches no tested unit — `ResearchTab.test.tsx` only tests `outcomeLabel`).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/ResearchTab.tsx
git commit -m "refactor(frontend): rename SyncResultsTable handleCreateOrg -> handleAddToCase

The AOS 'Save audit note' option routed through a function named handleCreateOrg,
but it is a generic add-to-case (backend routes ohio-aos -> InvestigatorNote).
Rename for honesty; no behavior change.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Out of scope (follow-up)

- **Rendering job FAILED state.** `useAsyncJob.run` already catches POST/poll errors into `status: "FAILED"` + `error` (it never rejects), so the search/Lead handlers are NOT silent failures. Whether every consumer visibly renders the FAILED state + `error` string is a separate UX audit, not part of this remediation.
- **Adopting one shared error-toast helper.** If a `utils`/`lib` layer is introduced later for other reasons, `refetchCase` and the six sites touched here could collapse onto it. Deliberately deferred — not worth a new pattern for this slice.
- **Unit-testing the view error paths.** Would require a render harness for InvestigateTab/ResearchTab (Cytoscape, many mocks). Track separately if these views get a test harness.

---

## Self-Review

**1. Coverage of the findings:**
- CaseDetailView initial `fetchCase` silent load → Task 1. ✅
- InvestigateTab `handleRerunRules` / post-Lead dashboard refresh / `fetchEntityDetail` / `onAngleTiedOff` / post-connect Web refresh → Task 2 (incl. the missing `toast` import). ✅
- ResearchTab `fetchCaseJobs` reattach `.catch(() => {})` → Task 3. ✅
- AOS "Save audit note" mislabel → Task 4 (rename only; backend confirmed behavior already correct). ✅
- `handleRunLead` / search handlers → correctly EXCLUDED (errors land in `useAsyncJob` state; not silent). ✅

**2. Placeholder scan:** every step shows the exact before/after code; no "add appropriate handling" hand-waving. ✅

**3. Pattern consistency:** all six toast additions follow the `refetchCase` precedent (`console.error` retained + `toast.error`); no new helper/dir; toast copy uses approved vocabulary; `toast` import added only where missing (InvestigateTab). ✅

**4. Risk:** Task 4 is a pure rename scoped to `SyncResultsTable` with a grep guard against touching the other tables' identically-named handlers. Tasks 1–3 are additive error-surfacing that cannot change success-path behavior. ✅

**Runtime verification (verify skill) — required after all tasks:** run the app (Docker stack or Vite); force each failure and confirm the toast: (1) load a case with the API down → "Failed to load case data."; (2) trigger re-run rules / knot click / tie-off / connect with the relevant endpoint failing → the matching toasts; (3) reload Research with the jobs endpoint failing → "Couldn't restore in-progress searches…"; (4) AOS "Save audit note" still saves a note and shows "Saved as note" (Task 4 unchanged behavior). If any toast doesn't fire, that catch was missed.
