# Tie-Off Gate + Credibility Counts — Design (case-workspace build item 2)

**Status:** Design (approved, pre-plan). Implements build-sequence **item 2** of
`docs/architecture/case-workspace-design.md` — Angle lifecycle + the tie-off gate (§4) and the
credibility counts header (§5).
**Date:** 2026-06-18
**Owner:** Tyler Collins
**Predecessor:** item 1 (shared state + feeders, PR #10, merged + verified live).

> Read alongside `docs/architecture/case-workspace-design.md` (§4, §5, §7) and
> `docs/architecture/api-contract.md`. This spec governs the tie-off gate and credibility
> header once built; update those docs section-by-section as pieces land.

---

## 1. Goal

Turn "CONFIRMED" from a free-text status into an **enforced, evidentiary gate**, and replace the
workspace's `score / 100` headline with the **credibility triplet**
(`N referral-grade · M need work · K agency leads`).

"Referral-grade" — the only definition of "done" — is an Angle (Finding) that is:

```
CONFIRMED  ∧  ≥1 cited document  ∧  evidence_weight ∈ {DOCUMENTED, TRACED}
           ∧  narrative present  ∧  overreach_reviewed == True
```

## 2. Current state (what already exists)

- `Finding.status` (NEW/NEEDS_EVIDENCE/CONFIRMED/DISMISSED) and `evidence_weight`
  (SPECULATIVE/DIRECTIONAL/DOCUMENTED/TRACED) already exist (`models.py`).
- `FindingUpdateSerializer` (`serializers.py:850`) enforces a **dismissal rationale** but
  enforces **nothing** on the transition to CONFIRMED — today an Angle can be confirmed with
  SPECULATIVE weight, zero citations, and an empty narrative.
- `TieOffModal.tsx` already exists as a **form** (weight + outcome + rule). `handleConfirm`
  (line 117) sends `status + evidence_weight + investigator_note` only — no overreach, no
  inline citation. It performs **no precondition checks**.
- `build_case_readiness` (`views.py:2271`) already computes `confirmed_count`, `eligible_count`
  (DOCUMENTED/TRACED), and `uncited_count`, and a `quality.score/100`.
- `InvestigateTab.tsx` renders `CaseQualityPanel` with `{quality.score} / 100` (line 292) — the
  exact "get-it-to-100-then-refer" psychology §5 rejects.

So this is **extend + replace in known files + one migration**, not a greenfield build.

## 3. Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| Overreach | stored field vs frontend-only | **Stored** `overreach_reviewed` boolean — full server-side gate |
| Header K (agency leads) | how to handle the 3rd count | **Header-ready now**; component accepts optional count; wired to RecipientGap in item 4 (K=0 for now) |
| Existing confirmed angles | grandfather vs force re-tie-off | **No silent grandfathering** — no data migration flips the bit |
| Demo seed | how `seed_demo` behaves | **A mix** — some angles fully tied off (referral-grade), some left need-work |
| Gate location | where enforced | **`FindingUpdateSerializer`** (server is the gate); frontend previews only |
| Provenance / PDF | who/when tied off | **AuditLog at PDF-render time**; no denormalized `_by`/`_at` columns |
| Condition loss | confirmed angle later loses a condition | **Allow, recount as need-work** (non-blocking); also drops from PDF |

## 4. Security posture (invariant)

**The server is the sole decision-maker and the sole writer of state and `AuditLog`. The
frontend is display + a non-authoritative preview.**

- The frontend never decides what gets stored. It computes "the server will reject this" only to
  disable the Confirm button and show *what's missing*. A raw-API bypass hits the same gate and
  gets the same 400 — identical outcome.
- Only the server writes `AuditLog`, only on a **successful** gated transition, inside the
  existing `transaction.atomic()` (confirm + audit row commit together or not at all). A
  tampered/buggy client cannot fabricate a referral-grade angle — worst case a wrong *preview*
  and a 400.
- Error responses name the **unmet condition keys** only; they do not echo record contents
  (info-leak discipline).

## 5. Data model

Add one column to `Finding`:

```python
overreach_reviewed = models.BooleanField(default=False)
```

- The stored 4th gate input.
- One migration, `default=False`, **no backfill** (honors "no grandfathering").
- Tie-off attribution (who/when) is **not** denormalized — it lives in the `SIGNAL_CONFIRMED`
  `AuditLog` row the server writes on confirm. The referral PDF queries the latest such row per
  confirmed angle at render time.

## 6. The gate (backend enforcement)

In `FindingUpdateSerializer.is_valid()`, add a guard that fires **only when the payload
transitions status to CONFIRMED** (`new_status == CONFIRMED`).

- **Evaluate against the *post-PATCH* state**, not the stored row. A single tie-off PATCH
  typically sets weight + narrative + `add_document_ids` + `overreach_reviewed` at once; the
  guard must check what the row *will be* after the payload applies (the serializer already
  stages `_documents_to_add` / `_documents_to_remove`, so the post-state is computable before the
  write). This is the core reason the gate belongs in the serializer, not a separate endpoint.
- **Collect all unmet conditions**, not the first failure — tie-off is a checklist; four
  sequential round-trips to discover four gaps is exactly the silent friction to avoid.
- **Error shape:** `400 {"gate": {"unmet": ["citation", "evidence_weight", "narrative",
  "overreach"]}}` — condition keys only.
- **Idempotent re-confirm:** re-PATCHing an already-CONFIRMED angle that still meets the gate is
  a no-op success, not a 400.
- **"Narrative present"** means the post-PATCH `narrative` is non-empty after `.strip()`. No
  minimum length is imposed (YAGNI — the overreach checklist, not a character count, is the
  quality control).
- **Condition loss is allowed:** a PATCH that strips a confirmed angle below the predicate
  (removes last citation, downgrades weight) succeeds; the angle stays `status=CONFIRMED` but the
  computed predicate now fails, so it recounts as need-work and drops from the PDF. No block.

## 7. The predicate (one definition, three call sites)

Define `is_referral_grade(finding)` (and/or an equivalent queryset annotation) **once**. Use it in:

1. the `referral_grade` header count,
2. the `need_work` header count (`status∈{NEW,NEEDS_EVIDENCE}` OR `CONFIRMED ∧ ¬predicate`;
   excludes DISMISSED),
3. **the referral PDF inclusion filter** (replacing today's `confirmed ∧ DOCUMENTED/TRACED`).

> Aligning the PDF filter is what makes the gate *real*. Without it, a confirmed angle with
> `overreach_reviewed=False` (e.g. every existing one, post "no-grandfathering") would still
> export — the customer-facing package would contradict the gate.

Prefer a queryset annotation so all three call sites share one `.filter()` (O(1) queries) and the
definition lives in exactly one place.

## 8. Credibility counts (API)

Add a helper `build_credibility(case)` returning:

```
credibility = {
  "referral_grade": <count satisfying the predicate>,
  "need_work":      <count of NEW/NEEDS_EVIDENCE OR (CONFIRMED ∧ ¬predicate)>,
  "agency_leads":   0,   # slot reserved; wired to open RecipientGap count in item 4
}
```

- Rides on the **existing** dashboard/readiness payload `InvestigateTab` already fetches, added
  alongside `quality`.
- `quality.score` **stays in the API** (dashboard still uses it). Only the **workspace** stops
  surfacing `/100`, per §5 — same data, different framing.

## 9. Frontend (display + non-authoritative preview)

- **Replace** `CaseQualityPanel`'s `{score}/100` headline with the triplet:
  `● N referral-grade · ◐ M need work · ◷ K agency leads`. The third segment reads
  `credibility.agency_leads` (0 now), so item 4 lights it up with **no markup change**.
- **Harden `TieOffModal`** into the gate's display layer:
  - Add the **overreach checklist** — the three §7.2 statements — as a required acknowledgement
    that sets `overreach_reviewed: true` in the PATCH body.
  - Send `overreach_reviewed` (and `add_document_ids` when citing inline) in `handleConfirm`
    (today it sends neither — required for confirms to pass the new gate).
  - **Preview, don't decide:** disable Confirm and list unmet conditions by reading the same
    conditions locally; the server stays authoritative. If the preview is stale/wrong, render the
    400's `gate.unmet` as fallback truth.

## 10. Seed + tests

- **`seed_demo`:** author a **mix** — some angles fully tied off (`overreach_reviewed=True`,
  cited, DOCUMENTED/TRACED → referral-grade) and some left need-work — so the public Railway demo
  shows a realistic in-progress case.
- **Tests (backend suite — Railway/Docker per CLAUDE.md):**
  - gate rejects each missing condition individually;
  - gate accepts when all four met in one post-PATCH payload;
  - idempotent re-confirm;
  - condition-loss recounts (not blocked);
  - credibility triplet math;
  - PDF filter excludes overreach-unreviewed confirmed angles.

## 11. Deployment coupling (atomic PR)

The **migration + serializer gate + TieOffModal change ship as one atomic PR**, merged in one
commit. Splitting breaks confirms in production (Catalyst deploys `main` → Railway directly):

- backend-first → the modal never sends `overreach_reviewed`, so every confirm 400s in the gap;
- frontend-first → the column doesn't exist, so the PATCH sends an unknown field and errors.

There is no safe split order. (An expand/contract three-PR sequence would avoid mid-deploy
breakage for a multi-user system, but buys nothing for this single-dev, single-demo repo with an
instant deploy.)

## 12. Out of scope (defer)

- `RecipientGap` model and the real `agency_leads` count → **item 4**.
- Dismissed opt-in package appendix, dismissal "kind" (`ruled_out` / `correction`) → item 4.
- Context-panel three-state + idle "what's missing" → item 3.
- Connectedness warning (WS-GAP-1) → item 5.
- Whether `overreach_reviewed` later enables connectedness graduating warning→gate → deferred (§13).
