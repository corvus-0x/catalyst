# Catalyst Frontend Design Spec
**Status:** LIVING DOCUMENT — v1, draft
**Last updated:** 2026-05-03
**Owner:** Tyler Collins (tjcollinsku@gmail.com)
**Replaces:** `catalyst_frontend_design_spec.md` (May 2026 working draft)
**How to use this doc:** read top-to-bottom the first time. After that, sections are independently editable. Section 13 ("Open questions") is where unresolved decisions live — keep it pruned.

---

## 1. The frame

### What Catalyst is
Catalyst is **referral-packaging software for citizen investigators handing off to professionals with subpoena power.** The customer of the output is the AG, IRS, FBI, or federal OIG investigator — not the user of the tool. The user assembles. The customer acts.

### The defining distinction
Catalyst is **paper-trail assembly**, not **OSINT discovery**.

|                          | OSINT (Maltego, etc.)                                | Paper trail (Catalyst)                                                  |
|--------------------------|------------------------------------------------------|-------------------------------------------------------------------------|
| Starting state           | One entity                                           | A pile of public records                                                |
| Movement                 | Outward — find what else is out there                | Sideways — connect what already exists                                  |
| Edge meaning             | "A transform produced this link"                     | "This document proves this link"                                        |
| Quality bar              | Find more leads                                      | Every claim cites a document. Every edge has provenance.                |
| Output                   | A graph of leads for the analyst                     | A referral package a stranger can verify in 15 minutes                  |
| Failure mode             | Missed connections                                   | An unsupported claim that discredits the package                        |

Every UI decision in this document flows from that distinction. When in doubt: **does this help the investigator assemble a defensible paper trail?**

### Who the user is
A non-professional investigator working on a single case at a time, often part-time. They are not a data analyst. They will spend hours staring at this UI and need it to help them think, not fight them. They are NOT the customer of the output — the customer is the agency investigator on the receiving end.

### The portfolio constraint
Catalyst is a portfolio piece that needs to get Tyler hired. The interface needs to look serious, deliberate, and dense — like a real investigative tool, not a CRUD app with charts. Recruiters viewing screenshots should immediately read it as professional software.

---

## 2. Reference tools and what we're pulling from each

We are not copying any of these. We are stealing patterns and adapting them to paper-trail work. Each entry: tool → what we take → why.

| Tool                          | What we take                                                                                | Why it fits Catalyst                                                                                |
|-------------------------------|---------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| **Maltego**                   | Graph-as-workspace. Layout algorithms. Multi-select detail table. Lock/freeze. View modes that re-encode node size. | Maltego is the most polished link-analysis UI on the market. Its layout language is what Catalyst should *feel* like. |
| **i2 Analyst's Notebook**     | Three primary objects: entity, link, attribute. Timeline as a peer chart, not a strip.       | i2 is the closest cousin — built for forensic paper trail with defensibility built in. Closer in spirit than Maltego. |
| **Palantir Gotham**           | The "applications share one workspace" model. Multiple panes (Graph + Map + Table) coexist. | Lets the investigator compose a workbench instead of jumping between tabs. Solves the "5 tabs problem" of the current spec. |
| **Cytoscape.js**              | The graph engine itself. Layout algorithms, lock, multi-select, performance.                 | What we use to build the graph. See §8.0 and §16.5.                                                  |
| **Existing Catalyst tokens**  | Dark-first IBM Plex + Carbon palette. Per-entity-type graph node colors. Severity tags.    | Already built. Don't reinvent.                                                                       |

Reference URLs (for design inspection — open these on a second monitor when iterating):

- Maltego — Navigate the Interface: https://docs.maltego.com/en/support/solutions/articles/15000059532-navigate-the-interface
- Maltego — Graph Sidebar (layouts + view modes): https://docs.maltego.com/en/support/solutions/articles/15000009615-graph-sidebar
- Maltego — Entity Palette: https://docs.maltego.com/en/support/solutions/articles/15000019238-entity-palette
- Maltego — Detail View (multi-select sortable table): https://docs.maltego.com/en/support/solutions/articles/15000019236-detail-view
- Maltego — Property View (editable entity properties): https://docs.maltego.com/en/support/solutions/articles/15000019237-property-view-window
- i2 Analyst's Notebook overview: https://i2group.com/solutions/i2-analysts-notebook
- Palantir Gotham overview: https://www.palantir.com/platforms/gotham/
- Cytoscape.js documentation: https://js.cytoscape.org/
- Cytoscape.js layout demos (try cose-bilkent, dagre, breadthfirst): https://js.cytoscape.org/#layouts
- Radix UI primitives: https://www.radix-ui.com/primitives
- TanStack Table: https://tanstack.com/table/v8

---

## 3. Naming conventions

Lock these. Use them everywhere — code, UI copy, this doc.

| Term            | Definition                                                                                         |
|-----------------|----------------------------------------------------------------------------------------------------|
| **Flag**        | Automatic detection from a signal rule. Lives in triage. Not yet reviewed by the investigator.     |
| **Finding**     | Investigator-confirmed conclusion. Goes in the referral package. Always manually promoted from a flag (or created from scratch). |
| **Entity**      | A person, organization, property, or financial instrument that's part of the case.                  |
| **Document**    | A source artifact — 990, deed, UCC filing, building permit, obituary. Has a SHA-256 hash and a citation slot. |
| **Citation**    | A `[Doc-N]` reference linking a claim back to a document and page.                                  |
| **Transform**   | A research action run on an entity (IRS lookup, SOS search, recorder pull, AOS audit search). Returns a Document and zero or more new entities. |
| **Phase**       | One of four workflow stages: Ingest · Detect · Investigate · Determine. Cyclical in practice, sequential in intent. |
| **Package**     | The exported, deterministic referral PDF. The deliverable.                                          |

**Banned words:** "Pipeline" (already overloaded with the backend processing pipeline). "Dashboard" (this is investigative software, not analytics). "Report" (the deliverable is a Package, not a report).

---

## 4. Information architecture

```
CATALYST
├── Cases list (/cases)
│   └── Case workspace (/cases/:id) — the rest of this doc is about this screen
│
├── Cross-case views (secondary, not the main work surface)
│   ├── Triage (open flags across all cases)
│   ├── Entities (browse persons / orgs / properties across cases)
│   └── Search (full-text)
│
└── Settings
```

Everything that follows is about **the case workspace**. That's where 95% of the user's time is spent.

---

## 5. Case workspace — the five-zone layout

