import cytoscape from "cytoscape";
// @ts-expect-error — cytoscape-cose-bilkent has no bundled type declarations
import coseBilkent from "cytoscape-cose-bilkent";
import CytoscapeComponent from "react-cytoscapejs";

// Register the cose-bilkent layout algorithm once at module load time.
// cytoscape.use() is idempotent — safe to call on hot reload.
cytoscape.use(coseBilkent);

/* ─── Stylesheet ─────────────────────────────────────────────────────────── */

const STYLESHEET: cytoscape.Stylesheet[] = [
  /* ── Person knots ── */
  {
    selector: 'node[type="person"]',
    style: {
      "background-color": "#3b82f6",
      color: "#ffffff",
      label: "data(label)",
      "text-valign": "center",
      "text-halign": "center",
      "font-size": 12,
      "text-wrap": "ellipsis",
      "text-max-width": 80,
      width: 48,
      height: 48,
      shape: "ellipse",
    },
  },

  /* ── Organization knots ── */
  {
    selector: 'node[type="org"]',
    style: {
      "background-color": "#14b8a6",
      color: "#ffffff",
      label: "data(label)",
      "text-valign": "center",
      "text-halign": "center",
      "font-size": 12,
      "text-wrap": "ellipsis",
      "text-max-width": 80,
      width: 52,
      height: 52,
      shape: "roundrectangle",
    },
  },

  /* ── Selected knot ── */
  {
    selector: "node:selected",
    style: {
      "background-color": "#ffffff",
      "border-width": 3,
      "border-color": "#f59e0b", // gold
      color: "#111827",
    },
  },

  /* ── Edge severity variants ── */
  {
    selector: 'edge[severity="CRITICAL"]',
    style: { "line-color": "#D85A30", "target-arrow-color": "#D85A30" },
  },
  {
    selector: 'edge[severity="HIGH"]',
    style: { "line-color": "#BA7517", "target-arrow-color": "#BA7517" },
  },
  {
    selector: 'edge[severity="MEDIUM"]',
    style: { "line-color": "#185FA5", "target-arrow-color": "#185FA5" },
  },
  {
    selector: 'edge[severity="INFORMATIONAL"]',
    style: { "line-color": "#9ca3af", "target-arrow-color": "#9ca3af" },
  },

  /* ── Proposed (unconfirmed) connections — dashed gray ── */
  {
    selector: 'edge[status="proposed"]',
    style: {
      "line-style": "dashed",
      "line-color": "#9ca3af",
      "target-arrow-color": "#9ca3af",
    },
  },

  /* ── Manual connections — dotted ── */
  {
    selector: 'edge[source_type="manual"]',
    style: {
      "line-style": "dotted",
    },
  },

  /* ── Default edge fallback ── */
  {
    selector: "edge",
    style: {
      width: 2,
      "curve-style": "bezier",
      "target-arrow-shape": "triangle",
      "line-color": "#9ca3af",
      "target-arrow-color": "#9ca3af",
    },
  },
];

/* ─── Component ──────────────────────────────────────────────────────────── */

interface CytoscapeCanvasProps {
  elements: cytoscape.ElementDefinition[];
  onNodeClick?: (id: string) => void;
  onEdgeClick?: (id: string) => void;
}

export default function CytoscapeCanvas({
  elements,
  onNodeClick,
  onEdgeClick,
}: CytoscapeCanvasProps) {
  function handleCyInit(cy: cytoscape.Core) {
    // Wire tap events to the callback props
    cy.on("tap", "node", (evt) => {
      const node = evt.target as cytoscape.NodeSingular;
      onNodeClick?.(node.id());
    });

    cy.on("tap", "edge", (evt) => {
      const edge = evt.target as cytoscape.EdgeSingular;
      onEdgeClick?.(edge.id());
    });
  }

  return (
    <CytoscapeComponent
      elements={elements}
      stylesheet={STYLESHEET}
      layout={{ name: "cose-bilkent" }}
      style={{ width: "100%", height: "100%" }}
      cy={handleCyInit}
    />
  );
}

// TODO: Step 2 — add toolbar overlay
