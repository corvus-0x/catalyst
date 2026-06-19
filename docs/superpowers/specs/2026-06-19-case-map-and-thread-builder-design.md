# Case Map and Thread Builder Redesign

**Date:** 2026-06-19 (rev. 2026-06-19 — promoted to controlling plan)
**Status:** **CONTROLLING PLAN** — supersedes/absorbs the context-panel work; ready to plan Phase 1A + 1B
**Scope:** Frontend product language, Case Map workspace, relationship strength, graph visual system, inspector pattern, and Thread Builder direction

> ### Relationship to other specs
> - **Controls** `2026-06-19-context-panel-three-state-design.md`, which is now **partially
>   superseded**. That spec's **focus reducer** (context owns Investigate navigation;
>   `navStack` deleted) and **"What's Missing" panel** are **kept** and absorbed into Phase 2
>   / §9 here. Its **state-swap / canvas-hidden layout is dropped** in favor of the persistent
>   Case Map + right inspector defined in §5.
> - **Refines, does not replace** `docs/architecture/case-workspace-design.md` (the
>   confirmation-centered reframe) and `frontend-design-spec.md` (shipped behavior). Update
>   those section-by-section as phases land.
> - **Vocabulary supersedes** the locked frontend vocabulary table in `CLAUDE.md` once Phase
>   1A's doc-alignment task ships (see §2 "Vocabulary source of truth").

> ### What this revision locked (2026-06-19)
> 1. Case Map spec is the **controlling plan**; context-panel spec marked partially superseded.
> 2. **Phase 1 split** into **1A** (`/case-map/` backend contract + relationship-strength
>    builder) and **1B** (visual Case Map foundation consuming 1A). 1B depends on 1A.
> 3. **Endpoint split locked:** new `/api/cases/:id/case-map/` feeds the visible Case Map;
>    `/graph/` stays as-is for Timeline/legacy until a later cleanup (resolves §12 Q5).
> 4. **Focus reducer is kept**, but `focusEntity`/`focusRelationship`/`focusThread` render
>    inspectors **beside a visible map**, not full-width swaps (see §5.1).
> 5. **Locked v1 `/case-map/` contract** added (§4 "Locked v1 contract").
> 6. **Property-transaction subject-pair summarization** called out as the core builder
>    challenge (§4 "Property transaction summarization").
> 7. **Phase 1 test plan** added (§11A test plan), incl. strength levels + SR-path attachment.
> 8. **Strength levels locked** to `observed | documented | repeated | material` (resolves
>    §12 Q2).

## 1. Purpose

Catalyst is moving from an ad hoc investigation tool into a professional investigation workbench for citizen investigators building defensible handoff packages. The frontend should feel closer to an investigative journalism platform than a generic graph demo or compliance dashboard.

The current frontend has the right core workflow, but some of the language and visual choices still feel like internal scaffolding
- `Angle` and `Knot` helped describe the puzzle model, but they do not sound like referral or investigation package language.
- The graph can feel clip-art-like because nodes use pictogram icons, bright categorical colors, and prototype-style toolbar glyphs.
- The Case Map disappears during drill-down, which weakens the spatial investigation model.

This redesign should make Catalyst feel serious, evidence-first, and built for assembling a handoff package.

## 2. Product Voice Direction

The preferred voice is **investigative journalism / public accountability**, not law enforcement command software and not internal compliance software.

The product should sound neutral, careful, and evidence-grounded. It should help a citizen investigator organize and substantiate concerns without pretending the user has agency authority.

### Proposed User-Facing Vocabulary

| Current term | Proposed term | Rationale |
|---|---|---|
| Web | **Case Map** | Clear, professional, still spatial. |
| Knot | **Subject** | Neutral term for a person or organization of interest. |
| Angle | **Thread** | Journalism-native term for a line of inquiry. Less legalistic than Finding. |
| Connection | **Relationship** | Plain factual link between subjects. |
| Quick capture | **Observation** | A noticed item that may or may not become part of a thread. |
| Lead | **Lead** | Already fits journalism vocabulary; use only for suggestions, not facts. |
| Confirmed | **Substantiated** | Stronger and more precise for a thread supported by cited sources. |
| Dismissed / Exhausted | **Set Aside** | Reversible investigative judgment. A thread can return if new sources or rules make it relevant again. |
| Referral package | **Handoff Package** for workflow; **Referral Package** for agency export | Handoff is neutral; referral is specific to AG/IRS/FBI-style export. |

Backend model names do not need to change. This is a frontend copy, component naming, and documentation alignment pass unless a later implementation plan explicitly chooses otherwise.

### Locked Language Decisions

- Use **Handoff Package** as the general product/workflow term.
- Use **Referral Package** when referring specifically to an agency-directed export.
- Use **Set Aside** for threads that are not currently being developed.
- Set Aside is not final deletion. New documents, relationships, or signal-rule activity may bring a thread back into active work.
- Use **Thread** throughout the active workspace.
- Use **Finding** only where a formal package/export needs more official language.
- Treat the "red string on a cork board" as a conceptual metaphor only. Do not render literal corkboard, pins, yarn, tape, paper scraps, or detective-wall imagery.

### Vocabulary source of truth

The new vocabulary is **not** real until the project's source-of-truth docs say so. Today
`CLAUDE.md` (FRONTEND VOCABULARY table) locks `Angle / Knot / Web / Connection`, so every
implementation agent will keep "correcting" the new language back unless that table is updated
first.

**Locked plan:**
- **Phase 1A includes a doc-alignment task** that rewrites the `CLAUDE.md` FRONTEND
  VOCABULARY table (and any `AGENTS.md`) to the new terms — *before* component work in 1B/2 —
  so naming stops drifting. Backend model names (`Finding`, `Person`, `Organization`,
  `Relationship`) are unchanged; only user-facing copy, component names, and docs move.
