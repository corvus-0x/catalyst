# Case Map Phase 4C — Referral PDF Renders Structured Assertions

## Problem Statement

Phase 4B shipped the assertion data model, the softened `gate_version`-aware gate, and the
ThreadBuilder authoring UI — so citizen investigators now build structured fact / analysis /
referral assertions with real per-assertion citations. But the **referral PDF**, the only artifact
the subpoena-power customer (AG / IRS / FBI) ever sees, still flattens everything back into free-text
narrative and scrapes `[Doc-N]` tokens out of it. The structured-evidence investment never reaches
the reader, and an `ASSERTION_V1` thread that is genuinely referral-grade **but has no legacy
narrative would export wrong or empty** — actively breaking the deliverable for exactly the threads
4B's gate now admits.

## Evidence

- Acceptance criterion #8 in the design spec explicitly calls out the failure mode: "Tests prove an
  `ASSERTION_V1` referral-grade thread with no legacy narrative exports correctly" — i.e. today it
  does not.
- `referral_export.py:427–433` renders `finding.narrative` under a hardcoded "Analysis:" label; there
  is no code path that reads `ThreadElement` / `ThreadElementCitation` into the PDF.
- The role-derivation predicates (`assertion_is_cited`, `finding_has_cited_assertion`,
  `finding_has_handoff_ready_assertion` in `thread_elements.py`) are **already wired into the 4B
  gate** — so the gate admits threads on a definition of "cited" the PDF currently can't honor.
- Design spec §10 lists 4C as part of Phase 4's product-level **definition of done**.

## Proposed Solution

Rewire the per-thread renderer in `referral_export.py` so that rendering branches on
`Finding.gate_version`. `LEGACY_NARRATIVE` threads keep the current narrative path unchanged
(grandfathered). `ASSERTION_V1` threads render their `ThreadElement`s into **four fixed evidentiary
sections** — Documented Facts, Analysis, Referral Assertions, Open Questions — via a single
deterministic `element → section` mapping that **reuses the existing `assertion_is_cited` predicate**
(`thread_elements.py:13`) rather than inventing its own citation logic. (Note: the serializer's
`_element_role` at `serializers.py:1123` is a *separate* derivation — it checks `citations.exists()`
and ignores blank text — and is NOT unified with `assertion_is_cited` today; 4C reuses
`assertion_is_cited` and leaves `_element_role` alone unless a deliberate refactor is scoped.)
`[Doc-N]` scraping is dropped for
`ASSERTION_V1`. NOTE elements and leftover legacy narrative are omitted from the government-facing
package. Selection of which findings appear (CONFIRMED + DOCUMENTED/TRACED) is unchanged — only the
per-thread rendering changes, keeping the blast radius small.

We chose strict omission of uncited context (over a context appendix) because the handoff artifact
must not carry uncited prose just because it exists in the DB; a "working draft with context
appendix" export mode is deferred as a separate future phase.

## Key Hypothesis

We believe **rendering structured assertions by derived evidentiary role** will **let a government
reader distinguish sourced facts from investigator inference at a glance** for **AG / IRS / FBI
recipients of a referral package**.
We'll know we're right when **an `ASSERTION_V1` referral-grade thread with no legacy narrative
exports with its facts, analysis, referral assertions, and open questions in the correct sections
with correct per-assertion citations, and no `[Doc-N]` scraping appears anywhere in the output** —
proven by `backend/investigations/tests/test_referral_pdf.py`.

## What We're NOT Building

- **Executive Summary changes** — separate narrative surface; changing it widens scope from "replace
  the renderer" to "redesign summary semantics." (Follow-up issue noted below.)
- **Context appendix / "working draft" export mode** - the official referral package omits uncited
  context entirely; a multi-mode export is a future phase.
- **`supported_by` backing graph + edge rationale** - explicitly Phase 5 per the spec guardrails.
- **Selection-logic changes** - which findings are referral-grade is unchanged; 4C only changes how
  each renders.
