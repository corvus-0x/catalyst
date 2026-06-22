# Case Map Phase 4 — Thread Builder (structured assertions)

**Date:** 2026-06-22 (rev. 2026-06-22 — pivoted to the Assertion model after a product-owner
pressure-test; supersedes the earlier 5-type FACT/INFERENCE/QUESTION/CLAIM design in this file's
history)
**Status:** **READY TO PLAN** — design + product-friction review complete. Load-bearing decisions
locked (Assertion model, evidence-dictates-role, per-element citations, full-width layout,
elements-replace-narrative, softened two-tier gate, `gate_version` grandfathering, AI-assist as a
committed assist-only slice).
**Scope:** Replace the freeform `AngleView` narrative editor with a structured **Thread Builder**
backed by typed evidentiary **assertions** with per-assertion citations, and make that structure
*load-bearing* by strengthening the referral-grade gate — **without** taxing the investigator with an
upfront classification chore.

> ### Slices (renamed for deployment safety — see §11)
> - **4A-additive** — backend model + API + migration + seed; **changes no existing behavior** (safe
>   on `main`/demo alone). Gate predicate helpers exist but are **unwired**.
> - **4B-gate-and-builder** — the `ThreadBuilder` UI **and** the softened two-tier gate flip
>   (`gate_version`-aware), in one deploy unit.
> - **4C-export** — referral PDF renders structured assertions by derived role.
> - **4D-assist** — AI-assisted structuring (committed, post-4B): proposes assertions/citations from
>   freeform text for human confirmation. **Assist-only; never touches the gate.**
>
> **Deployment-sequencing invariant (load-bearing):** the gate flip must not reach `main` before 4B —
> today's `AngleView` cannot author cited assertions, so a gate flip ahead of the UI would make the
> live tool unable to confirm new threads. 4A ships helpers unwired; 4B wires them.

> ### Relationship to other specs
> - **Implements Phase 4** of `2026-06-19-case-map-and-thread-builder-design.md` (controlling plan),
>   §7 "Thread Builder Direction" + §11 "Phase 4". **Departs** from that section's literal
>   Fact/Inference/Question/Claim list: see §2 for why the taxonomy collapsed to assertions.
> - **Builds on Phase 2/3.** The focus reducer, `selection.kind === "thread"`, `ThreadInspector`
>   ("Open full Thread" → `openThread` → `frame.kind === "angle"`), the Thread Dock, and Thread Path
>   Mode all exist. Phase 4 changes *what the `angle` frame renders* — no reducer/dock/path changes.
> - **Aligns the tie-off gate.** Extends `referral_grade.py` and the `FindingUpdateSerializer` tie-off
>   gate from `2026-06-18-tie-off-gate-and-credibility-design.md`, adding `gate_version` awareness.
> - **No `/case-map/` contract change.** `handoff_ready` / `handoff_included` / `material` already
>   derive from the referral-grade predicate; strengthening it flows through (once 4B flips).

---

## 1. Purpose — what Phase 4 completes

`AngleView` today is one freeform `narrative` textarea plus a flat cited-docs list, with `[Doc-N]`
tokens regex-scraped from prose (`citationRefs()`). That is "nicer note-taking," not defensible
structure. The professional who receives the handoff (AG/IRS/FBI, subpoena power) needs the
investigator's **cited observations** cleanly separated from their **uncited reasoning** and their
**headline accusation** — that separation is the credibility firewall (CLAUDE.md
`project_banned_strings_rationale`).

Phase 4 delivers that separation **without forcing the investigator to pre-classify every thought.**
A thread becomes an ordered list of **assertions** whose *role is dictated by evidence*, not chosen
from a dropdown:

| What the investigator does | How the system + export read it |
|---|---|
| writes an assertion, attaches a source | **Documented fact** (cited) |
| writes an assertion, no source (yet) | **Analysis / inference** (uncited) |
| flags an assertion `handoff_ready` | **Claim** — the accusation handed off |
| writes a `QUESTION` | an open gap (subpoena/interview territory) |
| (migration) old narrative | a subordinate **`NOTE`** (context, never gates) |

The same documented payment can be **both** a cited fact **and** the headline claim — one assertion,
cited + `handoff_ready` — which is how real investigations work. The PDF (4C) still renders the three
roles in order; the structure is preserved while the *authoring tax* is removed.

