/**
 * Pure conversion from Catalyst's graph response shape into Cytoscape.js
 * elements (`{ data, classes }` records). Split out from the React component
 * so it can be unit-tested without a canvas/jsdom dependency.
 *
 * Why we encode `type` as a Cytoscape *class* and `subtype` separately as
 * data: the stylesheet (in EntityGraphCytoscape.tsx) keys all visual
 * properties off classes, so the same class system drives shape + color.
 */
import type { GraphEdge, GraphNode, GraphNodeType } from "../../types";

export interface CyNodeElement {
    data: {
        id: string;
        label: string;
        nodeType: GraphNodeType;
        finding_count: number;
        doc_count: number;
    };
    classes: string;
}

export interface CyEdgeElement {
    data: {
        id: string;
        source: string;
        target: string;
        relationship: string;
        label: string;
        weight: number;
        document_ids: string[];
    };
    classes: string;
}

export type CyElement = CyNodeElement | CyEdgeElement;

/**
 * Map a GraphNode → Cytoscape node element. Class encodes:
 *   • nodeType    (person | organization | property | financial_instrument)
 *   • flagged     (when finding_count > 0 — drives the badge ring)
 */
export function nodeToElement(node: GraphNode): CyNodeElement {
    const classes = ["entity", `entity-${node.type}`];
    if ((node.metadata?.finding_count ?? 0) > 0) classes.push("flagged");
    return {
        data: {
            id: node.id,
            label: node.label,
            nodeType: node.type,
            finding_count: node.metadata?.finding_count ?? 0,
            doc_count: node.metadata?.doc_count ?? 0,
        },
        classes: classes.join(" "),
    };
}

/**
 * Map a GraphEdge → Cytoscape edge element. Class encodes:
 *   • relationship category (officer | citation | property | family | other)
 *
 * Citation density (document_ids.length) is the proxy for evidence weight
 * until the backend exposes per-edge `[Doc-N]` references per spec §8.2.
 *   0 docs           → speculative   (1px dashed)
 *   1 doc            → directional   (1.5px solid)
 *   2 docs           → documented    (2px solid)
 *   3+ docs          → traced        (2.5px solid + glow)
 */
export function edgeToElement(edge: GraphEdge): CyEdgeElement {
    const documentIds = edge.metadata?.document_ids ?? [];
    const evidenceClass = evidenceWeightClass(documentIds.length);
    const classes = [
        "relationship",
        `rel-${edgeCategory(edge.relationship)}`,
        evidenceClass,
    ];
    return {
        data: {
            // Cytoscape requires a stable id; collapsed CO_APPEARS_IN edges
            // can repeat (source, target) so include the relationship type.
            id: `${edge.source}::${edge.target}::${edge.relationship}`,
            source: edge.source,
            target: edge.target,
            relationship: edge.relationship,
            label: edgeLabel(edge),
            weight: edge.weight,
            document_ids: documentIds,
        },
        classes: classes.join(" "),
    };
}

export function edgeCategory(relationship: string): string {
    const r = (relationship || "").toUpperCase();
    if (r === "OFFICER_OF" || r === "CO_OFFICER") return "officer";
    if (r === "CO_APPEARS_IN") return "citation";
    if (r === "PURCHASED" || r === "SOLD_BY") return "property";
    if (
        r === "FAMILY" ||
        r === "SPOUSE" ||
        r === "PARENT_CHILD" ||
        r === "SIBLING"
    ) {
        return "family";
    }
    if (r === "BUSINESS_PARTNER") return "business";
    if (r === "SOCIAL_CONNECTION") return "social";
    return "other";
}

export function evidenceWeightClass(docCount: number): string {
    if (docCount >= 3) return "weight-traced";
    if (docCount === 2) return "weight-documented";
    if (docCount === 1) return "weight-directional";
    return "weight-speculative";
}

/**
 * Edge label: prefer the backend-provided human label; fall back to a
 * humanized form of the relationship enum.
 */
export function edgeLabel(edge: GraphEdge): string {
    if (edge.label) return edge.label;
    return (edge.relationship || "")
        .toLowerCase()
        .split("_")
        .map((s) => (s ? s[0].toUpperCase() + s.slice(1) : s))
        .join(" ");
}

/**
 * Build the full Cytoscape elements array from a CaseGraphResponse subset.
 */
export function toCytoscapeElements(
    nodes: GraphNode[],
    edges: GraphEdge[],
): CyElement[] {
    return [
        ...nodes.map(nodeToElement),
        ...edges.map(edgeToElement),
    ];
}
