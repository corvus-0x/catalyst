# Frontend Dark Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `index.css` to a dark token system and update the four priority views (CaseDetailView, InvestigateTab, ProfilePanel, AngleView) to match the approved dark mockup.

**Architecture:** CSS-first. Task 1 replaces every hardcoded light color in `index.css` with dark token variables — this alone makes 80% of the app go dark without touching any JSX. Tasks 2-4 handle the small structural changes (shell header, vertical toolbar, two-column knot layout) that CSS alone cannot fix.

**Tech Stack:** React 18, TypeScript, vanilla CSS (no new libraries). Verify with `npx tsc --noEmit` and `npm run build` after each task.

---

## File Map

| File | What changes |
|------|-------------|
| `frontend/src/index.css` | Full token replacement — dark `:root`, all class color values updated |
| `frontend/src/views/CaseDetailView.tsx` | Replace inline-style header with `.case-shell-header` class |
| `frontend/src/views/InvestigateTab.tsx` | `WebToolbar` → vertical left rail; outer layout → row; canvas bg dark |
| `frontend/src/views/ProfilePanel.tsx` | Replace right-panel layout with `knot-view` two-column layout |
| `frontend/src/views/AngleView.tsx` | Update hardcoded light colors in inline styles to dark tokens |

---

## Task 1: Dark CSS Foundation

**Files:**
- Modify: `frontend/src/index.css`

The entire file is rewritten. Every hardcoded light color (`#fff`, `#111827`, `#e5e7eb`, etc.) becomes a dark token reference. Class names and structure stay identical — only color values change. This single task makes the whole app go dark.

- [ ] **Step 1.1: Replace the entire `:root` block and `body` rule**

Find this section at the top of `index.css` (lines 1-53):

```css
/* ─── Color tokens ── */
:root {
  --color-critical: #D85A30;
  ...
}
...
body {
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 14px;
  color: #111827;
}
```

Replace with:

```css
/* ─── Design tokens — dark mode ─────────────────────────────────────────────── */

:root {
  /* Backgrounds */
  --bg-0: #0d1117;
  --bg-1: #161b22;
  --bg-2: #1f2937;
  --bg-3: #374151;

  /* Borders */
  --border-1: #30363d;
  --border-2: #4b5563;

  /* Text */
  --text-1: #e6edf3;
  --text-2: #9ca3af;
  --text-3: #6b7280;

  /* Accent */
  --accent: #60a5fa;
  --accent-bg: rgba(96,165,250,0.12);

  /* Severity (edges + badges) */
  --color-critical: #f87171;
  --color-high: #fbbf24;
  --color-medium: #34d399;
  --color-informational: #6b7280;
  --color-coral: #f87171;

  /* Severity with alpha (backgrounds) */
  --critical-bg: rgba(248,113,113,0.12);
  --high-bg: rgba(251,191,36,0.12);
  --medium-bg: rgba(52,211,153,0.12);

  /* Graph node fills */
  --color-knot-person: #3b82f6;
  --color-knot-org: #14b8a6;

  /* Intake highlight pills — keep contrast on dark */
  --tag-entity-bg: #1e3a5f;
  --tag-entity-color: #93c5fd;
  --tag-date-bg: #3b2800;
  --tag-date-color: #fcd34d;
  --tag-amount-bg: #1a3a1a;
  --tag-amount-color: #86efac;
  --tag-flag-bg: #3b1a1a;
  --tag-flag-color: #fca5a5;

  /* Border radius */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
}

/* ─── Reset ───────────────────────────────────────────────────────────────────── */

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  height: 100%;
  margin: 0;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 14px;
  background: var(--bg-0);
  color: var(--text-1);
}

#root {
  height: 100%;
}

[role="tabpanel"]:focus,
[role="tabpanel"]:focus-visible {
  outline: none;
}

.cytoscape-container:focus,
.cytoscape-container:focus-visible {
  outline: none;
}
```

- [ ] **Step 1.2: Update tab primitives**

Find the `/* ─── Tab primitives (Radix UI) ─── */` section. Replace with:

```css
/* ─── Tab primitives (Radix UI) ─────────────────────────────────────────────── */

.tabs-list {
  display: flex;
  border-bottom: 1px solid var(--border-1);
  padding: 0 16px;
  background: var(--bg-1);
  flex-shrink: 0;
}

.tabs-trigger {
  padding: 10px 16px;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-3);
  transition: color 0.12s, border-color 0.12s;
  white-space: nowrap;
}

.tabs-trigger:hover {
  color: var(--text-2);
}

.tabs-trigger[data-state="active"] {
  color: var(--text-1);
  border-bottom-color: var(--accent);
}

.tab-panel[data-state="inactive"] { display: none; }
.tab-panel[data-state="active"]   { flex: 1; min-height: 0; display: flex; flex-direction: column; }
```

- [ ] **Step 1.3: Update toolbar buttons**

Find `/* ─── Toolbar buttons ─── */`. Replace with:

```css
/* ─── Toolbar buttons ────────────────────────────────────────────────────────── */

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  background: var(--bg-2);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-2);
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s, color 0.1s;
}

.toolbar-btn:hover {
  background: var(--bg-3);
  border-color: var(--border-2);
  color: var(--text-1);
}

.toolbar-btn:active {
  background: var(--bg-3);
}

.toolbar-btn--pending {
  border-color: var(--color-high);
  color: var(--color-high);
  background: var(--high-bg);
}

.toolbar-btn--pending:hover {
  background: rgba(251,191,36,0.2);
}
```

- [ ] **Step 1.4: Update status pill**

Find `/* ─── Status pill ─── */`. Replace with:

```css
/* ─── Status pill ───────────────────────────────────────────────────────────── */

.status-pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.status-pill--active   { background: rgba(52,211,153,0.15); color: #34d399; border: 1px solid rgba(52,211,153,0.25); }
.status-pill--paused   { background: rgba(251,191,36,0.15); color: #fbbf24; border: 1px solid rgba(251,191,36,0.25); }
.status-pill--referred { background: var(--accent-bg); color: var(--accent); border: 1px solid rgba(96,165,250,0.25); }
.status-pill--closed   { background: var(--bg-3); color: var(--text-3); border: 1px solid var(--border-1); }
```

- [ ] **Step 1.5: Update empty state**

Find `/* ─── Empty state ─── */`. Replace with:

```css
/* ─── Empty state ───────────────────────────────────────────────────────────── */

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  color: var(--text-3);
  text-align: center;
  padding: 32px;
}

.empty-state__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-2);
  margin: 0;
}

.empty-state__body {
  font-size: 14px;
  margin: 0;
  max-width: 320px;
}
```

- [ ] **Step 1.6: Update right panel + panel header**

Find `/* ─── Right panel ─── */`. Replace with:

```css
/* ─── Right panel (Profile / Angle / Connection review) ─────────────────────── */

.right-panel {
  border-left: 1px solid var(--border-1);
  background: var(--bg-1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex-shrink: 0;
}

.right-panel--profile { width: 380px; }
.right-panel--angle   { width: 600px; }

.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-1);
  flex-shrink: 0;
  background: var(--bg-1);
}

.panel-section {
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-1);
}

.panel-section__title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-3);
  margin: 0 0 6px;
}

.panel-scroll {
  flex: 1;
  overflow-y: auto;
}
```

- [ ] **Step 1.7: Update entity avatar, doc badges, angle/severity/weight badges**

Find `/* ─── Entity avatar ─── */`. Replace from there through end of badge section with:

