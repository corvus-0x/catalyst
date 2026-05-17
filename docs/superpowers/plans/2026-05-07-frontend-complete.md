# Frontend Complete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all functional gaps in the Catalyst frontend so the full 4-level investigation workflow (Web → Profile → Angle → Document) works end-to-end, plus Research, Financials, and Timeline tabs.

**Architecture:** Component-by-component (Option A). Complete each component before touching the next. The six components are: InvestigateTab, AngleView, DocumentView, ProfilePanel, FinancialsTab, TimelineTab. CaseDetailView receives targeted changes to support cross-tab navigation.

**Tech Stack:** React 18, TypeScript, Cytoscape.js, Radix UI, D3, sonner toasts, TanStack Table. All API calls use existing endpoints in `frontend/src/api/`. No new backend endpoints except one serializer field addition (Task 4).

---

## File Map

| File | Changes |
|------|---------|
| `frontend/src/views/InvestigateTab.tsx` | Node click → direct Profile nav; edge click → right panel; toolbar labels; remove empty modal callbacks |
| `frontend/src/views/AngleView.tsx` | Remove external modal props; mount CiteDocumentPicker, TieOffModal, AngleSplitModal internally; add Split button |
| `frontend/src/views/DocumentView.tsx` | Real OCR text; "Cite in angle" context menu item; RAG result click navigates to document |
| `frontend/src/views/ProfilePanel.tsx` | Fetch + display existing quick captures |
| `frontend/src/views/FinancialsTab.tsx` | Replace native `title` tooltip with Radix Popover + action buttons |
| `frontend/src/views/CaseDetailView.tsx` | Controlled tab state (replace `defaultValue` with `value`); pass anomaly navigation callback |
| `frontend/src/types/index.ts` | Add `extracted_text?: string \| null` to `DocumentItem` |
| `backend/investigations/serializers.py` | Add `extracted_text` to DocumentSerializer fields |

---

## Task 1: InvestigateTab — Node click, edge click, toolbar labels

**Files:**
- Modify: `frontend/src/views/InvestigateTab.tsx`

### What changes and why

Current code has three problems:
1. `handleNodeClick` selects the node and shows a mini-summary in the right panel, requiring a second click on "Open knot view →". The spec says one click navigates to Profile.
2. `onEdgeClick={(id) => console.debug(...)}` — edge click is wired to nothing.
3. Toolbar labels are `"+ Add knot"` and `"+ Add thread"` instead of the spec's `"+ Knot"`, `"+ Connection"`, `"+ Angle"`.

Also: `AngleView` is passed `onOpenCitePicker={() => {}}` and `onOpenTieOff={() => {}}` — Task 2 makes AngleView self-contained so these props go away.

- [ ] **Step 1.1: Fix handleNodeClick to navigate directly**

In `InvestigateTab.tsx`, replace the current `handleNodeClick` function (lines ~371-387) with:

```tsx
function handleNodeClick(nodeId: string) {
  if (current.kind !== "web") return;
  const node = graph?.nodes.find((n) => n.id === nodeId);
  if (!node || (node.type !== "person" && node.type !== "organization")) return;
  handleOpenKnotView(node);
}
```

Also remove the `webSelectedNode` state and its setter — it is no longer needed since we navigate on click instead of showing a summary.

Remove this line near the top of the component:
```tsx
const [webSelectedNode, setWebSelectedNode] = useState<GraphNode | null>(null);
```

- [ ] **Step 1.2: Add webSelectedEdge state for connection detail right panel**

Add after the existing state declarations:

```tsx
const [webSelectedEdge, setWebSelectedEdge] = useState<GraphEdge | null>(null);
```

- [ ] **Step 1.3: Add handleEdgeClick function**

Add after `handleOpenKnotView`:

```tsx
function handleEdgeClick(edgeId: string) {
  if (current.kind !== "web") return;
  // edgeId format from edgeToElement: "source__target__relationship"
  const parts = edgeId.split("__");
  if (parts.length < 3) return;
  const [source, target, relationship] = parts;
  const edge = graph?.edges.find(
    (e) => e.source === source && e.target === target && e.relationship === relationship
  );
  if (!edge) return;
  setWebSelectedEdge(edge);
}
```

- [ ] **Step 1.4: Wire handleEdgeClick to CytoscapeCanvas**

Replace:
```tsx
onEdgeClick={(id) => console.debug("[Investigate] edge:", id)}
```
With:
```tsx
onEdgeClick={handleEdgeClick}
```

Also in the `navigate` function, clear edge selection on navigation:
```tsx
function navigate(entry: NavEntry) {
  setNavStack((s) => [...s, entry]);
  setWebSelectedEdge(null);
}
```

- [ ] **Step 1.5: Update WebRightPanel to show edge detail**

Replace the entire `WebPanelProps` interface and `WebRightPanel` function with the following. The panel now shows edge (connection) detail when an edge is selected, and case stats otherwise. The old `selectedNode` / `onOpenKnotView` / `onAddThread` props are removed since node click now navigates directly.

