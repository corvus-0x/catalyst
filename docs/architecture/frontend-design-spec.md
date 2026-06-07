# Catalyst Frontend Design Spec
**Version:** 3.0 (Session 38 — connection/profile/angle model)
**Owner:** Tyler Collins
**Status:** Authoritative — build from this

This document is the single source of truth for the Catalyst frontend. It describes the investigation
model, navigation structure, tab layouts, and interaction patterns for the connection/profile/angle UI.
Version 2.0 (thread/knot/web) was superseded mid-session when the terminology was clarified.

---

## 1. Core Investigation Model

### The fundamental principle

**Documents are the truth.** Every fact in the system traces back to a document. Connections
between entities are only as real as the document that establishes them. An angle is only as
strong as the documents it cites. Nothing is asserted without a source.

Documents do two jobs when Intake processes them:
1. **Build profiles** — financial figures, dates, roles, and facts about a single entity
2. **Establish connections** — when two entities appear together in a document (grantor/grantee,
   officer/organization, secured party/debtor), that relationship becomes a visible edge in the web

The **angle** is what the investigator finds by reading across profiles and connections. It is the
investigative question — the "why does this matter" — built as a narrative with document citations.

### Glossary

| Term | Definition |
|------|-----------|
| **Knot** | A node of investigative interest. Only Person and Organization can be knots. Property is NOT a knot — you cannot press charges on a property. |
| **Connection** | A factual link between two knots established by a document or entered manually. Shown as an edge in the web. Three states: Proposed, Confirmed, Manual. |
| **Profile** | The accumulated portrait of a knot — all facts Intake extracted about this entity, plus every document associated with them, plus all their confirmed connections. |
| **Angle** | An investigative line of inquiry. A free-form narrative with `[Doc-N]` citations that builds the case for why a pattern is significant. Maps to the `Finding` model. Can draw on multiple entities and multiple documents. |
| **Web** | The full investigation graph — all knots as nodes, all connections as edges. The primary view of the Investigate tab. |
| **Active** | An angle that is open — investigator is building the narrative. Maps to `Finding.status = NEEDS_EVIDENCE`. |
| **Confirmed** | An angle that has been tied off — narrative complete, evidence cited. Maps to `Finding.status = CONFIRMED`. |
| **Exhausted** | An angle that went nowhere — dead end. Maps to `Finding.status = DISMISSED`. |
| **Intake** | The extraction AI role. Runs on document upload. Extracts entities, dates, amounts, and flags. Powered by Claude Haiku. Never display model name — always show as "Intake". |
| **Lead** | The reasoning AI role. Proposes connections after document processing. Suggests next investigative steps. Can draft angle narratives. Powered by Claude Sonnet. Never display model name — always show as "Lead". |
| **Quick capture** | An informal note on a knot — an observation not yet part of any angle. Stored as `InvestigatorNote`. |
| **Fuzzy match** | When Intake finds an entity name that is similar but not identical to an existing knot — e.g. "S Mitchell" vs "Sarah Mitchell". Lead surfaces these for investigator review rather than silently merging or creating duplicates. |

### Backend Model Mapping

| Frontend concept | Backend model | Notes |
|-----------------|--------------|-------|
| Knot | `Person` or `Organization` | Only these two. Not `Property`. |
| Connection (confirmed) | `Relationship` or `PersonOrganization` | Existing relationship models |
| Connection (proposed) | Pending state — stored in `Document.ingestion_metadata` until reviewed | |
| Connection (manual) | `Relationship` with `source=MANUAL` and a note field | |
| Profile | Entity model + `FinancialSnapshot[]` + `PersonDocument[]`/`OrgDocument[]` | Assembled view |
| Angle | `Finding` | One Finding = one angle |
| Evidence cited in angle | `FindingDocument` | Multi-document, exists today |
| Active angle | `Finding.status = NEEDS_EVIDENCE` | |
| Confirmed angle | `Finding.status = CONFIRMED` | |
| Exhausted angle | `Finding.status = DISMISSED` | |
| Web (graph) | `GET /api/cases/<uuid>/graph/` | Existing endpoint |
| Quick capture | `InvestigatorNote` | Existing model |
| Intake extraction | `ai_extraction.py` + `entity_extraction.py` + `entity_resolution.py` | |
| Lead connection proposals | `ai_pattern_augmentation.py` + `entity_resolution.py` fuzzy matching | |
| Fuzzy match candidates | `entity_resolution.py` similarity scores | Surfaced in review panel |

No new backend models are required. The frontend is a new lens on existing data.

---

## 2. Technology Stack

### Core UI
- React 18.3.1, TypeScript — existing
- Vite — existing
- React Router DOM 6.30 — existing

### Graph engine
- **Cytoscape.js** — force-directed graph for the web view. Chosen over D3 for built-in node/edge
  interaction model (click, hover, selection, zoom/pan). Replaces the existing D3 entity graph.

### UI components
- **Radix UI** (headless primitives) — Dialog, DropdownMenu, Tooltip, Popover, Select, Tabs
- **cmdk** — command palette (Cmd+K global search)
- **sonner** — toast notifications (Intake extraction complete, Lead suggestion ready)
- **TanStack Table** — Financials tab year-over-year table, Research tab results
- Existing CSS custom properties for light/dark/auto theming

### No new backend dependencies needed. All new functionality uses existing API endpoints.

---

## 3. Navigation Structure

### Four levels of drill-down

```
Level 1: Web view           — full graph canvas (Investigate tab, default)
Level 2: Profile view       — click a knot node → entity portrait + all documents
Level 3: Angle view         — click an angle card in Profile, or click a confirmed edge
Level 4: Document view      — click a document anywhere → full text + Intake highlights
```

Documents are also directly accessible from the web view via the Documents rail (left side).
A document does not have to be reached through a profile or angle — it is a first-class object.

### Breadcrumb trail (always visible when below level 1)

```
Investigation web  ›  Sarah Mitchell  ›  Hidden compensation angle  ›  Form 990 · 2019
[Web — click to return]  [Profile]      [Angle]                      [Document — current]
```

Each crumb is clickable and returns to that level without losing context.

### Navigation transitions
- Web → Profile: graph zooms/pans to center the selected knot; profile panel slides in from right
- Profile → Angle: angle detail panel replaces the profile panel (same right side)
- Any level → Document: document viewer occupies the main canvas area; graph persists as a
  mini-map in the bottom-right corner
- Back navigation: breadcrumb click OR browser back button

### Connection review — non-blocking
When Lead proposes new connections after document processing, they do NOT block navigation.
Proposed connections sit as dashed edges in the web. A badge on the toolbar shows the count:
"4 pending connections." The investigator reviews them when ready — not before.

---

## 4. Tab Layout

The Case Detail page has five tabs. Referrals is deferred — backend exists, UI is a stretch goal.

