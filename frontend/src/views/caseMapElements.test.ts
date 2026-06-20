import { describe, it, expect } from "vitest";
import {
  edgeWidthForLevel,
  subjectNodeToElement,
  summaryEdgeToElement,
  subjectBadges,
} from "./caseMapElements";
import type { SubjectNode, SummaryEdge } from "../types";

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
