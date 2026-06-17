# Case Workspace Design — the Confirmation-Centered Reframe (v2)

**Status:** Design (pre-build). Refines, does not replace, `frontend-design-spec.md`.
**Audience:** Anyone building or reviewing the case-detail frontend. Read with
`frontend-design-spec.md` (current component/graph spec) and `api-contract.md`.

> **No PII.** Distilled from a real investigation replay kept out of the repo. All
> case-specific names, EINs, addresses, and org names are deliberately excluded.

> **v2 incorporates two design reviews.** Changes from v1: realized *inside the Investigate
> tab* (not a shell rewrite); backend quality score kept (UI surfaces grade + counts);
> connectedness is a warning, not a gate; replay is a hybrid; dismissed findings are
> filter-gated in the workspace and opt-in to the package; added Angle-lifecycle, count-formula,
> recipient-gap, and shared-state sections; workspace gaps renamed `WS-GAP-*`.

---

## 0. Relationship to the existing frontend spec

This is an **evolution inside the Investigate tab**, not a new shell.

- The six-tab route shell (`CaseDetailView`: Investigate · Research · Financials · Timeline ·
  Referrals · Replay) and its routing/back-button behavior **stay unchanged**.
- The reframe is realized **within the Investigate tab** — which already is the web-home — by
  adding the context panel, the credibility header, shared selection state, and feeder actions.
- Financials, Timeline, Research, Documents remain their own surfaces (full screen space when
  open); they become **referential feeders** by gaining shared-context-aware actions, not by
  losing their views.
- Where this doc and `frontend-design-spec.md` disagree about the *internal* layout of the
  Investigate tab, this doc governs **once the corresponding piece is built**; until then the
  spec describes shipped behavior. Update the spec section-by-section as pieces land.

---

## 1. The organizing principle

**The confirmed Angle (Finding) is the atom of "done." The Web is the home surface of the
Investigate tab. Every other surface is a *feeder* into Angles — not a destination.**

- "Ready to refer" is measured in **confirmations**, never in completeness or phases.
- A case becomes referable when it has enough **referral-grade Angles**, even while most of
  the picture is still unknown.

```
        signal / lead / tip / document / research hit
                          │
                          ▼
                     ┌──────────┐
   feeds ───────────►│  ANGLE   │◄─────────── feeds
  (Research add,     │ (Finding)│   (Financials anomaly,
   Doc cite,         └────┬─────┘    Timeline event cite,
   graph connect)         │          signal rule fires)
                          ▼
        CONFIRM (tie-off gate) = substantiated + cited + weighted
                  + overreach-reviewed
                          │
                          ▼
                   REFERRAL PACKAGE
```

---

## 2. Why — the lessons that forced this model

Distilled from replaying one real end-to-end investigation:

1. **Accretive, unknown, growing denominator.** The case expanded from one subject to multiple
   counties and entities; you cannot know how many "pieces" exist at the start, and the count
   grows. **Any "% complete" gauge is a lie** — it would shrink as the case grew.
2. **Ready ≠ complete.** The real case was correctly referred with ~36 questions still open —
   those open questions ("requires subpoena," "FOIA the loan file") are **the recipient's job.**
   The investigator's job is credibility, not completeness.
3. **A fired signal rule is the *birth* of an Angle, not proof.** An auto-flagged CRITICAL
   finding turned out to be a misidentification and was dismissed. Substantiation counts, not
   firing.
4. **Non-linear.** ~14 main steps + ~9 dead-end branches with constant back-and-forth. A linear
   Intake→…→Refer "phase" model is the wrong shape and is rejected.

---

## 3. Layout — web-home + one context panel + referential feeders (inside Investigate)

```
┌─ Case Name ───── Credibility: N referral-grade · M need work · K agency leads ──── [status ▼] ─┐
│  (Investigate tab)                                                                              │
├──────────────────────────────────────────────────────────────┬─────────────────────────────────┤
│                    THE WEB  (home surface of Investigate)      │  CONTEXT PANEL (one panel,       │
│         knots + connections; confirmable shared-attribute      │  three states)                  │
│         edges auto-proposed (see WS-GAP-1)                     │  · idle  → CASE STATE /          │
│                                                                │           what's missing (2-kind)│
│                                                                │  · knot/connection selected →    │
│                                                                │           profile / detail       │
│                                                                │  · ANGLE active → convergence    │
│                                                                │           workspace → tie-off    │
└──────────────────────────────────────────────────────────────┴─────────────────────────────────┘

Feeders (own surfaces, full space when open): Research · Documents · Financials · Timeline
   referential, not prominent. Each result/row carries shared-context actions:
   Add to Case · Cite · Start Angle.  No dead-end toasts (see WS-GAP-7).
```