```
[ Investigate ]  [ Research ]  [ Financials ]  [ Timeline ]  [ Referrals ]
```

- **Investigate** — the web view. This is the primary tab. Recruiter demo starts here.
- **Research** — external data source queries with async job polling.
- **Financials** — year-over-year 990 table with anomaly highlighting.
- **Timeline** — brushable chronological event rail.
- **Referrals** — deterministic PDF export (backend done in Session 33; UI is a button, deferred).

---

## 5. Investigate Tab — Web View (Level 1)

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  TOOLBAR: [ + Knot ]  [ + Angle ]  [ Fit ]  [ Minimap ]    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                   CYTOSCAPE CANVAS                          │
│                                                             │
│   ● Sarah Mitchell ──────────────── ● Bright Future Found.    │
│          \                        /                         │
│           \                      /                          │
│            ─────── ● EH Const. ──                          │
│                                                             │
│                                                [MINIMAP]   │
└─────────────────────────────────────────────────────────────┘
```

### Node (Knot) visual encoding

Gotham/Maltego aesthetic as of Session 45: nodes are small data-point markers, not labeled objects. Labels float to the right. Node size scales with `finding_count` via `mapData` — the most-investigated entity is visually dominant (hub).

| Type | Fill | Ring | Icon | Size range |
|------|------|------|------|-----------|
| Person | `#3b82f6` (blue) | 1px `#93c5fd` | Person silhouette (head+body SVG) | 22–54px |
| Org (nonprofit) | `#0d9488` (teal) | 1px `#5eead4` | Building (roof+body+door SVG) | 24–58px |
| Org/LLC | `#d97706` (amber) | 1px `#fcd34d` | Building icon | 24–58px |
| Org/LEGAL | `#7c3aed` (violet) | 1px `#c4b5fd` | Building icon | 24–58px |
| Org/UNKNOWN | `#dc2626` (red) | 1px `#fca5a5` | Building icon | 24–58px |
| Selected | any | 2px `#fbbf24` (gold) | — | — |
| Has active findings | — | — | Red badge at top-right corner | 14px |

### Edge (Connection) visual encoding

Three connection states, three visual treatments:

| State | Style | Meaning |
|-------|-------|---------|
| Proposed | Dashed gray line, animated pulse | Lead drew this from a document — awaiting investigator review |
| Confirmed | Solid gray line (unflagged) or solid colored line (has active/confirmed angle) | Investigator verified this connection is real |
| Manual | Dotted line, slightly thicker | No document source — entered by investigator (tip, public announcement, etc.) |