```css
/* ─── Entity avatar ──────────────────────────────────────────────────────────── */

.entity-avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 700;
  flex-shrink: 0;
}

.entity-avatar--person { background: rgba(59,130,246,0.2); color: #60a5fa; }
.entity-avatar--org    { background: rgba(20,184,166,0.2); color: #14b8a6; }

/* ─── Doc type badges ────────────────────────────────────────────────────────── */

.doc-badge {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  flex-shrink: 0;
}

.doc-badge--IRS_990        { background: rgba(96,165,250,0.15); color: #60a5fa; }
.doc-badge--DEED           { background: rgba(52,211,153,0.15); color: #34d399; }
.doc-badge--UCC            { background: rgba(251,191,36,0.15); color: #fbbf24; }
.doc-badge--AUDIT_REPORT   { background: rgba(192,132,252,0.15); color: #c084fc; }
.doc-badge--BANK_STATEMENT { background: rgba(167,139,250,0.15); color: #a78bfa; }
.doc-badge--PERMIT         { background: rgba(248,113,113,0.15); color: #f87171; }
.doc-badge--CONTRACT       { background: rgba(52,211,153,0.15); color: #34d399; }
.doc-badge--CORRESPONDENCE { background: rgba(96,165,250,0.15); color: #60a5fa; }
.doc-badge--OTHER,
.doc-badge--UNKNOWN        { background: var(--bg-3); color: var(--text-3); }

/* ─── Status / severity / weight / connection badges ────────────────────────── */

.angle-badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; letter-spacing: 0.03em; }
.angle-badge--NEW            { background: rgba(167,139,250,0.15); color: #a78bfa; }
.angle-badge--NEEDS_EVIDENCE { background: var(--high-bg); color: var(--color-high); }
.angle-badge--CONFIRMED      { background: var(--medium-bg); color: var(--color-medium); }
.angle-badge--DISMISSED      { background: var(--bg-3); color: var(--text-3); }

.severity-badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: 700; }
.severity-badge--CRITICAL    { background: var(--critical-bg); color: var(--color-critical); }
.severity-badge--HIGH        { background: var(--high-bg); color: var(--color-high); }
.severity-badge--MEDIUM      { background: var(--medium-bg); color: var(--color-medium); }
.severity-badge--LOW,
.severity-badge--INFORMATIONAL { background: var(--bg-3); color: var(--text-3); }

.weight-badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: 600; }
.weight-badge--SPECULATIVE { background: var(--bg-3); color: var(--text-3); }
.weight-badge--DIRECTIONAL { background: var(--high-bg); color: var(--color-high); }
.weight-badge--DOCUMENTED  { background: var(--accent-bg); color: var(--accent); }
.weight-badge--TRACED      { background: var(--medium-bg); color: var(--color-medium); }

.conn-state-badge { display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: 10px; font-weight: 600; }
.conn-state-badge--confirmed { background: var(--medium-bg); color: var(--color-medium); }
.conn-state-badge--proposed  { background: var(--high-bg); color: var(--color-high); }
.conn-state-badge--manual    { background: rgba(167,139,250,0.15); color: #a78bfa; }
```

- [ ] **Step 1.8: Update panel list items, back button, quick capture, narrative editor**

Find `/* ─── Panel list items ─── */`. Replace from there through `.narrative-editor:focus`:

```css
/* ─── Panel list items ───────────────────────────────────────────────────────── */

.panel-list-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background 0.1s;
}

.panel-list-item:hover { background: var(--bg-3); }

.panel-list-item__label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-1);
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.panel-list-item__meta {
  font-size: 12px;
  color: var(--text-3);
  flex-shrink: 0;
}

/* ─── Back button ────────────────────────────────────────────────────────────── */

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border: none;
  background: transparent;
  font-size: 12px;
  color: var(--text-3);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background 0.1s, color 0.1s;
}

.back-btn:hover { background: var(--bg-3); color: var(--text-1); }

/* ─── Quick capture textarea ─────────────────────────────────────────────────── */

.quick-capture {
  width: 100%;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  padding: 6px 8px;
  font-size: 13px;
  font-family: inherit;
  resize: none;
  outline: none;
  min-height: 52px;
  transition: border-color 0.1s;
  box-sizing: border-box;
  background: var(--bg-2);
  color: var(--text-1);
}

.quick-capture:focus { border-color: var(--accent); }

/* ─── Angle view ─────────────────────────────────────────────────────────────── */

.angle-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.angle-view__body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.angle-view__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 14px;
  overflow-y: auto;
  gap: 14px;
}

.narrative-editor {
  width: 100%;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  outline: none;
  min-height: 110px;
  line-height: 1.5;
  transition: border-color 0.1s;
  box-sizing: border-box;
  background: var(--bg-2);
  color: var(--text-1);
}

.narrative-editor:focus { border-color: var(--accent); }
```

- [ ] **Step 1.9: Update cited doc card, lead panel, doc view, RAG panel**

Find `/* ─── Cited document card ─── */`. Replace from there through `.rag-result__snippet`:

```css
/* ─── Cited document card ────────────────────────────────────────────────────── */

.cited-doc-card {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.cited-doc-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  background: var(--bg-2);
  border-bottom: 1px solid var(--border-1);
  font-size: 13px;
  font-weight: 500;
}

.cited-doc-card__excerpt {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-3);
  line-height: 1.4;
  font-style: italic;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--bg-1);
}

.cited-doc-card__tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  padding: 4px 10px 8px;
  background: var(--bg-1);
}

.fact-tag { display: inline-block; padding: 1px 6px; border-radius: 9999px; font-size: 11px; font-weight: 500; }
.fact-tag--entity { background: var(--tag-entity-bg); color: var(--tag-entity-color); }
.fact-tag--date   { background: var(--tag-date-bg);   color: var(--tag-date-color); }
.fact-tag--amount { background: var(--tag-amount-bg);  color: var(--tag-amount-color); }
.fact-tag--flag   { background: var(--tag-flag-bg);   color: var(--tag-flag-color); border-bottom: 1.5px solid var(--color-critical); }

/* ─── Lead panel ─────────────────────────────────────────────────────────────── */

.lead-panel {
  width: 224px;
  flex-shrink: 0;
  border-left: 1px solid var(--border-1);
  background: var(--bg-1);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.lead-panel__header {
  padding: 8px 12px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-3);
  border-bottom: 1px solid var(--border-1);
  flex-shrink: 0;
}

.lead-panel__section {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-1);
}

.lead-panel__section-title {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-3);
  margin: 0 0 5px;
}

.lead-panel__text {
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.45;
  margin: 0;
}

/* ─── Document view ──────────────────────────────────────────────────────────── */

.doc-view {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.doc-view__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.doc-view__header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-1);
  flex-shrink: 0;
  background: var(--bg-1);
}

.doc-view__content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, monospace;
  background: var(--bg-0);
  color: var(--text-2);
}

/* ─── RAG search panel ───────────────────────────────────────────────────────── */

.rag-panel {
  width: 260px;
  flex-shrink: 0;
  border-left: 1px solid var(--border-1);
  display: flex;
  flex-direction: column;
  background: var(--bg-1);
}

.rag-panel__header {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-1);
  flex-shrink: 0;
}

.rag-input {
  width: 100%;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-sm);
  padding: 5px 8px;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.1s;
  background: var(--bg-2);
  color: var(--text-1);
}

.rag-input:focus { border-color: var(--accent); }

.rag-results { flex: 1; overflow-y: auto; }

.rag-result {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-1);
  cursor: pointer;
  transition: background 0.1s;
}

.rag-result:hover { background: var(--bg-2); }

.rag-result__title { font-size: 12px; font-weight: 600; color: var(--text-1); margin: 0 0 2px; }
.rag-result__snippet { font-size: 11px; color: var(--text-3); margin: 0; line-height: 1.4; }
```

- [ ] **Step 1.10: Update dialogs and buttons**

Find `/* ─── Dialogs ─── */`. Replace from there through `.btn-secondary:hover`:

