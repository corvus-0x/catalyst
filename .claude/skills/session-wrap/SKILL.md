---
name: session-wrap
description: End-of-session doc reconciliation for Catalyst. Use at the end of a working session, or when the user says "wrap up", "update the docs", "session wrap", "close out", or before pushing final work. Reviews what actually changed this session, captures the reasoning behind key decisions, and updates STATUS.md, the wiring matrix, CLAUDE.md, the briefing books, and memory files so the docs never drift from the code.
---

# Catalyst — Session Wrap

Keep Catalyst's docs honest at the end of every working session. STATUS.md once
described a 7-tab D3 app for a month after the graph-first rebuild shipped — this
skill exists so that drift can't happen silently again.

**Core rule: update from evidence, never from memory.** Diff the code, then make
the docs match what the diff shows. Do not write a status line you haven't verified
against the actual files.

**Run before any `/clear`.** The conversation holds the *why* behind decisions
made this session. Once context is cleared, that reasoning is gone even if the
code is still there. Git has what was built. The conversation had why that way
instead of another way.

---

## Step 1 — See what actually changed

Establish ground truth for this session before editing any doc:

```bash
# Commits made this session + uncommitted work
git log --oneline -15
git status --short
git diff --stat HEAD~5   # widen the range if the session was long
```

Note specifically whether any of these changed — they drive the wiring audit:
- `backend/investigations/urls.py` (endpoints added/removed)
- `frontend/src/api/` (client functions added/removed)
- `frontend/src/views/` or `frontend/src/components/` (UI callers added/removed)
- `frontend/src/App.tsx` (routes)
- `backend/investigations/models.py` (models added/changed — drives migration check)

---

## Step 2 — Capture the why (before context is cleared)

Git records what shipped. This step records why. Do not skip it — this is where
Tyler's learning context lives, and it's gone after `/clear`.

For each meaningful decision or change this session, ask:
- Why was this built now and not later?
- What constraint or discovery drove the approach?
- What alternative was considered and rejected?
- What was surprising or non-obvious?

If a decision is unclear, ask Tyler before proceeding: *"What was the reasoning
behind [specific choice]?"*

Write a short session log entry in `STATUS.md`'s History section (Step 4 below)
that captures this reasoning — not just what landed, but why that way.

---

## Step 3 — Re-run the wiring audit (only if the seam changed)

If `urls.py`, `frontend/src/api/`, or the views/components changed, regenerate the
endpoint→client→UI map and reconcile `docs/architecture/wiring-matrix.md`:

```bash
cd frontend/src
for fn in $(grep -oE '^\s+[a-zA-Z0-9]+,' api/index.ts | tr -d ' ,'); do
  files=$(grep -rl --include="*.tsx" --include="*.ts" --exclude-dir=api "\b$fn\b" . | sed 's|^\./||' | tr '\n' ',')
  printf "%-26s | %s\n" "$fn" "${files:-NONE}"
done
```

- Any function printing `NONE` is a **dead end** — add/move it in the matrix's §3
  tables and the §4 triage punch list (classify: wire up / decide & delete /
  deferred).
- Any function that gained its first caller this session moves from ⚠️ to ✅.
- Also scan `urls.py` paths for endpoints with **no** client function in
  `api/index.ts` (the other direction of the seam).
- Bump the matrix's "Last updated" date.

Read the matrix's own §5 if the recipe above needs adjusting — it is the source of
truth for how to regenerate.

---

## Step 4 — Update STATUS.md

Follow the "Keeping this file honest" checklist at the bottom of STATUS.md:

1. **"Working" table** — move any capability that newly works end-to-end into it;
   correct any row whose description no longer matches the code (tabs, libraries,
   routes, button locations).
2. **"Not yet wired" table** — remove rows that got wired this session; add any new
   backend-ahead-of-frontend gaps the audit surfaced.
3. **History** — add a `**Recently completed (Session N, <Mon D YYYY>):**` block at
   the **top** of the history (newest first). N = previous top session number + 1.
   Use the date from the environment context, not a guess. Include both *what* landed
   and *why* that approach (from Step 2). Mark superseded older entries rather than
   deleting them.
