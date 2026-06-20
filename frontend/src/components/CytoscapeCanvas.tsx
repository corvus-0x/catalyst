import cytoscape from "cytoscape";
// @ts-expect-error -- cytoscape-cose-bilkent has no bundled type declarations
import coseBilkent from "cytoscape-cose-bilkent";
// @ts-expect-error -- react-cytoscapejs has no bundled type declarations
import CytoscapeComponent from "react-cytoscapejs";

cytoscape.use(coseBilkent);

/* ─── Stylesheet — abstract markers (shape = type, color = state) ───────────── */
export const STYLESHEET = [
  /* Person — quiet slate filled circle */
  {
    selector: 'node[type="person"]',
    style: {
      "background-color": "#475569",
      "border-width": 1.5,
      "border-color": "#64748b",
      "border-style": "solid",
      shape: "ellipse",
      width: 26,
      height: 26,
      label: "data(label)",
      "text-valign": "center",
      "text-halign": "right",
      "text-margin-x": 8,
      color: "#e2e8f0",
      "text-outline-color": "#0d1117",
      "text-outline-width": 2,
      "font-size": 9,
      "font-weight": "500",
      "text-wrap": "wrap",
      "text-max-width": 110,
    },
  },
  /* Organization — quiet slate rounded square */
  {
    selector: 'node[type="organization"]',
    style: {
      "background-color": "#475569",
      "border-width": 1.5,
      "border-color": "#64748b",
      "border-style": "solid",
      shape: "round-rectangle",
      width: 26,
      height: 26,
      label: "data(label)",
      "text-valign": "center",
      "text-halign": "right",
      "text-margin-x": 8,
      color: "#e2e8f0",
      "text-outline-color": "#0d1117",
      "text-outline-width": 2,
      "font-size": 9,
      "font-weight": "500",
      "text-wrap": "wrap",
      "text-max-width": 110,
    },
  },
  /* Substantiated thread → green border (state color) */
  {
    selector: "node[?has_substantiated_thread]",
    style: { "border-color": "#34d399", "border-width": 3 },
  },
  /* Unknown status → dashed border (neutral, NOT red, NOT an accusation) */
  {
    selector: "node[?status_unknown]",
    style: { "border-style": "dashed", "border-color": "#94a3b8" },
  },
  /* Selected → amber outline, drawn outside the border so it stacks with state */
  {
    selector: "node:selected",
    style: { "outline-width": 3, "outline-color": "#fbbf24", "outline-offset": 2 },
  },
  /* Active-thread badge — small amber dot */
  {
    selector: ".badge",
    style: {
      width: 9,
      height: 9,
      shape: "ellipse",
      "background-color": "#fbbf24",
      "border-width": 1,
      "border-color": "#0d1117",
      label: "",
      events: "no",
      "z-index": 999,
    },
  },
  /* Dimmed (reserved for Phase 3 Thread Path Mode) */
  { selector: ".dimmed", style: { opacity: 0.1 } },
  /* Summary edges — neutral grey, width from strength level */
  {
    selector: "edge.summary",
    style: {
      width: "data(width)",
      "curve-style": "bezier",
      "line-color": "#64748b",
      "target-arrow-shape": "none",
      opacity: 0.6,
    },
  },
  /* Material edges — subtle emphasis (still neutral, no severity color in 1B) */
  {
    selector: "edge.material",
    style: { "line-color": "#94a3b8", opacity: 0.85 },
  },
];

/* ─── Position badge nodes at top-right of their main node after layout ────── */
function positionBadges(cy: cytoscape.Core) {
  cy.nodes(".badge").forEach((badge) => {
    const mainId = badge.data("mainNodeId") as string;
    const main = cy.getElementById(mainId);
    if (main.length === 0) return;
    const pos = main.position();
    const w = main.outerWidth();
    const h = main.outerHeight();
    badge.position({
      x: pos.x + w * 0.38,
      y: pos.y - h * 0.38,
    });
  });
}

/* ─── Component ──────────────────────────────────────────────────────────── */

/** Active-thread badge descriptor — a small amber dot at the node's top-right. */
export interface BadgeDescriptor {
  nodeId: string;
}

interface CytoscapeCanvasProps {
  elements: cytoscape.ElementDefinition[];
  /** Badges are injected after layout completes — keep them out of the initial elements array */
  badges?: BadgeDescriptor[];
  onNodeClick?: (id: string) => void;
  onEdgeClick?: (id: string) => void;
  /** Called once when the Cytoscape instance is ready — use to store a ref for fit()/zoom() */
  onCyInit?: (cy: cytoscape.Core) => void;
  /** When true, disables zoom/pan/selection — used for the minimap overlay */
  interactionDisabled?: boolean;
}

export default function CytoscapeCanvas({
  elements,
  badges,
  onNodeClick,
  onEdgeClick,
  onCyInit,
  interactionDisabled = false,
}: CytoscapeCanvasProps) {
  function handleCyInit(cy: cytoscape.Core) {
    onCyInit?.(cy);

    // After layout: remove old badges, inject fresh ones at correct positions
    cy.on("layoutstop", () => {
      cy.nodes(".badge").remove();

      if (badges?.length) {
        badges.forEach((b) => {
          const main = cy.getElementById(b.nodeId);
          if (!main.length) return;
          const pos = main.position();
          const w = main.outerWidth();
          const h = main.outerHeight();
          cy.add({
            data: { id: `badge-${b.nodeId}`, mainNodeId: b.nodeId },
            classes: "badge",
            position: { x: pos.x + w * 0.38, y: pos.y - h * 0.38 },
          });
        });
      }

      positionBadges(cy);
    });

    if (interactionDisabled) {
      cy.userZoomingEnabled(false);
      cy.userPanningEnabled(false);
      cy.boxSelectionEnabled(false);
      cy.autoungrabify(true);
    } else {
      // Tap a main node (ignore badge circle clicks)
      cy.on("tap", "node", (evt) => {
        const node = evt.target as cytoscape.NodeSingular;
        if (node.hasClass("badge")) return;
        onNodeClick?.(node.id());
      });

      cy.on("tap", "edge", (evt) => {
        const edge = evt.target as cytoscape.EdgeSingular;
        onEdgeClick?.(edge.id());
      });

      // Reposition badges when a node is dragged
      cy.on("dragfree", "node", () => positionBadges(cy));
    }
  }

  return (
    <CytoscapeComponent
      elements={elements}
      stylesheet={STYLESHEET}
      layout={{
        name: "cose-bilkent",
        nodeDimensionsIncludeLabels: true,
        idealEdgeLength: 120,
        nodeRepulsion: 6500,
        animate: false,
      }}
      style={{ width: "100%", height: "100%", outline: "none" }}
      className="cytoscape-container"
      cy={handleCyInit}
    />
  );
}