```css
/* ─── Dialogs ────────────────────────────────────────────────────────────────── */

.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 100;
  animation: fade-in 0.12s ease;
}

.dialog-content {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: var(--bg-2);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  z-index: 101;
  min-width: 480px;
  max-width: 600px;
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  outline: none;
  animation: slide-up 0.14s ease;
}

.dialog-header {
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border-1);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.dialog-title { font-size: 15px; font-weight: 600; margin: 0; color: var(--text-1); }

.dialog-body {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
}

.dialog-footer {
  padding: 12px 20px;
  border-top: 1px solid var(--border-1);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
}

@keyframes fade-in  { from { opacity: 0; } to { opacity: 1; } }
@keyframes slide-up { from { transform: translate(-50%, -46%); opacity: 0; } to { transform: translate(-50%, -50%); opacity: 1; } }

/* ─── Buttons ────────────────────────────────────────────────────────────────── */

.btn-primary {
  padding: 7px 14px;
  border: none;
  border-radius: var(--radius-md);
  background: #2563eb;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.1s;
}

.btn-primary:hover    { background: #1d4ed8; }
.btn-primary:disabled { background: #1e3a5f; color: var(--text-3); cursor: not-allowed; }

.btn-danger {
  padding: 7px 14px;
  border: none;
  border-radius: var(--radius-md);
  background: #dc2626;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.1s;
}

.btn-danger:hover { background: #b91c1c; }

.btn-secondary {
  padding: 7px 14px;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}

.btn-secondary:hover { background: var(--bg-3); color: var(--text-1); }
```

- [ ] **Step 1.11: Update icon button, connection review drawer, research tab, financials tab, timeline tab**

Find `/* ─── Icon button ─── */`. Replace from there through end of `/* ─── Timeline tab ─── */` section:

```css
/* ─── Icon button ────────────────────────────────────────────────────────────── */

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: var(--radius-sm);
  color: var(--text-3);
  transition: background 0.1s, color 0.1s;
}

.icon-btn:hover { background: var(--bg-3); color: var(--text-1); }

/* ─── Connection review drawer ───────────────────────────────────────────────── */

.conn-review-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.45);
  z-index: 10;
}

.conn-review-drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 460px;
  background: var(--bg-1);
  border-left: 1px solid var(--border-1);
  z-index: 11;
  display: flex;
  flex-direction: column;
  box-shadow: -6px 0 24px rgba(0,0,0,0.4);
}

.excerpt-box {
  background: var(--bg-0);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.55;
  font-family: ui-monospace, monospace;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow-y: auto;
  margin: 0;
  color: var(--text-2);
}

/* ─── Research tab ───────────────────────────────────────────────────────────── */

.source-bar { display: flex; gap: 6px; padding: 10px 16px; border-bottom: 1px solid var(--border-1); background: var(--bg-1); flex-shrink: 0; flex-wrap: wrap; }
.source-btn { padding: 5px 12px; border: 1px solid var(--border-2); border-radius: 20px; background: var(--bg-2); font-size: 13px; font-weight: 500; color: var(--text-2); cursor: pointer; transition: all 0.1s; }
.source-btn:hover { border-color: var(--border-2); background: var(--bg-3); color: var(--text-1); }
.source-btn--active { border-color: var(--accent); color: var(--accent); background: var(--accent-bg); }
.source-btn--broken { color: var(--text-3); border-style: dashed; cursor: default; }
.query-form { padding: 12px 16px; border-bottom: 1px solid var(--border-1); display: flex; gap: 8px; align-items: flex-end; flex-shrink: 0; background: var(--bg-1); }
.query-input { flex: 1; border: 1px solid var(--border-2); border-radius: var(--radius-md); padding: 6px 10px; font-size: 13px; outline: none; transition: border-color 0.1s; background: var(--bg-2); color: var(--text-1); }
.query-input:focus { border-color: var(--accent); }
.job-rail { padding: 8px 16px; border-bottom: 1px solid var(--border-1); flex-shrink: 0; background: var(--bg-1); }
.job-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; color: var(--text-3); }
.job-item__label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.results-area { flex: 1; overflow-y: auto; }
.results-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.results-table th { padding: 8px 12px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); border-bottom: 1px solid var(--border-1); white-space: nowrap; background: var(--bg-1); position: sticky; top: 0; }
.results-table td { padding: 8px 12px; border-bottom: 1px solid var(--border-1); color: var(--text-2); vertical-align: middle; }
.results-table tr:hover td { background: var(--bg-2); }
.add-trigger { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 50%; border: 1px solid var(--border-2); background: var(--bg-2); cursor: pointer; font-size: 15px; color: var(--text-3); transition: all 0.1s; }
.add-trigger:hover { border-color: var(--accent); color: var(--accent); }
.add-trigger--done { border-color: var(--color-medium); color: var(--color-medium); cursor: default; }
.add-popover { background: var(--bg-2); border: 1px solid var(--border-1); border-radius: var(--radius-lg); box-shadow: 0 8px 24px rgba(0,0,0,0.4); padding: 6px; min-width: 200px; z-index: 50; }
.add-option { display: block; width: 100%; padding: 7px 10px; text-align: left; font-size: 13px; border: none; background: transparent; cursor: pointer; border-radius: var(--radius-sm); color: var(--text-2); transition: background 0.1s, color 0.1s; }
.add-option:hover { background: var(--bg-3); color: var(--text-1); }
.add-option__sub { font-size: 11px; color: var(--text-3); display: block; }

/* ─── Financials tab ─────────────────────────────────────────────────────────── */

.fin-tab { display: flex; flex-direction: column; height: 100%; overflow: hidden; background: var(--bg-0); }
.fin-tab__header { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid var(--border-1); flex-shrink: 0; }
.fin-tab__title { font-size: 14px; font-weight: 600; margin: 0; color: var(--text-1); }
.fin-tab__sub { font-size: 12px; color: var(--text-3); }
.fin-table-wrap { flex: 1; overflow: auto; }
.fin-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 520px; }
.fin-table th { padding: 8px 12px; text-align: right; font-size: 11px; font-weight: 700; color: var(--text-3); border-bottom: 2px solid var(--border-1); white-space: nowrap; position: sticky; top: 0; background: var(--bg-1); z-index: 1; letter-spacing: 0.03em; }
.fin-table th:first-child { text-align: left; width: 180px; }
.fin-table td { padding: 7px 12px; text-align: right; border-bottom: 1px solid var(--border-1); white-space: nowrap; color: var(--text-2); }
.fin-table td:first-child { text-align: left; font-weight: 500; color: var(--text-1); }
.fin-table tr:hover td { background: var(--bg-2); }
.cell--spike { background: rgba(251,191,36,0.1) !important; }
.cell--flag  { background: rgba(248,113,113,0.1) !important; }
.yoy-badge { display: inline-block; font-size: 10px; font-weight: 700; padding: 0 3px; border-radius: 2px; margin-left: 4px; vertical-align: middle; }
.yoy-badge--up { color: var(--color-high); }
.yoy-badge--down { color: var(--accent); }

/* ─── Timeline tab ───────────────────────────────────────────────────────────── */

.timeline-tab { display: flex; flex-direction: column; height: 100%; overflow: hidden; background: var(--bg-0); }
.timeline-controls { padding: 8px 16px; border-bottom: 1px solid var(--border-1); display: flex; align-items: center; gap: 6px; flex-shrink: 0; flex-wrap: wrap; background: var(--bg-1); }
.filter-chip { padding: 3px 10px; border: 1px solid var(--border-1); border-radius: 20px; font-size: 12px; font-weight: 500; color: var(--text-3); cursor: pointer; background: var(--bg-2); transition: all 0.1s; }
.filter-chip--active { border-color: var(--accent); color: var(--accent); background: var(--accent-bg); }
.filter-chip:hover:not(.filter-chip--active) { border-color: var(--border-2); color: var(--text-2); }
.timeline-brush-area { padding: 8px 16px 0; flex-shrink: 0; background: var(--bg-1); }
.timeline-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; }
.event-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
.event-dot--document    { background: var(--text-3); }
.event-dot--financial   { background: var(--accent); }
.event-dot--transaction { background: var(--color-high); }
.event-dot--finding     { background: var(--color-medium); }
.event-dot--ucc         { background: var(--color-critical); }
.event-dot--note        { background: #a78bfa; }
.event-card { border: 1px solid var(--border-1); border-radius: var(--radius-md); padding: 8px 10px; margin-bottom: 6px; cursor: pointer; transition: background 0.1s; background: var(--bg-1); }
.event-card:hover { background: var(--bg-2); }
.event-card__header { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; font-size: 13px; font-weight: 600; color: var(--text-1); }
.event-card__meta { font-size: 11px; color: var(--text-3); }
.event-card__excerpt { font-size: 12px; color: var(--text-2); margin-top: 3px; }
```