- Until that task ships, **no partial rename** in code (avoids a half-migrated vocabulary).
- The `CLAUDE.md` table gains a column noting the *backend* model each term maps to, so the
  Subject↔Person/Org and Thread↔Finding bridges stay legible in API calls and types.

## 3. Core Experience

The primary workspace should be:

> Open the Case Map. Select a Subject. Review Relationships. Build a Thread. Cite Sources. Check substantiation. Export a defensible handoff package.

The frontend should stop feeling like separate feature tabs and start feeling like a case workbench:

- **Case Map** is the persistent spatial map.
- **Inspector** is the work surface for selected subjects, relationships, threads, and sources.
- **Thread Builder** is the structured surface for turning evidence into a substantiated investigative line.
- **Referral readiness / handoff readiness** is the output meter.

## 4. Case Map Direction

The Case Map should feel like an analytical instrument, not an illustrated org chart.

### Visual Direction

- Use abstract node markers instead of pictogram icons.
- Use shape/ring/line treatment for subject type.
- Reserve strong colors for investigative meaning: severity, blocker, readiness, selected state.
- Keep default graph colors quiet and neutral.
- Labels should be clean, small, and stable.
- Edges should carry the strongest meaning because relationships and evidence are the point of the map.

### Node Direction

Potential marker language:

- Person subject: small circle or ring.
- Organization subject: square, diamond, or squared ring.
- Unknown/shell entity: double ring, broken outline, or warning accent.
- Selected subject: clear focus ring.
- Subject with active thread: small status tick or compact badge.
- Subject with substantiated thread: subtle ready indicator.

Avoid:

- Cartoon person/building pictograms.
- Large colorful nodes unless the size encodes meaningful investigation weight.
- Color as the primary entity-type language.

### Edge Direction

Relationships should visually answer:

- Is this relationship confirmed, proposed, or manual?
- Does it have cited source support?
- Does it participate in a thread?
- Is the thread critical/high/medium?
- Is this relationship part of the handoff package?

Severity and substantiation should be visible primarily through edge treatment.

### Relationship Summary Model

The visible Case Map should use **one summarized relationship line per subject pair**.

This is a deliberate product decision. The map should not show a separate edge for every raw database relationship when those relationships connect the same two subjects. That quickly becomes noisy and makes the UI feel technical rather than investigative.

Instead, the visible line between two subjects should summarize all known relationship evidence between them:

- source document co-mentions,
- officer / board / employee roles,
- property transactions,
- family or personal relationships,
- business associations,
- shared addresses,
- UCC / lien / financial instrument links,
- threads that cite or rely on the relationship.

The Relationship Inspector then explains the underlying evidence behind the summarized line.

This gives the user a cleaner map:

> One line answers "these subjects are connected"; the inspector answers "how, how strongly, and according to which sources."

### Visible Line Creation Rule

A summarized relationship line appears between two Subjects when at least one of these exists:

- shared source document / co-mention,
- formal role such as officer, board member, employee, or registered agent,
- direct transaction relationship,
- family or personal relationship,
- business association,
- shared address,
- financial link such as UCC, lien, debtor, secured party, or signer,
- thread references both subjects.

Starting strength by source type:

| Evidence source | Starting level |
|---|---|
| Co-mention only | `observed` |
| Formal role | `documented` |
| Direct transaction | `documented` |
| Shared address alone | `observed` |
| Source-backed family/personal relationship | `documented` |
| Source-backed business association | `documented` |
| Source-backed financial link | `documented` |
| Developing thread reference | Adds relevance, does not create `material` |
| Substantiated/handoff-ready thread reference | Can elevate to `material` |

Thread references may create or strengthen a line, but `material` still requires substantiated or handoff-ready thread relevance.

### Relationship Strength

The Case Map needs a backend-provided relationship-strength summary. The frontend should not infer relationship importance from scattered metadata alone.

Relationship strength means:

> How documented, repeated, formal, or thread-relevant the relationship is.

It does **not** mean:

> The subject is accused of wrongdoing.

The product rule is:

> Color the claim, not the person. Weight the relationship, not the subject.

The backend already exposes some raw ingredients on graph edges (`relationship`, `weight`, `metadata.document_ids`, role metadata, transaction metadata, manual relationship confidence, and `finding_links`), but the frontend needs a unified object that explains the strength of a subject-to-subject relationship.

Current backend ingredients:

| Source | Current backend support | Use in relationship strength |
|---|---|---|
| Shared source documents | `CO_APPEARS_IN` edges with `metadata.document_ids` and `weight` | Counts source-backed co-mentions. |
| Person/org role | `PersonOrganization` → `OFFICER_OF` edge with role/date metadata | Formal relationship evidence. |
| Property transactions | `PropertyTransaction` → `PURCHASED` / `SOLD_BY` edges through property nodes | Direct transaction evidence; needs subject-pair summarization because properties may not be shown as subject nodes. |
| Manual/person relationships | `Relationship` rows with type/source/confidence/notes | Family, personal, business, or observed relationships. |
| Threads/findings | `finding_links` attached to graph edge pairs | Shows whether a thread relies on the relationship. |

Missing backend layer:

- A subject-pair relationship summary that merges those ingredients into one explainable edge.
- A strength level and reason list.
- Category counts and supporting source references.
- Thread/handoff relevance separated from raw relationship existence.

Proposed graph edge addition:

```json
"strength": {
  "score": 72,
  "level": "repeated",
  "source_count": 4,
  "transaction_count": 2,
  "role_count": 1,
  "thread_count": 2,
  "substantiated_thread_count": 1,
  "handoff_included": false,
  "relationship_types": ["OFFICER_OF", "CO_APPEARS_IN", "PURCHASED"],
  "categories": ["formal_role", "co_mentioned", "transaction", "thread_referenced"],
  "reasons": [
    "Board role documented",
    "Appears together in 4 source documents",
    "2 property transactions",
    "Referenced by 1 substantiated thread"
  ]
}
```

