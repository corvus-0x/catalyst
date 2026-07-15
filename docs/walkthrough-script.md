# Catalyst — Live Demo Walkthrough Script

**Audience:** interviewer on a screen-share. **Length:** ~5–7 minutes for the full path,
~90 seconds for the cold open. **URL:** https://catalyst-production-9566.up.railway.app/

This is a script, not a rulebook — the point of each screen is the engineering it proves.
Lead with the workflow and the evidence chain; the AI is a governed supporting component, not
the headline.

---

## 90-second cold open (if time is tight)

> "Catalyst turns scattered public records into a citation-bearing referral package a
> professional investigator can act on. The hard part isn't the CRUD — it's keeping an
> evidence chain a lawyer would trust: append-only audit logs, SHA-256 custody on every
> document, and a gate that refuses to export anything a human hasn't reviewed and cited."

Open the demo → land on the Dashboard → click the case → land on the **Case Map**. One
sentence: *"Everything you're about to see traces back to a source document."* Then jump to
**Referrals → Generate PDF** and show the citation appendix. That's the whole value in 90
seconds: messy inputs in, a defensible, cited package out.

---

## Full walkthrough — the canonical path

Each step names the **click** and the **engineering point** it proves.

### 1. Dashboard → open "Bright Future Foundation Investigation"
- **Point:** stats are honest — "5 referral-grade · 7 need work." *"I deliberately seeded the
  middle of an investigation, not an all-green highlight reel. The product's job is to tell
  you what's NOT ready yet."*

### 2. Investigate → the Case Map
- **Click:** land on the Case Map; point at the Subjects (people + orgs) and the edges.
- **Point:** *"This is a Cytoscape graph, not a D3 force sim — I use D3 only for the timeline
  brush. Nodes are Subjects; edges are Relationships the backend computes — shared addresses,
  financial links, property transfers — each with an evidence trail behind it."*

### 3. Select a Thread → Thread Path Mode
- **Click:** click a thread in the dock (e.g. the CRITICAL `INSIDER_SWAP`). The map dims to
  just the relationships that thread relies on.
- **Point:** *"Selecting a thread emphasizes the evidence it stands on and dims the rest —
  so you can see, visually, what a claim depends on before you believe it."*

### 4. Open full Thread → the Thread Builder
- **Click:** "Open full Thread" on the `INSIDER_SWAP` (referral-grade) thread.
- **Point:** *"Each assertion cites a specific document and page. The role — fact, analysis,
  or claim — is DERIVED from the evidence, not typed by hand: a cited assertion reads as fact,
  an uncited one as analysis. The 'referral-grade' badge means it cleared the gate: confirmed,
  cited, weighed as documented-or-traced, and overreach-reviewed — enforced server-side."*

### 5. Lead Suggestions (the AI, framed correctly)
- **Click:** on a thread with staged notes (e.g. `REVENUE_SPIKE`), click **Suggest
  assertions**. Wait for the live result.
- **Point:** *"This is the one live AI call. It reads the investigator's freeform notes and
  PROPOSES structured assertions — but nothing it produces persists until I accept it, and it
  can never set the handoff flag or touch the referral gate. AI is a drafting aid held to an
  evidence bar; the eval harness scores every lead for faithfulness and overreach against
  golden fixtures, most of them negative controls."*
- **Fallback framing (say this regardless of what the model returns):** *"This is generated
  live, so the exact wording varies — here's the shape it produces."* Then show the captured
  known-good result if the live call is slow or thin. Never let the interview hinge on a
  perfect fresh model call.

### 6. Financials
- **Click:** the Financials tab.
- **Point:** *"Six years of 990 data in one view — revenue trend, $0 officer comp, missing
  COI policy. Parsed straight from IRS TEOS XML over HTTP range requests, no third-party API.
  The anomaly highlighting is what feeds several of the signal rules."*

### 7. Timeline
- **Click:** the Timeline tab.
- **Point:** *"Every 990 filing and property deed on one axis. The revenue jumps and the two
  same-window property transfers are the pattern the case is built on — and each event can be
  cited straight into a thread."*

### 8. Referrals → Generate PDF (the payload)
- **Click:** the Referrals tab → **Generate Referral Package (PDF)**.
- **Point:** *"The readiness checklist gates the export — you cannot generate a package until
  the threads clear the gate. The PDF is deterministic: every sentence traces to a cited
  document, with a SHA-256 chain-of-custody appendix. No AI-generated prose reaches the file
  an agency reads. THIS is the product — everything else exists to make this defensible."*

### 9. Replay (if time)
- **Click:** the Replay tab.
- **Point:** *"The investigation's reasoning arc as documented steps — question, what was
  found, resolved or dead end. It's the audit trail of how the case was actually built."*

---

## Questions to expect (and the honest answers)

- **"Is this real?"** — The code is real and tested (1,100+ backend, 177 frontend). The demo
  *case* is fictional seeded data. Catalyst was built backwards from a real Ohio investigation
  that produced referrals to five agencies; identifying details are out of the public repo.
- **"How much did you write vs. the AI?"** — AI-first inside a harness I designed: skills,
  a TDD gate, PR review. What ships in a package, how evidence is weighed, and when an entity
  merge is confirmed are decisions I kept human. I can walk any file.
- **"What would you do next?"** — Cross-state connector coverage, and a supported-by graph
  linking each assertion to the specific records that back it.
- **"What's the hardest bug you fixed?"** — The referral gate versioned rewrite: a
  grandfathering migration had to freeze the OLD predicate inline so re-running it couldn't
  corrupt legacy rows using the NEW rule. Migrations and application code encode the same
  business rule on different timelines.

---

## Notes for the presenter

- The demo is **read-only in production** — you can click and read freely, but mutations
  (delete, create) are gated behind a write token, so nothing a visitor does can degrade it.
- If the Case Map canvas ever feels stuck, the fit control is the top-left icon on the map
  rail; the graph zoom is scroll-sensitive.
- Keep the AI screen (step 5) SHORT. Traceability and the evidence chain are the story; the
  AI is a well-governed supporting act. Spend the time on steps 4 and 8.