4. **"Known issues"** — add/remove as appropriate. If a migration was added, note it
   here: migration ID + one-line description of the DDL it installs.
5. **Bump the "Last updated" line** at the very top to today's date + session label.

---

## Step 5 — Check CLAUDE.md for drift

CLAUDE.md is the system map and is read first by every session, so a wrong claim
there is costly. Spot-check only the sections touched this session:
- PROJECT STRUCTURE (new/removed files)
- CONNECTOR WIRING STATUS table
- FRONTEND VIEWS / VOCABULARY (routes, tab count, terminology)
- API ENDPOINTS pointer

Fix only what the session's diff proves is now wrong. Don't rewrite for style.

---

## Step 6 — Check the authoritative architecture docs for drift

These two files are called out in CLAUDE.md as authoritative and are read by every
frontend session. A stale claim here is high-cost.

**Only update if the session's diff proves a specific claim is now wrong:**

- **`docs/architecture/api-contract.md`** — check if any endpoint's JSON shape
  changed: new fields, renamed fields, changed types, new async-vs-sync behavior.
- **`docs/architecture/frontend-design-spec.md`** — check if any tab layout, node/
  edge encoding, interaction model, or the 21-step build sequence changed.

Do not rewrite for completeness. Fix the specific claim the diff broke.

---

## Step 7 — Check the briefing books for drift

The `docs/team/` briefing books are read by specialists at session start. Stale
entries mislead future sessions. Check only the book(s) relevant to what changed:

- **`docs/team/backend-engineer.md`** — if models, signal rules, or the extraction
  pipeline changed
- **`docs/team/data-engineer.md`** — if the extraction/resolution/normalization
  pipeline changed
- **`docs/team/irs-domain-expert.md`** — if the 990 parser or IRS connector changed
- **`docs/team/qa-engineer.md`** — if test counts or known bug patterns changed

Same rule: fix only what the diff proves is wrong.

---

## Step 8 — Update memory files (if warranted)

Memory files in the active Claude project memory directory
(e.g. `%USERPROFILE%\.claude\projects\<project-name>\memory\` on Windows,
`~/.claude/projects/<project-name>/memory/` on macOS/Linux)
persist across sessions. Update them if this session surfaced:

- **New feedback** — Tyler corrected an approach, confirmed an unusual choice, or
  gave explicit guidance about how to work. Save to a `feedback_*.md` file.
- **New project state** — a decision was made that future sessions need to know
  about (scope change, deferred work, new constraint). Update
  `project_catalyst_status.md`.
- **New environment fact** — something about how to run, test, or deploy Catalyst
  that isn't obvious from the code.

Do not save ephemeral task details, code patterns, or things already in git history.
If nothing memory-worthy happened, skip this step.

---

## Step 9 — Commit & push

Keep doc updates in their own commit, separate from code:

```bash
git add STATUS.md docs/architecture/wiring-matrix.md CLAUDE.md
# Add any briefing books or architecture docs that changed:
# git add docs/architecture/api-contract.md docs/architecture/frontend-design-spec.md
# git add docs/team/backend-engineer.md
git commit -m "docs: session wrap — <one-line summary of what changed>"
```

Then push. Do **not** open a PR unless asked.

---

## Guardrails

- **Evidence over memory.** Every status change must trace to a file you read or a
  command you ran this session.
- **Why is not optional.** If the session involved a meaningful decision, the history
  entry must explain the reasoning — not just list what shipped.
- **Don't invent metrics.** Don't bump test counts, bundle sizes, or timings unless
  you actually measured them this session — carry forward the prior value otherwise.
- **Honesty is the feature.** A "Not yet wired" row is more valuable to a recruiter
  than a fake ✅. Never paper over a dead end.
- **Preserve history.** Mark old session entries as superseded; don't delete the
  narrative.
- **Don't over-update.** Only touch files where the diff proves something is now
  wrong. Touching everything "just in case" degrades the signal.