The first version should favor explainability over mathematical precision. The inspector must be able to show why a relationship appears strong.

### Relationship Evidence Categories

Use neutral category names. These describe evidence type, not culpability.

| Category | Meaning | Example reason |
|---|---|---|
| `co_mentioned` | Subjects appear in the same source document. | "Appears together in 4 source documents." |
| `formal_role` | A person holds a documented role with an organization. | "Board role documented in Form 990." |
| `transaction` | Subjects are connected through a property or financial transaction. | "2 property transactions connect these subjects." |
| `family_or_personal` | Public record or investigator-entered personal relationship. | "Family relationship recorded from public source." |
| `business_association` | Shared business role, partner relationship, or operating association. | "Business association from SOS filing." |
| `shared_address` | Subjects share a normalized address. | "Shared mailing address appears in public filings." |
| `financial_link` | UCC, lien, secured party/debtor, or financial instrument relationship. | "UCC lien links debtor and secured party." |
| `thread_referenced` | Relationship is referenced by one or more investigative threads. | "Referenced by 1 substantiated thread." |

### Relationship Strength Levels

Use evidence-based labels rather than accusatory labels like weak/strong when possible.

Recommended levels:

| Level | Meaning | Visual intent |
|---|---|---|
| `observed` | One source, low-confidence observation, or simple co-mention. | Thin neutral line. |
| `documented` | At least one direct source-backed role, relationship, or transaction. | Solid neutral line. |
| `repeated` | Multiple sources, repeated transactions, time-separated records, or multiple relationship categories. | Thicker neutral line. |
| `material` | Relationship is central to a substantiated or handoff-ready thread. | Strong line with thread emphasis when relevant. |

This language is safer than `weak`, `moderate`, `strong`, `material` because it explains the evidentiary basis without implying the subject did anything improper.

Locked rule:

> Raw relationship evidence can reach `repeated`, but it cannot reach `material` by itself. `material` requires a substantiated or handoff-ready thread that relies on the relationship.

This prevents the map from implying investigative significance just because two subjects appear together often. Repetition is evidence strength; materiality is handoff relevance.

### First Scoring Formula

The first formula should be deterministic, explainable, and easy to test. It should produce both a score and reasons.

Suggested point model:

| Evidence | Points | Notes |
|---|---:|---|
| First shared source document | 10 | Simple co-mention. |
| Additional shared source documents | +5 each, max +20 | Repetition matters, capped to avoid document spam. |
| Formal role | +30 | Board member, officer, employee, registered agent, etc. |
| Direct transaction | +25 each, max +50 | Property sale, purchase, grantor/grantee, lien, debtor/secured party. |
| Family/personal relationship | +25 | Only when source-backed or explicitly investigator-entered. |
| Business association | +25 | SOS role, partner link, shared business address, etc. |
| Shared address | +15 | Supports nexus but should not dominate by itself. |
| Financial link | +25 | UCC/lien/debtor/secured party. |
| Developing thread references relationship | +10 | Thread is not yet substantiated. |
| Substantiated thread references relationship | +25 | Relationship has investigative significance. |
| Included in handoff package | +35 | Only after substantiation gate passes. |

Suggested thresholds:

| Score | Level |
|---:|---|
| 0-19 | `observed` |
| 20-49 | `documented` |
| 50-79 | `repeated` |
| 80+ with substantiated/handoff thread relevance | `material` |

Important scoring rules:

- A relationship can be visually `material` because of thread/handoff relevance, but the inspector must explain that materiality comes from a thread, not from the subject alone.
- A relationship without substantiated/handoff thread relevance is capped at `repeated`, even if its raw score exceeds 80.
- The score should never be shown as a moral judgment. Prefer showing the level and reasons.
- The score can be internal for sorting and visual thickness; reasons are the user-facing truth.
- Caps prevent a large document batch from overweighting simple co-mentions.

Suggested visual mapping:

- `observed` — thin neutral line; one source or low-confidence observation.
- `documented` — solid neutral line; direct source-backed relationship.
- `repeated` — thicker neutral line; repeated records or multiple categories.
- `material` — strong line plus thread emphasis; relationship is central to a substantiated or handoff-ready thread.

Thread severity may add amber/coral emphasis, but the base relationship strength should stay neutral unless a thread/claim is selected.

### Proposed API Shape

