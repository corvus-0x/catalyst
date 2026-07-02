# Catalyst — Methodology & Citation Standard

**Audience:** The professional investigator receiving a Catalyst referral package
(Attorney General, IRS, FBI, or equivalent), and anyone auditing how a finding in
that package was derived.

**Purpose:** This document explains *how* Catalyst reaches a finding, *what a
finding is allowed to claim*, and *how every claim is cited back to a source*. It
is the standard against which the output should be judged. Read it before relying
on any referral package this system produces.

---

## 1. What Catalyst is (and is not)

Catalyst is **referral-packaging software for citizen investigators**. It ingests
public records, extracts entities, detects a fixed set of fraud signals, and
produces a citation-bearing referral package for a professional with subpoena
power.

It is **not** an adjudication engine. Catalyst does not conclude that fraud
occurred. It surfaces *signals* — specific, rule-defined patterns in public data —
and packages the underlying documents so a professional can decide whether to
pursue them. Every automated finding is a **lead for a human to verify**, never a
verdict.

Two design commitments follow directly from that:

- **Every claim traces to a source document.** A finding that cannot be tied to a
  cited record cannot enter a referral package (see §5, the tie-off gate).
- **The system declares its own blind spots.** Catalyst reports which detections
  are impossible given the data on file, so the recipient can distinguish "we
  looked and found nothing" from "we could not look" (see §6).

---

## 2. The two-dimensional finding model

Every finding carries **two independent dimensions**. Conflating them is the most
common way investigative software overstates itself, so Catalyst keeps them
separate.

### Dimension 1 — Status (where the finding is in review)

| Status | Meaning |
|--------|---------|
| `NEW` | Auto-detected by a signal rule; not yet reviewed by a human. |
| `NEEDS_EVIDENCE` | A human has looked and wants supporting documents before deciding. |
| `DISMISSED` | Reviewed and set aside as a false positive (reversible). |
| `CONFIRMED` | Reviewed, supported, and eligible for referral. |

### Dimension 2 — Evidence weight (how well-supported the claim is)

| Weight | Meaning |
|--------|---------|
| `SPECULATIVE` | Pattern matched only — no supporting document attached. |
| `DIRECTIONAL` | Suggestive but unproven. |
| `DOCUMENTED` | Supporting documents are on file. |
| `TRACED` | Full citation chain from the claim back to the source record. |

A finding is born `NEW` / `SPECULATIVE` / auto-sourced. It advances along **both**
axes only through human review. A rule firing tells you *a pattern exists*; it says
nothing about whether the pattern is *substantiated*. That is the reviewer's job,
and the system enforces it (§5).

### Source

Each finding also records how it originated: `AUTO` (signal rule), `MANUAL`
(investigator), or `AI` (pattern lead). In all user-facing output, AI-sourced
findings are labeled **"Lead"** and the extraction pipeline is labeled **"Intake"**
— never by the name of any model or vendor. This is deliberate: the recipient
audience discounts "an AI said so." A finding must stand on its cited records, not
on the tool that surfaced it. (See the credibility rationale in §7.)

---

## 3. How a finding is produced

```
public records → extraction/OCR → entity extraction → entity resolution
   → data quality → SIGNAL RULES → Finding (NEW / SPECULATIVE / AUTO)
   → human triage → (tie-off gate) → Referral Package
```

Signal rules are the detection core. Each rule is a **stateless, side-effect-free
evaluator** that takes a case (and sometimes a single document) and returns a list
of triggers, or an empty list when nothing fires. A rule never writes to the
database; persistence and de-duplication are handled separately. One rule failing
is caught and logged — it never blocks the others.

### Three detection modes, in ascending order of reliability

1. **Document-scoped (regex over extracted text).** Runs against a single
   document's OCR/extracted text immediately after upload (e.g. SR-005 zero-
   consideration language, SR-006 missing Schedule L). Most exposed to OCR error;
   treated as the weakest signal.
2. **Case-scoped (cross-document, structured ORM).** Runs across all entities and
   relationships in the case after every upload, because the pattern only emerges
   when records are viewed together (e.g. SR-015 insider swap, SR-024 conduit
   pattern). Relies on structured records, not raw text.