- [ ] **Step 1.12: Update breadcrumb, minimap, skeleton, and remaining supplemental classes**

Find `/* ─── Breadcrumb ─── */`. Replace from there through the end of the file with:

```css
/* ─── Breadcrumb ─────────────────────────────────────────────────────────────── */

.breadcrumb { display: flex; align-items: center; gap: 2px; padding: 4px 14px; border-bottom: 1px solid var(--border-1); background: var(--bg-1); flex-shrink: 0; font-size: 12px; overflow: hidden; }
.breadcrumb__sep { color: var(--border-2); padding: 0 2px; -webkit-user-select: none; user-select: none; }
.breadcrumb__item { border: none; background: transparent; padding: 2px 4px; border-radius: var(--radius-sm); font-size: 12px; white-space: nowrap; cursor: pointer; color: var(--text-3); transition: color 0.1s, background 0.1s; }
.breadcrumb__item:hover { color: var(--accent); background: var(--accent-bg); }
.breadcrumb__item--current { color: var(--text-1); font-weight: 600; cursor: default; }
.breadcrumb__item--current:hover { color: var(--text-1); background: transparent; }

/* ─── Minimap ────────────────────────────────────────────────────────────────── */

.minimap-container { position: absolute; bottom: 12px; right: 12px; width: 160px; height: 110px; border: 1px solid var(--border-2); border-radius: var(--radius-md); overflow: hidden; background: var(--bg-2); box-shadow: 0 2px 8px rgba(0,0,0,0.4); z-index: 5; pointer-events: none; }

/* ─── Skeleton loader ────────────────────────────────────────────────────────── */

.skeleton {
  background: linear-gradient(90deg, var(--bg-2) 25%, var(--bg-3) 50%, var(--bg-2) 75%);
  background-size: 200% 100%;
  animation: skeleton-sweep 1.4s ease-in-out infinite;
  border-radius: var(--radius-sm);
}

@keyframes skeleton-sweep {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ─── AngleView supplemental classes ─────────────────────────────────────────── */

.angle-view__title {
  font-weight: 600;
  font-size: 14px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-1);
}

.angle-view__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-bottom: 1px solid var(--border-1);
  flex-shrink: 0;
  background: var(--bg-1);
}

.angle-view__saved-flash { font-size: 12px; color: var(--color-medium); flex-shrink: 0; }

.angle-view__remove-banner {
  padding: 6px 14px;
  background: var(--high-bg);
  color: var(--color-high);
  font-size: 12px;
  border-bottom: 1px solid rgba(251,191,36,0.25);
  flex-shrink: 0;
}

.angle-view__loading-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
  font-size: 14px;
}

.angle-view__error-text { color: var(--color-critical); font-size: 14px; }

.angle-view__skeleton-title { display: inline-block; width: 200px; height: 16px; border-radius: var(--radius-sm); }

.angle-view__citation-list { display: flex; flex-direction: column; gap: 10px; }
.angle-view__empty-cite { padding: 24px 0; }
.angle-view__lead-analysis-section { margin-top: 24px; }
.angle-view__rationale { font-size: 13px; color: var(--text-2); margin: 0 0 8px; }

.angle-view__suggested-action {
  background: var(--medium-bg);
  border: 1px solid rgba(52,211,153,0.25);
  border-radius: var(--radius-md);
  padding: 8px 12px;
  font-size: 12px;
  color: var(--color-medium);
}

.doc-ref-label { font-family: ui-monospace, monospace; font-size: 12px; color: var(--text-3); flex-shrink: 0; }

.cited-doc-card__filename-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: none;
  border: none;
  padding: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-1);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: color 0.1s;
}

.cited-doc-card__filename-btn:hover { color: var(--accent); }
.cited-doc-card__filename-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cited-doc-card__page-ref { font-size: 11px; color: var(--text-3); flex-shrink: 0; }

.lead-panel__thinking { display: flex; align-items: center; gap: 6px; color: var(--text-3); font-size: 12px; }
.lead-panel__text--muted { color: var(--text-3); font-size: 12px; }
.lead-panel__divider { border: none; border-top: 0.5px solid var(--border-1); margin: 8px 0; }

.cited-docs-count { color: var(--text-3); font-weight: 400; }

/* ─── Spin animation ─────────────────────────────────────────────────────────── */
@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin 1s linear infinite; }

/* ─── Outcome pills ──────────────────────────────────────────────────────────── */
.outcome-pill-group { display: flex; gap: 6px; flex-wrap: wrap; }
.outcome-pill-group--vertical { flex-direction: column; }
.outcome-pill {
  padding: 6px 14px;
  border-radius: 20px;
  border: 1px solid var(--border-2);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: background 0.15s;
}
.outcome-pill:hover { background: var(--bg-3); }
.outcome-pill--selected { background: var(--bg-3); border-color: var(--border-2); font-weight: 500; color: var(--text-1); }
.outcome-pill--confirmed.outcome-pill--selected { background: var(--medium-bg); color: var(--color-medium); border-color: rgba(52,211,153,0.25); }
.outcome-pill--exhausted.outcome-pill--selected { background: var(--critical-bg); color: var(--color-critical); border-color: rgba(248,113,113,0.25); }

/* ─── TieOffModal ────────────────────────────────────────────────────────────── */
.tieoff-identity { margin-bottom: 14px; }
.tieoff-angle-title { font-size: 14px; font-weight: 600; color: var(--text-1); margin: 0 0 4px; }
.tieoff-entity-pairs { font-size: 12px; color: var(--text-3); margin: 0; }
.tieoff-doc-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.tieoff-doc-item { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 4px 0; }
.tieoff-doc-ref { font-size: 11px; font-weight: 600; color: var(--accent); font-family: monospace; }
.tieoff-doc-name { flex: 1; color: var(--text-2); }
.tieoff-doc-page { font-size: 11px; color: var(--text-3); }
.tieoff-select-wrapper { position: relative; }
.tieoff-select {
  width: 100%;
  font-size: 12px;
  padding: 6px 10px;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  background: var(--bg-2);
  color: var(--text-1);
  outline: none;
  appearance: none;
}
.tieoff-select:focus { border-color: var(--accent); }
.tieoff-rationale { margin-top: 10px; }
.tieoff-error { font-size: 11px; color: var(--color-critical); margin: 4px 0 0; }

/* ─── CiteDocumentPicker ─────────────────────────────────────────────────────── */
.research-input {
  width: 100%;
  font-size: 12px;
  padding: 7px 10px;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  background: var(--bg-2);
  color: var(--text-1);
  outline: none;
  margin-bottom: 12px;
}
.research-input:focus { border-color: var(--accent); }
.cite-list { list-style: none; padding: 0; margin: 0 0 8px; display: flex; flex-direction: column; gap: 2px; }
.cite-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  font-size: 12px;
}
.cite-item--already-cited { background: var(--bg-3); color: var(--text-3); }
.cite-item__label { display: flex; align-items: center; gap: 8px; cursor: pointer; flex: 1; }
.cite-item__ref { font-family: monospace; font-size: 11px; font-weight: 600; color: var(--accent); flex-shrink: 0; }
.cite-item__name { flex: 1; display: flex; align-items: center; gap: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty-state-text { font-size: 12px; color: var(--text-3); text-align: center; padding: 12px 0; }

/* ─── KnotPicker ─────────────────────────────────────────────────────────────── */
.knot-picker { position: relative; flex: 1; min-width: 0; }
.knot-picker--locked {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--bg-2);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  font-size: 12px;
  color: var(--text-3);
  flex: 1;
}
.knot-picker__input-wrap { position: relative; }
.knot-picker__icon { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); color: var(--text-3); pointer-events: none; }
.knot-picker__lock-icon { color: var(--text-3); flex-shrink: 0; }
.knot-picker__lock-label { font-size: 12px; }
.knot-picker__spinner { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); animation: spin 1s linear infinite; color: var(--text-3); }
.knot-picker__check { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); color: var(--color-medium); }
.knot-picker__input {
  width: 100%;
  font-size: 12px;
  padding: 6px 10px 6px 28px;
  border: 1px solid var(--border-2);
  border-radius: var(--radius-md);
  background: var(--bg-2);
  color: var(--text-1);
  outline: none;
}
.knot-picker__input:focus { border-color: var(--accent); }
.knot-picker__dropdown {
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  background: var(--bg-2);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  z-index: 100;
  max-height: 200px;
  overflow-y: auto;
  padding: 4px;
  list-style: none;
  margin: 0;
}
.knot-picker__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 12px;
  color: var(--text-2);
}
.knot-picker__option:hover { background: var(--bg-3); color: var(--text-1); }
.knot-picker__option[aria-selected="true"] { background: var(--accent-bg); color: var(--accent); }
.knot-picker__name { flex: 1; }
.knot-picker__type { font-size: 10px; padding: 1px 6px; border-radius: 10px; font-weight: 500; flex-shrink: 0; }
.knot-picker__type--person { background: rgba(59,130,246,0.15); color: #60a5fa; }
.knot-picker__type--organization { background: rgba(20,184,166,0.15); color: #14b8a6; }

/* ─── AngleSplitModal ────────────────────────────────────────────────────────── */
.angle-split-modal__instructions { font-size: 12px; color: var(--text-3); margin: 0 0 14px; line-height: 1.5; }
.angle-split-modal__doc-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.angle-split-modal__doc-row { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 4px 0; }
.angle-split-modal__assign-group { display: flex; gap: 4px; }
.angle-split-modal__doc-ref { font-family: monospace; font-size: 11px; font-weight: 600; color: var(--accent); }
.angle-split-modal__doc-name { flex: 1; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.angle-split-modal__field-label { font-size: 11px; font-weight: 500; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.04em; display: block; margin-bottom: 4px; }
.angle-split-modal__name-input { width: 100%; margin-bottom: 10px; }
.angle-split-modal__connects-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.angle-split-modal__connects-label { font-size: 11px; color: var(--text-3); white-space: nowrap; }
.angle-split-modal__entity-chip { font-size: 11px; padding: 2px 8px; background: var(--accent-bg); color: var(--accent); border-radius: 12px; white-space: nowrap; }
.angle-split-modal__arrow { font-size: 13px; color: var(--text-3); }
.angle-split-modal__error { font-size: 12px; color: var(--color-critical); margin: 0; }
.btn-spinner { animation: spin 1s linear infinite; }

/* ─── ConnectKnotsModal ──────────────────────────────────────────────────────── */
.connect-knots-modal__pickers { display: flex; align-items: flex-start; gap: 10px; }
.connect-knots-modal__picker-col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.connect-knots-modal__picker-label { font-size: 11px; font-weight: 500; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.04em; }
.connect-knots-modal__arrow { font-size: 16px; color: var(--text-3); padding-top: 28px; flex-shrink: 0; }
.connect-knots-modal__angle-name-row { display: flex; flex-direction: column; gap: 4px; margin-top: 12px; }
.connect-knots-modal__angle-name-label { font-size: 11px; font-weight: 500; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.04em; }
.connect-knots-modal__angle-name-input { width: 100%; font-size: 13px; padding: 8px 10px; border: 1px solid var(--border-2); border-radius: var(--radius-md); background: var(--bg-2); color: var(--text-1); outline: none; }
.connect-knots-modal__angle-name-input:focus { border-color: var(--accent); }
.connect-knots-modal__error { font-size: 12px; color: var(--color-critical); margin: 0; }
.connect-knots-modal__success { font-size: 12px; color: var(--color-medium); margin: 0; }

/* ─── New layout classes (dark mockup) ───────────────────────────────────────── */

/* Case shell header — replaces inline-style header in CaseDetailView */
.case-shell-header {
  padding: 0 20px;
  height: 44px;
  border-bottom: 1px solid var(--border-1);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  background: var(--bg-1);
}

.case-shell-header__wordmark {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-1);
  letter-spacing: -0.02em;
  flex-shrink: 0;
}

.case-shell-header__wordmark span { color: var(--accent); }

.case-shell-header__sep {
  color: var(--border-2);
  font-size: 14px;
  flex-shrink: 0;
}

.case-shell-header__title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.case-shell-header__right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* Vertical web toolbar (left rail of Investigate tab) */
.web-toolbar-rail {
  width: 44px;
  background: var(--bg-1);
  border-right: 1px solid var(--border-1);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  gap: 2px;
  flex-shrink: 0;
}

.web-toolbar-rail__sep {
  width: 24px;
  height: 1px;
  background: var(--border-1);
  margin: 4px 0;
}

.web-tool-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  position: relative;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}

.web-tool-btn:hover {
  background: var(--bg-3);
  color: var(--text-1);
  border-color: var(--border-1);
}

.web-tool-btn__badge {
  position: absolute;
  top: -3px;
  right: -3px;
  background: var(--color-high);
  color: #000;
  font-size: 8px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 8px;
  line-height: 1.2;
}

/* Graph canvas — dark background for Cytoscape */
.graph-canvas-dark {
  flex: 1;
  background: var(--bg-0);
  position: relative;
  overflow: hidden;
}

/* Knot view (Level 2 — two column layout) */
.knot-view {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.knot-left {
  width: 260px;
  background: var(--bg-1);
  border-right: 1px solid var(--border-1);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow-y: auto;
  padding: 16px;
  gap: 0;
}

.knot-main {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.knot-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 10px;
  flex-shrink: 0;
}

.knot-avatar--person { background: rgba(59,130,246,0.2); color: #3b82f6; }
.knot-avatar--org    { background: rgba(20,184,166,0.2); color: #14b8a6; }

.knot-name { font-size: 16px; font-weight: 600; color: var(--text-1); margin-bottom: 4px; }

.knot-type-badge {
  display: inline-block;
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 12px;
  margin-bottom: 12px;
}
.knot-type-badge--org    { background: rgba(20,184,166,0.15); color: #14b8a6; border: 1px solid rgba(20,184,166,0.25); }
.knot-type-badge--person { background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.25); }

.knot-meta-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 14px; }
.knot-meta-table td { padding: 3px 0; vertical-align: top; }
.knot-meta-label { color: var(--text-3); min-width: 60px; padding-right: 8px; }
.knot-meta-value { color: var(--text-2); }

.knot-divider { height: 1px; background: var(--border-1); margin: 8px 0; }

.knot-stat-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-bottom: 14px; }
.knot-stat { background: var(--bg-2); border-radius: var(--radius-md); padding: 8px; text-align: center; }
.knot-stat__num { font-size: 18px; font-weight: 500; line-height: 1; margin-bottom: 2px; }
.knot-stat__num--accent { color: var(--accent); }
.knot-stat__num--success { color: var(--color-medium); }
.knot-stat__num--neutral { color: var(--text-1); }
.knot-stat__lbl { font-size: 9px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.04em; }

.quick-cap-btn {
  width: 100%;
  padding: 6px 10px;
  border-radius: var(--radius-md);
  border: 1px dashed var(--border-2);
  background: transparent;
  color: var(--text-3);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s, color 0.1s, border-style 0.1s;
}
.quick-cap-btn:hover { background: var(--bg-3); color: var(--text-2); border-style: solid; }

.knot-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.knot-section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-3);
}
.knot-section-add {
  font-size: 11px;
  color: var(--accent);
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
}
.knot-section-add:hover { text-decoration: underline; }

.angle-card {
  background: var(--bg-2);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  padding: 10px 14px;
  margin-bottom: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  transition: border-color 0.15s;
}
.angle-card:hover { border-color: var(--border-2); }

.angle-card__bar { width: 3px; border-radius: 2px; align-self: stretch; flex-shrink: 0; }
.angle-card__bar--CRITICAL { background: var(--color-critical); }
.angle-card__bar--HIGH     { background: var(--color-high); }
.angle-card__bar--MEDIUM   { background: var(--color-medium); }
.angle-card__bar--LOW,
.angle-card__bar--INFORMATIONAL { background: var(--border-2); }

.angle-card__info { flex: 1; min-width: 0; }
.angle-card__title { font-size: 12px; font-weight: 500; color: var(--text-1); margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.angle-card__meta  { font-size: 10px; color: var(--text-3); }

.conn-card {
  background: var(--bg-2);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-md);
  padding: 8px 12px;
  margin-bottom: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: border-color 0.15s;
  font-size: 11px;
}
.conn-card:hover { border-color: var(--border-2); }
.conn-card__dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.conn-card__dot--person { background: var(--color-knot-person); }
.conn-card__dot--org    { background: var(--color-knot-org); }
.conn-card__name { color: var(--text-1); font-weight: 500; }
.conn-card__role { color: var(--text-3); font-size: 10px; }

.doc-row {
  background: var(--bg-2);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-sm);
  padding: 7px 12px;
  margin-bottom: 5px;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.doc-row:hover { border-color: var(--border-2); }
.doc-row__name { flex: 1; color: var(--text-1); }
.doc-row__meta { color: var(--text-3); font-size: 10px; }
```