- **AI in the export path** - the PDF stays fully deterministic.

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| ASSERTION_V1 no-legacy-narrative thread exports correctly | Pass | New test in `backend/investigations/tests/test_referral_pdf.py`, extracting text via PyMuPDF (`fitz.open(stream=..., filetype="pdf")`) and asserting the four section labels + citation text |
| `[Doc-N]` scraping removed AND tokens stripped from assertion text | 0 occurrences | PyMuPDF-extracted text of an ASSERTION_V1 export (incl. a fixture whose assertion text literally contains `[Doc-3]`) has no `[Doc-` token |
| LEGACY_NARRATIVE rendering unchanged | Extracted-text / story-structure stable (NOT byte-stable — cover page uses `datetime.now()` at `referral_export.py:186`) | Regression test on existing legacy fixture comparing extracted text/structure |
| Section→assertion mapping is total & deterministic | 100% of elements mapped to exactly one section | Unit test over the mapping function |
| Backend suite stays green | 1064+/1064+ | `docker exec ... test investigations --exclude-tag=eval --keepdb --noinput` |

## Open Questions

- [ ] Exact section header copy: "Analysis — investigator interpretation", "Referral Assertions",
      "Open Questions" — confirm final strings during implementation (banned-strings gate applies).
- [ ] Visual treatment fidelity in reportlab: tinted background / left border for Analysis, callout
      style for Referral Assertions, checklist style for Open Questions — confirm what's achievable
      cleanly vs. deferred to polish.
- [ ] Should the `documented` vs `needs support` marker on Referral Assertions be a text label, a
      colored chip, or both? (Default: text label to start.)
- [ ] Branch name: nested `feature/case-map-phase-4c-...` has failed to create in this environment
      before. If it recurs, use a flat name (`feature-case-map-phase-4c-referral-pdf-assertions`).

**Resolved decisions (formerly open):**
- **Page-reference formatting** — render `ThreadElementCitation.page_reference` **verbatim after
  trimming whitespace; do NOT prepend `p.`** The field is free-form and may hold `p. 1`,
  `Schedule L`, `Book 429 / Page 12`, etc. (The legacy renderer's hardcoded `p.{...}` is a legacy
  quirk, not the model for ASSERTION_V1.)
- **Uncited referral-assertion label** — use blunt copy: **"Needs source"** or
  **"Uncited — needs support"** (not a soft marker). This is a credibility decision, not just
  rendering: the gate permits an uncited handoff assertion to appear in a referral-grade package as
  long as *some other* assertion is cited and *a* handoff assertion is ready, so the PDF must label
  the uncited one unambiguously.

---

## Users & Context

**Primary User**
- **Who**: A government investigator with subpoena power (AG / IRS / FBI) who receives a Catalyst
  referral package.
- **Current behavior**: Reads a flat narrative PDF where sourced facts and investigator inference are
  visually indistinguishable; must mentally re-separate them to assess credibility.
- **Trigger**: A citizen investigator hands off a completed referral package and asks the agency to
  act.
- **Success state**: In ~15 minutes, the reader can see exactly which statements are document-backed,
  which are interpretation, which assertions are put forward for referral, and what still needs
  subpoena/interview/records authority — then decide whether to commit agency resources.

**Secondary User**
- The **citizen investigator** who authored structured assertions in ThreadBuilder and finally sees
  that structure reflected in the deliverable (closing the 4A→4B→4C loop).

**Job to Be Done**
When I receive a citizen referral, I want sourced facts structurally fenced off from inference and
allegation, so I can quickly judge credibility and decide whether to commit subpoena power.