3. **XML-structured (parsed IRS 990 e-file data).** Runs against structured fields
   parsed from IRS 990 XML rather than OCR'd PDF text. This is the **most reliable**
   mode: booleans are real booleans, dollar amounts are real integers, and officer
   compensation is a structured list — no pattern-matching against noisy text.

> **Why this matters for a recipient:** the same rule ID (e.g. SR-006, SR-012,
> SR-013, SR-025, SR-029) can fire from either OCR text or structured XML. The
> XML-derived version is materially stronger evidence and should be weighted
> accordingly. The `evidence_snapshot` on each finding records which mode produced
> it (`detection_mode` / `source: "IRS_TEOS_XML"`).

---

## 4. The signal-rule registry

The active rule set — **17 rules**, `SR-003` through `SR-031` (the numbering has
gaps where earlier rules were retired) — lives in
`backend/investigations/signal_rules.py` (`RULE_REGISTRY`). Every rule has a stable
ID, a severity, and a one-sentence charter description. **The `rule_id` is the
rule's identity and is never changed after the fact** — it is the bridge between a
finding and the rule that produced it. (Note that a single rule ID, e.g. SR-025,
may fire through more than one detection mode; it is still counted once.)

Three rules are **CRITICAL** — they indicate self-dealing, a false statement to
the IRS, or a self-reported diversion:

| Rule | Severity | What it detects |
|------|----------|-----------------|
| **SR-015** | CRITICAL | Insider swap — a related party sits on both sides of a property transaction (non-arm's-length transfer). |
| **SR-025** | CRITICAL | Form 990 denies related-party transactions, but case records (or the filing's own Schedule L) prove otherwise — a false disclosure to the IRS. |
| **SR-028** | CRITICAL | Material diversion or misuse of assets, self-disclosed by the org on Form 990 Part VI Line 5. |

The remaining rules are HIGH or MEDIUM severity and cover valuation anomalies
(SR-003), UCC amendment bursts (SR-004), zero-consideration transfers (SR-005),
governance gaps (SR-006, SR-012, SR-031), compensation anomalies (SR-013),
blanket liens on charity-connected entities (SR-017), revenue spikes (SR-021),
conduit patterns (SR-024), contractor-denial contradictions (SR-026), low program-
expense ratios (SR-029), and disclosed Schedule L transactions (SR-030). See
`RULE_REGISTRY` for each rule's exact charter text.

### The strongest rules compare a claim against proof

The contradiction rules (SR-025, SR-026, SR-028) are the most probative in the
engine. They do not read a filing in isolation — they compare **what the filing
claims** against **what other records establish**:

- SR-025 (network mode): a 990 answers "No" to related-party transactions, but the
  case database holds confirmed relationships linking officers to the counterparties
  in property transactions.
- SR-025 (XML contradiction mode): a 990 answers "No" on Part IV Line 28, but the
  *same filing's* Schedule L lists non-zero related-party transactions — a
  self-contradiction inside a single IRS document.
- SR-026: a 990 denies independent-contractor compensation, but building permits in
  the case name the contractors.
- SR-028: quotes the organization's **own Schedule O explanation verbatim** where
  available.

---

## 5. The tie-off gate — what a finding must satisfy to enter a referral

This is the load-bearing standard. A finding is **referral-grade** only when it
clears every one of these conditions. The predicate is defined **once**, in
`backend/investigations/referral_grade.py`, and reused by the readiness check, the
credibility counts, and the referral-PDF filter, so the number the investigator
sees and the number that exports can never drift apart. It is enforced
**server-side** on the transition into `CONFIRMED` — it cannot be bypassed from the
UI.

**Base conditions (all findings):**

1. Status is `CONFIRMED`.
2. Evidence weight is `DOCUMENTED` or `TRACED`.
3. `overreach_reviewed` is true — a human has explicitly checked the finding for
   overreach (claiming more than the evidence supports).
4. At least one cited document is attached.

**Additional conditions for structured (`ASSERTION_V1`) threads:**

5. At least one **cited assertion** (a claim with a citation to a source record).
6. At least one **handoff-ready assertion**.

(A single assertion that is both cited and handoff-ready satisfies 5 and 6 at
once. Legacy threads created before this standard, marked `LEGACY_NARRATIVE`, are
grandfathered to the base conditions only.)

The takeaway for a recipient: **nothing reaches the referral package on a pattern
match alone.** A machine-detected signal is a starting point; a human must confirm
it, weight it as documented or traced, attach the source, and affirm it is not
overreaching before it is allowed out the door.

---

## 6. Chain of custody and citation integrity

**Evidence is snapshotted at detection time.** When a rule fires, the exact inputs
that triggered it (transaction IDs, party names, dollar amounts, tax years, the
relevant form line, the Schedule O text) are captured into the finding's
`evidence_snapshot`. The referral package quotes *that snapshot*, not a fresh
re-derivation. If the underlying record is later edited, the citation still shows
what was true at the moment of detection. This is what lets a citation be audited
after the fact rather than silently changing underneath the reader.

**De-duplication is deterministic.** A finding's identity for de-dup purposes is
`(case, rule_id, trigger_entity_id)`, falling back to the triggering document when
no entity is the natural anchor. Re-running detection as a case grows does not
create duplicate findings on the same subject, and dismissed findings are not
silently resurrected.

**The audit log is append-only.** Review actions are recorded and never updated or
deleted, so the history of how a finding moved from `NEW` to `CONFIRMED` (or to
`DISMISSED`) is reconstructable.

---

## 7. What Catalyst cannot see — the coverage audit

Alongside the findings, Catalyst runs a **coverage audit** that reports which rules
are *blind* because the case is missing the data they require. Examples it will
state plainly:

- "No Relationship records exist, so SR-015 (insider swap) cannot fire even if the
  case is full of insider swaps."
- "Properties exist but none have both a purchase price and an assessed value, so
  SR-003 (valuation anomaly) cannot compare."
- "No multi-year financial snapshots, so SR-021 (revenue spike) has nothing to
  compare."

Each gap is labeled `MISSING_DATA`, `LOW_CONFIDENCE`, or `RULE_BLIND`, with a
concrete recommendation for the data needed to close it.

**Why this is part of the methodology, not an afterthought:** a referral package
that lists what the tool *could not* examine is far more trustworthy than one that
only lists hits. The absence of a finding for a given rule means one of two very
different things — "the rule ran and found nothing" or "the rule could not run" —
and the coverage audit is how the recipient tells them apart.

---

## 8. Credibility firewall (naming)

No model, vendor, or "AI" name ever appears in user-facing output or in a referral
package. AI-surfaced findings are **"Leads"**; the document-extraction pipeline is
**"Intake"**. These are *investigative roles*, described by what they do, not by
their implementation. The reason is evidentiary: the audience — prosecutors and
agents with subpoena power — will discount a claim framed as "an AI found this." A
finding must stand on its cited public records. The naming rule keeps the focus
there, and it is enforced by an automated check in CI.

---

## 9. How to read a finding in a referral package

For any finding, verify it against this checklist:

1. **Rule and severity** — what pattern fired, and how serious is it by charter?
2. **Detection mode** — OCR text (weaker) or structured XML (stronger)? Check the
   `evidence_snapshot`.
3. **Evidence weight** — `DOCUMENTED` or `TRACED`? (It must be one of these to have
   been included.)
4. **Cited sources** — pull the attached documents and confirm they say what the
   finding says.
5. **Overreach** — does the claim stay within what the cited records support? The
   finding was reviewed for this, but you should re-check.
6. **Coverage gaps** — what related rules were blind, and would additional records
   (a subpoena for bank statements, deeds, or full 990 filings) let them run?

Catalyst's job ends at handing you a substantiated, cited starting point. The
subpoena power, and the judgment, are yours.

---

*Source of truth for the mechanics described here:
`backend/investigations/signal_rules.py` (detection), `referral_grade.py`
(tie-off gate), and the `Finding` / `EvidenceWeight` / `FindingStatus` models in
`models.py`. If this document and the code disagree, the code is authoritative —
please open an issue so this document can be corrected.*