- [ ] **Step 1.13: Verify TypeScript and build**

Run:
```bash
cd frontend && npx tsc --noEmit
```
Expected: zero errors (CSS changes don't affect types).

```bash
cd frontend && npm run build
```
Expected: successful build, no warnings about missing files.

- [ ] **Step 1.14: Start dev server and visually verify dark mode**

Run:
```bash
cd frontend && npm run dev
```

Open http://localhost:5173. The entire app should now be dark. Check:
- Body background is very dark (`#0d1117`)
- Tab bar is dark gray (`#161b22`) with blue underline on active tab
- Buttons, dialogs, badges all use dark backgrounds
- Text is light gray (`#e6edf3`)

- [ ] **Step 1.15: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat(css): replace light theme with dark token system"
```

---

## Task 2: Case Detail Shell Header

**Files:**
- Modify: `frontend/src/views/CaseDetailView.tsx`

The current `<header>` uses `style={{ ... }}` with hardcoded light values. Replace it with the `.case-shell-header` class added in Task 1.

- [ ] **Step 2.1: Replace the header JSX**

In `CaseDetailView.tsx`, find the `<header>` element (lines 107-128):

```tsx
<header
  style={{
    padding: "10px 20px",
    borderBottom: "1px solid #e5e7eb",
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexShrink: 0,
    background: "#fff",
  }}
>
  {loadingCase ? (
    <div className="skeleton" style={{ width: 220, height: 20 }} />
  ) : (
    <>
      <h1 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
        {caseData?.name ?? "Unknown case"}
      </h1>
      {caseData && <StatusPill status={caseData.status} />}
    </>
  )}
</header>
```

Replace with:

```tsx
<header className="case-shell-header">
  <span className="case-shell-header__wordmark">
    Cata<span>lyst</span>
  </span>
  <span className="case-shell-header__sep">›</span>
  {loadingCase ? (
    <div className="skeleton" style={{ width: 180, height: 16 }} />
  ) : (
    <>
      <span className="case-shell-header__title">
        {caseData?.name ?? "Unknown case"}
      </span>
      <div className="case-shell-header__right">
        {caseData && <StatusPill status={caseData.status} />}
      </div>
    </>
  )}
</header>
```

Also replace the outer wrapper `div` style to use dark:

Find:
```tsx
<div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
```

Replace with:
```tsx
<div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-0)" }}>
```

- [ ] **Step 2.2: Verify and commit**

```bash
cd frontend && npx tsc --noEmit
```

Check the browser — the top bar now shows "Catalyst" wordmark in dark with case name in the breadcrumb trail, blue status pill.

```bash
git add frontend/src/views/CaseDetailView.tsx
git commit -m "feat(shell): dark case detail header with wordmark"
```

---

## Task 3: Investigate Tab — Vertical Toolbar + Dark Canvas

**Files:**
- Modify: `frontend/src/views/InvestigateTab.tsx`

The `WebToolbar` is currently a horizontal strip across the top. The design calls for a vertical 44px-wide left rail. This requires:
1. Changing `WebToolbar` from horizontal flex row to vertical column
2. Changing the outer investigate layout from `flexDirection: "column"` to `flexDirection: "row"`
3. Removing the toolbar from the top-of-column position and placing it as first child of the row
4. Setting the graph canvas wrapper class to `graph-canvas-dark`

- [ ] **Step 3.1: Replace WebToolbar component**

Find the entire `WebToolbar` function (lines 113-131):

```tsx
function WebToolbar({ pendingCount, showMinimap, onAddKnot, onAddConnection, onAddAngle, onFit, onPendingClick, onToggleMinimap }: ToolbarProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderBottom: "1px solid #e5e7eb", background: "#fff", flexShrink: 0 }}>
      <button type="button" className="toolbar-btn" onClick={onAddKnot}>+ Knot</button>
      <button type="button" className="toolbar-btn" onClick={onAddConnection}>+ Connection</button>
      <button type="button" className="toolbar-btn" onClick={onAddAngle}>+ Angle</button>
      <div style={{ flex: 1 }} />
      {pendingCount > 0 && (
        <button type="button" className="toolbar-btn toolbar-btn--pending" onClick={onPendingClick}>
          {pendingCount} pending
        </button>
      )}
      <button type="button" className="toolbar-btn" onClick={onFit}>Fit</button>
      <button type="button" className="toolbar-btn" onClick={onToggleMinimap} style={{ opacity: showMinimap ? 1 : 0.6 }}>
        Minimap
      </button>
    </div>
  );
}
```

Replace with:

```tsx
function WebToolbar({ pendingCount, showMinimap, onAddKnot, onAddConnection, onAddAngle, onFit, onPendingClick, onToggleMinimap }: ToolbarProps) {
  return (
    <div className="web-toolbar-rail">
      <button type="button" className="web-tool-btn" title="+ Knot" onClick={onAddKnot}>＋</button>
      <button type="button" className="web-tool-btn" title="+ Connection" onClick={onAddConnection}>⟷</button>
      <button type="button" className="web-tool-btn" title="+ Angle" onClick={onAddAngle}>⚑</button>
      <div className="web-toolbar-rail__sep" />
      <button type="button" className="web-tool-btn" title="Fit graph" onClick={onFit}>⊞</button>
      <button
        type="button"
        className="web-tool-btn"
        title="Toggle minimap"
        onClick={onToggleMinimap}
        style={{ opacity: showMinimap ? 1 : 0.5 }}
      >
        ▣
      </button>
      <div className="web-toolbar-rail__sep" />
      <button
        type="button"
        className="web-tool-btn"
        title="Pending connections"
        onClick={onPendingClick}
      >
        🔗
        {pendingCount > 0 && (
          <span className="web-tool-btn__badge">{pendingCount}</span>
        )}
      </button>
    </div>
  );
}
```

- [ ] **Step 3.2: Move WebToolbar into the main row and fix the layout**

In the `InvestigateTab` return statement (line ~462), the current structure is:

```tsx
<div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, position: "relative" }}>
  {/* Toolbar */}
  <WebToolbar ... />                                            {/* ← line ~464, must move */}

  {/* Breadcrumb */}
  <Breadcrumb stack={navStack} onNavigateTo={navigateTo} />    {/* ← stays here */}

  {/* Main area */}
  <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>  {/* ← line ~479 */}
    ...canvas, panels...
  </div>
