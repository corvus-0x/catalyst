import cytoscape from "cytoscape";
// @ts-expect-error -- cytoscape-cose-bilkent has no bundled type declarations
import coseBilkent from "cytoscape-cose-bilkent";
// @ts-expect-error -- react-cytoscapejs has no bundled type declarations
import CytoscapeComponent from "react-cytoscapejs";

cytoscape.use(coseBilkent);

/* ─── Node icons — ultra-minimal filled shapes, legible at 20px ─────────────
   Filled shapes (not strokes) scale down without blurring.
   Person: head circle + body ellipse — 2 shapes.
   Building: body rect + roof polygon + door rect — 3 shapes.
─────────────────────────────────────────────────────────────────────────── */
const PERSON_ICON = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">' +
  '<circle cx="10" cy="7" r="4" fill="rgba(255,255,255,0.92)"/>' +
  '<ellipse cx="10" cy="18" rx="7.5" ry="5" fill="rgba(255,255,255,0.92)"/>' +
  '</svg>'
);

const ORG_ICON = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">' +
  '<polygon points="0,9 10,2 20,9" fill="rgba(255,255,255,0.95)"/>' +
  '<rect x="1" y="9" width="18" height="10" fill="rgba(255,255,255,0.88)"/>' +
  '<rect x="7.5" y="13" width="5" height="6" fill="rgba(0,0,0,0.3)"/>' +
  '</svg>'
);

/* ─── Stylesheet ─────────────────────────────────────────────────────────────
   Gotham / data-tool aesthetic: nodes are small markers, labels float to
   the right, edges are the primary visual. The network is what you see;
   nodes are just anchors.

   3-color palette:
     Person  → blue  #3b82f6  (circle, 24px)
     Org     → teal  #0d9488  (rounded square, 26px)
     LLC     → amber #d97706  (rounded square, signals commercial/contractor)
     LEGAL   → violet #7c3aed
     UNKNOWN → red   #dc2626  (flags unknown/shell entities)

   Labels: right of node, vertically centered, white with dark outline.
   Edges: thin white/gray, labeled with relationship type, opacity varies
          with severity so critical connections read immediately.
─────────────────────────────────────────────────────────────────────────── */
const STYLESHEET = [
  /* ── Person knots — blue circle + person icon, 1px ring ── */
  {
    selector: 'node[type="person"]',
    style: {
      "background-color": "#3b82f6",
      "border-width": 1,
      "border-color": "#93c5fd",
      "background-image": PERSON_ICON,
      "background-fit": "contain",
      "background-width": "58%",
      "background-height": "58%",
      "background-position-x": "50%",
      "background-position-y": "48%",
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
      width: "mapData(finding_count, 0, 8, 22, 54)" as unknown as number,
      height: "mapData(finding_count, 0, 8, 22, 54)" as unknown as number,
      shape: "ellipse",
    },
  },

  /* ── Organization knots — teal square + building icon, 1px ring ── */
  {
    selector: 'node[type="org"]',
    style: {
      "background-color": "#0d9488",
      "border-width": 1,
      "border-color": "#5eead4",
      "background-image": ORG_ICON,
      "background-fit": "contain",
      "background-width": "58%",
      "background-height": "58%",
      "background-position-x": "50%",
      "background-position-y": "50%",
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
      width: "mapData(finding_count, 0, 8, 24, 58)" as unknown as number,
      height: "mapData(finding_count, 0, 8, 24, 58)" as unknown as number,
      shape: "roundrectangle",
    },
  },

  /* ── LLC / contractor → amber + ring ── */
  {
    selector: 'node[type="org"][org_type="LLC"]',
    style: { "background-color": "#d97706", "border-color": "#fcd34d" },
  },

  /* ── Legal firm → violet + ring ── */
  {
    selector: 'node[type="org"][org_type="LEGAL"]',
    style: { "background-color": "#7c3aed", "border-color": "#c4b5fd" },
  },

  /* ── Shell / unknown → red + ring ── */
  {
    selector: 'node[type="org"][org_type="UNKNOWN"]',
    style: { "background-color": "#dc2626", "border-color": "#fca5a5" },
  },

  /* ── Badge nodes ── */
  {
    selector: ".badge",
    style: {
      width: 14,
      height: 14,
      shape: "ellipse",
      "background-color": "#2563eb",
      "border-width": 1,
      "border-color": "#0d1117",
      color: "#ffffff",
      label: "data(label)",
      "text-valign": "center",
      "text-halign": "center",
      "font-size": 7,
      "font-weight": "bold",
      events: "no",
      "z-index": 999,
    },
  },

  /* ── Active badge → red ── */
  {
    selector: ".badge.badge-active",
    style: { "background-color": "#dc2626" },
  },

  /* ── Selected — bright ring ── */
  {
    selector: "node:selected",
    style: {
      "border-width": 2,
      "border-color": "#fbbf24",
    },
  },

  /* ── Dimmed ── */
  {
    selector: ".dimmed",
    style: { opacity: 0.1 },
  },

  /* ── Edges — severity sets colour and weight, arrow inherits colour ── */
  {
    selector: 'edge[severity="CRITICAL"]',
    style: {
      "line-color": "#ef4444",
      "target-arrow-color": "#ef4444",
      width: 1.5,
      opacity: 1,
    },
  },
  {
    selector: 'edge[severity="HIGH"]',
    style: {
      "line-color": "#f97316",
      "target-arrow-color": "#f97316",
      width: 1.5,
      opacity: 0.9,
    },
  },
  {
    selector: 'edge[severity="MEDIUM"]',
    style: {
      "line-color": "#94a3b8",
      "target-arrow-color": "#94a3b8",
      opacity: 0.7,
    },
  },
  {
    selector: 'edge[severity="INFORMATIONAL"]',
    style: {
      "line-color": "#475569",
      "target-arrow-color": "#475569",
      opacity: 0.45,
    },
  },
  /* Proposed edges stay arrowless — indicating unconfirmed relationships */
  {
    selector: 'edge[status="proposed"]',
    style: { "target-arrow-shape": "none" },
  },

  /* ── Proposed — dashed ── */
  {
    selector: 'edge[status="proposed"]',
    style: {
      "line-style": "dashed",
      "line-color": "#334155",
      opacity: 0.4,
    },
  },

  /* ── Manual — dotted ── */
  {
    selector: 'edge[source_type="manual"]',
    style: { "line-style": "dotted", width: 1.5 },
  },

  /* ── Default edge — thin, directed arrow ── */
  {
    selector: "edge",
    style: {
      width: 1,
      "curve-style": "bezier",
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.7,
      "target-arrow-color": "#64748b",
      "line-color": "#64748b",
      opacity: 0.55,
    },
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
      x: pos.x + w * 0.5,
      y: pos.y - h * 0.5,
    });
  });
}

/* ─── Component ──────────────────────────────────────────────────────────── */

/** Badge descriptor — added dynamically after layout so they don't confuse cose-bilkent */
export interface BadgeDescriptor {
  nodeId: string;
  count: number;
  /** true when the node has NEEDS_EVIDENCE findings → red badge */
  active: boolean;
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
          const w   = main.outerWidth();
          const h   = main.outerHeight();
          cy.add({
            data: { id: `badge-${b.nodeId}`, label: String(b.count), mainNodeId: b.nodeId },
            classes: b.active ? "badge badge-active" : "badge",
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