**Non-Users**
Tyler (the platform builder) is not the customer of the output. Anyone wanting an AI-generated or
narrative-prose summary is out of scope — this is a deterministic, evidence-fenced artifact.

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | Branch per-thread rendering on `Finding.gate_version` | The grandfathering contract; legacy threads must not regress |
| Must | Predicate-injectable `element → section` mapping (`map_thread_element_to_referral_section(element, is_cited=assertion_is_cited)`) | Single source of truth for "cited"; total function; no double-counting; unit-testable without DB/reportlab |
| Must | Add `elements__citations__document` prefetch (and `document_links__document`) to the endpoint queryset | New renderer dereferences citations per element; avoids N+1 and matches the legacy renderer's `doc_link.document` access |
| Must | Four fixed sections in order: Documented Facts → Analysis → Referral Assertions → Open Questions | The credibility firewall the government reader relies on |
| Must | Per-assertion citations rendered from `ThreadElementCitation` (page ref + context note) | Citations are the source of truth, not narrative scraping |
| Must | Drop `[Doc-N]` scraping for ASSERTION_V1, AND strip bracketed legacy tokens matching `\[Doc-\d+\]` from rendered assertion text | Preserves the "no `[Doc-`" promise even if an investigator typed `[Doc-3]`. Match the **specific** pattern, not every `[Doc-` substring, to avoid damaging legitimate text. Order: strip token → escape → normalize whitespace |
| Must | A single `_pdf_escape(value)` helper applied **only** to interpolated user data | `Paragraph` parses mini-HTML; `&`/`<`/`>` corrupt rendering. Centralizing prevents escaping intentional markup labels like `<b>Documented</b>` (which would break formatting if whole strings were escaped) |
| Must | Omit NOTE + legacy narrative from ASSERTION_V1 package | No uncited prose in the handoff artifact |
| Must | `backend/investigations/tests/test_referral_pdf.py` proving the no-legacy-narrative export | The spec's acceptance bar |
| Should | "Documented" vs "needs support" marker on Referral Assertions | Distinguishes cited vs uncited handoff assertions |
| Should | Omit empty evidentiary sections | Less visual noise; render a header only when it has content |
| Should | Distinct visual treatment per section (tinted Analysis, callout Referral Assertions, checklist Open Questions) | Reinforces the firewall for a skimming reader |
| Could | Internal TODO / follow-up issue for Executive Summary evidentiary counts | Useful later; out of scope now |
| Won't | Context appendix / working-draft export mode | Future phase |
| Won't | Executive Summary semantic changes | Separate surface; scope discipline |
| Won't | AI / non-deterministic rendering | Determinism is a core promise |

### The Rendering Contract (deterministic decision tree)

```
if gate_version == LEGACY_NARRATIVE:
    render current narrative path (unchanged)

elif gate_version == ASSERTION_V1:
    for each element (ordered by position):
        if element_type == QUESTION              -> Open Questions
        elif element_type == NOTE                -> OMIT
        elif element_type == ASSERTION:
            if handoff_ready:                    -> Referral Assertions
                if assertion_is_cited(e): mark "Documented" + render citations
                else:                     mark "Uncited / needs support"
            elif assertion_is_cited(e):          -> Documented Facts (+ citations)
            else:                                -> Analysis (investigator interpretation)
    omit any section that ends up empty
    render sections in fixed order:
        Documented Facts -> Analysis -> Referral Assertions -> Open Questions
```

Each element maps to **exactly one** section. `handoff_ready` is the dominant axis; citation is a
secondary marker within Referral Assertions. The PDF never re-implements citation logic — the mapper
takes the citation predicate as an injected argument
(`map_thread_element_to_referral_section(element, is_cited=assertion_is_cited)`), so production uses
the same gate predicate while unit tests pass a stub (`lambda e: True/False`) to prove the decision
tree with plain objects — no DB, no reportlab.

> **Note on "pure":** `assertion_is_cited(element)` calls `element.citations.exists()` (an ORM hit),
> so a mapper calling it directly is *deterministic but ORM-backed*, not pure. Injecting the predicate
> is what makes the decision tree unit-testable in isolation.

### MVP Scope

