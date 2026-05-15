# Frontend Dark Redesign — Design Spec
**Date:** 2026-05-15
**Status:** Approved by Tyler

---

## Problem

The Catalyst frontend has all the right components and API wiring, but the visual design does not match the wireframes. The app looks unpolished. The goal is to make it look like a professional investigation tool (Maltego / Palantir class) — dark, dense, intentional.

---

## Approach: Extract & Port (Option A)

The 14 HTML wireframes in `HTML wireframes/` already define a complete design system — color tokens, spacing, typography, component patterns. The work is to:

1. Define a dark-mode CSS variable system in `frontend/src/index.css`
2. Port the wireframe component CSS into reusable classes in `index.css`
3. Rewrite each React component's JSX and className usage to use those classes — no inline styles

**We do not change any backend code. We do not change any API calls. We do not add new libraries.**

---

## Dark Color Token System

These CSS custom properties go in `:root` in `frontend/src/index.css`. They replace the existing sparse token set.

```css
:root {
  /* Backgrounds — 4 layers of depth */
  --bg-0: #0d1117;      /* outermost canvas (graph, page bg) */
  --bg-1: #161b22;      /* app shell, sidebars, topnav, tabbar */
  --bg-2: #1f2937;      /* cards, panels, dropdowns */
  --bg-3: #374151;      /* hover states, tertiary fills */

  /* Borders */
  --border-1: #30363d;  /* primary dividers */
  --border-2: #4b5563;  /* secondary borders, inputs */

  /* Text */
  --text-1: #e6edf3;    /* primary text */
  --text-2: #9ca3af;    /* secondary text, labels */
  --text-3: #6b7280;    /* tertiary text, placeholders */

  /* Accent */
  --accent: #60a5fa;
  --accent-bg: rgba(96,165,250,0.12);

  /* Severity (kept from CLAUDE.md spec) */
  --critical: #f87171;
  --critical-bg: rgba(248,113,113,0.12);
  --high: #fbbf24;
  --high-bg: rgba(251,191,36,0.12);
  --medium: #34d399;
  --medium-bg: rgba(52,211,153,0.12);

  /* Graph nodes */
  --node-person: #3b82f6;
  --node-org: #14b8a6;

  /* Shared shape */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
}
```

---

## Component CSS Classes

These classes go in `index.css` after the token definitions. React components reference them via `className`. No styled-components, no Tailwind.

### Buttons
```css
.btn-primary    /* blue fill — main actions */
.btn-ghost      /* transparent + border — secondary actions */
.btn-xs         /* 11px, 4px 10px padding — inline actions */
.btn-danger     /* red fill — destructive actions */
```

### Badges / Pills
```css
.badge-critical   /* red pill */
.badge-high       /* amber pill */
.badge-medium     /* green pill */
.badge-neutral    /* gray pill */
.badge-pulling    /* blue pill — angle status */
.badge-confirmed  /* green pill — angle status */
.badge-dismissed  /* gray pill — angle status */
.entity-type-badge.person
.entity-type-badge.org
.doc-type-badge   /* 990 / DEED / UCC / SOS / PERMIT */
```

### Layout
```css
.topnav           /* 44px fixed top nav bar */
.tabbar           /* tab bar row below topnav */
.tab              /* individual tab */
.tab.active       /* underline + white text */
.web-toolbar      /* 44px left icon rail for graph tools */
.right-panel      /* 280px right stats/detail panel */
.knot-left        /* 260px entity sidebar in knot view */
.knot-main        /* scrollable main content in knot view */
```

### Cards
```css
.angle-card       /* clickable angle row with severity bar */
.angle-bar.critical / .high / .medium / .neutral
.conn-card        /* connection row */
.doc-row          /* document list row */
.stat-card        /* small metric tile (3-col grid) */
.finding-card     /* finding detail card */
```

### Section structure
```css
.section-head     /* flex row: label + "+ add" link */
.section-title    /* 11px uppercase label */
.section-add      /* blue "+ New X" link */
```

---

## Priority Screens

### Screen 1: Case Detail Shell