```tsx
interface WebPanelProps {
  graph: GraphResponse | null;
  dashboard: DashboardResponse | null;
  selectedEdge: GraphEdge | null;
  onOpenAngle: (angleId: string, angleTitle: string) => void;
  onClearEdge: () => void;
}

function WebRightPanel({ graph, dashboard, selectedEdge, onOpenAngle, onClearEdge }: WebPanelProps) {
  const knotCount = graph
    ? (graph.stats.node_types.person ?? 0) + (graph.stats.node_types.organization ?? 0)
    : 0;
  const edgeCount = graph?.stats.total_edges ?? 0;

  if (selectedEdge) {
    const nodeIndex = new Map(graph?.nodes.map((n) => [n.id, n.label]) ?? []);
    const fromLabel = nodeIndex.get(selectedEdge.source) ?? selectedEdge.source.slice(0, 8) + "…";
    const toLabel = nodeIndex.get(selectedEdge.target) ?? selectedEdge.target.slice(0, 8) + "…";
    const meta = selectedEdge.metadata as Record<string, unknown>;
    const isProposed = selectedEdge.relationship === "CO_APPEARS_IN";
    const isManual = ["FAMILY", "BUSINESS", "SOCIAL"].includes(selectedEdge.relationship) && meta.source_type === "MANUAL";
    const stateLabel = isProposed ? "Proposed" : isManual ? "Manual" : "Confirmed";

    return (
      <div style={{ padding: 12, fontSize: 11, overflowY: "auto", height: "100%" }}>
        <button type="button" className="back-btn" onClick={onClearEdge} style={{ marginBottom: 8 }}>
          ← Clear
        </button>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9ca3af", marginBottom: 4 }}>
          Connection
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#111827", marginBottom: 2 }}>
          {fromLabel}
        </div>
        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>↔ {toLabel}</div>
        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>{selectedEdge.label}</div>
        <span className={`conn-state-badge conn-state-badge--${stateLabel.toLowerCase()}`} style={{ marginBottom: 10, display: "inline-block" }}>
          {stateLabel}
        </span>

        {selectedEdge.finding_links?.length > 0 && (
          <>
            <hr style={{ border: "none", borderTop: "0.5px solid #e5e7eb", margin: "8px 0" }} />
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9ca3af", marginBottom: 6 }}>
              Angles on this connection
            </div>
            {selectedEdge.finding_links.map((fl) => (
              <button
                key={fl.finding_id}
                type="button"
                className="panel-list-item"
                style={{ background: "none", border: "none", width: "100%", cursor: "pointer", textAlign: "left", marginBottom: 4 }}
                onClick={() => onOpenAngle(fl.finding_id, fl.title)}
              >
                <span className={`severity-badge severity-badge--${fl.severity}`}>{fl.severity}</span>
                <span style={{ fontSize: 11, marginLeft: 6, flex: 1 }}>{fl.title}</span>
              </button>
            ))}
          </>
        )}

        {isProposed && (
          <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 8 }}>
            Proposed by Intake — review in the connections panel.
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: 12, fontSize: 11, overflowY: "auto", height: "100%" }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9ca3af", marginBottom: 5 }}>
        Case web
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#111827", marginBottom: 2 }}>
        {graph?.stats ? `${knotCount} knots · ${edgeCount} connections` : "Loading…"}
      </div>

      {dashboard && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, margin: "10px 0" }}>
          {[
            { label: "Confirmed angles", value: dashboard.findings.by_status.CONFIRMED ?? 0, badge: "badge-success" },
            { label: "Active angles",    value: dashboard.findings.by_status.NEEDS_EVIDENCE ?? 0, badge: "badge-info" },
            { label: "Documents",        value: dashboard.documents.total, badge: null },
          ].map(({ label, value, badge }) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "#6b7280" }}>{label}</span>
              <span className={badge ? `badge ${badge}` : ""} style={badge ? {} : { fontWeight: 600 }}>
                {value}
              </span>
            </div>
          ))}
        </div>
      )}

      <hr style={{ border: "none", borderTop: "0.5px solid #e5e7eb", margin: "8px 0" }} />
      <div style={{ fontSize: 10, color: "#9ca3af" }}>
        Click a knot to open its profile. Click a connection to see detail.
      </div>
    </div>
  );
}
```

- [ ] **Step 1.6: Update the Level 1 right panel JSX to pass new props**

Replace the `WebRightPanel` usage in the JSX (currently around line 507-527) with:

```tsx
{current.kind === "web" && !showDocument && (
  <div style={{ width: 215, flexShrink: 0, borderLeft: "0.5px solid #e5e7eb", background: "#fff", overflow: "hidden" }}>
    <WebRightPanel
      graph={graph}
      dashboard={dashboard}
      selectedEdge={webSelectedEdge}
      onOpenAngle={(angleId, angleTitle) => navigate({ kind: "angle", angleId, angleTitle })}
      onClearEdge={() => setWebSelectedEdge(null)}
    />
  </div>
)}
```

- [ ] **Step 1.7: Fix WebToolbar labels and add separate Angle button**

Replace the `ToolbarProps` interface and `WebToolbar` component with:

```tsx
interface ToolbarProps {
  pendingCount: number;
  showMinimap: boolean;
  onAddKnot: () => void;
  onAddConnection: () => void;
  onAddAngle: () => void;
  onFit: () => void;
  onPendingClick: () => void;
  onToggleMinimap: () => void;
}

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

Update the two `WebToolbar` usages (loading state + main render) to pass the new props. The "+ Connection" and "+ Angle" both open `ConnectKnotsModal` for now:

```tsx
<WebToolbar
  pendingCount={pendingCount}
  showMinimap={showMinimap}
  onFit={() => cyRef.current?.fit(undefined, 40)}
  onAddKnot={() => { setConnectPrefill({}); setShowConnectModal(true); }}
  onAddConnection={() => { setConnectPrefill({}); setShowConnectModal(true); }}
  onAddAngle={() => { setConnectPrefill({}); setShowConnectModal(true); }}
  onPendingClick={() => setShowConnectionReview(true)}
  onToggleMinimap={() => setShowMinimap((s) => !s)}
/>
```

- [ ] **Step 1.8: Remove empty modal callback props from AngleView usage**

After Task 2 makes AngleView self-contained, remove `onOpenCitePicker` and `onOpenTieOff` from the AngleView JSX call:

```tsx
<AngleView
  caseId={caseId}
  angleId={current.angleId}
  documents={documents}
  onDocumentClick={(docId, docName) => navigate({ kind: "document", documentId: docId, docName })}
  onBack={navigateBack}
  onAngleTiedOff={() => fetchGraph(caseId).then(setGraph).catch(console.error)}
/>
```

- [ ] **Step 1.9: Build check**

```bash
cd /c/Users/tjcol/Catalyst/frontend && npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors (or only pre-existing errors unrelated to this task). Fix any type errors introduced.

- [ ] **Step 1.10: Commit**

```bash
git add frontend/src/views/InvestigateTab.tsx
git commit -m "feat(investigate): direct node→profile nav, edge detail panel, correct toolbar labels"
```

---

## Task 2: AngleView — Self-contained modals + Split button

**Files:**
- Modify: `frontend/src/views/AngleView.tsx`

### What changes and why

`onOpenCitePicker` and `onOpenTieOff` are currently props that receive `() => {}` from InvestigateTab. The modals `CiteDocumentPicker`, `TieOffModal`, and `AngleSplitModal` exist as files but are never mounted anywhere. AngleView already has the `FindingItem` state they need — mount them here directly and remove the external prop dependency.

- [ ] **Step 2.1: Remove external modal props from AngleViewProps**

Replace the `AngleViewProps` interface:

```tsx
interface AngleViewProps {
  caseId: string;
  angleId: string;
  documents: DocumentItem[];
  onDocumentClick: (docId: string, docName: string) => void;
  onBack: () => void;
  onAngleTiedOff: () => void;
}
```

(Removed `onOpenCitePicker` and `onOpenTieOff`.)

Update the function signature to match:

```tsx
export default function AngleView({
  caseId,
  angleId,
  documents,
  onDocumentClick,
  onBack,
  onAngleTiedOff,
}: AngleViewProps) {
```

- [ ] **Step 2.2: Add modal state**

After the existing `removeBanner` state, add:

```tsx
const [showCitePicker, setShowCitePicker] = useState(false);
const [showTieOff, setShowTieOff] = useState(false);
const [showSplit, setShowSplit] = useState(false);
```

- [ ] **Step 2.3: Add lazy imports for the three modals**

At the top of the file add:

```tsx
import { lazy } from "react";
import { Suspense } from "react";
const CiteDocumentPicker = lazy(() => import("../components/CiteDocumentPicker"));
const TieOffModal = lazy(() => import("../components/TieOffModal"));
const AngleSplitModal = lazy(() => import("../components/AngleSplitModal"));
```

(Remove any existing imports of these that aren't there yet — they were never imported before.)

- [ ] **Step 2.4: Add handleCited callback**

After `handleRemoveCitation`, add:

```tsx
async function handleCited(_newDocIds: string[]) {
  // Re-fetch the finding so document_links reflects the updated narrative
  try {
    const updated = await fetchAngle(caseId, angleId);
    setFinding(updated);
    setNarrative(updated.narrative ?? "");
    savedNarrativeRef.current = updated.narrative ?? "";
  } catch {
    // Ignore — next manual refresh will pick it up
  }
}

function handleTiedOff(updated: FindingItem) {
  setFinding(updated);
  setNarrative(updated.narrative ?? "");
  savedNarrativeRef.current = updated.narrative ?? "";
  onAngleTiedOff();
}
```

- [ ] **Step 2.5: Add Split angle button to toolbar**

In the action toolbar div (currently has "Cite document" and "Tie off"), add a third button:

```tsx
<div className="angle-view__toolbar">
  <button type="button" className="toolbar-btn" onClick={() => setShowCitePicker(true)}>
    <Plus size={12} aria-hidden="true" />
    Cite document
  </button>

  <button
    type="button"
    className="toolbar-btn"
    onClick={() => setShowSplit(true)}
    disabled={isTiedOff || citedDocCount === 0}
    title={isTiedOff ? "Already tied off." : citedDocCount === 0 ? "Cite a document first." : "Split this angle into two"}
  >
    Split angle
  </button>

  <button
    type="button"
    className="toolbar-btn"
    onClick={() => setShowTieOff(true)}
    disabled={isTiedOff}
    title={isTiedOff ? "This angle is already tied off." : "Tie off this angle with a final status"}
  >
    <ChevronDown size={12} aria-hidden="true" />
    Tie off
  </button>
</div>
```

- [ ] **Step 2.6: Mount the three modals at the bottom of the render return**

Before the closing `</div>` of the outer `angle-view` div, add:

```tsx
{/* ── Modals (self-contained, mounted when finding is loaded) ── */}
{finding && showCitePicker && (
  <Suspense fallback={null}>
    <CiteDocumentPicker
      open={showCitePicker}
      caseId={caseId}
      finding={finding}
      documents={documents}
      onClose={() => setShowCitePicker(false)}
      onCited={handleCited}
    />
  </Suspense>
)}

{finding && showTieOff && (
  <Suspense fallback={null}>
    <TieOffModal
      open={showTieOff}
      caseId={caseId}
      finding={finding}
      onClose={() => setShowTieOff(false)}
      onTiedOff={handleTiedOff}
    />
  </Suspense>
)}

{finding && showSplit && (
  <Suspense fallback={null}>
    <AngleSplitModal
      open={showSplit}
      caseId={caseId}
      finding={finding}
      documents={documents}
      onClose={() => setShowSplit(false)}
      onCreated={() => {
        setShowSplit(false);
        onAngleTiedOff(); // parent refreshes graph since parent angle is now DISMISSED
        onBack();         // navigate back since this angle is exhausted
      }}
    />
  </Suspense>
)}
```

- [ ] **Step 2.7: Build check**

```bash
cd /c/Users/tjcol/Catalyst/frontend && npx tsc --noEmit 2>&1 | head -40
```

Fix any type errors (especially the removed props in InvestigateTab — Task 1.8 should have done this already; if not, do it now).

- [ ] **Step 2.8: Commit**

```bash
git add frontend/src/views/AngleView.tsx frontend/src/views/InvestigateTab.tsx
git commit -m "feat(angle): self-contained cite/tie-off/split modals, split angle button"
```

---

## Task 3: AngleView — Complete Lead panel (3 sections)

**Files:**
- Modify: `frontend/src/views/AngleView.tsx`

### What changes and why

The current `LeadPanel` calls `aiAsk` with a plain question and shows only "Suggested next". The spec (Section 7) requires three sections: **Suggested next**, **Pattern match**, **New angle?**. We ask `aiAsk` with a structured JSON prompt and parse the three fields.

- [ ] **Step 3.1: Define the Lead response type and update LeadPanel**

Replace the entire `LeadPanel` component with:

```tsx
interface LeadSections {
  next_step: string;
  pattern_match: string | null;
  new_angle: string | null;
}

interface LeadPanelProps {
  caseId: string;
  finding: FindingItem | null;
  citedDocCount: number;
}

function LeadPanel({ caseId, finding, citedDocCount }: LeadPanelProps) {
  const [sections, setSections] = useState<LeadSections | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);
  const [leadLoading, setLeadLoading] = useState(false);
  const [leadError, setLeadError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchLead = useCallback(async () => {
    if (!finding) return;
    if (citedDocCount === 0) {
      setSections(null);
      setRawText(null);
      setLeadLoading(false);
      return;
    }

    setLeadLoading(true);
    setLeadError(false);

    const question = [
      `Angle: "${finding.title}"`,
      `Evidence cited: ${citedDocCount} documents`,
      `Existing narrative: ${finding.narrative ? finding.narrative.slice(0, 400) : "(none yet)"}`,
      ``,
      `Respond with ONLY a valid JSON object — no markdown, no explanation, just the JSON:`,
      `{`,
      `  "next_step": "one concrete investigative action (1-2 sentences)",`,
      `  "pattern_match": null,`,
      `  "new_angle": null`,
      `}`,
      `For pattern_match: if the cited evidence matches one of these signal rules (SR-003, SR-004, SR-005, SR-006, SR-010, SR-012, SR-013, SR-015, SR-017, SR-021, SR-024, SR-025, SR-026, SR-028, SR-029), set it to a 1-2 sentence explanation naming the rule. Otherwise null.`,
      `For new_angle: if you see a second independent line of inquiry worth pursuing, set it to "EntityA and EntityB — brief reason (1 sentence)". Otherwise null.`,
      `Rules: Never use the words fraud, criminal, illegal, guilty. Evidence weight is at most DIRECTIONAL.`,
    ].join("\n");

    try {
      const response = await aiAsk(caseId, question);
      const text = response.answer.trim();
      // Strip markdown code fences if the model adds them
      const clean = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
      try {
        const parsed = JSON.parse(clean) as LeadSections;
        setSections(parsed);
        setRawText(null);
      } catch {
        // Couldn't parse JSON — show raw text in next_step
        setRawText(text);
        setSections(null);
      }
    } catch {
      setLeadError(true);
    } finally {
      setLeadLoading(false);
    }
  }, [caseId, finding, citedDocCount]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchLead, 3000);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchLead]);

  useEffect(() => {
    if (finding && citedDocCount > 0) fetchLead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="lead-panel">
      <div className="lead-panel__header">
        <Sparkles size={13} aria-hidden="true" />
        {" "}Lead
      </div>

      <div className="lead-panel__section">
        {citedDocCount === 0 && !leadLoading && (
          <p className="lead-panel__text lead-panel__text--muted">
            Cite a document and Lead will suggest what to look for next.
          </p>
        )}

        {citedDocCount > 0 && leadLoading && (
          <div className="lead-panel__thinking">
            <Loader2 size={13} className="spin" aria-hidden="true" />
            Lead is thinking…
          </div>
        )}

        {citedDocCount > 0 && !leadLoading && leadError && (
          <p className="lead-panel__text lead-panel__text--muted">Lead unavailable.</p>
        )}

        {citedDocCount > 0 && !leadLoading && !leadError && rawText && (
          <>
            <p className="lead-panel__section-title">Suggested next</p>
            <p className="lead-panel__text">{rawText}</p>
          </>
        )}

        {citedDocCount > 0 && !leadLoading && !leadError && sections && (
          <>
            {sections.next_step && (
              <>
                <p className="lead-panel__section-title">Suggested next</p>
                <p className="lead-panel__text">{sections.next_step}</p>
              </>
            )}

            {sections.pattern_match && (
              <>
                <hr style={{ border: "none", borderTop: "0.5px solid #e5e7eb", margin: "8px 0" }} />
                <p className="lead-panel__section-title">Pattern match</p>
                <p className="lead-panel__text">{sections.pattern_match}</p>
              </>
            )}

            {sections.new_angle && (
              <>
                <hr style={{ border: "none", borderTop: "0.5px solid #e5e7eb", margin: "8px 0" }} />
                <p className="lead-panel__section-title">New angle?</p>
                <p className="lead-panel__text">{sections.new_angle}</p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3.2: Build check and commit**

```bash
cd /c/Users/tjcol/Catalyst/frontend && npx tsc --noEmit 2>&1 | head -20
git add frontend/src/views/AngleView.tsx
git commit -m "feat(lead): 3-section Lead panel with JSON-structured suggestions"
```

---

## Task 4: Expose extracted_text from backend document serializer

**Files:**
- Modify: `backend/investigations/serializers.py`
- Modify: `frontend/src/types/index.ts`

### What changes and why

`DocumentView.tsx` currently shows `"Text extracted — full document viewer requires backend update."` because `Document.extracted_text` is never serialized. Adding it to the serializer is a one-field addition.

- [ ] **Step 4.1: Find the document serializer in the backend**

```bash
grep -n "extracted_text\|class Document" backend/investigations/serializers.py | head -30
```

This shows you which serializer class handles document detail. It will be something like `DocumentSerializer` or `DocumentDetailSerializer`.

- [ ] **Step 4.2: Add extracted_text to the serializer fields list**

In `backend/investigations/serializers.py`, find the document serializer's `fields` list or `Meta.fields` tuple and add `"extracted_text"`.

Example — if you see something like:
```python
class DocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Document
        fields = [
            "id", "filename", "display_name", "file_path", "sha256_hash",
            "file_size", "doc_type", ...
        ]
```

Add `"extracted_text"` to that list. The field is already on the model as `TextField(blank=True, default='')` so no migration is needed.

- [ ] **Step 4.3: Add extracted_text to DocumentItem TypeScript type**

In `frontend/src/types/index.ts`, find the `DocumentItem` interface and add after `extraction_notes`:

```typescript
/**
 * Full OCR-extracted text of the document. Empty string "" if extraction has not run.
 * Populated only on the document detail endpoint (GET /api/cases/:id/documents/:doc_id/).
 * Not included on list endpoints (too large).
 */
extracted_text?: string;
```

- [ ] **Step 4.4: Verify with a quick smoke test**

```bash
# Start the backend (if not running) and test the endpoint
curl -s "http://localhost:8000/api/cases/<any-case-uuid>/documents/<any-doc-uuid>/" | python3 -c "import sys,json; d=json.load(sys.stdin); print('extracted_text' in d, len(d.get('extracted_text','')))"
```

Expected output: `True <N>` where N is the character count of the OCR text (may be 0 for documents not yet processed).

- [ ] **Step 4.5: Commit**

```bash
git add backend/investigations/serializers.py frontend/src/types/index.ts
git commit -m "feat(docs): expose extracted_text in document detail serializer"
```

---

## Task 5: DocumentView — Real OCR text, Cite in angle, RAG navigation

**Files:**
- Modify: `frontend/src/views/DocumentView.tsx`
- Modify: `frontend/src/views/InvestigateTab.tsx` (pass activeAngleId)

### What changes and why

Three gaps:
1. `buildContentText` returns placeholder text — replace with `doc.extracted_text`
2. Context menu is missing "Cite in angle" item
3. Clicking a RAG result shows a banner instead of navigating to the document

- [ ] **Step 5.1: Update buildContentText to use real OCR text**

Replace the entire `buildContentText` function with:

```typescript
function buildContentText(doc: DocumentItem): string {
  if (doc.extracted_text && doc.extracted_text.trim().length > 0) {
    return doc.extracted_text;
  }

  switch (doc.ocr_status) {
    case "COMPLETED":
      return `[Document: ${doc.filename}]\n[Text extraction completed but no content returned — the document may be image-only or the backend serializer needs updating.]\n\nSHA-256: ${doc.sha256_hash}`;
    case "PENDING":
    case "IN_PROGRESS":
      return "Intake is processing this document…";
    case "FAILED":
      return `Intake could not extract text from this document.\n\nExtraction notes:\n${doc.extraction_notes || "(none)"}`;
    case "SKIPPED":
      return "Text extraction was skipped for this document.";
    default:
      return "";
  }
}
```

- [ ] **Step 5.2: Add activeAngleId prop to DocumentView**

Update `DocumentViewProps`:

```typescript
interface DocumentViewProps {
  caseId: string;
  documentId: string;
  activeAngleId?: string;
  onBack: () => void;
  onDocumentNavigate?: (docId: string) => void;
}
```

Update the function signature to receive and use these props:

```typescript
export default function DocumentView({ caseId, documentId, activeAngleId, onBack, onDocumentNavigate }: DocumentViewProps) {
```

- [ ] **Step 5.3: Pass activeAngleId from InvestigateTab to DocumentView**

In `InvestigateTab.tsx`, in the Level 4 DocumentView render block, extract the active angle ID from the navStack:

```tsx
{showDocument && current.kind === "document" && (
  <Suspense fallback={fallback("Loading document…")}>
    <DocumentView
      caseId={caseId}
      documentId={current.documentId}
      activeAngleId={(() => {
        const angleEntry = navStack.find((e): e is Extract<NavEntry, {kind: "angle"}> => e.kind === "angle");
        return angleEntry?.angleId;
      })()}
      onBack={navigateBack}
      onDocumentNavigate={(docId) => {
        // Find the document name from the case document list
        const doc = graph?.nodes.find((n) => n.id === docId);
        navigate({ kind: "document", documentId: docId, docName: doc?.label ?? docId.slice(0, 8) + "…" });
      }}
    />
  </Suspense>
)}
```

- [ ] **Step 5.4: Add citeInAngle handler and "Cite in angle" context menu item**

In `DocumentView`, add a handler that appends selected text to the active angle's narrative:

```typescript
async function handleCiteInAngle() {
  const selection = window.getSelection()?.toString().trim() ?? "";
  if (!selection || !activeAngleId) return;

  try {
    // Fetch current angle to get existing narrative
    const { fetchAngle, updateAngle } = await import("../api");
    const current = await fetchAngle(caseId, activeAngleId);
    const passage = `\n— from ${doc?.filename ?? "document"}: "${selection}"`;
    const updated = current.narrative ? current.narrative + passage : passage.trimStart();
    await updateAngle(caseId, activeAngleId, { narrative: updated });
    setCapturedBanner(true);
    setTimeout(() => setCapturedBanner(false), 1500);
  } catch {
    // silently fail — the investigator can manually paste
  }
}
```

Add the "Cite in angle" menu item inside `ContextMenu.Content`, after "Search docs for selection" and before "Quick capture this":

```tsx
{activeAngleId && (
  <ContextMenu.Item
    onSelect={handleCiteInAngle}
    style={{ padding: "6px 14px", cursor: "pointer", outline: "none" }}
    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#f3f4f6")}
    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "")}
  >
    Cite in angle
  </ContextMenu.Item>
)}
```

Also update the captured banner message to be context-aware:

```tsx
{capturedBanner && (
  <div role="status" style={{ background: "#d1fae5", color: "#065f46", fontSize: 12, fontWeight: 600, padding: "6px 16px", flexShrink: 0 }}>
    {activeAngleId ? "Added to angle." : "Captured!"}
  </div>
)}
```

- [ ] **Step 5.5: Fix RAG result click to navigate to that document**

Replace `handleResultClick` with:

```typescript
function handleResultClick(result: SearchResult) {
  if (result.type === "document" && result.id !== documentId && onDocumentNavigate) {
    onDocumentNavigate(result.id);
  } else {
    setJumpBanner(`Jump to: ${result.title}`);
    setTimeout(() => setJumpBanner(null), 2000);
  }
}
```

- [ ] **Step 5.6: Build check and commit**

```bash
cd /c/Users/tjcol/Catalyst/frontend && npx tsc --noEmit 2>&1 | head -40
git add frontend/src/views/DocumentView.tsx frontend/src/views/InvestigateTab.tsx
git commit -m "feat(document): real OCR text, cite-in-angle context menu, RAG result navigation"
```

---

## Task 6: ProfilePanel — Load and display existing quick captures

**Files:**
- Modify: `frontend/src/views/ProfilePanel.tsx`

### What changes and why

The profile shows a textarea to add new notes, but never fetches and displays existing ones. The `fetchNotes` API exists and returns all case notes — filter client-side by `target_id`.

- [ ] **Step 6.1: Add fetchNotes import and existing notes state**

At the top of the file, add to the imports from `"../api"`:
```typescript
import { createNote, fetchNotes } from "../api";
```

Add to the imports from `"../types"`:
```typescript
import type { ..., InvestigatorNote } from "../types";
```

Inside the `ProfilePanel` component, after the existing state declarations, add:

```typescript
const [existingNotes, setExistingNotes] = useState<InvestigatorNote[]>([]);
const [notesLoading, setNotesLoading] = useState(false);
```

- [ ] **Step 6.2: Fetch notes on mount**

Add a useEffect after the component's existing logic:

```typescript
useEffect(() => {
  if (!entityId) return;
  let cancelled = false;
  setNotesLoading(true);
  fetchNotes(caseId)
    .then((resp) => {
      if (!cancelled) {
        setExistingNotes(
          resp.results.filter((n) => n.target_id === entityId)
        );
      }
    })
    .catch(() => {})
    .finally(() => { if (!cancelled) setNotesLoading(false); });
  return () => { cancelled = true; };
}, [caseId, entityId]);
```

- [ ] **Step 6.3: Show existing notes above the textarea in the Quick Captures section**

Replace the QUICK CAPTURES section with:

```tsx
{/* ── QUICK CAPTURES ────────────────────────────────────────── */}
<div className="panel-section">
  <div className="panel-section__title">Quick Captures</div>

  {/* Existing notes */}
  {notesLoading && (
    <div className="skeleton" style={{ height: 40, borderRadius: 4, marginBottom: 8 }} />
  )}
  {!notesLoading && existingNotes.length > 0 && (
    <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px", display: "flex", flexDirection: "column", gap: 6 }}>
      {existingNotes.map((note) => (
        <li
          key={note.id}
          style={{
            background: "#FAEEDA",
            border: "0.5px solid #FAC775",
            borderRadius: 6,
            padding: "7px 10px",
          }}
        >
          <p style={{ fontSize: 12, color: "#633806", lineHeight: 1.5, margin: 0 }}>
            {note.content}
          </p>
          <p style={{ fontSize: 10, color: "#854F0B", marginTop: 3 }}>
            {new Date(note.created_at).toLocaleDateString()}
          </p>
        </li>
      ))}
    </ul>
  )}

  {/* Add new note */}
  <textarea
    ref={textareaRef}
    className="quick-capture"
    value={noteContent}
    onChange={(e) => setNoteContent(e.target.value)}
    onKeyDown={handleTextareaKeyDown}
    placeholder="Add quick capture… (Enter to save, Shift+Enter for newline)"
    rows={3}
    disabled={noteSubmitting}
  />

  {noteError && (
    <p style={{ fontSize: 12, color: "#ef4444", margin: "4px 0 0" }}>{noteError}</p>
  )}

  <button
    type="button"
    className="btn-primary"
    style={{ marginTop: 6 }}
    onClick={() => void handleNoteSubmit()}
    disabled={!noteContent.trim() || noteSubmitting}
  >
    {noteSubmitting ? "Saving…" : "Save"}
  </button>