</div>
```

Make two changes:
1. **Move** the `<WebToolbar>` JSX block from its current position (between the outer div and Breadcrumb) to be the **first child inside** the `<div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>` block at line ~479.
2. **No other style changes needed** — the main area is already `display: flex` with no `flexDirection`, which defaults to `row`. The toolbar will automatically become a left rail.

After the change the structure is:

```tsx
<div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, position: "relative" }}>
  {/* Breadcrumb stays at column level */}
  <Breadcrumb stack={navStack} onNavigateTo={navigateTo} />

  {/* Main row: toolbar + canvas + panels */}
  <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
    <WebToolbar                                                {/* ← moved here */}
      pendingCount={pendingCount}
      showMinimap={showMinimap}
      onFit={() => cyRef.current?.fit(undefined, 40)}
      onAddKnot={() => { setConnectPrefill({}); setShowConnectModal(true); }}
      onAddConnection={() => { setConnectPrefill({}); setShowConnectModal(true); }}
      onAddAngle={() => { setConnectPrefill({}); setShowConnectModal(true); }}
      onPendingClick={() => setShowConnectionReview(true)}
      onToggleMinimap={() => setShowMinimap((s) => !s)}
    />
    ...canvas, panels (unchanged)...
  </div>
</div>
```

Also fix the loading and error fallback states (lines ~447-459) which also render `<WebToolbar>`. Change their outer div from `flexDirection: "column"` to `flexDirection: "row"` so the toolbar is a left rail there too:

```tsx
if (loading) return (
  <div style={{ flex: 1, display: "flex", flexDirection: "row", minHeight: 0, overflow: "hidden" }}>
    <WebToolbar pendingCount={0} showMinimap={false} onFit={() => {}} onAddKnot={() => {}} onAddConnection={() => {}} onAddAngle={() => {}} onPendingClick={() => {}} onToggleMinimap={() => {}} />
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)" }}>Loading web…</div>
  </div>
);

