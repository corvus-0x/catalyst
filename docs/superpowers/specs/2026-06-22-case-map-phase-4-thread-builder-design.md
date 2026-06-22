# Case Map Phase 4 — Thread Builder (structured evidentiary elements)

**Date:** 2026-06-22
**Status:** **READY TO PLAN** — design approved in brainstorm. All load-bearing decisions locked
(data model, per-element citations, full-width layout, elements-replace-narrative, two-tier
strengthened gate). Slices: **4A** backend, **4B** frontend, **4C** referral-PDF (separate but
committed).
**Scope:** Replace the freeform `AngleView` narrative editor with a structured **Thread Builder**
backed by typed, individually-cited evidentiary elements (Fact / Inference / Question / Claim), and
make that taxonomy *load-bearing* by strengthening the referral-grade gate.

> ### Relationship to other specs
> - **Implements Phase 4** of `2026-06-19-case-map-and-thread-builder-design.md` (the controlling
>   plan), §7 "Thread Builder Direction" + §11 "Phase 4". This document is the detailed design for
>   that phase.
> - **Builds on Phase 2/3.** The focus reducer, `selection.kind === "thread"`, `ThreadInspector`
>   ("Open full Thread" → `openThread` → `frame.kind === "angle"`), the Thread Dock, and Thread Path
>   Mode all exist. Phase 4 changes *what the `angle` frame renders* — it does **not** add reducer
>   fields or change the dock/path-mode.
> - **Aligns the tie-off gate.** Extends — does not replace — `referral_grade.py` and the
>   `FindingUpdateSerializer` tie-off gate from `2026-06-18-tie-off-gate-and-credibility-design.md`.
> - **No `/case-map/` contract change.** The Case Map's `handoff_ready` / `handoff_included` /
>   `material` already derive from the referral-grade predicate; strengthening that predicate flows
>   through automatically (edges just get stricter).

---

## 1. Purpose — what Phase 4 completes

`AngleView` today is a single freeform `narrative` textarea plus a flat list of cited documents, with
`[Doc-N]` tokens regex-scraped out of the prose (`citationRefs()`). That is "nicer note-taking," not
defensible structure. Phase 4 turns a thread into an **ordered list of typed, individually-cited
evidentiary elements** so that:

- every assertion is classified — **Fact** (cited observation), **Inference** (reasoning over
  facts), **Question** (a gap requiring subpoena power/interviews), **Claim** (the handoff-ready
  accusation);
- every Fact points to the exact source (document + page + excerpt) that makes it a fact;
- a Claim is only "handoff-ready" when it is backed by cited facts;
- the referral package can render *facts → reasoning → claim* with per-sentence citations instead of
  scraping a prose blob (Phase 4C).

This is the realization of Catalyst's core thesis (CLAUDE.md "Prime"/"Reframe"): the customer of the
output is a professional with subpoena power who will discount an unstructured narrative.

The redesign's "one job per surface" principle holds: the **map** is the overview (Thread Dock +
Thread Path Mode already answer "where does this thread live" before you open it), and the **Thread
Builder** is the full-width detail surface where the thread is made defensible.

## 2. Locked decisions (from brainstorm)

| # | Decision | Choice |
|---|---|---|
| 1 | Structure | **New backend structured records** (not frontend-only, not JSON-on-Finding). |
| 2 | Evidence binding | **Per-element citations** — each Fact binds to specific source(s). |
| 3 | Layout | **Full-width Thread Builder** (keeps `frame.kind === "angle"`); map is the overview. |
| 4 | Narrative | **Elements replace the narrative.** Legacy narrative migrates to a `NOTE` element. |
| 5 | Gate | **Strengthened + two-tier** (see §5). |
| 6 | PDF | **4C — separate but committed** (see §8). |

## 3. Data model (Phase 4A)

Three new tables, following existing `Finding*` conventions (`UUIDPrimaryKeyModel`, `related_name`,
explicit `db_table`, indexes, the `page_reference`/`context_note` citation shape on
`FindingDocument`).

### `ThreadElement` — `db_table = "thread_element"`

| Field | Type | Notes |
|---|---|---|
| `finding` | FK → Finding, `related_name="elements"`, `on_delete=CASCADE` | the thread |
| `element_type` | TextChoices: `FACT` · `INFERENCE` · `QUESTION` · `CLAIM` · `NOTE` | taxonomy + migration bucket |
| `text` | TextField | element content |
| `position` | PositiveIntegerField | order within the thread |
| `handoff_ready` | BooleanField, default False | meaningful only on `CLAIM` |
| `supported_by` | `ManyToManyField("self", symmetrical=False, related_name="supports_elements", blank=True)` | a CLAIM/INFERENCE → the element(s) backing it |
| `created_at` / `updated_at` | DateTimeField | |