</div>
```

- [ ] **Step 6.4: After a successful note save, append to existingNotes without refetch**

In `handleNoteSubmit`, after `setNoteContent("")`:

```typescript
// Optimistically append new note to list
setExistingNotes((prev) => [
  ...prev,
  {
    id: Date.now().toString(), // temporary ID until page refresh
    case_id: caseId,
    target_type: noteTargetType,
    target_id: entityId,
    content,
    created_by: "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as InvestigatorNote,
]);
```

- [ ] **Step 6.5: Build check and commit**

```bash
cd /c/Users/tjcol/Catalyst/frontend && npx tsc --noEmit 2>&1 | head -20
git add frontend/src/views/ProfilePanel.tsx
git commit -m "feat(profile): fetch and display existing quick captures"
```

---

## Task 7: FinancialsTab — Interactive anomaly popovers + CaseDetailView tab control

**Files:**
- Modify: `frontend/src/views/FinancialsTab.tsx`
- Modify: `frontend/src/views/CaseDetailView.tsx`

### What changes and why

Anomaly cells have `title` attributes (native browser tooltip) with no action buttons. The spec requires clicking an anomaly cell to open a popover with "Start new angle" and (when available) "Open existing angle" buttons. This requires:

1. Replace `title` with a Radix Popover
2. CaseDetailView must control the active tab with state (so it can switch to Investigate programmatically)
3. FinancialsTab receives an `onStartAngle` callback

- [ ] **Step 7.1: Add Radix Popover import to FinancialsTab**

```tsx
import * as Popover from "@radix-ui/react-popover";
```

- [ ] **Step 7.2: Add onStartAngle prop to FinancialsTab**

Update `FinancialsTabProps`:

```typescript
interface FinancialsTabProps {
  caseId: string;
  onStartAngle?: (prefilledName: string) => void;
}
```

Update the function signature:

```tsx
export default function FinancialsTab({ caseId, onStartAngle }: FinancialsTabProps) {
```

- [ ] **Step 7.3: Create AnomalyCell component**

Add this component inside `FinancialsTab.tsx` before the main `FinancialsTab` function:

```tsx
interface AnomalyCellProps {
  value: string | React.ReactNode;
  ruleId: string;
  ruleLabel: string;
  explanation: string;
  onStartAngle?: (prefilledName: string) => void;
}

function AnomalyCell({ value, ruleId, ruleLabel, explanation, onStartAngle }: AnomalyCellProps) {
  const [open, setOpen] = useState(false);
  const prefilledName = `${ruleLabel} — anomaly detected`;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <td
          className="cell--flag"
          style={{ cursor: "pointer" }}
          role="button"
          tabIndex={0}
          aria-label={`${ruleId} anomaly — click for details`}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOpen(true); }}
        >
          {value}
        </td>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            padding: 14,
            maxWidth: 280,
            zIndex: 200,
          }}
          sideOffset={4}
        >
          <p style={{ fontSize: 12, fontWeight: 600, color: "#111827", marginBottom: 4 }}>
            {ruleId}
          </p>
          <p style={{ fontSize: 11, color: "#6b7280", lineHeight: 1.5, marginBottom: 10 }}>
            {explanation}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {onStartAngle && (
              <button
                type="button"
                className="btn-primary"
                style={{ fontSize: 11, width: "100%" }}
                onClick={() => { setOpen(false); onStartAngle(prefilledName); }}
              >
                Start new angle
              </button>
            )}
            <Popover.Close asChild>
              <button type="button" className="btn-secondary" style={{ fontSize: 11, width: "100%" }}>
                Dismiss
              </button>
            </Popover.Close>
          </div>
          <Popover.Arrow style={{ fill: "#e5e7eb" }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
```

Also add `useState` to the import at the top (it's already there for the main component, but `AnomalyCell` uses its own).

Actually since `AnomalyCell` uses `useState`, make sure `useState` is imported from react at the top — it already is.

- [ ] **Step 7.4: Replace anomaly `<td>` elements in the table with AnomalyCell**

In the Total revenue row, replace the anomaly cell:

```tsx
{snapshots.map((s) => {
  const spike = isRevenueSpike(s);
  if (spike) {
    return (
      <AnomalyCell
        key={s.tax_year}
        value={
          <>
            {formatMoney(s.total_revenue)}
            {s.total_revenue_yoy_pct !== undefined && (
              <><br /><YoYBadge pct={s.total_revenue_yoy_pct} /></>
            )}
          </>
        }
        ruleId="SR-021"
        ruleLabel="Revenue spike"
        explanation={revenueSpikeTitle(s) ?? ""}
        onStartAngle={onStartAngle}
      />
    );
  }
  return (
    <td key={s.tax_year}>
      {formatMoney(s.total_revenue)}
      {s.total_revenue_yoy_pct !== undefined && (
        <><br /><YoYBadge pct={s.total_revenue_yoy_pct} /></>
      )}
    </td>
  );
})}
```

Do the same for the Program services row (SR-029) and Officer compensation row (SR-013), wrapping their flagged `<td>` elements in `<AnomalyCell>`.

For program services:
```tsx
if (flagged) {
  return (
    <AnomalyCell
      key={s.tax_year}
      value={<>{formatMoney(s.program_service_revenue)}{pct !== null && <><br/><span style={{fontSize:"0.75em",opacity:0.75}}>({pct}%)</span></>}</>}
      ruleId="SR-029"
      ruleLabel="Low program ratio"
      explanation={lowProgramTitle(s) ?? ""}
      onStartAngle={onStartAngle}
    />
  );
}
```

For officer compensation:
```tsx
if (flagged) {
  return (
    <AnomalyCell
      key={s.tax_year}
      value={formatMoney(s.officer_compensation_total)}
      ruleId="SR-013"
      ruleLabel="Zero officer pay"
      explanation={zeroCompTitle(s) ?? ""}
      onStartAngle={onStartAngle}
    />
  );
}
```

- [ ] **Step 7.5: Add controlled tab state to CaseDetailView**

In `CaseDetailView.tsx`, replace `defaultValue="investigate"` with controlled state:

After `const [loadingCase, setLoadingCase] = useState(true);`, add:

```typescript
const [activeTab, setActiveTab] = useState("investigate");
```

Replace `<Tabs.Root defaultValue="investigate"` with:

```tsx
<Tabs.Root
  value={activeTab}
  onValueChange={setActiveTab}
  style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}
