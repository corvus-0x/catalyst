# Case Workspace Design — the Confirmation-Centered Reframe

**Status:** Design (pre-build). Supersedes the linear "phase" model for case-detail layout.
**Audience:** Anyone building or reviewing the case-detail frontend. Read with
`frontend-design-spec.md` (current component/graph spec) and `api-contract.md`.

> **No PII.** This document was distilled from a real investigation replay that is kept
> out of the repo. All case-specific names, EINs, addresses, and org names are deliberately
> excluded. Only structural lessons and tool-level gaps remain.

---

## 1. The organizing principle

**The confirmed Angle (Finding) is the atom of "done." The Web is the home. Every other
surface is a *feeder* into Angles — not a destination.**

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
        CONFIRM = substantiated + cited + connected
                  + written to the overreach standard
                          │
                          ▼
                   REFERRAL PACKAGE
```

---

## 2. Why — the lessons that forced this model

Distilled from replaying one real end-to-end investigation:

1. **The investigation is accretive with an unknown, growing denominator.** It expanded from
   one subject to multiple counties, multiple entities, and dozens of people. You cannot know
   how many "pieces" exist at the start, and the count grows as you work. **Therefore any
   "% complete" gauge is a lie** — it would shrink as the case grew.
2. **Ready ≠ complete.** The real case was correctly referred to multiple agencies with ~36
   questions still open — because those open questions ("requires subpoena," "FOIA the loan
   file," "bank records") are **the recipient's job.** The recipient has subpoena power; the
   investigator's job is credibility, not completeness.
3. **A fired signal rule is the *birth* of an Angle, not proof of one.** One auto-flagged
   CRITICAL finding turned out to be a misidentification and was dismissed. Counting "fired
   signals" toward readiness would have made the case look *more* ready while carrying a false
   accusation. Substantiation — not firing — is what counts.
4. **The work is non-linear.** The real path was ~14 main steps plus ~9 dead-end branches,
   with constant back-and-forth. A linear Intake→…→Refer "phase" model is the wrong shape and
   is explicitly rejected here.

---

## 3. Layout — web-home + one context panel + referential feeders

Not a row of co-equal tabs. A workspace shell:

```
┌─ Case Name ───────── Credibility: N referral-grade · M need work · K agency leads ── [status ▼] ─┐
├──────────────────────────────────────────────────────────────┬──────────────────────────────────┤
│                                                                │  CONTEXT PANEL (one panel,        │
│                    THE WEB  (home — always present)            │  three states)                   │
│         knots + connections; shared-attribute edges            │                                  │
│         auto-proposed (see GAP-1)                              │  · idle  → CASE STATE:            │
│                                                                │           what's missing (2-kind) │
│   [Research] [Documents] [Financials] [Timeline]               │  · knot/connection selected →     │
│   referential feeders — accessible, not prominent.             │           profile / detail        │
│   Every result ends in an action that lands on the web         │  · ANGLE active → the             │
│   or in an Angle: Add to Case · Cite · Start Angle             │           convergence workspace   │
│   (no dead-end toasts — see GAP-7)                             │           (origin+provenance,     │
│                                                                │            cited docs, subgraph,  │
│                                                                │            evidence weight,       │
│                                                                │            open threads → Confirm)│
└────────────────────────────────────────────────────────────────┴──────────────────────────────────┘
```

- **The Web is the persistent home.** The case *is* a web of connected knots.
- **One context panel, three states** (idle case-state / selected entity-or-connection /
  active Angle workspace). The Angle workspace is the convergence point where evidence,
  citations, connected subgraph, evidence weight, and open threads come together to support
  **Confirm**.
- **Feeders are referential, not prominent.** Investigators hold the financial/temporal
  picture in their heads and *check* it; they do not live in it. Financials and Timeline
  remain openable reference surfaces. They are kept (not dissolved into the web) for now;
  dissolving them into entity panels / a temporal web filter is a deferred option, not a
  current goal (avoid over-engineering — first 70% is 100%).
- **Shared selection context is what makes tools work "in unison":** selecting an entity
  anywhere (web, research result, financial row) sets the active entity and the panel reacts;
  opening an Angle sets the active Angle so "Cite" actions from Documents/Timeline target it.

---

## 4. Readiness model — counts, not a score

The header shows **counts, never a number that reads like a percentage.** A score invites
"get it to 100 and refer"; counts invite "substantiate the next Angle."

> Credibility: **N referral-grade angles · M need work · K open leads for the agency**

### Referral-grade Angle (the bar)
An Angle is referral-grade when it is:
- `status = CONFIRMED` (human-confirmed, not just signal-fired), **and**
- `evidence_weight ≥ DOCUMENTED`, **and**
- has ≥1 cited document, **and**
- is embedded in the web (≥1 reviewed connection on its knot), **and**
- written to the **overreach standard** (stated facts, not inferred conclusions).

### Two kinds of "missing" — only one gates readiness
| Kind | Examples | Effect on readiness |
|------|----------|---------------------|
| **Investigator-closable** | uncited confirmed Angle; unconnected knot; research hit not added; OCR pending | **Lowers readiness** — must be closed |
| **Recipient gap (subpoena/FOIA)** | bank records, payroll, loan files, agency records | **Does NOT block** — rides in the package as "leads for the agency" |

This split is what lets a case be referable while many questions remain open.

---

## 5. Hard requirements (non-negotiable)

1. **Dismissed stays visible.** Dismissed findings are kept with their documented reason —
   they demonstrate rigor (what was checked and ruled out). Never hide them; the referral
   package includes a correction/dismissed section.
2. **Overreach standard, enforced in the UI.** An Angle cannot reach referral-grade on an
   inferred conclusion. Shared names/addresses/timing render as **stated facts with a
   "not established by these documents" caveat**, never as a conclusion. (The AI eval harness
   already polices this on the model side; the UI must police it on the human side.)
3. **Provenance is preserved.** Every Angle/thread records who originated it — investigator,
   AI lead, or external tip — and this provenance appears in the replay/timeline view and the
   package.

---

## 6. Three design decisions (deliberate cuts)

1. **Replay is auto-derived, not hand-typed.** The retrospective replay's value (provenance,
   the question→finding→next-question chain, dead-ends-kept-visible) must be **generated from
   the actions already taken** (add-to-case, cite, confirm, dismiss all write AuditLog rows).
   A manually authored step log is documentation debt that won't survive real workload.
   Replay = a generated timeline view + a package export, not a data-entry screen.
2. **One context panel, not a second permanent rail.** "What's missing" lives in the context
   panel's idle state plus the header credibility chip — it does not get its own always-on
   rail competing with the web's profile/connection panels.
3. **Counts, not a score.** No 0–100 number anywhere in the readiness surface.

---

## 7. Platform gap backlog (tool-level, from the real investigation)

These are capabilities the real investigation needed that the tool could not do
automatically. They are platform requirements, not case data.

| Gap | Capability needed | Design role |
|-----|-------------------|-------------|
| **GAP-1** | Auto-propose a relationship edge when two entities share a statutory agent / organizer / address | **Connectedness** — "the backend builds the web." Surface the edge; never assert the conclusion. |
| **GAP-7** | "Add to Case" on every Research result, pre-populating the entity and dropping it on the web | **Top friction fix** — kills the connector→case dead-end (matches the toast dead-ends in `CaseDetailView`). |
| **GAP-4** | Saved searches on case names; alert when a new external entity matching the case appears | **Accretion over time** — new pieces arrive after "active" work pauses. |
| **GAP-2** | Year-over-year governance/disclosure comparison table; auto-flag a changed answer (e.g. Yes→No) | Financial intelligence (feeds disclosure-flip signals). |
| **GAP-3** | OCR fallback auto-triggered when text extraction yields < ~100 chars; visible OCR status; manual re-trigger | Document intake reliability. |
| **GAP-5** | When a person has a date-of-death, flag any later filing naming them as signatory — as a *fact to check*, not a conclusion | Cross-document date check (must respect the overreach standard — name match ≠ identity). |
| **GAP-6** | Signal when material grant/distribution program revenue exists but the required schedule is not filed | New signal rule. |

---

## 8. What this changes vs. the current app

- **Keep:** all current tab *bodies* (web/graph, Research, Financials, Timeline, Referrals),
  the deterministic PDF export, the readiness backend, `Case.status`.
- **Reframe:** the case-detail shell from "6 co-equal tabs" to "web-home + one context panel +
  referential feeders," with the Angle workspace as the convergence point.
- **Wire the seams:** replace every "go do X elsewhere" toast with a real action
  (Add to Case / Cite / Start Angle) targeting shared selection context (GAP-7).
- **Auto-derive** the replay/timeline from AuditLog instead of manual step entry.
- **Header:** credibility counts (not a score); "what's missing" in the context panel idle
  state with the two-kind split.

---

## 9. Deferred / open

- Whether Financials and Timeline eventually **dissolve** into the web (financials as a panel
  on an org knot; timeline as a temporal filter) — deferred; kept as referential feeders for
  now.
- Exact connectedness rule for "web-embedded" (any reviewed connection on the knot vs.
  connection to another Angle's entities) — to settle during build.