- **Web-home ≠ permanent split-screen.** The Web is the *default home surface of the Investigate
  tab* and the holder of persistent **shared context/actions** — it is **not** graph pixels
  overlaid on Financials/Timeline. Feeders keep their full dense-scanning space; what persists
  across them is the active selection + the action set, not the canvas.
- **One context panel, three states** (idle case-state / selected entity-or-connection / active
  Angle workspace). The Angle workspace is the convergence point and hosts the **tie-off** flow.

---

## 4. Angle lifecycle + the tie-off gate (the keystone)

Every header count and "ready" judgment derives from one precise predicate, so it is defined
first.

```
NEW ──► NEEDS_EVIDENCE ──► CONFIRMED        (tie-off gate)
   └────────────────────► DISMISSED         (rationale required)
```

- **NEW** — created from a signal firing, a manual add, an AI lead, or "Start Angle" from a
  feeder. No requirements.
- **NEEDS_EVIDENCE** — optional working state ("actively gathering").
- **CONFIRMED** — only via the **tie-off gate**, enforced in `TieOffModal`:
  - ≥1 cited document, **and**
  - `evidence_weight ≥ DOCUMENTED` (i.e. DOCUMENTED or TRACED), **and**
  - narrative present, **and**
  - **overreach checklist acknowledged** (see §7).
  - **Connectedness is a WARNING chip, not a blocker** (see §6).
- **DISMISSED** — requires a dismissal rationale (already enforced server-side). Dismissal has a
  **kind**: `ruled_out` (routine) or `correction` (was asserted, now retracted).

**Referral-grade (UI term)** = an Angle that is CONFIRMED with every tie-off condition met.
This is the only definition of "done."

---

## 5. Readiness — grade + counts in the UI, score kept in the API

The backend `quality.score` (dashboard/readiness) is **kept** and stays available in the API.
The **workspace** surfaces a **grade label + counts**, never `score/100`, to avoid
"get-it-to-100-then-refer" psychology.

> Credibility: **N referral-grade · M need work · K agency leads**

### Count formulas (header = Angle-level + leads only)
```
referral-grade = Angles where CONFIRMED ∧ ≥1 citation ∧ weight∈{DOCUMENTED,TRACED}
                                ∧ overreach acknowledged
need-work      = Angles where status∈{NEW,NEEDS_EVIDENCE}  OR  (CONFIRMED ∧ tie-off unmet)
                 (excludes DISMISSED)
agency-leads   = open RecipientGap items (§8)
```
Case-level blockers are **not** in the header — they live in the idle "what's missing" panel:
`pending Intake docs · pending fuzzy matches · confirmed Angles missing a confirmable connection (warn)`.

### Two kinds of "missing" — only one gates readiness
| Kind | Examples | Effect |
|------|----------|--------|
| **Investigator-closable** | uncited confirmed Angle; research hit not added; OCR pending; Angle below DOCUMENTED | **Lowers readiness** |
| **Recipient gap (subpoena/FOIA)** | bank records, payroll, loan files, agency records | **Does NOT block** — becomes an agency lead (§8) |

---

## 6. "Web-embedded" — confirmable edges only (warning, not gate)

Connectedness uses **confirmable edges only**:
- a manual **Relationship**, an **accepted FuzzyMatchCandidate**, a **PersonOrganization** role,
  or a **PropertyTransaction** edge.
- **Excludes `CO_APPEARS_IN`** (synthetic; cannot be confirmed/dismissed).

For now connectedness is a **warning** on an otherwise referral-grade Angle, not a hard gate. A
missing/synthetic-only connection becomes one of the **open questions delivered to the agency**,
consistent with "ready ≠ complete." It can graduate to a gate later if a precise stored meaning
of "reviewed connection" is added.

---

## 7. Hard requirements

1. **Dismissed stays visible — but quiet.**
   - **Workspace:** visible **behind a filter** (default hidden; "show dismissed" toggle).
   - **Package:** **opt-in appendix** — the investigator selects which dismissed items appear,
     shown as either "checked and ruled out" or "correction." Not automatic (avoids noise the
     badge-holder customer does not want). Current export remains confirmed
     DOCUMENTED/TRACED-only by default.
2. **Overreach standard = tie-off checklist (not auto-enforced yet).** At tie-off the investigator
   acknowledges:
   - narrative states only what the cited documents establish;
   - inferences are labeled as questions/leads, not conclusions;
   - name/address/timing matches are caveated when identity is not proven.
   This is a **visible checklist / narrative-lint affordance**, not automatic gating, until a
   stored `overreach_reviewed` signal exists on Finding. (The AI eval harness already polices
   overreach on the model side.)
3. **Provenance preserved.** Every Angle/thread records who originated it — investigator, AI
   lead, or external tip — surfaced in the replay/timeline and the package.

---