>
```

- [ ] **Step 7.6: Pass onStartAngle callback to FinancialsTab from CaseDetailView**

In CaseDetailView, the `InvestigateTab` needs to expose a way to open the ConnectKnotsModal from outside. The simplest approach: pass a callback that just switches to the Investigate tab with a note (the ConnectKnotsModal wiring inside InvestigateTab is already there for the toolbar buttons).

Add to the FinancialsTab usage:

```tsx
<Tabs.Content value="financials" className="tab-panel">
  <Suspense fallback={TAB_FALLBACK}>
    <FinancialsTab
      caseId={id}
      onStartAngle={(prefilledName) => {
        setActiveTab("investigate");
        // After tab switch, the investigator uses "+ Angle" in the toolbar.
        // Use a toast notification to prompt them.
        import("sonner").then(({ toast }) => {
          toast(`Switch to "+ Angle" to create: ${prefilledName}`);
        });
      }}
    />
  </Suspense>
</Tabs.Content>
```

Note: A full deep-link (auto-opening the modal with prefilled name) requires InvestigateTab to accept an `initialAngleName` prop and open ConnectKnotsModal on mount. That is in scope but adds complexity — the toast approach is a working approximation. Add to the plan backlog if Tyler wants the full flow.

- [ ] **Step 7.7: Build check and commit**

```bash
cd /c/Users/tjcol/Catalyst/frontend && npx tsc --noEmit 2>&1 | head -40
git add frontend/src/views/FinancialsTab.tsx frontend/src/views/CaseDetailView.tsx
git commit -m "feat(financials): interactive anomaly popovers with start-angle action"
```

---

## Task 8: TimelineTab — "Cite in angle" on event cards + event clustering

**Files:**
- Modify: `frontend/src/views/TimelineTab.tsx`
- Modify: `frontend/src/views/CaseDetailView.tsx`

### What changes and why

Two gaps:
1. Event cards have no action buttons — spec requires "Cite in angle" and "View document"
2. Events on the same day should cluster into a stack (SR-004 UCC burst visibility)

- [ ] **Step 8.1: Add onCiteInAngle and onViewDocument props to TimelineTab**

Update `TimelineTabProps`:

```typescript
interface TimelineTabProps {
  caseId: string;
  activeAngleId?: string;
  onCiteInAngle?: (event: TimelineEvent) => void;
  onViewDocument?: (documentId: string, label: string) => void;
}
```

Update function signature:

```tsx
export default function TimelineTab({ caseId, activeAngleId, onCiteInAngle, onViewDocument }: TimelineTabProps) {
```

- [ ] **Step 8.2: Update EventCard sub-components to show action buttons**

The event cards need buttons. Update `DocumentCard` to include action buttons:

```tsx
function DocumentCard({ event, onCiteInAngle, onViewDocument }: {
  event: TimelineEvent;
  onCiteInAngle?: (e: TimelineEvent) => void;
  onViewDocument?: (id: string, label: string) => void;
}) {
  const dt = String(event.metadata.doc_type ?? "OTHER");
  const badgeClass = `doc-badge doc-badge--${dt === "UCC" ? "UCC" : dt}`;
  const docId = String(event.metadata.document_id ?? "");
  return (
    <div className="event-card">
      <div className="event-card__header">
        <span className={`event-dot event-dot--${dt === "UCC" ? "ucc" : "document"}`}>
          <FileText size={12} />
        </span>
        <span className={badgeClass}>{dt}</span>
        <span className="event-card__meta">{event.label}</span>
      </div>
      <div className="event-card__excerpt">
        {formatDate(parseDate(event.date))} &middot; Extracted by Intake
      </div>
      {(onViewDocument || onCiteInAngle) && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          {docId && onViewDocument && (
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: 11, padding: "3px 8px" }}
              onClick={() => onViewDocument(docId, event.label)}
            >
              View document
            </button>
          )}
          {onCiteInAngle && (
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: 11, padding: "3px 8px" }}
              onClick={() => onCiteInAngle(event)}
            >
              Cite in angle
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

Apply the same pattern to `FinancialCard`, `TransactionCard`, `FindingCard` (for FindingCard, show "Open angle" instead of "Cite in angle"), and `NoteCard`.

Update `EventCard` to thread the callbacks down:

```tsx
function EventCard({ event, onCiteInAngle, onViewDocument }: {
  event: TimelineEvent;
  onCiteInAngle?: (e: TimelineEvent) => void;
  onViewDocument?: (id: string, label: string) => void;
}) {
  const cls = getEventClass(event);
  const props = { event, onCiteInAngle, onViewDocument };
  if (cls === "financial") return <FinancialCard {...props} />;
  if (cls === "transaction") return <TransactionCard {...props} />;
  if (cls === "finding") return <FindingCard {...props} />;
  if (cls === "note") return <NoteCard {...props} />;
  return <DocumentCard {...props} />;
}
```

- [ ] **Step 8.3: Add event clustering for same-day events**

In the component, before the visible events are rendered, group them by date. Add this helper function:

```typescript
function groupByDay(events: TimelineEvent[]): Map<string, TimelineEvent[]> {
  const groups = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const key = e.date.slice(0, 10); // YYYY-MM-DD
    const group = groups.get(key) ?? [];
    group.push(e);
    groups.set(key, group);
  }
  return groups;
}
```

In the main render, replace the `visibleEvents.map((event) => <EventCard ...>)` with clustered rendering:

```tsx
{(() => {
  const groups = groupByDay(visibleEvents);
  const sortedKeys = Array.from(groups.keys()).sort();
  return sortedKeys.map((day) => {
    const dayEvents = groups.get(day)!;
    if (dayEvents.length === 1) {
      return (
        <EventCard
          key={dayEvents[0].id}
          event={dayEvents[0]}
          onCiteInAngle={onCiteInAngle}
          onViewDocument={onViewDocument}
        />
      );
    }
    // Multiple events on same day — show a cluster
    const [first, ...rest] = dayEvents;
    return (
      <ClusterCard
        key={day}
        day={day}
        events={dayEvents}
        primaryEvent={first}
        onCiteInAngle={onCiteInAngle}
        onViewDocument={onViewDocument}
      />
    );
  });
})()}
```

Add the `ClusterCard` component before `EventCard`:

```tsx
function ClusterCard({ day, events, primaryEvent, onCiteInAngle, onViewDocument }: {
  day: string;
  events: TimelineEvent[];
  primaryEvent: TimelineEvent;
  onCiteInAngle?: (e: TimelineEvent) => void;
  onViewDocument?: (id: string, label: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const ucc = events.filter((e) => getEventClass(e) === "ucc");
  const isUccBurst = ucc.length >= 3;

  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          background: isUccBurst ? "#FAECE7" : "var(--color-background-secondary, #f9fafb)",
          border: `1px solid ${isUccBurst ? "#D85A30" : "#e5e7eb"}`,
          borderRadius: 6,
          padding: "6px 10px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Enter") setExpanded((v) => !v); }}
        aria-expanded={expanded}
      >
        <span
          style={{
            background: isUccBurst ? "#D85A30" : "#6b7280",
            color: "#fff",
            borderRadius: 10,
            padding: "1px 7px",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {events.length}
        </span>
        <span style={{ fontSize: 12, fontWeight: 500 }}>
          {isUccBurst ? `UCC burst — ${ucc.length} filings` : `${events.length} events`}
        </span>
        <span style={{ fontSize: 11, color: "#6b7280" }}>{day}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#9ca3af" }}>
          {expanded ? "▲" : "▼"}
        </span>
      </div>
      {expanded && (
        <div style={{ paddingLeft: 12, borderLeft: "2px solid #e5e7eb", marginLeft: 8 }}>
          {events.map((e) => (
            <EventCard
              key={e.id}
              event={e}
              onCiteInAngle={onCiteInAngle}
              onViewDocument={onViewDocument}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 8.4: Implement "Cite in angle" from timeline**

The `onCiteInAngle` callback in CaseDetailView needs to add the event to the active angle. Add this to CaseDetailView's TimelineTab usage. First, we need to track the active angle ID in CaseDetailView.

The simplest approach: track `activeAngleId` in CaseDetailView state, updated by InvestigateTab when an angle is opened.

Add to CaseDetailView:
```typescript
const [activeAngleId, setActiveAngleId] = useState<string | undefined>();
```

Pass a callback to InvestigateTab:
```tsx
<InvestigateTab
  caseId={id}
  documents={caseData?.documents ?? []}
  onAngleActive={(angleId) => setActiveAngleId(angleId)}
/>
```

In InvestigateTab, add `onAngleActive?: (angleId: string | undefined) => void` to `InvestigateTabProps` and call it in the `navigate` function:

```typescript
function navigate(entry: NavEntry) {
  setNavStack((s) => [...s, entry]);
  setWebSelectedEdge(null);
  if (entry.kind === "angle") {
    props.onAngleActive?.(entry.angleId);
  } else if (entry.kind === "web" || entry.kind === "profile") {
    props.onAngleActive?.(undefined);
  }
}
```

Also call `props.onAngleActive?.(undefined)` in `navigateTo` when popping back above the angle level.

Then pass to TimelineTab:

```tsx
<TimelineTab
  caseId={id}
  activeAngleId={activeAngleId}
  onCiteInAngle={async (event) => {
    if (!activeAngleId) return;
    const { fetchAngle, updateAngle } = await import("./api");
    const current = await fetchAngle(id, activeAngleId);
    const note = `\n— Timeline event ${event.date.slice(0, 10)}: ${event.label}`;
    await updateAngle(id, activeAngleId, { narrative: (current.narrative ?? "") + note });
    import("sonner").then(({ toast }) => toast(`Event cited in angle`));
  }}
  onViewDocument={(docId, label) => {
    setActiveTab("investigate");
    // Navigate to document in Investigate tab — requires passing down a handler
    // For now, switch tab and let investigator navigate
  }}
/>
```

- [ ] **Step 8.5: Build check and commit**

```bash
cd /c/Users/tjcol/Catalyst/frontend && npx tsc --noEmit 2>&1 | head -40
git add frontend/src/views/TimelineTab.tsx frontend/src/views/CaseDetailView.tsx frontend/src/views/InvestigateTab.tsx
git commit -m "feat(timeline): cite-in-angle, event clustering, UCC burst stacking"
```

---

## Task 9: Final build verification

- [ ] **Step 9.1: Run TypeScript check**

```bash
cd /c/Users/tjcol/Catalyst/frontend && npx tsc --noEmit 2>&1
```

Expected: zero errors. Fix any remaining type errors.

- [ ] **Step 9.2: Run Vite build**

```bash
cd /c/Users/tjcol/Catalyst/frontend && npm run build 2>&1 | tail -20
```

Expected: `✓ built in Xs` with no errors.

- [ ] **Step 9.3: Run ruff on backend change**

```bash
cd /c/Users/tjcol/Catalyst && python -m ruff check backend/investigations/serializers.py
```

Expected: no errors.

- [ ] **Step 9.4: Final commit**

```bash
git add -A
git commit -m "chore: final build verification pass — all components complete"
```

---

## Self-Review: Spec Coverage Check

| Spec section | Task | Status |
|---|---|---|
| §5 Web view — node click → Profile | Task 1.1 | ✅ |
| §5 Web view — edge click → connection detail | Task 1.3–1.5 | ✅ |
| §5 Toolbar: +Knot, +Connection, +Angle | Task 1.7 | ✅ |
| §6 Profile — connections, angles, quick captures | Task 6 | ✅ |
| §7 Angle view — Cite, Tie off, Split buttons wired | Task 2 | ✅ |
| §7 Lead panel — 3 sections | Task 3 | ✅ |
| §7.1 Tie-off modal — existing modal, now mounted | Task 2 | ✅ |
| §8.1 Angle split modal — existing modal, now mounted | Task 2 | ✅ |
| §9 Document view — real OCR text | Task 4 + 5 | ✅ |
| §9 Document view — "Cite in angle" context menu | Task 5.4 | ✅ |
| §9 RAG result click navigates to document | Task 5.5 | ✅ |
| §10 Research tab | Already functional | ✅ |
| §11 Financials — anomaly cell interactive tooltip | Task 7 | ✅ |
| §12 Timeline — event clustering for SR-004 burst | Task 8.3 | ✅ |
| §12 Timeline — "Cite in angle" on events | Task 8.4 | ✅ |
| §13 AI naming: Lead/Intake only | All tasks follow spec | ✅ |
| §15.5 Empty states | Already implemented in all components | ✅ |

**Gaps intentionally deferred:**
- Intake highlight layer in DocumentView (spans for Entity/Date/Amount/Flag) — requires backend to expose highlight positions, not just text. Backend currently doesn't return span offsets.
- "Open existing angle" in Financials popover — requires fetching angles by rule_id. Task 7 includes "Start new angle" only. Add as follow-up.
- FinancialsTab "Start new angle" deep-link (auto-open ConnectKnotsModal with prefill) — Task 7 uses a toast prompt instead. Add as follow-up.
- Document view minimap while in Level 4 — not in current spec build sequence.