The redesign's "one job per surface" principle holds: the **map** is the overview (Thread Dock +
Thread Path Mode answer "where does this thread live" before you open it); the **Thread Builder** is
the full-width detail surface where a thread is made defensible.

## 2. Why the taxonomy collapsed (the product-friction pivot)

The controlling plan's §7 named four explicit element types (Fact / Inference / Question / Claim) with
mandatory fact→claim backing. A product-owner pressure-test found that design optimizes the **reader**
at the **author's** expense — contradicting CLAUDE.md's "make Catalyst useful for actual investigation
work" and "first 70% is 100%." Three failures drove the pivot:

1. **Taxonomy paralysis.** "The charity paid $500k to an LLC owned by a board member's brother" is
   simultaneously a documented fact *and* the core accusation. A 4-type model forces it to exist as
   two near-identical elements (a FACT and a CLAIM) to satisfy "complete." Pure data-entry tax.
2. **Graph-in-a-graph.** Mandatory `supported_by` wiring makes the investigator do software
   engineering; in practice they link everything to turn the gate green — making the backing data
   worthless ("green theater").
3. **Hostile migration.** Flipping a strict gate retroactively demotes yesterday's referral-grade
   work to "needs claim." Burns trust.

**Resolution (locked):** collapse to a single **`ASSERTION`** whose role is derived from evidence;
keep `QUESTION` and `NOTE`; drop the mandatory backing graph (optional backing + edge-`rationale`
returns as a Phase-5 power feature, answering the "reasoning on the edge" / cell-tower case then);
grandfather existing work via `gate_version`. AI-assisted structuring is elevated to a committed
slice (4D) **but kept assist-only** — it must never decide what counts as a cited fact (credibility
firewall) or drive referral-readiness (determinism).

## 3. Locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Structure | New backend structured records (assertions), not freeform-only, not JSON-on-Finding. |
| 2 | Taxonomy | **`ASSERTION` · `QUESTION` · `NOTE`** (3); role derived from evidence + `handoff_ready` flag. |
| 3 | Evidence binding | **Per-assertion citations** (`ASSERTION` only). |
| 4 | Backing graph | **None in v1.** Optional `supported_by` + edge `rationale` → Phase 5. |
| 5 | Layout | Full-width Thread Builder (`frame.kind === "angle"` stays); map is the overview. |
| 6 | Narrative | Assertions replace it; legacy narrative migrates to a `NOTE`. |
| 7 | Gate | Softened two-tier, **`gate_version`-aware** (§5). Wired in 4B. |
| 8 | Grandfather | `Finding.gate_version` enum; currently-referral-grade findings → `LEGACY_NARRATIVE`. |
| 9 | AI | Committed assist-only slice (4D); never gates, never auto-classifies as authoritative. |
| 10 | PDF | 4C — separate but committed (definition of done). |

## 4. Data model (Phase 4A-additive)

Two new tables + two new `Finding`-area fields, following existing `Finding*` conventions
(`UUIDPrimaryKeyModel`, `related_name`, explicit `db_table`, indexes, the
`page_reference`/`context_note` citation shape on `FindingDocument`).

### `ThreadElement` — `db_table = "thread_element"`

| Field | Type | Notes |
|---|---|---|
| `finding` | FK → Finding, `related_name="elements"`, CASCADE | the thread |
| `element_type` | TextChoices: `ASSERTION` · `QUESTION` · `NOTE` | `NOTE` = migration/context bucket, never gates |
| `text` | TextField | content |
| `position` | PositiveIntegerField | order within thread |
| `handoff_ready` | BooleanField, default False | meaningful only on `ASSERTION` (the "claim" flag) |
| `created_at` / `updated_at` | DateTimeField | |

