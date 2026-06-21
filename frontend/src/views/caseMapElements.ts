/**
 * Pure Case Map element mapping — the single home of Case Map visual encoding.
 *
 * These functions turn the /case-map/ contract (SubjectNode / SummaryEdge) into
 * Cytoscape element `data`/`classes`. The stylesheet in CytoscapeCanvas only
 * *selects* on the attributes set here, so the visual rules are unit-testable
 * without rendering Cytoscape. Shape = type; color = state
 * (see docs/superpowers/specs/2026-06-19-case-map-and-thread-builder-design.md §10).
 */
import type {
  SubjectNode, SummaryEdge, EdgeStrengthLevel, FindingEntityLink, FindingSeverity,
} from "../types";

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

/** Compute the Case Map elements a thread relies on. Edge-backed threads come from
 *  edge.thread_refs; subject-only threads come from the finding's person/org entity_links. */
export function threadPath(args: {
  threadId: string;
  edges: SummaryEdge[];
  entityLinks: FindingEntityLink[];
}): { pathEdgeIds: string[]; participatingSubjectIds: string[] } {
  const pathEdgeIds: string[] = [];
  const subjects = new Set<string>();
  for (const e of args.edges) {
    if (e.thread_refs.some((r) => r.thread_id === args.threadId)) {
      pathEdgeIds.push(e.id);
      subjects.add(e.source);
      subjects.add(e.target);
    }
  }
  for (const l of args.entityLinks) {
    if (l.entity_type === "person" || l.entity_type === "organization") {
      subjects.add(l.entity_id);
    }
  }
  return { pathEdgeIds, participatingSubjectIds: [...subjects] };
}

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFORMATIONAL: 4,
};

/** Path-edge color suffix. Only elevated severities get color; LOW/INFORMATIONAL stay neutral. */
export function severityEdgeClass(sev: FindingSeverity): "" | "critical" | "high" | "medium" {
  switch (sev) {
    case "CRITICAL": return "critical";
    case "HIGH": return "high";
    case "MEDIUM": return "medium";
    default: return "";
  }
}

/** Sort comparator: most-severe first (CRITICAL → INFORMATIONAL). */
export function compareBySeverity(a: FindingSeverity, b: FindingSeverity): number {
  return SEVERITY_RANK[a] - SEVERITY_RANK[b];
}
