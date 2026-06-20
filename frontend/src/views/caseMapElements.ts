/**
 * Pure Case Map element mapping — the single home of Case Map visual encoding.
 *
 * These functions turn the /case-map/ contract (SubjectNode / SummaryEdge) into
 * Cytoscape element `data`/`classes`. The stylesheet in CytoscapeCanvas only
 * *selects* on the attributes set here, so the visual rules are unit-testable
 * without rendering Cytoscape. Shape = type; color = state (spec §10).
 */
import type { SubjectNode, SummaryEdge, EdgeStrengthLevel } from "../types";

/** Discrete edge widths per strength level (observed thin → material strong). */
const EDGE_WIDTH: Record<EdgeStrengthLevel, number> = {
  observed: 1,
  documented: 2,
  repeated: 3.5,
  material: 5,
};

export function edgeWidthForLevel(level: EdgeStrengthLevel): number {
  return EDGE_WIDTH[level];
}

export function subjectNodeToElement(node: SubjectNode): {
  data: Record<string, unknown>;
  classes: string;
} {
  return {
    data: {
      id: node.id,
      label: node.label,
      type: node.type, // "person" | "organization" — stylesheet selects on this
      subtype: node.subtype ?? "",
      status_unknown: node.flags.status_unknown,
      has_active_thread: node.flags.has_active_thread,
      has_substantiated_thread: node.flags.has_substantiated_thread,
      thread_count: node.metadata.thread_count,
      document_count: node.metadata.document_count,
    },
    classes: "subject",
  };
}

export function summaryEdgeToElement(edge: SummaryEdge): {
  data: Record<string, unknown>;
  classes: string;
} {
  const level = edge.strength.level;
  return {
    data: {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      level,
      width: edgeWidthForLevel(level),
      label: edge.label,
    },
    classes: level === "material" ? "summary material" : "summary",
  };
}

/** Active-thread badge descriptors (the amber dot). Other states are borders. */
export function subjectBadges(nodes: SubjectNode[]): { nodeId: string }[] {
  return nodes
    .filter((n) => n.flags.has_active_thread)
    .map((n) => ({ nodeId: n.id }));
}