> **Note (rev. 2026-06-19):** the JSON below is the original *illustrative* draft. The
> **binding** shape is the **"Locked v1 `/case-map/` contract"** later in this section — where
> field names and invariants are fixed (e.g. `state` uses the four-value
> `observed|documented|repeated|material` vocabulary, not the draft's `source_backed`). Where
> the two differ, the locked contract governs.

The preferred implementation is a new summarized Case Map endpoint:

```text
GET /api/cases/:id/case-map/
```

Reasoning:

- The existing `/api/cases/:id/graph/` endpoint is a raw graph/timeline endpoint and already has consumers.
- The Case Map needs a higher-level subject-pair relationship summary, not just raw relationship edges.
- A new endpoint avoids breaking current graph/timeline behavior while giving the professional workspace a purpose-built contract.
- The old endpoint can remain available for legacy graph consumers and timeline events.

The Case Map endpoint should return subject nodes and summarized relationship edges. It should not need to expose property and financial-instrument nodes as primary visible nodes in the first pass, but it should use those records to build relationship evidence.

Proposed edge shape:

```json
{
  "id": "subject-a__subject-b",
  "source": "uuid-subject-a",
  "target": "uuid-subject-b",
  "relationship": "SUMMARY",
  "label": "Documented relationship",
  "weight": 3,
  "state": "source_backed",
  "strength": {
    "score": 64,
    "level": "repeated",
    "categories": ["formal_role", "co_mentioned", "transaction"],
    "source_count": 4,
    "transaction_count": 1,
    "role_count": 1,
    "thread_count": 1,
    "substantiated_thread_count": 0,
    "handoff_included": false,
    "relationship_types": ["OFFICER_OF", "CO_APPEARS_IN", "PURCHASED"],
    "reasons": [
      "Board role documented",
      "Appears together in 4 source documents",
      "1 property transaction connects these subjects"
    ]
  },
  "evidence_refs": [
    {
      "kind": "source_document",
      "document_id": "uuid",
      "label": "Form 990 - 2022",
      "category": "formal_role"
    }
  ],
  "thread_refs": [
    {
      "thread_id": "uuid",
      "title": "Property transfer pattern",
      "status": "NEEDS_EVIDENCE",
      "severity": "HIGH",
      "rule_id": "SR-015",
      "signal_type": "INSIDER_SWAP",
      "handoff_ready": false
    }
  ],
  "underlying_relationships": [
    {
      "kind": "OFFICER_OF",
      "label": "Board member",
      "source": "person_org",
      "source_id": "uuid"
    }
  ],
  "metadata": {}
}
```

The exact names can change in the implementation plan, but the contract must preserve:

- strength level,
- category list,
- reason list,
- source references,
- thread references,
- underlying relationship records for inspector drill-down.

For signal-rule-created threads/findings, the Case Map builder should not rely only on `FindingEntity.trigger_entity_id`. Some rules trigger on a property, document, or organization even though the visual Case Map needs to highlight a multi-subject path. The builder should also inspect `Finding.evidence_snapshot` and underlying relationship records to attach the signal to the relevant subject-pair summaries.

Examples:

- SR-015 may trigger on a property transaction, but the map path is insider subject -> organization and counterparty subject/entity -> transaction evidence.
- SR-025 may trigger on a 990 document or organization, but the map path is 990 denial -> related-party network -> property/transaction evidence.
- SR-028 may trigger on an organization and may not need a multi-subject path; the inspector should show it as organization/source evidence.
- SR-030 may trigger from Schedule L transactions and should link the disclosed party to matching subjects when available.

### Locked v1 `/case-map/` contract

This is the binding shape for Phase 1A so frontend and backend cannot drift. Field *names*
are now fixed; only additive changes are allowed without a spec revision.

**Endpoint:** `GET /api/cases/:id/case-map/` → `200`

**Top-level response:**

```json
{
  "case_id": "uuid",
  "nodes": [ /* SubjectNode */ ],
  "edges": [ /* SummaryEdge */ ],
  "stats": {
    "subject_count": 12,
    "edge_count": 18,
    "by_level": { "observed": 6, "documented": 7, "repeated": 4, "material": 1 },
    "material_edge_count": 1,
    "handoff_edge_count": 0,
    "generated_at": "ISO8601"
  }
}
```

**SubjectNode** (only `person` and `organization` are subjects; property and
financial-instrument records are *evidence*, never primary nodes in v1):

```json
{
  "id": "uuid",
  "type": "person" | "organization",
  "label": "display name",
  "subtype": "org_type or null",
  "flags": {
    "status_unknown": false,
    "has_active_thread": true,
    "has_substantiated_thread": false
  },
  "metadata": { "thread_count": 2, "document_count": 5 }
}
```

> **`flags.status_unknown`** is a **neutral data-completeness** flag — true when the org's
> registration `status` is `UNKNOWN`. It is **not** a shell-company accusation (per §10 "color
> the claim, not the person"); the UI should treat it as "status not yet established," not as a
> warning. (Renamed from the earlier `unknown_or_shell`, which read as an accusation and would
> have flagged every freshly-created org, since `Organization.status` defaults to `UNKNOWN`.)

**SummaryEdge** — exactly one per unordered subject pair (see edge-id stability):

```json
{
  "id": "subjectMin__subjectMax",
  "source": "subjectMin",
  "target": "subjectMax",
  "relationship": "SUMMARY",
  "label": "Documented relationship",
  "state": "observed | documented | repeated | material",
  "strength": {
    "score": 64,
    "level": "observed | documented | repeated | material",
    "categories": ["formal_role", "co_mentioned", "transaction"],
    "source_count": 4,
    "transaction_count": 1,
    "role_count": 1,
    "thread_count": 1,
    "substantiated_thread_count": 0,
    "handoff_included": false,
    "relationship_types": ["OFFICER_OF", "CO_APPEARS_IN", "PURCHASED"],
    "reasons": ["Board role documented", "Appears together in 4 source documents"]
  },
  "evidence_refs": [
    { "kind": "source_document", "document_id": "uuid", "label": "Form 990 — 2022", "category": "formal_role" }
  ],
  "thread_refs": [
    { "thread_id": "uuid", "title": "…", "status": "NEEDS_EVIDENCE", "severity": "HIGH",
      "rule_id": "SR-015", "signal_type": "INSIDER_SWAP", "handoff_ready": false }
  ],
  "underlying_relationships": [
    { "kind": "OFFICER_OF", "label": "Board member", "source": "person_org", "source_id": "uuid" }
  ]
}
```

**Locked field semantics** (these are the exact predicates the 1A builder implements):

- **`thread_ref.handoff_ready`** = the **referral-grade tie-off predicate**
  (`referral_grade.is_referral_grade` / `referral_grade_qs`), i.e. CONFIRMED ∧ ≥1 cited
  document ∧ weight ∈ {DOCUMENTED, TRACED} ∧ `overreach_reviewed`. **Not** `status ==
  CONFIRMED`. This keeps the Case Map aligned with the existing tie-off gate.
- **`strength.substantiated_thread_count`** = count of linked threads with **`status ==
  CONFIRMED`** (user-facing "Substantiated"). This is the *broader* set — a thread can be
  Substantiated without yet being handoff-ready.
- **`strength.handoff_included`** = `true` iff **at least one** linked thread is
  `handoff_ready` (full package-ready predicate above) **and** the relationship is part of that
  thread's cited evidence. This is the field that may elevate `level` to `material`.
- **Elevation rule restated precisely:** `material` requires
  `substantiated_thread_count ≥ 1` **and** that the substantiated/handoff thread relies on this
  relationship. A `CONFIRMED`-but-not-handoff-ready thread can still elevate to `material`
  (substantiated is enough for materiality); `handoff_included` is a *stronger* signal used for
  edge emphasis and package status, not a precondition for `material`.
- **`node.flags.has_substantiated_thread`** / **`metadata.thread_count`** use the same
  CONFIRMED definition as `substantiated_thread_count`.
- **`underlying_relationships[].source`** is a locked enum: `person_org` · `co_mention` ·
  `property_transaction` · `manual_relationship` · `shared_address` · `financial_instrument` ·
  `thread_reference`. **`category`** values (on `evidence_refs` and in `strength.categories`)
  remain the §"Relationship Evidence Categories" set: `co_mentioned` · `formal_role` ·
  `transaction` · `family_or_personal` · `business_association` · `shared_address` ·
  `financial_link` · `thread_referenced`.

**Locked invariants:**

1. **Edge id stability.** `id = "{minId}__{maxId}"` where `minId`/`maxId` are the two subject
   UUIDs sorted lexicographically. The id is therefore **order-independent and stable** across
   reloads, so the frontend can key selection/focus state off it. `source`/`target` follow the
   same sort. (This differs from the raw `/graph/` edge id, which encodes relationship type.)
2. **One edge per subject pair.** All underlying relationship records between the two subjects
   collapse into this single edge; `underlying_relationships` carries the un-summarized list
   for inspector drill-down.
3. **`level` ↔ `state` agree.** `state` mirrors `strength.level`; both use the same four-value
   vocabulary. (`state` exists for parity with the raw graph edge shape; consumers should read
   `strength.level`.)
4. **`material` requires thread relevance.** Per §"First Scoring Formula": raw evidence caps at
   `repeated`; only a substantiated/handoff-ready `thread_ref` elevates to `material`. The
   builder enforces this after scoring, not in the threshold table.
5. **Reasons are user-facing truth; score is internal.** `score` drives sort + edge thickness
   only; the inspector shows `level` + `reasons`, never a bare number as judgment.
6. **No PII beyond what `/graph/` already exposes.** Same auth/serialization guarantees as the
   existing graph endpoint.

### Property transaction summarization (core builder challenge)

The raw graph routes property transactions through **property nodes** (`subject —PURCHASED→
property ←SOLD_BY— counterparty`). The Case Map has **no property nodes**, but it must still
show a **subject-to-subject** relationship line carrying that transaction as evidence.

**Builder rule:** for each `PropertyTransaction`, resolve the buyer subject and the seller
subject (both must resolve to a `person`/`organization` subject in the case), and attribute the
transaction to **that subject pair's** summary edge as a `transaction` category with a
`transaction`-kind `evidence_ref` (the property is named in the ref label, not as a node). If
only one side resolves to a subject (e.g. an out-of-case seller), the transaction contributes to
the resolved subject's `metadata` but creates no edge. This is the trickiest part of 1A and
gets dedicated tests (§11A).

The same "trigger may sit on a non-subject record" problem applies to signal rules: the builder
must consult `Finding.evidence_snapshot` and underlying relationship records — **not only**
`FindingEntity.trigger_entity_id` — to attach a `thread_ref` to the correct subject-pair edge
(e.g. SR-015 triggers on a property transaction but the map path is insider→org and
counterparty→transaction).

## 5. Persistent Workspace

The Case Map should remain visible during drill-down.

Current behavior replaces the graph with Profile / Angle views. The new direction should preserve map context:

- Clicking a Subject opens a Subject Inspector while keeping the Case Map visible.
- Clicking a Relationship opens a Relationship Inspector.
- Opening a Thread should either open a Thread Inspector or a larger Thread Builder panel while the map remains present, dimmed, or reduced.
- Document view can still take more space, but the user should not lose the investigation context entirely.

This is the biggest platform-feel improvement. The user should feel like they are moving through a case map, not jumping between disconnected pages.

### Focus reducer (absorbed from the context-panel spec)

The mechanism is the **focus reducer** from `2026-06-19-context-panel-three-state-design.md`:
`CaseWorkspaceContext` owns Investigate-tab navigation via `useReducer`, and the local
`navStack` in `InvestigateTab` is deleted. What changes from that spec is **what each focus
action renders** — beside a still-visible map, not as a full-width swap:

| Action | Old (superseded) | New (this plan) |
|--------|------------------|-----------------|
| `focusEntity(subject)` | full-width `ProfilePanel` | **Subject Inspector** in the right panel; **map stays visible**, selected subject gets a focus ring |
| `focusRelationship(edgeId)` | n/a (edge was local state) | selects the summarized `/case-map/` edge → **Relationship Inspector** in the right panel; map stays visible |
| `focusThread(thread)` | full-width `AngleView` | **Thread Path Mode** (§7): highlight the thread's relationships, dim the rest, show thread summary in the inspector; an **"Open full Thread"** action navigates to the existing `AngleView` (full-width) until Phase 4 |
| `focusDocument(doc)` | full-width `DocumentView` | unchanged — document may take the larger area, but the inspector context persists |
| `goBack` / `goTo` | history truncation + pointer recompute | unchanged; the pointer-recompute invariant (active thread persists while drilling into a document opened from it) still holds |

So `selectedConnection` from the context-panel spec is generalized to a focus frame backed by
the **stable `/case-map/` edge id** (§4 locked invariant 1). The "What's Missing" panel becomes
the §9 readiness module. The reducer's transitions and the pointer-recompute rule carry over
verbatim — only the rendered surface and the persistent-map layout change.

### First Implementation Scope

The first implementation pass should be **Case Map workspace redesign**:

- Replace node pictograms with abstract markers.
- Reduce graph colors and reserve strong color for investigative meaning.
- Replace toolbar glyphs/emoji with Lucide icons.
- Improve edge styling for relationship status, severity, and thread involvement.
- Keep the Case Map visible while opening Subject and Relationship inspectors.
- Begin converting Profile and Connection detail into a shared right-inspector pattern.
- Defer the full Thread Builder redesign to a later phase.

This scope is intentionally larger than a cosmetic graph restyle but smaller than a full workspace + Thread Builder rewrite.

### Layout Decision

The first redesign should use **right inspector only**.

Do not start with a full command-center layout with a left queue. The graph needs visual authority first. A left queue/worklist can be added later if the workspace needs it.

First-pass layout:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Case header / tabs / compact handoff readiness                       │
├──────┬───────────────────────────────────────────────┬──────────────┤
│ Tool │                                               │ Right        │
│ rail │                 Case Map                      │ Inspector    │
│      │                                               │              │
└──────┴───────────────────────────────────────────────┴──────────────┘
```

Recommended first-pass inspector width: fixed 320-360px. Make it collapsible later if needed, but avoid resizable panels in the first implementation.

## 6. Inspector System

Every selected item should use the same inspector grammar.

### Inspector Sections

1. **Identity** — what is this item?
2. **Source Trail** — what documents support it?
3. **Relationships** — what subjects or links are connected?
4. **Threads** — what investigative threads use it?
5. **Gaps** — what is missing or unresolved?
6. **Actions** — cite, observe, open, add to thread, set aside, export where relevant.

The inspector should support four selected item types:

- Subject
- Relationship
- Thread
- Source document

The same visual grammar should repeat across all four, so the app feels like one platform instead of separate screens.

### Subject Inspector

The first Subject Inspector should show:

1. **Identity**
   - subject name,
   - subject type,
   - known aliases / EIN / status where available,
   - neutral source presence counts.

2. **Relationship Summary**
   - total relationships,
   - strongest relationship level,
   - categories present,
   - top related subjects.

3. **Source Trail**
   - related source documents,
   - document type,
   - context notes where available.

4. **Threads**
   - developing threads involving the subject,
   - substantiated threads involving the subject,
   - set-aside threads if relevant.

5. **Observations**
   - investigator observations attached to the subject.

6. **Actions**
   - add observation,
   - start thread from subject,
   - cite subject/source into active thread,
   - open full source.

Important copy rule:

> The subject inspector must not label a person or organization as suspicious. It should describe record presence, relationships, and thread usage.

### Relationship Inspector

The first Relationship Inspector is the most important inspector for the Case Map.

It should show:

1. **Summary**
   - subject A,
   - subject B,
   - relationship strength level,
   - neutral explanation line.

2. **Why this line exists**
   - `strength.reasons`,
   - grouped by category.

3. **Source Trail**
   - supporting source documents,
   - page references/context notes when available,
   - source category.

4. **Underlying Evidence**
   - formal roles,
   - transactions,
   - family/personal/business links,
   - shared address or financial links,
   - co-mentions.

5. **Threads using this relationship**
   - developing threads,
   - substantiated threads,
   - handoff-included status.

6. **Unresolved Questions**
   - optional manually-authored questions or generated suggestions later,
   - should be phrased as questions, not allegations.

7. **Actions**
   - open source,
   - add observation,
   - start thread from relationship,
   - add relationship to active thread.

The inspector should include a stable explanatory note:

> Relationship strength reflects source support and investigative relevance. It does not imply wrongdoing by either subject.

### Thread Inspector / Future Thread Builder Bridge

The first Case Map pass does not need the full Thread Builder, but it should prepare for it.

When a Thread is selected from a Relationship or Subject inspector:

- the Case Map should highlight the relationships used by the thread,
- unrelated map elements should dim,
- the inspector should show thread status, cited sources, gaps, and handoff readiness,
- opening the full Thread Builder can still navigate to the current AngleView until the later redesign.

## 7. Thread Builder Direction

The current Angle view should evolve into a Thread Builder.

The Thread Builder should not just be a narrative textarea plus cited documents. It should help the investigator build an evidence-backed line of inquiry.

### Proposed Thread Builder Sections

- **Thread question / claim** — what is being investigated?
- **Narrative** — the written explanation, with source citations.
- **Cited sources** — attached documents and source references.
- **Key excerpts / facts** — the evidence fragments that support the thread.
- **Unresolved questions** — what a professional investigator may need subpoena power or interviews to answer.
- **Overreach check** — explicit acknowledgement that the thread stays within the cited record.
- **Substantiation status** — whether the thread is ready for handoff.

The Thread Builder should make this distinction visible:

- Fact
- Inference
- Unresolved question
- Handoff-ready claim

This distinction is central to Catalyst's defensibility.

### Thread Path Mode

The red-string metaphor should become **Thread Path Mode**, not literal red string.

When the user selects a thread:

- relationships used by the thread become the emphasized path,
- subjects attached to the thread receive a subtle selected/participating ring,
- unrelated relationships dim,
- cited sources appear in the inspector,
- severity color applies to the thread path only.

This supports storytelling and review without visually accusing every subject on the map.

Thread Path Mode should be read as:

> This is the path this thread currently relies on.

Not:

> Everyone on this path did something wrong.

## 8. Toolbar and Command Surface

The Case Map toolbar should stop using raw glyphs or emoji. Use a consistent icon system, preferably Lucide because the project already uses it elsewhere.

Expected toolbar actions:

- New thread
- Fit map
- Toggle minimap or overview
- Run Lead analysis
- Re-run rules
- Review pending relationships / matches
- Search or command palette

Buttons should be icon-first with tooltips and stable 32px dimensions.

Longer term, the command palette should become a serious workflow accelerator:

- Search case
- Open subject
- Open thread
- Cite source
- Add observation
- Review pending
- Open handoff readiness
- Run research

## 9. Readiness and Handoff Presence

Referral/handoff readiness should stay visible in a compact, non-intrusive way.

The user should always understand whether they are:

- Collecting fragments
- Building a thread
- Substantiating a thread
- Ready to export a handoff package

This can be a compact rail, header badge, or inspector module. It should not dominate the workspace, but it should be available without switching mental context.

## 10. Ethical and Evidentiary Guardrails

The Case Map must protect people who are merely present in records or caught in the crossfire, while still allowing Catalyst to make evidence-backed accusations when a Thread or signal rule supports them.

Required guardrails:

- Subjects are neutral by default.
- Relationship lines mean documented connection, not wrongdoing.
- Strong color belongs to claims, signal/thread severity, readiness blockers, and handoff status.
- Relationship strength describes source support and repetition, not guilt.
- Threads must distinguish facts, inferences, unresolved questions, and handoff-ready claims.
- Set Aside threads remain available and may return to active work if new sources or signal rules make them relevant.
- The UI should avoid unsupported accusation language: suspicious, guilty, fraudster, bad actor, criminal, cult, scammer.
- Accusatory language is allowed at the Thread/Finding layer when tied to cited evidence or a signal rule's persisted evidence snapshot.

Suggested explanatory copy for the Case Map help/legend:

> Case Map lines show relationships found in source records or entered observations. Line weight reflects documentation and repetition. Thread colors show investigative relevance. A relationship line does not imply wrongdoing.

### Signal Rule Tie-In

Signal rules are where Catalyst may make stronger claims. The Case Map should support those claims by showing the relationship path and source support behind them.

The distinction:

- **Relationship layer:** "These subjects are connected in records."
- **Signal / Thread layer:** "This connected structure supports a self-dealing, insider transaction, false disclosure, or other rule-specific concern."
- **Handoff layer:** "This substantiated thread is ready to include in the package."

This is not an anti-accusation standard. It is an evidence-placement standard:

> Do not imply wrongdoing from relationship presence alone. Do make the supported accusation clearly when a signal rule or substantiated thread proves it.

Relevant active signal patterns from `signal_rules.py`:

| Rule | Signal claim | Case Map support needed |
|---|---|---|
| SR-003 | Purchase price deviates from assessed value. | Property transaction evidence shown in relationship inspector; may support overpayment / undervalue thread. |
| SR-004 | UCC amendment burst. | Financial instrument evidence and timeline clustering. |
| SR-005 | Zero-consideration transfer. | Property transaction/source document evidence; may support self-dealing thread. |
| SR-006 | 990 says related-party question is Yes but Schedule L missing. | 990 source trail; governance/disclosure thread. |
| SR-012 | No conflict of interest policy. | Governance weakness context for self-dealing / related-party threads. |
| SR-013 | Principal officer reports zero compensation at high revenue. | Organization/officer relationship + 990 financial evidence. |
| SR-015 | Insider swap / related party on both sides of transaction. | Path: insider role -> related person/business -> property transaction. |
| SR-017 | Blanket UCC lien on charity-connected entity. | Path: charity-connected subject -> debtor/secured party/financial instrument. |
| SR-024 | Charity conduit pattern. | Path across transactions: charity buys from family-connected seller then transfers to insider/related party. |
| SR-025 | 990 denies related-party transactions but evidence contradicts. | Path: 990 denial + relationship network + transaction evidence. |
| SR-026 | 990 denies contractors but permit/source evidence contradicts. | Organization -> contractor relationship + permit/source documents. |
| SR-028 | Material diversion of assets self-disclosed on 990. | Organization + 990 source evidence; claim can be direct because the filing self-discloses it. |
| SR-029 | Low program expense ratio. | Financial snapshot evidence; may support non-mission spending thread. |
| SR-030 | Schedule L discloses related-party transactions. | Related-party transaction evidence; review whether arm's-length and properly authorized. |
| SR-031 | No independent board members. | Governance weakness context; supports conflict/control analysis. |

The Case Map API should expose enough thread/signal references for a relationship inspector to answer:

- Which signal rules touch this relationship?
- What claim does the rule make?
- Is the claim developing, substantiated, set aside, or handoff-ready?
- Which sources/evidence snapshots support it?
- Which relationship path did the rule rely on?

### Pattern Flags

Relationship and Subject inspectors may show **Pattern Flags** when a signal or thread uses the selected item.

Examples:

- Self-dealing pattern
- Insider transaction
- Related-party disclosure contradiction
- Gross overpayment / valuation deviation
- Material diversion self-disclosed
- Governance control gap
- UCC blanket lien / financial encumbrance
- Procurement contradiction

Pattern flags must link to the relevant Thread/Finding. They should not appear as free-floating accusations detached from evidence.

## 11. Implementation Phasing

This redesign should be planned as a complete path with a controlled first build slice.

### Phase 1A — `/case-map/` backend contract + relationship-strength builder

Backend only. Ships the locked v1 contract (§4) so 1B has real data to render. No frontend
visual work depends on guesswork.

- New `GET /api/cases/:id/case-map/` endpoint returning the §4 locked shape (nodes, summarized
  edges, stats). **Leave `/graph/` untouched** — Timeline and legacy consumers keep using it.
- Subject-pair **relationship-strength builder**: merge co-mentions, formal roles, transactions,
  manual relationships, financial links, shared address, and thread references into one
  `strength` object per pair (score + level + categories + reasons + counts).
- **Property-transaction summarization** (§4): resolve buyer/seller subjects, attribute the
  transaction to the subject-pair edge as `transaction` evidence; no property nodes.
- **Signal/thread attachment** beyond `trigger_entity_id`: consult `evidence_snapshot` +
  underlying relationships to attach `thread_refs` to the correct subject-pair edges.
- Enforce the **`material` cap rule** (raw evidence ≤ `repeated`; only substantiated/handoff
  thread relevance elevates).
- **Doc-alignment task** (§2 "Vocabulary source of truth"): update `CLAUDE.md` FRONTEND
  VOCABULARY (+ `AGENTS.md`) to the new terms with backend-mapping column, before 1B.

**1A fast-follow (separate small PR):** the `shared_address` collector (normalized `Address`
links), the `financial_link` collector (`FinancialInstrument` UCC / debtor / secured-party),
and the `business_association` split of `Relationship`. The scorer already supports these
fields; they default to zero until the collectors land, so the contract shape is unaffected.

### Phase 1B — Case Map visual foundation (consumes 1A)

Frontend, depends on 1A's endpoint.

- Point the Investigate Case Map at `/case-map/`; keep `/graph/` for Timeline.
- Replace pictogram nodes with **abstract markers** (shape/ring for subject type per §4 Node
  Direction).
- Replace toolbar glyphs/emoji with **Lucide icons** (stable 32px, tooltips).
- **Edge thickness from `strength.level`**; keep base edges quiet/neutral, reserving strong
  color for thread severity / blocker / handoff meaning.
- Map legend + the ethical explanatory copy (§10).

### Phase 1 test plan (§11A)

**Backend (relationship-strength builder) — locked cases:**
- co-mention only ⇒ `observed`
- single formal role ⇒ `documented`
- single direct transaction ⇒ `documented`
- multiple sources / multiple categories ⇒ `repeated`
- raw score ≥ 80 **without** a substantiated/handoff thread ⇒ still capped at `repeated`
- substantiated (or handoff-ready) thread reference ⇒ elevates to `material`
- additional-document cap (+5 each, max +20) and transaction cap (max +50) honored
- **property transaction** with both subjects in case ⇒ one subject-pair edge with `transaction`
  category + transaction `evidence_ref`; one-sided (out-of-case counterparty) ⇒ no edge
- **SR-015** (triggers on property txn) ⇒ `thread_ref` attached to the insider↔counterparty
  subject-pair edge, not only the trigger entity
- **SR-025** (triggers on 990/org) ⇒ `thread_ref` attached across the related-party subject pair
- edge-id stability: `"{minId}__{maxId}"` regardless of buyer/seller order
- contract shape: response validates against §4 (stats `by_level` sums to `edge_count`, etc.)

**Frontend (1B):** edge thickness maps to level; abstract markers render per subject type;
toolbar renders Lucide icons with accessible labels; map consumes `/case-map/` without touching
the Timeline's `/graph/` calls.

Backend tests run on Railway (Postgres + ArrayField); frontend tests run locally (Vitest).

### Phase 2 — Right Inspector Workspace

- Land the **focus reducer** (absorbed from the context-panel spec, §5.1): context owns
  Investigate navigation, `navStack` deleted.
- Keep Case Map visible when selecting subjects and relationships (right inspector, fixed
  320–360px).
- Convert current `ProfilePanel` into Subject Inspector behavior.
- Convert current `ConnectionDetailPanel` into Relationship Inspector behavior, keyed off the
  stable `/case-map/` edge id.
- Add the **"What's Missing" / readiness presence** module (§9), consuming the existing
  `referral-readiness` endpoint.
- Preserve current full `AngleView` navigation for threads ("Open full Thread") until the
  Thread Builder redesign (Phase 4).

### Phase 3 — Thread Path Mode

- Selecting a thread highlights its supporting relationships.
- Dim unrelated relationships.
- Show cited sources and substantiation gaps in inspector.
- Keep visual treatment analytical, not literal red string.

### Phase 4 — Thread Builder

- Replace the current AngleView with a structured Thread Builder.
- Separate claim/question, narrative, cited sources, key facts, unresolved questions, overreach check, and substantiation status.
- Align tie-off gate with Thread Builder language.

### Phase 5 — Advanced Investigation Controls

- Add map filters for relationship category, strength level, thread status, source type, and date range.
- Integrate Timeline brush with visible Case Map relationships.
- Add command palette actions for opening subjects, threads, sources, handoff readiness, and research.

## 12. Open Questions

**Resolved (2026-06-19):**

- **Q2 — strength levels:** ✅ **Locked** to `observed | documented | repeated | material`
  (§4, §"Relationship Strength Levels").
- **Q5 — endpoint strategy:** ✅ **Locked** — the Investigate **Case Map** reads `/case-map/`
  (Phase 1B); the **Timeline** and any legacy graph consumers keep reading `/graph/` unchanged.
  In other words, only the map surface moves to `/case-map/` in Phase 1 — `/graph/` is not
  modified and is not removed. A later cleanup pass can migrate remaining `/graph/` consumers.

**Still open — but do NOT block Phase 1A planning (they are 1B / Phase 2 detail):**

1. **(1B)** Exact node marker system for person, organization, unknown/shell, selected,
   developing-thread, and substantiated-thread states. Lock during 1B design.
3. **(Phase 2)** Exact first Subject Inspector field list (§6 gives the shape; finalize when
   building it).
4. **(Phase 2)** Exact first Relationship Inspector field list (§6 gives the shape).

## 13. Recommended Next Step

Locked and ready to plan (this revision):

- ✅ relationship-strength levels + thresholds + `material` cap rule,
- ✅ `/api/cases/:id/case-map/` v1 response contract (§4 "Locked v1 contract"),
- ✅ endpoint strategy (`/case-map/` for the map, `/graph/` for Timeline),
- ✅ Phase 1 split (1A backend, 1B visual) + Phase 1 test plan,
- ✅ vocabulary source-of-truth update sequenced into 1A.

Still to lock *at their phase* (not blocking 1A): node marker system (1B), inspector field
lists (Phase 2), Thread Builder structure (Phase 4).

**Next step:** convert **Phase 1A + 1B** into a step-by-step implementation plan
(TDD-first on the relationship-strength builder, using the §11A test cases as the red tests).