**Naming rationale:** the edge lives on the claim and points *to* the facts. `claim.supported_by.all()`
= the cited facts backing this claim; `fact.supports_elements.all()` = the claims/inferences this
fact backs. (`symmetrical=False` because support is directional.)

**`NOTE` is not a peer category.** It exists for migration and freeform context only. The builder
renders it as a subordinate "Context note," never as a fifth equal chip in the four-part model, and
it can **never** satisfy a gate.

**Meta:** `ordering = ["position"]`; index on `(finding, position)`; **`unique(finding, position)`**.

### `ThreadElementCitation` — `db_table = "thread_element_citation"`

| Field | Type | Notes |
|---|---|---|
| `element` | FK → ThreadElement, `related_name="citations"`, `on_delete=CASCADE` | |
| `document` | FK → Document, `related_name="element_citations"`, `on_delete=CASCADE` | |
| `page_reference` | CharField(blank) | mirrors `FindingDocument` |
| `context_note` | TextField(blank) | the excerpt that makes this a fact |

**Same-case guard (required):** `document.case_id == element.finding.case_id`. Enforced in the
serializer **and** model `clean()`. (DB-level enforcement across the join is impractical, so it is
also test-covered — see §7.)

**Meta:** `unique(element, document, page_reference)` (prevents duplicate citation chips).

### `FindingDocument.is_legacy` (new field, additive)

`BooleanField(default=False)`. Set `True` for all pre-Phase-4 rows during migration. Turns the
`document_links` sync rule from "infer provenance" into "respect provenance" (§4).

### Completeness (the predicates the gates use)

Recursive, evaluated at gate-time (drafting stays permissive):

- **Complete `FACT`** = `text` non-empty **and** ≥1 `ThreadElementCitation`.
- **Complete `CLAIM`** = `text` non-empty **and** ≥1 `supported_by` element that is a **complete
  `FACT`**.
- `INFERENCE` / `QUESTION` / `NOTE` have no completeness requirement and never satisfy a gate.

### Invariants (enforced; see §7 for tests)

1. `handoff_ready = true` is **rejected** (error, not silent downgrade) unless the element is a
   complete `CLAIM`.
2. `element_type` change is **conservative**: allowed only when the resulting element still satisfies
   its type invariants; a change that would orphan citations or invalidate `supported_by` is rejected
   with a clear error in v1.
3. `DELETE element` cleanup order: delete its citations → remove it from every other element's
   `supported_by` → resync `FindingDocument` (§4).
4. Self-M2M is the v1 backing mechanism. A dedicated through-table is only warranted later if
   per-link metadata is wanted (e.g. "reason this fact supports the claim", supporting-fact
   ordering).

## 4. `document_links` as a synced union (compatibility surface)

`Finding.document_links` (`FindingDocument`) stays — the `/case-map/` builder, credibility counts, and
the current referral PDF all read it. Strangler-fig, not rip-and-replace.

- **Definition:** `document_links` = the **union of all element citations' documents** (non-legacy)
  **plus** preserved **legacy** citations (`is_legacy=True`).
- **On adding** an element citation: ensure a `FindingDocument(finding, document, is_legacy=False)`
  exists.
- **On removing** an element citation: remove the `FindingDocument` row **only if** no other element
  still cites that document **and** the row is not `is_legacy=True`.
- Legacy rows are **never reaped** by element-citation churn.

## 5. Two-tier strengthened gate (Phase 4A)

The two enforcement points stay distinct and must remain equivalent where they overlap (see parity
test, §7). The strengthening preserves the **"Substantiated but not yet handoff-ready"** middle state
the rest of the app relies on (Case Map `substantiated_thread_count` vs `handoff_ready`, Thread Dock
readiness column, credibility counts).

### Tier 1 — CONFIRMED tie-off gate (`FindingUpdateSerializer`, serializers.py:1038)

Fires only on the transition **into** CONFIRMED (condition loss after tie-off remains allowed).

> **CONFIRMED requires:** ≥1 **complete `FACT`** (text + citation) ∧ `evidence_weight ∈
> {DOCUMENTED, TRACED}` ∧ `overreach_reviewed`.

Replaces the now-dead `post_narrative` non-empty check (serializers.py:1066). "≥1 complete FACT"
subsumes today's finding-level citation check, since a cited fact syncs into `document_links`.

### Tier 2 — Referral-grade (`referral_grade.py`)

> **Referral-grade requires:** CONFIRMED ∧ `evidence_weight ∈ {DOCUMENTED, TRACED}` ∧
> `overreach_reviewed` ∧ ≥1 cited document ∧ **≥1 `handoff_ready` `CLAIM` backed by ≥1 complete
> `FACT`**.