The strict government-facing referral package: `gate_version` branch + the four-section ASSERTION_V1
renderer + per-assertion citations + the acceptance test. Visual polish (exact tints/callouts) is a
"Should," not a blocker for proving the hypothesis.

### User Flow

Author substantiates a thread in ThreadBuilder (4B) → thread becomes referral-grade under
`ASSERTION_V1` → investigator exports the referral package → PDF renders the thread's assertions in
the four evidentiary sections with citations → government reader scans facts vs. analysis vs. referral
assertions vs. open questions and decides whether to act.

---

## Technical Approach

**Feasibility**: HIGH

**Architecture Notes**
- Additive renderer swap behind `Finding.gate_version` (`models.py:1302`); legacy path untouched.
- All data already exists: `ThreadElement` (`element_type`, `text`, `position`, `handoff_ready`),
  `ThreadElementCitation` (`page_reference`, `context_note`) — `models.py:1425–1483`.
- Reuse the `assertion_is_cited` predicate (`thread_elements.py:13`) — already gate-wired, so the
  PDF and the gate agree on "cited." Do NOT route through the serializer's `_element_role`
  (`serializers.py:1123`), which uses a looser `citations.exists()` check and is intentionally left
  separate in 4C.
- Change is localized to `_build_findings_section` (`referral_export.py:391–482`) plus new private
  render helpers + new paragraph styles in `_build_custom_styles`.
- `generate()` selection logic (line 110) unchanged — smaller blast radius. Selection already lives in
  the endpoint: `referral_grade_qs(case)` is passed in at `views.py:6283`.
- **Prefetch:** the endpoint queryset (`views.py:6285`) currently does
  `.prefetch_related("entity_links", "document_links")`. The new renderer must add
  `elements__citations__document`, and `document_links` should become `document_links__document`
  (the legacy renderer already dereferences `doc_link.document`). Without this the per-element
  citation rendering is an N+1.
- New paragraph styles needed for tinted Analysis block / callout / checklist (reportlab
  `ParagraphStyle` + table backgrounds for tints).
- **Tests use PyMuPDF** (`pymupdf` is already in `backend/requirements.txt`):
  `fitz.open(stream=response.content, filetype="pdf")` extracts real text, so assertions can check
  section labels, citation strings, and the absence of `[Doc-` — not just "a PDF was produced."

**Implementation guardrails — keep helper boundaries sharp (one concern each)**
- `map_thread_element_to_referral_section(element, is_cited=...)` — decides the **bucket only**. No
  text transformation, no escaping, no formatting.
- `_strip_legacy_doc_tokens(text)` — removes **only** `\[Doc-\d+\]`. Nothing else.
- `_pdf_escape(value)` — escapes **only** user-controlled text. Never touches markup labels.
- citation formatting — renders `page_reference.strip()` **verbatim**. No prefixing, no parsing.
- **Tests prove each seam separately**: section placement, citation rendering, escaping, token
  stripping, and legacy preservation are distinct tests — not one mega-assertion. A failure should
  point at exactly one helper.

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| PDF "cited" definition drifts from gate's | M | Inject `assertion_is_cited`; do not re-implement; add a parity-style test |
| Legacy rendering regresses | M | Regression test on extracted text/structure (NOT bytes — cover page uses `datetime.now()`); branch isolates the new path |
| N+1 on per-element citations | M | Add `elements__citations__document` prefetch to the endpoint queryset |
| Acceptance fixture blocked before it reaches the renderer | H | `referral_grade_qs()` requires `FindingDocument` rows via `document_links`, which `ThreadElementCitation` does NOT auto-sync (the serializer does). The acceptance test must create the citation via `ThreadElementCitationSerializer.save()` OR also create the `FindingDocument` compatibility row — else the endpoint returns empty and a renderer bug is misdiagnosed. |
| Unescaped user text breaks reportlab markup | M | `Paragraph()` parses mini-HTML; element text / context notes / filenames may contain `&`, `<`, `>`. Escape all user-controlled text before embedding. |
| `[Doc-N]` token surviving in assertion text | M | An investigator's assertion text may literally contain `[Doc-3]`; strip legacy citation tokens from ASSERTION_V1 rendered text so the "no `[Doc-`" promise holds. |
| `page_reference` double-prefix (`p.p. 1`) | L | Render `ThreadElementCitation.page_reference` verbatim or normalize defensively |
| reportlab can't cleanly do tints/callouts | L | Treat visual treatment as "Should"; fall back to bold labels + spacing |
| Empty-section logic produces an all-empty thread | L | Guard: if a thread maps to zero sections, surface a deterministic placeholder or assert upstream gate prevents it |
| Banned-strings gate trips on section copy | L | Use investigative vocabulary; run the banned-strings check before commit |