The outer container that wraps all tabs. Applies to `CaseDetailView.tsx`.

**Structure:**
```
.topnav
  wordmark | breadcrumb (Cases › Case Name) | status pill | Upload docs btn
.tabbar
  [Investigate] [Research] [Financials] [Timeline] [Referrals]
<tab content fills remaining height>
```

**Key details:**
- `topnav` is `--bg-1`, 44px, `border-bottom: 1px solid var(--border-1)`
- Active tab uses `border-bottom: 2px solid var(--accent)` and `color: var(--text-1)`
- Inactive tabs use `var(--text-3)`, hover to `var(--text-2)`
- Status pill: green for ACTIVE, amber for PAUSED, gray for REFERRED/CLOSED

### Screen 2: Investigate Tab — Web (Level 1)

Three-column layout inside the tab. Applies to `InvestigateTab.tsx`.

**Structure:**
```
.web-toolbar (44px, left)
.graph-canvas (flex:1, --bg-0)
.right-panel (280px, --bg-1)
```

**Web toolbar** — vertical icon strip. Buttons: + Knot, + Connection, + Angle, divider, Fit, Zoom+, Zoom−, divider, Pending badge. Pending connections badge is amber with count.

**Graph canvas** — `--bg-0` (#0d1117). Cytoscape stylesheet stays the same (it already uses the right node colors from CLAUDE.md). The canvas bg just needs to be dark.

**Right panel** — shows case stats (3-col stat grid: Critical / High / Confirmed) + recent angles list when nothing selected. Shows connection detail when an edge is clicked.

### Screen 3: Knot Profile (Level 2)

Two-column layout replacing the graph canvas when a knot is clicked. Applies to `ProfilePanel.tsx`.

**Structure:**
```
.knot-left (260px, --bg-1)
  ← back breadcrumb
  entity avatar (colored circle, initials)
  entity name + type badge
  meta table (EIN, State, Formed, Revenue)
  divider
  3-col stat grid (Angles / Confirmed / Docs)
  divider
  Quick capture button (dashed border)

.knot-main (flex:1, scrollable)
  section: Angles (angle cards with severity bar)
  section: Connections (conn cards with colored dot)
  section: Source documents (doc rows with type badge)
```

**Avatar colors:**
- Person: `rgba(59,130,246,0.2)` bg, `#3b82f6` text
- Org: `rgba(20,184,166,0.2)` bg, `#14b8a6` text

---

## Build Sequence

Build screens in this order. Each screen must look correct before moving to the next.

1. **CSS foundation** — define all tokens and component classes in `index.css`. No JSX changes yet. Verify the existing app doesn't explode.
2. **Case Detail shell** — `CaseDetailView.tsx`: topnav, tabbar, tab active state. This is the chrome that wraps everything.
3. **Investigate Tab — Web view** — `InvestigateTab.tsx`: toolbar, canvas bg, right panel stats.
4. **Knot Profile** — `ProfilePanel.tsx`: left entity sidebar, right sections (angles, connections, docs).
5. **Angle View** — `AngleView.tsx`: evidence feed, Lead panel, breadcrumb nav.
6. **Document View** — `DocumentView.tsx`: OCR text area, Intake highlight pills, RAG panel.
7. **Remaining tabs** — `ResearchTab`, `FinancialsTab`, `TimelineTab` — apply the same token + class system.

---

## What Does NOT Change

- All API client code (`frontend/src/api/`)
- All TypeScript types (`frontend/src/types/index.ts`)
- All business logic (async job polling, graph data transforms, entity resolution)
- The Cytoscape stylesheet (node/edge colors already match CLAUDE.md spec)
- Backend code (none)

---

## Definition of Done

- Running `npm run dev` shows a dark-mode app that matches the mockup approved in brainstorming
- `npx tsc --noEmit` passes with zero errors
- `npm run build` produces a clean production build
- Minimal inline `style={{...}}` props in priority screens — CSS classes for all recurring patterns; inline styles only for one-off values (e.g., dynamic widths, Cytoscape config)
- The 4-level drill-down (Web → Knot → Angle → Document) is navigable end-to-end