The case workspace is one screen with five zones. Inspired by Maltego's three-zone interface plus a top bar and a multi-tab bottom dock, adapted for paper-trail work.

```
┌────────────────────────────────────────────────────────────────────────┐
│  TOP BAR                                                                │  ← Zone 1: identity + view toggles + global actions
│  Catalyst › Do Good In His Name Inc · ACTIVE · EIN 82-4458479           │
│  [Graph] [990 Viewer] [Financials] [Package]    [Find] [Layout] [⌄]    │
├──────────┬─────────────────────────────────────────┬──────────────────┤
│          │                                         │                  │
│  LEFT    │                                         │  RIGHT           │
│  RAIL    │           CENTER CANVAS                 │  DETAIL          │
│ ~220px   │           (graph by default)            │ ~280px           │
│          │                                         │                  │
│ Zone 2   │  Zone 3                                 │  Zone 4          │
│          │                                         │                  │
├──────────┴─────────────────────────────────────────┴──────────────────┤
│  BOTTOM DOCK                                                            │  ← Zone 5: multi-tab: Audit log · Triage · Transforms · Documents
│  ~180–360px (resizable, collapsible)                                   │
└────────────────────────────────────────────────────────────────────────┘
```

This deliberately departs from the current spec's five center-canvas tabs. The new model is:

- **One canvas** in the center — the graph by default.
- **Top-bar view toggles** open *additional panes* (990 Viewer, Financials, Package) that split the center horizontally. The graph never goes away; you just pull a second pane next to it.
- **The triage queue is no longer the home view.** Flags appear as badges on entity nodes in the graph AND as a sortable table in the bottom dock's "Triage" tab. Both views are the same data — pick your entry point.

### Why this changes from the previous spec

The previous spec made the triage queue the primary view (locked decision L1). That was a workaround for not having a real graph workspace. Once the graph becomes a serious link-analysis surface, flags can live on the graph itself and the queue becomes a filtered list — same data, different lens. The investigator chooses how to enter the work; the data is unified.

This is a senior-engineer call: **don't build two parallel data displays competing for "primary."** Make the graph the canvas, expose every other view as a lens onto it.

### 5.1 Single-screen baseline

**The minimum viable viewport is 1366×768.** Every workflow in this spec must complete on that screen size. This is non-negotiable: it covers standard low-end laptops, which is what a citizen investigator is likely to own.

How that's achievable:
- Left rail collapses to a 48px icon-only state (clickable strip with phase + palette + recently-added icons; expands on hover or click)
- Right detail panel collapses to a 32px tab strip (entity icon + flag count badge; clicks back open)
- Bottom dock collapses to a 28px tab strip with counts (`Audit · 47` / `Triage · 9` / `Transforms · 3` / `Documents · 12`)
- Top-bar view panes are opt-in. Default state is Graph only — no second pane unless the user opens it.
- The "minimum reasonable" working layout is: collapsed left rail (48px) + Graph canvas (flex) + collapsed right panel (32px) + collapsed bottom dock (28px). That leaves ~1280×648 of pure canvas on a 1366×768 screen.

We test the spec on 1366×768 before declaring any view "done."

### 5.2 Multi-monitor (v2 path)

Catalyst's actual investigators (Tyler included) work across two monitors when they have them — one for the case workspace, one for whatever document they're staring at. v1 supports this only via the user's own window arrangement. v2 supports **popout panes**: click `⤢` on the 990 Viewer or Document table → opens in a new window (`window.open`) with state synced via `BroadcastChannel`. Closing the popout returns the pane to the main window.

v1 must not preclude v2. Specifically: pane state lives in case-scoped Context, not in the URL, so it can be hydrated into a second window. We don't hardcode anything that assumes a single window. But we don't ship popout in v1 — it's a real engineering effort and a v1-irrelevant feature for single-monitor users.

---

## 6. Zone 1 — Top bar (~36px)

Always visible. Three regions: identity (left), view toggles (center), global actions (right).

### Identity (left)
```
Catalyst  ›  Do Good In His Name Inc  ·  [ACTIVE]  ·  EIN 82-4458479  ·  Darke OH
```
- Logo links to `/cases`.
- Case name is large (14px, weight 500). Click → open rename modal.
- Status pill (`ACTIVE`, `PAUSED`, `REFERRED`, `CLOSED`) in muted-with-color treatment matching `--tag-*` tokens.
- EIN and county in `--text-soft` after the status. Useful at-a-glance reference.

### View toggles (center)
Four toggleable panes. Default state: Graph on, others off.
```
[• Graph]   [ 990 Viewer]   [ Financials]   [ Package]
```
Clicking a toggle splits the center canvas to add that pane on the right. Multiple can be open at once. Panes are resizable by dragging the divider. This is the Gotham/Maltego "applications share a workspace" pattern — not a tab swap.