## 8. Recipient gaps / agency leads (new lightweight model)

The subpoena/FOIA "missing" needs a home. Add a small model:

```
RecipientGap {
  case:           FK
  gap_type:       e.g. bank_records | payroll | loan_file | agency_record | other
  rationale:      why this matters (free text)
  cited_document: FK → Document  (optional — the doc that implies the gap)
  target_agency:  which referral target it serves
  status:         OPEN | PROVIDED
  created_by:     provenance
}
```
- Surfaces in the workspace "what's missing" as **non-blocking**.
- Becomes the **"Leads for the agency"** section of the referral package.
- (YELLOW: new data model — confirmed for build.)

---

## 9. Shared action/state model (the "in unison" mechanism)

Case-detail context holds **`activeEntityId`** and **`activeAngleId`** (partially exists today
as `activeAngleId`/`requestedAngle`).

- Selecting a row/knot anywhere (web, research result, financials row) **sets `activeEntity`**;
  the context panel reacts.
- Opening an Angle **sets `activeAngle`** so feeder "Cite" actions target it.

### Feeder action behavior (exact)
- **Cite** with an active Angle → links the item; **with no active Angle → opens an Angle
  picker** whose top option is **"+ New Angle from this."**
- **Start Angle from this** → creates an Angle pre-filled (trigger entity + first citation) and
  sets it active.
- **Duplicate cite** → idempotent no-op (`FindingDocument.get_or_create`) + "already cited" toast.
- **After any feeder action → stay in place** (do not yank to the Web); show inline confirmation
  and set the Angle active for follow-on cites.

### Add to Case (WS-GAP-7, detailed)
- **Provenance:** record the source connector + raw result snapshot + who/when.
- **Dedupe:** fuzzy-match the result against existing case knots; on a likely match offer
  **"enrich existing knot"** vs **"create new"** (reuse FuzzyMatchCandidate machinery) — never
  silently duplicate.
- **Explicit outcome label:** the action states which happened — *created knot / enriched knot /
  saved note / fetched documents.*

---

## 10. Replay — hybrid (auto spine + optional structured annotation)

- **Auto spine:** generate the event timeline from AuditLog (add-to-case, cite, confirm, dismiss
  already write rows) — no mandatory data entry.
- **Optional enrichment:** keep structured fields (question → source → result → next question,
  status) as *optional* annotation the investigator can add where a step needs a "why." Not
  required; the timeline exists for free without it.
- Replay = a generated view + a package export, not a mandatory data-entry screen.

---

## 11. Workspace gap backlog (`WS-GAP-*`)

Renamed from `GAP-*` to avoid collision with `api-contract.md`'s resolved GAP-1 (finding_links).
Capabilities the real investigation needed that the tool could not do automatically:

| Gap | Capability | Design role |
|-----|------------|-------------|
| **WS-GAP-1** | Auto-propose a relationship edge when entities share a statutory agent / organizer / address | **Connectedness** — surface the edge; never assert the conclusion. Confirmable edge only. |
| **WS-GAP-7** | "Add to Case" on every Research result (provenance + dedupe + explicit outcome) | **Top friction fix** — kills the connector→case dead-end. See §9. |
| **WS-GAP-4** | Saved searches on case names; alert when a new external entity matching the case appears | **Accretion over time.** |
| **WS-GAP-2** | Year-over-year governance/disclosure comparison; auto-flag a changed answer | Financial intelligence. |
| **WS-GAP-3** | OCR fallback when extraction < ~100 chars; visible status; manual re-trigger | Intake reliability. |
| **WS-GAP-5** | When a person has a date-of-death, flag a later filing naming them as signatory — as a *fact to check*, not a conclusion | Cross-document date check (respect overreach). |
| **WS-GAP-6** | Signal when material grant/distribution revenue exists but the required schedule is not filed | New signal rule. |

---

## 12. Suggested build sequence

1. **WS-GAP-7 + shared state (§9)** — `activeEntity`/`activeAngle` context + feeder Cite/Add/Start
   actions. Highest friction relief, smallest change, all inside Investigate.
2. **Angle lifecycle + tie-off gate (§4) + credibility counts (§5).** The keystone predicate and
   the header that depends on it.
3. **Context panel three-state (§3) + idle "what's missing" (§5).**
4. **RecipientGap (§8)** + package "Leads for the agency" + dismissed opt-in appendix (§7).
5. **Replay hybrid (§10)** and **WS-GAP-1 connectedness proposals (§6).**

---

## 13. Deferred / open

- Whether Financials/Timeline eventually dissolve into the web — deferred; kept as referential
  feeders.
- Whether connectedness graduates from warning to gate once "reviewed connection" has a precise
  stored meaning.
- Whether `overreach_reviewed` becomes a stored field enabling real gating.