When a confirmed connection has an angle attached, the edge color reflects the highest severity
angle on that connection:
- CRITICAL → coral (#D85A30)
- HIGH → amber (#BA7517)
- MEDIUM → blue (#185FA5)
- INFORMATIONAL → gray

### Toolbar actions

- **⚑ New Angle** — opens ConnectKnotsModal to create an angle between two existing knots. *(Note: the old "+ Knot" and "+ Connection" buttons were removed in Session 45 — all three opened the same modal and there is no backend endpoint for standalone entity creation. Knots enter the graph only via document extraction or research connectors.)*
- **[N] pending** — badge showing count of proposed connections awaiting review. Clicking
  highlights all dashed edges and opens the review panel for the first one.
- **Fit** — Cytoscape fit() to show all nodes.
- **Minimap toggle** — shows/hides the minimap overlay.

### Interaction model

- **Click node** → navigate to Profile view (Level 2)
- **Click confirmed/manual edge** → show connection detail popover (which documents support it,
  which angles reference it). Click through to an angle from the popover.
- **Click proposed (dashed) edge** → open connection review panel for that specific proposal
- **Right-click node** → context menu: View profile / New angle from here / Quick capture / New manual connection
- **Right-click confirmed edge** → context menu: View supporting documents / Add to angle / Dispute connection
- **Right-click proposed edge** → context menu: Review now / Dismiss proposal
- **Drag** — pan the canvas
- **Scroll** — zoom
- **Box select** — multi-select nodes for bulk actions (future)

---

## 6. Profile View (Level 2)

Triggered by clicking a node in the web view. The graph dims unselected elements and the selected
knot is centered. A profile panel slides in from the right (380px).

The profile is the accumulated portrait of this entity — everything known about them, sourced
from documents. It is a description, not an investigation. Angles are listed here but live
separately.

### Profile panel layout

```
┌──────────────────────────────────────┐
│  ● K                                 │  ← Avatar circle (initials)
│  Sarah Mitchell              [ Edit ]   │  ← Name + edit knot metadata
│  Person                              │  ← Type pill
│                                      │
│  Board Member, Bright Future Fnd.    │  ← role_tags[] from PersonOrganization
│  DOB: 1964-03-12                     │  ← date_of_birth (if present)
│                                      │
│  ○ 2 active angles  ✓ 1 confirmed    │  ← angle stats
│  □ 9 documents                       │  ← ALL docs associated with this entity
│  ◈ 4 connections                     │  ← confirmed connections in the web
│                                      │
├──────────────────────────────────────┤
│  DOCUMENTS (9)           [ View all ]│
│                                      │
│  [990] Form 990 · 2019  ·  3 flags  │  ← doc type, name, Intake flag count
│  [990] Form 990 · 2018               │
│  [DEED] Warranty Deed 2019           │
│  [UCC]  UCC Filing 2019-0044123      │
│  ...                                 │
│                                      │
│  "View all" opens Documents rail     │
│  filtered to this entity             │
│                                      │
├──────────────────────────────────────┤
│  CONNECTIONS (4)                     │
│                                      │
│  ━━ Bright Future Fnd.   Board ED    │  ← confirmed, solid line
│       [990 2019] [990 2018]          │  ← supporting documents
│                                      │
│  ━━ EH Construction      Grantor     │
│       [Deed 2019]                    │
│                                      │
│  ·· James Mitchell         Manual      │  ← manual, dotted
│       "Same address, SOS filing"     │  ← source note
│                                      │
│  -- Mitchell Development Group  Proposed    │  ← proposed, dashed
│       [Review]                       │  ← click to open review panel
│                                      │
├──────────────────────────────────────┤
│  ANGLES (3)                          │
│                                      │
│  ▌ Hidden compensation    ACTIVE     │
│  ▌ UCC filing pattern     ACTIVE     │
│  ▌ Property transfer      CONFIRMED  │
│                                      │
│  [ + New angle from this entity ]    │
│                                      │
├──────────────────────────────────────┤
│  QUICK CAPTURES                      │
│  "Licensed contractor but no..."     │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ Add quick capture...           │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

### Behavior

- Clicking a document card → navigates to Document view (Level 4)
- "View all" on Documents → opens the Documents rail in the Investigate tab filtered to this entity
- Clicking a confirmed/manual connection → expands inline to show supporting documents
- Clicking "Review" on a proposed connection → opens connection review panel (Section 6.1)
- Clicking an angle card → navigates to Angle view (Level 3)
- "New angle from this entity" → opens New angle modal with this entity pre-filled
- Quick capture → saves as `InvestigatorNote` via `POST /api/cases/<uuid>/notes/`

### 6.1 Connection review panel

Non-blocking. Opens as a drawer from the right side. Shows the proposed connection with the
relevant document excerpt highlighted so the investigator can verify it before confirming.

```
┌──────────────────────────────────────────────────────────┐
│  Review proposed connection              [ × Close ]     │
│                                                          │
│  Lead found: Sarah Mitchell ←→ Mitchell Development Group LLC      │
│  Source document: Warranty Deed · 2021-03-14             │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  ...the following described real property:         │  │
│  │                                                    │  │
│  │  GRANTOR: ████████████████████████                 │  │  ← highlighted
│  │  SARAH MITCHELL                                       │  │
│  │                                                    │  │
│  │  GRANTEE: ████████████████████████████████         │  │  ← highlighted
│  │  BRIGHT FUTURE REAL ESTATE LLC                           │  │
│  │                                                    │  │
│  │  for consideration of $300,000...                  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  [ Open full document ]                                  │
│                                                          │
│  ──────────────────────────────────────────────────────  │
│                                                          │
│  FUZZY MATCH CHECK                                       │
│  "Mitchell Development Group LLC" — possible matches:           │
│                                                          │
│  ○  Mitchell Development Group LLC (exact)    — not in case yet │
│  ○  Bright Future Inc. (68% match)           — already in case │
│                                                          │
│  [ Confirm — same entity as Bright Future Inc. ]               │
│  [ Confirm — new entity: Mitchell Development Group LLC ]       │
│  [ Dismiss — this connection is incorrect ]              │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

Key rules:
- The document excerpt is always shown. Investigators never confirm blind.
- "Open full document" navigates to Document view without closing the review panel (opens in new panel).
- Fuzzy match candidates are sorted by similarity score, highest first.
- "Confirm — same entity" merges the extracted name into the existing knot.
- "Confirm — new entity" creates a new knot and draws the connection to it.
- "Dismiss" records the dismissal in AuditLog so it can be reviewed later.
- After confirming or dismissing, the panel automatically loads the next pending connection (if any).

### 6.2 Manual connection creation

Accessible from: web view right-click on node → "New manual connection", or Profile view
"+ Connection" button in the Connections section.

```
┌──────────────────────────────────────────────────────┐
│  Add manual connection                                │
│                                                      │
│  From:  Sarah Mitchell  (pre-filled)                    │
│  To:    [ Search or create knot... ]                 │
│                                                      │
│  Connection type:  [ Board member ▾ ]                │
│  (Board member / Family / Vendor / Legal counsel /   │
│   Registered agent / Co-owner / Other)               │
│                                                      │
│  Source note (required for manual connections):      │
│  ┌────────────────────────────────────────────────┐  │
│  │ e.g. "Facebook announcement, March 2019" or    │  │
│  │ "Per county auditor phone call, 2024-01-15"    │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  Evidence weight:  ● Speculative  ○ Directional      │
│  (Manual connections start at Speculative by default)│
│                                                      │
│  [ Cancel ]              [ Add connection ]          │
└──────────────────────────────────────────────────────┘
```

Manual connections appear in the web as dotted lines. They can be upgraded to Confirmed later
if a document surfaces that supports them — the investigator clicks the dotted edge and chooses
"Attach document source."

---

## 7. Angle View (Level 3)

Triggered by clicking an angle card in the Profile view, or by clicking a confirmed/colored
connection edge in the web view. An angle is a line of investigative inquiry — a narrative the
investigator is building toward a conclusion.

Backend model: `Finding` (`status=NEEDS_EVIDENCE` while active, `status=CONFIRMED` when tied off,
`status=DISMISSED` when exhausted). Cited documents are `FindingDocument` rows.

### Layout

```
┌─────────────────────────────────────────┬──────────────────────┐
│  ANGLE: UCC filing timeline             │  LEAD PANEL          │
│  Sarah Mitchell ←→ Bright Future F.        │                      │
│  Status: ACTIVE  SR-004                 │  Suggested next:     │
│                                         │  ─────────────────   │
│  [ Cite document ]  [ Tie off ]         │  Look for UCC        │
│  [ Split angle ]                        │  amendments filed    │
├─────────────────────────────────────────│  same day as deed    │
│  NARRATIVE                              │  transfer.           │
│  ┌─────────────────────────────────┐    │                      │
│  │ Sarah Mitchell appears as secured  │    │  Pattern match:      │
│  │ party in [Doc-3] and as a board │    │  ─────────────────   │
│  │ member in [Doc-1]. Three UCC    │    │  3 UCC amendments    │
│  │ amendments [Doc-4][Doc-5][Doc-6]│    │  within 24h matches  │
│  │ were filed the same day...      │    │  SR-004 pattern.     │
│  │                                 │    │                      │
│  │ [ Draft with Lead ]             │    │  New angle?          │
│  └─────────────────────────────────┘    │  ─────────────────   │
│                                         │  EH Construction ↔   │
│  CITED DOCUMENTS (3)                    │  Sarah Mitchell may     │
│  ┌─────────────────────────────────┐    │  warrant a separate  │
│  │ [Doc-3] Warranty Deed 2019      │    │  angle on the deed   │
│  │ Page 3 · Extracted by Intake    │    │  transfer.           │
│  │ "Grantor: EH Construction       │    │                      │
│  │  Grantee: Bright Future..."     │    │  [ Start angle ]     │
│  └─────────────────────────────────┘    │                      │
│  ┌─────────────────────────────────┐    │                      │
│  │ [Doc-4] UCC Filing 2019-0044    │    │                      │
│  │ Page 1 · Extracted by Intake    │    │                      │
│  │ "Debtor: Bright Future Fnd.     │    │                      │
│  │  Secured party: K. Mitchell..."    │    │                      │
│  └─────────────────────────────────┘    │                      │
│                                         │                      │
│  [ + Cite another document ]            │                      │
└─────────────────────────────────────────┴──────────────────────┘
```

### Narrative editor

The narrative is a free-text field. Investigators write in plain language.

**Citation insertion:** typing `[` opens an inline picker listing all case documents by
`[Doc-N]` reference. Selecting one inserts `[Doc-3]` into the text. Hovering a `[Doc-N]`
reference in the rendered narrative shows a tooltip with the document title, page number,
and a 2-line excerpt of the relevant passage.

**Draft with Lead button:** sends the current cited documents and any existing narrative text
to the Lead role, which returns a draft narrative paragraph. The draft is inserted into the
editor as a starting point — the investigator edits freely after.

Narrative saves automatically on blur (PATCH `findings/<uuid>/` with `narrative=<text>`).

### Cited documents panel

Each row in the "Cited Documents" list represents one `FindingDocument` record.

```
┌──────────────────────────────────────────────────────────────┐
│  [Doc-4]  [UCC]  UCC Filing 2019-0044123    Page 1  · · ·  │  ← ref badge, doc type, overflow
├──────────────────────────────────────────────────────────────┤
│  "Debtor: Bright Future Foundation, Inc.                     │
│   Secured party: Sarah Mitchell                                 │
│   Filing date: 2019-11-14..."                                │
│                                                              │
│  [Entity: Sarah Mitchell]  [Date: 2019-11-14]  [Flag: UCC]    │  ← Intake fact tags
│                                                  ──────     │
│  · · · Intake                                               │  ← source chip, right-aligned
└──────────────────────────────────────────────────────────────┘
```

Fact tag colors (from Intake):
- **Entity** — blue pill, `background: #E6F1FB; color: #0C447C`
- **Date** — amber pill, `background: #FAEEDA; color: #633806`
- **Amount** — green pill, `background: #EAF3DE; color: #27500A`
- **Flag** — coral pill with underline, `background: #FAECE7; color: #712B13; border-bottom: 1.5px solid #D85A30`

Overflow menu on each cited document card:
- **View document** — opens document view (Level 4) in a side panel
- **Remove citation** — removes the `FindingDocument` row; does not affect the document itself

### Toolbar actions

- **Cite document** — opens document picker showing all case documents; selecting one adds a
  `FindingDocument` row and inserts `[Doc-N]` at the cursor position in the narrative
- **Tie off** — opens the tie-off modal (see Section 7.1)
- **Split angle** — opens the split/connect modal on the "Split" tab (see Section 8)

### Lead panel

Always visible on the right (240px). Content is AI-generated by the Lead role (Sonnet via
`ai_pattern_augmentation.py`). Three sections:

1. **Suggested next** — one or two concrete investigative actions ("Look for UCC amendments
   filed same day as deed transfer")
2. **Pattern match** — if the accumulated cited documents match a signal rule, names it and
   explains the match in plain language. Never uses the words: fraud, criminal, illegal,
   guilty. Evidence weight is capped at DIRECTIONAL — the investigator sets the final weight
   at tie-off.
3. **New angle?** — if the Lead sees a secondary line of inquiry worth pursuing, suggests a
   new angle with both knots named and a [ Start angle ] button. Clicking it opens the new
   angle form pre-filled with those knots.

The Lead auto-refreshes when a document is cited or removed (debounced 3s). Shows a spinner
"Lead is thinking..." while refreshing.

### 7.1 Tie-off modal

Opens when the investigator clicks "Tie off". This is the confirmation step — the investigator
decides the final weight and outcome here, not on individual facts.

```
┌──────────────────────────────────────────────────────┐
│  Tie off this angle                                  │
│                                                      │
│  Angle: UCC filing timeline                          │
│  Sarah Mitchell ←→ Bright Future Foundation             │
│                                                      │
│  Narrative preview:                                  │
│  ┌────────────────────────────────────────────────┐  │
│  │ Sarah Mitchell appears as secured party in        │  │
│  │ [Doc-3] and as a board member in [Doc-1]...    │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  Cited documents (3):                                │
│  ✓ [Doc-3] Warranty Deed 2019 — Page 3               │
│  ✓ [Doc-4] UCC Filing 2019-0044123 — Page 1          │
│  ✓ [Doc-5] UCC Amendment 2019-0044124 — Page 1       │
│                                                      │
│  Signal rule: SR-004 · UCC_BURST                ▾   │  ← dropdown, pre-filled by Lead if matched
│                                                      │
│  Evidence weight:  ○ Speculative  ● Directional      │  ← radio
│                    ○ Documented   ○ Traced            │
│                                                      │
│  Outcome:  ● Confirmed (send to referral package)    │  ← radio
│            ○ Exhausted (dead end, dismiss)           │
│                                                      │
│  [ Cancel ]              [ Confirm angle ]           │
└──────────────────────────────────────────────────────┘
```

On confirm:
- PATCH `/api/cases/<uuid>/findings/<uuid>/` with `status=CONFIRMED` or `status=DISMISSED`,
  `evidence_weight=<selected>`, `rule_id=<selected>`, `narrative=<text>`
- If confirmed: connection edges for knots associated with this angle update to solid
  severity-based color in the web view
- Toast: "Angle confirmed · Added to referral package" or "Angle marked exhausted"

---

## 8. Angle Splitting and Connecting Knots

Both actions use the same modal with two tabs: **Split** and **Connect**.

### 8.1 Split angle

Triggered from the angle view toolbar "Split angle" or the right-click context menu on a
connection edge.

```
┌──────────────────────────────────────────────────────────┐
│  [ Split ]  [ Connect ]                                  │
├──────────────────────────────────────────────────────────┤
│  Split: UCC filing timeline                              │
│                                                          │
│  Assign each cited document to Angle A, Angle B, or     │
│  both. The parent angle will be marked Exhausted.        │
│                                                          │
│  ┌────────────────────────────────────────┐              │
│  │ ○ A  ● B  ○ Both  [Doc-4] UCC Filing  │              │
│  ├────────────────────────────────────────┤              │
│  │ ● A  ○ B  ○ Both  [Doc-3] Warranty D. │              │
│  ├────────────────────────────────────────┤              │
│  │ ○ A  ● B  ○ Both  [Doc-5] UCC Amend.  │              │
│  └────────────────────────────────────────┘              │
│                                                          │
│  ANGLE A                                                 │
│  Name: ________________________________                  │
│  Connects: Sarah Mitchell ←→ [ Bright Future F. ▾ ]        │  ← can redirect to different knot
│                                                          │
│  ANGLE B                                                 │
│  Name: ________________________________                  │
│  Connects: Sarah Mitchell ←→ [ EH Construction ▾ ]         │  ← redirected to different knot
│                               [ + New knot ]             │  ← inline knot creation
│                                                          │
│  [ Cancel ]                    [ Create angles ]         │
└──────────────────────────────────────────────────────────┘
```

Key rules:
- Each child angle can redirect to a DIFFERENT knot pair than the parent. This is the primary
  reason split exists — not just to create two copies.
- Parent angle is marked Exhausted (status=DISMISSED) when children are created.
- Each child starts as Active (status=NEEDS_EVIDENCE) with the assigned documents pre-cited.
- "+ New knot" opens an inline form (name, type, optional EIN) without leaving the modal.

### 8.2 Connect knots

Triggered from the web view toolbar "+ Angle", the Profile view "+ New angle", or a right-click
on the web canvas. Also accessible as the "Connect" tab in the split modal.

```
┌──────────────────────────────────────────────────────────┐
│  [ Split ]  [ Connect ]                                  │
├──────────────────────────────────────────────────────────┤
│  Connect two knots with a new angle                      │
│                                                          │
│  KNOT A                          KNOT B                  │
│  ┌──────────────────────┐   ┌──────────────────────┐    │
│  │ Sarah Mitchell          │   │ Select or create...  │    │
│  │ (pre-filled if from  │   │                      │    │
│  │  Profile view)       │   │ [ search knots... ]  │    │
│  └──────────────────────┘   │                      │    │
│                             │ ── existing knots ── │    │
│                             │ ○ Bright Future F.   │    │
│                             │ ○ EH Construction    │    │
│                             │ ○ James Mitchell       │    │
│                             │                      │    │
│                             │ [ + New knot ]       │    │  ← inline form
│                             └──────────────────────┘    │
│                                                          │
│  Angle name:                                             │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Property transfer — Sarah Mitchell → EH Construction  │  │  ← Lead auto-suggests on knot select
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  [ Cancel ]                    [ Create angle ]          │
└──────────────────────────────────────────────────────────┘
```

On submit: POST `/api/cases/<uuid>/findings/` with `status=NEEDS_EVIDENCE`, `source=MANUAL`,
two `FindingEntity` rows linking to both knots.

The Lead suggests an angle name automatically when both knots are selected (lightweight
inference based on knot names + existing angle context — does not require a full API call).

---

## 9. Document View (Level 4)

Triggered by clicking a document card in Angle view, or from the Profile view documents panel,
or from the connection review panel.

### Layout

```
┌────────────────────────────────────┬─────────────────────┐
│  BREADCRUMB: Web › Sarah › UCC... │                     │
├────────────────────────────────────┤  RAG SEARCH (open)  │
│                                    │                     │
│  DOCUMENT: UCC Filing 2019-0044123 │  ┌───────────────┐ │
│  [UCC]  Page 1 of 3                │  │ Search docs...│ │
│                                    │  └───────────────┘ │
│  ┌──────────────────────────────┐  │                     │
│  │ UCC FINANCING STATEMENT      │  │  Results (3):       │
│  │                              │  │                     │
│  │ Debtor:                      │  │  UCC Amend. 0044    │
│  │ ████████████████████████     │  │  "Secured party:    │
│  │ BRIGHT FUTURE FOUNDATION INC │  │  K. Mitchell..."       │
│  │                              │  │                     │
│  │ Secured party:               │  │  Warranty Deed 2019 │
│  │ ████████████████             │  │  "Sarah Mitchell,      │
│  │ SARAH MITCHELL                  │  │  grantor..."        │
│  │                              │  │                     │
│  │ Filing date:                 │  │  990 Form 2019      │
│  │ ████████████                 │  │  "K. Mitchell, Board   │
│  │ 11/14/2019                   │  │  member..."         │
│  │                              │  │                     │
│  └──────────────────────────────┘  └─────────────────────┘
└────────────────────────────────────┴─────────────────────┘
```

### Intake highlight layer

Overlaid on OCR text. Color-coded spans:

| Tag type | Background | Border-bottom | Text color |
|----------|-----------|--------------|------------|
| Entity | `#E6F1FB` (blue-50) | none | `#0C447C` (blue-800) |
| Date | `#FAEEDA` (amber-50) | none | `#633806` (amber-900) |
| Amount | `#EAF3DE` (green-50) | none | `#27500A` (green-800) |
| Flag | `#FAECE7` (coral-50) | `1.5px solid #D85A30` | `#712B13` (coral-800) |

Highlights come from `Document.ingestion_metadata["parsed_990"]` and entity extraction results.
Toggle: "Intake highlights" switch in the document toolbar.

### RAG search panel

- Default: open (toggleable, persists per session via localStorage)
- Triggered by: typing in the search box OR right-clicking selected text in the document
- Right-click context menu on selected text:
  - **"Search docs for '[selection]'"** — populates search box and runs query
  - **"Cite in angle"** — attaches this document + page to an angle via `FindingDocument`;
    shows a picker of active angles if multiple are open
  - **"Quick capture this"** — saves passage as `InvestigatorNote` on the current knot

Search implementation (v1): keyword grep against `Document.extracted_text` via the existing
`GET /api/search/` endpoint filtered to the current case. Full-text search is already in the
backend. Semantic embeddings deferred to v2.

Results show: document type badge, document name, matching excerpt (50 words around the match),
click to navigate to that document at the matching page.

---

## 10. Research Tab

External data source queries. Five connectors, four of them async.

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│  SOURCE:  [IRS 990 ▾]  [Ohio SOS]  [Ohio AOS]  [Recorder]  [Parcel] │
├──────────────────────────────────────────────────────────────┤
│  QUERY FORM (context-aware per source)                       │
│                                                              │
│  Search by: ● EIN  ○ Name                                   │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 31-1234567                                             │ │
│  └────────────────────────────────────────────────────────┘ │
│                                          [ Search ]          │
├──────────────────────────────────────────────────────────────┤
│  RECENT JOBS                                                 │
│                                                              │
│  ✓ IRS · "bright future" · 177 results · 16s ago      [ View ]   │
│  ↻ Ohio AOS · "Bright Future" · Running...      [Cancel]   │
│  ○ IRS · "31-1234567" · Queued                             │
├──────────────────────────────────────────────────────────────┤
│  RESULTS — IRS 990 · bright future · 177 filings                   │
│                                                              │
│  EIN            Name                       Year  Form  │ + │
│  ─────────────────────────────────────────────────────────  │
│  31-1234567     Bright Future Foundation         2022  990   │ + │
│  31-1234567     Bright Future Foundation         2021  990   │ + │
│  ...                                                        │
└──────────────────────────────────────────────────────────────┘
```

### Async job model

- POST to research endpoint returns `202 Accepted` + `{ job_id, status_url }`
- Frontend polls `GET /api/jobs/<uuid>/` every 2 seconds
- Job states: `QUEUED` → `RUNNING` → `SUCCESS` or `FAILED`
- On mount: `GET /api/cases/<uuid>/jobs/?limit=5` to reattach to in-flight jobs
  (investigator can close the tab and come back — jobs keep running in the worker)
- Hook: `useAsyncJob<TResult>` (built in Session 36) — expose `run`, `reattach`, status, result

### Sync vs async per source

| Source | Mode | Notes |
|--------|------|-------|
| IRS 990 (name search) | Async | Streams 50–90MB index CSVs |
| IRS 990 (fetch XML) | Async | One 990 XML per filing |
| Ohio AOS | Async | ASP.NET postback scrape |
| County Parcel | Async | ODNR ArcGIS (currently broken) |
| Ohio SOS | Sync | Local CSV search, fast |
| County Recorder | Sync | URL builder, no network call |

### Add to case

Each result row has a `+` button. Opens a quick dialog:
- "Create as Organization knot" (if EIN present)
- "Create as Document" (for 990 XML results — fetches and stores the filing)
- "Add as note" (free-form import)

---

## 11. Financials Tab

Year-over-year 990 data table sourced from `FinancialSnapshot` model. Rows are metrics, columns
are tax years. Shows up to 7 years (most available on IRS TEOS).

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│  FINANCIALS — Bright Future Foundation                        │
│  Source: IRS Form 990 · 6 years on file  [ Fetch new 990s ] │
├────────────────────┬──────┬──────┬──────┬──────┬──────┬─────┤
│ Metric             │ 2017 │ 2018 │ 2019 │ 2020 │ 2021 │2022 │
├────────────────────┼──────┼──────┼──────┼──────┼──────┼─────┤
│ Total revenue      │ 42K  │ 89K  │ ████ │ 198K │ 220K │240K │
│                    │      │      │ 191K │      │      │     │
│                    │      │      │ ↑127%│      │      │     │  ← SR-021 spike badge
├────────────────────┼──────┼──────┼──────┼──────┼──────┼─────┤
│ Total expenses     │ 38K  │ 80K  │ 170K │ 185K │ 200K │215K │
├────────────────────┼──────┼──────┼──────┼──────┼──────┼─────┤
│ Program services   │ 30K  │ 60K  │ ████ │ 70K  │ 75K  │ 80K │
│ (% of expenses)    │ 79%  │ 75%  │ 38%  │ 38%  │ 38%  │ 37% │  ← SR-029 flagged (coral)
├────────────────────┼──────┼──────┼──────┼──────┼──────┼─────┤
│ Net assets         │  4K  │  9K  │  21K │  34K │  54K │ 79K │
├────────────────────┼──────┼──────┼──────┼──────┼──────┼─────┤
│ Officer comp       │   $0 │   $0 │   $0 │   $0 │   $0 │  $0 │  ← SR-013 flagged (coral)
└────────────────────┴──────┴──────┴──────┴──────┴──────┴─────┘
```

### Anomaly highlighting

Cells that triggered a signal rule are highlighted:

- **SR-021 (REVENUE_SPIKE, >100% YoY)** — amber cell background, `↑127%` badge below the value
- **SR-029 (LOW_PROGRAM_RATIO, <50%)** — coral cell background
- **SR-013 (ZERO_OFFICER_PAY at high-revenue org)** — coral cell background on the entire officer
  comp row when revenue exceeds $100K threshold

Clicking a highlighted cell opens a tooltip:
```
SR-021 · REVENUE_SPIKE
Revenue increased 127% from 2018 to 2019.
Threshold: >100% year-over-year.

[ Open existing angle ]    [ Start new angle ]
```

**"Open existing angle"** — only shown if an angle already exists citing a document that
triggered this rule. Navigates to that angle in the Investigate tab.

**"Start new angle"** — navigates to the Investigate tab and opens the Connect knots modal
pre-filled with this organization as Knot A and an empty Knot B picker. The angle name
is pre-suggested ("Revenue spike 2019 — Bright Future Foundation").

### Sparklines

Each row has a small sparkline chart (40px tall, TanStack Table column) showing the trend across
all years. Revenue and expenses share the same scale for visual comparison.

---

## 12. Timeline Tab

Brushable chronological rail of all case events. Particularly useful for showing compression
patterns (SR-004 UCC burst, timeline of property transfers vs. 990 filings).

### Event types and colors

| Event type | Color | Source |
|-----------|-------|--------|
| Document uploaded | Gray | `Document.created_at` |
| 990 filing | Blue | `FinancialSnapshot.tax_year` |
| Property transaction | Amber | `PropertyTransaction.transaction_date` |
| UCC filing / amendment | Coral | `FinancialInstrument` (instrument_type=UCC) |
| Confirmed finding | Green with check | `Finding.status=CONFIRMED` |
| Quick capture | Purple dot | `InvestigatorNote.created_at` |

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  TIMELINE — Bright Future Foundation                         │
│  [ 2015 ─────────────────────────────────────── 2023 ]     │  ← brush range
│  [ 2018 ─────────────────── 2020 ]  (zoomed)              │
├─────────────────────────────────────────────────────────────┤
│   2018                2019                2020              │
│                                                             │
│    ●990               ●UCC 0044   ●DEED   ●990   ●UCC amnd │
│                       ●UCC 0045           ●990              │  ← SR-004 burst visible as column
│                       ●UCC 0046                             │
│                                                             │
│    [  ]               [  ][  ]    [  ]   [  ]   [  ]      │  ← event cards below
└─────────────────────────────────────────────────────────────┘
```

### Behavior

- **Brush** — range selector at the top. Dragging updates the visible date range. Double-click
  resets to full range.
- Events that cluster within 24 hours are grouped into a vertical stack — the SR-004 UCC burst
  pattern becomes visible as a tall stack of coral dots on a single day. Clicking the stack
  opens a popup listing all events in the cluster.
- **Clicking an event card** — navigates to the relevant document (Level 4) or angle (Level 3)
- **"Cite in angle" on an event card** — attaches the document to any active angle via
  `FindingDocument`; shows an angle picker ("Which angle?") if multiple are active; includes
  "Create new angle" as the last option in the picker
- **Filter chips** — toggle each event type on/off. Chips: All · Documents · 990s · Transactions ·
  UCC · Angles · Notes

### Event card anatomy

```
┌─────────────────────────────────────────────┐
│  [UCC]  UCC Amendment 2019-0044124          │  ← doc type badge + name
│  Nov 14, 2019 · Extracted by Intake         │
│  "Secured party: K. Mitchell..."               │  ← 1-line excerpt
│                                             │
│  [ View document ]  [ Cite in angle ]       │
└─────────────────────────────────────────────┘
```

For confirmed angles:
```
┌─────────────────────────────────────────────┐
│  [CONFIRMED]  UCC filing timeline           │  ← angle status badge + name
│  Nov 14, 2019 · SR-004 · DIRECTIONAL        │
│  Sarah Mitchell ←→ Bright Future Foundation    │
│                                             │
│  [ Open angle ]                             │
└─────────────────────────────────────────────┘
```

---

## 13. AI Role Naming — LOCKED

This is non-negotiable. Do not expose model names anywhere in the UI.

| Role | Display name | Underlying model | Where it appears |
|------|-------------|-----------------|-----------------|
| Extraction | **Intake** | Claude Haiku | "Intake" chip on evidence cards; "Extracted by Intake" label; highlight legend |
| Reasoning | **Lead** | Claude Sonnet | Lead panel header; "Lead is thinking..." spinner; Lead suggestion cards |

### Banned strings (never appear in UI text)
- Haiku
- Sonnet
- Opus
- Claude
- AI assistant
- LLM
- Machine learning model
- GPT (or any other model name)

The investigative framing is deliberate: "Intake" evokes the evidence room intake process;
"Lead" evokes the lead investigator directing the case.

---

## 14. Decisions Log

All design decisions made during wireframing sessions. These are locked — change requires a
session decision, not a code change.

| ID | Decision | Notes |
|----|---------|-------|
| OQ-1 | Cytoscape.js for web graph | Better interaction model than D3 for click/select/zoom |
| OQ-2 | Five tabs: Investigate, Research, Financials, Timeline, Referrals | Referrals deferred |
| OQ-3 | Four-level navigation: Web → Profile → Angle → Document | Breadcrumb always visible below Level 1 |
| OQ-4 | Angle = Finding model, Connection = Relationship/PersonOrganization, Profile = entity + FinancialSnapshot[] | No new backend models needed |
| OQ-5 | Active = NEEDS_EVIDENCE, Confirmed = CONFIRMED, Exhausted = DISMISSED | |
| OQ-6 | Lead panel auto-refreshes on cited document change (debounced 3s) | |
| OQ-7 | RAG search: keyword grep in v1, semantic embeddings deferred to v2 | Uses existing /api/search/ |
| OQ-8 | Confirmation at tie-off level only — not per extracted fact | Can revisit via prompt change |
| OQ-9 | Only Person and Organization can be knots — not Property | "You can't press charges on a property" |
| OQ-10 | One angle has exactly two knots | Multiple angles can share the same pair |
| OQ-11 | Angle split can redirect each child to a DIFFERENT knot pair than parent | Key reason split exists |
| OQ-12 | AI names are "Intake" (Haiku) and "Lead" (Sonnet) — never show model names | LOCKED |
| OQ-13 | RAG panel is toggleable, default open | |
| OQ-14 | Angle splitting and connecting knots share one modal with two tabs | |
| OQ-15 | Financials anomaly cells show BOTH "Open existing angle" and "Start new angle" in tooltip | "Financials are a description, not an angle" |
| OQ-16 | SR-004 UCC burst visible as vertical stack of events on Timeline tab | |
| OQ-17 | Connection review is non-blocking — pending connections shown as dashed edges, reviewed when ready | Investigator should never be forced to confirm before continuing |
| OQ-18 | Connection review always shows the document excerpt — never confirm blind | Legal defensibility requirement |
| OQ-19 | Manual connections allowed (dotted edge) for sources that cannot be uploaded (e.g. social media) | |
| OQ-20 | Documents do two jobs: (1) build profiles via extracted facts, (2) establish connections when two entities appear together | Documents do NOT belong to angles; angles cite documents as evidence |
| OQ-21 | Vocabulary: Connection (factual link), Profile (entity portrait), Angle (investigative narrative) | Replaces ambiguous "Thread" terminology |

---

## 15. Overflow Menus, Pickers, and Secondary Interactions

### 15.1 Cited document card overflow menu (· · ·)

Appears on every cited document card in the Angle view, top-right corner. Opens a small dropdown:

```
┌──────────────────────────────┐
│  View document               │  ← navigate to Document view (Level 4)
│  Remove citation             │  ← DELETE FindingDocument row; document stays in case
│  Move to different angle     │  ← reassign: opens angle picker dropdown
│  ──────────────────────────  │
│  View source page            │  ← jump to the specific page number stored in FindingDocument
└──────────────────────────────┘
```

"Remove citation" requires a confirmation toast (see Section 15.4) — citation removal is
a chain-of-custody action and should not be silent.

### 15.2 Cite document picker

Opens when the investigator clicks "Cite document" on the Angle view toolbar.

```
┌──────────────────────────────────────────────────────┐
│  Cite a document in: UCC filing timeline             │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │ Filter documents...                             │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  Already cited in this angle (3) ──────────────────  │
│  ✓ [Doc-3] Warranty Deed 2019                        │
│  ✓ [Doc-4] UCC Filing 2019-0044123                   │
│  ✓ [Doc-5] UCC Amendment 2019-0044124                │
│                                                       │
│  Available (8) ────────────────────────────────────  │
│  ○ [Doc-1] Form 990 · 2019                           │  ← checkbox
│  ○ [Doc-2] Form 990 · 2020                           │
│  ○ [Doc-6] Quit-Claim Deed 2021                      │
│  ○ [Doc-7] UCC Filing 2022-0081233                   │
│  ...                                                  │
│                                                       │
│  [ Cancel ]              [ Cite selected (0) ]       │
└──────────────────────────────────────────────────────┘
```

- Documents already cited are shown grayed-out (already attached, not re-selectable)
- Document type badges match the Angle view card badges
- "Cite selected" button label updates live: "Cite selected (2)", "Cite selected (0)", etc.
- On confirm: POST one `FindingDocument` row per selected document. Each is attached with `page_ref=null`
  initially — investigator can set a specific page via the card's "View source page" action later.
- Source: `GET /api/cases/<uuid>/documents/` filtered to exclude already-cited IDs

### 15.3 Add to case dialog (Research tab)

Each result row in the Research tab has a `+` button. Opens a small popover (not a full modal):

```
┌────────────────────────────────────────┐
│  Add to investigation                   │
│                                         │
│  [ Create Organization knot ]           │  ← if EIN present in result
│    "Bright Future Foundation"                 │     POST /api/cases/<id>/findings/ linking org
│                                         │
│  [ Fetch and store 990 XML ]            │  ← IRS results only
│    Stores as Document + runs Intake     │     POST /api/cases/<id>/fetch-990s/ for this EIN
│                                         │
│  [ Save as note ]                       │  ← always available
│    Adds InvestigatorNote with result    │     POST /api/cases/<id>/notes/
│    as body text                         │
└────────────────────────────────────────┘
```

After any action, the `+` button on that row changes to a `✓` checkmark (disabled). Multiple
actions on the same result are allowed — you can create a knot AND save a note.

"Fetch and store 990 XML" is only shown for IRS results. It runs the IRS TEOS XML fetch for that
specific EIN (`POST /api/cases/<uuid>/fetch-990s/`), stores the filing as a `Document`, and
triggers Intake extraction. A toast fires when extraction completes (see Section 15.4).

### 15.4 Toast notifications

Toasts appear bottom-right, 4s auto-dismiss, using the `sonner` library.

| Trigger | Toast text | Type |
|---------|-----------|------|
| Document uploaded | "Intake is processing [filename]..." | Info (spinner) |
| Intake extraction complete | "Intake finished: [N] entities, [M] flags found in [filename]" | Success |
| Angle tied off (confirmed) | "Angle confirmed — added to referral package" | Success |
| Angle tied off (exhausted) | "Angle marked exhausted" | Info |
| Angle created | "New angle: [angle name]" | Success |
| Citation removed from angle | "Removed [docname] from [angle name]. [Undo]" | Warning with Undo |
| Connection confirmed | "Connection confirmed: [Knot A] ←→ [Knot B]" | Success |
| Knot created | "[Name] added to the web" | Success |
| Lead suggestions ready | (no toast — Lead panel just updates silently) | — |
| Research job complete | "IRS search complete — [N] results found" | Success |
| Research job failed | "IRS search failed: [error reason]" | Error |
| 990 fetch + Intake complete | "990 loaded — Intake found [N] entities" | Success |
| AI pattern analysis complete | "[N] AI patterns found · [M] dropped" | Success |

**Undo** on citation removal: a 5s window. Clicking Undo re-creates the `FindingDocument` row.
After 5s the undo option expires and removal is permanent (an `AuditLog` entry records the removal).

### 15.5 Empty states

Each view needs a clear empty state so the recruiter demo doesn't show a blank screen.

**Web view (no knots)**
```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│               (web icon — faint nodes and edges)            │
│                                                             │
│          Your investigation web is empty.                   │
│                                                             │
│    Add a person or organization to start building the web.  │
│                                                             │
│              [ + Add first knot ]                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Angle view (no citations yet)**
```
┌─────────────────────────────────────────────────────────────┐
│  ANGLE: [name]                                              │
│  Status: ACTIVE — no documents cited yet                    │
│                                                             │
│   (document icon — faint)                                   │
│                                                             │
│   No documents cited in this angle yet.                     │
│   Cite a document from the case to start building           │
│   the narrative.                                            │
│                                                             │
│              [ + Cite first document ]                      │
└─────────────────────────────────────────────────────────────┘
```
The Lead panel in this state shows one static prompt: "Cite a document in this angle and Lead
will suggest what to look for next."

**Research tab (no jobs run yet)**
```
Select a source above and run your first search.
```
Small, non-intrusive. Does not use an icon.

**Financials tab (no snapshots)**
```
No Form 990 data on file for this case.

[ Fetch 990 data ]   or   use Research → IRS 990 to find filings.
```

### 15.6 Global command palette (Cmd+K)

Available on every page and tab. Opens a `cmdk` Command palette.

```
┌──────────────────────────────────────────────────────────┐
│  ┌────────────────────────────────────────────────────┐  │
│  │ ⌘  Search or jump to...                            │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  Recent                                                  │
│  → Sarah Mitchell — Person                                  │
│  → UCC filing timeline — Angle (Sarah Mitchell ↔ BFF)      │
│  → Form 990 · 2019 — Document                            │
│                                                          │
│  Quick actions                                           │
│  + Add knot                                              │
│  + New angle                                             │
│  ↑ Upload document                                       │
│  ⌘K  Run Research search                                 │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

Typing filters all entity names, document names, angle names, and quick actions simultaneously.
Pressing Enter on a result navigates to it (Profile view for entities, Angle view for findings,
Document view for documents). Quick actions open the relevant modal.

Source: the existing `GET /api/search/` endpoint handles the text search. The command palette
adds quick actions on top of the search results.

---

## 16. Timeline Tab — Add Event

Triggered by the `+ Add event` button on the Timeline tab toolbar.

```
┌──────────────────────────────────────────────────────┐
│  Add event to timeline                                │
│                                                       │
│  Event type:                                          │
│  ┌──────────────────────────────────────────────┐    │
│  │ Manual note                                ▾ │    │  ← dropdown
│  └──────────────────────────────────────────────┘    │
│  (Property transaction / UCC filing / Other)          │
│                                                       │
│  Date:  ┌──────────────────────────────────────┐     │
│         │ 2019-11-14                            │     │
│         └──────────────────────────────────────┘     │
│                                                       │
│  Description:                                         │
│  ┌────────────────────────────────────────────────┐  │
│  │                                                │  │
│  └────────────────────────────────────────────────┘  │
│                                                       │
│  Cite in angle (optional):                            │
│  ┌──────────────────────────────────────────────┐    │
│  │ Select angle...                            ▾ │    │
│  └──────────────────────────────────────────────┘    │
│                                                       │
│  ─────────────────────────────────────────────────── │
│  Start a new angle from this event?  [ Yes / No ]    │
│                                                       │
│  If Yes → opens "Connect knots" modal after save     │
│  (pre-filled with event description as angle name)   │
│                                                       │
│  [ Cancel ]                    [ Add to timeline ]    │
└──────────────────────────────────────────────────────┘
```

Implementation: a manual event is stored as an `InvestigatorNote` with a `date` field in the
body JSON. The timeline renders it as a purple dot at that date (same as Quick capture). It is
NOT a `Finding` unless the investigator chooses "Create a finding from this event."

"Start a new angle from this event → Yes" flow:
1. "Add to timeline" saves the note
2. The Connect knots modal opens immediately after, pre-filled with the event description as
   the angle name. At least one citation is required before the angle can be tied off — the
   note gives context, but an angle must have at least one cited document to be confirmed.

---

## 18. Build Sequence

Recommended implementation order. Each step is independently testable.

1. **Cytoscape.js scaffolding** — install library, render empty canvas, zoom/pan
2. **Web view: nodes** — wire to `/api/cases/<uuid>/graph/`, render Person + Org nodes with
   correct colors, pending connection badge
3. **Web view: edges** — render connections as edges with state-based styling (dashed/solid/dotted)
4. **Profile view** — click node → side panel with entity metadata, documents panel, connections
   panel, angles panel
5. **Connection review panel** — pending connection card with document excerpt, confirm/dismiss
6. **Angle view** — click edge OR angle card → narrative editor, cited documents list, Lead panel
7. **Cited document card rendering** — doc type badges, `[Doc-N]` refs, Intake fact tags chip
8. **Lead panel** — wire to `ai_pattern_augmentation.py`, show suggestions, spinner state
9. **Document view** — OCR text display, Intake highlight layer, RAG search panel
10. **RAG right-click menu** — "Search docs for", "Cite in angle", "Quick capture this"
11. **Cite document picker** — document picker, `FindingDocument` creation, `[Doc-N]` insertion
12. **Tie-off modal** — narrative preview, cited docs list, signal rule dropdown, evidence weight,
    outcome radio, confirm → PATCH Finding
13. **Angle split modal** — citation assignment A/B/Both, child angle creation
14. **Connect knots modal** — knot selection, inline knot creation, Lead name suggestion
15. **Quick capture** — textarea on Profile view, InvestigatorNote creation
16. **Research tab** — source picker, query form, `useAsyncJob` hook, job status rail, results table
17. **Add to case** — result → knot/document promotion
18. **Financials tab** — YoY table, anomaly cell highlighting with dual tooltip buttons, sparklines
19. **Timeline tab** — event rail, brush range, event type colors, cluster view, "Cite in angle" picker
20. **Breadcrumb + back navigation** — full four-level nav with browser back support
21. **Minimap** — Cytoscape minimap overlay on web view

Steps 1–12 cover the full recruiter demo path (web → profile → angle → document → tie-off).
Steps 13–15 cover the investigation creation flow.
Steps 16–17 cover the data import flow.
Steps 18–21 are the remaining tabs and polish.