When more than one pane is open, each pane gets a small `[×]` to close it. Graph cannot be closed (it's the home pane).

### Global actions (right)
- `[⚲ Find]` — Cmd/Ctrl+K command palette. Search across entities, documents, findings, flags.
- `[⊞ Layout]` — saved workspace layouts. "Default", "Triage focus", "990 review", "Pre-export check". Stretch goal.
- `[⌄]` — overflow: export, print, settings, sign out.

---

## 7. Zone 2 — Left rail (~220px)

Three stacked sections, each independently collapsible. Background `--sidebar-bg`. Border-right `--sidebar-border`.

### 7.1 Phase navigator (top)
The four phases as collapsible groups. Each shows live counts. Active phase gets the `--sidebar-active` background.

```
INGEST                                       12 docs
  990s                                        7
  SOS filings                                 8
  Recorder instruments                       14
  Uploaded                                    5

DETECT                                       9 flags · 6 open
  Critical                                    2
  High                                        4
  Medium                                      0
  ── dismissed                                3

INVESTIGATE                                  18 transforms run
  IRS TEOS                                    7
  Ohio SOS                                    8
  County Recorder                            11
  Ohio AOS                                    1

DETERMINE                                    3 / 9 confirmed
  Confirmed findings                          3
  Needs evidence                              2
  Package status                              0 / 4 agencies sent
```

Phase color encoding (use existing tokens):
- Ingest → `--info` (blue)
- Detect → `--danger` (red)
- Investigate → `--warn` (amber)
- Determine → `--success` (green)

Clicking a sub-item filters the bottom dock to that subset. (E.g. clicking "Critical" filters the Triage tab to critical flags.)

### 7.2 Entity palette (middle)
Maltego-pattern. Categories collapsible. Drag-and-drop a type onto the canvas to manually add an entity. Used for manual entity creation when the investigator finds something not yet picked up by extraction.

```
+ Person
+ Organization
+ Property
+ Financial instrument
+ Document
```

Category icons match `--graph-node-*` colors. Recently used types float to the top of the section (Maltego pattern — "Recently used Entities will automatically appear at the top of the Entity Palette").

### 7.3 Recently added (bottom)
Last 5 items added to the case across any source. Click → focus on graph and update right detail panel.

```
RECENTLY ADDED
• Doc · IRS 990 2024 — 2 hr ago
• Entity · Karen Homan — 2 hr ago
• Flag · SR-025 fired — 1 hr ago
• Doc · SOS Filing #4128601 — 47 min ago
• Finding · "Three-day corporate death" — 12 min ago
```

This is the audit-log preview. Full log lives in the bottom dock.

---

## 8. Zone 3 — Center canvas (the graph)

The graph is the heart of the system. Build this *right*.

### 8.0 Graph engine

**We use [Cytoscape.js](https://js.cytoscape.org/) as the graph engine.** Not D3.

D3 is a low-level visualization toolkit — `d3-force` gives you a physics simulation and you build everything else (lock, layouts, multi-select, edge routing, performance tuning) by hand. Catalyst's spec demands every one of those features. Building them on D3 is reinventing a graph engine.

Cytoscape.js is a purpose-built graph library used in scientific software, biology network analysis, and adjacent to tools like Gephi. It ships with:

- 7+ layout algorithms (cose-bilkent for organic, dagre for hierarchical, breadthfirst, circle, concentric, grid, klay)
- Lock individual nodes; lock the whole graph
- Multi-select with rectangle drag
- Compound nodes (for grouping by entity type or by document source)
- Pan, zoom, fit-to-screen, panBy programmatic API
- Edge routing (so edges don't cross each other stupidly)
- Canvas rendering — performant with thousands of nodes
- A React binding (`react-cytoscapejs`) that handles the lifecycle

Cytoscape replaces the existing D3 graph code. The migration cost is real but contained — the existing graph is not deeply integrated yet. See §17 (Professional library stack) for the install command.

Specific Cytoscape features we use heavily:
- `cy.layout({ name: 'cose-bilkent' })` — the default organic layout
- `cy.elements().lock()` — for the export-gate lock state
- `cy.style()` — declarative node/edge styling (pluggable into our token system via CSS variables)
- `cy.on('tap', 'node', handler)` — click events for selection
- `cy.collection()` — for selection state, multi-select operations

### 8.1 Node types and iconography

Each entity type has a distinct shape, icon, and color (already in tokens):

| Entity type        | Shape         | Color                       | Icon                              |
|--------------------|---------------|-----------------------------|-----------------------------------|
| Person             | Circle        | `--graph-node-person`       | Silhouette                        |
| Organization       | Rounded square| `--graph-node-org`          | Building (different per org type) |
| Property           | Diamond       | `--graph-node-property`     | House / parcel                    |
| Financial instrument| Hexagon      | `--graph-node-financial`    | Coin / lien glyph                 |
| Document           | Document fold | `--graph-label`             | Paper                             |

Document nodes are usually hidden from the graph (they live on edges as citations). Surface them only when "Show source documents" is toggled — see view modes below.

### 8.2 Edges carry provenance

This is the headline difference from Maltego. **Every edge has a citation.** No edge can exist on the graph without a source document.

Edge anatomy:
```
Karen Homan ────[OFFICER · Doc-3]────► Do Good In His Name Inc
```

- Edge label shows the relationship type (`OFFICER`, `MANAGER`, `STATUTORY_AGENT`, `GRANTOR`, `GRANTEE`, `OVERPAYMENT`, etc.)
- A `[Doc-N]` chip on the edge anchors it to the document that proves the relationship.
- Hover the edge → tooltip with full citation: "Form 990 (2024), Part VII, p.7 · SHA-256: a3f7…"
- Click the edge → right detail panel shows the citing document with the relevant page open.

**Edge weight encoding** (different from line color, which encodes type):
- 1px dashed → SPECULATIVE (claim made by AI extraction, not yet verified)
- 1.5px solid → DIRECTIONAL (one document supports it)
- 2px solid → DOCUMENTED (multiple documents agree)
- 2.5px solid + glow → TRACED (full citation chain end to end)

### 8.3 Node decorations

Live badges on the node, not floating chips:

- **Top-right corner: flag badge.** Number of open flags on this entity. Color = highest severity flag. Click → bottom dock opens to Triage tab filtered to this entity.
- **Bottom-right corner: finding badge.** Number of confirmed findings. Click → right detail panel scrolls to Findings section.
- **Top-left: pin** (Maltego pattern). Pinned nodes don't move during layout reflow.
- **Bottom-left: bookmark color** (Maltego pattern). User can color-tag nodes for personal triage. Five colors. Saved per user, not part of the case data.

### 8.4 Graph controls (on the canvas, not in a sidebar)

A small floating toolbar in the bottom-left of the graph:

```
┌─────────────────────────────────────────────────┐
│  ⊕ ⊖   [layout ⌄]   [view ⌄]   [show ⌄]   [🔒]  │
└─────────────────────────────────────────────────┘
```

- `⊕ ⊖` — zoom in/out. Mouse wheel and trackpad pinch also work.
- `[layout ⌄]` — Maltego pattern. Choose: **Organic** (default — Cytoscape's `cose-bilkent`), **Hierarchical** (`dagre`), **Block** (grouped by entity type), **Circular**. Switching is non-destructive.
- `[view ⌄]` — node-size encoding. Choose: **Normal** (uniform), **Flag intensity** (size by open flag count), **Provenance strength** (size by evidence weight of attached findings), **Document count** (size by number of source documents citing this entity).
- `[show ⌄]` — what's visible on the graph. Toggles:
  - ☐ **Source documents** *(off by default)* — when on, document nodes appear at 40% size of entity nodes, document-fold shape, in `--graph-label` color, with edges to every entity they cite. Most cases don't need this on; turn it on when answering "which entities does this 990 touch?" or "what does the citation graph for this finding look like?"
  - ☑ **Flag badges** *(on by default)* — show flag count badges on entity nodes
  - ☑ **Finding badges** *(on by default)* — show finding count badges on entity nodes
  - ☐ **Pinned-only** *(off by default)* — hide all nodes except pinned ones. Useful for focusing on a working subset during package prep.
- `[🔒]` — Lock layout. Pins all nodes in current positions; new nodes from transforms come in but don't reflow existing ones. **The lock state at export time is what gets rendered into the referral package PDF.** Locking is the export gate.

### 8.5 Mode selector (bottom-left of canvas)

Three states (Maltego pattern):
- **Pan** (default) — drag the canvas to move
- **Select** — drag-rectangle to select multiple nodes. Multi-select auto-focuses the bottom dock's Selection tab — see §10.5.
- **Link** — manually draw an edge between two nodes. The created edge starts as **SPECULATIVE** (1px dashed, lightest weight per §14). The user upgrades it to DIRECTIONAL/DOCUMENTED/TRACED later by attaching citations from the right detail panel's Sources tab. SPECULATIVE edges cannot be exported to a referral package — the pre-flight check (§13) blocks it. This lets investigators draw connections as they think, then back-fill citations without breaking flow.

`Space` held = temporary pan mode (Maltego shortcut, keep it).

### 8.6 Cold start state

When the case is brand new and the graph is empty, the canvas shows the **Cold Start workspace** instead of an empty graph:

- Two large search panels side by side, centered: IRS TEOS (left), Ohio SOS (right).
- Submit on either runs both in parallel as async jobs (use existing `useAsyncJob` hook).
- Results show as two stacked entity preview cards.
- Big primary button below: `Confirm entity → begin investigation`.
- On confirm: the entity drops onto the canvas as the first node, the layout starts, the 990 fetch transform fires automatically, and the case transitions out of cold-start state.

This is the only time the canvas shows something other than a graph.

---

## 9. Zone 4 — Right detail panel (~280px)

Contextual. Updates based on selection in Zone 3 (graph) or Zone 5 (bottom dock).

The structure is **Maltego's Property View + Detail View merged into one tabbed panel.**

### Default state (no selection)
Shows the **case subject** — the primary organization. Acts as a "you are here" anchor.

```
DO GOOD IN HIS NAME INC
501(c)(3) · EIN 82-4458479
Incorporated 2018-01-23

Status: ACTIVE
County: Darke OH
Address: 6712 Olding Rd, Maria Stein OH

[ Properties ]    ← active tab
[ Sources ]       (12)
[ Flags ]         (9)
[ Actions ]
```

### Tabs

**Properties** — the editable view (Maltego Property View). Shows entity attributes the investigator can edit. Inline editing on click. Last edited timestamp. Edits write to the audit log.

**Sources** — the citation panel. Every document that mentions this entity, with page references. Click → opens the document in the right pane (or in 990 Viewer if it's a 990).

**Flags** — list of open flags on this entity. Each shows severity, rule ID, status. Inline confirm/dismiss buttons.

**Actions** — the transforms menu. List of research actions runnable on this entity:
- IRS TEOS lookup (if Org)
- Ohio SOS lookup (if Person or Org)
- County Recorder lookup (if Person)
- Ohio AOS audit search (if Org)
- Mark as deceased (if Person)

Each action runs as an async job (existing pattern). When it returns, results land in the bottom dock's "Transforms" tab and any new entities/edges appear on the graph.

### When a different selection happens
- **Click an edge** → Properties tab shows edge detail (relationship type, citation, document hash)
- **Click a flag in bottom dock** → panel shows flag detail with full evidence checklist and confirm/dismiss
- **Click a year on the financial timeline** → panel shows that year's full 990 line items (citable figures)

---

## 10. Zone 5 — Bottom dock (~180–360px, resizable, collapsible)

Four tabs. Default tab is **Audit log**.

```
[ Audit log ] [ Triage ] [ Transforms ] [ Documents ]      ← default tabs
[ Selection (5) ]                                           ← appears only when graph nodes are multi-selected
```

Tab persistence: which tab is open is remembered per-case in `localStorage` keyed by case ID. The Selection tab is ephemeral — never persisted.

### 10.1 Audit log (default)
Reverse-chronological event stream. The case's living history.

```
14:23 · FLAG_FIRED   SR-025 fired on Do Good In His Name Inc                       [view]
14:21 · DOC_INGESTED IRS 990 2024 — 12 entities extracted, 3 flags fired           [view]
14:18 · COLD_START   Entity confirmed: EIN 82-4458479 (Karen Homan)                [view]
14:17 · CASE_OPENED  Case "Do Good In His Name Inc" created                        [view]
```

Every event is clickable → focuses the relevant entity/document/flag and updates the right detail panel.

This panel is the chain of custody made visible. **For a recruiter looking at screenshots, this is the panel that says "this is serious software."** Don't skimp on it.

### 10.2 Triage
The flag table. Maltego's multi-select detail view, adapted.

Sortable columns:
| ✓ | Severity | Rule  | Title                                     | Entity              | Status        | Evidence weight | Source       | Age   |
|---|----------|-------|-------------------------------------------|---------------------|---------------|-----------------|--------------|-------|
| ☐ | CRIT     | SR-025| FALSE_DISCLOSURE — Line 28 flip 2018→2019 | Do Good In His Name | NEW           | DOCUMENTED      | 990 (2019)   | 2 hr  |
| ☐ | CRIT     | SR-015| INSIDER_SWAP — Both sides controlled      | Karen Homan         | NEW           | DIRECTIONAL     | Multiple     | 2 hr  |
| ☐ | HIGH     | SR-021| REVENUE_SPIKE — 1546% growth              | Do Good In His Name | INVESTIGATING | DIRECTIONAL     | 990 (2019)   | 2 hr  |

- Filter chips above the table: status, severity, source.
- Selecting a row highlights the entity on the graph (Maltego sync pattern).
- Bulk actions on multi-select: dismiss with reason, mark as needs-evidence, assign to phase.

### 10.3 Transforms
Recent research actions. Like a console log.

```
14:25 · RUNNING      IRS TEOS · "Do Good In His Name" by name
14:18 · SUCCESS      Ohio SOS · EIN 82-4458479 → 1 result, added to case
14:17 · SUCCESS      IRS TEOS · 82-4458479 → 7 filings, 12 entities
```

Failed transforms stay visible with a retry button. Successful ones link to the new entity/document on the graph.

### 10.4 Documents
The document table. SHA-256 hash, type, OCR status, extraction status, page count, filename.

OCR status is the critical column — when a 990 is a scanned PDF, this tells the investigator extraction will need OCR. Visible badge: `OCR PENDING / RUNNING / COMPLETE / FAILED`.

### 10.5 Selection (ephemeral)

When the user multi-selects two or more nodes on the graph, a **Selection** tab auto-appears on the bottom dock and auto-focuses. It vanishes when the selection clears.

This is Maltego's multi-entity detail view, adapted to live in the bottom dock instead of the right rail. Same component as Triage (TanStack Table) — different filter.

Sortable columns:
| ✓ | Type | Name              | Flags | Findings | Docs | Status     | Evidence weight | Last activity |
|---|------|-------------------|-------|----------|------|------------|-----------------|---------------|
| ☐ | Person | Karen Homan      | 4     | 1        | 12   | ACTIVE     | DOCUMENTED      | 12 min ago    |
| ☐ | Org    | Do Good In His Name | 6  | 2        | 18   | ACTIVE     | TRACED          | 2 min ago     |
| ☐ | Property | 25 W Main St   | 3     | 0        | 7    | DEFECTIVE  | DOCUMENTED      | 1 hr ago      |

When the Selection tab is active, the right detail panel shows a brief summary ("3 selected · 13 flags · 3 findings · view table below") with a small button that focuses the bottom dock. The right panel doesn't try to render multi-select detail itself — that would cramp the 280px width.

Bulk actions on the Selection table: pin, color-tag, run a transform on all (where applicable), open in Triage filtered to these entities, export selection.

---

## 11. The 990 Viewer pane (toggle from top bar)

Opens to the right of the graph as a second pane. Renders the 990 XML as a structured form (NOT as a PDF — we already have the XML).

Sections rendered as labeled blocks:
- Part I — financials summary
- Part IV — checklist (each Yes/No on its own row)
- Part VI — governance + policies
- Part VII — officers + compensation (each officer is a clickable entity link)
- Part IX — expense breakdown
- Schedules B / L / O

**Inline signal callouts** appear directly under the line that triggered them, GitHub-PR-style:

```
Part IV, Line 28a — Did the org engage in transactions with current/former officers?
   ◉  Yes   ◯  No
   ┌─────────────────────────────────────────────────────────┐
   │ ⚠  SR-025 FALSE_DISCLOSURE                               │
   │ This year answered Yes; 2019–2024 answered No.            │
   │ [ View flag ]  [ Dismiss ]                                │
   └─────────────────────────────────────────────────────────┘
```

Year selector at the top. Switching years updates the entire pane.

---

## 12. The Financials pane

Year-over-year tabular view + sparkline charts. Matches the data already exposed by `FinancialSnapshot`.

Columns: year. Rows: revenue, expenses, net assets, program ratio, officer comp, board independence (%).

Above the table, a small revenue/expenses dual-line chart (mini sparkline). Click a year → right detail panel shows that year's full 990 line items.

Anomaly cells (program ratio < 50%, revenue spike > 100%, etc.) get a `--tag-high-bg` highlight with a tiny rule-ID chip (`SR-029`).

---

## 13. The Package pane

Where the referral packages get assembled.

Four agency lanes, stacked or side-by-side depending on viewport:
- Ohio Attorney General
- IRS Form 13909
- FBI IC3
- FCA OIG

Each lane shows:
- Agency name and complaint type
- Pre-selected confirmed findings (per the routing table — see `do_good_workflow_spec.md` § Agency routing table)
- Toggle each finding in/out for this specific agency
- Status: `Draft / Ready / Submitted`
- `[ Generate PDF ]` button

The PDF is rendered server-side (existing `referral-pdf` endpoint). Underlying evidence is identical across agencies; only cover narrative and legal authority citations differ.

**Pre-flight check** appears above the lanes: a checklist of conditions that must be true before any package can be generated.
- ✅ Every confirmed finding has ≥1 source document
- ✅ Every entity in a confirmed finding is linked to ≥1 source document
- ⚠ Graph is unlocked (lock before exporting to freeze the snapshot)
- ⚠ 2 dismissed flags lack a documented reason

---

## 14. State, color, and weight encoding

Don't reinvent — these tokens already exist. This section is canonical.

### Severity (use existing `--tag-*` tokens)
| Severity | Bg                  | Fg                   |
|----------|---------------------|----------------------|
| CRITICAL | `--tag-critical-bg` | `--tag-critical-color` |
| HIGH     | `--tag-high-bg`     | `--tag-high-color`   |
| MEDIUM   | `--tag-med-bg`      | `--tag-med-color`    |
| LOW      | `--tag-low-bg`      | `--tag-low-color`    |
| (neutral)| `--tag-neutral-bg`  | `--tag-neutral-color`|

### Phase (use existing accent tokens)
| Phase        | Color      |
|--------------|-----------|
| Ingest       | `--info`   |
| Detect       | `--danger` |
| Investigate  | `--warn`   |
| Determine    | `--success`|

### Flag status
| Status        | Visual                                              |
|---------------|-----------------------------------------------------|
| NEW           | `--tag-neutral-*` chip                              |
| INVESTIGATING | `--tag-med-*` chip + animated pulse                 |
| CONFIRMED     | `--tag-low-*` chip with check                       |
| DISMISSED     | greyscale, struck-through, dismissal reason on hover|

### Evidence weight (edge stroke)
| Weight       | Stroke                              | Default state for…                                              |
|--------------|-------------------------------------|-----------------------------------------------------------------|
| SPECULATIVE  | 1px dashed, `--graph-edge-default`  | Manually drawn edges (Link mode); AI-extracted relationships    |
| DIRECTIONAL  | 1.5px solid, `--graph-edge-default` | Edges with one document citation                                |
| DOCUMENTED   | 2px solid, `--graph-edge-highlight` | Edges with multiple agreeing documents                          |
| TRACED       | 2.5px solid + 4px glow, `--graph-edge-highlight` | Edges with full citation chain end-to-end       |

**Promotion path:** SPECULATIVE → DIRECTIONAL when the first citation is attached. DIRECTIONAL → DOCUMENTED when a second independent document agrees. DOCUMENTED → TRACED when the chain is end-to-end (every entity in the relationship is itself documented). The user attaches citations from the right detail panel's Sources tab when an edge is selected.

**Export gate:** SPECULATIVE edges cannot be exported into a referral package — the §13 pre-flight check blocks any package that includes a confirmed finding whose edges are still SPECULATIVE. This is the safety on the "draw freely, cite later" workflow.

---

## 15. Interaction patterns

### Keyboard shortcuts (lock these)
- `Cmd/Ctrl+K` — global find / command palette
- `Space` (hold) — temporary pan mode in graph
- `V` — switch graph mode to Pan
- `S` — switch graph mode to Select
- `L` — switch graph mode to Link
- `Cmd/Ctrl+L` — toggle layout lock
- `Cmd/Ctrl+\` — toggle bottom dock
- `Cmd/Ctrl+1..4` — switch bottom dock tabs (1=Audit, 2=Triage, 3=Transforms, 4=Documents)
- `Cmd/Ctrl+Shift+1..4` — toggle top-bar view panes (1=Graph, 2=990, 3=Financials, 4=Package)
- `?` — show keyboard shortcut overlay
- `Esc` — close modals, deselect

### Right-click context menus
- **Right-click an entity** → run transform menu, copy citation, mark as deceased, pin/unpin, color-tag, open in detail
- **Right-click an edge** → view source document, dismiss edge, change relationship type
- **Right-click a flag in Triage** → confirm, dismiss with reason, assign

### Drag patterns
- **From entity palette → onto canvas** = manually create entity (prompts for required fields)
- **From bottom-dock document table → onto an entity node** = link document as source for that entity
- **Within graph** = move node (or with multi-select, move group)

---

## 15.5 Discoverability and first-time use

The investigator opening Catalyst for the first time has no training. They should make real progress on a case in their first session without reading any documentation. Power features (chord shortcuts, layout algorithms, popout windows in v2) reward learning over time but never gate the basic workflow.

There IS a learning curve — the workflow IS Ingest → Detect → Investigate → Determine, and that's not a paradigm everyone knows. But the curve is one-pass: by case 2, the user knows where everything lives. By case 5, they want speed and reach for keyboard shortcuts.

### Principles

1. **Every action is achievable by mouse.** Keyboard shortcuts are augmentation. If a feature exists *only* in a chord shortcut, it doesn't exist for first-time users.
2. **Every icon has a tooltip.** No mystery glyphs. Tooltips appear on 250ms hover, dismiss on mouseout. Use Radix Tooltip primitives so accessibility is correct by default.
3. **Empty states teach the next step.** Don't show "No data." Show "Run the IRS or SOS search above to add your first entity." Empty triage tab: "No flags yet — flags appear when documents are processed." Empty findings list: "Promote a flag to a finding to start your referral package."
4. **Right detail panel is never empty chrome.** When nothing is selected, it shows the case subject (the primary org). Always-something-on-screen.
5. **Right-click is augmentation, not the only path.** Every right-click action has a button somewhere visible.
6. **Modals never auto-open.** Always user-initiated.

### First-time-user tour

On first case open, a 5-step guided tour fires (using `driver.js`):

1. **Cold start** — points at the two search panels: "Find your subject organization in IRS or Ohio SOS to begin."
2. **Phase navigator (left rail)** — points at the four phases: "Track your progress as the case moves through Ingest → Detect → Investigate → Determine."
3. **Audit log (bottom dock)** — points at the running event log: "Every action you take is recorded here. This is your chain of custody."
4. **Triage tab** — points at the bottom-dock triage tab: "Flags from automatic detections appear here for you to review and confirm."
5. **Generate package** — points at the Package toggle in the top bar: "When you're done, this is where you generate referral PDFs for the agencies."

Each step is dismissible. Setting `localStorage.catalyst.tourSeen = true` prevents the tour from reappearing. Re-enable from Settings.

### Learn-as-you-go callouts

When a user does something for the first time, a one-line toast (using `sonner`) appears with the keyboard-shortcut equivalent. Each callout fires once per user.

- First flag confirmed: `✓ Flag confirmed. Tip: press 'c f' next time.`
- First transform run: `Transform queued. Watch the Transforms tab for results.`
- First package generated: `Package downloaded. Lock the graph (⌘L) before exporting to freeze the snapshot.`

Toasts dismiss on click or after 6 seconds. Stack in the bottom-right.

### What "easy learning curve" means concretely

- **Cold start screen**: two inputs and one primary button. Not a wizard, not five fields.
- **Bottom dock collapse handle** has a label, not just an arrow: `Audit log · 47 events · ⌃\\`.
- **Mode selector** in the graph (Pan / Select / Link) shows current mode in plain English, not just an icon.
- **Generate package** button is disabled with a tooltip explaining what's missing if the pre-flight check fails. Don't silently allow a half-empty package; don't hide the button either.
- **Loading states** use skeleton screens (structure visible, data shimmering) instead of spinners. Users learn the layout before they have data.

### Bias toward labels

Use icons + labels (not icons alone) for any control a first-time user might encounter:
- Top-bar view toggles: `[• Graph]` `[ 990 Viewer]` (icons + word)
- Bottom-dock tabs: `Audit log · 47` (word + count)
- Graph mode selector: `Pan` / `Select` / `Link` (words, not icons)

Icon-only is reserved for: collapse arrows, close X, zoom +/−, toolbar actions where the icon is universally understood (search ⚲, settings ⚙).

---

## 16. Lock-versus-flex decisions

**Locked** (don't relitigate without strong cause):
1. Graph is the primary canvas. Triage queue is a lens, not a competing home view.
2. Every edge has a citation. No edges without `[Doc-N]`.
3. Findings are always manually promoted from flags or created from scratch — never auto-promoted.
4. Dismissed flags stay visible with a documented reason. Negative evidence matters in a paper trail.
5. The deliverable is a deterministic PDF generated from the locked graph snapshot. No AI in the body.
6. Dark mode is the default. Light mode is supported.
7. Existing token system (`tokens.css`) is canonical. Don't introduce new color variables without updating tokens.css first.
8. **Cytoscape.js is the graph engine.** Not D3. (See §16.5 Professional library stack.)
9. **Single-screen baseline is 1366×768.** Every workflow must complete on that viewport. Multi-monitor popout is v2.
10. **First-time-user tour fires on first case open** and the workflow is achievable mouse-only without docs. Keyboard shortcuts and chord commands are augmentation.

**Flexible** (open to redesign as we build):
- Exact widths of left rail / right detail / bottom dock
- Whether the 990 Viewer renders inline-on-the-graph as overlay vs as a side pane (currently: side pane)
- How aggressive the auto-layout is when new entities arrive (currently: lock layout is the user's call, default is reflow)
- The exact set of node-size view modes
- Whether flags appear ONLY as badges on entity nodes vs ALSO as floating cards above the node when severity is critical

---

## 16.5 Professional library stack

We use battle-tested libraries from the same ecosystem as Linear, Vercel, Stripe, and GitHub. **No school-project-feeling defaults. No rolled-our-own primitives where a mature library exists.** This list is locked — if a need arises that isn't covered, propose an addition through this section before installing.

### Currently installed (keep)
- `react` 18 + `react-dom` + `typescript`
- `react-router-dom` 6
- `vite` + `vitest` + `@testing-library/react`

### To install (commit to in this spec)

| Library | Purpose | Why this one |
|---|---|---|
| `cytoscape` + `react-cytoscapejs` + `cytoscape-cose-bilkent` | Graph engine, React binding, high-quality organic layout | The library investigative tools use. Replaces D3. See §8.0. |
| `lucide-react` | Icons | What Linear, Vercel, shadcn, Cal.com use. Clean, consistent, free, ~1500 icons. |
| `@radix-ui/react-dialog`, `react-popover`, `react-tooltip`, `react-dropdown-menu`, `react-context-menu`, `react-tabs`, `react-toggle-group` | Accessible UI primitives | Foundation of shadcn/ui. Unstyled — we apply our tokens. WAI-ARIA correct out of the box. |
| `@tanstack/react-table` v8 | Triage queue, audit log, document list, multi-select detail table | What Stripe and GitHub use. Sortable, filterable, virtualizable. Headless — keeps our visual style. |
| `cmdk` | Command palette (`Cmd/Ctrl+K`) | Paco Coursey's library. The de facto command-palette in React. Used by Vercel. |
| `react-resizable-panels@^2` | Resizable splits between top-bar panes | Brian Vaughn (React core team). Smooth, native-feeling. Used by Vercel. **Pin to ^2** — v4 (released 2026) renamed all the major APIs (`PanelGroup` → `Group`, `PanelResizeHandle` → `Separator`) and broke every tutorial/blog post on the internet. v2 is what's documented everywhere. |
| `tinykeys` | Keyboard shortcut registration, including chord sequences (`g g`, `c f`) | ~1kb, zero deps. Composable. |
| `sonner` | Toast notifications (learn-as-you-go callouts) | Emil Kowalski / Vercel. Tasteful animations, stack management. |
| `react-pdf` (`pdfjs-dist`) | Document viewer for uploaded PDFs | Mozilla's pdf.js wrapped for React. The standard for serious PDF rendering. |
| `date-fns` | Date and time formatting | Modular, treeshakeable. Standard. |
| `driver.js` | First-time-user guided tour | ~5kb, framework-agnostic. Lighter than alternatives. |

### Install command

```
npm install cytoscape react-cytoscapejs cytoscape-cose-bilkent \
  lucide-react \
  @radix-ui/react-dialog @radix-ui/react-popover @radix-ui/react-tooltip \
  @radix-ui/react-dropdown-menu @radix-ui/react-context-menu @radix-ui/react-tabs \
  @radix-ui/react-toggle-group \
  @tanstack/react-table \
  cmdk \
  react-resizable-panels \
  tinykeys \
  sonner \
  react-pdf \
  date-fns \
  driver.js
```

Then remove `d3` and `@types/d3` from dependencies after the graph migration is complete (Build Sequence step 6).

### Deliberately NOT using

- **CSS-in-JS** (styled-components, emotion). We use CSS Modules + tokens. Faster, simpler, already in place.
- **Animation libraries** (framer-motion). Use CSS transitions tied to existing `--transition-*` tokens. Catalyst should feel calm, not animated.
- **State-management libraries** (Redux, Zustand, Jotai). React Context + hooks are sufficient until proven otherwise. The async job hook is the most complex state we have and it works fine in Context.
- **CSS frameworks** (Tailwind, Bootstrap). We have a token system; we don't need a utility framework.
- **Charting libraries** (recharts, visx) for now — the financial sparklines are simple enough to render with inline SVG. Reconsider if we add complex multi-axis charts.

### Bundle-size discipline

Cytoscape.js is the largest addition (~150kb gzipped); `react-pdf` brings pdf.js (~250kb gzipped, but lazy-loadable). Everything else is small (Lucide 5–10kb tree-shaken, Radix per-primitive 5–15kb, cmdk ~7kb). We tree-shake aggressively. Lazy-load heavy panes (990 Viewer, Document viewer) so the initial graph load isn't blocked.

### Visual consistency note

All Radix primitives ship unstyled. We provide one canonical set of styles for each (Dialog, Popover, Tooltip, etc.) in a shared `components/ui/` directory consuming our tokens. Components elsewhere in the codebase use those wrappers — they don't import Radix primitives directly. This keeps the visual language uniform.

---

## 17. Decisions log

Open questions get logged here; once resolved they stay as a record of why we landed where we did. Append-only.

### Currently open
*(none)*

### Resolved

**OQ-1** *(asked 2026-05-03 · resolved 2026-05-04)* — Should documents appear as graph nodes by default, or only on a toggle?
→ **Toggle, off by default.** Lives in `[show ⌄]` dropdown on graph toolbar (§8.4). Reasoning: a typical case has 30–80 entities + flag/finding badges + citation chips on every edge — already dense. Documents are already represented via `[Doc-N]` chips on edges. Surface document nodes only when the investigator wants to ask a citation-graph question. When on, document nodes render at 40% size in `--graph-label` color so they read as supporting infrastructure.

**OQ-2** *(asked 2026-05-03 · resolved 2026-05-04)* — How does the graph behave when the user creates a from-scratch finding? Manual link with citation modal vs. SPECULATIVE-default?
→ **SPECULATIVE-default.** Manually drawn edges (Link mode) and AI-extracted edges start as SPECULATIVE — 1px dashed, lightest weight per §14. User upgrades the edge by attaching citations from the right detail panel's Sources tab. SPECULATIVE edges are visually distinct and **cannot be exported** to a referral package — the §13 pre-flight check blocks any confirmed finding whose edges are still SPECULATIVE. Reasoning: investigators think nonlinearly; they notice a connection, draw it, attach the citation when they find the document. Forcing the citation up front breaks their flow. The SPECULATIVE state preserves the "every exported edge has provenance" rule while allowing flexible working order.

**OQ-3** *(asked 2026-05-03 · resolved 2026-05-04)* — Multi-select detail: sortable table in right panel or just a count?
→ **Sortable table in the bottom dock**, not the right panel. New Selection tab (§10.5) appears on multi-select, vanishes when selection clears. Same TanStack Table component as Triage — different filter. Right detail panel shows a brief summary ("5 selected · view table below"). Reasoning: multi-select is a table-shaped view; the bottom dock is where tables live; cramming an 8-column sortable table into a 280px right rail is wrong. Also unifies the multi-select UX with the Triage UX — same component, same interactions.

**OQ-4** *(asked 2026-05-03 · resolved 2026-05-04)* — Bottom dock tab memory: per-case or default-to-Audit?
→ **Per-case memory.** Stored in `localStorage` keyed by case ID. Investigators settle into a rhythm per case; forcing them back to Audit on every load fights muscle memory. Selection tab is the exception — never persisted (it's ephemeral by definition).

**OQ-5** *(asked 2026-05-03 · resolved 2026-05-04)* — Async transforms: ghost node with spinner or wait until success?
→ **Ghost node.** When a transform queues, a placeholder node appears: dashed circle with spinner glyph, smaller than real nodes, in `--graph-label` color. Replaces with real result on success; removes with toast (sonner) on failure. Reasoning: maps to existing `useAsyncJob` pattern; makes async work visible; removes the "did I click that?" anxiety.

**OQ-6** *(asked 2026-05-03 · resolved 2026-05-04)* — Tablet/mobile responsive?
→ **Desktop only for v1.** No responsive collapse below 1366×768. Investigative work is keyboard-heavy and dense — tablets fight the format. v2 may add read-only tablet views for reviewing a frozen package. Implicitly locked by §5.1.

**OQ-7** *(asked 2026-05-03 · resolved 2026-05-04)* — Package pane four agency lanes on small screens: stack or horizontal scroll?
→ **Stack vertically below 1440px width.** Vertical scroll is universal muscle memory; horizontal scroll on a 4-column lane layout is awkward. On 1366×768 baseline the user sees one full agency lane at a time and scrolls for the next.

---

## 18. Build sequence

This is the order in which the spec gets implemented. Earlier items unblock later ones. Each step lands as its own PR.

0. **Install professional library stack** (§16.5). Single PR. Cytoscape, Radix primitives, TanStack Table, Lucide, cmdk, react-resizable-panels, tinykeys, sonner, react-pdf, date-fns, driver.js. Verify build still passes.
1. **Layout shell.** AppShell with the five-zone grid using `react-resizable-panels`. Top bar, left rail, center (empty placeholder), right detail panel, bottom dock. Collapse/expand mechanics for left rail, right panel, bottom dock. Verify on 1366×768 (§5.1). No real content yet — just the chrome.
2. **Token-aware UI primitives.** Wrap Radix Dialog, Popover, Tooltip, DropdownMenu, ContextMenu, Tabs in `components/ui/` with our token-based styles. Wire `sonner` toasts. These are the building blocks for everything else.
3. **Audit log (Zone 5, default tab).** TanStack Table reading from existing audit log endpoint. Reverse-chronological. Click → focus event in the workspace. **This is the "visible chain of custody" panel — the most distinctive thing about Catalyst's UI vs. a generic CRUD app. Get it right early; the screenshots from this build already start looking serious.**
4. **Document table (Zone 5, Documents tab).** TanStack Table. SHA-256 hash, OCR status badge, type, page count, filename. Reuse logic from existing DocumentsTab.
5. **Cold start workspace (Zone 3 empty state).** Two-search-panel layout (IRS TEOS + Ohio SOS). Uses existing `useAsyncJob` hook. On confirm, drops the first entity onto the canvas.
6. **Graph view — Cytoscape.js migration.** Install Cytoscape, replace existing D3 force-directed graph. Implement node iconography (§8.1), edge citation chips (§8.2), and node decorations (§8.3). Default cose-bilkent layout. **Remove `d3` and `@types/d3` from package.json after this lands.**
7. **Right detail panel (Zone 4).** Properties / Sources / Flags / Actions tabs (Radix Tabs). Wire to graph selection events.
8. **Phase navigator (Zone 2 top).** Live counts pulled from existing endpoints. Filter wiring to bottom dock.
9. **Triage tab (Zone 5).** TanStack Table — the sortable flag queue (§10.2). Sync to graph selection. Bulk actions via Radix Dialog confirmations.
10. **Graph controls (Zone 3 floating toolbar).** Lock, layout algorithms, node-size view modes. All wired through Cytoscape's API (§8.0).
11. **990 Viewer pane.** Structured form rendering from existing 990 XML. Inline signal callouts. Add as a top-bar toggle pane.
12. **Financials pane.** Year-over-year table + inline-SVG sparklines. Top-bar toggle.
13. **Package pane + pre-flight check.** Four agency lanes. Finding toggles. PDF export via existing `referral-pdf` endpoint. Pre-flight check disables generate button when conditions fail (§13).
14. **Entity palette + drag-to-create (Zone 2 middle).** Drag-and-drop from palette → canvas creates a node. Required-field modal on drop.
15. **Transforms tab (Zone 5).** Wire to existing async job system. Retry, link to result on graph.
16. **Discoverability layer.** First-time-user tour via `driver.js`. Learn-as-you-go toasts. Tooltips on every icon (Radix Tooltip). Empty-state copy on every empty container.
17. **Command palette (`Cmd/Ctrl+K`).** Using `cmdk`. Search across entities, documents, findings, flags. Open from top bar Find button or shortcut.
18. **Keyboard shortcuts.** `tinykeys` registration of single-key (`V`, `S`, `L`) and chord (`g g`, `c f`) commands per §15.
19. **Polish.** Right-click context menus, recently-added strip, multi-select detail table, animation timing tuning.

Each of steps 1–19 should be reviewable as a screenshot. By step 3 Catalyst should already look serious.

---

## 19. What this replaces

The previous design spec (`catalyst_frontend_design_spec.md`) had:
- Triage queue as primary view (L1) — **replaced by graph as primary view**
- 5-tab center canvas (Triage / Graph / 990 / Financials / Package) — **replaced by single canvas + composable top-bar panes**
- Research as a separate inline panel inside flag cards — **replaced by Actions tab in right detail panel; transforms run from any entity in the graph context, not just from inside a flag**
- Financial timeline as a permanent bottom strip — **replaced by Financials pane (top-bar toggle); chart can be shown alongside the graph when relevant**

Every other locked decision from the previous spec carries forward. In particular: cold start sequence (L3), manual finding creation (L4), tight research coupling (L5), four-agency-package routing (L6).

---

*v1 draft — 2026-05-03 — Review with Tyler before any code lands. This document is the source of truth for the case workspace UI; code should follow the spec, not the other way around.*