**No `supported_by` M2M in v1** (decision #4). **Meta:** `ordering = ["position"]`; index on
`(finding, position)`; `unique(finding, position)`.

**Derived role (render-time, not stored)** — `serialize_element` exposes a `role` for the
frontend/PDF:
- `ASSERTION` + ≥1 citation → `"fact"`
- `ASSERTION` + `handoff_ready` → `"claim"` (a cited+handoff_ready assertion is both; PDF lists it in
  both the facts and the claims sections, or flags it as a "documented claim")
- `ASSERTION`, uncited, not handoff_ready → `"analysis"`
- `QUESTION` → `"question"`; `NOTE` → `"note"`

### `ThreadElementCitation` — `db_table = "thread_element_citation"`

| Field | Type | Notes |
|---|---|---|
| `element` | FK → ThreadElement, `related_name="citations"`, CASCADE | |
| `document` | FK → Document, `related_name="element_citations"`, CASCADE | |
| `page_reference` | CharField(blank) | mirrors `FindingDocument` |
| `context_note` | TextField(blank) | the excerpt |

**Citations attach to `ASSERTION` only.** The serializer/endpoint reject a citation whose target is a
`QUESTION` or `NOTE`.

**Same-case guard (required):** `document.case_id == element.finding.case_id`. Authoritative in the
**serializer** (only write path); model `clean()` is defense-in-depth for `full_clean()` callers — note
Django does **not** call `clean()` on `save()` and there is **no DB constraint** across this join, so
the serializer check + tests guarantee it.

**Meta:** `unique(element, document, page_reference)`.

### `Finding.gate_version` (new field)

`CharField` TextChoices: `LEGACY_NARRATIVE` · `ASSERTION_V1`, **default `ASSERTION_V1`** (so every new
thread uses the new gate). The migration (§6) stamps `LEGACY_NARRATIVE` on findings that are
referral-grade under the *old* predicate, preserving their status. `referral_grade` reads this to pick
which gate applies (§5).

### `FindingDocument.is_legacy` (new field)

`BooleanField(default=False)`. `True` for compatibility-index rows not authored via
`ThreadElementCitation` (pre-Phase-4 citations + the legacy `add_document_ids` path). Never reaped.

### Completeness helpers (the predicates 4B's gate uses; built unwired in 4A)

- `assertion_is_cited(element)` = `element_type == ASSERTION ∧ text ∧ ≥1 citation`
- `finding_has_cited_assertion(finding)` = any assertion is cited
- `finding_has_handoff_ready_assertion(finding)` = any `ASSERTION` with `handoff_ready ∧ text`

No recursive claim/fact backing — the softened gate checks thread-level presence, not per-claim wiring.

### Invariants (serializer-enforced; tests in §7)

1. `handoff_ready = true` rejected unless the element is an `ASSERTION` with non-empty text. (No
   backing requirement at *set* time — the referral-grade gate checks thread-level evidence.)
2. Citations attach to `ASSERTION` only.
3. `element_type` change is conservative: changing an `ASSERTION` with citations to `QUESTION`/`NOTE`
   is rejected until its citations are removed; clearing `handoff_ready` is required before a type
   change off `ASSERTION`.
4. `DELETE element` cleanup: delete its citations → resync `FindingDocument` (§4). (No `supported_by`
   to unwire in v1.)

There are no DB-level constraints expressing these; each has a test in §7.

## 5. `document_links` as a synced compatibility citation index

**Source-of-truth framing (keep in the plan):** `ThreadElementCitation` is the **source of truth**.
`Finding.document_links` (`FindingDocument`) is the **compatibility citation index** —
denormalized/export-compat + legacy-preservation — **not** a place to author citations.

- `document_links` = union of element-citation documents (non-legacy) ∪ preserved legacy rows.
- Adding an element citation ensures a `FindingDocument(is_legacy=False)` exists.
- Removing an element citation reaps the `FindingDocument` row **only if** no other element cites that
  document **and** it is not `is_legacy=True`.
- The old finding-level path (`add_document_ids` / `remove_document_ids` in `FindingUpdateSerializer`)
  stays for the current UI but is **demoted**: rows it creates are `is_legacy=True`. Authoritative
  citations come only through `ThreadElementCitation`.

## 6. Softened two-tier gate (wired in 4B, NOT 4A)

> **Sequencing:** the helpers (§4) + their unit tests are built in **4A-additive, unwired**. The flip
> — editing `FindingUpdateSerializer` and `referral_grade.py` — ships in **4B** atomically with the
> editor. The design below is the binding target for that wiring.

Two enforcement points, both now `gate_version`-aware. The strengthening preserves the **"Substantiated
but not yet handoff-ready"** middle state the rest of the app relies on.

### Tier 1 — CONFIRMED tie-off gate (`FindingUpdateSerializer`)

Fires only on the transition into CONFIRMED (condition loss after tie-off remains allowed).

> **`ASSERTION_V1` CONFIRMED requires:** ≥1 **cited assertion** ∧ `evidence_weight ∈
> {DOCUMENTED, TRACED}` ∧ `overreach_reviewed`. (Replaces the dead `post_narrative` check.)

New threads are always `ASSERTION_V1` (the field default), so new tie-offs always use this rule.
`LEGACY_NARRATIVE` threads are pre-launch and already past tie-off; the gate does not re-fire on edit.

### Tier 2 — Referral-grade (`referral_grade.py`, dual-version)

> **`ASSERTION_V1` referral-grade:** CONFIRMED ∧ weight ∈ {DOCUMENTED, TRACED} ∧ `overreach_reviewed`
> ∧ ≥1 cited document ∧ **≥1 `handoff_ready` assertion** ∧ **≥1 cited assertion** (a
> cited + `handoff_ready` assertion satisfies both with one element).
>
> **`LEGACY_NARRATIVE` referral-grade:** the **old** predicate unchanged — CONFIRMED ∧ weight ∧
> `overreach_reviewed` ∧ ≥1 cited document. (Grandfathered; never demoted.)

Both `is_referral_grade(finding)` and `referral_grade_qs(case)` branch on `gate_version` and must
agree (parity test, §7). Queryset shape:

```python
from django.db.models import Count, Exists, OuterRef, Q
from .models import Finding, FindingStatus, ThreadElement, GateVersion

def referral_grade_qs(case):
    cited_assertion = ThreadElement.objects.filter(
        finding=OuterRef("pk"), element_type="ASSERTION", citations__isnull=False
    )
    handoff_assertion = ThreadElement.objects.filter(
        finding=OuterRef("pk"), element_type="ASSERTION", handoff_ready=True
    )
    base = (
        Finding.objects.filter(
            case=case, status=FindingStatus.CONFIRMED,
            evidence_weight__in=REFERRAL_WEIGHTS, overreach_reviewed=True,
        )
        .annotate(_cc=Count("document_links")).filter(_cc__gt=0)
    )
    return base.filter(
        Q(gate_version=GateVersion.LEGACY_NARRATIVE)
        | (
            Q(gate_version=GateVersion.ASSERTION_V1)
            & Exists(cited_assertion) & Exists(handoff_assertion)
        )
    )
```

**Flows through for free:** `/case-map/` `handoff_ready` / `handoff_included` / `material` derive from
this predicate — no contract change; edges get stricter for `ASSERTION_V1` threads once 4B flips.

## 7. Migration + grandfathering (Phase 4A-additive)

Schema + data migration:

1. Add `element_type` choices (`ASSERTION`/`QUESTION`/`NOTE`); add `Finding.gate_version`
   (default `ASSERTION_V1`); add `FindingDocument.is_legacy`.
2. **Grandfather:** for each pre-existing Finding that **is referral-grade under the OLD predicate**
   (evaluated now, while the old predicate is still in force in 4A), set
   `gate_version = LEGACY_NARRATIVE`. All other findings keep the default `ASSERTION_V1`.
3. For each Finding with non-empty `narrative` → create one `NOTE` element. **Idempotent +
   collision-safe:** insert at the **next free position** (`max(position)+1`, or `0` if none); skip
   if an equivalent `NOTE` already exists. **Leave `Finding.narrative` in place** (the legacy PDF
   reads it until 4C).
4. Flag all existing `FindingDocument` rows `is_legacy=True`.

**Consequence — and it only bites for `ASSERTION_V1` threads once 4B flips.** In 4A-additive the gate
is unchanged, so nothing drops out on the 4A deploy. After 4B:
- `LEGACY_NARRATIVE` threads keep referral-grade under the old predicate — **never demoted**.
- A pre-launch thread that was *not* referral-grade stays `ASSERTION_V1`; to become referral-grade it
  needs cited assertions + a handoff_ready assertion (its old narrative is now a `NOTE`).

**UI affordance (4B):** `LEGACY_NARRATIVE` threads show a non-blocking prompt — *"Legacy narrative
format. Convert to structured assertions when you next edit."* Export is **never blocked** for them.

**Demo:** `seed_demo` (in 4A) builds real assertions (a cited assertion + a `handoff_ready` assertion)
so the demo is referral-grade-shaped under `ASSERTION_V1`, **and** retains its `narrative` + legacy
`FindingDocument` rows so the pre-4C PDF still renders.

## 8. API surface + test plan (Phase 4A-additive)

### Endpoints (nested under the thread; finding detail embeds `elements[]`)

- `GET / POST  …/findings/:fid/elements/` — create `{element_type, text}`
- `PATCH / DELETE  …/elements/:eid/` — edit `{text, element_type?, handoff_ready?}`
- `POST  …/elements/reorder/` — `{ordered_ids: […]}`; atomic two-phase rewrite (the
  `unique(finding, position)` constraint forbids transient collisions)
- `POST  …/elements/:eid/citations/` — `{document_id, page_reference, context_note}`; **rejects a
  non-ASSERTION target and a cross-case document**
- `DELETE  …/citations/:cid/` — runs the §5 sync/deletion rule

`serialize_finding` (`fetchAngle`) gains `elements: [...]` with nested `citations` and derived `role`.

### Backend tests (TDD — red first)

**4A-additive (behavior-preserving):**
- **Completeness helpers** (unwired): `assertion_is_cited`; `finding_has_cited_assertion`;
  `finding_has_handoff_ready_assertion`; QUESTION/NOTE never cited/handoff.
- **Citation ASSERTION-only**; **same-case guard** (serializer + a `full_clean()` defense test).
- **`handoff_ready` rejection** on non-ASSERTION / empty-text; **`element_type`-change** constraints.
- **Deletion sync**; **`add_document_ids` → `is_legacy=True`**; **`document_links` union**.
- **Reorder** atomicity under `unique(finding, position)`.
- **Migration:** narrative → NOTE (idempotent, next free position, narrative retained);
  `FindingDocument` flagged legacy; **`gate_version` stamping** — a finding referral-grade under the
  old predicate becomes `LEGACY_NARRATIVE`, others `ASSERTION_V1`.
- **Regression sweep:** full existing suite green **untouched** (4A changes no gate).

**4B-gate-and-builder (with the flip):**
- **Tier-1** `ASSERTION_V1` CONFIRMED blocked without a cited assertion; allowed with one; no re-gate
  on edit; update existing `test_tie_off_gate` fixtures.
- **Tier-2 dual-version:** `ASSERTION_V1` needs cited + handoff_ready assertion; `LEGACY_NARRATIVE`
  passes under the old predicate; a stamped legacy thread stays referral-grade after the flip.
- **Parity test:** `is_referral_grade(f)` ⇔ `f in referral_grade_qs(f.case)` across a matrix covering
  both `gate_version` values.

Backend tests run on Railway (Postgres + ArrayField); CI-equivalent via the Docker stack.

## 9. Frontend Thread Builder (Phase 4B)

`ThreadBuilder.tsx` replaces `AngleView` as the full-width frame (`frame.kind === "angle"` stays;
`openThread` routing untouched; `ThreadInspector`'s "Open full Thread" still routes here).

- **Header:** title, status/severity/weight badges, back-to-map, a **two-tier readiness line**
  ("Substantiated ✓ · Referral-grade: add a handoff-ready claim"), and — for `LEGACY_NARRATIVE`
  threads — the non-blocking **convert prompt** (§7).
- **Body:** ordered list of **assertion cards**. An assertion shows its **derived role** as a quiet
  badge (Fact when cited / Analysis when not / Claim when handoff_ready), inline `text` edit,
  per-assertion citation chips (reuse `CiteDocumentPicker`, element-scoped), and a **`handoff_ready`
  toggle** (enabled on any non-empty assertion; the readiness line — not the toggle — tells them what
  referral-grade still needs). `QUESTION`s render as gaps; the migrated `NOTE` renders subordinate.
- **Reorder:** up/down → bulk reorder endpoint (drag deferred).
- **Tie-off:** `TieOffModal` retargeted to the `ASSERTION_V1` gate language.
- **Shared readiness:** update the Phase-3 `threadReadiness` helper to the softened, `gate_version`-
  aware gap strings — flows automatically to the Thread Dock + `ThreadInspector`.
- **`types.ts` / `api.ts`:** `ThreadElement` (+ derived `role`) / `ThreadElementCitation` types;
  element CRUD + citation + reorder clients; `FindingItem` gains `elements[]` + `gate_version`.

## 10. Phase 4C — referral PDF renders structured assertions (separate but LOCKED)

Part of Phase 4's **product-level definition of done**. Its own PR after 4B (the generator —
`referral_export.py` + `tests/test_referral_pdf.py` — is a distinct subsystem). Acceptance criteria:

- Renders cited assertions as **Documented facts** with per-assertion citations.
- Renders uncited assertions as **Analysis** (clearly separated from facts).
- Renders `handoff_ready` assertions as **Claims** (a cited+handoff_ready one may appear as a
  "documented claim").
- Renders `QUESTION`s as unresolved questions / follow-up needs.
- `NOTE` / legacy context **omitted or in a clearly labeled appendix**, never mixed into claims.
- **No `[Doc-N]` scraping** from `Finding.narrative`.
- For `LEGACY_NARRATIVE` threads, the PDF still renders the legacy `narrative` (grandfathered);
  `ASSERTION_V1` threads render from assertions.
- Tests prove an `ASSERTION_V1` referral-grade thread with no legacy narrative exports correctly.

## 11. Phase 4D — AI-assisted structuring (committed, assist-only)

Elevated from "deferred fast-follow" to a committed post-4B slice, because freeform→structured is how
the model meets a real user. **Hard constraints:**
- AI **proposes** assertions/citations from freeform text; the human **confirms** every one. Nothing
  AI produces is authoritative until accepted.
- AI **never** sets `handoff_ready`, never decides cited-vs-uncited as final, and **never** influences
  `gate_version` or the referral-grade predicate (determinism + credibility firewall).
- Reuses `ai_proxy.py` / `ai_pattern_augmentation.py` patterns; surfaced under the existing **"Lead"**
  / **"Intake"** vocabulary (banned-strings gate applies).

## 12. Scope guardrails — NOT in Phase 4

- ❌ `supported_by` backing graph + edge `rationale` ("reasoning on the edge") → **Phase 5**.
- ❌ `AngleSplitModal` rework for assertions.
- ❌ `narrative_source` replacement / auto-generated prose.
- ❌ Drag-to-reorder polish (v1 = up/down + bulk endpoint).
- ❌ Map filters / command palette (Phase 5).

## 13. File-level change map

| File | Slice | Change |
|---|---|---|
| `backend/investigations/models.py` | 4A | `ThreadElement` (ASSERTION/QUESTION/NOTE, `handoff_ready`), `ThreadElementCitation`; `Finding.gate_version`; `FindingDocument.is_legacy`; defense-in-depth `clean()` (no DB constraint) |
| `backend/investigations/thread_elements.py` (new) | 4A | completeness helpers + `document_links` sync — **unwired** |
| `backend/investigations/migrations/*` | 4A | schema + idempotent data migration (narrative→NOTE, flag legacy docs, **stamp `gate_version`**); dep on `0036` |
| `backend/investigations/serializers.py` | 4A | element/citation serializers (citation ASSERTION-only; `handoff_ready`/type-change validation); finding-detail `elements[]` + derived `role`; `add_document_ids`→`is_legacy=True` |
| `backend/investigations/views.py` + `urls.py` | 4A | element CRUD + reorder + citation endpoints; delete-cleanup + sync |
| `backend/investigations/management/commands/seed_demo.py` | 4A | build assertions **and retain legacy narrative + legacy FindingDocument rows** |
| `backend/investigations/serializers.py` (`FindingUpdateSerializer` gate) | **4B** | Tier-1 `ASSERTION_V1` rewrite (narrative→cited assertion) |
| `backend/investigations/referral_grade.py` | **4B** | dual-version Tier-2 predicate + queryset (§6) + parity test; fixture rework |
| `frontend/src/views/ThreadBuilder.tsx` (new, replaces `AngleView.tsx`) | 4B | full-width assertion builder + convert prompt |
| `frontend/src/components/ElementCard.tsx` (new) | 4B | assertion card: derived-role badge, citations, handoff toggle |
| `frontend/src/components/threadReadiness.ts` | 4B | softened, `gate_version`-aware gap strings |
| `frontend/src/types.ts` · `frontend/src/api.ts` | 4B | element types (+ `role`) + clients; `FindingItem.elements` + `gate_version` |
| `backend/investigations/referral_export.py` (+ `tests/test_referral_pdf.py`) | 4C | render assertions by role; `gate_version`-aware; drop `[Doc-N]` scraping |
| AI structuring pipeline (path TBD in 4D plan) | 4D | assist-only freeform→assertion proposals |

## 14. Recommended next step

Rewrite the **Phase 4A-additive** implementation plan to the Assertion model (3 types, no M2M,
`gate_version` field + grandfather migration), ending with a regression sweep proving no existing
behavior changed. 4B (gate flip + builder), 4C (PDF), 4D (AI-assist) follow as their own plans.