if (error) return (
  <div style={{ flex: 1, display: "flex", flexDirection: "row", minHeight: 0, overflow: "hidden" }}>
    <WebToolbar pendingCount={0} showMinimap={false} onFit={() => {}} onAddKnot={() => {}} onAddConnection={() => {}} onAddAngle={() => {}} onPendingClick={() => {}} onToggleMinimap={() => {}} />
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-critical)", padding: 24, textAlign: "center" }}>{error}</div>
  </div>
);
```

- [ ] **Step 3.3: Dark the graph canvas wrapper**

Find the div that directly wraps `<CytoscapeCanvas>`. It will have an inline style with something like `background: "#f9fafb"` or similar. Replace its `background` with `var(--bg-0)`, or add `className="graph-canvas-dark"` if it has no other critical inline styles.

For example, change:
```tsx
<div style={{ flex: 1, position: "relative", background: "#f9fafb" }}>
```
to:
```tsx
<div style={{ flex: 1, position: "relative" }} className="graph-canvas-dark">
```

- [ ] **Step 3.4: Verify and commit**

```bash
cd frontend && npx tsc --noEmit
```

In the browser: the Investigate tab should show a narrow vertical icon strip on the left, and the dark graph canvas fills the rest. The right stats panel remains on the right.

```bash
git add frontend/src/views/InvestigateTab.tsx
git commit -m "feat(investigate): vertical toolbar rail, dark graph canvas"
```

---

## Task 4: Profile Panel — Two-Column Knot Layout

**Files:**
- Modify: `frontend/src/views/ProfilePanel.tsx`

Currently `ProfilePanel` renders inside the right panel slot (380px wide). The design calls for a full-width two-column layout: `knot-left` (260px entity sidebar) + `knot-main` (scrollable sections). This replaces the panel-within-panel structure.

- [ ] **Step 4.1: Update ProfileSkeleton**

Find `ProfileSkeleton` (lines 146-164). Replace with:

```tsx
function ProfileSkeleton() {
  return (
    <div className="knot-view">
      <div className="knot-left">
        <div className="skeleton" style={{ width: 48, height: 48, borderRadius: "50%", marginBottom: 10 }} />
        <div className="skeleton" style={{ width: "70%", height: 18, marginBottom: 6 }} />
        <div className="skeleton" style={{ width: "40%", height: 14, marginBottom: 12 }} />
        <div className="skeleton" style={{ width: "100%", height: 80 }} />
      </div>
      <div className="knot-main">
        <div className="skeleton" style={{ width: "100%", height: 120 }} />
        <div className="skeleton" style={{ width: "100%", height: 80 }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4.2: Update EntityAvatar to use knot-avatar classes**

Find the `EntityAvatar` component (lines 55-74). Replace with:

```tsx
function EntityAvatar({ name, entityType }: { name: string; entityType: EntityType }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

  return (
    <div className={`knot-avatar knot-avatar--${entityType}`}>
      {initials || "?"}
    </div>
  );
}
```

- [ ] **Step 4.3: Replace the main ProfilePanel return JSX**

Find the `return` statement of the main `ProfilePanel` export function. It currently starts with:

```tsx
return (
  <div className="right-panel right-panel--profile">
    <div className="panel-header">
      <button ... className="back-btn"> ...
```

Replace the entire return with the two-column layout. Keep all existing data-fetching logic and section content — only the outer structure changes:

```tsx
return (
  <div className="knot-view">
    {/* ── Left column: entity identity ── */}
    <div className="knot-left">
      <button type="button" className="back-btn" onClick={onBack} style={{ marginBottom: 14 }}>
        ← Investigation web
      </button>

      <EntityAvatar name={name} entityType={entityType} />
      <div className="knot-name">{name}</div>
      <span className={`knot-type-badge knot-type-badge--${entityType}`}>
        {entityType === "person" ? "Person" : orgSubtype ?? "Organization"}
      </span>

      {/* Meta rows */}
      {metaRows.length > 0 && (
        <table className="knot-meta-table">
          <tbody>
            {metaRows.map(({ label, value }) => (
              <tr key={label}>
                <td className="knot-meta-label">{label}</td>
                <td className="knot-meta-value">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="knot-divider" />

      {/* Stat grid */}
      <div className="knot-stat-grid">
        <div className="knot-stat">
          <div className={`knot-stat__num knot-stat__num--accent`}>{angles.length}</div>
          <div className="knot-stat__lbl">Angles</div>
        </div>
        <div className="knot-stat">
          <div className={`knot-stat__num knot-stat__num--success`}>
            {angles.filter((a) => a.status === "CONFIRMED").length}
          </div>
          <div className="knot-stat__lbl">Confirmed</div>
        </div>
        <div className="knot-stat">
          <div className={`knot-stat__num knot-stat__num--neutral`}>{documents.length}</div>
          <div className="knot-stat__lbl">Docs</div>
        </div>
      </div>

      <div className="knot-divider" />

      {/* Quick capture */}
      <button type="button" className="quick-cap-btn" onClick={() => setShowQuickCapture(true)}>
        + Quick capture…
      </button>
      {showQuickCapture && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <textarea
            className="quick-capture"
            placeholder="Note something about this knot…"
            value={captureText}
            onChange={(e) => setCaptureText(e.target.value)}
            rows={3}
          />
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button type="button" className="btn-secondary" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => { setShowQuickCapture(false); setCaptureText(""); }}>
              Cancel
            </button>
            <button type="button" className="btn-primary" style={{ fontSize: 11, padding: "3px 8px" }} disabled={!captureText.trim() || savingCapture} onClick={handleSaveCapture}>
              {savingCapture ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>

    {/* ── Right column: sections ── */}
    <div className="knot-main">

      {/* Angles */}
      <div>
        <div className="knot-section-head">
          <span className="knot-section-title">Angles</span>
        </div>
        {angles.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-3)", padding: "8px 0" }}>No angles yet.</div>
        ) : (
          angles.map((a) => (
            <div key={a.id} className="angle-card" onClick={() => onAngleClick(a.id, a.title)}>
              <div className={`angle-card__bar angle-card__bar--${a.severity}`} />
              <div className="angle-card__info">
                <div className="angle-card__title">{a.title}</div>
                <div className="angle-card__meta">{a.rule_id ?? ""}{a.rule_id && " · "}{a.doc_count ?? 0} docs cited</div>
              </div>
              <AngleStatusBadge status={a.status} />
            </div>
          ))
        )}
      </div>

      {/* Connections */}
      <div>
        <div className="knot-section-head">
          <span className="knot-section-title">Connections</span>
        </div>
        {connections.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-3)", padding: "8px 0" }}>No connections.</div>
        ) : (
          connections.map((c) => (
            <div key={c.edgeId} className="conn-card">
              <div className={`conn-card__dot conn-card__dot--${c.otherType ?? "org"}`} />
              <div>
                <div className="conn-card__name">{c.otherLabel}</div>
                <div className="conn-card__role">{c.edgeLabel}</div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Documents */}
      <div>
        <div className="knot-section-head">
          <span className="knot-section-title">Source documents</span>
        </div>
        {documents.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-3)", padding: "8px 0" }}>No documents linked.</div>
        ) : (
          documents.map((d) => (
            <div key={d.id} className="doc-row" onClick={() => onDocumentClick(d.id, d.filename)}>
              <DocBadge docType={d.doc_type} />
              <span className="doc-row__name">{d.filename}</span>
              <span className="doc-row__meta">{d.page_count ? `${d.page_count} pg` : ""}</span>
            </div>
          ))
        )}
      </div>

      {/* Quick captures list */}
      {notes.length > 0 && (
        <div>
          <div className="knot-section-head">
            <span className="knot-section-title">Quick captures</span>
          </div>
          {notes.map((n) => (
            <div key={n.id} style={{ fontSize: 12, color: "var(--text-2)", padding: "6px 0", borderBottom: "1px solid var(--border-1)" }}>
              {n.content}
            </div>
          ))}
        </div>
      )}

    </div>
  </div>
);
```

**Note:** The variables `name`, `orgSubtype`, `metaRows`, `angles`, `connections`, `documents`, `notes`, `showQuickCapture`, `setShowQuickCapture`, `captureText`, `setCaptureText`, `savingCapture`, `handleSaveCapture` must come from the existing state/data logic in the component. Do not remove any of the existing data-building code above the return — only replace the JSX `return` block.

For `connections`, you need `otherType` on `DerivedConnection`. Add it by updating the `buildConnections` function to also return the `otherType`:

Find `DerivedConnection` interface and add:
```tsx
interface DerivedConnection {
  edgeId: string;
  otherId: string;
  otherLabel: string;
  otherType: "person" | "organization";  // add this field
  relationship: string;
  edgeLabel: string;
  state: ConnectionState;
  supportingDocIds: string[];
}
```

In `buildConnections`, set `otherType` from the matching graph node:
```tsx
const otherNode = graph?.nodes.find((n) => n.id === otherId);
// add to returned object:
otherType: (otherNode?.type === "person" ? "person" : "organization") as "person" | "organization",
```

- [ ] **Step 4.4: Wire ProfilePanel into InvestigateTab as full-width**

In `InvestigateTab.tsx` the current profile panel render (line ~544) wraps ProfilePanel in a `rightPanelCls` div (380px wide), and the canvas STILL renders alongside it. Two changes are needed:

**Change 1:** Hide the canvas when Level 2 is active. Find the canvas wrapper (line ~507):

```tsx
{!showDocument && (
  <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
```

Change `!showDocument` to also exclude profile:

```tsx
{!showDocument && current.kind !== "profile" && (
  <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
```

**Change 2:** Replace the `rightPanelCls` wrapper around ProfilePanel with a `flex: 1` div so it fills the full canvas area:

Find (line ~544):
```tsx
{showRightPanel && current.kind === "profile" && (
  <div className={rightPanelCls} style={{ overflowY: "auto" }}>
    <Suspense fallback={fallback("Loading…")}>
      <ProfilePanel
        caseId={caseId}
        entityId={current.entityId}
        entityType={current.entityType}
        entityData={entityData}
        graph={graph}
        onAngleClick={(angleId, angleTitle) => {
          if (angleId === "") {
            setConnectPrefill({ entityId: current.entityId, entityName: current.entityName });
            setShowConnectModal(true);
          } else {
            navigate({ kind: "angle", angleId, angleTitle });
          }
        }}
        onDocumentClick={(docId, docName) => navigate({ kind: "document", documentId: docId, docName })}
        onBack={navigateBack}
      />
    </Suspense>
  </div>
)}
```

Replace with:
```tsx
{current.kind === "profile" && (
  <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
    <Suspense fallback={fallback("Loading…")}>
      <ProfilePanel
        caseId={caseId}
        entityId={current.entityId}
        entityType={current.entityType}
        entityData={entityData}
        graph={graph}
        onAngleClick={(angleId, angleTitle) => {
          if (angleId === "") {
            setConnectPrefill({ entityId: current.entityId, entityName: current.entityName });
            setShowConnectModal(true);
          } else {
            navigate({ kind: "angle", angleId, angleTitle });
          }
        }}
        onDocumentClick={(docId, docName) => navigate({ kind: "document", documentId: docId, docName })}
        onBack={navigateBack}
      />
    </Suspense>
  </div>
)}
```

The `knot-view` class on ProfilePanel's root element provides the two-column layout — no additional wrapper needed.

- [ ] **Step 4.5: Verify and commit**

```bash
cd frontend && npx tsc --noEmit
```

In the browser: clicking a knot on the graph should show the two-column Knot Profile — dark left sidebar with entity info, scrollable right column with angles/connections/docs.

```bash
git add frontend/src/views/ProfilePanel.tsx frontend/src/views/InvestigateTab.tsx
git commit -m "feat(profile): two-column knot view with dark layout"
```

---

## Task 5: AngleView Dark Polish

**Files:**
- Modify: `frontend/src/views/AngleView.tsx`

AngleView already uses CSS classes from Task 1, but any remaining hardcoded light colors in inline `style={{}}` props need to be replaced with dark token variables.

- [ ] **Step 5.1: Audit AngleView for hardcoded light colors**

Run:
```bash
grep -n "#fff\|#e5e7eb\|#f9fafb\|#374151\|#111827\|#6b7280\|background: \"#" frontend/src/views/AngleView.tsx
```

For each match, replace the hardcoded hex with the equivalent dark token:
- `#fff` → `var(--bg-1)` or `var(--bg-2)`
- `#e5e7eb` → `var(--border-1)`
- `#f9fafb` → `var(--bg-1)`
- `#374151` → `var(--text-2)`
- `#111827` → `var(--text-1)`
- `#6b7280` → `var(--text-3)`

- [ ] **Step 5.2: Verify and commit**

```bash
cd frontend && npx tsc --noEmit
```

In the browser: open an angle from the Knot Profile view. The angle view panel should be consistently dark with no light patches.

```bash
git add frontend/src/views/AngleView.tsx
git commit -m "feat(angle): dark token cleanup in AngleView"
```

---

## Definition of Done

- [ ] `npm run dev` shows a fully dark app matching the approved mockup
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] `npm run build` succeeds
- [ ] Web (Level 1): vertical left toolbar, dark graph canvas, dark right stats panel
- [ ] Knot Profile (Level 2): two-column layout (entity sidebar left, sections right)
- [ ] No light backgrounds visible in any of the 5 priority views
- [ ] All angle/severity/weight/status badges readable on dark backgrounds
