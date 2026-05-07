import cytoscape from "cytoscape";
// @ts-expect-error -- cytoscape-cose-bilkent has no bundled type declarations
import coseBilkent from "cytoscape-cose-bilkent";
// @ts-expect-error -- react-cytoscapejs has no bundled type declarations
import CytoscapeComponent from "react-cytoscapejs";

cytoscape.use(coseBilkent);

/* ─── Stylesheet ─────────────────────────────────────────────────────────────
   Colors match the HTML wireframes exactly:
   Person  → pastel blue fill  (#E6F1FB), blue stroke  (#185FA5), dark blue text (#0C447C)
   Org     → pastel teal fill  (#E1F5EE), teal stroke  (#1D9E75), dark teal text (#085041)
   Org/LLC → pastel amber fill (#FAEEDA), amber stroke (#BA7517), dark amber text (#633806)
   Selected → white fill, gold border
   Badge   → small green circle overlaid at top-right of nodes with findings
─────────────────────────────────────────────────────────────────────────── */
const STYLESHEET = [
  /* ── Person knots — pastel blue ── */
  {
    selector: 'node[type="person"]',
    style: {
      "background-color": "#E6F1FB",
      "border-width": 1.5,
      "border-color": "#185FA5",
      color: "#0C447C",
      label: "data(label)",
      "text-valign": "center",
      "text-halign": "center",
      "font-size": 10,
      "font-weight": "500",
      "text-wrap": "wrap",
      "text-max-width": 72,
      width: 66,
      height: 66,
      shape: "ellipse",
    },
  },

  /* ── Organization knots — nonprofit/default: pastel teal ── */
  {
    selector: 'node[type="org"]',
    style: {
      "background-color": "#E1F5EE",
      "border-width": 1.5,
      "border-color": "#1D9E75",
      color: "#085041",
      label: "data(label)",
      "text-valign": "center",
      "text-halign": "center",
      "font-size": 9.5,
      "font-weight": "500",
      "text-wrap": "wrap",
      "text-max-width": 90,
      width: 110,
      height: 44,
      shape: "roundrectangle",
    },
  },

  /* ── Org override: LLC / contractor → amber ── */
  {
    selector: 'node[type="org"][org_type="LLC"]',
    style: {
      "background-color": "#FAEEDA",
      "border-color": "#BA7517",
      color: "#633806",
    },
  },

  /* ── Org override: legal firm → purple ── */
  {
    selector: 'node[type="org"][org_type="LEGAL"]',
    style: {
      "background-color": "#EEEDFE",
      "border-color": "#534AB7",
      color: "#26215C",
    },
  },

  /* ── Org override: shell/unknown → coral ── */
  {
    selector: 'node[type="org"][org_type="UNKNOWN"]',
    style: {
      "background-color": "#FAECE7",
      "border-color": "#D85A30",
      color: "#4A1B0C",
    },
  },

  /* ── Badge nodes (finding count overlays — added after layout via cy.add()) ── */
  {
    selector: ".badge",
    style: {
      width: 18,
      height: 18,
      shape: "ellipse",
      "background-color": "#1D9E75",
      "border-width": 1.5,
      "border-color": "#ffffff",
      color: "#ffffff",
      label: "data(label)",
      "text-valign": "center",
      "text-halign": "center",
      "font-size": 9,
      "font-weight": "bold",
      events: "no",
      "z-index": 999,
    },
  },

  /* ── Active (NEEDS_EVIDENCE) badge → red ── */
  {
    selector: ".badge.badge-active",
    style: {
      "background-color": "#E24B4A",
    },
  },

  /* ── Selected knot — white fill, gold border ── */
  {
    selector: "node:selected",
    style: {
      "background-color": "#ffffff",
      "border-width": 2.5,
      "border-color": "#f59e0b",
      color: "#111827",
    },
  },

  /* ── Dimmed elements ── */
  {
    selector: ".dimmed",
    style: { opacity: 0.15 },
  },

  /* ── Edge: severity-based colour ── */
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

  /* ── Proposed connections — dashed gray ── */
  {
    selector: 'edge[status="proposed"]',
    style: {
      "line-style": "dashed",
      "line-color": "#9ca3af",
      "target-arrow-color": "#9ca3af",
    },
  },

  /* ── Manual connections — dotted, slightly thicker ── */
  {
    selector: 'edge[source_type="manual"]',
    style: {
      "line-style": "dotted",
      width: 2.5,
    },
  },

  /* ── Default edge ── */
  {
    selector: "edge",
    style: {
      width: 2,
      "curve-style": "bezier",
      "target-arrow-shape": "none",
      "line-color": "#9ca3af",
      "target-arrow-color": "#9ca3af",
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
      x: pos.x + w * 0.38,
      y: pos.y - h * 0.38,
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
      layout={{ name: "cose-bilkent" }}
      style={{ width: "100%", height: "100%", outline: "none" }}
      className="cytoscape-container"
      cy={handleCyInit}
    />
  );
}
