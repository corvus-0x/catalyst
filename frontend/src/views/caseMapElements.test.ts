import { describe, it, expect } from "vitest";
import {
  edgeWidthForLevel,
  subjectNodeToElement,
  summaryEdgeToElement,
  subjectBadges,
  threadPath,
  severityEdgeClass,
  compareBySeverity,
} from "./caseMapElements";
import type { SubjectNode, SummaryEdge, FindingEntityLink, FindingSeverity } from "../types";

function node(over: Partial<SubjectNode> = {}): SubjectNode {
  return {
    id: "n1", type: "person", label: "Jay", subtype: null,
    flags: { status_unknown: false, has_active_thread: false, has_substantiated_thread: false },
    metadata: { thread_count: 0, document_count: 0 },
    ...over,
  };
}
function edge(level: SummaryEdge["strength"]["level"]): SummaryEdge {
  return {
    id: "a__b", source: "a", target: "b", relationship: "SUMMARY",
    label: "x", state: level,
    strength: {
      score: 0, level, categories: [], source_count: 0, transaction_count: 0,
      role_count: 0, thread_count: 0, substantiated_thread_count: 0,
      handoff_included: false, relationship_types: [], reasons: [],
    },
    evidence_refs: [], thread_refs: [], underlying_relationships: [],
  };
}

describe("edgeWidthForLevel", () => {
  it("increases monotonically observed < documented < repeated < material", () => {
    const w = (l: SummaryEdge["strength"]["level"]) => edgeWidthForLevel(l);
    expect(w("observed")).toBeLessThan(w("documented"));
    expect(w("documented")).toBeLessThan(w("repeated"));
    expect(w("repeated")).toBeLessThan(w("material"));
  });
});

describe("subjectNodeToElement", () => {
  it("maps person to ellipse data and carries flags", () => {
    const el = subjectNodeToElement(node({ type: "person" }));
    expect(el.data.id).toBe("n1");
    expect(el.data.type).toBe("person");
    expect(el.data.status_unknown).toBe(false);
  });
  it("flags status_unknown / substantiated as data attributes", () => {
    const el = subjectNodeToElement(node({
      type: "organization",
      flags: { status_unknown: true, has_active_thread: false, has_substantiated_thread: true },
    }));
    expect(el.data.type).toBe("organization");
    expect(el.data.status_unknown).toBe(true);
    expect(el.data.has_substantiated_thread).toBe(true);
  });
});

describe("summaryEdgeToElement", () => {
  it("carries level and a numeric width matching edgeWidthForLevel", () => {
    const el = summaryEdgeToElement(edge("repeated"));
    expect(el.data.level).toBe("repeated");
    expect(el.data.width).toBe(edgeWidthForLevel("repeated"));
    expect(el.data.source).toBe("a");
    expect(el.data.target).toBe("b");
  });
  it("tags material edges with a class for emphasis", () => {
    expect(summaryEdgeToElement(edge("material")).classes).toContain("material");
    expect(summaryEdgeToElement(edge("observed")).classes).not.toContain("material");
  });
});

describe("subjectBadges", () => {
  it("returns one badge per node with an active thread, none otherwise", () => {
    const nodes = [
      node({ id: "a", flags: { status_unknown: false, has_active_thread: true, has_substantiated_thread: false } }),
      node({ id: "b" }),
    ];
    expect(subjectBadges(nodes)).toEqual([{ nodeId: "a" }]);
  });
});

function edgeWithThreads(id: string, source: string, target: string, threadIds: string[]): SummaryEdge {
  const e = edge("documented");
  return {
    ...e,
    id, source, target,
    thread_refs: threadIds.map((tid) => ({
      thread_id: tid, title: "t", status: "NEEDS_EVIDENCE",
      severity: "HIGH", rule_id: "SR-015", signal_type: "INSIDER_SWAP", handoff_ready: false,
    })),
  };
}
function link(entity_id: string, entity_type: FindingEntityLink["entity_type"]): FindingEntityLink {
  return { entity_id, entity_type, context_note: "" };
}

describe("threadPath", () => {
  it("returns path edges referencing the thread and their endpoints", () => {
    const edges = [
      edgeWithThreads("a__b", "a", "b", ["T1"]),
      edgeWithThreads("b__c", "b", "c", ["T1"]),
      edgeWithThreads("c__d", "c", "d", ["T2"]),
    ];
    const r = threadPath({ threadId: "T1", edges, entityLinks: [] });
    expect(r.pathEdgeIds.sort()).toEqual(["a__b", "b__c"]);
    expect(r.participatingSubjectIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("lights a subject-only thread from entity_links when no edge matches", () => {
    const edges = [edgeWithThreads("a__b", "a", "b", ["OTHER"])];
    const r = threadPath({
      threadId: "T1", edges,
      entityLinks: [link("p1", "person"), link("o1", "organization")],
    });
    expect(r.pathEdgeIds).toEqual([]);
    expect(r.participatingSubjectIds.sort()).toEqual(["o1", "p1"]);
  });

  it("ignores non-subject entity_links (property / financial_instrument)", () => {
    // EntityType = "person" | "organization" | "property" | "financial_instrument"
    const r = threadPath({
      threadId: "T1", edges: [],
      entityLinks: [link("pr1", "property"), link("fi1", "financial_instrument"), link("p1", "person")],
    });
    expect(r.participatingSubjectIds).toEqual(["p1"]);
  });

  it("returns both empty when the thread has no map presence", () => {
    const r = threadPath({ threadId: "T1", edges: [edgeWithThreads("a__b", "a", "b", ["X"])], entityLinks: [] });
    expect(r.pathEdgeIds).toEqual([]);
    expect(r.participatingSubjectIds).toEqual([]);
  });

  it("dedups a subject that is both an edge endpoint and an entity_link", () => {
    const edges = [edgeWithThreads("a__b", "a", "b", ["T1"])];
    const r = threadPath({ threadId: "T1", edges, entityLinks: [link("a", "person")] });
    expect(r.participatingSubjectIds.sort()).toEqual(["a", "b"]);
  });
});

describe("severityEdgeClass", () => {
  it("maps CRITICAL/HIGH/MEDIUM to a suffix and LOW/INFORMATIONAL to empty", () => {
    expect(severityEdgeClass("CRITICAL")).toBe("critical");
    expect(severityEdgeClass("HIGH")).toBe("high");
    expect(severityEdgeClass("MEDIUM")).toBe("medium");
    expect(severityEdgeClass("LOW")).toBe("");
    expect(severityEdgeClass("INFORMATIONAL")).toBe("");
  });
});

describe("compareBySeverity", () => {
  it("orders CRITICAL > HIGH > MEDIUM > LOW > INFORMATIONAL", () => {
    const order: FindingSeverity[] = ["INFORMATIONAL", "CRITICAL", "MEDIUM", "LOW", "HIGH"];
    expect([...order].sort(compareBySeverity)).toEqual(
      ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL"],
    );
  });
});