Both definitions are updated and must agree:
- `is_referral_grade(finding)` — instance predicate (add the claim/fact check).
- `referral_grade_qs(case)` — the single-SQL queryset; add the element predicate via an `Exists()`
  subquery so counts and the PDF filter stay one statement.

**Flows through for free:** `/case-map/` `handoff_ready` / `handoff_included` / `material` derive from
this predicate — no contract change; material edges and handoff status simply get stricter.

## 6. Migration (Phase 4A) — and its intended consequence

Schema + data migration:

1. Add `NOTE` to `element_type` choices; add `FindingDocument.is_legacy`.
2. For each `Finding` with non-empty `narrative` → create one `ThreadElement(element_type=NOTE,
   position=0, text=narrative)`.
3. Flag all existing `FindingDocument` rows `is_legacy=True` (preserved, never reaped).

**Intended consequence (per locked decision #4/#5):** already-CONFIRMED findings **keep CONFIRMED
status** (the gate does not re-fire retroactively) but **drop out of referral-grade** until reworked
into facts/claims — because a `NOTE` can never be a complete `FACT`. This is correct, not a
regression.

**Two mandatory mitigations, both in the 4A PR:**
- **`seed_demo` is updated** to build real `ThreadElement` facts/claims so the demo case still
  showcases referral-grade threads (portfolio-critical — recruiters see the demo).
- The UI frames a dropped thread as **"needs handoff-ready claim,"** never as vanished data (the
  shared `threadReadiness` helper supplies the gap string; §7 of Phase 3 wired it into the dock +
  inspector).

## 7. API surface + test plan (Phase 4A)

### Endpoints (nested under the thread; finding detail also embeds `elements[]`)

- `GET / POST  /api/cases/:id/findings/:fid/elements/` — create `{element_type, text, position?}`
- `PATCH / DELETE  …/elements/:eid/` — edit `{text, element_type?, handoff_ready?, supported_by_ids?}`
- `POST  …/elements/reorder/` — `{ordered_ids: […]}`; rewrites `position` atomically in one
  transaction (required because `unique(finding, position)` forbids transient collisions that per-row
  PATCHes would cause).
- `POST  …/elements/:eid/citations/` — `{document_id, page_reference, context_note}`
- `DELETE  …/citations/:cid/` — runs the §4 sync/deletion rule.

The finding-detail serializer (`fetchAngle`) gains `elements: [...]` with nested `citations` and
`supported_by_ids`.

### Backend tests (TDD — red first)

- **Completeness:** complete vs incomplete FACT (text/citation); complete vs incomplete CLAIM
  (text + ≥1 *complete*-FACT backing); INFERENCE/QUESTION/NOTE never complete.
- **Tier-1 gate:** transition into CONFIRMED **blocked** without a complete FACT; allowed with one;
  weight/overreach still enforced; editing an already-CONFIRMED thread does not re-gate.
- **Tier-2 predicate:** referral-grade **false** for a CONFIRMED thread with no handoff-ready claim;
  **true** once a handoff_ready CLAIM backed by a complete FACT exists.
- **Parity test:** `is_referral_grade(f)` agrees with `f in referral_grade_qs(f.case)` across a
  fixture matrix — the anti-drift guard that justifies a single source of truth.
- **Migration:** narrative → one NOTE element; `FindingDocument` rows flagged `is_legacy`;
  previously-CONFIRMED finding stays CONFIRMED **and** drops out of `referral_grade_qs`.
- **Same-case citation guard** rejects a cross-case `document_id` (serializer + `clean()`).
- **Deletion sync:** removing an element citation reaps the `FindingDocument` only when no other
  element cites it and it is not `is_legacy`; legacy rows survive.
- **Reorder** atomicity honors `unique(finding, position)`.
- **`handoff_ready` rejection** unless complete CLAIM; **`element_type`-change** constraint.
- **`document_links` union** equals non-legacy element-citation documents ∪ legacy rows.

Backend tests run on Railway (Postgres + ArrayField); CI-equivalent locally with
`docker exec catalyst_backend python manage.py test investigations --exclude-tag=eval --keepdb --noinput`.

## 8. Frontend Thread Builder (Phase 4B)

`ThreadBuilder.tsx` replaces `AngleView` as the full-width frame. **The frame kind stays `"angle"`**
(CLAUDE.md internal-identifier rule) and `openThread` / routing are untouched — only the rendered
surface changes. `ThreadInspector`'s "Open full Thread" still routes here.

- **Header:** title, status / severity / weight badges, back-to-map, and a **two-tier readiness
  line** ("Substantiated ✓ · Referral-grade: needs handoff-ready claim").
- **Body:** typed element list grouped **Fact → Inference → Question → Claim**, with the **Context
  note** (migrated `NOTE`) rendered subordinate at the bottom.
- **`ElementCard`:** type tag, inline `text` edit, per-element citation chips (reuse
  `CiteDocumentPicker`, now element-scoped), a "supporting facts" multiselect for CLAIM/INFERENCE,
  and a `handoff_ready` toggle **disabled until the claim is complete** (tooltip names the gap).
- **Reorder:** up/down buttons → the bulk reorder endpoint (drag polish deferred).
- **Tie-off:** `TieOffModal` retargeted to the new gate language.
- **Shared readiness:** update the Phase-3 `threadReadiness` helper to the two-tier gap strings — it
  automatically flows to the **Thread Dock** and **`ThreadInspector`** (they consume the same
  helper), so the dock readiness column and the inspector stay coherent with the builder.
- **`types.ts` / `api.ts`:** add `ThreadElement` / `ThreadElementCitation` types and element CRUD +
  citation + reorder client functions; `FindingItem` gains `elements[]`.

### Frontend tests (Vitest)

- Renders elements grouped by type; `NOTE` rendered subordinate.
- Add / edit / delete element; per-element citation attach/detach.
- Claim-backing multiselect; `handoff_ready` toggle gated by completeness (disabled + tooltip when
  incomplete).
- Two-tier readiness line reflects gate state; reorder calls the bulk endpoint.

Frontend tests run locally (Vitest).

## 9. Phase 4C — referral PDF renders structured elements (separate but LOCKED)

4C is the payoff and is **non-optional**: it is the committed next slice after 4B, with its own PR and
test suite (the PDF generator is a distinct subsystem — ordering, citation rendering, page layout,
export filters, regression tests).

**Acceptance criteria (locked):**
- PDF renders `FACT` elements with **per-element citations**.
- PDF renders `INFERENCE` **separately** from facts (reasoning, not evidence).
- PDF renders **only `handoff_ready` `CLAIM`** elements as package claims.
- `QUESTION` elements render as unresolved questions / follow-up needs.
- `NOTE` / legacy context is **omitted or placed in a clearly labeled context appendix**, never mixed
  into claims.
- **No `[Doc-N]` scraping** from `Finding.narrative`.
- Tests prove a referral-grade thread with **no** legacy narrative still exports correctly.

Between 4B and 4C the PDF may still read the legacy narrative field; acceptable because the
strengthened gate already controls *what qualifies* for export.

## 10. Scope guardrails — what Phase 4 does NOT ship

Deferred to a later phase / fast-follow so 4A/4B/4C stay focused:

- ❌ `AngleSplitModal` rework for elements (splitting a thread = moving elements).
- ❌ AI-assisted element drafting / `LeadPanel` retarget / `narrative_source` replacement.
- ❌ Auto-generated prose narrative from elements.
- ❌ Drag-to-reorder polish (v1 uses up/down + bulk endpoint).
- ❌ Map filters / command palette (Phase 5).

## 11. File-level change map

| File | Slice | Change |
|---|---|---|
| `backend/investigations/models.py` | 4A | `ThreadElement`, `ThreadElementCitation`, `supported_by` M2M; `FindingDocument.is_legacy`; `clean()` same-case guard |
| `backend/investigations/migrations/*` | 4A | schema + data migration (narrative→NOTE, flag legacy docs) |
| `backend/investigations/serializers.py` | 4A | element/citation serializers; finding-detail `elements[]`; Tier-1 gate rewrite (drop narrative check → complete-FACT); `handoff_ready`/type-change validation; deletion-sync |
| `backend/investigations/referral_grade.py` | 4A | Tier-2 predicate + `Exists()` subquery in `referral_grade_qs` |
| `backend/investigations/views.py` + `urls.py` | 4A | element CRUD + reorder + citation endpoints |
| `backend/investigations/management/commands/seed_demo.py` | 4A | build real elements so demo threads stay referral-grade |
| `frontend/src/views/ThreadBuilder.tsx` (new, replaces `AngleView.tsx`) | 4B | full-width structured builder |
| `frontend/src/components/ElementCard.tsx` (new) | 4B | typed element card + citations + backing + handoff toggle |
| `frontend/src/components/threadReadiness.ts` | 4B | two-tier gap strings |
| `frontend/src/types.ts` · `frontend/src/api.ts` | 4B | element types + client functions; `FindingItem.elements` |
| `backend/investigations/referral_export.py` (+ `tests/test_referral_pdf.py`) | 4C | render elements per §9 acceptance criteria; drop `[Doc-N]` narrative scraping |

## 12. Recommended next step

Convert **Phase 4A** into a step-by-step, TDD-first implementation plan (the §7 backend test cases as
the red tests), starting with the model + completeness predicates, then the two-tier gate, then the
API. 4B depends on 4A deployed to the Railway PR preview; 4C follows 4B.
