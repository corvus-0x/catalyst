import { describe, expect, it } from "vitest";
import {
    edgeCategory,
    edgeLabel,
    edgeToElement,
    evidenceWeightClass,
    nodeToElement,
    toCytoscapeElements,
} from "./graphElements";
import type { GraphEdge, GraphNode } from "../../types";

function node(partial: Partial<GraphNode> & Pick<GraphNode, "id" | "type" | "label">): GraphNode {
    return {
        metadata: { finding_count: 0, doc_count: 0 },
        ...partial,
    };
}

function edge(partial: Partial<GraphEdge> & Pick<GraphEdge, "source" | "target">): GraphEdge {
    return {
        relationship: "CO_APPEARS_IN",
        label: "",
        weight: 1,
        metadata: {},
        ...partial,
    };
}

describe("nodeToElement", () => {
    it("encodes type as a Cytoscape class", () => {
        const out = nodeToElement(node({ id: "p1", type: "person", label: "Karen" }));
        expect(out.classes).toContain("entity");
        expect(out.classes).toContain("entity-person");
        expect(out.data.id).toBe("p1");
        expect(out.data.label).toBe("Karen");
        expect(out.data.nodeType).toBe("person");
    });

    it("flags nodes with at least one finding", () => {
        const out = nodeToElement(
            node({
                id: "o1",
                type: "organization",
                label: "Acme",
                metadata: { finding_count: 3, doc_count: 5 },
            }),
        );
        expect(out.classes).toContain("flagged");
        expect(out.data.finding_count).toBe(3);
        expect(out.data.doc_count).toBe(5);
    });

    it("does NOT add the flagged class when finding_count is 0", () => {
        const out = nodeToElement(node({ id: "p1", type: "person", label: "Quiet" }));
        expect(out.classes).not.toContain("flagged");
    });

    it("handles missing metadata defensively", () => {
        const out = nodeToElement({
            id: "x",
            type: "property",
            label: "Land",
            // @ts-expect-error — exercising runtime guard
            metadata: undefined,
        });
        expect(out.data.finding_count).toBe(0);
        expect(out.data.doc_count).toBe(0);
    });
});

describe("edgeCategory", () => {
    it.each([
        ["OFFICER_OF", "officer"],
        ["CO_OFFICER", "officer"],
        ["CO_APPEARS_IN", "citation"],
        ["PURCHASED", "property"],
        ["SOLD_BY", "property"],
        ["FAMILY", "family"],
        ["SPOUSE", "family"],
        ["PARENT_CHILD", "family"],
        ["SIBLING", "family"],
        ["BUSINESS_PARTNER", "business"],
        ["SOCIAL_CONNECTION", "social"],
        ["MYSTERY_FUTURE_REL", "other"],
    ])("maps %s -> %s", (rel, expected) => {
        expect(edgeCategory(rel)).toBe(expected);
    });

    it("treats empty string as 'other'", () => {
        expect(edgeCategory("")).toBe("other");
    });
});

describe("evidenceWeightClass", () => {
    it("0 docs is speculative", () => expect(evidenceWeightClass(0)).toBe("weight-speculative"));
    it("1 doc is directional", () => expect(evidenceWeightClass(1)).toBe("weight-directional"));
    it("2 docs is documented", () => expect(evidenceWeightClass(2)).toBe("weight-documented"));
    it("3+ docs is traced", () => {
        expect(evidenceWeightClass(3)).toBe("weight-traced");
        expect(evidenceWeightClass(99)).toBe("weight-traced");
    });
});

describe("edgeLabel", () => {
    it("uses the supplied label when provided", () => {
        expect(edgeLabel(edge({ source: "a", target: "b", label: "Officer Since 2018" })))
            .toBe("Officer Since 2018");
    });

    it("humanizes the relationship enum when label is empty", () => {
        expect(edgeLabel(edge({ source: "a", target: "b", relationship: "OFFICER_OF", label: "" })))
            .toBe("Officer Of");
        expect(edgeLabel(edge({ source: "a", target: "b", relationship: "PARENT_CHILD", label: "" })))
            .toBe("Parent Child");
    });
});

describe("edgeToElement", () => {
    it("builds a stable composite id", () => {
        const out = edgeToElement(edge({ source: "a", target: "b", relationship: "OFFICER_OF" }));
        expect(out.data.id).toBe("a::b::OFFICER_OF");
    });

    it("attaches the right category + evidence-weight classes", () => {
        const out = edgeToElement(
            edge({
                source: "a",
                target: "b",
                relationship: "CO_APPEARS_IN",
                metadata: { document_ids: ["d1", "d2"] },
            }),
        );
        expect(out.classes).toContain("rel-citation");
        expect(out.classes).toContain("weight-documented");
        expect(out.data.document_ids).toEqual(["d1", "d2"]);
    });

    it("falls back to weight-speculative when no documents are cited", () => {
        const out = edgeToElement(edge({ source: "a", target: "b", relationship: "FAMILY" }));
        expect(out.classes).toContain("weight-speculative");
    });
});

describe("toCytoscapeElements", () => {
    it("emits nodes first, then edges, in stable order", () => {
        const nodes: GraphNode[] = [
            node({ id: "p1", type: "person", label: "A" }),
            node({ id: "o1", type: "organization", label: "B" }),
        ];
        const edges: GraphEdge[] = [
            edge({ source: "p1", target: "o1", relationship: "OFFICER_OF" }),
        ];
        const out = toCytoscapeElements(nodes, edges);
        expect(out).toHaveLength(3);
        expect(out[0].data.id).toBe("p1");
        expect(out[1].data.id).toBe("o1");
        expect(out[2].data.id).toBe("p1::o1::OFFICER_OF");
    });
});