---

## Implementation Phases

<!--
  STATUS: pending | in-progress | complete
  PARALLEL: phases that can run concurrently
  DEPENDS: phases that must complete first
  PRP: link to generated plan file once created
-->

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
|---|-------|-------------|--------|----------|---------|----------|
| 1 | Mapping function + unit tests | Predicate-injectable `element → section` decision-tree fn | complete | - | - | commit `19bd60d` |
| 2 | Legacy branch split | Extract legacy rendering into its own helper behind `gate_version`; regression test (extracted text) | complete | - | 1 | commit `0020667` |
| 3 | ASSERTION_V1 renderer + styles | New per-thread render path + styles + escaping + token strip | complete | - | 2 | commit `abd6bfa` |
| 4 | Acceptance + integration tests | No-legacy-narrative ASSERTION_V1 export; no-Doc-N; full suite green | complete | - | 3 | commit `abd6bfa` (1094 green) |
| 5 | Follow-up issue (exec summary counts) | File the deferred Executive Summary evidentiary-counts issue | complete | - | 4 | issue [#20](https://github.com/corvus-0x/catalyst/issues/20) |

### Phase Details

**Phase 1: Mapping function + unit tests**
- **Goal**: A deterministic, total `element → section` mapping isolated from reportlab AND the DB.
- **Scope**: `map_thread_element_to_referral_section(element, is_cited=assertion_is_cited)` with the
  predicate injected; unit tests pass a stub `is_cited` and cover every branch (cited/uncited ×
  handoff/not × QUESTION × NOTE).
- **Success signal**: Every element type/state maps to exactly one section (or OMIT); tests green
  with no DB or reportlab in the test path.

**Phase 2: Legacy branch split + regression test**
- **Goal**: Isolate the legacy path so the new renderer can't regress it, and lock it.
- **Scope**: Extract the current `_build_findings_section` body into a `_build_legacy_findings`
  helper called when `gate_version == LEGACY_NARRATIVE`; add an explicit LEGACY_NARRATIVE fixture
  (don't rely on `setUp`, which currently builds an ASSERTION_V1 finding with legacy narrative);
  regression test asserts stable PyMuPDF-extracted **substrings** (headers, narrative fragments,
  filenames) — not full lines (extraction reorders/splits punctuation) and not raw bytes
  (`datetime.now()`).
- **Success signal**: Legacy fixture's extracted substrings are unchanged after the split.

**Phase 3: ASSERTION_V1 renderer + styles**
- **Goal**: Render the four sections in fixed order with per-assertion citations.
- **Scope**: New private render helper for `gate_version == ASSERTION_V1`; new `ParagraphStyle`s
  (Analysis tint, Referral Assertions callout, Open Questions checklist); markers `<b>Documented</b>`
  vs blunt **"Needs source" / "Uncited — needs support"**; omit-empty-sections. Three small helpers:
  `_pdf_escape(value)` (applied only to interpolated user data, never to markup labels); strip
  `\[Doc-\d+\]` from assertion text (**before** escaping); `page_reference` rendered **verbatim after
  `.strip()`, no `p.` prefix**.
- **Success signal**: An ASSERTION_V1 fixture renders all four sections correctly; no `[Doc-`.

**Phase 4: Acceptance + integration tests**
- **Goal**: Meet the spec's acceptance bar and keep the suite green.
- **Scope**: The no-legacy-narrative ASSERTION_V1 acceptance test using PyMuPDF text extraction
  (assert section-label and citation **substrings**, plus absence of `[Doc-`). Run full backend
  suite (`--exclude-tag=eval --keepdb --noinput`).

  **Exact fixture recipe (avoids the two traps verified against the serializers):**
  - Create the `ASSERTION_V1` finding, then **four** elements so all four sections are non-empty:
    1. cited, non-handoff ASSERTION → *Documented Facts*
    2. uncited, non-handoff ASSERTION → *Analysis*
    3. cited, handoff ASSERTION → *Referral Assertions* (marked Documented)
    4. a `QUESTION` → *Open Questions*

    (If the *only* cited assertion were also handoff-ready, Documented Facts would correctly be empty
    — so #1 must be a separate cited non-handoff assertion. Optionally add a 5th uncited handoff
    assertion to exercise the "Needs source" label, and put `[Doc-3]` in one assertion's text to
    prove the strip.)
  - **`handoff_ready` cannot be set via `ThreadElementCreateSerializer`** (it whitelists only
    `element_type`/`text`, `serializers.py:1180`). For handoff elements, set `handoff_ready=True` on
    the model directly, or PATCH via `ThreadElementUpdateSerializer`.
  - **Citations must go through the serializer** so `document_links` syncs and `referral_grade_qs`
    admits the finding:
    `s = ThreadElementCitationSerializer(data={"document_id": str(doc.id), "page_reference": "p. 1", "context_note": "..."}, element=el); assert s.is_valid(), s.errors; s.save()`.
    A raw `ThreadElementCitation.objects.create(...)` leaves `document_links` empty → endpoint
    returns nothing → renderer bug misdiagnosed.
- **Success signal**: New tests pass; 1064+/1064+ green.

**Phase 5: Follow-up issue**
- **Goal**: Capture deferred scope without widening this PR.
- **Scope**: File an issue for Executive Summary evidentiary counts (documented facts, documented
  referral assertions, uncited referral assertions needing support, open questions, threads included).
- **Success signal**: Issue exists and is linked from the PR.

### Parallelism Notes

**Sequential, not parallel.** Phases 2 and 3 both touch `_build_findings_section` and the same test
file, so true parallelism would conflict. The ordering is deliberate: split the legacy path into its
own helper *first* (Phase 2) so the new ASSERTION_V1 renderer (Phase 3) is added alongside it rather
than carved out of a shared function under churn. Only after that split could the two be worked
independently — and by then the dependency is already paid.

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Fact/analysis separation | Separate labeled sections, fixed order | Inline role badges; facts-first appendix | Cleanest credibility firewall for a skimming AG/IRS reader; badges too easy to miss |
| handoff_ready bucket name | "Referral Assertions" | "Claims"; "Handoff Assertions"; "Key Assertions" | "Claims" implies allegation/hearsay and lowers credibility of the strongest material |
| Documented + handoff_ready placement | Referral Assertions, marked "Documented" + citations | Both Facts and Referral Assertions; Facts only | Render once in primary role; double-rendering inflates apparent evidence |
| Uncited assertion routing | Always Analysis | Sometimes Open Questions "by content" | Renderer must be deterministic on structure; Open Questions is fed only by QUESTION elements |
| NOTE / legacy narrative (ASSERTION_V1) | Omit entirely | Labeled context appendix | Handoff artifact must not carry uncited prose; appendix deferred to a future "working draft" mode |
| Executive Summary | Unchanged this PR | Add evidentiary counts now | Keep PR scoped to the renderer; file a follow-up issue |
| Empty sections | Omit | Show with placeholder | Less visual noise; header only when it has content |
| Citation logic | Reuse `assertion_is_cited` + role helpers | Re-implement in the PDF | PDF buckets must match the gate that admitted the thread |
| Mapper testability | Inject `is_cited` predicate | Call `assertion_is_cited` directly (ORM-backed) | Lets the decision tree be unit-tested with no DB/reportlab; prod still uses the gate predicate |
| PDF test method | PyMuPDF text extraction | Assert only "a PDF was produced" | Makes acceptance real: checks section labels, citations, and absence of `[Doc-` |
| Legacy regression bar | Extracted-text/structure stability | Byte-stable PDF | Cover page `datetime.now()` makes bytes inherently unstable |
| Citation prefetch | `elements__citations__document` + `document_links__document` | Keep current 2-relation prefetch | Per-element citation rendering would otherwise be N+1 |
| `[Doc-N]` in assertion text | Strip tokens during ASSERTION_V1 render | Test only that scraping isn't used | Preserves the literal "no `[Doc-`" promise even if an author typed the token |
| User text safety | Escape before `Paragraph()` | Trust input | reportlab parses mini-HTML; `&`/`<`/`>` corrupt output; 4C widens the surface |
| Acceptance citation creation | `ThreadElementCitationSerializer.save()` (or create `FindingDocument` too) | Raw `ThreadElementCitation.objects.create` | `referral_grade_qs` needs `document_links`; raw create leaves it empty → endpoint returns nothing |
| Role-derivation reuse | PDF mapper uses `assertion_is_cited` only | Route through serializer `_element_role` | The two are not unified (`_element_role` ignores blank text); leave it separate unless a refactor is scoped |
| Phase 2/3 ordering | Split legacy helper first, then add V1 renderer | Develop both branches in parallel | Both touch the same function/test; splitting first avoids churn conflicts |
| Page-reference format | Verbatim after `.strip()`, no `p.` prefix | Hardcode `p.{...}` like legacy | Field is free-form (`Schedule L`, `Book 429 / Page 12`); prefixing produces `p.p. 1` |
| `[Doc-N]` strip pattern | Regex `\[Doc-\d+\]` only | Strip every `[Doc-` substring | Avoids damaging legitimate text; strip before escape, then normalize whitespace |
| Escaping shape | Single `_pdf_escape(value)` on interpolated data only | Escape whole strings | Escaping whole strings would break intentional `<b>...</b>` markup labels |
| Uncited referral-assertion label | Blunt "Needs source" / "Uncited — needs support" | Soft marker | Gate permits an uncited handoff assertion in a referral-grade package; label must be unambiguous |
| Test handoff_ready setup | Set on model directly (or PATCH via update serializer) | Pass to `ThreadElementCreateSerializer` | Create serializer silently drops `handoff_ready`; assertion would land in the wrong section |

---

## Research Summary

**Market Context**
Internal tooling, so market research is light, but one precedent is directly relevant: IC analytic
tradecraft (ICD 203) mandates that sourced reporting be visually/structurally distinguished from
analytic judgment, and SARs / prosecution referral memos follow the same fact-then-analysis fencing.
The chosen design (fenced Analysis with an explicit "investigator interpretation" header) conforms to
the convention the subpoena-power audience already trusts — confirming rather than inventing.

**Technical Context**
The renderer to replace is `_build_findings_section` (`referral_export.py:391–482`), which prints
`finding.narrative` under a hardcoded "Analysis:" label. `generate()` (line 110) already receives a
referral-grade-filtered `findings` queryset, so selection is untouched. The assertion data
(`ThreadElement`, `ThreadElementCitation`, `models.py:1425–1483`) and the role predicates
(`thread_elements.py`, already gate-wired) exist — making this an additive renderer swap behind
`Finding.gate_version`. Feasibility is HIGH; the main discipline is reusing the citation predicate so
the PDF and gate never disagree.

---

*Generated: 2026-06-27*
*Status: DRAFT - needs validation*
